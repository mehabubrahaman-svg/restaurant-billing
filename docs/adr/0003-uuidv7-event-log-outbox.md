# ADR 0003 — UUIDv7 keys, domain event log and transactional outbox from day 1

- Status: Proposed
- Date: 2026-10-28

## Decision
All IDs are UUIDv7. Every command appends `domain_events` and a `sync_queue` row in the same transaction as the state change. Current state remains in normal relational tables (hybrid event sourcing).

## Consequences
- Cloud sync (Phase 6) needs no schema changes to existing tables, and nothing is lost on a crash.
- Realtime WebSocket updates and gap recovery use the same event `seq`.
- Storage overhead is ~40% more rows. Synced events older than 90 days can be archived.
