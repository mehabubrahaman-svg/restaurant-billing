import type { ReportFile, ReportSchedule } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../features/auth/auth-store';
import { i18n } from '../../i18n';
import { expectNoAxeViolations } from '../../test/axe';
import { BASE_ROUTES, json, mockHub, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';

const SALES: ReportSchedule = {
  id: '0f400000-0000-4000-8000-000000000001',
  report: 'SALES',
  frequency: 'DAILY',
  format: 'XLSX',
  isActive: true,
  lastPeriodTo: '2026-10-27',
  lastRunAt: '2026-10-27T22:45:00.000Z',
  lastError: null,
  version: 1,
};
const GSTR1: ReportSchedule = {
  ...SALES,
  id: '0f400000-0000-4000-8000-000000000002',
  report: 'GSTR1',
  frequency: 'MONTHLY',
  lastPeriodTo: null,
  lastRunAt: '2026-10-28T06:00:00.000Z',
  lastError: 'disk full',
};
const FILE: ReportFile = {
  id: '0f500000-0000-4000-8000-000000000001',
  scheduleId: SALES.id,
  report: 'SALES',
  periodFrom: '2026-10-27',
  periodTo: '2026-10-27',
  format: 'XLSX',
  fileName: 'sales-2026-10-27.xlsx',
  sizeBytes: 24_576,
  createdAt: '2026-10-27T22:45:00.000Z',
  createdBy: null,
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
  permissions = ['reports.sales', 'reports.export', 'reports.financial'],
) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /report-schedules': () => json({ data: [SALES, GSTR1] }),
    'GET /report-files': () => json({ data: [FILE] }),
    ...routes,
  });
}

describe('Scheduled reports', () => {
  it('lists schedules and files, adds a schedule, makes one now and downloads a file', async () => {
    const sent: { path: string; body: unknown }[] = [];
    hub({
      'POST /report-schedules': ({ body }) => {
        sent.push({ path: 'create', body });
        return json(
          {
            ...SALES,
            id: '0f400000-0000-4000-8000-000000000003',
            report: 'DAY_END',
            format: 'CSV',
          },
          201,
        );
      },
      [`POST /report-schedules/${SALES.id}/run`]: () => {
        sent.push({ path: 'run', body: null });
        return json(
          {
            ...FILE,
            id: '0f500000-0000-4000-8000-000000000002',
            createdBy: '0e100000-0000-4000-8000-000000000001',
          },
          201,
        );
      },
      [`PATCH /report-schedules/${GSTR1.id}`]: ({ body }) => {
        sent.push({ path: 'patch', body });
        return json({ ...GSTR1, isActive: false, version: 2 });
      },
      [`GET /report-files/${FILE.id}/download`]: () =>
        new Response('PK', {
          headers: { 'content-disposition': 'attachment; filename="sales-2026-10-27.xlsx"' },
        }),
    });
    renderApp('/reports/scheduled');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Scheduled reports' }),
    ).toBeInTheDocument();
    const schedules = await screen.findByRole('table', { name: 'Schedules' });
    const sales = within(schedules).getByText('Sales report').closest('tr')!;
    expect(within(sales).getByText('Daily')).toBeInTheDocument();
    expect(within(sales).getByText('Up to 27 Oct 2026')).toBeInTheDocument();
    const gst = within(schedules).getByText('GSTR-1').closest('tr')!;
    expect(within(gst).getByText('Not yet')).toBeInTheDocument();
    expect(within(gst).getByText('Last try failed')).toHaveAttribute('title', 'disk full');

    const files = screen.getByRole('table', { name: 'Files' });
    expect(within(files).getByText('sales-2026-10-27.xlsx')).toBeInTheDocument();
    expect(within(files).getByText('24 KB')).toBeInTheDocument();
    expect(within(files).getByText('by the schedule')).toBeInTheDocument();
    await expectNoAxeViolations();

    // The day-end report is daily, as a CSV: the choices follow.
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'DAY_END' } });
    expect(
      within(screen.getByLabelText('How often'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Daily']);
    expect(screen.getByLabelText('File')).toHaveValue('CSV');
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    expect(await screen.findByText('Day-end report will be made Daily.')).toBeInTheDocument();
    expect(sent[0]).toEqual({
      path: 'create',
      body: { report: 'DAY_END', frequency: 'DAILY', format: 'CSV' },
    });

    fireEvent.click(within(sales).getByRole('button', { name: 'Make Sales report now' }));
    await waitFor(() => expect(sent.map((x) => x.path)).toContain('run'));
    expect(await screen.findByText('Made sales-2026-10-27.xlsx.')).toBeInTheDocument();
    fireEvent.click(within(gst).getByRole('switch', { name: 'GSTR-1 on schedule' }));
    await waitFor(() =>
      expect(sent).toContainEqual({ path: 'patch', body: { isActive: false, version: 1 } }),
    );

    fireEvent.click(within(files).getByRole('button', { name: 'Download sales-2026-10-27.xlsx' }));
    await waitFor(() => expect(saved).toEqual(['sales-2026-10-27.xlsx']));
  });

  it('offers GST returns only with reports.financial, and is a tab only with reports.export', async () => {
    hub({}, ['reports.sales', 'reports.export']);
    renderApp('/reports/scheduled');
    const report = await screen.findByLabelText('Report');
    expect(within(report).queryByRole('option', { name: 'GSTR-1' })).toBeNull();
    expect(within(report).getByRole('option', { name: 'Sales register' })).toBeInTheDocument();
  });

  it('is not a tab without reports.export', async () => {
    hub({}, ['reports.sales']);
    renderApp('/reports/scheduled');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Scheduled' })).toBeNull();
  });
});
