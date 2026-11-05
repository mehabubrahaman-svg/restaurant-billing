import { DomainError } from '@restroos/domain';
import type { CatalogRepository } from '../catalog/ports';
import type { FloorRepository } from '../floor/ports';
import type { PopularDishes } from '../ordering/qr-ordering';
import type { BusinessCalendar } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';

export type DishRatingStatus = 'PENDING' | 'COUNTED' | 'EXCLUDED';

/** One of the day's orders a guest's phone is on, as the rating screen needs it. */
export interface RatableOrder {
  orderId: string;
  orderNo: string;
  tableLabel: string | null;
  openedAt: string;
  captainId: string | null;
  captainName: string | null;
  customerId: string;
  /** Dishes on the order (not cancelled), each once, in the order they were added. */
  dishes: { menuItemId: string; name: string }[];
  rated: boolean;
}

export interface DishRatingRecord {
  id: string;
  menuItemId: string;
  stars: number;
  comment: string | null;
  status: DishRatingStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  version: number;
}

export interface OrderRatingRecord {
  id: string;
  branchId: string;
  orderId: string;
  customerId: string;
  captainId: string | null;
  captainStars: number | null;
  comment: string | null;
  businessDate: string;
  createdAt: string;
  dishes: DishRatingRecord[];
}

/** A rating as the admin reads it: with the order, the guest and the names. */
export interface OrderRatingView extends Omit<OrderRatingRecord, 'dishes' | 'customerId'> {
  orderNo: string;
  tableLabel: string | null;
  guestName: string | null;
  /** Last four digits only: the full number stays with the customer record. */
  guestPhoneLast4: string;
  captainName: string | null;
  dishes: (DishRatingRecord & { name: string })[];
}

export interface DishScore {
  menuItemId: string;
  /** Average of the counted ratings, to one decimal. */
  average: number;
  count: number;
}

export interface BestsellerEntry {
  menuItemId: string;
  published: boolean;
}

export interface RatingRepository {
  /** The branch's orders of that business day with this guest (E.164 phone), not cancelled, newest first. */
  ordersForPhone(branchId: string, businessDate: string, phone: string): RatableOrder[];
  insert(rating: OrderRatingRecord): void;
  list(
    branchId: string,
    filter: { from: string; to: string; status: DishRatingStatus | 'ALL' },
  ): OrderRatingView[];
  /** Sets the status of these dish ratings of the branch; returns those it changed. */
  review(
    branchId: string,
    ids: readonly string[],
    status: DishRatingStatus,
    by: string | null,
    at: string,
  ): string[];
  /** Counted dish ratings of the branch, per dish. */
  dishScores(branchId: string): DishScore[];
  /** Per captain and per dish, for ratings made from `from` to `to` (business dates). */
  summary(
    branchId: string,
    from: string,
    to: string,
  ): {
    captains: { captainId: string; name: string; ratings: number; average: number }[];
    dishes: {
      menuItemId: string;
      name: string;
      counted: number;
      average: number | null;
      pending: number;
      excluded: number;
    }[];
  };
  bestsellers(branchId: string): BestsellerEntry[];
  replaceBestsellers(
    branchId: string,
    entries: readonly BestsellerEntry[],
    by: string | null,
    at: string,
  ): void;
}

export interface GuestRatingInput {
  orderId: string;
  phone: string;
  captainStars: number | null;
  comment?: string | undefined;
  dishes: { menuItemId: string; stars: number; comment?: string | undefined }[];
}

/** The bestseller list's limit: a strip on a phone, not a second menu. */
export const MAX_BESTSELLERS = 12;
/** Suggestions look at this many days of orders. */
export const SUGGESTION_DAYS = 30;

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/**
 * Guest ratings (docs/08 Phase 5): the captain puts the guest's phone on the
 * order; that day, the guest finds the order on the table's QR page by the
 * phone and rates the captain and the dishes, once. An admin reads them all,
 * counts the dish ratings that should show on the menu (or leaves them out),
 * and keeps the published bestseller list.
 */
