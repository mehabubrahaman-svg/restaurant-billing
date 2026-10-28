import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { makeFloor, makeTable, TABLE_T1, TABLE_T2 } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const session = () => json(makeSession({ permissions: ['floor.manage', 'tables.view'] }));

describe('Floor editor', () => {
  it('moves a table with the arrow keys and recovers from a save conflict', async () => {
    let version = 1;
    const puts: unknown[] = [];
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': session,
      'GET /floor': () => json(makeFloor([makeTable({ version })])),
      'PUT /floor/layout': ({ body }) => {
        puts.push(body);
        const [move] = (body as { tables: { posX: number; posY: number; version: number }[] })
          .tables;
        if (move!.version !== version) return problem(409, 'VERSION_CONFLICT');
        return json({ data: [makeTable({ posX: move!.posX, posY: move!.posY, version: 3 })] });
      },
    });
    renderApp('/admin/floor');
    const tile = await screen.findByRole('button', { name: /^Table T1, 4 seats, column 3, row 3/ });
    fireEvent.keyDown(tile, { key: 'ArrowRight' });
    fireEvent.keyDown(tile, { key: 'ArrowDown', shiftKey: true });
    expect(tile).toHaveAccessibleName(/column 4, row 7/);
    expect(screen.getByText('1 table moved. Save the layout to keep it.')).toBeInTheDocument();

    // Someone else edited T1 meanwhile: the Hub refuses the whole save.
    version = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Save layout (1 move)' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Someone else changed the floor plan');
    expect(screen.getByRole('button', { name: 'Save layout (1 move)' })).toBeDisabled();

    fireEvent.click(within(alert).getByRole('button', { name: 'Load latest, keep my moves' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save layout (1 move)' }));
    expect(await screen.findByText('Layout saved: 1 table moved.')).toBeInTheDocument();
    expect(puts).toEqual([
      { tables: [{ id: TABLE_T1, posX: 3, posY: 6, version: 1 }] },
      { tables: [{ id: TABLE_T1, posX: 3, posY: 6, version: 2 }] },
    ]);
    expect(screen.getByRole('button', { name: 'Save layout' })).toBeDisabled();
  });

  it('drags with the pointer, snapping to cells and staying inside the grid', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': session,
      'GET /floor': () =>
        json(makeFloor([makeTable(), makeTable({ id: TABLE_T2, label: 'T2', posX: 20 })])),
    });
    renderApp('/admin/floor');
    const tile = await screen.findByRole('button', { name: /^Table T1,/ });
    const canvas = screen.getByRole('group', { name: 'Floor plan of Ground' });
    // 480 × 320 px canvas: each cell is 10 px.
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 480, height: 320, right: 480, bottom: 320 }) as DOMRect;
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 126, clientY: 104 });
    expect(tile).toHaveAccessibleName(/column 6, row 3/);
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 2000, clientY: 2000 });
    expect(tile).toHaveAccessibleName(/column 45, row 29/);
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 2000, clientY: 2000 });
    expect(screen.getByRole('button', { name: 'Save layout (1 move)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(tile).toHaveAccessibleName(/column 3, row 3/);
  });
});
