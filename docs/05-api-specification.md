# 05 — API Specification

Base URL: `https://<hub>:7443/api/v1` (HTTPS, once the device trusts the Hub CA) or `http://<hub>:7400/api/v1` (first contact and pairing) · JSON · All money in minor units · All IDs UUIDv7.
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
| Language | `Accept-Language: hi-IN` localises error `title`/`detail` and server-rendered documents (receipts, PDFs). Data fields are never translated in place; translations come in `nameTranslations` |
| Transport | The same JSON contracts travel over HTTPS/WSS (normal) or the BLE fallback channel (§4). Idempotency keys make retries across transports safe |

### Standard error codes
`UNAUTHENTICATED` 401 · `FORBIDDEN` 403 (includes `requiredPermission`) · `NOT_FOUND` 404 · `VERSION_CONFLICT` 409 · `INVALID_STATE_TRANSITION` 409 · `INSUFFICIENT_STOCK` 409 (only when `settings.inventory.block_on_negative`) · `APPROVAL_REQUIRED` 403 · `VALIDATION_FAILED` 422 · `RATE_LIMITED` 429.

## 2. Endpoints (Phase 1)

Permission required in brackets.

### Auth
Implemented in Sprint 2. Contracts: `packages/contracts/src/http/auth.ts`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | public, 20/min/IP | `{username, password, branchId?}` → session (`accessToken` 15 min, user, branch, branches, roles, permissions) + httpOnly refresh cookie (12 h, path `/api/v1/auth`, SameSite=Strict) |
| POST | `/auth/pin-login` | public, paired device, 20/min/IP | `{userId, pin, branchId?}` → session. Fast user switch |
| GET | `/auth/pin-users` | public, paired device | PIN-pad tiles `{id, fullName, initials}` |
| POST | `/auth/refresh` | cookie | Rotates the refresh token. Body `{branchId?}` switches branch. Replaying an old token ends the whole session (theft signal, audited) |
| POST | `/auth/logout` | cookie | Ends the session immediately, including its access token |
| GET | `/auth/me` | token | Current user, branch, roles, permissions |
| POST | `/auth/change-password` | token | `{currentPassword, newPassword}`. Keeps this session, ends the others |
| POST | `/auth/approve` | token, paired device, 20/min/IP | Manager `{userId, pin, permission}` → `approverToken` valid 60 s, **once**, for that permission and branch. Send as `X-Approver-Token` when retrying the request that returned `APPROVAL_REQUIRED` |

Security behaviour:
- **Lockout:** 5 failed passwords or PINs lock the account for 15 minutes. A wrong password and an unknown user get the same response, after the same delay.
- **Permission checks:** permissions are re-read on every request, so role changes and deactivations apply immediately.
- **PIN only on paired devices:** PIN routes answer `403 DEVICE_NOT_PAIRED` unless the request comes from a paired device or from the Hub PC itself (localhost). A 4-digit PIN is fine on a registered tablet, not from any browser on the Wi-Fi.
- **Sign-in bookkeeping:** failure counts and last login don't change the user's edit `version`, so an admin editing a user never gets a conflict just because they signed in.

