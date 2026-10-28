import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas, quotes and newlines', () => {
    const csv =
      'sku,name,description\r\nBIR1,"Biryani, Chicken","Served with ""raita""\nand salan"\n';
    expect(parseCsv(csv)).toEqual([
      ['sku', 'name', 'description'],
      ['BIR1', 'Biryani, Chicken', 'Served with "raita"\nand salan'],
    ]);
  });

  it('keeps Indian scripts and drops a BOM and blank lines', () => {
    expect(parseCsv('﻿name_hi,name_bn\n\nचिकन बिरयानी,চিকেন বিরিয়ানি')).toEqual([
      ['name_hi', 'name_bn'],
      ['चिकन बिरयानी', 'চিকেন বিরিয়ানি'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/quoted/);
  });
});
