import { describe, expect, it } from 'vitest';
import { MAX_ATTRIBUTE_VALUE_BYTES } from './frame';
import {
  bleHubInfoSchema,
  bleOutboundSchema,
  blePairingSchema,
  bleRequestSchema,
  bleResponseSchema,
  encodeReadValue,
  isBleResponse,
  type BleHubInfo,
} from './schemas';

const hubInfo: BleHubInfo = {
  hubId: '0190f3a2-1234-7abc-8def-0123456789ab',
  name: 'Hub – Counter 1',
  urls: ['https://192.168.1.20:7400', 'https://restro.local:7400'],
  caFingerprint: 'a'.repeat(64),
  protocol: 1,
};

describe('hub-info', () => {
  it('accepts the documented shape, with or without mtu', () => {
    expect(bleHubInfoSchema.parse(hubInfo)).toEqual(hubInfo);
    expect(bleHubInfoSchema.parse({ ...hubInfo, mtu: 247 }).mtu).toBe(247);
  });

  it.each([
    ['http URL', { urls: ['http://192.168.1.20:7400'] }],
    ['no URLs', { urls: [] }],
    ['four URLs', { urls: Array(4).fill('https://a.local') }],
    ['upper-case fingerprint', { caFingerprint: 'A'.repeat(64) }],
    ['colon fingerprint', { caFingerprint: 'aa:'.repeat(31) + 'aa' }],
    ['protocol 2', { protocol: 2 }],
    ['MTU 22', { mtu: 22 }],
    ['long name', { name: 'x'.repeat(25) }],
  ])('rejects %s', (_name, patch) => {
    expect(bleHubInfoSchema.safeParse({ ...hubInfo, ...patch }).success).toBe(false);
  });

  it('always fits one 512-byte attribute value, even at every field limit', () => {
    const worst = bleHubInfoSchema.parse({
      hubId: hubInfo.hubId,
      name: 'ह'.repeat(24), // 3 bytes per character in UTF-8
      urls: Array.from({ length: 3 }, (_, i) => `https://${'h'.repeat(40)}${i}.local:7400`),
      caFingerprint: 'f'.repeat(64),
      protocol: 1,
      mtu: 517,
    });
    expect(worst.urls[0]!.length).toBe(60);
    const bytes = encodeReadValue(worst);
    expect(bytes.byteLength).toBeLessThanOrEqual(MAX_ATTRIBUTE_VALUE_BYTES);
  });

  it('encodeReadValue refuses values over 512 bytes', () => {
    const tooBig = { ...hubInfo, name: 'x'.repeat(600) };
    expect(() => encodeReadValue(tooBig)).toThrow(RangeError);
  });
});

describe('pairing', () => {
  it('accepts a 128-bit base64url nonce', () => {
    const pairing = {
      hubId: hubInfo.hubId,
      nonce: 'q83vEjRWeJCrze8SNFZ4kA',
      expiresAt: 1_800_000_000_000,
    };
    expect(blePairingSchema.parse(pairing)).toEqual(pairing);
  });

  it.each(['short', 'has+plus/slash=padding==', ''])('rejects nonce "%s"', (nonce) => {
    expect(blePairingSchema.safeParse({ hubId: hubInfo.hubId, nonce, expiresAt: 1 }).success).toBe(
      false,
    );
  });
});

describe('envelopes', () => {
  const request = {
    id: '0190f3a2-0000-7abc-8def-0123456789ab',
    method: 'POST',
    path: '/orders/0190f3a2-1111-7abc-8def-0123456789ab/kots',
    headers: { authorization: 'Bearer x.y.z', 'idempotency-key': 'k-1' },
    body: { note: 'no onion' },
  };

  it('accepts a request, with or without a body', () => {
    expect(bleRequestSchema.parse(request)).toEqual(request);
    const { body: _body, ...noBody } = request;
    expect(bleRequestSchema.parse({ ...noBody, method: 'GET' })).not.toHaveProperty('body');
  });

  it.each([
    ['unknown method', { method: 'TRACE' }],
    ['relative path', { path: 'orders' }],
    ['upper-case header', { headers: { Authorization: 'x' } }],
    ['non-string header', { headers: { 'x-n': 1 } }],
    ['empty id', { id: '' }],
  ])('rejects a request with %s', (_name, patch) => {
    expect(bleRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
  });

  it('accepts a response and rejects an impossible status', () => {
    const response = { id: request.id, status: 201, headers: {}, body: { kotIds: [] } };
    expect(bleResponseSchema.parse(response)).toEqual(response);
    expect(bleResponseSchema.safeParse({ ...response, status: 99 }).success).toBe(false);
  });

  it('tells responses and events apart on evt-out', () => {
    const response = bleOutboundSchema.parse({ id: 'r1', status: 200, headers: {} });
    const event = bleOutboundSchema.parse({
      type: 'kitchen.kot.fired',
      seq: 18_233,
      branchId: 'b1',
      occurredAt: '2026-10-28T12:00:00.000Z',
      data: { kotId: 'k1' },
    });
    expect(isBleResponse(response)).toBe(true);
    expect(isBleResponse(event)).toBe(false);
    expect(bleOutboundSchema.safeParse({ id: 'r1' }).success).toBe(false);
  });
});
