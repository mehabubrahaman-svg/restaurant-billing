import { describe, expect, it } from 'vitest';
import { lineTotalOf, Order, type NewOrderLine } from './order';

const at = new Date('2026-10-28T13:00:00Z');
const later = new Date('2026-10-28T13:05:00Z');

function open(type: 'DINE_IN' | 'TAKEAWAY' = 'DINE_IN') {
  return Order.open('o1', {
    branchId: 'b1',
    orderNo: '42',
    tokenNo: type === 'TAKEAWAY' ? 7 : null,
    businessDate: '2026-10-28',
    orderType: type,
    source: 'CAPTAIN',
    tableId: type === 'DINE_IN' ? 't1' : null,
    salesChannelId: null,
    externalOrderId: null,
    externalOtp: null,
    captainId: 'u1',
    covers: 2,
    notes: null,
    openedAt: at,
    createdBy: 'u1',
  });
}

function line(id: string, over: Partial<NewOrderLine> = {}): NewOrderLine {
  return {
    id,
    menuItemId: 'm1',
    variantId: null,
    name: 'Chicken Biryani',
    variantName: null,
    foodType: 'NON_VEG',
    unitPrice: 32000,
    addons: [],
    taxGroupId: null,
    kitchenStationId: null,
    prepTimeSec: null,
    quantity: 1,
    specialNote: null,
    course: 1,
    createdAt: at,
    createdBy: 'u1',
    ...over,
  };
}

describe('Order', () => {
  it('prices lines with add-ons and keeps cancelled lines out of the subtotal', () => {
    const order = open();
    order.addLines(
      [
        line('l1', {
          quantity: 2,
          addons: [{ addonId: 'a1', name: 'Raita', price: 4000, quantity: 1 }],
        }),
        line('l2', { unitPrice: 6000, quantity: 4, name: 'Butter Naan' }),
      ],
      at,
    );
    expect(lineTotalOf(order.line('l1'))).toBe(72000);
    expect(order.subtotal).toBe(96000);
    expect(order.itemCount).toBe(6);
    order.cancelLine('l2', 1, { reason: null, isWastage: false, by: 'u1' }, later);
    expect(order.subtotal).toBe(72000);
    expect(order.line('l2')).toMatchObject({ status: 'CANCELLED', isWastage: false, version: 2 });
    expect(order.pullEvents().map((e) => e.type)).toEqual([
      'OrderOpened',
      'OrderItemsAdded',
      'OrderItemCancelled',
    ]);
  });

  it('edits only pending lines, with a version check', () => {
    const order = open();
    order.addLines([line('l1')], at);
    order.updateLine('l1', 1, { quantity: 3, specialNote: 'Less spicy' }, later);
    expect(order.line('l1')).toMatchObject({ quantity: 3, specialNote: 'Less spicy', version: 2 });
    expect(() => order.updateLine('l1', 1, { quantity: 1 }, later)).toThrow(
      expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    );
    order.markSent(new Map([['l1', 'k1']]), later);
    expect(() => order.updateLine('l1', 2, { quantity: 1 }, later)).toThrow(
      expect.objectContaining({ code: 'ITEM_ALREADY_SENT' }),
    );
  });

  it('needs a reason to cancel what the kitchen already has, and records wastage', () => {
    const order = open();
    order.addLines([line('l1')], at);
    order.markSent(new Map([['l1', 'k1']]), later);
    expect(order.hasSentItems).toBe(true);
    expect(() =>
      order.cancelLine('l1', 1, { reason: null, isWastage: true, by: 'm1' }, later),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    const { wasSent } = order.cancelLine(
      'l1',
      1,
      { reason: 'Guest changed mind', isWastage: true, by: 'm1' },
      later,
    );
    expect(wasSent).toBe(true);
    expect(order.line('l1')).toMatchObject({ isWastage: true, cancelReason: 'Guest changed mind' });
  });

  it('cancels the whole order and refuses changes afterwards', () => {
    const order = open();
    order.addLines([line('l1'), line('l2')], at);
    const cancelled = order.cancel({ reason: 'Guests left', by: 'm1' }, later);
    expect(cancelled.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(order.state).toMatchObject({ status: 'CANCELLED', closedAt: later });
    expect(() => order.addLines([line('l3')], later)).toThrow(
      expect.objectContaining({ code: 'ORDER_NOT_OPEN' }),
    );
  });

  it('reopens when its bill is cancelled, billed or already paid, but not once cancelled', () => {
    const order = open();
    order.addLines([line('l1')], at);
    order.markSent(new Map([['l1', 'k1']]), at);
    order.markBilled(at);
    order.reopen(later);
    expect(order.state).toMatchObject({ status: 'OPEN', closedAt: null });
    order.markBilled(later);
    order.markPaid(later);
    expect(order.state.closedAt).toEqual(later);
    order.reopen(later);
    expect(order.state).toMatchObject({ status: 'OPEN', closedAt: null });
    order.cancel({ reason: 'Guests left', by: 'm1' }, later);
    expect(() => order.reopen(later)).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });

  it('merges every line into another order and closes itself', () => {
    const a = open();
    const b = Order.open('o2', {
      ...a.state,
      orderNo: '43',
      tableId: 't2',
      covers: 3,
      openedAt: at,
    });
    a.addLines([line('l1')], at);
    b.addLines([line('l2')], at);
    a.mergeInto(b, later);
    expect(b.lines.map((l) => l.id)).toEqual(['l2', 'l1']);
    expect(b.state.covers).toBe(5);
    expect(a.state).toMatchObject({ status: 'CANCELLED', mergedIntoOrderId: 'o2' });
    expect(a.lines).toHaveLength(0);
    expect([...b.dirtyLineIds]).toContain('l1');
  });

  it('moves a dine-in order to another table, but not a takeaway', () => {
    const order = open();
    expect(order.moveToTable('t9', later)).toBe('t1');
    expect(order.state.tableId).toBe('t9');
    expect(() => open('TAKEAWAY').moveToTable('t9', later)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});
