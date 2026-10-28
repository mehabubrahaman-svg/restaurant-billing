import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { ITEM_BIRYANI, makeSnapshot } from '../../test/catalog-fixtures';
import { BASE_ROUTES, json, mockHub, problem } from '../../test/mock-hub';
import { renderApp } from '../../test/render-app';
import { makeSession } from '../../test/session';
import { useAuthStore } from '../auth/auth-store';

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

function menuRoute(etags: (string | null)[]) {
  return ({ headers }: { headers: Headers }) => {
    etags.push(headers.get('if-none-match'));
    const response = json(makeSnapshot());
    response.headers.set('etag', '"v1"');
    return response;
  };
}

describe('Out of stock list', () => {
  it('flips at once, and rolls back with a message when the Hub refuses', async () => {
    let answer: (r: Response) => void = () => {};
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.toggle_availability'] })),
      'GET /menu': menuRoute([]),
      [`POST /menu-items/${ITEM_BIRYANI}/availability`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp('/kitchen/availability');
    const toggle = await screen.findByRole('switch', { name: 'Chicken Biryani available' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    // Optimistic: shown out of stock before the Hub answers.
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(toggle).toHaveTextContent('Out of stock');

    answer(problem(403, 'FORBIDDEN'));
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(
      await screen.findByText(
        'Couldn’t change Chicken Biryani: Your role is not allowed to do this.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the change, refetches with If-None-Match, and filters', async () => {
    const etags: (string | null)[] = [];
    const fetchMock = mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
      'GET /menu': menuRoute(etags),
      [`POST /menu-items/${ITEM_BIRYANI}/availability`]: () => json({}),
    });
    renderApp('/kitchen/availability');
    const toggle = await screen.findByRole('switch', { name: 'Chicken Biryani available' });
    fireEvent.click(toggle);
    await waitFor(() => expect(etags).toEqual([null, '"v1"']));
    const post = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/availability'))!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ isAvailable: false });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'naan' } });
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Chicken Biryani available' })).toBeNull(),
    );
    expect(screen.getByRole('switch', { name: 'Butter Naan available' })).toBeInTheDocument();
  });
});
