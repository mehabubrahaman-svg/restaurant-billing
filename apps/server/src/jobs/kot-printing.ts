import type { Cradle } from '../container';

/**
 * Prints each KOT on its station's printer as soon as it's fired, after the
 * order's transaction has committed. A printer problem never blocks the
 * order: the KDS shows the ticket anyway, and it can be reprinted.
 */
export function printKotsWhenFired(
  cradle: Pick<Cradle, 'eventBus' | 'printService' | 'logger'>,
): () => void {
  return cradle.eventBus.subscribe('KotFired', async (event) => {
    try {
      await cradle.printService.printKot(event.aggregateId, event.branchId, false);
    } catch (error) {
      cradle.logger.warn({ err: error, kotId: event.aggregateId }, 'KOT not printed');
    }
  });
}
