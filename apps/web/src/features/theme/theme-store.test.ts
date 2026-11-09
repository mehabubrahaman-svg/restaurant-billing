import { describe, expect, it } from 'vitest';
import { applyTextSize, applyTheme, effectiveTheme, markGuestPage } from './theme-store';

describe('theme and text size', () => {
  it('kitchen screens default to dark, everything else follows the OS, and a choice wins', () => {
    expect(effectiveTheme(null, 'KDS')).toBe('dark');
    expect(effectiveTheme(null, 'CAPTAIN')).toBe('system');
    expect(effectiveTheme('light', 'KDS')).toBe('light');
  });

  it('marks the page with the theme and the text size, and clears the defaults', () => {
    const root = document.createElement('html');
    applyTheme('high-contrast', root);
    expect(root.dataset['theme']).toBe('high-contrast');
    applyTheme('system', root);
    expect(root.dataset['theme']).toBeUndefined();

    applyTextSize('xlarge', root);
    expect(root.dataset['textSize']).toBe('xlarge');
    applyTextSize('large', root);
    expect(root.dataset['textSize']).toBe('large');
    applyTextSize('default', root);
    expect(root.dataset['textSize']).toBeUndefined();
  });

  it('marks the guest menu while it is open, so it keeps the phone’s own text size', () => {
    const root = document.createElement('html');
    const leave = markGuestPage(root);
    expect(root.dataset['guest']).toBe('');
    leave();
    expect(root.dataset['guest']).toBeUndefined();
  });
});
