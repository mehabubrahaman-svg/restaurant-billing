import { DomainError } from '@restroos/domain';
import type { CatalogRepository } from '../catalog/ports';
import type { SalesChannelRepository } from '../ordering/channels';
import type { OrderService } from '../ordering/order-service';
import type { OrderRepository } from '../ordering/ports';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { CommandContext, UnitOfWork } from '../ports/unit-of-work';
import type { SettingsRepository } from '../settings/ports';

export interface RelayLinkRecord {
  branchId: string;
  relayUrl: string;
  hubId: string;
  /** Secret: never leaves the Hub except to the relay. */
  hubKey: string;
  isEnabled: boolean;
  /** "Online orders": the user relay orders are entered as. */
  actorUserId: string;
  version: number;
}

export type RelayMessageStatus = 'PENDING' | 'SENT' | 'DONE' | 'FAILED' | 'SKIPPED';

export interface RelayMessageRecord {
  id: string;
  branchId: string;
  direction: 'IN' | 'OUT';
  kind: string;
  status: RelayMessageStatus;
  channelCode: string | null;
  externalOrderId: string | null;
  orderId: string | null;
  payload: unknown;
  error: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface RelayRepository {
  link(branchId: string): RelayLinkRecord | undefined;
  links(): RelayLinkRecord[];
  /** Inserts or (version-checked) updates the branch's link. */
  saveLink(record: RelayLinkRecord, actorId: string | null, at: Date): void;
  /** The "Online orders" user (no password, no sign-in), made the first time. */
  ensureActor(): string;
  message(id: string): RelayMessageRecord | undefined;
  insertMessage(record: RelayMessageRecord): void;
  updateMessage(
    id: string,
    change: Pick<RelayMessageRecord, 'status' | 'error' | 'orderId' | 'handledAt'>,
  ): void;
  /** Outbound messages the relay hasn't stored yet, oldest first. */
  pendingOut(branchId: string, limit: number): RelayMessageRecord[];
  /** Older outbound messages of a kind still waiting become SKIPPED (a newer menu replaces them). */
  skipPendingOut(branchId: string, kind: string, at: Date): void;
  recent(branchId: string, limit: number): RelayMessageRecord[];
  counts(branchId: string): { pendingOut: number; failedIn: number };
}

/** A webhook the relay delivered: the shape of `RelayWebhookSchema` (contracts). */
export type RelayDelivery =
  | {
      event: 'order.created';
      order: {
        channel: string;
        externalOrderId: string;
        otp?: string | undefined;
        note?: string | undefined;
        items: {
          menuItemId: string;
          variantId?: string | undefined;
          quantity: number;
          addons: { addonId: string; quantity: number }[];
          note?: string | undefined;
        }[];
      };
    }
  | {
      event: 'order.cancelled';
      order: { channel: string; externalOrderId: string; reason?: string | undefined };
    };

/** The Hub's menu as the middleware lists it (`RelayMenuSchema`). */
export interface RelayMenuView {
  channels: { code: string; priceMarkupBp: number }[];
  categories: { id: string; name: string; sortOrder: number }[];
  items: {
    id: string;
    categoryId: string;
    name: string;
    description: string | null;
    foodType: string;
    price: number;
    variants: { id: string; name: string; price: number }[];
    addonGroups: {
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      addons: { id: string; name: string; price: number }[];
    }[];
    available: boolean;
  }[];
}

const WS_URL = /^(wss?|https?):\/\/[^\s/]+/;

/**
 * Online orders through the cloud relay (docs/08 Phase 5, ADR 0007): orders
 * from Swiggy, Zomato … arrive as aggregator orders and go to the kitchen at
 * once; what can't be entered (an unknown channel or dish) is kept as FAILED
 * for staff to key in or retry. Menu, availability and order status are
 * queued for the relay and survive a lost connection.
 */
export class RelayIntegrationService {
  constructor(
    private readonly d: {
      relay: RelayRepository;
      orderService: OrderService;
      orders: OrderRepository;
      channels: SalesChannelRepository;
      catalog: CatalogRepository;
      settings: SettingsRepository;
      unitOfWork: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  link(branchId: string): RelayLinkRecord | undefined {
    return this.d.relay.link(branchId);
  }

  links(): RelayLinkRecord[] {
    return this.d.relay.links();
  }

  overview(branchId: string) {
    return {
      link: this.d.relay.link(branchId) ?? null,
      counts: this.d.relay.counts(branchId),
      recent: this.d.relay.recent(branchId, 50),
    };
  }

  saveLink(
    input: {
      relayUrl: string;
      hubId: string;
      hubKey?: string | undefined;
      isEnabled: boolean;
      version?: number | undefined;
    },
    ctx: CommandContext,
  ): RelayLinkRecord {
    const relayUrl = input.relayUrl.trim().replace(/\/+$/, '');
    if (!WS_URL.test(relayUrl))
      throw new DomainError(
        'VALIDATION_FAILED',
        'the relay address starts with wss:// or https://',
      );
    return this.d.unitOfWork.run(ctx, (scope) => {
      const current = this.d.relay.link(ctx.branchId);
      if (current && current.version !== input.version)
        throw new DomainError('VERSION_CONFLICT', 'the online orders link changed; reload');
      const hubKey = input.hubKey?.trim() || current?.hubKey;
      if (!hubKey) throw new DomainError('VALIDATION_FAILED', 'enter the key the relay gave');
      const next: RelayLinkRecord = {
        branchId: ctx.branchId,
        relayUrl,
        hubId: input.hubId.trim(),
        hubKey,
        isEnabled: input.isEnabled,
        actorUserId: current?.actorUserId ?? this.d.relay.ensureActor(),
        version: (current?.version ?? 0) + 1,
      };
      this.d.relay.saveLink(next, ctx.actorId, this.d.clock.now());
      scope.audit({
        action: 'integrations.relay.save',
        entityType: 'RelayLink',
        entityId: ctx.branchId,
        before: current && {
          relayUrl: current.relayUrl,
          hubId: current.hubId,
          isEnabled: current.isEnabled,
        },
        after: {
          relayUrl,
          hubId: next.hubId,
          isEnabled: next.isEnabled,
          keyChanged: hubKey !== current?.hubKey,
        },
      });
      return next;
    });
  }

  /** A webhook from the relay; the answer becomes the relay's `ack`. Handled once per relay id. */
  receive(branchId: string, id: string, message: RelayDelivery): { ok: boolean; error?: string } {
    const seen = this.d.relay.message(id);
    if (seen && seen.status !== 'PENDING') {
      return seen.status === 'DONE' ? { ok: true } : { ok: false, error: seen.error ?? 'failed' };
    }
    if (!seen) {
      this.d.relay.insertMessage({
        id,
        branchId,
        direction: 'IN',
        kind: message.event,
        status: 'PENDING',
        channelCode: message.order.channel,
        externalOrderId: message.order.externalOrderId,
        orderId: null,
        payload: message,
        error: null,
        createdAt: this.d.clock.now().toISOString(),
        handledAt: null,
      });
    }
    return this.handle(branchId, id, message);
  }

  /** Staff fixed what was wrong (a channel, a dish): try a FAILED order again. */
  retry(id: string, branchId: string): { ok: boolean; error?: string } {
    const message = this.d.relay.message(id);
    if (!message || message.branchId !== branchId || message.direction !== 'IN')
      throw new DomainError('NOT_FOUND', 'message not found');
    if (message.status !== 'FAILED')
      throw new DomainError('VALIDATION_FAILED', 'only a failed online order can be tried again');
    return this.handle(branchId, id, message.payload as RelayDelivery);
  }

  /** Queues a message for the relay; the client sends it when connected. */
  queue(branchId: string, kind: 'menu' | 'availability' | 'order-status', payload: unknown) {
    const link = this.d.relay.link(branchId);
    if (!link?.isEnabled) return null;
    const now = this.d.clock.now();
    if (kind === 'menu') this.d.relay.skipPendingOut(branchId, 'menu', now);
    const record: RelayMessageRecord = {
      id: this.d.ids.next(),
      branchId,
      direction: 'OUT',
      kind,
      status: 'PENDING',
      channelCode:
        kind === 'order-status' ? ((payload as { channel?: string }).channel ?? null) : null,
      externalOrderId:
        kind === 'order-status'
          ? ((payload as { externalOrderId?: string }).externalOrderId ?? null)
          : null,
      orderId: null,
      payload,
      error: null,
      createdAt: now.toISOString(),
      handledAt: null,
    };
    this.d.relay.insertMessage(record);
    return record;
  }

  pendingOut(branchId: string): RelayMessageRecord[] {
    return this.d.relay.pendingOut(branchId, 100);
  }

  /** The relay stored it. */
  markSent(id: string): void {
    const message = this.d.relay.message(id);
    if (message?.status !== 'PENDING') return;
    this.d.relay.updateMessage(id, {
      status: 'SENT',
      error: null,
      orderId: null,
      handledAt: this.d.clock.now().toISOString(),
    });
  }

  /**
   * Tells the platform about an aggregator order: READY once every item is
   * ready (or served), CANCELLED when staff cancel it. Other orders are ignored.
   */
  notifyOrder(branchId: string, orderId: string, status: 'READY' | 'CANCELLED'): void {
    const order = this.d.orders.get(branchId, orderId);
    const channelId = order?.state.salesChannelId;
    const externalOrderId = order?.state.externalOrderId;
    if (!order || !channelId || !externalOrderId) return;
    const channel = this.d.channels.get(channelId);
    if (!channel || channel.kind !== 'AGGREGATOR') return;
    if (status === 'READY') {
      const live = order.lines.filter((l) => l.status !== 'CANCELLED');
      if (live.length === 0 || !live.every((l) => l.status === 'READY' || l.status === 'SERVED'))
        return;
    }
    this.queue(branchId, 'order-status', { channel: channel.code, externalOrderId, status });
  }

  /** Everything the aggregators may list: active dishes in active categories, without liquor. */
  menu(branchId: string): RelayMenuView {
    const categories = this.d.catalog.categories().filter((c) => c.isActive);
    const shown = new Set(categories.map((c) => c.id));
    const liquor = (taxGroupId: string | null) => {
      const group = taxGroupId ? this.d.settings.taxGroup(taxGroupId) : undefined;
      return group?.invoiceSeries === 'LIQ' || group?.taxType === 'VAT';
    };
    const groups = new Map(this.d.catalog.addonGroups().map((g) => [g.id, g]));
    return {
      channels: this.d.channels
        .all()
        .filter((c) => c.isActive && c.kind === 'AGGREGATOR')
        .map((c) => ({ code: c.code, priceMarkupBp: c.priceMarkupBp })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder })),
      items: this.d.catalog
        .items(branchId, false)
        .filter((i) => i.isActive && shown.has(i.categoryId) && !liquor(i.taxGroupId))
        .map((i) => ({
          id: i.id,
          categoryId: i.categoryId,
          name: i.name,
          description: i.description,
          foodType: i.foodType,
          price: i.basePrice,
          variants: [...i.variants]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((v) => ({ id: v.id, name: v.name, price: v.price })),
          addonGroups: i.addonGroupIds
            .map((id) => groups.get(id))
            .filter((g) => g !== undefined && g.isActive)
            .map((g) => ({
              id: g!.id,
              name: g!.name,
              minSelect: g!.minSelect,
              maxSelect: g!.maxSelect,
              addons: g!.addons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
            })),
          available: i.isAvailable,
        })),
    };
  }

