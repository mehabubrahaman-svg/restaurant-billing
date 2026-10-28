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
  const executor = options.executor ?? playwrightExecutor(logger);
  return executor ? new ChromiumRasterRenderer(executor, fontsourceFiles(options.fontsDir)) : null;
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
