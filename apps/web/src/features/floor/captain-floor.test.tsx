import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { makeFloor, makeTable, TABLE_T1, TABLE_T2 } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

const floor = () =>
  makeFloor([
    makeTable({ status: 'RESERVED' }),
    makeTable({ id: TABLE_T2, label: 'T2', posX: 10, status: 'OCCUPIED' }),
  ]);

describe('Captain floor', () => {
  it('colours tables by status with icon and text, and offers only allowed changes', async () => {
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () =>
        json(makeSession({ permissions: ['tables.view', 'tables.update_status'] })),
      'GET /floor': () => json(floor()),
      [`POST /tables/${TABLE_T1}/status`]: () => json(makeTable({ status: 'BLOCKED', version: 2 })),
    });
    renderApp('/captain');
    const t1 = await screen.findByRole('button', { name: 'Table T1, 4 seats, Reserved' });
    expect(t1).toHaveAttribute('data-status', 'RESERVED');
    expect(screen.getByRole('list', { name: 'Table status' })).toHaveTextContent('Reserved');

    fireEvent.click(t1);
    const sheet = await screen.findByRole('dialog', { name: 'Table T1' });
    const options = within(sheet)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('data-status'))
      .map((b) => b.textContent);
    expect(options).toEqual(['Mark free', 'Block table']);
    expect(within(sheet).getByRole('button', { name: 'Take order' })).toBeDisabled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Block table' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith(`/tables/${TABLE_T1}/status`),
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ status: 'BLOCKED', version: 1 });
    expect(
      await screen.findByRole('button', { name: 'Table T1, 4 seats, Blocked' }),
    ).toBeInTheDocument();
  });

  it('leaves order-driven statuses alone and hides changes without permission', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['tables.view'] })),
      'GET /floor': () => json(floor()),
    });
    renderApp('/captain');
    fireEvent.click(await screen.findByRole('button', { name: 'Table T2, 4 seats, Occupied' }));
    const sheet = await screen.findByRole('dialog', { name: 'Table T2' });
    expect(within(sheet).getByText('Your role cannot change table status.')).toBeInTheDocument();
    expect(
      within(sheet)
        .queryAllByRole('button')
        .filter((b) => b.hasAttribute('data-status')),
    ).toHaveLength(0);
  });
});
