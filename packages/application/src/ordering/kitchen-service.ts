import { DomainError, type Kot, type KotStatus } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { KitchenQueries, KotRepository } from './ports';

export interface KitchenServiceDeps {
  readonly kots: KotRepository;
  readonly queries: KitchenQueries;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/** KDS commands (docs/09 WP 4.2). */
export class KitchenService {
  constructor(private readonly d: KitchenServiceDeps) {}

  /** `servedOnly`: the caller is front-of-house (a captain), who may only mark food served. */
  setStatus(
    id: string,
    input: { to: Exclude<KotStatus, 'NEW' | 'CANCELLED'>; version: number },
    ctx: CommandContext,
    options: { servedOnly: boolean },
  ): Kot {
    if (options.servedOnly && input.to !== 'SERVED') {
      throw new DomainError('FORBIDDEN', 'only the kitchen moves a KOT before it is served', {
        permission: 'kds.update_status',
      });
    }
    return this.write(id, input.version, ctx, (kot, now) => {
      const from = kot.state.status;
      kot.moveTo(input.to, ctx.actorId, now);
      return {
        action: 'kitchen.kot.status',
        before: { status: from },
        after: { status: input.to },
      };
    });
  }

  bumpItem(id: string, itemId: string, ctx: CommandContext): Kot {
    return this.write(id, null, ctx, (kot, now) => {
      kot.bumpLine(itemId, ctx.actorId, now);
      return { action: 'kitchen.kot.item_ready', after: { itemId, kotStatus: kot.state.status } };
    });
  }

  assignChef(
    id: string,
    input: { chefId: string | null; version: number },
    ctx: CommandContext,
  ): Kot {
    if (input.chefId && !this.d.queries.isChef(ctx.branchId, input.chefId)) {
      throw new DomainError('VALIDATION_FAILED', 'that person does not work in the kitchen');
    }
    return this.write(id, input.version, ctx, (kot, now) => {
      const before = { chefId: kot.state.assignedChefId };
      kot.assignChef(input.chefId, now);
      return { action: 'kitchen.kot.assign', before, after: { chefId: input.chefId } };
    });
  }

  private write(
    id: string,
    expectedVersion: number | null,
    ctx: CommandContext,
    change: (kot: Kot, now: Date) => { action: string; before?: unknown; after: unknown },
  ): Kot {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const kot = this.d.kots.get(ctx.branchId, id);
      if (!kot) throw new DomainError('NOT_FOUND', 'KOT not found');
      if (expectedVersion !== null && kot.version !== expectedVersion) {
        throw new DomainError(
          'VERSION_CONFLICT',
          'this KOT was changed on another screen; it has been refreshed',
        );
      }
      const entry = change(kot, this.d.clock.now());
      this.d.kots.save(kot, ctx.actorId);
      scope.audit({ ...entry, entityType: 'Kot', entityId: kot.id });
      scope.recordEvents(kot.pullEvents());
      return kot;
    });
  }
}
