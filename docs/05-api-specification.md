# 05 — API Specification

Base URL: `https://<hub>:7400/api/v1` · JSON · All money in minor units · All IDs UUIDv7.
Full OpenAPI 3.1 will be **generated from Zod contracts** (`packages/contracts`) at build time and served at `/api/docs`. This document is the design-level contract.

## 1. Conventions

| Aspect | Rule |
|---|---|
| Auth | `Authorization: Bearer <access JWT>`; refresh via httpOnly cookie on `/auth/refresh` |
| Branch scope | `X-Branch-Id` header (defaults to the user's only branch) |
| Idempotency | All `POST` commands accept `Idempotency-Key` (UUID). Replays return the stored response. Required for offline-queued captain commands. |
| Concurrency | Mutations of versioned resources send `If-Match: <version>`. A mismatch returns `409 VERSION_CONFLICT` with the current resource. |
| Manager override | `X-Approver-Token` (short-lived JWT from `POST /auth/approve`) |
| Errors | RFC 9457 problem+json: `{ type, title, status, code, detail, errors[] }` |
| Pagination | Cursor: `?limit=50&cursor=<opaque>` → `{ data, nextCursor }` |
| Filtering | `?status=OPEN&from=2026-10-01&to=2026-10-31` |
| Time | Responses include `serverTime`, and clients correct for clock skew |

### Standard error codes
`UNAUTHENTICATED` 401 · `FORBIDDEN` 403 (includes `requiredPermission`) · `NOT_FOUND` 404 · `VERSION_CONFLICT` 409 · `INVALID_STATE_TRANSITION` 409 · `INSUFFICIENT_STOCK` 409 (only when `settings.inventory.block_on_negative`) · `APPROVAL_REQUIRED` 403 · `VALIDATION_FAILED` 422 · `RATE_LIMITED` 429.

## 2. Endpoints (Phase 1)

Permission required in brackets.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | `{username, password, deviceId}` → `{accessToken, user, permissions[], branches[]}` + refresh cookie |
| POST | `/auth/pin-login` | Fast user switch on a paired device `{userId, pin}` |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke refresh family |
| POST | `/auth/approve` | Manager enters PIN → `{approverToken, expiresIn: 60}` scoped to one action |
| GET | `/auth/me` | Current user, permissions, branch |

### Users & roles [`users.manage`, `roles.manage`]
`GET/POST /users` · `GET/PATCH /users/{id}` · `POST /users/{id}/deactivate` · `POST /users/{id}/reset-pin` · `GET/POST /roles` · `PUT /roles/{id}/permissions` · `GET /permissions`

### Settings [`settings.manage`]
`GET/PATCH /settings` · `GET/POST/PATCH /tax-groups` · `GET/POST/PATCH /charge-rules` · `GET/POST/PATCH /printers` · `POST /printers/{id}/test` · `GET/POST/PATCH /devices` · `POST /devices/pairing-code`

### Floor
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/floor` | `tables.view` | Areas + tables + live status + open order summary (amount, elapsed time, captain) |
| POST/PATCH | `/floor-areas`, `/tables` | `floor.manage` | Layout editor |
| POST | `/tables/{id}/status` | `tables.update_status` | `{status: CLEANING\|AVAILABLE\|RESERVED\|BLOCKED}` |
| POST | `/tables/{id}/transfer` | `orders.transfer_table` | `{targetTableId, mode: MOVE\|MERGE}` |

### Menu
| Method | Path | Perm |
|---|---|---|
| GET | `/menu?updatedSince=` | any authenticated. Full menu snapshot with ETag, cached by clients |
| GET | `/menu/search?q=biry&category=&sku=` | any |
| POST/PATCH | `/categories`, `/menu-items`, `/menu-items/{id}/variants`, `/addon-groups` | `menu.manage` |
| POST | `/menu-items/{id}/availability` | `menu.toggle_availability` |

### Orders (Captain + POS)
| Method | Path | Perm | Body / Notes |
|---|---|---|---|
| POST | `/orders` | `orders.create` | `{orderType, tableId?, covers?, customerId?}` → order. Sets table to OCCUPIED |
| GET | `/orders?status=OPEN` | `tables.view` | |
| GET | `/orders/{id}` | `tables.view` | Order + items + KOTs + running totals |
| POST | `/orders/{id}/items` | `orders.create` | `{items:[{menuItemId, variantId?, quantity, addons:[{addonId,quantity}], specialNote?, course?}]}`. Items are PENDING until fired |
| PATCH | `/orders/{id}/items/{itemId}` | `orders.update` | quantity/note, only while PENDING |
| POST | `/orders/{id}/kots` | `orders.fire_kot` | Fires all PENDING items, one KOT per station → `KotFired` pushed to KDS |
| POST | `/orders/{id}/items/{itemId}/cancel` | `orders.item_cancel` (+ approver if already fired) | `{reason, isWastage}` |
| POST | `/orders/{id}/cancel` | `orders.cancel` + approver | `{reason}` |
| POST | `/orders/{id}/customer` | `customers.manage` | attach/create customer by phone |

### Kitchen (KDS)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/kitchen/kots?station=&status=` | `kds.view` | Active board |
| POST | `/kitchen/kots/{id}/status` | `kds.update_status` | `{to: ACCEPTED\|COOKING\|READY\|SERVED}`. Invalid transitions → 409 |
| POST | `/kitchen/kots/{id}/items/{itemId}/ready` | `kds.update_status` | Item-level bump |
| POST | `/kitchen/kots/{id}/assign` | `kds.assign_chef` | `{chefId}` |
| POST | `/kitchen/kots/{id}/reprint` | `kds.view` | Optional paper backup |
| GET | `/kitchen/metrics?date=` | `kds.view` | pending, avg cook time, delayed count, per-chef stats |

### Billing (POS)
| Method | Path | Perm | Notes |
|---|---|---|---|
| POST | `/orders/{id}/invoice` | `billing.create` | `{discounts?:[…], couponCode?, chargeRuleIds?, customerId?, customerTaxId?}` → invoice with tax breakup. Order → BILLED, table → BILLING |
| POST | `/invoices/preview` | `billing.create` | Same body. Computes totals without persisting (live bill panel) |
| POST | `/invoices/{id}/payments` | `billing.collect_payment` | `{payments:[{method, amount, tendered?, reference?}]}`. Split payment = several entries. Fully paid → order PAID, table → CLEANING |
| POST | `/invoices/{id}/print` | `billing.create` (first) / `billing.reprint` | `{printerId?, copy: CUSTOMER\|DUPLICATE}` |
| POST | `/invoices/{id}/cancel` | `billing.cancel` + approver | Only if unpaid, or paid same-shift (auto-refunds) |
| POST | `/invoices/{id}/refunds` | `billing.refund` + approver | `{lines?:[{invoiceLineId, quantity}], amount?, method, reason}` → credit note + negative payment |
| GET | `/invoices?date=&status=` | `billing.create` | |
| POST/GET | `/cash-shifts`, `/cash-shifts/{id}/close` | `cash.shift_manage` | `{openingFloat}` / `{countedCash, denominations}` → X/Z report |

### Customers
`GET /customers?phone=` · `POST /customers` · `GET /customers/{id}` (history, favourites, LTV, points) · `POST /customers/{id}/loyalty-adjustments` [`loyalty.adjust`]

### Reports (Phase 1 subset)
`GET /reports/day-end?date=` (sales, tax, payment-mode split, cash summary) · `GET /reports/dashboard` · `GET /reports/{name}/export?format=pdf|xlsx|csv`

### Public QR ordering (no auth, rate-limited)
`GET /public/qr/{qrToken}/menu` · `POST /public/qr/{qrToken}/orders` → order in `PENDING_APPROVAL`, captain notified to confirm.

### Admin / platform
`GET /audit-logs?entityType=&entityId=&actorId=` [`audit.view`] · `POST /backups` · `GET /backups` · `POST /backups/{id}/restore` [`backup.manage`] · `GET /health` (no auth: db, disk, printer, sync status)

## 3. Phase 2–6 endpoint groups (outline)

| Phase | Group | Key endpoints |
|---|---|---|
| 2 | Inventory | `/inventory-items`, `/recipes`, `/stock` (levels), `/stock/adjustments`, `/stock/wastage`, `/stock-counts` (+`/post`), `/stock/alerts` |
| 3 | Purchasing | `/vendors`, `/purchase-orders` (+`/approve`, `/send`), `/grns` (+`/post`), `/vendor-payments`, `/vendors/{id}/statement` |
| 4 | Accounting | `/accounts`, `/journal-entries` (+`/reverse`), `/expenses`, `/ledgers/{accountId}`, `/ledgers/party/{type}/{id}` |
| 5 | Reporting | `/reports/{sales\|items\|tax\|gstr1\|pnl\|balance-sheet\|cash-flow\|inventory-valuation\|consumption-variance}` |
| 6 | Sync | `/sync/status`, `/sync/conflicts` (+`/resolve`), `/sync/retry` · cloud side: `POST /sync/push`, `GET /sync/pull` |

## 4. WebSocket protocol

Endpoint `wss://<hub>:7400/ws?token=<access JWT>`. The server assigns rooms from the user's role and device kind. Clients can `subscribe` to extra rooms they're authorized for.

```jsonc
// server → client envelope
{ "type": "kitchen.kot.fired", "seq": 18233, "branchId": "…", "occurredAt": "…", "data": { /* contract */ } }
// client → server
{ "type": "subscribe", "rooms": ["kds:station:<id>"] }
{ "type": "ack", "seq": 18233 }
```

| Message | Rooms | Payload |
|---|---|---|
| `floor.table.status_changed` | floor | tableId, status, orderId, version |
| `ordering.order.updated` | floor, pos | order summary |
| `kitchen.kot.fired` | kds:station:{id}, kds:all | full KOT with items, notes, addons |
| `kitchen.kot.status_changed` | kds, floor, captain:{userId} | kotId, from, to, at |
| `kitchen.kot.delayed` | kds, manager | kotId, overdueSec |
| `billing.invoice.paid` | pos, dashboard | invoice summary |
| `token.ready` | token-display | tokenNo |
| `notification.created` | user:{id}, role:{code} | notification |

**Gap recovery**: each message carries the event `seq`. On reconnect, the client sends `{type:"resume", lastSeq}` and the server replays from `domain_events`, or tells the client to refetch if the gap is too large.
