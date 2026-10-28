# ADR 0009 — Synchronous transactions; slow I/O only after commit

- Status: Accepted
- Date: 2026-10-28

## Context
better-sqlite3 is synchronous and shares one connection per process. If a command awaited a promise while its transaction was open, other requests would run their statements inside that transaction.

## Decision
`UnitOfWork.run(context, work)` takes a **synchronous** `work` function. The SQLite implementation rejects a `work` that returns a promise and rolls it back. Anything slow or fallible (printing, network, cloud sync, notifications) happens **after commit**, in handlers of the published domain events.

## Consequences
- Transactions are short (milliseconds) and can't interleave, which is what makes `BEGIN IMMEDIATE` inventory locking and gapless invoice numbers safe.
- A PostgreSQL adapter (Phase 6) will need an async variant of the port. Command handlers keep the same shape (load → decide → save, no I/O inside), so the change stays in the adapter layer.
