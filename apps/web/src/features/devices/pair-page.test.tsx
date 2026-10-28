import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { useDeviceStore } from '../../stores/device-store';
import { makeDevice } from '../../test/fixtures';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { useAuthStore } from '../auth/auth-store';
import type * as DeviceIdentity from './device-identity';

const insecure = vi.hoisted(() => ({ value: false }));
vi.mock('./device-identity', async (importOriginal) => {
  const real = await importOriginal<typeof DeviceIdentity>();
  return { ...real, needsCertificate: () => insecure.value };
});

const HUB_INFO = {
  name: 'RestroOS Hub',
  version: '0.0.0',
  needsSetup: false,
  urls: {
    http: ['http://192.0.2.2:7400'],
    https: ['https://restro.local:7443', 'https://192.0.2.2:7443'],
  },
  caFingerprint: '98:0C:4E:85',
  mdnsHost: 'restro.local',
  restaurantName: 'Spice Route',
};

beforeEach(async () => {
  insecure.value = false;
  localStorage.clear();
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Pairing page', () => {
  it('prefills the code from the QR, pairs, adopts the Hub’s kind and continues', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'GET /devices/me': () => problem(403, 'DEVICE_NOT_PAIRED'),
      'POST /devices/pair': () =>
        json({ device: makeDevice({ kind: 'KDS', name: 'Tandoor screen' }), deviceToken: 'x' }),
    });
    const { router } = renderApp('/pair?code=ab12cd34');
    const input = await screen.findByLabelText('Pairing code');
    expect(input).toHaveValue('AB12 CD34');
    // Same-origin HTTPS or localhost: no certificate step.
    expect(screen.queryByText('Download Hub certificate')).toBeNull();
    expect(useDeviceStore.getState().status).toBe('unpaired');

    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('Device paired')).toBeInTheDocument();
    expect(
      screen.getByText('This device is now Tandoor screen, used as Kitchen display.'),
    ).toBeInTheDocument();
    expect(useDeviceStore.getState()).toMatchObject({ kind: 'KDS', status: 'paired' });
    // The browser keeps no token: it relies on the httpOnly cookie.
    expect(Object.values(localStorage).join()).not.toContain('"x"');

    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/devices/pair'))!;
    const body = JSON.parse(String(call[1]?.body));
    expect(body.code).toBe('AB12CD34');
    expect(body.fingerprint).toMatch(/^[0-9a-f]{48}$/);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // KDS goes to its full-screen route, which asks for sign-in first.
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.state).toEqual({ from: '/kitchen' });
  });

  it('explains a wrong or expired code', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /devices/pair': () => problem(403, 'PAIRING_CODE_INVALID'),
    });
    renderApp('/pair');
    fireEvent.change(await screen.findByLabelText('Pairing code'), {
      target: { value: 'zz99zz99' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code is wrong, already used or expired.',
    );
  });

  it('on plain HTTP, offers the CA certificate with the fingerprint to compare', async () => {
    insecure.value = true;
    mockHub({ ...BASE_ROUTES, 'GET /hub/info': () => json(HUB_INFO) });
    renderApp('/pair?code=AB12CD34');
    const link = await screen.findByRole('link', { name: 'Download Hub certificate' });
    expect(link).toHaveAttribute('href', '/api/v1/hub/ca.crt');
    expect(await screen.findByTestId('ca-fingerprint')).toHaveTextContent('98:0C:4E:85');
    expect(screen.getByRole('link', { name: 'https://192.0.2.2:7443' })).toHaveAttribute(
      'href',
      'https://192.0.2.2:7443/pair?code=AB12CD34',
    );
    expect(screen.getByText('On Android (Chrome)')).toBeInTheDocument();
  });

  it('says when the device is already paired', async () => {
    mockHub({
      ...BASE_ROUTES,
      'GET /devices/me': () => json(makeDevice({ name: 'Captain tab 1', kind: 'CAPTAIN' })),
    });
    renderApp('/pair');
    expect(await screen.findByText('Already paired')).toBeInTheDocument();
    expect(screen.getByText(/paired as Captain tab 1 \(Captain tablet\)/)).toBeInTheDocument();
  });
});
