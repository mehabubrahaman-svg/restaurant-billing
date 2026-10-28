import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './config';
import bnIN from './locales/bn-IN.json';
import enIN from './locales/en-IN.json';
import hiIN from './locales/hi-IN.json';
import { pseudoLocalizeCatalogue, type Catalogue } from './pseudo';

const CATALOGUES: Record<(typeof LOCALES)[number], Catalogue> = {
  'en-IN': enIN,
  'hi-IN': hiIN,
  'bn-IN': bnIN,
};

function flatten(catalogue: Catalogue, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(catalogue)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

type Element = ReturnType<IntlMessageFormat['getAst']>[number];

/** Argument names used by a parsed ICU message, including inside plural/select branches. */
function argumentNames(elements: readonly Element[], into = new Set<string>()): Set<string> {
  for (const el of elements) {
    if ('value' in el && el.type !== 0 && typeof el.value === 'string') into.add(el.value);
    if ('options' in el) {
      for (const option of Object.values(el.options)) argumentNames(option.value, into);
    }
    if ('children' in el) argumentNames(el.children, into);
  }
  return into;
}

function parse(message: string, locale: string): IntlMessageFormat {
  return new IntlMessageFormat(message, locale);
}

const english = flatten(enIN);

describe('translation catalogues', () => {
  it('has a non-trivial source catalogue', () => {
    expect(english.size).toBeGreaterThan(50);
  });

  for (const locale of ['hi-IN', 'bn-IN'] as const) {
    describe(locale, () => {
      const translated = flatten(CATALOGUES[locale]);

      it('has every en-IN key', () => {
        const missing = [...english.keys()].filter((k) => !translated.has(k));
        expect(missing).toEqual([]);
      });

      it('has no keys that en-IN lacks', () => {
        const extra = [...translated.keys()].filter((k) => !english.has(k));
        expect(extra).toEqual([]);
      });

      it('has no empty messages', () => {
        const empty = [...translated].filter(([, v]) => v.trim() === '').map(([k]) => k);
        expect(empty).toEqual([]);
      });

      it('uses the same ICU arguments as en-IN in every message', () => {
        for (const [key, source] of english) {
          const target = translated.get(key);
          if (target === undefined) continue;
          const expected = [...argumentNames(parse(source, 'en-IN').getAst())].sort();
          const actual = [...argumentNames(parse(target, locale).getAst())].sort();
          expect({ key, args: actual }).toEqual({ key, args: expected });
        }
      });
    });
  }

  for (const locale of LOCALES) {
    it(`${locale}: every message is valid ICU and formats`, () => {
      for (const [key, message] of flatten(CATALOGUES[locale])) {
        let formatted = '';
        expect(() => {
          const values = Object.fromEntries(
            [...argumentNames(parse(message, locale).getAst())].map((a) => [a, 3]),
          );
          formatted = String(parse(message, locale).format(values));
        }, key).not.toThrow();
        expect(formatted.length, key).toBeGreaterThan(0);
      }
    });
  }

  it('pseudo-locale keeps every message valid ICU with the same arguments', () => {
    const pseudo = flatten(pseudoLocalizeCatalogue(enIN));
    expect([...pseudo.keys()]).toEqual([...english.keys()]);
    for (const [key, message] of pseudo) {
      const expected = [...argumentNames(parse(english.get(key)!, 'en').getAst())].sort();
      expect([...argumentNames(parse(message, 'en').getAst())].sort(), key).toEqual(expected);
    }
  });
});
