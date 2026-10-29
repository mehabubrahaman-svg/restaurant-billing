import type { MembershipTier } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

const GOLD: MembershipTier = {
  id: '0f300000-0000-4000-8000-000000000001',
  name: 'Gold',
  minSpend: 20_000_00,
  minVisits: 10,
  pointsMultiplierBp: 15_000,
  discountBp: 1000,
  isActive: true,
  version: 2,
};

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Membership tiers', () => {
  it('lists tiers, checks what is typed, adds one and edits one', async () => {
    const sent: { method: string; body: unknown }[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /membership-tiers': () => json({ data: [GOLD] }),
      'POST /membership-tiers': ({ body }) => {
        sent.push({ method: 'POST', body });
        return json({ ...GOLD, id: '0f300000-0000-4000-8000-000000000002', name: 'Silver' }, 201);
      },
      [`PATCH /membership-tiers/${GOLD.id}`]: ({ body }) => {
        sent.push({ method: 'PATCH', body });
        return json({ ...GOLD, version: 3 });
      },
    });
    renderApp('/admin/membership');
    const table = await screen.findByRole('table', { name: 'Membership tiers' });
    const row = within(table).getByText('Gold').closest('tr')!;
    expect(within(row).getByText('₹20,000.00')).toBeInTheDocument();
    expect(within(row).getByText('1.5×')).toBeInTheDocument();
    expect(within(row).getByText('10%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add tier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add tier' });
    fireEvent.change(within(dialog).getByLabelText(/^Tier/), { target: { value: 'Silver' } });
    fireEvent.change(within(dialog).getByLabelText('Lifetime spend from (₹)'), {
      target: { value: '५०००' },
    });
    fireEvent.change(within(dialog).getByLabelText('Points multiplier'), {
      target: { value: '20' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Between 0 and 10, like 1.5.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Points multiplier'), {
      target: { value: '1.25' },
    });
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved Silver.');
    expect(sent[0]).toEqual({
      method: 'POST',
      body: {
        name: 'Silver',
        minSpend: 5_000_00,
        minVisits: 0,
        pointsMultiplierBp: 12_500,
        discountBp: 0,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Gold' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit Gold' });
    expect(within(edit).getByLabelText('Lifetime spend from (₹)')).toHaveValue('20000.00');
    expect(within(edit).getByLabelText('Discount on every bill (%)')).toHaveValue('10');
    fireEvent.click(within(edit).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      method: 'PATCH',
      body: {
        name: 'Gold',
        minSpend: 20_000_00,
        minVisits: 10,
        pointsMultiplierBp: 15_000,
        discountBp: 1000,
        isActive: false,
        version: 2,
      },
    });
  });

  it('is an Admin tab for settings.manage only (tiers carry discounts)', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['customers.manage'] })),
    });
    renderApp('/admin/membership');
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument();
  });
});
