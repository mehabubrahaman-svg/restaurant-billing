import { DomainError, type Kot, type Order } from '@restroos/domain';
import type { CatalogRepository, FoodType, Translations } from '../catalog/ports';
import type { FloorRepository } from '../floor/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { SettingsRepository } from '../settings/ports';
import { recordChanged } from '../shared-events';
import type { OrderService } from './order-service';

export type QrRequestKind = 'ORDER' | 'WAITER' | 'BILL';
export type QrRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DONE';

/** One dish a guest asked for, with the names they saw (for the captain). */
export interface QrRequestItem {
  menuItemId: string;
  variantId: string | null;
  quantity: number;
  addons: { addonId: string; quantity: number }[];
  note: string | null;
  name: string;
  variantName: string | null;
  addonNames: string[];
}

export interface QrRequestRecord {
  id: string;
  branchId: string;
  tableId: string;
  kind: QrRequestKind;
  status: QrRequestStatus;
  items: QrRequestItem[];
  guestName: string | null;
  covers: number | null;
  note: string | null;
  /** The order the items went onto, once accepted. */
  orderId: string | null;
  handledBy: string | null;
  handledAt: string | null;
  rejectReason: string | null;
  /** The phone's own key for the request, so a retried send isn't a second order. */
  clientKey: string | null;
  createdAt: string;
  version: number;
}

export interface QrRequestRepository {
  get(id: string): QrRequestRecord | undefined;
  byClientKey(tableId: string, clientKey: string): QrRequestRecord | undefined;
  /** Pending requests of the branch, oldest first, with the table's label. */
  pending(branchId: string): (QrRequestRecord & { tableLabel: string })[];
  pendingCount(tableId: string): number;
  insert(record: QrRequestRecord): void;
  /** Version-checked. */
  update(record: QrRequestRecord): void;
}

/** The menu a guest sees: what can be ordered, with names in their language. */
export interface QrMenuView {
  branchName: string;
  tableLabel: string;
  categories: { id: string; name: string; nameTranslations: Translations; sortOrder: number }[];
  items: {
    id: string;
    categoryId: string;
    name: string;
    nameTranslations: Translations;
    description: string | null;
    descriptionTranslations: Translations;
    foodType: FoodType;
    price: number;
    /** The price already includes tax; otherwise tax is added on the bill. */
    taxIncluded: boolean;
    variants: { id: string; name: string; nameTranslations: Translations; price: number }[];
    addonGroupIds: string[];
    isAvailable: boolean;
  }[];
  addonGroups: {
    id: string;
    name: string;
    nameTranslations: Translations;
    minSelect: number;
    maxSelect: number;
    addons: { id: string; name: string; nameTranslations: Translations; price: number }[];
  }[];
}

export interface QrRequestInput {
  kind: QrRequestKind;
  items: {
    menuItemId: string;
    variantId?: string | undefined;
    quantity: number;
    addons: { addonId: string; quantity: number }[];
    note?: string | undefined;
  }[];
  guestName?: string | undefined;
  covers?: number | undefined;
  note?: string | undefined;
  clientKey?: string | undefined;
}

/** A table has at most this many requests waiting for a captain. */
export const MAX_PENDING_PER_TABLE = 5;

/**
 * QR self-ordering (docs/08 Phase 5): a guest scans the table's code, orders
 * from their phone or calls for the waiter or the bill, and a captain
 * accepts the order onto the table (it then goes to the kitchen) or declines
 * it. Guests never change an order themselves.
 */
