import { create } from 'zustand';
import { checkHealth } from '../../api/health';

/**
 * `restoring`: the Hub accepted a restore and is restarting; every screen is
 * covered until it answers again. `failed`: it did not come back in time.
 */
export type RestorePhase = 'idle' | 'restoring' | 'failed';

interface RestoreState {
  readonly phase: RestorePhase;
  /** When the restored backup was taken, for the message. */
  readonly backupCreatedAt: string | null;
}

export const useRestoreStore = create<RestoreState>()(() => ({
  phase: 'idle',
  backupCreatedAt: null,
}));

/** How the wait for the Hub's restart is paced (tests shorten it). */
export const RESTORE_TIMING = {
  /** Ask /health this often. */
  pollMs: 1_000,
  /** The Hub answered all along: after this long assume it restarted between two polls. */
  assumeRestartedMs: 15_000,
  /** Stop waiting and offer a reload. */
  giveUpMs: 120_000,
};

export function startRestoreWait(backupCreatedAt: string): void {
  useRestoreStore.setState({ phase: 'restoring', backupCreatedAt });
}

export function endRestoreWait(phase: 'idle' | 'failed'): void {
  useRestoreStore.setState({ phase, ...(phase === 'idle' ? { backupCreatedAt: null } : {}) });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

async function hubAnswers(signal: AbortSignal): Promise<boolean> {
  try {
    await checkHealth(signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves `true` once the Hub is back after its restart: it went away and
 * answers again (or answered throughout for `assumeRestartedMs`, when the
 * restart fell between two polls). `false` after `giveUpMs` or on abort.
 */
export async function waitForHubRestart(signal: AbortSignal): Promise<boolean> {
  const started = Date.now();
  let wentAway = false;
  while (!signal.aborted && Date.now() - started < RESTORE_TIMING.giveUpMs) {
    await sleep(RESTORE_TIMING.pollMs, signal);
    if (signal.aborted) return false;
    if (!(await hubAnswers(signal))) {
      wentAway = true;
      continue;
    }
    if (wentAway || Date.now() - started >= RESTORE_TIMING.assumeRestartedMs) return true;
  }
  return false;
}
