import { ArrowRight, Button, cn, Delete } from '@restroos/ui';
import { motion } from 'motion/react';
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
}

/** Wireframes §3: dots, then a 3×4 pad of 64 px keys ending in ⌫ 0 →. */
export function PinPad({
  entered,
  length,
  canSubmit,
  onDigit,
  onBackspace,
  onSubmit,
}: PinPadProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const key = 'h-16 text-2xl font-semibold tabular-nums';

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
        {t('login.pinProgress', { entered, length })}
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
          aria-label={t('login.submit')}
        >
          <ArrowRight aria-hidden="true" className="size-7!" />
        </Button>
      </div>
    </div>
  );
}
