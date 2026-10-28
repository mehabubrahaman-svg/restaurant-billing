import { DomainError } from '../shared/result';

export const PASSWORD_MIN_LENGTH = 8;

/** Throws PASSWORD_TOO_WEAK. Length matters most; we also refuse the obvious. */
export function assertAcceptablePassword(password: string, username: string): void {
  const reasons: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    reasons.push(`at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.toLowerCase().includes(username.toLowerCase()) && username.length >= 3) {
    reasons.push('must not contain the username');
  }
  if (/^(.)\1*$/.test(password)) reasons.push('must not be one repeated character');
  if (/^\d+$/.test(password)) reasons.push('must not be only digits');
  if (reasons.length > 0) {
    throw new DomainError('PASSWORD_TOO_WEAK', `password ${reasons.join('; ')}`, { reasons });
  }
}

/**
 * PINs are 4–6 digits. They are only ever accepted on the restaurant's own
 * network with lockout after repeated failures, so we just refuse the PINs
 * everyone tries first.
 */
export function assertAcceptablePin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new DomainError('PIN_INVALID', 'PIN must be 4 to 6 digits');
  const digits = [...pin].map(Number);
  const allSame = digits.every((d) => d === digits[0]);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 1) % 10);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1]! + 9) % 10);
  if (allSame || ascending || descending) {
    throw new DomainError(
      'PIN_TOO_WEAK',
      'PIN must not be a repeated digit or a straight sequence',
    );
  }
}

export const LOCKOUT = {
  /** Failed attempts (password or PIN) before the account locks. */
  maxAttempts: 5,
  lockMinutes: 15,
} as const;
