import type {
  BillRequest,
  Invoice,
  InvoiceStatus,
  InvoiceSummary,
  InvoicesResponse,
  ShiftReport,
} from '@restroos/contracts';
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { isApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import { usePermission } from '../auth/permissions';

export const BILLING_KEYS = {
  all: ['billing'],
  preview: (orderId: string, version: number, request: BillRequest) =>
    ['billing', 'preview', orderId, version, request] as const,
  orderInvoices: (orderId: string) => ['billing', 'order-invoices', orderId] as const,
  invoiceLists: ['billing', 'invoices'],
  invoices: (date: string, status: InvoiceStatus | null) =>
    ['billing', 'invoices', date, status] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  creditNotes: (id: string) => ['billing', 'invoice', id, 'credit-notes'] as const,
  shifts: ['billing', 'shift'],
  currentShift: ['billing', 'shift', 'current'],
  shift: (id: string) => ['billing', 'shift', id] as const,
} as const;

/** Shared with the admin screens that edit them. */
export const BRANCH_SETTINGS_KEY = ['branch-settings'] as const;
export const CHARGE_RULES_KEY = ['charge-rules'] as const;

export function useBranchSettings() {
  return useQuery({
    queryKey: BRANCH_SETTINGS_KEY,
    queryFn: api.settings.branch,
    staleTime: 60_000,
  });
}

export function useChargeRules() {
  return useQuery({ queryKey: CHARGE_RULES_KEY, queryFn: api.chargeRules.list, staleTime: 60_000 });
}

/**
 * The live bill for an open order. Keyed by the order's version, so items a
 * captain adds (a live `ordering.order.updated`) recompute it; the last bill
 * stays on screen while the next one loads.
 */
export function useBillPreview(
  orderId: string,
  version: number,
  request: BillRequest,
  enabled: boolean,
) {
  return useQuery({
    queryKey: BILLING_KEYS.preview(orderId, version, request),
    queryFn: ({ signal }) => api.billing.preview(orderId, request, signal),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useOrderInvoices(orderId: string, enabled = true) {
  return useQuery({
    queryKey: BILLING_KEYS.orderInvoices(orderId),
    queryFn: async () => (await api.billing.orderInvoices(orderId)).data,
    enabled,
  });
}

export function useInvoices(date: string, status: InvoiceStatus | null) {
  return useQuery({
    queryKey: BILLING_KEYS.invoices(date, status),
    queryFn: () => api.billing.list(date, status ?? undefined),
  });
}

export function useInvoice(id: string, enabled = true) {
  return useQuery({
    queryKey: BILLING_KEYS.invoice(id),
    queryFn: () => api.billing.get(id),
    enabled,
  });
}

/** Credit notes issued against an invoice (its refunds). */
export function useCreditNotes(invoice: Pick<Invoice, 'id' | 'kind'>) {
  const notes = useQuery({
    queryKey: BILLING_KEYS.creditNotes(invoice.id),
    queryFn: async () => (await api.billing.creditNotes(invoice.id)).data,
    enabled: invoice.kind === 'INVOICE',
  });
  return notes.data ?? [];
}

/** The cash shift open on this device, or `null` when there is none (the Hub answers 404). */
export function useCurrentShift() {
  const allowed = usePermission('cash.shift_manage');
  return useQuery({
    queryKey: BILLING_KEYS.currentShift,
    enabled: allowed,
    queryFn: async (): Promise<ShiftReport | null> => {
      try {
        return await api.cashShifts.current();
      } catch (error) {
        if (isApiError(error, 'NOT_FOUND')) return null;
        throw error;
      }
    },
  });
}

export function useShift(id: string) {
  return useQuery({ queryKey: BILLING_KEYS.shift(id), queryFn: () => api.cashShifts.get(id) });
}

const NO_CANCEL = { cancelRefetch: false } as const;

/** Every invoice of an order is settled (paid, on credit, or cancelled/refunded). */
export function isSettled(invoice: Pick<Invoice, 'status'>): boolean {
  return invoice.status !== 'UNPAID' && invoice.status !== 'PARTIALLY_PAID';
}

/** A full invoice from a command response: the newest version wins everywhere it shows. */
export function setInvoice(client: QueryClient, invoice: Invoice): void {
  const held = client.getQueryData<Invoice>(BILLING_KEYS.invoice(invoice.id));
  if (held === undefined || held.version <= invoice.version) {
    client.setQueryData(BILLING_KEYS.invoice(invoice.id), invoice);
  }
  client.setQueryData<Invoice[]>(BILLING_KEYS.orderInvoices(invoice.orderId), (list) => {
    if (list === undefined) return list;
    const at = list.findIndex((i) => i.id === invoice.id);
    if (at === -1) return [...list, invoice];
    if (list[at]!.version > invoice.version) return list;
    return list.map((i) => (i.id === invoice.id ? invoice : i));
  });
  if (invoice.originalInvoiceId !== null) {
    // A credit note: it joins its invoice's list of refunds.
    client.setQueryData<Invoice[]>(BILLING_KEYS.creditNotes(invoice.originalInvoiceId), (list) =>
      list === undefined ? list : [...list.filter((i) => i.id !== invoice.id), invoice],
    );
  }
  applyInvoiceSummary(client, invoice, { refetchDetail: false });
}

/**
 * The latest summary of an invoice (a live `billing.invoice.updated`, or a
 * command's response): updates the day lists it belongs in, and refetches the
 * full invoice, its order's invoices and the shift's X report, which it changes.
 */
export function applyInvoiceSummary(
  client: QueryClient,
  summary: InvoiceSummary,
  { refetchDetail = true }: { refetchDetail?: boolean } = {},
): void {
  for (const [key, list] of client.getQueriesData<InvoicesResponse>({
    queryKey: BILLING_KEYS.invoiceLists,
  })) {
    if (list === undefined) continue;
    const [, , date, status] = key as readonly [string, string, string, InvoiceStatus | null];
    const existing = list.data.find((i) => i.id === summary.id);
    if (existing !== undefined && existing.version > summary.version) continue;
    const belongs = date === summary.businessDate && (status === null || status === summary.status);
    const rest = list.data.filter((i) => i.id !== summary.id);
    const slim = pickSummary(summary);
    client.setQueryData<InvoicesResponse>(key, {
      data: belongs
        ? existing === undefined
          ? [slim, ...rest]
          : list.data.map((i) => (i.id === summary.id ? slim : i))
        : rest,
    });
  }
  if (refetchDetail) {
    const held = client.getQueryData<Invoice>(BILLING_KEYS.invoice(summary.id));
    if (held !== undefined && held.version < summary.version) {
      void client.invalidateQueries(
        { queryKey: BILLING_KEYS.invoice(summary.id), exact: true },
        NO_CANCEL,
      );
    }
    void client.invalidateQueries(
      { queryKey: BILLING_KEYS.orderInvoices(summary.orderId), exact: true },
      NO_CANCEL,
    );
  }
  void client.invalidateQueries({ queryKey: BILLING_KEYS.currentShift, exact: true }, NO_CANCEL);
}

function pickSummary(i: InvoiceSummary): InvoiceSummary {
  return {
    id: i.id,
    invoiceNo: i.invoiceNo,
    kind: i.kind,
    series: i.series,
    orderId: i.orderId,
    orderNo: i.orderNo,
    orderType: i.orderType,
    tableLabel: i.tableLabel,
    tokenNo: i.tokenNo,
    businessDate: i.businessDate,
    grandTotal: i.grandTotal,
    paidTotal: i.paidTotal,
    balance: i.balance,
    status: i.status,
    createdAt: i.createdAt,
    version: i.version,
  };
}
