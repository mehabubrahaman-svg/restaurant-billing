# ADR 0001 — Electron + Node.js + SQLite LAN Hub

- Status: Proposed
- Date: 2026-10-28

## Context
The restaurant must keep operating without internet. Many devices (tablets, KDS screens, PCs) must share live state, on low-cost hardware, on Windows and Linux.

## Decision
One PC runs the **Hub**: an Electron app that embeds a Fastify HTTP/WebSocket server and an encrypted SQLite database. All other devices use the same React app through a browser/PWA over the LAN.

## Alternatives considered
- **.NET 9 / ASP.NET Core**: strong, but a second language. We'd lose shared Zod contracts with the UI.
- **Every device has its own DB with peer sync (CRDT)**: true peer-to-peer resilience, but much higher complexity, and invoice numbering/inventory locking need a single authority anyway.
- **PostgreSQL locally**: heavier install and service management on Windows, with no real benefit at single-branch scale.

## Consequences
- The Hub is a single point of failure. This is mitigated with backups (Phase 1) and a standby Hub (Phase 6).
- Clients need nothing installed. Updates ship once, to the Hub.
