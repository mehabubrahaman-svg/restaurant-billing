import type { PersistedEvent } from '@restroos/application';
import type { Cradle } from '../container';

const CATALOG = new Set(['MenuItem', 'Category', 'AddonGroup']);
/** Menu edits come in bursts (an import, a price list): push once they settle. */
export const MENU_PUSH_DELAY_MS = 5_000;

/**
 * Turns committed events into messages for the relay: the menu when it
 * changes, an item's availability when it is turned off or on, and an
 * aggregator order's status when it is ready or cancelled by staff.
 */
export function startRelayFeeds(
  cradle: Pick<Cradle, 'eventBus' | 'relayIntegrationService' | 'relayClient' | 'logger'>,
): () => void {
  const service = cradle.relayIntegrationService;
  const menuTimers = new Map<string, NodeJS.Timeout>();

  const handle = (event: PersistedEvent) => {
    const branchId = event.branchId;
    if (!service.link(branchId)?.isEnabled) return;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.type === 'MenuItemAvailabilityChanged') {
      service.queue(branchId, 'availability', {
        items: [{ menuItemId: event.aggregateId, available: payload['isAvailable'] === true }],
      });
    } else if (CATALOG.has(event.aggregateType)) {
      clearTimeout(menuTimers.get(branchId));
      const timer = setTimeout(() => {
        menuTimers.delete(branchId);
        try {
          service.queue(branchId, 'menu', service.menu(branchId));
          cradle.relayClient.flush();
        } catch (error) {
          cradle.logger.error({ err: error }, 'menu push for the relay failed');
        }
      }, MENU_PUSH_DELAY_MS);
      timer.unref();
      menuTimers.set(branchId, timer);
      return;
    } else if (event.type === 'KotStatusChanged' && payload['to'] === 'READY') {
      service.notifyOrder(branchId, String(payload['orderId']), 'READY');
    } else if (
      event.type === 'OrderCancelled' &&
      !event.metadata.correlationId.startsWith('relay:')
    ) {
      // A cancellation that came from the platform needs no answer.
      service.notifyOrder(branchId, event.aggregateId, 'CANCELLED');
    } else {
      return;
    }
    cradle.relayClient.flush();
  };

  const unsubscribe = cradle.eventBus.subscribe('*', (event) => {
    try {
      handle(event);
    } catch (error) {
      cradle.logger.error({ err: error, event: event.type }, 'relay feed failed');
    }
  });
  return () => {
    unsubscribe();
    for (const timer of menuTimers.values()) clearTimeout(timer);
    menuTimers.clear();
  };
}
