import { describe, expect, it } from 'vitest';
import { HubSupervisor, RESTART_EXIT_CODE, type HubProcess } from './hub-supervisor';

function harness() {
  let clock = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const spawned: FakeHub[] = [];
  const restarts: string[] = [];
  let gaveUp = 0;
  class FakeHub implements HubProcess {
    listeners: ((code: number) => void)[] = [];
    messages: unknown[] = [];
    killed = false;
    onExit(l: (code: number) => void) {
      this.listeners.push(l);
    }
    postMessage(m: unknown) {
      this.messages.push(m);
    }
    kill() {
      this.killed = true;
    }
    exit(code: number) {
      for (const l of this.listeners) l(code);
    }
  }
  const supervisor = new HubSupervisor({
    spawn: () => {
      const hub = new FakeHub();
      spawned.push(hub);
      return hub;
    },
    onGiveUp: (n) => (gaveUp = n),
    onRestart: (reason, delay) => restarts.push(`${reason}:${delay}`),
    now: () => clock,
    schedule: (fn, ms) => timers.push({ at: clock + ms, fn }),
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) t.fn();
      else timers.push(t);
    }
  };
  return { supervisor, spawned, restarts, advance, gaveUp: () => gaveUp };
}

describe('HubSupervisor', () => {
  it('restarts at once after a restore', () => {
    const h = harness();
    h.supervisor.start();
    h.spawned[0]!.exit(RESTART_EXIT_CODE);
    expect(h.spawned).toHaveLength(2);
    expect(h.restarts).toEqual(['restore:0']);
  });

  it('backs off after crashes and gives up after 5 in 2 minutes', () => {
    const h = harness();
    h.supervisor.start();
    for (let i = 0; i < 4; i++) {
      h.spawned.at(-1)!.exit(1);
      h.advance(60_000 / 4);
    }
    expect(h.restarts).toEqual(['crash:1000', 'crash:2000', 'crash:4000', 'crash:8000']);
    expect(h.spawned).toHaveLength(5);
    h.spawned.at(-1)!.exit(1);
    expect(h.gaveUp()).toBe(5);
    h.advance(60_000);
    expect(h.spawned).toHaveLength(5);
  });

  it('forgets crashes older than 2 minutes', () => {
    const h = harness();
    h.supervisor.start();
    for (let i = 0; i < 8; i++) {
      h.spawned.at(-1)!.exit(1);
      h.advance(60_000);
    }
    expect(h.gaveUp()).toBe(0);
    expect(h.spawned).toHaveLength(9);
  });

  it('stops cleanly with a shutdown message, and kills a Hub that hangs', async () => {
    const h = harness();
    h.supervisor.start();
    const first = h.spawned[0]!;
    const stopped = h.supervisor.stop();
    expect(first.messages).toEqual([{ type: 'shutdown' }]);
    first.exit(0);
    await stopped;
    expect(first.killed).toBe(false);
    expect(h.spawned).toHaveLength(1); // no restart after a requested stop

    h.supervisor.start();
    const second = h.spawned[1]!;
    const hanging = h.supervisor.stop();
    h.advance(10_000);
    await hanging;
    expect(second.killed).toBe(true);
  });
});
