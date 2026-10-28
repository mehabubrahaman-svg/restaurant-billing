import { DomainError, parseGstin } from '@restroos/domain';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import { recordChanged } from '../shared-events';
import type {
  BranchSettingsRecord,
  ChargeRuleRecord,
  PrinterRecord,
  SettingsRepository,
  TaxComponentRecord,
  TaxGroupRecord,
} from './ports';

export interface SettingsServiceDeps {
  readonly settings: SettingsRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Restaurant configuration (permission settings.manage). Reads are open to any signed-in user. */
export class SettingsService {
  constructor(private readonly d: SettingsServiceDeps) {}

  branch(branchId: string): BranchSettingsRecord {
    const branch = this.d.settings.branch(branchId);
    if (!branch) throw new DomainError('NOT_FOUND', 'branch not found');
    return branch;
  }

  updateBranch(
    patch: Patch<
      Omit<BranchSettingsRecord, 'id' | 'code' | 'stateCode' | 'stateName' | 'liquorEnabled'>
    > & {
      version: number;
    },
    ctx: CommandContext,
  ): BranchSettingsRecord {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.branch(ctx.branchId);
      assertVersion(current.version, patch.version, 'branch settings');
      const next = merge<BranchSettingsRecord>(current, patch);
      if (patch.gstin) next.gstin = parseGstin(patch.gstin, current.stateCode);
      if (patch.liquorInvoice && !current.liquorEnabled) {
        throw new DomainError('LIQUOR_NOT_ENABLED', 'liquor is not enabled for this branch');
      }
      this.d.settings.updateBranch(ctx.branchId, next, this.d.clock.now());
      scope.recordEvents([
        recordChanged(
          'BranchSettingsChanged',
          'Branch',
          ctx.branchId,
          next.version,
          diff(current, next),
          this.d.clock.now(),
        ),
      ]);
      scope.audit({
        action: 'settings.branch.update',
        entityType: 'Branch',
        entityId: ctx.branchId,
        before: current,
        after: next,
      });
      return next;
    });
  }

  taxGroups(): TaxGroupRecord[] {
    return this.d.settings.taxGroups();
  }

  createTaxGroup(
    input: Omit<TaxGroupRecord, 'id' | 'isActive' | 'version'>,
    ctx: CommandContext,
  ): TaxGroupRecord {
    validateTaxGroup(input);
    return this.d.unitOfWork.run(ctx, (scope) => {
      const record: TaxGroupRecord = {
        ...input,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      this.d.settings.insertTaxGroup(record, this.d.clock.now());
      scope.recordEvents([
        recordChanged('TaxGroupCreated', 'TaxGroup', record.id, 1, record, this.d.clock.now()),
      ]);
      scope.audit({
        action: 'settings.tax_group.create',
        entityType: 'TaxGroup',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  updateTaxGroup(
    id: string,
    patch: Patch<Omit<TaxGroupRecord, 'id'>> & { version: number },
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.settings.taxGroup(id);
      if (!current) throw new DomainError('NOT_FOUND', 'tax group not found');
      assertVersion(current.version, patch.version, 'tax group');
      const next = merge<TaxGroupRecord>(current, patch);
      validateTaxGroup(next);
      this.d.settings.updateTaxGroup(next, this.d.clock.now());
      scope.recordEvents([
        recordChanged('TaxGroupChanged', 'TaxGroup', id, next.version, next, this.d.clock.now()),
      ]);
      scope.audit({
        action: 'settings.tax_group.update',
        entityType: 'TaxGroup',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  chargeRules(branchId: string): ChargeRuleRecord[] {
    return this.d.settings.chargeRules(branchId);
  }

  createChargeRule(
    input: Omit<ChargeRuleRecord, 'id' | 'isActive' | 'version'>,
    ctx: CommandContext,
  ) {
    validateCharge(input);
    return this.d.unitOfWork.run(ctx, (scope) => {
      this.assertTaxGroup(input.taxGroupId);
      const record: ChargeRuleRecord = {
        ...input,
        id: this.d.ids.next(),
        isActive: true,
        version: 1,
      };
      this.d.settings.insertChargeRule(ctx.branchId, record, this.d.clock.now());
      scope.recordEvents([
        recordChanged('ChargeRuleCreated', 'ChargeRule', record.id, 1, record, this.d.clock.now()),
      ]);
      scope.audit({
        action: 'settings.charge_rule.create',
        entityType: 'ChargeRule',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  updateChargeRule(
    id: string,
    patch: Patch<Omit<ChargeRuleRecord, 'id'>> & { version: number },
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.settings.chargeRule(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'charge rule not found');
      assertVersion(current.version, patch.version, 'charge rule');
      const next = merge<ChargeRuleRecord>(current, patch);
      validateCharge(next);
      this.assertTaxGroup(next.taxGroupId);
      this.d.settings.updateChargeRule(ctx.branchId, next, this.d.clock.now());
      scope.recordEvents([
        recordChanged(
          'ChargeRuleChanged',
          'ChargeRule',
          id,
          next.version,
          next,
          this.d.clock.now(),
        ),
      ]);
      scope.audit({
        action: 'settings.charge_rule.update',
        entityType: 'ChargeRule',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  printers(branchId: string): PrinterRecord[] {
    return this.d.settings.printers(branchId);
  }

  createPrinter(input: Omit<PrinterRecord, 'id' | 'isActive' | 'version'>, ctx: CommandContext) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const record: PrinterRecord = { ...input, id: this.d.ids.next(), isActive: true, version: 1 };
      this.d.settings.insertPrinter(ctx.branchId, record, this.d.clock.now());
      scope.recordEvents([
        recordChanged('PrinterCreated', 'Printer', record.id, 1, record, this.d.clock.now()),
      ]);
      scope.audit({
        action: 'settings.printer.create',
        entityType: 'Printer',
        entityId: record.id,
        after: record,
      });
      return record;
    });
  }

  updatePrinter(
    id: string,
    patch: Patch<Omit<PrinterRecord, 'id'>> & { version: number },
    ctx: CommandContext,
  ) {
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.settings.printer(ctx.branchId, id);
      if (!current) throw new DomainError('NOT_FOUND', 'printer not found');
      assertVersion(current.version, patch.version, 'printer');
      const next = merge<PrinterRecord>(current, patch);
      this.d.settings.updatePrinter(ctx.branchId, next, this.d.clock.now());
      scope.recordEvents([
        recordChanged('PrinterChanged', 'Printer', id, next.version, next, this.d.clock.now()),
      ]);
      scope.audit({
        action: 'settings.printer.update',
        entityType: 'Printer',
        entityId: id,
        before: current,
        after: next,
      });
      return next;
    });
  }

  /** Queues a test page; the print service (Sprint 5) picks up the event. */
  requestTestPrint(id: string, ctx: CommandContext): void {
    this.d.unitOfWork.run(ctx, (scope) => {
      const printer = this.d.settings.printer(ctx.branchId, id);
      if (!printer) throw new DomainError('NOT_FOUND', 'printer not found');
      scope.recordEvents([
        recordChanged(
          'PrinterTestRequested',
          'Printer',
          id,
          printer.version,
          { name: printer.name },
          this.d.clock.now(),
        ),
      ]);
    });
  }

  private assertTaxGroup(id: string | null): void {
    if (id !== null && !this.d.settings.taxGroup(id))
      throw new DomainError('NOT_FOUND', 'tax group not found');
  }
}

function assertVersion(current: number, expected: number, what: string): void {
  if (current !== expected) {
    throw new DomainError(
      'VERSION_CONFLICT',
      `this ${what} was changed by someone else; reload and try again`,
    );
  }
}

/** Applies the defined fields of a patch and bumps the version. */
function merge<T extends { version: number }>(current: T, patch: Patch<T>): T {
  const next: T = { ...current, version: current.version + 1 };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && key !== 'version') (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function diff<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(after).filter(
      ([k, v]) => JSON.stringify(v) !== JSON.stringify((before as Record<string, unknown>)[k]),
    ),
  ) as Partial<T>;
}

function validateTaxGroup(
  group: Pick<TaxGroupRecord, 'taxType' | 'components' | 'invoiceSeries'>,
): void {
  const codes = group.components.map((c: TaxComponentRecord) => c.code);
  if (group.taxType === 'GST' && codes.some((c) => c === 'VAT' || c === 'SURCHARGE')) {
    throw new DomainError('TAX_GROUP_INVALID', 'a GST group cannot contain VAT components');
  }
  if (group.taxType === 'VAT' && codes.some((c) => c === 'CGST' || c === 'SGST' || c === 'IGST')) {
    throw new DomainError('TAX_GROUP_INVALID', 'a VAT group cannot contain GST components');
  }
  if (group.taxType === 'GST') {
    const rate = (code: string) =>
      group.components.filter((c) => c.code === code).reduce((sum, c) => sum + c.rateBp, 0);
    if (rate('CGST') !== rate('SGST') || rate('CGST') + rate('SGST') !== rate('IGST')) {
      throw new DomainError('TAX_GROUP_INVALID', 'CGST and SGST must be equal and add up to IGST');
    }
  }
  if (group.invoiceSeries === 'LIQ' && group.taxType !== 'VAT') {
    throw new DomainError(
      'TAX_GROUP_INVALID',
      'only liquor (VAT) groups can use the LIQ invoice series',
    );
  }
}

function validateCharge(rule: Pick<ChargeRuleRecord, 'kind' | 'value'>): void {
  if (rule.kind === 'PERCENT' && rule.value > 100_00) {
    throw new DomainError('CHARGE_INVALID', 'a percentage charge cannot exceed 100%');
  }
}
