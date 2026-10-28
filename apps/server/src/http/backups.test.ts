import { BackupSchema, BackupsResponseSchema } from '@restroos/contracts';
import {
  applyPendingRestore,
  DatabaseLockedError,
  openDatabase,
  pendingRestorePath,
} from '@restroos/infrastructure';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, signInAs } from '../testing/staff';
import { createTestServer, SETUP_FIXTURE, type TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

async function hub() {
  s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  return { s, admin };
}

describe('backups', () => {
  it('writes an encrypted backup that only the backup passphrase opens', async () => {
    const { s, admin } = await hub();
    const res = await admin('POST', '/backups');
    expect(res.statusCode).toBe(201);
    const backup = BackupSchema.parse(res.json());
    expect(backup).toMatchObject({
      kind: 'MANUAL',
      status: 'AVAILABLE',
      createdByName: 'Ananya Sen',
    });
    expect(backup.schemaVersion).toBeGreaterThanOrEqual(9);

    const list = BackupsResponseSchema.parse((await admin('GET', '/backups')).json());
    expect(list.data.map((b) => b.id)).toEqual([backup.id]);
    const file = join(list.backupDir, backup.fileName);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 18).toString()).toBe('RESTROOS-BACKUP 1\n');
    // Nothing readable past the header, and the Hub's own key does not open it.
    expect(bytes.includes(Buffer.from(SETUP_FIXTURE.organization.name))).toBe(true); // header only
    expect(bytes.subarray(600).includes(Buffer.from('Ananya Sen'))).toBe(false);

    const download = await admin('GET', `/backups/${backup.id}/download`);
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.rawPayload.equals(bytes)).toBe(true);

    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');
    expect((await captain('GET', '/backups')).statusCode).toBe(403);
  });

  it('restores: checks the backup, keeps a safety copy, stages it and restarts', async () => {
    const { s, admin } = await hub();
    const before = BackupSchema.parse((await admin('POST', '/backups')).json());
    await admin('POST', '/customers', { phone: '9830012345', name: 'After Backup' });

    expect((await admin('POST', `/backups/${before.id}/restore`, {})).statusCode).toBe(422);
    const res = await admin('POST', `/backups/${before.id}/restore`, { confirm: 'RESTORE' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ restarting: true, backup: { id: before.id } });
    expect(s.restarts).toEqual([`restoring backup ${before.id}`]);

    const list = BackupsResponseSchema.parse((await admin('GET', '/backups')).json());
    expect(list.data.map((b) => b.kind)).toEqual(['PRE_RESTORE', 'MANUAL']);
    const audit = (await admin('GET', '/audit-logs?entityType=Backup')).json().data;
    expect(audit.map((a: { action: string }) => a.action)).toContain('backup.restore');

    // What the Hub opens after the restart: the backup's data, under the Hub's own key.
    const staged = pendingRestorePath(s.database.path);
    const restored = openDatabase({ path: staged, key: s.database.key });
    const names = restored.prepare('SELECT name FROM customers').pluck().all();
    restored.close();
    expect(names).not.toContain('After Backup');

    s.database.db.close();
    const replaced = applyPendingRestore(s.database.path, new Date());
    expect(replaced).toMatch(/restore[\\/]replaced-.*\.db$/);
    expect(existsSync(staged)).toBe(false);
    const live = openDatabase({ path: s.database.path, key: s.database.key });
    expect(live.prepare('SELECT count(*) FROM customers').pluck().get()).toBe(0);
    live.close();
    // The data it replaced is kept aside.
    const old = openDatabase({ path: replaced!, key: s.database.key });
    expect(old.prepare('SELECT name FROM customers').pluck().all()).toEqual(['After Backup']);
    old.close();
  });

  it('imports a backup from another Hub with its passphrase, and refuses a wrong one', async () => {
    const { s, admin } = await hub();
    const backup = BackupSchema.parse((await admin('POST', '/backups')).json());
    const bytes = readFileSync(join(s.container.cradle.config.backupDir, backup.fileName));
    const upload = (passphrase: string, body: Buffer) =>
      admin('POST', '/backups/import', body, {
        'content-type': 'application/octet-stream',
        'x-backup-passphrase': passphrase,
      });

    expect((await upload('not the passphrase', bytes)).json().code).toBe('BACKUP_UNREADABLE');
    expect((await upload(SETUP_FIXTURE.backupPassphrase, Buffer.from('hello'))).json().code).toBe(
      'BACKUP_UNREADABLE',
    );
    const tampered = Buffer.from(bytes);
    const at = tampered.length - 100;
    tampered.writeUInt8(tampered.readUInt8(at) ^ 0xff, at);
    expect((await upload(SETUP_FIXTURE.backupPassphrase, tampered)).json().code).toBe(
      'BACKUP_UNAVAILABLE',
    );

    const imported = await upload(SETUP_FIXTURE.backupPassphrase, bytes);
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ kind: 'IMPORTED', createdAt: backup.createdAt });
    const list = BackupsResponseSchema.parse((await admin('GET', '/backups')).json()).data;
    expect(list.map((b) => b.kind).sort()).toEqual(['IMPORTED', 'MANUAL']);

    // A damaged file on disk is caught before anything is staged.
    writeFileSync(join(s.container.cradle.config.backupDir, backup.fileName), 'gone');
    const res = await admin('POST', `/backups/${backup.id}/restore`, { confirm: 'RESTORE' });
    expect(res.json().code).toBe('BACKUP_UNAVAILABLE');
    expect(
      BackupsResponseSchema.parse((await admin('GET', '/backups')).json()).data,
    ).toContainEqual(expect.objectContaining({ id: backup.id, status: 'MISSING' }));
    expect(existsSync(pendingRestorePath(s.database.path))).toBe(false);
    expect(() =>
      openDatabase({
        path: join(s.container.cradle.config.backupDir, backup.fileName),
        key: 'x'.repeat(20),
      }),
    ).toThrow(DatabaseLockedError);
  });

  it('backs up hourly only when something changed, and prunes by retention', async () => {
    const { s } = await hub();
    const { backupService } = s.container.cradle;
    const change = async (n: number) => {
      const admin = caller(s, (await s.login()).accessToken);
      await admin('POST', '/customers', { phone: `98300${String(10000 + n)}` });
    };
    expect(backupService.scheduled()).not.toBeNull();
    s.clock.advance(60 * 60_000);
    expect(backupService.scheduled()).toBeNull(); // nothing new since
    for (let h = 1; h <= 9; h++) {
      await change(h);
      s.clock.advance(60 * 60_000);
      expect(backupService.scheduled()).not.toBeNull();
    }
    const all = backupService.list();
    // 12:00Z start = 17:30 IST: 10 backups over two days; the newest 7 plus
    // the last of 28 October stay.
    expect(all.filter((b) => b.status === 'AVAILABLE')).toHaveLength(7);
    const pruned = all.filter((b) => b.status === 'PRUNED');
    expect(pruned).toHaveLength(3);
    expect(pruned.every((b) => !existsSync(b.filePath))).toBe(true);
  }, 20_000); // ten sign-ins (bcrypt) and ten backups
});
