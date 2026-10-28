import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { makeSnapshot } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { KOT_1, makeKot } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

vi.mock('../../lib/chime', () => ({
  chime: vi.fn(),
  unlockAudio: vi.fn(async () => false),
  audioReady: () => false,
}));

const PRINTER = '0f900000-0000-4000-8000-000000000001';
const outcome = { printerId: PRINTER, printerName: 'Tandoor KOT', mode: 'RASTER', bytes: 4096 };

function hub(routes: Record<string, Handler>, permissions: string[]) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /menu': () => json(makeSnapshot()),
    'GET /kitchen/kots': () => json({ data: [makeKot({ id: KOT_1, kotNo: 34 })] }),
    'GET /kitchen/metrics': () =>
      json({
        businessDate: '2026-10-28',
        pending: 1,
        delayed: 0,
        avgCookSeconds: null,
        completed: 0,
        perChef: [],
      }),
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('KOT reprint', () => {
  it('reprints a KOT from the kitchen board, and warns when the station has no printer', async () => {
    let printers = [outcome];
    const fetchMock = hub(
      { [`POST /kitchen/kots/${KOT_1}/reprint`]: () => json({ data: printers }) },
      ['kds.view'],
    );
    renderApp('/kitchen');
    const card = await screen.findByRole('article', { name: /KOT 34/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Reprint KOT 34' }));
    expect(await screen.findByText('Sent to Tandoor KOT.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', `/kitchen/kots/${KOT_1}/reprint`)).toHaveLength(1);
    printers = [];
    fireEvent.click(within(card).getByRole('button', { name: 'Reprint KOT 34' }));
    expect(
      await screen.findByText('No KOT printer is set up for this station.'),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('shows the printer problem when the reprint fails', async () => {
    hub({ [`POST /kitchen/kots/${KOT_1}/reprint`]: () => problem(503, 'PRINTER_OFFLINE') }, [
      'kds.view',
    ]);
    renderApp('/kitchen');
    const card = await screen.findByRole('article', { name: /KOT 34/ });
    fireEvent.click(within(card).getByRole('button', { name: 'Reprint KOT 34' }));
    expect(
      await screen.findByText(
        'The printer did not answer. Check it is on, has paper and is connected.',
      ),
    ).toBeInTheDocument();
  });
});

describe('Printer test page', () => {
  it('shows what the test print sent, or why it failed, on the printer’s card', async () => {
    let offline = false;
    const printer = {
      id: PRINTER,
      name: 'Counter',
      connection: 'NETWORK',
      address: '192.168.1.50:9100',
      paperWidthMm: 80,
      purpose: 'BILL',
      isActive: true,
      version: 1,
    };
    hub(
      {
        'GET /printers': () => json({ data: [printer] }),
        [`POST /printers/${PRINTER}/test`]: () =>
          offline
            ? problem(503, 'PRINTER_OFFLINE')
            : json({ ...outcome, printerName: 'Counter', mode: 'TEXT', bytes: 1234 }),
      },
      ['settings.manage'],
    );
    renderApp('/admin/printers');
    fireEvent.click(await screen.findByRole('button', { name: 'Test print on Counter' }));
    expect(
      await screen.findByText('Test page sent to Counter: 1,234 bytes, printer font.'),
    ).toBeInTheDocument();
    offline = true;
    fireEvent.click(screen.getByRole('button', { name: 'Test print on Counter' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The printer did not answer.'),
    );
    await expectNoAxeViolations();
  });
});
