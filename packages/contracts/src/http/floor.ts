import { z } from 'zod';
import { IdSchema, patchSchema } from './common';
import { TableReservationSchema } from './reservations';

const Version = z.number().int();

export const TableStatusSchema = z.enum([
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'CLEANING',
  'BILLING',
  'BLOCKED',
]);
export type TableStatus = z.infer<typeof TableStatusSchema>;
/** Statuses staff may set by hand. OCCUPIED and BILLING come from orders (Sprint 4). */
export const ManualTableStatusSchema = z.enum(['AVAILABLE', 'RESERVED', 'CLEANING', 'BLOCKED']);

export const TableShapeSchema = z.enum(['SQUARE', 'ROUND', 'RECT', 'BOOTH']);

/** Layout grid: positions are cells on a 48 × 32 grid; the editor snaps to cells. */
export const LAYOUT_GRID = { columns: 48, rows: 32 } as const;
const GridX = z
  .number()
  .int()
  .min(0)
  .max(LAYOUT_GRID.columns - 1);
const GridY = z
  .number()
  .int()
  .min(0)
  .max(LAYOUT_GRID.rows - 1);

/** The open order on a table, for the captain's floor view. */
export const TableOrderSchema = z.object({
  id: IdSchema,
  orderNo: z.string(),
  covers: z.number().int().nullable(),
  /** Paise, before tax. */
  subtotal: z.number().int(),
  openedAt: z.string(),
  captainId: IdSchema.nullable(),
  captainName: z.string().nullable(),
  itemCount: z.number().int(),
  pendingCount: z.number().int(),
  readyCount: z.number().int(),
});
export type TableOrder = z.infer<typeof TableOrderSchema>;

export const DiningTableSchema = z.object({
  id: IdSchema,
  floorAreaId: IdSchema,
  label: z.string(),
  seats: z.number().int().positive(),
  shape: TableShapeSchema,
  posX: GridX,
  posY: GridY,
  status: TableStatusSchema,
  currentOrderId: IdSchema.nullable(),
  /** Filled on GET /floor while the table has an open order. */
  openOrder: TableOrderSchema.nullable().default(null),
  /** Filled on GET /floor: the table's next booking, from 30 minutes ago to 12 hours ahead. */
  nextReservation: TableReservationSchema.nullable().default(null),
  hasQr: z.boolean(),
  isActive: z.boolean(),
  version: Version,
});
export type DiningTable = z.infer<typeof DiningTableSchema>;

export const FloorAreaSchema = z.object({
  id: IdSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  version: Version,
  tables: z.array(DiningTableSchema),
});
export type FloorArea = z.infer<typeof FloorAreaSchema>;
export const FloorResponseSchema = z.object({ areas: z.array(FloorAreaSchema) });
export type FloorResponse = z.infer<typeof FloorResponseSchema>;

export const SaveFloorAreaRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  sortOrder: z.number().int().default(0),
});
export const UpdateFloorAreaRequestSchema = patchSchema(SaveFloorAreaRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

export const SaveTableRequestSchema = z.object({
  floorAreaId: IdSchema,
  label: z.string().trim().min(1).max(12),
  seats: z.number().int().min(1).max(40).default(4),
  shape: TableShapeSchema.default('SQUARE'),
  posX: GridX.default(0),
  posY: GridY.default(0),
});
export const UpdateTableRequestSchema = patchSchema(SaveTableRequestSchema).extend({
  version: Version,
  isActive: z.boolean().optional(),
});

/** Drag-and-drop save: all moves apply together or none do. */
export const SaveLayoutRequestSchema = z.object({
  tables: z
    .array(z.object({ id: IdSchema, posX: GridX, posY: GridY, version: Version }))
    .min(1)
    .max(500),
});

export const SetTableStatusRequestSchema = z.object({
  status: ManualTableStatusSchema,
  version: Version,
});

export const TableQrResponseSchema = z.object({
  /** What the QR code encodes: guests open it to see the menu for this table. */
  url: z.string(),
  label: z.string(),
});
export type TableQrResponse = z.infer<typeof TableQrResponseSchema>;
