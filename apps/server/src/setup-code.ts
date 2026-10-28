import { randomInt, timingSafeEqual } from 'node:crypto';
import type { Logger } from 'pino';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const MAX_ATTEMPTS = 5;

/**
 * First-time setup must be done by whoever sits at the Hub, not by anyone on
 * the restaurant Wi-Fi. The Hub shows this code on its screen (and console);
 * the setup request must include it. Wrong guesses roll the code.
 */
export class SetupCode {
  private code: string | null = null;
  private failures = 0;

  constructor(
    private readonly logger: Logger,
    fixed?: string,
  ) {
    if (fixed) this.code = fixed.toUpperCase();
  }

  /** Called at startup when setup is still needed. */
  announce(): void {
    this.code ??= generate();
    this.logger.warn(
      { setupCode: this.code },
      `FIRST-TIME SETUP: open the Hub in a browser and enter setup code ${this.code}`,
    );
  }

  check(candidate: string): boolean {
    if (this.code === null) return false;
    if (codesMatch(candidate, this.code)) return true;
    this.failures += 1;
    if (this.failures >= MAX_ATTEMPTS) {
      this.failures = 0;
      this.code = generate();
      this.logger.warn('too many wrong setup codes: a new code was generated');
      this.announce();
    }
    return false;
  }

  consume(): void {
    this.code = null;
  }

  /** For the desktop shell's window and for tests. */
  current(): string | null {
    return this.code;
  }
}

function generate(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

function codesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().toUpperCase());
  const right = Buffer.from(b.trim().toUpperCase());
  return left.length === right.length && timingSafeEqual(left, right);
}
