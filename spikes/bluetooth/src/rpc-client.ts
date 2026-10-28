import {
  FrameAssembler,
  bleOutboundSchema,
  createMsgIdCounter,
  decodeJson,
  decodeMessageBody,
  encodeJson,
  encodeMessage,
  isBleResponse,
  type BleCompression,
  type BleEvent,
  type BleRequest,
  type BleResponse,
  type FrameError,
} from '@restroos/contracts/ble';

/**
 * Tablet side of the BLE command channel, independent of the Bluetooth API:
 * the page plugs in Web Bluetooth, the loopback test plugs in the Hub session
 * directly. Correlates responses to requests by envelope `id`.
 */

export interface RpcClientOptions {
  /** Writes one frame to `cmd-in`. Must resolve once the stack accepted it. */
  readonly writeFrame: (frame: Uint8Array) => Promise<void>;
  /** ATT MTU used to size outgoing frames; change it with `setMtu`. */
  readonly mtu: number;
  readonly compression?: BleCompression;
  readonly requestTimeoutMs?: number;
  readonly now?: () => number;
  readonly onEvent?: (event: BleEvent) => void;
  readonly onFrameError?: (error: FrameError) => void;
}

export interface RpcResult {
  readonly response: BleResponse;
  /** When `request` was called, its last frame was accepted, and its response completed. */
  readonly startedAt: number;
  readonly writtenAt: number;
  readonly receivedAt: number;
  readonly framesOut: number;
  readonly wireBytesOut: number;
  readonly framesIn: number;
  readonly wireBytesIn: number;
}

/** The part of an RpcResult known when the response arrives. */
type Received = Pick<RpcResult, 'response' | 'receivedAt' | 'framesIn' | 'wireBytesIn'>;

interface Pending {
  readonly resolve: (r: Received) => void;
  readonly reject: (e: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class RpcClient {
  private mtu: number;
  private assembler: FrameAssembler;
  private readonly nextMsgId = createMsgIdCounter();
  private readonly pending = new Map<string, Pending>();
  private writeChain: Promise<void> = Promise.resolve();
  private requestCounter = 0;
  private readonly now: () => number;

  constructor(private readonly options: RpcClientOptions) {
    this.mtu = options.mtu;
    this.now = options.now ?? (() => performance.now());
    this.assembler = this.newAssembler();
  }

  setMtu(mtu: number): void {
    this.mtu = mtu;
  }

  get currentMtu(): number {
    return this.mtu;
  }

  /** Feed every `evt-out` notification here. */
  onFrame(frame: Uint8Array): void {
    for (const event of this.assembler.push(frame)) {
      if (event.kind === 'error') {
        this.options.onFrameError?.(event.error);
        continue;
      }
      const { message } = event;
      void decodeMessageBody(message, this.decodeOptions())
        .then((body) => {
          const parsed = bleOutboundSchema.safeParse(decodeJson(body));
          if (!parsed.success) throw new Error(`invalid evt-out message: ${parsed.error.message}`);
          if (!isBleResponse(parsed.data)) {
            this.options.onEvent?.(parsed.data);
            return;
          }
          const pending = this.pending.get(parsed.data.id);
          if (!pending) return; // late response to a request that already timed out
          this.pending.delete(parsed.data.id);
          clearTimeout(pending.timer);
          pending.resolve({
            response: parsed.data,
            receivedAt: this.now(),
            framesIn: message.frames,
            wireBytesIn: message.payload.byteLength,
          });
        })
        .catch((error: unknown) =>
          this.options.onFrameError?.({
            code: 'MALFORMED_FRAME',
            dropped: 'message',
            msgId: message.msgId,
            message: String(error),
          }),
        );
    }
  }

  /** Sends a request and waits for its response. `compress: false` forces raw frames. */
  async request(
    request: Omit<BleRequest, 'id' | 'headers'> & Partial<Pick<BleRequest, 'id' | 'headers'>>,
    options: { compress?: boolean; timeoutMs?: number } = {},
  ): Promise<RpcResult> {
    const envelope: BleRequest = {
      ...request,
      id: request.id ?? `r${++this.requestCounter}-${Math.round(this.now())}`,
      headers: request.headers ?? {},
    };
    const startedAt = this.now();
    const compression = options.compress === false ? undefined : this.options.compression;
    const frames = await encodeMessage(encodeJson(envelope), {
      mtu: this.mtu,
      msgId: this.nextMsgId(),
      ...(compression ? { compression } : {}),
    });

    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 30_000;
    const response = new Promise<Received>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.id);
        reject(new Error(`request ${envelope.id} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(envelope.id, { resolve, reject, timer });
    });
    // Avoid an unhandled rejection if writing fails before anyone awaits `response`.
    response.catch(() => undefined);

    try {
      await this.enqueueWrites(frames);
    } catch (error) {
      this.fail(envelope.id, error);
      throw error;
    }
    const writtenAt = this.now();
    const result = await response;
    return {
      ...result,
      startedAt,
      writtenAt,
      framesOut: frames.length,
      wireBytesOut: frames.reduce((n, f) => n + f.byteLength, 0),
    };
  }

  /** Fails every outstanding request and forgets partial messages (call on disconnect). */
  reset(reason = 'disconnected'): void {
    for (const id of [...this.pending.keys()]) this.fail(id, new Error(reason));
    this.assembler = this.newAssembler();
    this.writeChain = Promise.resolve();
  }

  /** Report idle partial messages; call from a timer. */
  expire(): void {
    for (const event of this.assembler.expire()) {
      if (event.kind === 'error') this.options.onFrameError?.(event.error);
    }
  }

  /**
   * Web Bluetooth allows one GATT operation at a time per characteristic, so
   * frames of concurrent requests are written strictly one after another.
   */
  private enqueueWrites(frames: readonly Uint8Array[]): Promise<void> {
    const run = this.writeChain.then(async () => {
      for (const frame of frames) await this.options.writeFrame(frame);
    });
    this.writeChain = run.catch(() => undefined);
    return run;
  }

  private fail(id: string, error: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private decodeOptions() {
    return this.options.compression ? { compression: this.options.compression } : {};
  }

  private newAssembler(): FrameAssembler {
    return new FrameAssembler({ now: this.now });
  }
}
