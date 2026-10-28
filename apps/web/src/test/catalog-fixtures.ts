import type {
  AddonGroup,
  Category,
  DiningTable,
  FloorArea,
  KitchenStation,
  MenuItem,
  MenuSnapshot,
} from '@restroos/contracts';

export const CAT_BIRYANI = 'c0000000-0000-4000-8000-000000000001';
export const CAT_BREADS = 'c0000000-0000-4000-8000-000000000002';
export const STATION_MAIN = 'd0000000-0000-4000-8000-000000000001';
export const ADDON_EXTRAS = 'a0000000-0000-4000-8000-000000000001';
export const ITEM_BIRYANI = 'b0000000-0000-4000-8000-000000000001';
export const ITEM_NAAN = 'b0000000-0000-4000-8000-000000000002';
export const VARIANT_FULL = 'e0000000-0000-4000-8000-000000000001';
export const VARIANT_HALF = 'e0000000-0000-4000-8000-000000000002';

export const categories: Category[] = [
  {
    id: CAT_BIRYANI,
    parentId: null,
    name: 'Biryani',
    nameTranslations: { hi: 'बिरयानी', bn: 'বিরিয়ানি' },
    color: '#F97316',
    sortOrder: 10,
    isActive: true,
    version: 1,
  },
  {
    id: CAT_BREADS,
    parentId: null,
    name: 'Breads',
    nameTranslations: {},
    color: null,
    sortOrder: 20,
    isActive: true,
    version: 1,
  },
];

export const stations: KitchenStation[] = [
  { id: STATION_MAIN, name: 'Main Kitchen', isActive: true, version: 1 },
];

export const addonGroups: AddonGroup[] = [
  {
    id: ADDON_EXTRAS,
    name: 'Extras',
    nameTranslations: {},
    minSelect: 0,
    maxSelect: 2,
    addons: [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        name: 'Raita',
        nameTranslations: {},
        price: 4000,
      },
      {
        id: 'a1000000-0000-4000-8000-000000000002',
        name: 'Extra egg',
        nameTranslations: {},
        price: 2500,
      },
    ],
    isActive: true,
    version: 1,
  },
];

export function makeItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: ITEM_BIRYANI,
    sku: 'BIR-CHK',
    name: 'Chicken Biryani',
    shortName: null,
    nameTranslations: { hi: 'चिकन बिरयानी', bn: 'চিকেন বিরিয়ানি' },
    description: null,
    descriptionTranslations: {},
    categoryId: CAT_BIRYANI,
    foodType: 'NON_VEG',
    basePrice: 32000,
    taxGroupId: null,
    hsnSacCode: null,
    kitchenStationId: STATION_MAIN,
    prepTimeSec: null,
    sortOrder: 0,
    variants: [
      { id: VARIANT_FULL, name: 'Full', nameTranslations: {}, price: 32000, sortOrder: 1 },
      { id: VARIANT_HALF, name: 'Half', nameTranslations: {}, price: 19000, sortOrder: 2 },
    ],
    addonGroupIds: [],
    isActive: true,
    isAvailable: true,
    version: 3,
    ...overrides,
  };
}

export const naan = makeItem({
  id: ITEM_NAAN,
  sku: 'BRD-NAAN',
  name: 'Butter Naan',
  nameTranslations: { hi: 'बटर नान' },
  categoryId: CAT_BREADS,
  foodType: 'VEG',
  basePrice: 6000,
  variants: [],
  version: 1,
});

export function makeSnapshot(items: MenuItem[] = [makeItem(), naan]): MenuSnapshot {
  return { version: 'v1', categories, items, addonGroups, kitchenStations: stations };
}

export const AREA_GROUND = 'f0000000-0000-4000-8000-000000000001';
export const TABLE_T1 = 'f1000000-0000-4000-8000-000000000001';
export const TABLE_T2 = 'f1000000-0000-4000-8000-000000000002';

export function makeTable(overrides: Partial<DiningTable> = {}): DiningTable {
  return {
    id: TABLE_T1,
    floorAreaId: AREA_GROUND,
    label: 'T1',
    seats: 4,
    shape: 'SQUARE',
    posX: 2,
    posY: 2,
    status: 'AVAILABLE',
    currentOrderId: null,
    openOrder: null,
    hasQr: false,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

export function makeFloor(tables: DiningTable[] = [makeTable()]): { areas: FloorArea[] } {
  return {
    areas: [{ id: AREA_GROUND, name: 'Ground', sortOrder: 10, isActive: true, version: 1, tables }],
  };
}
