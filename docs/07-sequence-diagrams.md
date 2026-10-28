# 07 — Sequence Diagrams

## 7.1 Login and token refresh

```mermaid
sequenceDiagram
  autonumber
  participant D as Device (browser/PWA)
  participant API as Hub API
  participant DB as SQLite
  D->>API: POST /auth/login {username, password, deviceId}
  API->>DB: SELECT user, roles, permissions (branch-scoped)
  API->>API: bcrypt.compare (cost 12) / lockout check
  API->>DB: INSERT refresh_tokens (hash, family) + audit_logs(auth.login)
  API-->>D: 200 {accessToken(15m), permissions} + Set-Cookie refresh (httpOnly)
  Note over D: access token kept in memory only
  D->>API: POST /auth/refresh (cookie)
  API->>DB: verify hash, not revoked, not expired
  alt token already used (replay)
    API->>DB: revoke whole family + audit(auth.token_reuse)
    API-->>D: 401
  else valid
    API->>DB: revoke old, insert new (same family)
    API-->>D: 200 {accessToken} + new cookie
  end
```

## 7.2 Captain takes order → KOT → Kitchen (core flow)

```mermaid
sequenceDiagram
  autonumber
  actor C as Captain (tablet)
  participant API as Hub API
  participant H as FireKot handler
  participant DB as SQLite
  participant BUS as Event bus
  participant WS as WS gateway
  actor K as KDS screen
  participant INV as Inventory policy (Phase 2)

  C->>API: POST /orders {DINE_IN, tableId:T2, covers:4}
  API->>DB: BEGIN IMMEDIATE · INSERT orders · UPDATE dining_tables OCCUPIED (version check) · events · audit · COMMIT
  API-->>C: 201 order
  WS-->>C: floor.table.status_changed (all captains see T2 occupied)
  C->>API: POST /orders/{id}/items [Chicken Biryani x2 "Less spicy" + Raita]
  API-->>C: 200 (items PENDING, totals)
  C->>API: POST /orders/{id}/kots  (Idempotency-Key)
  API->>H: FireKot(orderId, actor)
  H->>DB: BEGIN IMMEDIATE
  H->>DB: group PENDING items by kitchen_station
  H->>DB: next kot_no (per branch/day) · INSERT kots · UPDATE order_items SENT, kot_id
  H->>DB: INSERT domain_events(KotFired) · audit_logs · sync_queue
  H->>DB: COMMIT
  H->>BUS: publish KotFired
  BUS->>WS: kitchen.kot.fired → room kds:station:{id}
  WS-->>K: new KOT card (sound + slide-in)
  BUS->>INV: deduct recipe ingredients (own transaction)
  API-->>C: 201 [kots]
  K->>API: POST /kitchen/kots/{id}/status {ACCEPTED}
  K->>API: POST /kitchen/kots/{id}/status {COOKING}
  K->>API: POST /kitchen/kots/{id}/status {READY}
  API->>DB: UPDATE kots (state machine + version) · INSERT kot_status_events · events
  BUS->>WS: kitchen.kot.status_changed
  WS-->>C: "T2 — Chicken Biryani READY" notification
  C->>API: POST /kitchen/kots/{id}/status {SERVED}
```

## 7.3 Offline captain tablet (Wi-Fi drop)

```mermaid
sequenceDiagram
  autonumber
  actor C as Captain PWA
  participant Q as IndexedDB command queue
  participant API as Hub API
  C->>API: POST /orders/{id}/items
  API--xC: network error
  C->>Q: enqueue {method, path, body, Idempotency-Key}
  Note over C: UI shows item as "queued" (optimistic) · status pill "Offline · 1 queued"
  loop every 2s with backoff / on 'online' event
    Q->>API: replay oldest command (same Idempotency-Key)
    alt 2xx or idempotent replay
      API-->>Q: response → dequeue, reconcile UI
    else 409 VERSION_CONFLICT / INVALID_STATE
      API-->>Q: current state → mark failed, show "needs attention"
    end
  end
  Note over C,API: Firing a KOT while offline is allowed to queue,<br/>but the UI warns: "Kitchen not notified yet"
```

## 7.4 Billing with split payment

