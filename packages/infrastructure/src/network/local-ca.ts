import { generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto';
import forge from 'node-forge';

/** Where the CA and server certificate are kept (inside the encrypted database). */
export interface TlsSecretStore {
  get(name: string): string | undefined;
  put(name: string, value: string): void;
}

export interface TlsMaterial {
  readonly caCertPem: string;
  /** SHA-256 of the CA certificate, "AB:CD:…", shown on pairing screens so staff can compare. */
  readonly caFingerprint: string;
  readonly serverKeyPem: string;
  readonly serverCertPem: string;
}

const CA_YEARS = 10;
/** Kept under 398 days, which browsers accept for leaf certificates. */
const SERVER_DAYS = 397;
const RENEW_WITHIN_DAYS = 30;

/**
 * The Hub's own certificate authority (docs/01 §3, §6). Devices trust it once,
 * at pairing; the Hub then serves HTTPS on the LAN with a certificate it signs
 * for its current addresses. The server certificate is re-issued when the
 * addresses change (new router, new DHCP lease) or it nears expiry. The CA
 * itself stays the same for 10 years, so paired devices keep trusting the Hub.
 */
export function ensureTlsMaterial(
  secrets: TlsSecretStore,
  names: { dns: readonly string[]; ips: readonly string[] },
  now: Date = new Date(),
): TlsMaterial {
  let caKeyPem = secrets.get('tls.ca.key');
  let caCertPem = secrets.get('tls.ca.cert');
  if (!caKeyPem || !caCertPem) {
    ({ keyPem: caKeyPem, certPem: caCertPem } = issueCa(now));
    secrets.put('tls.ca.key', caKeyPem);
    secrets.put('tls.ca.cert', caCertPem);
  }

  const sans = JSON.stringify({ dns: [...names.dns].sort(), ips: [...names.ips].sort() });
  let serverKeyPem = secrets.get('tls.server.key');
  let serverCertPem = secrets.get('tls.server.cert');
  const stale =
    !serverKeyPem ||
    !serverCertPem ||
    secrets.get('tls.server.sans') !== sans ||
    new Date(new X509Certificate(serverCertPem).validTo).getTime() - now.getTime() <
      RENEW_WITHIN_DAYS * 86_400_000;
  if (stale) {
    ({ keyPem: serverKeyPem, certPem: serverCertPem } = issueServer(
      caKeyPem,
      caCertPem,
      names,
      now,
    ));
    secrets.put('tls.server.key', serverKeyPem);
    secrets.put('tls.server.cert', serverCertPem);
    secrets.put('tls.server.sans', sans);
  }

  return {
    caCertPem,
    caFingerprint: new X509Certificate(caCertPem).fingerprint256,
    serverKeyPem: serverKeyPem!,
    serverCertPem: serverCertPem!,
  };
}

function rsaKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    keyPem: privateKey,
    forgePrivate: forge.pki.privateKeyFromPem(privateKey),
    forgePublic: forge.pki.publicKeyFromPem(publicKey),
  };
}

function serial(): string {
  // Positive, non-zero 128-bit serial.
  const bytes = randomBytes(16);
  bytes[0] = (bytes[0]! & 0x7f) | 0x01;
  return bytes.toString('hex');
}

function issueCa(now: Date) {
  const keys = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.forgePublic;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + CA_YEARS * 365 * 86_400_000);
  const subject = [
    { name: 'commonName', value: `RestroOS Hub CA ${serial().slice(0, 8)}` },
    { name: 'organizationName', value: 'RestroOS (local)' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.forgePrivate, forge.md.sha256.create());
  return { keyPem: keys.keyPem, certPem: forge.pki.certificateToPem(cert) };
}

function issueServer(
  caKeyPem: string,
  caCertPem: string,
  names: { dns: readonly string[]; ips: readonly string[] },
  now: Date,
) {
  const ca = forge.pki.certificateFromPem(caCertPem);
  const caKey = forge.pki.privateKeyFromPem(caKeyPem);
  const keys = rsaKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.forgePublic;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - 60_000);
  cert.validity.notAfter = new Date(now.getTime() + SERVER_DAYS * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: names.dns[0] ?? 'restro.local' }]);
  cert.setIssuer(ca.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        ...names.dns.map((value) => ({ type: 2, value })),
        ...names.ips.map((ip) => ({ type: 7, ip })),
      ],
    },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { keyPem: keys.keyPem, certPem: forge.pki.certificateToPem(cert) };
}
