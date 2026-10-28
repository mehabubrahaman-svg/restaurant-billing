import type { IndianState, SetupRequest } from '@restroos/contracts';
import { PasswordSchema } from '@restroos/contracts';
import type { AppLocale } from '../../i18n/config';
import { isWeakPin } from '../../lib/pin';
import { percentToBp } from '../../lib/units';
import { gstinProblem } from './gstin';

export const STEPS = [
  'language',
  'business',
  'liquor',
  'receipt',
  'admin',
  'backup',
  'review',
] as const;
export type Step = (typeof STEPS)[number];

export type ReceiptLanguage = 'en' | 'hi' | 'bn';
export const RECEIPT_LANGUAGES: readonly ReceiptLanguage[] = ['en', 'hi', 'bn'];

export interface SetupForm {
  locale: AppLocale;
  orgName: string;
  legalName: string;
  branchName: string;
  branchCode: string;
  stateCode: string;
  address: string;
  phone: string;
  gstin: string;
  liquorEnabled: boolean;
  overrideProhibition: boolean;
  vatTin: string;
  exciseLicenceNo: string;
  vatPercent: string;
  surchargePercent: string;
  separateInvoice: boolean;
  receiptLanguages: ReceiptLanguage[];
  adminUsername: string;
  adminFullName: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  adminPin: string;
  adminPinConfirm: string;
  backupPassphrase: string;
  backupPassphraseConfirm: string;
  backupAcknowledged: boolean;
  setupCode: string;
}

export function initialForm(locale: AppLocale): SetupForm {
  return {
    locale,
    orgName: '',
    legalName: '',
    branchName: '',
    branchCode: '',
    stateCode: '',
    address: '',
    phone: '',
    gstin: '',
    liquorEnabled: false,
    overrideProhibition: false,
    vatTin: '',
    exciseLicenceNo: '',
    vatPercent: '',
    surchargePercent: '',
    separateInvoice: false,
    receiptLanguages: ['en'],
    adminUsername: '',
    adminFullName: '',
    adminPassword: '',
    adminPasswordConfirm: '',
    adminPin: '',
    adminPinConfirm: '',
    backupPassphrase: '',
    backupPassphraseConfirm: '',
    backupAcknowledged: false,
    setupCode: '',
  };
}

/** Receipt languages a new branch in this state starts with: its local languages we support. */
export function defaultReceiptLanguages(state: IndianState | undefined): ReceiptLanguage[] {
  const supported = (state?.localLocales ?? []).filter((l): l is ReceiptLanguage =>
    (RECEIPT_LANGUAGES as readonly string[]).includes(l),
  );
  return supported.length === 0 ? ['en'] : supported.slice(0, 2);
}

/** Translation keys of validation messages (checked against the catalogue by typecheck). */
export type SetupErrorKey =
  | 'validation.required'
  | 'validation.nameLength'
  | 'validation.passwordShort'
  | 'validation.passwordsDiffer'
  | 'validation.pinFormat'
  | 'validation.pinWeak'
  | 'validation.pinsDiffer'
  | 'validation.username'
  | 'validation.percent'
  | 'setup.errors.branchCode'
  | 'setup.errors.state'
  | 'setup.errors.gstinFormat'
  | 'setup.errors.gstinState'
  | 'setup.errors.gstinChecksum'
  | 'setup.errors.prohibition'
  | 'setup.errors.vatTin'
  | 'setup.errors.excise'
  | 'setup.errors.vatRate'
  | 'setup.errors.receiptLanguages'
  | 'setup.errors.passphraseShort'
  | 'setup.errors.passphrasesDiffer'
  | 'setup.errors.acknowledge'
  | 'setup.errors.setupCode'
  | 'errors.invalidSetupCode'
  | 'errors.liquorNotPermitted';

export type SetupErrors = Partial<Record<keyof SetupForm, SetupErrorKey>>;

const between = (s: string, min: number, max: number) =>
  s.trim().length >= min && s.trim().length <= max;

const USERNAME = /^[a-z0-9._-]{3,32}$/;
const PIN = /^\d{4,6}$/;

