import type { MenuItem, Order } from '@restroos/contracts';
import { Alert, ArrowLeft, ArrowRightLeft, Ban, Button, Merge, Spinner, Users } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../../api/endpoints';
import { QueryState } from '../../../features/admin/query-state';
import { usePermission } from '../../../features/auth/permissions';
import { useNow } from '../../../features/devices/use-now';
import { useFloor } from '../../../features/floor/floor-queries';
import { TransferDialog } from '../../../features/floor/table-sheet';
import { localizedName } from '../../../features/menu/localized-name';
import { useMenuSnapshot } from '../../../features/menu/menu-queries';
import { useCommandQueue } from '../../../features/offline/command-queue';
import { useElapsed } from '../../../features/orders/elapsed';
import { hasOptions } from '../../../features/orders/item-options';
import { ORDER_KEYS, setOrder, useOrder } from '../../../features/orders/order-queries';
import { addDraft, flushPad, usePadStore } from '../../../features/orders/pad-store';
import { toast } from '../../../features/toast/toast-store';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { CoversPicker } from '../covers-dialog';
import { ItemOptionsSheet, type PickedLine } from './item-options-sheet';
import { MenuPanel } from './menu-panel';
import { CancelOrderDialog } from './order-dialogs';
import { OrderPanel } from './order-panel';

const EMPTY: readonly never[] = [];

/** /captain/orders/:orderId: the order pad (wireframes §5). */
export function OrderPadPage() {
  const { orderId = '' } = useParams();
  const order = useOrder(orderId);
  return <QueryState query={order}>{(o) => <Pad order={o} />}</QueryState>;
}

function Pad({ order }: { order: Order }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const menu = useMenuSnapshot();
  const canEdit = usePermission(['orders.create', 'orders.update']);
  const editable = order.status === 'OPEN' && canEdit;
  const [optionsFor, setOptionsFor] = useState<MenuItem | null>(null);
  const drafts = usePadStore((s) => s.drafts[order.id] ?? EMPTY);
  const qtyEdits = usePadStore((s) => s.qtyEdits);
  const commands = useCommandQueue((s) => s.commands);
  const snapshot = menu.data?.snapshot;
  const title = usePadTitle(order);

  // Leaving the pad saves whatever was tapped in the last moment.
  useEffect(() => {
    const id = order.id;
    return () => void flushPad(queryClient, id);
  }, [queryClient, order.id]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const bump = (id: string, n: number) => map.set(id, (map.get(id) ?? 0) + n);
    for (const item of order.items) {
      if (item.status === 'PENDING')
        bump(item.menuItemId, qtyEdits[item.id]?.quantity ?? item.quantity);
    }
    for (const d of drafts) bump(d.request.menuItemId, d.request.quantity);
    for (const c of commands) {
      if (c.orderId !== order.id || c.kind !== 'addItems' || c.status === 'failed') continue;
      const body = c.body as { items?: { menuItemId: string; quantity: number }[] } | undefined;
      for (const item of body?.items ?? []) bump(item.menuItemId, item.quantity);
    }
    return map;
  }, [order, drafts, qtyEdits, commands]);

  const add = useCallback(
    (line: PickedLine) => {
      addDraft(queryClient, order.id, line);
      setOptionsFor(null);
    },
    [queryClient, order.id],
  );

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

  return (
    // From md up the pad fills the screen under the top bar: the menu and the
    // order each scroll on their own, so "Send to kitchen" is always in reach.
    <div className="mx-auto flex max-w-[100rem] flex-col gap-3 md:h-[calc(100dvh-7.5rem)]">
      <title>{`${title} · ${t('app.name')}`}</title>
      <PadHeader order={order} editable={editable} />
      {order.status !== 'OPEN' && <Alert tone="info">{t(`order.closed.${order.status}`)}</Alert>}
      <div className="grid gap-4 md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_17.5rem] lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        {snapshot === undefined ? (
          <QueryState query={menu}>{() => null}</QueryState>
        ) : (
          <div className="md:min-h-0 md:overflow-y-auto md:pe-1">
            <MenuPanel menu={snapshot} onPick={pick} disabled={!editable} counts={counts} />
          </div>
        )}
        <OrderPanel order={order} menu={snapshot} editable={editable} />
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

