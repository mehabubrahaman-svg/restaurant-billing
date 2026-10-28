import type { Device, Peripheral } from '@restroos/contracts';
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
  ScanBarcode,
  Select,
  Switch,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';

type Kind = Peripheral['kind'];
type Connection = Peripheral['connection'];
const KINDS: readonly Kind[] = [
  'BARCODE_SCANNER',
  'WEIGHING_SCALE',
  'CUSTOMER_DISPLAY',
  'CASH_DRAWER',
  'GUEST_PAGER',
  'CARD_TERMINAL',
];
const CONNECTIONS: readonly Connection[] = ['USB', 'SERIAL', 'NETWORK', 'BLUETOOTH', 'BLE', 'HID'];

/** Scanners, scales, cash drawers… on the Hub or on a paired device. Same pattern as printers. */
export function PeripheralsTab() {
  const { t } = useTranslation();
  const peripherals = useQuery({ queryKey: ['peripherals'], queryFn: api.peripherals.list });
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices.list });
  const [editing, setEditing] = useState<Peripheral | 'new' | null>(null);
  const deviceList = devices.data?.data ?? [];
  const deviceName = (id: string | null) =>
    id === null
      ? t('devices.peripherals.onHub')
      : (deviceList.find((d) => d.id === id)?.name ?? '—');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">{t('devices.peripherals.description')}</p>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('devices.peripherals.add')}
        </Button>
      </div>
      <QueryState query={peripherals}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('devices.peripherals.empty')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.map((p) => (
                <li key={p.id}>
                  <Card className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <ScanBarcode
                        aria-hidden="true"
                        className="mt-1 size-6 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg font-semibold break-words">{p.name}</h2>
                        <p className="text-sm break-all text-muted-foreground">
                          {t(`devices.peripherals.connections.${p.connection}`)}
                          {p.address !== null && ` · ${p.address}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="info">{t(`devices.peripherals.kinds.${p.kind}`)}</Badge>
                      <Badge variant="outline">{deviceName(p.deviceId)}</Badge>
                      {!p.isActive && <Badge>{t('common.inactive')}</Badge>}
                    </div>
                    <Button
                      variant="outline"
                      className="mt-auto self-start"
                      aria-label={t('devices.peripherals.editNamed', { name: p.name })}
                      onClick={() => setEditing(p)}
                    >
                      <Pencil aria-hidden="true" />
                      {t('common.edit')}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      {editing !== null && (
        <PeripheralDialog
          peripheral={editing === 'new' ? null : editing}
          devices={deviceList}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function PeripheralDialog({
  peripheral,
  devices,
  onClose,
}: {
  peripheral: Peripheral | null;
  devices: readonly Device[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(peripheral?.name ?? '');
  const [kind, setKind] = useState<Kind>(peripheral?.kind ?? 'BARCODE_SCANNER');
  const [connection, setConnection] = useState<Connection>(peripheral?.connection ?? 'USB');
  const [address, setAddress] = useState(peripheral?.address ?? '');
  const [deviceId, setDeviceId] = useState(peripheral?.deviceId ?? '');
  const [active, setActive] = useState(peripheral?.isActive ?? true);
  const [nameError, setNameError] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 1 || name.trim().length > 120) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      const body = {
        name: name.trim(),
        kind,
        connection,
        address: address.trim() === '' ? null : address.trim(),
        deviceId: deviceId === '' ? null : deviceId,
      };
      return peripheral === null
        ? api.peripherals.create(body)
        : api.peripherals.update(peripheral.id, {
            ...body,
            isActive: active,
            version: peripheral.version,
          });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['peripherals'] });
      toast(t('devices.peripherals.saved', { name: saved.name }));
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!save.isPending}
      closeLabel={t('common.close')}
      title={
        peripheral === null
          ? t('devices.peripherals.add')
          : t('devices.peripherals.editNamed', { name: peripheral.name })
      }
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
            {isApiError(save.error, 'VERSION_CONFLICT') && ` ${t('common.reload')}`}
          </Alert>
        )}
        <Field
          label={t('devices.peripherals.name')}
          hint={t('devices.peripherals.nameHint')}
          required
          error={nameError ? t('menu.item.errors.name') : undefined}
        >
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('devices.peripherals.kind')}>
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`devices.peripherals.kinds.${k}`)}
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
                {CONNECTIONS.map((c) => (
                  <option key={c} value={c}>
                    {t(`devices.peripherals.connections.${c}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('devices.peripherals.attachedTo')}>
          {(p) => (
            <Select {...p} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">{t('devices.peripherals.onHub')}</option>
              {devices
                .filter((d) => d.isActive || d.id === deviceId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('printers.address')} hint={t('devices.peripherals.addressHint')}>
          {(p) => (
            <Input
              {...p}
              spellCheck={false}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        {peripheral !== null && (
          <Switch label={t('common.active')} checked={active} onCheckedChange={setActive} />
        )}
      </div>
    </Dialog>
  );
}
