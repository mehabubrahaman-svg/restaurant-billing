import type { DevicePrintJob } from '@restroos/contracts';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import { isAndroidApp, printOverBluetooth } from '../../lib/android-bridge';
import { useDeviceStore } from '../../stores/device-store';
import { toast } from '../toast/toast-store';

/** How often the tablet asks the Hub for tickets to print. */
export const DEVICE_PRINT_POLL_MS = 3_000;

/**
 * Prints one round of queued tickets, oldest first, and tells the Hub how
 * each went. Returns the jobs that failed so the caller can say so.
 */
export async function printQueuedJobs(): Promise<DevicePrintJob[]> {
  const { data } = await api.devices.printJobs();
  const failed: DevicePrintJob[] = [];
  for (const job of data) {
    const result = await printOverBluetooth(job.connection, job.address, job.data);
    if (!result.ok) failed.push(job);
    await api.devices.printResult(
      job.id,
      result.ok ? { ok: true } : { ok: false, error: (result.error ?? 'failed').slice(0, 200) },
    );
  }
  return failed;
}

/**
 * In the Android app on a paired tablet: prints the KOTs and bills the Hub
 * queues for the Bluetooth printers attached to this tablet. Elsewhere it
 * does nothing (the Hub prints itself, or the browser shows a preview).
 */
export function useDevicePrintAgent(): void {
  const { t } = useTranslation();
  const paired = useDeviceStore((s) => s.status === 'paired');
  useEffect(() => {
    if (!paired || !isAndroidApp()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const round = async () => {
      try {
        const failed = await printQueuedJobs();
        for (const job of failed) {
          toast(t('printers.deviceFailed', { name: job.printerName }), 'danger');
        }
      } catch {
        // The Hub is away or this tablet was unpaired: try again next round.
      }
      if (!stopped) timer = setTimeout(() => void round(), DEVICE_PRINT_POLL_MS);
    };
    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paired, t]);
}
