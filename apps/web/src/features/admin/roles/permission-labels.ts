import type { TFunction } from 'i18next';
import { tDynamic } from '../../../lib/dynamic-t';

/** Short translated name of a permission; falls back to the Hub's description, then the code. */
export function permissionLabel(t: TFunction, code: string, description?: string): string {
  return tDynamic(t, `permissionNames.${code}`, description ?? code);
}

export function moduleLabel(t: TFunction, module: string): string {
  return tDynamic(t, `permissionModules.${module}`, module);
}
