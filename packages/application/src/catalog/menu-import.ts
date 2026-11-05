import { DomainError, Money } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type { CatalogService, ItemInput } from './catalog-service';
import { parseCsv } from './csv';
import type { CatalogRepository, FoodType, MenuItemRecord, Translations } from './ports';

export type ImportAction = 'create' | 'update' | 'unchanged';
/** What happens to an item's photo: a new one, the one it has, removed, or none. */
export type ImportImage = 'set' | 'keep' | 'remove' | 'none';

export interface ImportIssue {
  row: number;
  column?: string;
  message: string;
}

export interface ImportRowPlan {
  row: number;
  sku: string;
  name: string;
  action: ImportAction;
  image: ImportImage;
  /** The uploaded file the photo comes from, when `image` is `set`. */
  imageFile: string | null;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  createdCategories: string[];
  createdStations: string[];
  /** Items not in the sheet that `retireMissing` takes off the menu. */
  retired: { sku: string; name: string }[];
  items: ImportRowPlan[];
  errors: ImportIssue[];
  /** Worth a look, but nothing stops the import (an uploaded photo no row uses). */
  warnings: ImportIssue[];
}

export interface MenuImportInput {
  /** The sheet, header row first (from CSV or from an Excel workbook's first sheet). */
  table: string[][];
  dryRun: boolean;
  /**
   * Uploaded photos by file name. The value is the media id, or null in a
   * preview, before the photos are uploaded.
   */
  images: Readonly<Record<string, string | null>>;
  /** Take active items that aren't in the sheet off the menu (a full-menu sync). */
  retireMissing: boolean;
}

/** Sheet columns. Headers are matched case-insensitively; spaces count as underscores. */
export const MENU_IMPORT_COLUMNS = [
  'sku',
  'name',
  'category',
  'price',
  'food_type',
  'tax_group',
  'kitchen_station',
  'short_name',
  'name_hi',
  'name_bn',
  'hsn_sac',
  'description',
  'description_hi',
  'description_bn',
  'variants',
  'addon_groups',
  'prep_time_min',
  'image',
  'active',
] as const;
const REQUIRED = ['sku', 'name', 'category', 'price'] as const;
const KNOWN = new Set<string>(MENU_IMPORT_COLUMNS);
/** In an optional column, this clears the value (an empty cell keeps it). */
export const CLEAR = '-';

const FOOD_TYPES: Record<string, FoodType> = {
  veg: 'VEG',
  'non-veg': 'NON_VEG',
  non_veg: 'NON_VEG',
  nonveg: 'NON_VEG',
  'non veg': 'NON_VEG',
  egg: 'EGG',
  vegan: 'VEGAN',
  na: 'NA',
};
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);
const MAX_ROWS = 5000;
const MAX_VARIANTS = 10;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i;
const MEDIA_ID = /^[0-9a-f]{64}$/;

/** "Half:180 | Full:320" → [{ name: 'Half', price: 18000 }, …] in paise. */
export function parseVariants(cell: string): { name: string; price: number }[] {
  return cell
    .split(/[|;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = Math.max(part.lastIndexOf(':'), part.lastIndexOf('='));
      if (at <= 0) throw new Error(`"${part}" needs a name and a price, like Half:180`);
      const name = part.slice(0, at).trim();
      if (name.length > 40) throw new Error(`"${name}" is longer than 40 characters`);
      let price: number;
      try {
        price = Money.ofRupees(part.slice(at + 1).trim()).paise;
      } catch {
        throw new Error(`"${part}": the price must be a rupee amount like 180 or 180.50`);
      }
      if (price < 0) throw new Error(`"${part}": the price can't be negative`);
      return { name, price };
    });
}

/** "dishes/Paneer Tikka.JPG" → "paneer tikka.jpg"; "PNR-TKA.webp" → stem "pnr-tka". */
export function fileKey(name: string): { full: string; stem: string } {
  const base = (name.split(/[\\/]/).pop() ?? name).trim().toLowerCase();
  return { full: base, stem: base.replace(/\.[^.]+$/, '') };
}

interface Plan {
  rowNumber: number;
  existing: MenuItemRecord | undefined;
  input: ItemInput;
  isActive: boolean;
  category: string;
  station: string | null;
  image: ImportImage;
  imageFile: string | null;
}

