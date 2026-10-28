import {
  BLE_ROUTE_NOT_ALLOWED,
  FrameAssembler,
  bleRequestSchema,
  decodeJson,
  decodeMessageBody,
  encodeJson,
  encodeMessage,
  matchBleRoute,
  type AssembledMessage,
  type BleCompression,
  type BleResponse,
  type FrameError,
} from '@restroos/contracts/ble';
import {
  MAX_SOURCE_BYTES,
  SPIKE_PATHS,
  filler,
  type HubStats,
  type LinkStats,
  type SinkResult,
} from './bench-protocol';

/**
 * The Hub's handler for ONE connected central, with no Bluetooth in it:
 * frames in (from `cmd-in` writes), frames out (to `evt-out` notifications).
 * `hub.ts` wires it to bleno; the loopback test wires it to an RpcClient.
 */

export interface HubSessionOptions {
  readonly id: string;
  readonly address: string;
  /** Sends one frame as an `evt-out` notification. */
  readonly notify: (frame: Uint8Array) => Promise<void>;
  /** Current ATT MTU of this link (it can change after the session starts). */
  readonly mtu: () => number;
  /** Hub-wide msgId counter for `evt-out`: unique even if a stack broadcasts notifications. */
  readonly nextMsgId: () => number;
  readonly compression?: BleCompression;
  readonly hubStats?: () => HubStats;
  /** Drops this link (bench `disconnect`). */
  readonly disconnect?: () => void;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

const MAX_MESSAGE_BYTES = 256 * 1024;

export class HubSession {
  private readonly assembler: FrameAssembler;
  private readonly connectedAt = new Date();
  private sendChain: Promise<void> = Promise.resolve();
  private readonly counters = {
    framesIn: 0,
    framesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    messagesIn: 0,
    messagesOut: 0,
  };
  private readonly frameErrors: Record<string, number> = {};
  private closed = false;

  constructor(private readonly options: HubSessionOptions) {
    this.assembler = new FrameAssembler({
      maxMessageBytes: MAX_MESSAGE_BYTES,
      ...(options.now ? { now: options.now } : {}),
    });
  }

  /** Feed every `cmd-in` write here. Never throws; problems are counted and logged. */
  onFrame(frame: Uint8Array): void {
    if (this.closed) return;
    this.counters.framesIn++;
    this.counters.bytesIn += frame.byteLength;
    for (const event of this.assembler.push(frame)) {
      if (event.kind === 'error') this.recordFrameError(event.error);
      else void this.handleMessage(event.message);
    }
  }

  /** Call periodically so stalled messages are reported. */
  tick(): void {
    for (const event of this.assembler.expire()) {
      if (event.kind === 'error') this.recordFrameError(event.error);
    }
  }

  /** Resolves once every queued notification has been handed to the stack. */
  drain(): Promise<void> {
    return this.sendChain;
  }

  close(): void {
    this.closed = true;
    this.assembler.reset();
  }

  stats(): LinkStats {
    return {
      id: this.options.id,
      address: this.options.address,
      connectedAt: this.connectedAt.toISOString(),
      mtu: this.options.mtu(),
      ...this.counters,
      frameErrors: { ...this.frameErrors },
    };
  }

  private async handleMessage(message: AssembledMessage): Promise<void> {
    this.counters.messagesIn++;
    let raw: unknown;
    try {
      const body = await decodeMessageBody(message, {
        maxMessageBytes: MAX_MESSAGE_BYTES,
        ...(this.options.compression ? { compression: this.options.compression } : {}),
      });
      raw = decodeJson(body);
    } catch (error) {
      this.log(`msgId ${message.msgId}: undecodable message: ${String(error)}`);
      return;
    }
    const parsed = bleRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const id = typeof raw === 'object' && raw !== null && 'id' in raw ? raw.id : undefined;
      if (typeof id === 'string' && id.length > 0 && id.length <= 64) {
        await this.respond(problem(id, 422, 'VALIDATION_FAILED', parsed.error.message));
      } else {
        this.log(`msgId ${message.msgId}: request without a usable id dropped`);
      }
      return;
    }
    const request = parsed.data;

