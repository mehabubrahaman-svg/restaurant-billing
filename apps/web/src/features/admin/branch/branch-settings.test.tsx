import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { branchSettings } from '../../../test/billing-fixtures';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Branch settings: loyalty points', () => {
  it('turns points on with what a guest earns and what a point is worth', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /settings/branch': () => json(branchSettings),
      'PATCH /settings/branch': ({ body }) =>
        json({ ...branchSettings, ...(body as object), version: 2 }),
    });
    renderApp('/admin/branch');
    const card = (await screen.findByText('Loyalty points')).closest('div[class*="rounded"]')!;
    const toggle = within(card as HTMLElement).getByRole('switch', {
      name: /Guests earn and spend points/,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText(/Points per ₹100 paid/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Value of a point/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Between ₹0.01 and ₹100.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Value of a point/), { target: { value: '0.50' } });
    fireEvent.change(screen.getByLabelText(/Fewest points spent at once/), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) => String(u).endsWith('/settings/branch') && init?.method === 'PATCH',
        ),
      ).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith('/settings/branch') && init?.method === 'PATCH',
    )!;
    expect(JSON.parse(String(patch[1]?.body))).toMatchObject({
      version: 1,
      loyaltyEnabled: true,
      loyaltyEarnPer100: 5,
      loyaltyPointValue: 50,
      loyaltyMinRedeem: 20,
    });
  });
});
