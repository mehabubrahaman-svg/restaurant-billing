import type { FloorResponse, ServerMessage } from '@restroos/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { applyInvoiceSummary, BILLING_KEYS } from '../billing/billing-queries';
import { FLOOR_KEY } from '../floor/floor-queries';
import { refreshReservations, RESERVATIONS_KEY } from '../floor/reservation-queries';
import { useKdsFlags } from '../kitchen/kds-flags';
import { applyKot, KITCHEN_KEYS } from '../kitchen/kds-queries';
import { MENU_KEYS } from '../menu/menu-queries';
import { applyKotToOrder, applyOrderSummary, ORDER_KEYS } from '../orders/order-queries';
import { QR_REQUESTS_KEY } from '../orders/qr-requests';
import { markTokenReady, TOKENS_KEY } from '../tokens/token-queries';

const NO_CANCEL = { cancelRefetch: false } as const;

/** Statuses where a table has no order on it. */
const ORDERLESS = new Set(['AVAILABLE', 'RESERVED', 'CLEANING', 'BLOCKED']);

/**
 * Applies one live message to the React Query cache. Each message carries
 * the latest state of one entity, so it replaces what we hold only when its
 * version is at least as new.
 */
export function applyLiveMessage(client: QueryClient, message: ServerMessage): void {
  switch (message.type) {
    case 'floor.table.status_changed': {
      const { tableId, status, orderId, version } = message.data;
      client.setQueryData<FloorResponse>(FLOOR_KEY, (floor) =>
        floor === undefined
          ? floor
          : {
              areas: floor.areas.map((area) => ({
                ...area,
                tables: area.tables.map((t) =>
                  t.id !== tableId || t.version > version
                    ? t
                    : {
                        ...t,
                        status,
                        version,
                        currentOrderId: orderId,
                        openOrder:
                          ORDERLESS.has(status) || t.openOrder?.id !== orderId ? null : t.openOrder,
                      },
                ),
              })),
            },
      );
      return;
    }
    case 'ordering.order.updated':
      applyOrderSummary(client, message.data.order);
      return;
    case 'kitchen.kot.fired':
    case 'kitchen.kot.status_changed':
    case 'kitchen.kot.updated': {
      const { kot } = message.data;
      applyKot(client, kot);
      applyKotToOrder(client, kot);
      if (message.type !== 'kitchen.kot.updated') {
        void client.invalidateQueries({ queryKey: KITCHEN_KEYS.metrics }, NO_CANCEL);
      }
      return;
    }
    case 'kitchen.kot.delayed':
      useKdsFlags.getState().markDelayed(message.data.kotId);
      void client.invalidateQueries({ queryKey: KITCHEN_KEYS.metrics }, NO_CANCEL);
      return;
    case 'token.ready':
      markTokenReady(client, message.data.tokenNo);
      return;
    case 'billing.invoice.updated':
      applyInvoiceSummary(client, message.data.invoice);
      return;
    case 'menu.changed':
      void client.invalidateQueries({ queryKey: MENU_KEYS.snapshot }, NO_CANCEL);
      return;
    case 'floor.reservations.changed':
      refreshReservations(client);
      return;
    case 'floor.qr_requests.changed':
      void client.invalidateQueries({ queryKey: QR_REQUESTS_KEY }, NO_CANCEL);
      return;
  }
}

/** `resync`: too much was missed to replay; refetch everything live screens show. */
export function resyncAll(client: QueryClient): Promise<void> {
  return Promise.all(
    [
      FLOOR_KEY,
      RESERVATIONS_KEY,
      QR_REQUESTS_KEY,
      ORDER_KEYS.all,
      KITCHEN_KEYS.all,
      TOKENS_KEY,
      MENU_KEYS.snapshot,
      BILLING_KEYS.all,
    ].map((queryKey) => client.invalidateQueries({ queryKey })),
  ).then(() => undefined);
}
