import { describe, expect, it } from 'vitest';
import { FrameAssembler, type AssemblerEvent } from './assembler';
import { encodeFrame, frameMessage } from './frame';
import { manualClock, testBytes } from './test-utils';

const MTU = 23; // 15-byte payloads keep the frame counts small and readable

function frames(msgId: number, size: number, seed = msgId): Uint8Array[] {
  return frameMessage(testBytes(size, seed), { mtu: MTU, msgId });
}

function messages(events: readonly AssemblerEvent[]): { msgId: number; payload: Uint8Array }[] {
  return events.flatMap((e) => (e.kind === 'message' ? [e.message] : []));
}

function errors(events: readonly AssemblerEvent[]) {
  return events.flatMap((e) => (e.kind === 'error' ? [e.error] : []));
}

describe('FrameAssembler', () => {
  it('reassembles interleaved messages independently', () => {
    const a = frames(1, 50); // 4 frames
    const b = frames(2, 31); // 3 frames
    const c = frames(3, 0); // 1 frame
    const order = [a[0], b[0], a[1], c[0], b[1], a[2], b[2], a[3]];
    const assembler = new FrameAssembler();

    const events = order.flatMap((f) => assembler.push(f!));

    expect(errors(events)).toEqual([]);
    expect(messages(events).map((m) => m.msgId)).toEqual([3, 2, 1]);
    expect(messages(events)[2]!.payload).toEqual(testBytes(50, 1));
    expect(messages(events)[1]!.payload).toEqual(testBytes(31, 2));
    expect(messages(events)[0]!.payload).toEqual(new Uint8Array());
  });

  it('drops a duplicated frame and still completes the message', () => {
    const f = frames(5, 50);
    const assembler = new FrameAssembler();

    const events = [f[0], f[1], f[1], f[2], f[0], f[3]].flatMap((x) => assembler.push(x!));

    expect(errors(events).map((e) => [e.code, e.dropped, e.seq, e.expectedSeq])).toEqual([
      ['DUPLICATE_FRAME', 'frame', 1, 2],
      ['DUPLICATE_FRAME', 'frame', 0, 3],
    ]);
    expect(messages(events)[0]!.payload).toEqual(testBytes(50, 5));
  });

  it('reports a re-delivered frame of a completed message as a duplicate, not a new message', () => {
    const [only] = frames(9, 4);
    const assembler = new FrameAssembler();

    expect(messages(assembler.push(only!))).toHaveLength(1);
    const again = assembler.push(only!);

    expect(messages(again)).toHaveLength(0);
    expect(errors(again)).toMatchObject([{ code: 'DUPLICATE_FRAME', msgId: 9 }]);
  });

  it('abandons the message on a missing frame and ignores its later frames', () => {
    const f = frames(6, 50);
    const assembler = new FrameAssembler();

    expect(assembler.push(f[0]!)).toEqual([]);
    expect(errors(assembler.push(f[2]!))).toMatchObject([
      { code: 'GAP', dropped: 'message', msgId: 6, seq: 2, expectedSeq: 1 },
    ]);
    expect(assembler.push(f[3]!)).toEqual([]);
    expect(assembler.pendingCount).toBe(0);
  });

  it('reports out-of-order delivery as a gap', () => {
    const f = frames(7, 50);
    const assembler = new FrameAssembler();
    const events = [f[0], f[1], f[3], f[2]].flatMap((x) => assembler.push(x!));
    expect(errors(events).map((e) => e.code)).toEqual(['GAP']);
    expect(messages(events)).toEqual([]);
  });

  it('reports a message that does not start at seq 0', () => {
    const f = frames(8, 50);
    expect(errors(new FrameAssembler().push(f[1]!))).toMatchObject([
      { code: 'MISSING_START', dropped: 'frame', msgId: 8, seq: 1, expectedSeq: 0 },
    ]);
  });

  it('times out an idle message on the next push or on expire()', () => {
    const clock = manualClock();
    const assembler = new FrameAssembler({ reassemblyTimeoutMs: 1_000, now: clock.now });
    const a = frames(1, 50);
    const b = frames(2, 50);

    assembler.push(a[0]!);
    clock.advance(600);
    assembler.push(b[0]!);
    clock.advance(600); // a idle 1200 ms, b idle 600 ms

    const events = assembler.push(b[1]!);
    expect(errors(events)).toMatchObject([
      { code: 'TIMEOUT', dropped: 'message', msgId: 1, expectedSeq: 1 },
    ]);
    expect(assembler.pendingCount).toBe(1);

    clock.advance(1_001);
    expect(errors(assembler.expire())).toMatchObject([{ code: 'TIMEOUT', msgId: 2 }]);
    expect(assembler.pendingCount).toBe(0);
  });

  it('measures the timeout from the last frame, not the first', () => {
    const clock = manualClock();
    const assembler = new FrameAssembler({ reassemblyTimeoutMs: 1_000, now: clock.now });
    const f = frames(1, 50);
    const events: AssemblerEvent[] = [];
    for (const frame of f) {
      clock.advance(900);
      events.push(...assembler.push(frame));
    }
    expect(errors(events)).toEqual([]);
    expect(messages(events)).toHaveLength(1);
  });

  it('accepts a msgId again once its completion has aged out', () => {
    const clock = manualClock();
    const assembler = new FrameAssembler({ reassemblyTimeoutMs: 1_000, now: clock.now });
    const [first] = frames(4, 3, 1);
    const [second] = frames(4, 3, 2);

    expect(messages(assembler.push(first!))).toHaveLength(1);
    clock.advance(1_001);
    const events = assembler.push(second!);
    expect(messages(events)[0]!.payload).toEqual(testBytes(3, 2));
  });

  it('rejects a message larger than maxMessageBytes', () => {
    const assembler = new FrameAssembler({ maxMessageBytes: 40 });
    const events = frames(1, 50).flatMap((f) => assembler.push(f));
    expect(errors(events)).toMatchObject([
      { code: 'MESSAGE_TOO_LARGE', dropped: 'message', msgId: 1, seq: 2 },
    ]);
    expect(messages(events)).toEqual([]);

    const exact = new FrameAssembler({ maxMessageBytes: 50 });
    expect(messages(frames(1, 50).flatMap((f) => exact.push(f)))).toHaveLength(1);
  });

  it('limits the number of messages in progress', () => {
    const assembler = new FrameAssembler({ maxPendingMessages: 2 });
    assembler.push(frames(1, 50)[0]!);
    assembler.push(frames(2, 50)[0]!);
    expect(errors(assembler.push(frames(3, 50)[0]!))).toMatchObject([
      { code: 'TOO_MANY_PENDING', dropped: 'frame', msgId: 3 },
    ]);
  });

  it('rejects a message whose frames disagree on COMPRESSED', () => {
    const assembler = new FrameAssembler();
    assembler.push(encodeFrame({ msgId: 1, seq: 0, last: false, compressed: true }, testBytes(3)));
    const events = assembler.push(
      encodeFrame({ msgId: 1, seq: 1, last: true, compressed: false }, testBytes(3)),
    );
    expect(errors(events)).toMatchObject([{ code: 'FLAGS_MISMATCH', dropped: 'message' }]);
  });

  it('rejects malformed frames and unknown flags without disturbing other messages', () => {
    const assembler = new FrameAssembler();
    const f = frames(1, 20);
    assembler.push(f[0]!);
    expect(errors(assembler.push(new Uint8Array([1, 2])))).toMatchObject([
      { code: 'MALFORMED_FRAME', dropped: 'frame' },
    ]);
    expect(errors(assembler.push(new Uint8Array([1, 0, 1, 0, 0x81])))).toMatchObject([
      { code: 'UNSUPPORTED_FLAGS', dropped: 'frame' },
    ]);
    expect(messages(assembler.push(f[1]!))).toHaveLength(1);
  });

  it('refuses a non-final frame at seq 65535', () => {
    const assembler = new FrameAssembler({ maxMessageBytes: Infinity });
    let events: AssemblerEvent[] = [];
    for (let seq = 0; seq <= 65_535; seq++) {
      events = assembler.push(
        encodeFrame({ msgId: 1, seq, last: false, compressed: false }, new Uint8Array(1)),
      );
      if (events.length > 0) break;
    }
    expect(errors(events)).toMatchObject([{ code: 'MESSAGE_TOO_LARGE', seq: 65_535 }]);
  });

  it('copies payloads, so the caller may reuse its frame buffer', () => {
    const assembler = new FrameAssembler();
    const f = frames(1, 20);
    const reused = new Uint8Array(f[0]!.byteLength);
    reused.set(f[0]!);
    assembler.push(reused);
    reused.fill(0);
    const [message] = messages(assembler.push(f[1]!));
    expect(message!.payload).toEqual(testBytes(20, 1));
  });

  it('forgets everything on reset()', () => {
    const assembler = new FrameAssembler();
    assembler.push(frames(1, 20)[0]!);
    assembler.reset();
    expect(assembler.pendingCount).toBe(0);
  });
});