### Setup
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/setup/status` | public | `{needsSetup, states[]}`. Only states in enabled rollout waves are listed |
| POST | `/setup` | public + setup code, 10/min/IP | Creates the organisation, branch, 7 roles, admin, GST groups (5/18/0%), liquor VAT group if enabled, invoice series, backup key. The setup code is printed by the Hub; 5 wrong codes roll it |

### Users & roles [`users.manage`, `roles.manage`]
`GET/POST /users` · `GET/PATCH /users/{id}` · `POST /users/{id}/deactivate` · `POST /users/{id}/reset-pin` · `GET/POST /roles` · `PUT /roles/{id}/permissions` · `GET /permissions`

### Settings [`settings.manage`]
`GET/PATCH /settings` · `GET/POST/PATCH /tax-groups` · `GET/POST/PATCH /charge-rules` · `GET/POST/PATCH /printers` · `POST /printers/{id}/test` · `GET/POST/PATCH /sales-channels`

### Devices & discovery
Implemented in Sprint 3. Contracts: `packages/contracts/src/http/devices.ts`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/hub/info` | public | `{name, version, needsSetup, urls:{http[], https[]}, caFingerprint, mdnsHost}` |
| GET | `/hub/ca.crt` | public | The Hub's local CA (PEM) for the device to trust |
| POST | `/devices/pairing-codes` | `settings.manage` | `{name, kind}` → `{code, expiresAt, pairUrl, caFingerprint}`. 8 characters, single use, 10 min. The QR encodes `pairUrl` (`http://<lan-ip>:7400/pair?code=…`) |
| POST | `/devices/pair` | public, 10/min/IP | `{code, fingerprint, platform?}` → `{device, deviceToken}` + httpOnly cookie `restro_dt` (path `/`, so the WebSocket upgrade carries it too). Native shells send the token as `X-Device-Token`. The same browser fingerprint re-pairs in place |
| GET | `/devices/me` | public | The calling device, or `403 DEVICE_NOT_PAIRED` |
| GET/PATCH | `/devices`, `/devices/{id}` | `settings.manage` | Registry. `isActive:false` unpairs at once; re-activating needs a new code (`DEVICE_MUST_REPAIR`) |
| GET/POST/PATCH | `/peripherals` | `settings.manage` | Scanners, scales, cash drawers, pagers, customer displays, on the Hub or on a device |

The paired device's id is recorded on audit rows and refresh tokens.

