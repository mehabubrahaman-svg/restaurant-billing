import type { AlertTone } from '@restroos/ui';
import { create } from 'zustand';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: AlertTone;
}

const VISIBLE_MS = 4_000;
let nextId = 1;

interface ToastState {
  readonly toasts: readonly Toast[];
  dismiss(id: number): void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Short confirmation after an action ("User saved"). Errors stay inline instead. */
export function toast(message: string, tone: AlertTone = 'success'): void {
  const id = nextId++;
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), VISIBLE_MS);
}
