import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates `database/migrations` by walking up from this file. Packaged builds
 * pass an explicit directory instead.
 */
export function findMigrationsDir(from: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from);
  for (;;) {
    const candidate = join(dir, 'database', 'migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('database/migrations not found; set RESTRO_MIGRATIONS_DIR');
    dir = parent;
  }
}
