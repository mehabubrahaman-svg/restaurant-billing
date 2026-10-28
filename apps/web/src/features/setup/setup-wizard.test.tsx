import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';
import { STATES } from '../../test/fixtures';

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function hub(setup: (body: unknown) => Response) {
  return mockHub({
    ...BASE_ROUTES,
    'GET /setup/status': () => json({ needsSetup: true, states: STATES }),
    'POST /setup': ({ body }) => setup(body),
    'POST /auth/login': () => json(makeSession()),
  });
}

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillBusiness(stateCode: string) {
  await screen.findByRole('heading', { name: 'Language' });
  next();
  await screen.findByRole('heading', { name: 'Business and branch' });
  type(/Business name/, 'Spice Route');
  type(/Branch name/, 'Park Street');
  type(/Branch code/, 'kol1');
  fireEvent.change(screen.getByLabelText(/State or union territory/), {
    target: { value: stateCode },
  });
}

describe('SetupWizard', () => {
  it('follows the header language switcher for the default language', async () => {
    hub(() => json({}));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Language' });
    fireEvent.click(screen.getAllByRole('radio', { name: 'বাংলা' })[0]!);
    await waitFor(() =>
      screen
        .getAllByRole('radio', { name: 'বাংলা' })
        .forEach((r) => expect(r).toHaveAttribute('aria-checked', 'true')),
    );
    await i18n.changeLanguage('en-IN');
  });

  it('validates each step before moving on (GSTIN vs state)', async () => {
    hub(() => json({}));
    renderApp('/');
    await fillBusiness('19');
    type('GSTIN', '27AAPFU0939F1ZV');
    next();
    expect(screen.getByLabelText('GSTIN')).toHaveAccessibleDescription(
      expect.stringContaining('belongs to another state'),
    );
    expect(screen.getByRole('heading', { name: 'Business and branch' })).toBeInTheDocument();
    type('GSTIN', '');
    next();
    expect(await screen.findByRole('heading', { name: 'Liquor' })).toBeInTheDocument();
  });

  it('keeps liquor off in a prohibition state until the override is ticked', async () => {
    hub(() => json({}));
    renderApp('/');
    await fillBusiness('10');
    next();
    await screen.findByRole('heading', { name: 'Liquor' });
    expect(screen.getByText(/Bihar is set up as a prohibition/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: /Sell liquor/ });
    expect(toggle).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /valid liquor licence/ }));
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(screen.getByLabelText(/VAT on liquor/)).toHaveValue('');
    next();
    expect(screen.getByLabelText(/VAT on liquor/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits, signs the owner in and opens admin; shows a wrong setup code', async () => {
    let attempts = 0;
    const fetchMock = hub(() => {
      attempts += 1;
      return attempts === 1
        ? problem(403, 'INVALID_SETUP_CODE')
        : json({
            organizationId: '66666666-6666-4666-8666-666666666666',
            branchId: '11111111-1111-4111-8111-111111111111',
            adminUserId: '33333333-3333-4333-8333-333333333333',
          });
    });
    const { router } = renderApp('/');
    await fillBusiness('19');
    next(); // → liquor (off)
    await screen.findByRole('heading', { name: 'Liquor' });
    next(); // → receipt
    expect(await screen.findByRole('checkbox', { name: 'বাংলা' })).toBeChecked();
    next(); // → admin
    await screen.findByRole('heading', { name: 'Owner account' });
    type(/^Username/, 'owner');
    type(/Full name/, 'Sumit Das');
    type(/^Password/, 'Kolkata#Biryani2026');
    type(/Repeat new password/, 'Kolkata#Biryani2027');
    next();
    expect(screen.getByLabelText(/Repeat new password/)).toHaveAccessibleDescription(
      'The two entries do not match.',
    );
    type(/Repeat new password/, 'Kolkata#Biryani2026');
    next(); // → backup
    await screen.findByRole('heading', { name: 'Backup passphrase' });
    type(/^Backup passphrase/, 'mango lassi at noon');
    type(/Repeat passphrase/, 'mango lassi at noon');
    fireEvent.click(screen.getByRole('checkbox', { name: /written the passphrase down/ }));
    next(); // → review
    await screen.findByRole('heading', { name: 'Review and finish' });
    type(/Setup code/, 'WRONG123');
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Setup code/)).toHaveAccessibleDescription(
        expect.stringContaining('Wrong setup code'),
      ),
    );

    type(/Setup code/, 'WIZARD01');
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    const sent = fetchMock.mock.calls.findLast(([u]) => String(u).endsWith('/api/v1/setup'))!;
    expect(JSON.parse(String(sent[1]?.body))).toMatchObject({
      setupCode: 'WIZARD01',
      branch: { code: 'KOL1', stateCode: '19' },
      liquor: { enabled: false },
      languages: { defaultLocale: 'en-IN', receiptLanguages: ['bn', 'en'] },
      admin: { username: 'owner', fullName: 'Sumit Das' },
    });
    const login = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/auth/login'))!;
    expect(JSON.parse(String(login[1]?.body))).toEqual({
      username: 'owner',
      password: 'Kolkata#Biryani2026',
    });
  });
});
