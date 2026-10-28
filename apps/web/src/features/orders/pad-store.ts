import type { NewOrderItem } from '@restroos/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { runCommand, type CommandOutcome } from '../offline/command-queue';
import type { QueuedLinePreview } from '../offline/command-types';
import { setOrder } from './order-queries';

/** Taps are gathered for this long, then sent as one request (so a lost tablet loses little). */
export const FLUSH_DELAY_MS = 600;

/** A line tapped on the pad that the Hub doesn't have yet. */
export interface DraftLine {
  readonly key: string;
  readonly request: NewOrderItem & { quantity: number };
  /** Price of one unit with its add-ons, paise. */
  readonly unitTotal: number;
  readonly preview: Omit<QueuedLinePreview, 'quantity' | 'lineTotal'>;
}

interface QtyEdit {
  readonly orderId: string;
  readonly quantity: number;
  readonly version: number;
}

interface PadState {
  readonly drafts: Readonly<Record<string, readonly DraftLine[]>>;
  /** Quantity changes to PENDING lines the Hub has, by item id. */
  readonly qtyEdits: Readonly<Record<string, QtyEdit>>;
  /** The last refusal while saving taps, per order (e.g. ITEM_UNAVAILABLE). */
  readonly errors: Readonly<Record<string, unknown>>;
  readonly saving: Readonly<Record<string, boolean>>;
}

export const usePadStore = create<PadState>()(() => ({
  drafts: {},
  qtyEdits: {},
  errors: {},
  saving: {},
}));

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Map<string, Promise<void>>();
let keySeq = 0;

export function previewOf(line: DraftLine): QueuedLinePreview {
  return {
    ...line.preview,
    quantity: line.request.quantity,
    lineTotal: line.unitTotal * line.request.quantity,
  };
}

/** Same dish, same choices, no note: a second tap just adds one more. */
function sameChoice(a: DraftLine['request'], b: DraftLine['request']): boolean {
  return (
    a.menuItemId === b.menuItemId &&
    (a.variantId ?? null) === (b.variantId ?? null) &&
    JSON.stringify(a.addons ?? []) === JSON.stringify(b.addons ?? []) &&
    (a.specialNote ?? '') === (b.specialNote ?? '')
  );
}

function setDrafts(orderId: string, update: (lines: readonly DraftLine[]) => DraftLine[]): void {
  usePadStore.setState((s) => {
    const next = update(s.drafts[orderId] ?? []);
    const drafts = { ...s.drafts };
    if (next.length === 0) delete drafts[orderId];
    else drafts[orderId] = next;
    return { drafts };
  });
}

function schedule(client: QueryClient, orderId: string): void {
  const existing = timers.get(orderId);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    orderId,
    setTimeout(() => {
      timers.delete(orderId);
      void flushPad(client, orderId);
    }, FLUSH_DELAY_MS),
  );
}

/** Adds a line (or one more of an identical untouched line) and schedules a save. */
export function addDraft(client: QueryClient, orderId: string, line: Omit<DraftLine, 'key'>): void {
  setDrafts(orderId, (lines) => {
    const same = lines.find((l) => sameChoice(l.request, line.request));
    if (same !== undefined) {
      return lines.map((l) =>
        l === same
          ? {
              ...l,
              request: {
                ...l.request,
                quantity: Math.min(99, l.request.quantity + line.request.quantity),
              },
            }
          : l,
      );
    }
    keySeq += 1;
    return [...lines, { ...line, key: `draft-${keySeq}` }];
  });
  usePadStore.setState((s) => {
    const errors = { ...s.errors };
    delete errors[orderId];
    return { errors };
  });
  schedule(client, orderId);
}

/** −/+ on a line not saved yet; 0 removes it. */
export function setDraftQuantity(
  client: QueryClient,
  orderId: string,
  key: string,
  quantity: number,
): void {
  setDrafts(orderId, (lines) =>
    quantity <= 0
      ? lines.filter((l) => l.key !== key)
      : lines.map((l) =>
          l.key === key ? { ...l, request: { ...l.request, quantity: Math.min(99, quantity) } } : l,
        ),
  );
  schedule(client, orderId);
}

