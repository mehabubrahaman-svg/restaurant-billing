import type { Backup } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../../test/mock-hub';
import { BACKUP_2_ID, BACKUP_ID, makeBackup } from '../../../test/report-fixtures';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';
import { RESTORE_TIMING, useRestoreStore } from '../../backups/restore-store';

const DIR = 'C:\\RestroOS\\backups';
const manual = makeBackup({
  id: BACKUP_2_ID,
  fileName: 'restroos-20261028-120000000-manual.rbak',
  kind: 'MANUAL',
  createdAt: '2026-10-28T06:30:00.000Z',
  createdByName: 'Ananya Sen',
  copiedTo: 'E:\\RestroOS',
  sizeBytes: 1_400_000,
});

function hub(routes: Record<string, Handler> = {}, permissions = ['backup.manage']) {
  let list: Backup[] = [
    makeBackup(),
    makeBackup({
      id: '0e100000-0000-4000-8000-000000000009',
      status: 'PRUNED',
      fileName: 'old.rbak',
      createdAt: '2026-09-01T17:30:00.000Z',
    }),
  ];
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions })),
    'GET /backups': () => json({ data: list, backupDir: DIR, copyDir: null }),
    'POST /backups': () => {
      list = [manual, ...list];
      return json(manual, 201);
    },
    ...routes,
  });
}
const callsTo = (fetchMock: ReturnType<typeof mockHub>, method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([u, init]) =>
      new URL(String(u), 'http://hub.test').pathname === `/api/v1${path}` &&
      (init?.method ?? 'GET') === method,
  );

