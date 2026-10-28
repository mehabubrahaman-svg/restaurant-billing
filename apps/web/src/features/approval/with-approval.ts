import type { ApproveResponse } from '@restroos/contracts';
import { isApiError } from '../../api/client';
import { requestApproval } from './approval-store';

/** The manager closed the approval dialog. */
export class ApprovalCancelledError extends Error {
  constructor() {
    super('Approval cancelled');
    this.name = 'ApprovalCancelledError';
  }
}

/** Extracts the permission from an APPROVAL_REQUIRED problem (body field, else `detail`). */
function permissionOf(error: {
  permission: string | null;
  problem: { detail?: string | undefined } | null;
}) {
  if (error.permission !== null) return error.permission;
  const match = /[a-z_]+\.[a-z_]+/.exec(error.problem?.detail ?? '');
  return match?.[0] ?? null;
}

/**
 * Runs `request`; if the Hub answers 403 APPROVAL_REQUIRED, asks a manager to
 * approve (PIN on this device) and retries exactly once with their one-time
 * token. `request` receives the token on the retry:
 *
 *   await withApproval((token) => api.bills.discount(id, body, token));
 */
export async function withApproval<T>(
  request: (approverToken?: string) => Promise<T>,
  ask: (permission: string) => Promise<ApproveResponse | null> = requestApproval,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!isApiError(error, 'APPROVAL_REQUIRED')) throw error;
    const permission = permissionOf(error);
    if (permission === null) throw error;
    const approval = await ask(permission);
    if (approval === null) throw new ApprovalCancelledError();
    return request(approval.approverToken);
  }
}
