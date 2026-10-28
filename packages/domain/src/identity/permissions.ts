/**
 * Every permission the system knows, mirroring the seed in
 * database/migrations/0002_seed_reference_data.sql (a test keeps them in sync).
 */
export const PERMISSIONS = [
  'dashboard.view',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'floor.manage',
  'menu.manage',
  'audit.view',
  'backup.manage',
  'tables.view',
  'tables.update_status',
  'orders.create',
  'orders.update',
  'orders.fire_kot',
  'orders.item_cancel',
  'orders.cancel',
  'orders.transfer_table',
  'reservations.manage',
  'kds.view',
  'kds.update_status',
  'kds.assign_chef',
  'menu.toggle_availability',
  'billing.create',
  'billing.collect_payment',
  'billing.discount',
  'billing.discount_override',
  'billing.complimentary',
  'billing.reprint',
  'billing.cancel',
  'billing.refund',
  'billing.credit_sale',
  'cash.shift_manage',
  'customers.view',
  'customers.manage',
  'loyalty.adjust',
  'inventory.view',
  'inventory.manage_items',
  'inventory.adjust',
  'inventory.count',
  'vendors.view',
  'vendors.manage',
  'po.create',
  'po.approve',
  'grn.post',
  'vendor_payments.create',
  'accounts.view',
  'accounts.journal',
  'expenses.manage',
  'reports.sales',
  'reports.inventory',
  'reports.financial',
  'reports.export',
  'sync.manage',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

const KNOWN: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermissionCode(value: string): value is PermissionCode {
  return KNOWN.has(value);
}
