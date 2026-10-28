import type { DiningTable, FloorArea } from '@restroos/contracts';
import {
  Button,
  CHIP_LOOKS,
  cn,
  LayoutGrid,
  List,
  SegmentedControl,
  STATE_TONE_CLASSES,
  StateChip,
} from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Portal } from '../../app/portals';
import { QueryState } from '../../features/admin/query-state';
import { AreaTabs } from '../../features/floor/area-tabs';
import { FloorCanvas, SHAPE_CLASSES, tileStyle } from '../../features/floor/floor-canvas';
import { useFloor } from '../../features/floor/floor-queries';
import { TableSheet } from '../../features/floor/table-sheet';
import { STATUS_CHIP, STATUS_ORDER } from '../../features/floor/table-status';
import { useFormat } from '../../i18n/use-format';
import { MenuBrowser } from './menu-browser';

/** Floor state is polled until the WebSocket feed arrives (Sprint 4). */
export const FLOOR_REFRESH_MS = 10_000;

type Tab = 'floor' | 'menu';
type View = 'plan' | 'list';

/** Captain portal (wireframes §4): the floor by area, tables coloured by status. */
export function CaptainPage({ portal }: { portal: Portal }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('floor');
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <title>{`${t(portal.titleKey)} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t(portal.titleKey)}</h1>
        <SegmentedControl<Tab>
          aria-label={t('captain.sections')}
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'floor', label: t('captain.tabs.floor') },
            { value: 'menu', label: t('captain.tabs.menu') },
          ]}
        />
      </header>
      {tab === 'floor' ? <FloorView /> : <MenuBrowser />}
    </div>
  );
}

function FloorView() {
  const floor = useFloor({ refetchInterval: FLOOR_REFRESH_MS });
  return <QueryState query={floor}>{({ areas }) => <Floor areas={areas} />}</QueryState>;
}

function Floor({ areas }: { areas: readonly FloorArea[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const active = areas
    .filter((a) => a.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const [areaId, setAreaId] = useState<string | null>(null);
  // Phones get the list: a 48-column plan is too small to tap at 360 px.
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
      ? 'list'
      : 'plan',
  );
  const [open, setOpen] = useState<string | null>(null);
  const area = active.find((a) => a.id === areaId) ?? active[0] ?? null;
  const tables = (area?.tables ?? []).filter((x) => x.isActive);
  const openTable = tables.find((x) => x.id === open) ?? null;

  if (area === null) return <p className="text-muted-foreground">{t('captain.noFloor')}</p>;

  const counts = new Map<string, number>();
  for (const x of tables) counts.set(x.status, (counts.get(x.status) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AreaTabs
          label={t('floor.areas.label')}
          areas={active}
          value={area.id}
          onChange={setAreaId}
          panelId="captain-floor"
        />
        <SegmentedControl<View>
          aria-label={t('captain.view')}
          value={view}
          onValueChange={setView}
          options={[
            {
              value: 'plan',
              label: <LayoutGrid aria-hidden="true" />,
              ariaLabel: t('captain.viewPlan'),
            },
            { value: 'list', label: <List aria-hidden="true" />, ariaLabel: t('captain.viewList') },
          ]}
        />
      </div>

      <div id="captain-floor">
        {view === 'plan' ? (
          // Wide enough that a 4-cell table shows its status in words; narrower
          // screens scroll the plan sideways inside its own box.
          <div className="overflow-x-auto rounded-xl">
            <FloorCanvas
              label={t('floor.layout.canvasLabel', { area: area.name })}
              className="min-w-[56rem]"
            >
              {tables.map((table) => (
                <PlanTile key={table.id} table={table} onOpen={() => setOpen(table.id)} />
              ))}
            </FloorCanvas>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...tables]
              .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
              .map((table) => {
                const state = STATUS_CHIP[table.status];
                return (
                  <li key={table.id}>
                    <Button
                      variant="outline"
                      className="h-full w-full flex-col items-start gap-1 p-3 text-start"
                      data-status={table.status}
                      onClick={() => setOpen(table.id)}
                    >
                      <span className="text-xl font-bold">{table.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {t('floor.tables.seatsShort', { seats: table.seats })}
                      </span>
                      <StateChip size="sm" state={state} label={t(`state.table.${state}`)} />
                    </Button>
                  </li>
                );
              })}
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

      {openTable !== null && (
        <TableSheet table={openTable} areaName={area.name} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/** A table on the plan: status colour + icon, label, seats, and the status name when it fits. */
function PlanTile({ table, onOpen }: { table: DiningTable; onOpen: () => void }) {
  const { t } = useTranslation();
  const state = STATUS_CHIP[table.status];
  const look = CHIP_LOOKS[state];
  const Icon = look.icon;
  const status = t(`state.table.${state}`);
  return (
    <button
      type="button"
      data-status={table.status}
      aria-label={t('captain.tileLabel', { label: table.label, seats: table.seats, status })}
      onClick={onOpen}
      style={tileStyle(table, table.shape)}
      className={cn(
        'absolute flex flex-col items-center justify-center gap-0.5 overflow-hidden border-2 p-0.5 text-center leading-tight @container',
        'transition-colors duration-200',
        SHAPE_CLASSES[table.shape],
        STATE_TONE_CLASSES[look.tone],
      )}
    >
      <span className="flex items-center gap-1">
        <Icon aria-hidden="true" className={cn('size-4 shrink-0', look.iconClassName)} />
        <span className="text-sm font-bold text-foreground @min-[4.5rem]:text-base">
          {table.label}
        </span>
      </span>
      <span className="hidden text-xs font-medium @min-[4rem]:block">{status}</span>
      <span className="hidden text-xs text-muted-foreground @min-[5.5rem]:block">
        {t('floor.tables.seatsShort', { seats: table.seats })}
      </span>
    </button>
  );
}
