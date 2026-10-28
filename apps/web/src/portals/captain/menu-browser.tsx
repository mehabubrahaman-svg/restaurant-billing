import type { MenuSnapshot } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Badge, cn, Input, Search } from '@restroos/ui';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryState } from '../../features/admin/query-state';
import { CategorySwatch } from '../../features/menu/category-swatch';
import { FoodTypeMark } from '../../features/menu/food-type';
import { localizedName } from '../../features/menu/localized-name';
import { useMenuSnapshot } from '../../features/menu/menu-queries';
import { byOrder } from '../../features/menu/sort';
import { useFormat } from '../../i18n/use-format';

/**
 * The cached menu (GET /menu with ETag) as captains will order from it in
 * Sprint 4: names in the current UI language, veg/non-veg marks, prices,
 * and out-of-stock items greyed out.
 */
export function MenuBrowser() {
  const snapshot = useMenuSnapshot();
  return (
    <QueryState query={snapshot}>{({ snapshot: menu }) => <Browser menu={menu} />}</QueryState>
  );
}

function Browser({ menu }: { menu: MenuSnapshot }) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const lang = i18n.language;
  const categories = useMemo(
    () => menu.categories.filter((c) => c.isActive).sort(byOrder),
    [menu.categories],
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
        : [i.name, i.nameTranslations.hi ?? '', i.nameTranslations.bn ?? '', i.sku]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query),
    )
    .sort(byOrder);

  return (
    <div className="flex flex-col gap-3">
      <label className="relative">
        <span className="sr-only">{t('menu.items.search')}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="ps-10"
          placeholder={t('menu.items.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <nav aria-label={t('menu.categories.title')} className="overflow-x-auto">
          <ul className="flex gap-2 md:flex-col">
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={c.id === current?.id && query === '' ? 'true' : undefined}
                  onClick={() => {
                    setCategory(c.id);
                    setSearch('');
                  }}
                  className={cn(
                    'flex min-h-touch w-full items-center gap-2 rounded-lg border px-3 text-start font-medium whitespace-nowrap md:whitespace-normal',
                    c.id === current?.id && query === ''
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'bg-surface hover:bg-muted',
                  )}
                >
                  <CategorySwatch color={c.color} />
                  <span lang={lang}>{localizedName(c.name, c.nameTranslations, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {items.length === 0 ? (
          <p className="text-muted-foreground">{t('menu.items.empty')}</p>
        ) : (
          <ul className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex flex-col gap-1 rounded-xl border bg-surface p-3',
                  !item.isAvailable && 'opacity-60',
                )}
              >
                <span className="flex items-start gap-2">
                  <FoodTypeMark type={item.foodType} className="mt-1" />
                  <span className="font-semibold break-words" lang={lang}>
                    {localizedName(item.name, item.nameTranslations, lang)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums">
                    {format.money(Money.ofPaise(item.basePrice))}
                  </span>
                  {!item.isAvailable && (
                    <Badge variant="danger">{t('availability.outOfStock')}</Badge>
                  )}
                </span>
                {item.variants.length > 0 && (
                  <span className="text-sm text-muted-foreground" lang={lang}>
                    {item.variants
                      .map(
                        (v) =>
                          `${localizedName(v.name, v.nameTranslations, lang)} ${format.money(Money.ofPaise(v.price))}`,
                      )
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
