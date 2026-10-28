import { defineConfig } from 'tsup';

/**
 * The Hub server as one file for the desktop app (apps/desktop): every
 * dependency bundled except the native SQLite module, which electron-builder
 * rebuilds for Electron, and Playwright, which the desktop app replaces with
 * its own offscreen window.
 */
export default defineConfig({
  entry: { 'hub-server': 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: '../desktop/server-bundle',
  clean: true,
  sourcemap: true,
  // noExternal wins over external in tsup, so the exceptions live in the pattern.
  noExternal: [/^(?!better-sqlite3-multiple-ciphers|playwright|pino-pretty)/],
  external: ['better-sqlite3-multiple-ciphers', 'playwright', 'pino-pretty'],
  outExtension: () => ({ js: '.mjs' }),
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
