/**
 * Typography tokens: the one place that says how big and how heavy text is.
 *
 * Every piece of text in the web app picks a token by *what it is* (a page
 * title, a card title, body copy, a button label, a badge), never by the size
 * it should be. That keeps every screen on one visual rhythm, and lets the
 * scale change in one file. The iOS app (`AppTypography.swift`) and the
 * Android app (`res/values/typography.xml`) carry the same names and sizes.
 * docs/13-design-system.md has the table and the migration recipe.
 *
 * Names follow the Material 3 text theme (`titleMedium`, `bodySmall`,
 * `labelLarge`, ...), the same vocabulary as the owner's other product.
 *
 * | Token         | Use for                                                   |
 * | ------------- | --------------------------------------------------------- |
 * | displayLarge  | Hero numbers and headlines (token board, login)           |
 * | displayMedium | Page titles                                               |
 * | titleLarge    | Section headings (a menu section, a report block)         |
 * | titleMedium   | Dialog and card titles, the brand in the top bar          |
 * | titleSmall    | Row titles: a dish, a table, a customer                   |
 * | bodyLarge     | Readable body copy and what the guest reads; input text   |
 * | bodyMedium    | Secondary body: descriptions, table cells, hints          |
 * | bodySmall     | Meta: timestamps, counts, "customisable"                  |
 * | labelLarge    | Touch buttons, prices, switch labels                      |
 * | labelMedium   | Small buttons, chips, field labels, status pills          |
 * | labelSmall    | Badges, table headers, chip text                          |
 * | overline      | Tiny ALL-CAPS tags above something else                   |
 * | caption       | The smallest readable note                                |
 * | mono          | Codes, ids, references                                    |
 *
 * Tokens carry size, weight, letter-spacing and line-height only. Colour,
 * layout, alignment and truncation stay with the caller:
 *
 *   <h3 className={cn(TYPO.titleSmall, 'text-muted-foreground')}>…</h3>
 *
 * The sizes are tuned for touch screens read at arm's length and for guests
 * on their phones, so the body sits at 16 px and buttons at 16 px semibold,
 * a step larger than a dense desktop dashboard would use.
 */
export const TYPO = {
  // Display: hero text
  displayLarge: 'text-3xl font-bold tracking-tight leading-tight',
  displayMedium: 'text-2xl font-bold tracking-tight leading-tight',

  // Titles: sections, dialogs, cards, rows
  titleLarge: 'text-xl font-bold leading-snug',
  titleMedium: 'text-lg font-semibold leading-snug',
  titleSmall: 'text-base font-semibold leading-snug',

  // Body: running text
  bodyLarge: 'text-base leading-relaxed',
  bodyMedium: 'text-sm leading-normal',
  bodySmall: 'text-xs leading-normal',

  // Labels: text that belongs to a control
  labelLarge: 'text-base font-semibold leading-tight',
  labelMedium: 'text-sm font-semibold leading-tight',
  labelSmall: 'text-xs font-semibold leading-snug',

  // Overline and caption: the smallest notes
  overline: 'text-[11px] font-bold uppercase tracking-wider leading-tight',
  caption: 'text-[11px] leading-normal',

  // Utility
  mono: 'font-mono text-sm tabular-nums leading-normal',
} as const;

export type TypoToken = keyof typeof TYPO;

/**
 * A token with more classes, dropping anything falsy, for callers that
 * compose conditionally:
 *
 *   <p className={typo('bodyMedium', 'text-muted-foreground', urgent && 'text-destructive')}>
 */
export function typo(token: TypoToken, ...extra: (string | false | null | undefined)[]): string {
  return [TYPO[token], ...extra.filter(Boolean)].join(' ');
}
