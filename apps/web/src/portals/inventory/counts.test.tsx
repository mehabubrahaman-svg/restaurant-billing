import type { StockCount } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  COUNT_DRAFT,
  countLine,
  EGGS,
  ITEMS,
  KG,
  makeAlerts,
  makeCount,
  postedCount,
  RICE,
  rice,
  UNITS,
} from '../../test/inventory-fixtures';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const COUNTER = ['inventory.view', 'inventory.count', 'inventory.adjust'];
const NEW_COUNT = '1c000000-0000-4000-8000-000000000003';

const summaryOf = ({ lines: _lines, ...summary }: StockCount) => summary;

function hub(routes: Record<string, Handler> = {}, permissions = COUNTER) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /inventory-items': () => json({ data: ITEMS }),
    'GET /units': () => json({ data: UNITS }),
    'GET /stock/alerts': () => json(makeAlerts()),
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls
    .filter(
      ([u, init]) =>
        new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
        (init?.method ?? 'GET') === method,
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

/** A Hub that keeps one count and moves it through save and post. */
function countHub(permissions = COUNTER) {
  let count = makeCount();
  return hub(
    {
      [`GET /stock-counts/${COUNT_DRAFT}`]: () => json(count),
      [`PUT /stock-counts/${COUNT_DRAFT}/lines`]: ({ body }) => {
        const { lines } = body as { lines: { inventoryItemId: string; countedQtyMilli: number }[] };
        count = makeCount({
          version: count.version + 1,
          counted: lines.length,
          lines: count.lines.map((l) => {
            const item = ITEMS.find((i) => i.id === l.inventoryItemId)!;
            const saved = lines.find((x) => x.inventoryItemId === l.inventoryItemId);
            return saved === undefined
              ? l
              : countLine(item, l.systemQtyMilli, saved.countedQtyMilli);
          }),
        });
        return json(count);
      },
      [`POST /stock-counts/${COUNT_DRAFT}/post`]: () => {
        count = postedCount();
        return json(count);
      },
    },
    permissions,
  );
}

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Stock counts', () => {
  it('lists counts and starts a new one', async () => {
    const fetchMock = hub({
      'GET /stock-counts': () => json({ data: [summaryOf(postedCount())] }),
      'POST /stock-counts': () => json(makeCount({ id: NEW_COUNT }), 201),
      [`GET /stock-counts/${NEW_COUNT}`]: () => json(makeCount({ id: NEW_COUNT })),
    });
    const { router } = renderApp('/inventory/counts');
    const table = await screen.findByRole('table', { name: 'Stock counts' });
    const row = within(table).getByRole('link', { name: '28 Oct 2026' }).closest('tr')!;
    expect(row).toHaveTextContent('Closing');
    expect(row).toHaveTextContent('Posted');
    expect(row).toHaveTextContent('-₹43.34');
    expect(row).toHaveTextContent('Posted by Ananya Sen');
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'New count' }));
    const dialog = screen.getByRole('dialog', { name: 'New count' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Closing' }));
    expect(within(dialog).getByText('At the end of the day, after service.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'After dinner' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start counting' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/inventory/counts/${NEW_COUNT}`),
    );
    expect(callsTo(fetchMock, 'POST', '/stock-counts')).toEqual([
      { countType: 'CLOSING', notes: 'After dinner' },
    ]);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Closing count · 28 Oct 2026' }),
    ).toBeInTheDocument();
  });

  it('shows the difference as quantities are typed, saves with the version, then posts', async () => {
    const fetchMock = countHub();
    renderApp(`/inventory/counts/${COUNT_DRAFT}`);
    const sheet = await screen.findByRole('table', { name: 'Count sheet' });
    // A counted line keeps the books from when it was counted: posting books only the difference.
    expect(
      within(sheet).getByRole('columnheader', { name: 'Books when counted' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/so sales made during the count still count\.$/)).toBeInTheDocument();
    const riceRow = within(sheet).getByText('Basmati rice').closest('tr')!;
    // Counted in the unit rice is bought in.
    expect(riceRow).toHaveTextContent('28.5 kg');
    expect(within(riceRow).getByLabelText('Unit for Basmati rice')).toHaveValue('unit-kg');
    fireEvent.change(within(riceRow).getByLabelText('Counted Basmati rice'), {
      target: { value: '28' },
    });
    // 500 g short at ₹86.67 a kg.
    expect(riceRow).toHaveTextContent('-0.5 kg');
    expect(riceRow).toHaveTextContent('-₹43.34');
    expect(screen.getByText('Counted', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '1 of 6',
    );
    expect(
      screen.getByText('Difference in value', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('-₹43.34');
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Save counts' }));
    expect(await screen.findByText('Counts saved.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', `/stock-counts/${COUNT_DRAFT}/lines`)).toEqual([
      { version: 1, lines: [{ inventoryItemId: RICE, countedQtyMilli: 28 * KG }] },
    ]);
    expect(within(riceRow).getByLabelText('Counted Basmati rice')).toHaveValue('28');
    expect(screen.getByRole('button', { name: 'Save counts' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    const confirm = screen.getByRole('dialog', { name: 'Post this count?' });
    // Booked against the books when each item was counted: sales made since still count.
    expect(confirm).toHaveTextContent(
      'The differences for 1 item are booked, -₹43.34 in all. Each is counted against the books when it was counted, so sales made since still count.',
    );
    fireEvent.click(within(confirm).getByRole('button', { name: 'Post count' }));
    expect(
      await screen.findByText('Count posted: the differences are booked.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', `/stock-counts/${COUNT_DRAFT}/post`)).toEqual([
      { version: 2 },
    ]);
    // Posted: read-only, with what posting booked.
    await waitFor(() => expect(screen.queryByLabelText('Counted Basmati rice')).toBeNull());
    expect(screen.getByText(/Posted by Ananya Sen/)).toBeInTheDocument();
    const posted = screen.getByRole('table', { name: 'Count sheet' });
    expect(within(posted).getByText('Basmati rice').closest('tr')).toHaveTextContent('-0.5 kg');
    expect(within(posted).getByText('Flour').closest('tr')).toHaveTextContent('Matches');
    expect(screen.queryByRole('button', { name: 'Post count' })).toBeNull();
  });

  it('values the whole count the way the Hub does: rounded once, not line by line', async () => {
    countHub();
    renderApp(`/inventory/counts/${COUNT_DRAFT}`);
    const sheet = await screen.findByRole('table', { name: 'Count sheet' });
    fireEvent.change(within(sheet).getByLabelText('Counted Basmati rice'), {
      target: { value: '28' },
    });
    fireEvent.change(within(sheet).getByLabelText('Counted Chicken'), {
      target: { value: '14.7' },
    });
    // -₹43.335 and -₹72.999 show as -₹43.34 and -₹73.00; together they are -₹116.33.
    expect(within(sheet).getByText('Chicken').closest('tr')).toHaveTextContent('-₹73.00');
    expect(
      screen.getByText('Difference in value', { selector: 'dt' }).nextElementSibling,
    ).toHaveTextContent('-₹116.33');
  });

  it('refuses an unreadable quantity, and saves what was typed before posting', async () => {
    const fetchMock = countHub();
    renderApp(`/inventory/counts/${COUNT_DRAFT}`);
    const sheet = await screen.findByRole('table', { name: 'Count sheet' });
    const eggs = within(sheet).getByText('Eggs').closest('tr')!;
    // 36 eggs are 3 dozen; a typo is refused, not sent.
    expect(within(eggs).getByLabelText('Unit for Eggs')).toHaveValue('unit-dozen');
    fireEvent.change(within(eggs).getByLabelText('Counted Eggs'), { target: { value: '2.5.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save counts' }));
    expect(await screen.findByText(/1 quantity can’t be read/)).toBeInTheDocument();
    expect(within(eggs).getByLabelText('Counted Eggs')).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(fetchMock, 'PUT', `/stock-counts/${COUNT_DRAFT}/lines`)).toEqual([]);

    fireEvent.change(within(eggs).getByLabelText('Counted Eggs'), { target: { value: '2.5' } });
    expect(eggs).toHaveTextContent('-0.5 dozen');
    fireEvent.click(screen.getByRole('button', { name: 'Post count' }));
    const confirm = screen.getByRole('dialog', { name: 'Post this count?' });
    expect(confirm).toHaveTextContent('Counts not saved yet are saved first.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Post count' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', `/stock-counts/${COUNT_DRAFT}/post`)).toEqual([
        { version: 2 },
      ]),
    );
    expect(callsTo(fetchMock, 'PUT', `/stock-counts/${COUNT_DRAFT}/lines`)).toEqual([
      { version: 1, lines: [{ inventoryItemId: EGGS, countedQtyMilli: 30_000 }] },
    ]);
  });

  it('lets counters count but not post, and others only look', async () => {
    countHub(['inventory.view', 'inventory.count']);
    const view = renderApp(`/inventory/counts/${COUNT_DRAFT}`);
    expect(await screen.findByLabelText('Counted Basmati rice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save counts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post count' })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    useAuthStore.setState({ status: 'restoring', session: null });

    countHub(['inventory.view']);
    renderApp(`/inventory/counts/${COUNT_DRAFT}`);
    expect(
      await screen.findByText(
        'You can see this count; entering quantities needs the count permission.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Counted/ })).toBeNull();
    expect(screen.getByText(rice.name).closest('tr')).toHaveTextContent('Not counted');
  });
});
