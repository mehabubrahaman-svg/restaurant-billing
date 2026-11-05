import type { QrMenu } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Badge, BookOpen, Button, cn, Crown, Dialog, Stepper } from '@restroos/ui';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FoodTypeMark } from '../../features/menu/food-type';
import { localizedName } from '../../features/menu/localized-name';
import { useFormat } from '../../i18n/use-format';
import { photoUrl } from '../../lib/dish-photos';
import { matchRanges, splitDescription } from './menu-search';

export type Item = QrMenu['items'][number];
export type Category = QrMenu['categories'][number];

/** The dish's lowest price: its smallest size when it has sizes. */
export const fromPrice = (item: Item) =>
  item.variants.length > 0 ? Math.min(...item.variants.map((v) => v.price)) : item.price;
/** Sizes or add-ons to choose before it goes in the order. */
export const hasOptions = (item: Item) => item.variants.length > 0 || item.addonGroupIds.length > 0;

export function useMoney() {
  const format = useFormat();
  return (paise: number) => format.money(Money.ofPaise(paise));
}

/** `text` with the query's words marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = query ? matchRanges(text, query) : [];
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-primary/15 px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * One dish in the list: what it is, its price, a short line, and its photo
 * with Add on it. Tapping the name or photo opens the dish.
 */
