import type { Role } from '@restroos/contracts';
import type { TFunction } from 'i18next';
import { tDynamic } from '../../../lib/dynamic-t';

/** Built-in roles are translated by code; custom roles keep the name the owner typed. */
export function roleName(t: TFunction, role: Pick<Role, 'code' | 'name' | 'isSystem'>): string {
  return role.isSystem ? tDynamic(t, `roleNames.${role.code}`, role.name) : role.name;
}
