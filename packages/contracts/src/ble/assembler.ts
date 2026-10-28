import { concatBytes } from './compression';
import { MAX_SEQ, decodeFrame, type DecodedFrame } from './frame';

/**
 * Reassembles frames into messages for ONE link and ONE direction (one
 * assembler per connected central on the Hub; one per Hub on a tablet).
 *
 * GATT over a single link is reliable and ordered, so anything other than
 * seq 0, 1, 2, … for a msgId means a bug or a dropped notification. The policy:
 * - a frame whose seq was already received (or whose message already
 *   completed) is a DUPLICATE and is dropped; the message continues;
 * - a frame that skips ahead is a GAP: the whole message is abandoned, since
 *   frames are never retransmitted (the sender retries the request with a new
 *   msgId and the same Idempotency-Key);
 * - a message that stops receiving frames for `reassemblyTimeoutMs`, or grows
 *   past `maxMessageBytes`, is abandoned.
 * Frames of different msgIds may be interleaved.
 */

export type FrameErrorCode =
  | 'MALFORMED_FRAME'
  | 'UNSUPPORTED_FLAGS'
  | 'DUPLICATE_FRAME'
  | 'MISSING_START'
  | 'GAP'
  | 'FLAGS_MISMATCH'
  | 'MESSAGE_TOO_LARGE'
  | 'TOO_MANY_PENDING'
  | 'TIMEOUT';

export interface FrameError {
  readonly code: FrameErrorCode;
  /** `frame`: only the offending frame was dropped. `message`: the partial message was discarded. */
  readonly dropped: 'frame' | 'message';
  readonly msgId?: number;
  readonly seq?: number;
  readonly expectedSeq?: number;
  readonly message: string;
}

export interface AssembledMessage {
  readonly msgId: number;
  /** Wire bytes; still compressed when `compressed` is true (see `decodeMessageBody`). */
  readonly payload: Uint8Array;
  readonly compressed: boolean;
  readonly frames: number;
}

export type AssemblerEvent =
  | { readonly kind: 'message'; readonly message: AssembledMessage }
  | { readonly kind: 'error'; readonly error: FrameError };

export interface FrameAssemblerOptions {
  /** Upper bound on a message's wire size. Default 256 KiB. */
  readonly maxMessageBytes?: number;
  /** Abandon a message after this long without a new frame. Default 10 s. */
  readonly reassemblyTimeoutMs?: number;
  /** Messages in progress at once. Default 16. */
  readonly maxPendingMessages?: number;
  /** Injected clock in ms (monotonic preferred). Default `Date.now`. */
  readonly now?: () => number;
}

export const DEFAULT_MAX_MESSAGE_BYTES = 256 * 1024;
export const DEFAULT_REASSEMBLY_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_PENDING_MESSAGES = 16;
const MAX_RECENT_IDS = 1024;

interface Pending {
  readonly compressed: boolean;
  readonly chunks: Uint8Array[];
  nextSeq: number;
  bytes: number;
  lastFrameAt: number;
}

export class FrameAssembler {
  private readonly maxMessageBytes: number;
  private readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;
  private readonly pending = new Map<number, Pending>();
  /** msgIds that recently completed or were abandoned → when; later frames for them are stale. */
  private readonly recent = new Map<number, { at: number; completed: boolean }>();

  constructor(options: FrameAssemblerOptions = {}) {
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.timeoutMs = options.reassemblyTimeoutMs ?? DEFAULT_REASSEMBLY_TIMEOUT_MS;
    this.maxPending = options.maxPendingMessages ?? DEFAULT_MAX_PENDING_MESSAGES;
    this.now = options.now ?? Date.now;
  }