### Floor
Implemented in Sprint 3 (live order summaries arrive with orders in Sprint 4). Contracts: `packages/contracts/src/http/floor.ts`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/floor` | `tables.view` or `floor.manage` | Areas + tables + status. The QR token is never returned, only `hasQr` |
| POST/PATCH | `/floor-areas`, `/tables` | `floor.manage` | Layout editor. Positions are cells on a 48 × 32 grid |
| PUT | `/floor/layout` | `floor.manage` | `{tables:[{id, posX, posY, version}]}`: drag-and-drop save, all moves or none |
| POST | `/tables/{id}/status` | `tables.update_status` | `{status: CLEANING\|AVAILABLE\|RESERVED\|BLOCKED, version}`. Allowed manual moves: AVAILABLE→RESERVED/CLEANING/BLOCKED, RESERVED→AVAILABLE/BLOCKED, CLEANING→AVAILABLE, BLOCKED→AVAILABLE. OCCUPIED/BILLING come from orders |
| GET/POST | `/tables/{id}/qr` | `floor.manage` | `{url, label}`. POST creates or replaces the QR (the old printout stops working) |
| POST | `/tables/{id}/transfer` | `orders.transfer_table` | `{targetTableId, mode: MOVE\|MERGE}` |

### Menu
| Method | Path | Perm |
|---|---|---|
| GET | `/menu` | any authenticated. Active menu snapshot `{version, categories, items, addonGroups, kitchenStations}`; `ETag` = version, `If-None-Match` → 304 |
| GET | `/menu/search?q=biry&category=&sku=` | any (Sprint 4, if client-side search is too slow) |
| GET/POST/PATCH | `/kitchen-stations`, `/categories`, `/addon-groups`, `/menu-items` | `menu.manage`. Variants and add-ons are sent as the full list on the item / group: entries left out are retired |
| GET | `/menu-items?includeInactive=` | `menu.manage` or `menu.toggle_availability` |
| POST | `/menu-items/{id}/availability` | `menu.toggle_availability`. `{isAvailable}`: branch-level "86" |
| POST | `/menu/import` | `menu.manage`. `{csv, dryRun}`. Columns `sku, name, category, price` (+ optional `food_type, tax_group, kitchen_station, short_name, name_hi, name_bn, hsn_sac, description`). Matched by SKU; every row is checked first and nothing is written if any row fails |

Implemented in Sprint 3. Contracts: `packages/contracts/src/http/catalog.ts`.

### Orders (Captain + POS)
Implemented in Sprint 4; aggregator entry in Sprint 5. Contracts: `packages/contracts/src/http/ordering.ts`.

| Method | Path | Perm | Body / Notes |
|---|---|---|---|
| POST | `/orders` | `orders.create` | `{orderType: DINE_IN\|TAKEAWAY\|DELIVERY, tableId?, covers?, notes?}` → Order. Dine-in needs a free or reserved table (`409 TABLE_NOT_FREE`) and sets it OCCUPIED. Takeaway/delivery get a `tokenNo`. `orderNo` and `tokenNo` restart each business day |
| POST | `/orders/aggregator` | `orders.create` | Manual Swiggy/Zomato entry `{salesChannelId, externalOrderId, externalOtp?, items[]}` → `{order, kots}`: a DELIVERY order with a token, priced with the channel's markup and fired at once. A repeated `(channel, externalOrderId)` → `409 DUPLICATE_EXTERNAL_ORDER`. Its bill has no GST when the channel's `gstPaidByOperator` is set (CGST Act s.9(5)) |
| GET/POST/PATCH | `/sales-channels` | read: `settings.manage`, `orders.create` or `billing.create`; write: `settings.manage` | `{code, name, kind: AGGREGATOR\|OWN_ONLINE, commissionBp, priceMarkupBp, gstPaidByOperator, isActive}`. The DIRECT channel is made at setup |
| GET | `/orders?status=OPEN` | `tables.view`, `billing.create` or `kds.view` | Summaries: subtotal, item / pending / ready counts, table, captain |
| GET | `/orders/{id}` | same | Order + items (name, price and tax group frozen at order time) + KOT summaries |
| PATCH | `/orders/{id}` | `orders.update` | `{version, covers?, notes?}` |
| POST | `/orders/{id}/items` | `orders.create` | `{items:[{menuItemId, variantId?, quantity, addons:[{addonId, quantity}], specialNote?, course?}]}`. Items are PENDING until fired. A size is required when the item has variants; add-ons must belong to the item's groups and respect min/max; 86'd or retired items → `409 ITEM_UNAVAILABLE` |
| PATCH | `/orders/{id}/items/{itemId}` | `orders.update` | `{version, quantity?, specialNote?, course?}`, only while PENDING (`409 ITEM_ALREADY_SENT`) |
| POST | `/orders/{id}/kots` | `orders.fire_kot` | Fires every PENDING item, one KOT per kitchen station (`409 NOTHING_TO_FIRE`). Target time = fired + the slowest item's prep time (15 min default). Send an `Idempotency-Key` |
| POST | `/orders/{id}/items/{itemId}/cancel` | `orders.update`; `orders.item_cancel` or a manager's approval once the kitchen has it | `{version, reason?, isWastage}`. A PENDING item is just removed. A sent item needs a reason; without the permission → `403 APPROVAL_REQUIRED` (`permission: orders.item_cancel`), retry with `X-Approver-Token`. The item is struck through on its KOT; a KOT left empty is cancelled |
| POST | `/orders/{id}/cancel` | `orders.update`; `orders.cancel` or approval once anything was sent | `{version, reason}`. Cancels open KOTs and frees the table |
| POST | `/tables/{id}/transfer` | `orders.transfer_table` | `{targetTableId, mode: MOVE\|MERGE}`. MOVE needs a free target; MERGE moves every item and KOT into the target table's open order (covers add up) and closes this one as merged |

Idempotency-Key works on POST and PATCH. Refusals the client fixes by retrying the same request (401, 403, 429) are not stored, so an approval retry can reuse the key.

### Kitchen (KDS)
Implemented in Sprint 4. Contracts: `packages/contracts/src/http/kitchen.ts`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/kitchen/kots?station=` | `kds.view` | Active board: NEW, ACCEPTED, COOKING, READY, oldest first, with items, add-ons, notes, table/token, captain, chef |
| POST | `/kitchen/kots/{id}/status` | `kds.update_status`; captains (`orders.update`) only `SERVED` | `{to: ACCEPTED\|COOKING\|READY\|SERVED, version}`. Forward only; steps may be skipped. Items follow (COOKING → PREPARING, READY, SERVED). Every change is written to `kot_status_events` |
| POST | `/kitchen/kots/{id}/items/{itemId}/ready` | `kds.update_status` | Item-level bump; the last live item makes the KOT READY |
| POST | `/kitchen/kots/{id}/assign` | `kds.assign_chef` | `{chefId \| null, version}`; the chef must hold `kds.update_status` in the branch |
| GET | `/kitchen/chefs` | `kds.view` | Who can be assigned |
| GET | `/kitchen/metrics` | `kds.view` | Today: pending, delayed, completed, average fired→ready seconds, per chef |
| GET | `/tokens` | public | Token display: `{businessDate, preparing[], ready[]}` for takeaway/delivery tokens |
| POST | `/kitchen/kots/{id}/reprint` | `kds.view` or `orders.fire_kot` | `{printerId?}` → print outcomes, one per KOT printer for the station; the slip says DUPLICATE. `409 NO_PRINTER` when none is set up |

