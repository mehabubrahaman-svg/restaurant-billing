import type { BaseUnit, Unit } from '@restroos/contracts';
import { costPerBase, divideRounded, stockValue, toSafeNumber } from '@restroos/domain';
import { toLatinDigits } from '../../lib/units';

/**
 * Stock quantities in the browser (docs/03 §6). The Hub counts integer
 * milli-units of an item's base unit (2.5 kg of rice = 2_500_000, base g) and
 * prices stock in paise per 1000 base units. Everything here is integer or
 * string arithmetic: no floats touch a quantity or an amount.
 */

/** Milli-units in one base unit (1 g, 1 ml, 1 pc). */
export const MILLI_PER_BASE = 1000;
/** The largest quantity one line may carry (10 tonnes), as the contract allows. */
export const MAX_MILLI = 10_000_000_000;
/** From 1 kg (or 1 l) on, a gram (or millilitre) quantity reads better in kg (or l). */
const LARGE = 1_000_000n;

/** What a quantity is shown in: the base unit, or kg / l for large weights and volumes. */
export type DisplayUnit = 'g' | 'kg' | 'ml' | 'l' | 'pc';

const QUANTITY = /^([+-])?(\d+(?:\.(\d{1,3}))?|\.(\d{1,3}))$/;

/**
 * "2.5" in a unit (kg: 1_000_000 milli-g each) → 2_500_000. Takes up to three
 * decimals, grouping commas and Devanagari/Bengali digits; `signed` also
 * takes a leading + or − (for adjustments). Null when unreadable or beyond
 * MAX_MILLI. Whatever does not land on a whole milli-unit is rounded half-even.
 */
export function parseQuantity(
  input: string,
  toBaseMilli: number,
  { signed = false }: { signed?: boolean } = {},
): number | null {
  const text = toLatinDigits(input).trim().replaceAll(',', '').replace(/^−/, '-');
  const match = QUANTITY.exec(text);
  if (match === null || (match[1] !== undefined && !signed)) return null;
  const [whole, fraction = ''] = match[2]!.split('.');
  const thousandths = BigInt(whole === '' ? '0' : whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  const milli = divideRounded(thousandths * BigInt(toBaseMilli), 1000n, 'HALF_EVEN');
  const value = match[1] === '-' ? -milli : milli;
  if (value > BigInt(MAX_MILLI) || value < -BigInt(MAX_MILLI)) return null;
  return toSafeNumber(value, 'quantity');
}

/** 2_500_000 thousandths → "2500", -1_250 → "-1.25". */
function decimalOf(thousandths: bigint): string {
  const sign = thousandths < 0n ? '-' : '';
  const abs = thousandths < 0n ? -thousandths : thousandths;
  const fraction = String(abs % 1000n)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${abs / 1000n}${fraction === '' ? '' : `.${fraction}`}`;
}

/**
 * A quantity as an input field would hold it in one unit: 2_500_000 milli-g
 * in kg → "2.5". Null when it is not exact to three decimals in that unit
 * (1 pc in dozens), so the caller can fall back to the base unit.
 */
export function quantityText(milli: number, toBaseMilli: number): string | null {
  const scaled = BigInt(milli) * 1000n;
  if (scaled % BigInt(toBaseMilli) !== 0n) return null;
  return decimalOf(scaled / BigInt(toBaseMilli));
}

/**
 * How a quantity is shown: grams and millilitres switch to kg and l from 1 kg
 * (28_350_000 milli-g → 28.35 kg, 950_000 → 950 g), rounded to the gram.
 */
export function quantityParts(milli: number, base: BaseUnit): { value: string; unit: DisplayUnit } {
  const m = BigInt(milli);
  const abs = m < 0n ? -m : m;
  if (base !== 'pc' && abs >= LARGE) {
    return {
      value: decimalOf(divideRounded(m, 1000n, 'HALF_EVEN')),
      unit: base === 'g' ? 'kg' : 'l',
    };
  }
  return { value: decimalOf(m), unit: base };
}

/** The base unit itself, for when the Hub's unit list is not to hand. */
export function baseUnitOf(base: BaseUnit): Unit {
  return {
    id: `unit-${base}`,
    code: base,
    name: base,
    baseCode: base,
    toBaseMilli: MILLI_PER_BASE,
  };
}

/** The Hub's units, plus each base unit it did not send (e.g. when the list failed to load). */
export function knownUnits(units: readonly Unit[]): Unit[] {
  const bases: readonly BaseUnit[] = ['g', 'ml', 'pc'];
  return [
    ...units,
    ...bases
      .filter((b) => !units.some((u) => u.baseCode === b && u.toBaseMilli === MILLI_PER_BASE))
      .map(baseUnitOf),
  ];
}

/** The units an item of this base can be counted in, smallest first (g, kg). */
export function unitsFor(base: BaseUnit, units: readonly Unit[]): Unit[] {
  const same = units
    .filter((u) => u.baseCode === base)
    .sort((a, b) => a.toBaseMilli - b.toBaseMilli);
  return same.length > 0 ? same : [baseUnitOf(base)];
}

/** The unit to offer first for an item: the one it is bought in, else its base unit. */
export function preferredUnit(
  item: { readonly baseUnit: BaseUnit; readonly purchaseUnitId: string | null },
  units: readonly Unit[],
): Unit {
  const choices = unitsFor(item.baseUnit, units);
  return (
    choices.find((u) => u.id === item.purchaseUnitId) ??
    choices.find((u) => u.toBaseMilli === MILLI_PER_BASE) ??
    choices[0]!
  );
}

/** Stock is priced per kg, per litre or per piece. */
export function costUnitOf(base: BaseUnit): { unit: DisplayUnit; toBaseMilli: number } {
  if (base === 'pc') return { unit: 'pc', toBaseMilli: MILLI_PER_BASE };
  return { unit: base === 'g' ? 'kg' : 'l', toBaseMilli: Number(LARGE) };
}

/** Paise for one unit at a cost in paise per 1000 base units: 8_667 per 1000 g → 8_667 a kg. */
export function unitPrice(costPerThousandBase: number, toBaseMilli: number): number {
  return stockValue(toBaseMilli, costPerThousandBase);
}

/** Above this (5%), recipe and counted consumption disagree enough to look into (docs/08 Phase 2). */
export const VARIANCE_LIMIT_BP = 500;

/** Basis points as a signed percentage string: 667 → "6.67", -250 → "-2.5". */
export function percentText(bp: number): string {
  const abs = Math.abs(bp);
  const fraction = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${bp < 0 ? '-' : ''}${Math.trunc(abs / 100)}${fraction === '' ? '' : `.${fraction}`}`;
}

/** What a receipt line works out to per unit: ₹250 for 2.5 kg → 10_000 paise a kg. */
export function receiptUnitPrice(
  totalPaise: number,
  qtyMilli: number,
  toBaseMilli: number,
): number {
  return unitPrice(costPerBase(totalPaise, qtyMilli), toBaseMilli);
}
