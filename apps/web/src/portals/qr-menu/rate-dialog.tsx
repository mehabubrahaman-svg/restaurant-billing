import { IndianMobileSchema, type RatableOrder } from '@restroos/contracts';
import { Alert, Button, CircleCheck, Dialog, Field, Input, Textarea } from '@restroos/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { localizedName } from '../../features/menu/localized-name';
import { StarInput } from '../../features/ratings/stars';
import { useFormat } from '../../i18n/use-format';
import { photoUrl } from '../../lib/dish-photos';
import { useErrorMessage } from '../../lib/errors';

type Step =
  | { kind: 'phone' }
  | { kind: 'choose'; phone: string; orders: RatableOrder[] }
  | { kind: 'rate'; phone: string; order: RatableOrder }
  | { kind: 'thanks' };

/**
 * "Rate your meal": the guest gives the phone number they told the captain,
 * picks today's order if there are several, and rates the captain and each
 * dish. Once per order.
 */
export function RateDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: 'phone' });

  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={t('qr.rate.title')}
      {...(step.kind === 'phone' ? { description: t('qr.rate.phoneDescription') } : {})}
    >
      {step.kind === 'phone' && (
        <PhoneStep
          token={token}
          onFound={(phone, orders) => {
            const open = orders.filter((o) => !o.rated);
            setStep(
              open.length === 1
                ? { kind: 'rate', phone, order: open[0]! }
                : { kind: 'choose', phone, orders },
            );
          }}
        />
      )}
      {step.kind === 'choose' && (
        <ChooseStep
          orders={step.orders}
          onChoose={(order) => setStep({ kind: 'rate', phone: step.phone, order })}
        />
      )}
      {step.kind === 'rate' && (
        <RateStep
          token={token}
          phone={step.phone}
          order={step.order}
          onDone={() => setStep({ kind: 'thanks' })}
        />
      )}
      {step.kind === 'thanks' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
          <CircleCheck aria-hidden="true" className="size-12 text-state-available" />
          <p className="text-lg font-semibold">{t('qr.rate.thanks')}</p>
          <p className="text-muted-foreground">{t('qr.rate.thanksNote')}</p>
          <Button className="mt-2" onClick={onClose}>
            {t('qr.rate.backToMenu')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function PhoneStep({
  token,
  onFound,
}: {
  token: string;
  onFound: (phone: string, orders: RatableOrder[]) => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);
  const parsed = IndianMobileSchema.safeParse(phone);
  const find = useMutation({
    mutationFn: (number: string) => api.qr.findOrders(token, number),
    onSuccess: (r, number) => {
      if (r.orders.some((o) => !o.rated)) onFound(number, r.orders);
    },
  });
  const nothing = find.isSuccess && find.data.orders.length === 0;
  const allRated =
    find.isSuccess && find.data.orders.length > 0 && find.data.orders.every((o) => o.rated);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (parsed.success) find.mutate(parsed.data);
      }}
    >
      <Field
        label={t('qr.rate.phone')}
        required
        error={tried && !parsed.success ? t('order.guest.phoneError') : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={16}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      {find.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(find.error)}
        </Alert>
      )}
      {nothing && (
        <Alert tone="info" role="status">
          {t('qr.rate.notFound')}
        </Alert>
      )}
      {allRated && (
        <Alert tone="success" role="status">
          {t('qr.rate.allRated')}
        </Alert>
      )}
      <Button type="submit" disabled={find.isPending}>
        {find.isPending ? t('qr.rate.finding') : t('qr.rate.find')}
      </Button>
    </form>
  );
}

function ChooseStep({
  orders,
  onChoose,
}: {
  orders: RatableOrder[];
  onChoose: (order: RatableOrder) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">{t('qr.rate.choose')}</p>
      <ul className="flex flex-col gap-2">
        {orders.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              disabled={o.rated}
              className="flex min-h-touch w-full flex-col items-start gap-0.5 rounded-xl border p-3 text-start hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onChoose(o)}
            >
              <span className="font-semibold">
                {o.tableLabel === null
                  ? t('order.number', { orderNo: o.orderNo })
                  : t('qr.rate.orderAtTable', { orderNo: o.orderNo, table: o.tableLabel })}
                {' · '}
                {format.dateTime(o.openedAt, { hour: 'numeric', minute: '2-digit' })}
              </span>
              <span className="text-sm text-muted-foreground">
                {o.rated ? t('qr.rate.rated') : t('qr.rate.dishCount', { count: o.dishes.length })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RateStep({
  token,
  phone,
  order,
  onDone,
}: {
  token: string;
  phone: string;
  order: RatableOrder;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const errorMessage = useErrorMessage();
  const [captainStars, setCaptainStars] = useState<number | null>(null);
  const [dishStars, setDishStars] = useState<Record<string, number>>({});
  const [dishNotes, setDishNotes] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const rated = Object.keys(dishStars).length;
  const send = useMutation({
    mutationFn: () =>
      api.qr.rate(token, {
        orderId: order.id,
        phone,
        captainStars,
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        dishes: order.dishes
          .filter((d) => dishStars[d.menuItemId] !== undefined)
          .map((d) => ({
            menuItemId: d.menuItemId,
            stars: dishStars[d.menuItemId]!,
            ...(dishNotes[d.menuItemId]?.trim()
              ? { comment: dishNotes[d.menuItemId]!.trim() }
              : {}),
          })),
      }),
    onSuccess: onDone,
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      {order.captainName !== null && (
        <StarInput
          size="lg"
          legend={t('qr.rate.captain', { name: order.captainName })}
          value={captainStars}
          onChange={setCaptainStars}
        />
      )}
      <section aria-labelledby="rate-dishes" className="flex flex-col gap-4">
        <h3 id="rate-dishes" className="font-semibold">
          {t('qr.rate.dishes')}
        </h3>
        {order.dishes.map((d) => {
          const name = localizedName(d.name, d.nameTranslations, i18n.language);
          const stars = dishStars[d.menuItemId] ?? null;
          return (
            <div key={d.menuItemId} className="flex gap-3">
              {d.imageId !== null && (
                <img
                  src={photoUrl(d.imageId)}
                  alt=""
                  width={56}
                  height={56}
                  loading="lazy"
                  className="size-14 shrink-0 rounded-lg bg-muted object-cover"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <StarInput
                  legend={name}
                  value={stars}
                  onChange={(n) => setDishStars((s) => ({ ...s, [d.menuItemId]: n }))}
                />
                {stars !== null && (
                  <Input
                    aria-label={t('qr.rate.dishNote', { name })}
                    placeholder={t('qr.rate.dishNoteHint')}
                    maxLength={300}
                    value={dishNotes[d.menuItemId] ?? ''}
                    onChange={(e) =>
                      setDishNotes((s) => ({ ...s, [d.menuItemId]: e.target.value }))
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </section>
      <Field label={t('qr.rate.comment')}>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
      </Field>
      {send.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(send.error)}
        </Alert>
      )}
      <Button type="submit" disabled={send.isPending || (captainStars === null && rated === 0)}>
        {send.isPending ? t('qr.sending') : t('qr.rate.send')}
      </Button>
    </form>
  );
}
