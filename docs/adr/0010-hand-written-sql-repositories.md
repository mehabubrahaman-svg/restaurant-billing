# ADR 0010 — Hand-written SQL repositories instead of Drizzle

- Status: Accepted (supersedes the Drizzle choice in 01-architecture §2)
- Date: 2026-10-28

## Context
The architecture planned Drizzle ORM for typed queries and an easy move to PostgreSQL. Sprint 2 added the first real repositories (users, roles, refresh tokens, settings, setup, audit queries). The schema is defined in SQL migrations, which are the source of truth: they carry STRICT types, CHECK constraints, append-only and no-delete triggers, and partial indexes, none of which Drizzle models. A Drizzle schema would be a second, hand-maintained copy of the same tables.

## Decision
Repositories and read models use prepared SQL statements through `better-sqlite3`, behind the application layer's ports (`UserRepository`, `IdentityQueries`, `SettingsRepository`, …). No ORM.

## Consequences
- One schema definition (the migrations). Queries are explicit, fast, and easy to review against the indexes.
- Portability comes from the ports, not the query builder: a PostgreSQL adapter (Phase 6) re-implements the repositories behind the same interfaces. The tests that run against the ports become the PostgreSQL adapter's acceptance tests.
- Row-to-domain mapping is written by hand. Each repository has integration tests through the API, which catch mapping mistakes.
