import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../system/system-clock';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { SqliteIdempotencyStore } from './sqlite-idempotency-store';

let t: TestDatabase;
beforeEach(() => (t = createTestDatabase()));
afterEach(() => t.close());

describe('SqliteIdempotencyStore', () => {
  it('returns the stored response until it expires, then purges it', () => {
    const clock = new FixedClock(new Date('2026-10-28T12:00:00Z'));
    const store = new SqliteIdempotencyStore(t.db, clock, 60_000);
    const response = { requestHash: 'h', statusCode: 201, body: '{"id":"o1"}' };

    store.save('device-1', 'key-1', response);
    expect(store.find('device-1', 'key-1')).toEqual(response);
    expect(store.find('device-2', 'key-1')).toBeUndefined();

    store.save('device-1', 'key-1', { ...response, body: 'second write ignored' });
    expect(store.find('device-1', 'key-1')?.body).toBe('{"id":"o1"}');

    clock.advance(60_001);
    expect(store.find('device-1', 'key-1')).toBeUndefined();
    expect(store.purgeExpired()).toBe(1);
  });
});
