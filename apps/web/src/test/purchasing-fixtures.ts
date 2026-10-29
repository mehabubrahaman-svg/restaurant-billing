import type {
  Grn,
  InventoryItem,
  PurchaseOrder,
  Unit,
  Vendor,
  VendorDuesReport,
  VendorPayment,
  VendorStatement,
} from '@restroos/contracts';

export const VENDOR_ID = '0f100000-0000-4000-8000-000000000001';
export const VENDOR_2_ID = '0f100000-0000-4000-8000-000000000002';
export const RICE_ID = '0f200000-0000-4000-8000-000000000001';
export const EGGS_ID = '0f200000-0000-4000-8000-000000000002';
export const PO_ID = '0f300000-0000-4000-8000-000000000001';
export const PO_LINE_RICE = '0f300000-0000-4000-8000-0000000000a1';
export const PO_LINE_EGGS = '0f300000-0000-4000-8000-0000000000a2';
export const GRN_ID = '0f400000-0000-4000-8000-000000000001';
export const GRN_LINE_ID = '0f400000-0000-4000-8000-0000000000b1';
export const PAYMENT_ID = '0f500000-0000-4000-8000-000000000001';

/** The units seeded by migration 0002. */
export const UNITS: Unit[] = [
  { id: 'unit-g', code: 'g', name: 'Gram', baseCode: 'g', toBaseMilli: 1_000 },
  { id: 'unit-kg', code: 'kg', name: 'Kilogram', baseCode: 'g', toBaseMilli: 1_000_000 },
  { id: 'unit-ml', code: 'ml', name: 'Millilitre', baseCode: 'ml', toBaseMilli: 1_000 },
  { id: 'unit-l', code: 'l', name: 'Litre', baseCode: 'ml', toBaseMilli: 1_000_000 },
  { id: 'unit-pc', code: 'pc', name: 'Piece', baseCode: 'pc', toBaseMilli: 1_000 },
  { id: 'unit-dozen', code: 'dozen', name: 'Dozen', baseCode: 'pc', toBaseMilli: 12_000 },
  { id: 'unit-tray', code: 'tray', name: 'Tray (30)', baseCode: 'pc', toBaseMilli: 30_000 },
];

/** Fresh Farms: a West Bengal vendor (the branch's state) on 15 days' terms. */
export function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: VENDOR_ID,
    code: 'FRESH',
    name: 'Fresh Farms',
    contactPerson: 'Bikash Pal',
    phone: '+91 98300 12345',
    email: null,
    address: 'Koley Market, Sealdah',
    taxId: '19AAACF1234A1Z5',
    paymentTermsDays: 15,
    due: 86_250,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

export const delhiSpices = makeVendor({
  id: VENDOR_2_ID,
  code: 'DSP',
  name: 'Delhi Spices',
  contactPerson: null,
  phone: null,
  address: null,
  taxId: '07AAACD1234B1Z2',
  paymentTermsDays: 30,
  due: 0,
});

/** Basmati rice, kept in grams and bought by the kg. */
export function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: RICE_ID,
    sku: 'RICE',
    name: 'Basmati rice',
    nameTranslations: {},
    category: 'Grains',
    baseUnit: 'g',
    purchaseUnitId: 'unit-kg',
    isPerishable: false,
    shelfLifeDays: null,
    reorderLevelMilli: 5_000_000,
    maxLevelMilli: null,
    qtyMilli: 20_000_000,
    avgCostPerBase: 9_000,
    value: 180_000,
    level: 'OK',
    isActive: true,
    version: 1,
    ...overrides,
  };
}

export const eggs = makeItem({
  id: EGGS_ID,
  sku: 'EGG',
  name: 'Eggs',
  category: 'Dairy',
  baseUnit: 'pc',
  purchaseUnitId: 'unit-dozen',
  qtyMilli: 108_000,
  avgCostPerBase: 654_167,
  value: 70_650,
});

/** 25 kg of rice at ₹90/kg + 5% and 10 dozen eggs at ₹78.50, sent to Fresh Farms. */
export function makePurchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: PO_ID,
    poNo: 'KOL1/PO/2026-27/000001',
    vendorId: VENDOR_ID,
    vendorName: 'Fresh Farms',
    status: 'SENT',
    expectedOn: '2026-10-30',
    subtotal: 303_500,
    taxTotal: 11_250,
    grandTotal: 314_750,
    createdAt: '2026-10-28T04:30:00.000Z',
    createdByName: 'Gopal Ghosh',
    version: 3,
    notes: null,
    lines: [
      {
        id: PO_LINE_RICE,
        inventoryItemId: RICE_ID,
        itemName: 'Basmati rice',
        baseUnit: 'g',
        unitId: 'unit-kg',
        unitCode: 'kg',
        quantityMilli: 25_000,
        unitPrice: 9_000,
        taxRateBp: 500,
        value: 225_000,
        taxAmount: 11_250,
        total: 236_250,
        receivedQtyMilli: 20_000,
      },
      {
        id: PO_LINE_EGGS,
        inventoryItemId: EGGS_ID,
        itemName: 'Eggs',
        baseUnit: 'pc',
        unitId: 'unit-dozen',
        unitCode: 'dozen',
        quantityMilli: 10_000,
        unitPrice: 7_850,
        taxRateBp: 0,
        value: 78_500,
        taxAmount: 0,
        total: 78_500,
        receivedQtyMilli: 10_000,
      },
    ],
    approvedAt: '2026-10-28T05:00:00.000Z',
    approvedByName: 'Ananya Sen',
    sentAt: '2026-10-28T05:10:00.000Z',
    cancelReason: null,
    grns: [],
    ...overrides,
  };
}