export function setDraftNote(
  client: QueryClient,
  orderId: string,
  key: string,
  note: string,
): void {
  const trimmed = note.trim();
  setDrafts(orderId, (lines) =>
    lines.map((l) => {
      if (l.key !== key) return l;
      const { specialNote: _old, ...rest } = l.request;
      return {
        ...l,
        request: trimmed === '' ? rest : { ...rest, specialNote: trimmed },
        preview: { ...l.preview, specialNote: trimmed === '' ? null : trimmed },
      };
    }),
  );
  schedule(client, orderId);
}

/** −/+ on a PENDING line the Hub has: sent as a PATCH after the taps settle. */
export function editQuantity(
  client: QueryClient,
  orderId: string,
  itemId: string,
  quantity: number,
  version: number,
): void {
  usePadStore.setState((s) => ({
    qtyEdits: {
      ...s.qtyEdits,
      [itemId]: { orderId, quantity: Math.max(1, Math.min(99, quantity)), version },
    },
  }));
  schedule(client, orderId);
}

/** Drops a pending quantity change (the line is being removed instead). */
export function forgetQuantity(itemId: string): void {
  usePadStore.setState((s) => {
    const qtyEdits = { ...s.qtyEdits };
    delete qtyEdits[itemId];
    return { qtyEdits };
  });
}

function done(client: QueryClient, outcome: CommandOutcome): void {
  if (outcome.status === 'done') setOrder(client, outcome.order);
}

/**
 * Saves the pad now: pending quantity changes, then new lines in one
 * request. Lines the Hub refuses stay on the pad with the error shown.
 */
export function flushPad(client: QueryClient, orderId: string): Promise<void> {
  const timer = timers.get(orderId);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(orderId);
  }
  const previous = inflight.get(orderId) ?? Promise.resolve();
  const run = previous.then(async () => {
    const state = usePadStore.getState();
    const edits = Object.entries(state.qtyEdits).filter(([, e]) => e.orderId === orderId);
    const drafts = state.drafts[orderId] ?? [];
    if (edits.length === 0 && drafts.length === 0) return;
    usePadStore.setState((s) => ({ saving: { ...s.saving, [orderId]: true } }));
    try {
      for (const [itemId, edit] of edits) {
        forgetQuantity(itemId);
        done(
          client,
          await runCommand({
            kind: 'updateItem',
            orderId,
            itemId,
            method: 'PATCH',
            path: `/orders/${orderId}/items/${itemId}`,
            body: { version: edit.version, quantity: edit.quantity },
          }),
        );
      }
      if (drafts.length > 0) {
        const outcome = await runCommand({
          kind: 'addItems',
          orderId,
          method: 'POST',
          path: `/orders/${orderId}/items`,
          body: { items: drafts.map((d) => d.request) },
          lines: drafts.map(previewOf),
        });
        // Saved or safely queued: either way they are no longer drafts.
        const sent = new Set(drafts.map((d) => d.key));
        setDrafts(orderId, (lines) => lines.filter((l) => !sent.has(l.key)));
        done(client, outcome);
      }
    } catch (error) {
      usePadStore.setState((s) => ({ errors: { ...s.errors, [orderId]: error } }));
    } finally {
      usePadStore.setState((s) => ({ saving: { ...s.saving, [orderId]: false } }));
    }
  });
  const tracked = run.finally(() => {
    if (inflight.get(orderId) === tracked) inflight.delete(orderId);
  });
  inflight.set(orderId, tracked);
  return tracked;
}

/** Saves the pad, then sends every pending line to the kitchen. */
export async function fireOrder(client: QueryClient, orderId: string): Promise<CommandOutcome> {
  await flushPad(client, orderId);
  const error = usePadStore.getState().errors[orderId];
  if (error !== undefined) throw error;
  const outcome = await runCommand({
    kind: 'fire',
    orderId,
    method: 'POST',
    path: `/orders/${orderId}/kots`,
  });
  done(client, outcome);
  return outcome;
}

/** Units on the pad for this order that the Hub doesn't have yet. */
export function draftUnits(lines: readonly DraftLine[] | undefined): number {
  return (lines ?? []).reduce((n, l) => n + l.request.quantity, 0);
}

/** Tests: forget every draft and timer. */
export function resetPad(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  inflight.clear();
  usePadStore.setState({ drafts: {}, qtyEdits: {}, errors: {}, saving: {} });
}
