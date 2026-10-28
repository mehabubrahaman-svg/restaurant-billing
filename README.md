# RestroOS — Restaurant Management & Billing Platform

Offline-first, LAN-based restaurant POS and back office for Indian restaurants, from single outlets to multi-branch chains. It covers captain ordering, a kitchen display, GST billing (plus state VAT on liquor), inventory with recipe-based consumption, purchasing, accounting, and reports. It runs on one Windows/Linux PC with no internet required, and syncs to the cloud when available.

**Market**: India, all states. Launch wave covers the North, East and North-East; West, South and Central follow. **Languages**: English, हिन्दी, বাংলা.

> **Status: Phase 1, Sprint 1 (foundation).** Planning is complete. The monorepo, domain kernel, encrypted database layer, server skeleton, web shell with English/Hindi/Bengali, and Bluetooth spike harness are in place.

## Stack

Electron · Node.js (Fastify) · SQLite (SQLCipher, WAL) · Drizzle · React + TypeScript · TailwindCSS · shadcn/ui · Framer Motion · TanStack Query · Zustand · WebSockets · Bluetooth LE · i18next · Capacitor (Android tablet app) · pnpm/Turborepo

## Documentation

| #   | Document                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | [System architecture](docs/01-architecture.md) — topology, Clean Architecture/CQRS/DDD, security, sync, product decisions |
| 2   | [Folder structure](docs/02-folder-structure.md)                                                                           |
| 3   | [Database design](docs/03-database-design.md) · SQL: [`database/migrations`](database/migrations)                         |
| 4   | [ER diagrams](docs/04-er-diagram.md)                                                                                      |
| 5   | [API specification](docs/05-api-specification.md) — REST + WebSocket                                                      |
| 6   | [UI wireframes & design system](docs/06-ui-wireframes.md)                                                                 |
| 7   | [Sequence diagrams](docs/07-sequence-diagrams.md)                                                                         |
| 8   | [Roadmap](docs/08-roadmap.md)                                                                                             |
| 9   | [Phase 1 implementation plan](docs/09-implementation-plan.md)                                                             |
| —   | [Architecture decision records](docs/adr)                                                                                 |

## Portals

Admin · Captain · Kitchen (KDS) · POS Billing · Inventory · Vendor · Accounts · Reports · Token display · QR self-ordering

## Development

Requirements: Node.js 22.12+, pnpm 10 (`corepack enable`), and a C/C++ toolchain only if no prebuilt SQLite binary exists for your platform.

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs formatting, lint, typecheck and tests across the workspace. To run the Hub server locally (data goes to `./data`, encrypted with the given key):

```bash
RESTRO_DB_KEY=change-me-dev-key-0001 NODE_ENV=development pnpm --filter @restroos/server dev
```

Then, in another terminal, start the web app (it proxies `/api` to the server on port 7400):

```bash
pnpm --filter @restroos/web dev
```

## Validating the schema

```bash
pnpm db:validate
```
