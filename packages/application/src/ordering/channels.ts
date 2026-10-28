import { DomainError } from '@restroos/domain';
import type { Patch } from '../patch';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';

export interface SalesChannelRecord {
  id: string;
  code: string;
  name: string;
  kind: 'DIRECT' | 'AGGREGATOR' | 'OWN_ONLINE';
  integration: 'MANUAL' | 'MIDDLEWARE' | 'DIRECT_API';
  /** The aggregator's cut, for net revenue in reports. */
  commissionBp: number;
  /** Menu prices on the channel are this much higher than in the restaurant. */
  priceMarkupBp: number;
  /** CGST Act s.9(5): the operator pays GST on restaurant food sold through it. */
  gstPaidByOperator: boolean;
  isActive: boolean;
  version: number;
}

export interface SalesChannelRepository {
  all(): SalesChannelRecord[];
  get(id: string): SalesChannelRecord | undefined;
  byCode(code: string): SalesChannelRecord | undefined;
  insert(record: SalesChannelRecord, at: Date): void;
  /** Version-checked. */
  update(record: SalesChannelRecord, at: Date): void;
  /** An order already entered with this channel's order id (even if cancelled: the id is never reused). */
  existingOrderId(channelId: string, externalOrderId: string): string | undefined;
}

type ChannelInput = Omit<SalesChannelRecord, 'id' | 'isActive' | 'version' | 'integration'>;

/** Swiggy, Zomato, magicpin … entered by hand at the counter in Phase 1 (docs/01 §5.10). */
export class SalesChannelService {
  constructor(
    private readonly d: {
      channels: SalesChannelRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  list(): SalesChannelRecord[] {
    return this.d.channels.all();
  }

  create(input: ChannelInput, ctx: CommandContext): SalesChannelRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      if (this.d.channels.byCode(input.code))
        throw new DomainError('DUPLICATE_NAME', `channel ${input.code} already exists`);
      const record: SalesChannelRecord = {
        ...input,
        integration: 'MANUAL',
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      const now = this.d.clock.now();
      this.d.channels.insert(record, now);
      scope.recordEvents([
        recordChanged('SalesChannelCreated', 'SalesChannel', record.id, 1, record, now),
      ]);
      scope.audit({
        action: 'ordering.channel.create',
        entityType: 'SalesChannel',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  update(
    id: string,
    patch: Patch<ChannelInput & { isActive: boolean }> & { version: number },
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.channels.get(id);
      if (!current) throw new DomainError('NOT_FOUND', 'sales channel not found');
      if (current.version !== patch.version)
        throw new DomainError('VERSION_CONFLICT', 'this channel changed; reload');
      if (current.code === 'DIRECT' && (patch.code !== undefined || patch.isActive === false)) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'the direct channel can’t be renamed or retired',
        );
      }
      const next: SalesChannelRecord = { ...current, version: current.version + 1 };
      for (const [k, v] of Object.entries(patch))
        if (v !== undefined && k !== 'version') (next as unknown as Record<string, unknown>)[k] = v;
      const now = this.d.clock.now();
      this.d.channels.update(next, now);
      scope.recordEvents([
        recordChanged('SalesChannelChanged', 'SalesChannel', id, next.version, next, now),
      ]);
      scope.audit({
        action: 'ordering.channel.update',
        entityType: 'SalesChannel',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }
}
