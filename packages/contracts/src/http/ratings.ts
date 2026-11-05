import { z } from 'zod';
import { FoodTypeSchema, TranslationsSchema } from './catalog';
import { CalendarDateSchema, IdSchema } from './common';
import { IndianMobileSchema } from './customers';

// ---- Guest ratings and bestsellers ------------------------------------------------

const Stars = z.number().int().min(1).max(5);
const Version = z.number().int();

/** The captain puts the guest's phone on the order (null takes it off). */
export const SetOrderGuestRequestSchema = z.object({
  version: Version,
  phone: IndianMobileSchema.nullable(),
  name: z.string().trim().min(1).max(80).optional(),
});
export type SetOrderGuestRequest = z.input<typeof SetOrderGuestRequestSchema>;

/** The guest, on the table's QR page: today's orders with this phone. */
export const RatingLookupRequestSchema = z.object({ phone: IndianMobileSchema });
export type RatingLookupRequest = z.input<typeof RatingLookupRequestSchema>;

export const RatableOrderSchema = z.object({
  id: IdSchema,
  orderNo: z.string(),
  tableLabel: z.string().nullable(),
  openedAt: z.string(),
  /** First name only. */
  captainName: z.string().nullable(),
  dishes: z.array(
    z.object({
      menuItemId: IdSchema,
      name: z.string(),
      nameTranslations: TranslationsSchema,
      imageId: z.string().nullable(),
    }),
  ),
  /** Already rated: it can't be rated again. */
  rated: z.boolean(),
});
export type RatableOrder = z.infer<typeof RatableOrderSchema>;
export const RatingLookupResponseSchema = z.object({ orders: z.array(RatableOrderSchema) });
export type RatingLookupResponse = z.infer<typeof RatingLookupResponseSchema>;

export const SubmitRatingRequestSchema = z
  .object({
    orderId: IdSchema,
    /** The same phone as the look-up: the order must carry it. */
    phone: IndianMobileSchema,
    captainStars: Stars.nullable().default(null),
    comment: z.string().trim().max(500).optional(),
    dishes: z
      .array(
        z.object({
          menuItemId: IdSchema,
          stars: Stars,
          comment: z.string().trim().max(300).optional(),
        }),
      )
      .max(40)
      .default([]),
  })
  .refine((r) => r.captainStars !== null || r.dishes.length > 0, {
    message: 'give at least one rating',
    path: ['dishes'],
  });
export type SubmitRatingRequest = z.input<typeof SubmitRatingRequestSchema>;
export const SubmitRatingResponseSchema = z.object({ id: IdSchema });

// ---- the admin --------------------------------------------------------------------

export const DishRatingStatusSchema = z.enum(['PENDING', 'COUNTED', 'EXCLUDED']);
export type DishRatingStatus = z.infer<typeof DishRatingStatusSchema>;

export const RatingsQuerySchema = z.object({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
  /** Ratings with at least one dish rating in this state (ALL: every rating). */
  status: DishRatingStatusSchema.or(z.literal('ALL')).default('ALL'),
});

export const OrderRatingSchema = z.object({
  id: IdSchema,
  orderId: IdSchema,
  orderNo: z.string(),
  businessDate: z.string(),
  createdAt: z.string(),
  tableLabel: z.string().nullable(),
  guestName: z.string().nullable(),
  /** The last four digits of the guest's phone. */
  guestPhoneLast4: z.string(),
  captainId: IdSchema.nullable(),
  captainName: z.string().nullable(),
  captainStars: Stars.nullable(),
  comment: z.string().nullable(),
  dishes: z.array(
    z.object({
      id: IdSchema,
      menuItemId: IdSchema,
      name: z.string(),
      stars: Stars,
      comment: z.string().nullable(),
      status: DishRatingStatusSchema,
      reviewedAt: z.string().nullable(),
      version: Version,
    }),
  ),
});
export type OrderRating = z.infer<typeof OrderRatingSchema>;
export const OrderRatingsResponseSchema = z.object({ data: z.array(OrderRatingSchema) });

export const ReviewDishRatingsRequestSchema = z.object({
  ids: z.array(IdSchema).min(1).max(200),
  /** COUNTED: shows in the dish's stars on the menu. EXCLUDED: never does. PENDING: decide later. */
  status: DishRatingStatusSchema,
});
export const ReviewDishRatingsResponseSchema = z.object({ updated: z.number().int() });

export const RatingSummaryQuerySchema = z.object({
  from: CalendarDateSchema,
  to: CalendarDateSchema,
});
export const RatingSummarySchema = z.object({
  captains: z.array(
    z.object({
      captainId: IdSchema,
      name: z.string(),
      ratings: z.number().int(),
      average: z.number(),
    }),
  ),
  dishes: z.array(
    z.object({
      menuItemId: IdSchema,
      name: z.string(),
      counted: z.number().int(),
      /** Of the counted ratings; null when none are counted yet. */
      average: z.number().nullable(),
      pending: z.number().int(),
      excluded: z.number().int(),
    }),
  ),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

const BestsellerDishSchema = z.object({
  menuItemId: IdSchema,
  name: z.string(),
  foodType: FoodTypeSchema,
  imageId: z.string().nullable(),
  /** Off the menu: kept on the list, but guests don't see it. */
  isActive: z.boolean(),
  /** Counted stars, or null. */
  average: z.number().nullable(),
  ratings: z.number().int(),
});
export const BestsellersResponseSchema = z.object({
  /** The list, in the order guests see it. */
  items: z.array(BestsellerDishSchema.extend({ published: z.boolean() })),
  /** Dishes ordered most over the last 30 days that aren't on the list. */
  suggestions: z.array(BestsellerDishSchema.extend({ rank: z.number().int() })),
});
export type Bestsellers = z.infer<typeof BestsellersResponseSchema>;

export const SetBestsellersRequestSchema = z.object({
  items: z
    .array(z.object({ menuItemId: IdSchema, published: z.boolean() }))
    .max(12)
    .refine(
      (list) => new Set(list.map((i) => i.menuItemId)).size === list.length,
      'each dish once',
    ),
});
export type SetBestsellersRequest = z.input<typeof SetBestsellersRequestSchema>;
