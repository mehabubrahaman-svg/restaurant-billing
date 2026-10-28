import type { AddonGroup, MenuItem, MenuSnapshot } from '@restroos/contracts';

/** The add-on groups an item offers, in the order the menu lists them (retired ones dropped). */
export function addonGroupsOf(item: MenuItem, menu: MenuSnapshot): AddonGroup[] {
  return item.addonGroupIds
    .map((id) => menu.addonGroups.find((g) => g.id === id))
    .filter((g): g is AddonGroup => g !== undefined && g.isActive && g.addons.length > 0);
}

/** Tapping such an item opens the options sheet instead of adding one straight away. */
export function hasOptions(item: MenuItem, menu: MenuSnapshot): boolean {
  return item.variants.length > 0 || addonGroupsOf(item, menu).length > 0;
}

/** Lowest price a guest can pay for the item (the cheapest variant, if any), paise. */
export function fromPrice(item: MenuItem): number {
  return item.variants.length === 0
    ? item.basePrice
    : Math.min(...item.variants.map((v) => v.price));
}

export interface OptionsChoice {
  readonly variantId: string | null;
  /** Add-on ids picked, per group id. */
  readonly addons: Readonly<Record<string, readonly string[]>>;
}

export type OptionsProblem =
  | { readonly kind: 'variant' }
  | { readonly kind: 'min'; readonly groupId: string; readonly min: number }
  | { readonly kind: 'max'; readonly groupId: string; readonly max: number };

/** What still stops "Add": a size not chosen, or a group outside its min/max. */
export function optionsProblems(
  item: MenuItem,
  groups: readonly AddonGroup[],
  choice: OptionsChoice,
): OptionsProblem[] {
  const problems: OptionsProblem[] = [];
  if (item.variants.length > 0 && !item.variants.some((v) => v.id === choice.variantId)) {
    problems.push({ kind: 'variant' });
  }
  for (const group of groups) {
    const picked = choice.addons[group.id]?.length ?? 0;
    if (picked < group.minSelect) {
      problems.push({ kind: 'min', groupId: group.id, min: group.minSelect });
    }
    if (picked > group.maxSelect) {
      problems.push({ kind: 'max', groupId: group.id, max: group.maxSelect });
    }
  }
  return problems;
}

/** One unit with its variant and add-ons, paise (integers only). */
export function unitPrice(
  item: MenuItem,
  groups: readonly AddonGroup[],
  choice: OptionsChoice,
): number {
  const variant = item.variants.find((v) => v.id === choice.variantId);
  let total = variant?.price ?? item.basePrice;
  for (const group of groups) {
    for (const id of choice.addons[group.id] ?? []) {
      total += group.addons.find((a) => a.id === id)?.price ?? 0;
    }
  }
  return total;
}

/** The default choice: the first variant (menus list the usual size first), and no add-ons. */
export function initialChoice(item: MenuItem): OptionsChoice {
  const first = [...item.variants].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return { variantId: first?.id ?? null, addons: {} };
}

/** Quick notes offered on the sheet; the text sent is the translated label. */
export const QUICK_NOTES = ['lessSpicy', 'noOnion', 'jain'] as const;
export type QuickNote = (typeof QUICK_NOTES)[number];

/** "Less spicy, Jain, extra lemon": quick notes first, then the free text; ≤ 140 characters. */
export function composeNote(quick: readonly string[], free: string): string {
  return [...quick, free.trim()]
    .filter((part) => part !== '')
    .join(', ')
    .slice(0, 140);
}
