import { z } from 'zod';
import { IdSchema, PaiseSchema, patchSchema } from './common';

/** Customer-facing names in other languages: { hi: "…", bn: "…" }. English is the main `name`. */
export const TranslationsSchema = z
  .object({ hi: z.string().trim().max(200).optional(), bn: z.string().trim().max(200).optional() })
  .strict();
export type Translations = z.infer<typeof TranslationsSchema>;

export const FoodTypeSchema = z.enum(['VEG', 'NON_VEG', 'EGG', 'VEGAN', 'NA']);
const Name = z.string().trim().min(1).max(120);
const Version = z.number().int();

// ---- kitchen stations --------------------------------------------------------
export const KitchenStationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  isActive: z.boolean(),
  version: Version,
});
export type KitchenStation = z.infer<typeof KitchenStationSchema>;
export const SaveKitchenStationRequestSchema = z.object({ name: Name });
export const UpdateKitchenStationRequestSchema = z.object({
  version: Version,
  name: Name.optional(),
  isActive: z.boolean().optional(),
});

// ---- categories -----------------------------------------------------------------
export const CategorySchema = z.object({
  id: IdSchema,
  parentId: IdSchema.nullable(),
  name: z.string(),
  nameTranslations: TranslationsSchema,
  /** Tile colour on the order pad, "#RRGGBB". */
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  version: Version,
});
export type Category = z.infer<typeof CategorySchema>;
export const SaveCategoryRequestSchema = z.object({
  name: Name,
  nameTranslations: TranslationsSchema.default({}),
  parentId: IdSchema.nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  sortOrder: z.number().int().default(0),
});
export const UpdateCategoryRequestSchema = patchSchema(SaveCategoryRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

// ---- add-on groups -------------------------------------------------------------
export const AddonSchema = z.object({
  id: IdSchema,
  name: z.string(),
  nameTranslations: TranslationsSchema,
  price: PaiseSchema.nonnegative(),
});
export const AddonGroupSchema = z.object({
  id: IdSchema,
  name: z.string(),
  nameTranslations: TranslationsSchema,
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().positive(),
  addons: z.array(AddonSchema),
  isActive: z.boolean(),
  version: Version,
});
export type AddonGroup = z.infer<typeof AddonGroupSchema>;
export const SaveAddonGroupRequestSchema = z.object({
  name: Name,
  nameTranslations: TranslationsSchema.default({}),
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).default(1),
  /** The full list: addons not listed are retired. Keep `id` to update an existing one. */
  addons: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: Name,
        nameTranslations: TranslationsSchema.default({}),
        price: PaiseSchema.nonnegative(),
      }),
    )
    .min(1)
    .max(50),
});
export const UpdateAddonGroupRequestSchema = patchSchema(SaveAddonGroupRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

// ---- menu items ------------------------------------------------------------------
export const VariantSchema = z.object({
  id: IdSchema,
  name: z.string(),
  nameTranslations: TranslationsSchema,
  price: PaiseSchema.nonnegative(),
  sortOrder: z.number().int(),
});

export const MenuItemSchema = z.object({
  id: IdSchema,
  sku: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  nameTranslations: TranslationsSchema,
  description: z.string().nullable(),
  descriptionTranslations: TranslationsSchema,
  categoryId: IdSchema,
  foodType: FoodTypeSchema,
  /** Price before tax unless the item's tax group is tax-inclusive. */
  basePrice: PaiseSchema.nonnegative(),
  taxGroupId: IdSchema.nullable(),
  hsnSacCode: z.string().nullable(),
  kitchenStationId: IdSchema.nullable(),
  prepTimeSec: z.number().int().positive().nullable(),
  sortOrder: z.number().int(),
  variants: z.array(VariantSchema),
  addonGroupIds: z.array(IdSchema),
  /** Retired items stay for history but can't be ordered. */
  isActive: z.boolean(),
  /** Branch-level "86": temporarily out of stock in this branch. */
  isAvailable: z.boolean(),
  version: Version,
});
export type MenuItem = z.infer<typeof MenuItemSchema>;
export const MenuItemsResponseSchema = z.object({ data: z.array(MenuItemSchema) });
export type MenuItemsResponse = z.infer<typeof MenuItemsResponseSchema>;

const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, 'up to 32 letters, digits, - or _');

export const SaveMenuItemRequestSchema = z.object({
  sku: SkuSchema,
  name: Name,
  shortName: z.string().trim().max(24).nullable().default(null),
  nameTranslations: TranslationsSchema.default({}),
  description: z.string().trim().max(500).nullable().default(null),
  descriptionTranslations: TranslationsSchema.default({}),
  categoryId: IdSchema,
  foodType: FoodTypeSchema,
  basePrice: PaiseSchema.nonnegative(),
  taxGroupId: IdSchema.nullable().default(null),
  hsnSacCode: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/)
    .nullable()
    .default(null),
  kitchenStationId: IdSchema.nullable().default(null),
  prepTimeSec: z
    .number()
    .int()
    .min(30)
    .max(4 * 3600)
    .nullable()
    .default(null),
  sortOrder: z.number().int().default(0),
  /** The full list: variants not listed are retired. Keep `id` to update one. */
  variants: z
    .array(
      z.object({
        id: IdSchema.optional(),
        name: Name,
        nameTranslations: TranslationsSchema.default({}),
        price: PaiseSchema.nonnegative(),
      }),
    )
    .max(10)
    .default([]),
  addonGroupIds: z.array(IdSchema).max(10).default([]),
});
export type SaveMenuItemRequest = z.input<typeof SaveMenuItemRequestSchema>;
export const UpdateMenuItemRequestSchema = patchSchema(SaveMenuItemRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});
export const SetAvailabilityRequestSchema = z.object({ isAvailable: z.boolean() });

// ---- menu snapshot (what ordering devices cache) ------------------------------
export const MenuSnapshotSchema = z.object({
  /** Changes whenever anything on the menu changes; also sent as the ETag. */
  version: z.string(),
  categories: z.array(CategorySchema),
  items: z.array(MenuItemSchema),
  addonGroups: z.array(AddonGroupSchema),
  kitchenStations: z.array(KitchenStationSchema),
});
export type MenuSnapshot = z.infer<typeof MenuSnapshotSchema>;

// ---- CSV import -----------------------------------------------------------------
/**
 * Columns (header row required, any order): sku, name, category, price,
 * food_type, tax_group, kitchen_station, short_name, name_hi, name_bn,
 * hsn_sac, description. Rows are matched by sku: existing items are updated,
 * new ones created. Unknown categories and kitchen stations are created;
 * tax groups must already exist (by name). Price in rupees, e.g. 249.50.
 */
export const MenuImportRequestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(true),
});
export const MenuImportResponseSchema = z.object({
  dryRun: z.boolean(),
  rows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  createdCategories: z.array(z.string()),
  createdStations: z.array(z.string()),
  errors: z.array(
    z.object({ row: z.number().int(), column: z.string().optional(), message: z.string() }),
  ),
});
export type MenuImportResponse = z.infer<typeof MenuImportResponseSchema>;

export const CategoriesResponseSchema = z.object({ data: z.array(CategorySchema) });
export const KitchenStationsResponseSchema = z.object({ data: z.array(KitchenStationSchema) });
export const AddonGroupsResponseSchema = z.object({ data: z.array(AddonGroupSchema) });
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export type KitchenStationsResponse = z.infer<typeof KitchenStationsResponseSchema>;
export type AddonGroupsResponse = z.infer<typeof AddonGroupsResponseSchema>;