### Billing (POS)
Implemented in Sprint 5 (printing in 5B). Contracts: `packages/contracts/src/http/billing.ts`. Tax engine: `packages/domain/src/billing/tax-engine.ts`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| POST | `/orders/{id}/bill-preview` | `billing.create` | Body as below. Computes the bill(s) without saving: lines, discounts, charges, CGST/SGST (or VAT) per rate, round-off, total |
| POST | `/orders/{id}/invoice` | `billing.create` (+ approvals below) | `{discount?:{kind: PERCENT\|FIXED, value, reason?}, couponCode?, complimentary?:{reason}, removeChargeRuleIds?, customer?:{name?, taxId?}}` → **one or two** invoices (a separate `LIQ` invoice when the branch bills liquor separately). Every item must have been sent (`409 ORDER_HAS_UNSENT_ITEMS`). Order → BILLED, table → BILLING. A discount above the branch limit (`discountLimitBp`, default 10%) needs `billing.discount_override`, complimentary needs `billing.complimentary`, otherwise `403 APPROVAL_REQUIRED` with the permission; `422 COUPON_INVALID` |
| GET | `/orders/{id}/invoices` | `billing.create` | The order's tax invoices (not credit notes) |
| GET | `/invoices/{id}/credit-notes` | `billing.create` | Credit notes issued against the invoice, on any business day |
| GET | `/invoices?date=&status=` | `billing.create` | Summaries; today's business date by default |
| GET | `/invoices/{id}` | `billing.create` | Lines, taxes, discounts, charges, payments |
| POST | `/invoices/{id}/payments` | `billing.collect_payment` | `{payments:[{method: CASH\|CARD\|UPI\|WALLET\|CREDIT\|AGGREGATOR, amount, tendered?, reference?, cardLast4?, terminalLabel?}]}`. Card/UPI are taken on the standalone terminal and the approval code / RRN keyed in. Split payment = several entries (`409 OVERPAYMENT` beyond the balance). Cash needs an open shift on this counter (`409 SHIFT_NOT_OPEN`). CREDIT needs `billing.credit_sale` and a customer name. All of an order's invoices settled → order PAID, table CLEANING |
| POST | `/invoices/{id}/cancel` | `billing.cancel` or approval | `{version, reason}`. Cancels the bill and its INV/LIQ sibling; the number stays used. Payments taken in the current shift are reversed; older ones need a refund. The order reopens |
| POST | `/invoices/{id}/refunds` | `billing.refund` or approval | `{lines?:[{invoiceLineId, quantity}] \| amount?, method, reference?, reason}` → `{creditNote, invoice}`. The credit note (`CN` series) reverses tax in proportion; refunding everything left also returns charges and round-off. Paid out at once as a negative payment |
| POST | `/invoices/{id}/print` | `billing.create`; a reprint needs `billing.reprint` or approval | `{printerId?}` → `{printerId, mode: TEXT\|RASTER, bytes}`. The first print is the original, later ones say DUPLICATE. `409 NO_PRINTER`, `503 PRINTER_OFFLINE` |
| GET | `/invoices/{id}/receipt` | `billing.create` | The receipt as a `PrintDocument`, for an on-screen preview or browser printing when no printer answers |
| POST | `/cash-shifts/{id}/print` | `cash.shift_manage` | X or Z report on the REPORT (else BILL) printer |
| POST | `/cash-shifts` | `cash.shift_manage` | `{openingFloat}`; one open shift per paired device (or per user on an unpaired browser), `409 SHIFT_ALREADY_OPEN` |
| GET | `/cash-shifts/current`, `/cash-shifts/{id}` | `cash.shift_manage` | X report while open, Z report once closed: expected cash, sales, refunds, per-method and per-terminal tenders |
| POST | `/cash-shifts/{id}/close` | `cash.shift_manage` | `{version, countedCash, denominations?, tenders:[{method, terminalLabel, reportedAmount}], notes?}` → Z report with variances (stored in `shift_tender_counts`) |
| GET/POST/PATCH | `/coupons` | `settings.manage` | `{code, kind: PERCENT\|FIXED, value, maxDiscount?, minBill, validFrom?, validTo?, usageLimit?}` |

