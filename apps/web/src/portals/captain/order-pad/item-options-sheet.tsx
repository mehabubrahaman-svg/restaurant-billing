import type { MenuItem, MenuSnapshot } from '@restroos/contracts';
import { Money } from '@restroos/domain';
import { Button, Checkbox, cn, Dialog, Input, Stepper } from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FoodTypeMark } from '../../../features/menu/food-type';
import { localizedName } from '../../../features/menu/localized-name';
import {
  addonGroupsOf,
  composeNote,
  initialChoice,
  optionsProblems,
  QUICK_NOTES,
  unitPrice,
  type OptionsChoice,
} from '../../../features/orders/item-options';
import type { DraftLine } from '../../../features/orders/pad-store';
import { useFormat } from '../../../i18n/use-format';

/** The sheet's result: a line ready to go on the pad. */
export type PickedLine = Omit<DraftLine, 'key'>;

/**
 * Item options (wireframes §5): size, add-ons within each group's min/max,
 * quick notes plus free text, quantity, and "Add · ₹…".
 */
export function ItemOptionsSheet({
  item,
  menu,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  menu: MenuSnapshot;
  onAdd: (line: PickedLine) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const lang = i18n.language;
  const groups = addonGroupsOf(item, menu);
  const variants = [...item.variants].sort((a, b) => a.sortOrder - b.sortOrder);
  const [choice, setChoice] = useState<OptionsChoice>(() => initialChoice(item));
  const [quick, setQuick] = useState<readonly string[]>([]);
  const [free, setFree] = useState('');
  const [quantity, setQuantity] = useState(1);
  const problems = optionsProblems(item, groups, choice);
  const unit = unitPrice(item, groups, choice);
  const total = Money.ofPaise(unit * quantity);
  const name = localizedName(item.name, item.nameTranslations, lang);
  const money = (paise: number) => format.money(Money.ofPaise(paise));

  function toggleAddon(groupId: string, addonId: string, on: boolean) {
    setChoice((c) => {
      const picked = c.addons[groupId] ?? [];
      const next = on ? [...picked, addonId] : picked.filter((id) => id !== addonId);
      return { ...c, addons: { ...c.addons, [groupId]: next } };
    });
  }

  function add() {
    if (problems.length > 0) return;
    const variant = variants.find((v) => v.id === choice.variantId);
    const picked = groups.flatMap((g) =>
      (choice.addons[g.id] ?? []).map((id) => g.addons.find((a) => a.id === id)!),
    );
    const note = composeNote(quick, free);
    onAdd({
      request: {
        menuItemId: item.id,
        ...(variant === undefined ? {} : { variantId: variant.id }),
        quantity,
        addons: picked.map((a) => ({ addonId: a.id, quantity: 1 })),
        ...(note === '' ? {} : { specialNote: note }),
      },
      unitTotal: unit,
      preview: {
        name,
        variantName:
          variant === undefined
            ? null
            : localizedName(variant.name, variant.nameTranslations, lang),
        foodType: item.foodType,
        addons: picked.map((a) => localizedName(a.name, a.nameTranslations, lang)),
        specialNote: note === '' ? null : note,
      },
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={
        <span className="flex items-center gap-2">
          <FoodTypeMark type={item.foodType} />
          <span lang={lang}>{name}</span>
        </span>
      }
      description={money(unit)}
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <Stepper
            value={quantity}
            onValueChange={setQuantity}
            display={format.number(quantity)}
            decrementLabel={t('order.options.fewer')}
            incrementLabel={t('order.options.more')}
          />
          <Button size="lg" disabled={problems.length > 0} onClick={add}>
            {t('order.options.add', { amount: format.money(total) })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {variants.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-semibold">{t('order.options.size')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {variants.map((v) => (
                <label
                  key={v.id}
                  className={cn(
                    'flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border px-3',
                    choice.variantId === v.id ? 'border-primary bg-accent' : 'border-input',
                  )}
                >
                  <input
                    type="radio"
                    name={`variant-${item.id}`}
                    className="size-5 accent-primary"
                    checked={choice.variantId === v.id}
                    onChange={() => setChoice((c) => ({ ...c, variantId: v.id }))}
                  />
                  <span className="flex-1" lang={lang}>
                    {localizedName(v.name, v.nameTranslations, lang)}
                  </span>
                  <span className="font-semibold tabular-nums">{money(v.price)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {groups.map((group) => {
          const picked = choice.addons[group.id] ?? [];
          const full = picked.length >= group.maxSelect;
          const short = picked.length < group.minSelect;
          const groupName = localizedName(group.name, group.nameTranslations, lang);
          return (
            <fieldset key={group.id} className="flex flex-col gap-1">
              <legend className="mb-1 font-semibold">
                <span lang={lang}>{groupName}</span>{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  {t('order.options.limits', { min: group.minSelect, max: group.maxSelect })}
                </span>
              </legend>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {group.addons.map((addon) => {
                  const on = picked.includes(addon.id);
                  return (
                    <Checkbox
                      key={addon.id}
                      checked={on}
                      disabled={!on && full}
                      onChange={(e) => toggleAddon(group.id, addon.id, e.target.checked)}
                      label={
                        <span className="flex flex-wrap gap-x-2">
                          <span lang={lang}>
                            {localizedName(addon.name, addon.nameTranslations, lang)}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {t('order.options.addonPrice', { price: money(addon.price) })}
                          </span>
                        </span>
                      }
                    />
                  );
                })}
              </div>
              {short && (
                <p className="text-sm text-state-reserved-fg">
                  {t('order.options.chooseAtLeast', { count: group.minSelect })}
                </p>
              )}
            </fieldset>
          );
        })}

        <NoteEditor quick={quick} onQuick={setQuick} free={free} onFree={setFree} />
      </div>
    </Dialog>
  );
}

/** Quick-note toggles (Less spicy, No onion, Jain) and a free-text note. */
export function NoteEditor({
  quick,
  onQuick,
  free,
  onFree,
}: {
  quick: readonly string[];
  onQuick: (quick: readonly string[]) => void;
  free: string;
  onFree: (free: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{t('order.note.label')}</legend>
      <div className="flex flex-wrap gap-2">
        {QUICK_NOTES.map((key) => {
          const text = t(`order.note.quick.${key}`);
          const on = quick.includes(text);
          return (
            <Button
              key={key}
              variant="outline"
              aria-pressed={on}
              onClick={() => onQuick(on ? quick.filter((q) => q !== text) : [...quick, text])}
            >
              {text}
            </Button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className="sr-only">{t('order.note.free')}</span>
        <Input
          value={free}
          maxLength={120}
          placeholder={t('order.note.free')}
          onChange={(e) => onFree(e.target.value)}
        />
      </label>
    </fieldset>
  );
}
