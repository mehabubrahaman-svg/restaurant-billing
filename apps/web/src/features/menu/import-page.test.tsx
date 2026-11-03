import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { readWorkbook, strToU8, writeWorkbook } from '../../lib/xlsx';
import { makeItem } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { menuCsvTemplate } from './csv-template';
import { MENU_COLUMNS, menuExport, menuTemplate } from './menu-workbook';
import { collectPhotos } from './photo-files';

// Shrinking photos needs a real canvas; the upload itself is what matters here.
const uploaded: string[] = [];
vi.mock('./photo-upload', () => ({
  uploadDishPhoto: vi.fn(async (file: File) => {
    uploaded.push(file.name);
    return (file.name.startsWith('BIR') ? 'b' : 'c').repeat(64);
  }),
}));

const ROWS = [
  ['sku', 'name', 'category', 'price', 'variants', 'image'],
  ['BIR-CHK', 'Chicken Biryani', 'Biryani', '320', 'Half:220 | Full:320', ''],
  ['PNR-TKA', 'Paneer Tikka', 'Starters', '249', '', 'paneer.png'],
  ['BEV-CHAI', 'Masala Chai', 'Beverages', '30', '', ''],
];

function xlsxFile(rows: string[][], name = 'menu.xlsx') {
  return new File([Uint8Array.from(writeWorkbook([{ name: 'Menu items', rows }]))], name);
}
const photo = (name: string, type = 'image/jpeg') =>
  new File([strToU8(`photo ${name}`)], name, { type });

const zipBytes = (files: Parameters<typeof zipSync>[0]) => Uint8Array.from(zipSync(files));

function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
}

