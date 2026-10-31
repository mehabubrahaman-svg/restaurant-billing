import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SalesReportQuery } from '@restroos/contracts';
import { api } from '../../api/endpoints';
import { saveBlob } from '../../lib/download';
import { useErrorMessage } from '../../lib/errors';
import { toast } from '../toast/toast-store';

export const REPORT_KEYS = {
  all: ['reports'],
  dashboard: ['reports', 'dashboard'],
  /** `null`: today's business day, as the Hub reckons it. */
  dayEnd: (date: string | null) => ['reports', 'day-end', date] as const,
  sales: (query: SalesReportQuery) => ['reports', 'sales', query] as const,
  schedules: ['reports', 'schedules'],
  files: ['reports', 'files'],
} as const;

/** The branch's report schedules (those this user may read). */
export function useReportSchedules() {
  return useQuery({ queryKey: REPORT_KEYS.schedules, queryFn: api.reportSchedules.list });
}

/** Files the schedules made, newest first; refreshed every minute while on screen. */
export function useReportFiles() {
  return useQuery({
    queryKey: REPORT_KEYS.files,
    queryFn: api.reportFiles.list,
    refetchInterval: 60_000,
  });
}

/** The owner's dashboard; refreshed every minute while it is on screen. */
export function useDashboard() {
  return useQuery({
    queryKey: REPORT_KEYS.dashboard,
    queryFn: api.reports.dashboard,
    refetchInterval: 60_000,
  });
}

/** The sales report for a range; `enabled: false` while the range is not valid. */
export function useSalesReport(query: SalesReportQuery, enabled: boolean) {
  return useQuery({
    queryKey: REPORT_KEYS.sales(query),
    queryFn: () => api.reports.sales(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDayEndReport(date: string | null) {
  return useQuery({
    queryKey: REPORT_KEYS.dayEnd(date),
    queryFn: () => api.reports.dayEnd(date ?? undefined),
  });
}

/** Fetches a file from the Hub (with the session) and saves it; errors become a toast. */
export function useDownload<A>(
  fetchFile: (args: A) => Promise<{ blob: Blob; fileName: string | null }>,
  fallbackName: (args: A) => string,
) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: async (args: A) => {
      const { blob, fileName } = await fetchFile(args);
      const name = fileName ?? fallbackName(args);
      await saveBlob(blob, name);
      return name;
    },
    onSuccess: (name) => toast(t('reports.downloaded', { name })),
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
}
