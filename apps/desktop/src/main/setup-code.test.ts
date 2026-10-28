import { describe, expect, it } from 'vitest';
import { newSetupCode } from './setup-code';

describe('setup code', () => {
  it('is 8 easy-to-read characters, different each time', () => {
    const codes = Array.from({ length: 50 }, () => newSetupCode());
    for (const code of codes) expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(new Set(codes).size).toBe(50);
  });
});
