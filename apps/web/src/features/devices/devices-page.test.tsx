import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { DEVICE_ID, makeDevice } from '../../test/fixtures';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Devices', () => {
  it('creates a pairing code and shows the QR, the code, a countdown and the CA fingerprint', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /devices': () => json({ data: [makeDevice()] }),
      'POST /devices/pairing-codes': () =>
        json({
          code: 'AB12CD34',
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          pairUrl: 'http://192.0.2.2:7400/pair?code=AB12CD34',
          caFingerprint: '98:0C:4E:85',
        }),
    });
    renderApp('/admin/devices');
    expect(await screen.findByText('Captain tab 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pair a device' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pair a device' });
    fireEvent.change(within(dialog).getByLabelText(/^Device name/), {
      target: { value: 'Tandoor screen' },
    });
    fireEvent.change(within(dialog).getByLabelText('Used as'), { target: { value: 'KDS' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get pairing code' }));

    expect(await within(dialog).findByTestId('pairing-code')).toHaveTextContent('AB12 CD34');
    expect(within(dialog).getByRole('timer')).toHaveTextContent(/Code expires in (10:00|9:5\d)/);
    expect(within(dialog).getByText('98:0C:4E:85')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByRole('img', { name: 'Pairing QR code for Tandoor screen' }),
      ).toHaveAttribute('data-qr-value', 'http://192.0.2.2:7400/pair?code=AB12CD34'),
    );
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/pairing-codes'))!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ name: 'Tandoor screen', kind: 'KDS' });
  });

  it('unpairs after confirmation', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /devices': () => json({ data: [makeDevice()] }),
      [`PATCH /devices/${DEVICE_ID}`]: () => json(makeDevice({ isActive: false, version: 2 })),
    });
    renderApp('/admin/devices');
    fireEvent.click(await screen.findByRole('button', { name: 'Unpair Captain tab 1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unpair Captain tab 1?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unpair' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ version: 1, isActive: false });
  });
});
