import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

const COUPON = {
  id: '0f200000-0000-4000-8000-000000000001',
  code: 'WELCOME10',
  kind: 'PERCENT',
  value: 1000,
  maxDiscount: 20000,
  minBill: 50000,
  validFrom: null,
  validTo: null,
  usageLimit: null,
  usedCount: 3,
  isActive: true,
  version: 1,
};

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Coupons', () => {
  it('lists coupons and adds one', async () => {
    const created: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /coupons': () => json({ data: [COUPON] }),
      'POST /coupons': ({ body }) => {
        created.push(body);
        return json({ ...COUPON, id: '0f200000-0000-4000-8000-000000000002', code: 'FLAT50' }, 201);
      },
    });
    renderApp('/admin/coupons');
    expect(await screen.findByText('WELCOME10')).toBeInTheDocument();
    expect(screen.getByText('up to ₹200.00 · bill from ₹500.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add coupon' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add coupon' });
    fireEvent.change(within(dialog).getByLabelText(/Code/), { target: { value: 'flat50' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Fixed|Amount/ }));
    fireEvent.change(within(dialog).getByLabelText(/Amount/), { target: { value: '50' } });
    fireEvent.change(within(dialog).getByLabelText(/Smallest bill/), { target: { value: '300' } });
    await expectNoAxeViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      code: 'FLAT50',
      kind: 'FIXED',
      value: 5000,
      maxDiscount: null,
      minBill: 30000,
      validFrom: null,
      validTo: null,
      usageLimit: null,
    });
  });
});
