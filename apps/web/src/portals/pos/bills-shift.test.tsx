import type { Invoice } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import {
  CN_ID,
  INV_LINE_1,
  INV_LINE_2,
  INVOICE_ID,
  makeInvoice,
  makePayment,
  makeShift,
  SHIFT_ID,
  summaryOfInvoice,
} from '../../test/billing-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { ORDER_ID } from '../../test/order-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const MANAGER = '55555555-5555-4555-8555-555555555555';
const PERMISSIONS = ['billing.create', 'billing.collect_payment', 'cash.shift_manage'];

function hub(routes: Record<string, Handler>) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions: PERMISSIONS })),
    'GET /auth/pin-users': () =>
      json({ data: [{ id: MANAGER, fullName: 'Meena Jha', initials: 'MJ' }] }),
    'POST /auth/approve': () =>
      json({
        approverToken: 'appr-9',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        approver: { id: MANAGER, fullName: 'Meena Jha' },
      }),
    'GET /cash-shifts/current': () => json(makeShift()),
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

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Bills', () => {
  it('lists the day’s bills, filters by status and number, and opens one', async () => {
    const paid = makeInvoice({ paidTotal: 97000, status: 'PAID' });
    const other = makeInvoice({
      id: '0d000000-0000-4000-8000-000000000009',
      invoiceNo: 'KOL1/2026-27/000124',
      status: 'UNPAID',
    });
    const fetchMock = hub({
      'GET /invoices': ({ url }) => {
        const status = url.searchParams.get('status');
        const all = [paid, other].filter((i) => status === null || i.status === status);
        return json({ data: all.map(summaryOfInvoice) });
      },
      [`GET /invoices/${INVOICE_ID}`]: () => json(paid),
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [paid] }),
    });
    renderApp('/pos/bills?date=2026-10-28');
    const table = await screen.findByRole('table', { name: '2 bills' });
    expect(within(table).getByText('Unpaid')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bill number'), { target: { value: '124' } });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'KOL1/2026-27/000123' })).toBeNull(),
    );
    fireEvent.change(screen.getByLabelText('Bill number'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAID' } });
    await screen.findByRole('table', { name: '1 bill' });
    expect(
      new URL(String(callsTo(fetchMock, 'GET', '/invoices').at(-1)![0]), 'http://x').search,
    ).toBe('?date=2026-10-28&status=PAID');
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole('link', { name: 'KOL1/2026-27/000123' }));
    expect(
      await screen.findByRole('heading', { name: /KOL1\/2026-27\/000123/ }),
    ).toBeInTheDocument();
  });

  it('refunds chosen lines by quantity, with a manager’s approval, and lists the credit note', async () => {
    let invoice: Invoice = makeInvoice({
      paidTotal: 97000,
      status: 'PAID',
      payments: [makePayment({ method: 'UPI', reference: 'RRN77' })],
    });
    const creditNote = makeInvoice({
      id: CN_ID,
      invoiceNo: 'KOL1/CN/2026-27/000001',
      kind: 'CREDIT_NOTE',
      series: 'CN',
      originalInvoiceId: INVOICE_ID,
      lines: [{ ...invoice.lines[1]!, id: '0e000000-0000-4000-8000-000000000007', quantity: 2 }],
      grandTotal: 12600,
      status: 'PAID',
    });
    let refunded = false;
    const fetchMock = hub({
      'GET /invoices': () =>
        json({
          data: [summaryOfInvoice(invoice), ...(refunded ? [summaryOfInvoice(creditNote)] : [])],
        }),
      [`GET /invoices/${INVOICE_ID}`]: () => json(invoice),
      [`GET /invoices/${CN_ID}`]: () => json(creditNote),
      [`GET /invoices/${INVOICE_ID}/credit-notes`]: () =>
        json({ data: refunded ? [creditNote] : [] }),
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [invoice] }),
      [`POST /invoices/${INVOICE_ID}/refunds`]: ({ headers }) => {
        if (headers.get('x-approver-token') !== 'appr-9') {
          return problem(403, 'APPROVAL_REQUIRED', { permission: 'billing.refund' });
        }
        refunded = true;
        invoice = { ...invoice, status: 'PARTIALLY_REFUNDED', version: 2 };
        return json({ creditNote, invoice });
      },
    });
    renderApp(`/pos/bills/${INVOICE_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Refund' }));
    const dialog = await screen.findByRole('dialog', { name: 'Refund on KOL1/2026-27/000123' });
    // The refund goes back the way it was paid by default.
    expect(within(dialog).getByRole('radio', { name: 'UPI' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'One more Butter Naan' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'One more Butter Naan' }));
    // 2 of 4 naans: half of ₹252.00.
    expect(within(dialog).getByText(/About ₹126.00 with tax/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Burnt naan' } });
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refund about ₹126.00' }));

    const approval = await screen.findByRole('dialog', { name: 'Manager approval needed' });
    fireEvent.click(await within(approval).findByRole('button', { name: /Meena Jha/ }));
    for (const d of '1234') fireEvent.click(within(approval).getByRole('button', { name: d }));
    fireEvent.click(within(approval).getByRole('button', { name: 'Approve' }));

    expect(
      await screen.findByText('Refund done. Credit note KOL1/CN/2026-27/000001 issued.'),
    ).toBeInTheDocument();
    const calls = callsTo(fetchMock, 'POST', `/invoices/${INVOICE_ID}/refunds`);
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]!)).toEqual({
      method: 'UPI',
      reason: 'Burnt naan',
      lines: [{ invoiceLineId: INV_LINE_2, quantity: 2 }],
    });
    expect(await screen.findByRole('link', { name: 'KOL1/CN/2026-27/000001' })).toBeInTheDocument();
    expect(screen.getByText('Part refunded')).toBeInTheDocument();
    // Credit notes come from the invoice's own list, not a scan of the day's bills.
    expect(
      callsTo(fetchMock, 'GET', `/invoices/${INVOICE_ID}/credit-notes`).length,
    ).toBeGreaterThan(0);
    expect(callsTo(fetchMock, 'GET', '/invoices')).toHaveLength(0);
    void INV_LINE_1;
  });

  it('prints the bill; when the printer is offline it previews the slip for browser printing', async () => {
    let invoice = makeInvoice({ status: 'PAID', paidTotal: 97000 });
    let offline = false;
    const fetchMock = hub({
      'GET /invoices': () => json({ data: [] }),
      [`GET /invoices/${INVOICE_ID}`]: () => json(invoice),
      [`GET /orders/${ORDER_ID}/invoices`]: () => json({ data: [invoice] }),
      [`POST /invoices/${INVOICE_ID}/print`]: ({ headers }) => {
        if (offline) return problem(503, 'PRINTER_OFFLINE');
        if (invoice.printCount > 0 && headers.get('x-approver-token') !== 'appr-9') {
          return problem(403, 'APPROVAL_REQUIRED', { permission: 'billing.reprint' });
        }
        invoice = { ...invoice, printCount: invoice.printCount + 1, version: invoice.version + 1 };
        return json({
          printerId: MANAGER,
          printerName: 'Counter printer',
          mode: 'TEXT',
          bytes: 812,
        });
      },
      [`GET /invoices/${INVOICE_ID}/receipt`]: () =>
        json({
          cut: true,
          blocks: [
            { kind: 'text', text: 'Spice Route', align: 'center', bold: true, size: 2 },
            { kind: 'rule', char: '-' },
            { kind: 'row', left: 'Butter Naan x4', right: '240.00' },
            { kind: 'row', left: 'TOTAL', right: '970.00', bold: true },
            { kind: 'feed', lines: 2 },
          ],
        }),
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderApp(`/pos/bills/${INVOICE_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(await screen.findByText('Sent to Counter printer.')).toBeInTheDocument();
    // The second print is a duplicate: a manager approves it here (the cashier lacks billing.reprint).
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint' }));
    const approval = await screen.findByRole('dialog', { name: 'Manager approval needed' });
    fireEvent.click(await within(approval).findByRole('button', { name: /Meena Jha/ }));
    for (const d of '1234') fireEvent.click(within(approval).getByRole('button', { name: d }));
    fireEvent.click(within(approval).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', `/invoices/${INVOICE_ID}/print`)).toHaveLength(3),
    );

    offline = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Reprint' }));
    const preview = await screen.findByRole('dialog', { name: 'Bill KOL1/2026-27/000123' });
    expect(within(preview).getByRole('alert')).toHaveTextContent('The printer did not answer.');
    expect(await within(preview).findAllByText('Butter Naan x4')).not.toHaveLength(0);
    await expectNoAxeViolations();
    fireEvent.click(within(preview).getByRole('button', { name: 'Print from this screen' }));
    expect(print).toHaveBeenCalled();
    print.mockRestore();
  });
});

