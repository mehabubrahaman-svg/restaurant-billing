import { describe, expect, it } from 'vitest';
import {
  addonGroups,
  ADDON_EXTRAS,
  makeItem,
  makeSnapshot,
  naan,
  VARIANT_FULL,
  VARIANT_HALF,
} from '../../test/catalog-fixtures';
import {
  composeNote,
  fromPrice,
  hasOptions,
  initialChoice,
  optionsProblems,
  unitPrice,
} from './item-options';

const RAITA = addonGroups[0]!.addons[0]!.id;
const EGG = addonGroups[0]!.addons[1]!.id;
const biryani = makeItem({ addonGroupIds: [ADDON_EXTRAS] });
const required = [{ ...addonGroups[0]!, minSelect: 1, maxSelect: 1 }];

describe('item options', () => {
  it('knows which dishes need the sheet', () => {
    const menu = makeSnapshot();
    expect(hasOptions(biryani, menu)).toBe(true);
    expect(hasOptions(naan, menu)).toBe(false);
    expect(hasOptions(makeItem({ variants: [], addonGroupIds: [ADDON_EXTRAS] }), menu)).toBe(true);
    // A retired group doesn't count.
    expect(
      hasOptions(makeItem({ variants: [], addonGroupIds: [ADDON_EXTRAS] }), {
        ...menu,
        addonGroups: [{ ...addonGroups[0]!, isActive: false }],
      }),
    ).toBe(false);
  });

  it('starts on the first size and prices in paise', () => {
    expect(initialChoice(biryani)).toEqual({ variantId: VARIANT_FULL, addons: {} });
    expect(fromPrice(biryani)).toBe(19000);
    expect(
      unitPrice(biryani, addonGroups, {
        variantId: VARIANT_HALF,
        addons: { [ADDON_EXTRAS]: [RAITA, EGG] },
      }),
    ).toBe(19000 + 4000 + 2500);
  });

  it('reports a missing size and groups outside min/max', () => {
    expect(optionsProblems(biryani, required, { variantId: null, addons: {} })).toEqual([
      { kind: 'variant' },
      { kind: 'min', groupId: ADDON_EXTRAS, min: 1 },
    ]);
    expect(
      optionsProblems(biryani, required, {
        variantId: VARIANT_FULL,
        addons: { [ADDON_EXTRAS]: [RAITA, EGG] },
      }),
    ).toEqual([{ kind: 'max', groupId: ADDON_EXTRAS, max: 1 }]);
    expect(
      optionsProblems(biryani, required, {
        variantId: VARIANT_FULL,
        addons: { [ADDON_EXTRAS]: [RAITA] },
      }),
    ).toEqual([]);
  });

  it('joins quick notes and free text, capped at 140 characters', () => {
    expect(composeNote(['Less spicy', 'Jain'], '  extra lemon ')).toBe(
      'Less spicy, Jain, extra lemon',
    );
    expect(composeNote([], '')).toBe('');
    expect(composeNote([], 'x'.repeat(200))).toHaveLength(140);
  });
});
