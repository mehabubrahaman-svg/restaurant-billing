import { DomainError, Money } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type { CatalogService, ItemInput } from './catalog-service';
import { parseCsv } from './csv';
import type { CatalogRepository, FoodType } from './ports';

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: number;
  updated: number;
  createdCategories: string[];
  createdStations: string[];
  errors: { row: number; column?: string; message: string }[];
}

const REQUIRED = ['sku', 'name', 'category', 'price'] as const;
const KNOWN = new Set([
  ...REQUIRED,
  'food_type',
  'tax_group',
  'kitchen_station',
  'short_name',
  'name_hi',
  'name_bn',
  'hsn_sac',
  'description',
]);
const FOOD_TYPES: Record<string, FoodType> = {
  veg: 'VEG',
  'non-veg': 'NON_VEG',
  non_veg: 'NON_VEG',
  nonveg: 'NON_VEG',
  egg: 'EGG',
  vegan: 'VEGAN',
  na: 'NA',
};
const MAX_ROWS = 5000;

/**
 * Bulk menu upload from a spreadsheet. Validates every row first; writes
 * nothing if any row is wrong, so a half-imported menu can't happen. Rows are
 * matched by SKU: existing items keep their variants, add-ons and anything
 * the sheet doesn't mention.
 */
export class MenuImporter {
  constructor(
    private readonly d: {
      catalog: CatalogRepository;
      catalogService: CatalogService;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  run(csv: string, dryRun: boolean, ctx: CommandContext): ImportResult {
    let table: string[][];
    try {
      table = parseCsv(csv);
    } catch (error) {
      throw new DomainError('CSV_INVALID', (error as Error).message);
    }
    const result: ImportResult = {
      dryRun,
      rows: 0,
      created: 0,
      updated: 0,
      createdCategories: [],
      createdStations: [],
      errors: [],
    };
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
    for (const column of REQUIRED) {
      if (!header.includes(column))
        result.errors.push({ row: 1, column, message: `missing column "${column}"` });
    }
    for (const column of header) {
      if (!KNOWN.has(column))
        result.errors.push({ row: 1, column, message: `unknown column "${column}"` });
    }
    if (table.length - 1 > MAX_ROWS)
      result.errors.push({ row: 1, message: `at most ${MAX_ROWS} rows per import` });
    if (result.errors.length > 0) return result;

    const categories = new Map(
      this.d.catalog
        .categories()
        .filter((c) => c.isActive)
        .map((c) => [c.name.toLowerCase(), c.id]),
    );
    const stations = new Map(
      this.d.catalog
        .stations(ctx.branchId)
        .filter((s) => s.isActive)
        .map((s) => [s.name.toLowerCase(), s.id]),
    );
    const seenSkus = new Map<string, number>();
    const planned: {
      rowNumber: number;
      existingId: string | undefined;
      input: ItemInput;
      category: string;
      station: string | null;
    }[] = [];

    table.slice(1).forEach((cells, index) => {
      const rowNumber = index + 2;
      result.rows += 1;
      const get = (column: string) => (cells[header.indexOf(column)] ?? '').trim();
      const fail = (column: string, message: string) =>
        result.errors.push({ row: rowNumber, column, message });

      const sku = get('sku').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(sku)) fail('sku', 'up to 32 letters, digits, - or _');
      else if (seenSkus.has(sku)) fail('sku', `same SKU as row ${seenSkus.get(sku)}`);
      else seenSkus.set(sku, rowNumber);

      const name = get('name');
      if (!name || name.length > 120) fail('name', 'required, at most 120 characters');
      const category = get('category');
      if (!category) fail('category', 'required');

      let price = 0;
      try {
        price = Money.ofRupees(get('price')).paise;
        if (price < 0) fail('price', 'cannot be negative');
      } catch {
        fail('price', 'a rupee amount like 249 or 249.50');
      }

      const foodRaw = get('food_type').toLowerCase() || 'veg';
      const foodType = FOOD_TYPES[foodRaw];
      if (!foodType) fail('food_type', 'veg, non-veg, egg, vegan or na');

      const taxName = get('tax_group');
      const taxGroupId = taxName ? this.d.catalog.taxGroupIdByName(taxName) : undefined;
      if (taxName && !taxGroupId) fail('tax_group', `no tax group named "${taxName}"`);

      const hsn = get('hsn_sac');
      if (hsn && !/^\d{4,8}$/.test(hsn)) fail('hsn_sac', '4 to 8 digits');
      const shortName = get('short_name');
      if (shortName.length > 24) fail('short_name', 'at most 24 characters');

      const existingId = sku ? this.d.catalog.itemIdBySku(sku) : undefined;
      const existing = existingId ? this.d.catalog.item(ctx.branchId, existingId) : undefined;
      const translations = {
        ...(existing?.nameTranslations ?? {}),
        ...(get('name_hi') && { hi: get('name_hi') }),
        ...(get('name_bn') && { bn: get('name_bn') }),
      };
      const station = get('kitchen_station') || null;

      planned.push({
        rowNumber,
        existingId,
        category,
        station,
        input: {
          sku,
          name,
          shortName: shortName || existing?.shortName || null,
          nameTranslations: translations,
          description: get('description') || existing?.description || null,
          descriptionTranslations: existing?.descriptionTranslations ?? {},
          categoryId: '',
          foodType: foodType ?? 'VEG',
          basePrice: price,
          taxGroupId: taxGroupId ?? existing?.taxGroupId ?? null,
          hsnSacCode: hsn || existing?.hsnSacCode || null,
          kitchenStationId: null,
          prepTimeSec: existing?.prepTimeSec ?? null,
          sortOrder: existing?.sortOrder ?? index,
          variants: existing?.variants ?? [],
          addonGroupIds: existing?.addonGroupIds ?? [],
        },
      });
    });

    const newCategories = [
      ...new Set(
        planned.map((p) => p.category).filter((c) => c && !categories.has(c.toLowerCase())),
      ),
    ];
    const newStations = [
      ...new Set(
        planned
          .map((p) => p.station)
          .filter((s): s is string => !!s && !stations.has(s.toLowerCase())),
      ),
    ];
    result.createdCategories = dedupeCaseInsensitive(newCategories);
    result.createdStations = dedupeCaseInsensitive(newStations);
    result.created = planned.filter((p) => !p.existingId).length;
    result.updated = planned.length - result.created;
    if (dryRun || result.errors.length > 0) return result;

    this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      for (const name of result.createdCategories) {
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
      for (const name of result.createdStations) {
        const id = this.d.ids.next();
        this.d.catalog.insertStation(ctx.branchId, { id, name, isActive: true, version: 1 }, now);
        stations.set(name.toLowerCase(), id);
      }
      for (const plan of planned) {
        const input: ItemInput = {
          ...plan.input,
          categoryId: categories.get(plan.category.toLowerCase())!,
          kitchenStationId: plan.station ? stations.get(plan.station.toLowerCase())! : null,
        };
        const existing = plan.existingId
          ? this.d.catalog.item(ctx.branchId, plan.existingId)
          : undefined;
        if (existing) {
          const next = this.d.catalogService.buildItem(
            { ...existing, version: existing.version + 1, isActive: true },
            { ...input, kitchenStationId: input.kitchenStationId ?? existing.kitchenStationId },
            ctx.branchId,
          );
          this.d.catalog.updateItem(next, ctx.actorId, now);
          scope.recordEvents([
            recordChanged('MenuItemChanged', 'MenuItem', next.id, next.version, next, now),
          ]);
        } else {
          const record = this.d.catalogService.buildItem(
            { id: this.d.ids.next(), isActive: true, isAvailable: true, version: 1, variants: [] },
            input,
            ctx.branchId,
          );
          this.d.catalog.insertItem(record, ctx.actorId, now);
          scope.recordEvents([
            recordChanged('MenuItemCreated', 'MenuItem', record.id, 1, record, now),
          ]);
        }
      }
      scope.audit({
        action: 'menu.import',
        entityType: 'Menu',
        entityId: ctx.branchId,
        after: {
          rows: result.rows,
          created: result.created,
          updated: result.updated,
          createdCategories: result.createdCategories,
          createdStations: result.createdStations,
        },
      });
    });
    return result;
  }
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
