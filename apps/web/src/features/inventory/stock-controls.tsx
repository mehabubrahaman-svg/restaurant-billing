import type { InventoryItem, StockLevel, Unit } from '@restroos/contracts';
import { Badge, Field, Input, Select, type BadgeProps, type FieldControlProps } from '@restroos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { localizedName } from '../menu/localized-name';
import { useStockFormat } from './use-stock-format';

const LEVEL_LOOK: Record<StockLevel, NonNullable<BadgeProps['variant']>> = {
  OUT: 'danger',
  LOW: 'warning',
  OK: 'success',
  OVER: 'info',
};

/** Out / Low / OK / Over max: where a balance sits against its reorder and maximum levels. */
export function LevelBadge({ level }: { level: StockLevel }) {
  const { t } = useTranslation();
  return (
    <Badge variant={LEVEL_LOOK[level]} className="whitespace-nowrap" data-level={level}>
      {t(`inventory.levels.${level}`)}
    </Badge>
  );
}

/** An item's name in the UI language (its English name when it has no translation). */
export function useItemName() {
  const { i18n } = useTranslation();
  return (item: { name: string; nameTranslations?: InventoryItem['nameTranslations'] }) =>
    localizedName(item.name, item.nameTranslations ?? {}, i18n.language);
}

/** Items grouped by category, in the Hub's order (category, then name). */
export function byCategory<T extends { category: string | null }>(
  items: readonly T[],
): { category: string | null; items: T[] }[] {
  const groups: { category: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }
  return groups;
}

/**
 * A native select of stock items, grouped by category. `disabledIds` are
 * listed but can't be picked (e.g. items that already have opening stock).
 */
export function ItemSelect({
  items,
  value,
  onChange,
  disabledIds,
  disabledNote,
  control,
}: {
  items: readonly InventoryItem[];
  value: string;
  onChange: (id: string) => void;
  disabledIds?: ReadonlySet<string>;
  /** Shown after a disabled item's name. */
  disabledNote?: string;
  /** The id/aria wiring from a Field. */
  control: FieldControlProps;
}) {
  const { t } = useTranslation();
  const name = useItemName();
  return (
    <Select {...control} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        {t('inventory.fields.pickItem')}
      </option>
      {byCategory(items).map((group) => (
        <optgroup key={group.category ?? ''} label={group.category ?? t('inventory.uncategorised')}>
          {group.items.map((item) => {
            const disabled = disabledIds?.has(item.id) === true && item.id !== value;
            return (
              <option key={item.id} value={item.id} disabled={disabled}>
                {disabled && disabledNote !== undefined
                  ? `${name(item)} (${disabledNote})`
                  : name(item)}
              </option>
            );
          })}
        </optgroup>
      ))}
    </Select>
  );
}

/** What a quantity input holds: the text as typed and the unit it is in. */
export interface QuantityDraft {
  readonly text: string;
  readonly unitId: string;
}

/**
 * A quantity typed in a chosen unit (2.5 + kg). The text is kept as typed and
 * parsed with `parseQuantity`, so nothing is rounded through a float.
 */
export function QuantityField({
  label,
  hint,
  error,
  required,
  value,
  units,
  onChange,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  value: QuantityDraft;
  units: readonly Unit[];
  onChange: (value: QuantityDraft) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const format = useStockFormat();
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required ?? false}
      {...(className === undefined ? {} : { className })}
    >
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            className="min-w-0 flex-1 tabular-nums"
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
          {units.length > 1 ? (
            <Select
              aria-label={t('inventory.fields.unitOf', { field: label })}
              className="w-28 shrink-0"
              value={value.unitId}
              onChange={(e) => onChange({ ...value, unitId: e.target.value })}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {format.unitLabel(u.code)}
                </option>
              ))}
            </Select>
          ) : (
            <span className="flex min-h-touch shrink-0 items-center px-1 text-muted-foreground">
              {format.unitLabel(units[0]?.code ?? '')}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}
