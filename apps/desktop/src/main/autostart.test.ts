import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linuxAutostartEntry, setLinuxAutostart } from './autostart';
import { readSettings, writeSettings } from './settings';

describe('start at login on Linux', () => {
  it('writes and removes an XDG autostart entry that starts hidden', () => {
    const home = mkdtempSync(join(tmpdir(), 'restro-home-'));
    try {
      setLinuxAutostart(true, '/opt/RestroOS Hub/restroos-hub', home);
      const file = join(home, '.config', 'autostart', 'restroos-hub.desktop');
      expect(readFileSync(file, 'utf8')).toContain(
        'Exec="/opt/RestroOS Hub/restroos-hub" --hidden',
      );
      setLinuxAutostart(false, '/opt/x', home);
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
    expect(linuxAutostartEntry('/usr/bin/restroos-hub')).toContain(
      'Exec=/usr/bin/restroos-hub --hidden\n',
    );
  });

  it('reads settings with defaults and ignores a damaged file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'restro-settings-'));
    try {
      const file = join(dir, 's.json');
      expect(readSettings(file)).toEqual({
        startAtLogin: true,
        updateChannel: 'stable',
        backupCopyDir: null,
      });
      writeSettings(file, {
        startAtLogin: false,
        updateChannel: 'beta',
        backupCopyDir: '/media/usb',
      });
      expect(readSettings(file)).toEqual({
        startAtLogin: false,
        updateChannel: 'beta',
        backupCopyDir: '/media/usb',
      });
      writeSettings(file, null as never);
      expect(readSettings(file).updateChannel).toBe('stable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
