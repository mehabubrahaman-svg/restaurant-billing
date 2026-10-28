import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { createQueryClient, Providers } from '../../app/providers';
import { i18n } from '../../i18n';
import { json, mockHub, problem } from '../../test/mock-hub';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { ApprovalDialog } from './approval-dialog';
import { ApprovalCancelledError, withApproval } from './with-approval';

const MANAGER = '55555555-5555-4555-8555-555555555555';
const Ok = { parse: (v: unknown) => v as { ok: boolean } };

/** A protected endpoint that needs a manager's discount override. */
function hub() {
  return mockHub({
    'GET /auth/pin-users': () =>
      json({ data: [{ id: MANAGER, fullName: 'Meena Jha', initials: 'MJ' }] }),
    'POST /auth/approve': ({ body }) =>
      (body as { pin: string }).pin === '2580'
        ? json({
            approverToken: 'appr-123',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            approver: { id: MANAGER, fullName: 'Meena Jha' },
          })
        : problem(401, 'INVALID_CREDENTIALS'),
    'POST /bills/discount': ({ headers }) =>
      headers.get('x-approver-token') === 'appr-123'
        ? json({ ok: true })
        : problem(403, 'APPROVAL_REQUIRED', {
            detail: 'Needs billing.discount_override',
            permission: 'billing.discount_override',
          }),
  });
}

const discount = (approverToken?: string) =>
  apiClient.json('/bills/discount', Ok, {
    method: 'POST',
    ...(approverToken === undefined ? {} : { approverToken }),
  });

beforeEach(async () => {
  useAuthStore.setState({ status: 'authenticated', session: makeSession() });
  await i18n.changeLanguage('en-IN');
  render(
    <Providers client={createQueryClient()}>
      <ApprovalDialog />
    </Providers>,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withApproval', () => {
  it('asks a manager, then retries once with the approver token', async () => {
    const fetchMock = hub();
    const result = withApproval(discount);

    const dialog = await screen.findByRole('dialog', { name: 'Manager approval needed' });
    expect(dialog).toHaveTextContent('Approve discounts above the limit');
    fireEvent.click(await screen.findByRole('button', { name: /Meena Jha/ }));

    // A wrong PIN keeps the dialog open with an error.
    for (const d of '1357') fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username, password or PIN.');

    for (const d of '2580') fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await expect(result).resolves.toEqual({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const approveCall = fetchMock.mock.calls.findLast(([u]) =>
      String(u).endsWith('/auth/approve'),
    )!;
    expect(JSON.parse(String(approveCall[1]?.body))).toEqual({
      userId: MANAGER,
      pin: '2580',
      permission: 'billing.discount_override',
    });
    const protectedCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith('/bills/discount'),
    );
    expect(protectedCalls).toHaveLength(2);
  });

  it('rejects with ApprovalCancelledError when the dialog is closed', async () => {
    hub();
    const result = withApproval(discount);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await expect(result).rejects.toBeInstanceOf(ApprovalCancelledError);
  });

  it('passes other errors straight through', async () => {
    mockHub({ 'POST /bills/discount': () => problem(409, 'VERSION_CONFLICT') });
    await expect(withApproval(discount)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
