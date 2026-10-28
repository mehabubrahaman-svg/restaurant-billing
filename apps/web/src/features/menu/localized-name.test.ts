import { describe, expect, it } from 'vitest';
import { cleanTranslations, localizedName } from './localized-name';

describe('localizedName', () => {
  const names = { hi: 'चिकन बिरयानी', bn: 'চিকেন বিরিয়ানি' };

  it('uses the translation for the UI language', () => {
    expect(localizedName('Chicken Biryani', names, 'hi-IN')).toBe('चिकन बिरयानी');
    expect(localizedName('Chicken Biryani', names, 'bn-IN')).toBe('চিকেন বিরিয়ানি');
  });

  it('falls back to the main name for English or a missing translation', () => {
    expect(localizedName('Chicken Biryani', names, 'en-IN')).toBe('Chicken Biryani');
    expect(localizedName('Masala Chai', { hi: '  ' }, 'hi-IN')).toBe('Masala Chai');
    expect(localizedName('Masala Chai', {}, 'bn-IN')).toBe('Masala Chai');
  });

  it('cleans empty translations before sending', () => {
    expect(cleanTranslations(' मसाला चाय ', '')).toEqual({ hi: 'मसाला चाय' });
  });
});
