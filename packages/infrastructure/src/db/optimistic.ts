import { DomainError } from '@restroos/domain';
import type Database from 'better-sqlite3-multiple-ciphers';

/**
 * Repositories update versioned rows with `… WHERE id = ? AND version = ?`.
 * Zero changed rows means someone else saved first: surface it as a
 * VERSION_CONFLICT so the API can return 409 with the current state.
 */
export function assertVersionMatched(
  result: Database.RunResult,
  entityType: string,
  id: string,
): void {
  if (result.changes === 0) {
    throw new DomainError(
      'VERSION_CONFLICT',
      `${entityType} ${id} was changed by someone else; reload and try again`,
      { entityType, id },
    );
  }
}
