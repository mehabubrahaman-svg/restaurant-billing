import {
  MenuImportRequestSchema,
  SaveAddonGroupRequestSchema,
  SaveCategoryRequestSchema,
  SaveKitchenStationRequestSchema,
  SaveMenuItemRequestSchema,
  SetAvailabilityRequestSchema,
  UpdateAddonGroupRequestSchema,
  UpdateCategoryRequestSchema,
  UpdateKitchenStationRequestSchema,
  UpdateMenuItemRequestSchema,
  type AddonGroupsResponse,
  type CategoriesResponse,
  type KitchenStationsResponse,
  type MenuImportResponse,
  type MenuItemsResponse,
  type MenuSnapshot,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const MANAGE = { permission: 'menu.manage' } as const;
const TOGGLE = { permission: ['menu.toggle_availability', 'menu.manage'] } as const;
const ItemsQuery = z.object({ includeInactive: z.enum(['true', 'false']).default('false') });

/** WP 3.1: the menu (docs/05 §2 Menu). */
export async function catalogRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { catalogService: catalog, menuImporter } = cradle;
  const branchOf = (r: { principal?: { branchId: string } }) => r.principal!.branchId;

  // ---- snapshot for ordering devices ---------------------------------------
  app.get('/menu', async (request, reply): Promise<MenuSnapshot | undefined> => {
    const branchId = branchOf(request);
    const version = catalog.menuVersion(branchId);
    const etag = `"${version}"`;
    reply.header('etag', etag).header('cache-control', 'no-cache');
    if (request.headers['if-none-match'] === etag) {
      reply.status(304).send();
      return undefined;
    }
    return {
      version,
      categories: catalog.categories().filter((c) => c.isActive),
      items: catalog.items(branchId, false),
      addonGroups: catalog.addonGroups().filter((g) => g.isActive),
      kitchenStations: catalog.stations(branchId).filter((s) => s.isActive),
    };
  });

  // ---- kitchen stations ------------------------------------------------------
  app.get(
    '/kitchen-stations',
    { config: MANAGE },
    async (request): Promise<KitchenStationsResponse> => ({
      data: catalog.stations(branchOf(request)),
    }),
  );
  app.post('/kitchen-stations', { config: MANAGE }, async (request, reply) => {
    const body = SaveKitchenStationRequestSchema.parse(request.body);
    reply.status(201);
    return catalog.createStation(body, commandContext(request));
  });
  app.patch('/kitchen-stations/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return catalog.updateStation(
      id,
      UpdateKitchenStationRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  // ---- categories --------------------------------------------------------------
  app.get('/categories', { config: MANAGE }, async (): Promise<CategoriesResponse> => ({
    data: catalog.categories(),
  }));
  app.post('/categories', { config: MANAGE }, async (request, reply) => {
    const body = SaveCategoryRequestSchema.parse(request.body);
    reply.status(201);
    return catalog.createCategory(body, commandContext(request));
  });
  app.patch('/categories/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return catalog.updateCategory(
      id,
      UpdateCategoryRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  // ---- add-on groups -------------------------------------------------------------
  app.get('/addon-groups', { config: MANAGE }, async (): Promise<AddonGroupsResponse> => ({
    data: catalog.addonGroups(),
  }));
  app.post('/addon-groups', { config: MANAGE }, async (request, reply) => {
    const body = SaveAddonGroupRequestSchema.parse(request.body);
    reply.status(201);
    return catalog.createAddonGroup(body, commandContext(request));
  });
  app.patch('/addon-groups/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return catalog.updateAddonGroup(
      id,
      UpdateAddonGroupRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  // ---- menu items -------------------------------------------------------------------
  app.get('/menu-items', { config: TOGGLE }, async (request): Promise<MenuItemsResponse> => {
    const { includeInactive } = ItemsQuery.parse(request.query);
    return { data: catalog.items(branchOf(request), includeInactive === 'true') };
  });
  app.post('/menu-items', { config: MANAGE }, async (request, reply) => {
    const body = SaveMenuItemRequestSchema.parse(request.body);
    reply.status(201);
    return catalog.createItem(body, commandContext(request));
  });
  app.patch('/menu-items/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return catalog.updateItem(
      id,
      UpdateMenuItemRequestSchema.parse(request.body),
      commandContext(request),
    );
  });
  // "86" an item in this branch, or bring it back.
  app.post('/menu-items/:id/availability', { config: TOGGLE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { isAvailable } = SetAvailabilityRequestSchema.parse(request.body);
    return catalog.setAvailability(id, isAvailable, commandContext(request));
  });

  // ---- CSV import ---------------------------------------------------------------------
  app.post(
    '/menu/import',
    { config: MANAGE, bodyLimit: 4 * 1024 * 1024 },
    async (request): Promise<MenuImportResponse> => {
      const { csv, dryRun } = MenuImportRequestSchema.parse(request.body);
      return menuImporter.run(csv, dryRun, commandContext(request));
    },
  );
}
