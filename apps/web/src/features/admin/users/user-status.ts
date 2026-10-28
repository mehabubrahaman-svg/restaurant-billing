import type { User } from '@restroos/contracts';

export function isLocked(user: Pick<User, 'lockedUntil'>, now = Date.now()): boolean {
  return user.lockedUntil !== null && Date.parse(user.lockedUntil) > now;
}