describe('Cash shift', () => {
  it('counts the drawer by notes, reports the terminal batch, shows variance and the Z report', async () => {
    let closed: ReturnType<typeof makeShift> | null = null;
    const fetchMock = hub({
      'GET /cash-shifts/current': () =>
        closed === null ? json(makeShift()) : problem(404, 'NOT_FOUND'),
      [`GET /cash-shifts/${SHIFT_ID}`]: () => json(closed ?? makeShift()),
      [`POST /cash-shifts/${SHIFT_ID}/close`]: ({ body }) => {
        const b = body as { countedCash: number; tenders: { reportedAmount: number }[] };
        closed = makeShift({
          status: 'CLOSED',
          closedAt: '2026-10-28T22:00:00.000Z',
          closedByName: 'Ravi Kumar',
          countedCash: b.countedCash,
          cashVariance: b.countedCash - 5_00_000,
          tenders: [
            {
              method: 'CASH',
              terminalLabel: '',
              expected: 5_00_000,
              reported: b.countedCash,
              variance: b.countedCash - 5_00_000,
            },
            {
              method: 'CARD',
              terminalLabel: 'HDFC-1',
              expected: 1_20_000,
              reported: b.tenders[0]!.reportedAmount,
              variance: 0,
            },
          ],
          version: 4,
        });
        return json(closed);
      },
    });
    renderApp('/pos/shift');
    expect(
      await screen.findByRole('heading', { name: 'Shift so far (X report)' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close shift' }));

    // ₹4,980 counted: 9 × ₹500 + 4 × ₹100 + ₹80 in coins (₹20 short).
    fireEvent.change(await screen.findByLabelText('Number of ₹500 notes'), {
      target: { value: '9' },
    });
    fireEvent.change(screen.getByLabelText('Number of ₹100 notes'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Coins and small notes/), { target: { value: '80' } });
    expect(screen.getByTestId('counted-total')).toHaveTextContent('₹4,980.00');
    // The card terminal used in the shift is listed for its batch total.
    fireEvent.change(screen.getByLabelText('Card · HDFC-1: batch total (₹)'), {
      target: { value: '1200' },
    });
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Check the differences' }));

    const confirm = await screen.findByRole('region', { name: 'Confirm the count' });
    expect(
      within(confirm).getByText('1 method does not match. Check it before closing.'),
    ).toBeInTheDocument();
    const short = within(confirm).getByText('Short ₹20.00');
    expect(short).toHaveAttribute('data-variance', 'short');
    expect(short.className).toMatch(/state-danger/);
    expect(within(confirm).getByText('Matches').className).toMatch(/state-available/);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Close shift' }));

    expect(
      await screen.findByRole('heading', { name: 'Shift closed (Z report)' }),
    ).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', `/cash-shifts/${SHIFT_ID}/close`)[0]!)).toEqual({
      version: 3,
      countedCash: 4_98_000,
      denominations: { '500': 9, '100': 4, '1': 80 },
      tenders: [{ method: 'CARD', terminalLabel: 'HDFC-1', reportedAmount: 1_20_000 }],
    });
    expect(screen.getAllByText('Short ₹20.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Print from this screen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Print on printer' })).toBeEnabled();
  });
});
