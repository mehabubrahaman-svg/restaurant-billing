import type { MenuItem, Order } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Bike,
  Button,
  Field,
  Input,
  Receipt,
  Select,
  Send,
  Stepper,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isApiError, newIdempotencyKey } from '../../api/client';
import { api, type AggregatorOrderBody } from '../../api/endpoints';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useMenuSnapshot } from '../../features/menu/menu-queries';
import { FoodTypeMark } from '../../features/menu/food-type';
import { localizedName } from '../../features/menu/localized-name';
import { hasOptions } from '../../features/orders/item-options';
import { ORDER_KEYS, setOrder } from '../../features/orders/order-queries';
import { useSalesChannels } from '../../features/orders/sales-channels';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { MenuPanel } from '../captain/order-pad/menu-panel';
import { ItemOptionsSheet, type PickedLine } from '../captain/order-pad/item-options-sheet';
import { useRate } from './bill-breakdown';

interface Line extends PickedLine {
  readonly key: string;
}

/** Same dish, same size, add-ons and note: one more of the line instead of a new one. */
function sameLine(a: PickedLine['request'], b: PickedLine['request']): boolean {
  return (
    a.menuItemId === b.menuItemId &&
    (a.variantId ?? null) === (b.variantId ?? null) &&
    JSON.stringify(a.addons ?? []) === JSON.stringify(b.addons ?? []) &&
    (a.specialNote ?? '') === (b.specialNote ?? '')
  );
}

let lineSeq = 0;

/**
 * /pos/delivery: a Swiggy / Zomato order keyed in from the partner's tablet.
 * Pick the channel, type its order number and the rider's OTP, add the dishes
 * from the menu, and send: the Hub opens a DELIVERY order with a token and
 * fires its KOTs straight away.
 */
export function DeliveryPage() {
  const { t, i18n } = useTranslation();
  const menu = useMenuSnapshot();
  const snapshot = menu.data?.snapshot;
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [optionsFor, setOptionsFor] = useState<MenuItem | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);

  const add = useCallback((line: PickedLine) => {
    setPlaced(null);
    setLines((current) => {
      const same = current.find((l) => sameLine(l.request, line.request));
      if (same === undefined) {
        lineSeq += 1;
        return [...current, { ...line, key: `line-${lineSeq}` }];
      }
      return current.map((l) =>
        l === same
          ? {
              ...l,
              request: {
                ...l.request,
                quantity: Math.min(99, l.request.quantity + line.request.quantity),
              },
            }
          : l,
      );
    });
    setOptionsFor(null);
  }, []);

  const pick = useCallback(
    (item: MenuItem) => {
      if (snapshot === undefined || !item.isAvailable) return;
      if (hasOptions(item, snapshot)) {
        setOptionsFor(item);
        return;
      }
      add({
        request: { menuItemId: item.id, quantity: 1, addons: [] },
        unitTotal: item.basePrice,
        preview: {
          name: localizedName(item.name, item.nameTranslations, i18n.language),
          variantName: null,
          foodType: item.foodType,
          addons: [],
          specialNote: null,
        },
      });
    },
    [snapshot, add, i18n.language],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      map.set(l.request.menuItemId, (map.get(l.request.menuItemId) ?? 0) + l.request.quantity);
    }
    return map;
  }, [lines]);

  return (
    <div className="flex flex-col gap-3">
      <title>{`${t('pos.tabs.delivery')} · ${t('app.name')}`}</title>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_19rem] lg:grid-cols-[minmax(0,1fr)_23rem] xl:h-[calc(100dvh-12rem)] xl:min-h-[30rem]">
        {snapshot === undefined ? (
          <QueryState query={menu}>{() => null}</QueryState>
        ) : (
          <div className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:pe-1">
            <MenuPanel menu={snapshot} onPick={pick} disabled={false} counts={counts} />
          </div>
        )}
        <DeliveryForm
          lines={lines}
          onLines={setLines}
          placed={placed}
          onPlaced={(order) => {
            setPlaced(order);
            setLines([]);
          }}
        />
      </div>
      {optionsFor !== null && snapshot !== undefined && (
        <ItemOptionsSheet
          item={optionsFor}
          menu={snapshot}
          onAdd={add}
          onClose={() => setOptionsFor(null)}
        />
      )}
    </div>
  );
}

