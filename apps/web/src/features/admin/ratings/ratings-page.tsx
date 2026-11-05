import type { DishRatingStatus, OrderRating } from '@restroos/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ChevronDown,
  ChevronUp,
  Field,
  Input,
  Plus,
  SegmentedControl,
  Select,
  Switch,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Trash,
  Tr,
} from '@restroos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/endpoints';
import { useFormat } from '../../../i18n/use-format';
import { useErrorMessage } from '../../../lib/errors';
import { photoUrl } from '../../../lib/dish-photos';
import { localIsoDate } from '../../../portals/pos/bills-page';
import { FoodTypeMark } from '../../menu/food-type';
import { StarRow, StarScore } from '../../ratings/stars';
import { toast } from '../../toast/toast-store';
import { AdminHeader } from '../admin-layout';
import { QueryState } from '../query-state';

type View = 'reviews' | 'summary' | 'bestsellers';
type Filter = DishRatingStatus | 'ALL';
const FILTERS: readonly Filter[] = ['PENDING', 'COUNTED', 'EXCLUDED', 'ALL'];
const RATINGS_KEY = ['ratings'] as const;
const BESTSELLERS_KEY = ['bestsellers'] as const;
/** The most bestsellers the list holds (the Hub's limit too). */
export const MAX_BESTSELLERS = 12;

const daysBefore = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - days);
  return localIsoDate(d);
};

/**
 * Admin → Ratings: what guests said about their captain and the dishes.
 * The admin counts the dish ratings that should make up a dish's stars on
 * the guest menu, or leaves them out, and keeps the bestseller list.
 */
export function RatingsPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('reviews');
  const today = localIsoDate();
  const [from, setFrom] = useState(daysBefore(today, 6));
  const [to, setTo] = useState(today);
  const range = from !== '' && to !== '' && from <= to ? { from, to } : null;

  return (
    <div className="flex flex-col gap-4">
      <AdminHeader title={t('ratings.title')} description={t('ratings.description')} />
      <SegmentedControl
        aria-label={t('ratings.views')}
        value={view}
        onValueChange={setView}
        options={[
          { value: 'reviews', label: t('ratings.view.reviews') },
          { value: 'summary', label: t('ratings.view.summary') },
          { value: 'bestsellers', label: t('ratings.view.bestsellers') },
        ]}
        className="self-start"
      />
      {view !== 'bestsellers' && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('ratings.from')} className="w-full sm:w-44">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={from}
                max={to || today}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('ratings.to')} className="w-full sm:w-44">
            {(p) => (
              <Input
                {...p}
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      {view === 'reviews' && range && <Reviews range={range} />}
      {view === 'summary' && range && <Summary range={range} />}
      {view === 'bestsellers' && <BestsellerList />}
    </div>
  );
}