Invoice numbers are gapless per branch, series and financial year (`KOL1/2026-27/000123`, `KOL1/LIQ/…`, `KOL1/CN/…`), taken from `document_sequences` inside the invoice's transaction. Restaurant service is supplied where the restaurant is, so bills always carry CGST + SGST (IGST is supported by the engine). Tax is per line with banker's rounding, bill discounts are spread over lines before tax, and the total is rounded to the branch's cash rounding (`roundOff`).

### Printing
Implemented in Sprint 5B. Contracts: `packages/contracts/src/http/printing.ts`; templates in `packages/application/src/printing/templates.ts`.

Slips are built as a `PrintDocument` (text, rows, rules, QR, cut) and sent as ESC/POS: **text mode** for English, **raster mode** (an image drawn by Chromium with the Noto fonts) when the receipt languages include Hindi or Bengali. The printer is chosen by purpose (BILL, KOT per kitchen station, REPORT), over TCP 9100, a device file or the OS spooler (`lp`). Fired KOTs print at their station's printer automatically. A Bluetooth LE printer is driven by the tablet it is paired with (`409 PRINTER_ON_DEVICE`). `POST /printers/{id}/test` prints a test page.

### Customers
Implemented in Sprint 5B (WP 5.6). Contracts: `packages/contracts/src/http/customers.ts`.

`GET /customers?q=` (phone or name) [`customers.view`, `customers.manage` or `billing.create`] · `GET /customers/{id}` (visits, lifetime value, recent bills) · `POST /customers` · `PATCH /customers/{id}` [`customers.manage`]. Indian mobile numbers are stored as `+91XXXXXXXXXX`. Giving `customer.phone` on a bill finds or creates the customer; a visit and the amount are added when the order is paid, and a refund lowers the lifetime value. Loyalty points are Phase 2.

