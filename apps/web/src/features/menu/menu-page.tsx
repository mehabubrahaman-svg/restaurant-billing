import { Money } from '@restroos/domain';
import type { Category, MenuItem } from '@restroos/contracts';
import {
  ArrowDown,
  ArrowUp,
  Badge,
  Button,
  Card,
  cn,
  Input,
  ListChecks,
  Pencil,
  Plus,
  Search,
  SegmentedControl,
  Switch,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { api } from '../../api/endpoints';
import { usePermission } from '../auth/permissions';
import { AdminHeader } from '../admin/admin-layout';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { CategoryDialog } from './category-dialog';
import { CategorySwatch } from './category-swatch';
import { FoodTypeMark } from './food-type';
import { localizedName, translationKey } from './localized-name';
import { invalidateMenu, useCategories, useMenuItems } from './menu-queries';
import { byOrder } from './sort';

type Filter = 'active' | 'retired' | 'all';

/** Admin → Menu: categories (sortable) on the side, items grouped by category. */
export function MenuPage() {
  const { t } = useTranslation();
  const categories = useCategories();
  const items = useMenuItems();
  const canToggle = usePermission('menu.toggle_availability');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('menu.title')}
        description={t('menu.description')}
        actions={
          <>
            {canToggle && (
              <Button variant="outline" asChild>
                <Link to="/kitchen/availability">
                  <ListChecks aria-hidden="true" />
                  {t('availability.title')}
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('menu.categories.add')}
            </Button>
            <Button asChild>
              <Link to="/admin/menu/items/new">
                <Plus aria-hidden="true" />
                {t('menu.item.add')}
              </Link>
            </Button>
          </>
        }
      />
      <QueryState query={categories}>
        {({ data: cats }) => (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
            <CategoryPanel
              categories={cats}
              items={items.data?.data ?? []}
              onEdit={(c) => setEditing(c)}
            />
            <QueryState query={items}>
              {({ data }) => <ItemGroups categories={cats} items={data} />}
            </QueryState>
          </div>
        )}
      </QueryState>
      {editing !== null && (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          nextSortOrder={
            ((categories.data?.data ?? []).reduce((m, c) => Math.max(m, c.sortOrder), 0) || 0) + 10
          }
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryPanel({
  categories,
  items,
  onEdit,
}: {
  categories: readonly Category[];
  items: readonly MenuItem[];
  onEdit: (c: Category) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [showRetired, setShowRetired] = useState(false);
  const active = categories.filter((c) => c.isActive).sort(byOrder);
  const retired = categories.filter((c) => !c.isActive).sort(byOrder);
  const lang = translationKey(i18n.language);

  // Renumbers the whole list 10, 20, 30… and saves only the categories that moved.
  const reorder = useMutation({
    mutationFn: async (ordered: readonly Category[]) => {
      for (const [i, c] of ordered.entries()) {
        const sortOrder = (i + 1) * 10;
        if (c.sortOrder !== sortOrder) {
          await api.menu.updateCategory(c.id, { version: c.version, sortOrder });
        }
      }
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
    onSettled: () => invalidateMenu(queryClient),
  });

  function move(index: number, by: -1 | 1) {
    const next = [...active];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(index + by, 0, moved);
    reorder.mutate(next);
  }

  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.isActive) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  }

  const row = (c: Category, index: number | null) => {
    const translated = lang === null ? null : (c.nameTranslations[lang] ?? null);
    return (
      <li key={c.id} className="flex items-center gap-2 py-1">
        <CategorySwatch color={c.color} />
        <a href={`#category-${c.id}`} className="min-w-0 flex-1 rounded py-1 hover:underline">
          <span className={cn('block font-medium break-words', !c.isActive && 'line-through')}>
            {c.name}
          </span>
          <span className="block text-xs text-muted-foreground">
            {translated !== null && (
              <span className="me-2" lang={i18n.language}>
                {translated}
              </span>
            )}
            {t('menu.categories.itemCount', { count: counts.get(c.id) ?? 0 })}
          </span>
        </a>
        {index !== null && (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('menu.categories.moveUp', { name: c.name })}
              disabled={index === 0 || reorder.isPending}
              onClick={() => move(index, -1)}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('menu.categories.moveDown', { name: c.name })}
              disabled={index === active.length - 1 || reorder.isPending}
              onClick={() => move(index, 1)}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('menu.categories.editNamed', { name: c.name })}
          onClick={() => onEdit(c)}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </li>
    );
  };

  return (
    <Card className="flex flex-col gap-2 p-4 lg:sticky lg:top-20">
      <h2 className="text-lg font-semibold">{t('menu.categories.title')}</h2>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('menu.categories.empty')}</p>
      ) : (
        <ol aria-label={t('menu.categories.title')} className="flex flex-col divide-y">
          {active.map((c, i) => row(c, i))}
        </ol>
      )}
      {retired.length > 0 && (
        <>
          <Switch
            className="border-t pt-2"
            label={t('menu.categories.showRetired', { count: retired.length })}
            checked={showRetired}
            onCheckedChange={setShowRetired}
          />
          {showRetired && (
            <ul className="flex flex-col divide-y opacity-80">
              {retired.map((c) => row(c, null))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function ItemGroups({
  categories,
  items,
}: {
  categories: readonly Category[];
  items: readonly MenuItem[];
}) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());

  const groups = useMemo(() => {
    const shown = items.filter(
      (item) =>
        (filter === 'all' || (filter === 'active') === item.isActive) &&
        (query === '' ||
          [item.name, item.sku, item.nameTranslations.hi ?? '', item.nameTranslations.bn ?? '']
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    );
    const sortedCats = [...categories].sort(
      (a, b) => Number(b.isActive) - Number(a.isActive) || byOrder(a, b),
    );
    return sortedCats
      .map((c) => ({
        category: c,
        items: shown.filter((i) => i.categoryId === c.id).sort(byOrder),
      }))
      .filter((g) => g.items.length > 0);
  }, [items, categories, filter, query]);

  return (
    <section aria-label={t('menu.items.title')} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-48 flex-1">
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
        <SegmentedControl<Filter>
          aria-label={t('menu.items.filter')}
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'active', label: t('common.active') },
            { value: 'retired', label: t('common.retired') },
            { value: 'all', label: t('users.all') },
          ]}
        />
      </div>
      {groups.length === 0 && <p className="text-muted-foreground">{t('menu.items.empty')}</p>}
      {groups.map(({ category, items: rows }) => (
        <section
          key={category.id}
          id={`category-${category.id}`}
          aria-labelledby={`category-heading-${category.id}`}
          className="flex scroll-mt-24 flex-col gap-2"
        >
          <h2
            id={`category-heading-${category.id}`}
            className="flex items-center gap-2 text-base font-semibold"
          >
            <CategorySwatch color={category.color} />
            <span>{localizedName(category.name, category.nameTranslations, i18n.language)}</span>
            {!category.isActive && <Badge>{t('common.retired')}</Badge>}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border bg-surface">
            {rows.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function ItemRow({ item }: { item: MenuItem }) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const lang = translationKey(i18n.language);
  const translated = lang === null ? null : (item.nameTranslations[lang] ?? null);
  return (
    <li>
      <Link
        to={`/admin/menu/items/${item.id}`}
        className="flex min-h-touch items-center gap-3 px-3 py-2 hover:bg-muted"
        aria-label={t('menu.item.editNamed', { name: item.name })}
      >
        <FoodTypeMark type={item.foodType} />
        <span className="min-w-0 flex-1">
          <span className={cn('block font-medium break-words', !item.isActive && 'line-through')}>
            {item.name}
          </span>
          <span className="block text-sm break-words text-muted-foreground">
            {lang !== null &&
              (translated === null ? (
                <span className="me-2 italic">{t('menu.item.noTranslation')}</span>
              ) : (
                <span className="me-2 text-foreground" lang={i18n.language}>
                  {translated}
                </span>
              ))}
            <span className="font-mono text-xs">{item.sku}</span>
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="font-semibold tabular-nums">
            {format.money(Money.ofPaise(item.basePrice))}
          </span>
          <span className="flex flex-wrap justify-end gap-1">
            {item.variants.length > 0 && (
              <Badge variant="outline">
                {t('menu.item.variantCount', { count: item.variants.length })}
              </Badge>
            )}
            {item.isActive && !item.isAvailable && (
              <Badge variant="danger">{t('availability.outOfStock')}</Badge>
            )}
            {!item.isActive && <Badge>{t('common.retired')}</Badge>}
          </span>
        </span>
        <Pencil aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
