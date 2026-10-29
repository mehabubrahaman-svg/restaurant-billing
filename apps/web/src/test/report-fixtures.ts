import type {
  Backup,
  Customer,
  CustomerDetail,
  Dashboard,
  DayEndReport,
  SalesChannel,
} from '@restroos/contracts';

export const BACKUP_ID = '0e100000-0000-4000-8000-000000000001';
export const BACKUP_2_ID = '0e100000-0000-4000-8000-000000000002';
export const CHANNEL_DIRECT = '0e200000-0000-4000-8000-000000000001';
export const CHANNEL_SWIGGY = '0e200000-0000-4000-8000-000000000002';
export const CUSTOMER_ID = '0e300000-0000-4000-8000-000000000001';

const period = (from: string, sales: number, invoices: number) => ({
  from,
  to: '2026-10-28',
  sales,
  invoices,
  covers: invoices * 2,
  averageBill: invoices === 0 ? 0 : Math.round(sales / invoices),
});

/** 14 days, oldest first; today (28 Oct) is the best day. */
export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    businessDate: '2026-10-28',
    today: period('2026-10-28', 1_84_220_00, 312),
    month: period('2026-10-01', 38_40_000_00, 6_120),
    financialYear: period('2026-04-01', 2_10_55_000_00, 34_800),
    daily: Array.from({ length: 14 }, (_, i) => {
      const day = 15 + i;
      return {
        date: `2026-10-${String(day).padStart(2, '0')}`,
        sales: day === 28 ? 1_84_220_00 : 1_00_000_00 + i * 3_000_00,
        invoices: day === 28 ? 312 : 200 + i,
      };
    }),
    paymentMix: [
      { method: 'UPI', amount: 95_794_00 },
      { method: 'CASH', amount: 57_108_00 },
      { method: 'CARD', amount: 31_318_00 },
    ],
    topItems: [
      { name: 'Chicken Biryani', quantity: 96, amount: 30_720_00 },
      { name: 'Kosha Mangsho', quantity: 41, amount: 15_580_00 },
      { name: 'Mishti Doi', quantity: 77, amount: 5_390_00 },
    ],
    kitchen: { pending: 9, delayed: 2, avgCookSeconds: 660 },
    openOrders: 14,
    openTables: 11,
    ...overrides,
  };
}

export function makeDayEnd(overrides: Partial<DayEndReport> = {}): DayEndReport {
  return {
    businessDate: '2026-10-28',
    branchName: 'Park Street',
    generatedAt: '2026-10-28T17:30:00.000Z',
    orders: {
      count: 120,
      dineIn: 80,
      takeaway: 25,
      delivery: 15,
      covers: 260,
      cancelled: 2,
      open: 3,
    },
    sales: {
      invoiceCount: 115,
      gross: 1_80_000_00,
      discounts: 4_000_00,
      charges: 6_000_00,
      taxable: 1_82_000_00,
      tax: 9_100_00,
      roundOff: -40,
      total: 1_91_099_60,
      net: 1_89_099_60,
      averageBill: 1_661_74,
    },
    taxes: [
      { code: 'CGST', rateBp: 250, taxable: 1_50_000_00, tax: 3_750_00 },
      { code: 'SGST', rateBp: 250, taxable: 1_50_000_00, tax: 3_750_00 },
      { code: 'VAT', rateBp: 2000, taxable: 8_000_00, tax: 1_600_00 },
    ],
    liquor: { invoiceCount: 9, total: 9_600_00, vat: 1_600_00 },
    payments: [
      { method: 'UPI', count: 60, amount: 1_00_000_00 },
      { method: 'CASH', count: 40, amount: 60_000_00 },
      { method: 'AGGREGATOR', count: 15, amount: 31_099_60 },
    ],
    refunds: { creditNotes: 1, amount: 2_000_00 },
    cancellations: {
      invoices: 1,
      invoiceValue: 1_058_00,
      voidedItems: 3,
      voidedValue: 960_00,
      wastageValue: 320_00,
    },
    discountsGiven: [
      { kind: 'PERCENT', count: 6, amount: 3_000_00 },
      { kind: 'COUPON', count: 2, amount: 1_000_00 },
    ],
    channels: [
      { name: 'Swiggy', orders: 15, sales: 31_099_60, commission: 6_160_00, netRevenue: 24_939_60 },
    ],
    shifts: [
      {
        openedBy: 'Meera Saha',
        status: 'CLOSED',
        expectedCash: 62_000_00,
        countedCash: 61_980_00,
        variance: -20_00,
      },
    ],
    topItems: [{ name: 'Chicken Biryani', quantity: 96, amount: 30_720_00 }],
    kitchen: { kots: 210, avgCookSeconds: 702, delayed: 7 },
    hourly: [
      { hour: 13, invoices: 30, total: 50_000_00 },
      { hour: 20, invoices: 70, total: 1_20_000_00 },
      { hour: 1, invoices: 5, total: 9_000_00 },
    ],
    ...overrides,
  };
}

export function makeBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: BACKUP_ID,
    fileName: 'restroos-20261027-230000000-scheduled.rbak',
    sizeBytes: 1_278_222,
    kind: 'SCHEDULED',
    status: 'AVAILABLE',
    schemaVersion: 9,
    copiedTo: null,
    createdAt: '2026-10-27T17:30:00.000Z',
    createdByName: null,
    ...overrides,
  };
}

export function makeChannel(overrides: Partial<SalesChannel> = {}): SalesChannel {
  return {
    id: CHANNEL_SWIGGY,
    code: 'SWIGGY',
    name: 'Swiggy',
    kind: 'AGGREGATOR',
    integration: 'MANUAL',
    commissionBp: 2200,
    priceMarkupBp: 1000,
    gstPaidByOperator: true,
    operatorGstin: null,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

export const directChannel = makeChannel({
  id: CHANNEL_DIRECT,
  code: 'DIRECT',
  name: 'Direct',
  kind: 'DIRECT',
  commissionBp: 0,
  priceMarkupBp: 0,
  gstPaidByOperator: false,
});

export function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: CUSTOMER_ID,
    phone: '+919830012345',
    name: 'Asha Roy',
    email: null,
    taxId: '19AABCU9603R1ZK',
    preferredLocale: 'bn-IN',
    visitCount: 12,
    lifetimeValue: 18_450_00,
    lastVisitAt: '2026-10-20T15:00:00.000Z',
    marketingOptIn: true,
    loyaltyPoints: 0,
    version: 3,
    ...overrides,
  };
}

export function makeCustomerDetail(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    ...makeCustomer(),
    recentInvoices: [
      {
        id: '0d000000-0000-4000-8000-000000000001',
        invoiceNo: 'KOL1/2026-27/000123',
        businessDate: '2026-10-20',
        grandTotal: 97000,
        status: 'PAID',
      },
    ],
    favourites: [
      { name: 'Chicken Biryani', quantity: 14 },
      { name: 'Mishti Doi', quantity: 9 },
    ],
    ...overrides,
  };
}