  /** Messages currently being reassembled. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Feeds one frame. Returns every event it caused: possibly timeouts of other
   * messages, then this frame's error or completed message. An empty array means
   * the frame was accepted and its message is still incomplete.
   */
  push(raw: Uint8Array): AssemblerEvent[] {
    const events = this.expire();
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      events.push(error({ ...decoded.error, dropped: 'frame' }));
      return events;
    }
    const outcome = this.accept(decoded.frame);
    if (outcome) events.push(outcome);
    return events;
  }

  /**
   * Abandons messages idle for longer than the timeout. `push` calls this
   * itself; call it from a timer as well so a stalled message is reported
   * even when no further frames arrive.
   */
  expire(): AssemblerEvent[] {
    const now = this.now();
    const events: AssemblerEvent[] = [];
    for (const [msgId, p] of this.pending) {
      if (now - p.lastFrameAt > this.timeoutMs) {
        this.abandon(msgId, now, false);
        events.push(
          error({
            code: 'TIMEOUT',
            dropped: 'message',
            msgId,
            expectedSeq: p.nextSeq,
            message: `msgId ${msgId} idle for more than ${this.timeoutMs} ms after ${p.nextSeq} frame(s)`,
          }),
        );
      }
    }
    for (const [msgId, r] of this.recent) {
      if (now - r.at > this.timeoutMs) this.recent.delete(msgId);
    }
    return events;
  }

  /** Drops all state, e.g. after a disconnect. */
  reset(): void {
    this.pending.clear();
    this.recent.clear();
  }

  private accept(frame: DecodedFrame): AssemblerEvent | undefined {
    const now = this.now();
    const { msgId, seq } = frame;
    let p = this.pending.get(msgId);

    if (!p) {
      const recent = this.recent.get(msgId);
      if (recent) {
        // Late frames of an abandoned message are expected noise after a GAP or TIMEOUT.
        return recent.completed
          ? error({
              code: 'DUPLICATE_FRAME',
              dropped: 'frame',
              msgId,
              seq,
              message: `msgId ${msgId} already completed`,
            })
          : undefined;
      }
      if (seq !== 0) {
        return error({
          code: 'MISSING_START',
          dropped: 'frame',
          msgId,
          seq,
          expectedSeq: 0,
          message: `msgId ${msgId} starts at seq ${seq}`,
        });
      }
      if (this.pending.size >= this.maxPending) {
        return error({
          code: 'TOO_MANY_PENDING',
          dropped: 'frame',
          msgId,
          seq,
          message: `${this.pending.size} messages already in progress`,
        });
      }
      p = { compressed: frame.compressed, chunks: [], nextSeq: 0, bytes: 0, lastFrameAt: now };
      this.pending.set(msgId, p);
    }

    if (seq < p.nextSeq) {
      return error({
        code: 'DUPLICATE_FRAME',
        dropped: 'frame',
        msgId,
        seq,
        expectedSeq: p.nextSeq,
        message: `msgId ${msgId} seq ${seq} received twice`,
      });
    }
    if (seq > p.nextSeq) {
      this.abandon(msgId, now, false);
      return error({
        code: 'GAP',
        dropped: 'message',
        msgId,
        seq,
        expectedSeq: p.nextSeq,
        message: `msgId ${msgId} expected seq ${p.nextSeq}, got ${seq}`,
      });
    }
    if (frame.compressed !== p.compressed) {
      this.abandon(msgId, now, false);
      return error({
        code: 'FLAGS_MISMATCH',
        dropped: 'message',
        msgId,
        seq,
        message: `msgId ${msgId} mixes compressed and uncompressed frames`,
      });
    }
    if (p.bytes + frame.payload.byteLength > this.maxMessageBytes) {
      this.abandon(msgId, now, false);
      return error({
        code: 'MESSAGE_TOO_LARGE',
        dropped: 'message',
        msgId,
        seq,
        message: `msgId ${msgId} exceeds ${this.maxMessageBytes} B`,
      });
    }
    if (!frame.last && seq === MAX_SEQ) {
      this.abandon(msgId, now, false);
      return error({
        code: 'MESSAGE_TOO_LARGE',
        dropped: 'message',
        msgId,
        seq,
        message: `msgId ${msgId} ran out of sequence numbers`,
      });
    }

    // Copy: the caller may reuse the buffer (Web Bluetooth's DataView, bleno's Buffer pool).
    p.chunks.push(frame.payload.slice());
    p.bytes += frame.payload.byteLength;
    p.nextSeq = seq + 1;
    p.lastFrameAt = now;
    if (!frame.last) return undefined;

    this.pending.delete(msgId);
    this.remember(msgId, now, true);
    return {
      kind: 'message',
      message: {
        msgId,
        payload: concatBytes(p.chunks, p.bytes),
        compressed: p.compressed,
        frames: p.nextSeq,
      },
    };
  }

  private abandon(msgId: number, now: number, completed: boolean): void {
    this.pending.delete(msgId);
    this.remember(msgId, now, completed);
  }

  private remember(msgId: number, at: number, completed: boolean): void {
    this.recent.delete(msgId);
    this.recent.set(msgId, { at, completed });
    if (this.recent.size > MAX_RECENT_IDS) {
      const oldest = this.recent.keys().next();
      if (!oldest.done) this.recent.delete(oldest.value);
    }
  }
}

function error(e: FrameError): AssemblerEvent {
  return { kind: 'error', error: e };
}
