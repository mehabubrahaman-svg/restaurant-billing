import { create } from 'zustand';

/** Permission codes from `database/migrations/0002_seed_reference_data.sql`. */
export type PermissionCode =
  | 'dashboard.view'
  | 'users.manage'
  | 'settings.manage'
  | 'menu.manage'
  | 'tables.view'
  | 'orders.create'
  | 'orders.fire_kot'
  | 'kds.view'
  | 'kds.update_status'
  | 'billing.create'
  | 'billing.collect_payment'
  | 'cash.shift_manage'
  | 'customers.view'
  | 'inventory.view'
  | 'vendors.view'
  | 'accounts.view'
  | 'reports.sales';

export type RoleKey = 'owner' | 'cashier' | 'captain' | 'chef';

export interface SessionUser {
  readonly id: string;
  readonly displayName: string;
  /** Short form for tight spaces ("Ravi K."). */
  readonly shortName: string;
  readonly initials: string;
  readonly employeeCode: string;
  readonly role: RoleKey;
  readonly permissions: readonly PermissionCode[];
}

/**
 * Mock staff until auth lands (Sprint 2). Names are data, not UI copy, so
 * they are not translated. Permission sets follow the seeded roles.
 */
export const MOCK_USERS: readonly SessionUser[] = [
  {
    id: 'usr-owner',
    displayName: 'Ravi Kumar',
    shortName: 'Ravi K.',
    initials: 'RK',
    employeeCode: '1001',
    role: 'owner',
    permissions: [
      'dashboard.view',
      'users.manage',
      'settings.manage',
      'menu.manage',
      'tables.view',
      'orders.create',
      'orders.fire_kot',
      'kds.view',
      'kds.update_status',
      'billing.create',
      'billing.collect_payment',
      'cash.shift_manage',
      'customers.view',
      'inventory.view',
      'vendors.view',
      'accounts.view',
      'reports.sales',
    ],
  },
  {
    id: 'usr-cashier',
    displayName: 'Asha Sen',
    shortName: 'Asha S.',
    initials: 'AS',
    employeeCode: '1002',
    role: 'cashier',
    permissions: [
      'tables.view',
      'billing.create',
      'billing.collect_payment',
      'cash.shift_manage',
      'customers.view',
    ],
  },
  {
    id: 'usr-captain',
    displayName: 'Manoj Jha',
    shortName: 'Manoj J.',
    initials: 'MJ',
    employeeCode: '1003',
    role: 'captain',
    permissions: ['tables.view', 'orders.create', 'orders.fire_kot', 'customers.view'],
  },
  {
    id: 'usr-chef',
    displayName: 'Imran Sheikh',
    shortName: 'Imran S.',
    initials: 'IS',
    employeeCode: '1004',
    role: 'chef',
    permissions: ['kds.view', 'kds.update_status'],
  },
];

export function hasPermission(user: SessionUser | null, code: PermissionCode): boolean {
  return user !== null && user.permissions.includes(code);
}

interface SessionState {
  readonly user: SessionUser | null;
  /** Mock sign-in by user id. Replaced by the PIN login call in Sprint 2. */
  signInAs(userId: string): boolean;
  signOut(): void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  // Start signed in as the owner so every portal is reachable before auth exists.
  user: MOCK_USERS[0] ?? null,
  signInAs(userId) {
    const user = MOCK_USERS.find((u) => u.id === userId);
    if (user === undefined) return false;
    set({ user });
    return true;
  },
  signOut() {
    set({ user: null });
  },
}));