function Reviews({ range }: { range: { from: string; to: string } }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Filter>('PENDING');
  const ratings = useQuery({
    queryKey: [...RATINGS_KEY, range.from, range.to, status],
    queryFn: () => api.ratings.list({ ...range, status }),
  });
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('ratings.show')} className="w-full sm:w-56">
        {(p) => (
          <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`ratings.filter.${f}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <QueryState query={ratings}>
        {({ data }) =>
          data.length === 0 ? (
            <p className="text-muted-foreground">{t('ratings.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.map((r) => (
                <li key={r.id}>
                  <RatingCard rating={r} />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </div>
  );
}

const STATUS_BADGE = { PENDING: 'info', COUNTED: 'success', EXCLUDED: 'neutral' } as const;

function RatingCard({ rating }: { rating: OrderRating }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const review = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: DishRatingStatus }) =>
      api.ratings.review(ids, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: RATINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: BESTSELLERS_KEY });
    },
    onError: (error) => toast(errorMessage(error), 'danger'),
  });
  const pending = rating.dishes.filter((d) => d.status === 'PENDING').map((d) => d.id);
  const guest = [rating.guestName, `••${rating.guestPhoneLast4}`].filter(Boolean).join(' ');

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-semibold">
              {rating.tableLabel === null
                ? t('order.number', { orderNo: rating.orderNo })
                : t('qr.rate.orderAtTable', { orderNo: rating.orderNo, table: rating.tableLabel })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {format.dateTime(rating.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
              {' · '}
              {guest}
            </p>
          </div>
          {pending.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate({ ids: pending, status: 'COUNTED' })}
            >
              {t('ratings.countAll')}
            </Button>
          )}
        </div>
        {rating.captainStars !== null && (
          <p className="flex flex-wrap items-center gap-2">
            <span>{t('ratings.captain', { name: rating.captainName ?? '—' })}</span>
            <StarRow stars={rating.captainStars} />
          </p>
        )}
        {rating.comment !== null && (
          <blockquote className="border-s-4 ps-3 break-words text-muted-foreground italic">
            {rating.comment}
          </blockquote>
        )}
        {rating.dishes.length > 0 && (
          <Table>
            <THead>
              <Tr>
                <Th>{t('ratings.dish')}</Th>
                <Th>{t('ratings.starsHeading')}</Th>
                <Th>{t('ratings.state')}</Th>
                <Th>
                  <span className="sr-only">{t('users.actions')}</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rating.dishes.map((d) => (
                <Tr key={d.id}>
                  <Td>
                    <span className="font-medium">{d.name}</span>
                    {d.comment !== null && (
                      <span className="block text-sm break-words text-muted-foreground">
                        “{d.comment}”
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StarRow stars={d.stars} />
                  </Td>
                  <Td>
                    <Badge variant={STATUS_BADGE[d.status]}>
                      {t(`ratings.status.${d.status}`)}
                    </Badge>
                  </Td>
                  <Td className="text-end whitespace-nowrap">
                    {d.status !== 'COUNTED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        aria-label={t('ratings.countNamed', { name: d.name })}
                        onClick={() => review.mutate({ ids: [d.id], status: 'COUNTED' })}
                      >
                        {t('ratings.count')}
                      </Button>
                    )}
                    {d.status !== 'EXCLUDED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ms-1"
                        disabled={review.isPending}
                        aria-label={t('ratings.excludeNamed', { name: d.name })}
                        onClick={() => review.mutate({ ids: [d.id], status: 'EXCLUDED' })}
                      >
                        {t('ratings.exclude')}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({ range }: { range: { from: string; to: string } }) {
  const { t } = useTranslation();
  const format = useFormat();
  const summary = useQuery({
    queryKey: [...RATINGS_KEY, 'summary', range.from, range.to],
    queryFn: () => api.ratings.summary(range),
  });
  const average = (n: number | null) =>
    n === null ? '—' : format.number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <QueryState query={summary}>
      {({ captains, dishes }) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="ratings-captains" className="flex flex-col gap-2">
            <h2 id="ratings-captains" className="text-lg font-semibold">
              {t('ratings.captains')}
            </h2>
            {captains.length === 0 ? (
              <p className="text-muted-foreground">{t('ratings.empty')}</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t('ratings.captainHeading')}</Th>
                    <Th className="text-end">{t('ratings.ratingsHeading')}</Th>
                    <Th className="text-end">{t('ratings.averageHeading')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {captains.map((c) => (
                    <Tr key={c.captainId}>
                      <Td className="font-medium">{c.name}</Td>
                      <Td className="text-end tabular-nums">{format.number(c.ratings)}</Td>
                      <Td className="text-end tabular-nums">{average(c.average)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
          <section aria-labelledby="ratings-dishes" className="flex flex-col gap-2">
            <h2 id="ratings-dishes" className="text-lg font-semibold">
              {t('ratings.dishes')}
            </h2>
            {dishes.length === 0 ? (
              <p className="text-muted-foreground">{t('ratings.empty')}</p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>{t('ratings.dish')}</Th>
                    <Th className="text-end">{t('ratings.countedHeading')}</Th>
                    <Th className="text-end">{t('ratings.averageHeading')}</Th>
                    <Th className="text-end">{t('ratings.pendingHeading')}</Th>
                    <Th className="text-end">{t('ratings.excludedHeading')}</Th>
                  </Tr>
                </THead>
                <TBody>
                  {dishes.map((d) => (
                    <Tr key={d.menuItemId}>
                      <Td className="font-medium">{d.name}</Td>
                      <Td className="text-end tabular-nums">{format.number(d.counted)}</Td>
                      <Td className="text-end tabular-nums">{average(d.average)}</Td>
                      <Td className="text-end tabular-nums">{format.number(d.pending)}</Td>
                      <Td className="text-end tabular-nums">{format.number(d.excluded)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </QueryState>
  );
}

function BestsellerList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const list = useQuery({ queryKey: BESTSELLERS_KEY, queryFn: api.ratings.bestsellers });
  const save = useMutation({
    mutationFn: api.ratings.setBestsellers,
    onSuccess: (data) => queryClient.setQueryData(BESTSELLERS_KEY, data),
    onError: (error) => toast(errorMessage(error), 'danger'),
  });

  return (
    <QueryState query={list}>
      {({ items, suggestions }) => {
        const entries = items.map((i) => ({ menuItemId: i.menuItemId, published: i.published }));
        const put = (next: typeof entries) => save.mutate({ items: next });
        const move = (index: number, by: -1 | 1) => {
          const next = [...entries];
          const [moved] = next.splice(index, 1);
          next.splice(index + by, 0, moved!);
          put(next);
        };
        const full = items.length >= MAX_BESTSELLERS;
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="bestsellers-list" className="flex flex-col gap-2">
              <h2 id="bestsellers-list" className="text-lg font-semibold">
                {t('ratings.bestsellers.title')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('ratings.bestsellers.description', { max: MAX_BESTSELLERS })}
              </p>
              {items.length === 0 ? (
                <p className="text-muted-foreground">{t('ratings.bestsellers.empty')}</p>
              ) : (
                <ol className="flex flex-col divide-y rounded-xl border bg-surface">
                  {items.map((item, index) => (
                    <li key={item.menuItemId} className="flex flex-wrap items-center gap-3 p-3">
                      <DishLabel dish={item} />
                      <Switch
                        label={t('ratings.bestsellers.published')}
                        checked={item.published}
                        disabled={save.isPending}
                        onCheckedChange={(published) =>
                          put(entries.map((e, i) => (i === index ? { ...e, published } : e)))
                        }
                      />
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('ratings.bestsellers.up', { name: item.name })}
                          disabled={index === 0 || save.isPending}
                          onClick={() => move(index, -1)}
                        >
                          <ChevronUp aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('ratings.bestsellers.down', { name: item.name })}
                          disabled={index === items.length - 1 || save.isPending}
                          onClick={() => move(index, 1)}
                        >
                          <ChevronDown aria-hidden="true" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t('ratings.bestsellers.remove', { name: item.name })}
                          disabled={save.isPending}
                          onClick={() => put(entries.filter((_, i) => i !== index))}
                        >
                          <Trash aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section aria-labelledby="bestsellers-suggestions" className="flex flex-col gap-2">
              <h2 id="bestsellers-suggestions" className="text-lg font-semibold">
                {t('ratings.bestsellers.suggestions')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('ratings.bestsellers.suggestionsHint')}
              </p>
              {suggestions.length === 0 ? (
                <p className="text-muted-foreground">{t('ratings.bestsellers.noSuggestions')}</p>
              ) : (
                <ol className="flex flex-col divide-y rounded-xl border bg-surface">
                  {suggestions.map((dish) => (
                    <li key={dish.menuItemId} className="flex flex-wrap items-center gap-3 p-3">
                      <span className="w-6 text-end text-sm text-muted-foreground tabular-nums">
                        {dish.rank}
                      </span>
                      <DishLabel dish={dish} />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={full || save.isPending}
                        aria-label={t('ratings.bestsellers.addNamed', { name: dish.name })}
                        onClick={() =>
                          put([...entries, { menuItemId: dish.menuItemId, published: true }])
                        }
                      >
                        <Plus aria-hidden="true" />
                        {t('ratings.bestsellers.add')}
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        );
      }}
    </QueryState>
  );
}

function DishLabel({
  dish,
}: {
  dish: {
    name: string;
    foodType: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' | 'NA';
    imageId: string | null;
    isActive: boolean;
    average: number | null;
    ratings: number;
  };
}) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {dish.imageId !== null ? (
        <img
          src={photoUrl(dish.imageId)}
          alt=""
          width={44}
          height={44}
          loading="lazy"
          className="size-11 shrink-0 rounded-lg bg-muted object-cover"
        />
      ) : (
        <span className="size-11 shrink-0 rounded-lg bg-muted" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 font-medium break-words">
          <FoodTypeMark type={dish.foodType} size="sm" />
          {dish.name}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {dish.average !== null ? (
            <StarScore average={dish.average} count={dish.ratings} />
          ) : (
            t('ratings.bestsellers.noStars')
          )}
          {!dish.isActive && <Badge variant="neutral">{t('ratings.bestsellers.offMenu')}</Badge>}
        </span>
      </span>
    </span>
  );
}
