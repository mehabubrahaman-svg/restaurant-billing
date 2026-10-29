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
  /** PIN sign-in is only offered on paired devices (and on the Hub itself). */
  DEVICE_NOT_PAIRED: 403,
  PAIRING_CODE_INVALID: 403,
  FORBIDDEN: 403,
  /** The caller lacks the permission but a manager may approve: retry with X-Approver-Token. */
  APPROVAL_REQUIRED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  INSUFFICIENT_STOCK: 409,
  /** The table already has guests, a bill, or is blocked. */
  TABLE_NOT_FREE: 409,
  /** Another booking holds the table within 2 hours of that time. */
  TABLE_ALREADY_RESERVED: 409,
  /** The order is billed, paid or cancelled; it can't change. */
  ORDER_NOT_OPEN: 409,
  /** Only items still on the order pad can be edited. */
  ITEM_ALREADY_SENT: 409,
  NOTHING_TO_FIRE: 409,
  /** 86'd in this branch, or retired. */
  ITEM_UNAVAILABLE: 409,
  /** Send or remove items still on the pad before billing. */
  ORDER_HAS_UNSENT_ITEMS: 409,
  /** The payments add up to more than is owed. */
  OVERPAYMENT: 409,
  /** Cash needs an open cash shift on this device. */
  SHIFT_NOT_OPEN: 409,
  SHIFT_ALREADY_OPEN: 409,
  COUPON_INVALID: 422,
  /** The guest has fewer points than the bill tries to spend. */
  LOYALTY_INSUFFICIENT: 409,
  /** Loyalty points are off for this branch (Admin → Branch). */
  LOYALTY_DISABLED: 409,
  /** A table's earlier QR requests are still waiting for a captain. */
  QR_TOO_MANY_REQUESTS: 429,
  /** Another captain already accepted or declined this QR request. */
  QR_REQUEST_HANDLED: 409,
  /** That aggregator order id was already entered. */
  DUPLICATE_EXTERNAL_ORDER: 409,
  /** Liquor can't be sold through Swiggy/Zomato: VAT liquor isn't an aggregator supply. */
  LIQUOR_NOT_FOR_DELIVERY: 422,
  /** The backup file is gone or fails its checksum. */
  BACKUP_UNAVAILABLE: 422,
  /** The passphrase does not open this backup, or the file is not a RestroOS backup. */
  BACKUP_UNREADABLE: 422,
  /** Another inventory item (or menu item) already uses this SKU. */
  SKU_TAKEN: 409,
  /** The dish (or this size of it) already has a recipe: edit that one. */
  RECIPE_EXISTS: 409,
  /** A recipe or add-on still uses the item: remove it there before retiring the item. */
  INGREDIENT_IN_USE: 409,
  /** Opening stock is entered once, before the item is first received; use an adjustment or a count. */
  STOCK_ALREADY_MOVED: 409,
  /** The unit measures something else (kg for an item kept in pieces). */
  UNIT_MISMATCH: 422,
  /** Another vendor already has this code. */
  VENDOR_CODE_TAKEN: 409,
  /** Another account already has this code. */
  ACCOUNT_CODE_TAKEN: 409,
  /** Automatic postings use this account: it can't be retired or change type. */
  SYSTEM_ACCOUNT: 409,
  /** The debits and the credits of a journal entry differ. */
  JOURNAL_UNBALANCED: 422,
  /** The entry was already reversed, or is itself a reversal. */
  ALREADY_REVERSED: 409,
  /** No active printer for this purpose is set up. */
  NO_PRINTER: 409,
  /** The printer didn't answer (off, out of paper, wrong address). */
  PRINTER_OFFLINE: 503,
  /** A Bluetooth LE printer is driven by the tablet it's paired with. */
  PRINTER_ON_DEVICE: 409,
  PRINTER_UNSUPPORTED: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_STATUS;
