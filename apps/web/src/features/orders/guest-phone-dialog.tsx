import { IndianMobileSchema, type Order } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Field, Input, TYPO } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { setOrder } from './order-queries';

/**
 * The guest's phone on the order, when they give it to the captain: the
 * bill is theirs, and they can rate the captain and the dishes on the
 * table's QR code that day.
 */
export function GuestPhoneDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState(order.guest?.name ?? '');
  const [tried, setTried] = useState(false);
  const parsed = IndianMobileSchema.safeParse(phone);

  const save = useMutation({
    mutationFn: (number: string | null) =>
      api.orders.setGuest(order.id, {
        version: order.version,
        phone: number,
        ...(number !== null && name.trim() !== '' ? { name: name.trim() } : {}),
      }),
    onSuccess: (updated) => {
      setOrder(queryClient, updated);
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={t('order.guest.title')}
      description={t('order.guest.description')}
      size="sm"
      footer={
        <>
          {order.guest !== null && (
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t('order.guest.remove')}
            </Button>
          )}
          <Button
            disabled={save.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate(parsed.data);
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (parsed.success) save.mutate(parsed.data);
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        {order.guest !== null && (
          <p className={cn(TYPO.bodyMedium, 'text-muted-foreground')}>
            {t('order.guest.current', { last4: order.guest.phoneLast4 })}
          </p>
        )}
        <Field
          label={t('order.guest.phone')}
          required
          hint={t('order.guest.phoneHint')}
          error={tried && !parsed.success ? t('order.guest.phoneError') : undefined}
        >
          {(p) => (
            <Input
              {...p}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={16}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('order.guest.name')}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
