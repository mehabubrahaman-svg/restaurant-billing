import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { makeDevice } from '../../../test/fixtures';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

const TABLET_ID = '0193a5b0-0000-7000-8000-0000000000a1';
const STATION_ID = '0193a5b0-0000-7000-8000-0000000000b1';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => {
  delete window.RestroAndroid;
  vi.unstubAllGlobals();
});

describe('Printers in the Android app', () => {
  it('adds a Bluetooth KOT printer paired with this tablet, printed by the tablet', async () => {
    window.RestroAndroid = {
      version: () => '1.0.0',
      bondedPrinters: () =>
        JSON.stringify({
          ok: true,
          printers: [{ name: 'RP58 Kitchen', address: '66:22:B3:01:4C:7A', type: 'CLASSIC' }],
        }),
      print: () => {},
      saveFile: () => '{"ok":true}',
    };
    const tablet = makeDevice({ id: TABLET_ID, name: 'Tandoor tablet', kind: 'POS' });
    const saved: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['settings.manage'] })),
      'GET /devices/me': () => json(tablet),
      'GET /devices': () => json({ data: [tablet] }),
      'GET /devices/me/print-jobs': () => json({ data: [] }),
      'GET /printers': () => json({ data: [] }),
      'GET /kitchen-stations': () =>
        json({
          data: [{ id: STATION_ID, name: 'Tandoor', isActive: true, version: 1 }],
        }),
      'POST /printers': ({ body }) => {
        saved.push(body);
        return json({
          id: '0193a5b0-0000-7000-8000-0000000000c1',
          isActive: true,
          version: 1,
          ...(body as object),
        });
      },
    });
    renderApp('/admin/printers');
    fireEvent.click(await screen.findByRole('button', { name: 'Add printer' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Used for'), { target: { value: 'KOT' } });
    fireEvent.change(await within(dialog).findByLabelText(/Kitchen station/), {
      target: { value: STATION_ID },
    });
    fireEvent.change(within(dialog).getByLabelText('Connection'), {
      target: { value: 'BLUETOOTH' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Choose a printer paired with this tablet' }),
    );
    fireEvent.click(await within(dialog).findByRole('button', { name: /RP58 Kitchen/ }));
    expect(within(dialog).getByLabelText(/Printed by/)).toHaveValue(TABLET_ID);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      name: 'RP58 Kitchen',
      connection: 'BLUETOOTH',
      address: '66:22:B3:01:4C:7A',
      paperWidthMm: 80,
      purpose: 'KOT',
      stationId: STATION_ID,
      deviceId: TABLET_ID,
    });
  });
});
