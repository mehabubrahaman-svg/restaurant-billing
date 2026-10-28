import { describe, expect, it } from 'vitest';
import { UpdatePrinterRequestSchema, UpdateTableRequestSchema } from '../index';

describe('PATCH bodies', () => {
  it('leave out what was not sent, instead of filling in defaults', () => {
    expect(UpdatePrinterRequestSchema.parse({ version: 3, isActive: false })).toEqual({
      version: 3,
      isActive: false,
    });
    expect(UpdateTableRequestSchema.parse({ version: 1, label: 'T9' })).toEqual({
      version: 1,
      label: 'T9',
    });
    expect(UpdatePrinterRequestSchema.parse({ version: 1, address: null })).toEqual({
      version: 1,
      address: null,
    });
  });
});
