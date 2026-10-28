import { Alert } from '@restroos/ui';
import { useToastStore } from './toast-store';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((t) => (
        <Alert key={t.id} tone={t.tone} className="pointer-events-auto w-full max-w-md shadow-lg">
          {t.message}
        </Alert>
      ))}
    </div>
  );
}
