import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { menuCsvTemplate } from './csv-template';

const BAD = 'sku,name,category,price\nBIR-CHK,Chicken Biryani,Biryani,abc\n,Naan,Breads,60\n';
const GOOD =
  'sku,name,category,price\nBIR-CHK,Chicken Biryani,Biryani,320\nBRD-NAAN,Naan,Breads,60\n';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('CSV import', () => {
  it('dry-runs, shows row errors, and imports only a clean, re-checked file', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
      'POST /menu/import': ({ body }) => {
        const { csv, dryRun } = body as { csv: string; dryRun: boolean };
        const errors = csv.includes('abc')
          ? [
              { row: 2, column: 'price', message: 'Not a valid amount' },
              { row: 3, column: 'sku', message: 'SKU is required' },
            ]
          : [];
        return json({
          dryRun,
          rows: 2,
          created: errors.length > 0 ? 0 : 1,
          updated: errors.length > 0 ? 0 : 1,
          createdCategories: errors.length > 0 ? [] : ['Breads'],
          createdStations: [],
          errors,
        });
      },
    });
    renderApp('/admin/menu/import');
    const box = await screen.findByLabelText(/Or paste the CSV here/);
    fireEvent.change(box, { target: { value: BAD } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));

    const table = await screen.findByRole('table', { name: 'Problems found in the file' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      '2priceNot a valid amount',
      '3skuSKU is required',
    ]);
    expect(screen.getByText('2 rows have problems')).toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: /^Import/ });
    expect(importButton).toBeDisabled();

    // Editing the text throws away the old check; it must be checked again.
    fireEvent.change(box, { target: { value: GOOD } });
    expect(screen.queryByRole('table', { name: 'Problems found in the file' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    expect(await screen.findByText('No problems found. You can import now.')).toBeInTheDocument();
    expect(screen.getByText('New categories: Breads')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 items' }));
    expect(await screen.findByText('Menu imported')).toBeInTheDocument();

    const sent = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/menu/import'))
      .map(([, init]) => JSON.parse(String(init?.body)) as { csv: string; dryRun: boolean });
    expect(sent.map((b) => [b.csv === GOOD, b.dryRun])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
  });

  it('offers a template with the documented columns and Indian examples', () => {
    const [header, ...rows] = menuCsvTemplate().trim().split('\r\n');
    expect(header).toBe(
      'sku,name,category,price,food_type,tax_group,kitchen_station,short_name,name_hi,name_bn,hsn_sac,description',
    );
    expect(rows.map((r) => r.split(',')[1])).toEqual([
      'Chicken Biryani',
      'Paneer Butter Masala',
      'Butter Naan',
      'Masala Chai',
    ]);
    // The comma inside the biryani description is quoted.
    expect(rows[0]).toContain('"Kolkata-style dum biryani, with potato and egg"');
  });
});
