import type { ChargeRule } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  SegmentedControl,
  Select,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type OrderType } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { bpToPercent, paiseToRupees, percentToBp, rupeesToPaise } from '../../../lib/units';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

const ORDER_TYPES: readonly OrderType[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY', 'QR_SELF', 'KIOSK'];

export function ChargesPage() {
  const { t } = useTranslation();
  const format = useFormat();
  const rules = useQuery({ queryKey: ['charge-rules'], queryFn: api.chargeRules.list });
  const [editing, setEditing] = useState<ChargeRule | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('charges.title')}
        description={t('charges.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('charges.add')}
          </Button>
        }
      />
      <QueryState query={rules}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('charges.empty')}</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('charges.name')}</Th>
                  <Th>{t('charges.value')}</Th>
                  <Th>{t('charges.orderTypes')}</Th>
                  <Th>{t('users.status')}</Th>
                  <Th>
                    <span className="sr-only">{t('users.actions')}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {data.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="tabular-nums whitespace-nowrap">
                      {r.kind === 'PERCENT'
                        ? t('charges.percentValue', { rate: bpToPercent(r.value) })
                        : format.money(Money.ofPaise(r.value))}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.orderTypes.map((o) => (
                          <Badge key={o} variant="outline">
                            {t(`orderTypes.${o}`)}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={r.isActive ? 'success' : 'neutral'}>
                          {r.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                        {r.isOptional && (
                          <Badge variant="outline">{t('charges.optionalBadge')}</Badge>
                        )}
                      </div>
                    </Td>
                    <Td className="text-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-touch"
                        onClick={() => setEditing(r)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        }
      </QueryState>
      {editing !== null && (
        <ChargeDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ChargeDialog({ rule, onClose }: { rule: ChargeRule | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const taxGroups = useQuery({ queryKey: ['tax-groups'], queryFn: api.taxGroups.list });
  const [name, setName] = useState(rule?.name ?? '');
  const [kind, setKind] = useState<'PERCENT' | 'FIXED'>(rule?.kind ?? 'PERCENT');
  const [value, setValue] = useState(
    rule === null
      ? ''
      : rule.kind === 'PERCENT'
        ? bpToPercent(rule.value)
        : paiseToRupees(rule.value),
  );
  const [orderTypes, setOrderTypes] = useState<OrderType[]>(rule?.orderTypes ?? ['DINE_IN']);
  const [taxGroupId, setTaxGroupId] = useState(rule?.taxGroupId ?? '');
  const [optional, setOptional] = useState(rule?.isOptional ?? true);
  const [active, setActive] = useState(rule?.isActive ?? true);
  const [errors, setErrors] = useState<{ name?: string; value?: string; orderTypes?: string }>({});

  const save = useMutation({
    mutationFn: async () => {
      const amount = kind === 'PERCENT' ? percentToBp(value) : rupeesToPaise(value);
      const found: typeof errors = {};
      if (name.trim().length < 2 || name.trim().length > 60)
        found.name = t('validation.nameLength');
      if (amount === null || (kind === 'PERCENT' && amount > 100_00))
        found.value = kind === 'PERCENT' ? t('validation.percent') : t('validation.amount');
      if (orderTypes.length === 0) found.orderTypes = t('validation.chooseOne');
      setErrors(found);
      if (Object.keys(found).length > 0 || amount === null) return null;
      const body = {
        name: name.trim(),
        kind,
        value: amount,
        orderTypes,
        taxGroupId: taxGroupId === '' ? null : taxGroupId,
        isOptional: optional,
      };
      return rule === null
        ? api.chargeRules.create(body)
        : api.chargeRules.update(rule.id, { ...body, isActive: active, version: rule.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['charge-rules'] });
      toast(t('charges.saved', { name: saved.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={rule === null ? t('charges.add') : t('taxes.editTitle', { name: rule.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <Field label={t('charges.name')} hint={t('charges.nameHint')} required error={errors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('charges.kind')}</span>
          <SegmentedControl<'PERCENT' | 'FIXED'>
            aria-label={t('charges.kind')}
            value={kind}
            onValueChange={(k) => {
              setKind(k);
              setValue('');
            }}
            options={[
              { value: 'PERCENT', label: t('charges.percent') },
              { value: 'FIXED', label: t('charges.fixed') },
            ]}
          />
        </div>
        <Field
          label={kind === 'PERCENT' ? t('taxes.ratePercent') : t('charges.amount')}
          required
          error={errors.value}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              className="max-w-48"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <fieldset className="flex flex-col">
          <legend className="text-sm font-medium">{t('charges.orderTypes')}</legend>
          <div className="grid sm:grid-cols-2">
            {ORDER_TYPES.map((o) => (
              <Checkbox
                key={o}
                label={t(`orderTypes.${o}`)}
                checked={orderTypes.includes(o)}
                onChange={(e) =>
                  setOrderTypes(
                    e.target.checked ? [...orderTypes, o] : orderTypes.filter((x) => x !== o),
                  )
                }
              />
            ))}
          </div>
          {errors.orderTypes !== undefined && (
            <p className="text-sm font-medium text-state-danger-fg">{errors.orderTypes}</p>
          )}
        </fieldset>
        <Field label={t('charges.taxGroup')} hint={t('charges.taxGroupHint')}>
          {(p) => (
            <Select {...p} value={taxGroupId} onChange={(e) => setTaxGroupId(e.target.value)}>
              <option value="">{t('taxes.noTax')}</option>
              {taxGroups.data?.data
                .filter((g) => g.isActive || g.id === taxGroupId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Switch
          label={t('charges.optional')}
          description={t('charges.optionalHint')}
          checked={optional}
          onCheckedChange={setOptional}
        />
        {rule !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
      </div>
    </Dialog>
  );
}
