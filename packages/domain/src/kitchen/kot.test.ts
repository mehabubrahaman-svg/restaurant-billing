import { describe, expect, it } from 'vitest';
import { DEFAULT_PREP_SEC, Kot } from './kot';

const at = new Date('2026-10-28T13:00:00Z');
const t = (min: number) => new Date(at.getTime() + min * 60_000);

const fire = (lineIds = ['l1', 'l2'], prepTimeSec: number | null = null) =>
  Kot.fire(
    'k1',
    {
      branchId: 'b1',
      orderId: 'o1',
      kitchenStationId: 's1',
      kotNo: 31,
      businessDate: '2026-10-28',
      createdBy: 'u1',
      lineIds,
      prepTimeSec,
    },
    at,
  );

describe('Kot', () => {
  it('sets the target time from the slowest item, or 15 minutes', () => {
    expect(fire().state.targetReadyAt.getTime() - at.getTime()).toBe(DEFAULT_PREP_SEC * 1000);
    expect(fire(['l1'], 1200).state.targetReadyAt).toEqual(t(20));
  });

  it('moves forward only, skipping steps if needed, and items follow', () => {
    const kot = fire();
    kot.moveTo('COOKING', 'chef', t(2));
    expect(kot.lineChanges().map((c) => c.status)).toEqual(['PREPARING', 'PREPARING']);
    expect(() => kot.moveTo('ACCEPTED', 'chef', t(3))).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
    kot.moveTo('READY', 'chef', t(9));
    expect(kot.state).toMatchObject({
      status: 'READY',
      cookingAt: t(2),
      readyAt: t(9),
      acceptedAt: null,
    });
    expect(kot.lineChanges()).toEqual([
      { id: 'l1', status: 'READY', readyAt: t(9) },
      { id: 'l2', status: 'READY', readyAt: t(9) },
    ]);
    kot.moveTo('SERVED', 'captain', t(11));
    expect(kot.lineChanges().every((c) => c.status === 'SERVED')).toBe(true);
  });

  it('becomes READY when the last item is bumped', () => {
    const kot = fire();
    kot.bumpLine('l1', 'chef', t(4));
    expect(kot.state.status).toBe('NEW');
    kot.bumpLine('l2', 'chef', t(6));
    expect(kot.state).toMatchObject({ status: 'READY', readyAt: t(6) });
    expect(kot.pullEvents().map((e) => e.type)).toEqual([
      'KotFired',
      'KotItemReady',
      'KotItemReady',
      'KotStatusChanged',
    ]);
  });

  it('cancels itself when its last item is cancelled; a cancelled item no longer blocks READY', () => {
    const kot = fire();
    kot.cancelLine('l1', t(1));
    kot.bumpLine('l2', 'chef', t(3));
    expect(kot.state.status).toBe('READY');

    const other = fire();
    other.cancelLine('l1', t(1));
    other.cancelLine('l2', t(1));
    expect(other.state.status).toBe('CANCELLED');
    expect(() => other.moveTo('READY', null, t(2))).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });

  it('assigns a chef until the KOT is served', () => {
    const kot = fire();
    kot.assignChef('chef1', t(1));
    expect(kot.state.assignedChefId).toBe('chef1');
    kot.moveTo('SERVED', null, t(10));
    expect(() => kot.assignChef('chef2', t(11))).toThrow(
      expect.objectContaining({ code: 'INVALID_STATE_TRANSITION' }),
    );
  });
});
