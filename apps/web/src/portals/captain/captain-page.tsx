import type { DiningTable, FloorArea, OrderSummary } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  BellRing,
  Bike,
  Button,
  CHIP_LOOKS,
  cn,
  EllipsisVertical,
  LayoutGrid,
  List,
  SegmentedControl,
  ShoppingBag,
  STATE_TONE_CLASSES,
  StateChip,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { newIdempotencyKey } from '../../api/client';
import { api } from '../../api/endpoints';
import type { Portal } from '../../app/portals';
import { QueryState } from '../../features/admin/query-state';
import { useSession } from '../../features/auth/auth-store';
import { usePermission } from '../../features/auth/permissions';
import { useNow } from '../../features/devices/use-now';
import { AreaTabs } from '../../features/floor/area-tabs';
import { FloorCanvas, SHAPE_CLASSES, tileStyle } from '../../features/floor/floor-canvas';
import { useFloor } from '../../features/floor/floor-queries';
import { TableSheet } from '../../features/floor/table-sheet';
import { STATUS_CHIP, STATUS_ORDER } from '../../features/floor/table-status';
import { useElapsed } from '../../features/orders/elapsed';
import { setOrder, useOpenOrders } from '../../features/orders/order-queries';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { CoversDialog } from './covers-dialog';
import { SoundToggle } from './sound-toggle';

/** A slow safety-net poll; WebSocket messages keep the floor current. */
export const FLOOR_REFRESH_MS = 60_000;
/** Elapsed times on tiles tick this often. */
const TICK_MS = 30_000;
/** Hold this long on a tile for its actions (move, merge, cleaning). */
export const LONG_PRESS_MS = 550;

type Filter = 'all' | 'mine' | 'free';
type View = 'tiles' | 'plan';

/** Tables a new dine-in order can start on (the Hub answers TABLE_NOT_FREE otherwise). */
export function canStartOrder(table: DiningTable): boolean {
  return table.status === 'AVAILABLE' || table.status === 'RESERVED';
}

function matches(table: DiningTable, filter: Filter, me: string | null): boolean {
  if (filter === 'free') return table.status === 'AVAILABLE';
  if (filter === 'mine') return me !== null && table.openOrder?.captainId === me;
  return true;
}

/** Captain portal (wireframes §4): live tables by area, takeaway and delivery. */
export function CaptainPage({ portal }: { portal: Portal }) {
  const { t } = useTranslation();
  const floor = useFloor({ refetchInterval: FLOOR_REFRESH_MS });
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <title>{`${t(portal.titleKey)} · ${t('app.name')}`}</title>
      <QueryState query={floor}>{({ areas }) => <Floor areas={areas} />}</QueryState>
    </div>
  );
}

