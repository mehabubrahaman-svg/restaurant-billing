import { PERMISSIONS, type PermissionCode } from './permissions';

export interface RoleTemplate {
  readonly code: string;
  readonly name: string;
  readonly permissions: readonly PermissionCode[];
  /** Locked roles can't be edited at all (ADMIN always keeps every permission). */
  readonly locked: boolean;
}

const all = PERMISSIONS;
const except = (...excluded: PermissionCode[]) => all.filter((p) => !excluded.includes(p));

/**
 * The seven roles created at setup (docs/09 WP 2.2). Owners can edit them
 * afterwards, except ADMIN. Overrides (discount above limit, refunds,
 * cancellations) sit with MANAGER so cashiers ask a manager to approve.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  { code: 'ADMIN', name: 'Admin', permissions: all, locked: true },
  {
    code: 'MANAGER',
    name: 'Manager',
    permissions: except('roles.manage', 'backup.manage', 'sync.manage', 'accounts.journal'),
    locked: false,
  },
  {
    code: 'CASHIER',
    name: 'Cashier',
    permissions: [
      'tables.view',
      'tables.update_status',
      'orders.create',
      'orders.update',
      'orders.fire_kot',
      'orders.transfer_table',
      'billing.create',
      'billing.collect_payment',
      'billing.discount',
      'billing.reprint',
      'cash.shift_manage',
      'customers.view',
      'customers.manage',
      'reports.sales',
    ],
    locked: false,
  },
  {
    code: 'CAPTAIN',
    name: 'Captain',
    permissions: [
      'tables.view',
      'tables.update_status',
      'orders.create',
      'orders.update',
      'orders.fire_kot',
      'orders.transfer_table',
      'reservations.manage',
      'customers.view',
      'customers.manage',
    ],
    locked: false,
  },
  {
    code: 'KITCHEN',
    name: 'Kitchen Staff',
    permissions: ['kds.view', 'kds.update_status', 'menu.toggle_availability'],
    locked: false,
  },
  {
    code: 'INVENTORY',
    name: 'Inventory Staff',
    permissions: [
      'inventory.view',
      'inventory.manage_items',
      'inventory.adjust',
      'inventory.count',
      'vendors.view',
      'po.create',
      'grn.post',
      'reports.inventory',
    ],
    locked: false,
  },
  {
    code: 'ACCOUNTANT',
    name: 'Accountant',
    permissions: [
      'dashboard.view',
      'accounts.view',
      'accounts.journal',
      'expenses.manage',
      'vendors.view',
      'vendor_payments.create',
      'reports.sales',
      'reports.inventory',
      'reports.financial',
      'reports.export',
      'audit.view',
    ],
    locked: false,
  },
];
