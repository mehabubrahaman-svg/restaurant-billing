# ADR 0007 — Swiggy/Zomato: manual channel entry first, middleware later

- Status: Accepted
- Date: 2026-10-28

## Context
Aggregators push orders over the internet to a public endpoint, but the Hub lives on a private LAN. Aggregators typically approve POS integrations through partner programmes, and each has a different API.

## Decision
- **Phase 1**: manual entry against a `sales_channel` (external order id, OTP, commission, `AGGREGATOR` payment method, `gst_paid_by_operator`). Gives per-channel net revenue and correct GST treatment immediately.
- **Phase 5**: automated ingestion through an aggregator **middleware** provider, via a thin **cloud relay** that the Hub reaches over an *outbound* connection. Menu, price and stock availability are pushed back the same way. Orders are de-duplicated by `(sales_channel_id, external_order_id)`.
- Direct aggregator APIs are possible later as additional channel adapters.

## Consequences
The cloud relay is the first cloud component, ahead of full sync (Phase 6), and is designed to be reused by it.
