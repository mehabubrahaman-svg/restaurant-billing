import {
  assertAcceptablePassword,
  assertAcceptablePin,
  BusinessDate,
  DEFAULT_GST_GROUPS,
  DomainError,
  liquorVatGroup,
  parseGstin,
  Role,
  ROLE_TEMPLATES,
  User,
} from '@restroos/domain';
import type { PasswordHasher } from '../identity/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { UnitOfWork } from '../ports/unit-of-work';
import type {
  IndianStateInfo,
  InstallationRepository,
  KeyDerivation,
  ReferenceData,
} from './ports';

export interface SetupInput {
  organization: { name: string; legalName?: string | undefined };
  branch: {
    name: string;
    code: string;
    stateCode: string;
    address?: string | undefined;
    phone?: string | undefined;
    gstin?: string | undefined;
  };
  liquor:
    | { enabled: false }
    | {
        enabled: true;
        vatTin: string;
        exciseLicenceNo: string;
        vatRateBp: number;
        surchargeBp: number;
        separateInvoice: boolean;
        overrideProhibition: boolean;
      };
  languages: { defaultLocale: string; receiptLanguages: string[] };
  admin: { username: string; fullName: string; password: string; pin?: string | undefined };
  backupPassphrase: string;
}

export interface SetupServiceDeps {
  readonly installation: InstallationRepository;
  readonly reference: ReferenceData;
  readonly hasher: PasswordHasher;
  readonly keys: KeyDerivation;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Rollout waves this installation may be set up in (docs/01 §5.11). */
  readonly enabledWaves: readonly number[];
  readonly timeZone: string;
}

/** First-time setup: turns an empty Hub into a working restaurant. Runs exactly once. */
export class SetupService {
  constructor(private readonly d: SetupServiceDeps) {}

  needsSetup(): boolean {
    return !this.d.installation.isInstalled();
  }

  availableStates(): IndianStateInfo[] {
    return this.d.reference.states().filter((s) => this.d.enabledWaves.includes(s.rolloutWave));
  }

  async run(input: SetupInput, client: { ipAddress: string | null; correlationId: string }) {
    if (!this.needsSetup())
      throw new DomainError('SETUP_ALREADY_DONE', 'this Hub is already set up');

    const state = this.availableStates().find((s) => s.gstStateCode === input.branch.stateCode);
    if (!state) {
      throw new DomainError(
        'STATE_NOT_AVAILABLE',
        `state ${input.branch.stateCode} is not available yet`,
      );
    }
    const gstin = input.branch.gstin ? parseGstin(input.branch.gstin, state.gstStateCode) : null;
    if (input.liquor.enabled && !state.liquorPermitted && !input.liquor.overrideProhibition) {
      throw new DomainError(
        'LIQUOR_NOT_PERMITTED_IN_STATE',
        `${state.name} is set up as a prohibition state; confirm the override to enable liquor`,
      );
    }
    assertAcceptablePassword(input.admin.password, input.admin.username);
    if (input.admin.pin) assertAcceptablePin(input.admin.pin);

    // Slow, async work happens before the transaction.
    const [passwordHash, pinHash, backupKey] = await Promise.all([
      this.d.hasher.hash(input.admin.password, 'password'),
      input.admin.pin ? this.d.hasher.hash(input.admin.pin, 'pin') : Promise.resolve(null),
      this.d.keys.deriveBackupKey(input.backupPassphrase),
    ]);

    const now = this.d.clock.now();
    const organizationId = this.d.ids.next();
    const branchId = this.d.ids.next();
    const roles = ROLE_TEMPLATES.map((t) =>
      Role.restore(this.d.ids.next(), 1, {
        organizationId,
        code: t.code,
        name: t.name,
        isSystem: true,
        isLocked: t.locked,
        permissions: new Set(t.permissions),
      }),
    );
    const adminRole = roles.find((r) => r.state.code === 'ADMIN')!;
    const admin = User.create(
      this.d.ids.next(),
      {
        organizationId,
        username: input.admin.username.trim().toLowerCase(),
        fullName: input.admin.fullName.trim(),
        phone: null,
        email: null,
        preferredLocale: input.languages.defaultLocale,
        passwordHash,
        pinHash,
        branchId,
        roleIds: [adminRole.id],
      },
      now,
    );

    const liquor = input.liquor;
    const taxGroups = [
      ...DEFAULT_GST_GROUPS.map((g, i) => ({ ...g, id: this.d.ids.next(), isDefault: i === 0 })),
      ...(liquor.enabled
        ? [
            {
              ...liquorVatGroup(liquor.vatRateBp, liquor.surchargeBp, liquor.separateInvoice),
              id: this.d.ids.next(),
              isDefault: false,
            },
          ]
        : []),
    ];
    const fiscalYear = BusinessDate.at(now, this.d.timeZone).fiscalYear();
    const code = input.branch.code.trim().toUpperCase();
    const documentSeries = [
      { series: 'INV', fiscalYear, prefix: `${code}/${fiscalYear}/` },
      { series: 'CN', fiscalYear, prefix: `${code}/CN/${fiscalYear}/` },
      ...(liquor.enabled && liquor.separateInvoice
        ? [{ series: 'LIQ', fiscalYear, prefix: `${code}/LIQ/${fiscalYear}/` }]
        : []),
    ];

    const plan = {
      organization: {
        id: organizationId,
        name: input.organization.name.trim(),
        legalName: input.organization.legalName?.trim() || null,
      },
      branch: {
        id: branchId,
        code,
        name: input.branch.name.trim(),
        stateCode: state.gstStateCode,
        address: input.branch.address?.trim() || null,
        phone: input.branch.phone?.trim() || null,
        gstin,
        vatTin: liquor.enabled ? liquor.vatTin.trim() : null,
        exciseLicenceNo: liquor.enabled ? liquor.exciseLicenceNo.trim() : null,
        defaultLocale: input.languages.defaultLocale,
        receiptLanguages: input.languages.receiptLanguages,
      },
      settings: {
        'billing.liquor_enabled': liquor.enabled,
        'billing.liquor_invoice': liquor.enabled && liquor.separateInvoice ? 'SEPARATE' : 'SAME',
        'billing.default_tax_group_id': taxGroups[0]!.id,
        'business.day_starts_at': '04:00',
        'receipt.header': input.organization.name.trim(),
        'receipt.footer': '',
      },
      roles,
      admin,
      taxGroups,
      documentSeries,
      salesChannel: { id: this.d.ids.next(), code: 'DIRECT', name: 'Direct' },
      backupKey,
      createdAt: now,
    };

    this.d.unitOfWork.run(
      { branchId, actorId: null, ipAddress: client.ipAddress, correlationId: client.correlationId },
      (scope) => {
        if (this.d.installation.isInstalled())
          throw new DomainError('SETUP_ALREADY_DONE', 'already set up');
        this.d.installation.create(plan);
        scope.recordEvents(admin.pullEvents());
        scope.audit({
          action: 'setup.complete',
          entityType: 'Organization',
          entityId: organizationId,
          after: {
            organization: plan.organization,
            branch: plan.branch,
            liquor: liquor.enabled
              ? {
                  vatRateBp: liquor.vatRateBp,
                  surchargeBp: liquor.surchargeBp,
                  separateInvoice: liquor.separateInvoice,
                }
              : null,
            adminUsername: admin.state.username,
            taxGroups: taxGroups.map((g) => g.name),
          },
        });
      },
    );
    return { organizationId, branchId, adminUserId: admin.id };
  }
}
