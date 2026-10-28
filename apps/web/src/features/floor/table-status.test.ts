import { describe, expect, it } from 'vitest';
import { allowedTransitions } from './table-status';

describe('allowedTransitions', () => {
  it('matches the Hub’s manual transition rules', () => {
    expect(allowedTransitions('AVAILABLE')).toEqual(['RESERVED', 'CLEANING', 'BLOCKED']);
    expect(allowedTransitions('RESERVED')).toEqual(['AVAILABLE', 'BLOCKED']);
    expect(allowedTransitions('CLEANING')).toEqual(['AVAILABLE']);
    expect(allowedTransitions('BLOCKED')).toEqual(['AVAILABLE']);
  });

  it('leaves order-driven statuses to orders', () => {
    expect(allowedTransitions('OCCUPIED')).toEqual([]);
    expect(allowedTransitions('BILLING')).toEqual([]);
  });
});
