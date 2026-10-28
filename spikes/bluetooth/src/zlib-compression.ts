import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { BleCodecError, type BleCompression } from '@restroos/contracts/ble';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Node implementation of the injectable codec compression. Interoperates with
 * the browser's CompressionStream('gzip'); the loopback test checks both ways.
 */
export const zlibGzip: BleCompression = {
  compress: async (data) => new Uint8Array(await gzipAsync(data)),
  decompress: async (data, maxOutputBytes) => {
    try {
      // maxOutputLength makes zlib stop (RangeError) instead of inflating a bomb.
      return new Uint8Array(await gunzipAsync(data, { maxOutputLength: maxOutputBytes }));
    } catch (error) {
      if (error instanceof RangeError) {
        throw new BleCodecError(
          'MESSAGE_TOO_LARGE',
          `decompressed message exceeds ${maxOutputBytes} B`,
        );
      }
      throw new BleCodecError('DECOMPRESSION_FAILED', `gunzip failed: ${String(error)}`);
    }
  },
};
