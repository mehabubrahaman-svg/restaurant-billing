import type { QrMenu } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import {
  editDistance,
  fold,
  matchRanges,
  searchMenu,
  sound,
  splitDescription,
} from './menu-search';

const CAT_MAIN = '0d100000-0000-4000-8000-000000000001';
const CAT_DRINK = '0d100000-0000-4000-8000-000000000002';
let n = 0;
const item = (
  name: string,
  more: Partial<QrMenu['items'][number]> = {},
): QrMenu['items'][number] => ({
  id: `0d200000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  categoryId: CAT_MAIN,
  name,
  nameTranslations: {},
  description: null,
  descriptionTranslations: {},
  foodType: 'VEG',
  price: 10000,
  taxIncluded: false,
  imageId: null,
  variants: [],
  addonGroupIds: [],
  isAvailable: true,
  ...more,
});
const paneer = item('Paneer Makhani', { nameTranslations: { hi: 'पनीर मखनी', bn: 'পনির মাখনি' } });
const biryani = item('Chicken Biryani', {
  foodType: 'NON_VEG',
  variants: [
    {
      id: '0d300000-0000-4000-8000-000000000001',
      name: 'Half',
      nameTranslations: {},
      price: 22000,
    },
  ],
});
const butterChicken = item('Butter Chicken', {
  foodType: 'NON_VEG',
  description: 'Creamy tomato gravy.',
});
const naan = item('Butter Naan');
const lassi = item('Lassi', {
  categoryId: CAT_DRINK,
  description: 'A cold, creamy curd drink.',
  descriptionTranslations: { bn: 'একটি ঠান্ডা, ক্রিমি দইয়ের পানীয়।' },
});
const MENU: QrMenu = {
  branchName: 'Baobab',
  tableLabel: 'T1',
  categories: [
    { id: CAT_MAIN, name: 'Mains', nameTranslations: { bn: 'প্রধান' }, sortOrder: 1 },
    { id: CAT_DRINK, name: 'Beverages', nameTranslations: { hi: 'पेय' }, sortOrder: 2 },
  ],
  items: [paneer, biryani, butterChicken, naan, lassi],
  addonGroups: [],
  popularItemIds: [],
  ratings: [],
};
const names = (q: string) => searchMenu(MENU.items, MENU, q).map((i) => i.name);

describe('menu search', () => {
  it('folds case, accents and punctuation, and keeps Indic vowel signs', () => {
    expect(fold('  Crème-Brûlée!! ')).toBe('creme brulee');
    expect(fold('পনির মাখনি')).toBe('পনির মাখনি');
  });

  it('hears romanised spellings alike', () => {
    expect(sound('paneer')).toBe(sound('panir'));
    expect(sound('tikka')).toBe(sound('tika'));
    expect(sound('chiken')).toBe(sound('chicken'));
    expect(editDistance('biriyani', 'biryani', 1)).toBe(1);
    expect(editDistance('naan', 'nana', 1)).toBe(1);
    expect(editDistance('lassi', 'pizza', 2)).toBe(3);
  });

  it('finds dishes by name, start of a word, near spelling, script or category', () => {
    expect(names('paneer')).toEqual(['Paneer Makhani']);
    expect(names('pan')).toEqual(['Paneer Makhani']);
    expect(names('panir')).toEqual(['Paneer Makhani']);
    expect(names('biriyani')).toEqual(['Chicken Biryani']);
    expect(names('chiken')).toEqual(['Chicken Biryani', 'Butter Chicken']);
    expect(names('পনির')).toEqual(['Paneer Makhani']);
    expect(names('पनीर')).toEqual(['Paneer Makhani']);
    expect(names('beverages')).toEqual(['Lassi']);
    expect(names('পানীয়')).toEqual(['Lassi']);
    expect(names('half')).toEqual(['Chicken Biryani']);
  });

  it('needs every word, and puts a name hit before a description hit', () => {
    expect(names('butter chicken')).toEqual(['Butter Chicken']);
    expect(names('butter')).toEqual(['Butter Chicken', 'Butter Naan']);
    // "creamy" is in Lassi's and Butter Chicken's descriptions only.
    expect(names('creamy')).toEqual(['Butter Chicken', 'Lassi']);
    expect(names('pizza')).toEqual([]);
    expect(names('   ')).toHaveLength(5);
  });

  it('marks where the words are in a name', () => {
    expect(matchRanges('Butter Chicken', 'chick butter')).toEqual([
      [0, 6],
      [7, 12],
    ]);
    expect(matchRanges('Naan', 'xyz')).toEqual([]);
  });

  it('splits a description into its line and its facts', () => {
    expect(
      splitDescription(
        'Soft steamed chicken dumplings. 6 pieces · 240 kcal · Contains gluten, soy · Medium spicy',
      ),
    ).toEqual({
      lead: 'Soft steamed chicken dumplings.',
      facts: ['6 pieces', '240 kcal', 'Contains gluten, soy', 'Medium spicy'],
    });
    expect(splitDescription('মাখন মাখানো নান রুটি। 1 পিস · 240 কিলো ক্যাল')).toEqual({
      lead: 'মাখন মাখানো নান রুটি।',
      facts: ['1 পিস', '240 কিলো ক্যাল'],
    });
    expect(splitDescription('Just a line.')).toEqual({ lead: 'Just a line.', facts: [] });
  });
});