interface FormErrors {
  channel?: string;
  externalId?: string;
  otp?: string;
}

function DeliveryForm({
  lines,
  onLines,
  placed,
  onPlaced,
}: {
  lines: readonly Line[];
  onLines: (update: (lines: readonly Line[]) => readonly Line[]) => void;
  placed: Order | null;
  onPlaced: (order: Order) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const rate = useRate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canBill = usePermission('billing.create');
  const canManage = usePermission('settings.manage');
  const channels = useSalesChannels();
  const aggregators = (channels.data?.data ?? []).filter((c) => c.isActive && c.kind !== 'DIRECT');
  const [channelId, setChannelId] = useState('');
  const channel = aggregators.find((c) => c.id === channelId) ?? aggregators[0] ?? null;
  const [externalId, setExternalId] = useState('');
  const [otp, setOtp] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const key = useRef<{ body: string; key: string } | null>(null);
  const subtotal = lines.reduce((sum, l) => sum + l.unitTotal * l.request.quantity, 0);
  const units = lines.reduce((sum, l) => sum + l.request.quantity, 0);

  const send = useMutation({
    mutationFn: (body: AggregatorOrderBody) => {
      const text = JSON.stringify(body);
      if (key.current?.body !== text) key.current = { body: text, key: newIdempotencyKey() };
      return api.orders.aggregator(body, { idempotencyKey: key.current.key });
    },
    onSuccess: ({ order, kots }) => {
      key.current = null;
      setOrder(queryClient, order);
      void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.open });
      onPlaced(order);
      setExternalId('');
      setOtp('');
      setNotes('');
      toast(
        t('pos.delivery.sent', {
          channel: order.salesChannelName ?? '',
          id: order.externalOrderId ?? '',
          token: order.tokenNo ?? 0,
          count: kots.length,
        }),
      );
    },
    onError: (error) => {
      if (isApiError(error, 'DUPLICATE_EXTERNAL_ORDER')) {
        setErrors({ externalId: errorMessage(error) });
      }
    },
  });

  function submit() {
    const id = externalId.trim();
    const pin = otp.trim();
    const found: FormErrors = {};
    if (channel === null) found.channel = t('pos.delivery.channelRequired');
    if (id.length < 3 || id.length > 40) found.externalId = t('pos.delivery.externalIdInvalid');
    if (pin.length > 12) found.otp = t('pos.delivery.otpInvalid');
    setErrors(found);
    if (channel === null || Object.keys(found).length > 0 || lines.length === 0) return;
    const note = notes.trim();
    send.mutate({
      salesChannelId: channel.id,
      externalOrderId: id,
      ...(pin === '' ? {} : { externalOtp: pin }),
      ...(note === '' ? {} : { notes: note }),
      items: lines.map((l) => l.request),
    });
  }

  const setQuantity = (lineKey: string, quantity: number) =>
    onLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.key !== lineKey)
        : current.map((l) =>
            l.key === lineKey ? { ...l, request: { ...l.request, quantity } } : l,
          ),
    );

  return (
    <section
      aria-labelledby="delivery-title"
      className="flex min-w-0 flex-col rounded-xl border bg-surface xl:min-h-0"
    >
      <h2
        id="delivery-title"
        className="flex items-center gap-2 border-b px-4 py-3 text-lg font-semibold"
      >
        <Bike aria-hidden="true" className="size-5 text-muted-foreground" />
        {t('pos.delivery.title')}
      </h2>
      <form
        className="flex min-h-0 flex-1 flex-col"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {placed !== null && (
            <Alert tone="success" role="status" title={t('pos.delivery.placedTitle')}>
              <p>
                {t('pos.delivery.placed', {
                  orderNo: placed.orderNo,
                  token: placed.tokenNo ?? 0,
                })}
              </p>
              {canBill && (
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to={`/pos?order=${placed.id}`}>
                    <Receipt aria-hidden="true" />
                    {t('pos.delivery.bill')}
                  </Link>
                </Button>
              )}
            </Alert>
          )}
          {channels.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(channels.error)}
            </Alert>
          )}
          {channels.isSuccess && aggregators.length === 0 && (
            <Alert tone="warning" title={t('pos.delivery.noChannelsTitle')}>
              <p>{canManage ? t('pos.delivery.noChannelsAdmin') : t('pos.delivery.noChannels')}</p>
              {canManage && (
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to="/admin/sales-channels">{t('pos.delivery.setUpChannels')}</Link>
                </Button>
              )}
            </Alert>
          )}
          <Field label={t('pos.delivery.channel')} error={errors.channel} required>
            {(p) => (
              <Select
                {...p}
                value={channel?.id ?? ''}
                disabled={aggregators.length === 0}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {aggregators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
            <Field label={t('pos.delivery.externalId')} error={errors.externalId} required>
              {(p) => (
                <Input
                  {...p}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('pos.delivery.otp')}
              hint={t('pos.delivery.otpHint')}
              error={errors.otp}
            >
              {(p) => (
                <Input
                  {...p}
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={12}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label={t('pos.delivery.notes')}>
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={200}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>

          <section aria-labelledby="delivery-items" className="flex flex-col gap-2">
            <h3 id="delivery-items" className="text-sm font-semibold text-muted-foreground">
              {t('pos.delivery.items', { count: units })}
            </h3>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pos.delivery.noItems')}</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {lines.map((l) => {
                  const name =
                    l.preview.variantName === null
                      ? l.preview.name
                      : t('order.line.withVariant', {
                          name: l.preview.name,
                          variant: l.preview.variantName,
                        });
                  return (
                    <li key={l.key} className="flex flex-col gap-2 py-2">
                      <div className="flex items-start gap-2">
                        <FoodTypeMark type={l.preview.foodType} className="mt-1" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="font-medium break-words">{name}</span>
                          {l.preview.addons.length > 0 && (
                            <span className="text-sm break-words text-muted-foreground">
                              {l.preview.addons.join(', ')}
                            </span>
                          )}
                          {l.preview.specialNote !== null && (
                            <span className="text-sm break-words text-muted-foreground italic">
                              {l.preview.specialNote}
                            </span>
                          )}
                        </div>
                        <span className="font-medium whitespace-nowrap tabular-nums">
                          {format.money(Money.ofPaise(l.unitTotal * l.request.quantity))}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Stepper
                          value={l.request.quantity}
                          min={1}
                          onValueChange={(q) => setQuantity(l.key, q)}
                          display={format.number(l.request.quantity)}
                          decrementLabel={t('order.line.fewer', { name: l.preview.name })}
                          incrementLabel={t('order.line.more', { name: l.preview.name })}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('order.line.remove', { name: l.preview.name })}
                          onClick={() => setQuantity(l.key, 0)}
                        >
                          <Trash aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
          <p className="flex items-baseline justify-between text-lg font-bold">
            <span>{t('pos.delivery.subtotal')}</span>
            <span className="tabular-nums">{format.money(Money.ofPaise(subtotal))}</span>
          </p>
          {channel !== null && (
            <p className="text-sm text-muted-foreground">
              {channel.priceMarkupBp > 0
                ? t('pos.delivery.markup', {
                    channel: channel.name,
                    rate: rate(channel.priceMarkupBp),
                  })
                : t('pos.delivery.noMarkup')}
              {channel.gstPaidByOperator && ` ${t('pos.delivery.operatorGst')}`}
            </p>
          )}
          {send.isError && !isApiError(send.error, 'DUPLICATE_EXTERNAL_ORDER') && (
            <Alert tone="danger" role="alert">
              {errorMessage(send.error)}
            </Alert>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={lines.length === 0 || channel === null || send.isPending}
          >
            <Send aria-hidden="true" />
            {send.isPending ? t('common.saving') : t('pos.delivery.send')}
          </Button>
        </div>
      </form>
    </section>
  );
}
