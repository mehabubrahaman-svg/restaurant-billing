# ADR 0007 — Swiggy/Zomato: manual channel entry first, middleware later

- Status: Accepted
- Date: 2026-10-28

## Context
Aggregators push orders over the internet to a public endpoint, but the Hub lives on a private LAN. Aggregators typically approve POS integrations through partner programmes, and each has a different API.

## Decision
- **Phase 1**: manual entry against a `sales_channel` (external order id, OTP, commission, `AGGREGATOR` payment method, `gst_paid_by_operator`). Gives per-channel net revenue and correct GST treatment immediately.
- **Phase 5**: automated ingestion through an aggregator **middleware** provider, via a thin **cloud relay** that the Hub reaches over an *outbound* connection. Menu, price and stock availability are pushed back the same way. Orders are de-duplicated by `(sales_channel_id, external_order_id)`.
- Direct aggregator APIs are possible later as additional channel adapters.

## Implementation (Phase 5)
- The relay is `apps/relay`. It is a Fastify and `ws` service with its own SQLite: hubs, an inbox of webhooks waiting for the Hub, and an outbox for the middleware. Webhooks are HMAC-signed per hub. The Hub's key is kept only as a hash.
- The middleware speaks one documented JSON format (`packages/contracts/src/relay.ts`). Orders use the Hub's own ids, because the menu was pushed from the Hub. A provider with another format needs a small adapter in front of the relay. The format was not checked against a live provider: there is no partner account yet.
- On the Hub, `RelayClient` (`apps/server/src/relay`) keeps the outbound connection. `RelayIntegrationService` enters orders through the same aggregator flow as manual entry. Feeds push the menu, availability and order status.

## Consequences
The cloud relay is the first cloud component, ahead of full sync (Phase 6), and is designed to be reused by it.
