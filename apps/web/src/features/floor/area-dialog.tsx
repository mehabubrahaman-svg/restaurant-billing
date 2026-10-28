import type { FloorArea } from '@restroos/contracts';
import { Alert, Button, Dialog, Field, Input } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { toast } from '../toast/toast-store';
import { FLOOR_KEY } from './floor-queries';

/** Add or rename a floor area; retire or restore it. */
export function AreaDialog({
  area,
  nextSortOrder,
  onClose,
  onCreated,
}: {
  area: FloorArea | null;
  nextSortOrder: number;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(area?.name ?? '');
  const [nameError, setNameError] = useState(false);

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (area !== null && change !== 'save') {
        return api.floor.updateArea(area.id, {
          version: area.version,
          isActive: change === 'restore',
        });
      }
      if (name.trim().length < 1 || name.trim().length > 60) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      return area === null
        ? api.floor.createArea({ name: name.trim(), sortOrder: nextSortOrder })
        : api.floor.updateArea(area.id, { name: name.trim(), version: area.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: FLOOR_KEY });
      toast(t('floor.areas.saved', { name: saved.name }));
      if (area === null) onCreated?.(saved.id);
      onClose();
    },
  });

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={area === null ? t('floor.areas.add') : t('floor.areas.editNamed', { name: area.name })}
      footer={
        <>
          {area !== null && (
            <Button
              variant={area.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={save.isPending}
              onClick={() => save.mutate(area.isActive ? 'retire' : 'restore')}
            >
              {area.isActive ? t('common.retire') : t('common.restore')}
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
        {area !== null && area.isActive && (
          <p className="text-sm text-muted-foreground">{t('floor.areas.retireHint')}</p>
        )}
        <Field
          label={t('floor.areas.name')}
          hint={t('floor.areas.nameHint')}
          required
          error={nameError ? t('floor.areas.nameError') : undefined}
        >
          {(p) => (
            <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
