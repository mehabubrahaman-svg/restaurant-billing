import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockHub } from '../../test/mock-hub';
import { printQueuedJobs } from './device-print-agent';

afterEach(() => {
  delete window.RestroAndroid;
  vi.unstubAllGlobals();
});

const ids = {
  j1: '0193a5b0-0000-7000-8000-000000000001',
  j2: '0193a5b0-0000-7000-8000-000000000002',
  printer: '0193a5b0-0000-7000-8000-000000000010',
};
const job = (id: string, printerName: string) => ({
  id,
  printerId: ids.printer,
  printerName,
  connection: 'BLUETOOTH',
  address: '66:22:B3:01:4C:7A',
  paperWidthMm: 58,
  data: btoa('\x1b@KOT'),
  createdAt: '2026-10-31T10:00:00.000Z',
});

describe('the tablet print agent', () => {
  it('prints queued tickets in order and reports each result to the Hub', async () => {
    const results: unknown[] = [];
    mockHub({
      'GET /devices/me/print-jobs': () =>
        json({ data: [job(ids.j1, 'Tandoor BT'), job(ids.j2, 'Bar BT')] }),
      [`POST /devices/me/print-jobs/${ids.j1}/result`]: ({ body }) => {
        results.push(['j1', body]);
        return new Response(null, { status: 204 });
      },
      [`POST /devices/me/print-jobs/${ids.j2}/result`]: ({ body }) => {
        results.push(['j2', body]);
        return new Response(null, { status: 204 });
      },
    });
    const printed: string[] = [];
    window.RestroAndroid = {
      version: () => '1.0.0',
      bondedPrinters: () => '{"ok":true,"printers":[]}',
      saveFile: () => '{"ok":true}',
      print: (id, _connection, _address, data) => {
        printed.push(atob(data));
        const ok = printed.length === 1;
        queueMicrotask(() =>
          window.RestroAndroidCallbacks?.settle(
            id,
            JSON.stringify(ok ? { ok: true } : { ok: false, error: 'socket closed' }),
          ),
        );
      },
    };

    const failed = await printQueuedJobs();
    expect(printed).toEqual(['\x1b@KOT', '\x1b@KOT']);
    expect(failed.map((j) => j.printerName)).toEqual(['Bar BT']);
    expect(results).toEqual([
      ['j1', { ok: true }],
      ['j2', { ok: false, error: 'socket closed' }],
    ]);
  });
});
