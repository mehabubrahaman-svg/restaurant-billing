import {
  SetupRequestSchema,
  type SetupResponse,
  type SetupStatusResponse,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../container';
import { clientInfo } from '../context';
import { HttpProblem } from '../problem';
import type { SetupCode } from '../../setup-code';

export async function setupRoutes(
  app: FastifyInstance,
  { cradle, setupCode }: { cradle: Cradle; setupCode: SetupCode },
) {
  const { setupService } = cradle;

  app.get(
    '/setup/status',
    { config: { public: true } },
    async (): Promise<SetupStatusResponse> => ({
      needsSetup: setupService.needsSetup(),
      states: setupService.needsSetup()
        ? setupService.availableStates().map((s) => ({ ...s, localLocales: [...s.localLocales] }))
        : [],
    }),
  );

  app.post(
    '/setup',
    { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply): Promise<SetupResponse> => {
      if (!setupService.needsSetup())
        throw new HttpProblem('SETUP_ALREADY_DONE', 'this Hub is already set up');
      const body = SetupRequestSchema.parse(request.body);
      if (!setupCode.check(body.setupCode)) {
        throw new HttpProblem(
          'INVALID_SETUP_CODE',
          'the setup code does not match the one shown on the Hub',
        );
      }
      const result = await setupService.run(body, clientInfo(request));
      setupCode.consume();
      reply.status(201);
      return result;
    },
  );
}
