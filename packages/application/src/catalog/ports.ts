export type Translations = { hi?: string | undefined; bn?: string | undefined };
export type FoodType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' | 'NA';

export interface StationRecord {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
}

export interface CategoryRecord {
  id: string;
  parentId: string | null;
  name: string;
  nameTranslations: Translations;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface AddonRecord {
  id: string;
  name: string;
  nameTranslations: Translations;
  price: number;
}

export interface AddonGroupRecord {
  id: string;
  name: string;
  nameTranslations: Translations;
  minSelect: number;
  maxSelect: number;
  addons: AddonRecord[];
  isActive: boolean;
  version: number;
}

export interface VariantRecord {
  id: string;
  name: string;
  nameTranslations: Translations;
  price: number;
  sortOrder: number;
}

export interface MenuItemRecord {
  id: string;
  sku: string;
  name: string;
  shortName: string | null;
  nameTranslations: Translations;
  description: string | null;
  descriptionTranslations: Translations;
  categoryId: string;
  foodType: FoodType;
  basePrice: number;
  taxGroupId: string | null;
  hsnSacCode: string | null;
  kitchenStationId: string | null;
  prepTimeSec: number | null;
  sortOrder: number;
  variants: VariantRecord[];
  addonGroupIds: string[];
  isActive: boolean;
  /** Branch-level availability ("86"). */
  isAvailable: boolean;
  version: number;
}

/**
 * Versioned writes: `update*` stores `next` only if the stored version is
 * `next.version - 1`, otherwise throws VERSION_CONFLICT.
 */
export interface CatalogRepository {
  organizationId(): string;

  stations(branchId: string): StationRecord[];
  station(branchId: string, id: string): StationRecord | undefined;
  insertStation(branchId: string, record: StationRecord, at: Date): void;
  updateStation(branchId: string, record: StationRecord, at: Date): void;

  categories(): CategoryRecord[];
  category(id: string): CategoryRecord | undefined;
  insertCategory(record: CategoryRecord, at: Date): void;
  updateCategory(record: CategoryRecord, at: Date): void;
  activeItemCount(categoryId: string): number;

  addonGroups(): AddonGroupRecord[];
  addonGroup(id: string): AddonGroupRecord | undefined;
  insertAddonGroup(record: AddonGroupRecord, at: Date): void;
  updateAddonGroup(record: AddonGroupRecord, at: Date): void;

  items(branchId: string, includeInactive: boolean): MenuItemRecord[];
  item(branchId: string, id: string): MenuItemRecord | undefined;
  itemIdBySku(sku: string): string | undefined;
  insertItem(record: MenuItemRecord, actorId: string | null, at: Date): void;
  updateItem(record: MenuItemRecord, actorId: string | null, at: Date): void;
  setAvailability(branchId: string, itemId: string, isAvailable: boolean, at: Date): void;

  taxGroupIdByName(name: string): string | undefined;
  taxGroupExists(id: string): boolean;

  /** Changes whenever anything that ordering devices cache changes. */
  menuVersion(branchId: string): string;
}
