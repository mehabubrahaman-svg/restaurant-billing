/**
 * Throwaway local CA + server certificate for serving the measurement page
 * over HTTPS, generated with the system `openssl` (no npm dependency). It
 * rehearses the production design (docs/01 §6.1: tablets trust a local CA).
 * Spike only: keys are unencrypted, stored under ~/.cache, valid 30 days.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function spikeCertDir(): string {
  return (
    process.env['RESTROOS_SPIKE_CERT_DIR'] ?? join(homedir(), '.cache', 'restroos-spike-certs')
  );
}

export function spikeCaCertPath(): string {
  return join(spikeCertDir(), 'ca.crt');
}

export interface ServerCert {
  readonly caCertPath: string;
  readonly certPath: string;
  readonly keyPath: string;
}

function openssl(args: string[]): void {
  execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * Creates the CA once (so it is installed on the tablets once) and a fresh
 * server certificate for the current IPs on every call.
 */
export function ensureServerCert(ipAddresses: readonly string[]): ServerCert {
  const dir = spikeCertDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caKey = join(dir, 'ca.key');
  const caCert = spikeCaCertPath();
  const key = join(dir, 'server.key');
  const csr = join(dir, 'server.csr');
  const cert = join(dir, 'server.crt');
  const ext = join(dir, 'server.ext');
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];

  if (!existsSync(caCert) || !existsSync(caKey)) {
    openssl([
      'req',
      '-x509',
      ...ec,
      '-keyout',
      caKey,
      '-out',
      caCert,
      '-days',
      '30',
      '-subj',
      '/CN=RestroOS Bluetooth Spike CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
  }

  const san = ['DNS:localhost', 'DNS:restro.local', ...ipAddresses.map((ip) => `IP:${ip}`)];
  writeFileSync(
    ext,
    [
      'basicConstraints=critical,CA:FALSE',
      'keyUsage=critical,digitalSignature',
      'extendedKeyUsage=serverAuth',
      `subjectAltName=${san.join(',')}`,
    ].join('\n'),
  );
  openssl(['req', ...ec, '-keyout', key, '-out', csr, '-subj', '/CN=restroos-spike']);
  openssl([
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-days',
    '30',
    '-out',
    cert,
    '-extfile',
    ext,
  ]);
  return { caCertPath: caCert, certPath: cert, keyPath: key };
}
