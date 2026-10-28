import { create } from 'zustand';

interface ShiftPromptState {
  /** Resolves true once a shift is open, false if the cashier closed the prompt. */
  readonly pending: ((opened: boolean) => void) | null;
}

export const useShiftPrompt = create<ShiftPromptState>()(() => ({ pending: null }));

/**
 * Asks the cashier to open a cash shift (cash needs one on this device).
 * The POS layout shows the dialog; a second request replaces the first.
 */
export function requestOpenShift(): Promise<boolean> {
  useShiftPrompt.getState().pending?.(false);
  return new Promise((resolve) => {
    useShiftPrompt.setState({
      pending: (opened) => {
        useShiftPrompt.setState({ pending: null });
        resolve(opened);
      },
    });
  });
}