/**
 * Bulk menu upload from a spreadsheet, with dish photos. Every row is checked
 * first, and nothing is written if any row is wrong, so a half-imported menu
 * can't happen. Rows are matched by SKU. An empty optional cell keeps what
 * the item has (its variants, add-ons, photo); `-` clears it.
 */
export class MenuImporter {
  constructor(
    private readonly d: {
      catalog: CatalogRepository;
      catalogService: CatalogService;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
      media: { exists(id: string): boolean };
    },
  ) {}

  /** The original CSV entry point. */
  run(csv: string, dryRun: boolean, ctx: CommandContext): ImportResult {
    let table: string[][];
    try {
      table = parseCsv(csv);
    } catch (error) {
      throw new DomainError('CSV_INVALID', (error as Error).message);
    }
    return this.import({ table, dryRun, images: {}, retireMissing: false }, ctx);
  }

  import(input: MenuImportInput, ctx: CommandContext): ImportResult {
    const { table, dryRun } = input;
    const result: ImportResult = {
      dryRun,
      rows: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      createdCategories: [],
      createdStations: [],
      retired: [],
      items: [],
      errors: [],
      warnings: [],
    };
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    for (const column of REQUIRED) {
      if (!header.includes(column))
        result.errors.push({ row: 1, column, message: `missing column "${column}"` });
    }
    header.forEach((column, i) => {
      if (column && !KNOWN.has(column))
        result.errors.push({ row: 1, column, message: `unknown column "${column}"` });
      if (column && header.indexOf(column) !== i)
        result.errors.push({ row: 1, column, message: `column "${column}" appears twice` });
    });
    const body = table.slice(1).filter((cells) => cells.some((c) => c.trim() !== ''));
    if (body.length > MAX_ROWS)
      result.errors.push({ row: 1, message: `at most ${MAX_ROWS} rows per import` });
    if (body.length === 0 && result.errors.length === 0)
      result.errors.push({ row: 2, message: 'the sheet has no items' });
    if (result.errors.length > 0) return result;

    // Uploaded photos, by full file name and by name without the extension (for SKU matching).
    const files = new Map<string, { name: string; id: string | null }>();
    const stems = new Map<string, string>();
    for (const [name, id] of Object.entries(input.images)) {
      if (id !== null && !this.d.media.exists(id)) {
        throw new DomainError('IMAGE_NOT_FOUND', `photo ${name} isn't uploaded`);
      }
      if (id === null && !dryRun) {
        throw new DomainError('VALIDATION_FAILED', `upload ${name} before importing`);
      }
      const key = fileKey(name);
      files.set(key.full, { name, id });
      stems.set(key.stem, key.full);
    }
    const usedFiles = new Set<string>();

    const allCategories = this.d.catalog.categories().filter((c) => c.isActive);
    const categories = new Map(allCategories.map((c) => [c.name.toLowerCase(), c.id]));
    const categoryName = new Map(allCategories.map((c) => [c.id, c.name.toLowerCase()]));
    const allStations = this.d.catalog.stations(ctx.branchId).filter((s) => s.isActive);
    const stations = new Map(allStations.map((s) => [s.name.toLowerCase(), s.id]));
    const addonGroups = new Map(
      this.d.catalog
        .addonGroups()
        .filter((g) => g.isActive)
        .map((g) => [g.name.toLowerCase(), g.id]),
    );
    const seenSkus = new Map<string, number>();
    const planned: Plan[] = [];

    body.forEach((cells, index) => {
      const rowNumber = table.indexOf(cells) + 1;
      result.rows += 1;
      const get = (column: string) => {
        const i = header.indexOf(column);
        return i < 0 ? '' : (cells[i] ?? '').trim();
      };
      const fail = (column: string, message: string) =>
        result.errors.push({ row: rowNumber, column, message });
      /** Optional text: empty keeps `current`, `-` clears it. */
      const optional = (column: string, current: string | null) => {
        const value = get(column);
        return value === CLEAR ? null : value || current;
      };

      const sku = get('sku').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(sku)) fail('sku', 'up to 32 letters, digits, - or _');
      else if (seenSkus.has(sku)) fail('sku', `same SKU as row ${seenSkus.get(sku)}`);
      else seenSkus.set(sku, rowNumber);

      const name = get('name');
      if (!name || name.length > 120) fail('name', 'required, at most 120 characters');
      const category = get('category');
      if (!category) fail('category', 'required');
      else if (category.length > 60) fail('category', 'at most 60 characters');

      let price = 0;
      try {
        price = Money.ofRupees(get('price')).paise;
        if (price < 0) fail('price', 'cannot be negative');
      } catch {
        fail('price', 'a rupee amount like 249 or 249.50');
      }

      const foodRaw = get('food_type').toLowerCase();
      if (foodRaw && !FOOD_TYPES[foodRaw]) fail('food_type', 'veg, non-veg, egg, vegan or na');

      const taxName = get('tax_group');
      const taxGroupId = taxName ? this.d.catalog.taxGroupIdByName(taxName) : undefined;
      if (taxName && !taxGroupId) fail('tax_group', `no tax group named "${taxName}"`);

      const hsn = get('hsn_sac');
      if (hsn && hsn !== CLEAR && !/^\d{4,8}$/.test(hsn)) fail('hsn_sac', '4 to 8 digits');
      const shortName = get('short_name');
      if (shortName.length > 24) fail('short_name', 'at most 24 characters');

      const existingId = sku ? this.d.catalog.itemIdBySku(sku) : undefined;
      const existing = existingId ? this.d.catalog.item(ctx.branchId, existingId) : undefined;
      // Empty keeps what the dish is (a short sheet of prices mustn't make
      // non-veg dishes veg); a new dish without one is veg.
      const foodType = (foodRaw ? FOOD_TYPES[foodRaw] : undefined) ?? existing?.foodType ?? 'VEG';

      const translated = (current: Translations | undefined, hi: string, bn: string) => {
        const next: Translations = { ...(current ?? {}) };
        for (const [lang, value] of [
          ['hi', get(hi)],
          ['bn', get(bn)],
        ] as const) {
          if (value === CLEAR) delete next[lang];
          else if (value) next[lang] = value;
        }
        return next;
      };

      let prepTimeSec = existing?.prepTimeSec ?? null;
      const prep = get('prep_time_min');
      if (prep === CLEAR) prepTimeSec = null;
      else if (prep) {
        if (!/^\d{1,3}$/.test(prep) || Number(prep) < 1 || Number(prep) > 240)
          fail('prep_time_min', 'whole minutes, 1 to 240');
        else prepTimeSec = Number(prep) * 60;
      }

      // Empty keeps the dish on or off the menu as it is; a new dish goes on.
      let isActive = existing?.isActive ?? true;
      const active = get('active').toLowerCase();
      if (active && !YES.has(active) && !NO.has(active)) fail('active', 'yes or no');
      else if (NO.has(active)) isActive = false;
      else if (YES.has(active)) isActive = true;

      // Variants: keep the ids of sizes that keep their name, so old bills still point at them.
      let variants: ItemInput['variants'] = (existing?.variants ?? []).map((v) => ({ ...v }));
      const variantCell = get('variants');
      if (variantCell === CLEAR) variants = [];
      else if (variantCell) {
        try {
          const parsed = parseVariants(variantCell);
          const names = parsed.map((v) => v.name.toLowerCase());
          if (new Set(names).size !== names.length) fail('variants', 'two sizes with one name');
          else if (parsed.length > MAX_VARIANTS) fail('variants', `at most ${MAX_VARIANTS} sizes`);
          variants = parsed.map((v) => {
            const same = existing?.variants.find(
              (e) => e.name.toLowerCase() === v.name.toLowerCase(),
            );
            return {
              ...(same && { id: same.id }),
              name: v.name,
              nameTranslations: same?.nameTranslations ?? {},
              price: v.price,
            };
          });
        } catch (error) {
          fail('variants', (error as Error).message);
        }
      }

      let addonGroupIds = existing?.addonGroupIds ?? [];
      const addonCell = get('addon_groups');
      if (addonCell === CLEAR) addonGroupIds = [];
      else if (addonCell) {
        const names = addonCell
          .split(/[|;\n]/)
          .map((n) => n.trim())
          .filter(Boolean);
        const missing = names.filter((n) => !addonGroups.has(n.toLowerCase()));
        if (missing.length > 0)
          fail('addon_groups', `no add-on group named ${missing.map((n) => `"${n}"`).join(', ')}`);
        else addonGroupIds = [...new Set(names.map((n) => addonGroups.get(n.toLowerCase())!))];
      }

      // The photo: a named file, an existing media id, `-`, or a file named after the SKU.
      let imageId: string | null = existing?.imageId ?? null;
      let image: ImportImage = imageId ? 'keep' : 'none';
      let imageFile: string | null = null;
      const imageCell = get('image');
      const useFile = (full: string) => {
        const file = files.get(full)!;
        usedFiles.add(full);
        imageFile = file.name;
        if (file.id !== null && file.id === existing?.imageId) {
          image = 'keep';
        } else {
          image = 'set';
          imageId = file.id;
        }
      };
      if (imageCell === CLEAR) {
        image = existing?.imageId ? 'remove' : 'none';
        imageId = null;
      } else if (imageCell && MEDIA_ID.test(imageCell.toLowerCase())) {
        if (!this.d.media.exists(imageCell.toLowerCase()))
          fail('image', 'no such photo on the Hub');
        else if (imageCell.toLowerCase() !== existing?.imageId) {
          image = 'set';
          imageId = imageCell.toLowerCase();
        }
      } else if (imageCell) {
        const key = fileKey(imageCell);
        const full = files.has(key.full) ? key.full : stems.get(key.stem);
        if (full !== undefined && (files.has(key.full) || !IMAGE_EXT.test(key.full))) useFile(full);
        else fail('image', `"${imageCell}" isn't among the uploaded photos`);
      } else if (sku && stems.has(sku.toLowerCase())) {
        useFile(stems.get(sku.toLowerCase())!);
      }

      const station = get('kitchen_station') || null;
      const hsnSacCode = hsn === CLEAR ? null : hsn || existing?.hsnSacCode || null;
      planned.push({
        rowNumber,
        existing,
        category,
        station,
        isActive,
        image,
        imageFile,
        input: {
          sku,
          name,
          shortName: optional('short_name', existing?.shortName ?? null),
          nameTranslations: translated(existing?.nameTranslations, 'name_hi', 'name_bn'),
          description: optional('description', existing?.description ?? null),
          descriptionTranslations: translated(
            existing?.descriptionTranslations,
            'description_hi',
            'description_bn',
          ),
          categoryId: '',
          foodType,
          basePrice: price,
          taxGroupId: taxName ? (taxGroupId ?? null) : (existing?.taxGroupId ?? null),
          hsnSacCode,
          kitchenStationId: null,
          prepTimeSec,
          imageId,
          sortOrder: existing?.sortOrder ?? index,
          variants,
          addonGroupIds,
        },
      });
    });

