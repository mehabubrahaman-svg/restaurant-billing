import { assertManualTransition, DomainError, isTableInUse } from '@restroos/domain';
import type { TokenCodec } from '../identity/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, TransactionScope, UnitOfWork } from '../ports/unit-of-work';
import type { Patch } from '../patch';
import { recordChanged } from '../shared-events';
import type { FloorAreaRecord, FloorRepository, TableRecord } from './ports';

export interface FloorServiceDeps {
  readonly floor: FloorRepository;
  readonly tokens: TokenCodec;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

type TableInput = Pick<TableRecord, 'floorAreaId' | 'label' | 'seats' | 'shape' | 'posX' | 'posY'>;

/** Floor plan, table layout and the hand-set table statuses. */
export class FloorService {
  constructor(private readonly d: FloorServiceDeps) {}

  floor(branchId: string): (FloorAreaRecord & { tables: TableRecord[] })[] {
    const tables = this.d.floor.tables(branchId);
    return this.d.floor
      .areas(branchId)
      .map((area) => ({ ...area, tables: tables.filter((t) => t.floorAreaId === area.id) }));
  }

  createArea(input: { name: string; sortOrder: number }, ctx: CommandContext): FloorAreaRecord {
    return this.write(ctx, (scope, now) => {
      const record: FloorAreaRecord = {
        id: this.d.ids.next(),
        name: input.name.trim(),
        sortOrder: input.sortOrder,
        isActive: true,
        version: 1,
      };
      this.d.floor.insertArea(ctx.branchId, record, now);
      this.log(scope, 'FloorArea', 'floor.area.create', record.id, 1, undefined, record, now);
      return record;
    });
  }

