import { describe, expect, it } from 'vitest';
import { TYPO, typo } from './typography';

describe('typography tokens', () => {
  it('every token sets a size and a line height, and nothing else about colour or layout', () => {
    for (const [name, classes] of Object.entries(TYPO)) {
      expect(classes, name).toMatch(/\btext-(\[\d+px\]|xs|sm|base|lg|xl|\dxl)(?=\s|$)/);
      expect(classes, name).toMatch(/\bleading-/);
      expect(classes, name).not.toMatch(/\b(text-(muted|primary|foreground)|bg-|p-|m-|flex)/);
    }
  });

  it('the scale steps down from display to caption', () => {
    const px: Record<string, number> = {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
    };
    const sizeOf = (classes: string) => {
      const m = /\btext-(\[(\d+)px\]|xs|sm|base|lg|xl|\dxl)(?=\s|$)/.exec(classes)!;
      return m[2] !== undefined ? Number(m[2]) : px[m[1]!]!;
    };
    expect(sizeOf(TYPO.displayLarge)).toBeGreaterThan(sizeOf(TYPO.displayMedium));
    expect(sizeOf(TYPO.displayMedium)).toBeGreaterThan(sizeOf(TYPO.titleLarge));
    expect(sizeOf(TYPO.titleLarge)).toBeGreaterThan(sizeOf(TYPO.titleMedium));
    expect(sizeOf(TYPO.titleMedium)).toBeGreaterThan(sizeOf(TYPO.titleSmall));
    expect(sizeOf(TYPO.bodyLarge)).toBeGreaterThan(sizeOf(TYPO.bodyMedium));
    expect(sizeOf(TYPO.bodyMedium)).toBeGreaterThan(sizeOf(TYPO.bodySmall));
    expect(sizeOf(TYPO.bodySmall)).toBeGreaterThan(sizeOf(TYPO.caption));
    // Labels sit on the same sizes as the body text they go with.
    expect(sizeOf(TYPO.labelLarge)).toBe(sizeOf(TYPO.bodyLarge));
    expect(sizeOf(TYPO.labelMedium)).toBe(sizeOf(TYPO.bodyMedium));
    expect(sizeOf(TYPO.labelSmall)).toBe(sizeOf(TYPO.bodySmall));
  });

  it('typo() composes a token with extra classes and drops what is not there', () => {
    expect(typo('bodyMedium', 'text-muted-foreground', false, null, undefined, 'truncate')).toBe(
      `${TYPO.bodyMedium} text-muted-foreground truncate`,
    );
    expect(typo('titleSmall')).toBe(TYPO.titleSmall);
  });
});
