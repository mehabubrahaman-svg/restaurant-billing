import {
  CalendarDateSchema,
  AdjustmentRequestSchema,
  CreateStockCountRequestSchema,
  OpeningStockRequestSchema,
  PostStockCountRequestSchema,
  SaveInventoryItemRequestSchema,
  SaveRecipeRequestSchema,
  SaveStockCountLinesRequestSchema,
  SetAddonIngredientsRequestSchema,
  StockMovementsQuerySchema,
  StockReceiptRequestSchema,
  UpdateInventoryItemRequestSchema,
  UpdateRecipeRequestSchema,
  WastageRequestSchema,
  type AddonIngredients,
  type ConsumptionReport,
  type InventoryItem,
  type InventoryItemsResponse,
  type Recipe,
  type RecipesResponse,
  type StockAlerts,
  type StockCount,
  type StockEntryResponse,
  type StockMovementsResponse,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const ItemsQuery = z.object({ includeRetired: z.enum(['true', 'false']).default('false') });
const RecipesQuery = z.object({ menuItemId: z.uuid().optional() });
const DateString = CalendarDateSchema;
const RangeQuery = z.object({ from: DateString, to: DateString });
const MAX_RANGE_DAYS = 366;

const VIEW = { permission: 'inventory.view' } as const;
/** The menu editor shows a dish's recipe; the store room edits it. */
const RECIPE_VIEW = { permission: ['inventory.view', 'menu.manage'] } as const;
const MANAGE = { permission: 'inventory.manage_items' } as const;
const ADJUST = { permission: 'inventory.adjust' } as const;
const COUNT = { permission: 'inventory.count' } as const;

/** Phase 2 (docs/05 §3): items and levels, recipes, stock in and out, counts, alerts. */
export async function inventoryRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { inventoryService: inventory } = cradle;
  const branchOf = (r: FastifyRequest) => r.principal!.branchId;

  app.get('/units', { config: VIEW }, async () => ({ data: inventory.units() }));

  // ---- items -------------------------------------------------------------------
  app.get(
    '/inventory-items',
    { config: { permission: ['inventory.view', 'menu.manage'] } },
    async (request): Promise<InventoryItemsResponse> => {
      const { includeRetired } = ItemsQuery.parse(request.query);
      return { data: inventory.items(branchOf(request), includeRetired === 'true') };
    },
  );

  app.get('/inventory-items/:id', { config: VIEW }, async (request): Promise<InventoryItem> =>
    inventory.item(branchOf(request), IdParams.parse(request.params).id),
  );

  app.post('/inventory-items', { config: MANAGE }, async (request, reply) => {
    const item = inventory.createItem(
      SaveInventoryItemRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return item;
  });

  app.patch('/inventory-items/:id', { config: MANAGE }, async (request): Promise<InventoryItem> =>
    inventory.updateItem(
      IdParams.parse(request.params).id,
      UpdateInventoryItemRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- recipes -------------------------------------------------------------------
  app.get('/recipes', { config: RECIPE_VIEW }, async (request): Promise<RecipesResponse> => {
    const { menuItemId } = RecipesQuery.parse(request.query);
    return { data: inventory.recipes(menuItemId ?? null, branchOf(request)) };
  });

  app.post('/recipes', { config: MANAGE }, async (request, reply): Promise<Recipe> => {
    const recipe = inventory.createRecipe(
      SaveRecipeRequestSchema.parse(request.body),
      commandContext(request),
    );
    reply.status(201);
    return recipe;
  });

  /** `isActive: false` removes the recipe and answers 204. */
  app.patch('/recipes/:id', { config: MANAGE }, async (request, reply) => {
    const recipe = inventory.updateRecipe(
      IdParams.parse(request.params).id,
      UpdateRecipeRequestSchema.parse(request.body),
      commandContext(request),
    );
    if (recipe === null) return reply.status(204).send();
    return recipe;
  });

  app.get(
    '/addons/:id/ingredients',
    { config: RECIPE_VIEW },
    async (request): Promise<AddonIngredients> =>
      inventory.addonIngredients(IdParams.parse(request.params).id),
  );

  app.put(
    '/addons/:id/ingredients',
    { config: MANAGE },
    async (request): Promise<AddonIngredients> =>
      inventory.setAddonIngredients(
        IdParams.parse(request.params).id,
        SetAddonIngredientsRequestSchema.parse(request.body).ingredients,
        commandContext(request),
      ),
  );

  // ---- stock in and out ----------------------------------------------------------
  const entry = (path: string, run: (request: FastifyRequest) => StockEntryResponse) =>
    app.post(path, { config: ADJUST }, async (request, reply): Promise<StockEntryResponse> => {
      const result = run(request);
      reply.status(201);
      return result;
    });
  entry('/stock/receipts', (r) =>
    inventory.receive(StockReceiptRequestSchema.parse(r.body), commandContext(r)),
  );
  entry('/stock/opening', (r) =>
    inventory.opening(OpeningStockRequestSchema.parse(r.body), commandContext(r)),
  );
  entry('/stock/wastage', (r) =>
    inventory.wastage(WastageRequestSchema.parse(r.body), commandContext(r)),
  );
  entry('/stock/adjustments', (r) =>
    inventory.adjust(AdjustmentRequestSchema.parse(r.body), commandContext(r)),
  );

  app.get(
    '/stock/movements',
    { config: VIEW },
    async (request): Promise<StockMovementsResponse> => {
      const filter = StockMovementsQuerySchema.parse(request.query);
      const data = inventory.movements(branchOf(request), filter);
      return {
        data,
        nextCursor: data.length === filter.limit ? (data.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get('/stock/alerts', { config: VIEW }, async (request): Promise<StockAlerts> =>
    inventory.alerts(branchOf(request)),
  );

  // ---- stock counts ----------------------------------------------------------------
  app.get('/stock-counts', { config: VIEW }, async (request) => ({
    data: inventory.counts(branchOf(request)),
  }));

  app.get('/stock-counts/:id', { config: VIEW }, async (request): Promise<StockCount> =>
    inventory.count(branchOf(request), IdParams.parse(request.params).id),
  );

  app.post('/stock-counts', { config: COUNT }, async (request, reply): Promise<StockCount> => {
    const count = inventory.createCount(
      CreateStockCountRequestSchema.parse(request.body ?? {}),
      commandContext(request),
    );
    reply.status(201);
    return count;
  });

  app.put('/stock-counts/:id/lines', { config: COUNT }, async (request): Promise<StockCount> =>
    inventory.saveCountLines(
      IdParams.parse(request.params).id,
      SaveStockCountLinesRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  /** Posting books the differences as adjustments, so it needs inventory.adjust. */
  app.post('/stock-counts/:id/post', { config: ADJUST }, async (request): Promise<StockCount> =>
    inventory.postCount(
      IdParams.parse(request.params).id,
      PostStockCountRequestSchema.parse(request.body),
      commandContext(request),
    ),
  );

  // ---- reports ------------------------------------------------------------------------
  app.get(
    '/reports/consumption',
    { config: { permission: 'reports.inventory' } },
    async (request): Promise<ConsumptionReport> => {
      const { from, to } = RangeQuery.parse(request.query);
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      if (days < 0 || days >= MAX_RANGE_DAYS) {
        throw new DomainError('VALIDATION_FAILED', `the range must be 1 to ${MAX_RANGE_DAYS} days`);
      }
      return inventory.consumption(branchOf(request), from, to);
    },
  );
}
