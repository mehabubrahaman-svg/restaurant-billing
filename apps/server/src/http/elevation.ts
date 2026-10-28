import type { AuthService } from '@restroos/application';
import { APPROVER_HEADER } from '@restroos/contracts';
import type { FastifyRequest } from 'fastify';

/**
 * For commands whose required permission depends on the data (cancelling an
 * item is routine until the kitchen has it). True when the caller holds
 * `permission`, or sent a manager's X-Approver-Token for it, in which case the
 * manager is recorded as the approver. The service then decides whether it
 * was needed and answers APPROVAL_REQUIRED if so.
 */
export async function mayElevate(
  request: FastifyRequest,
  auth: AuthService,
  permission: string,
): Promise<boolean> {
  const principal = request.principal!;
  if (principal.permissions.has(permission)) return true;
  const token = request.headers[APPROVER_HEADER];
  if (typeof token !== 'string') return false;
  const approverId = await auth.consumeApproval(token, permission, principal.branchId);
  if (!approverId) return false;
  request.approverId = approverId;
  return true;
}
