import {
  BLE_SERVICE_UUID,
  MAX_USEFUL_ATT_MTU,
  MIN_ATT_MTU,
  type FrameError,
} from '@restroos/contracts/ble';
import { SPIKE_PATHS } from '../src/bench-protocol';
import {
  fetchHubStats,
  runDownload,
  runEcho,
  runReconnect,
  runUpload,
  type EchoResult,
  type ReconnectSample,
  type ThroughputResult,
} from './bench';
import { HubLink, type WriteMode } from './hub-link';

/** Measurement page UI: plain DOM, one file. Results accumulate into one JSON report. */

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const logEl = $<HTMLPreElement>('log');
const resultsEl = $<HTMLPreElement>('results');
const statusEl = $('status');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-needs-link]')];

function log(line: string): void {
  const time = new Date().toISOString().slice(11, 23);
  logEl.textContent = `${time} ${line}\n${logEl.textContent ?? ''}`.slice(0, 20_000);
}

interface Report {
  spike: 'restroos-ble';
  reportVersion: 1;
  startedAt: string;
  tablet: { label: string; userAgent: string; secureContext: boolean };
  hub: { deviceName: string | undefined; hubInfo: unknown; firstConnect?: unknown };
  echo: EchoResult[];
  throughput: ThroughputResult[];
  reconnect: ReconnectSample[];
  keepAlive: { ok: number; failed: number };
  frameErrors: { at: string; code: FrameError['code']; message: string }[];
  disconnects: string[];
  hubStats?: unknown;
}

const report: Report = {
  spike: 'restroos-ble',
  reportVersion: 1,
  startedAt: new Date().toISOString(),
  tablet: { label: '', userAgent: navigator.userAgent, secureContext: window.isSecureContext },
  hub: { deviceName: undefined, hubInfo: undefined },
  echo: [],
  throughput: [],
  reconnect: [],
  keepAlive: { ok: 0, failed: 0 },
  frameErrors: [],
  disconnects: [],
};

function render(): void {
  report.tablet.label = $<HTMLInputElement>('tablet-label').value;
  resultsEl.textContent = JSON.stringify(report, null, 2);
  const connected = link?.connected ?? false;
  statusEl.textContent = link
    ? `${link.device.name ?? link.device.id}: ${connected ? 'connected' : 'disconnected'} · frame MTU ${link.client.currentMtu}${link.hasCommandChannel ? '' : ' · discovery only'}`
    : 'not connected';
  for (const b of buttons) b.disabled = !connected || busy;
}

let link: HubLink | undefined;
let busy = false;
let disconnectWaiter: ((at: number) => void) | undefined;

function waitForDisconnect(): Promise<number> {
  return new Promise((resolve) => (disconnectWaiter = resolve));
}

/** Runs one action at a time, keeping the buttons and report in sync. */
async function task(name: string, action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  log(`▶ ${name}`);
  try {
    await action();
    log(`✓ ${name}`);
  } catch (error) {
    log(`✗ ${name}: ${String(error)}`);
  } finally {
    busy = false;
    render();
  }
}

function on(id: string, handler: () => Promise<void>): void {
  $(id).addEventListener('click', () => void handler());
}

on('connect', () =>
  task('connect', async () => {
    link?.disconnect();
    link = await HubLink.choose({
      log,
      onDisconnect: (at) => {
        report.disconnects.push(new Date().toISOString());
        log('link disconnected');
        disconnectWaiter?.(at);
        disconnectWaiter = undefined;
        render();
      },
      onFrameError: (e) => {
        report.frameErrors.push({ at: new Date().toISOString(), code: e.code, message: e.message });
        log(`frame error ${e.code}: ${e.message}`);
      },
    });
    applySettings();
    const timing = await link.connect();
    report.hub = { deviceName: link.device.name, hubInfo: link.hubInfo, firstConnect: timing };
    log(`connected in ${Math.round(timing.readyMs)} ms; hub-info ${JSON.stringify(link.hubInfo)}`);
  }),
);

on('read-info', () =>
  task('read hub-info + pairing', async () => {
    if (!link) return;
    log(`hub-info ${JSON.stringify(await link.readHubInfo())}`);
    log(`pairing ${JSON.stringify(await link.readPairing())}`);
  }),
);

const echo = (payload: 'small' | 'kot') => () =>
  task(`echo ×100 (${payload})`, async () => {
    if (!link) return;
    const result = await runEcho(link, payload, 100, (i) => i % 10 === 0 && log(`echo ${i}/100`));
    report.echo.push(result);
    log(`echo ${payload}: ${JSON.stringify(result.rttMs)} failures ${result.failures}`);
  });
on('echo-small', echo('small'));
on('echo-kot', echo('kot'));

