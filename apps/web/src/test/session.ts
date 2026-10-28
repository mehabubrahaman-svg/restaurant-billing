import type { SessionResponse } from '@restroos/contracts';
import { useAuthStore } from '../features/auth/auth-store';

export const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
export const BRANCH_2_ID = '22222222-2222-4222-8222-222222222222';
export const USER_ID = '33333333-3333-4333-8333-333333333333';

export const ALL_PERMISSIONS = [
  'dashboard.view',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'audit.view',
  'tables.view',
  'kds.view',
  'billing.create',
  'inventory.view',
  'vendors.view',
  'accounts.view',
  'reports.sales',
];

export function makeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
  const branch = { id: BRANCH_ID, code: 'KOL1', name: 'Park Street', stateCode: '19' };
  return {
    accessToken: 'access-1',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    user: {
      id: USER_ID,
      username: 'ravi',
      fullName: 'Ravi Kumar',
      preferredLocale: null,
      hasPin: true,
    },
    branch,
    branches: [branch],
    roles: ['ADMIN'],
    permissions: ALL_PERMISSIONS,
    ...overrides,
  };
}

/** Test helper: sign in without the Hub. */
export function signInForTest(permissions: readonly string[] = ALL_PERMISSIONS) {
  useAuthStore.setState({
    status: 'authenticated',
    session: makeSession({ permissions: [...permissions] }),
  });
}

export function signOutForTest() {
  useAuthStore.setState({ status: 'anonymous', session: null });
}