```mermaid
sequenceDiagram
  autonumber
  actor P as Cashier (POS)
  participant API as Hub API
  participant DB as SQLite
  participant BUS as Event bus
  participant PR as Print service
  actor M as Manager

  P->>API: POST /invoices/preview {discount 10%}
  API-->>P: totals (discount exceeds cashier limit 5% → approvalRequired)
  M->>API: POST /auth/approve {pin, action: billing.discount_override}
  API-->>P: approverToken (60s)
  P->>API: POST /orders/{id}/invoice + X-Approver-Token
  API->>DB: BEGIN IMMEDIATE
  API->>DB: UPDATE document_sequences (gapless invoice no)
  API->>DB: INSERT invoices, invoice_lines (frozen), invoice_taxes (CGST/SGST), invoice_discounts(approved_by)
  API->>DB: UPDATE orders BILLED · dining_tables BILLING
  API->>DB: events(InvoiceIssued) · audit(actor + approver) · sync_queue · COMMIT
  API-->>P: invoice
  P->>API: POST /invoices/{id}/payments [{CASH 1000},{UPI 1078, ref}]
  API->>DB: BEGIN IMMEDIATE · INSERT payments x2 · invoice PAID · order PAID · table CLEANING · events(InvoicePaid) · COMMIT
  BUS->>BUS: policies: PostSalesJournal (Ph4) · AccrueLoyalty · UpdateCustomerStats
  P->>API: POST /invoices/{id}/print
  API->>PR: render ESC/POS template → printer
  PR-->>API: ok / error (error → notification, bill stays valid)
```

## 7.5 Refund (credit note)

```mermaid
sequenceDiagram
  autonumber
  actor P as Cashier
  actor M as Manager
  participant API as Hub API
  participant DB as SQLite
  P->>API: POST /invoices/{id}/refunds {lines, method: CASH, reason}
  API-->>P: 403 APPROVAL_REQUIRED (billing.refund)
  M->>API: POST /auth/approve {pin, action: billing.refund}
  P->>API: retry + X-Approver-Token
  API->>DB: BEGIN IMMEDIATE
  API->>DB: INSERT invoices(kind=CREDIT_NOTE, original_invoice_id, own CN number)
  API->>DB: INSERT payments(amount < 0, refund_of_payment_id, approved_by)
  API->>DB: UPDATE original invoice status PARTIALLY_REFUNDED/REFUNDED
  API->>DB: events(CreditNoteIssued) · audit(actor, approver, reason) · COMMIT
  API-->>P: credit note (printable)
```

## 7.6 Purchase → GRN → Inventory → Accounts (Phase 3/4)

```mermaid
sequenceDiagram
  autonumber
  actor S as Inventory staff
  actor MG as Manager
  participant API as Hub API
  participant DB as SQLite
  participant BUS as Event bus
  S->>API: POST /purchase-orders (vendor, lines)
  MG->>API: POST /purchase-orders/{id}/approve
  API->>API: render PO PDF / share via WhatsApp/email when online
  Note over S: Vendor delivers
  S->>API: POST /grns {poId, lines(qty received, rejected, batch, expiry)}
  S->>API: POST /grns/{id}/post
  API->>DB: BEGIN IMMEDIATE
  API->>DB: INSERT stock_batches · stock_movements(PURCHASE +qty) · UPDATE inventory_stock (qty, weighted avg cost)
  API->>DB: UPDATE purchase_order_lines.received · PO status
  API->>DB: INSERT journal_entries/lines (Dr Inventory, Dr Input GST / Cr AP-vendor)
  API->>DB: events(GrnPosted) · audit · COMMIT
  BUS->>BUS: clear low-stock notifications if above reorder level
```

## 7.7 Cloud sync push (Phase 6)

```mermaid
sequenceDiagram
  autonumber
  participant W as Sync worker (Hub)
  participant DB as SQLite
  participant C as Cloud API
  participant PG as PostgreSQL
  loop every 10s when online
    W->>DB: SELECT sync_queue PENDING/FAILED where next_attempt_at <= now LIMIT 500
    W->>DB: mark IN_FLIGHT
    W->>C: POST /sync/push {branchId, events[]} (gzip, mTLS)
    C->>PG: INSERT events ON CONFLICT (id) DO NOTHING · apply projections
    alt accepted
      C-->>W: {acceptedIds, conflicts[]}
      W->>DB: SYNCED · sync_state.last_pushed_seq
      W->>DB: conflicts → sync_conflicts (status CONFLICT)
    else network / 5xx
      W->>DB: FAILED · attempts+1 · next_attempt_at = now + backoff(attempts)
    end
  end
  W->>C: GET /sync/pull?cursor (HQ-owned master data)
  C-->>W: menu/price/tax changes
  W->>DB: apply in txn (HQ wins) · emit events → clients refresh menu
```
