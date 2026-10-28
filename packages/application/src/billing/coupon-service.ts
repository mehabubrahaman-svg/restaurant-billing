import { DomainError } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { Patch } from '../patch';
import { recordChanged } from '../shared-events';
import type { CouponRecord, CouponRepository } from './ports';

type Coupon = CouponRecord & { version: number };
type CouponInput = Omit<CouponRecord, 'id' | 'usedCount' | 'isActive'>;

/** Coupon codes the cashier can apply at billing (Settings → Coupons). */
export class CouponService {
  constructor(
    private readonly d: {
      coupons: CouponRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  list(): Coupon[] {
    return this.d.coupons.all();
  }

  create(input: CouponInput, ctx: CommandContext): Coupon {
    return this.d.unitOfWork.run(ctx, (scope) => {
      this.check(input);
      if (this.d.coupons.byCode(input.code))
        throw new DomainError('DUPLICATE_NAME', `coupon ${input.code} already exists`);
      const now = this.d.clock.now();
      const coupon: Coupon = {
        ...input,
        id: this.d.ids.next(),
        usedCount: 0,
        isActive: true,
        version: 1,
      };
      this.d.coupons.insert(coupon, now);
      scope.recordEvents([recordChanged('CouponCreated', 'Coupon', coupon.id, 1, coupon, now)]);
      scope.audit({
        action: 'billing.coupon.create',
        entityType: 'Coupon',
        entityId: coupon.id,
        after: coupon,
      });
      return coupon;
    });
  }

  update(
    id: string,
    patch: Patch<CouponInput & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ): Coupon {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.coupons.get(id);
      if (!current) throw new DomainError('NOT_FOUND', 'coupon not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this coupon changed; reload');
      const next: Coupon = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      this.check(next);
      if (next.code !== current.code && this.d.coupons.byCode(next.code)) {
        throw new DomainError('DUPLICATE_NAME', `coupon ${next.code} already exists`);
      }
      const now = this.d.clock.now();
      this.d.coupons.update(next, now);
      scope.recordEvents([recordChanged('CouponChanged', 'Coupon', id, next.version, next, now)]);
      scope.audit({
        action: 'billing.coupon.update',
        entityType: 'Coupon',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  private check(c: CouponInput): void {
    if (c.kind === 'PERCENT' && c.value > 10_000)
      throw new DomainError('VALIDATION_FAILED', 'a coupon can’t exceed 100%');
    if (c.validFrom && c.validTo && c.validFrom > c.validTo) {
      throw new DomainError('VALIDATION_FAILED', 'the coupon ends before it starts');
    }
  }
}
