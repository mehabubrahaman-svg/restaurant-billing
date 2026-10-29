import type { Vendor } from '@restroos/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Pencil,
  Plus,
  Search,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AdminHeader } from '../../features/admin/admin-layout';
import { QueryState } from '../../features/admin/query-state';
import { usePermission } from '../../features/auth/permissions';
import { useVendors } from '../../features/purchasing/purchasing-queries';
import { useMoney, useTerms } from './purchase-ui';
import { VendorDialog } from './vendor-dialog';

/** /purchase/vendors: suppliers with their GSTIN, terms and what is owed to each. */
export function VendorsPage() {
  const { t } = useTranslation();
  const canManage = usePermission('vendors.manage');
  const [showRetired, setShowRetired] = useState(false);
  const [q, setQ] = useState('');
  const vendors = useVendors(showRetired);
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('purchase.vendors.title')}
        description={t('purchase.vendors.description')}
        actions={
          canManage ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('purchase.vendors.add')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="relative w-full max-w-md">
          <span className="sr-only">{t('purchase.vendors.search')}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="ps-10"
            autoComplete="off"
            placeholder={t('purchase.vendors.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <Checkbox
          label={t('purchase.vendors.showRetired')}
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
        />
      </div>
      <QueryState query={vendors}>
        {({ data }) => (
          <VendorTable vendors={data} q={q} canManage={canManage} onEdit={setEditing} />
        )}
      </QueryState>
      {editing !== null && (
        <VendorDialog
          vendor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function VendorTable({
  vendors,
  q,
  canManage,
  onEdit,
}: {
  vendors: readonly Vendor[];
  q: string;
  canManage: boolean;
  onEdit: (vendor: Vendor) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const terms = useTerms();
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle === '') return vendors;
    return vendors.filter((v) =>
      [v.name, v.code, v.taxId ?? '', v.phone ?? '', v.contactPerson ?? ''].some((s) =>
        s.toLowerCase().includes(needle),
      ),
    );
  }, [vendors, q]);
  const owed = vendors.reduce((sum, v) => sum + Math.max(0, v.due), 0);

  if (vendors.length === 0) {
    return <p className="text-muted-foreground">{t('purchase.vendors.empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4">
        <span className="text-sm text-muted-foreground">{t('purchase.vendors.totalOwed')}</span>
        <span className="text-xl font-bold tabular-nums">{money(owed)}</span>
      </Card>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('purchase.vendors.noMatch', { q: q.trim() })}</p>
      ) : (
        <Table>
          <caption className="sr-only">
            {t('purchase.vendors.caption', { count: rows.length })}
          </caption>
          <THead>
            <Tr>
              <Th>{t('purchase.vendors.vendor')}</Th>
              <Th>{t('purchase.vendors.contact')}</Th>
              <Th>{t('purchase.vendors.gstin')}</Th>
              <Th>{t('purchase.vendors.terms')}</Th>
              <Th className="text-end">{t('purchase.vendors.owed')}</Th>
              {canManage && (
                <Th>
                  <span className="sr-only">{t('purchase.actions')}</span>
                </Th>
              )}
            </Tr>
          </THead>
          <TBody>
            {rows.map((v) => (
              <Tr key={v.id} className={v.isActive ? undefined : 'text-muted-foreground'}>
                <Td>
                  <Link
                    to={`/purchase/vendors/${v.id}`}
                    className="font-medium break-words text-primary underline-offset-2 hover:underline"
                  >
                    {v.name}
                  </Link>
                  <span className="block font-mono text-xs text-muted-foreground">{v.code}</span>
                  {!v.isActive && (
                    <Badge variant="neutral" className="mt-1">
                      {t('common.retired')}
                    </Badge>
                  )}
                </Td>
                <Td className="break-words">
                  {v.contactPerson ?? ''}
                  {v.phone !== null && (
                    <span className="block whitespace-nowrap tabular-nums">{v.phone}</span>
                  )}
                  {v.contactPerson === null && v.phone === null && t('reports.none')}
                </Td>
                <Td>
                  {v.taxId === null ? (
                    <span className="text-sm text-muted-foreground">
                      {t('purchase.vendors.unregistered')}
                    </span>
                  ) : (
                    <span className="font-mono text-sm">{v.taxId}</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{terms(v.paymentTermsDays)}</Td>
                <Td className="text-end whitespace-nowrap tabular-nums">
                  {v.due < 0 ? (
                    <span className="text-state-occupied-fg">
                      {t('purchase.vendors.advance', { amount: money(-v.due) })}
                    </span>
                  ) : (
                    <span className={v.due > 0 ? 'font-semibold' : undefined}>{money(v.due)}</span>
                  )}
                </Td>
                {canManage && (
                  <Td className="text-end">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={t('purchase.vendors.editNamed', { name: v.name })}
                      onClick={() => onEdit(v)}
                    >
                      <Pencil aria-hidden="true" />
                      {/* Just the pencil on a tablet, so the row fits. */}
                      <span className="max-lg:sr-only">{t('common.edit')}</span>
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