  private handle(
    branchId: string,
    id: string,
    message: RelayDelivery,
  ): { ok: boolean; error?: string } {
    const link = this.d.relay.link(branchId);
    const finish = (ok: boolean, error: string | null, orderId: string | null) => {
      this.d.relay.updateMessage(id, {
        status: ok ? 'DONE' : 'FAILED',
        error,
        orderId,
        handledAt: this.d.clock.now().toISOString(),
      });
      return ok ? { ok } : { ok, error: error ?? 'failed' };
    };
    if (!link) return finish(false, 'online orders are not set up on this Hub', null);
    const ctx: CommandContext = {
      branchId,
      actorId: link.actorUserId,
      correlationId: `relay:${id}`,
    };
    const channel = this.d.channels.byCode(message.order.channel);
    if (!channel || !channel.isActive || channel.kind !== 'AGGREGATOR') {
      return finish(
        false,
        `no active aggregator channel ${message.order.channel} on the Hub`,
        null,
      );
    }
    const existing = this.d.channels.existingOrderId(channel.id, message.order.externalOrderId);
    try {
      if (message.event === 'order.created') {
        if (existing) return finish(true, null, existing);
        const { order } = this.d.orderService.openAggregator(
          {
            salesChannelId: channel.id,
            externalOrderId: message.order.externalOrderId,
            externalOtp: message.order.otp,
            notes: message.order.note,
            items: message.order.items.map((i) => ({
              menuItemId: i.menuItemId,
              variantId: i.variantId,
              quantity: i.quantity,
              addons: i.addons,
              specialNote: i.note,
              course: 1,
            })),
            fire: true,
          },
          ctx,
        );
        this.queue(branchId, 'order-status', {
          channel: channel.code,
          externalOrderId: message.order.externalOrderId,
          status: 'ACCEPTED',
        });
        return finish(true, null, order.id);
      }
      if (!existing)
        return finish(false, `no ${channel.name} order ${message.order.externalOrderId}`, null);
      const order = this.d.orders.get(branchId, existing);
      if (!order) return finish(false, 'order not found', null);
      if (order.state.status === 'CANCELLED') return finish(true, null, existing);
      if (order.state.status !== 'OPEN') {
        return finish(
          false,
          `the order is already ${order.state.status.toLowerCase()}; settle it at the counter`,
          existing,
        );
      }
      this.d.orderService.cancel(
        existing,
        {
          version: order.version,
          reason: `${channel.name}: ${message.order.reason ?? 'cancelled on the platform'}`.slice(
            0,
            200,
          ),
        },
        ctx,
        { mayCancelSent: true },
      );
      return finish(true, null, existing);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return finish(false, text.slice(0, 500), existing ?? null);
    }
  }
}
