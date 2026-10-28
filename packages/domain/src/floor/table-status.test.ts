import { describe, expect, it } from 'vitest';
import { allowedManualTransitions, assertManualTransition, isTableInUse } from './table-status';

describe('table status', () => {
  it('lets staff reserve, clean and block free tables', () => {
    expect(allowedManualTransitions('AVAILABLE')).toEqual(['RESERVED', 'CLEANING', 'BLOCKED']);
    expect(() => assertManualTransition('CLEANING', 'AVAILABLE')).not.toThrow();
  });

  it('never lets staff set or leave order-driven statuses by hand', () => {
    expect(allowedManualTransitions('OCCUPIED')).toEqual([]);
    expect(() => assertManualTransition('OCCUPIED', 'AVAILABLE')).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
    expect(() => assertManualTransition('AVAILABLE', 'OCCUPIED')).toThrow();
    expect(() => assertManualTransition('CLEANING', 'RESERVED')).toThrow();
  });

  it('treats tables with guests or a bill as in use', () => {
    expect(isTableInUse('OCCUPIED')).toBe(true);
    expect(isTableInUse('BILLING')).toBe(true);
    expect(isTableInUse('RESERVED')).toBe(false);
  });
});
