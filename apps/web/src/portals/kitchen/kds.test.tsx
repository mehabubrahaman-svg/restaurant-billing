import type { Kot } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { kotUrgency } from '../../features/kitchen/kot-timing';
import { i18n } from '../../i18n';
import { chime } from '../../lib/chime';
import { removeStorage, STORAGE_KEYS } from '../../lib/storage';
import { useDeviceStore } from '../../stores/device-store';
import { expectNoAxeViolations } from '../../test/axe';
import { makeSnapshot, STATION_MAIN } from '../../test/catalog-fixtures';
import { FakeSocket } from '../../test/fake-socket';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import {
  envelope,
  KOT_1,
  KOT_2,
  KOT_3,
  LINE_2,
  LINE_3,
  makeKot,
  makeKotItem,
} from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { KDS_TICK_MS } from './kds-board';

vi.mock('../../lib/chime', () => ({
  chime: vi.fn(),
  unlockAudio: vi.fn(async () => false),
  audioReady: () => false,
}));

const T0 = Date.parse('2026-10-28T12:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const TANDOOR = 'd0000000-0000-4000-8000-000000000002';

/** Now is T0 + 13 min. */
function board(): Kot[] {
  return [
    // 13 of 15 minutes used (87%): amber.
    makeKot({
      id: KOT_1,
      kotNo: 34,
      firedAt: at(0),
      targetReadyAt: at(15),
      items: [
        makeKotItem({
          name: 'Chicken Biryani',
          quantity: 2,
          specialNote: 'less spicy',
          addons: [{ name: 'Raita', quantity: 1 }],
        }),
        makeKotItem({
          id: LINE_2,
          name: 'Butter Naan',
          quantity: 4,
          status: 'CANCELLED',
          cancelReason: 'Guest changed mind',
        }),
      ],
    }),
    // Past its target: red.
    makeKot({
      id: KOT_2,
      kotNo: 28,
      status: 'COOKING',
      tableLabel: 'T3',
      firedAt: at(-5),
      targetReadyAt: at(10),
      version: 4,
      items: [makeKotItem({ id: LINE_3, name: 'Dal Makhani', quantity: 1, status: 'PREPARING' })],
    }),
    // Fresh: neutral.
    makeKot({
      id: KOT_3,
      kotNo: 35,
      status: 'ACCEPTED',
      tableLabel: null,
      tokenNo: 12,
      orderType: 'TAKEAWAY',
      firedAt: at(12),
      targetReadyAt: at(27),
      assignedChefName: 'Subrata Bose',
      version: 2,
    }),
  ];
}

let kots: Kot[];

function hub() {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () =>
      json(
        makeSession({ permissions: ['kds.view', 'kds.update_status', 'menu.toggle_availability'] }),
      ),
    'GET /menu': () =>
      json({
        ...makeSnapshot(),
        kitchenStations: [
          { id: STATION_MAIN, name: 'Main Kitchen', isActive: true, version: 1 },
          { id: TANDOOR, name: 'Tandoor', isActive: true, version: 1 },
        ],
      }),
    'GET /kitchen/kots': ({ url }) => {
      const station = url.searchParams.get('station');
      return json({ data: kots.filter((k) => station === null || k.kitchenStationId === station) });
    },
    'GET /kitchen/metrics': () =>
      json({
        businessDate: '2026-10-28',
        pending: 3,
        delayed: 1,
        avgCookSeconds: 660,
        completed: 12,
        perChef: [],
      }),
    [`POST /kitchen/kots/${KOT_1}/status`]: ({ body }) => {
      const { to } = body as { to: Kot['status'] };
      const kot = { ...kots[0]!, status: to, version: 2 };
      kots = kots.map((k) => (k.id === KOT_1 ? kot : k));
      return json(kot);
    },
    [`POST /kitchen/kots/${KOT_2}/items/${LINE_3}/ready`]: () => {
      const kot: Kot = {
        ...kots[1]!,
        status: 'READY',
        readyAt: at(13),
        version: 5,
        items: kots[1]!.items.map((i) => ({ ...i, status: 'READY' })),
      };
      kots = kots.map((k) => (k.id === KOT_2 ? kot : k));
      return json(kot);
    },
  });
}

const column = (name: RegExp) => screen.getByRole('region', { name });
const card = (kotNo: number) =>
  document.querySelector<HTMLElement>(`article[data-kot="${kotNo}"]`)!;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(T0 + 13 * 60_000);
  kots = board();
  useAuthStore.setState({ status: 'restoring', session: null });
  useDeviceStore.setState({ kind: 'KDS' });
  removeStorage(STORAGE_KEYS.kdsStation);
  vi.mocked(chime).mockClear();
  await i18n.changeLanguage('en-IN');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useDeviceStore.setState({ kind: 'POS' });
});

