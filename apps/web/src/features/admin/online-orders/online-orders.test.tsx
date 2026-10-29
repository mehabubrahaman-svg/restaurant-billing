import type { RelayOverview } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

const ORDER = '0d100000-0000-4000-8000-000000000001';
const FAILED = '0d200000-0000-4000-8000-000000000002';
const status = (state: RelayOverview['status']['state'], lastError: string | null = null) => ({
  state,
  since: '2026-10-28T12:00:00.000Z',
  lastConnectedAt: state === 'CONNECTED' ? '2026-10-28T12:00:00.000Z' : null,
  lastError,
});
const message = (over: Partial<RelayOverview['recent'][number]>) => ({
  id: '0d200000-0000-4000-8000-000000000001',
  direction: 'IN' as const,
  kind: 'order.created',
  status: 'DONE' as const,
  channelCode: 'SWIGGY',
  externalOrderId: 'SWG-77',
  orderId: ORDER,
  error: null,
  createdAt: '2026-10-28T12:05:00.000Z',
  handledAt: '2026-10-28T12:05:01.000Z',
  ...over,
});

const NOT_SET: RelayOverview = {
  link: null,
  status: status('OFF'),
  counts: { pendingOut: 0, failedIn: 0 },
  recent: [],
};
const LINKED: RelayOverview = {
  link: {
    relayUrl: 'wss://relay.test',
    hubId: 'hub-0001',
    keySet: true,
    isEnabled: true,
    version: 1,
  },
  status: status('CONNECTED'),
  counts: { pendingOut: 0, failedIn: 1 },
  recent: [
    message({}),
    message({
      id: FAILED,
      channelCode: 'ZOMATO',
      externalOrderId: 'ZMT-5',
      orderId: null,
      status: 'FAILED',
      error: 'no active aggregator channel ZOMATO on the Hub',
    }),
    message({
      id: '0d200000-0000-4000-8000-000000000003',
      direction: 'OUT',
      kind: 'order-status',
      status: 'SENT',
    }),
  ],
};

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const admin = () => json(makeSession({ permissions: ['settings.manage'] }));

describe('Online orders', () => {
  it('links the Hub to the relay, checking what is typed', async () => {
    const saved: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': admin,
      'GET /integrations/relay': () => json(NOT_SET),
      'PUT /integrations/relay': ({ body }) => {
        saved.push(body);
        return json({ ...LINKED, status: status('CONNECTING'), recent: [] });
      },
    });
    renderApp('/admin/online-orders');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Online orders' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send the menu now' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Relay address'), { target: { value: 'relay.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Starts with wss:// or https://.')).toBeInTheDocument();
    expect(screen.getByText('The key is at least 16 characters.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Relay address'), {
      target: { value: 'wss://relay.test' },
    });
    fireEvent.change(screen.getByLabelText('Hub ID'), { target: { value: 'hub-0001' } });
    fireEvent.change(screen.getByLabelText('Hub key'), {
      target: { value: 'k3y-from-the-relay-0001' },
    });
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved. Connecting to the relay…')).toBeInTheDocument();
    expect(saved).toEqual([
      {
        relayUrl: 'wss://relay.test',
        hubId: 'hub-0001',
        hubKey: 'k3y-from-the-relay-0001',
        isEnabled: true,
      },
    ]);
    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
  });

  it('shows the status and messages, sends the menu, and retries an order that failed', async () => {
    const calls: string[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': admin,
      'GET /integrations/relay': () => json(LINKED),
      'POST /integrations/relay/menu': () => {
        calls.push('menu');
        return json({ queued: true }, 202);
      },
      [`POST /integrations/relay/messages/${FAILED}/retry`]: () => {
        calls.push('retry');
        return json({ ok: true });
      },
    });
    renderApp('/admin/online-orders');
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(
      screen.getByText('nothing waiting to send · 1 order couldn’t be entered'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Hub key')).toHaveValue('');
    expect(screen.getByText('A key is saved. Leave this empty to keep it.')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Recent messages' });
    const failed = within(table).getByText('ZOMATO ZMT-5').closest('tr')!;
    expect(within(failed).getByText('Couldn’t enter')).toBeInTheDocument();
    expect(
      within(failed).getByText('no active aggregator channel ZOMATO on the Hub'),
    ).toBeInTheDocument();
    expect(within(table).getByText('Order status sent')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Send the menu now' }));
    expect(await screen.findByText('The menu will go to the platforms.')).toBeInTheDocument();
    fireEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('The order is entered.')).toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual(['menu', 'retry']));
  });

  it('is an Admin tab for settings.manage only', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['customers.manage'] })),
    });
    renderApp('/admin/online-orders');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });
});
