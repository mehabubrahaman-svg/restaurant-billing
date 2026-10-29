import type { RelayMessageRecord } from '@restroos/application';
import {
  SaveRelayLinkRequestSchema,
  type RelayMessage,
  type RelayOverview,
} from '@restroos/contracts';
import { DomainError } from '@restroos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { startRelayFeeds } from '../../relay/relay-feeds';
import { commandContext } from '../context';

const MANAGE = { permission: 'settings.manage' } as const;
const IdParams = z.object({ id: z.string().min(8).max(64) });

const messageView = ({
  payload: _payload,
  branchId: _branchId,
  ...m
}: RelayMessageRecord): RelayMessage => m;

/** Admin → Online orders: the link to the cloud relay, its status and its messages. */
export async function integrationRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { relayIntegrationService: service, relayClient: client } = cradle;
  // The feeds and the connection last as long as the app.
  const stopFeeds = startRelayFeeds(cradle);
  client.restart();
  app.addHook('onClose', async () => {
    stopFeeds();
    client.stop();
  });

  const overview = (request: FastifyRequest): RelayOverview => {
    const { link, counts, recent } = service.overview(request.principal!.branchId);
    return {
      link: link && {
        relayUrl: link.relayUrl,
        hubId: link.hubId,
        keySet: link.hubKey.length > 0,
        isEnabled: link.isEnabled,
        version: link.version,
      },
      status: client.current(),
      counts,
      recent: recent.map(messageView),
    };
  };

  app.get('/integrations/relay', { config: MANAGE }, async (request) => overview(request));

  app.put('/integrations/relay', { config: MANAGE }, async (request) => {
    service.saveLink(SaveRelayLinkRequestSchema.parse(request.body), commandContext(request));
    client.restart();
    return overview(request);
  });

  /** Sends the whole menu now (it also goes by itself a few seconds after any change). */
  app.post('/integrations/relay/menu', { config: MANAGE }, async (request, reply) => {
    const branchId = request.principal!.branchId;
    if (!service.queue(branchId, 'menu', service.menu(branchId)))
      throw new DomainError('VALIDATION_FAILED', 'turn online orders on first');
    client.flush();
    reply.status(202);
    return { queued: true };
  });

  /** An online order the Hub could not enter, tried again once staff fixed the cause. */
  app.post('/integrations/relay/messages/:id/retry', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const result = service.retry(id, request.principal!.branchId);
    client.flush();
    return result;
  });
}
