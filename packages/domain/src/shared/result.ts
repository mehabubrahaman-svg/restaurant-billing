export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * A rule of the business was violated. `code` is stable and machine readable
 * (it becomes the API error code); `message` is for logs and developers.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Throws a DomainError when `condition` is false. For invariants inside value objects. */
export function invariant(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
