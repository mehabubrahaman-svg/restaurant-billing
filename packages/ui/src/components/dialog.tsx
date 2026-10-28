import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Accessible name of the close (✕) button. */
  readonly closeLabel: string;
  readonly children?: ReactNode;
  /** Buttons row, pinned under the scrolling body. */
  readonly footer?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  /** Close on Esc / backdrop tap. Turn off while a request is in flight. */
  readonly dismissible?: boolean;
}

/**
 * Modal dialog: focus moves in on open, Tab stays inside, Esc closes, and
 * focus returns to whatever opened it. Full-height sheet on phones.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Prefer an explicit [data-autofocus], then the first control in the body (not ✕).
    const first =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      body.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.current;
    first?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && dismissibleRef.current) {
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === 'Tab' && panel.current !== null) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const firstItem = items[0]!;
        const lastItem = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === firstItem) {
          lastItem.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          firstItem.focus();
          event.preventDefault();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (dismissible) onClose();
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description !== undefined ? { 'aria-describedby': descriptionId } : {})}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-dvh w-full flex-col rounded-t-2xl border bg-surface text-surface-foreground shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
        )}
      >
        <div className="flex items-start gap-3 border-b p-4 ps-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-lg leading-snug font-semibold">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            disabled={!dismissible}
            onClick={onClose}
            className="grid size-touch shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto p-5">
          {children}
        </div>
        {footer !== undefined && (
          <div className="flex flex-wrap justify-end gap-3 border-t p-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