export class QrOrderingService {
  constructor(
    private readonly d: {
      requests: QrRequestRepository;
      floor: FloorRepository;
      catalog: CatalogRepository;
      settings: SettingsRepository;
      orders: OrderService;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  menu(token: string): QrMenuView {
    const table = this.tableFor(token);
    const categories = this.d.catalog
      .categories()
      .filter((c) => c.isActive)
      .map((c) => ({
        id: c.id,
        name: c.name,
        nameTranslations: c.nameTranslations,
        sortOrder: c.sortOrder,
      }));
    const shown = new Set(categories.map((c) => c.id));
    const items = this.d.catalog
      .items(table.branchId, false)
      .filter((i) => i.isActive && shown.has(i.categoryId))
      .map((i) => ({
        id: i.id,
        categoryId: i.categoryId,
        name: i.name,
        nameTranslations: i.nameTranslations,
        description: i.description,
        descriptionTranslations: i.descriptionTranslations,
        foodType: i.foodType,
        price: i.basePrice,
        taxIncluded: i.taxGroupId
          ? (this.d.settings.taxGroup(i.taxGroupId)?.isInclusive ?? false)
          : false,
        variants: [...i.variants]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((v) => ({
            id: v.id,
            name: v.name,
            nameTranslations: v.nameTranslations,
            price: v.price,
          })),
        addonGroupIds: i.addonGroupIds,
        isAvailable: i.isAvailable,
      }));
    const used = new Set(items.flatMap((i) => i.addonGroupIds));
    const addonGroups = this.d.catalog
      .addonGroups()
      .filter((g) => g.isActive && used.has(g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        nameTranslations: g.nameTranslations,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        addons: g.addons.map((a) => ({
          id: a.id,
          name: a.name,
          nameTranslations: a.nameTranslations,
          price: a.price,
        })),
      }));
    return {
      branchName: this.d.settings.branch(table.branchId)?.name ?? '',
      tableLabel: table.label,
      categories,
      items,
      addonGroups,
    };
  }

  /** From the guest's phone: an order, or a call for the waiter or the bill. */
  submit(
    token: string,
    input: QrRequestInput,
    meta: { ipAddress: string | null; correlationId: string },
  ): QrRequestRecord {
    const table = this.tableFor(token);
    const ctx: CommandContext = {
      branchId: table.branchId,
      actorId: null,
      ipAddress: meta.ipAddress,
      correlationId: meta.correlationId,
    };
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (input.clientKey) {
        const again = this.d.requests.byClientKey(table.id, input.clientKey);
        if (again) return again;
      }
      if (input.kind === 'ORDER' && input.items.length === 0)
        throw new DomainError('VALIDATION_FAILED', 'add something to the order first');
      if (this.d.requests.pendingCount(table.id) >= MAX_PENDING_PER_TABLE) {
        throw new DomainError(
          'QR_TOO_MANY_REQUESTS',
          'your earlier requests are still waiting; a server will be with you shortly',
        );
      }
      const record: QrRequestRecord = {
        id: this.d.ids.next(),
        branchId: table.branchId,
        tableId: table.id,
        kind: input.kind,
        status: 'PENDING',
        items:
          input.kind === 'ORDER' ? input.items.map((i) => this.describe(table.branchId, i)) : [],
        guestName: input.guestName?.trim() || null,
        covers: input.covers ?? null,
        note: input.note?.trim() || null,
        orderId: null,
        handledBy: null,
        handledAt: null,
        rejectReason: null,
        clientKey: input.clientKey ?? null,
        createdAt: this.d.clock.now().toISOString(),
        version: 1,
      };
      this.d.requests.insert(record);
      scope.recordEvents([
        recordChanged(
          'QrRequestCreated',
          'QrRequest',
          record.id,
          1,
          { tableId: table.id, kind: record.kind, items: record.items.length },
          this.d.clock.now(),
        ),
      ]);
      return record;
    });
  }

  /** The guest's view of one of their requests. */
  status(token: string, id: string): QrRequestRecord {
    const table = this.tableFor(token);
    const request = this.d.requests.get(id);
    if (!request || request.tableId !== table.id)
      throw new DomainError('NOT_FOUND', 'request not found');
    return request;
  }

  pending(branchId: string) {
    return this.d.requests.pending(branchId);
  }

  /** The captain takes the order onto the table (sent to the kitchen unless `fire` is false). */
  accept(id: string, input: { fire: boolean }, ctx: CommandContext): { order: Order; kots: Kot[] } {
    const request = this.open(id, ctx.branchId);
    if (request.kind !== 'ORDER')
      throw new DomainError('VALIDATION_FAILED', 'only an order can be accepted; mark it done');
    return this.d.orders.addGuestOrder(
      {
        tableId: request.tableId,
        covers: request.covers,
        items: request.items.map((i) => ({
          menuItemId: i.menuItemId,
          variantId: i.variantId ?? undefined,
          quantity: i.quantity,
          addons: i.addons,
          specialNote: i.note ?? undefined,
          course: 1,
        })),
        fire: input.fire,
      },
      ctx,
      (scope, order) => {
        // Read again inside the transaction: two captains can't both accept it.
        const current = this.open(id, ctx.branchId);
        const now = this.d.clock.now();
        this.d.requests.update({
          ...current,
          status: 'ACCEPTED',
          orderId: order.id,
          handledBy: ctx.actorId,
          handledAt: now.toISOString(),
          version: current.version + 1,
        });
        scope.recordEvents([
          recordChanged(
            'QrRequestAccepted',
            'QrRequest',
            id,
            current.version + 1,
            { orderId: order.id },
            now,
          ),
        ]);
      },
    );
  }

  /** The captain declines an order (with why, shown to the guest). */
  reject(id: string, reason: string, ctx: CommandContext): QrRequestRecord {
    return this.close(id, ctx, 'REJECTED', reason);
  }

  /** A call for the waiter or the bill was answered. */
  done(id: string, ctx: CommandContext): QrRequestRecord {
    return this.close(id, ctx, 'DONE', null);
  }

  private close(
    id: string,
    ctx: CommandContext,
    status: 'REJECTED' | 'DONE',
    reason: string | null,
  ): QrRequestRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.open(id, ctx.branchId);
      if (status === 'DONE' && current.kind === 'ORDER')
        throw new DomainError('VALIDATION_FAILED', 'accept or decline the order');
      const now = this.d.clock.now();
      const next: QrRequestRecord = {
        ...current,
        status,
        rejectReason: reason,
        handledBy: ctx.actorId,
        handledAt: now.toISOString(),
        version: current.version + 1,
      };
      this.d.requests.update(next);
      scope.recordEvents([
        recordChanged(
          status === 'DONE' ? 'QrRequestDone' : 'QrRequestRejected',
          'QrRequest',
          id,
          next.version,
          {},
          now,
        ),
      ]);
      scope.audit({
        action: status === 'DONE' ? 'order.qr.done' : 'order.qr.reject',
        entityType: 'QrRequest',
        entityId: id,
        reason,
      });
      return next;
    });
  }

  private open(id: string, branchId: string): QrRequestRecord {
    const request = this.d.requests.get(id);
    if (!request || request.branchId !== branchId)
      throw new DomainError('NOT_FOUND', 'request not found');
    if (request.status !== 'PENDING')
      throw new DomainError('QR_REQUEST_HANDLED', 'someone already answered this request');
    return request;
  }

  private tableFor(token: string) {
    const table = this.d.floor.tableByQrToken(token);
    if (!table || !table.isActive)
      throw new DomainError('NOT_FOUND', 'this QR code is not in use; ask a server');
    return table;
  }

  /** Checks the dish against the menu now, and keeps the names the guest saw. */
  private describe(branchId: string, input: QrRequestInput['items'][number]): QrRequestItem {
    const item = this.d.catalog.item(branchId, input.menuItemId);
    if (!item || !item.isActive) throw new DomainError('NOT_FOUND', 'that dish is not on the menu');
    if (!item.isAvailable)
      throw new DomainError('ITEM_UNAVAILABLE', `${item.name} is not available right now`);
    const variant = item.variants.find((v) => v.id === input.variantId) ?? null;
    if (item.variants.length > 0 && !variant)
      throw new DomainError('VALIDATION_FAILED', `choose a size for ${item.name}`);
    const addons = item.addonGroupIds
      .map((g) => this.d.catalog.addonGroup(g))
      .flatMap((g) => (g?.isActive ? g.addons : []));
    const addonNames = input.addons.map((a) => {
      const addon = addons.find((x) => x.id === a.addonId);
      if (!addon)
        throw new DomainError('VALIDATION_FAILED', `an add-on doesn't belong to ${item.name}`);
      return a.quantity > 1 ? `${addon.name} ×${a.quantity}` : addon.name;
    });
    return {
      menuItemId: item.id,
      variantId: variant?.id ?? null,
      quantity: input.quantity,
      addons: input.addons,
      note: input.note?.trim() || null,
      name: item.name,
      variantName: variant?.name ?? null,
      addonNames,
    };
  }
}
