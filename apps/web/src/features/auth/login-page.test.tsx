import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { useDeviceStore } from '../../stores/device-store';
import { useSessionStore } from '../../stores/session-store';
import { renderApp } from '../../test/render-app';

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
  useDeviceStore.setState({ kind: 'POS' });
  useSessionStore.setState({ user: null });
  await i18n.changeLanguage('en-IN');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const key = (name: string) => screen.getByRole('button', { name });

describe('LoginPage', () => {
  it('enters a PIN on the pad and signs the chosen user in', async () => {
    const { router } = renderApp('/login');
    fireEvent.click(key('Asha Sen'));
    expect(screen.getByText('PIN for Asha S.')).toBeInTheDocument();

    const submit = key('Sign in');
    expect(submit).toBeDisabled();
    for (const d of ['1', '2', '3']) fireEvent.click(key(d));
    expect(screen.getByText('3 of 4 digits entered')).toBeInTheDocument();
    fireEvent.click(key('Delete last digit'));
    expect(screen.getByText('2 of 4 digits entered')).toBeInTheDocument();
    fireEvent.click(key('3'));
    fireEvent.click(key('4'));
    fireEvent.click(key('5'));
    expect(screen.getByText('4 of 4 digits entered')).toBeInTheDocument();
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe('/pos'));
    expect(useSessionStore.getState().user?.displayName).toBe('Asha Sen');
  });

  it('accepts the physical keyboard', async () => {
    const { router } = renderApp('/login');
    fireEvent.click(key('Manoj Jha'));
    for (const d of ['9', '8', '7', '6']) fireEvent.keyDown(window, { key: d });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/captain'));
  });

  it('looks up other staff by employee code', async () => {
    renderApp('/login');
    fireEvent.click(key('Other'));
    fireEvent.change(screen.getByLabelText('Employee code'), { target: { value: '9999' } });
    for (const d of ['1', '1', '1', '1']) fireEvent.click(key(d));
    fireEvent.click(key('Sign in'));
    expect(await screen.findByRole('alert')).toHaveTextContent('No staff member with this code');
  });
});
