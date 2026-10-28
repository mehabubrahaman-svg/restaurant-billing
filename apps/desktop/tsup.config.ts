import { defineConfig } from 'tsup';

// Electron's main process and the preload script, as CommonJS (a sandboxed preload must be).
export default defineConfig({
  entry: { main: 'src/main/main.ts', preload: 'src/preload/preload.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  sourcemap: true,
  external: ['electron', 'electron-updater'],
});
