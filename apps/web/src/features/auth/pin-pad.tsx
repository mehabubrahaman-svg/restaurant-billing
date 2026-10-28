import { ArrowRight, Button, cn, Delete } from '@restroos/ui';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../../i18n/use-format';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

interface PinPadProps {
  readonly entered: number;
  readonly length: number;
  readonly canSubmit: boolean;
  readonly onDigit: (digit: string) => void;
  readonly onBackspace: () => void;
  readonly onSubmit: () => void;
  /** Accessible name of the → key. */
  readonly submitLabel?: string;
  /** Also accept digits, Backspace and Enter from a physical keyboard or USB keypad. */
  readonly listenToKeyboard?: boolean;
}

/** Wireframes §3: dots, then a 3×4 pad of 64 px keys ending in ⌫ 0 →. */
export function PinPad({
  entered,
  length,
  canSubmit,
  onDigit,
  onBackspace,
  onSubmit,
  submitLabel,
  listenToKeyboard = false,
}: PinPadProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const key = 'h-16 text-2xl font-semibold tabular-nums';

  // Latest handlers without re-subscribing on every keystroke.
  const handlers = useRef({ onDigit, onBackspace, onSubmit });
  useEffect(() => {
    handlers.current = { onDigit, onBackspace, onSubmit };
  });
  useEffect(() => {
    if (!listenToKeyboard) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(event.key)) handlers.current.onDigit(event.key);
      else if (event.key === 'Backspace') handlers.current.onBackspace();
      else if (event.key === 'Enter') handlers.current.onSubmit();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listenToKeyboard]);

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex gap-4" aria-hidden="true">
        {Array.from({ length }, (_, i) => (
          <motion.span
            key={i}
            animate={{ scale: i < entered ? 1 : 0.8 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'size-4 rounded-full border-2 border-foreground',
              i < entered && 'bg-foreground',
            )}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {t('login.pinEntered', { entered })}
      </p>
      <div className="grid w-full max-w-72 grid-cols-3 gap-3">
        {DIGITS.map((d) => (
          <Button key={d} variant="outline" className={key} onClick={() => onDigit(d)}>
            {format.number(Number(d))}
          </Button>
        ))}
        <Button
          variant="ghost"
          className={key}
          onClick={onBackspace}
          disabled={entered === 0}
          aria-label={t('login.backspace')}
        >
          <Delete aria-hidden="true" className="size-7!" />
        </Button>
        <Button variant="outline" className={key} onClick={() => onDigit('0')}>
          {format.number(0)}
        </Button>
        <Button
          className={key}
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label={submitLabel ?? t('login.submit')}
        >
          <ArrowRight aria-hidden="true" className="size-7! rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
