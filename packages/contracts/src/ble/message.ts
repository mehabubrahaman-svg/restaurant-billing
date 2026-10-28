import type { AssembledMessage } from './assembler';
import { DEFAULT_MAX_MESSAGE_BYTES } from './assembler';
import { BleCodecError, COMPRESSION_THRESHOLD_BYTES, type BleCompression } from './compression';
import { frameMessage } from './frame';

export interface EncodeMessageOptions {
  readonly mtu: number;
  readonly msgId: number;
  /** Omit to never compress. */
  readonly compression?: BleCompression;
  /** Compress only messages strictly larger than this. Default 512 B. */
  readonly compressAboveBytes?: number;
}

/**
 * Message bytes → frames, compressing first when it pays off: the message is
 * larger than the threshold and the compressed form is actually smaller.
 */
export async function encodeMessage(
  bytes: Uint8Array,
  options: EncodeMessageOptions,
): Promise<Uint8Array[]> {
  const threshold = options.compressAboveBytes ?? COMPRESSION_THRESHOLD_BYTES;
  if (options.compression && bytes.byteLength > threshold) {
    const packed = await options.compression.compress(bytes);
    if (packed.byteLength < bytes.byteLength) {
      return frameMessage(packed, { mtu: options.mtu, msgId: options.msgId, compressed: true });
    }
  }
  return frameMessage(bytes, { mtu: options.mtu, msgId: options.msgId });
}

export interface DecodeMessageOptions {
  readonly compression?: BleCompression;
  /** Limit on the decompressed size. Default 256 KiB. */
  readonly maxMessageBytes?: number;
}

/** Assembled message → original bytes (decompressing when the frames were flagged). */
export async function decodeMessageBody(
  message: AssembledMessage,
  options: DecodeMessageOptions = {},
): Promise<Uint8Array> {
  if (!message.compressed) return message.payload;
  if (!options.compression) {
    throw new BleCodecError(
      'COMPRESSION_UNAVAILABLE',
      `msgId ${message.msgId} is compressed but no decompressor was supplied`,
    );
  }
  const max = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const body = await options.compression.decompress(message.payload, max);
  if (body.byteLength > max) {
    throw new BleCodecError('MESSAGE_TOO_LARGE', `decompressed message exceeds ${max} B`);
  }
  return body;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeJson(value: unknown): Uint8Array {
  return utf8Encoder.encode(JSON.stringify(value));
}

/** Strict UTF-8 + JSON.parse. Throws BleCodecError('INVALID_JSON'). Validate the result with a schema. */
export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8Decoder.decode(bytes)) as unknown;
  } catch (error) {
    throw new BleCodecError('INVALID_JSON', `message is not UTF-8 JSON: ${String(error)}`);
  }
}
