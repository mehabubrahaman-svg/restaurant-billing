import { PERMISSIONS } from '@restroos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

let t: TestDatabase;
afterEach(() => t.close());

describe('permission catalogue', () => {
  it('matches between the domain and the database seed', () => {
    t = createTestDatabase({ seed: false });
    const seeded = t.db.prepare('SELECT code FROM permissions ORDER BY code').pluck().all();
    expect(seeded).toEqual([...PERMISSIONS].sort());
  });
});
