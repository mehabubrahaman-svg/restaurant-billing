import { useEffect, useRef } from 'react';

/** Keys the counter answers to. F1, F3, F5, F10–F12 are left to the browser. */
export type ShortcutKey = 'F2' | 'F4' | 'F6' | 'F7' | 'F8' | 'F9' | 'Escape';

/** True while a modal dialog is open: it owns the keyboard then (its Esc closes it). */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * Counter keyboard shortcuts. Handlers that are `undefined` are not active
 * (the key does what the browser normally does). Ignored while a dialog is open.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutKey, (() => void) | undefined>>) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const handler = ref.current[event.key as ShortcutKey];
      if (handler === undefined || modalOpen()) return;
      event.preventDefault();
      handler();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