const TIMING = { ...RESTORE_TIMING };
beforeEach(async () => {
  Object.assign(RESTORE_TIMING, TIMING);
  useAuthStore.setState({ status: 'restoring', session: null });
  useRestoreStore.setState({ phase: 'idle', backupCreatedAt: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Backups', () => {
  it('lists backups with the folders, takes one now and downloads it', async () => {
    const saved: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const fetchMock = hub({
      [`GET /backups/${BACKUP_2_ID}/download`]: () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${manual.fileName}"`,
          },
        }),
    });
    renderApp('/admin/backups');
    const table = await screen.findByRole('table', { name: '2 backups' });
    expect(screen.getByText(DIR)).toBeInTheDocument();
    expect(screen.getByText(/Not set up\. A second copy/)).toBeInTheDocument();
    expect(within(table).getAllByText('Daily')).toHaveLength(2);
    expect(within(table).getAllByText('1.2 MB')).toHaveLength(2);
    expect(within(table).getByText('Removed (old)')).toBeInTheDocument();
    // A pruned file can be neither downloaded nor restored.
    expect(within(table).getAllByRole('button', { name: /^Download/ })).toHaveLength(1);
    await expectNoAxeViolations();

    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText(`Backup ${manual.fileName} saved.`)).toBeInTheDocument();
    const row = (await screen.findByText(manual.fileName)).closest('tr')!;
    expect(within(row).getByText('Manual')).toBeInTheDocument();
    expect(within(row).getByText('Ananya Sen')).toBeInTheDocument();
    expect(within(row).getByText('Also copied to the second location')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: `Download ${manual.fileName}` }));
    await waitFor(() => expect(saved).toEqual([manual.fileName]));
    expect(callsTo(fetchMock, 'POST', '/backups')).toHaveLength(1);
  });

  it('imports a .rbak file with its passphrase, and explains a wrong passphrase', async () => {
    let attempts = 0;
    const imported = makeBackup({ id: BACKUP_2_ID, kind: 'IMPORTED', fileName: 'imported.rbak' });
    const fetchMock = hub({
      'POST /backups/import': ({ headers }) => {
        attempts += 1;
        return headers.get('x-backup-passphrase') === 'correct horse battery staple'
          ? json(imported, 201)
          : problem(422, 'BACKUP_UNREADABLE');
      },
    });
    renderApp('/admin/backups');
    fireEvent.click(await screen.findByRole('button', { name: 'Import a backup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import a backup file' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(within(dialog).getByText('Choose a backup file.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the passphrase.')).toBeInTheDocument();
    expect(attempts).toBe(0);

    const file = new File([new Uint8Array([82, 66, 65, 75])], 'shop.rbak');
    fireEvent.change(within(dialog).getByLabelText(/Backup file/), { target: { files: [file] } });
    fireEvent.change(within(dialog).getByLabelText(/Backup passphrase/), {
      target: { value: 'wrong one' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This backup can’t be opened: wrong passphrase, or it is not a RestroOS backup.',
    );
    await expectNoAxeViolations();
    fireEvent.change(within(dialog).getByLabelText(/Backup passphrase/), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported imported.rbak.')).toBeInTheDocument();
    const call = callsTo(fetchMock, 'POST', '/backups/import').at(-1)!;
    const init = call[1] as RequestInit;
    expect(init.body).toBe(file);
    expect(new Headers(init.headers).get('content-type')).toBe('application/octet-stream');
  });

  it('restores only after RESTORE is typed, covers the app while the Hub restarts, then resumes', async () => {
    Object.assign(RESTORE_TIMING, { pollMs: 5, assumeRestartedMs: 60_000, giveUpMs: 60_000 });
    let restoring = false;
    let healthCalls = 0;
    const fetchMock = hub({
      [`POST /backups/${BACKUP_ID}/restore`]: () => {
        restoring = true;
        return json({ backup: makeBackup(), restarting: true }, 202);
      },
      // Down twice while the Hub swaps its database, then back.
      'GET /health': () => {
        if (!restoring) return json({});
        healthCalls += 1;
        return healthCalls <= 2 ? problem(503, 'INTERNAL_ERROR') : json({});
      },
    });
    renderApp('/admin/backups');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /^Restore the backup of/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(
      within(dialog).getByText(/A safety backup of today’s data is taken first/),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Restore and restart' });
    expect(confirm).toBeDisabled();
    const word = within(dialog).getByLabelText('Type RESTORE to confirm');
    fireEvent.change(word, { target: { value: 'restore' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(word, { target: { value: 'RESTORE' } });
    expect(confirm).toBeEnabled();
    await expectNoAxeViolations();
    fireEvent.click(confirm);

    expect(
      await screen.findByRole('dialog', { name: 'Restoring the backup…' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/going back to the backup of 27 Oct 2026/)).toBeInTheDocument();
    const body = JSON.parse(
      String(
        (callsTo(fetchMock, 'POST', `/backups/${BACKUP_ID}/restore`)[0]![1] as RequestInit).body,
      ),
    ) as unknown;
    expect(body).toEqual({ confirm: 'RESTORE' });

    expect(
      await screen.findByText('Backup restored. Every screen has been reloaded.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Restoring the backup…' })).toBeNull();
    expect(healthCalls).toBeGreaterThanOrEqual(3);
    // The session was renewed against the restored Hub and the list fetched again.
    expect(callsTo(fetchMock, 'POST', '/auth/refresh').length).toBeGreaterThanOrEqual(2);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('sends the user to sign in when the restored Hub no longer knows the session', async () => {
    Object.assign(RESTORE_TIMING, { pollMs: 5, assumeRestartedMs: 20, giveUpMs: 60_000 });
    let restored = false;
    hub({
      [`POST /backups/${BACKUP_ID}/restore`]: () => {
        restored = true;
        return json({ backup: makeBackup(), restarting: true }, 202);
      },
      'POST /auth/refresh': () =>
        restored
          ? problem(401, 'UNAUTHENTICATED')
          : json(makeSession({ permissions: ['backup.manage'] })),
    });
    renderApp('/admin/backups');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /^Restore the backup of/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    fireEvent.change(within(dialog).getByLabelText(/Backup passphrase/), {
      target: { value: 'other pc passphrase' },
    });
    fireEvent.change(within(dialog).getByLabelText('Type RESTORE to confirm'), {
      target: { value: 'RESTORE' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore and restart' }));
    expect(await screen.findByText('Backup restored. Sign in again.')).toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the Hub’s refusal and stays put', async () => {
    hub({
      [`POST /backups/${BACKUP_ID}/restore`]: () => problem(409, 'BACKUP_UNAVAILABLE'),
    });
    renderApp('/admin/backups');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /^Restore the backup of/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    fireEvent.change(within(dialog).getByLabelText('Type RESTORE to confirm'), {
      target: { value: 'RESTORE' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore and restart' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This backup file was removed or is missing on the Hub.',
    );
    expect(useRestoreStore.getState().phase).toBe('idle');
  });

  it('is hidden from admins without backup.manage', async () => {
    hub({}, ['settings.manage']);
    renderApp('/admin/printers');
    await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(screen.queryByRole('link', { name: 'Backups' })).toBeNull();
  });
});
