import { describe, expect, it } from 'vitest';
import { assertAddonGroupLimits, assertUniqueNames } from './menu-rules';

describe('menu rules', () => {
  it('keeps add-on group limits satisfiable', () => {
    expect(() => assertAddonGroupLimits(0, 2, 3)).not.toThrow();
    expect(() => assertAddonGroupLimits(2, 1, 3)).toThrow(
      expect.objectContaining({ code: 'ADDON_GROUP_INVALID' }),
    );
    expect(() => assertAddonGroupLimits(1, 4, 3)).toThrow(
      expect.objectContaining({ code: 'ADDON_GROUP_INVALID' }),
    );
  });

  it('rejects duplicate names regardless of case', () => {
    expect(() => assertUniqueNames(['Half', 'Full'], 'variant')).not.toThrow();
    expect(() => assertUniqueNames(['Half', ' half '], 'variant')).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_NAME' }),
    );
  });
});
