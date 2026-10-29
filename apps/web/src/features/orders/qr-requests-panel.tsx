import type { QrRequest } from '@restroos/contracts';
import { Alert, BellRing, Button, Card, Dialog, Field, Input, QrCode } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { usePermission } from '../auth/permissions';
import { useNow } from '../devices/use-now';
import { FLOOR_KEY } from '../floor/floor-queries';
import { toast } from '../toast/toast-store';
import { useElapsed } from './elapsed';
import { ORDER_KEYS } from './order-queries';
import { QR_REQUESTS_KEY, useQrRequests } from './qr-requests';

/** Captains answer these: staff who take orders. */
export const QR_ANSWER_PERMISSIONS = ['orders.create', 'orders.update'] as const;

/** Guests' QR orders and calls, on the captain's floor until someone answers each. */
export function QrRequestsPanel() {
  const { t } = useTranslation();
  const canAnswer = usePermission(QR_ANSWER_PERMISSIONS);
  const requests = useQrRequests(canAnswer);
  const now = useNow(30_000);
  const [declining, setDeclining] = useState<QrRequest | null>(null);
  const list = requests.data?.data ?? [];
  if (!canAnswer || list.length === 0) return null;

  return (
    <section aria-labelledby="qr-requests" className="flex flex-col gap-2">
      <h2 id="qr-requests" className="flex items-center gap-2 font-semibold">
        <BellRing aria-hidden="true" className="size-5 text-primary" />
        {t('qr.requests.title', { count: list.length })}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((request) => (
          <li key={request.id}>
            <RequestCard request={request} now={now} onDecline={() => setDeclining(request)} />
          </li>
        ))}
      </ul>
      {declining !== null && (
        <DeclineDialog request={declining} onClose={() => setDeclining(null)} />
      )}
    </section>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: QR_REQUESTS_KEY });
    void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
    void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.all });
  };
}

function RequestCard({
  request,
  now,
  onDecline,
}: {
  request: QrRequest;
  now: number;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsed();
  const errorMessage = useErrorMessage();
  const refresh = useRefresh();
  const table = request.tableLabel;
  const accept = useMutation({
    mutationFn: (fire: boolean) => api.qrRequests.accept(request.id, fire),
    onSuccess: (_, fire) => {
      refresh();
      toast(fire ? t('qr.requests.acceptedSent', { table }) : t('qr.requests.accepted', { table }));
    },
    onError: (error) => {
      refresh();
      toast(errorMessage(error), 'danger');
    },
  });
  const done = useMutation({
    mutationFn: () => api.qrRequests.done(request.id),
    onSuccess: refresh,
    onError: (error) => {
      refresh();
      toast(errorMessage(error), 'danger');
    },
  });
  const busy = accept.isPending || done.isPending;

  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <QrCode aria-hidden="true" className="size-4 text-muted-foreground" />
          {t(`qr.requests.kinds.${request.kind}`, { table })}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {elapsed(request.createdAt, now)}
        </span>
      </div>
      {request.kind === 'ORDER' && (
        <ul className="text-sm">
          {request.items.map((item, i) => (
            <li key={i} className="break-words">
              {t('qr.requests.line', {
                quantity: item.quantity,
                name: item.variantName ? `${item.name} (${item.variantName})` : item.name,
              })}
              {[...item.addonNames.map((a) => `+ ${a}`), item.note]
                .filter(Boolean)
                .map((x) => ` · ${x}`)
                .join('')}
            </li>
          ))}
        </ul>
      )}
      {(request.covers !== null || request.guestName !== null || request.note !== null) && (
        <p className="text-sm text-muted-foreground">
          {[
            request.covers !== null && t('qr.requests.guests', { count: request.covers }),
            request.guestName,
            request.note,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {request.kind === 'ORDER' ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => accept.mutate(true)}>
              {t('qr.requests.acceptSend')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => accept.mutate(false)}
            >
              {t('qr.requests.accept')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onDecline}>
              {t('qr.requests.decline')}
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => done.mutate()}>
            {t('qr.requests.done')}
          </Button>
        )}
      </div>
    </Card>
  );
}

function DeclineDialog({ request, onClose }: { request: QrRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const refresh = useRefresh();
  const [reason, setReason] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const decline = useMutation({
    mutationFn: () => api.qrRequests.reject(request.id, reason.trim()),
    onSuccess: () => {
      refresh();
      toast(t('qr.requests.declined', { table: request.tableLabel }));
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!decline.isPending}
      closeLabel={t('common.close')}
      title={t('qr.requests.declineTitle', { table: request.tableLabel })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={decline.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="qr-decline" disabled={decline.isPending}>
            {t('qr.requests.decline')}
          </Button>
        </>
      }
    >
      <form
        id="qr-decline"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const short = reason.trim().length < 3;
          setTooShort(short);
          if (!short) decline.mutate();
        }}
      >
        {decline.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(decline.error)}
          </Alert>
        )}
        <Field
          label={t('qr.requests.reason')}
          hint={t('qr.requests.reasonHint')}
          error={tooShort ? t('qr.requests.reasonShort') : undefined}
        >
          {(p) => (
            <Input
              {...p}
              value={reason}
              maxLength={120}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
