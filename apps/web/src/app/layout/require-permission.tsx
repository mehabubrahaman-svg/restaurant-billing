import { ShieldAlert } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission, type PermissionRequirement } from '../../features/auth/permissions';
import { StatusPage } from './status-page';

/**
 * Shows a "no access" page instead of `children` for users without the
 * permission. UX only: the Hub enforces the same permission on every call.
 */
export function RequirePermission({
  permission,
  name,
  children,
}: {
  /** Any of these; `null` means open to every signed-in user. */
  permission: PermissionRequirement | null;
  /** What the user tried to open, for the message. */
  name: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const allowed = usePermission(permission ?? []);
  if (permission === null || allowed) return children;
  return (
    <StatusPage
      icon={ShieldAlert}
      title={t('access.deniedTitle')}
      body={t('access.deniedBody', { portal: name })}
    />
  );
}
