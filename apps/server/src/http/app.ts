import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  ACCOUNTING_EVENT_TYPES,
  INVENTORY_EVENT_TYPES,
  STOCK_MOVING_EVENT_TYPES,
} from '@restroos/application';
import { API_PREFIX } from '@restroos/contracts';
import type { AwilixContainer } from 'awilix';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Cradle } from '../container';
import type { SetupCode } from '../setup-code';
import { authPlugin } from './plugins/auth';
import { devicePlugin } from './plugins/device';
import { idempotencyPlugin } from './plugins/idempotency';
import { errorHandler, problem, sendProblem } from './problem';
import { accountingRoutes } from './routes/accounting';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { billingRoutes } from './routes/billing';
import { catalogRoutes } from './routes/catalog';
import { customerRoutes } from './routes/customers';
import { deviceRoutes } from './routes/devices';
import { floorRoutes } from './routes/floor';
import { inventoryRoutes } from './routes/inventory';
import { kitchenRoutes } from './routes/kitchen';
import { orderRoutes } from './routes/orders';
import { printingRoutes } from './routes/printing';
import { purchasingRoutes } from './routes/purchasing';
import { reportRoutes } from './routes/reports';
import { healthRoutes } from './routes/health';
import { settingsRoutes } from './routes/settings';
import { setupRoutes } from './routes/setup';
import { userRoutes } from './routes/users';

export interface BuildAppOptions {
  readonly setupCode: SetupCode;
  /** Extra API routes, registered under the API prefix. Used by tests. */
  readonly registerApiRoutes?: (api: FastifyInstance) => void | Promise<void>;
}

export async function buildApp(
  container: AwilixContainer<Cradle>,
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const { config, logger, ids, idempotencyStore } = container.cradle;
  // Typed as Fastify's logger interface so the instance stays a plain FastifyInstance.
  const loggerInstance: FastifyBaseLogger = logger;
  const app = Fastify({
    loggerInstance,
    genReqId: () => ids.next(),
    requestIdHeader: 'x-request-id',
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  app.setErrorHandler(errorHandler);
  // Command endpoints without a body (POST /orders/{id}/kots) are often called with a JSON
  // content type anyway; treat an empty body as no body instead of rejecting it.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text) as unknown);
    } catch {
      done(
        Object.assign(new Error('the request body is not valid JSON'), { statusCode: 400 }),
        undefined,
      );
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
  });

  // Fired dishes take their ingredients from stock once the KOT has committed,
  // then bills, payments, purchases and the stock that moved are journaled.
  // Catching up at start covers anything committed while the Hub was down.
  const { inventoryProjector, accountingProjector, eventBus } = container.cradle;
  const accountingTypes = new Set<string>([...ACCOUNTING_EVENT_TYPES, ...STOCK_MOVING_EVENT_TYPES]);
  const stopProjecting = [
    ...INVENTORY_EVENT_TYPES.map((type) =>
      eventBus.subscribe(type, () => void inventoryProjector.catchUp()),
    ),
    // Subscribed second, so it runs after the inventory projector for the same event.
    ...[...accountingTypes].map((type) =>
      eventBus.subscribe(type, () => void accountingProjector.catchUp()),
    ),
  ];
  inventoryProjector.catchUp();
  accountingProjector.catchUp();
  app.addHook('onClose', async () => stopProjecting.forEach((stop) => stop()));

  await app.register(
    async (api) => {
      const { cradle } = container;
      await api.register(devicePlugin, { devices: cradle.deviceService });
      await api.register(authPlugin, { auth: cradle.authService });
      await api.register(idempotencyPlugin, { store: idempotencyStore });
      await api.register(healthRoutes, { cradle });
      await api.register(setupRoutes, { cradle, setupCode: options.setupCode });
      await api.register(authRoutes, { cradle });
      await api.register(userRoutes, { cradle });
      await api.register(settingsRoutes, { cradle });
      await api.register(auditRoutes, { cradle });
      await api.register(catalogRoutes, { cradle });
      await api.register(floorRoutes, { cradle });
      await api.register(deviceRoutes, { cradle });
      await api.register(orderRoutes, { cradle });
      await api.register(kitchenRoutes, { cradle });
      await api.register(billingRoutes, { cradle });
      await api.register(printingRoutes, { cradle });
      await api.register(customerRoutes, { cradle });
      await api.register(reportRoutes, { cradle });
      await api.register(backupRoutes, { cradle });
      await api.register(inventoryRoutes, { cradle });
      await api.register(purchasingRoutes, { cradle });
      await api.register(accountingRoutes, { cradle });
      await options.registerApiRoutes?.(api);
      api.setNotFoundHandler((request, reply) =>
        sendProblem(
          reply,
          problem(request, 404, 'NOT_FOUND', `no route for ${request.method} ${request.url}`),
        ),
      );
    },
    { prefix: API_PREFIX },
  );

  // The Hub serves the web app itself, so every device just opens https://<hub>:7400.
  if (config.webDist && existsSync(join(config.webDist, 'index.html'))) {
    // wildcard: files are looked up per request, so a rebuilt web app is served without a restart.
    await app.register(fastifyStatic, { root: config.webDist, wildcard: true });
    app.setNotFoundHandler((request, reply) => {
      // A missing hashed asset must be a 404, not index.html, or the browser runs HTML as a script.
      const wantsPage =
        request.method === 'GET' &&
        !request.url.startsWith('/api/') &&
        !request.url.startsWith('/assets/');
      if (wantsPage) return reply.sendFile('index.html'); // client-side routing
      return sendProblem(
        reply,
        problem(request, 404, 'NOT_FOUND', `no route for ${request.method} ${request.url}`),
      );
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      sendProblem(
        reply,
        problem(request, 404, 'NOT_FOUND', `no route for ${request.method} ${request.url}`),
      ),
    );
  }

  return app;
}
