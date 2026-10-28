import { invariant } from './result';

declare const brand: unique symbol;

/** A UUID tagged with the kind of thing it identifies, so an OrderId can't be passed as a UserId. */
export type Id<Kind extends string> = string & { readonly [brand]: Kind };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function asId<Kind extends string>(value: string): Id<Kind> {
  invariant(isUuid(value), 'ID_INVALID', `not a lowercase UUID: "${value}"`);
  return value as Id<Kind>;
}
