# ADR 0005 — India only: GST, state VAT on liquor, data-driven state packs

- Status: Accepted
- Date: 2026-10-28

## Context
The product targets restaurants in all Indian states. It launches in the North, East and North-East, then the West, South and Central states. Food is taxed under GST. Alcoholic liquor is outside GST and taxed with state VAT, and many states expect it on a separate bill. Some states prohibit liquor. Restaurant food sold through e-commerce operators has GST paid by the operator. E-invoicing (IRN) is not needed yet.

## Decision
- Tax type (`GST` | `VAT` | `NONE`) belongs to the **item's tax group**, not the branch. One order may produce a GST invoice and a separate `LIQ`-series liquor invoice.
- All state differences (liquor permitted, separate-bill default, VAT rates, languages, receipt wording) are **data**: the `indian_states` table plus a JSON state pack per state.
- `sales_channels.gst_paid_by_operator` is snapshotted onto each invoice.
- E-invoicing is **deferred**. It will be a later migration (IRN, ack no./date, signed QR) and an outbox job that submits B2B invoices when online.
- Money is integer paise. No multi-currency.

## Consequences
- Opening a new state = reviewing its state pack and enabling its wave. No billing code changes.
- Seeded prohibition and liquor-billing defaults must be verified with a tax advisor before each state goes live.
