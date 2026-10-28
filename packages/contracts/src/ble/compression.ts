/**
 * Pluggable message compression. The contracts package imports neither zlib
 * nor any browser API: callers inject a `BleCompression`. `streamGzip()` uses
 * the global `CompressionStream` (Chrome ≥ 80, Android WebView, Node ≥ 18);
 * the Hub may pass a `node:zlib` implementation instead. Both produce gzip
 * (RFC 1952), so either side can decode the other.
 */

export interface BleCompression {
  readonly compress: (data: Uint8Array) => Promise<Uint8Array>;
  /**
   * Must reject (not truncate) once the output would exceed `maxOutputBytes`,
   * so a small hostile frame sequence cannot inflate into a huge allocation.
   */
  readonly decompress: (data: Uint8Array, maxOutputBytes: number) => Promise<Uint8Array>;
}

/** Messages larger than this are compressed when a `BleCompression` is available. */
export const COMPRESSION_THRESHOLD_BYTES = 512;

export type BleCodecErrorCode =
  'COMPRESSION_UNAVAILABLE' | 'DECOMPRESSION_FAILED' | 'MESSAGE_TOO_LARGE' | 'INVALID_JSON';

export class BleCodecError extends Error {
  constructor(
    readonly code: BleCodecErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BleCodecError';
  }
}

export function concatBytes(chunks: readonly Uint8Array[], totalBytes?: number): Uint8Array {
  const total = totalBytes ?? chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** gzip via the platform's `CompressionStream` / `DecompressionStream` globals. */
export function streamGzip(): BleCompression {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
    throw new BleCodecError(
      'COMPRESSION_UNAVAILABLE',
      'CompressionStream is not available on this platform',
    );
  }
  return {
    compress: (data) => pipeThrough(new CompressionStream('gzip'), data, Infinity),
    decompress: async (data, maxOutputBytes) => {
      try {
        return await pipeThrough(new DecompressionStream('gzip'), data, maxOutputBytes);
      } catch (error) {
        if (error instanceof BleCodecError) throw error;
        throw new BleCodecError('DECOMPRESSION_FAILED', `gunzip failed: ${String(error)}`);
      }
    },
  };
}

async function pipeThrough(
  transform: CompressionStream | DecompressionStream,
  data: Uint8Array,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  // Blob.stream() handles back-pressure on the write side; the copy pins the
  // buffer type to ArrayBuffer as BlobPart requires.
  const reader = new Blob([new Uint8Array(data)]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxOutputBytes) {
      await reader.cancel();
      throw new BleCodecError(
        'MESSAGE_TOO_LARGE',
        `decompressed message exceeds ${maxOutputBytes} B`,
      );
    }
    chunks.push(value);
  }
  return concatBytes(chunks, total);
}
