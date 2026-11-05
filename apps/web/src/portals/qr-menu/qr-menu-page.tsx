import type { QrMenu, QrRequestStatusResponse } from '@restroos/contracts';
import {
  Alert,
  BellRing,
  Button,
  Card,
  CardContent,
  cn,
  Dialog,
  FoodMark,
  Input,
  QrCode,
  ReceiptText,
  Search,
  Select,
  ShoppingBag,
  Stepper,
  X,
} from '@restroos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { localizedName } from '../../features/menu/localized-name';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useErrorMessage } from '../../lib/errors';
import {
  addLine,
  addPlain,
  loadCart,
  MAX_QUANTITY,
  quantities,
  saveCart,
  setQuantity,
  type CartLine,
} from './cart';
import { DishSheet } from './dish-sheet';
import {
  CategoryBar,
  CategorySheet,
  DishCard,
  fromPrice,
  hasOptions,
  MenuButton,
  MenuSkeleton,
  PopularStrip,
  useMoney,
  type Category,
  type Item,
} from './menu-parts';
import { queryTokens, searchMenu } from './menu-search';

type FoodType = Item['foodType'];
type Sort = 'recommended' | 'priceLow' | 'priceHigh';
const SORTS: readonly Sort[] = ['recommended', 'priceLow', 'priceHigh'];
/** The kinds a guest can narrow the menu to, in the order the chips show. */
const FOOD_FILTERS: readonly Exclude<FoodType, 'NA'>[] = ['VEG', 'EGG', 'NON_VEG', 'VEGAN'];

/** While a sent request waits for a captain, the phone checks this often. */
export const STATUS_POLL_MS = 5_000;

/** Guest self-ordering (public, phone-first): no staff shell, no sign-in. */
export function QrMenuPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const menu = useQuery({
    queryKey: ['qr-menu', token],
    queryFn: () => api.qr.menu(token),
    retry: false,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pt-4 pb-32">
      <title>
        {menu.data
          ? `${menu.data.branchName} · ${t('qr.table', { table: menu.data.tableLabel })}`
          : t('portals.qrMenu.title')}
      </title>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <QrCode aria-hidden="true" className="size-6" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-lg leading-tight font-bold break-words">
              {menu.data?.branchName ?? t('portals.qrMenu.title')}
            </span>
            {menu.data && (
              <span className="text-sm text-muted-foreground">
                {t('qr.table', { table: menu.data.tableLabel })}
              </span>
            )}
          </div>
        </div>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-col gap-4">
        {menu.isPending ? (
          <MenuSkeleton />
        ) : menu.isError ? (
          <Card>
            <CardContent className="pt-5">
              <p role="alert">{t('qr.unknown')}</p>
            </CardContent>
          </Card>
        ) : (
          <Ordering token={token} menu={menu.data} />
        )}
      </main>
    </div>
  );
}

/** Available dishes before the ones that have run out; by price when asked. Keeps order otherwise. */
function arrange(items: readonly Item[], sort: Sort): Item[] {
  return [...items].sort(
    (a, b) =>
      Number(b.isAvailable) - Number(a.isAvailable) ||
      (sort === 'priceLow' ? fromPrice(a) - fromPrice(b) : 0) ||
      (sort === 'priceHigh' ? fromPrice(b) - fromPrice(a) : 0),
  );
}

/** A Veg filter shows vegan dishes too: they are vegetarian. */
const ofKind = (item: Item, kinds: readonly FoodType[]) =>
  kinds.length === 0 ||
  kinds.includes(item.foodType) ||
  (item.foodType === 'VEGAN' && kinds.includes('VEG'));

