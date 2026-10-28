import type { HealthResponse } from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../container';

/** Liveness and readiness for devices, the connection pill and the desktop watchdog. No auth. */
export async function healthRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const schemaVersion = cradle.db
    .prepare<[], number>('SELECT coalesce(max(version), 0) FROM schema_migrations')
    .pluck();
  const ping = cradle.db.prepare('SELECT 1');

  app.get('/health', { config: { public: true } }, async (): Promise<HealthResponse> => {
    let ok = true;
    try {
      ping.get();
    } catch (error) {
      ok = false;
      app.log.error({ err: error }, 'database health check failed');
    }
    const now = cradle.clock.now();
    return {
      status: ok ? 'ok' : 'degraded',
      version: cradle.config.version,
      serverTime: now.toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((now.getTime() - cradle.startedAt.getTime()) / 1000)),
      database: { ok, schemaVersion: ok ? (schemaVersion.get() ?? 0) : 0 },
    };
  });
}
