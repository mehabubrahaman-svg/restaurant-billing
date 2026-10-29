import type { Account, AccountType, JournalSourceType } from '@restroos/contracts';
import { Badge, type BadgeProps } from '@restroos/ui';
import { useTranslation } from 'react-i18next';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
];

export const SOURCE_TYPES: readonly JournalSourceType[] = [
  'INVOICE',
  'CREDIT_NOTE',
  'PAYMENT',
  'GRN',
  'VENDOR_PAYMENT',
  'EXPENSE',
  'STOCK',
  'MANUAL',
];

/** The day book and ledgers (expenses.manage alone gives the chart and expenses only). */
export const BOOKS_PERMISSIONS = ['accounts.view', 'accounts.journal'] as const;
/** The trial balance; the other statements need reports.financial. */
export const TRIAL_BALANCE_PERMISSIONS = ['accounts.view', 'reports.financial'] as const;

/** System accounts an expense can be paid from (the Hub's rule). */
const PAYING_TAGS = new Set(['CASH', 'BANK', 'CARD_UPI_CLEARING']);

/**
 * Chart order: by code, each account followed by the accounts under it, with
 * its depth for indenting. Accounts whose parent is missing start a branch.
 */
export function chartOrder(accounts: readonly Account[]): { account: Account; depth: number }[] {
  const byCode = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  const ids = new Set(byCode.map((a) => a.id));
  const out: { account: Account; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const a of byCode) {
      const isRoot = a.parentId === null || !ids.has(a.parentId);
      if (!seen.has(a.id) && (parentId === null ? isRoot : a.parentId === parentId)) {
        seen.add(a.id);
        out.push({ account: a, depth });
        visit(a.id, depth + 1);
      }
    }
  };
  visit(null, 0);
  // Accounts that point at each other as parents are listed rather than lost.
  for (const a of byCode) if (!seen.has(a.id)) out.push({ account: a, depth: 0 });
  return out;
}

/**
 * Where the Hub lets an expense be paid from: an active asset account that is
 * cash, the bank or card/UPI clearing, or one the owner added (petty cash, a
 * second bank account), which has no system tag.
 */
export function payingAccounts(accounts: readonly Account[]): Account[] {
  return chartOrder(accounts)
    .map((r) => r.account)
    .filter(
      (a) =>
        a.isActive && a.type === 'ASSET' && (a.systemTag === null || PAYING_TAGS.has(a.systemTag)),
    );
}

/** "6020 · Electricity and gas". */
export function useAccountLabel(): (account: { code: string; name: string }) => string {
  const { t } = useTranslation();
  return (account) => t('accounts.accountLabel', { code: account.code, name: account.name });
}

/** Active accounts as <option>s grouped by type, for an account picker. */
export function AccountOptions({
  accounts,
  types = ACCOUNT_TYPES,
}: {
  accounts: readonly Account[];
  types?: readonly AccountType[];
}) {
  const { t } = useTranslation();
  const label = useAccountLabel();
  const ordered = chartOrder(accounts.filter((a) => a.isActive));
  return (
    <>
      {types.map((type) => {
        const own = ordered.filter((r) => r.account.type === type);
        if (own.length === 0) return null;
        return (
          <optgroup key={type} label={t(`accounts.types.${type}`)}>
            {own.map(({ account }) => (
              <option key={account.id} value={account.id}>
                {label(account)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

const SOURCE_VARIANT: Record<JournalSourceType, NonNullable<BadgeProps['variant']>> = {
  INVOICE: 'success',
  CREDIT_NOTE: 'warning',
  PAYMENT: 'info',
  GRN: 'outline',
  VENDOR_PAYMENT: 'info',
  EXPENSE: 'warning',
  STOCK: 'neutral',
  MANUAL: 'primary',
};

export function SourceBadge({ type }: { type: JournalSourceType }) {
  const { t } = useTranslation();
  return (
    <Badge variant={SOURCE_VARIANT[type]} className="whitespace-nowrap">
      {t(`accounts.sources.${type}`)}
    </Badge>
  );
}
