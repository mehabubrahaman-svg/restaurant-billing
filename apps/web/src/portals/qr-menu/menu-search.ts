import type { QrMenu } from '@restroos/contracts';

type Item = QrMenu['items'][number];
type Translations = Item['nameTranslations'];

/**
 * Text as search compares it: lower case, Latin accents dropped, anything
 * that isn't a letter, digit or mark turned into a space. Devanagari and
 * Bengali vowel signs are marks and stay, so "पनीर" keeps its spelling.
 */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

/**
 * How a romanised Indian word sounds, so everyday spellings meet: paneer and
 * panir, tikka and tika, chiken and chicken, bhetki and betki.
 */
export function sound(word: string): string {
  return word
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/([bcdgjkpt])h/g, '$1')
    .replace(/ee|ie/g, 'i')
    .replace(/oo|ou/g, 'u')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

/** Edits (insert, delete, change, swap two letters) between two short words; stops early past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

const LATIN = /^[a-z0-9]+$/;

interface Field {
  readonly text: string;
  readonly words: readonly string[];
  readonly sounds: readonly string[];
  readonly weight: number;
}

function field(text: string | null | undefined, weight: number): Field | null {
  if (!text) return null;
  const folded = fold(text);
  if (folded === '') return null;
  const words = folded.split(' ');
  return { text: folded, words, sounds: words.map((w) => (LATIN.test(w) ? sound(w) : w)), weight };
}

/** How well one query word meets a field: 3 a whole word, 2 the start of one, 1.5 inside one, 1 a near spelling. */
function quality(token: string, f: Field): number {
  if (f.words.includes(token)) return 3;
  if (f.words.some((w) => w.startsWith(token))) return 2;
  if (f.text.includes(token)) return 1.5;
  if (LATIN.test(token) && token.length >= 4) {
    const s = sound(token);
    const max = s.length >= 8 ? 2 : 1;
    if (f.sounds.some((w) => w.startsWith(s) || editDistance(s, w, max) <= max)) return 1;
  }
  return 0;
}

const translations = (t: Translations) => [t.hi, t.bn];

/** Everything a guest might type to find a dish, each with how much a hit on it counts. */
export function searchFields(
  item: Item,
  category: QrMenu['categories'][number] | undefined,
): Field[] {
  return [
    field(item.name, 10),
    ...translations(item.nameTranslations).map((t) => field(t, 9)),
    ...item.variants.flatMap((v) => [
      field(v.name, 4),
      ...translations(v.nameTranslations).map((t) => field(t, 4)),
    ]),
    category && field(category.name, 3),
    ...(category ? translations(category.nameTranslations).map((t) => field(t, 3)) : []),
    field(item.description, 1),
    ...translations(item.descriptionTranslations).map((t) => field(t, 1)),
  ].filter((f): f is Field => f !== null && f !== undefined);
}

/** The query's words, folded; empty when there is nothing to search for. */
export function queryTokens(query: string): string[] {
  const folded = fold(query);
  return folded === '' ? [] : folded.split(' ');
}

/**
 * Dishes that have every query word somewhere (name, translations, sizes,
 * category or description), best first: a hit on the name counts most, a
 * whole word more than part of one, a near spelling least. Ties keep the
 * menu's order.
 */
export function searchMenu(items: readonly Item[], menu: QrMenu, query: string): Item[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [...items];
  const categories = new Map(menu.categories.map((c) => [c.id, c]));
  const phrase = tokens.join(' ');
  return items
    .map((item, order) => {
      const fields = searchFields(item, categories.get(item.categoryId));
      let score = 0;
      for (const token of tokens) {
        const best = Math.max(0, ...fields.map((f) => quality(token, f) * f.weight));
        if (best === 0) return null;
        score += best;
      }
      if (fields.slice(0, 3).some((f) => f.text.startsWith(phrase))) score += 15;
      return { item, score, order };
    })
    .filter((r): r is { item: Item; score: number; order: number } => r !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.item);
}

/** Where the query's words appear in a display string, for highlighting: [start, end) ranges, merged. */
export function matchRanges(text: string, query: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of queryTokens(query)) {
    for (let at = lower.indexOf(token); at >= 0; at = lower.indexOf(token, at + token.length)) {
      ranges.push([at, at + token.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/**
 * A description written as "What it is. 6 pieces · 240 kcal · Contains gluten"
 * split into its line and its facts, so the facts can be shown as tags.
 * Without a "·" it is all line.
 */
export function splitDescription(text: string): { lead: string; facts: string[] } {
  const dot = text.indexOf(' · ');
  if (dot < 0) return { lead: text.trim(), facts: [] };
  const head = text.slice(0, dot);
  const end = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('। '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  );
  const lead = end < 0 ? '' : text.slice(0, end + 1).trim();
  const facts = text
    .slice(end < 0 ? 0 : end + 2)
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  return { lead, facts };
}