### Reports (Phase 1 subset)
Implemented in Sprint 5B (WP 5.7). Contracts: `packages/contracts/src/http/reports.ts`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/reports/day-end?date=` | `reports.sales` | One business day (today by default): orders and covers by type; sales (gross, discounts, charges, taxable, tax, round-off, total, net of credit notes, average bill); tax per code and rate; liquor bills and VAT; payments per method; refunds; cancelled bills, items voided after the KOT, wastage; discounts by kind; per sales channel orders, sales, commission (on the food value) and net revenue; cash shifts with expected/counted/variance; top items; bills per hour; KOT count, average cook time, late KOTs |
| POST | `/reports/day-end/print?date=` | `reports.sales` | The day-end slip on the REPORT (else BILL) printer |
| GET | `/reports/day-end.csv?date=` | `reports.export` | The same as one CSV of labelled sections |
| GET | `/reports/sales-register.csv?from=&to=` | `reports.export` | Every invoice and credit note in the range (up to 366 days) with CGST, SGST, IGST, VAT per row; credit notes negative. For the accountant's GSTR-1 and VAT returns |
| GET | `/reports/dashboard` | `reports.sales` | Net sales, bills, covers and average bill for today, the month and the financial year (from 1 April); the last 14 days; today's payment mix; the month's top items; kitchen pending/late/average; open orders and tables |

CSV files start with a byte-order mark and use CRLF so Excel shows Hindi and Bengali text; amounts are rupees with two decimals; text that a spreadsheet would run as a formula is prefixed with `'`. PDF and XLSX exports wait until an owner asks for them (each would add a dependency).

### Public QR ordering (no auth, rate-limited)
`GET /public/qr/{qrToken}/menu` · `POST /public/qr/{qrToken}/orders` → order in `PENDING_APPROVAL`, captain notified to confirm.

### Admin / platform
`GET /audit-logs?entityType=&entityId=&actorId=` [`audit.view`] · `GET /health` (no auth: db, disk, printer, sync status)

**Backups** [`backup.manage`], implemented in Sprint 5B (WP 5.8), contracts `packages/contracts/src/http/backups.ts`:

| Method | Path | Notes |
|---|---|---|
| GET | `/backups` | `{data, backupDir, copyDir}`: each backup's file, size, kind (SCHEDULED, MANUAL, PRE_MIGRATION, PRE_RESTORE, IMPORTED), status (AVAILABLE, PRUNED, MISSING), schema version, second copy |
| POST | `/backups` | A backup now (201) |
| GET | `/backups/{id}/download` | The `.rbak` file |
| POST | `/backups/import` | Body: the `.rbak` file as `application/octet-stream`; header `X-Backup-Passphrase`. Checked (checksum, passphrase, integrity) before it is listed. `422 BACKUP_UNREADABLE` / `BACKUP_UNAVAILABLE` |
| POST | `/backups/{id}/restore` | `{confirm: "RESTORE", passphrase?}` → `202 {backup, restarting: true}`. Verifies the file, takes a PRE_RESTORE backup, stages the decrypted copy and restarts the Hub, which swaps it in before opening the database. Clients see the socket drop and resync. A passphrase is needed only for a backup made with a different one |

A `.rbak` file is a one-line header (format, time, kind, scrypt parameters and salt, schema version, organisation, SHA-256) followed by a SQLCipher database (AES-256, per-page HMAC) keyed with the key derived from the owner's backup passphrase. It never opens with the Hub's own database key, and opens on any PC with the passphrase. Backups run hourly when something changed, are kept 7 hourly / 30 daily / 12 monthly (10 of each other kind), and are copied to `RESTRO_BACKUP_COPY_DIR` (USB drive / NAS) when set.

## 3. Phase 2–6 endpoint groups (outline)

| Phase | Group | Key endpoints |
|---|---|---|
| 2 | Inventory | `/inventory-items`, `/recipes`, `/stock` (levels), `/stock/adjustments`, `/stock/wastage`, `/stock-counts` (+`/post`), `/stock/alerts` |
| 3 | Purchasing | `/vendors`, `/purchase-orders` (+`/approve`, `/send`), `/grns` (+`/post`), `/vendor-payments`, `/vendors/{id}/statement` |
| 4 | Accounting | `/accounts`, `/journal-entries` (+`/reverse`), `/expenses`, `/ledgers/{accountId}`, `/ledgers/party/{type}/{id}` |
| 5 | Reporting | `/reports/{sales\|items\|tax\|gstr1\|pnl\|balance-sheet\|cash-flow\|inventory-valuation\|consumption-variance}` |
| 6 | Sync | `/sync/status`, `/sync/conflicts` (+`/resolve`), `/sync/retry` · cloud side: `POST /sync/push`, `GET /sync/pull` |

