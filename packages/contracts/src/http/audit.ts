import { z } from 'zod';
import { IdSchema, pageSchema } from './common';

export const AuditLogEntrySchema = z.object({
  id: IdSchema,
  occurredAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actor: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  approver: z.object({ id: z.string(), fullName: z.string() }).nullable(),
  deviceId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export const AuditLogPageSchema = pageSchema(AuditLogEntrySchema);

export const AuditLogQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: IdSchema.optional(),
  action: z.string().optional(),
  /** ISO date-time bounds (inclusive from, exclusive to). */
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

export const AuditVerifyResponseSchema = z.object({
  ok: z.boolean(),
  rows: z.number().int(),
  brokenAtId: z.string().optional(),
  reason: z.string().optional(),
  checkedAt: z.string(),
});
export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>;
