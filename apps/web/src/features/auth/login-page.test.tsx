import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { useDeviceStore } from '../../stores/device-store';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { BRANCH_2_ID, BRANCH_ID, makeSession, USER_ID } from '../../test/session';
import { useAuthStore } from './auth-store';

const PIN_USERS = {
  data: [
    { id: USER_ID, fullName: 'Ravi Kumar', initials: 'RK' },
    { id: '44444444-4444-4444-8444-444444444444', fullName: 'Asha Sen', initials: 'AS' },
  ],
};

beforeEach(async () => {
  useDeviceStore.setState({ kind: 'POS' });
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const key = (name: string) => screen.getByRole('button', { name });

describe('LoginPage', () => {
  it('signs in with a PIN tile and the pad', async () => {
    const hub = mockHub({
      ...BASE_ROUTES,
      'GET /auth/pin-users': () => json(PIN_USERS),
      'POST /auth/pin-login': () => json(makeSession({ permissions: ['billing.create'] })),
    });
    const { router } = renderApp('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Asha Sen' }));
    expect(screen.getByText('PIN for Asha Sen')).toBeInTheDocument();
    const submit = key('Sign in');
    for (const d of ['2', '5', '8']) fireEvent.click(key(d));
    expect(submit).toBeDisabled();
    fireEvent.click(key('0'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe('/pos'));
    const call = hub.mock.calls.find(([url]) => String(url).endsWith('/auth/pin-login'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      userId: '44444444-4444-4444-8444-444444444444',
      pin: '2580',
    });
    expect(call[1]?.credentials).toBe('include');
  });

  it('shows translated errors: invalid, locked (with time), disabled', async () => {
    let answer = problem(401, 'INVALID_CREDENTIALS');
    mockHub({ ...BASE_ROUTES, 'POST /auth/login': () => answer });
    renderApp('/login');
    fireEvent.click(await screen.findByRole('radio', { name: 'Password' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });

    fireEvent.click(key('Sign in'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username, password or PIN.');

    answer = problem(423, 'ACCOUNT_LOCKED', { detail: 'Locked until 2026-10-28T09:15:00.000Z' });
    fireEvent.click(key('Sign in'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/locked until .*\d{1,2}:15/),
    );

    answer = problem(403, 'ACCOUNT_DISABLED');
    fireEvent.click(key('Sign in'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This account is switched off.'),
    );
  });

  it('asks people with several branches to pick one, then switches', async () => {
    const branches = [
      { id: BRANCH_ID, code: 'KOL1', name: 'Park Street', stateCode: '19' },
      { id: BRANCH_2_ID, code: 'KOL2', name: 'Salt Lake', stateCode: '19' },
    ];
    const hub = mockHub({
      ...BASE_ROUTES,
      'POST /auth/login': () => json(makeSession({ branches, permissions: ['billing.create'] })),
      'POST /auth/refresh': ({ body }) => {
        const wanted = (body as { branchId?: string } | undefined)?.branchId;
        const branch = branches.find((b) => b.id === wanted);
        return branch === undefined
          ? problem(401, 'UNAUTHENTICATED')
          : json(makeSession({ branches, branch, permissions: ['billing.create'] }));
      },
    });
    const { router } = renderApp('/login');
    fireEvent.click(await screen.findByRole('radio', { name: 'Password' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
    fireEvent.click(key('Sign in'));
    expect(await screen.findByRole('heading', { name: 'Choose a branch' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');

    fireEvent.click(screen.getByRole('button', { name: /Salt Lake/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pos'));
    expect(useAuthStore.getState().session?.branch.id).toBe(BRANCH_2_ID);
    const switchCall = hub.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/auth/refresh') && String(init?.body).includes(BRANCH_2_ID),
    );
    expect(switchCall).toBeDefined();
  });

  it('without a paired device: hides the PIN pad and offers password sign-in and pairing', async () => {
    mockHub({
      ...BASE_ROUTES,
      'GET /auth/pin-users': () => problem(403, 'DEVICE_NOT_PAIRED'),
      'GET /devices/me': () => problem(403, 'DEVICE_NOT_PAIRED'),
    });
    renderApp('/login');
    expect(await screen.findByText('PIN sign-in is off on this device')).toBeInTheDocument();
    expect(screen.getByText('This device is not paired with the Hub')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'PIN' })).toBeNull();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pair this device' })).toHaveAttribute('href', '/pair');
    expect(screen.getByText(/Admin → Devices/)).toBeInTheDocument();
  });

  it('falls back to password when the Hub refuses a PIN sign-in from an unpaired device', async () => {
    mockHub({
      ...BASE_ROUTES,
      'GET /auth/pin-users': () => json(PIN_USERS),
      'POST /auth/pin-login': () => problem(403, 'DEVICE_NOT_PAIRED'),
    });
    renderApp('/login');
    fireEvent.click(await screen.findByRole('button', { name: 'Asha Sen' }));
    for (const d of ['2', '5', '8', '0']) fireEvent.click(key(d));
    fireEvent.click(key('Sign in'));
    expect(await screen.findByText('PIN sign-in is off on this device')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });
});
