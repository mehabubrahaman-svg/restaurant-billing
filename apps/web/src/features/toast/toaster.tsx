import { Alert, Button } from '@restroos/ui';
import { useToastStore } from './toast-store';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      // Phones: above the bottom nav. Tablets and up: under the top bar, clear of the
      // action buttons that sit at the bottom of the order pad and forms.
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:top-20 md:bottom-auto print:hidden"
    >
      {toasts.map((t) => (
        // The tone colours are translucent tints: an opaque surface underneath keeps
        // the text readable over whatever the toast covers.
        <div
          key={t.id}
          className="pointer-events-auto w-full max-w-md rounded-lg bg-surface shadow-lg"
        >
          <Alert tone={t.tone} {...(t.title === undefined ? {} : { title: t.title })}>
            {t.action === undefined ? (
              t.message
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t.message}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-touch"
                  onClick={() => {
                    dismiss(t.id);
                    t.action?.onClick();
                  }}
                >
                  {t.action.label}
                </Button>
              </div>
            )}
          </Alert>
        </div>
      ))}
    </div>
  );
}
