import type { Device, DeviceKind, PairingCodeResponse } from '@restroos/contracts';
import { Alert, Button, CircleCheck, Dialog, Field, Input, RefreshCw, Select } from '@restroos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { QrImage } from '../../components/qr-image';
import { useFormat } from '../../i18n/use-format';
import { useErrorMessage } from '../../lib/errors';
import { PAIRABLE_KINDS } from './device-kinds';
import { useNow } from './use-now';

/** "AB12CD34" → "AB12 CD34", easier to read out across the counter. */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Admin → Devices → Pair a device: choose a name and kind, then show a big
 * QR (the pair URL), the code in large text, a countdown and the CA
 * fingerprint. Watches the device list so it can say when pairing worked.
 */
export function PairDeviceDialog({
  initial,
  onClose,
}: {
  initial?: { name: string; kind: DeviceKind };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<DeviceKind>(initial?.kind ?? 'CAPTAIN');
  const [nameError, setNameError] = useState(false);
  const [issued, setIssued] = useState<{ code: PairingCodeResponse; seen: Set<string> } | null>(
    null,
  );

  // Devices as they were before the code: a new id or a new pairedAt means it worked.
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: api.devices.list,
    refetchInterval: issued === null ? false : 4_000,
  });
  const stamp = (d: Device) => `${d.id}@${d.pairedAt ?? ''}`;
  const paired =
    issued === null
      ? undefined
      : devices.data?.data.find((d) => d.isActive && !issued.seen.has(stamp(d)));

  const create = useMutation({
    mutationFn: async () => {
      if (name.trim().length < 2 || name.trim().length > 60) {
        setNameError(true);
        return null;
      }
      setNameError(false);
      const before = await api.devices.list().catch(() => devices.data ?? { data: [] });
      const code = await api.devices.createPairingCode({ name: name.trim(), kind });
      return { code, seen: new Set(before.data.map(stamp)) };
    },
    onSuccess: (result) => {
      if (result !== null) setIssued(result);
    },
  });

  return (
    <Dialog
      open
      size={issued === null ? 'md' : 'lg'}
      onClose={onClose}
      dismissible={!create.isPending}
      closeLabel={t('common.close')}
      title={t('devices.pair.title')}
      description={issued === null ? t('devices.pair.description') : undefined}
      footer={
        issued === null ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={create.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? t('devices.pair.creating') : t('devices.pair.create')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('common.close')}</Button>
        )
      }
    >
      {issued === null ? (
        <div className="flex flex-col gap-4">
          {create.isError && (
            <Alert tone="danger" role="alert">
              {errorMessage(create.error)}
            </Alert>
          )}
          <Field
            label={t('devices.name')}
            hint={t('devices.nameHint')}
            required
            error={nameError ? t('devices.nameError') : undefined}
          >
            {(p) => (
              <Input {...p} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label={t('devices.kind')} hint={t(`devices.kindHints.${kind}`)}>
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
      ) : paired !== undefined ? (
        <Alert tone="success" role="status" title={t('devices.pair.done', { name: paired.name })}>
          {t('devices.pair.doneBody', { kind: t(`devices.kinds.${paired.kind}`) })}
        </Alert>
      ) : (
        <PairingCode
          code={issued.code}
          name={name.trim()}
          kind={kind}
          onRenew={() => create.mutate()}
          renewing={create.isPending}
        />
      )}
    </Dialog>
  );
}

function PairingCode({
  code,
  name,
  kind,
  onRenew,
  renewing,
}: {
  code: PairingCodeResponse;
  name: string;
  kind: DeviceKind;
  onRenew: () => void;
  renewing: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const now = useNow();
  const left = Math.max(0, Math.floor((Date.parse(code.expiresAt) - now) / 1000));
  const expired = left === 0;
  const clock = `${format.number(Math.floor(left / 60))}:${format.number(left % 60, {
    minimumIntegerDigits: 2,
  })}`;

  return (
    <div className="grid items-start gap-5 md:grid-cols-[auto_1fr]">
      <div className="relative mx-auto">
        <QrImage
          value={code.pairUrl}
          label={t('devices.pair.qrLabel', { name })}
          className={`w-64 max-w-full rounded-lg border p-2 ${expired ? 'opacity-20' : ''}`}
        />
        {expired && (
          <span className="absolute inset-0 grid place-items-center text-lg font-bold">
            {t('devices.pair.expired')}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-muted-foreground">
          {t('devices.pair.forDevice', { name, kind: t(`devices.kinds.${kind}`) })}
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-muted-foreground">
            {t('devices.pair.code')}
          </span>
          <span
            data-testid="pairing-code"
            aria-label={code.code.split('').join(' ')}
            className="font-mono text-4xl font-bold tracking-widest break-all tabular-nums"
          >
            {groupCode(code.code)}
          </span>
        </div>
        <p
          role="timer"
          aria-live="off"
          className={`text-lg font-semibold tabular-nums ${expired ? 'text-state-danger-fg' : ''}`}
        >
          {expired ? t('devices.pair.expiredBody') : t('devices.pair.expiresIn', { time: clock })}
        </p>
        {expired && (
          <Button className="self-start" onClick={onRenew} disabled={renewing}>
            <RefreshCw aria-hidden="true" />
            {t('devices.pair.renew')}
          </Button>
        )}
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          <li>{t('devices.pair.step1')}</li>
          <li>{t('devices.pair.step2', { url: code.pairUrl.replace(/\?.*$/, '') })}</li>
          <li>{t('devices.pair.step3')}</li>
        </ol>
        <div className="flex flex-col gap-1 rounded-lg border p-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <CircleCheck aria-hidden="true" className="size-4" />
            {t('devices.pair.fingerprint')}
          </span>
          <code className="font-mono text-xs break-all">{code.caFingerprint}</code>
        </div>
      </div>
    </div>
  );
}