/** A posted GRN of 20 kg of rice: ₹1,800 + 5% GST = ₹1,890, nothing paid yet. */
export function makeGrn(overrides: Partial<Grn> = {}): Grn {
  return {
    id: GRN_ID,
    grnNo: 'KOL1/GRN/2026-27/000001',
    vendorId: VENDOR_ID,
    vendorName: 'Fresh Farms',
    purchaseOrderId: PO_ID,
    poNo: 'KOL1/PO/2026-27/000001',
    vendorInvoiceNo: 'FF/1123',
    vendorInvoiceDate: null,
    businessDate: '2026-10-28',
    dueOn: '2026-11-12',
    status: 'POSTED',
    subtotal: 180_000,
    taxTotal: 9_000,
    grandTotal: 189_000,
    paid: 0,
    balance: 189_000,
    version: 2,
    inputTaxKind: 'CGST_SGST',
    notes: null,
    lines: [
      {
        id: GRN_LINE_ID,
        purchaseOrderLineId: PO_LINE_RICE,
        inventoryItemId: RICE_ID,
        itemName: 'Basmati rice',
        baseUnit: 'g',
        unitId: 'unit-kg',
        unitCode: 'kg',
        quantityMilli: 20_000,
        rejectedQtyMilli: 0,
        acceptedQtyMilli: 20_000,
        unitPrice: 9_000,
        taxRateBp: 500,
        value: 180_000,
        taxAmount: 9_000,
        total: 189_000,
        batchNo: 'B-11',
        expiresOn: '2027-04-30',
      },
    ],
    cancelReason: null,
    postedAt: '2026-10-28T09:00:00.000Z',
    postedByName: 'Gopal Ghosh',
    createdAt: '2026-10-28T08:45:00.000Z',
    createdByName: 'Gopal Ghosh',
    ...overrides,
  };
}

export function makePayment(overrides: Partial<VendorPayment> = {}): VendorPayment {
  return {
    id: PAYMENT_ID,
    vendorId: VENDOR_ID,
    vendorName: 'Fresh Farms',
    grnId: GRN_ID,
    grnNo: 'KOL1/GRN/2026-27/000001',
    method: 'BANK',
    amount: 100_000,
    reference: 'UTR123',
    paidOn: '2026-10-28',
    createdAt: '2026-10-28T10:00:00.000Z',
    createdByName: 'Tapas Roy',
    ...overrides,
  };
}

export function makeStatement(overrides: Partial<VendorStatement> = {}): VendorStatement {
  return {
    vendor: makeVendor(),
    from: '2026-10-01',
    to: '2026-10-28',
    openingBalance: 0,
    entries: [
      {
        date: '2026-10-28',
        kind: 'BILL',
        id: GRN_ID,
        number: 'KOL1/GRN/2026-27/000001',
        description: 'Bill FF/1123',
        debit: 0,
        credit: 189_000,
        balance: 189_000,
      },
      {
        date: '2026-10-28',
        kind: 'PAYMENT',
        id: PAYMENT_ID,
        number: 'UTR123',
        description: 'BANK against KOL1/GRN/2026-27/000001',
        debit: 100_000,
        credit: 0,
        balance: 89_000,
      },
    ],
    closingBalance: 89_000,
    ...overrides,
  };
}

/** Fresh Farms 31–60 days late; Delhi Spices partly not due yet, partly over 90 days. */
export function makeDues(overrides: Partial<VendorDuesReport> = {}): VendorDuesReport {
  const zero = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
  return {
    asOf: '2026-12-20',
    rows: [
      {
        vendorId: VENDOR_2_ID,
        code: 'DSP',
        name: 'Delhi Spices',
        billed: 162_000,
        paid: 100_000,
        due: 62_000,
        advance: 0,
        ...zero,
        current: 50_000,
        over90: 12_000,
        oldestDueOn: '2026-08-01',
      },
      {
        vendorId: VENDOR_ID,
        code: 'FRESH',
        name: 'Fresh Farms',
        billed: 236_250,
        paid: 150_000,
        due: 86_250,
        advance: 0,
        ...zero,
        d31to60: 86_250,
        oldestDueOn: '2026-11-12',
      },
    ],
    totals: { due: 148_250, advance: 0, ...zero, current: 50_000, d31to60: 86_250, over90: 12_000 },
    ...overrides,
  };
}
