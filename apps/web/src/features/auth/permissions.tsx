import type { ReactNode } from 'react';
import { useAuthStore } from './auth-store';

/** A permission code (`users.manage`) or a list meaning "any of these". */
export type PermissionRequirement = string | readonly string[];

export function hasPermission(
  session: { readonly permissions: readonly string[] } | null,
  required: PermissionRequirement,
): boolean {
  if (session === null) return false;
  const codes = typeof required === 'string' ? [required] : required;
  return codes.some((code) => session.permissions.includes(code));
}

/**
 * Whether the signed-in user holds the permission in the current branch.
 * UX only: the Hub checks the same permission on every request.
 */
export function usePermission(required: PermissionRequirement): boolean {
  return useAuthStore((s) => hasPermission(s.session, required));
}

/** Renders `children` only for users with the permission. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: PermissionRequirement;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}
