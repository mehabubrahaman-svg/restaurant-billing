/**
 * The RestroOS Android app (apps/android) runs this web app in a WebView and
 * adds `window.RestroAndroid`: Bluetooth printing from the tablet and saving
 * files to Downloads. In a browser (or the desktop and iOS apps) it is
 * absent and everything here is a no-op.
 *
 * Native calls that take time (printing) answer through
 * `window.RestroAndroidCallbacks.settle(requestId, resultJson)`.
 */

/** A Bluetooth device paired with the tablet in Android settings. */
export interface BondedPrinter {
  readonly name: string;
  /** MAC address, e.g. 66:22:B3:01:4C:7A. */
  readonly address: string;
  /** CLASSIC → print over SPP (connection BLUETOOTH); LE → GATT (connection BLE). */
  readonly type: 'CLASSIC' | 'LE' | 'DUAL' | 'UNKNOWN';
}

export interface NativePrintResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** What the Android app injects. Every method takes and returns strings (a WebView JS interface). */
interface RestroAndroidNative {
  /** App version, e.g. "1.0.0". */
  version(): string;
  /** JSON: `{ ok: true, printers: BondedPrinter[] }` or `{ ok: false, error }` (no permission, Bluetooth off). */
  bondedPrinters(): string;
  /** Starts printing; answers through `RestroAndroidCallbacks.settle(requestId, NativePrintResult JSON)`. */
  print(requestId: string, connection: string, address: string, base64: string): void;
  /** Saves a file to Downloads and shows it; JSON NativePrintResult. */
  saveFile(fileName: string, mimeType: string, base64: string): string;
}

declare global {
  interface Window {
    RestroAndroid?: RestroAndroidNative;
    RestroAndroidCallbacks?: { settle(requestId: string, resultJson: string): void };
  }
}

/** Printing a ticket takes a few seconds; one stuck connection mustn't stall the queue for ever. */
export const NATIVE_PRINT_TIMEOUT_MS = 45_000;

function native(): RestroAndroidNative | null {
  return typeof window === 'undefined' ? null : (window.RestroAndroid ?? null);
}

/** Running inside the RestroOS Android app. */
export function isAndroidApp(): boolean {
  return native() !== null;
}

function parse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The tablet's paired Bluetooth devices; throws with the app's reason when it can't list them. */
export function bondedPrinters(): BondedPrinter[] {
  const bridge = native();
  if (bridge === null) return [];
  const result = parse<{ ok: boolean; printers?: BondedPrinter[]; error?: string }>(
    bridge.bondedPrinters(),
  );
  if (result === null) throw new Error('Bad answer from the app');
  if (!result.ok) throw new Error(result.error ?? 'Bluetooth unavailable');
  return result.printers ?? [];
}

const pending = new Map<string, (result: NativePrintResult) => void>();
let nextRequest = 1;

function callbacks() {
  window.RestroAndroidCallbacks ??= {
    settle(requestId, resultJson) {
      const resolve = pending.get(requestId);
      if (resolve === undefined) return;
      pending.delete(requestId);
      resolve(
        parse<NativePrintResult>(resultJson) ?? { ok: false, error: 'Bad answer from the app' },
      );
    },
  };
}

/** Sends ESC/POS bytes to a Bluetooth printer through the app. Never throws: failures come back as `ok: false`. */
export function printOverBluetooth(
  connection: 'BLUETOOTH' | 'BLE',
  address: string,
  base64: string,
  timeoutMs = NATIVE_PRINT_TIMEOUT_MS,
): Promise<NativePrintResult> {
  const bridge = native();
  if (bridge === null) return Promise.resolve({ ok: false, error: 'Not in the Android app' });
  callbacks();
  const requestId = `p${nextRequest++}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, error: 'The printer did not answer' });
    }, timeoutMs);
    pending.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    try {
      bridge.print(requestId, connection, address, base64);
    } catch (error) {
      pending.delete(requestId);
      clearTimeout(timer);
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Saves a file through the app (a WebView can't follow blob: download links). False when not in the app. */
export async function saveFileInApp(blob: Blob, fileName: string): Promise<boolean> {
  const bridge = native();
  if (bridge === null) return false;
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()));
  const result = parse<NativePrintResult>(
    bridge.saveFile(fileName, blob.type || 'application/octet-stream', data),
  );
  if (result?.ok !== true) throw new Error(result?.error ?? 'Could not save the file');
  return true;
}
