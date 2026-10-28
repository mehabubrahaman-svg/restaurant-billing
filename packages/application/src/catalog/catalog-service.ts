import { assertAddonGroupLimits, assertUniqueNames, DomainError } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type { Patch } from '../patch';
import { recordChanged } from '../shared-events';
import type {
  AddonGroupRecord,
  CatalogRepository,
  CategoryRecord,
  MenuItemRecord,
  StationRecord,
  Translations,
} from './ports';

export interface CatalogServiceDeps {
  readonly catalog: CatalogRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface ItemInput {
  sku: string;
  name: string;
  shortName: string | null;
  nameTranslations: Translations;
  description: string | null;
  descriptionTranslations: Translations;
  categoryId: string;
  foodType: MenuItemRecord['foodType'];
  basePrice: number;
  taxGroupId: string | null;
  hsnSacCode: string | null;
  kitchenStationId: string | null;
  prepTimeSec: number | null;
  sortOrder: number;
  variants: {
    id?: string | undefined;
    name: string;
    nameTranslations: Translations;
    price: number;
  }[];
  addonGroupIds: string[];
}

export interface AddonGroupInput {
  name: string;
  nameTranslations: Translations;
  minSelect: number;
  maxSelect: number;
  addons: {
    id?: string | undefined;
    name: string;
    nameTranslations: Translations;
    price: number;
  }[];
}

/** The menu (permission menu.manage; availability: menu.toggle_availability). */
export class CatalogService {
  constructor(private readonly d: CatalogServiceDeps) {}

  // ---- stations ----------------------------------------------------------
  stations(branchId: string): StationRecord[] {
    return this.d.catalog.stations(branchId);
  }

  createStation(input: { name: string }, ctx: CommandContext): StationRecord {
    return this.write(ctx, (scope, now) => {
      const record: StationRecord = {
        id: this.d.ids.next(),
        name: input.name.trim(),
        isActive: true,
        version: 1,
      };
      this.d.catalog.insertStation(ctx.branchId, record, now);
      this.log(scope, 'KitchenStation', 'create', record.id, 1, undefined, record, now);
      return record;
    });
  }

  updateStation(
    id: string,
    patch: Patch<Omit<StationRecord, 'id'>> & { version: number },
    ctx: CommandContext,
  ) {
    return this.write(ctx, (scope, now) => {
      const current = this.d.catalog.station(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'kitchen station not found');
      const next = merge(current, patch);
      this.d.catalog.updateStation(ctx.branchId, next, now);
      this.log(scope, 'KitchenStation', 'update', id, next.version, current, next, now);
      return next;
    });
  }

  // ---- categories -----------------------------------------------------------
  categories(): CategoryRecord[] {
    return this.d.catalog.categories();
  }

