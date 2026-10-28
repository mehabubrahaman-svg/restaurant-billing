import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
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
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { deviceRoutes } from './routes/devices';
import { floorRoutes } from './routes/floor';
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
