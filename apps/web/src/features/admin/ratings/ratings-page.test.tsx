import type { Bestsellers, OrderRating, RatingSummary } from '@restroos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import { expectNoAxeViolations } from '../../../test/axe';
import { BASE_ROUTES, json, mockHub } from '../../../test/mock-hub';
import { renderApp } from '../../../test/render-app';
import { makeSession } from '../../../test/session';
import { useAuthStore } from '../../auth/auth-store';

const NAAN = '0d500000-0000-4000-8000-000000000001';
const BIRYANI = '0d500000-0000-4000-8000-000000000002';
const NAAN_RATING = '0d600000-0000-4000-8000-000000000001';
const BIRYANI_RATING = '0d600000-0000-4000-8000-000000000002';

const rating = (status: OrderRating['dishes'][number]['status']): OrderRating => ({
  id: '0d700000-0000-4000-8000-000000000001',
  orderId: '0d800000-0000-4000-8000-000000000001',
  orderNo: '142',
  businessDate: '2026-11-05',
  createdAt: '2026-11-05T14:30:00.000Z',
  tableLabel: 'T1',
  guestName: 'Ananya',
  guestPhoneLast4: '3210',
  captainId: '0d900000-0000-4000-8000-000000000001',
  captainName: 'Rahul Das',
  captainStars: 5,
  comment: 'Lovely evening',
  dishes: [
    {
      id: NAAN_RATING,
      menuItemId: NAAN,
      name: 'Butter Naan',
      stars: 4,
      comment: null,
      status,
      reviewedAt: null,
      version: 1,
    },
    {
      id: BIRYANI_RATING,
      menuItemId: BIRYANI,
      name: 'Chicken Biryani',
      stars: 2,
      comment: 'A little salty',
      status: 'PENDING',
      reviewedAt: null,
      version: 1,
    },
  ],
});
const SUMMARY: RatingSummary = {
  captains: [
    {
      captainId: '0d900000-0000-4000-8000-000000000001',
      name: 'Rahul Das',
      ratings: 3,
      average: 4.7,
    },
  ],
  dishes: [
    { menuItemId: NAAN, name: 'Butter Naan', counted: 2, average: 4.5, pending: 1, excluded: 0 },
  ],
};
const dish = { foodType: 'VEG' as const, imageId: null, isActive: true, average: 4.5, ratings: 2 };

beforeEach(async () => {
  useAuthStore.setState({ status: 'restoring', session: null });
  await i18n.changeLanguage('en-IN');
});
afterEach(() => vi.unstubAllGlobals());

describe('Admin → Ratings', () => {
  it('counts or leaves out dish ratings, shows captains and dishes, and keeps the bestsellers', async () => {
    const reviewed: unknown[] = [];
    const saved: unknown[] = [];
    let naanStatus: OrderRating['dishes'][number]['status'] = 'PENDING';
    let list: Bestsellers = {
      items: [],
      suggestions: [
        { menuItemId: NAAN, name: 'Butter Naan', rank: 1, ...dish },
        {
          menuItemId: BIRYANI,
          name: 'Chicken Biryani',
          rank: 2,
          ...dish,
          foodType: 'NON_VEG',
          average: null,
          ratings: 0,
        },
      ],
    };
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['feedback.manage'] })),
      'GET /ratings': ({ url }) =>
        json({
          data:
            url.searchParams.get('status') === 'PENDING' || url.searchParams.get('status') === 'ALL'
              ? [rating(naanStatus)]
              : [],
        }),
      'POST /ratings/dishes/review': ({ body }) => {
        reviewed.push(body);
        naanStatus = 'COUNTED';
        return json({ updated: 1 });
      },
      'GET /ratings/summary': () => json(SUMMARY),
      'GET /bestsellers': () => json(list),
      'PUT /bestsellers': ({ body }) => {
        saved.push(body);
        const { items } = body as { items: { menuItemId: string; published: boolean }[] };
        list = {
          items: items.map((i) => ({
            ...dish,
            menuItemId: i.menuItemId,
            name: i.menuItemId === NAAN ? 'Butter Naan' : 'Chicken Biryani',
            published: i.published,
          })),
          suggestions: list.suggestions.filter(
            (s) => !items.some((i) => i.menuItemId === s.menuItemId),
          ),
        };
        return json(list);
      },
    });
    renderApp('/admin/ratings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Guest ratings' }),
    ).toBeInTheDocument();
    const card = (await screen.findByRole('heading', { name: 'Order #142 · Table T1' })).closest(
      'div.flex.flex-col.gap-3',
    ) as HTMLElement;
    expect(within(card).getByText(/Ananya ••3210/)).toBeInTheDocument();
    expect(within(card).getByText('Captain Rahul Das')).toBeInTheDocument();
    expect(within(card).getAllByRole('img', { name: '5 stars' })).toHaveLength(1);
    expect(within(card).getByText('“A little salty”')).toBeInTheDocument();
    await expectNoAxeViolations();

    fireEvent.click(within(card).getByRole('button', { name: 'Count the rating of Butter Naan' }));
    await waitFor(() => expect(reviewed).toEqual([{ ids: [NAAN_RATING], status: 'COUNTED' }]));
    fireEvent.click(
      within(card).getByRole('button', { name: 'Leave out the rating of Chicken Biryani' }),
    );
    await waitFor(() => expect(reviewed).toHaveLength(2));
    expect(reviewed[1]).toEqual({ ids: [BIRYANI_RATING], status: 'EXCLUDED' });

    fireEvent.click(screen.getByRole('radio', { name: 'Captains and dishes' }));
    const captains = (await screen.findByRole('heading', { name: 'Captains' })).closest('section')!;
    const captainRow = within(captains).getByText('Rahul Das').closest('tr')!;
    expect(within(captainRow).getByText('4.7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Bestsellers' }));
    expect(
      await screen.findByText('No bestsellers yet. Add some from the suggestions.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Butter Naan to the bestsellers' }));
    const published = await screen.findByRole('switch', { name: 'Shown to guests' });
    expect(published).toBeChecked();
    expect(saved).toEqual([{ items: [{ menuItemId: NAAN, published: true }] }]);
    await expectNoAxeViolations();

    fireEvent.click(published);
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toEqual({ items: [{ menuItemId: NAAN, published: false }] });
  });

  it('is not open to staff without the permission', async () => {
    mockHub({
      ...BASE_ROUTES,
      'POST /auth/refresh': () => json(makeSession({ permissions: ['menu.manage'] })),
    });
    renderApp('/admin/ratings');
    expect(
      await screen.findByText('Your role cannot open Ratings. Ask a manager to give you access.'),
    ).toBeInTheDocument();
  });
});
