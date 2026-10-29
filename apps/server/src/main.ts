import {
  advertiseHub,
  applyPendingRestore,
  FileBackupStore,
  findMigrationsDir,
  ScryptKeyDerivation,
  SqliteBackupRepository,
  migrate,
  openDatabase,
  snapshotDatabase,
  systemClock,
  uuidv7Generator,
  type SqliteDatabase,
} from '@restroos/infrastructure';
import { mkdirSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { hostname } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { loadConfig, type ServerConfig } from './config';
import { buildContainer } from './container';
import { desktopBridge } from './desktop-bridge';
import { buildApp } from './http/app';
import { checkAuditChain } from './jobs/audit-chain-check';
import { scheduleDaily } from './jobs/daily';
import { printKotsWhenFired } from './jobs/kot-printing';
import { SetupCode } from './setup-code';
import { WsGateway } from './ws/gateway';

async function main() {
  const config = loadConfig();
  const logger = pino({
    level: config.logLevel,
    ...(config.env === 'development' && { transport: { target: 'pino-pretty' } }),
  });

  mkdirSync(config.backupDir, { recursive: true });
  const replaced = applyPendingRestore(config.databasePath, systemClock.now());
  if (replaced) logger.warn({ replaced }, 'restored a backup; the previous data was kept aside');
  const db = openDatabase({ path: config.databasePath, key: config.databaseKey });

  let preMigration: (() => void) | undefined;
  const applied = migrate(db, {
    migrationsDir: config.migrationsDir ?? findMigrationsDir(),
    beforeMigrate: (pending) => {
      logger.info({ pending: pending.map((m) => m.version) }, 'backing up before migration');
      preMigration = preMigrationBackup(db, config);
    },
  });
  if (applied.length > 0)
    logger.info({ applied: applied.map((m) => `${m.version}_${m.name}`) }, 'migrations applied');
  preMigration?.();

  let shutdown: (signal: string, exitCode?: number) => Promise<void> = async () => {};
  const container = buildContainer(config, logger, db, {
    hubLifecycle: {
      // Exit with EX_TEMPFAIL once the response is out; the OS service or the
      // desktop shell starts the Hub again, which swaps in the restored data.
      requestRestart: (reason) => {
        logger.warn({ reason }, 'restarting the Hub');
        setTimeout(() => void shutdown('restart', 75), 500);
      },
    },
  });
  const { backupService } = container.cradle;
  const adopted = backupService.adoptUntracked();
  if (adopted > 0) logger.info({ adopted }, 'listed backup files the database did not know about');
  const backupJob = config.backups
    ? setInterval(() => {
        try {
          const made = backupService.scheduled();
          if (made) logger.info({ file: made.filePath, bytes: made.sizeBytes }, 'backup written');
        } catch (error) {
          logger.error({ err: error }, 'scheduled backup failed');
        }
      }, 60 * 60_000)
    : undefined;
  backupJob?.unref();
  // Scheduled reports: a file as soon as each day, week or month has ended.
  const runReports = () => {
    try {
      const { made, failed } = container.cradle.reportScheduleService.runDue();
      for (const file of made) logger.info({ file: file.fileName }, 'scheduled report made');
      for (const f of failed)
        logger.error({ schedule: f.scheduleId, err: f.error }, 'scheduled report failed');
    } catch (error) {
      logger.error({ err: error }, 'scheduled reports failed to run');
    }
  };
  const reportJob = setInterval(runReports, 15 * 60_000);
  reportJob.unref();
  const firstReports = setTimeout(runReports, 60_000);
  firstReports.unref();
  const setupCode = new SetupCode(logger, config.setupCode);
  if (container.cradle.setupService.needsSetup()) setupCode.announce();
  const app = await buildApp(container, { setupCode });

  const stopKotPrinting = printKotsWhenFired(container.cradle);
  const auditCheck = scheduleDaily(
    '03:30',
    config.timeZone,
    container.cradle.clock,
    () => void checkAuditChain(container.cradle),
    (error) => logger.error({ err: error }, 'audit chain check failed to run'),
  );

  await app.listen({ host: config.host, port: config.port });

  // HTTPS on a second port, same app: devices switch to it once they trust the Hub CA.
  const { hubNetwork } = container.cradle;
  let https: HttpsServer | undefined;
  if (config.httpsPort > 0) {
    const tls = () => ({ key: hubNetwork.tls.serverKeyPem, cert: hubNetwork.tls.serverCertPem });
    https = createHttpsServer(tls(), (req, res) => app.routing(req, res));
    await new Promise<void>((resolve, reject) => {
      https!.once('error', reject).listen(config.httpsPort, config.host, () => resolve());
    });
    logger.info(
      { port: config.httpsPort, caFingerprint: hubNetwork.tls.caFingerprint },
      'HTTPS listening',
    );
  }
  // Live updates on both listeners.
  const gateway = new WsGateway(container.cradle, logger);
  gateway.attach(app.server);
  if (https) gateway.attach(https);

  // A new DHCP lease changes the Hub's address; re-issue the certificate for it.
  const addressWatch = setInterval(() => {
    try {
      if (hubNetwork.refresh()) {
        https?.setSecureContext({
          key: hubNetwork.tls.serverKeyPem,
          cert: hubNetwork.tls.serverCertPem,
        });
        logger.info(
          { addresses: hubNetwork.addresses() },
          'LAN address changed; certificate re-issued',
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'certificate refresh failed');
    }
  }, 60_000);
  addressWatch.unref();

  const mdns = config.mdns
    ? advertiseHub({
        name: `RestroOS Hub (${hostname()})`,
        httpPort: config.port,
        httpsPort: config.httpsPort,
        caFingerprint: hubNetwork.tls.caFingerprint,
        onError: (error) =>
          logger.warn({ err: error }, 'mDNS advertising failed; use the pairing QR'),
      })
    : undefined;

  shutdown = async (signal: string, exitCode = 0) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(backupJob);
    clearInterval(reportJob);
    clearTimeout(firstReports);
    auditCheck.stop();
    stopKotPrinting();
    clearInterval(addressWatch);
    gateway.close();
    await mdns?.stop();
    https?.close();
    await app.close();
    await container.dispose();
    db.close();
    process.exit(exitCode);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  // Inside the desktop app: stop when it asks (Windows has no SIGTERM), and say when ready.
  const desktop = desktopBridge();
  desktop?.onMessage((message) => {
    if (message.type === 'shutdown') void shutdown('desktop');
  });
  desktop?.send({ type: 'ready', httpPort: config.port, httpsPort: config.httpsPort });
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * The encrypted backup taken before migrations run. Written now, recorded
 * once the migrations have brought the backups table up to date. Before
 * setup (no backup key yet) it falls back to a plain snapshot.
 */
function preMigrationBackup(db: SqliteDatabase, config: ServerConfig): () => void {
  const at = systemClock.now();
  const store = new FileBackupStore({
    db,
    databasePath: config.databasePath,
    databaseKey: config.databaseKey,
    backupDir: config.backupDir,
    copyDir: config.backupCopyDir,
    deriveKey: (passphrase, kdf) => new ScryptKeyDerivation().keyFor(passphrase, kdf),
  });
  try {
    const file = store.snapshot('PRE_MIGRATION', at);
    return () =>
      new SqliteBackupRepository(db).insert({
        ...file,
        id: uuidv7Generator.next(),
        kind: 'PRE_MIGRATION',
        createdAt: at,
        createdBy: null,
      });
  } catch {
    snapshotDatabase(db, join(config.backupDir, `pre-migration-${at.getTime()}.db`));
    return () => {};
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
