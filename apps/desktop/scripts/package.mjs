// Builds the Hub installers: Windows NSIS on Windows, AppImage + deb on Linux.
//
//   pnpm --filter @restroos/web build && pnpm --filter @restroos/desktop package [--publish]
//   (--stage-only stops before electron-builder, to check the staged app)
//
// electron-builder downloads Electron and its packaging tools from GitHub on
// first use, and must run on the target OS (the native SQLite module is
// rebuilt for Electron there). The CI workflow .github/workflows/desktop.yml
// does this for both platforms.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktop, '..', '..');
const stage = join(desktop, 'stage');
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

const need = (path, hint) => {
  if (!existsSync(path)) throw new Error(`${path} is missing: ${hint}`);
};
need(join(desktop, 'dist', 'main.cjs'), 'run pnpm --filter @restroos/desktop build');
need(join(desktop, 'server-bundle', 'hub-server.mjs'), 'run pnpm --filter @restroos/desktop build');
need(join(root, 'apps', 'web', 'dist', 'index.html'), 'run pnpm --filter @restroos/web build');

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(desktop, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(desktop, 'build'), join(stage, 'build'), { recursive: true });
cpSync(join(desktop, 'server-bundle'), join(stage, 'server-bundle'), { recursive: true });
cpSync(join(desktop, 'electron-builder.yml'), join(stage, 'electron-builder.yml'));
cpSync(join(root, 'apps', 'web', 'dist'), join(stage, 'resources', 'web'), { recursive: true });
cpSync(join(root, 'database', 'migrations'), join(stage, 'resources', 'migrations'), {
  recursive: true,
});
// Only the Noto font files the raster printer uses.
const fontsource = join(root, 'apps', 'web', 'node_modules', '@fontsource');
for (const [name, subset] of [
  ['noto-sans', 'latin'],
  ['noto-sans-devanagari', 'devanagari'],
  ['noto-sans-bengali', 'bengali'],
]) {
  for (const weight of [400, 700]) {
    const file = `${name}-${subset}-${weight}-normal.woff2`;
    const from = join(fontsource, name, 'files', file);
    need(from, 'install the web app dependencies');
    mkdirSync(join(stage, 'resources', 'fonts', name, 'files'), { recursive: true });
    cpSync(from, join(stage, 'resources', 'fonts', name, 'files', file));
  }
}

writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'restroos-hub',
      productName: 'RestroOS Hub',
      version: pkg.version,
      description: pkg.description,
      homepage: 'https://restroos.app',
      author: { name: 'RestroOS', email: 'support@restroos.app' },
      main: pkg.main,
      dependencies: pkg.dependencies,
      devDependencies: {
        electron: pkg.devDependencies.electron,
        'electron-builder': pkg.devDependencies['electron-builder'],
      },
    },
    null,
    2,
  )}\n`,
);

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock']);
if (process.argv.includes('--stage-only')) {
  console.log(`staged in ${stage}`);
  process.exit(0);
}
run('npx', [
  'electron-builder',
  '--publish',
  process.argv.includes('--publish') ? 'always' : 'never',
]);
console.log(`installers in ${join(desktop, 'release')}`);
