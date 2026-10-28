import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them; keep the native module external.
  noExternal: [/^@restroos\//],
  external: ['better-sqlite3-multiple-ciphers'],
});
