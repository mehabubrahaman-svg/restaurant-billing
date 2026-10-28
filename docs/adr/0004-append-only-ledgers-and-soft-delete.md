# ADR 0004 — Append-only ledgers and soft delete enforced in the database

- Status: Proposed
- Date: 2026-10-28

## Decision
Physical DELETE is blocked by triggers on business tables. Payments, stock movements, journal lines, invoice lines/taxes, audit logs and events are fully append-only (no UPDATE either). Corrections are reversing entries; invoices are corrected with credit notes. The audit log is hash-chained.

## Consequences
Application bugs cannot destroy history. Someone with raw DB access could drop the triggers, but the audit hash chain makes such tampering detectable. "Undo" flows must be modelled explicitly as reversals.
