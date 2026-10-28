# 02 — Folder Structure

pnpm + Turborepo monorepo. The **dependency direction is enforced** by per-layer `no-restricted-imports` rules in the root `eslint.config.js`, so CI fails if, for example, `domain` imports anything or `application` imports `infrastructure`. Arrows mean "may import":

```
apps/*  ──►  packages/server-*  ──►  packages/application  ──►  packages/domain
   │                                         ▲
   └──────►  packages/ui, packages/contracts ┘   (contracts = Zod schemas shared by API + UI)
```

```
restaurant-billing/
├── apps/
│   ├── desktop/                     # Electron shell (Hub). Starts the server, owns OS integration
│   │   ├── src/main/                #   main process: window, tray, auto-start, auto-update
│   │   ├── src/preload/             #   contextBridge (printers, backup paths) — no Node in renderer
│   │   └── electron-builder.yml     #   Windows NSIS + Linux AppImage/deb
│   ├── server/                      # Fastify composition root (also runnable headless as a service)
│   │   ├── src/main.ts              #   bootstrap: config → DB → migrate → DI container → routes
│   │   ├── src/container.ts         #   awilix registrations
│   │   ├── src/http/                #   route modules per context, auth & RBAC preHandlers
│   │   ├── src/ws/                  #   WebSocket gateway, rooms, event → message mapping
│   │   └── src/jobs/                #   backup, KOT-delay watcher, low-stock scan, sync worker
│   └── web/                         # React SPA served by the Hub to every device
│       ├── src/app/                 #   router, providers (Query, Theme, Auth), layout shells
│       ├── src/portals/
│       │   ├── admin/               #   dashboard, users, settings, menu, floor editor
│       │   ├── captain/             #   floor view, order pad (tablet-first)
│       │   ├── kitchen/             #   KDS board, chef assignment, metrics
│       │   ├── pos/                 #   billing counter, payments, shifts
│       │   ├── inventory/           #   Phase 2
│       │   ├── purchase/            #   Phase 3 (vendor portal)
│       │   ├── accounts/            #   Phase 4
│       │   ├── reports/             #   Phase 5
│       │   ├── token-display/       #   order-ready token TV
│       │   └── qr-menu/             #   guest self-ordering (public)
│       ├── src/features/            #   cross-portal features (auth, notifications, customer lookup)
│       ├── src/stores/              #   Zustand stores (cart, session, ui)
│       ├── src/api/                 #   typed client generated from contracts + React Query hooks
│       └── src/sw/                  #   service worker, IndexedDB offline command queue
│
├── packages/
│   ├── domain/                      # Pure TypeScript. No I/O, no framework imports
│   │   └── src/
│   │       ├── shared/              #   Money, Quantity, Rate, BusinessDate, Result, DomainEvent, Entity
│   │       ├── identity/            #   User, Role, Permission, PasswordPolicy
│   │       ├── catalog/             #   MenuItem, Variant, AddonGroup, TaxGroup
│   │       ├── floor/               #   DiningTable (state machine), Reservation
│   │       ├── ordering/            #   Order aggregate, OrderItem, events
│   │       ├── kitchen/             #   Kot aggregate (NEW→ACCEPTED→COOKING→READY→SERVED)
│   │       ├── billing/             #   Invoice, TaxCalculator, Payment, CashShift
│   │       ├── crm/                 #   Customer, LoyaltyPolicy
│   │       ├── inventory/           #   StockItem, Recipe, ConsumptionService
│   │       ├── purchasing/          #   PurchaseOrder, Grn, Vendor
│   │       ├── accounting/          #   JournalEntry (balanced invariant), PostingRules
│   │       └── templates/           #   default roles, chart of accounts, tax groups (setup wizard)
│   ├── application/                 # Use cases (CQRS). Depends on domain + ports only
│   │   └── src/
│   │       ├── ports/               #   UnitOfWork, repositories, Clock, IdGenerator, Printer, EventBus
│   │       ├── <context>/commands/  #   e.g. ordering/commands/fire-kot.ts (+ .test.ts)
│   │       ├── <context>/queries/   #   e.g. kitchen/queries/get-active-kots.ts
│   │       └── <context>/policies/  #   event handlers: InvoicePaid → PostSalesJournal, DeductStock
│   ├── contracts/                   # Zod request/response/WS message schemas, shared with web
│   ├── infrastructure/              # Adapters implementing ports
│   │   └── src/
│   │       ├── db/                  #   connection (SQLCipher, pragmas), migrator, unit of work
│   │       ├── repositories/        #   one per aggregate
│   │       ├── read-models/         #   SQL for queries/reports
│   │       ├── events/              #   event store + outbox writer, in-process bus
│   │       ├── auth/                #   bcrypt, JWT (jose), refresh-token store
│   │       ├── printing/            #   ESC/POS templates (bill, KOT, report), adapters
│   │       ├── export/              #   PDF / XLSX / CSV writers
│   │       └── sync/                #   Phase 6 cloud client
│   ├── ui/                          # shadcn/ui components + design tokens + POS-specific widgets
│
├── database/
│   ├── migrations/                  # Ordered SQL migrations (source of truth for schema)
│   └── seeds/dev/                   # demo restaurant data for local development
├── docs/                            # This documentation set + ADRs
├── spikes/bluetooth/                # Sprint 1 Bluetooth spike: hub GATT prototype + measurement page (not shipped)
├── e2e/                             # Playwright suites (captain → KDS → POS happy paths)
├── scripts/                         # dev tooling (db reset, seed, release)
├── tsconfig.base.json · eslint.config.js · .prettierrc.json   # shared config lives at the root
├── turbo.json · pnpm-workspace.yaml · package.json
└── README.md
```

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `fire-kot.handler.ts` |
| Commands / queries | imperative / `Get…` | `FireKot`, `GetActiveKots` |
| Events | past tense | `KotFired`, `InvoicePaid` |
| DB tables / columns | snake_case plural / snake_case | `order_items.unit_price` |
| Permissions | `module.action` | `billing.refund` |
| API paths | plural nouns, actions as sub-resources | `POST /orders/{id}/kots` |
| WS messages | `context.event` | `kitchen.kot.status_changed` |
