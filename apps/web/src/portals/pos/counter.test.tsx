import type { BillRequest, Invoice, Order } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  branchSettings,
  INVOICE_ID,
  LIQ_INVOICE_ID,
  liquorDraft,
  makeDraft,
  makeInvoice,
  makeShift,
  SERVICE_RULE,
  serviceChargeRule,
} from '../../test/billing-fixtures';
import { makeFloor, makeTable } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { biryaniLine, makeLine, makeOrder, ORDER_ID, summaryOf } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const MANAGER = '55555555-5555-4555-8555-555555555555';
const CASHIER = [
  'billing.create',
  'billing.collect_payment',
  'billing.discount',
  'cash.shift_manage',
];

let order: Order;
let shiftOpen: boolean;

function hub(routes: Record<string, Handler> = {}, permissions = CASHIER) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /auth/pin-users': () =>
      json({ data: [{ id: MANAGER, fullName: 'Meena Jha', initials: 'MJ' }] }),
    'POST /auth/approve': ({ body }) =>
      (body as { pin: string }).pin === '2580'
        ? json({
            approverToken: 'appr-1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            approver: { id: MANAGER, fullName: 'Meena Jha' },
          })
        : problem(401, 'INVALID_CREDENTIALS'),
    'GET /floor': () => json(makeFloor([makeTable({ status: 'OCCUPIED' })])),
    'GET /orders': ({ url }) =>
      json({ data: order.status === url.searchParams.get('status') ? [summaryOf(order)] : [] }),
    [`GET /orders/${ORDER_ID}`]: () => json(order),
    'GET /settings/branch': () => json(branchSettings),
    'GET /charge-rules': () => json({ data: [serviceChargeRule] }),
    'GET /cash-shifts/current': () => (shiftOpen ? json(makeShift()) : problem(404, 'NOT_FOUND')),
    ...routes,
  });
}

const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as unknown;
const headerOf = (call: unknown[], name: string) =>
  new Headers((call[1] as RequestInit).headers).get(name);
const press = (key: string) => fireEvent.keyDown(window, { key });

