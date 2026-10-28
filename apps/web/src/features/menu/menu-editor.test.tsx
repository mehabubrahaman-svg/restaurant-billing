import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import {
  ADDON_EXTRAS,
  addonGroups,
  categories,
  ITEM_BIRYANI,
  makeItem,
  naan,
  stations,
  VARIANT_FULL,
} from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem, type Handler } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

function hub(extra: Record<string, Handler> = {}) {
  return mockHub({
    ...BASE_ROUTES,
    'POST /auth/refresh': () =>
      json(makeSession({ permissions: ['menu.manage', 'menu.toggle_availability'] })),
    'GET /menu-items': () => json({ data: [makeItem(), naan] }),
    'GET /categories': () => json({ data: categories }),
    'GET /kitchen-stations': () => json({ data: stations }),
    'GET /addon-groups': () => json({ data: addonGroups }),
    'GET /tax-groups': () => json({ data: [] }),
    ...extra,
  });
}

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Menu page', () => {
  it('lists items under their categories, with the translation for the UI language', async () => {
    hub();
    renderApp('/admin/menu');
    const biryani = await screen.findByRole('region', { name: 'Biryani' });
    expect(within(biryani).getByText('Chicken Biryani')).toBeInTheDocument();
    expect(within(biryani).getByText('2 variants')).toBeInTheDocument();
    expect(within(biryani).getByRole('img', { name: 'Non-veg' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Breads' })).getByText('Butter Naan'),
    ).toBeInTheDocument();
    await act(() => i18n.changeLanguage('hi-IN'));
    expect(await screen.findByText('चिकन बिरयानी')).toBeInTheDocument();
  });
});

describe('Item editor', () => {
  it('edits price, variants and add-on groups and sends the full lists', async () => {
    const fetchMock = hub({
      [`PATCH /menu-items/${ITEM_BIRYANI}`]: () => json(makeItem({ basePrice: 24950, version: 4 })),
    });
    const { router } = renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    expect(await screen.findByDisplayValue('BIR-CHK')).toBeInTheDocument();

    const price = screen.getAllByLabelText(/^Price/)[0]!;
    fireEvent.change(price, { target: { value: '₹249.5' } });
    expect(price).toHaveAccessibleDescription(expect.stringContaining('₹249.50'));

    // Drop "Half", add "Family pack".
    fireEvent.click(screen.getByRole('button', { name: 'Remove Half' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    const row = screen.getByRole('listitem', { name: 'Variant 2' });
    fireEvent.change(within(row).getByLabelText('Variant'), { target: { value: 'Family pack' } });
    fireEvent.change(within(row).getByLabelText(/^Price/), { target: { value: '899' } });
    fireEvent.change(within(row).getByLabelText('Name in Bengali'), {
      target: { value: 'ফ্যামিলি প্যাক' },
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Extras/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/menu'));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(String(patch[1]?.body));
    expect(body).toMatchObject({ version: 3, basePrice: 24950, addonGroupIds: [ADDON_EXTRAS] });
    expect(body.variants).toEqual([
      { id: VARIANT_FULL, name: 'Full', nameTranslations: {}, price: 32000 },
      { name: 'Family pack', nameTranslations: { bn: 'ফ্যামিলি প্যাক' }, price: 89900 },
    ]);
  });

  it('stops on an unreadable price without calling the Hub', async () => {
    const fetchMock = hub();
    renderApp(`/admin/menu/items/${ITEM_BIRYANI}`);
    const price = (await screen.findAllByLabelText(/^Price/))[0]!;
    fireEvent.change(price, { target: { value: '12.345' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(price).toHaveAttribute('aria-invalid', 'true'));
    expect(price).toHaveAccessibleDescription(expect.stringContaining('Enter an amount'));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('shows the translated name preview and server codes such as SKU_TAKEN', async () => {
    hub({ 'POST /menu-items': () => problem(409, 'SKU_TAKEN') });
    renderApp('/admin/menu/items/new');
    fireEvent.change(await screen.findByLabelText(/^SKU/), { target: { value: 'bir-chk' } });
    fireEvent.change(screen.getByLabelText(/^Name \(English\)/), {
      target: { value: 'Veg Biryani' },
    });
    fireEvent.change(screen.getByLabelText('Name in Hindi'), { target: { value: 'वेज बिरयानी' } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: categories[0]!.id } });
    fireEvent.change(screen.getAllByLabelText(/^Price/)[0]!, { target: { value: '260' } });
    const preview = screen.getByRole('heading', { name: 'Preview' }).parentElement!;
    expect(within(preview).getByText('वेज बिरयानी')).toBeInTheDocument();
    expect(within(preview).getByText('Shows the English name: Veg Biryani')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    expect(await screen.findByText(/Another item already uses this SKU/)).toBeInTheDocument();
  });
});