describe('kotUrgency', () => {
  const kot = { status: 'NEW' as const, firedAt: at(0), targetReadyAt: at(10) };
  it('is neutral up to 80% of the target, amber after, red past it', () => {
    expect(kotUrgency(kot, Date.parse(at(8)))).toBe('normal');
    expect(kotUrgency(kot, Date.parse(at(8)) + 1)).toBe('warn');
    expect(kotUrgency(kot, Date.parse(at(10)))).toBe('warn');
    expect(kotUrgency(kot, Date.parse(at(10)) + 1)).toBe('late');
  });
  it('turns red when the Hub flags the KOT delayed, and stops the clock once ready', () => {
    expect(kotUrgency(kot, Date.parse(at(1)), true)).toBe('late');
    expect(kotUrgency({ ...kot, status: 'READY' }, Date.parse(at(30)))).toBe('normal');
  });
});

describe('KDS board', () => {
  it('shows four columns with cards coloured by time, notes in capitals, cancelled lines struck', async () => {
    hub();
    renderApp('/kitchen');
    expect(await screen.findByRole('heading', { name: /New \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Accepted \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cooking \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Ready \(0\)/ })).toBeInTheDocument();

    expect(card(34)).toHaveAttribute('data-urgency', 'warn');
    expect(card(28)).toHaveAttribute('data-urgency', 'late');
    expect(card(35)).toHaveAttribute('data-urgency', 'normal');
    expect(within(column(/^New/)).getByText('KOT 34 · T2')).toBeInTheDocument();
    expect(within(column(/^Accepted/)).getByText('KOT 35 · Token 12')).toBeInTheDocument();
    expect(within(card(35)).getByText('Chef: Subrata Bose')).toBeInTheDocument();

    expect(within(card(34)).getByText('LESS SPICY')).toBeInTheDocument();
    expect(within(card(34)).getByLabelText('Note')).toBeInTheDocument();
    expect(within(card(34)).getByText('+ Raita')).toBeInTheDocument();
    expect(within(card(34)).getByText('Butter Naan')).toHaveClass('line-through');
    expect(within(card(34)).getByText('Cancelled: Guest changed mind')).toBeInTheDocument();

    const metrics = screen.getByLabelText('Kitchen today');
    expect(metrics).toHaveTextContent('Pending3');
    expect(metrics).toHaveTextContent('Avg cook11m');
    expect(metrics).toHaveTextContent('Delayed1');
    await expectNoAxeViolations();
  });

  it('turns a card red once its target passes (one shared tick)', async () => {
    hub();
    renderApp('/kitchen');
    await screen.findByRole('heading', { name: /New \(1\)/ });
    expect(card(34)).toHaveAttribute('data-urgency', 'warn');
    act(() => vi.advanceTimersByTime(2 * 60_000 + KDS_TICK_MS));
    await waitFor(() => expect(card(34)).toHaveAttribute('data-urgency', 'late'));
  });

  it('moves a KOT on with its column’s button and bumps single items ready', async () => {
    const fetchMock = hub();
    renderApp('/kitchen');
    await screen.findByRole('heading', { name: /New \(1\)/ });
    fireEvent.click(within(card(34)).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(within(column(/^Accepted/)).getByText('KOT 34 · T2')).toBeInTheDocument(),
    );
    const post = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith(`/kitchen/kots/${KOT_1}/status`),
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ to: 'ACCEPTED', version: 1 });

    fireEvent.click(within(card(28)).getByRole('button', { name: 'Mark 1 Dal Makhani ready' }));
    await waitFor(() =>
      expect(within(column(/^Ready/)).getByText('KOT 28 · T3')).toBeInTheDocument(),
    );
    expect(within(card(28)).getByRole('button', { name: 'Served' })).toBeInTheDocument();
  });

  it('adds KOTs from the live feed with a chime, for the chosen station only (remembered)', async () => {
    const fetchMock = hub();
    renderApp('/kitchen');
    await screen.findByRole('heading', { name: /New \(1\)/ });
    const ws = FakeSocket.last;
    act(() => {
      ws.open();
      ws.receive({ type: 'hello', seq: 1, topics: ['kitchen'] });
      ws.receive(
        envelope('kitchen.kot.fired', {
          kot: makeKot({
            id: '0c000000-0000-4000-8000-000000000009',
            kotNo: 36,
            firedAt: at(13),
            targetReadyAt: at(28),
          }),
        }),
      );
    });
    expect(await screen.findByRole('heading', { name: /New \(2\)/ })).toBeInTheDocument();
    expect(card(36).className).toContain('kds-enter');
    expect(chime).toHaveBeenCalledWith('newKot');

    fireEvent.change(screen.getByRole('combobox', { name: 'Station' }), {
      target: { value: TANDOOR },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes(`/kitchen/kots?station=${TANDOOR}`)),
      ).toBe(true),
    );
    expect(window.localStorage.getItem(STORAGE_KEYS.kdsStation)).toBe(TANDOOR);
    vi.mocked(chime).mockClear();
    act(() =>
      ws.receive(
        envelope('kitchen.kot.fired', {
          kot: makeKot({ id: '0c000000-0000-4000-8000-00000000000a', kotNo: 37 }),
        }),
      ),
    );
    expect(chime).not.toHaveBeenCalled();
    expect(screen.queryByText('KOT 37 · T2')).toBeNull();
  });
});
