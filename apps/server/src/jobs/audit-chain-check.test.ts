import { afterEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from '../testing/test-server';
import { checkAuditChain } from './audit-chain-check';
import { localParts } from './daily';

let s: TestServer;
afterEach(async () => s?.close());

describe('nightly audit chain check', () => {
  it('passes on untouched history and raises a CRITICAL notification after tampering', async () => {
    s = await createTestServer();
    await s.login();
    const deps = { ...s.container.cradle };
    expect(checkAuditChain(deps)).toBe(true);

    s.database.db.exec('DROP TRIGGER trg_audit_logs_no_update');
    s.database.db
      .prepare("UPDATE audit_logs SET reason = 'nothing to see here' WHERE action = 'auth.login'")
      .run();
    expect(checkAuditChain(deps)).toBe(false);
    const alert = s.database.db
      .prepare('SELECT kind, severity, role_code FROM notifications')
      .get();
    expect(alert).toEqual({ kind: 'AUDIT_CHAIN_BROKEN', severity: 'CRITICAL', role_code: 'ADMIN' });
  });
});

describe('localParts', () => {
  it('uses the branch time zone', () => {
    expect(localParts(new Date('2026-10-28T22:15:00Z'), 'Asia/Kolkata')).toEqual({
      day: '2026-10-29',
      time: '03:45',
    });
  });
});
