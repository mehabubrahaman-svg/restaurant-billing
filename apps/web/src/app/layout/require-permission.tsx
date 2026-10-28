import { ShieldAlert } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../../stores/session-store';
import { canOpenPortal, type Portal } from '../portals';
import { StatusPage } from './status-page';

/**
 * Hides a portal from users without its permission. This is a UX guard only:
 * the Hub enforces the same permissions on every API call.
 */
export function RequirePermission({ portal, children }: { portal: Portal; children: ReactNode }) {
  const { t } = useTranslation();
  const user = useSessionStore((s) => s.user);
  if (canOpenPortal(user, portal)) return children;
  return (
    <StatusPage
      icon={ShieldAlert}
      title={t('access.deniedTitle')}
      body={t('access.deniedBody', { portal: t(portal.titleKey) })}
    />
  );
}