beforeEach(async () => {
  uploaded.length = 0;
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (b: Blob) => `blob:${(b as File).name ?? 'x'}`,
      revokeObjectURL: () => {},
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function previewOf(body: { rows: string[][]; images: Record<string, string>; dryRun: boolean }) {
  const set = (sku: string, file: string | null) =>
    file === null ? { image: 'none', imageFile: null } : { image: 'set', imageFile: file };
  return {
    dryRun: body.dryRun,
    rows: body.rows.length - 1,
    created: 2,
    updated: 1,
    unchanged: 0,
    createdCategories: ['Beverages'],
    createdStations: [],
    retired: [],
    items: [
      {
        row: 2,
        sku: 'BIR-CHK',
        name: 'Chicken Biryani',
        action: 'update',
        ...set('BIR-CHK', 'BIR-CHK.jpg'),
      },
      {
        row: 3,
        sku: 'PNR-TKA',
        name: 'Paneer Tikka',
        action: 'create',
        ...set('PNR-TKA', 'paneer.png'),
      },
      { row: 4, sku: 'BEV-CHAI', name: 'Masala Chai', action: 'create', ...set('BEV-CHAI', null) },
    ],
    errors: [],
    warnings: [{ row: 1, column: 'image', message: "extra.webp isn't used by any row" }],
  };
}

describe('menu upload', () => {
  it('reads an Excel sheet and photos, uploads the photos, previews, then imports', async () => {
    const bodies: {
      rows: string[][];
      images: Record<string, string>;
      retireMissing: boolean;
      dryRun: boolean;
    }[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
      'GET /categories': () => json({ data: [] }),
      'GET /kitchen-stations': () => json({ data: [] }),
      'GET /addon-groups': () => json({ data: [] }),
      'GET /tax-groups': () => json({ data: [] }),
      'POST /menu/import': ({ body }) => {
        const b = body as (typeof bodies)[number];
        bodies.push(b);
        return json(previewOf(b));
      },
    });
    const { container } = renderApp('/admin/menu/import');
    await screen.findByRole('heading', { name: 'Upload menu' });
    const [sheetInput, photoInput] =
      container.querySelectorAll<HTMLInputElement>('input[type=file]');

    pick(sheetInput!, [xlsxFile(ROWS)]);
    expect(await screen.findByText(/sheet “Menu items”, 3 rows/)).toBeInTheDocument();

    // Two photos, a .zip holding a third (and junk), and a file that isn't a photo.
    const zip = new File(
      [
        zipBytes({
          'dishes/paneer.png': strToU8('png'),
          'dishes/extra.webp': strToU8('webp'),
          '__MACOSX/dishes/._paneer.png': strToU8('x'),
          'dishes/notes.txt': strToU8('hi'),
        }),
      ],
      'photos.zip',
      { type: 'application/zip' },
    );
    pick(photoInput!, [photo('BIR-CHK.jpg'), zip, photo('menu.pdf', 'application/pdf')]);
    expect(await screen.findByText('3 photos added')).toBeInTheDocument();
    expect(screen.getByText('menu.pdf: not a JPEG, PNG or WebP photo')).toBeInTheDocument();
    expect(screen.getByText('notes.txt: not a JPEG, PNG or WebP photo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    const table = await screen.findByRole('table', { name: 'What the import will do' });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent),
    ).toEqual([
      '2BIR-CHKChicken BiryaniUpdated',
      '3PNR-TKAPaneer TikkaNew',
      '4—BEV-CHAIMasala ChaiNew',
    ]);
    expect(within(table).getByRole('img', { name: 'Photo of Chicken Biryani' })).toHaveAttribute(
      'src',
      'blob:BIR-CHK.jpg',
    );
    expect(screen.getByText("extra.webp isn't used by any row")).toBeInTheDocument();
    expect(screen.getByText('New categories: Beverages')).toBeInTheDocument();
    expect(uploaded.sort()).toEqual(['BIR-CHK.jpg', 'extra.webp', 'paneer.png']);

    // Changing an option means checking again.
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Take dishes that aren’t in this sheet/ }),
    );
    expect(screen.queryByRole('table', { name: 'What the import will do' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import 3 items' }));
    expect(await screen.findByText('Menu imported')).toBeInTheDocument();

    expect(bodies.map((b) => [b.dryRun, b.retireMissing])).toEqual([
      [true, false],
      [true, true],
      [false, true],
    ]);
    // Empty cells at the end of a row aren't stored in the workbook; the Hub reads them as empty.
    const trimmed = ROWS.map((r) => {
      const row = [...r];
      while (row.at(-1) === '') row.pop();
      return row;
    });
    expect(bodies[2]!.rows).toEqual(trimmed);
    expect(bodies[2]!.images).toEqual({
      'BIR-CHK.jpg': 'b'.repeat(64),
      'paneer.png': 'c'.repeat(64),
      'extra.webp': 'c'.repeat(64),
    });
    // Each photo went up once, however often the sheet was checked.
    expect(uploaded).toHaveLength(3);
  });

  it('lists the rows that are wrong and does not import', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
      'POST /menu/import': () =>
        json({
          dryRun: true,
          rows: 1,
          created: 0,
          updated: 0,
          createdCategories: [],
          createdStations: [],
          errors: [{ row: 2, column: 'variants', message: '"Half 100" needs a name and a price' }],
        }),
    });
    const { container } = renderApp('/admin/menu/import');
    await screen.findByRole('heading', { name: 'Upload menu' });
    pick(container.querySelector<HTMLInputElement>('input[type=file]')!, [
      new File(['sku,name,category,price,variants\nA1,Dish,Mains,100,Half 100\n'], 'menu.csv', {
        type: 'text/csv',
      }),
    ]);
    expect(await screen.findByText(/menu\.csv · 1 row/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    const table = await screen.findByRole('table', { name: 'Problems found in the file' });
    expect(within(table).getAllByRole('row')[1]!.textContent).toBe(
      '2variants"Half 100" needs a name and a price',
    );
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
  });

  it('says when a file is not a menu sheet', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
    });
    const { container } = renderApp('/admin/menu/import');
    await screen.findByRole('heading', { name: 'Upload menu' });
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    pick(input, [
      new File(
        [Uint8Array.from(writeWorkbook([{ name: 'Sheet1', rows: [['a', 'b']] }]))],
        'x.xlsx',
      ),
    ]);
    expect(
      await screen.findByText(/No sheet in this workbook has a “sku” column/),
    ).toBeInTheDocument();
    pick(input, [new File(['not a zip'], 'broken.xlsx')]);
    expect(await screen.findByText(/This isn’t an Excel workbook/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check file' })).toBeDisabled());
  });
});