    for (const [full, file] of files) {
      if (!usedFiles.has(full))
        result.warnings.push({
          row: 1,
          column: 'image',
          message: `${file.name} isn't used by any row`,
        });
    }

    const newCategories = dedupeCaseInsensitive(
      planned.map((p) => p.category).filter((c) => c && !categories.has(c.toLowerCase())),
    );
    const newStations = dedupeCaseInsensitive(
      planned
        .map((p) => p.station)
        .filter((s): s is string => !!s && !stations.has(s.toLowerCase())),
    );
    result.createdCategories = newCategories;
    result.createdStations = newStations;

    for (const p of planned) {
      const action: ImportAction = !p.existing
        ? 'create'
        : unchanged(p, p.existing, categoryName, stations)
          ? 'unchanged'
          : 'update';
      result[action === 'create' ? 'created' : action === 'update' ? 'updated' : 'unchanged'] += 1;
      result.items.push({
        row: p.rowNumber,
        sku: p.input.sku,
        name: p.input.name,
        action,
        image: p.image,
        imageFile: p.imageFile,
      });
    }

    if (input.retireMissing) {
      const inSheet = new Set(planned.map((p) => p.input.sku));
      result.retired = this.d.catalog
        .items(ctx.branchId, false)
        .filter((i) => !inSheet.has(i.sku))
        .map((i) => ({ sku: i.sku, name: i.name }));
    }
    if (dryRun || result.errors.length > 0) return result;

