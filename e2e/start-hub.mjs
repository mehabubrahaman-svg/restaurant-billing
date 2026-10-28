// Starts a brand-new Hub for the end-to-end run: the built server
// (apps/server/dist) serving the built web app (apps/web/dist), with an empty
// encrypted database in e2e/.hub-data. Playwright stops it afterwards.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const server = join(root, 'apps', 'server', 'dist', 'main.js');
const web = join(root, 'apps', 'web', 'dist');
for (const [path, hint] of [
  [server, 'pnpm --filter @restroos/server build'],
  [join(web, 'index.html'), 'pnpm --filter @restroos/web build'],
]) {
  if (!existsSync(path)) {
    console.error(`${path} is missing: run ${hint}`);
    process.exit(1);
  }
}
const data = join(here, '.hub-data');
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });

const hub = spawn(process.execPath, [server], {
  cwd: join(root, 'apps', 'server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    RESTRO_DATA_DIR: data,
    RESTRO_DB_KEY: 'e2e-only-database-key-0001',
    RESTRO_PORT: process.env.E2E_PORT ?? '7710',
    RESTRO_HTTPS_PORT: '0',
    RESTRO_HOST: '127.0.0.1',
    RESTRO_WEB_DIST: web,
    RESTRO_SETUP_CODE: 'E2E00001',
    RESTRO_MDNS: 'false',
    RESTRO_RASTER: 'off',
    RESTRO_BACKUPS: 'off',
    RESTRO_RATE_LIMIT_PER_MINUTE: '100000',
    RESTRO_LOG_LEVEL: 'warn',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.kill(signal));
hub.on('exit', (code) => process.exit(code ?? 0));
