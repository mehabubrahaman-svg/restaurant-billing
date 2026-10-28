/**
 * Frame layout of the `cmd-in` / `evt-out` characteristics. One frame is one
 * ATT write or notification value; a message (a UTF-8 JSON envelope, possibly
 * gzip-compressed) is split into frames that share a `msgId`.
 *
 *   offset 0  msgId  u16 little-endian   per direction, per sender, wraps at 65536
 *   offset 2  seq    u16 little-endian   0, 1, 2, … within the message
 *   offset 4  flags  u8                  bit0 LAST, bit1 COMPRESSED, bits 2–7 must be 0
 *   offset 5  payload                    0 … maxFramePayload(mtu) bytes
 *
 * Sizing: an ATT Write Request / Write Command / Handle Value Notification
 * carries at most MTU − 3 value bytes, and no attribute value may exceed 512
 * bytes (Core spec Vol 3 Part F §3.2.9). So a frame is at most
 * min(MTU − 3, 512) bytes and its payload at most min(MTU − 3, 512) − 5:
 * 15 B at MTU 23, 239 B at MTU 247, 507 B at MTU 517.
 *
 * Little-endian matches every other multi-byte value in GATT. COMPRESSED is
 * set on every frame of a compressed message so that each frame is
 * self-describing; the assembler rejects a message whose frames disagree.
 */

export const ATT_HEADER_BYTES = 3;
export const MAX_ATTRIBUTE_VALUE_BYTES = 512;
export const MIN_ATT_MTU = 23;
/** MTU Android and BlueZ ask for: a 512-byte value + the 5-byte Prepare Write header. */
export const MAX_USEFUL_ATT_MTU = 517;

export const FRAME_HEADER_BYTES = 5;
export const MAX_SEQ = 0xffff;
export const MAX_MSG_ID = 0xffff;

export const FrameFlags = {
  LAST: 0b0000_0001,
  COMPRESSED: 0b0000_0010,
} as const;
const KNOWN_FLAGS = FrameFlags.LAST | FrameFlags.COMPRESSED;

export interface FrameHeader {
  readonly msgId: number;
  readonly seq: number;
  readonly last: boolean;
  readonly compressed: boolean;
}

export interface DecodedFrame extends FrameHeader {
  /** A view into the frame passed to `decodeFrame`, not a copy. */
  readonly payload: Uint8Array;
}

export function assertValidMtu(mtu: number): void {
  if (!Number.isInteger(mtu) || mtu < MIN_ATT_MTU) {
    throw new RangeError(`ATT MTU must be an integer >= ${MIN_ATT_MTU}: ${mtu}`);
  }
}

/** Largest frame (header + payload) that fits one ATT write/notify at this MTU. */
export function maxFrameBytes(mtu: number): number {
  assertValidMtu(mtu);
  return Math.min(mtu - ATT_HEADER_BYTES, MAX_ATTRIBUTE_VALUE_BYTES);
}

/** Largest message payload slice per frame at this MTU. */
export function maxFramePayload(mtu: number): number {
  return maxFrameBytes(mtu) - FRAME_HEADER_BYTES;
}

/** Number of frames a message of `byteLength` needs. An empty message is one frame. */
export function frameCount(byteLength: number, mtu: number): number {
  return Math.max(1, Math.ceil(byteLength / maxFramePayload(mtu)));
}

/** Largest message (after compression) one `msgId` can carry at this MTU. */
export function maxMessageBytesAt(mtu: number): number {
  return (MAX_SEQ + 1) * maxFramePayload(mtu);
}

export function encodeFrame(header: FrameHeader, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(header.msgId) || header.msgId < 0 || header.msgId > MAX_MSG_ID) {
    throw new RangeError(`msgId must be a u16: ${header.msgId}`);
  }
  if (!Number.isInteger(header.seq) || header.seq < 0 || header.seq > MAX_SEQ) {
    throw new RangeError(`seq must be a u16: ${header.seq}`);
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint16(0, header.msgId, true);
  view.setUint16(2, header.seq, true);
  view.setUint8(
    4,
    (header.last ? FrameFlags.LAST : 0) | (header.compressed ? FrameFlags.COMPRESSED : 0),
  );
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

export type FrameDecodeError =
  | { readonly code: 'MALFORMED_FRAME'; readonly message: string }
  | { readonly code: 'UNSUPPORTED_FLAGS'; readonly message: string; readonly flags: number };

/** Parses one frame. Returns an error (never throws) because frames come from the peer. */
export function decodeFrame(
  frame: Uint8Array,
): { ok: true; frame: DecodedFrame } | { ok: false; error: FrameDecodeError } {
  if (frame.byteLength < FRAME_HEADER_BYTES) {
    return {
      ok: false,
      error: { code: 'MALFORMED_FRAME', message: `frame of ${frame.byteLength} B has no header` },
    };
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const flags = view.getUint8(4);
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_FLAGS',
        message: `unknown frame flags 0x${flags.toString(16)}`,
        flags,
      },
    };
  }
  return {
    ok: true,
    frame: {
      msgId: view.getUint16(0, true),
      seq: view.getUint16(2, true),
      last: (flags & FrameFlags.LAST) !== 0,
      compressed: (flags & FrameFlags.COMPRESSED) !== 0,
      payload: frame.subarray(FRAME_HEADER_BYTES),
    },
  };
}

export interface FrameMessageOptions {
  /** Negotiated ATT MTU of the link the frames will travel on. */
  readonly mtu: number;
  readonly msgId: number;
  /** Marks every frame COMPRESSED; the caller has already compressed `payload`. */
  readonly compressed?: boolean;
}

/**
 * Splits an already-encoded (and, if wanted, already-compressed) message into
 * frames. Synchronous and pure; `encodeMessage` adds optional compression.
 * Throws RangeError for programmer errors (bad MTU, msgId, or a message too
 * large for 65 536 frames).
 */
export function frameMessage(payload: Uint8Array, options: FrameMessageOptions): Uint8Array[] {
  const perFrame = maxFramePayload(options.mtu);
  const count = frameCount(payload.byteLength, options.mtu);
  if (count > MAX_SEQ + 1) {
    throw new RangeError(
      `message of ${payload.byteLength} B needs ${count} frames at MTU ${options.mtu}; max is ${MAX_SEQ + 1}`,
    );
  }
  const compressed = options.compressed ?? false;
  const frames: Uint8Array[] = [];
  for (let seq = 0; seq < count; seq++) {
    const start = seq * perFrame;
    frames.push(
      encodeFrame(
        { msgId: options.msgId, seq, last: seq === count - 1, compressed },
        payload.subarray(start, start + perFrame),
      ),
    );
  }
  return frames;
}

/** Wrapping u16 counter for outgoing msgIds. One per sender per direction. */
export function createMsgIdCounter(start = 0): () => number {
  let next = start & MAX_MSG_ID;
  return () => {
    const id = next;
    next = (next + 1) & MAX_MSG_ID;
    return id;
  };
}
