import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The desktop app's own settings (the restaurant's settings live in the Hub database). */
export interface DesktopSettings {
  startAtLogin: boolean;
  updateChannel: 'stable' | 'beta';
  /** Second backup folder (USB drive / NAS share), passed to the Hub. */
  backupCopyDir: string | null;
}

const DEFAULTS: DesktopSettings = {
  startAtLogin: true,
  updateChannel: 'stable',
  backupCopyDir: null,
};

export function readSettings(file: string): DesktopSettings {
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<DesktopSettings>;
    return {
      startAtLogin:
        typeof raw.startAtLogin === 'boolean' ? raw.startAtLogin : DEFAULTS.startAtLogin,
      updateChannel: raw.updateChannel === 'beta' ? 'beta' : 'stable',
      backupCopyDir: typeof raw.backupCopyDir === 'string' ? raw.backupCopyDir : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(file: string, settings: DesktopSettings): void {
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
