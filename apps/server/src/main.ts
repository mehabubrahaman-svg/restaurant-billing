import {
  advertiseHub,
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
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { hostname } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { loadConfig } from './config';
import { buildContainer } from './container';
import { buildApp } from './http/app';
import { checkAuditChain } from './jobs/audit-chain-check';
import { scheduleDaily } from './jobs/daily';
import { SetupCode } from './setup-code';
import { WsGateway } from './ws/gateway';

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

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    auditCheck.stop();
    clearInterval(addressWatch);
    gateway.close();
    await mdns?.stop();
    https?.close();
    await app.close();
    await container.dispose();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
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
