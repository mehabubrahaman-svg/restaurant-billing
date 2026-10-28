import type {
  AccessClaims,
  ApprovalClaims,
  Clock,
  IdGenerator,
  TokenSigner,
} from '@restroos/application';
import {
  exportPKCS8,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { SqliteSecretStore } from './secret-store';

const ISSUER = 'restroos-hub';
const AUDIENCE = 'restroos';
const ALG = 'EdDSA';
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const APPROVAL_TOKEN_TTL_MS = 60 * 1000;
const SECRET_NAME = 'jwt.ed25519.pkcs8';

/**
 * Ed25519-signed JWTs. The key pair is generated on first start and kept in
 * the encrypted database, so tokens survive restarts but never leave the Hub.
 */
export class JoseTokenSigner implements TokenSigner {
  private keys?: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }>;

  constructor(
    private readonly secrets: SqliteSecretStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async signAccess(claims: AccessClaims) {
    return this.sign(
      { typ: 'access', bid: claims.branchId, sid: claims.sessionId },
      claims.userId,
      ACCESS_TOKEN_TTL_MS,
    );
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    const payload = await this.verify(token, 'access');
    if (!payload || typeof payload['bid'] !== 'string' || typeof payload['sid'] !== 'string')
      return null;
    return { userId: payload.sub!, branchId: payload['bid'], sessionId: payload['sid'] };
  }

  async signApproval(claims: Omit<ApprovalClaims, 'tokenId'>) {
    return this.sign(
      { typ: 'approval', bid: claims.branchId, perm: claims.permission },
      claims.approverId,
      APPROVAL_TOKEN_TTL_MS,
    );
  }

  async verifyApproval(token: string): Promise<ApprovalClaims | null> {
    const payload = await this.verify(token, 'approval');
    if (
      !payload ||
      typeof payload['bid'] !== 'string' ||
      typeof payload['perm'] !== 'string' ||
      !payload.jti
    ) {
      return null;
    }
    return {
      approverId: payload.sub!,
      branchId: payload['bid'],
      permission: payload['perm'],
      tokenId: payload.jti,
    };
  }

  private async sign(claims: Record<string, string>, subject: string, ttlMs: number) {
    const { privateKey } = await this.loadKeys();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(subject)
      .setJti(this.ids.next())
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(privateKey);
    return { token, expiresAt };
  }

  private async verify(token: string, typ: string) {
    const { publicKey } = await this.loadKeys();
    try {
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.clock.now(),
      });
      return payload['typ'] === typ && typeof payload.sub === 'string' ? payload : null;
    } catch {
      return null;
    }
  }

  private loadKeys() {
    this.keys ??= (async () => {
      const pkcs8 = await this.storedOrNewKey();
      const privateKey = await importPKCS8(pkcs8, ALG);
      const publicPem = createPublicKey(createPrivateKey(pkcs8)).export({
        type: 'spki',
        format: 'pem',
      });
      const publicKey = await importSPKI(publicPem.toString(), ALG);
      return { privateKey, publicKey };
    })();
    return this.keys;
  }

  private async storedOrNewKey(): Promise<string> {
    const existing = this.secrets.get(SECRET_NAME);
    if (existing) return existing;
    const { privateKey } = await generateKeyPair(ALG, { crv: 'Ed25519', extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    // If two first requests race, the first key stored wins and both use it.
    return this.secrets.getOrCreate(SECRET_NAME, () => pkcs8);
  }
}
