import type { Gstr1, Gstr3b, VatRegister } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { monthRange } from './gst-page';

const header = {
  from: '2026-10-01',
  to: '2026-10-31',
  branchName: 'Park Street',
  gstin: '19AAACR5055K1Z5',
  stateCode: '19',
  stateName: 'West Bengal',
  generatedAt: '2026-11-01T06:00:00.000Z',
  stateNames: { '19': 'West Bengal' },
};
const heads = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

const gstr1: Gstr1 = {
  ...header,
  b2b: [
    {
      gstin: '19AABCU9603R1ZK',
      receiverName: 'Acme Pvt Ltd',
      invoiceNo: 'KOL1/2026-27/000002',
      invoiceDate: '2026-10-28',
      invoiceValue: 12600,
      placeOfSupply: '19',
      rateBp: 500,
      taxable: 12000,
      ...heads,
      cgst: 300,
      sgst: 300,
    },
  ],
  b2cl: [],
  b2cs: [{ placeOfSupply: '19', rateBp: 500, taxable: 90000, ...heads, cgst: 2250, sgst: 2250 }],
  cdnr: [],
  cdnur: [],
  exempt: [{ kind: 'INTRA_UNREGISTERED', nilRated: 0, exempted: 0, nonGst: 70000 }],
  hsn: { b2b: [], b2c: [] },
  docs: [
    {
      nature: 'INVOICE',
      series: 'INV',
      fromNo: 'KOL1/2026-27/000001',
      toNo: 'KOL1/2026-27/000004',
      total: 4,
      cancelled: 1,
    },
  ],
  eco: [{ operator: 'Swiggy', operatorGstin: null, taxable: 13200 }],
};
const gstr3b: Gstr3b = {
  ...header,
  outward: {
    taxable: { taxable: 96000, ...heads, cgst: 2400, sgst: 2400 },
    zeroRated: { taxable: 0, ...heads },
    nilExempt: 0,
    reverseCharge: { taxable: 0, ...heads },
    nonGst: 70000,
  },
  ecoSupplies: 13200,
  interStateUnregistered: [],
  itc: { available: { ...heads, cgst: 500, sgst: 500 }, allowed: false },
  inwardNonGst: { interState: 0, intraState: 0 },
  payable: { ...heads, cgst: 2400, sgst: 2400 },
  creditCarriedForward: heads,
};
const vat: VatRegister = {
  from: '2026-10-01',
  to: '2026-10-31',
  branchName: 'Park Street',
  vatTin: '19123456789',
  generatedAt: '2026-11-01T06:00:00.000Z',
  rows: [
    {
      date: '2026-10-28',
      invoiceNo: 'KOL1/LIQ/2026-27/000001',
      kind: 'INVOICE',
      customerName: null,
      rateBp: 2000,
      taxable: 70000,
      vat: 14000,
      surcharge: 0,
      total: 84000,
    },
  ],
  byRate: [{ rateBp: 2000, bills: 1, taxable: 70000, vat: 14000, surcharge: 0, total: 84000 }],
  totals: { taxable: 70000, vat: 14000, surcharge: 0, total: 84000 },
};

let saved: string[];
beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
  saved = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function hub(
  routes: Record<string, Handler> = {},
  permissions = ['reports.sales', 'reports.financial'],
) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /reports/gstr1': () => json(gstr1),
    'GET /reports/gstr3b': () => json(gstr3b),
    'GET /reports/vat-register': () => json(vat),
    ...routes,
  });
}

describe('GST returns', () => {
  it('shows GSTR-1 by section, downloads a section for the offline tool, then GSTR-3B and VAT', async () => {
    const fetchMock = hub({
      'GET /reports/gstr1/b2cs.csv': () =>
        new Response('Type,Place Of Supply\n', {
          headers: { 'content-disposition': 'attachment; filename="gstr1-b2cs.csv"' },
        }),
    });
    renderApp('/reports/gst?month=2026-10');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'GST returns' }),
    ).toBeInTheDocument();
    const b2b = (await screen.findByRole('heading', { name: 'B2B invoices (4A)' })).closest(
      'section',
    )!;
    expect(within(b2b).getByText('19AABCU9603R1ZK · Acme Pvt Ltd')).toBeInTheDocument();
    const b2cs = screen.getByRole('heading', { name: 'B2C others (7)' }).closest('section')!;
    expect(within(b2cs).getByText('19 West Bengal')).toBeInTheDocument();
    expect(within(b2cs).getByText('₹900.00')).toBeInTheDocument();
    expect(screen.getByText('Intra-state, unregistered')).toBeInTheDocument();
    expect(screen.getByText('GSTIN not set (Admin → Sales channels)')).toBeInTheDocument();

    fireEvent.click(within(b2cs).getByRole('button', { name: 'Download B2C others (7) as CSV' }));
    await waitFor(() => expect(saved).toEqual(['gstr1-b2cs.csv']));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/gstr1/b2cs.csv'))!;
    expect(new URL(String(call[0]), 'http://hub.test').search).toBe(
      '?from=2026-10-01&to=2026-10-31',
    );

    fireEvent.click(screen.getByRole('radio', { name: 'GSTR-3B' }));
    expect(
      await screen.findByText(
        'Every GST bill was at 5%, the restaurant rate without input tax credit, so the credit is shown but not used.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Non-GST supplies (liquor)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'VAT register' }));
    const byRate = (await screen.findByRole('heading', { name: 'By VAT rate' })).closest(
      'section',
    )!;
    expect(within(byRate).getByText('20%')).toBeInTheDocument();
    expect(within(byRate).getAllByText('₹840.00')).toHaveLength(1);
  });

  it('is a Reports tab only with reports.financial', async () => {
    hub({}, ['reports.sales']);
    renderApp('/reports/gst');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GST returns' })).toBeNull();
  });

  it('turns a month into its first and last day', () => {
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
