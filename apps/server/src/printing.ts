import type { RasterRenderer } from '@restroos/application';
import {
  ChromiumRasterRenderer,
  fontsourceFiles,
  type ScriptExecutor,
} from '@restroos/infrastructure';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Logger } from 'pino';
import { desktopBridge } from './desktop-bridge';

/** Where the bundled Noto fonts are: RESTRO_FONTS_DIR, else the web app's @fontsource packages. */
export function findFontsDir(configured: string | undefined): string | null {
  const candidates = configured
    ? [configured]
    : [
        resolve('node_modules/@fontsource'),
        resolve('../web/node_modules/@fontsource'),
        resolve('apps/web/node_modules/@fontsource'),
      ];
  return candidates.find((dir) => existsSync(join(dir, 'noto-sans-bengali'))) ?? null;
}

/**
 * The Hub's image renderer for Hindi/Bengali slips. The desktop app passes
 * an executor for its offscreen window; a headless Hub uses Playwright's
 * Chromium if installed. Without either, slips print in English text mode.
 */
export function rasterRenderer(
  options: { mode: 'auto' | 'off'; fontsDir: string | null; executor?: ScriptExecutor | undefined },
  logger: Logger,
): RasterRenderer | null {
  if (options.mode === 'off' || !options.fontsDir) return null;
  const executor = options.executor ?? desktopExecutor() ?? playwrightExecutor(logger);
  return executor ? new ChromiumRasterRenderer(executor, fontsourceFiles(options.fontsDir)) : null;
}

/** Inside the desktop app: its offscreen Chromium window renders the slip. */
function desktopExecutor(): ScriptExecutor | undefined {
  const bridge = desktopBridge();
  if (!bridge) return undefined;
  let next = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  bridge.onMessage((message) => {
    if (message.type !== 'raster-result') return;
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error !== undefined) call?.reject(new Error(message.error));
    else call?.resolve(message.result);
  });
  return (script) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      bridge.send({ type: 'raster', id, script });
      setTimeout(() => {
        if (pending.delete(id))
          reject(new Error('the desktop app did not render the slip in time'));
      }, 15_000).unref();
    });
}

function playwrightExecutor(logger: Logger): ScriptExecutor | undefined {
  let playwright: {
    chromium: {
      launch(): Promise<{ newPage(): Promise<{ evaluate(s: string): Promise<unknown> }> }>;
    };
  };
  try {
    const name = 'playwright'; // not bundled: optional at runtime
    playwright = createRequire(import.meta.url)(name) as typeof playwright;
  } catch {
    logger.info('no Chromium for printing Hindi/Bengali slips; they will print in English');
    return undefined;
  }
  let page: Promise<{ evaluate(s: string): Promise<unknown> }> | undefined;
  return async (script) => {
    page ??= playwright.chromium.launch().then((b) => b.newPage());
    return (await page).evaluate(script);
  };
}