    this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      for (const name of newCategories) {
        const id = this.d.ids.next();
        this.d.catalog.insertCategory(
          {
            id,
            parentId: null,
            name,
            nameTranslations: {},
            color: null,
            sortOrder: categories.size,
            isActive: true,
            version: 1,
          },
          now,
        );
        categories.set(name.toLowerCase(), id);
      }
      for (const name of newStations) {
        const id = this.d.ids.next();
        this.d.catalog.insertStation(ctx.branchId, { id, name, isActive: true, version: 1 }, now);
        stations.set(name.toLowerCase(), id);
      }
      result.items.forEach((row, i) => {
        if (row.action === 'unchanged') return;
        const plan = planned[i]!;
        const input: ItemInput = {
          ...plan.input,
          categoryId: categories.get(plan.category.toLowerCase())!,
          kitchenStationId: plan.station
            ? stations.get(plan.station.toLowerCase())!
            : (plan.existing?.kitchenStationId ?? null),
        };
        const existing = plan.existing && this.d.catalog.item(ctx.branchId, plan.existing.id);
        if (existing) {
          const next = this.d.catalogService.buildItem(
            { ...existing, version: existing.version + 1, isActive: plan.isActive },
            input,
            ctx.branchId,
          );
          this.d.catalog.updateItem(next, ctx.actorId, now);
          scope.recordEvents([
            recordChanged('MenuItemChanged', 'MenuItem', next.id, next.version, next, now),
          ]);
        } else {
          const record = this.d.catalogService.buildItem(
            {
              id: this.d.ids.next(),
              isActive: plan.isActive,
              isAvailable: true,
              version: 1,
              variants: [],
            },
            input,
            ctx.branchId,
          );
          this.d.catalog.insertItem(record, ctx.actorId, now);
          scope.recordEvents([
            recordChanged('MenuItemCreated', 'MenuItem', record.id, 1, record, now),
          ]);
        }
      });
      for (const gone of result.retired) {
        const item = this.d.catalog.item(ctx.branchId, this.d.catalog.itemIdBySku(gone.sku)!)!;
        const next = { ...item, isActive: false, version: item.version + 1 };
        this.d.catalog.updateItem(next, ctx.actorId, now);
        scope.recordEvents([
          recordChanged('MenuItemChanged', 'MenuItem', next.id, next.version, next, now),
        ]);
      }
      scope.audit({
        action: 'menu.import',
        entityType: 'Menu',
        entityId: ctx.branchId,
        after: {
          rows: result.rows,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          retired: result.retired.map((r) => r.sku),
          photos: result.items.filter((r) => r.image === 'set').length,
          createdCategories: result.createdCategories,
          createdStations: result.createdStations,
        },
      });
    });
    return result;
  }
}

