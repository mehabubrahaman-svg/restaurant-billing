import { randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: easy to read off the screen and type. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * The first-time setup code (docs/05 §2 Setup). It proves the person running
 * the wizard is at the Hub PC; the desktop app shows it there.
 */
export function newSetupCode(length = 8): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
