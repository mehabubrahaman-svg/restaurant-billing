/** Notes counted at shift close, in rupees, largest first. Coins are entered as one total. */
export const NOTES = [500, 200, 100, 50, 20, 10] as const;
export type Note = (typeof NOTES)[number];

export interface CashCount {
  readonly notes: Readonly<Record<Note, number>>;
  /** Coins (and any ₹1/₹2/₹5 notes) as one sum, paise. */
  readonly coins: number;
}

export const EMPTY_COUNT: CashCount = {
  notes: { 500: 0, 200: 0, 100: 0, 50: 0, 20: 0, 10: 0 },
  coins: 0,
};

/** Counted cash in paise. Integer arithmetic only. */
export function countedTotal(count: CashCount): number {
  return NOTES.reduce((sum, note) => sum + note * 100 * count.notes[note], count.coins);
}

/**
 * The record kept with the Z report: note value (₹) → count. Coins go in as
 * ₹1 units, rounded down to the rupee (paise coins are not legal tender).
 */
export function denominationRecord(count: CashCount): Record<string, number> {
  const record: Record<string, number> = {};
  for (const note of NOTES) if (count.notes[note] > 0) record[String(note)] = count.notes[note];
  const rupeeCoins = Math.floor(count.coins / 100);
  if (rupeeCoins > 0) record['1'] = rupeeCoins;
  return record;
}
