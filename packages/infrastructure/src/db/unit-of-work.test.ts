import type { CommandContext, PersistedEvent } from '@restroos/application';
import { AggregateRoot } from '@restroos/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAuditChain } from '../audit/audit-chain';
import { InProcessEventBus } from '../events/in-process-event-bus';
import { FixedClock } from '../system/system-clock';
import { uuidv7Generator } from '../system/uuidv7-generator';
import {
  createTestDatabase,
  TEST_BRANCH_ID,
  TEST_USER_ID,
  type TestDatabase,
} from '../testing/test-database';
import { openDatabase } from './connection';
import { SqliteUnitOfWork } from './unit-of-work';

class Tab extends AggregateRoot {
  readonly aggregateType = 'Tab';
  static open(id: string): Tab {
    const tab = new Tab(id, 0);
    tab.raise('TabOpened', { id }, new Date('2026-10-28T12:00:00Z'));
    return tab;
  }
}

const context: CommandContext = {
  branchId: TEST_BRANCH_ID,
  actorId: TEST_USER_ID,
  deviceId: 'pos-1',
  correlationId: 'req-1',
};

let t: TestDatabase;
let bus: InProcessEventBus;
let uow: SqliteUnitOfWork;
const count = (table: string) => t.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

beforeEach(() => {
  t = createTestDatabase();
  bus = new InProcessEventBus({ error: vi.fn() });
  uow = new SqliteUnitOfWork({
    db: t.db,
    clock: new FixedClock(new Date('2026-10-28T12:00:00Z')),
    ids: uuidv7Generator,
    eventBus: bus,
  });
});
afterEach(() => t.close());

describe('SqliteUnitOfWork', () => {
  it('commits events, the sync outbox and audit rows together', () => {
    const published: PersistedEvent[] = [];
    bus.subscribe('*', (e) => void published.push(e));

    const result = uow.run(context, (scope) => {
      const tab = Tab.open('tab-1');
      scope.recordEvents(tab.pullEvents());
      scope.audit({
        action: 'tab.open',
        entityType: 'Tab',
        entityId: 'tab-1',
        after: { status: 'OPEN' },
      });
      return 'done';
    });

    expect(result).toBe('done');
    expect(count('domain_events')).toBe(1);
    expect(count('sync_queue')).toBe(1);
    expect(count('audit_logs')).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: 'TabOpened',
      aggregateId: 'tab-1',
      aggregateVersion: 1,
      branchId: TEST_BRANCH_ID,
      metadata: { actorId: TEST_USER_ID, deviceId: 'pos-1', correlationId: 'req-1' },
    });
    const outbox = t.db.prepare('SELECT event_seq, status FROM sync_queue').get();
    expect(outbox).toEqual({ event_seq: published[0]!.seq, status: 'PENDING' });
  });

  it('rolls everything back and publishes nothing when the work throws', () => {
    const handler = vi.fn();
    bus.subscribe('*', handler);
    expect(() =>
      uow.run(context, (scope) => {
        scope.recordEvents(Tab.open('tab-1').pullEvents());
        scope.audit({ action: 'tab.open', entityType: 'Tab', entityId: 'tab-1' });
        t.db.prepare("UPDATE branches SET name = 'changed'").run();
        throw new Error('invariant violated');
      }),
    ).toThrow('invariant violated');

    expect(count('domain_events')).toBe(0);
    expect(count('audit_logs')).toBe(0);
    expect(t.db.prepare('SELECT name FROM branches').pluck().get()).toBe('Park Street');
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects asynchronous work and rolls it back', () => {
    expect(() =>
      uow.run(context, (scope) => {
        scope.audit({ action: 'x', entityType: 'X', entityId: '1' });
        return Promise.resolve();
      }),
    ).toThrow(/must be synchronous/);
    expect(count('audit_logs')).toBe(0);
  });

  it('a failing event handler does not undo the committed command', () => {
    bus.subscribe('TabOpened', () => {
      throw new Error('printer offline');
    });
    uow.run(context, (scope) => scope.recordEvents(Tab.open('tab-1').pullEvents()));
    expect(count('domain_events')).toBe(1);
  });

  it('chains audit hashes across commands, and detects tampering', () => {
    for (const id of ['a', 'b', 'c']) {
      uow.run(context, (scope) =>
        scope.audit({ action: 'tab.open', entityType: 'Tab', entityId: id }),
      );
    }
    expect(verifyAuditChain(t.db)).toEqual({ ok: true, rows: 3 });

    // Someone with raw DB access drops the guard and edits history.
    t.db.exec('DROP TRIGGER trg_audit_logs_no_update');
    t.db.prepare("UPDATE audit_logs SET entity_id = 'z' WHERE entity_id = 'b'").run();
    expect(verifyAuditChain(t.db)).toMatchObject({ ok: false, rows: 2 });
  });

  it('takes the write lock up front: a second writer waits, then fails on timeout', () => {
    const other = openDatabase({ path: t.path, key: t.key, busyTimeoutMs: 50 });
    const otherUow = new SqliteUnitOfWork({
      db: other,
      clock: new FixedClock(new Date()),
      ids: uuidv7Generator,
      eventBus: bus,
    });
    t.db.prepare('BEGIN IMMEDIATE').run();
    try {
      expect(() => otherUow.run(context, () => 1)).toThrow(/locked|busy/i);
    } finally {
      t.db.prepare('COMMIT').run();
    }
    expect(otherUow.run(context, () => 2)).toBe(2);
    other.close();
  });
});
