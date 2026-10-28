import type { TaxGroup } from '@restroos/contracts';
import { Badge, Button, Card, Pencil, Plus, Switch } from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';
import { TaxGroupDialog } from './tax-group-dialog';
import { componentLabel } from './tax-labels';

export function TaxesPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const groups = useQuery({ queryKey: ['tax-groups'], queryFn: api.taxGroups.list });
  const [editing, setEditing] = useState<TaxGroup | 'new' | null>(null);

  const toggle = useMutation({
    mutationFn: (g: TaxGroup) =>
      api.taxGroups.update(g.id, { version: g.version, isActive: !g.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tax-groups'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  // Percent strings ("2.5") localised digit by digit for display.
  const digits = (s: string) =>
    s.replace(/\d+/g, (d) => format.number(Number(d), { useGrouping: false }));

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('taxes.title')}
        description={t('taxes.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('taxes.add')}
          </Button>
        }
      />
      <QueryState query={groups}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('taxes.empty')}</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {data.map((g) => (
                <li key={g.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold">{g.name}</h2>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="info">{t(`taxes.types.${g.taxType}`)}</Badge>
                          <Badge variant="outline">{t(`taxes.categories.${g.taxCategory}`)}</Badge>
                          <Badge variant="outline">{g.invoiceSeries}</Badge>
                          {g.isInclusive && <Badge>{t('taxes.inclusiveBadge')}</Badge>}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-touch"
                        onClick={() => setEditing(g)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {g.components.length === 0 && (
                        <li className="text-muted-foreground">{t('taxes.noTax')}</li>
                      )}
                      {g.components.map((c, i) => (
                        <li key={i} className="tabular-nums">
                          {componentLabel(t, c, digits)}
                        </li>
                      ))}
                    </ul>
                    <Switch
                      className="mt-auto border-t pt-2"
                      label={g.isActive ? t('common.active') : t('common.inactive')}
                      checked={g.isActive}
                      disabled={toggle.isPending}
                      onCheckedChange={() => toggle.mutate(g)}
                    />
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      {editing !== null && (
        <TaxGroupDialog
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
