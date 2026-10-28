import { LAYOUT_GRID, type DiningTable, type FloorArea } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  cn,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Save,
  StateChip,
  Switch,
  Undo2,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { UnsavedChangesDialog } from '../../components/unsaved-changes-dialog';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { useUnsavedGuard } from '../../lib/use-unsaved-guard';
import { AdminHeader } from '../admin/admin-layout';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { AreaDialog } from './area-dialog';
import { AreaTabs } from './area-tabs';
import { FloorCanvas, SHAPE_CLASSES, tileStyle } from './floor-canvas';
import { FLOOR_KEY, mergeTables, useFloor } from './floor-queries';
import {
  arrowStep,
  findOverlaps,
  FOOTPRINT,
  layoutChanges,
  moveBy,
  snapDrag,
  type Cell,
} from './layout-math';
import { TableDialog } from './table-dialog';
import { TableQrDialog } from './table-qr';
import { STATUS_CHIP } from './table-status';

const CANVAS_ID = 'floor-editor-canvas';

/** Admin → Floor: areas, tables, drag-and-drop layout with an explicit Save, QR codes. */
export function FloorEditorPage() {
  const { t } = useTranslation();
  const floor = useFloor();
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('floor.title')} description={t('floor.description')} />
      <QueryState query={floor}>{({ areas }) => <FloorEditor areas={areas} />}</QueryState>
    </div>
  );
}

interface Drag {
  readonly id: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly start: Cell;
}

