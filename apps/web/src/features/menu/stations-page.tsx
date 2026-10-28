import type { KitchenStation, MenuItem } from '@restroos/contracts';
import { Alert, Badge, Button, ChefHat, Dialog, Field, Input, Pencil, Plus } from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { AdminHeader } from '../admin/admin-layout';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { invalidateMenu, useMenuItems, useStations } from './menu-queries';

/** Admin → Menu → Kitchen stations: where KOTs for an item go (Tandoor, Chinese, Bar…). */
export function StationsPage() {
  const { t } = useTranslation();
  const stations = useStations();
  const items = useMenuItems();
  const [editing, setEditing] = useState<KitchenStation | 'new' | null>(null);
  const itemCount = (id: string) =>
    (items.data?.data ?? []).filter((i: MenuItem) => i.isActive && i.kitchenStationId === id)
      .length;

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('menu.stations.title')}
        description={t('menu.stations.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('menu.stations.add')}
          </Button>
        }
      />
      <QueryState query={stations}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('menu.stations.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border bg-surface">
              {[...data]
                .sort(
                  (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name),
                )
                .map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <ChefHat aria-hidden="true" className="size-5 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium break-words">{s.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {t('menu.categories.itemCount', { count: itemCount(s.id) })}
                      </span>
                    </span>
                    {!s.isActive && <Badge>{t('common.retired')}</Badge>}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-touch"
                      aria-label={t('menu.stations.editNamed', { name: s.name })}
                      onClick={() => setEditing(s)}
                    >
                      <Pencil aria-hidden="true" />
                      {t('common.edit')}
                    </Button>
                  </li>
                ))}
            </ul>
          )
        }
      </QueryState>
      {editing !== null && (
        <StationDialog
          station={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StationDialog({
  station,
  onClose,
}: {
  station: KitchenStation | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(station?.name ?? '');
  const [nameError, setNameError] = useState(false);

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (station !== null && change !== 'save') {
        return api.menu.updateStation(station.id, {
          version: station.version,
          isActive: change === 'restore',
        });
      }
      if (name.trim().length < 1 || name.trim().length > 120) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      return station === null
        ? api.menu.createStation({ name: name.trim() })
        : api.menu.updateStation(station.id, { name: name.trim(), version: station.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void invalidateMenu(queryClient);
      toast(t('menu.stations.saved', { name: saved.name }));
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
      title={
        station === null
          ? t('menu.stations.add')
          : t('menu.stations.editNamed', { name: station.name })
      }
      footer={
        <>
          {station !== null && (
            <Button
              variant={station.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={save.isPending}
              onClick={() => save.mutate(station.isActive ? 'retire' : 'restore')}
            >
              {station.isActive ? t('common.retire') : t('common.restore')}
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
        <Field
          label={t('menu.stations.name')}
          hint={t('menu.stations.nameHint')}
          required
          error={nameError ? t('menu.item.errors.name') : undefined}
        >
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
