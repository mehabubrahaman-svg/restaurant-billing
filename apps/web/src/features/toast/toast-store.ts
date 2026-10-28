import type { AlertTone } from '@restroos/ui';
import { create } from 'zustand';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: AlertTone;
  readonly title?: string;
  readonly action?: ToastAction;
}

const VISIBLE_MS = 4_000;

export interface ToastOptions {
  readonly title?: string;
  readonly action?: ToastAction;
  /** How long it stays; default 4 s. */
  readonly durationMs?: number;
}
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
export function toast(
  message: string,
  tone: AlertTone = 'success',
  { title, action, durationMs = VISIBLE_MS }: ToastOptions = {},
): void {
  const id = nextId++;
  const entry: Toast = {
    id,
    message,
    tone,
    ...(title === undefined ? {} : { title }),
    ...(action === undefined ? {} : { action }),
  };
  useToastStore.setState((s) => ({ toasts: [...s.toasts, entry] }));
  setTimeout(() => useToastStore.getState().dismiss(id), durationMs);
}
