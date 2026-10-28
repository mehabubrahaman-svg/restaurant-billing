import type { TableRecord } from '@restroos/application';
import {
  SaveFloorAreaRequestSchema,
  SaveLayoutRequestSchema,
  SaveTableRequestSchema,
  SetTableStatusRequestSchema,
  UpdateFloorAreaRequestSchema,
  UpdateTableRequestSchema,
  type DiningTable,
  type TableOrder,
  type FloorResponse,
  type TableQrResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { hubUrls } from '../../hub-network';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const MANAGE = { permission: 'floor.manage' } as const;
const VIEW = { permission: ['tables.view', 'floor.manage'] } as const;
const SET_STATUS = { permission: ['tables.update_status', 'floor.manage'] } as const;

/** The QR token never leaves the Hub except inside the QR URL. */
export function toTable(
  { qrToken, ...table }: TableRecord,
  openOrder: TableOrder | null = null,
): DiningTable {
  return { ...table, openOrder, hasQr: qrToken !== null };
}

/** WP 3.3: floor areas, tables, layout and table status (docs/05 §2 Floor). */
export async function floorRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { floorService: floor, hubNetwork, orderQueries } = cradle;
  const branchOf = (r: { principal?: { branchId: string } }) => r.principal!.branchId;

  const qrOf = (table: TableRecord): TableQrResponse => {
    if (!table.qrToken) throw new DomainError('NOT_FOUND', 'this table has no QR code yet');
    // Guests' phones don't trust the Hub CA, so the QR points at plain HTTP on the LAN.
    const base = hubUrls(hubNetwork).http[0] ?? `http://localhost:${hubNetwork.httpPort}`;
    return { url: `${base}/qr/${table.qrToken}`, label: table.label };
  };

  app.get('/floor', { config: VIEW }, async (request): Promise<FloorResponse> => {
    const open = orderQueries.openOrdersByTable(branchOf(request));
    return {
      areas: floor.floor(branchOf(request)).map((area) => ({
        ...area,
        tables: area.tables.map((t) => toTable(t, open.get(t.id) ?? null)),
      })),
    };
  });

  app.post('/floor-areas', { config: MANAGE }, async (request, reply) => {
    const body = SaveFloorAreaRequestSchema.parse(request.body);
    const area = floor.createArea(body, commandContext(request));
    reply.status(201);
    return { ...area, tables: [] };
  });
  app.patch('/floor-areas/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const area = floor.updateArea(
      id,
      UpdateFloorAreaRequestSchema.parse(request.body),
      commandContext(request),
    );
    const tables = floor.floor(branchOf(request)).find((a) => a.id === id)?.tables ?? [];
    return { ...area, tables: tables.map((t) => toTable(t)) };
  });

  app.post('/tables', { config: MANAGE }, async (request, reply) => {
    const body = SaveTableRequestSchema.parse(request.body);
    reply.status(201);
    return toTable(floor.createTable(body, commandContext(request)));
  });
  app.patch('/tables/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return toTable(
      floor.updateTable(id, UpdateTableRequestSchema.parse(request.body), commandContext(request)),
    );
  });
  // Drag-and-drop save: every move applies, or none.
  app.put('/floor/layout', { config: MANAGE }, async (request) => {
    const { tables } = SaveLayoutRequestSchema.parse(request.body);
    return { data: floor.saveLayout(tables, commandContext(request)).map((t) => toTable(t)) };
  });
  app.post('/tables/:id/status', { config: SET_STATUS }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { status, version } = SetTableStatusRequestSchema.parse(request.body);
    return toTable(floor.setStatus(id, status, version, commandContext(request)));
  });

  app.get('/tables/:id/qr', { config: MANAGE }, async (request): Promise<TableQrResponse> => {
    const { id } = IdParams.parse(request.params);
    return qrOf(floor.table(branchOf(request), id));
  });
  // Creates the table's QR, or replaces it (the old printed QR stops working).
  app.post('/tables/:id/qr', { config: MANAGE }, async (request): Promise<TableQrResponse> => {
    const { id } = IdParams.parse(request.params);
    return qrOf(floor.rotateQr(id, commandContext(request)));
  });
}
