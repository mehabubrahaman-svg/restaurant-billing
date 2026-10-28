import type { TokenCodec } from '@restroos/application';
import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random tokens. Only the SHA-256 is stored, so a database copy can't be used to sign in. */
export const nodeTokenCodec: TokenCodec = {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: sha256(token) };
  },
  hash: sha256,
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
