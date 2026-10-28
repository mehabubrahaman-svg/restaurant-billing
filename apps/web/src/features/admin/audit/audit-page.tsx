import type { AuditLogEntry, AuditVerifyResponse } from '@restroos/contracts';
import {
  Alert,
  Button,
  ChevronDown,
  ChevronUp,
  cn,
  Field,
  Input,
  ShieldCheck,
  Spinner,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AuditFilter } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { AdminHeader } from '../admin-layout';
import { jsonDiff } from './json-diff';

interface FilterDraft {
  action: string;
  entityType: string;
  from: string;
  to: string;
}
const EMPTY: FilterDraft = { action: '', entityType: '', from: '', to: '' };

/** Date input (local day) → ISO bound. `to` is exclusive, so it moves to the next day. */
function toFilter(d: FilterDraft): AuditFilter {
  const day = (s: string, plus: number) => {
    const date = new Date(`${s}T00:00:00`);
    date.setDate(date.getDate() + plus);
    return date.toISOString();
  };
  return {
    ...(d.action.trim() !== '' ? { action: d.action.trim() } : {}),
    ...(d.entityType.trim() !== '' ? { entityType: d.entityType.trim() } : {}),
    ...(d.from !== '' ? { from: day(d.from, 0) } : {}),
    ...(d.to !== '' ? { to: day(d.to, 1) } : {}),
  };
}

export function AuditPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState<FilterDraft>(EMPTY);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [open, setOpen] = useState<string | null>(null);

  const pages = useInfiniteQuery({
    queryKey: ['audit', filter],
    queryFn: ({ pageParam }) =>
      api.audit.list({ ...filter, ...(pageParam === null ? {} : { cursor: pageParam }) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const verify = useMutation({ mutationFn: api.audit.verify });

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilter(toFilter(draft));
  }

  const rows = pages.data?.pages.flatMap((p) => p.data) ?? [];
  const brokenId = verify.data?.ok === false ? verify.data.brokenAtId : undefined;

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('audit.title')}
        description={t('audit.description')}
        actions={
          <Button variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
            <ShieldCheck aria-hidden="true" />
            {verify.isPending ? t('audit.verifying') : t('audit.verify')}
          </Button>
        }
      />
      {verify.isError && (
        <Alert tone="danger" role="alert">
          {errorMessage(verify.error)}
        </Alert>
      )}
      {verify.data !== undefined && <VerifyResult result={verify.data} />}

      <form
        onSubmit={apply}
        className="grid items-end gap-3 rounded-xl border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Field label={t('audit.action')}>
          {(p) => (
            <Input
              {...p}
              placeholder="user.updated"
              spellCheck={false}
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('audit.entity')}>
          {(p) => (
            <Input
              {...p}
              placeholder="user"
              spellCheck={false}
              value={draft.entityType}
              onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('audit.from')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('audit.to')}>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit">{t('audit.apply')}</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilter({});
            }}
          >
            {t('audit.clear')}
          </Button>
        </div>
      </form>

      {pages.isPending ? (
        <Spinner label={t('common.loading')} />
      ) : pages.isError ? (
        <Alert tone="danger" role="alert">
          {errorMessage(pages.error)}
        </Alert>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">{t('audit.empty')}</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{t('audit.time')}</Th>
              <Th>{t('audit.action')}</Th>
              <Th>{t('audit.entity')}</Th>
              <Th>{t('audit.actor')}</Th>
              <Th>{t('audit.approver')}</Th>
              <Th>{t('audit.reason')}</Th>
              <Th>
                <span className="sr-only">{t('audit.changes')}</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <AuditRow
                key={row.id}
                row={row}
                broken={row.id === brokenId}
                expanded={open === row.id}
                onToggle={() => setOpen(open === row.id ? null : row.id)}
              />
            ))}
          </TBody>
        </Table>
      )}
      {pages.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => void pages.fetchNextPage()}
          disabled={pages.isFetchingNextPage}
        >
          {pages.isFetchingNextPage ? t('common.loading') : t('audit.more')}
        </Button>
      )}
    </div>
  );
}

function VerifyResult({ result }: { result: AuditVerifyResponse }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (result.ok) {
    return (
      <Alert tone="success" role="status" title={t('audit.verifyOk')}>
        {t('audit.verifyOkBody', { rows: result.rows, time: format.dateTime(result.checkedAt) })}
      </Alert>
    );
  }
  return (
    <Alert tone="danger" role="alert" title={t('audit.verifyBroken')} className="border-2">
      <p>{t('audit.verifyBrokenBody', { id: result.brokenAtId ?? '?' })}</p>
      {result.reason !== undefined && (
        <p className="mt-1 font-mono text-xs break-all">{result.reason}</p>
      )}
    </Alert>
  );
}

function AuditRow({
  row,
  broken,
  expanded,
  onToggle,
}: {
  row: AuditLogEntry;
  broken: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const diff = expanded ? jsonDiff(row.before, row.after) : [];
  const hasChanges = row.before !== null || row.after !== null;
  return (
    <Fragment>
      <Tr
        className={cn(
          broken && 'bg-state-danger-soft outline-2 -outline-offset-2 outline-state-danger',
        )}
      >
        <Td className="whitespace-nowrap tabular-nums">{format.dateTime(row.occurredAt)}</Td>
        <Td className="font-mono text-xs">{row.action}</Td>
        <Td>
          <span>{row.entityType}</span>
          <span className="block font-mono text-xs text-muted-foreground" title={row.entityId}>
            {row.entityId.slice(0, 8)}
          </span>
        </Td>
        <Td>{row.actor?.fullName ?? t('audit.system')}</Td>
        <Td>{row.approver?.fullName ?? ''}</Td>
        <Td className="max-w-64 break-words">{row.reason ?? ''}</Td>
        <Td className="text-end">
          {hasChanges && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-touch"
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {t('audit.changes')}
            </Button>
          )}
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td colSpan={7} className="bg-muted/50">
            {diff.length === 0 ? (
              <p className="text-muted-foreground">{t('audit.noDiff')}</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-start text-muted-foreground">
                    <th className="py-1 pe-3 text-start font-medium">{t('audit.field')}</th>
                    <th className="py-1 pe-3 text-start font-medium">{t('audit.before')}</th>
                    <th className="py-1 text-start font-medium">{t('audit.after')}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {diff.map((d) => (
                    <tr key={d.path} className="border-t align-top">
                      <td className="py-1 pe-3 break-all">{d.path}</td>
                      <td className="py-1 pe-3 break-all text-state-danger-fg">
                        {d.before ?? '—'}
                      </td>
                      <td className="py-1 break-all text-state-available-fg">{d.after ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Td>
        </Tr>
      )}
    </Fragment>
  );
}
