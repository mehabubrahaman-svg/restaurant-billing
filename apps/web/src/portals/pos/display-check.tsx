import { Money } from '@restroos/domain';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StateChip,
  type KotState,
  type TableState,
} from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';

const TABLE_STATES = ['available', 'occupied', 'billing', 'reserved', 'cleaning'] as const;
const KOT_STATES = ['new', 'accepted', 'cooking', 'ready', 'served', 'delayed'] as const;

/** Sample elapsed minutes so chips show realistic metadata. */
const TABLE_MINUTES: Partial<Record<TableState, number>> = { occupied: 32, billing: 48 };
const KOT_MINUTES: Partial<Record<KotState, number>> = { cooking: 6, delayed: 18 };

/** Values from the POS wireframe (§7), in paise. */
const AMOUNTS = [
  { key: 'pos.preview.subtotal', amount: Money.ofPaise(2_20_000) },
  { key: 'pos.preview.total', amount: Money.ofPaise(2_07_800) },
  { key: 'pos.preview.daySales', amount: Money.ofPaise(1_84_22_000) },
] as const;

/**
 * Until billing is built (Sprint 5) the POS page shows the shared state chips
 * and money formatting, so every language and theme can be checked on the
 * real device at 768 px and 1366 px.
 */
export function DisplayCheck() {
  const { t } = useTranslation();
  const format = useFormat();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pos.preview.title')}</CardTitle>
        <CardDescription>{t('pos.preview.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('pos.preview.tables')}</h4>
          <ul className="flex flex-wrap gap-2">
            {TABLE_STATES.map((state) => {
              const minutes = TABLE_MINUTES[state];
              return (
                <li key={state}>
                  <StateChip
                    state={state}
                    label={t(`state.table.${state}`)}
                    {...(minutes === undefined ? {} : { meta: t('time.minutes', { minutes }) })}
                  />
                </li>
              );
            })}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('pos.preview.kots')}</h4>
          <ul className="flex flex-wrap gap-2">
            {KOT_STATES.map((state) => {
              const minutes = KOT_MINUTES[state];
              return (
                <li key={state}>
                  <StateChip
                    state={state}
                    label={t(`state.kot.${state}`)}
                    {...(minutes === undefined ? {} : { meta: t('time.minutes', { minutes }) })}
                  />
                </li>
              );
            })}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t('pos.preview.amounts')}</h4>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {AMOUNTS.map(({ key, amount }) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{t(key)}</dt>
                <dd className="text-end font-semibold tabular-nums">{format.money(amount)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </CardContent>
    </Card>
  );
}