const SIZES = [1_000, 10_000, 100_000];
on('upload', () =>
  task('upload 1/10/100 KB', async () => {
    for (const bytes of SIZES) {
      if (!link) return;
      const r = await runUpload(link, bytes);
      report.throughput.push(r);
      log(
        `upload ${bytes} B: ${r.kbPerSec} KB/s in ${r.ms} ms (${r.frames} frames)${r.error ? ` ${r.error}` : ''}`,
      );
    }
  }),
);
on('download', () =>
  task('download 1/10/100 KB', async () => {
    for (const bytes of SIZES) {
      if (!link) return;
      const r = await runDownload(link, bytes);
      report.throughput.push(r);
      log(
        `download ${bytes} B: ${r.kbPerSec} KB/s in ${r.ms} ms (${r.frames} frames)${r.error ? ` ${r.error}` : ''}`,
      );
    }
  }),
);

const reconnectRuns = (kind: ReconnectSample['kind']) => () =>
  task(`reconnect ×5 (${kind})`, async () => {
    for (let i = 0; i < 5; i++) {
      if (!link) return;
      const r = await runReconnect(link, kind, waitForDisconnect);
      report.reconnect.push(r);
      log(
        `reconnect ${kind}: usable after ${r.usableMs} ms (${r.attempts} attempts)${r.error ? ` ${r.error}` : ''}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  });
on('reconnect-tablet', reconnectRuns('tablet-initiated'));
on('reconnect-hub', reconnectRuns('hub-initiated'));

on('stats', () =>
  task('hub stats', async () => {
    if (!link) return;
    report.hubStats = await fetchHubStats(link);
    log(`stats ${JSON.stringify(report.hubStats)}`);
  }),
);

on('run-all', () =>
  task('run all', async () => {
    if (!link) return;
    const l = link;
    report.echo.push(await runEcho(l, 'small', 100, () => undefined));
    report.echo.push(await runEcho(l, 'kot', 100, () => undefined));
    for (const bytes of SIZES) report.throughput.push(await runUpload(l, bytes));
    for (const bytes of SIZES) report.throughput.push(await runDownload(l, bytes));
    for (let i = 0; i < 5; i++)
      report.reconnect.push(await runReconnect(l, 'hub-initiated', waitForDisconnect));
    report.hubStats = await fetchHubStats(l);
  }),
);

// Keep-alive: for link-count and range tests, ping every 5 s and count outcomes.
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
$<HTMLInputElement>('keep-alive').addEventListener('change', (event) => {
  clearInterval(keepAliveTimer);
  if (!(event.target as HTMLInputElement).checked) return;
  keepAliveTimer = setInterval(() => {
    if (!link?.connected || busy) return;
    const ping = link.hasCommandChannel
      ? link.client.request(
          { method: 'POST', path: SPIKE_PATHS.echo, body: {} },
          { timeoutMs: 4_000 },
        )
      : link.readHubInfoRaw();
    ping
      .then(
        () => report.keepAlive.ok++,
        () => report.keepAlive.failed++,
      )
      .finally(render);
  }, 5_000);
});

function applySettings(): void {
  if (!link) return;
  link.writeMode = $<HTMLSelectElement>('write-mode').value as WriteMode;
  const mtu = Number($<HTMLInputElement>('mtu-override').value);
  link.mtuOverride =
    Number.isInteger(mtu) && mtu >= MIN_ATT_MTU && mtu <= MAX_USEFUL_ATT_MTU ? mtu : undefined;
  link.client.setMtu(link.mtuOverride ?? link.hubInfo?.mtu ?? MIN_ATT_MTU);
  render();
}
$('write-mode').addEventListener('change', applySettings);
$('mtu-override').addEventListener('change', applySettings);
$('tablet-label').addEventListener('input', render);

$('copy').addEventListener('click', () => {
  render();
  const text = resultsEl.textContent ?? '';
  navigator.clipboard.writeText(text).then(
    () => log('report copied to clipboard'),
    () => {
      // Clipboard can be blocked; select the text so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(resultsEl);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      log('clipboard blocked: report selected, copy it manually');
    },
  );
});

async function checkEnvironment(): Promise<void> {
  const env = $('environment');
  if (!window.isSecureContext) {
    env.textContent = 'Not a secure context: Web Bluetooth is disabled. See RUNBOOK §4.';
    env.className = 'bad';
  } else if (!navigator.bluetooth) {
    env.textContent = 'This browser has no Web Bluetooth. Use Chrome on Android.';
    env.className = 'bad';
  } else {
    const available = await navigator.bluetooth.getAvailability().catch(() => false);
    env.textContent = available
      ? `Ready. Service ${BLE_SERVICE_UUID}.`
      : 'Bluetooth is off or unavailable on this device.';
    env.className = available ? 'good' : 'bad';
  }
}

void checkEnvironment();
render();
