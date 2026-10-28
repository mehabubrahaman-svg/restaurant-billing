import type { KotSummary, MenuSnapshot, Order, OrderItem } from '@restroos/contracts';
import type { QueuedCommand, QueuedLinePreview } from '../offline/command-types';
import { localizedName, translationKey } from '../menu/localized-name';
import type { DraftLine } from './pad-store';

/**
 * One line in the NEW (not sent) part of the pad:
 * - `pending`: the Hub has it (PENDING); −/+ and notes edit it there.
 * - `draft`: tapped moments ago, being saved.
 * - `queued`: waiting in the offline queue.
 * - `failed`: the Hub refused the queued request; needs attention.
 */
export type NewLine =
  | {
      readonly kind: 'pending';
      readonly key: string;
      readonly item: OrderItem;
      readonly quantity: number;
      readonly lineTotal: number;
      /** A change to it waits in the offline queue. */
      readonly queuedChange: boolean;
    }
  | { readonly kind: 'draft'; readonly key: string; readonly draft: DraftLine }
  | {
      readonly kind: 'queued' | 'failed';
      readonly key: string;
      readonly command: QueuedCommand;
      readonly preview: QueuedLinePreview;
    };

export interface QtyEditLike {
  readonly quantity: number;
}

const unitOf = (item: OrderItem) => item.unitPrice + item.addonsTotal;

/** NEW lines in pad order: the Hub's pending lines, then queued, then fresh drafts. */
export function newLines(
  order: Order,
  drafts: readonly DraftLine[],
  qtyEdits: Readonly<Record<string, QtyEditLike>>,
  commands: readonly QueuedCommand[],
): NewLine[] {
  const mine = commands.filter((c) => c.orderId === order.id);
  const changing = new Set(mine.map((c) => c.itemId).filter((id) => id !== undefined));
  const lines: NewLine[] = order.items
    .filter((i) => i.status === 'PENDING')
    .map((item) => {
      const quantity = qtyEdits[item.id]?.quantity ?? item.quantity;
      return {
        kind: 'pending' as const,
        key: item.id,
        item,
        quantity,
        lineTotal: unitOf(item) * quantity,
        queuedChange: changing.has(item.id),
      };
    });
  for (const command of mine) {
    if (command.kind !== 'addItems') continue;
    (command.lines ?? []).forEach((preview, i) => {
      lines.push({
        kind: command.status === 'failed' ? 'failed' : 'queued',
        key: `${command.id}-${i}`,
        command,
        preview,
      });
    });
  }
  for (const draft of drafts) lines.push({ kind: 'draft', key: draft.key, draft });
  return lines;
}

/** Subtotal and units still to send, counting what the Hub doesn't have yet. */
export function padTotals(lines: readonly NewLine[], order: Order) {
  let subtotal = order.items
    .filter((i) => i.status !== 'CANCELLED' && i.status !== 'PENDING')
    .reduce((sum, i) => sum + i.lineTotal, 0);
  let pendingUnits = 0;
  for (const line of lines) {
    if (line.kind === 'pending') {
      subtotal += line.lineTotal;
      pendingUnits += line.quantity;
    } else if (line.kind === 'draft') {
      subtotal += line.draft.unitTotal * line.draft.request.quantity;
      pendingUnits += line.draft.request.quantity;
    } else if (line.kind === 'queued') {
      subtotal += line.preview.lineTotal;
      pendingUnits += line.preview.quantity;
    }
  }
  return { subtotal, pendingUnits };
}

/** Sent lines grouped under their KOT, newest KOT last (as fired). */
export function kotGroups(order: Order): { kot: KotSummary; items: OrderItem[] }[] {
  return [...order.kots]
    .sort((a, b) => a.kotNo - b.kotNo)
    .map((kot) => ({ kot, items: order.items.filter((i) => i.kotId === kot.id) }))
    .filter((g) => g.items.length > 0);
}

/** Names on order lines are copied in English; show the menu's translation when it has one. */
export function lineNames(
  item: Pick<OrderItem, 'menuItemId' | 'variantId' | 'name' | 'variantName'> & {
    readonly addons: readonly { addonId: string; name: string }[];
  },
  menu: MenuSnapshot | undefined,
  language: string,
): { name: string; variantName: string | null; addons: string[] } {
  const fallback = {
    name: item.name,
    variantName: item.variantName,
    addons: item.addons.map((a) => a.name),
  };
  if (menu === undefined || translationKey(language) === null) return fallback;
  const menuItem = menu.items.find((m) => m.id === item.menuItemId);
  const variant = menuItem?.variants.find((v) => v.id === item.variantId);
  const addons = menu.addonGroups.flatMap((g) => g.addons);
  return {
    name:
      menuItem === undefined
        ? item.name
        : localizedName(item.name, menuItem.nameTranslations, language),
    variantName:
      variant === undefined
        ? item.variantName
        : localizedName(item.variantName ?? variant.name, variant.nameTranslations, language),
    addons: item.addons.map((a) => {
      const found = addons.find((x) => x.id === a.addonId);
      return found === undefined ? a.name : localizedName(a.name, found.nameTranslations, language);
    }),
  };
}
