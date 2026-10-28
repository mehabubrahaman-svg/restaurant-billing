# ADR 0002 — Money, rates and quantities as integers

- Status: Proposed
- Date: 2026-10-28

## Decision
Money is stored as integer minor units, rates as basis points, and stock as integer milli-units of the base unit (g/ml/pc). All arithmetic goes through `Money`/`Quantity` value objects with explicit rounding.

## Consequences
No floating-point drift in GST computations or stock balances. The UI formats values for display. Reports and exports convert values at the edge.
