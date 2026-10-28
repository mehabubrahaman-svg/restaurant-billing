import type { EventBus, EventHandler, PersistedEvent } from '@restroos/application';

export interface EventBusLogger {
  error(details: object, message: string): void;
}

/**
 * Synchronous fan-out to subscribers. A failing handler is logged and never
 * affects the command that produced the event (it has already committed) or
 * other handlers.
 */
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly logger: EventBusLogger) {}

  subscribe(eventType: string, handler: EventHandler): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  publish(events: readonly PersistedEvent[]): void {
    for (const event of events) {
      const targets = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])];
      for (const handler of targets) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch((error: unknown) => this.report(event, error));
          }
        } catch (error) {
          this.report(event, error);
        }
      }
    }
  }

  private report(event: PersistedEvent, error: unknown): void {
    this.logger.error(
      { err: error, eventType: event.type, eventId: event.id },
      'event handler failed',
    );
  }
}
