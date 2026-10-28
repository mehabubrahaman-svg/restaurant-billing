import { DomainError } from '../shared/result';

/** min ≤ max ≤ number of addons, so a guest can always satisfy the group. */
export function assertAddonGroupLimits(
  minSelect: number,
  maxSelect: number,
  addonCount: number,
): void {
  if (minSelect > maxSelect) {
    throw new DomainError('ADDON_GROUP_INVALID', 'minimum choices cannot exceed the maximum');
  }
  if (maxSelect > addonCount) {
    throw new DomainError(
      'ADDON_GROUP_INVALID',
      `maximum choices (${maxSelect}) exceeds the ${addonCount} add-ons`,
    );
  }
}

export function assertUniqueNames(names: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) throw new DomainError('DUPLICATE_NAME', `${what} "${name}" appears twice`);
    seen.add(key);
  }
}
