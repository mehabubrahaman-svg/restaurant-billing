import { BrowserWindow } from 'electron';

/**
 * Renders Hindi/Bengali slips (docs/01 §8): the Hub sends a script that draws
 * the slip on a canvas with the bundled Noto fonts and returns a 1-bit
 * bitmap; it runs here in a hidden, sandboxed, offscreen page. Calls are
 * queued so slips render one at a time.
 */
export class RasterWindow {
  private window: BrowserWindow | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  run(script: string): Promise<unknown> {
    const result = this.queue.then(async () => (await this.page()).executeJavaScript(script, true));
    this.queue = result.catch(() => undefined);
    return result;
  }

  close(): void {
    this.window?.destroy();
    this.window = null;
  }

  private async page() {
    if (this.window && !this.window.isDestroyed()) return this.window.webContents;
    this.window = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await this.window.loadURL('about:blank');
    return this.window.webContents;
  }
}
