import type { BackupKeyMaterial, KeyDerivation } from '@restroos/application';
import { randomBytes, scrypt } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;

/**
 * Turns the owner's backup passphrase into a 256-bit key. The parameters and
 * salt are kept (`kdf`) and written into every backup header, so the same
 * passphrase re-derives the key when restoring onto a new PC.
 */
export class ScryptKeyDerivation implements KeyDerivation {
  deriveBackupKey(passphrase: string): Promise<BackupKeyMaterial> {
    const salt = randomBytes(16);
    return new Promise((resolve, reject) => {
      scrypt(
        passphrase.normalize('NFKC'),
        salt,
        32,
        { N, r: R, p: P, maxmem: 64 * 1024 * 1024 },
        (error, key) => {
          if (error) return reject(error);
          resolve({
            kdf: `scrypt$${N}$${R}$${P}$${salt.toString('base64')}`,
            keyHex: key.toString('hex'),
          });
        },
      );
    });
  }

  /** The key for an existing `kdf` (from a backup header) and its passphrase. */
  keyFor(passphrase: string, kdf: string): Promise<string> {
    const [name, n, r, p, salt] = kdf.split('$');
    if (name !== 'scrypt' || !n || !r || !p || !salt) throw new Error(`unknown kdf ${name}`);
    return new Promise((resolve, reject) => {
      scrypt(
        passphrase.normalize('NFKC'),
        Buffer.from(salt, 'base64'),
        32,
        { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key.toString('hex'))),
      );
    });
  }
}
