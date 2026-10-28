import type { MenuItem, MenuSnapshot } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Badge, cn, Input, Search, StickyNote } from '@restroos/ui';
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategorySwatch } from '../../../features/menu/category-swatch';
import { FoodTypeMark } from '../../../features/menu/food-type';
import { localizedName } from '../../../features/menu/localized-name';
import { byOrder } from '../../../features/menu/sort';
import { fromPrice, hasOptions } from '../../../features/orders/item-options';
import { useFormat } from '../../../i18n/use-format';

/**
 * The menu side of the order pad (wireframes §5): categories, search, and
 * item tiles with food marks. Out-of-stock (86'd) dishes are greyed and
 * can't be tapped. Works from the cached menu snapshot (GET /menu, ETag).
 */
export function MenuPanel({
  menu,
  onPick,
  disabled,
  counts,
}: {
  menu: MenuSnapshot;
  onPick: (item: MenuItem) => void;
  disabled: boolean;
  /** Units of each dish on the pad (not yet sent), shown on its tile. */
  counts: ReadonlyMap<string, number>;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const categories = useMemo(
    () =>
      menu.categories
        .filter((c) => c.isActive && menu.items.some((i) => i.isActive && i.categoryId === c.id))
        .sort(byOrder),
    [menu.categories, menu.items],
  );
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const current = categories.find((c) => c.id === category) ?? categories[0] ?? null;

  const items = menu.items
    .filter((i) => i.isActive)
    .filter((i) =>
      query === ''
        ? i.categoryId === current?.id
        : [
            i.name,
            i.shortName ?? '',
            i.nameTranslations.hi ?? '',
            i.nameTranslations.bn ?? '',
            i.sku,
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query),
    )
    .sort(byOrder);

  return (
    <section aria-label={t('order.menu.label')} className="flex min-w-0 flex-col gap-3">
      <label className="relative">
        <span className="sr-only">{t('order.menu.search')}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="ps-10"
          placeholder={t('order.menu.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label={t('menu.categories.title')} className="-mx-1 overflow-x-auto px-1 pb-1">
          <ul className="flex gap-2 lg:flex-col">
            {categories.map((c) => {
              const selected = c.id === current?.id && query === '';
              return (
                <li key={c.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => {
                      setCategory(c.id);
                      setSearch('');
                    }}
                    className={cn(
                      'flex min-h-touch w-full items-center gap-2 rounded-lg border px-3 text-start font-medium whitespace-nowrap lg:whitespace-normal',
                      selected
                        ? 'border-primary bg-accent text-accent-foreground'
                        : 'bg-surface hover:bg-muted',
                    )}
                  >
                    <CategorySwatch color={c.color} />
                    <span lang={lang}>{localizedName(c.name, c.nameTranslations, lang)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        {items.length === 0 ? (
          <p className="text-muted-foreground">{t('menu.items.empty')}</p>
        ) : (
          <ul className="grid content-start gap-2 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
            {items.map((item) => (
              <li key={item.id}>
                <ItemTile
                  item={item}
                  withOptions={hasOptions(item, menu)}
                  count={counts.get(item.id) ?? 0}
                  disabled={disabled}
                  onPick={onPick}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const ItemTile = memo(function ItemTile({
  item,
  withOptions,
  count,
  disabled,
  onPick,
}: {
  item: MenuItem;
  withOptions: boolean;
  count: number;
  disabled: boolean;
  onPick: (item: MenuItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const lang = i18n.language;
  const name = localizedName(item.name, item.nameTranslations, lang);
  const out = !item.isAvailable;
  const price = format.money(Money.ofPaise(fromPrice(item)));
  return (
    <button
      type="button"
      disabled={out || disabled}
      aria-label={
        out
          ? t('order.menu.tileOut', { name })
          : withOptions
            ? t('order.menu.tileOptions', { name, price })
            : t('order.menu.tileAdd', { name, price })
      }
      onClick={() => onPick(item)}
      className={cn(
        'relative flex h-full min-h-24 w-full flex-col justify-between gap-2 rounded-xl border bg-surface p-3 text-start',
        'transition-[background-color,transform] duration-150 hover:bg-muted motion-safe:active:scale-[0.98]',
        'disabled:cursor-not-allowed',
        out && 'border-dashed bg-muted opacity-60',
        count > 0 && 'border-primary',
      )}
    >
      <span className="flex items-start gap-2">
        <FoodTypeMark type={item.foodType} className="mt-1" />
        <span className={cn('font-semibold break-words', out && 'line-through')} lang={lang}>
          {name}
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-semibold tabular-nums">
          {item.variants.length > 0 ? t('order.menu.fromPrice', { price }) : price}
        </span>
        {out ? (
          <Badge variant="danger">{t('order.menu.out')}</Badge>
        ) : withOptions ? (
          <StickyNote aria-hidden="true" className="size-4 text-muted-foreground" />
        ) : null}
      </span>
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -end-1.5 -top-1.5 grid min-w-7 place-items-center rounded-full bg-primary px-1.5 text-sm font-bold text-primary-foreground tabular-nums"
        >
          {format.number(count)}
        </span>
      )}
    </button>
  );
});
