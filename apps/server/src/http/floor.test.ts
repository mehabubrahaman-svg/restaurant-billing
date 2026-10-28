import {
  DiningTableSchema,
  FloorAreaSchema,
  FloorResponseSchema,
  TableQrResponseSchema,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, signInAs, trail } from '../testing/staff';
import { createTestServer, TEST_LAN_IP, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

async function floorServer() {
  s = await createTestServer();
  const admin = caller(s, (await s.login()).accessToken);
  const area = FloorAreaSchema.parse(
    (await admin('POST', '/floor-areas', { name: 'Ground floor' })).json(),
  );
  const table = async (label: string, posX = 0, posY = 0) => {
    const res = await admin('POST', '/tables', {
      floorAreaId: area.id,
      label,
      seats: 4,
      posX,
      posY,
    });
    if (res.statusCode !== 201) throw new Error(res.body);
    return DiningTableSchema.parse(res.json());
  };
  return { admin, area, table };
}

describe('floor', () => {
  it('lays out areas and tables and never exposes the QR token', async () => {
    const { admin, area, table } = await floorServer();
    const t1 = await table('T1', 2, 3);
    await table('T2', 6, 3);
    expect(
      (await admin('POST', '/tables', { floorAreaId: area.id, label: 't1' })).json().code,
    ).toBe('TABLE_LABEL_TAKEN');

    const floor = FloorResponseSchema.parse((await admin('GET', '/floor')).json());
    expect(floor.areas).toHaveLength(1);
    expect(floor.areas[0]!.tables.map((t) => [t.label, t.posX, t.posY, t.status])).toEqual([
      ['T1', 2, 3, 'AVAILABLE'],
      ['T2', 6, 3, 'AVAILABLE'],
    ]);
    expect(JSON.stringify(floor)).not.toContain('qrToken');
    expect(trail(s, t1.id)).toMatchObject({ audit: ['floor.table.create'], queued: 1 });
  });

  it('saves a drag-and-drop layout all at once, or not at all', async () => {
    const { admin, table } = await floorServer();
    const t1 = await table('T1');
    const t2 = await table('T2', 1, 0);

    const moved = await admin('PUT', '/floor/layout', {
      tables: [
        { id: t1.id, posX: 10, posY: 5, version: t1.version },
        { id: t2.id, posX: 12, posY: 5, version: t2.version },
      ],
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.map((t: { posX: number }) => t.posX)).toEqual([10, 12]);

    // t1's version is stale now, so neither move applies.
    const stale = await admin('PUT', '/floor/layout', {
      tables: [
        { id: t2.id, posX: 20, posY: 5, version: t2.version + 1 },
        { id: t1.id, posX: 30, posY: 5, version: t1.version },
      ],
    });
    expect(stale.statusCode).toBe(409);
    const tables = FloorResponseSchema.parse((await admin('GET', '/floor')).json()).areas[0]!
      .tables;
    expect(tables.map((t) => t.posX)).toEqual([10, 12]);

    expect(
      (
        await admin('PUT', '/floor/layout', {
          tables: [{ id: t1.id, posX: 48, posY: 0, version: 2 }],
        })
      ).statusCode,
    ).toBe(422);
  });

  it('lets a captain change table status along the allowed paths only', async () => {
    const { admin, table } = await floorServer();
    const t1 = await table('T1');
    const captain = await signInAs(s, admin, 'CAPTAIN', 'rahul');

    const cleaning = await captain('POST', `/tables/${t1.id}/status`, {
      status: 'CLEANING',
      version: t1.version,
    });
    expect(cleaning.statusCode).toBe(200);
    expect(cleaning.json()).toMatchObject({ status: 'CLEANING', version: t1.version + 1 });

    const bad = await captain('POST', `/tables/${t1.id}/status`, {
      status: 'RESERVED',
      version: t1.version + 1,
    });
    expect(bad.json().code).toBe('INVALID_STATE_TRANSITION');
    // OCCUPIED comes from opening an order, never by hand.
    expect(
      (
        await captain('POST', `/tables/${t1.id}/status`, {
          status: 'OCCUPIED',
          version: t1.version + 1,
        })
      ).statusCode,
    ).toBe(422);

    expect(
      (await captain('POST', '/tables', { floorAreaId: t1.floorAreaId, label: 'T9' })).statusCode,
    ).toBe(403);
    expect((await captain('GET', '/floor')).statusCode).toBe(200);
  });

  it('issues a table QR and replaces it on request', async () => {
    const { admin, table } = await floorServer();
    const t1 = await table('T1');
    expect((await admin('GET', `/tables/${t1.id}/qr`)).json().code).toBe('NOT_FOUND');

    const first = TableQrResponseSchema.parse((await admin('POST', `/tables/${t1.id}/qr`)).json());
    expect(first.label).toBe('T1');
    expect(first.url).toMatch(
      new RegExp(`^http://${TEST_LAN_IP.replaceAll('.', '\\.')}:7400/qr/[A-Za-z0-9_-]{22}$`),
    );
    expect(TableQrResponseSchema.parse((await admin('GET', `/tables/${t1.id}/qr`)).json())).toEqual(
      first,
    );

    const second = TableQrResponseSchema.parse((await admin('POST', `/tables/${t1.id}/qr`)).json());
    expect(second.url).not.toBe(first.url);
    const floor = FloorResponseSchema.parse((await admin('GET', '/floor')).json());
    expect(floor.areas[0]!.tables[0]!.hasQr).toBe(true);
  });

  it('will not retire an area with active tables', async () => {
    const { admin, area, table } = await floorServer();
    await table('T1');
    const res = await admin('PATCH', `/floor-areas/${area.id}`, {
      version: area.version,
      isActive: false,
    });
    expect(res.json().code).toBe('AREA_HAS_TABLES');
  });
});
