import { afterEach, describe, expect, it, vi } from 'vitest';
import { bondedPrinters, isAndroidApp, printOverBluetooth, saveFileInApp } from './android-bridge';

afterEach(() => {
  delete window.RestroAndroid;
  vi.useRealTimers();
});

function fakeApp(overrides: Partial<Omit<NonNullable<Window['RestroAndroid']>, 'print'>> = {}) {
  const app = {
    version: () => '1.0.0',
    bondedPrinters: () =>
      JSON.stringify({
        ok: true,
        printers: [{ name: 'RP58', address: '66:22:B3:01:4C:7A', type: 'CLASSIC' }],
      }),
    print: vi.fn<(id: string, connection: string, address: string, base64: string) => void>(),
    saveFile: vi.fn(() => JSON.stringify({ ok: true })),
    ...overrides,
  };
  window.RestroAndroid = app;
  return app;
}

describe('the Android app bridge', () => {
  it('is a no-op in a browser', async () => {
    expect(isAndroidApp()).toBe(false);
    expect(bondedPrinters()).toEqual([]);
    expect(await printOverBluetooth('BLE', 'AA:BB:CC:DD:EE:FF', 'AA==')).toMatchObject({
      ok: false,
    });
    expect(await saveFileInApp(new Blob(['x']), 'a.csv')).toBe(false);
  });

  it("lists the tablet's paired printers, or says why it can't", () => {
    fakeApp();
    expect(isAndroidApp()).toBe(true);
    expect(bondedPrinters()).toEqual([
      { name: 'RP58', address: '66:22:B3:01:4C:7A', type: 'CLASSIC' },
    ]);
    fakeApp({ bondedPrinters: () => JSON.stringify({ ok: false, error: 'Bluetooth is off' }) });
    expect(() => bondedPrinters()).toThrow('Bluetooth is off');
  });

  it('prints and waits for the app to call back', async () => {
    const app = fakeApp();
    app.print.mockImplementation((id: string) =>
      setTimeout(() => window.RestroAndroidCallbacks?.settle(id, JSON.stringify({ ok: true })), 5),
    );
    await expect(printOverBluetooth('BLUETOOTH', '66:22:B3:01:4C:7A', 'G0A=')).resolves.toEqual({
      ok: true,
    });
    expect(app.print).toHaveBeenCalledWith(
      expect.any(String),
      'BLUETOOTH',
      '66:22:B3:01:4C:7A',
      'G0A=',
    );
  });

  it('gives up on a printer that never answers', async () => {
    vi.useFakeTimers();
    fakeApp();
    const result = printOverBluetooth('BLE', 'DC:0D:30:9A:11:02', 'G0A=', 1_000);
    vi.advanceTimersByTime(1_001);
    expect(await result).toEqual({ ok: false, error: 'The printer did not answer' });
  });

  it('saves files through the app as base64', async () => {
    const app = fakeApp();
    expect(await saveFileInApp(new Blob(['hello'], { type: 'text/csv' }), 'sales.csv')).toBe(true);
    expect(app.saveFile).toHaveBeenCalledWith('sales.csv', 'text/csv', btoa('hello'));
  });
});