/** The element's height, kept up to date as it wraps or changes. */
function useHeight(ref: RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const update = () => setHeight(element.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

const prefersLessMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Ordering({ token, menu }: { token: string; menu: QrMenu }) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const errorMessage = useErrorMessage();
  const lang = i18n.language;
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(token, menu));
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query);
  const [kinds, setKinds] = useState<FoodType[]>([]);
  const [sort, setSort] = useState<Sort>('recommended');
  const [opened, setOpened] = useState<Item | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sent, setSent] = useState<QrRequestStatusResponse[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const spyPausedUntil = useRef(0);
  const stickyHeight = useHeight(sticky);

  useEffect(() => saveCart(token, cart), [token, cart]);

  const categories = useMemo(
    () =>
      [...menu.categories].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [menu],
  );
  const categoryNames = useMemo(
    () => new Map(categories.map((c) => [c.id, localizedName(c.name, c.nameTranslations, lang)])),
    [categories, lang],
  );
  const popular = useMemo(() => new Set(menu.popularItemIds), [menu]);
  const kindsOnMenu = FOOD_FILTERS.filter((k) => menu.items.some((i) => i.foodType === k));
  const shown = useMemo(
    () =>
      arrange(
        menu.items.filter((i) => ofKind(i, kinds)),
        sort,
      ),
    [menu, kinds, sort],
  );
  const sections = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          items: shown.filter((i) => i.categoryId === category.id),
        }))
        .filter((s) => s.items.length > 0),
    [categories, shown],
  );
  const searching = queryTokens(search).length > 0;
  const found = useMemo(
    () => (searching ? arrange(searchMenu(shown, menu, search), sort) : []),
    [searching, shown, menu, search, sort],
  );
  const bestsellers = useMemo(
    () =>
      menu.popularItemIds
        .map((id) => shown.find((i) => i.id === id))
        .filter((i): i is Item => i !== undefined && i.isAvailable),
    [menu, shown],
  );
  const inOrder = useMemo(() => quantities(cart), [cart]);
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  const total = cart.reduce((n, l) => n + l.unit * l.quantity, 0);
  const taxExtra = menu.items.some((i) => !i.taxIncluded);
  const sectionKey = sections.map((s) => s.category.id).join();

  // The section chip follows the page: the topmost section under the search bar is marked.
  useEffect(() => {
    if (searching || typeof IntersectionObserver === 'undefined') return;
    const ids = sectionKey.split(',');
    const inView = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.section!;
          if (e.isIntersecting) inView.add(id);
          else inView.delete(id);
        }
        if (Date.now() < spyPausedUntil.current) return;
        const top = ids.find((id) => inView.has(id));
        if (top !== undefined) setActive(top);
      },
      { rootMargin: `-${stickyHeight + 1}px 0px -55% 0px` },
    );
    document.querySelectorAll('[data-section]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [searching, sectionKey, stickyHeight]);

  // Results start under the search bar, not somewhere far above the guest's thumb.
  useEffect(() => {
    if (!searching || results.current === null) return;
    const top = Math.max(
      0,
      results.current.getBoundingClientRect().top + window.scrollY - stickyHeight - 8,
    );
    if (window.scrollY > top) window.scrollTo({ top });
    // Only when a search starts: typing more shouldn't jump the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  function jump(id: string) {
    setBrowsing(false);
    setActive(id);
    spyPausedUntil.current = Date.now() + 900;
    // After the section list has closed (and handed focus back), go to the section.
    setTimeout(() => {
      const section = document.getElementById(`cat-${id}`);
      section?.scrollIntoView?.({
        behavior: prefersLessMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }, 0);
  }

  const call = useMutation({
    mutationFn: (kind: 'WAITER' | 'BILL') =>
      api.qr.submit(token, { kind, clientKey: newIdempotencyKey() }),
    onSuccess: (request) => setSent((s) => [request, ...s]),
  });

  const add = (item: Item) =>
    hasOptions(item) ? setOpened(item) : setCart((c) => addPlain(c, item));
  const card = (item: Item, categoryName?: string) => (
    <DishCard
      key={item.id}
      item={item}
      query={search}
      popular={popular.has(item.id)}
      quantity={inOrder.get(item.id) ?? 0}
      categoryName={categoryName}
      onOpen={() => setOpened(item)}
      onAdd={() => add(item)}
      onChange={(q) => setCart((c) => setQuantity(c, item, Math.min(MAX_QUANTITY, q)))}
    />
  );
  const sectionList = sections.map((s) => ({ category: s.category, count: s.items.length }));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={call.isPending}
          onClick={() => call.mutate('WAITER')}
        >
          <BellRing aria-hidden="true" />
          {t('qr.callWaiter')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={call.isPending}
          onClick={() => call.mutate('BILL')}
        >
          <ReceiptText aria-hidden="true" />
          {t('qr.askBill')}
        </Button>
      </div>
      {call.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(call.error)}
        </Alert>
      )}
      {sent.map((request) => (
        <SentRequest key={request.id} token={token} request={request} />
      ))}

      <div
        ref={sticky}
        className="sticky top-0 z-20 -mx-4 flex flex-col gap-2.5 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div role="search" className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={input}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('qr.search')}
            placeholder={t('qr.searchHint')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') {
                e.preventDefault();
                setQuery('');
              } else if (e.key === 'Enter') {
                // "Search" on a phone keyboard: put the keyboard away to show the results.
                e.currentTarget.blur();
              }
            }}
            className="rounded-full ps-11 pe-12 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query !== '' && (
            <button
              type="button"
              aria-label={t('qr.clearSearch')}
              className="absolute end-0.5 top-1/2 grid size-touch -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {kindsOnMenu.length > 1 && (
            <div
              role="group"
              aria-label={t('qr.showOnly')}
              className="-ms-1 flex min-w-0 flex-1 gap-2 overflow-x-auto ps-1 [scrollbar-width:none]"
            >
              {kindsOnMenu.map((kind) => {
                const on = kinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={on}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'bg-surface hover:bg-muted',
                    )}
                    onClick={() =>
                      setKinds((k) => (on ? k.filter((x) => x !== kind) : [...k, kind]))
                    }
                  >
                    <span aria-hidden="true" className="flex">
                      <FoodMark type={kind} label={t(`menu.foodTypes.${kind}`)} size="sm" />
                    </span>
                    {t(`menu.foodTypes.${kind}`)}
                  </button>
                );
              })}
            </div>
          )}
          <Select
            aria-label={t('qr.sort')}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className={cn('shrink-0', kindsOnMenu.length > 1 ? 'w-40' : 'ms-auto w-48')}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`qr.sorts.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {!searching && sections.length > 1 && (
          <CategoryBar categories={sectionList} active={active} onJump={jump} />
        )}
      </div>

      <div ref={results} className="flex flex-col gap-6">
        {searching ? (
          <section aria-label={t('qr.search')} className="flex flex-col">
            <p role="status" className="text-sm text-muted-foreground">
              {found.length > 0 ? t('qr.results', { count: found.length }) : ''}
            </p>
            {found.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Search aria-hidden="true" className="size-10 text-muted-foreground/60" />
                <p className="font-semibold break-words">
                  {t('qr.noResults', { query: search.trim() })}
                </p>
                <p className="text-sm text-muted-foreground">{t('qr.noResultsHint')}</p>
                <Button variant="outline" className="mt-2" onClick={() => setQuery('')}>
                  {t('qr.fullMenu')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col divide-y">
                {found.map((item) => card(item, categoryNames.get(item.categoryId)))}
              </div>
            )}
          </section>
        ) : sections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="font-semibold">{t('qr.noneOfKind')}</p>
            <Button variant="outline" onClick={() => setKinds([])}>
              {t('qr.allDishes')}
            </Button>
          </div>
        ) : (
          <>
            <PopularStrip items={bestsellers} onOpen={setOpened} />
            {sections.map(({ category, items }) => (
              <MenuSection
                key={category.id}
                category={category}
                count={items.length}
                stickyHeight={stickyHeight}
              >
                {items.map((item) => card(item))}
              </MenuSection>
            ))}
          </>
        )}
        {taxExtra && <p className="text-sm text-muted-foreground">{t('qr.taxNote')}</p>}
      </div>

      {!searching && sections.length > 1 && (
        <MenuButton raised={count > 0} onClick={() => setBrowsing(true)} />
      )}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border bg-surface p-2 ps-4 shadow-xl">
            <span className="font-semibold tabular-nums">
              {t('qr.cartSummary', { count, total: money(total) })}
            </span>
            <Button onClick={() => setReviewing(true)}>
              <ShoppingBag aria-hidden="true" />
              {t('qr.viewOrder')}
            </Button>
          </div>
        </div>
      )}
      {browsing && (
        <CategorySheet
          categories={sectionList}
          active={active}
          onJump={jump}
          onClose={() => setBrowsing(false)}
        />
      )}
      {opened !== null && (
        <DishSheet
          item={opened}
          menu={menu}
          popular={popular.has(opened.id)}
          onClose={() => setOpened(null)}
          onAdd={(line) => {
            setCart((c) => addLine(c, line));
            setOpened(null);
          }}
        />
      )}
      {reviewing && (
        <CartDialog
          token={token}
          menu={menu}
          cart={cart}
          onChange={setCart}
          onClose={() => setReviewing(false)}
          onSent={(request) => {
            setSent((s) => [request, ...s]);
            setCart([]);
            setReviewing(false);
          }}
        />
      )}
    </>
  );
}

/** One section of the menu, with its name and how many dishes it has. */
function MenuSection({
  category,
  count,
  stickyHeight,
  children,
}: {
  category: Category;
  count: number;
  stickyHeight: number;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const headingId = `cat-h-${category.id}`;
  return (
    <section
      id={`cat-${category.id}`}
      data-section={category.id}
      aria-labelledby={headingId}
      style={{ scrollMarginTop: stickyHeight + 8 }}
      className="flex flex-col"
    >
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <h2 id={headingId} tabIndex={-1} className="text-xl font-bold outline-none">
          {localizedName(category.name, category.nameTranslations, i18n.language)}
        </h2>
        <span className="shrink-0 text-sm text-muted-foreground">
          {t('qr.dishCount', { count })}
        </span>
      </div>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

function CartDialog({
  token,
  menu,
  cart,
  onChange,
  onClose,
  onSent,
}: {
  token: string;
  menu: QrMenu;
  cart: CartLine[];
  onChange: (cart: CartLine[]) => void;
  onClose: () => void;
  onSent: (request: QrRequestStatusResponse) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const errorMessage = useErrorMessage();
  const lang = i18n.language;
  const [covers, setCovers] = useState('');
  const [name, setName] = useState('');
  // One key per order: sending again after a dropped connection is the same order.
  const [clientKey] = useState(newIdempotencyKey);
  const total = cart.reduce((n, l) => n + l.unit * l.quantity, 0);
  const send = useMutation({
    mutationFn: () => {
      const guests = Number(covers);
      return api.qr.submit(token, {
        kind: 'ORDER',
        clientKey,
        items: cart.map((l) => ({
          menuItemId: l.item.id,
          ...(l.variantId === undefined ? {} : { variantId: l.variantId }),
          quantity: l.quantity,
          addons: l.addonIds.map((addonId) => ({ addonId, quantity: 1 })),
          ...(l.note === '' ? {} : { note: l.note }),
        })),
        ...(Number.isInteger(guests) && guests >= 1 && guests <= 50 ? { covers: guests } : {}),
        ...(name.trim() === '' ? {} : { guestName: name.trim() }),
      });
    },
    onSuccess: onSent,
  });
  const describe = (l: CartLine) => {
    const variant = l.item.variants.find((v) => v.id === l.variantId);
    const addons = menu.addonGroups
      .flatMap((g) => g.addons)
      .filter((a) => l.addonIds.includes(a.id));
    return [
      variant && localizedName(variant.name, variant.nameTranslations, lang),
      ...addons.map((a) => localizedName(a.name, a.nameTranslations, lang)),
      l.note || undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!send.isPending}
      closeLabel={t('common.close')}
      title={t('qr.yourOrder')}
      footer={
        <Button disabled={send.isPending || cart.length === 0} onClick={() => send.mutate()}>
          {send.isPending ? t('qr.sending') : t('qr.send', { total: money(total) })}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {send.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(send.error)}
          </Alert>
        )}
        <ul className="flex flex-col divide-y">
          {cart.map((l) => {
            const itemName = localizedName(l.item.name, l.item.nameTranslations, lang);
            const detail = describe(l);
            return (
              <li key={l.key} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium break-words">{itemName}</span>
                  {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
                </span>
                <Stepper
                  value={l.quantity}
                  min={0}
                  max={MAX_QUANTITY}
                  onValueChange={(q) =>
                    onChange(
                      q === 0
                        ? cart.filter((x) => x.key !== l.key)
                        : cart.map((x) => (x.key === l.key ? { ...x, quantity: q } : x)),
                    )
                  }
                  decrementLabel={t('qr.less', { name: itemName })}
                  incrementLabel={t('qr.more', { name: itemName })}
                />
                <span className="w-24 text-end tabular-nums">{money(l.unit * l.quantity)}</span>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('qr.guests')}</span>
            <Input
              inputMode="numeric"
              value={covers}
              maxLength={2}
              onChange={(e) => setCovers(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('qr.name')}</span>
            <Input
              value={name}
              maxLength={60}
              autoComplete="given-name"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <p className="text-sm text-muted-foreground">{t('qr.confirmNote')}</p>
      </div>
    </Dialog>
  );
}

/** A sent order or call, until a captain answers it. */
function SentRequest({ token, request }: { token: string; request: QrRequestStatusResponse }) {
  const { t } = useTranslation();
  const status = useQuery({
    queryKey: ['qr-request', token, request.id],
    queryFn: () => api.qr.status(token, request.id),
    initialData: request,
    // Ask straight away too: a captain may already have answered.
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? STATUS_POLL_MS : false),
  });
  const current = status.data;
  const kind = current.kind === 'ORDER' ? 'order' : current.kind === 'BILL' ? 'bill' : 'waiter';
  const tone =
    current.status === 'REJECTED' ? 'danger' : current.status === 'PENDING' ? 'info' : 'success';
  return (
    <Alert tone={tone} role="status">
      <span className="font-medium">{t(`qr.status.${kind}.${current.status}`)}</span>
      {current.status === 'REJECTED' && current.rejectReason && (
        <span className="block text-sm">{current.rejectReason}</span>
      )}
    </Alert>
  );
}
