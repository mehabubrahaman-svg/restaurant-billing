import type { SalesChannel } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Bike,
  Button,
  Dialog,
  Field,
  Input,
  Pencil,
  Plus,
  Select,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@restroos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SaveSalesChannelBody } from '../../../api/endpoints';
import { bpToPercent, percentToBp, toLatinDigits } from '../../../lib/units';
import { useErrorMessage } from '../../../lib/errors';
import { SALES_CHANNELS_KEY, useSalesChannels } from '../../orders/sales-channels';
import { toast } from '../../toast/toast-store';
import { useRate } from '../../../portals/pos/bill-breakdown';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

type Kind = NonNullable<SaveSalesChannelBody['kind']>;
const KINDS: readonly Kind[] = ['AGGREGATOR', 'OWN_ONLINE'];
const CODE = /^[A-Z0-9_]{2,20}$/;
/** The Hub's check on an operator's GSTIN (15 characters, state code first). */
const OPERATOR_GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/;

/** /admin/sales-channels: Swiggy, Zomato and other channels, with their commission and pricing. */
export function SalesChannelsPage() {
  const { t } = useTranslation();
  const rate = useRate();
  const channels = useSalesChannels();
  const [editing, setEditing] = useState<SalesChannel | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('channels.title')}
        description={t('channels.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('channels.add')}
          </Button>
        }
      />
      <QueryState query={channels}>
        {({ data }) => (
          <Table>
            <THead>
              <Tr>
                <Th>{t('channels.name')}</Th>
                <Th>{t('channels.kind')}</Th>
                <Th className="text-end">{t('channels.commission')}</Th>
                <Th className="text-end">{t('channels.markup')}</Th>
                <Th>{t('channels.gst')}</Th>
                <Th>
                  <span className="sr-only">{t('channels.actions')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {data.map((c) => (
                <Tr key={c.id} className={c.isActive ? undefined : 'text-muted-foreground'}>
                  <Td>
                    <span className="flex items-center gap-2 font-medium break-words">
                      {c.kind !== 'DIRECT' && (
                        <Bike
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      )}
                      {c.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                    {!c.isActive && (
                      <Badge className="ms-2" variant="neutral">
                        {t('common.inactive')}
                      </Badge>
                    )}
                  </Td>
                  <Td>{t(`channels.kinds.${c.kind}`)}</Td>
                  <Td className="text-end tabular-nums">
                    {t('reports.dayEnd.ratePercent', { rate: rate(c.commissionBp) })}
                  </Td>
                  <Td className="text-end tabular-nums">
                    {t('reports.dayEnd.ratePercent', { rate: rate(c.priceMarkupBp) })}
                  </Td>
                  <Td>
                    {c.gstPaidByOperator ? (
                      <Badge variant="info" className="whitespace-nowrap">
                        {t('channels.gstOperator')}
                      </Badge>
                    ) : (
                      <span className="text-sm">{t('channels.gstRestaurant')}</span>
                    )}
                  </Td>
                  <Td className="text-end">
                    {c.kind !== 'DIRECT' && (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('channels.editNamed', { name: c.name })}
                        onClick={() => setEditing(c)}
                      >
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {editing !== null && (
        <ChannelDialog
          channel={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface Errors {
  code?: string;
  name?: string;
  commission?: string;
  markup?: string;
  gstin?: string;
}

function ChannelDialog({
  channel,
  onClose,
}: {
  channel: SalesChannel | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState(channel?.code ?? '');
  const [name, setName] = useState(channel?.name ?? '');
  const [kind, setKind] = useState<Kind>(
    channel?.kind === 'OWN_ONLINE' ? 'OWN_ONLINE' : 'AGGREGATOR',
  );
  const [commission, setCommission] = useState(
    channel === null ? '' : bpToPercent(channel.commissionBp),
  );
  const [markup, setMarkup] = useState(channel === null ? '' : bpToPercent(channel.priceMarkupBp));
  const [operatorGst, setOperatorGst] = useState(channel?.gstPaidByOperator ?? true);
  const [gstin, setGstin] = useState(channel?.operatorGstin ?? '');
  const [active, setActive] = useState(channel?.isActive ?? true);
  const [errors, setErrors] = useState<Errors>({});

  const percent = (value: string) => {
    const clean = toLatinDigits(value).trim();
    if (clean === '') return 0;
    const bp = percentToBp(clean);
    return bp !== null && bp >= 0 && bp <= 10_000 ? bp : null;
  };

  const save = useMutation({
    mutationFn: (body: SaveSalesChannelBody) =>
      channel === null
        ? api.salesChannels.create(body)
        : api.salesChannels.update(channel.id, {
            ...body,
            isActive: active,
            version: channel.version,
          }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: SALES_CHANNELS_KEY });
      toast(t('channels.saved', { name: saved.name }));
      onClose();
    },
  });

  function submit() {
    const cleanCode = code.trim().toUpperCase();
    const commissionBp = percent(commission);
    const markupBp = percent(markup);
    const found: Errors = {};
    if (!CODE.test(cleanCode)) found.code = t('channels.codeInvalid');
    if (name.trim().length < 2 || name.trim().length > 60) found.name = t('channels.nameInvalid');
    if (commissionBp === null) found.commission = t('channels.percentInvalid');
    if (markupBp === null) found.markup = t('channels.percentInvalid');
    const cleanGstin = gstin.trim().toUpperCase();
    if (operatorGst && cleanGstin !== '' && !OPERATOR_GSTIN.test(cleanGstin)) {
      found.gstin = t('channels.gstinInvalid');
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || commissionBp === null || markupBp === null) return;
    save.mutate({
      code: cleanCode,
      name: name.trim(),
      kind,
      commissionBp,
      priceMarkupBp: markupBp,
      gstPaidByOperator: operatorGst,
      operatorGstin: operatorGst && cleanGstin !== '' ? cleanGstin : null,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={channel === null ? t('channels.add') : t('channels.editNamed', { name: channel.name })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="channel-form" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="channel-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {save.isError && (
          <Alert tone="danger" role="alert">
            {errorMessage(save.error)}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('channels.name')}
            hint={t('channels.nameHint')}
            required
            error={errors.name}
          >
            {(p) => (
              <Input {...p} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field
            label={t('channels.code')}
            hint={t('channels.codeHint')}
            required
            error={errors.code}
          >
            {(p) => (
              <Input
                {...p}
                className="font-mono uppercase"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('channels.kind')}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`channels.kinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('channels.commissionLabel')}
            hint={t('channels.commissionHint')}
            error={errors.commission}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('channels.markupLabel')}
            hint={t('channels.markupHint')}
            error={errors.markup}
          >
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                autoComplete="off"
                value={markup}
                onChange={(e) => setMarkup(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Switch
          label={t('channels.gstOperatorLabel')}
          description={t('channels.gstOperatorHint')}
          checked={operatorGst}
          onCheckedChange={setOperatorGst}
        />
        {operatorGst && (
          <Field
            label={t('channels.gstinLabel')}
            hint={t('channels.gstinHint')}
            error={errors.gstin}
          >
            {(p) => (
              <Input
                {...p}
                autoComplete="off"
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
              />
            )}
          </Field>
        )}
        {channel !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