function Floor({ areas }: { areas: readonly FloorArea[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const me = useSession()?.user.id ?? null;
  const canCreate = usePermission('orders.create');
  const active = areas
    .filter((a) => a.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const [areaId, setAreaId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('tiles');
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [coversFor, setCoversFor] = useState<string | null>(null);
  const area = active.find((a) => a.id === areaId) ?? active[0] ?? null;
  const tables = (area?.tables ?? []).filter((x) => x.isActive);
  const allTables = active.flatMap((a) => a.tables.filter((x) => x.isActive));
  const sheetTable = allTables.find((x) => x.id === sheetFor) ?? null;
  const coversTable = allTables.find((x) => x.id === coversFor) ?? null;

  const quickOrder = useMutation({
    mutationFn: (orderType: 'TAKEAWAY' | 'DELIVERY') =>
      api.orders.open({ orderType }, { idempotencyKey: newIdempotencyKey() }),
    onSuccess: (order) => {
      setOrder(queryClient, order);
      void navigate(`/captain/orders/${order.id}`);
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });

  function open(table: DiningTable) {
    const orderId = table.openOrder?.id ?? table.currentOrderId;
    if (orderId !== null) void navigate(`/captain/orders/${orderId}`);
    else if (canStartOrder(table) && canCreate) setCoversFor(table.id);
    else setSheetFor(table.id);
  }

  if (area === null) return <p className="text-muted-foreground">{t('captain.noFloor')}</p>;

  const counts = new Map<string, number>();
  for (const x of tables) counts.set(x.status, (counts.get(x.status) ?? 0) + 1);
  const shown = [...tables]
    .filter((x) => matches(x, filter, me))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('portals.captain.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <>
              <Button
                variant="outline"
                disabled={quickOrder.isPending}
                onClick={() => quickOrder.mutate('TAKEAWAY')}
              >
                <ShoppingBag aria-hidden="true" />
                {t('captain.newTakeaway')}
              </Button>
              <Button
                variant="outline"
                disabled={quickOrder.isPending}
                onClick={() => quickOrder.mutate('DELIVERY')}
              >
                <Bike aria-hidden="true" />
                {t('captain.newDelivery')}
              </Button>
            </>
          )}
          <SoundToggle />
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AreaTabs
          label={t('floor.areas.label')}
          areas={active}
          value={area.id}
          onChange={setAreaId}
          panelId="captain-floor"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Filter>
            aria-label={t('captain.filter.label')}
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: 'all', label: t('captain.filter.all') },
              { value: 'mine', label: t('captain.filter.mine') },
              { value: 'free', label: t('captain.filter.free') },
            ]}
          />
          <SegmentedControl<View>
            aria-label={t('captain.view')}
            value={view}
            onValueChange={setView}
            options={[
              {
                value: 'tiles',
                label: <List aria-hidden="true" />,
                ariaLabel: t('captain.viewList'),
              },
              {
                value: 'plan',
                label: <LayoutGrid aria-hidden="true" />,
                ariaLabel: t('captain.viewPlan'),
              },
            ]}
          />
        </div>
      </div>

      <div id="captain-floor">
        {view === 'plan' ? (
          // Wide enough that a 4-cell table shows its label and status; narrower
          // screens scroll the plan sideways inside its own box.
          <div className="overflow-x-auto rounded-xl">
            <FloorCanvas
              label={t('floor.layout.canvasLabel', { area: area.name })}
              className="min-w-[56rem]"
            >
              {tables.map((table) => (
                <PlanTile
                  key={table.id}
                  table={table}
                  dimmed={!matches(table, filter, me)}
                  onOpen={() => open(table)}
                  onActions={() => setSheetFor(table.id)}
                />
              ))}
            </FloorCanvas>
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
            {t('captain.filter.empty')}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {shown.map((table) => (
              <li key={table.id}>
                <TableTile
                  table={table}
                  mine={me !== null && table.openOrder?.captainId === me}
                  onOpen={() => open(table)}
                  onActions={() => setSheetFor(table.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul aria-label={t('captain.legend')} className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((status) => {
          const state = STATUS_CHIP[status];
          return (
            <li key={status}>
              <StateChip
                size="sm"
                state={state}
                label={t(`state.table.${state}`)}
                meta={format.number(counts.get(status) ?? 0)}
              />
            </li>
          );
        })}
      </ul>

      <CounterOrders filter={filter} me={me} />

      {sheetTable !== null && (
        <TableSheet
          table={sheetTable}
          areaName={active.find((a) => a.id === sheetTable.floorAreaId)?.name ?? area.name}
          tables={allTables}
          onClose={() => setSheetFor(null)}
          onTakeOrder={() => {
            setSheetFor(null);
            setCoversFor(sheetTable.id);
          }}
        />
      )}
      {coversTable !== null && (
        <CoversDialog table={coversTable} onClose={() => setCoversFor(null)} />
      )}
    </div>
  );
}

/**
 * Opens on tap; table actions on long-press, right-click or the context-menu
 * key (Shift+F10). The tile's own ⋮ button does the same for anyone who
 * can't long-press.
 */
function useTileGestures(onOpen: () => void, onActions: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      longPressed.current = false;
      clear();
      timer.current = setTimeout(() => {
        longPressed.current = true;
        onActions();
      }, LONG_PRESS_MS);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: () => {
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      onOpen();
    },
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      clear();
      onActions();
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        onActions();
      }
    },
  };
}

/** A table in the tile view: status, elapsed time, guests, amount and ready dishes. */
function TableTile({
  table,
  mine,
  onOpen,
  onActions,
}: {
  table: DiningTable;
  mine: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const elapsed = useElapsed();
  const now = useNow(TICK_MS);
  const gestures = useTileGestures(onOpen, onActions);
  const state = STATUS_CHIP[table.status];
  const look = CHIP_LOOKS[state];
  const Icon = look.icon;
  const order = table.openOrder;
  const status = t(`state.table.${state}`);
  const summary =
    order === null
      ? t('captain.tileLabel', { label: table.label, seats: table.seats, status })
      : t('captain.tileOrderLabel', {
          label: table.label,
          status,
          minutes: Math.max(0, Math.floor((now - Date.parse(order.openedAt)) / 60_000)),
          amount: format.money(Money.ofPaise(order.subtotal)),
          ready: order.readyCount,
        });

  return (
    <div className="relative h-full">
      <button
        type="button"
        data-status={table.status}
        aria-label={summary}
        {...gestures}
        className={cn(
          'flex h-full min-h-28 w-full flex-col items-start gap-1 rounded-xl border-2 p-3 pe-12 text-start select-none',
          'transition-colors duration-200 [-webkit-touch-callout:none]',
          STATE_TONE_CLASSES[look.tone],
          mine && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
      >
        <span className="flex items-center gap-1.5">
          <Icon aria-hidden="true" className={cn('size-5 shrink-0', look.iconClassName)} />
          <span className="text-xl font-bold text-foreground">{table.label}</span>
        </span>
        {order === null ? (
          <>
            <span className="text-sm font-medium">{status}</span>
            <span className="text-sm text-muted-foreground">
              {t('floor.tables.seatsShort', { seats: table.seats })}
            </span>
          </>
        ) : (
          <>
            <span className="flex flex-wrap gap-x-2 text-sm font-medium text-foreground">
              {order.covers !== null && (
                <span>{t('captain.coversShort', { covers: order.covers })}</span>
              )}
              <span className="tabular-nums">{elapsed(order.openedAt, now)}</span>
            </span>
            <span className="text-base font-semibold text-foreground tabular-nums">
              {format.money(Money.ofPaise(order.subtotal))}
            </span>
            {order.readyCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-state-available bg-state-available-soft px-1.5 text-xs font-semibold text-state-available-fg">
                <BellRing aria-hidden="true" className="size-3.5" />
                {t('captain.readyCount', { count: order.readyCount })}
              </span>
            )}
            {!mine && order.captainName !== null && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {order.captainName}
              </span>
            )}
          </>
        )}
      </button>
      <button
        type="button"
        aria-label={t('captain.tableActions', { label: table.label })}
        onClick={onActions}
        className="absolute end-1 top-1 grid size-touch place-items-center rounded-lg text-muted-foreground hover:bg-muted"
      >
        <EllipsisVertical aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

/** A table on the floor plan: status colour + icon, label, and elapsed time when it fits. */
function PlanTile({
  table,
  dimmed,
  onOpen,
  onActions,
}: {
  table: DiningTable;
  dimmed: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const { t } = useTranslation();
  const elapsed = useElapsed();
  const now = useNow(TICK_MS);
  const gestures = useTileGestures(onOpen, onActions);
  const state = STATUS_CHIP[table.status];
  const look = CHIP_LOOKS[state];
  const Icon = look.icon;
  const status = t(`state.table.${state}`);
  return (
    <button
      type="button"
      data-status={table.status}
      aria-label={t('captain.tileLabel', { label: table.label, seats: table.seats, status })}
      {...gestures}
      style={tileStyle(table, table.shape)}
      className={cn(
        'absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border-2 p-0.5 text-center leading-tight select-none @container',
        'transition-[colors,opacity] duration-200',
        SHAPE_CLASSES[table.shape],
        STATE_TONE_CLASSES[look.tone],
        dimmed && 'opacity-35',
      )}
    >
      <span className="flex items-center gap-1">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', look.iconClassName)} />
        <span className="text-sm font-bold text-foreground @min-[4.5rem]:text-base">
          {table.label}
        </span>
      </span>
      <span className="hidden text-xs font-medium @min-[4rem]:block">
        {table.openOrder === null ? status : elapsed(table.openOrder.openedAt, now)}
      </span>
    </button>
  );
}

/** Open takeaway and delivery orders: they have no table, so they get their own row. */
function CounterOrders({ filter, me }: { filter: Filter; me: string | null }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const orders = useOpenOrders();
  const now = useNow(TICK_MS);
  const elapsed = useElapsed();
  if (filter === 'free') return null;
  const list = (orders.data?.data ?? [])
    .filter((o): o is OrderSummary => o.tableId === null)
    .filter((o) => filter !== 'mine' || o.captainId === me)
    .sort((a, b) => (a.tokenNo ?? 0) - (b.tokenNo ?? 0));
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="counter-orders" className="flex flex-col gap-2">
      <h2 id="counter-orders" className="text-lg font-semibold">
        {t('captain.counterOrders')}
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((o) => (
          <li key={o.id}>
            <Button
              variant="outline"
              className="h-full w-full flex-col items-start gap-1 p-3 text-start"
              onClick={() => void navigate(`/captain/orders/${o.id}`)}
            >
              <span className="flex items-center gap-1.5 text-lg font-bold">
                {o.orderType === 'DELIVERY' ? (
                  <Bike aria-hidden="true" />
                ) : (
                  <ShoppingBag aria-hidden="true" />
                )}
                {o.tokenNo === null
                  ? t('order.number', { orderNo: o.orderNo })
                  : t('order.token', { token: o.tokenNo })}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('captain.counterMeta', {
                  type: t(`orderTypes.${o.orderType}`),
                  elapsed: elapsed(o.openedAt, now),
                })}
              </span>
              <span className="font-semibold tabular-nums">
                {format.money(Money.ofPaise(o.subtotal))}
              </span>
              {o.readyCount > 0 && (
                <span className="text-xs font-semibold text-state-available-fg">
                  {t('captain.readyCount', { count: o.readyCount })}
                </span>
              )}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
