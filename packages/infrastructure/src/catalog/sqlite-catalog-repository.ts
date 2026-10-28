import type {
  AddonGroupRecord,
  CatalogRepository,
  CategoryRecord,
  MenuItemRecord,
  StationRecord,
  Translations,
  VariantRecord,
} from '@restroos/application';
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from '../db/connection';
import { assertVersionMatched } from '../db/optimistic';

const json = (t: Translations) => (Object.keys(t).length === 0 ? null : JSON.stringify(t));
const parse = (v: string | null): Translations => (v ? (JSON.parse(v) as Translations) : {});
const iso = (d: Date) => d.toISOString();

interface ItemRow {
  id: string;
  sku: string;
  name: string;
  short_name: string | null;
  name_translations: string | null;
  description: string | null;
  description_translations: string | null;
  category_id: string;
  food_type: MenuItemRecord['foodType'];
  base_price: number;
  tax_group_id: string | null;
  hsn_sac_code: string | null;
  kitchen_station_id: string | null;
  prep_time_sec: number | null;
  sort_order: number;
  deleted_at: string | null;
  version: number;
  available: number | null;
}

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly db: SqliteDatabase) {}

  organizationId(): string {
    const id = this.db.prepare<[], string>('SELECT id FROM organizations LIMIT 1').pluck().get();
    if (!id) throw new Error('not set up');
    return id;
  }

  // ---- stations --------------------------------------------------------------
  stations(branchId: string): StationRecord[] {
    return this.db
      .prepare<[string], { id: string; name: string; deleted_at: string | null; version: number }>(
        'SELECT id, name, deleted_at, version FROM kitchen_stations WHERE branch_id = ? ORDER BY name',
      )
      .all(branchId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.deleted_at === null,
        version: r.version,
      }));
  }

  station(branchId: string, id: string): StationRecord | undefined {
    return this.stations(branchId).find((s) => s.id === id);
  }

  insertStation(branchId: string, r: StationRecord, at: Date): void {
    this.db
      .prepare(
        'INSERT INTO kitchen_stations (id, branch_id, name, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(r.id, branchId, r.name, iso(at), iso(at), r.version);
  }

  updateStation(branchId: string, r: StationRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE kitchen_stations SET name = ?, deleted_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND branch_id = ? AND version = ?`,
      )
      .run(r.name, r.isActive ? null : iso(at), iso(at), r.version, r.id, branchId, r.version - 1);
    assertVersionMatched(result, 'KitchenStation', r.id);
  }

  // ---- categories ------------------------------------------------------------
  categories(): CategoryRecord[] {
    return this.db
      .prepare<
        [],
        {
          id: string;
          parent_id: string | null;
          name: string;
          name_translations: string | null;
          color: string | null;
          sort_order: number;
          deleted_at: string | null;
          version: number;
        }
      >('SELECT * FROM categories ORDER BY sort_order, name')
      .all()
      .map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        nameTranslations: parse(r.name_translations),
        color: r.color,
        sortOrder: r.sort_order,
        isActive: r.deleted_at === null,
        version: r.version,
      }));
  }

  category(id: string): CategoryRecord | undefined {
    return this.categories().find((c) => c.id === id);
  }

  insertCategory(r: CategoryRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO categories (id, organization_id, parent_id, name, name_translations, color, sort_order,
                                 created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        this.organizationId(),
        r.parentId,
        r.name,
        json(r.nameTranslations),
        r.color,
        r.sortOrder,
        iso(at),
        iso(at),
        r.version,
      );
  }

  updateCategory(r: CategoryRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE categories SET parent_id = ?, name = ?, name_translations = ?, color = ?, sort_order = ?,
                deleted_at = ?, updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.parentId,
        r.name,
        json(r.nameTranslations),
        r.color,
        r.sortOrder,
        r.isActive ? null : iso(at),
        iso(at),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'Category', r.id);
  }

  activeItemCount(categoryId: string): number {
    return this.db
      .prepare<[string], number>(
        'SELECT count(*) FROM menu_items WHERE category_id = ? AND deleted_at IS NULL',
      )
      .pluck()
      .get(categoryId)!;
  }

  // ---- add-on groups ----------------------------------------------------------
  addonGroups(): AddonGroupRecord[] {
    const addons = this.db
      .prepare<
        [],
        {
          id: string;
          addon_group_id: string;
          name: string;
          name_translations: string | null;
          price: number;
        }
      >(
        'SELECT id, addon_group_id, name, name_translations, price FROM addons WHERE deleted_at IS NULL ORDER BY rowid',
      )
      .all();
    return this.db
      .prepare<
        [],
        {
          id: string;
          name: string;
          name_translations: string | null;
          min_select: number;
          max_select: number;
          deleted_at: string | null;
          version: number;
        }
      >('SELECT * FROM addon_groups ORDER BY name')
      .all()
      .map((g) => ({
        id: g.id,
        name: g.name,
        nameTranslations: parse(g.name_translations),
        minSelect: g.min_select,
        maxSelect: g.max_select,
        isActive: g.deleted_at === null,
        version: g.version,
        addons: addons
          .filter((a) => a.addon_group_id === g.id)
          .map((a) => ({
            id: a.id,
            name: a.name,
            nameTranslations: parse(a.name_translations),
            price: a.price,
          })),
      }));
  }

  addonGroup(id: string): AddonGroupRecord | undefined {
    return this.addonGroups().find((g) => g.id === id);
  }

  insertAddonGroup(r: AddonGroupRecord, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO addon_groups (id, organization_id, name, name_translations, min_select, max_select,
                                   created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        this.organizationId(),
        r.name,
        json(r.nameTranslations),
        r.minSelect,
        r.maxSelect,
        iso(at),
        iso(at),
        r.version,
      );
    this.writeAddons(r, at);
  }

  updateAddonGroup(r: AddonGroupRecord, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE addon_groups SET name = ?, name_translations = ?, min_select = ?, max_select = ?, deleted_at = ?,
                updated_at = ?, version = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        r.name,
        json(r.nameTranslations),
        r.minSelect,
        r.maxSelect,
        r.isActive ? null : iso(at),
        iso(at),
        r.version,
        r.id,
        r.version - 1,
      );
    assertVersionMatched(result, 'AddonGroup', r.id);
    this.writeAddons(r, at);
  }

  /** Upserts the listed addons and retires the rest (kept for order history). */
  private writeAddons(r: AddonGroupRecord, at: Date): void {
    const upsert = this.db.prepare(
      `INSERT INTO addons (id, addon_group_id, name, name_translations, price, created_at, updated_at)
       VALUES (@id, @groupId, @name, @translations, @price, @at, @at)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_translations = excluded.name_translations,
              price = excluded.price, deleted_at = NULL, updated_at = excluded.updated_at, version = addons.version + 1`,
    );
    for (const a of r.addons) {
      upsert.run({
        id: a.id,
        groupId: r.id,
        name: a.name,
        translations: json(a.nameTranslations),
        price: a.price,
        at: iso(at),
      });
    }
    const keep = r.addons.map((a) => a.id);
    this.db
      .prepare(
        `UPDATE addons SET deleted_at = ?, updated_at = ?
          WHERE addon_group_id = ? AND deleted_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`,
      )
      .run(iso(at), iso(at), r.id, JSON.stringify(keep));
  }

  // ---- items ---------------------------------------------------------------------
  items(branchId: string, includeInactive: boolean): MenuItemRecord[] {
    const rows = this.db
      .prepare<[string], ItemRow>(
        `SELECT m.*, bm.is_available AS available FROM menu_items m
           LEFT JOIN branch_menu_items bm ON bm.menu_item_id = m.id AND bm.branch_id = ?
          ${includeInactive ? '' : 'WHERE m.deleted_at IS NULL'}
          ORDER BY m.sort_order, m.name`,
      )
      .all(branchId);
    const variants = this.variantsByItem();
    const links = this.addonLinksByItem();
    return rows.map((r) => toItem(r, variants.get(r.id) ?? [], links.get(r.id) ?? []));
  }

  item(branchId: string, id: string): MenuItemRecord | undefined {
    const row = this.db
      .prepare<[string, string], ItemRow>(
        `SELECT m.*, bm.is_available AS available FROM menu_items m
           LEFT JOIN branch_menu_items bm ON bm.menu_item_id = m.id AND bm.branch_id = ?
          WHERE m.id = ?`,
      )
      .get(branchId, id);
    if (!row) return undefined;
    return toItem(
      row,
      this.variantsByItem(id).get(id) ?? [],
      this.addonLinksByItem(id).get(id) ?? [],
    );
  }

  itemIdBySku(sku: string): string | undefined {
    return this.db
      .prepare<[string], string>('SELECT id FROM menu_items WHERE sku = ?')
      .pluck()
      .get(sku);
  }

  insertItem(r: MenuItemRecord, actorId: string | null, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO menu_items (id, organization_id, category_id, sku, name, short_name, name_translations, description,
                                 description_translations, food_type, base_price, tax_group_id, hsn_sac_code,
                                 kitchen_station_id, prep_time_sec, sort_order, created_at, created_by, updated_at,
                                 updated_by, version)
         VALUES (@id, @org, @categoryId, @sku, @name, @shortName, @nameTr, @description, @descriptionTr, @foodType,
                 @basePrice, @taxGroupId, @hsnSacCode, @kitchenStationId, @prepTimeSec, @sortOrder, @at, @actor, @at,
                 @actor, @version)`,
      )
      .run({ ...this.itemParams(r), org: this.organizationId(), actor: actorId, at: iso(at) });
    this.writeChildren(r, at);
  }

  updateItem(r: MenuItemRecord, actorId: string | null, at: Date): void {
    const result = this.db
      .prepare(
        `UPDATE menu_items SET category_id = @categoryId, sku = @sku, name = @name, short_name = @shortName,
                name_translations = @nameTr, description = @description, description_translations = @descriptionTr,
                food_type = @foodType, base_price = @basePrice, tax_group_id = @taxGroupId, hsn_sac_code = @hsnSacCode,
                kitchen_station_id = @kitchenStationId, prep_time_sec = @prepTimeSec, sort_order = @sortOrder,
                deleted_at = @deletedAt, deleted_by = @deletedBy, updated_at = @at, updated_by = @actor,
                version = @version
          WHERE id = @id AND version = @expected`,
      )
      .run({
        ...this.itemParams(r),
        deletedAt: r.isActive ? null : iso(at),
        deletedBy: r.isActive ? null : actorId,
        actor: actorId,
        at: iso(at),
        expected: r.version - 1,
      });
    assertVersionMatched(result, 'MenuItem', r.id);
    this.writeChildren(r, at);
  }

  setAvailability(branchId: string, itemId: string, isAvailable: boolean, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO branch_menu_items (branch_id, menu_item_id, is_available, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (branch_id, menu_item_id) DO UPDATE SET is_available = excluded.is_available,
                updated_at = excluded.updated_at, version = branch_menu_items.version + 1`,
      )
      .run(branchId, itemId, isAvailable ? 1 : 0, iso(at));
  }

  taxGroupIdByName(name: string): string | undefined {
    return this.db
      .prepare<[string], string>(
        'SELECT id FROM tax_groups WHERE lower(name) = lower(?) AND deleted_at IS NULL',
      )
      .pluck()
      .get(name.trim());
  }

  taxGroupExists(id: string): boolean {
    return (
      this.db
        .prepare('SELECT EXISTS (SELECT 1 FROM tax_groups WHERE id = ? AND deleted_at IS NULL)')
        .pluck()
        .get(id) === 1
    );
  }

  menuVersion(branchId: string): string {
    const parts = this.db
      .prepare<[string, string], { s: string }>(
        `SELECT (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version) FROM categories) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version) FROM menu_items) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version) FROM menu_item_variants) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version) FROM addon_groups) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version) FROM addons) || '|' ||
                (SELECT count(*) FROM menu_item_addon_groups) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version)
                   FROM kitchen_stations WHERE branch_id = ?) || '|' ||
                (SELECT count(*) || ':' || ifnull(max(updated_at), '') || ':' || total(version)
                   FROM branch_menu_items WHERE branch_id = ?) AS s`,
      )
      .get(branchId, branchId)!;
    return createHash('sha256').update(parts.s).digest('hex').slice(0, 20);
  }

  private itemParams(r: MenuItemRecord) {
    return {
      id: r.id,
      categoryId: r.categoryId,
      sku: r.sku,
      name: r.name,
      shortName: r.shortName,
      nameTr: json(r.nameTranslations),
      description: r.description,
      descriptionTr: json(r.descriptionTranslations),
      foodType: r.foodType,
      basePrice: r.basePrice,
      taxGroupId: r.taxGroupId,
      hsnSacCode: r.hsnSacCode,
      kitchenStationId: r.kitchenStationId,
      prepTimeSec: r.prepTimeSec,
      sortOrder: r.sortOrder,
      version: r.version,
    };
  }

  private writeChildren(r: MenuItemRecord, at: Date): void {
    const upsert = this.db.prepare(
      `INSERT INTO menu_item_variants (id, menu_item_id, name, name_translations, price, sort_order, created_at, updated_at)
       VALUES (@id, @itemId, @name, @tr, @price, @sortOrder, @at, @at)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, name_translations = excluded.name_translations,
              price = excluded.price, sort_order = excluded.sort_order, deleted_at = NULL,
              updated_at = excluded.updated_at, version = menu_item_variants.version + 1`,
    );
    for (const v of r.variants) {
      upsert.run({
        id: v.id,
        itemId: r.id,
        name: v.name,
        tr: json(v.nameTranslations),
        price: v.price,
        sortOrder: v.sortOrder,
        at: iso(at),
      });
    }
    this.db
      .prepare(
        `UPDATE menu_item_variants SET deleted_at = ?, updated_at = ?
          WHERE menu_item_id = ? AND deleted_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`,
      )
      .run(iso(at), iso(at), r.id, JSON.stringify(r.variants.map((v) => v.id)));

    // Item ↔ add-on group links are configuration, replaced as a whole (the item's version records the change).
    // eslint-disable-next-line no-restricted-syntax
    this.db.prepare('DELETE FROM menu_item_addon_groups WHERE menu_item_id = ?').run(r.id);
    const link = this.db.prepare(
      'INSERT INTO menu_item_addon_groups (menu_item_id, addon_group_id, sort_order) VALUES (?, ?, ?)',
    );
    r.addonGroupIds.forEach((groupId, i) => link.run(r.id, groupId, i));
  }

  private variantsByItem(itemId?: string): Map<string, VariantRecord[]> {
    const rows = this.db
      .prepare<
        [string | null, string | null],
        {
          id: string;
          menu_item_id: string;
          name: string;
          name_translations: string | null;
          price: number;
          sort_order: number;
        }
      >(
        `SELECT id, menu_item_id, name, name_translations, price, sort_order FROM menu_item_variants
          WHERE deleted_at IS NULL AND (? IS NULL OR menu_item_id = ?) ORDER BY sort_order`,
      )
      .all(itemId ?? null, itemId ?? null);
    const map = new Map<string, VariantRecord[]>();
    for (const v of rows) {
      const list = map.get(v.menu_item_id) ?? [];
      list.push({
        id: v.id,
        name: v.name,
        nameTranslations: parse(v.name_translations),
        price: v.price,
        sortOrder: v.sort_order,
      });
      map.set(v.menu_item_id, list);
    }
    return map;
  }

  private addonLinksByItem(itemId?: string): Map<string, string[]> {
    const rows = this.db
      .prepare<[string | null, string | null], { menu_item_id: string; addon_group_id: string }>(
        `SELECT menu_item_id, addon_group_id FROM menu_item_addon_groups
          WHERE (? IS NULL OR menu_item_id = ?) ORDER BY sort_order`,
      )
      .all(itemId ?? null, itemId ?? null);
    const map = new Map<string, string[]>();
    for (const l of rows)
      map.set(l.menu_item_id, [...(map.get(l.menu_item_id) ?? []), l.addon_group_id]);
    return map;
  }
}

function toItem(r: ItemRow, variants: VariantRecord[], addonGroupIds: string[]): MenuItemRecord {
  return {
    id: r.id,
    sku: r.sku,
    name: r.name,
    shortName: r.short_name,
    nameTranslations: parse(r.name_translations),
    description: r.description,
    descriptionTranslations: parse(r.description_translations),
    categoryId: r.category_id,
    foodType: r.food_type,
    basePrice: r.base_price,
    taxGroupId: r.tax_group_id,
    hsnSacCode: r.hsn_sac_code,
    kitchenStationId: r.kitchen_station_id,
    prepTimeSec: r.prep_time_sec,
    sortOrder: r.sort_order,
    variants,
    addonGroupIds,
    isActive: r.deleted_at === null,
    isAvailable: r.available === null ? true : r.available === 1,
    version: r.version,
  };
}
