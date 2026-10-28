import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ensureTlsMaterial } from './local-ca';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    get: (k: string) => data.get(k),
    put: (k: string, v: string) => void data.set(k, v),
  };
}

describe('local certificate authority', () => {
  const names = { dns: ['restro.local', 'localhost'], ips: ['127.0.0.1', '192.168.1.20'] };
  const now = new Date('2026-10-28T12:00:00Z');

  it('issues a server certificate the CA vouches for, valid for the Hub’s names and addresses', () => {
    const tls = ensureTlsMaterial(memoryStore(), names, now);
    const ca = new X509Certificate(tls.caCertPem);
    const server = new X509Certificate(tls.serverCertPem);
    expect(ca.ca).toBe(true);
    expect(server.ca).toBe(false);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(server.checkIssued(ca)).toBe(true);
    expect(server.checkHost('restro.local')).toBe('restro.local');
    expect(server.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(server.checkIP('10.0.0.9')).toBeUndefined();
    expect(tls.caFingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(new Date(server.validTo).getTime() - now.getTime()).toBeLessThanOrEqual(
      398 * 86_400_000,
    );
  });

  it('keeps the CA and certificate across restarts', () => {
    const store = memoryStore();
    const first = ensureTlsMaterial(store, names, now);
    const second = ensureTlsMaterial(store, names, now);
    expect(second).toEqual(first);
  });

  it('re-issues only the server certificate when the LAN address changes', () => {
    const store = memoryStore();
    const first = ensureTlsMaterial(store, names, now);
    const moved = ensureTlsMaterial(store, { ...names, ips: ['127.0.0.1', '192.168.0.42'] }, now);
    expect(moved.caFingerprint).toBe(first.caFingerprint);
    expect(moved.serverCertPem).not.toBe(first.serverCertPem);
    expect(new X509Certificate(moved.serverCertPem).checkIP('192.168.0.42')).toBe('192.168.0.42');
  });

  it('renews the server certificate before it expires', () => {
    const store = memoryStore();
    const first = ensureTlsMaterial(store, names, now);
    const later = new Date(now.getTime() + 380 * 86_400_000);
    const renewed = ensureTlsMaterial(store, names, later);
    expect(renewed.serverCertPem).not.toBe(first.serverCertPem);
    expect(renewed.caFingerprint).toBe(first.caFingerprint);
  });
});
