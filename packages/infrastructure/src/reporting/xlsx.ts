import { hundredths, type Column, type CellValue, type Workbook } from '@restroos/application';
import { deflateRawSync } from 'node:zlib';

/**
 * A small XLSX writer for report exports: inline strings (so Hindi and
 * Bengali survive), rupees and percentages as real numbers, bold headers and
 * totals, a frozen header row and column widths. No dependency: the file is
 * a zip of a few XML parts.
 */
export function writeXlsx(workbook: Workbook): Buffer {
  const names = sheetNames(workbook.sheets.map((s) => s.name));
  const files: [string, string][] = [
    ['[Content_Types].xml', contentTypes(workbook.sheets.length)],
    [
      '_rels/.rels',
      rels([
        [
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
          'xl/workbook.xml',
        ],
      ]),
    ],
    ['xl/workbook.xml', workbookXml(names)],
    [
      'xl/_rels/workbook.xml.rels',
      rels([
        ...names.map(
          (_, i) =>
            [
              'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
              `worksheets/sheet${i + 1}.xml`,
            ] as [string, string],
        ),
        [
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
          'styles.xml',
        ],
      ]),
    ],
    ['xl/styles.xml', STYLES],
    ...workbook.sheets.map(
      (sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)] as [string, string],
    ),
  ];
  return zip(files.map(([name, xml]) => ({ name, data: Buffer.from(xml, 'utf8') })));
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

// ---- styles: 0 text, 1 bold text, 2 money, 3 bold money, 4 integer, 5 bold integer, 6 percent, 7 bold percent
const STYLE = {
  text: [0, 1],
  date: [0, 1],
  money: [2, 3],
  int: [4, 5],
  percent: [6, 7],
} as const;

const STYLES = xml(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);

function sheetXml(sheet: Workbook['sheets'][number]): string {
  const rows: string[] = [];
  let r = 0;
  const text = (value: string, bold: boolean) => ({ value, kind: 'text' as const, bold });
  for (const line of sheet.title ?? []) {
    r += 1;
    rows.push(rowXml(r, [text(line, r === 1)]));
  }
  if (sheet.title?.length) r += 1;
  r += 1;
  const headerRow = r;
  rows.push(
    rowXml(
      r,
      sheet.columns.map((c) => text(c.header, true)),
    ),
  );
  const body = (values: readonly CellValue[], bold: boolean) =>
    values.map((value, i) => ({ value, kind: sheet.columns[i]?.kind ?? 'text', bold }));
  for (const row of sheet.rows) {
    r += 1;
    rows.push(rowXml(r, body(row, false)));
  }
  if (sheet.totals) {
    r += 1;
    rows.push(rowXml(r, body(sheet.totals, true)));
  }
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c)}" customWidth="1"/>`)
    .join('');
  return xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows.join('')}</sheetData>
</worksheet>`);
}

function rowXml(
  r: number,
  cells: { value: CellValue; kind: Column['kind']; bold: boolean }[],
): string {
  const out = cells
    .map(({ value, kind, bold }, i) => {
      if (value === null || value === '') return '';
      const ref = `${column(i)}${r}`;
      const style = STYLE[kind][bold ? 1 : 0];
      const s = style === 0 ? '' : ` s="${style}"`;
      if (typeof value === 'number') {
        const v = kind === 'money' || kind === 'percent' ? hundredths(value) : String(value);
        return `<c r="${ref}"${s}><v>${v}</v></c>`;
      }
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    })
    .join('');
  return `<row r="${r}">${out}</row>`;
}

function widthOf(c: Column): number {
  if (c.width !== undefined) return c.width;
  const byKind = { text: 24, date: 12, money: 14, int: 10, percent: 9 }[c.kind];
  return Math.max(byKind, Math.min(40, c.header.length + 2));
}

/** A, B, …, Z, AA, AB, … */
function column(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel's sheet-name rules: ≤ 31 characters, none of []:*?/\, unique. */
function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name, i) => {
    let base =
      name
        .replaceAll(/[[\]:*?/\\]/g, ' ')
        .trim()
        .slice(0, 31) || `Sheet${i + 1}`;
    for (let n = 2; used.has(base.toLowerCase()); n++) {
      base = `${base.slice(0, 28)} ${n}`;
    }
    used.add(base.toLowerCase());
    return base;
  });
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map((n, i) => `<sheet name="${escape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets}</sheets></workbook>`);
}

function rels(targets: readonly [string, string][]): string {
  const body = targets
    .map(
      ([type, target], i) => `<Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`,
    )
    .join('');
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`,
  );
}

function contentTypes(sheets: number): string {
  const overrides = Array.from(
    { length: sheets },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${overrides}</Types>`);
}

/** XML-escaped, without the control characters XML 1.0 forbids. */
function escape(s: string): string {
  // eslint-disable-next-line no-control-regex
  const allowed = s.replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return allowed
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---- zip ------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive, deflated, with UTF-8 names and a fixed 1980-01-01 timestamp. */
export function zip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
