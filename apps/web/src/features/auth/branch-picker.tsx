import type { BranchSummary } from '@restroos/contracts';
import { Alert, Button, ChevronRight, MapPin } from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/errors';

/** After login, for people who work in more than one branch. */
export function BranchPicker({
  branches,
  currentId,
  onPick,
}: {
  branches: readonly BranchSummary[];
  currentId: string;
  onPick: (branchId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onPick(id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('login.chooseBranch')}</h2>
      {error !== null && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      <ul className="flex flex-col gap-2">
        {branches.map((b) => (
          <li key={b.id}>
            <Button
              variant="outline"
              className="w-full justify-start text-start"
              disabled={busy !== null}
              onClick={() => void pick(b.id)}
            >
              <MapPin aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{b.name}</span>
                <span className="text-sm text-muted-foreground">
                  {b.id === currentId ? t('login.branchCurrent', { code: b.code }) : b.code}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="rtl:rotate-180" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
