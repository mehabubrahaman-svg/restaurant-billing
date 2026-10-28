import { create } from 'zustand';

interface KdsFlagsState {
  /** KOTs the Hub reported past their target time (`kitchen.kot.delayed`). */
  readonly delayed: ReadonlySet<string>;
  markDelayed(kotId: string): void;
}

export const useKdsFlags = create<KdsFlagsState>()((set) => ({
  delayed: new Set(),
  markDelayed: (kotId) =>
    set((s) => (s.delayed.has(kotId) ? s : { delayed: new Set([...s.delayed, kotId]) })),
}));