## 4. Bluetooth LE interface

The Hub exposes one GATT service, `RestroOS Hub`. UUIDs, frame codec, schemas and the route allow-list live in `packages/contracts/src/ble/` (import `@restroos/contracts/ble`); that code is the normative definition and this section summarises it.

| Attribute | UUID | Properties | Content |
|---|---|---|---|
| service | `c8ef0001-26b7-4e9e-97bd-541662ebe8e4` | primary, advertised | |
| `hub-info` | `c8ef0002-26b7-4e9e-97bd-541662ebe8e4` | read | JSON, at most 512 B: `{hubId, name (≤ 24 chars), urls: ["https://192.168.1.20:7400"] (1–3), caFingerprint (SHA-256 of the CA cert DER, lowercase hex), protocol: 1, mtu?}`. `mtu` is the ATT MTU negotiated with the central that is reading it. Web Bluetooth does not expose the MTU, so tablets use this value to size frames, or 23 if it is missing |
| `pairing` | `c8ef0003-26b7-4e9e-97bd-541662ebe8e4` | read (rotates every 60 s) | `{hubId, nonce (≥ 128 random bits, base64url), expiresAt (epoch ms)}`: the same one-time nonce the on-screen QR shows |
| `cmd-in` | `c8ef0004-26b7-4e9e-97bd-541662ebe8e4` | write, write without response | Frames of a request `{id, method, path, headers, body}` |
| `evt-out` | `c8ef0005-26b7-4e9e-97bd-541662ebe8e4` | notify | Frames of responses `{id, status, headers, body}` and of events (the §5 envelope `{type, seq, branchId, occurredAt, data}`) |

Values longer than MTU − 1 are read with Read Blob requests, which Chrome and Android do automatically. Each read value fits within the 512-byte attribute limit.

**Frames.** Each ATT write or notification carries one frame. Multi-byte fields are little-endian, as everywhere else in GATT.

| Offset | Size | Field |
|---|---|---|
| 0 | 2 | `msgId` u16: one counter per sender and direction, wraps at 65 536 |
| 2 | 2 | `seq` u16: 0, 1, 2, … within the message |
| 4 | 1 | `flags`: bit 0 `LAST`, bit 1 `COMPRESSED`, bits 2–7 reserved (0) |
| 5 | n | payload slice |

