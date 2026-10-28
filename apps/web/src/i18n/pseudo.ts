/**
 * Pseudo-localisation for the dev-only `en-XA` locale.
 *
 * Only literal text is changed. ICU syntax is parsed just enough to leave
 * argument names, plural/select selectors, `#` and number/date styles alone,
 * so the result is still a valid ICU message with the same arguments.
 * Quoting with ASCII apostrophes is not supported: catalogues use ’ instead.
 */

const ACCENTED: Readonly<Record<string, string>> = Object.fromEntries(
  [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [
    c,
    [...'áƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][i]!,
  ]),
);

/** Filler that roughly matches the width of real words. */
const FILLER = 'ļöŕéɱ îþšûɱ ðöļöŕ šîţ áɱéţ çöñšéçţéţûŕ áðîþîšçîñĝ éļîţ ';

/** How much longer than English the pseudo text is: Hindi/Bengali run ~30–40% longer. */
export const PSEUDO_EXPANSION = 0.4;

export function pseudoLocalizeMessage(message: string): string {
  let pos = 0;
  let literalLength = 0;

  const accent = (text: string): string => {
    literalLength += text.length;
    return [...text].map((c) => ACCENTED[c] ?? c).join('');
  };

  const fail = (reason: string): never => {
    throw new Error(`pseudo-locale: ${reason} at ${pos} in "${message}"`);
  };

  // message := (text | argument)*, ending at end of input or a closing brace.
  function parseMessage(nested: boolean): string {
    let out = '';
    let text = '';
    while (pos < message.length) {
      const ch = message[pos]!;
      if (ch === '{') {
        out += accent(text) + parseArgument();
        text = '';
      } else if (ch === '}') {
        if (!nested) fail('unexpected }');
        break;
      } else {
        text += ch;
        pos += 1;
      }
    }
    return out + accent(text);
  }

  function readUntilSeparator(): string {
    let token = '';
    while (pos < message.length && message[pos] !== ',' && message[pos] !== '}') {
      token += message[pos];
      pos += 1;
    }
    if (pos >= message.length) fail('unterminated argument');
    return token;
  }

  // argument := { name } | { name, type } | { name, type, style-or-options }
  function parseArgument(): string {
    pos += 1; // {
    const name = readUntilSeparator();
    if (message[pos] === '}') {
      pos += 1;
      return `{${name}}`;
    }
    pos += 1; // ,
    const type = readUntilSeparator();
    if (message[pos] === '}') {
      pos += 1;
      return `{${name},${type}}`;
    }
    pos += 1; // ,
    const kind = type.trim();
    let out = `{${name},${type},`;
    if (kind === 'plural' || kind === 'select' || kind === 'selectordinal') {
      // Options: selector {message} pairs; selectors and offset: are copied as-is.
      while (pos < message.length && message[pos] !== '}') {
        if (message[pos] === '{') {
          pos += 1;
          out += `{${parseMessage(true)}}`;
          if (message[pos] !== '}') fail('unterminated option');
          pos += 1;
        } else {
          out += message[pos];
          pos += 1;
        }
      }
    } else {
      // number/date/time style: copy verbatim up to the matching brace.
      let depth = 0;
      while (pos < message.length && (depth > 0 || message[pos] !== '}')) {
        if (message[pos] === '{') depth += 1;
        if (message[pos] === '}') depth -= 1;
        out += message[pos];
        pos += 1;
      }
    }
    if (message[pos] !== '}') fail('unterminated argument');
    pos += 1;
    return `${out}}`;
  }

  const body = parseMessage(false);
  const padding = Math.ceil(literalLength * PSEUDO_EXPANSION);
  const filler = FILLER.repeat(Math.ceil(padding / FILLER.length) + 1).slice(0, padding);
  return `⟦${body}${padding > 0 ? ` ${filler.trimEnd()}` : ''}⟧`;
}

export type Catalogue = { readonly [key: string]: string | Catalogue };

export function pseudoLocalizeCatalogue(catalogue: Catalogue): Catalogue {
  return Object.fromEntries(
    Object.entries(catalogue).map(([key, value]) => [
      key,
      typeof value === 'string' ? pseudoLocalizeMessage(value) : pseudoLocalizeCatalogue(value),
    ]),
  );
}
