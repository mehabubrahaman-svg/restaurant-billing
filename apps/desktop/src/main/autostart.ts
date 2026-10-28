import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The XDG autostart entry that starts the Hub, hidden in the tray, when the user signs in. */
export function linuxAutostartEntry(execPath: string): string {
  const quoted = /[\s"]/.test(execPath) ? `"${execPath.replaceAll('"', '\\"')}"` : execPath;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RestroOS Hub',
    'Comment=Runs the restaurant server for every device on the network',
    `Exec=${quoted} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Turns start-at-login on or off on Linux (Windows uses Electron's login items). */
export function setLinuxAutostart(enabled: boolean, execPath: string, home = homedir()): void {
  const dir = join(home, '.config', 'autostart');
  const file = join(dir, 'restroos-hub.desktop');
  if (!enabled) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, linuxAutostartEntry(execPath));
}
