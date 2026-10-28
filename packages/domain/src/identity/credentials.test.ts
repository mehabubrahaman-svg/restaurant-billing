import { describe, expect, it } from 'vitest';
import { assertAcceptablePassword, assertAcceptablePin } from './credentials';

describe('password policy', () => {
  it('accepts a reasonable password', () => {
    expect(() => assertAcceptablePassword('Biryani@Kolkata', 'owner')).not.toThrow();
  });

  it.each([
    ['short1', 'owner'],
    ['12345678', 'owner'],
    ['aaaaaaaaaa', 'owner'],
    ['ravi2026!x', 'ravi'],
  ])('rejects %s', (password, username) => {
    expect(() => assertAcceptablePassword(password, username)).toThrow(
      expect.objectContaining({ code: 'PASSWORD_TOO_WEAK' }),
    );
  });
});

describe('PIN policy', () => {
  it.each(['2580', '47193', '903172'])('accepts %s', (pin) => {
    expect(() => assertAcceptablePin(pin)).not.toThrow();
  });

  it.each(['1111', '1234', '4321', '7890', '0987', '123456'])('rejects the obvious %s', (pin) => {
    expect(() => assertAcceptablePin(pin)).toThrow(
      expect.objectContaining({ code: 'PIN_TOO_WEAK' }),
    );
  });

  it.each(['123', '1234567', '12a4'])('rejects malformed %s', (pin) => {
    expect(() => assertAcceptablePin(pin)).toThrow(
      expect.objectContaining({ code: 'PIN_INVALID' }),
    );
  });
});
