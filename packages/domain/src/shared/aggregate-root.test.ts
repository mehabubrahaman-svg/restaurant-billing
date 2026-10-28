import { describe, expect, it } from 'vitest';
import { AggregateRoot } from './aggregate-root';

class Counter extends AggregateRoot {
  readonly aggregateType = 'Counter';
  value = 0;

  static load(id: string, version: number): Counter {
    return new Counter(id, version);
  }

  increment(at: Date): void {
    this.value += 1;
    this.raise('CounterIncremented', { value: this.value }, at);
  }
}

describe('AggregateRoot', () => {
  it('bumps the version and records an event per change', () => {
    const counter = Counter.load('c1', 3);
    const at = new Date('2026-10-28T10:00:00Z');
    counter.increment(at);
    counter.increment(at);

    expect(counter.version).toBe(5);
    expect(counter.persistedVersion).toBe(3);
    const events = counter.pullEvents();
    expect(events.map((e) => [e.type, e.aggregateVersion])).toEqual([
      ['CounterIncremented', 4],
      ['CounterIncremented', 5],
    ]);
    expect(events[0]).toMatchObject({
      aggregateType: 'Counter',
      aggregateId: 'c1',
      payload: { value: 1 },
    });
    expect(counter.pullEvents()).toEqual([]);
  });

  it('tracks the persisted version after a save', () => {
    const counter = Counter.load('c1', 0);
    counter.increment(new Date());
    counter.markPersisted();
    expect(counter.persistedVersion).toBe(1);
  });
});
