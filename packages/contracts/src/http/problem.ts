import { z } from 'zod';

/** RFC 9457 problem details, the body of every error response. */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  /** Stable machine-readable code, e.g. VERSION_CONFLICT. */
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** For FORBIDDEN / APPROVAL_REQUIRED: the permission the request needed. */
  permission: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/** Error codes the API can return, with their HTTP status (docs/05-api-specification.md §1). */
export const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  /** Wrong username/password/PIN. Deliberately does not say which. */
  INVALID_CREDENTIALS: 401,
  ACCOUNT_DISABLED: 403,
  /** Too many failed attempts; `detail` says until when. */
  ACCOUNT_LOCKED: 423,
  INVALID_SETUP_CODE: 403,
  SETUP_ALREADY_DONE: 409,
  FORBIDDEN: 403,
  /** The caller lacks the permission but a manager may approve: retry with X-Approver-Token. */
  APPROVAL_REQUIRED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
