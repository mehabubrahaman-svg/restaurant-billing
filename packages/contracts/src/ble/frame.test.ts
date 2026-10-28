import { describe, expect, it } from 'vitest';
import { FrameAssembler } from './assembler';
import {
  FRAME_HEADER_BYTES,
  createMsgIdCounter,
  decodeFrame,
  encodeFrame,
  frameCount,
  frameMessage,
  maxFrameBytes,
  maxFramePayload,
  maxMessageBytesAt,
} from './frame';
import { testBytes } from './test-utils';

describe('frame sizing', () => {
  it.each([
    // mtu, frame bytes (min(MTU−3, 512)), payload bytes (frame − 5)
    [23, 20, 15],
    [185, 182, 177],
    [247, 244, 239],
    [515, 512, 507],
    [517, 512, 507],
    [1024, 512, 507],
  ])('MTU %i → frame %i B, payload %i B', (mtu, frame, payload) => {
    expect(maxFrameBytes(mtu)).toBe(frame);
    expect(maxFramePayload(mtu)).toBe(payload);
  });

  it.each([22, 0, -1, 23.5, Number.NaN])('rejects MTU %s', (mtu) => {
    expect(() => maxFrameBytes(mtu)).toThrow(RangeError);
  });

  it('counts frames, with one frame for an empty message', () => {
    expect(frameCount(0, 23)).toBe(1);
    expect(frameCount(15, 23)).toBe(1);
    expect(frameCount(16, 23)).toBe(2);
    expect(maxMessageBytesAt(23)).toBe(65_536 * 15);
  });
});

describe('frame header', () => {
  it('lays out msgId, seq (little-endian) and flags', () => {
    const frame = encodeFrame(
      { msgId: 0x1234, seq: 0xabcd, last: true, compressed: true },
      new Uint8Array([9, 8]),
    );
    expect([...frame]).toEqual([0x34, 0x12, 0xcd, 0xab, 0b11, 9, 8]);
  });

  it('round-trips header fields', () => {
    for (const [msgId, seq, last, compressed] of [
      [0, 0, false, false],
      [65_535, 65_535, true, false],
      [1, 2, false, true],
    ] as const) {
      const decoded = decodeFrame(encodeFrame({ msgId, seq, last, compressed }, new Uint8Array()));
      expect(decoded).toMatchObject({ ok: true, frame: { msgId, seq, last, compressed } });
    }
  });

  it.each([
    ['msgId', { msgId: 65_536, seq: 0 }],
    ['msgId', { msgId: -1, seq: 0 }],
    ['seq', { msgId: 0, seq: 65_536 }],
    ['seq', { msgId: 0, seq: 1.5 }],
  ])('rejects an out-of-range %s', (_name, h) => {
    expect(() => encodeFrame({ ...h, last: true, compressed: false }, new Uint8Array())).toThrow(
      RangeError,
    );
  });

  it('reports frames shorter than the header as malformed', () => {
    expect(decodeFrame(new Uint8Array(4))).toMatchObject({
      ok: false,
      error: { code: 'MALFORMED_FRAME' },
    });
  });

  it('reports reserved flag bits', () => {
    expect(decodeFrame(new Uint8Array([0, 0, 0, 0, 0b100]))).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_FLAGS', flags: 4 },
    });
  });

  it('decodes frames that are views into a larger buffer', () => {
    const backing = new Uint8Array(32);
    backing.set(
      encodeFrame({ msgId: 7, seq: 3, last: false, compressed: false }, testBytes(4)),
      10,
    );
    const decoded = decodeFrame(backing.subarray(10, 19));
    expect(decoded).toMatchObject({ ok: true, frame: { msgId: 7, seq: 3, last: false } });
    if (decoded.ok) expect([...decoded.frame.payload]).toEqual([...testBytes(4)]);
  });
});

describe('frameMessage → FrameAssembler round trip', () => {
  const mtus = [23, 185, 247, 517];

  for (const mtu of mtus) {
    const p = maxFramePayload(mtu);
    const sizes = [0, 1, p - 1, p, p + 1, 2 * p - 1, 2 * p, 2 * p + 1, 10 * p + 3, 100_000];

    it.each(sizes)(`MTU ${mtu}: %i-byte message`, (size) => {
      const message = testBytes(size, size + mtu);
      const frames = frameMessage(message, { mtu, msgId: 42 });

      expect(frames).toHaveLength(frameCount(size, mtu));
      for (const [i, frame] of frames.entries()) {
        expect(frame.byteLength).toBeLessThanOrEqual(maxFrameBytes(mtu));
        // Every frame but the last is full; the last carries the remainder.
        if (i < frames.length - 1) expect(frame.byteLength).toBe(maxFrameBytes(mtu));
        const decoded = decodeFrame(frame);
        expect(decoded).toMatchObject({
          ok: true,
          frame: { seq: i, last: i === frames.length - 1 },
        });
      }

      const assembler = new FrameAssembler();
      const events = frames.flatMap((f) => assembler.push(f));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'message',
        message: { msgId: 42, compressed: false, frames: frames.length },
      });
      if (events[0]?.kind === 'message') expect(events[0].message.payload).toEqual(message);
      expect(assembler.pendingCount).toBe(0);
    });
  }

  it('encodes an empty message as a single header-only LAST frame', () => {
    const frames = frameMessage(new Uint8Array(), { mtu: 23, msgId: 1 });
    expect(frames).toHaveLength(1);
    expect(frames[0]!.byteLength).toBe(FRAME_HEADER_BYTES);
    expect(decodeFrame(frames[0]!)).toMatchObject({ ok: true, frame: { last: true, seq: 0 } });
  });

  it('flags every frame of a compressed message', () => {
    const frames = frameMessage(testBytes(40), { mtu: 23, msgId: 1, compressed: true });
    expect(frames.every((f) => (f[4]! & 0b10) !== 0)).toBe(true);
  });

  it('refuses a message that needs more than 65 536 frames', () => {
    const size = maxMessageBytesAt(23);
    expect(frameMessage(new Uint8Array(size), { mtu: 23, msgId: 0 })).toHaveLength(65_536);
    expect(() => frameMessage(new Uint8Array(size + 1), { mtu: 23, msgId: 0 })).toThrow(RangeError);
  });
});

describe('createMsgIdCounter', () => {
  it('counts up and wraps at 65 536', () => {
    const next = createMsgIdCounter(65_534);
    expect([next(), next(), next(), next()]).toEqual([65_534, 65_535, 0, 1]);
  });
});