    switch (request.path) {
      case SPIKE_PATHS.echo:
        return this.respond({ id: request.id, status: 200, headers: {}, body: request.body });

      case SPIKE_PATHS.sink: {
        const data = bodyField(request.body, 'data');
        if (typeof data !== 'string') {
          return this.respond(
            problem(request.id, 422, 'VALIDATION_FAILED', 'body.data must be a string'),
          );
        }
        const result: SinkResult = {
          receivedChars: data.length,
          wireBytes: message.payload.byteLength,
          frames: message.frames,
        };
        return this.respond({ id: request.id, status: 200, headers: {}, body: result });
      }

      case SPIKE_PATHS.source: {
        const bytes = bodyField(request.body, 'bytes');
        if (
          typeof bytes !== 'number' ||
          !Number.isInteger(bytes) ||
          bytes < 0 ||
          bytes > MAX_SOURCE_BYTES
        ) {
          return this.respond(
            problem(
              request.id,
              422,
              'VALIDATION_FAILED',
              `body.bytes must be 0…${MAX_SOURCE_BYTES}`,
            ),
          );
        }
        const compress = bodyField(request.body, 'compress') === true;
        return this.respond(
          { id: request.id, status: 200, headers: {}, body: { data: filler(bytes) } },
          compress,
        );
      }

      case SPIKE_PATHS.stats:
        return this.respond({
          id: request.id,
          status: 200,
          headers: {},
          body: { link: this.stats(), hub: this.options.hubStats?.() },
        });

      case SPIKE_PATHS.disconnect:
        await this.respond({ id: request.id, status: 200, headers: {}, body: { ok: true } });
        // Give the stack a moment to flush the notification before dropping the link.
        setTimeout(() => this.options.disconnect?.(), 100);
        return;
    }

    if (request.path.startsWith('/_spike/')) {
      return this.respond(
        problem(request.id, 404, 'NOT_FOUND', `unknown bench command ${request.path}`),
      );
    }
    if (!matchBleRoute(request.method, request.path)) {
      return this.respond(
        problem(
          request.id,
          403,
          BLE_ROUTE_NOT_ALLOWED,
          `${request.method} ${request.path} is not allowed over Bluetooth`,
        ),
      );
    }
    // Allowed in production, but the spike has no application layer behind it.
    return this.respond(
      problem(request.id, 501, 'NOT_IMPLEMENTED_IN_SPIKE', `${request.method} ${request.path}`),
    );
  }

  /** Queues a response; responses go out one message at a time, in order. */
  private respond(response: BleResponse, compress = true): Promise<void> {
    const send = this.sendChain.then(async () => {
      if (this.closed) return;
      const frames = await encodeMessage(encodeJson(response), {
        mtu: this.options.mtu(),
        msgId: this.options.nextMsgId(),
        ...(compress && this.options.compression ? { compression: this.options.compression } : {}),
      });
      for (const frame of frames) {
        if (this.closed) return;
        await this.options.notify(frame);
        this.counters.framesOut++;
        this.counters.bytesOut += frame.byteLength;
      }
      this.counters.messagesOut++;
    });
    this.sendChain = send.catch((error: unknown) => this.log(`notify failed: ${String(error)}`));
    return this.sendChain;
  }

  private recordFrameError(error: FrameError): void {
    this.frameErrors[error.code] = (this.frameErrors[error.code] ?? 0) + 1;
    this.log(`frame error ${error.code}: ${error.message}`);
  }

  private log(line: string): void {
    this.options.log?.(`[${this.options.id} ${this.options.address}] ${line}`);
  }
}

function bodyField(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[key]
    : undefined;
}

/** RFC 9457 problem body, as every API error (docs/05 §1). */
function problem(id: string, status: number, code: string, detail: string): BleResponse {
  return {
    id,
    status,
    headers: { 'content-type': 'application/problem+json' },
    body: { type: 'about:blank', title: code, status, code, detail },
  };
}
