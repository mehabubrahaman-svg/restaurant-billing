import type { QrMenu } from '@restroos/contracts';
import { Badge, Button, Checkbox, Crown, Dialog, Input, Stepper } from '@restroos/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newIdempotencyKey } from '../../api/client';
import { FoodTypeMark } from '../../features/menu/food-type';
import { localizedName } from '../../features/menu/localized-name';
import { StarScore } from '../../features/ratings/stars';
import { photoUrl } from '../../lib/dish-photos';
import { groupsOf, MAX_QUANTITY, type CartLine } from './cart';
import { useMoney, type Item, type Score } from './menu-parts';
import { splitDescription } from './menu-search';

/**
 * One dish, in full: a large photo, what it is, its facts (pieces, calories,
 * allergens, spice) as tags, then its size, add-ons, a note and how many.
 */
export function DishSheet({
  item,
  menu,
  popular,
  score,
  onAdd,
  onClose,
}: {
  item: Item;
  menu: QrMenu;
  popular: boolean;
  score?: Score | undefined;
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const lang = i18n.language;
  const groups = groupsOf(item, menu);
  const [variantId, setVariantId] = useState(item.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const variant = item.variants.find((v) => v.id === variantId);
  const addons = groups.flatMap((g) => g.addons).filter((a) => addonIds.includes(a.id));
  const unit = (variant?.price ?? item.price) + addons.reduce((n, a) => n + a.price, 0);
  const short = groups.filter((g) => {
    const picked = g.addons.filter((a) => addonIds.includes(a.id)).length;
    return picked < g.minSelect || picked > g.maxSelect;
  });
  const name = localizedName(item.name, item.nameTranslations, lang);
  const { lead, facts } = item.description
    ? splitDescription(localizedName(item.description, item.descriptionTranslations, lang))
    : { lead: '', facts: [] };

  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={t('common.close')}
      title={name}
      footer={
        item.isAvailable ? (
          <Button
            className="w-full sm:w-auto"
            disabled={short.length > 0}
            onClick={() =>
              onAdd({
                key: newIdempotencyKey(),
                item,
                variantId,
                addonIds,
                quantity,
                note: note.trim(),
                unit,
              })
            }
          >
            {t('qr.addWithTotal', { total: money(unit * quantity) })}
          </Button>
        ) : (
          <p className="font-medium text-muted-foreground">{t('qr.unavailable')}</p>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {item.imageId !== null && (
          <img
            src={photoUrl(item.imageId, 'full')}
            alt=""
            decoding="async"
            className="-mx-5 -mt-5 aspect-[4/3] w-[calc(100%+2.5rem)] max-w-none bg-muted object-cover"
          />
        )}
        {/* Focus starts here, not in the note box, so a phone keyboard doesn't cover the dish. */}
        <div data-autofocus tabIndex={-1} className="flex flex-col gap-2 outline-none">
          <div className="flex flex-wrap items-center gap-2">
            <FoodTypeMark type={item.foodType} size="sm" />
            {popular && (
              <Badge variant="warning" className="gap-1 text-xs font-semibold">
                <Crown aria-hidden="true" className="size-3.5" />
                {t('qr.bestseller')}
              </Badge>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 text-lg font-semibold tabular-nums">
            <span>{money(variant?.price ?? item.price)}</span>
            {score && <StarScore average={score.average} count={score.count} />}
          </p>
          {lead && <p className="break-words text-muted-foreground">{lead}</p>}
          {facts.length > 0 && (
            <ul aria-label={t('qr.facts')} className="flex flex-wrap gap-2">
              {facts.map((fact) => (
                <li key={fact} className="rounded-full bg-muted px-3 py-1 text-sm">
                  {fact}
                </li>
              ))}
            </ul>
          )}
        </div>
        {item.isAvailable && (
          <>
            {item.variants.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-semibold">{t('qr.size')}</legend>
                {item.variants.map((v) => (
                  <label
                    key={v.id}
                    className="flex min-h-touch items-center gap-3 rounded-lg px-2 has-checked:bg-primary/10"
                  >
                    <input
                      type="radio"
                      name="size"
                      className="size-5 accent-primary"
                      checked={variantId === v.id}
                      onChange={() => setVariantId(v.id)}
                    />
                    <span className="flex-1">
                      {localizedName(v.name, v.nameTranslations, lang)}
                    </span>
                    <span className="tabular-nums">{money(v.price)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {groups.map((g) => (
              <fieldset key={g.id} className="flex flex-col gap-1">
                <legend className="mb-1 font-semibold">
                  {localizedName(g.name, g.nameTranslations, lang)}
                  <span className="ms-2 text-sm font-normal text-muted-foreground">
                    {g.minSelect === g.maxSelect
                      ? t('qr.chooseExactly', { count: g.minSelect })
                      : t('qr.chooseUpTo', { count: g.maxSelect })}
                  </span>
                </legend>
                {g.addons.map((a) => (
                  <Checkbox
                    key={a.id}
                    label={`${localizedName(a.name, a.nameTranslations, lang)} · +${money(a.price)}`}
                    checked={addonIds.includes(a.id)}
                    onChange={(e) =>
                      setAddonIds((ids) =>
                        e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                      )
                    }
                  />
                ))}
              </fieldset>
            ))}
            <label className="flex flex-col gap-1.5">
              <span className="font-semibold">{t('qr.note')}</span>
              <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Stepper
              value={quantity}
              onValueChange={setQuantity}
              max={MAX_QUANTITY}
              decrementLabel={t('qr.less', { name })}
              incrementLabel={t('qr.more', { name })}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
