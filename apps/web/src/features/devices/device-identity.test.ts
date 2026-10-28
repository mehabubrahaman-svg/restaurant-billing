import { afterEach, describe, expect, it } from 'vitest';
import { detectPlatform, deviceFingerprint, needsCertificate } from './device-identity';

afterEach(() => localStorage.clear());

describe('device identity', () => {
  it('creates a 32+ character fingerprint once and keeps it', () => {
    const first = deviceFingerprint();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(deviceFingerprint()).toBe(first);
    expect(localStorage.getItem('restroos.device-fingerprint')).toBe(first);
  });

  it('guesses the platform', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/130')).toBe('ANDROID');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('IPADOS');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('WINDOWS');
    expect(detectPlatform('curl/8')).toBe('OTHER');
  });

  it('asks for the certificate only on plain HTTP away from the Hub itself', () => {
    expect(needsCertificate({ protocol: 'http:', hostname: '192.168.1.20' })).toBe(true);
    expect(needsCertificate({ protocol: 'http:', hostname: 'localhost' })).toBe(false);
    expect(needsCertificate({ protocol: 'https:', hostname: '192.168.1.20' })).toBe(false);
  });
});