export class GuestRatingService {
  constructor(
    private readonly d: {
      ratings: RatingRepository;
      floor: FloorRepository;
      catalog: CatalogRepository;
      calendar: BusinessCalendar;
      popular: PopularDishes;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  // ---- the guest's phone -------------------------------------------------------------

  /** Today's orders with this phone at the branch of the table's code. */
  lookup(token: string, phone: string) {
    const table = this.tableFor(token);
    const today = this.d.calendar.businessDate(table.branchId, this.d.clock.now());
    return this.d.ratings.ordersForPhone(table.branchId, today, phone).map((o) => ({
      id: o.orderId,
      orderNo: o.orderNo,
      tableLabel: o.tableLabel,
      openedAt: o.openedAt,
      // A first name is enough to know who served you; the rest stays with the staff list.
      captainName: firstName(o.captainName),
      rated: o.rated,
      dishes: o.dishes.map((dish) => {
        const item = this.d.catalog.item(table.branchId, dish.menuItemId);
        return {
          menuItemId: dish.menuItemId,
          name: dish.name,
          nameTranslations: item?.nameTranslations ?? {},
          imageId: item?.imageId ?? null,
        };
      }),
    }));
  }

  rate(
    token: string,
    input: GuestRatingInput,
    meta: { ipAddress: string | null; correlationId: string },
  ): OrderRatingRecord {
    const table = this.tableFor(token);
    const ctx: CommandContext = {
      branchId: table.branchId,
      actorId: null,
      ipAddress: meta.ipAddress,
      correlationId: meta.correlationId,
    };
    return this.d.unitOfWork.run(ctx, (scope) => {
      const now = this.d.clock.now();
      const today = this.d.calendar.businessDate(table.branchId, now);
      // The order must be today's and carry this phone: the same check as the look-up.
      const order = this.d.ratings
        .ordersForPhone(table.branchId, today, input.phone)
        .find((o) => o.orderId === input.orderId);
      if (!order) throw new DomainError('NOT_FOUND', 'no order of today with this phone');
      if (order.rated) throw new DomainError('ALREADY_RATED', 'this order is already rated');
      const onOrder = new Set(order.dishes.map((d) => d.menuItemId));
      const seen = new Set<string>();
      for (const dish of input.dishes) {
        if (!onOrder.has(dish.menuItemId))
          throw new DomainError('VALIDATION_FAILED', 'rate only the dishes on this order');
        if (seen.has(dish.menuItemId)) throw new DomainError('VALIDATION_FAILED', 'each dish once');
        seen.add(dish.menuItemId);
      }
      if (input.captainStars === null && input.dishes.length === 0)
        throw new DomainError('VALIDATION_FAILED', 'give at least one rating');
      const record: OrderRatingRecord = {
        id: this.d.ids.next(),
        branchId: table.branchId,
        orderId: order.orderId,
        customerId: order.customerId,
        captainId: order.captainId,
        captainStars: input.captainStars,
        comment: input.comment?.trim() || null,
        businessDate: today,
        createdAt: now.toISOString(),
        dishes: input.dishes.map((dish) => ({
          id: this.d.ids.next(),
          menuItemId: dish.menuItemId,
          stars: dish.stars,
          comment: dish.comment?.trim() || null,
          status: 'PENDING',
          reviewedAt: null,
          reviewedBy: null,
          version: 1,
        })),
      };
      this.d.ratings.insert(record);
      scope.recordEvents([
        recordChanged(
          'OrderRated',
          'OrderRating',
          record.id,
          1,
          {
            orderId: record.orderId,
            captainStars: record.captainStars,
            dishes: record.dishes.length,
          },
          now,
        ),
      ]);
      return record;
    });
  }

  // ---- the admin -------------------------------------------------------------------------

  list(branchId: string, filter: { from: string; to: string; status: DishRatingStatus | 'ALL' }) {
    return this.d.ratings.list(branchId, filter);
  }

  /** Counts dish ratings toward the stars on the menu, leaves them out, or puts them back to decide. */
  review(ids: readonly string[], status: DishRatingStatus, ctx: CommandContext): number {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const at = this.d.clock.now().toISOString();
      const changed = this.d.ratings.review(ctx.branchId, ids, status, ctx.actorId, at);
      for (const id of changed) {
        scope.audit({
          action: 'crm.dish_rating.review',
          entityType: 'DishRating',
          entityId: id,
          after: { status },
        });
      }
      return changed.length;
    });
  }

  summary(branchId: string, from: string, to: string) {
    return this.d.ratings.summary(branchId, from, to);
  }

  /** The list as kept, and dishes worth adding: ordered most lately, with their stars. */
  bestsellers(branchId: string) {
    const items = this.d.catalog.items(branchId, true);
    const byId = new Map(items.map((i) => [i.id, i]));
    const scores = new Map(this.d.ratings.dishScores(branchId).map((s) => [s.menuItemId, s]));
    const list = this.d.ratings.bestsellers(branchId).filter((e) => byId.has(e.menuItemId));
    const listed = new Set(list.map((e) => e.menuItemId));
    const since = new Date(
      this.d.clock.now().getTime() - SUGGESTION_DAYS * 86_400_000,
    ).toISOString();
    const ordered = this.d.popular.top(branchId, since, 40, 1);
    const view = (id: string) => {
      const item = byId.get(id)!;
      const score = scores.get(id);
      return {
        menuItemId: id,
        name: item.name,
        foodType: item.foodType,
        imageId: item.imageId,
        isActive: item.isActive,
        average: score?.average ?? null,
        ratings: score?.count ?? 0,
      };
    };
    return {
      items: list.map((e) => ({ ...view(e.menuItemId), published: e.published })),
      suggestions: ordered
        .map((o, rank) => ({ id: o, rank }))
        .filter((o) => !listed.has(o.id) && byId.get(o.id)?.isActive)
        .slice(0, 20)
        .map((o) => ({ ...view(o.id), rank: o.rank + 1 })),
    };
  }

  /** Replaces the list: the order given is the order shown; published ones go on the menu. */
  setBestsellers(entries: readonly BestsellerEntry[], ctx: CommandContext) {
    if (entries.length > MAX_BESTSELLERS)
      throw new DomainError('VALIDATION_FAILED', `at most ${MAX_BESTSELLERS} bestsellers`);
    const ids = entries.map((e) => e.menuItemId);
    if (new Set(ids).size !== ids.length)
      throw new DomainError('VALIDATION_FAILED', 'each dish once');
    for (const id of ids) {
      if (!this.d.catalog.item(ctx.branchId, id))
        throw new DomainError('NOT_FOUND', 'that dish is not on the menu');
    }
    return this.d.unitOfWork.run(ctx, (scope) => {
      const before = this.d.ratings.bestsellers(ctx.branchId);
      this.d.ratings.replaceBestsellers(
        ctx.branchId,
        entries,
        ctx.actorId,
        this.d.clock.now().toISOString(),
      );
      scope.audit({
        action: 'crm.bestsellers.update',
        entityType: 'Branch',
        entityId: ctx.branchId,
        before: { items: before },
        after: { items: entries },
      });
      return this.bestsellers(ctx.branchId);
    });
  }

  private tableFor(token: string) {
    const table = this.d.floor.tableByQrToken(token);
    if (!table || !table.isActive)
      throw new DomainError('NOT_FOUND', 'this QR code is not in use; ask a server');
    return table;
  }
}
