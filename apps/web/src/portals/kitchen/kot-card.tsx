import type { Kot, KotItem } from '@restroos/contracts';
import {
  Bike,
  Button,
  Check,
  ChefHat,
  cn,
  Flag,
  ShoppingBag,
  TriangleAlert,
  UtensilsCrossed,
} from '@restroos/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { KotTarget } from '../../api/endpoints';
import { FoodTypeMark } from '../../features/menu/food-type';
import { useDishName } from '../../features/menu/use-dish-name';
import { useElapsed } from '../../features/orders/elapsed';
import type { KotUrgency } from '../../features/kitchen/kot-timing';
import { ReprintKotButton } from '../../features/kitchen/reprint-kot-button';
import { useFormat } from '../../i18n/use-format';

const URGENCY_CLASSES: Readonly<Record<KotUrgency, string>> = {
  normal: 'border-border bg-surface',
  warn: 'border-state-reserved bg-state-reserved-soft',
  late: 'border-state-danger bg-state-danger-soft kds-late',
};

const ACTION_KEYS = {
  ACCEPTED: 'kds.action.accept',
  COOKING: 'kds.action.start',
  READY: 'kds.action.ready',
  SERVED: 'kds.action.served',
} as const satisfies Record<KotTarget, string>;

/** Item lines the kitchen can still bump to ready. */
function bumpable(kot: Kot, item: KotItem): boolean {
  return (
    (item.status === 'SENT' || item.status === 'PREPARING') &&
    kot.status !== 'READY' &&
    kot.status !== 'SERVED'
  );
}

/**
 * One KOT on the board (wireframes §6): number, table or token, type and
 * age; captain and chef; the items (notes in capitals with a flag,
 * cancelled lines struck through); and one big button for the next step.
 */
export const KotCard = memo(function KotCard({
  kot,
  now,
  urgency,
  next,
  fresh,
  canAct,
  canAssign,
  busy,
  onAdvance,
  onBump,
  onAssign,
}: {
  kot: Kot;
  now: number;
  urgency: KotUrgency;
  next: KotTarget;
  /** Arrived over the live feed a moment ago: slides in. */
  fresh: boolean;
  canAct: boolean;
  canAssign: boolean;
  busy: boolean;
  onAdvance: (kot: Kot, to: KotTarget) => void;
  onBump: (kot: Kot, item: KotItem) => void;
  onAssign: (kot: Kot) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const dish = useDishName();
  const elapsed = useElapsed();
  const titleId = `kot-${kot.id}`;
  const TypeIcon =
    kot.orderType === 'DELIVERY'
      ? Bike
      : kot.orderType === 'DINE_IN'
        ? UtensilsCrossed
        : ShoppingBag;
  const where =
    kot.tableLabel ??
    (kot.tokenNo === null
      ? t('order.number', { orderNo: kot.orderNo })
      : t('order.token', { token: kot.tokenNo }));
  const age =
    kot.status === 'READY' && kot.readyAt !== null
      ? t('kds.readyFor', { elapsed: elapsed(kot.readyAt, now) })
      : elapsed(kot.firedAt, now);

  return (
    <article
      aria-labelledby={titleId}
      data-urgency={urgency}
      data-kot={kot.kotNo}
      className={cn(
        'flex flex-col gap-2 rounded-xl border-2 p-3 [contain-intrinsic-size:auto_16rem] [content-visibility:auto]',
        URGENCY_CLASSES[urgency],
        fresh && 'kds-enter',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 id={titleId} className="text-xl leading-tight font-bold">
            {t('kds.kotTitle', { kotNo: kot.kotNo, where })}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <TypeIcon aria-hidden="true" className="size-4" />
            <span>{t(`orderTypes.${kot.orderType}`)}</span>
            {kot.captainName !== null && <span>{kot.captainName}</span>}
          </p>
        </div>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 text-lg font-semibold tabular-nums',
            urgency === 'late' && 'text-state-danger-fg',
            urgency === 'warn' && 'text-state-reserved-fg',
          )}
        >
          {urgency === 'late' && (
            <TriangleAlert
              aria-label={t('kds.late')}
              className="size-5 motion-safe:animate-pulse"
            />
          )}
          {age}
        </span>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <ChefHat aria-hidden="true" className="size-4 text-muted-foreground" />
          {kot.assignedChefName === null
            ? t('kds.chefNone')
            : t('kds.chef', { name: kot.assignedChefName })}
        </span>
        <span className="flex flex-wrap gap-2">
          <ReprintKotButton kotId={kot.id} kotNo={kot.kotNo} iconOnly />
          {canAssign && (
            <Button variant="outline" size="touch" onClick={() => onAssign(kot)}>
              {kot.assignedChefName === null ? t('kds.assign') : t('kds.reassign')}
            </Button>
          )}
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-border border-y">
        {kot.items.map((item) => {
          const canBump = canAct && bumpable(kot, item);
          const cancelled = item.status === 'CANCELLED';
          const ready = item.status === 'READY' || item.status === 'SERVED';
          const body = (
            <>
              <span className="flex items-start gap-2">
                <span className="w-9 shrink-0 text-xl font-bold tabular-nums">
                  {format.number(item.quantity)}
                </span>
                <FoodTypeMark type={item.foodType} className="mt-1.5" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      'text-lg leading-snug font-semibold break-words',
                      cancelled && 'text-muted-foreground line-through',
                    )}
                  >
                    {dish(item).variantName === null
                      ? dish(item).name
                      : t('order.line.withVariant', {
                          name: dish(item).name,
                          variant: dish(item).variantName,
                        })}
                  </span>
                  {item.addons.map((a) => (
                    <span key={a.name} className={cn('text-base', cancelled && 'line-through')}>
                      {t('kds.addon', { name: a.name, quantity: a.quantity })}
                    </span>
                  ))}
                  {item.specialNote !== null && item.specialNote !== '' && (
                    <span className="flex items-center gap-1.5 text-base font-bold text-state-reserved-fg uppercase">
                      <Flag aria-label={t('kds.note')} className="size-4 shrink-0" />
                      <span className="break-words">{item.specialNote.toLocaleUpperCase()}</span>
                    </span>
                  )}
                  {cancelled && (
                    <span className="text-sm text-state-danger-fg">
                      {item.cancelReason === null
                        ? t('order.line.cancelled')
                        : t('order.line.cancelledReason', { reason: item.cancelReason })}
                    </span>
                  )}
                </span>
                {ready && (
                  <Check
                    aria-label={t('order.line.ready')}
                    className="mt-1 size-6 shrink-0 text-state-available-fg"
                  />
                )}
              </span>
            </>
          );
          return (
            <li key={item.id} data-status={item.status}>
              {canBump ? (
                <button
                  type="button"
                  aria-label={t('kds.bump', { quantity: item.quantity, name: dish(item).name })}
                  aria-describedby={titleId}
                  className="w-full rounded-lg px-1 py-2 text-start hover:bg-muted"
                  onClick={() => onBump(kot, item)}
                >
                  {body}
                </button>
              ) : (
                <div className={cn('px-1 py-2', ready && 'opacity-70')}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {canAct && (
        <Button
          size="kds"
          variant={next === 'READY' ? 'primary' : 'secondary'}
          className="w-full"
          disabled={busy}
          onClick={() => onAdvance(kot, next)}
        >
          {next === 'READY' && <Check aria-hidden="true" />}
          {t(ACTION_KEYS[next])}
        </Button>
      )}
    </article>
  );
});
