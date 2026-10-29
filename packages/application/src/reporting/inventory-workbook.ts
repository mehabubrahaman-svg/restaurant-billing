import { stockValue } from '@restroos/domain';
import type { BaseUnit, InventoryValuationView } from '../inventory/ports';
import type { CellValue, Column, Sheet, Workbook } from './workbook';

const money = (header: string): Column => ({ header, kind: 'money' });
const qty = (header: string): Column => ({ header, kind: 'qty' });
const text = (header: string, width?: number): Column =>
  width === undefined ? { header, kind: 'text' } : { header, kind: 'text', width };

/** Stock is shown by the kg, litre or piece. */
const UNIT: Record<BaseUnit, string> = { g: 'kg', ml: 'l', pc: 'pc' };

/** Milli-units of the base unit as thousandths of a kg, litre or piece (to the gram). */
function inUnit(milli: number, base: BaseUnit): number {
  if (base === 'pc') return milli;
  return Math.sign(milli) * Math.round(Math.abs(milli) / 1000);
}

/** Paise for one kg, litre or piece at a cost per 1000 base units. */
function unitCost(costPerBase: number, base: BaseUnit): number {
  return base === 'pc' ? stockValue(1000, costPerBase) : costPerBase;
}

/**
 * The stock value report as a workbook: the period in value (opening,
 * what came in and went out, closing, against the books), the closing value
 * by category, and every item.
 */
export function inventoryValuationWorkbook(r: InventoryValuationView): Workbook {
  const title = [
    `Stock value · ${r.branchName}`,
    `${r.from} to ${r.to} · weighted average cost · generated ${r.generatedAt}`,
  ];
  const sheet = (name: string, columns: Column[], rows: CellValue[][], totals?: CellValue[]) =>
    ({ name, title, columns, rows, ...(totals ? { totals } : {}) }) satisfies Sheet;
  const t = r.totals;

  return {
    sheets: [
      sheet(
        'Summary',
        [text('Measure', 40), money('Value')],
        [
          [`Opening stock (${r.from})`, t.openingValue],
          ['Received', t.receivedValue],
          ['Used in sales', -t.soldValue],
          ['Wastage', -t.wastageValue],
          ['Counts and adjustments', t.adjustedValue],
          ['Cost difference (stock below zero, rounding)', t.differenceValue],
          [`Closing stock (${r.to})`, t.closingValue],
          [],
          ['Inventory account in the books', r.books.inventoryAccount],
          ['Closing stock less the books', r.books.difference],
        ],
      ),
      sheet(
        'Categories',
        [
          text('Category'),
          { header: 'Items in stock', kind: 'int' },
          money('Value'),
          {
            header: 'Share',
            kind: 'percent',
          },
        ],
        r.categories.map((c) => [c.category ?? 'Uncategorised', c.items, c.value, c.shareBp]),
        ['Total', r.categories.reduce((s, c) => s + c.items, 0), t.closingValue, null],
      ),
      sheet(
        'Items',
        [
          text('SKU', 14),
          text('Item'),
          text('Category', 16),
          text('Unit', 6),
          qty('Opening'),
          money('Opening value'),
          qty('Received'),
          money('Received value'),
          qty('Sold (recipes)'),
          money('Sold value'),
          qty('Wastage'),
          money('Wastage value'),
          qty('Adjusted'),
          money('Adjusted value'),
          qty('Closing'),
          money('Cost per unit'),
          money('Closing value'),
          money('Cost difference'),
        ],
        r.rows.map((row) => [
          row.sku,
          row.name,
          row.category,
          UNIT[row.baseUnit],
          inUnit(row.openingMilli, row.baseUnit),
          row.openingValue,
          inUnit(row.receivedMilli, row.baseUnit),
          row.receivedValue,
          inUnit(row.soldMilli, row.baseUnit),
          row.soldValue,
          inUnit(row.wastageMilli, row.baseUnit),
          row.wastageValue,
          inUnit(row.adjustedMilli, row.baseUnit),
          row.adjustedValue,
          inUnit(row.closingMilli, row.baseUnit),
          unitCost(row.closingCostPerBase, row.baseUnit),
          row.closingValue,
          row.differenceValue,
        ]),
        [
          'Total',
          null,
          null,
          null,
          null,
          t.openingValue,
          null,
          t.receivedValue,
          null,
          t.soldValue,
          null,
          t.wastageValue,
          null,
          t.adjustedValue,
          null,
          null,
          t.closingValue,
          t.differenceValue,
        ],
      ),
    ],
  };
}
