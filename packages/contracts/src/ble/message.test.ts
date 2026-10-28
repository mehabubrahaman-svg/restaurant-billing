import { describe, expect, it } from 'vitest';
import { FrameAssembler, type AssembledMessage } from './assembler';
import { BleCodecError, streamGzip, type BleCompression } from './compression';
import { decodeFrame } from './frame';
import { decodeJson, decodeMessageBody, encodeJson, encodeMessage } from './message';
import { testBytes } from './test-utils';

const gzip = streamGzip();
const compressible = (size: number) =>
  new TextEncoder().encode('{"item":"Paneer Tikka"},'.repeat(size / 24 + 1)).subarray(0, size);

async function roundTrip(
  bytes: Uint8Array,
  mtu: number,
  compression?: BleCompression,
): Promise<{ frames: Uint8Array[]; message: AssembledMessage; body: Uint8Array }> {
  const frames = await encodeMessage(bytes, {
    mtu,
    msgId: 3,
    ...(compression ? { compression } : {}),
  });
  const assembler = new FrameAssembler();
  const all = frames.flatMap((f) => assembler.push(f));
  const done = all.find((e) => e.kind === 'message');
  if (done?.kind !== 'message') throw new Error(`no message: ${JSON.stringify(all)}`);
  const body = await decodeMessageBody(done.message, compression ? { compression } : {});
  return { frames, message: done.message, body };
}

describe('encodeMessage / decodeMessageBody', () => {
  it.each([23, 185, 247, 517])('round-trips a compressed 10 KB message at MTU %i', async (mtu) => {
    const bytes = compressible(10_000);
    const { frames, message, body } = await roundTrip(bytes, mtu, gzip);
    expect(message.compressed).toBe(true);
    expect(body).toEqual(bytes);
    expect(frames.length).toBeLessThan(Math.ceil(10_000 / (Math.min(mtu - 3, 512) - 5)));
  });

  it('does not compress at or below the 512-byte threshold', async () => {
    const { message } = await roundTrip(compressible(512), 185, gzip);
    expect(message.compressed).toBe(false);
    expect((await roundTrip(compressible(513), 185, gzip)).message.compressed).toBe(true);
  });

  it('honours a custom threshold', async () => {
    const frames = await encodeMessage(compressible(100), {
      mtu: 185,
      msgId: 1,
      compression: gzip,
      compressAboveBytes: 64,
    });
    expect(decodeFrame(frames[0]!)).toMatchObject({ ok: true, frame: { compressed: true } });
  });

  it('sends incompressible data uncompressed', async () => {
    const bytes = testBytes(4_000);
    const { message, body } = await roundTrip(bytes, 247, gzip);
    expect(message.compressed).toBe(false);
    expect(body).toEqual(bytes);
  });

  it('never compresses without a compressor', async () => {
    const { message } = await roundTrip(compressible(10_000), 247);
    expect(message.compressed).toBe(false);
  });

  it('works with any injected compressor', async () => {
    const calls: string[] = [];
    const reverse: BleCompression = {
      compress: async (d) => (calls.push('c'), d.slice(0, d.length / 2)),
      decompress: async (d) => (calls.push('d'), new Uint8Array([...d, ...d])),
    };
    const bytes = new Uint8Array(1_000).fill(7);
    const { body } = await roundTrip(bytes, 23, reverse);
    expect(body).toEqual(bytes);
    expect(calls).toEqual(['c', 'd']);
  });

  it('fails with COMPRESSION_UNAVAILABLE when a compressed message arrives without a decompressor', async () => {
    const frames = await encodeMessage(compressible(2_000), {
      mtu: 247,
      msgId: 1,
      compression: gzip,
    });
    const assembler = new FrameAssembler();
    const done = frames.flatMap((f) => assembler.push(f)).find((e) => e.kind === 'message');
    if (done?.kind !== 'message') throw new Error('no message');
    await expect(decodeMessageBody(done.message)).rejects.toMatchObject({
      code: 'COMPRESSION_UNAVAILABLE',
    });
  });

  it('stops inflating a compression bomb at the size limit', async () => {
    const bomb = await gzip.compress(new Uint8Array(4 * 1024 * 1024)); // 4 MiB of zeros → ~4 KB
    expect(bomb.byteLength).toBeLessThan(10_000);
    await expect(gzip.decompress(bomb, 256 * 1024)).rejects.toMatchObject({
      code: 'MESSAGE_TOO_LARGE',
    });
    const message: AssembledMessage = { msgId: 1, payload: bomb, compressed: true, frames: 1 };
    await expect(
      decodeMessageBody(message, { compression: gzip, maxMessageBytes: 1024 }),
    ).rejects.toBeInstanceOf(BleCodecError);
  });

  it('reports corrupt gzip as DECOMPRESSION_FAILED', async () => {
    await expect(gzip.decompress(testBytes(100), 1_000)).rejects.toMatchObject({
      code: 'DECOMPRESSION_FAILED',
    });
  });
});

describe('JSON helpers', () => {
  it('round-trips UTF-8 JSON, including non-Latin text', () => {
    const value = { name: 'पनीर टिक्का', qty: 2, note: null };
    expect(decodeJson(encodeJson(value))).toEqual(value);
  });

  it.each([
    ['invalid JSON', new TextEncoder().encode('{nope')],
    ['invalid UTF-8', new Uint8Array([0x7b, 0xff, 0x7d])],
  ])('rejects %s with INVALID_JSON', (_name, bytes) => {
    expect(() => decodeJson(bytes)).toThrow(expect.objectContaining({ code: 'INVALID_JSON' }));
  });
});
