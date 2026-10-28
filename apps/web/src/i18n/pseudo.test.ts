import IntlMessageFormat from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { PSEUDO_EXPANSION, pseudoLocalizeMessage } from './pseudo';

const format = (message: string, values?: Record<string, unknown>) =>
  String(new IntlMessageFormat(message, 'en').format(values as never));

describe('pseudoLocalizeMessage', () => {
  it('accents letters, wraps in brackets and lengthens by ~40%', () => {
    const out = pseudoLocalizeMessage('Settle bill');
    expect(out.startsWith('⟦Šéţţļé ƀîļļ')).toBe(true);
    expect(out.endsWith('⟧')).toBe(true);
    const body = out.slice(1, -1);
    expect(body.length).toBeGreaterThanOrEqual(
      Math.floor('Settle bill'.length * (1 + PSEUDO_EXPANSION)),
    );
  });

  it('leaves simple arguments untouched', () => {
    const out = pseudoLocalizeMessage('PIN for {name}');
    expect(format(out, { name: 'Ravi' })).toContain('Ravi');
    expect(out).toContain('{name}');
  });

  it('keeps plural selectors and # but translates branch text', () => {
    const out = pseudoLocalizeMessage(
      '{count, plural, one {# action queued} other {# actions queued}}',
    );
    expect(out).toContain('{count, plural, one {# áçţîöñ ǫûéûéð} other {# áçţîöñš ǫûéûéð}}');
    expect(format(out, { count: 3 })).toContain('3 áçţîöñš ǫûéûéð');
  });

  it('copies number styles verbatim', () => {
    const out = pseudoLocalizeMessage('Total {amount, number, ::currency/INR}');
    expect(out).toContain('{amount, number, ::currency/INR}');
  });

  it('rejects malformed messages', () => {
    expect(() => pseudoLocalizeMessage('broken {name')).toThrow();
    expect(() => pseudoLocalizeMessage('broken }')).toThrow();
  });
});
