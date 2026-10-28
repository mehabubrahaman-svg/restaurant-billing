import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  serverTime: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  database: z.object({
    ok: z.boolean(),
    schemaVersion: z.number().int().nonnegative(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