/** Validates one step. Field-level keys only; the UI translates them. */
export function validateStep(
  step: Step,
  f: SetupForm,
  states: readonly IndianState[],
): SetupErrors {
  const e: SetupErrors = {};
  const state = states.find((s) => s.gstStateCode === f.stateCode);
  switch (step) {
    case 'language':
      break;
    case 'business': {
      if (!between(f.orgName, 2, 120)) e.orgName = 'validation.nameLength';
      if (!between(f.branchName, 2, 120)) e.branchName = 'validation.nameLength';
      if (!/^[A-Z0-9]{2,8}$/.test(f.branchCode.trim().toUpperCase()))
        e.branchCode = 'setup.errors.branchCode';
      if (state === undefined) e.stateCode = 'setup.errors.state';
      if (f.gstin.trim() !== '') {
        const problem = gstinProblem(f.gstin, f.stateCode);
        if (problem === 'format') e.gstin = 'setup.errors.gstinFormat';
        if (problem === 'state') e.gstin = 'setup.errors.gstinState';
        if (problem === 'checksum') e.gstin = 'setup.errors.gstinChecksum';
      }
      break;
    }
    case 'liquor': {
      if (!f.liquorEnabled) break;
      if (state !== undefined && !state.liquorPermitted && !f.overrideProhibition)
        e.liquorEnabled = 'setup.errors.prohibition';
      if (!between(f.vatTin, 5, 20)) e.vatTin = 'setup.errors.vatTin';
      if (!between(f.exciseLicenceNo, 3, 40)) e.exciseLicenceNo = 'setup.errors.excise';
      const vat = percentToBp(f.vatPercent);
      if (vat === null) e.vatPercent = 'validation.percent';
      else if (vat < 1 || vat > 100_00) e.vatPercent = 'setup.errors.vatRate';
      if (f.surchargePercent.trim() !== '') {
        const surcharge = percentToBp(f.surchargePercent);
        if (surcharge === null || surcharge > 100_00) e.surchargePercent = 'validation.percent';
      }
      break;
    }
    case 'receipt':
      if (f.receiptLanguages.length < 1 || f.receiptLanguages.length > 2)
        e.receiptLanguages = 'setup.errors.receiptLanguages';
      break;
    case 'admin':
      if (!USERNAME.test(f.adminUsername.trim().toLowerCase()))
        e.adminUsername = 'validation.username';
      if (!between(f.adminFullName, 2, 120)) e.adminFullName = 'validation.nameLength';
      if (!PasswordSchema.safeParse(f.adminPassword).success)
        e.adminPassword = 'validation.passwordShort';
      if (f.adminPasswordConfirm !== f.adminPassword)
        e.adminPasswordConfirm = 'validation.passwordsDiffer';
      if (f.adminPin !== '' && !PIN.test(f.adminPin)) e.adminPin = 'validation.pinFormat';
      else if (isWeakPin(f.adminPin)) e.adminPin = 'validation.pinWeak';
      if (f.adminPinConfirm !== f.adminPin) e.adminPinConfirm = 'validation.pinsDiffer';
      break;
    case 'backup':
      if (f.backupPassphrase.length < 12) e.backupPassphrase = 'setup.errors.passphraseShort';
      if (f.backupPassphraseConfirm !== f.backupPassphrase)
        e.backupPassphraseConfirm = 'setup.errors.passphrasesDiffer';
      if (!f.backupAcknowledged) e.backupAcknowledged = 'setup.errors.acknowledge';
      break;
    case 'review':
      if (!between(f.setupCode, 6, 32)) e.setupCode = 'setup.errors.setupCode';
      break;
  }
  return e;
}

/** The first step with an error, for jumping back from the review step. */
export function firstInvalidStep(f: SetupForm, states: readonly IndianState[]): Step | null {
  return STEPS.find((s) => Object.keys(validateStep(s, f, states)).length > 0) ?? null;
}

const optional = (s: string) => (s.trim() === '' ? undefined : s.trim());

/** Builds the POST /setup body. Call only when every step validates. */
export function toSetupRequest(f: SetupForm): SetupRequest {
  const legalName = optional(f.legalName);
  const address = optional(f.address);
  const phone = optional(f.phone);
  const gstin = optional(f.gstin);
  const pin = optional(f.adminPin);
  return {
    setupCode: f.setupCode.trim(),
    organization: { name: f.orgName.trim(), ...(legalName ? { legalName } : {}) },
    branch: {
      name: f.branchName.trim(),
      code: f.branchCode.trim().toUpperCase(),
      stateCode: f.stateCode,
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
      ...(gstin ? { gstin: gstin.toUpperCase() } : {}),
    },
    liquor: f.liquorEnabled
      ? {
          enabled: true,
          vatTin: f.vatTin.trim(),
          exciseLicenceNo: f.exciseLicenceNo.trim(),
          vatRateBp: percentToBp(f.vatPercent) ?? 0,
          surchargeBp:
            f.surchargePercent.trim() === '' ? 0 : (percentToBp(f.surchargePercent) ?? 0),
          separateInvoice: f.separateInvoice,
          overrideProhibition: f.overrideProhibition,
        }
      : { enabled: false },
    languages: { defaultLocale: f.locale, receiptLanguages: f.receiptLanguages },
    admin: {
      username: f.adminUsername.trim().toLowerCase(),
      fullName: f.adminFullName.trim(),
      password: f.adminPassword,
      ...(pin ? { pin } : {}),
    },
    backupPassphrase: f.backupPassphrase,
  };
}

/** Maps a server validation path ("branch.gstin", "/admin/password") to its wizard step. */
export function stepForServerPath(path: string): Step {
  const head = path.split(/[./[\]]/).find((p) => p !== '') ?? '';
  switch (head) {
    case 'organization':
    case 'branch':
      return 'business';
    case 'liquor':
      return 'liquor';
    case 'languages':
      return 'receipt';
    case 'admin':
      return 'admin';
    case 'backupPassphrase':
      return 'backup';
    default:
      return 'review';
  }
}