async function pin(dialog: HTMLElement, digits: string) {
  fireEvent.click(await within(dialog).findByRole('button', { name: /Meena Jha/ }));
  for (const d of digits) fireEvent.click(within(dialog).getByRole('button', { name: d }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
}

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  order = makeOrder({
    items: [
      biryaniLine({ quantity: 2, status: 'SENT' }),
      makeLine({ quantity: 4, status: 'SENT' }),
    ],
  });
  shiftOpen = true;
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('POS counter: bill', () => {
  it('previews the bill live, with a discount above the limit approved by a manager', async () => {
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/bill-preview`]: ({ body }) => {
        const req = body as BillRequest;
        return json({
          invoices: [
            req.discount === undefined
              ? makeDraft()
              : makeDraft({
                  discounts: [
                    {
                      kind: 'PERCENT',
                      value: 1500,
                      amount: 13200,
                      couponCode: null,
                      reason: 'Regular guest',
                    },
                  ],
                  discountTotal: 13200,
                  grandTotal: 82400,
                }),
          ],
        });
      },
      [`POST /orders/${ORDER_ID}/invoice`]: ({ headers }) => {
        if (headers.get('x-approver-token') !== 'appr-1') {
          return problem(403, 'APPROVAL_REQUIRED', { permission: 'billing.discount_override' });
        }
        order = makeOrder({ ...order, status: 'BILLED', version: 2 });
        return json({ invoices: [makeInvoice({ grandTotal: 82400 })] }, 201);
      },
      [`GET /orders/${ORDER_ID}/invoices`]: () =>
        json({ data: [makeInvoice({ grandTotal: 82400 })] }),
    });
    renderApp(`/pos?order=${ORDER_ID}`);

    const bill = await screen.findByRole('region', { name: 'T1 · Order #142' });
    expect(await within(bill).findByText('₹970.00')).toBeInTheDocument();
    expect(within(bill).getByText('CGST 2.5%')).toBeInTheDocument();
    expect(within(bill).getByText('Chicken Biryani (Full)')).toBeInTheDocument();

    // F4: discount, 15% with a reason; the dialog warns that a manager must approve it.
    press('F4');
    const dialog = await screen.findByRole('dialog', { name: 'Discount on this bill' });
    fireEvent.change(within(dialog).getByLabelText('Discount (%)'), { target: { value: '15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Regular guest' }));
    expect(
      await within(dialog).findByText(/above the 10% limit: a manager will approve it/),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply discount' }));

    expect(await within(bill).findByText('₹824.00')).toBeInTheDocument();
    expect(within(bill).getByText('Discount 15%')).toBeInTheDocument();
    const previews = callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/bill-preview`);
    expect(bodyOf(previews.at(-1)!)).toEqual({
      discount: { kind: 'PERCENT', value: 1500, reason: 'Regular guest' },
      removeChargeRuleIds: [],
    });

    // Generate: the Hub asks for approval; the manager's PIN retries with the token and the same key.
    fireEvent.click(screen.getByRole('button', { name: /Generate bill/ }));
    await pin(await screen.findByRole('dialog', { name: 'Manager approval needed' }), '2580');
    expect(await screen.findByRole('heading', { name: 'Payment' })).toBeInTheDocument();
    const bills = callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/invoice`);
    expect(bills).toHaveLength(2);
    expect(headerOf(bills[1]!, 'x-approver-token')).toBe('appr-1');
    expect(headerOf(bills[1]!, 'idempotency-key')).toBe(headerOf(bills[0]!, 'idempotency-key'));
    expect(within(bill).getByText('KOL1/2026-27/000123')).toBeInTheDocument();
  });

  it('shows food and liquor as two bills, and lets the guest drop the optional service charge', async () => {
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/bill-preview`]: ({ body }) =>
        json({
          invoices: [
            (body as BillRequest).removeChargeRuleIds?.includes(SERVICE_RULE)
              ? makeDraft({ charges: [], chargesTotal: 0, grandTotal: 92400 })
              : makeDraft(),
            liquorDraft(),
          ],
        }),
    });
    renderApp(`/pos?order=${ORDER_ID}`);
    const bill = await screen.findByRole('region', { name: 'T1 · Order #142' });
    expect(await within(bill).findByText('Billed as 2 invoices')).toBeInTheDocument();
    const food = within(bill).getByRole('article', { name: 'Food and drinks (GST)' });
    const liquor = within(bill).getByRole('article', { name: 'Liquor (VAT)' });
    expect(within(liquor).getByText('VAT 20%')).toBeInTheDocument();
    expect(within(liquor).getByText('₹840.00')).toBeInTheDocument();
    expect(within(bill).getByText('Total of all bills').nextSibling).toHaveTextContent('₹1,810.00');

    fireEvent.click(within(food).getByRole('button', { name: 'Remove Service charge' }));
    expect(await within(bill).findByText('Service charge removed')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(bill).getByText('Total of all bills').nextSibling).toHaveTextContent(
        '₹1,764.00',
      ),
    );
    expect(bodyOf(callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/bill-preview`).at(-1)!)).toEqual({
      removeChargeRuleIds: [SERVICE_RULE],
    });
    await expectNoAxeViolations();
  });
});

describe('POS counter: payment', () => {
  function billed(invoices: Invoice[]) {
    order = makeOrder({ ...order, status: 'BILLED' });
    return invoices;
  }

  it('takes a split payment (card + cash) and shows the change, then Paid', async () => {
    let invoice = makeInvoice({ grandTotal: 2_07_800 });
    billed([invoice]);
    const fetchMock = hub({
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [invoice] }),
      [`POST /invoices/${INVOICE_ID}/payments`]: () => {
        invoice = makeInvoice({
          grandTotal: 2_07_800,
          paidTotal: 2_07_800,
          status: 'PAID',
          version: 2,
        });
        return json(invoice);
      },
    });
    renderApp(`/pos?order=${ORDER_ID}`);
    const pad = await screen.findByRole('region', { name: 'Payment' });

    press('F6');
    const card = await waitFor(() => pad.querySelector<HTMLElement>('li[data-method="CARD"]')!);
    fireEvent.change(within(card).getByLabelText('Amount (₹)'), { target: { value: '1000' } });
    fireEvent.change(within(card).getByLabelText('Terminal'), { target: { value: 'HDFC-1' } });
    fireEvent.change(within(card).getByLabelText(/Approval code/), { target: { value: '4F7K21' } });
    fireEvent.change(within(card).getByLabelText('Card last 4 digits'), {
      target: { value: '4821' },
    });

    // Cash defaults to what is left; ₹2,000 handed over → ₹922 change.
    press('F8');
    const cash = await waitFor(() => pad.querySelector<HTMLElement>('li[data-method="CASH"]')!);
    expect(within(cash).getByLabelText('Amount (₹)')).toHaveValue('1078.00');
    fireEvent.click(within(cash).getByRole('button', { name: '₹2,000.00' }));
    expect(within(pad).getByText('Give back ₹922.00')).toBeInTheDocument();
    expect(within(pad).getByText('Remaining').nextSibling).toHaveTextContent('₹0.00');
    await expectNoAxeViolations();

    press('F9');
    expect(await screen.findByText('Paid', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Give back ₹922.00')).toBeInTheDocument();
    const [post] = callsTo(fetchMock, 'POST', `/invoices/${INVOICE_ID}/payments`);
    expect(bodyOf(post!)).toEqual({
      payments: [
        {
          method: 'CARD',
          amount: 1_00_000,
          reference: '4F7K21',
          cardLast4: '4821',
          terminalLabel: 'HDFC-1',
        },
        { method: 'CASH', amount: 1_07_800, tendered: 2_00_000 },
      ],
    });
    expect(headerOf(post!, 'idempotency-key')).not.toBeNull();
    // The terminal is remembered on this counter.
    expect(localStorage.getItem('restroos.pos-terminal')).toBe('{"CARD":"HDFC-1"}');
  });

  it('pays INV + LIQ together, filling each bill in turn', async () => {
    const inv = makeInvoice({ grandTotal: 27_500 });
    const liq = makeInvoice({
      ...liquorDraft(),
      id: LIQ_INVOICE_ID,
      invoiceNo: 'KOL1/LIQ/2026-27/000087',
      series: 'LIQ',
      lines: [{ ...liquorDraft().lines[0]!, id: '0e000000-0000-4000-8000-000000000009' }],
      grandTotal: 84_000,
    });
    billed([inv, liq]);
    const fetchMock = hub({
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [inv, liq] }),
      [`POST /invoices/${INVOICE_ID}/payments`]: () =>
        json({ ...inv, paidTotal: 27_500, balance: 0, status: 'PAID', version: 2 }),
      [`POST /invoices/${LIQ_INVOICE_ID}/payments`]: () =>
        json({ ...liq, paidTotal: 84_000, balance: 0, status: 'PAID', version: 2 }),
    });
    renderApp(`/pos?order=${ORDER_ID}`);
    const pad = await screen.findByRole('region', { name: 'Payment' });
    expect(within(pad).getByRole('radio', { name: 'Together ₹1,115.00' })).toBeChecked();
    press('F8');
    await within(pad).findByLabelText('Amount (₹)');
    press('F9');
    await screen.findByText('Paid', { selector: 'p' });
    expect(bodyOf(callsTo(fetchMock, 'POST', `/invoices/${INVOICE_ID}/payments`)[0]!)).toEqual({
      payments: [{ method: 'CASH', amount: 27_500 }],
    });
    expect(bodyOf(callsTo(fetchMock, 'POST', `/invoices/${LIQ_INVOICE_ID}/payments`)[0]!)).toEqual({
      payments: [{ method: 'CASH', amount: 84_000 }],
    });
  });

  it('asks to open a cash shift when cash is taken without one, then records the payment', async () => {
    shiftOpen = false;
    const invoice = makeInvoice();
    billed([invoice]);
    let opened = false;
    const fetchMock = hub({
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [invoice] }),
      'POST /cash-shifts': ({ body }) => {
        opened = true;
        shiftOpen = true;
        return json(
          makeShift({ openingFloat: (body as { openingFloat: number }).openingFloat }),
          201,
        );
      },
      [`POST /invoices/${INVOICE_ID}/payments`]: () =>
        opened
          ? json({
              ...invoice,
              paidTotal: invoice.grandTotal,
              balance: 0,
              status: 'PAID',
              version: 2,
            })
          : problem(409, 'SHIFT_NOT_OPEN'),
    });
    renderApp(`/pos?order=${ORDER_ID}`);
    expect(await screen.findByText('No cash shift')).toBeInTheDocument();
    const pad = await screen.findByRole('region', { name: 'Payment' });

    // Picking cash prompts at once; the cashier closes it and records anyway.
    press('F8');
    const first = await screen.findByRole('dialog', { name: 'Open a cash shift' });
    fireEvent.click(within(first).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(pad).getByRole('button', { name: /Record payment/ }));

    // The Hub refuses (SHIFT_NOT_OPEN): the prompt comes back, a float opens the shift, and the payment goes through.
    const prompt = await screen.findByRole('dialog', { name: 'Open a cash shift' });
    fireEvent.change(within(prompt).getByLabelText('Opening float (₹)'), {
      target: { value: '2000' },
    });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByText('Paid', { selector: 'p' })).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', '/cash-shifts')[0]!)).toEqual({
      openingFloat: 2_00_000,
    });
    expect(callsTo(fetchMock, 'POST', `/invoices/${INVOICE_ID}/payments`)).toHaveLength(2);
    expect(await screen.findByText(/Shift open · Ravi Kumar/)).toBeInTheDocument();
  });
});

describe('POS counter: keyboard', () => {
  it('F2 finds an order, Enter picks it, F9 bills it, Esc goes back', async () => {
    const fetchMock = hub({
      [`POST /orders/${ORDER_ID}/bill-preview`]: () => json({ invoices: [makeDraft()] }),
      [`POST /orders/${ORDER_ID}/invoice`]: () => {
        order = makeOrder({ ...order, status: 'BILLED', version: 2 });
        return json({ invoices: [makeInvoice()] }, 201);
      },
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [makeInvoice()] }),
    });
    const { router } = renderApp('/pos');
    await screen.findByRole('button', { name: /^T1/ });
    expect(screen.getByRole('region', { name: 'Keyboard shortcuts' })).toHaveTextContent(
      /F2Find order.*F4Discount.*F9Bill \/ record payment/,
    );

    press('F2');
    const search = screen.getByRole('searchbox', { name: 'Find an order' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 't1' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await screen.findByRole('region', { name: 'T1 · Order #142' });
    expect(router.state.location.search).toBe(`?order=${ORDER_ID}`);
    await screen.findByText('₹970.00');

    press('F9');
    await screen.findByRole('heading', { name: 'Payment' });
    expect(callsTo(fetchMock, 'POST', `/orders/${ORDER_ID}/invoice`)).toHaveLength(1);

    // F8 adds a cash line; Esc first clears the pad, then leaves the order.
    press('F8');
    await screen.findByLabelText('Amount (₹)');
    press('Escape');
    await waitFor(() => expect(screen.queryByLabelText('Amount (₹)')).toBeNull());
    press('Escape');
    await screen.findByText('Choose an order on the left to see its bill.');
    expect(router.state.location.search).toBe('');
  });

  it('keeps F-keys away from the counter while a dialog is open', async () => {
    hub({ [`POST /orders/${ORDER_ID}/bill-preview`]: () => json({ invoices: [makeDraft()] }) });
    renderApp(`/pos?order=${ORDER_ID}`);
    await screen.findByText('₹970.00');
    press('F4');
    await screen.findByRole('dialog', { name: 'Discount on this bill' });
    await act(async () => press('F9'));
    expect(screen.queryByRole('dialog', { name: 'Manager approval needed' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
