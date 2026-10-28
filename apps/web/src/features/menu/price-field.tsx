import { Money } from '@restroos/domain';
import { Field, Input } from '@restroos/ui';
import { useFormat } from '../../i18n/use-format';
import { rupeesToPaise } from '../../lib/units';

/** Rupee amount typed as text; shows how it will be read, e.g. "₹1,249.50". */
export function PriceField({
  label,
  hint,
  value,
  onChange,
  error,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  required?: boolean;
}) {
  const format = useFormat();
  const paise = value.trim() === '' ? null : rupeesToPaise(value);
  const reading = paise === null ? null : format.money(Money.ofPaise(paise));
  const fullHint = [hint, reading].filter((s) => s !== undefined && s !== null).join(' · ');
  return (
    <Field
      label={label}
      hint={fullHint === '' ? undefined : fullHint}
      error={error}
      required={required ?? false}
    >
      {(p) => (
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {'₹' /* the rupee sign is the same in every language */}
          </span>
          <Input
            {...p}
            inputMode="decimal"
            className="ps-7 tabular-nums"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )}
    </Field>
  );
}
