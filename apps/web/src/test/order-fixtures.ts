import type {
  Kot,
  KotItem,
  KotSummary,
  Order,
  OrderItem,
  OrderSummary,
  ServerMessage,
} from '@restroos/contracts';
import { ITEM_BIRYANI, ITEM_NAAN, STATION_MAIN, TABLE_T1, VARIANT_FULL } from './catalog-fixtures';
import { BRANCH_ID, USER_ID } from './session';

export const ORDER_ID = '0a000000-0000-4000-8000-000000000001';
export const ORDER_2_ID = '0a000000-0000-4000-8000-000000000002';
export const LINE_1 = '0b000000-0000-4000-8000-000000000001';
export const LINE_2 = '0b000000-0000-4000-8000-000000000002';
export const LINE_3 = '0b000000-0000-4000-8000-000000000003';
export const KOT_1 = '0c000000-0000-4000-8000-000000000001';
export const KOT_2 = '0c000000-0000-4000-8000-000000000002';
export const KOT_3 = '0c000000-0000-4000-8000-000000000003';
export const OPENED_AT = '2026-10-28T12:00:00.000Z';

export function makeLine(overrides: Partial<OrderItem> = {}): OrderItem {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unitPrice ?? 6000;
  const addonsTotal = overrides.addonsTotal ?? 0;
  return {
    id: LINE_1,
    menuItemId: ITEM_NAAN,
    variantId: null,
    name: 'Butter Naan',
    variantName: null,
    foodType: 'VEG',
    unitPrice,
    addons: [],
    addonsTotal,
    quantity,
    lineTotal: (unitPrice + addonsTotal) * quantity,
    specialNote: null,
    course: 1,
    status: 'PENDING',
    kotId: null,
    kitchenStationId: STATION_MAIN,
    cancelReason: null,
    createdAt: OPENED_AT,
    version: 1,
    ...overrides,
  };
}

export const biryaniLine = (overrides: Partial<OrderItem> = {}) =>
  makeLine({
    id: LINE_2,
    menuItemId: ITEM_BIRYANI,
    variantId: VARIANT_FULL,
    name: 'Chicken Biryani',
    variantName: 'Full',
    foodType: 'NON_VEG',
    unitPrice: 32000,
    ...overrides,
  });

export function makeKotSummary(overrides: Partial<KotSummary> = {}): KotSummary {
  return {
    id: KOT_1,
    kotNo: 31,
    kitchenStationId: STATION_MAIN,
    stationName: 'Main Kitchen',
    status: 'NEW',
    firedAt: OPENED_AT,
    readyAt: null,
    version: 1,
    ...overrides,
  };
}

/** An order whose totals follow its items, as the Hub computes them. */
export function makeOrder(overrides: Partial<Order> = {}): Order {
  const items = overrides.items ?? [];
  const live = items.filter((i) => i.status !== 'CANCELLED');
  return {
    id: ORDER_ID,
    orderNo: '142',
    tokenNo: null,
    businessDate: '2026-10-28',
    orderType: 'DINE_IN',
    status: 'OPEN',
    tableId: TABLE_T1,
    tableLabel: 'T1',
    covers: 4,
    captainId: USER_ID,
    captainName: 'Ravi Kumar',
    notes: null,
    subtotal: live.reduce((s, i) => s + i.lineTotal, 0),
    itemCount: live.reduce((s, i) => s + i.quantity, 0),
    pendingCount: live.filter((i) => i.status === 'PENDING').reduce((s, i) => s + i.quantity, 0),
    readyCount: live.filter((i) => i.status === 'READY').reduce((s, i) => s + i.quantity, 0),
    openedAt: OPENED_AT,
    closedAt: null,
    version: 1,
    kots: [],
    ...overrides,
    items,
  };
}

export function summaryOf(order: Order): OrderSummary {
  const { items: _items, kots: _kots, ...summary } = order;
  return summary;
}

export function makeKotItem(overrides: Partial<KotItem> = {}): KotItem {
  return {
    id: LINE_1,
    menuItemId: ITEM_NAAN,
    variantId: null,
    name: 'Butter Naan',
    variantName: null,
    foodType: 'VEG',
    quantity: 4,
    addons: [],
    specialNote: null,
    course: 1,
    status: 'SENT',
    cancelReason: null,
    ...overrides,
  };
}

export function makeKot(overrides: Partial<Kot> = {}): Kot {
  return {
    id: KOT_1,
    kotNo: 34,
    businessDate: '2026-10-28',
    orderId: ORDER_ID,
    orderNo: '142',
    orderType: 'DINE_IN',
    tableLabel: 'T2',
    tokenNo: null,
    captainId: USER_ID,
    captainName: 'Ravi Kumar',
    kitchenStationId: STATION_MAIN,
    stationName: 'Main Kitchen',
    status: 'NEW',
    priority: 0,
    assignedChefId: null,
    assignedChefName: null,
    firedAt: OPENED_AT,
    acceptedAt: null,
    cookingAt: null,
    readyAt: null,
    servedAt: null,
    targetReadyAt: '2026-10-28T12:15:00.000Z',
    items: [makeKotItem()],
    version: 1,
    ...overrides,
  };
}

let seq = 100;
/** Wraps live-message data in the server envelope, with an increasing seq. */
export function envelope<T extends ServerMessage['type']>(
  type: T,
  data: Extract<ServerMessage, { type: T }>['data'],
): Extract<ServerMessage, { type: T }> {
  seq += 1;
  return {
    type,
    seq,
    branchId: BRANCH_ID,
    occurredAt: new Date().toISOString(),
    data,
  } as Extract<ServerMessage, { type: T }>;
}
