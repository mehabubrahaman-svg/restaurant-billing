import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  RESTRO_HOST: z.string().default('0.0.0.0'),
  RESTRO_PORT: z.coerce.number().int().min(1).max(65535).default(7400),
  RESTRO_DATA_DIR: z.string().default('./data'),
  /** Database encryption key. In production the desktop shell supplies it from the OS keychain. */
  RESTRO_DB_KEY: z.string().min(16).optional(),
  RESTRO_DB_KEY_FILE: z.string().optional(),
  RESTRO_MIGRATIONS_DIR: z.string().optional(),
  /** Built web app to serve to tablets and PCs on the LAN. */
  RESTRO_WEB_DIST: z.string().optional(),
  RESTRO_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Requests per minute per client IP. Generous: a busy POS makes many small calls. */
  RESTRO_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1200),
});

export interface ServerConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly databaseKey: string;
  readonly migrationsDir: string | undefined;
  readonly webDist: string | undefined;
  readonly logLevel: string;
  readonly rateLimitPerMinute: number;
  readonly version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  const key =
    e.RESTRO_DB_KEY ?? (e.RESTRO_DB_KEY_FILE && readFileSync(e.RESTRO_DB_KEY_FILE, 'utf8').trim());
  if (!key || key.length < 16) {
    throw new Error(
      'a database key of at least 16 characters is required (RESTRO_DB_KEY or RESTRO_DB_KEY_FILE)',
    );
  }
  const dataDir = resolve(e.RESTRO_DATA_DIR);
  return {
    env: e.NODE_ENV,
    host: e.RESTRO_HOST,
    port: e.RESTRO_PORT,
    dataDir,
    databasePath: resolve(dataDir, 'restro.db'),
    databaseKey: key,
    migrationsDir: e.RESTRO_MIGRATIONS_DIR && resolve(e.RESTRO_MIGRATIONS_DIR),
    webDist: e.RESTRO_WEB_DIST && resolve(e.RESTRO_WEB_DIST),
    logLevel: e.RESTRO_LOG_LEVEL,
    rateLimitPerMinute: e.RESTRO_RATE_LIMIT_PER_MINUTE,
    version: process.env['npm_package_version'] ?? '0.0.0',
  };
}
