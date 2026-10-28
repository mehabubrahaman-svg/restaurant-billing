import { StatusPill, type ConnectionStatus } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useConnectionStatus, useConnectionStore } from './connection-store';

const LABEL_KEYS = {
  live: 'connection.live',
  reconnecting: 'connection.reconnecting',
  bluetooth: 'connection.bluetooth',
  offline: 'connection.offline',
} as const satisfies Record<ConnectionStatus, string>;

const HINT_KEYS = {
  live: 'connection.hint.live',
  reconnecting: 'connection.hint.reconnecting',
  bluetooth: 'connection.hint.bluetooth',
  offline: 'connection.hint.offline',
} as const satisfies Record<ConnectionStatus, string>;

export function ConnectionPill({ className }: { className?: string }) {
  const { t } = useTranslation();
  const status = useConnectionStatus();
  const hasConnected = useConnectionStore((s) => s.hasConnected);
  const queuedCount = useConnectionStore((s) => s.queuedCount);

  const label =
    status === 'reconnecting' && !hasConnected ? t('connection.connecting') : t(LABEL_KEYS[status]);
  const showQueue = status !== 'live' && queuedCount > 0;

  return (
    <StatusPill
      status={status}
      label={label}
      title={t(HINT_KEYS[status])}
      {...(showQueue ? { detail: t('connection.queued', { count: queuedCount }) } : {})}
      {...(className === undefined ? {} : { className })}
    />
  );
}
