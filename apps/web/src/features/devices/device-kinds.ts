import type { DeviceKind } from '@restroos/contracts';

/** Kinds an admin can pair (the Hub PC itself is never paired). */
export const PAIRABLE_KINDS: readonly DeviceKind[] = [
  'POS',
  'CAPTAIN',
  'KDS',
  'OWNER',
  'TOKEN_DISPLAY',
  'KIOSK',
];
