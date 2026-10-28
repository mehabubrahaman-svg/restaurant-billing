import type { FloorResponse, KotsResponse, Order, TokenBoard } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../../app/providers';
import {
  makeFloor,
  makeTable,
  STATION_MAIN,
  TABLE_T1,
  TABLE_T2,
} from '../../test/catalog-fixtures';
import {
  envelope,
  KOT_1,
  KOT_2,
  makeKot,
  makeKotSummary,
  makeLine,
  makeOrder,
  ORDER_ID,
  summaryOf,
} from '../../test/order-fixtures';
import { FLOOR_KEY } from '../floor/floor-queries';
import { useKdsFlags } from '../kitchen/kds-flags';
import { KITCHEN_KEYS } from '../kitchen/kds-queries';
import { ORDER_KEYS } from '../orders/order-queries';
import { TOKENS_KEY } from '../tokens/token-queries';
import { applyLiveMessage } from './apply-message';

const OTHER_STATION = 'd0000000-0000-4000-8000-0000000000ff';

function client() {
  const c = createQueryClient();
  c.setQueryData<FloorResponse>(
    FLOOR_KEY,
    makeFloor([makeTable(), makeTable({ id: TABLE_T2, label: 'T2' })]),
  );
  return c;
}
const tables = (c: ReturnType<typeof client>) =>
  c.getQueryData<FloorResponse>(FLOOR_KEY)!.areas[0]!.tables;

describe('applyLiveMessage', () => {
  it('puts an order’s summary on its table, and keeps only the newest table version', () => {
    const c = client();
    const order = makeOrder({ items: [makeLine({ quantity: 3 })] });
    applyLiveMessage(
      c,
      envelope('floor.table.status_changed', {
        tableId: TABLE_T1,
        status: 'OCCUPIED',
        orderId: ORDER_ID,
        version: 3,
      }),
    );
    applyLiveMessage(c, envelope('ordering.order.updated', { order: summaryOf(order) }));
    expect(tables(c)[0]).toMatchObject({
      status: 'OCCUPIED',
      version: 3,
      openOrder: { id: ORDER_ID, subtotal: 18000, pendingCount: 3, covers: 4 },
    });
    // A late, older table message changes nothing.
    applyLiveMessage(
      c,
      envelope('floor.table.status_changed', {
        tableId: TABLE_T1,
        status: 'AVAILABLE',
        orderId: null,
        version: 2,
      }),
    );
    expect(tables(c)[0]!.status).toBe('OCCUPIED');
  });

  it('moves the order off its old table on MOVE, and clears it when paid', () => {
    const c = client();
    const order = makeOrder();
    applyLiveMessage(c, envelope('ordering.order.updated', { order: summaryOf(order) }));
    applyLiveMessage(
      c,
      envelope('ordering.order.updated', {
        order: { ...summaryOf(order), tableId: TABLE_T2, tableLabel: 'T2', version: 2 },
      }),
    );
    expect(tables(c)[0]!.openOrder).toBeNull();
    expect(tables(c)[1]!.openOrder?.id).toBe(ORDER_ID);
    applyLiveMessage(
      c,
      envelope('ordering.order.updated', {
        order: { ...summaryOf(order), tableId: TABLE_T2, status: 'PAID', version: 3 },
      }),
    );
    expect(tables(c)[1]!.openOrder).toBeNull();
  });

  it('marks a loaded order stale when its summary moves on, and updates its KOT status', () => {
    const c = client();
    const order = makeOrder({ kots: [makeKotSummary({ id: KOT_1, version: 1 })] });
    c.setQueryData<Order>(ORDER_KEYS.detail(ORDER_ID), order);
    applyLiveMessage(
      c,
      envelope('kitchen.kot.status_changed', {
        from: 'COOKING',
        to: 'READY',
        kot: makeKot({ id: KOT_1, status: 'READY', version: 4 }),
      }),
    );
    expect(c.getQueryData<Order>(ORDER_KEYS.detail(ORDER_ID))!.kots[0]).toMatchObject({
      status: 'READY',
      version: 4,
    });
    expect(c.getQueryState(ORDER_KEYS.detail(ORDER_ID))!.isInvalidated).toBe(true);
  });

  it('adds fired KOTs to the boards that show their station, and drops served ones', () => {
    const c = client();
    c.setQueryData<KotsResponse>(KITCHEN_KEYS.kots(null), { data: [] });
    c.setQueryData<KotsResponse>(KITCHEN_KEYS.kots(STATION_MAIN), { data: [] });
    c.setQueryData<KotsResponse>(KITCHEN_KEYS.kots(OTHER_STATION), { data: [] });
    applyLiveMessage(c, envelope('kitchen.kot.fired', { kot: makeKot({ id: KOT_1 }) }));
    applyLiveMessage(
      c,
      envelope('kitchen.kot.fired', {
        kot: makeKot({ id: KOT_2, kitchenStationId: OTHER_STATION }),
      }),
    );
    const ids = (station: string | null) =>
      c.getQueryData<KotsResponse>(KITCHEN_KEYS.kots(station))!.data.map((k) => k.id);
    expect(ids(null)).toEqual([KOT_1, KOT_2]);
    expect(ids(STATION_MAIN)).toEqual([KOT_1]);
    expect(ids(OTHER_STATION)).toEqual([KOT_2]);

    // An older copy arriving late is ignored; SERVED leaves the board.
    applyLiveMessage(
      c,
      envelope('kitchen.kot.updated', {
        kot: makeKot({ id: KOT_1, version: 0, status: 'SERVED' }),
      }),
    );
    expect(ids(null)).toEqual([KOT_1, KOT_2]);
    applyLiveMessage(
      c,
      envelope('kitchen.kot.status_changed', {
        from: 'READY',
        to: 'SERVED',
        kot: makeKot({ id: KOT_1, version: 5, status: 'SERVED' }),
      }),
    );
    expect(ids(null)).toEqual([KOT_2]);
  });

  it('flags delayed KOTs and moves ready tokens', () => {
    const c = client();
    c.setQueryData<TokenBoard>(TOKENS_KEY, {
      businessDate: '2026-10-28',
      preparing: [12, 13],
      ready: [9],
    });
    applyLiveMessage(c, envelope('kitchen.kot.delayed', { kotId: KOT_1, overdueSeconds: 90 }));
    expect(useKdsFlags.getState().delayed.has(KOT_1)).toBe(true);
    applyLiveMessage(c, envelope('token.ready', { tokenNo: 12, orderId: ORDER_ID }));
    applyLiveMessage(c, envelope('token.ready', { tokenNo: 12, orderId: ORDER_ID }));
    expect(c.getQueryData<TokenBoard>(TOKENS_KEY)).toMatchObject({
      preparing: [13],
      ready: [9, 12],
    });
  });
});
