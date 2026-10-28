# RestroOS — Restaurant Management & Billing Platform

Offline-first, LAN-based restaurant POS and back office for single outlets through multi-branch chains. It covers captain ordering, a kitchen display, GST billing, inventory with recipe-based consumption, purchasing, accounting, and reports. It runs on one Windows/Linux PC with no internet required, and syncs to the cloud when available.

> **Status: Phase 0 — Planning.** This repository currently contains the architecture, database schema, and design documents. Application code begins in Phase 1 once these are reviewed.

## Stack
Electron · Node.js (Fastify) · SQLite (SQLCipher, WAL) · Drizzle · React + TypeScript · TailwindCSS · shadcn/ui · Framer Motion · TanStack Query · Zustand · WebSockets · pnpm/Turborepo

## Documentation

| # | Document |
|---|---|
| 1 | [System architecture](docs/01-architecture.md) — topology, Clean Architecture/CQRS/DDD, security, sync, open questions |
| 2 | [Folder structure](docs/02-folder-structure.md) |
| 3 | [Database design](docs/03-database-design.md) · SQL: [`database/migrations`](database/migrations) |
| 4 | [ER diagrams](docs/04-er-diagram.md) |
| 5 | [API specification](docs/05-api-specification.md) — REST + WebSocket |
| 6 | [UI wireframes & design system](docs/06-ui-wireframes.md) |
| 7 | [Sequence diagrams](docs/07-sequence-diagrams.md) |
| 8 | [Roadmap](docs/08-roadmap.md) |
| 9 | [Phase 1 implementation plan](docs/09-implementation-plan.md) |
| — | [Architecture decision records](docs/adr) |

## Portals
Admin · Captain · Kitchen (KDS) · POS Billing · Inventory · Vendor · Accounts · Reports · Token display · QR self-ordering

## Validating the schema

```bash
python3 -c "import sqlite3,glob; c=sqlite3.connect(':memory:'); [c.executescript(open(f).read()) for f in sorted(glob.glob('database/migrations/*.sql'))]; print('ok')"
```