function FloorEditor({ areas }: { areas: readonly FloorArea[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Cell>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [areaDialog, setAreaDialog] = useState<FloorArea | 'new' | null>(null);
  const [tableDialog, setTableDialog] = useState<DiningTable | 'new' | null>(null);
  const [qrTable, setQrTable] = useState<DiningTable | null>(null);
  const [conflict, setConflict] = useState(false);

  const shownAreas = areas
    .filter((a) => showRetired || a.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const area = shownAreas.find((a) => a.id === areaId) ?? shownAreas[0] ?? null;
  const allTables = useMemo(() => areas.flatMap((a) => a.tables), [areas]);
  const changes = layoutChanges(allTables, draft);
  const dirty = changes.length > 0;
  const { blocker } = useUnsavedGuard(dirty);

  const position = (table: DiningTable): Cell => draft[table.id] ?? table;
  const activeTables = (area?.tables ?? []).filter((x) => x.isActive);
  const overlapping = findOverlaps(
    activeTables.map((x) => ({ id: x.id, shape: x.shape, ...position(x) })),
  );

  const save = useMutation({
    mutationFn: () => api.floor.saveLayout(changes),
    onSuccess: (tables) => {
      mergeTables(queryClient, tables);
      setDraft({});
      setConflict(false);
      void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      toast(t('floor.layout.saved', { count: tables.length }));
    },
    onError: (error) => {
      if (isApiError(error, 'VERSION_CONFLICT')) setConflict(true);
    },
  });

  const reload = useMutation({
    // Fetch the latest layout; our moves stay in the draft and are re-applied on top.
    mutationFn: () => queryClient.refetchQueries({ queryKey: FLOOR_KEY, exact: true }),
    onSuccess: () => {
      setConflict(false);
      save.reset();
    },
  });

  function place(table: DiningTable, cell: Cell, announce: boolean) {
    setDraft((d) => ({ ...d, [table.id]: cell }));
    if (announce) {
      setAnnouncement(
        t('floor.layout.movedTo', {
          label: table.label,
          column: cell.posX + 1,
          row: cell.posY + 1,
        }),
      );
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, table: DiningTable) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      id: table.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: position(table),
    };
    setSelected(table.id);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>, table: DiningTable) {
    const d = drag.current;
    if (d === null || d.pointerId !== event.pointerId || d.id !== table.id) return;
    const rect = canvas.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (dragging === null && Math.hypot(dx, dy) > 3) setDragging(table.id);
    const next = snapDrag(
      d.start,
      { dx, dy },
      { w: rect.width / LAYOUT_GRID.columns, h: rect.height / LAYOUT_GRID.rows },
      FOOTPRINT[table.shape],
    );
    const current = position(table);
    if (next.posX !== current.posX || next.posY !== current.posY) place(table, next, false);
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>, table: DiningTable) {
    const d = drag.current;
    if (d === null || d.pointerId !== event.pointerId) return;
    drag.current = null;
    if (dragging !== null) {
      const cell = position(table);
      setAnnouncement(
        t('floor.layout.movedTo', {
          label: table.label,
          column: cell.posX + 1,
          row: cell.posY + 1,
        }),
      );
    }
    setDragging(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, table: DiningTable) {
    const step = arrowStep(event.key, event.shiftKey);
    if (step === null) {
      if (event.key === 'Enter') setTableDialog(table);
      return;
    }
    event.preventDefault();
    setSelected(table.id);
    place(table, moveBy(position(table), step.dx, step.dy, FOOTPRINT[table.shape]), true);
  }

  const nextAreaOrder = areas.reduce((m, a) => Math.max(m, a.sortOrder), 0) + 10;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AreaTabs
          label={t('floor.areas.label')}
          areas={shownAreas}
          value={area?.id ?? null}
          onChange={(id) => {
            setAreaId(id);
            setSelected(null);
          }}
          panelId={CANVAS_ID}
          describe={(a) => (a.isActive ? null : t('common.retired'))}
          after={
            <>
              <Button variant="outline" onClick={() => setAreaDialog('new')}>
                <Plus aria-hidden="true" />
                {t('floor.areas.add')}
              </Button>
              {area !== null && (
                <Button
                  variant="ghost"
                  onClick={() => setAreaDialog(area)}
                  aria-label={t('floor.areas.editNamed', { name: area.name })}
                >
                  <Pencil aria-hidden="true" />
                  {t('floor.areas.edit')}
                </Button>
              )}
            </>
          }
        />
        <Switch
          label={t('floor.showRetired')}
          checked={showRetired}
          onCheckedChange={setShowRetired}
        />
      </div>

      {area === null ? (
        <Alert tone="info">{t('floor.noAreas')}</Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setTableDialog('new')}
              disabled={!area.isActive}
              variant="outline"
            >
              <Plus aria-hidden="true" />
              {t('floor.tables.add')}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/admin/floor/print?area=${area.id}`}>
                <Printer aria-hidden="true" />
                {t('floor.qr.printAll')}
              </Link>
            </Button>
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {dirty && (
                <Button variant="ghost" onClick={() => setDraft({})} disabled={save.isPending}>
                  <Undo2 aria-hidden="true" />
                  {t('floor.layout.discard')}
                </Button>
              )}
              <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || conflict}>
                <Save aria-hidden="true" />
                {save.isPending
                  ? t('common.saving')
                  : t('floor.layout.save', { count: changes.length })}
              </Button>
            </div>
          </div>

          {conflict ? (
            <Alert tone="warning" role="alert" title={t('floor.layout.conflictTitle')}>
              <p>{t('floor.layout.conflictBody')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => reload.mutate()} disabled={reload.isPending}>
                  {t('floor.layout.reloadKeep')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraft({});
                    setConflict(false);
                    save.reset();
                    void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
                  }}
                >
                  {t('floor.layout.discard')}
                </Button>
              </div>
            </Alert>
          ) : save.isError ? (
            <Alert tone="danger" role="alert">
              {errorMessage(save.error)}
            </Alert>
          ) : dirty ? (
            <Alert tone="warning">{t('floor.layout.unsaved', { count: changes.length })}</Alert>
          ) : null}

          <p id="floor-editor-help" className="text-sm text-muted-foreground">
            {t('floor.layout.help')}
          </p>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>

          <FloorCanvas
            ref={canvas}
            id={CANVAS_ID}
            label={t('floor.layout.canvasLabel', { area: area.name })}
            showGrid
            className={cn(dragging !== null && 'cursor-grabbing')}
          >
            {activeTables.map((table) => {
              const cell = position(table);
              const moved = draft[table.id] !== undefined && changes.some((c) => c.id === table.id);
              const isSelected = selected === table.id;
              const overlap = overlapping.has(table.id);
              return (
                <button
                  key={table.id}
                  type="button"
                  data-table={table.label}
                  aria-pressed={isSelected}
                  aria-describedby="floor-editor-help"
                  aria-label={t('floor.layout.tileLabel', {
                    label: table.label,
                    seats: table.seats,
                    column: cell.posX + 1,
                    row: cell.posY + 1,
                  })}
                  onPointerDown={(e) => onPointerDown(e, table)}
                  onPointerMove={(e) => onPointerMove(e, table)}
                  onPointerUp={(e) => endDrag(e, table)}
                  onPointerCancel={(e) => endDrag(e, table)}
                  onKeyDown={(e) => onKeyDown(e, table)}
                  onFocus={() => setSelected(table.id)}
                  onDoubleClick={() => setTableDialog(table)}
                  style={{ ...tileStyle(cell, table.shape), touchAction: 'none' }}
                  className={cn(
                    'absolute flex cursor-grab flex-col items-center justify-center border-2 bg-surface p-0.5 text-center leading-tight shadow-sm',
                    'transition-[box-shadow,transform] duration-100',
                    SHAPE_CLASSES[table.shape],
                    moved ? 'border-primary bg-accent' : 'border-input',
                    overlap && 'border-dashed border-state-danger',
                    isSelected && 'z-10 ring-4 ring-ring',
                    dragging === table.id && 'z-20 scale-105 cursor-grabbing shadow-lg',
                  )}
                >
                  <span className="text-sm font-bold break-all">{table.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('floor.tables.seatsShort', { seats: table.seats })}
                  </span>
                </button>
              );
            })}
          </FloorCanvas>
          {overlapping.size > 0 && <Alert tone="warning">{t('floor.layout.overlap')}</Alert>}

          <TableList
            tables={area.tables.filter((x) => showRetired || x.isActive)}
            selected={selected}
            onEdit={setTableDialog}
            onQr={setQrTable}
            format={format}
          />
        </>
      )}

      <UnsavedChangesDialog blocker={blocker} />
      {areaDialog !== null && (
        <AreaDialog
          area={areaDialog === 'new' ? null : areaDialog}
          nextSortOrder={nextAreaOrder}
          onCreated={setAreaId}
          onClose={() => setAreaDialog(null)}
        />
      )}
      {tableDialog !== null && area !== null && (
        <TableDialog
          table={tableDialog === 'new' ? null : tableDialog}
          areas={areas}
          areaId={area.id}
          onClose={() => setTableDialog(null)}
        />
      )}
      {qrTable !== null && <TableQrDialog table={qrTable} onClose={() => setQrTable(null)} />}
    </div>
  );
}

function TableList({
  tables,
  selected,
  onEdit,
  onQr,
  format,
}: {
  tables: readonly DiningTable[];
  selected: string | null;
  onEdit: (t: DiningTable) => void;
  onQr: (t: DiningTable) => void;
  format: ReturnType<typeof useFormat>;
}) {
  const { t } = useTranslation();
  if (tables.length === 0)
    return <p className="text-muted-foreground">{t('floor.tables.empty')}</p>;
  return (
    <section aria-label={t('floor.tables.title')} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t('floor.tables.title')}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[...tables]
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
          .map((table) => (
            <li
              key={table.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-xl border bg-surface p-3',
                selected === table.id && 'border-primary',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cn('block font-semibold', !table.isActive && 'line-through')}>
                  {table.label}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t('floor.tables.summary', {
                    seats: format.number(table.seats),
                    shape: t(`floor.shapes.${table.shape}`),
                  })}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                <StateChip
                  size="sm"
                  state={STATUS_CHIP[table.status]}
                  label={t(`state.table.${STATUS_CHIP[table.status]}`)}
                />
                {!table.isActive && <Badge>{t('common.retired')}</Badge>}
              </span>
              <span className="flex w-full gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-touch flex-1"
                  aria-label={t('floor.tables.editNamed', { label: table.label })}
                  onClick={() => onEdit(table)}
                >
                  <Pencil aria-hidden="true" />
                  {t('common.edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-touch flex-1"
                  disabled={!table.isActive}
                  aria-label={t('floor.qr.title', { label: table.label })}
                  onClick={() => onQr(table)}
                >
                  <QrCode aria-hidden="true" />
                  {table.hasQr ? t('floor.qr.short') : t('floor.qr.createShort')}
                </Button>
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}
