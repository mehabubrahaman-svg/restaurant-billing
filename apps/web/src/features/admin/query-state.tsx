import { Alert, Button, Spinner } from '@restroos/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../lib/errors';

/** Loading spinner / error with retry / content, for one query. */
export function QueryState<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  if (query.isPending) return <Spinner label={t('common.loading')} className="py-6" />;
  if (query.isError) {
    return (
      <Alert tone="danger" role="alert">
        <p>{errorMessage(query.error)}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </Alert>
    );
  }
  return children(query.data);
}
