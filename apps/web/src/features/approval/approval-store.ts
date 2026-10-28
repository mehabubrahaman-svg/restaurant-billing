import type { ApproveResponse } from '@restroos/contracts';
import { create } from 'zustand';

interface PendingApproval {
  readonly permission: string;
  readonly resolve: (approval: ApproveResponse | null) => void;
}

interface ApprovalState {
  readonly pending: PendingApproval | null;
}

export const useApprovalStore = create<ApprovalState>()(() => ({ pending: null }));

/**
 * Opens the approval dialog and resolves with the manager's approval, or
 * `null` if cancelled. A second request while one is open cancels the first.
 */
export function requestApproval(permission: string): Promise<ApproveResponse | null> {
  useApprovalStore.getState().pending?.resolve(null);
  return new Promise((resolve) => {
    useApprovalStore.setState({
      pending: {
        permission,
        resolve: (approval) => {
          useApprovalStore.setState({ pending: null });
          resolve(approval);
        },
      },
    });
  });
}
