/** "Ravi Kumar" → "RK"; works per grapheme, so "সুমিত দাস" → "সুদা"-style clusters stay whole. */
export function initialsOf(fullName: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
    .join('')
    .toLocaleUpperCase();
}
