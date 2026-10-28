import type { DiningTable, FloorArea } from '@restroos/contracts';
import { Alert, Button, cn, Dialog, Field, Input, Select } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type TableShape } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { toast } from '../toast/toast-store';
import { SHAPE_CLASSES } from './floor-canvas';
import { FLOOR_KEY } from './floor-queries';
import { firstFreeCell, FOOTPRINT } from './layout-math';

export const SHAPES: readonly TableShape[] = ['SQUARE', 'ROUND', 'RECT', 'BOOTH'];

/** Add a table to an area, or edit / retire / restore one. */
export function TableDialog({
  table,
  areas,
  areaId,
  onClose,
}: {
  table: DiningTable | null;
  areas: readonly FloorArea[];
  /** The area a new table goes into. */
  areaId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [label, setLabel] = useState(table?.label ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [shape, setShape] = useState<TableShape>(table?.shape ?? 'SQUARE');
  const [area, setArea] = useState(table?.floorAreaId ?? areaId);
  const [errors, setErrors] = useState<{ label?: boolean; seats?: boolean }>({});

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (table !== null && change !== 'save') {
        return api.floor.updateTable(table.id, {
          version: table.version,
          isActive: change === 'restore',
        });
      }
      const n = /^\d{1,2}$/.test(seats.trim()) ? Number(seats) : NaN;
      const found = {
        ...(label.trim().length < 1 || label.trim().length > 12 ? { label: true } : {}),
        ...(n >= 1 && n <= 40 ? {} : { seats: true }),
      };
      setErrors(found);
      if (Object.keys(found).length > 0) return null;
      const target = areas.find((a) => a.id === area);
      const others = (target?.tables ?? []).filter((x) => x.isActive && x.id !== table?.id);
      const body = { label: label.trim(), seats: n, shape, floorAreaId: area };
      if (table === null) {
        return api.floor.createTable({ ...body, ...firstFreeCell(others, shape) });
      }
      // Moving to another area: place it clear of that area's tables.
      const moved = area !== table.floorAreaId ? firstFreeCell(others, shape) : {};
      return api.floor.updateTable(table.id, { ...body, ...moved, version: table.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      toast(t('floor.tables.saved', { label: saved.label }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        table === null ? t('floor.tables.add') : t('floor.tables.editNamed', { label: table.label })
      }
      footer={
        <>
          {table !== null && (
            <Button
              variant={table.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={save.isPending}
              onClick={() => save.mutate(table.isActive ? 'retire' : 'restore')}
            >
              {table.isActive ? t('common.retire') : t('common.restore')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate('save')} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
            {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
          </Alert>
        )}
        {table !== null && table.isActive && (
          <p className="text-sm text-muted-foreground">{t('floor.tables.retireHint')}</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('floor.tables.label')}
            hint={t('floor.tables.labelHint')}
            required
            error={errors.label === true ? t('floor.tables.labelError') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                maxLength={12}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('floor.tables.seats')}
            required
            error={errors.seats === true ? t('floor.tables.seatsError') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('floor.tables.area')} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={area} onChange={(e) => setArea(e.target.value)}>
                {areas
                  .filter((a) => a.isActive || a.id === area)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('floor.tables.shape')}</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SHAPES.map((s) => {
              const size = FOOTPRINT[s];
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={shape === s}
                  onClick={() => setShape(s)}
                  className={cn(
                    'flex min-h-touch flex-col items-center gap-2 rounded-lg border p-2 text-sm font-medium',
                    shape === s
                      ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary'
                      : 'border-input bg-surface hover:bg-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn('border-2 border-current bg-muted', SHAPE_CLASSES[s])}
                    style={{ width: size.w * 7, height: size.h * 7 }}
                  />
                  {t(`floor.shapes.${s}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
