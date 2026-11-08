import type { QrMenu } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import { addLine, addPlain, quantities, setQuantity, subtotals, type CartLine } from './cart';

type Item = QrMenu['items'][number];

const item = (id: string, price: number, more: Partial<Item> = {}): Item => ({
  id,
  categoryId: 'cat',
  name: id,
  nameTranslations: {},
  description: null,
  descriptionTranslations: {},
  foodType: 'VEG',
  price,
  taxIncluded: true,
  variants: [],
  addonGroupIds: [],
  isAvailable: true,
  imageId: null,
  ...more,
});
const NAAN = item('naan', 6000);
const BIRYANI = item('biryani', 25000, {
  variants: [
    { id: 'half', name: 'Half', nameTranslations: {}, price: 25000 },
    { id: 'full', name: 'Full', nameTranslations: {}, price: 40000 },
  ],
});
const line = (
  it: Item,
  variantId: string | undefined,
  quantity: number,
  unit: number,
): CartLine => ({
  key: `${it.id}-${variantId ?? 'plain'}`,
  item: it,
  variantId,
  addonIds: [],
  quantity,
  note: '',
  unit,
});

describe('the guest’s order', () => {
  it('counts a plain dish up on one line and down to nothing', () => {
    let cart = setQuantity([], NAAN, 2);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ item: NAAN, variantId: undefined, quantity: 2, unit: 6000 });

    cart = setQuantity(cart, NAAN, 3);
    expect(cart.map((l) => l.quantity)).toEqual([3]);

    cart = setQuantity(cart, NAAN, 1);
    expect(cart.map((l) => l.quantity)).toEqual([1]);

    expect(setQuantity(cart, NAAN, 0)).toEqual([]);
  });

  it('one more of a dish with choices is one more of the way it was last chosen', () => {
    const cart = [line(BIRYANI, 'full', 1, 40000), line(BIRYANI, 'half', 1, 25000)];

    const more = setQuantity(cart, BIRYANI, 3);
    expect(more.map((l) => [l.variantId, l.quantity])).toEqual([
      ['full', 1],
      ['half', 2],
    ]);

    // Fewer comes off the most recent lines first.
    const fewer = setQuantity(more, BIRYANI, 1);
    expect(fewer.map((l) => [l.variantId, l.quantity])).toEqual([['full', 1]]);
    expect(setQuantity(fewer, BIRYANI, 0)).toEqual([]);
  });

  it('adds up what each dish comes to, however it was made', () => {
    let cart = addPlain([], NAAN);
    cart = addPlain(cart, NAAN);
    cart = addLine(cart, line(BIRYANI, 'full', 1, 40000));
    cart = addLine(cart, line(BIRYANI, 'half', 2, 25000));
    expect(quantities(cart)).toEqual(
      new Map([
        ['naan', 2],
        ['biryani', 3],
      ]),
    );
    expect(subtotals(cart)).toEqual(
      new Map([
        ['naan', 12000],
        ['biryani', 90000],
      ]),
    );
  });
});