export function DishCard({
  item,
  query,
  popular,
  quantity,
  categoryName,
  onOpen,
  onAdd,
  onChange,
}: {
  item: Item;
  query: string;
  popular: boolean;
  /** How many of it are in the order already. */
  quantity: number;
  /** Shown in search results, where dishes from every section mix. */
  categoryName?: string | undefined;
  onOpen: () => void;
  onAdd: () => void;
  /** A new quantity for a dish without options (0 takes it out). */
  onChange: (quantity: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const lang = i18n.language;
  const name = localizedName(item.name, item.nameTranslations, lang);
  const description = item.description
    ? splitDescription(localizedName(item.description, item.descriptionTranslations, lang)).lead
    : '';
  const price = fromPrice(item);
  const options = hasOptions(item);

  const control = !item.isAvailable ? (
    <span className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground">
      {t('qr.unavailable')}
    </span>
  ) : quantity > 0 && !options ? (
    <Stepper
      value={quantity}
      min={0}
      max={20}
      onValueChange={onChange}
      decrementLabel={t('qr.less', { name })}
      incrementLabel={t('qr.more', { name })}
      className="rounded-lg bg-surface shadow-md"
    />
  ) : (
    <Button
      size="sm"
      variant="outline"
      aria-label={t('qr.addNamed', { name })}
      className="min-w-24 border-primary bg-surface font-semibold text-primary uppercase shadow-md"
      onClick={onAdd}
    >
      {t('qr.add')}
      {quantity > 0 && <span className="ms-1 tabular-nums">· {quantity}</span>}
    </Button>
  );

  return (
    <article
      className={cn('flex gap-4 py-4', !item.isAvailable && 'opacity-70')}
      aria-labelledby={`dish-${item.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <FoodTypeMark type={item.foodType} size="sm" />
          {popular && (
            <Badge variant="warning" className="gap-1 text-xs font-semibold">
              <Crown aria-hidden="true" className="size-3.5" />
              {t('qr.bestseller')}
            </Badge>
          )}
          {categoryName && <span className="text-xs text-muted-foreground">{categoryName}</span>}
        </div>
        <h3 id={`dish-${item.id}`} className="text-base leading-snug font-semibold">
          <button type="button" className="text-start break-words hover:underline" onClick={onOpen}>
            <Highlight text={name} query={query} />
          </button>
        </h3>
        <p className="font-medium tabular-nums">
          {item.variants.length > 0 ? t('qr.from', { price: money(price) }) : money(price)}
        </p>
        {description && (
          <p className="line-clamp-2 text-sm break-words text-muted-foreground">{description}</p>
        )}
        {options && item.isAvailable && (
          <span className="text-xs text-muted-foreground">{t('qr.customisable')}</span>
        )}
      </div>
      <div className="flex w-32 shrink-0 flex-col items-center">
        {item.imageId !== null ? (
          <>
            <button
              type="button"
              className="block overflow-hidden rounded-2xl bg-muted"
              aria-label={t('qr.seeDish', { name })}
              onClick={onOpen}
            >
              <img
                src={photoUrl(item.imageId)}
                alt=""
                loading="lazy"
                decoding="async"
                width={128}
                height={128}
                className="size-32 object-cover"
              />
            </button>
            <div className="-mt-5">{control}</div>
          </>
        ) : (
          <div className="mt-2">{control}</div>
        )}
      </div>
    </article>
  );
}

/**
 * The sections across the top: follows the page as it scrolls (the section
 * in view is marked), and takes the guest to a section when tapped.
 */
export function CategoryBar({
  categories,
  active,
  onJump,
}: {
  categories: { category: Category; count: number }[];
  active: string | null;
  onJump: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const bar = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const chip = bar.current?.querySelector<HTMLElement>(`[data-category="${active}"]`);
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [active]);
  return (
    <nav
      aria-label={t('qr.categories')}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]"
    >
      <ul ref={bar} className="flex gap-2 pb-1">
        {categories.map(({ category: c }) => (
          <li key={c.id}>
            <button
              type="button"
              data-category={c.id}
              aria-current={active === c.id ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                active === c.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-surface text-foreground hover:bg-muted',
              )}
              onClick={() => onJump(c.id)}
            >
              {localizedName(c.name, c.nameTranslations, i18n.language)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Every section with how many dishes it has: the guest jumps straight there. */
export function CategorySheet({
  categories,
  active,
  onJump,
  onClose,
}: {
  categories: { category: Category; count: number }[];
  active: string | null;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={t('qr.browseMenu')}
      size="sm"
    >
      <ul className="flex flex-col">
        {categories.map(({ category: c, count }) => (
          <li key={c.id}>
            <button
              type="button"
              aria-current={active === c.id ? 'true' : undefined}
              className={cn(
                'flex min-h-touch w-full items-center justify-between gap-3 rounded-lg px-3 text-start',
                active === c.id ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted',
              )}
              onClick={() => onJump(c.id)}
            >
              <span className="break-words">
                {localizedName(c.name, c.nameTranslations, i18n.language)}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {format.number(count)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** The floating "Menu" button that opens the sections. */
export function MenuButton({ raised, onClick }: { raised: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      className={cn(
        'fixed end-4 z-30 rounded-full bg-foreground px-5 text-background shadow-xl hover:bg-foreground/90',
        raised ? 'bottom-24' : 'bottom-5',
      )}
      onClick={onClick}
    >
      <BookOpen aria-hidden="true" />
      {t('qr.menuButton')}
    </Button>
  );
}

/** Bestsellers as a strip of photo cards across the top of the menu. */
export function PopularStrip({ items, onOpen }: { items: Item[]; onOpen: (item: Item) => void }) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="qr-popular" className="flex flex-col gap-3">
      <h2 id="qr-popular" className="flex items-center gap-2 text-lg font-bold">
        <Crown aria-hidden="true" className="size-5 text-primary" />
        {t('qr.popular')}
      </h2>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((item) => {
          const name = localizedName(item.name, item.nameTranslations, i18n.language);
          return (
            <li key={item.id} className="w-40 shrink-0 snap-start">
              <button
                type="button"
                className="flex w-full flex-col gap-1.5 text-start"
                aria-label={t('qr.seeDish', { name })}
                onClick={() => onOpen(item)}
              >
                <span className="block aspect-square overflow-hidden rounded-2xl bg-muted">
                  {item.imageId !== null && (
                    <img
                      src={photoUrl(item.imageId)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={160}
                      height={160}
                      className="size-full object-cover"
                    />
                  )}
                </span>
                <span className="flex items-start gap-1.5">
                  <FoodTypeMark type={item.foodType} size="sm" className="mt-0.5 shrink-0" />
                  <span className="line-clamp-2 text-sm font-semibold break-words">{name}</span>
                </span>
                <span className="text-sm tabular-nums">
                  {item.variants.length > 0
                    ? t('qr.from', { price: money(fromPrice(item)) })
                    : money(item.price)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Placeholder cards while the menu loads. */
export function MenuSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-4">
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-4 py-2">
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="size-32 animate-pulse rounded-2xl bg-muted" />
        </div>
      ))}
    </div>
  );
}