/** Whether the row would leave the item as it is (so it isn't rewritten or versioned). */
function unchanged(
  p: Plan,
  e: MenuItemRecord,
  categoryName: Map<string, string>,
  stations: Map<string, string>,
): boolean {
  const i = p.input;
  const stationSame =
    p.station === null || stations.get(p.station.toLowerCase()) === e.kitchenStationId;
  const variantsSame =
    i.variants.length === e.variants.length &&
    i.variants.every(
      (v, n) =>
        v.id === e.variants[n]!.id &&
        v.price === e.variants[n]!.price &&
        v.name === e.variants[n]!.name,
    );
  return (
    e.isActive === p.isActive &&
    categoryName.get(e.categoryId) === p.category.toLowerCase() &&
    stationSame &&
    variantsSame &&
    e.name === i.name &&
    e.shortName === i.shortName &&
    e.description === i.description &&
    sameJson(e.nameTranslations, i.nameTranslations) &&
    sameJson(e.descriptionTranslations, i.descriptionTranslations) &&
    e.foodType === i.foodType &&
    e.basePrice === i.basePrice &&
    e.taxGroupId === i.taxGroupId &&
    e.hsnSacCode === i.hsnSacCode &&
    e.prepTimeSec === i.prepTimeSec &&
    e.imageId === (i.imageId ?? null) &&
    sameJson([...e.addonGroupIds].sort(), [...i.addonGroupIds].sort())
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    JSON.stringify(v, (_k, x: unknown) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(
            Object.entries(x as Record<string, unknown>)
              .filter(([, y]) => y !== undefined)
              .sort(([m], [n]) => m.localeCompare(n)),
          )
        : x,
    );
  return norm(a) === norm(b);
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