- **Size.** An ATT write or notification carries at most MTU − 3 bytes, and no attribute value may exceed 512 bytes. A frame is therefore at most `min(MTU − 3, 512)` bytes, and its payload at most `min(MTU − 3, 512) − 5` bytes: 15 B at MTU 23, 177 B at 185, 239 B at 247 and 507 B at 517. Every frame except the last is full. An empty message is one header-only `LAST` frame.
- **Compression.** When a compressor is available, a message of more than 512 B is gzip-compressed (RFC 1952) if that makes it smaller. Every frame of a compressed message carries `COMPRESSED`.
- **Limits.** A message may be at most 256 KiB on the wire and 256 KiB after decompression, and up to 65 536 frames. A partial message is dropped after 10 s with no new frame. At most 16 messages may be in progress per link.
- **Errors.** No frame is ever retransmitted. A frame whose `seq` was already received is dropped as a duplicate. A skipped or reordered `seq` drops the whole message (`GAP`), as do mixed `COMPRESSED` flags or an oversize message. A frame with reserved flag bits set is dropped. When a request goes unanswered, the client retries it with a new `msgId` and the same `Idempotency-Key`.
- **msgIds on `evt-out`.** The Hub uses one counter across all links. Some stacks (BlueZ's D-Bus API) send a notification to every subscribed central, so tablets must ignore responses whose `id` they did not send.

**Envelopes.** `path` is relative to `/api/v1` and may include a query string. Header names are lowercase. `authorization` carries the access JWT, and the same JWT and RBAC checks apply as over HTTPS. A response has `status`; an event has `type`.

**Allow-list.** The fallback channel accepts only: `POST /auth/refresh`, `GET|POST /orders`, `GET /orders/{id}`, `POST /orders/{id}/items`, `PATCH /orders/{id}/items/{itemId}`, `POST /orders/{id}/kots`, `GET /kitchen/kots`, `POST /kitchen/kots/{id}/status` and `POST /kitchen/kots/{id}/items/{itemId}/ready`. Any other route returns `403` with code `BLE_ROUTE_NOT_ALLOWED`. Routes that need an approver token are left out because `/auth/approve` is not on the list either. The device must already have been paired over LAN or QR.

**Open items for Phase 1.5:**
- **Refresh token.** BLE has no cookie jar, so the Android app needs another way to present its refresh token to `/auth/refresh`.
- **Pairing nonce exposure.** Anyone within radio range can read the nonce, which can be 10–30 m and outside the restaurant, while the QR needs line of sight. Pairing therefore needs a confirmation on the Hub.
- **Event acks.** `resume`/`ack` for events over BLE are not designed yet.
- **Spike results.** The Sprint 1 spike (`spikes/bluetooth/RUNBOOK.md`) records measured throughput, latency and link limits.

## 5. WebSocket protocol

Implemented in Sprint 4. Contracts: `packages/contracts/src/ws/messages.ts`. Gateway: `apps/server/src/ws/gateway.ts`.

Endpoint `ws://<hub>:7400/ws` or `wss://<hub>:7443/ws`. The access token is never put in the URL (it would end up in logs): the first message must be `{type:"auth", token}`, sent again after every token refresh. Without it the server closes the socket after 5 s with code `4401`. A paired TOKEN_DISPLAY device with nobody signed in sends `token: null` and is recognised by its device cookie.

```jsonc
// server → client
{ "type": "hello", "seq": 18230, "topics": ["floor", "tokens"] }
{ "type": "kitchen.kot.fired", "seq": 18233, "branchId": "…", "occurredAt": "…", "data": { "kot": { /* Kot */ } } }
// client → server
{ "type": "auth", "token": "<access JWT>" }
{ "type": "resume", "lastSeq": 18233 }
{ "type": "ping" }
```

Every message carries the **current state** of one entity (never a diff), so clients keep the one with the highest `version`. One command's events are coalesced: firing an order sends one `ordering.order.updated`, not one per event.

| Message | Topic | Payload |
|---|---|---|
| `floor.table.status_changed` | floor | tableId, status, orderId, version |
| `ordering.order.updated` | floor | order summary (after any order or KOT change) |
| `kitchen.kot.fired` | kitchen | full KOT with items, notes, add-ons |
| `kitchen.kot.status_changed` | kitchen, floor | from, to, full KOT (captains alert on READY) |
| `kitchen.kot.updated` | kitchen | full KOT (item bumped or cancelled, chef assigned, moved by a merge) |
| `kitchen.kot.delayed` | kitchen | kotId, overdueSeconds; once per KOT, from a 15 s scan; not replayed |
| `token.ready` | tokens | tokenNo, orderId |
| `menu.changed` | floor, kitchen | none: refetch `GET /menu` (304 if unchanged) |

**Topics follow permissions**, re-checked every 60 s: `floor` with `tables.view`, `billing.create` or `floor.manage`; `kitchen` with `kds.view`; `tokens` for everyone. When the token expires or the session is revoked the server sends `unauthenticated` and only `tokens` messages flow until a fresh `auth`. `billing.invoice.paid` and `notification.created` arrive with Sprint 5.

**Gap recovery**: on reconnect the client sends `{type:"resume", lastSeq}` and the server replays the latest state of every entity changed since, from `domain_events`. If more than 2,000 events were missed, or `lastSeq` is ahead of the Hub (a restored backup), it answers `{type:"resync"}` and the client refetches. A client that can't keep up (over 1 MB buffered) is disconnected with `4408` and resumes.
