import {
  Alert,
  Button,
  Card,
  CircleCheck,
  Download,
  Field,
  Input,
  MonitorSmartphone,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { api, HUB_CA_CERT_URL } from '../../api/endpoints';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useErrorMessage } from '../../lib/errors';
import {
  clearDeviceOverride,
  FULL_SCREEN_PORTAL_PATH,
  useDeviceStore,
  type DeviceKind,
} from '../../stores/device-store';
import { ConnectionPill } from '../connection/connection-pill';
import { DEVICE_ME_KEY } from './this-device';
import { detectPlatform, deviceFingerprint, needsCertificate } from './device-identity';
import { groupCode } from './pair-device-dialog';

/** Codes are shown grouped ("AB12 CD34"); accept them typed any way. */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Where a newly paired device goes next: its full-screen portal, or sign-in. */
export function afterPairingPath(device: { readonly kind: DeviceKind }): string {
  return FULL_SCREEN_PORTAL_PATH[device.kind] ?? '/login';
}

/**
 * /pair (public; the admin's QR opens /pair?code=…): explain the steps, offer
 * the Hub's CA certificate on plain HTTP, take the code, pair, and adopt the
 * kind the Hub gives this device.
 */
export function PairPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [params] = useSearchParams();
  const current = useDeviceStore((s) => (s.status === 'paired' ? s : null));
  const [code, setCode] = useState(() => groupCode(normaliseCode(params.get('code') ?? '')));
  const [codeError, setCodeError] = useState(false);
  const insecure = needsCertificate(window.location);
  const hub = useQuery({
    queryKey: ['hub', 'info'],
    queryFn: api.hub.info,
    enabled: insecure,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const pair = useMutation({
    mutationFn: () =>
      api.devices.pair({
        code: normaliseCode(code),
        fingerprint: deviceFingerprint(),
        platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
      }),
    onSuccess: ({ device }) => {
      // The Hub is now the source of truth for this device's kind and name.
      // (The returned deviceToken is for native shells; the browser uses the httpOnly cookie.)
      clearDeviceOverride();
      useDeviceStore.getState().adopt(device);
      queryClient.setQueryData(DEVICE_ME_KEY, device);
      void queryClient.invalidateQueries({ queryKey: ['auth', 'pin-users'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normaliseCode(code);
    if (clean.length < 6 || clean.length > 16) {
      setCodeError(true);
      return;
    }
    setCodeError(false);
    pair.mutate();
  }

  const paired = pair.data?.device;
  const httpsUrl =
    hub.data?.urls.https.find((u) => !u.includes('.local')) ?? hub.data?.urls.https[0];

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <title>{`${t('pairing.title')} · ${t('app.name')}`}</title>
      <Card className="flex w-full max-w-xl flex-col gap-5 p-5 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <MonitorSmartphone aria-hidden="true" className="size-6" />
            </span>
            <div>
              <h1 className="text-2xl font-bold">{t('pairing.title')}</h1>
              <p className="text-muted-foreground">{t('app.name')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectionPill />
            <LanguageSwitcher />
          </div>
        </header>

        {paired !== undefined ? (
          <section className="flex flex-col items-start gap-4" aria-live="polite">
            <Alert tone="success" title={t('pairing.successTitle')} className="w-full">
              {t('pairing.successBody', {
                name: paired.name,
                kind: t(`devices.kinds.${paired.kind}`),
              })}
            </Alert>
            <p className="text-muted-foreground">
              {afterPairingPath(paired) === '/login'
                ? t('pairing.nextSignIn')
                : t('pairing.nextFullScreen', { kind: t(`devices.kinds.${paired.kind}`) })}
            </p>
            <Button
              size="lg"
              data-autofocus
              onClick={() => void navigate(afterPairingPath(paired), { replace: true })}
            >
              {t('pairing.continue')}
            </Button>
          </section>
        ) : (
          <>
            {current !== null && (
              <Alert tone="info" title={t('pairing.alreadyTitle')}>
                <p>
                  {t('pairing.alreadyBody', {
                    name: current.name ?? '',
                    kind: t(`devices.kinds.${current.kind === 'SERVER' ? 'POS' : current.kind}`),
                  })}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => void navigate(afterPairingPath(current), { replace: true })}
                >
                  {t('pairing.continue')}
                </Button>
              </Alert>
            )}
            <ol className="flex list-decimal flex-col gap-2 ps-5">
              <li>{t('pairing.step1')}</li>
              {insecure && <li>{t('pairing.step2')}</li>}
              <li>{t('pairing.step3')}</li>
            </ol>

            {insecure && (
              <section
                aria-labelledby="pair-cert"
                className="flex flex-col gap-3 rounded-xl border p-4"
              >
                <h2 id="pair-cert" className="text-lg font-semibold">
                  {t('pairing.certTitle')}
                </h2>
                <p className="text-sm text-muted-foreground">{t('pairing.certWhy')}</p>
                <Button variant="secondary" className="self-start" asChild>
                  <a href={HUB_CA_CERT_URL} download="restroos-hub-ca.crt">
                    <Download aria-hidden="true" />
                    {t('pairing.certDownload')}
                  </a>
                </Button>
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold">{t('pairing.androidTitle')}</h3>
                  <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
                    <li>{t('pairing.android1')}</li>
                    <li>{t('pairing.android2')}</li>
                    <li>{t('pairing.android3')}</li>
                    <li>{t('pairing.android4')}</li>
                  </ol>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <CircleCheck aria-hidden="true" className="size-4" />
                    {t('pairing.compareFingerprint')}
                  </span>
                  <code className="font-mono text-xs break-all" data-testid="ca-fingerprint">
                    {hub.data?.caFingerprint ?? '…'}
                  </code>
                </div>
                {httpsUrl !== undefined && (
                  <p className="text-sm">
                    {t('pairing.thenOpen')}{' '}
                    <a
                      className="font-medium break-all underline"
                      href={`${httpsUrl}/pair${code.trim() === '' ? '' : `?code=${normaliseCode(code)}`}`}
                    >
                      {httpsUrl}
                    </a>
                  </p>
                )}
              </section>
            )}

            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              {pair.isError && (
                <Alert tone="danger" role="alert">
                  {errorMessage(pair.error)}
                </Alert>
              )}
              <Field
                label={t('pairing.code')}
                hint={t('pairing.codeHint')}
                error={codeError ? t('pairing.codeError') : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    className="min-h-14 font-mono text-2xl tracking-widest uppercase"
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={20}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    data-autofocus
                  />
                )}
              </Field>
              <Button type="submit" size="lg" disabled={pair.isPending || code.trim() === ''}>
                {pair.isPending ? t('pairing.pairing') : t('pairing.submit')}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
