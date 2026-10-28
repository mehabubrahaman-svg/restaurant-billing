import type { FoodType } from '../../api/endpoints';

/** Order-pad commands that may wait in the offline queue (docs/07 §7.3). */
export type CommandKind = 'addItems' | 'updateItem' | 'cancelItem' | 'fire';

/** How a queued "add items" line looks on the pad until the Hub has it. */
export interface QueuedLinePreview {
  readonly name: string;
  readonly variantName: string | null;
  readonly foodType: FoodType;
  readonly quantity: number;
  /** (unit + add-ons) × quantity, paise. */
  readonly lineTotal: number;
  readonly addons: readonly string[];
  readonly specialNote: string | null;
}

/**
 * - `queued`: waiting for the Hub.
 * - `sending`: being replayed right now.
 * - `failed`: the Hub refused it (4xx); needs a person to look at it.
 */
export type CommandStatus = 'queued' | 'sending' | 'failed';

export interface QueuedCommand {
  /** Also the Idempotency-Key, so a replay after a lost response is answered from the Hub's store. */
  readonly id: string;
  readonly kind: CommandKind;
  readonly orderId: string;
  readonly method: 'POST' | 'PATCH';
  /** Under /api/v1. */
  readonly path: string;
  readonly body?: unknown;
  /** Who queued it; it is only replayed while that person is signed in. */
  readonly userId: string | null;
  readonly createdAt: number;
  readonly status: CommandStatus;
  readonly attempts: number;
  readonly error: { readonly code: string; readonly status: number } | null;
  /** For `addItems`: what to show on the pad meanwhile. */
  readonly lines?: readonly QueuedLinePreview[];
  /** For `updateItem` / `cancelItem`: the order line it changes. */
  readonly itemId?: string;
}