/** "T2 · Order #142", or "Takeaway · Token 12 · #143". */
function usePadTitle(order: Order): string {
  const { t } = useTranslation();
  if (order.tableLabel !== null) {
    return t('order.titleTable', { label: order.tableLabel, orderNo: order.orderNo });
  }
  if (order.tokenNo !== null) {
    return t('order.titleToken', {
      type: t(`orderTypes.${order.orderType}`),
      token: order.tokenNo,
      orderNo: order.orderNo,
    });
  }
  return t('order.number', { orderNo: order.orderNo });
}

function PadHeader({ order, editable }: { order: Order; editable: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const now = useNow(30_000);
  const elapsed = useElapsed();
  const canTransfer = usePermission('orders.transfer_table');
  const [dialog, setDialog] = useState<'covers' | 'move' | 'merge' | 'cancel' | null>(null);
  const [covers, setCovers] = useState(order.covers ?? 1);
  const floor = useFloor();
  const tables = (floor.data?.areas ?? []).flatMap((a) => a.tables);
  const table = tables.find((x) => x.id === order.tableId) ?? null;
  const title = usePadTitle(order);

  const saveCovers = useMutation({
    mutationFn: () => api.orders.update(order.id, { version: order.version, covers }),
    onSuccess: (updated) => {
      setOrder(queryClient, updated);
      setDialog(null);
    },
  });

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button asChild variant="ghost" size="icon" aria-label={t('order.backToFloor')}>
        <Link to="/captain">
          <ArrowLeft aria-hidden="true" />
        </Link>
      </Button>
      <div className="flex min-w-[min(14rem,60vw)] flex-1 flex-col">
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
          <span>{t(`orderTypes.${order.orderType}`)}</span>
          <span className="tabular-nums">{elapsed(order.openedAt, now)}</span>
          {order.captainName !== null && <span>{order.captainName}</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {order.orderType === 'DINE_IN' && (
          <Button
            variant="outline"
            disabled={!editable}
            onClick={() => {
              setCovers(order.covers ?? 1);
              setDialog('covers');
            }}
          >
            <Users aria-hidden="true" />
            {order.covers === null
              ? t('order.covers.unset')
              : t('order.covers.count', { covers: order.covers })}
          </Button>
        )}
        {editable && canTransfer && table !== null && (
          <>
            <Button variant="outline" onClick={() => setDialog('move')}>
              <ArrowRightLeft aria-hidden="true" />
              {t('captain.transfer.move')}
            </Button>
            <Button variant="outline" onClick={() => setDialog('merge')}>
              <Merge aria-hidden="true" />
              {t('captain.transfer.merge')}
            </Button>
          </>
        )}
        {editable && (
          <Button variant="outline" onClick={() => setDialog('cancel')}>
            <Ban aria-hidden="true" />
            {t('order.cancel.orderAction')}
          </Button>
        )}
      </div>

      {dialog === 'covers' && (
        <CoversPicker
          title={t('order.covers.change')}
          value={covers}
          onChange={setCovers}
          busy={saveCovers.isPending}
          error={saveCovers.isError ? errorMessage(saveCovers.error) : null}
          submitLabel={t('common.save')}
          onSubmit={() => saveCovers.mutate()}
          onClose={() => setDialog(null)}
          formatNumber={format.number}
        />
      )}
      {(dialog === 'move' || dialog === 'merge') &&
        table !== null &&
        (floor.isPending ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <TransferDialog
            table={table}
            mode={dialog === 'move' ? 'MOVE' : 'MERGE'}
            tables={tables}
            onClose={() => setDialog(null)}
            onDone={(resultId) => {
              setDialog(null);
              if (resultId !== order.id) void navigate(`/captain/orders/${resultId}`);
              else void queryClient.invalidateQueries({ queryKey: ORDER_KEYS.detail(order.id) });
            }}
          />
        ))}
      {dialog === 'cancel' && (
        <CancelOrderDialog
          order={order}
          onClose={() => setDialog(null)}
          onCancelled={() => {
            toast(t('order.cancel.orderDone', { orderNo: order.orderNo }));
            void navigate('/captain');
          }}
        />
      )}
    </header>
  );
}
