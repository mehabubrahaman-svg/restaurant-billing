// Applies every SQL migration to a fresh in-memory database and checks that
// all foreign keys point at existing tables. Runs in CI.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3-multiple-ciphers';

const dir = fileURLToPath(new URL('../database/migrations/', import.meta.url));
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  db.exec(readFileSync(join(dir, file), 'utf8'));
}
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .pluck()
  .all();
const names = new Set(tables);
for (const t of tables) {
  for (const fk of db.pragma(`foreign_key_list(${t})`)) {
    if (!names.has(fk.table)) throw new Error(`${t} references missing table ${fk.table}`);
  }
}
console.log(`migrations ok: ${tables.length} tables`);
