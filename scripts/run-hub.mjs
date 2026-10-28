#!/usr/bin/env node
// Runs the Hub from a source checkout, without the desktop app:
//
//   pnpm install && pnpm build && pnpm hub
//
// Data goes to ./data (override with --data <dir> or RESTRO_DATA_DIR). On the
// first run a random database key is written to <data>/db.key, readable only
// by you; keep it with the data. The desktop app seals this key with the OS
// keychain instead. Any RESTRO_* variable you set is passed through
// (see apps/server/src/config.ts), e.g. RESTRO_PORT=8080 pnpm hub.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flag = process.argv.indexOf('--data');
const data = resolve(
  flag > 0 ? process.argv[flag + 1] : (process.env.RESTRO_DATA_DIR ?? join(root, 'data')),
);
const server = join(root, 'apps', 'server', 'dist', 'main.js');
const web = join(root, 'apps', 'web', 'dist');
if (!existsSync(server) || !existsSync(join(web, 'index.html'))) {
  console.error('The Hub is not built yet. Run: pnpm install && pnpm build');
  process.exit(1);
}

mkdirSync(data, { recursive: true });
const keyFile = join(data, 'db.key');
if (!process.env.RESTRO_DB_KEY && !process.env.RESTRO_DB_KEY_FILE) {
  if (!existsSync(keyFile)) {
    if (existsSync(join(data, 'restro.db'))) {
      console.error(`${data} has a database but no db.key; set RESTRO_DB_KEY to its key.`);
      process.exit(1);
    }
    writeFileSync(keyFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
    console.log(`Created the database key ${keyFile}. Keep it with the data.`);
  }
  readFileSync(keyFile); // fail early if it can't be read
}

const env = {
  NODE_ENV: 'production',
  RESTRO_DATA_DIR: data,
  RESTRO_WEB_DIST: web,
  RESTRO_MIGRATIONS_DIR: join(root, 'database', 'migrations'),
  RESTRO_FONTS_DIR: join(root, 'apps', 'web', 'node_modules', '@fontsource'),
  ...(process.env.RESTRO_DB_KEY || process.env.RESTRO_DB_KEY_FILE
    ? {}
    : { RESTRO_DB_KEY_FILE: keyFile }),
  ...process.env,
};
const port = env.RESTRO_PORT ?? '7400';
const lan = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === 'IPv4' && !a.internal)
  .map((a) => `http://${a.address}:${port}`);
console.log(`Starting the RestroOS Hub. Open http://localhost:${port} on this PC`);
if (lan.length > 0) console.log(`Other devices on the network: ${lan.join('  ')}`);
console.log('Stop it with Ctrl+C.\n');

const hub = spawn(process.execPath, [server], {
  cwd: join(root, 'apps', 'server'),
  stdio: 'inherit',
  env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => hub.kill(signal));
// Exit 75 asks for a restart (a backup restore was staged): start it again.
hub.on('exit', (code) => {
  if (code === 75) {
    console.log('\nRestarting the Hub to finish the restore…\n');
    spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: process.env }).on(
      'exit',
      (c) => process.exit(c ?? 0),
    );
  } else process.exit(code ?? 0);
});
