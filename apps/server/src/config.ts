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
  /** Mark the session cookie Secure. Turn on once devices reach the Hub over HTTPS. */
  RESTRO_SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Rollout waves offered by first-time setup, e.g. "1" or "1,2" (docs/08 State rollout). */
  RESTRO_ROLLOUT_WAVES: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .default('1')
    .transform((v) => v.split(',').map(Number)),
  RESTRO_TIMEZONE: z.string().default('Asia/Kolkata'),
  /** Fixed setup code, for the desktop shell to display. Random when unset. */
  RESTRO_SETUP_CODE: z.string().min(6).max(32).optional(),
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
  readonly secureCookies: boolean;
  readonly rolloutWaves: readonly number[];
  readonly timeZone: string;
  readonly setupCode: string | undefined;
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
    secureCookies: e.RESTRO_SECURE_COOKIES,
    rolloutWaves: e.RESTRO_ROLLOUT_WAVES,
    timeZone: e.RESTRO_TIMEZONE,
    setupCode: e.RESTRO_SETUP_CODE,
    version: process.env['npm_package_version'] ?? '0.0.0',
  };
}
