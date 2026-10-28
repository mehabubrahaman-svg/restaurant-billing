import type { Clock } from '@restroos/application';

export const systemClock: Clock = { now: () => new Date() };

/** A clock tests can set and advance. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
