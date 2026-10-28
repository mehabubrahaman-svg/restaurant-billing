import type { SetupStatusResponse } from '@restroos/contracts';
import { Alert, Button, Card, Spinner, Store } from '@restroos/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { SETUP_STATUS_KEY } from '../../app/root-layout';
import { isSupportedLocale, DEFAULT_LOCALE } from '../../i18n/config';
import { LanguageSwitcher } from '../../i18n/language-switcher';
import { useErrorMessage } from '../../lib/errors';
import { useAuthStore } from '../auth/auth-store';
import { ConnectionPill } from '../connection/connection-pill';
import {
  defaultReceiptLanguages,
  firstInvalidStep,
  initialForm,
  stepForServerPath,
  STEPS,
  toSetupRequest,
  validateStep,
  type SetupErrors,
  type SetupForm,
  type Step,
} from './setup-form';
import {
  AdminStep,
  BackupStep,
  BusinessStep,
  LanguageStep,
  LiquorStep,
  ReceiptStep,
  ReviewStep,
} from './setup-steps';

const TITLE_KEYS = {
  language: 'setup.language.title',
  business: 'setup.business.title',
  liquor: 'setup.liquor.title',
  receipt: 'setup.receipt.title',
  admin: 'setup.admin.title',
  backup: 'setup.backup.title',
  review: 'setup.review.title',
} as const satisfies Record<Step, string>;

/** First-run wizard. Shown instead of everything else until the Hub is set up. */
export function SetupWizard() {
  const { t, i18n } = useTranslation();
  const status = useQuery({ queryKey: SETUP_STATUS_KEY, queryFn: api.setup.status });
  if (status.data === undefined) return <Spinner label={t('common.loading')} className="m-8" />;
  return (
    <SetupWizardForm
      states={status.data.states}
      initialLocale={isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE}
    />
  );
}

function SetupWizardForm({
  states,
  initialLocale,
}: {
  states: SetupStatusResponse['states'];
  initialLocale: SetupForm['locale'];
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState(() => initialForm(initialLocale));

  // The language the owner sets up in becomes the branch default, however it
  // was chosen (the language step's cards or the header switcher).
  const uiLanguage = i18n.language;
  useEffect(() => {
    if (isSupportedLocale(uiLanguage))
      setForm((f) => (f.locale === uiLanguage ? f : { ...f, locale: uiLanguage }));
  }, [uiLanguage]);
  const [step, setStep] = useState<Step>('language');
  const [errors, setErrors] = useState<SetupErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const receiptTouched = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const index = STEPS.indexOf(step);

  function update(patch: Partial<SetupForm>) {
    setForm((f) => {
      const next = { ...f, ...patch };
      // A new state brings its own defaults unless the owner already chose.
      if (patch.stateCode !== undefined && patch.stateCode !== f.stateCode) {
        const state = states.find((s) => s.gstStateCode === patch.stateCode);
        if (!receiptTouched.current) next.receiptLanguages = defaultReceiptLanguages(state);
        next.separateInvoice = state?.liquorSeparateInvoice ?? false;
        if (state !== undefined && !state.liquorPermitted) {
          next.liquorEnabled = false;
          next.overrideProhibition = false;
        }
      }
      if (patch.receiptLanguages !== undefined) receiptTouched.current = true;
      return next;
    });
    // Re-validate live once errors are showing, so they clear as the user fixes them.
    if (Object.keys(errors).length > 0) {
      setErrors(validateStep(step, { ...form, ...patch }, states));
    }
  }

  function go(next: Step) {
    setErrors({});
    setSubmitError(null);
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function nextStep() {
    const found = validateStep(step, form, states);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const next = STEPS[index + 1];
    if (next !== undefined) go(next);
    else void submit();
  }

  async function submit() {
    const invalid = firstInvalidStep(form, states);
    if (invalid !== null) {
      go(invalid);
      setErrors(validateStep(invalid, form, states));
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await api.setup.run(toSetupRequest(form));
      queryClient.setQueryData<SetupStatusResponse>(SETUP_STATUS_KEY, {
        needsSetup: false,
        states,
      });
      await useAuthStore.getState().login({
        username: form.adminUsername.trim().toLowerCase(),
        password: form.adminPassword,
      });
      void navigate('/admin', { replace: true });
    } catch (e) {
      setBusy(false);
      if (isApiError(e, 'INVALID_SETUP_CODE')) {
        setErrors({ setupCode: 'errors.invalidSetupCode' });
      } else if (isApiError(e, 'SETUP_ALREADY_DONE')) {
        queryClient.setQueryData<SetupStatusResponse>(SETUP_STATUS_KEY, {
          needsSetup: false,
          states,
        });
        void navigate('/login', { replace: true });
      } else if (isApiError(e, 'LIQUOR_NOT_PERMITTED_IN_STATE')) {
        go('liquor');
        setErrors({ liquorEnabled: 'errors.liquorNotPermitted' });
      } else if (isApiError(e, 'VALIDATION_FAILED')) {
        const path = e.problem?.errors?.[0]?.path;
        if (path !== undefined) go(stepForServerPath(path));
        setSubmitError(errorMessage(e));
      } else {
        setSubmitError(errorMessage(e));
      }
    }
  }

  const stepProps = { form, errors, update, states };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <title>{`${t('setup.title')} · ${t('app.name')}`}</title>
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Store aria-hidden="true" className="size-5" />
        </span>
        <p className="text-lg font-bold">{t('setup.title')}</p>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <ConnectionPill />
          <LanguageSwitcher />
        </div>
      </header>

      <nav aria-label={t('setup.progress')}>
        <ol className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className="sr-only">{t(TITLE_KEYS[s])}</span>
            </li>
          ))}
        </ol>
      </nav>

      <Card className="flex flex-col gap-5 p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t('setup.stepOf', { current: index + 1, total: STEPS.length })}
          </p>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none">
            {t(TITLE_KEYS[step])}
          </h1>
        </div>

        {submitError !== null && (
          <Alert tone="danger" role="alert">
            {submitError}
          </Alert>
        )}

        {step === 'language' && <LanguageStep {...stepProps} />}
        {step === 'business' && <BusinessStep {...stepProps} />}
        {step === 'liquor' && <LiquorStep {...stepProps} />}
        {step === 'receipt' && <ReceiptStep {...stepProps} />}
        {step === 'admin' && <AdminStep {...stepProps} />}
        {step === 'backup' && <BackupStep {...stepProps} />}
        {step === 'review' && <ReviewStep {...stepProps} onEdit={go} />}

        <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => go(STEPS[index - 1] ?? 'language')}
            disabled={index === 0 || busy}
          >
            {t('common.back')}
          </Button>
          <Button onClick={nextStep} disabled={busy}>
            {step === 'review'
              ? busy
                ? t('setup.review.submitting')
                : t('setup.review.submit')
              : t('common.next')}
          </Button>
        </div>
      </Card>
    </main>
  );
}
