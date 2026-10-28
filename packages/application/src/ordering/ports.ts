import type {
  FoodType,
  Kot,
  KotStatus,
  Order,
  OrderItemStatus,
  OrderStatus,
  OrderType,
} from '@restroos/domain';

/** Orders, versioned at the order level; lines carry their own version for edits. */
export interface OrderRepository {
  get(branchId: string, id: string): Order | undefined;
  /** The OPEN order sitting at a table, if any. */
  openOrderIdForTable(branchId: string, tableId: string): string | undefined;
  insert(order: Order): void;
  /** Version-checked on the order row; writes the order and its changed lines. */
  save(order: Order): void;
  /** "1", "2", … per branch per business day. */
  nextOrderNo(branchId: string, businessDate: string): string;
  /** Takeaway / delivery token, per branch per business day. */
  nextTokenNo(branchId: string, businessDate: string): number;
}

export interface KotRepository {
  get(branchId: string, id: string): Kot | undefined;
  forOrder(orderId: string): Kot[];
  insert(kot: Kot): void;
  /** Version-checked; also writes the item statuses the KOT changed and its status history. */
  save(kot: Kot, actorId: string | null): void;
  nextKotNo(branchId: string, businessDate: string): number;
}

/** The trading day for a moment, in the branch's time zone and day start (docs/03 §2). */
export interface BusinessCalendar {
  businessDate(branchId: string, at: Date): string;
}

// ---- read models (shapes match packages/contracts ordering.ts and kitchen.ts) -------------
export interface OrderSummaryView {
  id: string;
  orderNo: string;
  tokenNo: number | null;
  businessDate: string;
  orderType: OrderType;
  status: OrderStatus;
  tableId: string | null;
  tableLabel: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  externalOrderId: string | null;
  covers: number | null;
  captainId: string | null;
  captainName: string | null;
  notes: string | null;
  subtotal: number;
  itemCount: number;
  pendingCount: number;
  readyCount: number;
  openedAt: string;
  closedAt: string | null;
  version: number;
}

export interface OrderItemView {
  id: string;
  menuItemId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  foodType: FoodType;
  unitPrice: number;
  addons: { addonId: string; name: string; price: number; quantity: number }[];
  addonsTotal: number;
  quantity: number;
  lineTotal: number;
  specialNote: string | null;
  course: number;
  status: OrderItemStatus;
  kotId: string | null;
  kitchenStationId: string | null;
  cancelReason: string | null;
  createdAt: string;
  version: number;
}

export interface KotSummaryView {
  id: string;
  kotNo: number;
  kitchenStationId: string | null;
  stationName: string | null;
  status: KotStatus;
  firedAt: string;
  readyAt: string | null;
  version: number;
}

export interface OrderView extends OrderSummaryView {
  items: OrderItemView[];
  kots: KotSummaryView[];
}

export interface TableOrderView {
  id: string;
  orderNo: string;
  covers: number | null;
  subtotal: number;
  openedAt: string;
  captainId: string | null;
  captainName: string | null;
  itemCount: number;
  pendingCount: number;
  readyCount: number;
}

export interface KotView {
  id: string;
  kotNo: number;
  businessDate: string;
  orderId: string;
  orderNo: string;
  orderType: OrderType;
  tableLabel: string | null;
  tokenNo: number | null;
  captainId: string | null;
  captainName: string | null;
  kitchenStationId: string | null;
  stationName: string | null;
  status: KotStatus;
  priority: number;
  assignedChefId: string | null;
  assignedChefName: string | null;
  firedAt: string;
  acceptedAt: string | null;
  cookingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  targetReadyAt: string;
  items: {
    id: string;
    menuItemId: string;
    variantId: string | null;
    name: string;
    variantName: string | null;
    foodType: FoodType;
    quantity: number;
    addons: { name: string; quantity: number }[];
    specialNote: string | null;
    course: number;
    status: OrderItemStatus;
    cancelReason: string | null;
  }[];
  version: number;
}

export interface KitchenMetricsView {
  businessDate: string;
  pending: number;
  delayed: number;
  avgCookSeconds: number | null;
  completed: number;
  perChef: { chefId: string; fullName: string; completed: number; avgCookSeconds: number | null }[];
}

export interface OrderQueries {
  order(branchId: string, id: string): OrderView | undefined;
  summary(branchId: string, id: string): OrderSummaryView | undefined;
  summaries(branchId: string, status: OrderStatus): OrderSummaryView[];
  /** tableId → its open order. */
  openOrdersByTable(branchId: string): Map<string, TableOrderView>;
}

export interface KitchenQueries {
  kot(branchId: string, id: string): KotView | undefined;
  /** NEW, ACCEPTED, COOKING and READY KOTs, oldest first. */
  active(branchId: string, stationId?: string): KotView[];
  /** Active KOTs past their target time. */
  overdue(
    branchId: string | null,
    now: Date,
  ): { id: string; branchId: string; targetReadyAt: Date }[];
  metrics(branchId: string, businessDate: string, now: Date): KitchenMetricsView;
  /** Active users who may work the KDS in this branch. */
  chefs(branchId: string): { id: string; fullName: string }[];
  isChef(branchId: string, userId: string): boolean;
  tokenBoard(branchId: string, businessDate: string): { preparing: number[]; ready: number[] };
}
