import type { InvoicesResponse, OrdersResponse } from '@restroos/contracts';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '../../app/providers';
import { makeInvoice, summaryOfInvoice } from '../../test/billing-fixtures';
import { envelope, makeOrder, summaryOf } from '../../test/order-fixtures';
import { applyLiveMessage } from '../live/apply-message';
import { ORDER_KEYS } from '../orders/order-queries';
import { BILLING_KEYS } from './billing-queries';

describe('billing live updates', () => {
  it('puts an updated invoice into the day lists it belongs in, and out of the others', () => {
    const c = createQueryClient();
    const unpaid = makeInvoice();
    c.setQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-28', null), {
      data: [summaryOfInvoice(unpaid)],
    });
    c.setQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-28', 'UNPAID'), {
      data: [summaryOfInvoice(unpaid)],
    });
    c.setQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-27', null), { data: [] });

    const paid = summaryOfInvoice(makeInvoice({ status: 'PAID', paidTotal: 97000, version: 2 }));
    applyLiveMessage(c, envelope('billing.invoice.updated', { invoice: paid }));
    expect(
      c.getQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-28', null))!.data,
    ).toEqual([paid]);
    expect(
      c.getQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-28', 'UNPAID'))!.data,
    ).toEqual([]);
    expect(
      c.getQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-27', null))!.data,
    ).toEqual([]);

    // An older version arriving late changes nothing.
    applyLiveMessage(c, envelope('billing.invoice.updated', { invoice: summaryOfInvoice(unpaid) }));
    expect(
      c.getQueryData<InvoicesResponse>(BILLING_KEYS.invoices('2026-10-28', null))!.data,
    ).toEqual([paid]);
  });

  it('moves a billed order from the open list to the billed list', () => {
    const c = createQueryClient();
    const open = makeOrder();
    c.setQueryData<OrdersResponse>(ORDER_KEYS.open, { data: [summaryOf(open)] });
    c.setQueryData<OrdersResponse>(ORDER_KEYS.billed, { data: [] });
    const billed = summaryOf(makeOrder({ status: 'BILLED', version: 2 }));
    applyLiveMessage(c, envelope('ordering.order.updated', { order: billed }));
    expect(c.getQueryData<OrdersResponse>(ORDER_KEYS.open)!.data).toEqual([]);
    expect(c.getQueryData<OrdersResponse>(ORDER_KEYS.billed)!.data).toEqual([billed]);
  });
});
