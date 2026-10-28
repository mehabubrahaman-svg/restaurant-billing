import type { ClientInfo, CommandContext } from '@restroos/application';
import type { FastifyRequest } from 'fastify';
import { HttpProblem } from './problem';

export function clientInfo(request: FastifyRequest): ClientInfo {
  const device = request.headers['x-device-id'];
  return {
    deviceId: typeof device === 'string' && device.length <= 64 ? device : null,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 256) ?? null,
    correlationId: request.id,
  };
}

/** Who is acting, for commands. Only for authenticated routes. */
export function commandContext(request: FastifyRequest): CommandContext {
  const principal = request.principal;
  if (!principal) throw new HttpProblem('UNAUTHENTICATED', 'sign in to continue');
  const client = clientInfo(request);
  return {
    branchId: principal.branchId,
    actorId: principal.userId,
    approverId: request.approverId ?? null,
    deviceId: client.deviceId,
    ipAddress: client.ipAddress,
    correlationId: client.correlationId,
  };
}
