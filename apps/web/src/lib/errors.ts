import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError, NetworkError } from '../api/client';
import { useFormat } from '../i18n/use-format';
import { ApprovalCancelledError } from '../features/approval/with-approval';

const CODE_KEYS = {
  INVALID_CREDENTIALS: 'errors.invalidCredentials',
  ACCOUNT_DISABLED: 'errors.accountDisabled',
  RATE_LIMITED: 'errors.rateLimited',
  VERSION_CONFLICT: 'errors.versionConflict',
  FORBIDDEN: 'errors.forbidden',
  APPROVAL_REQUIRED: 'errors.forbidden',
  VALIDATION_FAILED: 'errors.validation',
  NOT_FOUND: 'errors.notFound',
  UNAUTHENTICATED: 'errors.sessionExpired',
  BAD_RESPONSE: 'errors.badResponse',
  INVALID_SETUP_CODE: 'errors.invalidSetupCode',
  SETUP_ALREADY_DONE: 'errors.setupAlreadyDone',
  LIQUOR_NOT_PERMITTED_IN_STATE: 'errors.liquorNotPermitted',
  GSTIN_INVALID: 'setup.errors.gstinChecksum',
  GSTIN_STATE_MISMATCH: 'setup.errors.gstinState',
  STATE_NOT_AVAILABLE: 'errors.stateNotAvailable',
  PASSWORD_TOO_WEAK: 'errors.passwordTooWeak',
  PIN_TOO_WEAK: 'errors.pinTooWeak',
  PIN_INVALID: 'validation.pinFormat',
  USERNAME_TAKEN: 'errors.usernameTaken',
  LAST_ADMIN: 'errors.lastAdmin',
  CANNOT_DEACTIVATE_SELF: 'errors.cannotDeactivateSelf',
  ROLE_LOCKED: 'roles.adminLocked',
  PERMISSION_UNKNOWN: 'errors.permissionUnknown',
  TAX_GROUP_INVALID: 'errors.taxGroupInvalid',
  LIQUOR_NOT_ENABLED: 'errors.liquorNotEnabled',
  INTERNAL_ERROR: 'errors.unknown',
} as const;

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/;

/** Pulls the lock-out end time out of ACCOUNT_LOCKED's `detail`, if it has one. */
export function lockedUntil(detail: string | undefined): string | null {
  const match = detail === undefined ? null : ISO_TIME.exec(detail);
  return match === null ? null : match[0];
}

/**
 * Turns any thrown error into a translated, user-facing sentence. Server
 * `detail` text is English and for logs; users see our own catalogue text.
 */
export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  const format = useFormat();
  return useCallback(
    (error: unknown) => {
      if (error instanceof NetworkError) return t('errors.network');
      if (error instanceof ApprovalCancelledError) return t('errors.approvalCancelled');
      if (!isApiError(error)) return t('errors.unknown');
      if (error.code === 'ACCOUNT_LOCKED') {
        const until = lockedUntil(error.problem?.detail);
        return until === null
          ? t('errors.accountLockedNoTime')
          : t('errors.accountLocked', { time: format.dateTime(until, { timeStyle: 'short' }) });
      }
      const key = (CODE_KEYS as Record<string, (typeof CODE_KEYS)[keyof typeof CODE_KEYS]>)[
        error.code
      ];
      if (key !== undefined) return t(key);
      // A code this build does not know yet: show the Hub's own detail, framed in our language.
      const detail = error.problem?.detail ?? error.problem?.title;
      return detail === undefined ? t('errors.unknown') : t('errors.withDetail', { detail });
    },
    [t, format],
  );
}
