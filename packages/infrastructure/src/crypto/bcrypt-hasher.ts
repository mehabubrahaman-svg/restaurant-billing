import type { PasswordHasher } from '@restroos/application';
import bcrypt from 'bcryptjs';

/**
 * bcrypt, as the brief requires. Passwords use cost 12. PINs use cost 10:
 * a 4–6 digit PIN can't be made strong by hashing, so it's protected by
 * lockout and the encrypted database instead, and a fast PIN switch matters
 * at a busy counter. bcryptjs's async API yields to the event loop, so a
 * login never stalls other requests.
 */
export class BcryptPasswordHasher implements PasswordHasher {
  private readonly dummy: Promise<string>;

  constructor(private readonly costs = { password: 12, pin: 10 }) {
    this.dummy = bcrypt.hash('restroos-timing-equaliser', costs.password);
  }

  hash(secret: string, kind: 'password' | 'pin'): Promise<string> {
    return bcrypt.hash(secret, this.costs[kind]);
  }

  verify(secret: string, hash: string): Promise<boolean> {
    return bcrypt.compare(secret, hash);
  }

  async verifyNothing(): Promise<void> {
    await bcrypt.compare('not-a-real-secret', await this.dummy);
  }
}