  updateArea(
    id: string,
    patch: {
      version: number;
      name?: string | undefined;
      sortOrder?: number | undefined;
      isActive?: boolean | undefined;
    },
    ctx: CommandContext,
  ): FloorAreaRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.d.floor.area(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'floor area not found');
      assertVersion(current.version, patch.version, 'floor area');
      const next: FloorAreaRecord = {
        ...current,
        name: patch.name?.trim() ?? current.name,
        sortOrder: patch.sortOrder ?? current.sortOrder,
        isActive: patch.isActive ?? current.isActive,
        version: current.version + 1,
      };
      if (current.isActive && !next.isActive) {
        const active = this.d.floor
          .tables(ctx.branchId)
          .filter((t) => t.floorAreaId === id && t.isActive);
        if (active.length > 0)
          throw new DomainError('AREA_HAS_TABLES', 'move or retire its tables first');
      }
      this.d.floor.updateArea(ctx.branchId, next, now);
      this.log(scope, 'FloorArea', 'floor.area.update', id, next.version, current, next, now);
      return next;
    });
  }

  createTable(input: TableInput, ctx: CommandContext): TableRecord {
    return this.write(ctx, (scope, now) => {
      this.assertArea(ctx.branchId, input.floorAreaId);
      this.assertLabelFree(ctx.branchId, input.label, null);
      const record: TableRecord = {
        ...input,
        label: input.label.trim(),
        id: this.d.ids.next(),
        status: 'AVAILABLE',
        currentOrderId: null,
        qrToken: null,
        isActive: true,
        version: 1,
      };
      this.d.floor.insertTable(ctx.branchId, record, now);
      this.log(
        scope,
        'DiningTable',
        'floor.table.create',
        record.id,
        1,
        undefined,
        publicTable(record),
        now,
      );
      return record;
    });
  }

  updateTable(
    id: string,
    patch: Patch<TableInput> & { version: number; isActive?: boolean | undefined },
    ctx: CommandContext,
  ): TableRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.loadTable(ctx.branchId, id, patch.version);
      const next: TableRecord = {
        ...current,
        floorAreaId: patch.floorAreaId ?? current.floorAreaId,
        label: (patch.label ?? current.label).trim(),
        seats: patch.seats ?? current.seats,
        shape: patch.shape ?? current.shape,
        posX: patch.posX ?? current.posX,
        posY: patch.posY ?? current.posY,
        isActive: patch.isActive ?? current.isActive,
        version: current.version + 1,
      };
      if (next.floorAreaId !== current.floorAreaId) this.assertArea(ctx.branchId, next.floorAreaId);
      if (
        next.label.toLowerCase() !== current.label.toLowerCase() ||
        (!current.isActive && next.isActive)
      ) {
        this.assertLabelFree(ctx.branchId, next.label, id);
      }
      const retiring = current.isActive && !next.isActive;
      const moving = next.floorAreaId !== current.floorAreaId;
      if ((retiring || moving) && isTableInUse(current.status)) {
        throw new DomainError('TABLE_IN_USE', `${current.label} has guests or an open bill`);
      }
      this.d.floor.updateTable(ctx.branchId, next, now);
      this.log(
        scope,
        'DiningTable',
        'floor.table.update',
        id,
        next.version,
        publicTable(current),
        publicTable(next),
        now,
      );
      return next;
    });
  }

  /** Drag-and-drop save: every move applies, or none (any stale version fails the lot). */
  saveLayout(
    moves: { id: string; posX: number; posY: number; version: number }[],
    ctx: CommandContext,
  ): TableRecord[] {
    return this.write(ctx, (scope, now) => {
      const updated = moves.map((move) => {
        const current = this.loadTable(ctx.branchId, move.id, move.version);
        const next = { ...current, posX: move.posX, posY: move.posY, version: current.version + 1 };
        this.d.floor.updateTable(ctx.branchId, next, now);
        scope.recordEvents([
          recordChanged(
            'DiningTableMoved',
            'DiningTable',
            next.id,
            next.version,
            { posX: next.posX, posY: next.posY },
            now,
          ),
        ]);
        return next;
      });
      scope.audit({
        action: 'floor.layout.save',
        entityType: 'Branch',
        entityId: ctx.branchId,
        after: { moved: moves.map((m) => ({ id: m.id, posX: m.posX, posY: m.posY })) },
      });
      return updated;
    });
  }

  setStatus(id: string, status: string, version: number, ctx: CommandContext): TableRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.loadTable(ctx.branchId, id, version);
      if (!current.isActive) throw new DomainError('NOT_FOUND', 'table not found');
      assertManualTransition(current.status, status);
      const next: TableRecord = { ...current, status, version: current.version + 1 };
      this.d.floor.updateTable(ctx.branchId, next, now);
      scope.recordEvents([
        recordChanged(
          'TableStatusChanged',
          'DiningTable',
          id,
          next.version,
          { from: current.status, to: status },
          now,
        ),
      ]);
      scope.audit({
        action: 'floor.table.status',
        entityType: 'DiningTable',
        entityId: id,
        before: { status: current.status },
        after: { status },
      });
      return next;
    });
  }

  /** Issues a new QR token for a table; previously printed QR codes stop working. */
  rotateQr(id: string, ctx: CommandContext): TableRecord {
    return this.write(ctx, (scope, now) => {
      const current = this.d.floor.table(ctx.branchId, id);
      if (!current || !current.isActive) throw new DomainError('NOT_FOUND', 'table not found');
      const next: TableRecord = {
        ...current,
        qrToken: this.d.tokens.generate().token.slice(0, 22),
        version: current.version + 1,
      };
      this.d.floor.updateTable(ctx.branchId, next, now);
      scope.recordEvents([
        recordChanged('TableQrRotated', 'DiningTable', id, next.version, {}, now),
      ]);
      scope.audit({ action: 'floor.table.qr_rotate', entityType: 'DiningTable', entityId: id });
      return next;
    });
  }

  table(branchId: string, id: string): TableRecord {
    const table = this.d.floor.table(branchId, id);
    if (!table) throw new DomainError('NOT_FOUND', 'table not found');
    return table;
  }

  private loadTable(branchId: string, id: string, version: number): TableRecord {
    const table = this.table(branchId, id);
    assertVersion(table.version, version, `table ${table.label}`);
    return table;
  }

  private assertArea(branchId: string, areaId: string): void {
    if (!this.d.floor.area(branchId, areaId)?.isActive)
      throw new DomainError('NOT_FOUND', 'floor area not found');
  }

  private assertLabelFree(branchId: string, label: string, selfId: string | null): void {
    const owner = this.d.floor.tableIdByLabel(branchId, label.trim());
    if (owner && owner !== selfId)
      throw new DomainError('TABLE_LABEL_TAKEN', `there is already a table ${label}`);
  }

  private write<T>(ctx: CommandContext, work: (scope: TransactionScope, now: Date) => T): T {
    return this.d.unitOfWork.run(ctx, (scope) => work(scope, this.d.clock.now()));
  }

  private log(
    scope: TransactionScope,
    type: string,
    action: string,
    id: string,
    version: number,
    before: unknown,
    after: unknown,
    at: Date,
  ): void {
    const verb = action.endsWith('create') ? 'Created' : 'Changed';
    scope.recordEvents([recordChanged(`${type}${verb}`, type, id, version, after, at)]);
    scope.audit({ action, entityType: type, entityId: id, before, after });
  }
}

/** QR tokens never go into events or the audit log. */
function publicTable(table: TableRecord) {
  const { qrToken: _token, ...rest } = table;
  return { ...rest, hasQr: table.qrToken !== null };
}

function assertVersion(current: number, expected: number, what: string): void {
  if (current !== expected) {
    throw new DomainError(
      'VERSION_CONFLICT',
      `${what} was changed by someone else; reload and try again`,
    );
  }
}
