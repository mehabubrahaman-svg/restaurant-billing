import {
  findMigrationsDir,
  migrate,
  openDatabase,
  snapshotDatabase,
  systemClock,
  uuidv7Generator,
  type SqliteDatabase,
} from '@restroos/infrastructure';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { loadConfig } from './config';
import { buildContainer } from './container';
import { buildApp } from './http/app';
import { checkAuditChain } from './jobs/audit-chain-check';
import { scheduleDaily } from './jobs/daily';
import { SetupCode } from './setup-code';

async function main() {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
    ...(config.env === 'development' && { transport: { target: 'pino-pretty' } }),
  });

  mkdirSync(join(config.dataDir, 'backups'), { recursive: true });
  const db = openDatabase({ path: config.databasePath, key: config.databaseKey });

  let preMigrationBackup: string | undefined;
  const applied = migrate(db, {
    migrationsDir: config.migrationsDir ?? findMigrationsDir(),
    beforeMigrate: (pending) => {
      const stamp = systemClock.now().toISOString().replaceAll(':', '-');
      preMigrationBackup = join(config.dataDir, 'backups', `pre-migration-${stamp}.db`);
      logger.info(
        { pending: pending.map((m) => m.version), backup: preMigrationBackup },
        'backing up before migration',
      );
      snapshotDatabase(db, preMigrationBackup);
    },
  });
  if (applied.length > 0)
    logger.info({ applied: applied.map((m) => `${m.version}_${m.name}`) }, 'migrations applied');
  if (preMigrationBackup) recordBackup(db, preMigrationBackup);

  const container = buildContainer(config, logger, db);
  const setupCode = new SetupCode(logger, config.setupCode);
  if (container.cradle.setupService.needsSetup()) setupCode.announce();
  const app = await buildApp(container, { setupCode });

  const auditCheck = scheduleDaily(
    '03:30',
    config.timeZone,
    container.cradle.clock,
    () => void checkAuditChain(container.cradle),
    (error) => logger.error({ err: error }, 'audit chain check failed to run'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    auditCheck.stop();
    await app.close();
    await container.dispose();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

function recordBackup(db: SqliteDatabase, path: string) {
  db.prepare(
    `INSERT INTO backups (id, file_path, size_bytes, sha256, is_encrypted, kind, created_at)
     VALUES (?, ?, ?, ?, 1, 'PRE_MIGRATION', ?)`,
  ).run(
    uuidv7Generator.next(),
    path,
    statSync(path).size,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
    systemClock.now().toISOString(),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
