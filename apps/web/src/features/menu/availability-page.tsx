import type { Category, MenuItem } from '@restroos/contracts';
import { Ban, CircleCheck, cn, Input, Search, SegmentedControl } from '@restroos/ui';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { FoodTypeMark } from './food-type';
import { localizedName } from './localized-name';
import { MENU_KEYS, useMenuSnapshot, type CachedSnapshot } from './menu-queries';
import { byOrder } from './sort';

type Filter = 'all' | 'out';
const TOGGLE_KEY = ['menu', 'availability'] as const;

/** Writes one item's availability into the cached snapshot (optimistic update and rollback). */
function setCachedAvailability(client: QueryClient, id: string, isAvailable: boolean) {
  client.setQueryData<CachedSnapshot>(MENU_KEYS.snapshot, (held) =>
    held === undefined
      ? held
      : {
          ...held,
          snapshot: {
            ...held.snapshot,
            items: held.snapshot.items.map((i) => (i.id === id ? { ...i, isAvailable } : i)),
          },
        },
  );
}

/**
 * Kitchen → Out of stock ("86"): every active item with one big switch. The
 * switch flips at once and rolls back if the Hub refuses. Built for 500+
 * items: rows are memoised, search is deferred, and off-screen rows skip
 * layout (content-visibility).
 */
export function AvailabilityPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const errorMessage = useErrorMessage();
  const snapshot = useMenuSnapshot();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());

  const toggle = useMutation({
    mutationKey: TOGGLE_KEY,
    mutationFn: ({ item, isAvailable }: { item: MenuItem; isAvailable: boolean }) =>
      api.menu.setAvailability(item.id, isAvailable),
    onMutate: async ({ item, isAvailable }) => {
      await client.cancelQueries({ queryKey: MENU_KEYS.snapshot });
      setCachedAvailability(client, item.id, isAvailable);
      return { previous: !isAvailable };
    },
    onError: (error, { item }, context) => {
      if (context !== undefined) setCachedAvailability(client, item.id, context.previous);
      toast(t('availability.failed', { name: item.name, reason: errorMessage(error) }), 'danger');
    },
    onSettled: () => {
      // Refetch once the last pending toggle settles, so a refetch never
      // overwrites a switch that is still on its way to the Hub.
      if (client.isMutating({ mutationKey: TOGGLE_KEY }) <= 1) {
        void client.invalidateQueries({ queryKey: MENU_KEYS.all });
      }
    },
  });
  const { mutate } = toggle;
  const onToggle = useCallback(
    (item: MenuItem) => mutate({ item, isAvailable: !item.isAvailable }),
    [mutate],
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <title>{`${t('availability.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t('availability.title')}</h1>
        <p className="text-muted-foreground">{t('availability.description')}</p>
      </header>
      <QueryState query={snapshot}>
        {({ snapshot: menu }) => (
          <AvailabilityList
            items={menu.items}
            categories={menu.categories}
            language={i18n.language}
            query={query}
            filter={filter}
            onToggle={onToggle}
            toolbar={
              <div className="sticky top-16 z-10 -mx-1 flex flex-wrap items-center gap-3 bg-background px-1 py-2">
                <label className="relative min-w-48 flex-1">
                  <span className="sr-only">{t('availability.search')}</span>
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    className="min-h-14 ps-10 text-lg"
                    placeholder={t('availability.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <SegmentedControl<Filter>
                  aria-label={t('availability.filter')}
                  value={filter}
                  onValueChange={setFilter}
                  options={[
                    { value: 'all', label: t('availability.all') },
                    {
                      value: 'out',
                      label: t('availability.outCount', {
                        count: menu.items.filter((i) => i.isActive && !i.isAvailable).length,
                      }),
                    },
                  ]}
                />
              </div>
            }
          />
        )}
      </QueryState>
    </div>
  );
}

function AvailabilityList({
  items,
  categories,
  language,
  query,
  filter,
  onToggle,
  toolbar,
}: {
  items: readonly MenuItem[];
  categories: readonly Category[];
  language: string;
  query: string;
  filter: Filter;
  onToggle: (item: MenuItem) => void;
  toolbar: React.ReactNode;
}) {
  const { t } = useTranslation();
  const categoryNames = useMemo(
    () =>
      new Map(categories.map((c) => [c.id, localizedName(c.name, c.nameTranslations, language)])),
    [categories, language],
  );
  const categoryOrder = useMemo(
    () => new Map([...categories].sort(byOrder).map((c, i) => [c.id, i])),
    [categories],
  );
  // Search text per item, built once per menu/language rather than per keystroke.
  const rows = useMemo(
    () =>
      items
        .filter((i) => i.isActive)
        .sort(
          (a, b) =>
            (categoryOrder.get(a.categoryId) ?? 0) - (categoryOrder.get(b.categoryId) ?? 0) ||
            byOrder(a, b),
        )
        .map((item) => ({
          item,
          label: localizedName(item.name, item.nameTranslations, language),
          haystack: [
            item.name,
            item.sku,
            item.nameTranslations.hi ?? '',
            item.nameTranslations.bn ?? '',
          ]
            .join(' ')
            .toLocaleLowerCase(),
        })),
    [items, categoryOrder, language],
  );
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || !r.item.isAvailable) && (query === '' || r.haystack.includes(query)),
  );

  return (
    <>
      {toolbar}
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{t('availability.empty')}</p>
      ) : (
        <ul
          aria-label={t('availability.listLabel')}
          className="flex flex-col divide-y rounded-xl border bg-surface"
        >
          {shown.map((r) => (
            <AvailabilityRow
              key={r.item.id}
              item={r.item}
              label={r.label}
              category={categoryNames.get(r.item.categoryId) ?? ''}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </>
  );
}

const AvailabilityRow = memo(function AvailabilityRow({
  item,
  label,
  category,
  onToggle,
}: {
  item: MenuItem;
  label: string;
  category: string;
  onToggle: (item: MenuItem) => void;
}) {
  const { t } = useTranslation();
  const available = item.isAvailable;
  return (
    <li className="flex items-center gap-3 px-3 py-2 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto]">
      <FoodTypeMark type={item.foodType} size="lg" />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-lg font-semibold break-words',
            !available && 'text-muted-foreground line-through',
          )}
        >
          {label}
        </span>
        <span className="block text-sm text-muted-foreground">
          {label !== item.name && <span className="me-2">{item.name}</span>}
          {category}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={available}
        aria-label={t('availability.toggleLabel', { name: label })}
        onClick={() => onToggle(item)}
        className={cn(
          'flex min-h-kds min-w-36 shrink-0 items-center justify-center gap-2 rounded-xl border-2 px-3 text-base font-semibold transition-colors duration-150',
          available
            ? 'border-state-available bg-state-available-soft text-state-available-fg'
            : 'border-state-danger bg-state-danger-soft text-state-danger-fg',
        )}
      >
        {available ? (
          <CircleCheck aria-hidden="true" className="size-6 shrink-0" />
        ) : (
          <Ban aria-hidden="true" className="size-6 shrink-0" />
        )}
        <span>{available ? t('availability.available') : t('availability.outOfStock')}</span>
      </button>
    </li>
  );
});
