import type { Workbook } from '@restroos/application';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { writeXlsx } from './xlsx';

/** The files inside a zip written by `zip` (no data descriptors, deflated). */
function unzip(buf: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const data = buf.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    files.set(name, inflateRawSync(data).toString('utf8'));
    at += 30 + nameLength + size;
  }
  return files;
}

const book: Workbook = {
  sheets: [
    {
      name: 'Sales: by day',
      title: ['Sales report', 'Park Street · 2026-10-01 to 2026-10-31'],
      columns: [
        { header: 'Day', kind: 'date' },
        { header: 'Item', kind: 'text' },
        { header: 'Bills', kind: 'int' },
        { header: 'Net sales', kind: 'money' },
        { header: 'Share', kind: 'percent' },
      ],
      rows: [
        ['2026-10-01', 'চিকেন বিরিয়ানি <Full> & raita', 12, 1_234_56, 4250],
        ['2026-10-02', null, 0, -5_00, 0],
      ],
      totals: ['Total', null, 12, 1_229_56, 10_000],
    },
    { name: 'Sales: by day', columns: [{ header: 'x', kind: 'text' }], rows: [] },
  ],
};

describe('writeXlsx', () => {
  it('writes a workbook Excel opens: sheets, numbers in rupees, escaped Bengali text', () => {
    const files = unzip(writeXlsx(book));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    // Names lose ":" and stay unique.
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Sales  by day" sheetId="1"');
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Sales  by day 2" sheetId="2"');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    // Title lines, a blank row, then the header on row 4, frozen.
    expect(sheet).toContain('<pane ySplit="4" topLeftCell="A5"');
    expect(sheet).toContain(
      '<c r="B5" t="inlineStr"><is><t xml:space="preserve">চিকেন বিরিয়ানি &lt;Full&gt; &amp; raita</t></is></c>',
    );
    expect(sheet).toContain('<c r="D5" s="2"><v>1234.56</v></c>');
    expect(sheet).toContain('<c r="E5" s="6"><v>42.50</v></c>');
    expect(sheet).toContain('<c r="D6" s="2"><v>-5.00</v></c>');
    // Totals in bold; empty cells are left out.
    expect(sheet).toContain('<c r="D7" s="3"><v>1229.56</v></c>');
    expect(sheet).not.toContain('r="B6"');
  });
});
