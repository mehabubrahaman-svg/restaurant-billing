import type { MenuItem } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import { emptyVariant, formToBody, itemToForm, type ItemForm } from './item-form';

const CAT = '11111111-1111-4111-8111-1111111111c1';
const V_FULL = '11111111-1111-4111-8111-1111111111f1';
const V_HALF = '11111111-1111-4111-8111-1111111111f2';
const ADDON = '11111111-1111-4111-8111-1111111111a1';

const biryani: MenuItem = {
  id: '11111111-1111-4111-8111-1111111111b1',
  sku: 'BIR-CHK',
  name: 'Chicken Biryani',
  shortName: 'Chk Biryani',
  nameTranslations: { hi: 'चिकन बिरयानी', bn: 'চিকেন বিরিয়ানি' },
  description: null,
  descriptionTranslations: {},
  categoryId: CAT,
  foodType: 'NON_VEG',
  basePrice: 32000,
  taxGroupId: null,
  hsnSacCode: '996331',
  kitchenStationId: null,
  prepTimeSec: 900,
  sortOrder: 1,
  variants: [
    { id: V_HALF, name: 'Half', nameTranslations: {}, price: 19000, sortOrder: 2 },
    { id: V_FULL, name: 'Full', nameTranslations: { hi: 'फुल' }, price: 32000, sortOrder: 1 },
  ],
  addonGroupIds: [ADDON],
  isActive: true,
  isAvailable: true,
  version: 4,
};

function valid(form: ItemForm) {
  const result = formToBody(form);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.body;
}

describe('item form', () => {
  it('round-trips an item, keeping variant ids in their order', () => {
    const form = itemToForm(biryani);
    expect(form.price).toBe('320.00');
    expect(form.prepMinutes).toBe('15');
    expect(form.variants.map((v) => v.name)).toEqual(['Full', 'Half']);
    const body = valid(form);
    expect(body).toMatchObject({
      sku: 'BIR-CHK',
      basePrice: 32000,
      prepTimeSec: 900,
      hsnSacCode: '996331',
      nameTranslations: { hi: 'चिकन बिरयानी', bn: 'চিকেন বিরিয়ানি' },
      addonGroupIds: [ADDON],
    });
    expect(body.variants).toEqual([
      { id: V_FULL, name: 'Full', nameTranslations: { hi: 'फुल' }, price: 32000 },
      { id: V_HALF, name: 'Half', nameTranslations: {}, price: 19000 },
    ]);
  });

  it('parses prices as exact paise, with ₹, grouping and Indic digits', () => {
    const form = itemToForm(biryani);
    expect(valid({ ...form, price: '249.5' }).basePrice).toBe(24950);
    expect(valid({ ...form, price: '₹1,249.99' }).basePrice).toBe(124999);
    expect(valid({ ...form, price: '০.১০' }).basePrice).toBe(10);
    for (const bad of ['', '12.345', '-5', 'abc']) {
      const result = formToBody({ ...form, price: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.fields.price).toBe('validation.amount');
    }
  });

  it('sends removed variants by leaving them out, and new ones without an id', () => {
    const form = itemToForm(biryani);
    const added = { ...emptyVariant(), name: 'Family pack', price: '899' };
    const body = valid({ ...form, variants: [form.variants[0]!, added] });
    expect(body.variants).toEqual([
      { id: V_FULL, name: 'Full', nameTranslations: { hi: 'फुल' }, price: 32000 },
      { name: 'Family pack', nameTranslations: {}, price: 89900 },
    ]);
  });

  it('reports a bad variant row by its key', () => {
    const form = itemToForm(biryani);
    const bad = { ...emptyVariant(), name: '', price: '1.234' };
    const result = formToBody({ ...form, variants: [...form.variants, bad] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.variants[bad.key]).toEqual({
        name: 'menu.item.errors.name',
        price: 'validation.amount',
      });
    }
  });

  it('checks SKU, HSN/SAC, prep time and the category', () => {
    const result = formToBody({
      ...itemToForm(null),
      sku: 'bad sku!',
      name: 'Masala Chai',
      price: '30',
      hsnSac: '12',
      prepMinutes: '0',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.fields).toEqual({
        sku: 'menu.item.errors.sku',
        hsnSac: 'menu.item.errors.hsn',
        prepMinutes: 'menu.item.errors.prep',
        categoryId: 'menu.item.errors.category',
      });
    }
  });

  it('upper-cases the SKU and blanks optional fields to null', () => {
    const body = valid({
      ...itemToForm(null, CAT),
      sku: ' chai-01 ',
      name: 'Masala Chai',
      price: '30',
    });
    expect(body).toMatchObject({
      sku: 'CHAI-01',
      shortName: null,
      description: null,
      taxGroupId: null,
      kitchenStationId: null,
      prepTimeSec: null,
      variants: [],
    });
  });
});
