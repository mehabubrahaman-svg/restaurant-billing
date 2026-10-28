import {
  FrameAssembler,
  decodeFrame,
  frameMessage,
  maxFrameBytes,
  type AssemblerEvent,
} from '@restroos/contracts/ble';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Property-based tests of the contracts frame codec. They live in the spike
 * because fast-check is not a dependency of @restroos/contracts; the contracts
 * package has the table-driven equivalents.
 */

const mtu = fc.oneof(
  fc.constantFrom(23, 185, 247, 512, 515, 517),
  fc.integer({ min: 23, max: 600 }),
);
// size 'max': without it fast-check keeps arrays to about ten bytes, i.e. one frame.
const message = fc.uint8Array({ minLength: 0, maxLength: 3_000, size: 'max' });

const completed = (events: AssemblerEvent[]) =>
  events.flatMap((e) => (e.kind === 'message' ? [e.message] : []));

describe('frame codec properties', () => {
  it('round-trips any message at any MTU, every frame within the ATT limit', () => {
    fc.assert(
      fc.property(message, mtu, fc.integer({ min: 0, max: 0xffff }), (bytes, m, msgId) => {
        const frames = frameMessage(bytes, { mtu: m, msgId });
        expect(frames.every((f) => f.byteLength <= maxFrameBytes(m))).toBe(true);
        const assembler = new FrameAssembler();
        const [result] = completed(frames.flatMap((f) => assembler.push(f)));
        expect(result?.payload).toEqual(bytes);
        expect(result?.msgId).toBe(msgId);
      }),
    );
  });

  it('reassembles any interleaving of several messages that keeps each message in order', () => {
    fc.assert(
      fc.property(
        fc.array(message, { minLength: 1, maxLength: 6 }),
        mtu,
        fc.infiniteStream(fc.nat()),
        (messages, m, choices) => {
          const queues = messages.map((bytes, i) => frameMessage(bytes, { mtu: m, msgId: i }));
          const assembler = new FrameAssembler({ maxPendingMessages: 16 });
          const events: AssemblerEvent[] = [];
          const picks = choices[Symbol.iterator]();
          // Pick a random non-empty queue each step: a random merge preserving per-queue order.
          for (;;) {
            const live = queues.filter((q) => q.length > 0);
            if (live.length === 0) break;
            const queue = live[picks.next().value! % live.length]!;
            events.push(...assembler.push(queue.shift()!));
          }
          expect(events.filter((e) => e.kind === 'error')).toEqual([]);
          const byId = new Map(completed(events).map((x) => [x.msgId, x.payload]));
          messages.forEach((bytes, i) => expect(byId.get(i)).toEqual(bytes));
        },
      ),
    );
  }, 20_000); // CPU-heavy: generous when the whole monorepo tests in parallel

  it('never delivers a message when one of its frames is dropped', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 2_000, size: 'max' }),
        mtu,
        fc.nat(),
        (bytes, m, dropAt) => {
          const frames = frameMessage(bytes, { mtu: m, msgId: 1 });
          fc.pre(frames.length > 1);
          frames.splice(dropAt % frames.length, 1);
          const assembler = new FrameAssembler();
          const events = frames.flatMap((f) => assembler.push(f));
          expect(completed(events)).toEqual([]);
        },
      ),
    );
  });

  it('delivers exactly once despite any duplicated frames', () => {
    fc.assert(
      fc.property(message, mtu, fc.array(fc.nat(), { maxLength: 10 }), (bytes, m, dups) => {
        const frames = frameMessage(bytes, { mtu: m, msgId: 1 });
        // Insert each duplicate right after (or later than) its original.
        const stream = [...frames];
        for (const d of dups) {
          const i = d % frames.length;
          const at = stream.indexOf(frames[i]!) + 1 + (d % 3);
          stream.splice(Math.min(at, stream.length), 0, frames[i]!);
        }
        const assembler = new FrameAssembler();
        const delivered = completed(stream.flatMap((f) => assembler.push(f)));
        expect(delivered).toHaveLength(1);
        expect(delivered[0]!.payload).toEqual(bytes);
      }),
    );
  });

  it('never throws on arbitrary input frames', () => {
    fc.assert(
      fc.property(fc.array(fc.uint8Array({ maxLength: 40 }), { maxLength: 50 }), (frames) => {
        const assembler = new FrameAssembler({ maxMessageBytes: 200 });
        for (const f of frames) {
          for (const e of assembler.push(f)) {
            if (e.kind === 'message') expect(decodeFrame(f).ok).toBe(true);
          }
        }
      }),
    );
  });
});
