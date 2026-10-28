import type { Printer } from '@restroos/contracts';
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
  Printer as PrinterIcon,
  SegmentedControl,
  Select,
  Switch,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type SavePrinterBody } from '../../../api/endpoints';
import { useErrorMessage } from '../../../lib/errors';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

type Connection = NonNullable<SavePrinterBody['connection']>;
type Purpose = NonNullable<SavePrinterBody['purpose']>;
const CONNECTIONS: readonly Connection[] = ['NETWORK', 'USB', 'BLUETOOTH', 'BLE', 'SYSTEM'];
const PURPOSES: readonly Purpose[] = ['BILL', 'KOT', 'REPORT', 'LABEL'];

export function PrintersPage() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const printers = useQuery({ queryKey: ['printers'], queryFn: api.printers.list });
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const test = useMutation({
    mutationFn: (p: Printer) => api.printers.test(p.id).then(() => p),
    onSuccess: (p) => toast(t('printers.testQueued', { name: p.name })),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('printers.title')}
        description={t('printers.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('printers.add')}
          </Button>
        }
      />
      <QueryState query={printers}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('printers.empty')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.map((p) => (
                <li key={p.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <PrinterIcon
                        aria-hidden="true"
                        className="mt-1 size-6 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-semibold break-words">{p.name}</h2>
                        <p className="text-sm break-all text-muted-foreground">
                          {t(`printers.connections.${p.connection}`)}
                          {p.address !== null && ` · ${p.address}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="info">{t(`printers.purposes.${p.purpose}`)}</Badge>
                      <Badge variant="outline">{t('printers.width', { mm: p.paperWidthMm })}</Badge>
                      {!p.isActive && <Badge>{t('common.inactive')}</Badge>}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setEditing(p)}>
                        <Pencil aria-hidden="true" />
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => test.mutate(p)}
                        disabled={!p.isActive || test.isPending}
                      >
                        {t('printers.test')}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      {editing !== null && (
        <PrinterDialog
          printer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PrinterDialog({ printer, onClose }: { printer: Printer | null; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(printer?.name ?? '');
  const [connection, setConnection] = useState<Connection>(printer?.connection ?? 'NETWORK');
  const [address, setAddress] = useState(printer?.address ?? '');
  const [width, setWidth] = useState<58 | 80>(printer?.paperWidthMm ?? 80);
  const [purpose, setPurpose] = useState<Purpose>(printer?.purpose ?? 'BILL');
  const [active, setActive] = useState(printer?.isActive ?? true);
  const [nameError, setNameError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2 || name.trim().length > 60) {
        setNameError(t('validation.nameLength'));
        return null;
      }
      setNameError(undefined);
      const body = {
        name: name.trim(),
        connection,
        address: address.trim() === '' ? null : address.trim(),
        paperWidthMm: width,
        purpose,
      };
      return printer === null
        ? api.printers.create(body)
        : api.printers.update(printer.id, { ...body, isActive: active, version: printer.version });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['printers'] });
      toast(t('printers.saved', { name: saved.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={printer === null ? t('printers.add') : t('taxes.editTitle', { name: printer.name })}
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
        <Field label={t('printers.name')} hint={t('printers.nameHint')} required error={nameError}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={t('printers.purpose')}>
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
              {PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {t(`printers.purposes.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('printers.connection')}>
          {(p) => (
            <Select
              {...p}
              value={connection}
              onChange={(e) => setConnection(e.target.value as Connection)}
            >
              {CONNECTIONS.map((x) => (
                <option key={x} value={x}>
                  {t(`printers.connections.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('printers.address')} hint={t('printers.addressHint')}>
          {(p) => (
            <Input
              {...p}
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('printers.paper')}</span>
          <SegmentedControl<'58' | '80'>
            aria-label={t('printers.paper')}
            value={String(width) as '58' | '80'}
            onValueChange={(v) => setWidth(v === '58' ? 58 : 80)}
            options={[
              { value: '58', label: t('printers.width', { mm: 58 }) },
              { value: '80', label: t('printers.width', { mm: 80 }) },
            ]}
          />
        </div>
        {printer !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
      </div>
    </Dialog>
  );
}
