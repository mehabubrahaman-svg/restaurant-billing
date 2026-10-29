import { DomainError, nextTier, tierReached, type MembershipTier } from '@restroos/domain';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';

export interface MembershipTierRecord extends MembershipTier {
  version: number;
}

export interface MembershipTierRepository {
  /** Every tier, active or not. */
  all(): MembershipTierRecord[];
  get(id: string): MembershipTierRecord | undefined;
  byName(name: string): MembershipTierRecord | undefined;
  insert(record: MembershipTierRecord, actorId: string | null, at: Date): void;
  /** Version-checked. */
  update(record: MembershipTierRecord, actorId: string | null, at: Date): void;
}

/** A guest's tier, and whether a manager gave it by hand. */
export interface GuestTier {
  id: string;
  name: string;
  discountBp: number;
  pointsMultiplierBp: number;
  pinned: boolean;
}

interface Guest {
  membershipTierId: string | null;
  lifetimeValue: number;
  visitCount: number;
}

/**
 * The tier a manager pinned (while it is active), else the highest one the
 * guest's lifetime spend and visits reach.
 */
export function guestTier(tiers: readonly MembershipTierRecord[], guest: Guest): GuestTier | null {
  const pinned = tiers.find((t) => t.id === guest.membershipTierId && t.isActive);
  const tier = pinned ?? tierReached(tiers, guest);
  if (!tier) return null;
  return {
    id: tier.id,
    name: tier.name,
    discountBp: tier.discountBp,
    pointsMultiplierBp: tier.pointsMultiplierBp,
    pinned: pinned !== undefined,
  };
}

/** The next tier by spend and visits, and what is still needed (none above a pinned tier). */
export function guestNextTier(tiers: readonly MembershipTierRecord[], guest: Guest) {
  const current = guestTier(tiers, guest);
  if (current?.pinned) return null;
  const reached = current ? (tiers.find((t) => t.id === current.id) ?? null) : null;
  const next = nextTier(tiers, reached, guest);
  return (
    next && { name: next.tier.name, spendNeeded: next.spendNeeded, visitsNeeded: next.visitsNeeded }
  );
}

type TierInput = Omit<MembershipTierRecord, 'id' | 'isActive' | 'version'>;

/** Silver, Gold …: tiers guests reach by spend and visits (docs/08 Phase 5). */
export class MembershipService {
  constructor(
    private readonly d: {
      tiers: MembershipTierRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  list(): MembershipTierRecord[] {
    return this.d.tiers.all();
  }

  create(input: TierInput, ctx: CommandContext): MembershipTierRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (this.d.tiers.byName(input.name))
        throw new DomainError('DUPLICATE_NAME', `a tier named ${input.name} exists`);
      const record: MembershipTierRecord = {
        ...input,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      const now = this.d.clock.now();
      this.d.tiers.insert(record, ctx.actorId, now);
      scope.recordEvents([
        recordChanged('MembershipTierCreated', 'MembershipTier', record.id, 1, record, now),
      ]);
      scope.audit({
        action: 'crm.tier.create',
        entityType: 'MembershipTier',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  update(
    id: string,
    patch: Patch<TierInput & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ): MembershipTierRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.tiers.get(id);
      if (!current) throw new DomainError('NOT_FOUND', 'membership tier not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this tier changed; reload');
      const next: MembershipTierRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      const clash = this.d.tiers.byName(next.name);
      if (clash && clash.id !== id)
        throw new DomainError('DUPLICATE_NAME', `a tier named ${next.name} exists`);
      const now = this.d.clock.now();
      this.d.tiers.update(next, ctx.actorId, now);
      scope.recordEvents([
        recordChanged('MembershipTierChanged', 'MembershipTier', id, next.version, next, now),
      ]);
      scope.audit({
        action: 'crm.tier.update',
        entityType: 'MembershipTier',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }
}
