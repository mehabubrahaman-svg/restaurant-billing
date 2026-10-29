import type { QrMenu, QrRequestStatusResponse } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  BellRing,
  Button,
  Card,
  CardContent,
  Checkbox,
  cn,
  Dialog,
  Input,
  QrCode,
  ReceiptText,
  ShoppingBag,
  Spinner,
  Stepper,
} from '@restroos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import { FoodTypeMark } from '../../features/menu/food-type';
import { localizedName } from '../../features/menu/localized-name';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';

type Item = QrMenu['items'][number];
type Group = QrMenu['addonGroups'][number];

/** One line of the guest's order, before it is sent. */
interface CartLine {
  key: string;
  item: Item;
  variantId: string | undefined;
  addonIds: string[];
  quantity: number;
  note: string;
  /** Paise for one, with the size and add-ons. */
  unit: number;
}

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
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4 pb-28">
      <title>
        {menu.data
          ? `${menu.data.branchName} · ${t('qr.table', { table: menu.data.tableLabel })}`
          : t('portals.qrMenu.title')}
      </title>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-lg font-bold">
          <QrCode aria-hidden="true" className="size-6 shrink-0 text-primary" />
          <span className="min-w-0 break-words">
            {menu.data?.branchName ?? t('portals.qrMenu.title')}
          </span>
        </span>
        <LanguageSwitcher />
      </header>
      <main className="flex flex-col gap-4">
        {menu.isPending ? (
          <Spinner label={t('common.loading')} />
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

function Ordering({ token, menu }: { token: string; menu: QrMenu }) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const lang = i18n.language;
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [choosing, setChoosing] = useState<Item | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sent, setSent] = useState<QrRequestStatusResponse[]>([]);
  const categories = [...menu.categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );
  const count = cart.reduce((n, l) => n + l.quantity, 0);
  const total = cart.reduce((n, l) => n + l.unit * l.quantity, 0);
  const taxExtra = menu.items.some((i) => !i.taxIncluded);

  const call = useMutation({
    mutationFn: (kind: 'WAITER' | 'BILL') =>
      api.qr.submit(token, { kind, clientKey: newIdempotencyKey() }),
    onSuccess: (request) => setSent((s) => [request, ...s]),
  });

  function add(item: Item) {
    const groups = groupsOf(item, menu);
    if (item.variants.length === 0 && groups.length === 0) {
      setCart((c) => {
        const same = c.find(
          (l) => l.item.id === item.id && l.addonIds.length === 0 && l.note === '',
        );
        if (same)
          return c.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + 1) } : l));
        return [
          ...c,
          {
            key: newIdempotencyKey(),
            item,
            variantId: undefined,
            addonIds: [],
            quantity: 1,
            note: '',
            unit: item.price,
          },
        ];
      });
    } else {
      setChoosing(item);
    }
  }

  return (
    <>
      <p className="text-muted-foreground">{t('qr.table', { table: menu.tableLabel })}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={call.isPending} onClick={() => call.mutate('WAITER')}>
          <BellRing aria-hidden="true" />
          {t('qr.callWaiter')}
        </Button>
        <Button variant="outline" disabled={call.isPending} onClick={() => call.mutate('BILL')}>
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
      <nav aria-label={t('qr.categories')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-2">
          {categories.map((c) => (
            <li key={c.id}>
              <a
                href={`#cat-${c.id}`}
                className="block rounded-full border px-3 py-1.5 text-sm whitespace-nowrap"
              >
                {localizedName(c.name, c.nameTranslations, lang)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {categories.map((c) => {
        const items = menu.items.filter((i) => i.categoryId === c.id);
        if (items.length === 0) return null;
        return (
          <section
            key={c.id}
            id={`cat-${c.id}`}
            aria-labelledby={`cat-h-${c.id}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`cat-h-${c.id}`} className="text-lg font-semibold">
              {localizedName(c.name, c.nameTranslations, lang)}
            </h2>
            <ul className="flex flex-col divide-y rounded-xl border bg-surface">
              {items.map((item) => {
                const name = localizedName(item.name, item.nameTranslations, lang);
                const description = item.description
                  ? localizedName(item.description, item.descriptionTranslations, lang)
                  : null;
                const from =
                  item.variants.length > 0
                    ? Math.min(...item.variants.map((v) => v.price))
                    : item.price;
                return (
                  <li
                    key={item.id}
                    className={cn('flex items-start gap-3 p-3', !item.isAvailable && 'opacity-60')}
                  >
                    <FoodTypeMark type={item.foodType} size="sm" className="mt-1 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium break-words">{name}</span>
                      {description && (
                        <span className="text-sm break-words text-muted-foreground">
                          {description}
                        </span>
                      )}
                      <span className="text-sm tabular-nums">
                        {item.variants.length > 0
                          ? t('qr.from', { price: money(from) })
                          : money(from)}
                      </span>
                    </div>
                    {item.isAvailable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('qr.addNamed', { name })}
                        onClick={() => add(item)}
                      >
                        {t('qr.add')}
                      </Button>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('qr.unavailable')}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {taxExtra && <p className="text-sm text-muted-foreground">{t('qr.taxNote')}</p>}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-surface p-3 shadow-lg">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3">
            <span className="tabular-nums">
              {t('qr.cartSummary', { count, total: money(total) })}
            </span>
            <Button onClick={() => setReviewing(true)}>
              <ShoppingBag aria-hidden="true" />
              {t('qr.viewOrder')}
            </Button>
          </div>
        </div>
      )}
      {choosing !== null && (
        <OptionsDialog
          item={choosing}
          groups={groupsOf(choosing, menu)}
          onClose={() => setChoosing(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setChoosing(null);
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

function groupsOf(item: Item, menu: QrMenu): Group[] {
  return item.addonGroupIds
    .map((id) => menu.addonGroups.find((g) => g.id === id))
    .filter((g): g is Group => g !== undefined);
}

/** Size and add-ons, within each group's fewest and most. */
function OptionsDialog({
  item,
  groups,
  onAdd,
  onClose,
}: {
  item: Item;
  groups: Group[];
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const lang = i18n.language;
  const money = (paise: number) => format.money(Money.ofPaise(paise));
  const [variantId, setVariantId] = useState(item.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const variant = item.variants.find((v) => v.id === variantId);
  const addons = groups.flatMap((g) => g.addons).filter((a) => addonIds.includes(a.id));
  const unit = (variant?.price ?? item.price) + addons.reduce((n, a) => n + a.price, 0);
  const short = groups.filter((g) => {
    const picked = g.addons.filter((a) => addonIds.includes(a.id)).length;
    return picked < g.minSelect || picked > g.maxSelect;
  });
  const name = localizedName(item.name, item.nameTranslations, lang);

  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={name}
      footer={
        <Button
          disabled={short.length > 0}
          onClick={() =>
            onAdd({
              key: newIdempotencyKey(),
              item,
              variantId,
              addonIds,
              quantity,
              note: note.trim(),
              unit,
            })
          }
        >
          {t('qr.addWithTotal', { total: money(unit * quantity) })}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {item.variants.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('qr.size')}</legend>
            {item.variants.map((v) => (
              <label key={v.id} className="flex min-h-touch items-center gap-3">
                <input
                  type="radio"
                  name="size"
                  checked={variantId === v.id}
                  onChange={() => setVariantId(v.id)}
                />
                <span className="flex-1">{localizedName(v.name, v.nameTranslations, lang)}</span>
                <span className="tabular-nums">{money(v.price)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {groups.map((g) => (
          <fieldset key={g.id} className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">
              {localizedName(g.name, g.nameTranslations, lang)}
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                {g.minSelect === g.maxSelect
                  ? t('qr.chooseExactly', { count: g.minSelect })
                  : t('qr.chooseUpTo', { count: g.maxSelect })}
              </span>
            </legend>
            {g.addons.map((a) => (
              <Checkbox
                key={a.id}
                label={`${localizedName(a.name, a.nameTranslations, lang)} · +${money(a.price)}`}
                checked={addonIds.includes(a.id)}
                onChange={(e) =>
                  setAddonIds((ids) =>
                    e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                  )
                }
              />
            ))}
          </fieldset>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">{t('qr.note')}</span>
          <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Stepper
          value={quantity}
          onValueChange={setQuantity}
          max={20}
          decrementLabel={t('qr.less', { name })}
          incrementLabel={t('qr.more', { name })}
        />
      </div>
    </Dialog>
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
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const lang = i18n.language;
  const money = (paise: number) => format.money(Money.ofPaise(paise));
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
                  max={20}
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
