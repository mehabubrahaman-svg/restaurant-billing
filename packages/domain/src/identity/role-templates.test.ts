import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './permissions';
import { ROLE_TEMPLATES } from './role-templates';

describe('role templates', () => {
  it('defines the seven roles from the brief', () => {
    expect(ROLE_TEMPLATES.map((r) => r.code)).toEqual([
      'ADMIN',
      'MANAGER',
      'CASHIER',
      'CAPTAIN',
      'KITCHEN',
      'INVENTORY',
      'ACCOUNTANT',
    ]);
  });

  it('gives ADMIN everything and locks it', () => {
    const admin = ROLE_TEMPLATES.find((r) => r.code === 'ADMIN')!;
    expect([...admin.permissions].sort()).toEqual([...PERMISSIONS].sort());
    expect(admin.locked).toBe(true);
  });

  it('keeps refunds and discount overrides away from cashiers', () => {
    const cashier = ROLE_TEMPLATES.find((r) => r.code === 'CASHIER')!;
    expect(cashier.permissions).not.toContain('billing.refund');
    expect(cashier.permissions).not.toContain('billing.discount_override');
    expect(cashier.permissions).not.toContain('billing.cancel');
  });

  it('has no duplicate permissions in any role', () => {
    for (const role of ROLE_TEMPLATES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });
});
