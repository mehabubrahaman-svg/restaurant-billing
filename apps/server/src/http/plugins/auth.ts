import type { AuthService, Principal } from '@restroos/application';
import { APPROVER_HEADER } from '@restroos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpProblem } from '../problem';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** No sign-in needed (health, login, setup). Everything else requires a valid access token. */
    public?: boolean;
    /** The caller needs at least one of these permissions in their current branch. */
    permission?: string | readonly string[];
    /** A manager may authorise the request with X-Approver-Token when the caller lacks the permission. */
    approvable?: boolean;
  }
  interface FastifyRequest {
    principal?: Principal;
    approverId?: string | null;
  }
}

/**
 * Secure by default: every route under the API prefix needs a signed-in user
 * unless it is explicitly marked `config: { public: true }`. Permissions are
 * checked against the database on every request, so a role change or a
 * deactivation takes effect immediately, not when the token expires.
 */
export const authPlugin = fp<{ auth: AuthService }>(
  async (app: FastifyInstance, { auth }) => {
    app.addHook('onRequest', async (request) => {
      const config = request.routeOptions.config;
      if (!request.routeOptions.url) return; // unknown route: let the 404 handler answer
      if (config.public) return;

      const principal = await authenticate(auth, request);
      if (!principal) throw new HttpProblem('UNAUTHENTICATED', 'sign in to continue');
      request.principal = principal;
      request.approverId = null;

      const required = config.permission === undefined ? [] : [config.permission].flat();
      if (required.length === 0 || required.some((p) => principal.permissions.has(p))) return;

      const permission = required[0]!;
      if (config.approvable) {
        const token = request.headers[APPROVER_HEADER];
        if (typeof token === 'string') {
          const approverId = await auth.consumeApproval(token, permission, principal.branchId);
          if (approverId) {
            request.approverId = approverId;
            return;
          }
        }
        throw new HttpProblem(
          'APPROVAL_REQUIRED',
          `a manager must approve this (${permission})`,
          undefined,
          permission,
        );
      }
      throw new HttpProblem(
        'FORBIDDEN',
        `you need the ${permission} permission`,
        undefined,
        permission,
      );
    });
  },
  { name: 'auth' },
);

async function authenticate(auth: AuthService, request: FastifyRequest): Promise<Principal | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return auth.authenticate(header.slice('Bearer '.length).trim());
}
