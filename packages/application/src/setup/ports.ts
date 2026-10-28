import type { Role, TaxGroupTemplate, User } from '@restroos/domain';

export interface IndianStateInfo {
  readonly gstStateCode: string;
  readonly name: string;
  readonly region: string;
  readonly rolloutWave: number;
  readonly liquorPermitted: boolean;
  readonly liquorSeparateInvoice: boolean;
  readonly localLocales: readonly string[];
}

export interface ReferenceData {
  states(): IndianStateInfo[];
}

export interface BackupKeyMaterial {
  /** scrypt parameters + salt, stored with every backup so the passphrase can re-derive the key. */
  readonly kdf: string;
  readonly keyHex: string;
}

export interface KeyDerivation {
  deriveBackupKey(passphrase: string): Promise<BackupKeyMaterial>;
}

/** Everything first-time setup creates, decided by the application and written in one go. */
export interface InstallationPlan {
  readonly organization: { id: string; name: string; legalName: string | null };
  readonly branch: {
    id: string;
    code: string;
    name: string;
    stateCode: string;
    address: string | null;
    phone: string | null;
    gstin: string | null;
    vatTin: string | null;
    exciseLicenceNo: string | null;
    defaultLocale: string;
    receiptLanguages: readonly string[];
  };
  readonly settings: Readonly<Record<string, unknown>>;
  readonly roles: readonly Role[];
  readonly admin: User;
  readonly taxGroups: readonly (TaxGroupTemplate & { id: string; isDefault: boolean })[];
  readonly documentSeries: readonly { series: string; fiscalYear: string; prefix: string }[];
  readonly salesChannel: { id: string; code: string; name: string };
  readonly backupKey: BackupKeyMaterial;
  readonly createdAt: Date;
}

export interface InstallationRepository {
  isInstalled(): boolean;
  create(plan: InstallationPlan): void;
}
