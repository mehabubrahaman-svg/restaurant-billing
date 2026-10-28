import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';
import type { Tender } from './payments';

type Remembered = Partial<Record<Tender, string>>;

function read(): Remembered {
  const raw = readStorage(STORAGE_KEYS.lastTerminal);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Remembered) : {};
  } catch {
    return {};
  }
}

/** The card/UPI terminal this counter used last for `method` (a per-device preference). */
export function lastTerminal(method: Tender): string {
  const value = read()[method];
  return typeof value === 'string' ? value : '';
}

export function rememberTerminal(method: Tender, label: string): void {
  const trimmed = label.trim();
  if (trimmed === '') return;
  writeStorage(STORAGE_KEYS.lastTerminal, JSON.stringify({ ...read(), [method]: trimmed }));
}
