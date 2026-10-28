import type { Reservation } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import {
  makeFloor,
  makeSnapshot,
  makeTable,
  TABLE_T1,
  TABLE_T2,
} from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { makeOrder } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const PERMS = ['tables.view', 'orders.create', 'reservations.manage'];
const BOOKING = 'b0000000-0000-4000-8000-000000000001';
const NEW_ORDER = '0a000000-0000-4000-8000-000000000009';

/** Today at hh:mm on the test machine's clock. */
function todayAt(hours: number, minutes = 0): string {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function booking(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: BOOKING,
    tableId: TABLE_T1,
    tableLabel: 'T1',
    customerId: null,
    guestName: 'Ananya Das',
    guestPhone: '+919830055555',
    partySize: 4,
    reservedFor: todayAt(23, 30),
    status: 'BOOKED',
    notes: 'Birthday',
    createdAt: todayAt(0),
    version: 1,
    ...overrides,
  };
}

const floor = () =>
  makeFloor([
    makeTable({
      nextReservation: {
        id: BOOKING,
        guestName: 'Ananya Das',
        partySize: 4,
        reservedFor: todayAt(23, 30),
      },
    }),
    makeTable({ id: TABLE_T2, label: 'T2', posX: 10, seats: 6 }),
  ]);

describe('Reservations', () => {
  it('shows the booking on its table tile and today’s count on the floor', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(floor()),
      'GET /orders': () => json({ data: [] }),
      'GET /reservations': () => json({ data: [booking()] }),
    });
    renderApp('/captain');
    const tile = await screen.findByRole('button', {
      name: 'Table T1, 4 seats, Free, booked at 11:30 pm for Ananya Das',
    });
    expect(tile).toHaveTextContent('11:30 pm · Ananya Das (4)');
    expect(
      await screen.findByRole('link', { name: 'Reservations: 1 booking left today' }),
    ).toHaveAttribute('href', '/captain/reservations');
  });

  it('books a table ahead and says when another booking holds it', async () => {
    let attempts = 0;
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(floor()),
      'GET /reservations': () => json({ data: [] }),
      'POST /reservations': ({ body }) =>
        ++attempts === 1
          ? problem(409, 'TABLE_ALREADY_RESERVED')
          : json(booking({ ...(body as object), id: BOOKING, tableLabel: 'T2' }), 201),
    });
    renderApp('/captain/reservations');
    expect(await screen.findByText('No bookings in the next 30 days.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New reservation' }));
    const dialog = await screen.findByRole('dialog', { name: 'New reservation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save booking' }));
    expect(await within(dialog).findByText('Enter the guest’s name.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Guest name/), {
      target: { value: 'Rohit Sen' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Mobile number/), {
      target: { value: '98300 11111' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2031-01-15' } });
    fireEvent.change(within(dialog).getByLabelText(/Time/), { target: { value: '20:30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'One guest more' }));
    fireEvent.change(within(dialog).getByLabelText(/^Table/), { target: { value: TABLE_T2 } });
    fireEvent.change(within(dialog).getByLabelText(/Notes/), { target: { value: 'Window' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save booking' }));
    expect(
      await within(dialog).findByText(
        'Another booking holds this table within 2 hours of that time. Pick another table or time.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save booking' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = fetchMock.mock.calls.filter(
      ([u, init]) => String(u).endsWith('/reservations') && init?.method === 'POST',
    )[1]!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      guestName: 'Rohit Sen',
      guestPhone: '98300 11111',
      partySize: 3,
      reservedFor: new Date('2031-01-15T20:30').toISOString(),
      tableId: TABLE_T2,
      notes: 'Window',
    });
  });

  it('seats the guests at their table and opens their order', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: PERMS })),
      'GET /floor': () => json(floor()),
      'GET /reservations': () => json({ data: [booking()] }),
      [`POST /reservations/${BOOKING}/seat`]: () => json(booking({ status: 'SEATED', version: 2 })),
      'GET /menu': () => json(makeSnapshot()),
      'POST /orders': () => json(makeOrder({ id: NEW_ORDER, orderNo: '150' }), 201),
      [`GET /orders/${NEW_ORDER}`]: () => json(makeOrder({ id: NEW_ORDER, orderNo: '150' })),
    });
    const { router } = renderApp('/captain/reservations');
    expect(await screen.findByRole('heading', { name: /Today/ })).toHaveTextContent(
      '4 guests expected',
    );
    expect(screen.getByText('Ananya Das')).toBeInTheDocument();
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Seat Ananya Das' });
    expect(within(dialog).getByLabelText(/^Table/)).toHaveValue(TABLE_T1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seat and take order' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/captain/orders/${NEW_ORDER}`),
    );
    const seat = fetchMock.mock.calls.find(([u]) => String(u).endsWith(`/${BOOKING}/seat`))!;
    expect(JSON.parse(String(seat[1]?.body))).toEqual({ version: 1 });
    const open = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/orders') && init?.method === 'POST',
    )!;
    expect(JSON.parse(String(open[1]?.body))).toEqual({
      orderType: 'DINE_IN',
      tableId: TABLE_T1,
      covers: 4,
    });
  });

  it('lets a captain without reservations.manage see bookings but not change them', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['tables.view'] })),
      'GET /floor': () => json(floor()),
      'GET /reservations': () => json({ data: [booking()] }),
    });
    renderApp('/captain/reservations');
    expect(await screen.findByText('Ananya Das')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New reservation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seat' })).toBeNull();
  });
});
