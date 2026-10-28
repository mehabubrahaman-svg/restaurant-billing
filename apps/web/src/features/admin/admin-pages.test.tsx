import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { ALL_PERMISSIONS, makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

const ROLE_ADMIN = '77777777-7777-4777-8777-777777777771';
const ROLE_CASHIER = '77777777-7777-4777-8777-777777777772';
const ROLES = {
  data: [
    {
      id: ROLE_ADMIN,
      code: 'ADMIN',
      name: 'Admin',
      isSystem: true,
      isLocked: true,
      permissions: ['users.manage', 'billing.create', 'billing.reprint'],
      userCount: 1,
      version: 1,
    },
    {
      id: ROLE_CASHIER,
      code: 'CASHIER',
      name: 'Cashier',
      isSystem: true,
      isLocked: false,
      permissions: ['billing.create'],
      userCount: 2,
      version: 3,
    },
  ],
};
const PERMS = {
  data: [
    { code: 'users.manage', module: 'admin', description: 'Create/edit users' },
    { code: 'billing.create', module: 'billing', description: 'Generate bill' },
    { code: 'billing.reprint', module: 'billing', description: 'Reprint bill' },
  ],
};
const user = (over: Record<string, unknown>) => ({
  id: '88888888-8888-4888-8888-888888888881',
  username: 'asha',
  fullName: 'Asha Sen',
  phone: null,
  email: null,
  preferredLocale: 'bn-IN',
  isActive: true,
  hasPin: true,
  lockedUntil: null,
  lastLoginAt: null,
  roleIds: [ROLE_CASHIER],
  version: 2,
  ...over,
});

function hub(extra: Record<string, Handler> = {}) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () => json(makeSession({ permissions: ALL_PERMISSIONS })),
    'GET /roles': () => json(ROLES),
    'GET /permissions': () => json(PERMS),
    ...extra,
  });
}

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Staff page', () => {
  it('lists staff with roles and a locked badge, filtered by status', async () => {
    hub({
      'GET /users': () =>
        json({
          data: [
            user({ lockedUntil: new Date(Date.now() + 600_000).toISOString() }),
            user({
              id: '88888888-8888-4888-8888-888888888882',
              fullName: 'Old Staff',
              isActive: false,
            }),
          ],
        }),
    });
    renderApp('/admin/users');
    const row = (await screen.findByText('Asha Sen')).closest('tr')!;
    expect(within(row).getByText('Cashier')).toBeInTheDocument();
    expect(within(row).getByText('Locked')).toBeInTheDocument();
    expect(screen.queryByText('Old Staff')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }));
    expect(screen.getByText('Old Staff')).toBeInTheDocument();
  });

  it('validates a new user locally and shows server codes translated', async () => {
    const fetchMock = hub({
      'GET /users': () => json({ data: [] }),
      'POST /users': () => problem(422, 'USERNAME_TAKEN', { detail: 'username taken' }),
    });
    renderApp('/admin/users');
    const add = await screen.findByRole('button', { name: 'Add staff' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'Add staff' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/Full name/)).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(within(dialog).getByText('Choose at least one.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([u, init]) => String(u).endsWith('/users') && init?.method === 'POST',
      ),
    ).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/Full name/), {
      target: { value: 'Rahul Roy' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Username/), { target: { value: 'rahul' } });
    fireEvent.change(within(dialog).getByLabelText(/^Password/), {
      target: { value: 'long enough pass' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Quick PIN/), { target: { value: '4321' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Cashier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/Quick PIN/)).toHaveAccessibleDescription(
        expect.stringContaining('Too easy to guess'),
      ),
    );
    fireEvent.change(within(dialog).getByLabelText(/Quick PIN/), { target: { value: '2580' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This username is already used.',
    );
    // The ADMIN role is not offered to new staff.
    expect(within(dialog).queryByRole('checkbox', { name: 'Admin' })).toBeNull();
  });

  it('offers reload on a version conflict', async () => {
    hub({
      'GET /users': () => json({ data: [user({})] }),
      'PATCH /users/88888888-8888-4888-8888-888888888881': () => problem(409, 'VERSION_CONFLICT'),
    });
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha Sen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Someone else changed this');
    expect(within(dialog).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('frames unknown server codes with the Hub’s detail', async () => {
    hub({
      'GET /users': () => json({ data: [user({})] }),
      'POST /users/88888888-8888-4888-8888-888888888881/deactivate': () =>
        problem(422, 'SOMETHING_NEW', { detail: 'Shift still open' }),
    });
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Asha Sen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Couldn’t complete this: Shift still open',
    );
  });
});

describe('Role editor', () => {
  it('shows ADMIN read-only', async () => {
    hub();
    renderApp(`/admin/roles/${ROLE_ADMIN}`);
    expect(await screen.findByText(/always has every permission/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Reprint bills/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('selects a whole module and saves the permissions in Hub order', async () => {
    const fetchMock = hub({
      'PATCH /roles/77777777-7777-4777-8777-777777777772': ({ body }) =>
        json({ ...ROLES.data[1], ...(body as object), version: 4 }),
    });
    const { router } = renderApp(`/admin/roles/${ROLE_CASHIER}`);
    const all = await screen.findByRole('checkbox', { name: 'All of Billing' });
    expect((all as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(all);
    expect(screen.getByRole('checkbox', { name: /^Reprint bills/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/roles'));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({
      version: 3,
      permissions: ['billing.create', 'billing.reprint'],
    });
  });
});

describe('Taxes page', () => {
  it('creates a GST group from one rate', async () => {
    const fetchMock = hub({
      'GET /tax-groups': () => json({ data: [] }),
      'POST /tax-groups': ({ body }) =>
        json({
          id: '99999999-9999-4999-8999-999999999999',
          isActive: true,
          version: 1,
          ...(body as object),
        }),
    });
    renderApp('/admin/taxes');
    fireEvent.click(await screen.findByRole('button', { name: 'New tax group' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'GST 5%' } });
    fireEvent.change(within(dialog).getByLabelText(/GST rate/), { target: { value: '5' } });
    expect(within(dialog).getByText(/CGST 2.5% \+ SGST 2.5%/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST' && String(init.body).includes('GST 5%'),
    )!;
    expect(JSON.parse(String(post[1]?.body)).components).toEqual([
      { code: 'CGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'SGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
      { code: 'IGST', rateBp: 500, appliesTo: 'INTER_STATE' },
    ]);
  });
});

describe('Audit log', () => {
  it('shows a broken chain prominently and highlights the row', async () => {
    const entry = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      occurredAt: '2026-10-28T08:00:00.000Z',
      action: 'user.updated',
      entityType: 'user',
      entityId: '88888888-8888-4888-8888-888888888881',
      actor: { id: 'x', fullName: 'Sumit Das' },
      approver: null,
      deviceId: null,
      ipAddress: null,
      reason: null,
      before: { fullName: 'Asha' },
      after: { fullName: 'Asha Sen' },
    };
    hub({
      'GET /audit-logs': () => json({ data: [entry], nextCursor: null }),
      'POST /audit-logs/verify': () =>
        json({
          ok: false,
          rows: 10,
          brokenAtId: entry.id,
          reason: 'hash mismatch',
          checkedAt: '2026-10-28T09:00:00.000Z',
        }),
    });
    renderApp('/admin/audit');
    fireEvent.click(await screen.findByRole('button', { name: /Changes/ }));
    expect(screen.getByText('"Asha Sen"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify integrity' }));
    expect(await screen.findByText('The audit log has been tampered with')).toBeInTheDocument();
    expect(screen.getByText('user.updated').closest('tr')).toHaveClass('bg-state-danger-soft');
  });
});
