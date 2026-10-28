import type { AddonGroup } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  SegmentedControl,
  Trash,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type SaveAddonGroupBody } from '../../api/endpoints';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { paiseToRupees, rupeesToPaise } from '../../lib/units';
import { AdminHeader } from '../admin/admin-layout';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { newRowKey } from './item-form';
import { PriceField } from './price-field';
import { cleanTranslations, localizedName } from './localized-name';
import { invalidateMenu, useAddonGroups } from './menu-queries';

type Filter = 'active' | 'retired' | 'all';

/** Admin → Menu → Add-on groups: e.g. "Extras" (choose up to 2) with Raita ₹40, Extra egg ₹25. */
export function AddonGroupsPage() {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const groups = useAddonGroups();
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<AddonGroup | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('menu.addons.title')}
        description={t('menu.addons.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('menu.addons.add')}
          </Button>
        }
      />
      <SegmentedControl<Filter>
        className="self-start"
        aria-label={t('menu.items.filter')}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'active', label: t('common.active') },
          { value: 'retired', label: t('common.retired') },
          { value: 'all', label: t('users.all') },
        ]}
      />
      <QueryState query={groups}>
        {({ data }) => {
          const shown = data.filter(
            (g) => filter === 'all' || (filter === 'active') === g.isActive,
          );
          if (shown.length === 0) {
            return <p className="text-muted-foreground">{t('menu.addons.empty')}</p>;
          }
          return (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((g) => (
                <li key={g.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold break-words">{g.name}</h2>
                        {i18n.language !== 'en-IN' && (
                          <p className="text-sm text-muted-foreground" lang={i18n.language}>
                            {localizedName(g.name, g.nameTranslations, i18n.language)}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-touch"
                        aria-label={t('menu.addons.editNamed', { name: g.name })}
                        onClick={() => setEditing(g)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="info">
                        {t('menu.addons.rule', { min: g.minSelect, max: g.maxSelect })}
                      </Badge>
                      {!g.isActive && <Badge>{t('common.retired')}</Badge>}
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {g.addons.map((a) => (
                        <li key={a.id} className="flex justify-between gap-2">
                          <span className="break-words">
                            {localizedName(a.name, a.nameTranslations, i18n.language)}
                          </span>
                          <span className="tabular-nums">
                            +{format.money(Money.ofPaise(a.price))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
      {editing !== null && (
        <AddonGroupDialog
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface AddonRow {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly hi: string;
  readonly bn: string;
  readonly price: string;
}

type GroupError =
  | 'menu.item.errors.name'
  | 'menu.addons.errors.min'
  | 'menu.addons.errors.max'
  | 'menu.addons.errors.rule'
  | 'menu.addons.errors.count';

/**
 * Checks a group the way the Hub does (ADDON_GROUP_INVALID): 0 ≤ min ≤ max,
 * 1 ≤ max ≤ 20 and max ≤ number of add-ons; 1 to 50 add-ons. Pure, for tests.
 */
export function checkAddonGroup(input: {
  name: string;
  min: string;
  max: string;
  rows: readonly AddonRow[];
}):
  | { ok: true; body: SaveAddonGroupBody }
  | {
      ok: false;
      errors: Partial<Record<'name' | 'min' | 'max' | 'rows', GroupError>>;
      rowErrors: Record<string, { name?: boolean; price?: boolean }>;
    } {
  const errors: Partial<Record<'name' | 'min' | 'max' | 'rows', GroupError>> = {};
  const rowErrors: Record<string, { name?: boolean; price?: boolean }> = {};
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) errors.name = 'menu.item.errors.name';
  const min = /^\d{1,2}$/.test(input.min.trim()) ? Number(input.min) : NaN;
  const max = /^\d{1,2}$/.test(input.max.trim()) ? Number(input.max) : NaN;
  if (!(min >= 0 && min <= 20)) errors.min = 'menu.addons.errors.min';
  if (!(max >= 1 && max <= 20)) errors.max = 'menu.addons.errors.max';
  if (errors.min === undefined && errors.max === undefined) {
    if (min > max || max > input.rows.length) errors.max = 'menu.addons.errors.rule';
  }
  if (input.rows.length < 1 || input.rows.length > 50) errors.rows = 'menu.addons.errors.count';
  const addons: NonNullable<SaveAddonGroupBody['addons']> = [];
  for (const row of input.rows) {
    const price = rupeesToPaise(row.price);
    const bad = {
      name: row.name.trim() === '' || row.name.trim().length > 120,
      price: price === null,
    };
    if (bad.name || bad.price) {
      rowErrors[row.key] = bad;
      continue;
    }
    addons.push({
      ...(row.id === undefined ? {} : { id: row.id }),
      name: row.name.trim(),
      nameTranslations: cleanTranslations(row.hi, row.bn),
      price: price ?? 0,
    });
  }
  if (Object.keys(errors).length > 0 || Object.keys(rowErrors).length > 0) {
    return { ok: false, errors, rowErrors };
  }
  return { ok: true, body: { name, minSelect: min, maxSelect: max, addons } };
}

function AddonGroupDialog({ group, onClose }: { group: AddonGroup | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(group?.name ?? '');
  const [hi, setHi] = useState(group?.nameTranslations.hi ?? '');
  const [bn, setBn] = useState(group?.nameTranslations.bn ?? '');
  const [min, setMin] = useState(String(group?.minSelect ?? 0));
  const [max, setMax] = useState(String(group?.maxSelect ?? 1));
  const [rows, setRows] = useState<AddonRow[]>(
    group === null
      ? [{ key: newRowKey(), name: '', hi: '', bn: '', price: '' }]
      : group.addons.map((a) => ({
          key: newRowKey(),
          id: a.id,
          name: a.name,
          hi: a.nameTranslations.hi ?? '',
          bn: a.nameTranslations.bn ?? '',
          price: paiseToRupees(a.price),
        })),
  );
  const [checked, setChecked] = useState<ReturnType<typeof checkAddonGroup> | null>(null);

  const save = useMutation({
    mutationFn: async (change: 'save' | 'retire' | 'restore') => {
      if (group !== null && change !== 'save') {
        return api.menu.updateAddonGroup(group.id, {
          version: group.version,
          isActive: change === 'restore',
        });
      }
      const result = checkAddonGroup({ name, min, max, rows });
      setChecked(result);
      if (!result.ok) return null;
      const body = { ...result.body, nameTranslations: cleanTranslations(hi, bn) };
      return group === null
        ? api.menu.createAddonGroup(body)
        : api.menu.updateAddonGroup(group.id, { ...body, version: group.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void invalidateMenu(queryClient);
      toast(t('menu.addons.saved', { name: saved.name }));
      onClose();
    },
  });

  const errors = checked !== null && !checked.ok ? checked.errors : {};
  const rowErrors = checked !== null && !checked.ok ? checked.rowErrors : {};
  const err = (k: keyof typeof errors) => (errors[k] === undefined ? undefined : t(errors[k]));
  const update = (key: string, patch: Partial<AddonRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        group === null ? t('menu.addons.add') : t('menu.addons.editNamed', { name: group.name })
      }
      footer={
        <>
          {group !== null && (
            <Button
              variant={group.isActive ? 'destructive' : 'secondary'}
              className="me-auto"
              disabled={save.isPending}
              onClick={() => save.mutate(group.isActive ? 'retire' : 'restore')}
            >
              {group.isActive ? t('common.retire') : t('common.restore')}
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
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('menu.fields.nameEn')} required error={err('name')}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t('menu.fields.nameHi')}>
            {(p) => <Input {...p} lang="hi" value={hi} onChange={(e) => setHi(e.target.value)} />}
          </Field>
          <Field label={t('menu.fields.nameBn')}>
            {(p) => <Input {...p} lang="bn" value={bn} onChange={(e) => setBn(e.target.value)} />}
          </Field>
          <Field label={t('menu.addons.min')} hint={t('menu.addons.minHint')} error={err('min')}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('menu.addons.max')} hint={t('menu.addons.maxHint')} error={err('max')}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            )}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{t('menu.addons.items')}</legend>
          {rows.map((row, i) => {
            const e = rowErrors[row.key];
            const label = row.name.trim() === '' ? t('menu.addons.addonN', { n: i + 1 }) : row.name;
            return (
              <div
                key={row.key}
                role="group"
                aria-label={label}
                className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_8rem_auto]"
              >
                <Field
                  label={t('menu.addons.addonName')}
                  error={e?.name === true ? t('menu.item.errors.name') : undefined}
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={row.name}
                      onChange={(ev) => update(row.key, { name: ev.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('menu.fields.nameHi')}>
                  {(p) => (
                    <Input
                      {...p}
                      lang="hi"
                      value={row.hi}
                      onChange={(ev) => update(row.key, { hi: ev.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('menu.fields.nameBn')}>
                  {(p) => (
                    <Input
                      {...p}
                      lang="bn"
                      value={row.bn}
                      onChange={(ev) => update(row.key, { bn: ev.target.value })}
                    />
                  )}
                </Field>
                <PriceField
                  label={t('menu.fields.variantPrice')}
                  value={row.price}
                  error={e?.price === true ? t('validation.amount') : undefined}
                  onChange={(price) => update(row.key, { price })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="self-end"
                  aria-label={t('menu.addons.remove', { name: label })}
                  onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
                >
                  <Trash aria-hidden="true" />
                </Button>
              </div>
            );
          })}
          {err('rows') !== undefined && (
            <p className="text-sm font-medium text-state-danger-fg">{err('rows')}</p>
          )}
          <Button
            variant="outline"
            className="self-start"
            disabled={rows.length >= 50}
            onClick={() =>
              setRows([...rows, { key: newRowKey(), name: '', hi: '', bn: '', price: '' }])
            }
          >
            <Plus aria-hidden="true" />
            {t('menu.addons.addAddon')}
          </Button>
        </fieldset>
      </div>
    </Dialog>
  );
}
