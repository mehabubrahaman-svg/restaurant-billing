import type { QrMenu } from '@restroos/contracts';
import { newIdempotencyKey } from '../../api/client';

type Item = QrMenu['items'][number];
type Group = QrMenu['addonGroups'][number];

/** One line of the guest's order, before it is sent. */
export interface CartLine {
  key: string;
  item: Item;
  variantId: string | undefined;
  addonIds: string[];
  quantity: number;
  note: string;
  /** Paise for one, with the size and add-ons. */
  unit: number;
}

/** The most of one dish a phone can put in an order (the Hub's own limit). */
export const MAX_QUANTITY = 20;

export function groupsOf(item: Item, menu: QrMenu): Group[] {
  return item.addonGroupIds
    .map((id) => menu.addonGroups.find((g) => g.id === id))
    .filter((g): g is Group => g !== undefined);
}

/**
 * Paise for one of a dish with this size and these add-ons, or null when the
 * menu no longer has them (a size taken off, an add-on group changed).
 */
export function unitPrice(
  item: Item,
  variantId: string | undefined,
  addonIds: readonly string[],
  menu: QrMenu,
): number | null {
  let price = item.price;
  if (item.variants.length > 0) {
    const variant = item.variants.find((v) => v.id === variantId);
    if (variant === undefined) return null;
    price = variant.price;
  } else if (variantId !== undefined) {
    return null;
  }
  const addons = groupsOf(item, menu).flatMap((g) => g.addons);
  for (const id of addonIds) {
    const addon = addons.find((a) => a.id === id);
    if (addon === undefined) return null;
    price += addon.price;
  }
  return price;
}

const sameChoice = (a: CartLine, b: Omit<CartLine, 'key' | 'quantity'>) =>
  a.item.id === b.item.id &&
  a.variantId === b.variantId &&
  a.note === b.note &&
  a.addonIds.length === b.addonIds.length &&
  a.addonIds.every((id) => b.addonIds.includes(id));

/** Adds a line, or more of the same dish made the same way. */
export function addLine(cart: readonly CartLine[], line: CartLine): CartLine[] {
  const same = cart.find((l) => sameChoice(l, line));
  if (same === undefined) return [...cart, line];
  return cart.map((l) =>
    l === same ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + line.quantity) } : l,
  );
}

/** One more of a dish that has nothing to choose. */
export function addPlain(cart: readonly CartLine[], item: Item): CartLine[] {
  return addLine(cart, {
    key: newIdempotencyKey(),
    item,
    variantId: undefined,
    addonIds: [],
    quantity: 1,
    note: '',
    unit: item.price,
  });
}

/** How many of each dish are in the order, however they were made. */
export function quantities(cart: readonly CartLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of cart) counts.set(l.item.id, (counts.get(l.item.id) ?? 0) + l.quantity);
  return counts;
}

/**
 * The dish's quantity set from its card: more goes on the plain line, fewer
 * comes off the most recent lines first.
 */
export function setQuantity(cart: readonly CartLine[], item: Item, quantity: number): CartLine[] {
  const current = quantities(cart).get(item.id) ?? 0;
  if (quantity > current) {
    let next = [...cart];
    for (let i = current; i < quantity; i++) next = addPlain(next, item);
    return next;
  }
  let remove = current - quantity;
  const next: CartLine[] = [];
  for (const l of [...cart].reverse()) {
    if (remove > 0 && l.item.id === item.id) {
      const take = Math.min(remove, l.quantity);
      remove -= take;
      if (l.quantity > take) next.push({ ...l, quantity: l.quantity - take });
    } else {
      next.push(l);
    }
  }
  return next.reverse();
}

/** Where the phone keeps the order between reloads; one per table code. */
export const cartStorageKey = (token: string) => `qr-cart:${token}`;

interface SavedLine {
  key?: unknown;
  itemId?: unknown;
  variantId?: unknown;
  addonIds?: unknown;
  quantity?: unknown;
  note?: unknown;
}

/**
 * The order the guest was building before a reload or a look at another app.
 * Only ids and counts are kept: prices come from the menu as it is now, and a
 * dish that is off the menu or has run out is left out.
 */
export function loadCart(token: string, menu: QrMenu): CartLine[] {
  let saved: unknown;
  try {
    const raw = sessionStorage.getItem(cartStorageKey(token));
    if (raw === null) return [];
    saved = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  const items = new Map(menu.items.map((i) => [i.id, i]));
  const lines: CartLine[] = [];
  for (const s of saved as SavedLine[]) {
    const item = typeof s?.itemId === 'string' ? items.get(s.itemId) : undefined;
    if (item === undefined || !item.isAvailable) continue;
    const quantity = Number(s.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) continue;
    const variantId = typeof s.variantId === 'string' ? s.variantId : undefined;
    const addonIds = Array.isArray(s.addonIds)
      ? s.addonIds.filter((id): id is string => typeof id === 'string')
      : [];
    const unit = unitPrice(item, variantId, addonIds, menu);
    if (unit === null) continue;
    lines.push({
      key: typeof s.key === 'string' ? s.key : newIdempotencyKey(),
      item,
      variantId,
      addonIds,
      quantity,
      note: typeof s.note === 'string' ? s.note.slice(0, 120) : '',
      unit,
    });
  }
  return lines;
}

export function saveCart(token: string, cart: readonly CartLine[]): void {
  try {
    if (cart.length === 0) {
      sessionStorage.removeItem(cartStorageKey(token));
      return;
    }
    sessionStorage.setItem(
      cartStorageKey(token),
      JSON.stringify(
        cart.map((l) => ({
          key: l.key,
          itemId: l.item.id,
          variantId: l.variantId,
          addonIds: l.addonIds,
          quantity: l.quantity,
          note: l.note,
        })),
      ),
    );
  } catch {
    // Private browsing or storage full: the order still works, it just isn't kept.
  }
}
