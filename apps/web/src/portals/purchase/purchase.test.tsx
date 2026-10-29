import type { Grn, PurchaseOrder, Vendor } from '@restroos/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import {
  delhiSpices,
  eggs,
  GRN_ID,
  makeDues,
  makeGrn,
  makeItem,
  makePayment,
  makePurchaseOrder,
  makeStatement,
  makeVendor,
  PO_ID,
  PO_LINE_RICE,
  RICE_ID,
  UNITS,
  VENDOR_ID,
} from '../../test/purchasing-fixtures';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { localIsoDate } from '../pos/bills-page';

/** A manager: everything in purchasing. */
const MANAGER = [
  'vendors.view',
  'vendors.manage',
  'po.create',
  'po.approve',
  'grn.post',
  'vendor_payments.create',
  'inventory.view',
];
/** The INVENTORY role's purchasing permissions: raise orders and receive goods, not approve. */
const STORE = ['vendors.view', 'po.create', 'grn.post', 'inventory.view'];

const fresh = makeVendor();
const rice = makeItem();

function hub(routes: Record<string, Handler> = {}, permissions = MANAGER) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /vendors': () => json({ data: [delhiSpices, fresh] }),
    [`GET /vendors/${VENDOR_ID}`]: () => json(fresh),
    'GET /units': () => json({ data: UNITS }),
    'GET /inventory-items': () => json({ data: [rice, eggs] }),
    'GET /vendor-payments': () => json({ data: [] }),
    ...routes,
  });
}
type FetchMock = ReturnType<typeof mockHub>;
const callsTo = (fetchMock: FetchMock, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );
const bodyOf = (call: FetchMock['mock']['calls'][number]) =>
  JSON.parse(String((call[1] as RequestInit).body)) as unknown;

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Vendors', () => {
  it('lists vendors with what is owed, and adds one once its code is free', async () => {
    let tries = 0;
    const fetchMock = hub({
      'POST /vendors': ({ body }) => {
        tries += 1;
        if (tries === 1) return problem(409, 'VENDOR_CODE_TAKEN');
        const saved: Vendor = makeVendor({
          ...(body as Partial<Vendor>),
          id: '0f100000-0000-4000-8000-000000000009',
          due: 0,
        });
        return json(saved, 201);
      },
    });
    renderApp('/purchase/vendors');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vendors' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: '2 vendors' });
    expect(within(table).getByRole('link', { name: 'Fresh Farms' })).toHaveAttribute(
      'href',
      `/purchase/vendors/${VENDOR_ID}`,
    );
    const row = within(table).getByRole('row', { name: /Fresh Farms/ });
    expect(within(row).getByText('₹862.50')).toBeInTheDocument();
    expect(within(row).getByText('15 days')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Delhi Spices/ })).toHaveTextContent('30 days');
    expect(screen.getByText('Owed to vendors').nextElementSibling).toHaveTextContent('₹862.50');
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Add vendor' }));
    const dialog = screen.getByRole('dialog', { name: 'Add vendor' });
    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: 'fresh' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Fresh Again' } });
    fireEvent.change(within(dialog).getByLabelText('GSTIN'), {
      target: { value: '07aaacd1234b1z2' },
    });
    // The GSTIN's state says how its GST will be claimed.
    expect(
      within(dialog).getByText(/Another state: their GST is claimed as IGST/),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Another vendor already uses this code. Choose a different one.',
    );
    expect(within(dialog).getByLabelText(/^Code/)).toHaveAccessibleDescription(
      /Another vendor already uses this code/,
    );

    fireEvent.change(within(dialog).getByLabelText(/^Code/), { target: { value: 'fresh2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved Fresh Again.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyOf(callsTo(fetchMock, 'POST', '/vendors')[1]!)).toEqual({
      code: 'FRESH2',
      name: 'Fresh Again',
      contactPerson: null,
      phone: null,
      email: null,
      address: null,
      taxId: '07AAACD1234B1Z2',
      paymentTermsDays: 0,
    });
  });

  it('shows a vendor’s unpaid bills and statement in its own words, and retires them', async () => {
    let vendor: Vendor = { ...fresh, due: 89_000 };
    const fetchMock = hub({
      [`GET /vendors/${VENDOR_ID}`]: () => json(vendor),
      [`PATCH /vendors/${VENDOR_ID}`]: ({ body }) => {
        vendor = { ...vendor, ...(body as Partial<Vendor>), version: vendor.version + 1 };
        return json(vendor);
      },
      [`GET /vendors/${VENDOR_ID}/statement`]: () => json(makeStatement()),
      'GET /grns': () => json({ data: [makeGrn({ paid: 100_000, balance: 89_000 })] }),
      'GET /vendor-payments': () => json({ data: [makePayment()] }),
    });
    renderApp(`/purchase/vendors/${VENDOR_ID}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Fresh Farms' }),
    ).toBeInTheDocument();
    const bills = await screen.findByRole('row', { name: /KOL1\/GRN\/2026-27\/000001 FF\/1123/ });
    expect(within(bills).getByText('₹890.00')).toBeInTheDocument();
    expect(
      within(bills).getByRole('button', { name: 'Pay KOL1/GRN/2026-27/000001' }),
    ).toBeInTheDocument();
    // Nothing was paid on account, so the bills alone add up to what is owed.
    expect(screen.queryByText(/Paid on account/)).toBeNull();

    // The Hub writes "BANK against …"; the statement reads it from the payment itself.
    const statement = await screen.findByRole('table', {
      name: /Statement from 1 Oct 2026 to/,
    });
    expect(
      within(statement).getByText('Bank transfer against KOL1/GRN/2026-27/000001'),
    ).toBeInTheDocument();
    expect(within(statement).getByText('Bill FF/1123')).toBeInTheDocument();
    expect(within(statement).getByRole('row', { name: /Closing balance/ })).toHaveTextContent(
      '₹890.00',
    );
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const confirm = screen.getByRole('dialog', { name: 'Retire Fresh Farms?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByText('Fresh Farms retired.')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'PATCH', `/vendors/${VENDOR_ID}`)[0]!)).toEqual({
      version: 1,
      isActive: false,
    });
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('adds money paid on account under the unpaid bills, so they add up to what is owed', async () => {
    hub({
      // ₹1,890 billed, ₹1,000 paid against the bill and ₹100 on account.
      [`GET /vendors/${VENDOR_ID}`]: () => json({ ...fresh, due: 79_000 }),
      [`GET /vendors/${VENDOR_ID}/statement`]: () => json(makeStatement()),
      'GET /grns': () => json({ data: [makeGrn({ paid: 100_000, balance: 89_000 })] }),
    });
    renderApp(`/purchase/vendors/${VENDOR_ID}`);
    const onAccount = await screen.findByRole('row', {
      name: /^Paid on account: it settles the oldest bills first/,
    });
    expect(onAccount).toHaveTextContent('-₹100.00');
    expect(screen.getByRole('row', { name: /^Owed/ })).toHaveTextContent('₹790.00');
  });
});

describe('Purchase orders', () => {
  it('raises an order with live totals; stock staff can’t approve it', async () => {
    const saved = makePurchaseOrder({
      status: 'DRAFT',
      version: 1,
      approvedAt: null,
      approvedByName: null,
      sentAt: null,
      subtotal: 22_500,
      taxTotal: 1_125,
      grandTotal: 23_625,
      lines: [
        {
          ...makePurchaseOrder().lines[0]!,
          quantityMilli: 2_500,
          value: 22_500,
          taxAmount: 1_125,
          total: 23_625,
          receivedQtyMilli: 0,
        },
      ],
    });
    const fetchMock = hub(
      {
        'POST /purchase-orders': () => json(saved, 201),
        [`GET /purchase-orders/${PO_ID}`]: () => json(saved),
      },
      STORE,
    );
    renderApp('/purchase/orders/new');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'New purchase order' }),
    ).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText(/^Vendor/), { target: { value: VENDOR_ID } });
    const line = screen.getByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(line).getByLabelText(/^Item/), { target: { value: RICE_ID } });
    expect(line).toHaveAccessibleName('Line 1: Basmati rice');
    // Rice is kept in grams and bought by the kg: only units that measure grams are offered.
    const unit = within(line).getByLabelText(/^Unit/);
    expect(unit).toHaveValue('unit-kg');
    expect(
      within(unit)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['kg', 'g']);
    fireEvent.change(within(line).getByLabelText(/^Quantity/), { target: { value: '2.5' } });
    fireEvent.change(within(line).getByLabelText(/^Price per kg/), { target: { value: '90' } });
    fireEvent.change(within(line).getByLabelText('GST'), { target: { value: '500' } });
    expect(within(line).getByText('₹225.00 + GST ₹11.25 = ₹236.25')).toBeInTheDocument();
    const totals = screen.getByText('Before GST').closest('dl')!;
    expect(within(totals).getByText('₹225.00')).toBeInTheDocument();
    expect(within(totals).getByText('₹11.25')).toBeInTheDocument();
    expect(within(totals).getByText('₹236.25')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /KOL1\/PO\/2026-27\/000001/ }),
    ).toHaveTextContent('Draft');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/purchase-orders')[0]!)).toEqual({
      vendorId: VENDOR_ID,
      expectedOn: null,
      notes: null,
      lines: [
        {
          inventoryItemId: RICE_ID,
          unitId: 'unit-kg',
          quantityMilli: 2_500,
          unitPrice: 9_000,
          taxRateBp: 500,
        },
      ],
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      screen.getByText('Waiting for approval by someone who may approve purchase orders.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/purchase/orders/${PO_ID}/edit`,
    );
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
  });

  it('refuses a line until it is complete, and a quantity with too many decimals', async () => {
    const fetchMock = hub({}, STORE);
    renderApp('/purchase/orders/new');
    fireEvent.change(await screen.findByLabelText(/^Vendor/), { target: { value: VENDOR_ID } });
    const line = screen.getByRole('listitem', { name: 'Line 1' });
    fireEvent.change(within(line).getByLabelText(/^Item/), { target: { value: RICE_ID } });
    fireEvent.change(within(line).getByLabelText(/^Quantity/), { target: { value: '2.5555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await within(line).findByText(/Enter a quantity above 0/)).toBeInTheDocument();
    expect(
      within(line).getByText('Enter the price per unit, e.g. 90 or 78.50.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/purchase-orders')).toHaveLength(0);
  });

  it('a manager approves a draft, which can then be sent and received', async () => {
    let po: PurchaseOrder = makePurchaseOrder({
      status: 'DRAFT',
      version: 1,
      approvedAt: null,
      approvedByName: null,
      sentAt: null,
    });
    const fetchMock = hub({
      [`GET /purchase-orders/${PO_ID}`]: () => json(po),
      [`POST /purchase-orders/${PO_ID}/approve`]: () => {
        po = { ...po, status: 'APPROVED', version: 2, approvedAt: '2026-10-28T06:00:00.000Z' };
        return json(po);
      },
    });
    renderApp(`/purchase/orders/${PO_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('KOL1/PO/2026-27/000001 approved.')).toBeInTheDocument();
    expect(bodyOf(callsTo(fetchMock, 'POST', `/purchase-orders/${PO_ID}/approve`)[0]!)).toEqual({
      version: 1,
    });
    expect(await screen.findByRole('button', { name: 'Mark as sent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receive goods' })).toHaveAttribute(
      'href',
      `/purchase/grns/new?po=${PO_ID}`,
    );
  });
});

describe('Goods received', () => {
  it('receives what is still due on an order, then posts it after a confirmation', async () => {
    const po = makePurchaseOrder();
    let grn: Grn | null = null;
    const fetchMock = hub(
      {
        [`GET /purchase-orders/${PO_ID}`]: () => json(po),
        'POST /grns': ({ body }) => {
          const b = body as { lines: { quantityMilli: number; rejectedQtyMilli: number }[] };
          const base = makeGrn();
          grn = makeGrn({
            id: '0f400000-0000-4000-8000-000000000002',
            grnNo: 'KOL1/GRN/2026-27/000002',
            status: 'DRAFT',
            version: 1,
            vendorInvoiceNo: 'FF/1201',
            dueOn: null,
            postedAt: null,
            postedByName: null,
            subtotal: 40_500,
            taxTotal: 2_025,
            grandTotal: 42_525,
            balance: 42_525,
            lines: [
              {
                ...base.lines[0]!,
                quantityMilli: b.lines[0]!.quantityMilli,
                rejectedQtyMilli: b.lines[0]!.rejectedQtyMilli,
                acceptedQtyMilli: 4_500,
                value: 40_500,
                taxAmount: 2_025,
                total: 42_525,
                batchNo: 'B-12',
              },
            ],
          });
          return json(grn, 201);
        },
        'GET /grns/0f400000-0000-4000-8000-000000000002': () => json(grn),
        'POST /grns/0f400000-0000-4000-8000-000000000002/post': () => {
          grn = { ...grn!, status: 'POSTED', version: 2, dueOn: '2026-11-12' };
          return json(grn);
        },
      },
      STORE,
    );
    renderApp(`/purchase/orders/${PO_ID}`);
    // 25 kg ordered, 20 kg received: 5 kg still to come; the eggs all came.
    const riceRow = await screen.findByRole('row', { name: /Basmati rice/ });
    expect(within(riceRow).getAllByRole('cell')[3]).toHaveTextContent('5 kg');
    expect(screen.getByText('1 line is still to come.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Receive goods' }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Receive goods against KOL1/PO/2026-27/000001',
      }),
    ).toBeInTheDocument();
    const lines = screen.getAllByRole('listitem', { name: /^Line/ });
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toHaveAccessibleName('Line 1: Basmati rice');
    expect(within(line).getByText('Ordered 25 kg, received so far 20 kg')).toBeInTheDocument();
    expect(within(line).getByLabelText(/^Delivered/)).toHaveValue('5');
    expect(within(line).getByLabelText(/^Price per kg/)).toHaveValue('90.00');
    fireEvent.change(within(line).getByLabelText(/^Rejected/), { target: { value: '0.5' } });
    fireEvent.change(within(line).getByLabelText('Batch number'), { target: { value: 'B-12' } });
    fireEvent.change(within(line).getByLabelText('Expires on'), {
      target: { value: '2027-04-30' },
    });
    fireEvent.change(screen.getByLabelText('Vendor’s bill number'), {
      target: { value: 'FF/1201' },
    });
    // Billed on what was accepted: 4.5 kg × ₹90 + 5% GST.
    expect(within(line).getByText('₹405.00 + GST ₹20.25 = ₹425.25')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: /KOL1\/GRN\/2026-27\/000002/ }),
    ).toHaveTextContent('Draft');
    expect(bodyOf(callsTo(fetchMock, 'POST', '/grns')[0]!)).toEqual({
      purchaseOrderId: PO_ID,
      vendorId: null,
      vendorInvoiceNo: 'FF/1201',
      vendorInvoiceDate: null,
      notes: null,
      lines: [
        {
          purchaseOrderLineId: PO_LINE_RICE,
          inventoryItemId: RICE_ID,
          unitId: 'unit-kg',
          quantityMilli: 5_000,
          rejectedQtyMilli: 500,
          unitPrice: 9_000,
          taxRateBp: 500,
          batchNo: 'B-12',
          expiresOn: '2027-04-30',
        },
      ],
    });
    // A draft's tax treatment is previewed from the vendor's GSTIN.
    expect(await screen.findByText(/When posted: Same state as this branch/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Post GRN' }));
    const confirm = screen.getByRole('dialog', { name: 'Post KOL1/GRN/2026-27/000002?' });
    expect(within(confirm).getByText('Basmati rice: 4.5 kg')).toBeInTheDocument();
    expect(
      within(confirm).getByText(/₹425.25 is added to what you owe Fresh Farms/),
    ).toBeInTheDocument();
    await expectNoAxeViolations();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Post GRN' }));
    expect(
      await screen.findByText('KOL1/GRN/2026-27/000002 posted: the goods are in stock.'),
    ).toBeInTheDocument();
    expect(
      bodyOf(callsTo(fetchMock, 'POST', '/grns/0f400000-0000-4000-8000-000000000002/post')[0]!),
    ).toEqual({ version: 1 });
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Posted'),
    );
    expect(screen.queryByRole('button', { name: 'Post GRN' })).toBeNull();
  });

  it('pays a bill: more than its balance is refused, and the Hub’s overpayment is explained', async () => {
    const fetchMock = hub({
      [`GET /grns/${GRN_ID}`]: () => json(makeGrn()),
      'POST /vendor-payments': () => problem(409, 'OVERPAYMENT'),
    });
    renderApp(`/purchase/grns/${GRN_ID}`);
    expect(await screen.findByText(/CGST \+ SGST: a vendor in this state/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(dialog).toHaveAccessibleDescription(
      'Fresh Farms · KOL1/GRN/2026-27/000001 · ₹1,890.00 due',
    );
    const amount = within(dialog).getByLabelText(/^Amount/);
    expect(amount).toHaveValue('1890.00');
    fireEvent.change(amount, { target: { value: '2000' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      within(dialog).getByText('Only ₹1,890.00 is still due on this bill.'),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/vendor-payments')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('radio', { name: 'UPI' }));
    fireEvent.change(amount, { target: { value: '1000' } });
    fireEvent.change(within(dialog).getByLabelText('UPI reference'), {
      target: { value: 'UPI-889' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That is more than is still owed on this bill. Lower the amount, or pay the rest on account.',
    );
    const [call] = callsTo(fetchMock, 'POST', '/vendor-payments');
    expect(bodyOf(call!)).toEqual({
      vendorId: VENDOR_ID,
      grnId: GRN_ID,
      method: 'UPI',
      amount: 100_000,
      reference: 'UPI-889',
      paidOn: localIsoDate(),
    });
    // Retry-safe: a second tap after a lost reply can't pay twice.
    expect(new Headers((call![1] as RequestInit).headers).get('idempotency-key')).toMatch(
      /^[\w-]{8,128}$/,
    );
    await expectNoAxeViolations();
  });
});

describe('Dues', () => {
  it('ages what is owed per vendor and totals it, as of a chosen day', async () => {
    const fetchMock = hub({
      'GET /reports/vendor-dues': ({ url }) =>
        json(makeDues({ asOf: url.searchParams.get('asOf') ?? '2026-12-20' })),
    });
    renderApp('/purchase/dues?asOf=2026-12-20');
    const table = await screen.findByRole('table', { name: 'Dues as of 20 Dec 2026' });
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((c) => c.textContent);
    // Not yet due, 1–30, 31–60, 61–90, over 90, total due, advance, oldest due.
    expect(cells(/Fresh Farms/)).toEqual([
      'Fresh FarmsFRESH',
      '₹0.00',
      '₹0.00',
      '₹862.50',
      '₹0.00',
      '₹0.00',
      '₹862.50',
      '₹0.00',
      '12 Nov 2026',
    ]);
    expect(cells(/Delhi Spices/).slice(1, 7)).toEqual([
      '₹500.00',
      '₹0.00',
      '₹0.00',
      '₹0.00',
      '₹120.00',
      '₹620.00',
    ]);
    expect(cells(/^Total/)).toEqual([
      '₹500.00',
      '₹0.00',
      '₹862.50',
      '₹0.00',
      '₹120.00',
      '₹1,482.50',
      '₹0.00',
      '',
    ]);
    await expectNoAxeViolations();

    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-11-01' } });
    await waitFor(() =>
      expect(
        new URL(String(callsTo(fetchMock, 'GET', '/reports/vendor-dues').at(-1)![0]), 'http://x')
          .search,
      ).toBe('?asOf=2026-11-01'),
    );
  });
});

describe('Purchase permissions', () => {
  it('gives someone who only views purchases no buttons that change them', async () => {
    hub(
      {
        'GET /purchase-orders': () => json({ data: [] }),
        'GET /grns': () => json({ data: [] }),
      },
      ['vendors.view'],
    );
    const { router } = renderApp('/purchase');
    await waitFor(() => expect(router.state.location.pathname).toBe('/purchase/vendors'));
    expect(await screen.findByRole('link', { name: 'Fresh Farms' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add vendor' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();

    await act(() => router.navigate('/purchase/orders'));
    expect(await screen.findByText('No purchase orders here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New purchase order' })).toBeNull();
    await act(() => router.navigate('/purchase/grns'));
    expect(await screen.findByText('No goods received here yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receive without an order' })).toBeNull();
    await act(() => router.navigate('/purchase/payments'));
    expect(await screen.findByText('No payments in this period.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
    await act(() => router.navigate('/purchase/orders/new'));
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });

  it('is not offered without vendors.view', async () => {
    hub({}, ['inventory.view']);
    renderApp('/purchase/vendors');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.getByText(/cannot open Purchase/)).toBeInTheDocument();
  });

  it('reads in Hindi', async () => {
    await i18n.changeLanguage('hi-IN');
    hub();
    renderApp('/purchase/vendors');
    expect(await screen.findByRole('heading', { level: 1, name: 'विक्रेता' })).toBeInTheDocument();
    expect(await screen.findByText('15 दिन')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'विक्रेता जोड़ें' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
