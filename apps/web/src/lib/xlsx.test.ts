import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  columnIndex,
  columnName,
  readWorkbook,
  strToU8,
  WorkbookError,
  writeWorkbook,
} from './xlsx';

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(['A1', 'Z9', 'AA10', 'ab2'].map(columnIndex)).toEqual([0, 25, 26, 27]);
  });

  it('writes a workbook it can read back, Hindi, Bengali and leading zeros included', () => {
    const bytes = writeWorkbook([
      {
        name: 'Menu items',
        rows: [
          ['sku', 'name', 'name_bn', 'price'],
          ['007', 'Fish & Chips <large>', 'মাছ ভাজা', '249.50'],
          ['PNR', 'Paneer "Tikka"', '', '180'],
        ],
        widths: [12, 30, 30, 10],
        lists: [{ column: 3, values: ['veg', 'non-veg'] }],
      },
      { name: 'Lists', rows: [['category'], ['Starters']], header: false },
    ]);
    const sheets = readWorkbook(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Menu items', 'Lists']);
    expect(sheets[0]!.rows).toEqual([
      ['sku', 'name', 'name_bn', 'price'],
      ['007', 'Fish & Chips <large>', 'মাছ ভাজা', '249.50'],
      ['PNR', 'Paneer "Tikka"', '', '180'],
    ]);
    expect(sheets[1]!.rows).toEqual([['category'], ['Starters']]);
  });

  it('reads what Excel saves: shared strings, numbers, booleans, gaps and rich text', () => {
    const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const bytes = zipSync({
      'xl/workbook.xml': strToU8(
        `<workbook xmlns="${main}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          '<sheets><sheet name="Items" sheetId="1" r:id="rId7"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId7" Target="/xl/worksheets/items.xml" Type="x"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        `<sst xmlns="${main}"><si><t>sku</t></si><si><t>price</t></si>` +
          '<si><r><t>Paneer </t></r><r><rPr><b/></rPr><t>Tikka</t></r><rPh><t>x</t></rPh></si></sst>',
      ),
      'xl/worksheets/items.xml': strToU8(
        `<worksheet xmlns="${main}"><sheetData>` +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>249.49999999999997</v></c>' +
          '<c r="D3" t="b"><v>1</v></c><c r="E3" t="str"><v>ok</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    });
    expect(readWorkbook(bytes)[0]!.rows).toEqual([
      ['sku', '', 'price'],
      [],
      ['Paneer Tikka', '', '249.5', 'TRUE', 'ok'],
    ]);
  });

  it('says so when the file is not a workbook', () => {
    expect(() => readWorkbook(strToU8('sku,name\n'))).toThrow(WorkbookError);
    expect(() => readWorkbook(zipSync({ 'hello.txt': strToU8('hi') }))).toThrow(
      'not an Excel workbook',
    );
  });
});
