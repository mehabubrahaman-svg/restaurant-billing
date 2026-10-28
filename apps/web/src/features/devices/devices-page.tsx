import type { Device, DeviceKind } from '@restroos/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Link as LinkIcon,
  Pencil,
  Plus,
  SegmentedControl,
  Select,
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
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { useDeviceStore } from '../../stores/device-store';
import { AdminHeader } from '../admin/admin-layout';
import { QueryState } from '../admin/query-state';
import { toast } from '../toast/toast-store';
import { PAIRABLE_KINDS } from './device-kinds';
import { PairDeviceDialog } from './pair-device-dialog';
import { PeripheralsTab } from './peripherals-tab';

type Tab = 'devices' | 'peripherals';
type Filter = 'active' | 'unpaired' | 'all';

/** Admin → Devices: paired tablets, screens and tills; pairing codes; peripherals. */
export function DevicesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('devices');
  const [pairing, setPairing] = useState<{ name: string; kind: DeviceKind } | 'new' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <AdminHeader
        title={t('devices.title')}
        description={t('devices.description')}
        actions={
          tab === 'devices' ? (
            <Button onClick={() => setPairing('new')}>
              <Plus aria-hidden="true" />
              {t('devices.pair.title')}
            </Button>
          ) : undefined
        }
      />
      <SegmentedControl<Tab>
        className="self-start"
        aria-label={t('devices.sections')}
        value={tab}
        onValueChange={setTab}
        options={[
          { value: 'devices', label: t('devices.tabs.devices') },
          { value: 'peripherals', label: t('devices.tabs.peripherals') },
        ]}
      />
      {tab === 'devices' ? (
        <DevicesTab onRepair={(d) => setPairing({ name: d.name, kind: d.kind })} />
      ) : (
        <PeripheralsTab />
      )}
      {pairing !== null && (
        <PairDeviceDialog
          {...(pairing === 'new' ? {} : { initial: pairing })}
          onClose={() => setPairing(null)}
        />
      )}
    </div>
  );
}

function DevicesTab({ onRepair }: { onRepair: (d: Device) => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices.list });
  const thisDevice = useDeviceStore((s) => (s.status === 'paired' ? s.name : null));
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<Device | null>(null);
  const [unpairing, setUnpairing] = useState<Device | null>(null);
  const when = (iso: string | null) =>
    iso === null
      ? t('devices.never')
      : format.dateTime(iso, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <SegmentedControl<Filter>
        className="self-start"
        aria-label={t('users.filter')}
        value={filter}
        onValueChange={setFilter}
        options={[
          { value: 'active', label: t('devices.paired') },
          { value: 'unpaired', label: t('devices.unpaired') },
          { value: 'all', label: t('users.all') },
        ]}
      />
      <QueryState query={devices}>
        {({ data }) => {
          const shown = data.filter(
            (d) => filter === 'all' || (filter === 'active') === d.isActive,
          );
          if (shown.length === 0)
            return <p className="text-muted-foreground">{t('devices.empty')}</p>;
          return (
            <Table>
              <THead>
                <Tr>
                  <Th>{t('devices.name')}</Th>
                  <Th>{t('devices.kind')}</Th>
                  <Th>{t('devices.platform')}</Th>
                  <Th>{t('devices.lastSeen')}</Th>
                  <Th>{t('devices.pairedAt')}</Th>
                  <Th>{t('users.status')}</Th>
                  <Th>
                    <span className="sr-only">{t('users.actions')}</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {shown.map((d) => (
                  <Tr key={d.id}>
                    <Td>
                      <p className="font-medium break-words">{d.name}</p>
                      {thisDevice === d.name && d.isActive && (
                        <Badge variant="info">{t('devices.thisDevice')}</Badge>
                      )}
                    </Td>
                    <Td>{t(`devices.kinds.${d.kind}`)}</Td>
                    <Td>{d.platform === null ? '—' : t(`devices.platforms.${d.platform}`)}</Td>
                    <Td className="whitespace-nowrap">{when(d.lastSeenAt)}</Td>
                    <Td className="whitespace-nowrap">{when(d.pairedAt)}</Td>
                    <Td>
                      <Badge variant={d.isActive ? 'success' : 'neutral'}>
                        {d.isActive ? t('devices.paired') : t('devices.unpaired')}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-2">
                        {d.isActive ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-touch"
                              aria-label={t('devices.editNamed', { name: d.name })}
                              onClick={() => setEditing(d)}
                            >
                              <Pencil aria-hidden="true" />
                              {t('common.edit')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-touch"
                              aria-label={t('devices.unpairNamed', { name: d.name })}
                              onClick={() => setUnpairing(d)}
                            >
                              {t('devices.unpair')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-touch"
                            aria-label={t('devices.repairNamed', { name: d.name })}
                            onClick={() => onRepair(d)}
                          >
                            <LinkIcon aria-hidden="true" />
                            {t('devices.repair')}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          );
        }}
      </QueryState>
      {editing !== null && <DeviceDialog device={editing} onClose={() => setEditing(null)} />}
      {unpairing !== null && <UnpairDialog device={unpairing} onClose={() => setUnpairing(null)} />}
    </>
  );
}

function UnpairDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const unpair = useMutation({
    mutationFn: () => api.devices.update(device.id, { version: device.version, isActive: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast(t('devices.unpairDone', { name: device.name }));
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={t('devices.unpairTitle', { name: device.name })}
      body={t('devices.unpairBody')}
      confirmLabel={t('devices.unpair')}
      destructive
      busy={unpair.isPending}
      error={unpair.isError ? errorMessage(unpair.error) : null}
      onConfirm={() => unpair.mutate()}
      onClose={onClose}
    />
  );
}

function DeviceDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(device.name);
  const [kind, setKind] = useState<DeviceKind>(device.kind);
  const [nameError, setNameError] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2 || name.trim().length > 60) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      return api.devices.update(device.id, { version: device.version, name: name.trim(), kind });
    },
    onSuccess: (saved) => {
      if (saved === null) return;
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast(t('devices.saved', { name: saved.name }));
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
      title={t('devices.editNamed', { name: device.name })}
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
          label={t('devices.name')}
          required
          error={nameError ? t('devices.nameError') : undefined}
        >
          {(p) => (
            <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label={t('devices.kind')} hint={t('devices.kindChangeHint')}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
              {PAIRABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`devices.kinds.${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
