import type { Session } from '@restroos/application';
import {
  ApproveRequestSchema,
  ChangeOwnPasswordRequestSchema,
  LoginRequestSchema,
  PinLoginRequestSchema,
  RefreshRequestSchema,
  type ApproveResponse,
  type MeResponse,
  type PinUsersResponse,
  type SessionResponse,
} from '@restroos/contracts';
import type { User } from '@restroos/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Cradle } from '../../container';
import { clientInfo } from '../context';
import { HttpProblem } from '../problem';

export const REFRESH_COOKIE = 'restro_rt';
const COOKIE_PATH = '/api/v1/auth';
/** Brute-force guard on top of account lockout: per client IP. */
const SIGN_IN_LIMIT = { rateLimit: { max: 20, timeWindow: '1 minute' } };
const PIN_ONLY_ON_PAIRED = { pairedDeviceOnly: true };

export async function authRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { authService: auth, identityQueries, config } = cradle;

  const setCookie = (reply: FastifyReply, session: Session) =>
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      // Over HTTPS always; over plain HTTP (first contact, before the device trusts the Hub CA) only if allowed.
      secure: config.secureCookies || reply.request.protocol === 'https',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
  const clearCookie = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  const cookieOf = (request: FastifyRequest) => request.cookies[REFRESH_COOKIE];

  app.post(
    '/auth/login',
    { config: { public: true, ...SIGN_IN_LIMIT } },
    async (request, reply) => {
      const body = LoginRequestSchema.parse(request.body);
      const session = await auth.loginWithPassword(body, clientInfo(request));
      setCookie(reply, session);
      return toSessionResponse(session);
    },
  );

  app.post(
    '/auth/pin-login',
    { config: { public: true, ...SIGN_IN_LIMIT, ...PIN_ONLY_ON_PAIRED } },
    async (request, reply) => {
      const body = PinLoginRequestSchema.parse(request.body);
      const session = await auth.loginWithPin(body, clientInfo(request));
      setCookie(reply, session);
      return toSessionResponse(session);
    },
  );

  app.get(
    '/auth/pin-users',
    { config: { public: true, ...PIN_ONLY_ON_PAIRED } },
    async (): Promise<PinUsersResponse> => ({
      data: identityQueries.pinUsers().map((u) => ({ ...u, initials: initials(u.fullName) })),
    }),
  );

  app.post('/auth/refresh', { config: { public: true } }, async (request, reply) => {
    const token = cookieOf(request);
    if (!token) throw new HttpProblem('UNAUTHENTICATED', 'no session');
    const body = RefreshRequestSchema.parse(request.body ?? {});
    try {
      const session = await auth.refresh(token, body.branchId, clientInfo(request));
      setCookie(reply, session);
      return toSessionResponse(session);
    } catch (error) {
      clearCookie(reply);
      throw error;
    }
  });

  app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
    const token = cookieOf(request);
    if (token) auth.logout(token, clientInfo(request));
    clearCookie(reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (request): Promise<MeResponse> => {
    const principal = request.principal!;
    const user = cradle.users.findById(principal.userId)!;
    const branches = identityQueries.branchesForUser(user.id);
    return {
      user: toSessionUser(user),
      branch: branches.find((b) => b.id === principal.branchId)!,
      branches,
      roles: [...principal.roles],
      permissions: [...principal.permissions].sort(),
    };
  });

  app.post('/auth/change-password', async (request, reply) => {
    const body = ChangeOwnPasswordRequestSchema.parse(request.body);
    await auth.changeOwnPassword(
      request.principal!,
      body.currentPassword,
      body.newPassword,
      clientInfo(request),
    );
    return reply.status(204).send();
  });

  app.post(
    '/auth/approve',
    { config: { ...SIGN_IN_LIMIT, ...PIN_ONLY_ON_PAIRED } },
    async (request): Promise<ApproveResponse> => {
      const body = ApproveRequestSchema.parse(request.body);
      const result = await auth.approve(body, request.principal!, clientInfo(request));
      return {
        approverToken: result.token,
        expiresAt: result.expiresAt.toISOString(),
        approver: { id: result.approver.id, fullName: result.approver.state.fullName },
      };
    },
  );
}

function toSessionUser(user: User) {
  const s = user.state;
  return {
    id: user.id,
    username: s.username,
    fullName: s.fullName,
    preferredLocale: (s.preferredLocale as 'en-IN' | 'hi-IN' | 'bn-IN' | null) ?? null,
    hasPin: s.pinHash !== null,
  };
}

function toSessionResponse(session: Session): SessionResponse {
  return {
    accessToken: session.accessToken,
    expiresAt: session.expiresAt.toISOString(),
    user: toSessionUser(session.user),
    branch: session.branch,
    branches: session.branches,
    roles: [...session.roles],
    permissions: [...session.permissions],
  };
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = [...(parts[0] ?? '?')][0] ?? '?';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}
