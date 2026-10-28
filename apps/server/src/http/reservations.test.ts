import {
  FloorResponseSchema,
  ReservationSchema,
  ReservationsResponseSchema,
  type DiningTable,
} from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { restaurantServer } from '../testing/restaurant';
import { signInAs } from '../testing/staff';
import type { TestServer } from '../testing/test-server';

let s: TestServer | undefined;
afterEach(async () => s?.close());

// The test clock stands at 2026-10-28T12:00:00Z (17:30 IST).
const AT_8PM_IST = '2026-10-28T20:00:00+05:30';

describe('reservations', () => {
  it('books a table, shows it on the floor, refuses a clash and seats the guests', async () => {
    const r = await restaurantServer();
    s = r.s;
    const captain = await signInAs(r.s, r.admin, 'CAPTAIN', 'rahul');
    const kitchen = await signInAs(r.s, r.admin, 'KITCHEN', 'bablu');

    const booked = await captain('POST', '/reservations', {
      guestName: 'Ananya Das',
      guestPhone: '98300 55555',
      partySize: 4,
      reservedFor: AT_8PM_IST,
      tableId: r.tables.t1.id,
      notes: 'Birthday, window seat',
    });
    expect(booked.statusCode).toBe(201);
    const reservation = ReservationSchema.parse(booked.json());
    expect(reservation).toMatchObject({
      status: 'BOOKED',
      reservedFor: '2026-10-28T14:30:00.000Z',
      tableLabel: r.tables.t1.label,
      guestPhone: '+919830055555',
    });
    // The guest is now a customer, found by phone at billing.
    expect(reservation.customerId).not.toBeNull();

    const floor = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    const tile = floor.areas
      .flatMap((a) => a.tables)
      .find((t: DiningTable) => t.id === r.tables.t1.id);
    expect(tile?.nextReservation).toEqual({
      id: reservation.id,
      guestName: 'Ananya Das',
      partySize: 4,
      reservedFor: '2026-10-28T14:30:00.000Z',
    });

    // Another booking within 2 hours of 8 pm can't take T1; it can at 10 pm.
    const clash = await captain('POST', '/reservations', {
      guestName: 'Rohit',
      partySize: 2,
      reservedFor: '2026-10-28T21:30:00+05:30',
      tableId: r.tables.t1.id,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('TABLE_ALREADY_RESERVED');
    const later = await captain('POST', '/reservations', {
      guestName: 'Rohit',
      partySize: 2,
      reservedFor: '2026-10-28T22:00:00+05:30',
      tableId: r.tables.t1.id,
    });
    expect(later.statusCode).toBe(201);

    // Times long past are refused.
    const past = await captain('POST', '/reservations', {
      guestName: 'Late',
      partySize: 2,
      reservedFor: '2026-10-28T10:00:00Z',
    });
    expect(past.json().code).toBe('VALIDATION_FAILED');

    // Moving Rohit to 8:30 pm on T1 clashes; on T2 it doesn't.
    const rohit = ReservationSchema.parse(later.json());
    const moved = await captain('PATCH', `/reservations/${rohit.id}`, {
      version: rohit.version,
      reservedFor: '2026-10-28T20:30:00+05:30',
    });
    expect(moved.json().code).toBe('TABLE_ALREADY_RESERVED');
    const onT2 = ReservationSchema.parse(
      (
        await captain('PATCH', `/reservations/${rohit.id}`, {
          version: rohit.version,
          reservedFor: '2026-10-28T20:30:00+05:30',
          tableId: r.tables.t2.id,
        })
      ).json(),
    );
    expect(onT2).toMatchObject({ tableLabel: r.tables.t2.label, version: 2 });

    // Today's list, in time order.
    const list = ReservationsResponseSchema.parse((await captain('GET', '/reservations')).json());
    expect(list.data.map((x) => x.guestName)).toEqual(['Ananya Das', 'Rohit']);

    // Seated: closed, and no longer on the floor tile. Seating twice is refused.
    const seated = await captain('POST', `/reservations/${reservation.id}/seat`, {
      version: reservation.version,
    });
    expect(seated.json()).toMatchObject({ status: 'SEATED', version: 2 });
    const again = await captain('POST', `/reservations/${reservation.id}/cancel`, { version: 2 });
    expect(again.json().code).toBe('INVALID_STATE_TRANSITION');
    const after = FloorResponseSchema.parse((await captain('GET', '/floor')).json());
    expect(
      after.areas.flatMap((a) => a.tables).find((t) => t.id === r.tables.t1.id)?.nextReservation,
    ).toBeNull();

    const noShow = await captain('POST', `/reservations/${rohit.id}/no-show`, { version: 2 });
    expect(noShow.json()).toMatchObject({ status: 'NO_SHOW' });

    // Kitchen staff can't see or book reservations.
    expect((await kitchen('GET', '/reservations')).statusCode).toBe(403);
  });
});