describe('menu workbooks', () => {
  const lookups = {
    categories: [
      {
        id: 'c1',
        parentId: null,
        name: 'Biryani',
        nameTranslations: {},
        color: null,
        sortOrder: 0,
        isActive: true,
        version: 1,
      },
    ],
    stations: [{ id: 's1', name: 'Main Kitchen', isActive: true, version: 1 }],
    taxGroups: [],
    addonGroups: [],
  } as unknown as Parameters<typeof menuTemplate>[0];

  it('makes a template with examples, instructions and the Hub’s own lists', () => {
    const sheets = readWorkbook(
      menuTemplate(lookups, {
        title: 'Instructions',
        required: 'required',
        optional: 'optional',
        rows: MENU_COLUMNS.map((column) => ({ column, text: `about ${column}` })),
      }),
    );
    expect(sheets.map((s) => s.name)).toEqual(['Menu items', 'Instructions', 'Lists']);
    expect(sheets[0]!.rows[0]).toEqual([...MENU_COLUMNS]);
    expect(sheets[0]!.rows[1]!.slice(0, 4)).toEqual([
      'BIR-CHK',
      'Chicken Biryani',
      'Biryani',
      '320',
    ]);
    expect(sheets[1]!.rows[1]).toEqual(['sku', 'required', 'about sku']);
    expect(sheets[1]!.rows.find((r) => r[0] === 'image')).toEqual([
      'image',
      'optional',
      'about image',
    ]);
    expect(sheets[2]!.rows.map((r) => r[0])).toEqual(['category', 'Biryani', '', '', '', '']);
  });

  it('exports the menu in the same columns, ready to edit and upload again', () => {
    const item = makeItem({
      sku: 'BIR-CHK',
      categoryId: 'c1',
      kitchenStationId: 's1',
      basePrice: 32050,
      prepTimeSec: 1200,
      imageId: 'f'.repeat(64),
      variants: [
        { id: 'v1', name: 'Half', nameTranslations: {}, price: 22000, sortOrder: 0 },
        { id: 'v2', name: 'Full', nameTranslations: {}, price: 32050, sortOrder: 1 },
      ],
      addonGroupIds: [],
    });
    const [sheet] = readWorkbook(menuExport([item], lookups));
    const row = Object.fromEntries(MENU_COLUMNS.map((c, i) => [c, sheet!.rows[1]![i] ?? '']));
    expect(row).toMatchObject({
      sku: 'BIR-CHK',
      category: 'Biryani',
      price: '320.50',
      food_type: 'non-veg',
      kitchen_station: 'Main Kitchen',
      variants: 'Half:220.00 | Full:320.50',
      image: 'f'.repeat(64),
      prep_time_min: '20',
      active: 'yes',
    });
  });

  it('keeps a CSV template with the original columns', () => {
    const [header] = menuCsvTemplate().trim().split('\r\n');
    expect(header).toBe(
      'sku,name,category,price,food_type,tax_group,kitchen_station,short_name,name_hi,name_bn,hsn_sac,description',
    );
  });

  it('skips duplicate photo names across folders', async () => {
    const zip = new File(
      [zipBytes({ 'a/dal.jpg': strToU8('1'), 'b/DAL.JPG': strToU8('2') })],
      'p.zip',
    );
    const { photos, skipped } = await collectPhotos([zip]);
    expect(photos.map((p) => p.name)).toEqual(['dal.jpg']);
    expect(skipped).toEqual([{ name: 'DAL.JPG', reason: 'duplicate' }]);
  });
});
