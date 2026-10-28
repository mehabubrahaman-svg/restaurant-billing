import type { Kot, KotItem, KotsResponse } from '@restroos/contracts';
import {
  Alert,
  Button,
  CHIP_LOOKS,
  cn,
  Dialog,
  Select,
  Spinner,
  TriangleAlert,
  type KotState,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type KotTarget } from '../../api/endpoints';
import type { Portal } from '../../app/portals';
import { usePermission } from '../../features/auth/permissions';
import { ConnectionPill } from '../../features/connection/connection-pill';
import { useNow } from '../../features/devices/use-now';
import { useKdsFlags } from '../../features/kitchen/kds-flags';
import {
  applyKot,
  KITCHEN_KEYS,
  useChefs,
  useKitchenMetrics,
  useKots,
} from '../../features/kitchen/kds-queries';
import { byAge, KDS_COLUMNS, kotUrgency } from '../../features/kitchen/kot-timing';
import { subscribeLive } from '../../features/live/live-events';
import { useMenuSnapshot } from '../../features/menu/menu-queries';
import { applyKotToOrder } from '../../features/orders/order-queries';
import { toast } from '../../features/toast/toast-store';
import { useFormat } from '../../i18n/use-format';
import { chime } from '../../lib/chime';
import { readStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';
import { useErrorMessage } from '../../lib/errors';
import { useDeviceStore } from '../../stores/device-store';
import { useThemeStore } from '../../features/theme/theme-store';
import { SoundToggle } from '../captain/sound-toggle';
import { KotCard } from './kot-card';

/** Card ages and colours are recomputed this often (one timer for the whole board). */
export const KDS_TICK_MS = 5_000;
/** A KOT that arrived over the live feed slides in and stays highlighted this long. */
const FRESH_MS = 8_000;

const COLUMN_CHIP: Readonly<Record<string, KotState>> = {
  NEW: 'new',
  ACCEPTED: 'accepted',
  COOKING: 'cooking',
  READY: 'ready',
};

function storedStation(): string | null {
  const stored = readStorage(STORAGE_KEYS.kdsStation);
  return stored === null || stored === 'all' ? null : stored;
}

/** Puts a change into the cached board right away; the Hub's answer (or a refetch) follows. */
function patchKot(
  client: ReturnType<typeof useQueryClient>,
  kotId: string,
  change: (kot: Kot) => Kot,
): void {
  for (const [key, data] of client.getQueriesData<KotsResponse>({
    queryKey: KITCHEN_KEYS.kotLists,
  })) {
    if (data === undefined || !data.data.some((k) => k.id === kotId)) continue;
    client.setQueryData<KotsResponse>(key, {
      data: data.data.map((k) => (k.id === kotId ? change(k) : k)),
    });
  }
}

/**
 * Kitchen display (wireframes §6): four columns NEW → ACCEPTED → COOKING →
 * READY for one station (remembered per device), a metrics strip, a chime
 * for new KOTs, and colour that turns amber past 80% of the target time and
 * red (pulsing) past it. Dark by default; columns scroll on their own.
 */
export function KdsBoard({ portal }: { portal: Portal }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const fullScreen = useDeviceStore((s) => s.kind === 'KDS');
  // The board is dark (less glare) unless someone chose a theme on this device.
  const forceDark = useThemeStore((s) => s.preference === null) && !fullScreen;
  const canAct = usePermission('kds.update_status');
  const canAssign = usePermission('kds.assign_chef');
  const [station, setStation] = useState<string | null>(storedStation);
  const kots = useKots(station);
  const metrics = useKitchenMetrics();
  const menu = useMenuSnapshot();
  const delayed = useKdsFlags((s) => s.delayed);
  const now = useNow(KDS_TICK_MS);
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(new Map());
  const [assignFor, setAssignFor] = useState<Kot | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const stations = (menu.data?.snapshot.kitchenStations ?? []).filter((s) => s.isActive);

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.type !== 'kitchen.kot.fired') return;
        const { kot } = message.data;
        if (station !== null && kot.kitchenStationId !== station) return;
        setFresh((m) => new Map(m).set(kot.id, Date.now()));
        chime('newKot');
      }),
    [station],
  );

  const freshIds = useMemo(
    () => new Set([...fresh].filter(([, at]) => now - at < FRESH_MS).map(([id]) => id)),
    [fresh, now],
  );

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const onFailure = useCallback(
    (error: unknown) => {
      toast(errorMessage(error), 'danger');
      // Someone else moved it, or our copy is old: show the Hub's current board.
      if (isApiError(error, 'VERSION_CONFLICT') || isApiError(error, 'INVALID_STATE_TRANSITION')) {
        void queryClient.invalidateQueries({ queryKey: KITCHEN_KEYS.kotLists });
      }
    },
    [errorMessage, queryClient],
  );

  const advance = useMutation({
    mutationFn: ({ kot, to }: { kot: Kot; to: KotTarget }) =>
      api.kitchen.setStatus(kot.id, to, kot.version),
    onMutate: ({ kot, to }) => {
      mark(kot.id, true);
      if (to !== 'SERVED') patchKot(queryClient, kot.id, (k) => ({ ...k, status: to }));
    },
    onSuccess: (kot) => {
      applyKot(queryClient, kot);
      applyKotToOrder(queryClient, kot);
      void queryClient.invalidateQueries({ queryKey: KITCHEN_KEYS.metrics });
    },
    onError: (error, { kot }) => {
      patchKot(queryClient, kot.id, () => kot);
      onFailure(error);
    },
    onSettled: (_data, _error, { kot }) => mark(kot.id, false),
  });

  const bump = useMutation({
    mutationFn: ({ kot, item }: { kot: Kot; item: KotItem }) =>
      api.kitchen.bumpItem(kot.id, item.id),
    onMutate: ({ kot, item }) => {
      mark(kot.id, true);
      patchKot(queryClient, kot.id, (k) => ({
        ...k,
        items: k.items.map((i) => (i.id === item.id ? { ...i, status: 'READY' } : i)),
      }));
    },
    onSuccess: (kot) => {
      applyKot(queryClient, kot);
      applyKotToOrder(queryClient, kot);
    },
    onError: (error, { kot }) => {
      patchKot(queryClient, kot.id, () => kot);
      onFailure(error);
    },
    onSettled: (_data, _error, { kot }) => mark(kot.id, false),
  });

  const onAdvance = useCallback(
    (kot: Kot, to: KotTarget) => advance.mutate({ kot, to }),
    [advance],
  );
  const onBump = useCallback((kot: Kot, item: KotItem) => bump.mutate({ kot, item }), [bump]);
  const onAssign = useCallback((kot: Kot) => setAssignFor(kot), []);

  const list = kots.data?.data ?? [];
  const columns = KDS_COLUMNS.map((col) => ({
    ...col,
    kots: list.filter((k) => k.status === col.status).sort(byAge),
  }));
  const m = metrics.data;
  const delayedCount = Math.max(
    m?.delayed ?? 0,
    list.filter((k) => kotUrgency(k, now, delayed.has(k.id)) === 'late').length,
  );

  return (
    <div
      data-theme={forceDark ? 'dark' : undefined}
      className={cn(
        'flex flex-col gap-3 bg-background text-foreground',
        fullScreen ? 'lg:min-h-0 lg:flex-1' : 'rounded-2xl p-3 lg:h-[calc(100dvh-11rem)]',
      )}
    >
      <title>{`${t(portal.titleKey)} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-surface px-3 py-2">
        <h1 className="text-xl font-bold tracking-wide uppercase">{t('kds.title')}</h1>
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('kds.station')}</span>
          <Select
            value={station ?? 'all'}
            className="w-48"
            onChange={(e) => {
              const value = e.target.value;
              writeStorage(STORAGE_KEYS.kdsStation, value);
              setStation(value === 'all' ? null : value);
            }}
          >
            <option value="all">{t('kds.allStations')}</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <dl
          aria-label={t('kds.metrics.label')}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base"
        >
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('kds.metrics.pending')}</dt>
            <dd className="font-bold tabular-nums">{format.number(m?.pending ?? list.length)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">{t('kds.metrics.avg')}</dt>
            <dd className="font-bold tabular-nums">
              {m?.avgCookSeconds === null || m === undefined
                ? t('kds.metrics.none')
                : t('time.elapsedMinutes', { minutes: Math.round(m.avgCookSeconds / 60) })}
            </dd>
          </div>
          <div
            className={cn('flex items-center gap-1.5', delayedCount > 0 && 'text-state-danger-fg')}
          >
            <dt className={cn(delayedCount === 0 && 'text-muted-foreground')}>
              {t('kds.metrics.delayed')}
            </dt>
            <dd className="flex items-center gap-1 font-bold tabular-nums">
              {format.number(delayedCount)}
              {delayedCount > 0 && <TriangleAlert aria-hidden="true" className="size-4" />}
            </dd>
          </div>
        </dl>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <time dateTime={new Date(now).toISOString()} className="text-2xl font-bold tabular-nums">
            {format.dateTime(new Date(now).toISOString(), { timeStyle: 'short' })}
          </time>
          <SoundToggle />
          {fullScreen && <ConnectionPill />}
        </div>
      </header>

      {kots.isError && (
        <Alert tone="danger" role="alert">
          <p>{errorMessage(kots.error)}</p>
          <Button variant="outline" className="mt-2" onClick={() => void kots.refetch()}>
            {t('common.retry')}
          </Button>
        </Alert>
      )}
      {kots.isPending ? (
        <Spinner label={t('common.loading')} className="py-6" />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {columns.map((col) => {
            const chip = COLUMN_CHIP[col.status]!;
            const Icon = CHIP_LOOKS[chip].icon;
            const headingId = `kds-col-${col.status}`;
            return (
              <section
                key={col.status}
                aria-labelledby={headingId}
                data-column={col.status}
                className="flex min-h-0 flex-col rounded-xl border bg-muted/40"
              >
                <h2
                  id={headingId}
                  className="flex items-center gap-2 border-b px-3 py-2 text-lg font-bold uppercase"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {t('kds.column', {
                    status: t(`state.kot.${chip}`),
                    count: col.kots.length,
                  })}
                </h2>
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-2">
                  {col.kots.length === 0 ? (
                    <p className="p-3 text-center text-muted-foreground">{t('kds.empty')}</p>
                  ) : (
                    col.kots.map((kot) => (
                      <KotCard
                        key={kot.id}
                        kot={kot}
                        now={now}
                        urgency={kotUrgency(kot, now, delayed.has(kot.id))}
                        next={col.next}
                        fresh={freshIds.has(kot.id)}
                        canAct={canAct}
                        canAssign={canAssign && col.status !== 'READY'}
                        busy={busy.has(kot.id)}
                        onAdvance={onAdvance}
                        onBump={onBump}
                        onAssign={onAssign}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {assignFor !== null && (
        <AssignChefDialog kot={assignFor} onClose={() => setAssignFor(null)} />
      )}
    </div>
  );
}

function AssignChefDialog({ kot, onClose }: { kot: Kot; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const chefs = useChefs(true);
  const assign = useMutation({
    mutationFn: (chefId: string | null) => api.kitchen.assign(kot.id, chefId, kot.version),
    onSuccess: (updated) => {
      applyKot(queryClient, updated);
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: KITCHEN_KEYS.kotLists });
      }
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!assign.isPending}
      closeLabel={t('common.close')}
      title={t('kds.assignTitle', { kotNo: kot.kotNo })}
      size="sm"
    >
      <div className="flex flex-col gap-3">
        {assign.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(assign.error)}
          </Alert>
        )}
        {chefs.isPending && <Spinner label={t('common.loading')} />}
        {chefs.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(chefs.error)}
          </Alert>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {chefs.data?.data.map((chef) => (
            <li key={chef.id}>
              <Button
                variant="outline"
                size="kds"
                className="w-full"
                aria-pressed={kot.assignedChefId === chef.id}
                disabled={assign.isPending}
                onClick={() => assign.mutate(chef.id)}
              >
                {chef.fullName}
              </Button>
            </li>
          ))}
        </ul>
        {kot.assignedChefId !== null && (
          <Button variant="ghost" disabled={assign.isPending} onClick={() => assign.mutate(null)}>
            {t('kds.unassign')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
