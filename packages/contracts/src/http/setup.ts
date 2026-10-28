import { z } from 'zod';
import { LocaleSchema, ReceiptLanguageSchema } from './common';

export const IndianStateSchema = z.object({
  gstStateCode: z.string(),
  name: z.string(),
  region: z.string(),
  rolloutWave: z.number().int(),
  liquorPermitted: z.boolean(),
  liquorSeparateInvoice: z.boolean(),
  localLocales: z.array(z.string()),
});
export type IndianState = z.infer<typeof IndianStateSchema>;

export const SetupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
  /** States offered by this installation (enabled rollout waves only). */
  states: z.array(IndianStateSchema),
});
export type SetupStatusResponse = z.infer<typeof SetupStatusResponseSchema>;

/** 15-character GSTIN, e.g. 19AABCU9603R1ZX. The server also checks the check digit and state. */
export const GstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'not a valid GSTIN format');

export const PasswordSchema = z.string().min(8, 'at least 8 characters').max(256);

export const SetupRequestSchema = z.object({
  /** One-time code shown on the Hub's screen/console at first start. */
  setupCode: z.string().min(6).max(32),
  organization: z.object({
    name: z.string().trim().min(2).max(120),
    legalName: z.string().trim().max(200).optional(),
  }),
  branch: z.object({
    name: z.string().trim().min(2).max(120),
    /** Short code printed in invoice numbers, e.g. KOL1. */
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,8}$/, '2 to 8 letters or digits'),
    stateCode: z.string().regex(/^\d{2}$/),
    address: z.string().trim().max(400).optional(),
    phone: z.string().trim().max(20).optional(),
    gstin: GstinSchema.optional(),
  }),
  liquor: z.discriminatedUnion('enabled', [
    z.object({ enabled: z.literal(false) }),
    z.object({
      enabled: z.literal(true),
      vatTin: z.string().trim().min(5).max(20),
      exciseLicenceNo: z.string().trim().min(3).max(40),
      /** State VAT on liquor, in basis points. No default: confirm with your tax advisor. */
      vatRateBp: z.number().int().min(1).max(100_00),
      surchargeBp: z.number().int().min(0).max(100_00).default(0),
      separateInvoice: z.boolean(),
      /** Required to enable liquor in a state seeded as prohibition. */
      overrideProhibition: z.boolean().default(false),
    }),
  ]),
  languages: z.object({
    defaultLocale: LocaleSchema,
    receiptLanguages: z.array(ReceiptLanguageSchema).min(1).max(2),
  }),
  admin: z.object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,32}$/, '3 to 32 lowercase letters, digits, . _ -'),
    fullName: z.string().trim().min(2).max(120),
    password: PasswordSchema,
    pin: z
      .string()
      .regex(/^\d{4,6}$/)
      .optional(),
  }),
  /** Encrypts backups. Needed to restore on a new PC; it cannot be recovered. */
  backupPassphrase: z.string().min(12, 'at least 12 characters').max(256),
});
export type SetupRequest = z.input<typeof SetupRequestSchema>;

export const SetupResponseSchema = z.object({
  organizationId: z.uuid(),
  branchId: z.uuid(),
  adminUserId: z.uuid(),
});
export type SetupResponse = z.infer<typeof SetupResponseSchema>;
