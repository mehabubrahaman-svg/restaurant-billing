import {
  Alert,
  Button,
  Dialog,
  Field,
  Plus,
  SegmentedControl,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api, type StockCountType } from '../../api/endpoints';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { storeCount, useStockCounts } from '../../features/inventory/inventory-queries';
import { useDayFormat } from '../../features/reports/use-day-format';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { COUNT_PERMISSION, CountStatus, CountValue } from './count-parts';

const COUNT_TYPES: readonly StockCountType[] = ['SPOT', 'CLOSING', 'OPENING'];

/** /inventory/counts: physical stock counts, newest first, with what posting them changed. */
export function CountsPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const day = useDayFormat();
  const canCount = usePermission(COUNT_PERMISSION);
  const counts = useStockCounts();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('inventory.counts.title')}
        description={t('inventory.counts.description')}
        actions={
          canCount ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('inventory.counts.new')}
            </Button>
          ) : undefined
        }
      />
      <QueryState query={counts}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('inventory.counts.empty')}</p>
          ) : (
            <Table aria-label={t('inventory.counts.title')}>
              <THead>
                <Tr>
                  <Th>{t('inventory.counts.date')}</Th>
                  <Th>{t('inventory.counts.type')}</Th>
                  <Th>{t('inventory.counts.status')}</Th>
                  <Th className="text-end">{t('inventory.counts.counted')}</Th>
                  <Th className="text-end">{t('inventory.counts.varianceValue')}</Th>
                  <Th>{t('inventory.counts.by')}</Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((c) => (
                  <Tr key={c.id}>
                    <Td className="whitespace-nowrap">
                      <Link
                        to={`/inventory/counts/${c.id}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {day(c.businessDate)}
                      </Link>
                      {c.notes !== null && (
                        <span className="block text-xs break-words text-muted-foreground">
                          {c.notes}
                        </span>
                      )}
                    </Td>
                    <Td>{t(`inventory.counts.types.${c.countType}`)}</Td>
                    <Td>
                      <CountStatus count={c} />
                    </Td>
                    <Td className="text-end tabular-nums">{format.number(c.counted)}</Td>
                    <Td className="text-end">
                      {c.status === 'POSTED' ? (
                        <CountValue paise={c.varianceValue} />
                      ) : (
                        t('reports.none')
                      )}
                    </Td>
                    <Td className="text-sm">
                      {c.status === 'POSTED'
                        ? t('inventory.counts.postedBy', {
                            name: c.postedByName ?? t('reports.none'),
                            time: format.dateTime(c.postedAt ?? c.createdAt, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }),
                          })
                        : t('inventory.counts.startedBy', {
                            name: c.createdByName ?? t('reports.none'),
                            time: format.dateTime(c.createdAt, { timeStyle: 'short' }),
                          })}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        }
      </QueryState>
      {creating && <NewCountDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [type, setType] = useState<StockCountType>('SPOT');
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.inventory.createCount({
        countType: type,
        notes: notes.trim() === '' ? null : notes.trim(),
      }),
    onSuccess: (count) => {
      storeCount(queryClient, count);
      void navigate(`/inventory/counts/${count.id}`);
    },
  });
  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      dismissible={!create.isPending}
      closeLabel={t('common.close')}
      title={t('inventory.counts.new')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? t('common.saving') : t('inventory.counts.start')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(create.error)}
          </Alert>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('inventory.counts.type')}</legend>
          <SegmentedControl<StockCountType>
            className="self-start"
            aria-label={t('inventory.counts.type')}
            value={type}
            onValueChange={setType}
            options={COUNT_TYPES.map((c) => ({
              value: c,
              label: t(`inventory.counts.types.${c}`),
            }))}
          />
          <p className="text-sm text-muted-foreground">{t(`inventory.counts.typeHints.${type}`)}</p>
        </fieldset>
        <Field label={t('inventory.counts.notes')} hint={t('common.optional')}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
