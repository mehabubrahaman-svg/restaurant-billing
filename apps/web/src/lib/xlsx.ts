import { strFromU8, strToU8 as encode, unzipSync, zipSync, type Zippable } from 'fflate';

/** UTF-8 bytes as this realm's Uint8Array (jsdom's TextEncoder returns another realm's, which fflate rejects). */
export const strToU8 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(encode(text));

/**
 * Just enough of Excel's .xlsx format (Office Open XML) to read a sheet of
 * text and numbers and to write one: cells only, no formulas or dates. An
 * .xlsx file is a ZIP of XML parts; fflate unzips it and the browser's
 * DOMParser reads the XML. Google Sheets, LibreOffice and Numbers save the
 * same parts.
 */

export interface SheetData {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/** Refuse ZIP bombs: no part of a menu workbook comes near this. */
const MAX_PART_BYTES = 40 * 1024 * 1024;

export class WorkbookError extends Error {}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new WorkbookError('The workbook is damaged (bad XML).');
  }
  return doc;
}

/** Elements by local name, whatever namespace prefix the writer used. */
const all = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagNameNS('*', name));

/** "AB12" → column index 27 (0-based). */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** 27 → "AB". */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel keeps 249.5 as "249.5" but may keep 0.1 + 0.2 as "0.30000000000000004". */
function tidyNumber(text: string): string {
  const n = Number(text);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : text;
}

/** Every sheet's cells as text, in workbook order. Empty trailing cells are dropped. */
export function readWorkbook(bytes: Uint8Array): SheetData[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        if (f.originalSize > MAX_PART_BYTES) throw new WorkbookError('The workbook is too large.');
        return f.name.startsWith('xl/') || f.name === '[Content_Types].xml';
      },
    });
  } catch (error) {
    if (error instanceof WorkbookError) throw error;
    throw new WorkbookError('This is not an Excel workbook (.xlsx).');
  }
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const workbookXml = text('xl/workbook.xml');
  if (workbookXml === null) throw new WorkbookError('This is not an Excel workbook (.xlsx).');

  const shared = (() => {
    const xml = text('xl/sharedStrings.xml');
    if (xml === null) return [];
    // A rich-text string is several <r><t> runs; phonetic guides (<rPh>) aren't part of it.
    return all(parseXml(xml), 'si').map((si) =>
      all(si, 't')
        .filter((t) => t.parentElement?.localName !== 'rPh')
        .map((t) => t.textContent ?? '')
        .join(''),
    );
  })();

  const rels = new Map<string, string>();
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relsXml !== null) {
    for (const rel of all(parseXml(relsXml), 'Relationship')) {
      const target = rel.getAttribute('Target') ?? '';
      rels.set(
        rel.getAttribute('Id') ?? '',
        target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`,
      );
    }
  }

  return all(parseXml(workbookXml), 'sheet').map((sheet, i) => {
    const relId =
      sheet.getAttributeNS(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'id',
      ) ?? sheet.getAttribute('r:id');
    const path = rels.get(relId ?? '') ?? `xl/worksheets/sheet${i + 1}.xml`;
    const xml = text(path);
    const rows: string[][] = [];
    if (xml !== null) {
      for (const row of all(parseXml(xml), 'row')) {
        const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
        const cells: string[] = [];
        for (const c of all(row, 'c')) {
          const ref = c.getAttribute('r');
          const col = ref ? columnIndex(ref) : cells.length;
          const type = c.getAttribute('t');
          const v = all(c, 'v')[0]?.textContent ?? '';
          let value: string;
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'inlineStr')
            value = all(c, 't')
              .map((t) => t.textContent ?? '')
              .join('');
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'str' || type === 'e') value = v;
          else value = v === '' ? '' : tidyNumber(v);
          while (cells.length < col) cells.push('');
          cells[col] = value;
        }
        while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
        while (rows.length < r) rows.push([]);
        rows[r] = cells;
      }
    }
    return { name: sheet.getAttribute('name') ?? `Sheet${i + 1}`, rows };
  });
}

// ---- writing ---------------------------------------------------------------------

export interface WriteSheet extends SheetData {
  /** Column widths in characters. */
  readonly widths?: readonly number[];
  /** Bold, frozen first row (default true). */
  readonly header?: boolean;
  /** Drop-down lists: a column takes one of `values`, or a range like `Lists!$A$2:$A$200`. */
  readonly lists?: readonly { column: number; values: readonly string[] | string }[] | undefined;
}

const escapeXml = (s: string) =>
  s
    // Characters XML 1.0 can't hold at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function sheetXml(sheet: WriteSheet): string {
  const header = sheet.header ?? true;
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) =>
          value === ''
            ? ''
            : `<c r="${columnName(c)}${r + 1}" t="inlineStr"${header && r === 0 ? ' s="1"' : ''}>` +
              `<is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  const pane = header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '';
  const lists = sheet.lists?.length
    ? `<dataValidations count="${sheet.lists.length}">${sheet.lists
        .map((l) => {
          const col = columnName(l.column);
          const formula =
            typeof l.values === 'string'
              ? escapeXml(l.values)
              : `"${escapeXml(l.values.join(','))}"`;
          return (
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${col}2:${col}5001">` +
            `<formula1>${formula}</formula1></dataValidation>`
          );
        })
        .join('')}</dataValidations>`
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${pane}${cols}<sheetData>${rows}</sheetData>${lists}</worksheet>`
  );
}

/** An .xlsx workbook: every cell is text, so SKUs like 007 and HSN codes keep their zeros. */
export function writeWorkbook(sheets: readonly WriteSheet[]): Uint8Array {
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}"/>`,
          )
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets
          .map(
            (s, i) =>
              `<sheet name="${escapeXml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    // Style 0: normal text. Style 1: bold, on a light fill (the header row).
    'xl/styles.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE7D6"/></patternFill></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="49" applyNumberFormat="1"/>' +
        '<xf numFmtId="49" fontId="1" fillId="2" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs>' +
        '</styleSheet>',
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}
