import type { PersistedEvent } from '@restroos/application';
import type { ServerMessage, WsTopic } from '@restroos/contracts';
import type { Cradle } from '../container';

/** A message waiting to go out, with the topics allowed to see it. */
export interface Outgoing {
  readonly key: string;
  readonly topics: readonly WsTopic[];
  readonly message: ServerMessage;
}

/** The minimum an event needs to be turned into live messages (also what replay reads back). */
export type EventRef = Pick<
  PersistedEvent,
  'seq' | 'type' | 'aggregateType' | 'aggregateId' | 'branchId' | 'payload'
> & {
  occurredAt: Date;
};

const CATALOG = new Set(['MenuItem', 'Category', 'AddonGroup', 'KitchenStation']);

/**
 * Turns committed domain events into WebSocket messages carrying the entity's
 * current state (docs/05 §5). Callers dedupe by `key`, so a command that
 * raises five events for one order sends one `ordering.order.updated`.
 */
export function messagesFor(
  cradle: Pick<
    Cradle,
    'orderQueries' | 'kitchenQueries' | 'floorService' | 'calendar' | 'billingQueries'
  >,
  event: EventRef,
): Outgoing[] {
  const base = {
    seq: event.seq,
    branchId: event.branchId,
    occurredAt: event.occurredAt.toISOString(),
  };
  const out: Outgoing[] = [];
  const orderUpdated = (orderId: string) => {
    const order = cradle.orderQueries.summary(event.branchId, orderId);
    if (order) {
      out.push({
        key: `order:${orderId}`,
        topics: ['floor'],
        message: { ...base, type: 'ordering.order.updated', data: { order } },
      });
    }
  };

  switch (event.aggregateType) {
    case 'Reservation':
      out.push({
        key: 'reservations',
        topics: ['floor'],
        message: { ...base, type: 'floor.reservations.changed', data: {} },
      });
      break;
    case 'DiningTable': {
      let table;
      try {
        table = cradle.floorService.table(event.branchId, event.aggregateId);
      } catch {
        break;
      }
      out.push({
        key: `table:${table.id}`,
        topics: ['floor'],
        message: {
          ...base,
          type: 'floor.table.status_changed',
          data: {
            tableId: table.id,
            status: table.status,
            orderId: table.currentOrderId,
            version: table.version,
          },
        },
      });
      break;
    }
    case 'Order':
      orderUpdated(event.aggregateId);
      break;
    case 'Invoice': {
      const invoice = cradle.billingQueries.summary(event.branchId, event.aggregateId);
      if (!invoice) break;
      out.push({
        key: `invoice:${invoice.id}`,
        topics: ['floor'],
        message: { ...base, type: 'billing.invoice.updated', data: { invoice } },
      });
      orderUpdated(invoice.orderId);
      break;
    }
    case 'Kot': {
      const kot = cradle.kitchenQueries.kot(event.branchId, event.aggregateId);
      if (!kot) break;
      const payload = (event.payload ?? {}) as { from?: string; to?: string };
      if (event.type === 'KotFired') {
        out.push({
          key: `kot:${kot.id}`,
          topics: ['kitchen'],
          message: { ...base, type: 'kitchen.kot.fired', data: { kot } },
        });
      } else if (event.type === 'KotStatusChanged') {
        out.push({
          key: `kot-status:${kot.id}:${payload.to}`,
          topics: ['kitchen', 'floor'],
          message: {
            ...base,
            type: 'kitchen.kot.status_changed',
            data: {
              from: (payload.from as typeof kot.status | undefined) ?? null,
              to: kot.status,
              kot,
            },
          },
        });
      } else {
        out.push({
          key: `kot:${kot.id}`,
          topics: ['kitchen'],
          message: { ...base, type: 'kitchen.kot.updated', data: { kot } },
        });
      }
      orderUpdated(kot.orderId);
      if (kot.tokenNo !== null && (kot.status === 'READY' || event.type === 'KotItemReady')) {
        const board = cradle.kitchenQueries.tokenBoard(event.branchId, kot.businessDate);
        if (board.ready.includes(kot.tokenNo)) {
          out.push({
            key: `token:${kot.tokenNo}`,
            topics: ['tokens'],
            message: {
              ...base,
              type: 'token.ready',
              data: { tokenNo: kot.tokenNo, orderId: kot.orderId },
            },
          });
        }
      }
      break;
    }
    default:
      if (CATALOG.has(event.aggregateType)) {
        out.push({
          key: 'menu',
          topics: ['floor', 'kitchen'],
          message: { ...base, type: 'menu.changed', data: {} },
        });
      }
  }
  return out;
}

/** Keeps the last message per key, in first-seen order; the kept message takes the highest seq. */
export function dedupe(messages: readonly Outgoing[]): Outgoing[] {
  const byKey = new Map<string, Outgoing>();
  for (const m of messages) {
    const prev = byKey.get(m.key);
    byKey.delete(m.key);
    byKey.set(
      m.key,
      prev && prev.message.seq > m.message.seq
        ? { ...m, message: { ...m.message, seq: prev.message.seq } }
        : m,
    );
  }
  return [...byKey.values()];
}
