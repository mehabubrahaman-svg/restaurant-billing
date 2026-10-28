/** The exit code the Hub uses to ask for a restart (a restore was staged). */
export const RESTART_EXIT_CODE = 75;

/** The running Hub server, as the supervisor sees it (an Electron utility process). */
export interface HubProcess {
  onExit(listener: (code: number) => void): void;
  postMessage(message: unknown): void;
  kill(): void;
}

export interface HubSupervisorOptions {
  readonly spawn: () => HubProcess;
  /** Called when the Hub could not be kept running; show the owner what to do. */
  readonly onGiveUp: (crashes: number) => void;
  readonly onRestart?: (reason: 'restore' | 'crash', delayMs: number) => void;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => void;
  /** How long a graceful stop may take before the process is killed. */
  readonly stopTimeoutMs?: number;
}

const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Keeps the Hub server running: the watchdog of docs/01 §1. A restart asked
 * for by a restore happens at once; a crash is retried with backoff (1 s,
 * 2 s, 4 s ... 30 s), and after 5 crashes in 2 minutes it gives up rather
 * than loop forever on, say, a database it cannot open.
 */
export class HubSupervisor {
  private current: HubProcess | null = null;
  private stopping = false;
  private crashes: number[] = [];
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;

  constructor(private readonly o: HubSupervisorOptions) {
    this.now = o.now ?? Date.now;
    this.schedule = o.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get running(): HubProcess | null {
    return this.current;
  }

  start(): void {
    this.stopping = false;
    const hub = this.o.spawn();
    this.current = hub;
    hub.onExit((code) => this.exited(hub, code));
  }

  /** Asks the Hub to shut down cleanly (checkpointing the database), then kills it if it hangs. */
  stop(): Promise<void> {
    this.stopping = true;
    const hub = this.current;
    if (!hub) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      hub.onExit(finish);
      hub.postMessage({ type: 'shutdown' });
      this.schedule(() => {
        if (!done) hub.kill();
        finish();
      }, this.o.stopTimeoutMs ?? 10_000);
    });
  }

  private exited(hub: HubProcess, code: number) {
    if (hub !== this.current) return;
    this.current = null;
    if (this.stopping) return;
    if (code === RESTART_EXIT_CODE) {
      this.o.onRestart?.('restore', 0);
      this.start();
      return;
    }
    const now = this.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashes.length >= MAX_CRASHES) {
      this.o.onGiveUp(this.crashes.length);
      return;
    }
    const delay = Math.min(1000 * 2 ** (this.crashes.length - 1), MAX_BACKOFF_MS);
    this.o.onRestart?.('crash', delay);
    this.schedule(() => {
      if (!this.stopping) this.start();
    }, delay);
  }
}
