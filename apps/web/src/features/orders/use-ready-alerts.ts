import type { Kot } from '@restroos/contracts';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { chime } from '../../lib/chime';
import { useAuthStore } from '../auth/auth-store';
import { subscribeLive } from '../live/live-events';
import { toast } from '../toast/toast-store';

/** Ready alerts stay up longer than ordinary toasts: the captain may be mid-conversation. */
export const READY_TOAST_MS = 12_000;

/**
 * "T2 — Chicken Biryani ×2 ready" (docs/07 §7.2): when a KOT of an order this
 * captain owns turns READY, show a toast with a shortcut to the order and
 * chime (unless this device is muted).
 */
export function useReadyAlerts(): void {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.type !== 'kitchen.kot.status_changed' || message.data.to !== 'READY') return;
        const kot: Kot = message.data.kot;
        const me = useAuthStore.getState().session?.user.id ?? null;
        if (me === null || kot.captainId !== me) return;
        const where =
          kot.tableLabel ??
          (kot.tokenNo === null
            ? t('order.number', { orderNo: kot.orderNo })
            : t('order.token', { token: kot.tokenNo }));
        const items = kot.items
          .filter((i) => i.status !== 'CANCELLED')
          .map((i) => t('order.ready.item', { name: i.name, quantity: i.quantity }))
          .join(', ');
        toast(items, 'success', {
          title: t('order.ready.title', { where, kotNo: kot.kotNo }),
          durationMs: READY_TOAST_MS,
          action: {
            label: t('order.ready.open'),
            onClick: () => void navigate(`/captain/orders/${kot.orderId}`),
          },
        });
        chime('ready');
      }),
    [t, navigate],
  );
}
