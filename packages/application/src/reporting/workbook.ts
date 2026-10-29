import { hundredths, thousandths, toCsv } from './csv';

/**
 * A report as sheets of typed columns: the one shape every export is made
 * from (XLSX by the infrastructure writer, CSV here). Money is integer paise,
 * rates are basis points and quantities thousandths (of a kg, litre or piece);
 * the writers turn them into rupees, percent and decimals.
 */
export type ColumnKind = 'text' | 'int' | 'money' | 'percent' | 'qty' | 'date';

export interface Column {
  readonly header: string;
  readonly kind: ColumnKind;
  /** Characters; the writer picks a default from the kind. */
  readonly width?: number;
}

export type CellValue = string | number | null;

export interface Sheet {
  /** At most 31 characters, no []:*?/\ (Excel's rules). */
  readonly name: string;
  /** Lines shown above the table (report name, branch, period). */
  readonly title?: readonly string[];
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly CellValue[])[];
  /** A totals row, set in bold. */
  readonly totals?: readonly CellValue[];
}

export interface Workbook {
  readonly sheets: readonly Sheet[];
}

/** A cell as text for CSV: rupees for money, percent for basis points. */
export function cellText(value: CellValue, kind: ColumnKind): string | number | null {
  if (value === null || typeof value === 'string') return value;
  if (kind === 'money' || kind === 'percent') return hundredths(value);
  if (kind === 'qty') return thousandths(value);
  return value;
}

/** Every sheet as a titled section of one CSV (what a spreadsheet opens in one go). */
export function workbookToCsv(workbook: Workbook): string {
  const rows: (string | number | null)[][] = [];
  workbook.sheets.forEach((sheet, index) => {
    if (index > 0) rows.push([]);
    rows.push([sheet.name]);
    for (const line of sheet.title ?? []) rows.push([line]);
    rows.push(sheet.columns.map((c) => headerText(c)));
    for (const row of sheet.rows) rows.push(row.map((v, i) => cellText(v, sheet.columns[i]!.kind)));
    if (sheet.totals) rows.push(sheet.totals.map((v, i) => cellText(v, sheet.columns[i]!.kind)));
  });
  return toCsv(rows);
}

/** One sheet alone as CSV (the GST offline tool imports a file per section). */
export function sheetToCsv(sheet: Sheet): string {
  return toCsv([
    sheet.columns.map((c) => c.header),
    ...sheet.rows.map((row) => row.map((v, i) => cellText(v, sheet.columns[i]!.kind))),
  ]);
}

function headerText(c: Column): string {
  if (c.kind === 'money' && !c.header.includes('(')) return `${c.header} (INR)`;
  if (c.kind === 'percent' && !c.header.includes('%')) return `${c.header} (%)`;
  return c.header;
}
