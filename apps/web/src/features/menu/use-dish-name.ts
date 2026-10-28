import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { localizedName } from './localized-name';
import { useMenuSnapshot } from './menu-queries';

/**
 * Names a dish on an order or KOT in the current UI language, from the cached
 * menu. Falls back to the English names copied onto the order when the item or
 * variant is no longer on the menu.
 */
export function useDishName() {
  const { i18n } = useTranslation();
  const menu = useMenuSnapshot().data?.snapshot;
  return useCallback(
    (item: {
      menuItemId: string;
      variantId: string | null;
      name: string;
      variantName: string | null;
    }) => {
      const entry = menu?.items.find((m) => m.id === item.menuItemId);
      const variant = entry?.variants.find((v) => v.id === item.variantId);
      return {
        name: entry ? localizedName(item.name, entry.nameTranslations, i18n.language) : item.name,
        variantName:
          item.variantName !== null && variant
            ? localizedName(item.variantName, variant.nameTranslations, i18n.language)
            : item.variantName,
      };
    },
    [menu, i18n.language],
  );
}