  createCategory(input: Omit<CategoryRecord, 'id' | 'isActive' | 'version'>, ctx: CommandContext) {
    return this.write(ctx, (scope, now) => {
      this.assertParent(input.parentId, null);
      const record: CategoryRecord = {
        ...input,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      this.d.catalog.insertCategory(record, now);
      this.log(scope, 'Category', 'create', record.id, 1, undefined, record, now);
      return record;
    });
  }

  updateCategory(
    id: string,
    patch: Patch<Omit<CategoryRecord, 'id'>> & { version: number },
    ctx: CommandContext,
  ) {
    return this.write(ctx, (scope, now) => {
      const current = this.d.catalog.category(id);
      if (!current) throw new DomainError('NOT_FOUND', 'category not found');
      const next = merge(current, patch);
      this.assertParent(next.parentId, id);
      if (current.isActive && !next.isActive && this.d.catalog.activeItemCount(id) > 0) {
        throw new DomainError(
          'CATEGORY_HAS_ITEMS',
          'move or retire its items before retiring this category',
        );
      }
      this.d.catalog.updateCategory(next, now);
      this.log(scope, 'Category', 'update', id, next.version, current, next, now);
      return next;
    });
  }

  // ---- add-on groups ------------------------------------------------------
  addonGroups(): AddonGroupRecord[] {
    return this.d.catalog.addonGroups();
  }

  createAddonGroup(input: AddonGroupInput, ctx: CommandContext): AddonGroupRecord {
    return this.write(ctx, (scope, now) => {
      const record = this.buildAddonGroup(
        { id: this.d.ids.next(), isActive: true, version: 1, addons: [] },
        input,
      );
      this.d.catalog.insertAddonGroup(record, now);
      this.log(scope, 'AddonGroup', 'create', record.id, 1, undefined, record, now);
      return record;
    });
  }

  updateAddonGroup(
    id: string,
    patch: Patch<AddonGroupInput> & { version: number; isActive?: boolean | undefined },
    ctx: CommandContext,
  ): AddonGroupRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.d.catalog.addonGroup(id);
      if (!current) throw new DomainError('NOT_FOUND', 'add-on group not found');
      assertVersion(current.version, patch.version, 'add-on group');
      const next = this.buildAddonGroup(
        {
          id,
          isActive: patch.isActive ?? current.isActive,
          version: current.version + 1,
          addons: current.addons,
        },
        {
          name: patch.name ?? current.name,
          nameTranslations: patch.nameTranslations ?? current.nameTranslations,
          minSelect: patch.minSelect ?? current.minSelect,
          maxSelect: patch.maxSelect ?? current.maxSelect,
          addons: patch.addons ?? current.addons,
        },
      );
      this.d.catalog.updateAddonGroup(next, now);
      this.log(scope, 'AddonGroup', 'update', id, next.version, current, next, now);
      return next;
    });
  }

  private buildAddonGroup(
    base: Pick<AddonGroupRecord, 'id' | 'isActive' | 'version' | 'addons'>,
    input: AddonGroupInput,
  ): AddonGroupRecord {
    assertUniqueNames(
      input.addons.map((a) => a.name),
      'add-on',
    );
    assertAddonGroupLimits(input.minSelect, input.maxSelect, input.addons.length);
    const known = new Set(base.addons.map((a) => a.id));
    return {
      id: base.id,
      isActive: base.isActive,
      version: base.version,
      name: input.name.trim(),
      nameTranslations: input.nameTranslations,
      minSelect: input.minSelect,
      maxSelect: input.maxSelect,
      addons: input.addons.map((a) => {
        if (a.id && !known.has(a.id))
          throw new DomainError('NOT_FOUND', `add-on ${a.id} is not in this group`);
        return {
          id: a.id ?? this.d.ids.next(),
          name: a.name.trim(),
          nameTranslations: a.nameTranslations,
          price: a.price,
        };
      }),
    };
  }

  // ---- items -------------------------------------------------------------------
  items(branchId: string, includeInactive: boolean): MenuItemRecord[] {
    return this.d.catalog.items(branchId, includeInactive);
  }

  createItem(input: ItemInput, ctx: CommandContext): MenuItemRecord {
    return this.write(ctx, (scope, now) => {
      const record = this.buildItem(
        { id: this.d.ids.next(), isActive: true, isAvailable: true, version: 1, variants: [] },
        input,
        ctx.branchId,
      );
      this.d.catalog.insertItem(record, ctx.actorId, now);
      this.log(scope, 'MenuItem', 'create', record.id, 1, undefined, record, now);
      return record;
    });
  }

  updateItem(
    id: string,
    patch: Patch<ItemInput> & { version: number; isActive?: boolean | undefined },
    ctx: CommandContext,
  ): MenuItemRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.d.catalog.item(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'menu item not found');
      assertVersion(current.version, patch.version, 'menu item');
      const { version: _v, isActive, ...fields } = patch;
      const input: ItemInput = { ...current, ...defined(fields) };
      const next = this.buildItem(
        {
          id,
          isActive: isActive ?? current.isActive,
          isAvailable: current.isAvailable,
          version: current.version + 1,
          variants: current.variants,
        },
        input,
        ctx.branchId,
      );
      this.d.catalog.updateItem(next, ctx.actorId, now);
      this.log(scope, 'MenuItem', 'update', id, next.version, current, next, now);
      return next;
    });
  }

  /** Branch-level "86": the kitchen marks an item temporarily unavailable. */
  setAvailability(id: string, isAvailable: boolean, ctx: CommandContext): MenuItemRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.d.catalog.item(ctx.branchId, id);
      if (!current || !current.isActive) throw new DomainError('NOT_FOUND', 'menu item not found');
      this.d.catalog.setAvailability(ctx.branchId, id, isAvailable, now);
      scope.recordEvents([
        recordChanged(
          'MenuItemAvailabilityChanged',
          'MenuItem',
          id,
          current.version,
          { isAvailable },
          now,
        ),
      ]);
      scope.audit({
        action: 'menu.item.availability',
        entityType: 'MenuItem',
        entityId: id,
        after: { isAvailable },
      });
      return { ...current, isAvailable };
    });
  }

  /** Validates references and variants; `base.variants` are the existing ones (to keep their ids). */
  buildItem(
    base: Pick<MenuItemRecord, 'id' | 'isActive' | 'isAvailable' | 'version' | 'variants'>,
    input: ItemInput,
    branchId: string,
  ): MenuItemRecord {
    const sku = input.sku.trim().toUpperCase();
    const owner = this.d.catalog.itemIdBySku(sku);
    if (owner && owner !== base.id)
      throw new DomainError('SKU_TAKEN', `SKU ${sku} is already used`);
    const category = this.d.catalog.category(input.categoryId);
    if (!category || !category.isActive)
      throw new DomainError('CATEGORY_NOT_FOUND', 'category not found');
    if (input.taxGroupId && !this.d.catalog.taxGroupExists(input.taxGroupId)) {
      throw new DomainError('TAX_GROUP_NOT_FOUND', 'tax group not found');
    }
    if (
      input.kitchenStationId &&
      !this.d.catalog.station(branchId, input.kitchenStationId)?.isActive
    ) {
      throw new DomainError('STATION_NOT_FOUND', 'kitchen station not found');
    }
    for (const groupId of input.addonGroupIds) {
      if (!this.d.catalog.addonGroup(groupId)?.isActive) {
        throw new DomainError('ADDON_GROUP_NOT_FOUND', `add-on group ${groupId} not found`);
      }
    }
    assertUniqueNames(
      input.variants.map((v) => v.name),
      'variant',
    );
    const known = new Set(base.variants.map((v) => v.id));
    return {
      ...base,
      sku,
      name: input.name.trim(),
      shortName: input.shortName,
      nameTranslations: input.nameTranslations,
      description: input.description,
      descriptionTranslations: input.descriptionTranslations,
      categoryId: input.categoryId,
      foodType: input.foodType,
      basePrice: input.basePrice,
      taxGroupId: input.taxGroupId,
      hsnSacCode: input.hsnSacCode,
      kitchenStationId: input.kitchenStationId,
      prepTimeSec: input.prepTimeSec,
      sortOrder: input.sortOrder,
      addonGroupIds: [...new Set(input.addonGroupIds)],
      variants: input.variants.map((v, i) => {
        if (v.id && !known.has(v.id))
          throw new DomainError('NOT_FOUND', `variant ${v.id} is not on this item`);
        return {
          id: v.id ?? this.d.ids.next(),
          name: v.name.trim(),
          nameTranslations: v.nameTranslations,
          price: v.price,
          sortOrder: i,
        };
      }),
    };
  }

  menuVersion(branchId: string): string {
    return this.d.catalog.menuVersion(branchId);
  }

  // ---- helpers ------------------------------------------------------------
  private write<T>(ctx: CommandContext, work: (scope: TransactionScope, now: Date) => T): T {
    return this.d.unitOfWork.run(ctx, (scope) => work(scope, this.d.clock.now()));
  }

  private log(
    scope: TransactionScope,
    type: string,
    verb: 'create' | 'update',
    id: string,
    version: number,
    before: unknown,
    after: unknown,
    at: Date,
  ): void {
    scope.recordEvents([
      recordChanged(
        `${type}${verb === 'create' ? 'Created' : 'Changed'}`,
        type,
        id,
        version,
        after,
        at,
      ),
    ]);
    const action = `menu.${AUDIT_NAMES[type] ?? type.toLowerCase()}.${verb}`;
    scope.audit({ action, entityType: type, entityId: id, before, after });
  }

  private assertParent(parentId: string | null, selfId: string | null): void {
    if (parentId === null) return;
    if (parentId === selfId)
      throw new DomainError('CATEGORY_INVALID', 'a category cannot be its own parent');
    let cursor: string | null = parentId;
    for (let depth = 0; cursor !== null; depth++) {
      const parent = this.d.catalog.category(cursor);
      if (!parent) throw new DomainError('CATEGORY_NOT_FOUND', 'parent category not found');
      if (parent.id === selfId || depth > 5) {
        throw new DomainError(
          'CATEGORY_INVALID',
          'categories can nest at most a few levels and never in a loop',
        );
      }
      cursor = parent.parentId;
    }
  }
}

/** Audit action names: menu.item.create, menu.addon_group.update, … */
const AUDIT_NAMES: Record<string, string> = {
  MenuItem: 'item',
  Category: 'category',
  AddonGroup: 'addon_group',
  KitchenStation: 'station',
};

function assertVersion(current: number, expected: number, what: string): void {
  if (current !== expected) {
    throw new DomainError(
      'VERSION_CONFLICT',
      `this ${what} was changed by someone else; reload and try again`,
    );
  }
}

function merge<T extends { version: number }>(current: T, patch: Patch<T>): T {
  assertVersion(current.version, patch.version ?? current.version, 'record');
  const next: T = { ...current, version: current.version + 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && key !== 'version') (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function defined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
