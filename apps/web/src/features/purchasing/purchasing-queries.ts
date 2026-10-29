import type { PurchaseOrderStatus } from '@restroos/contracts';
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../api/client';
import { api, type GrnStatus } from '../../api/endpoints';
import { useErrorMessage } from '../../lib/errors';

export const PURCHASING_KEYS = {
  all: ['purchasing'],
  units: ['purchasing', 'units'],
  items: ['purchasing', 'inventory-items'],
  vendors: (includeRetired: boolean) => ['purchasing', 'vendors', includeRetired] as const,
  vendor: (id: string) => ['purchasing', 'vendor', id] as const,
  statement: (id: string, from: string, to: string) =>
    ['purchasing', 'statement', id, from, to] as const,
  orders: (status: PurchaseOrderStatus | null, vendorId: string | null) =>
    ['purchasing', 'orders', status, vendorId] as const,
  order: (id: string) => ['purchasing', 'order', id] as const,
  grns: (filter: { status?: GrnStatus; vendorId?: string; purchaseOrderId?: string }) =>
    ['purchasing', 'grns', filter] as const,
  grn: (id: string) => ['purchasing', 'grn', id] as const,
  payments: (filter: { vendorId?: string; from?: string; to?: string }) =>
    ['purchasing', 'payments', filter] as const,
  dues: (asOf: string) => ['purchasing', 'dues', asOf] as const,
} as const;

/**
 * After any purchase document changes: every purchase list, the dues, stock
 * levels (a posted GRN adds stock) and the books (it is journalled) are refetched.
 */
export function invalidatePurchasing(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: PURCHASING_KEYS.all }),
    client.invalidateQueries({ queryKey: ['inventory'] }),
    client.invalidateQueries({ queryKey: ['accounting'] }),
  ]).then(() => undefined);
}

export const useUnits = () =>
  useQuery({ queryKey: PURCHASING_KEYS.units, queryFn: api.purchasing.units, staleTime: 300_000 });

export const useStockItems = () =>
  useQuery({ queryKey: PURCHASING_KEYS.items, queryFn: api.purchasing.items, staleTime: 30_000 });

export const useVendors = (includeRetired = false) =>
  useQuery({
    queryKey: PURCHASING_KEYS.vendors(includeRetired),
    queryFn: () => api.purchasing.vendors(includeRetired),
  });

export const useVendor = (id: string, enabled = true) =>
  useQuery({
    queryKey: PURCHASING_KEYS.vendor(id),
    queryFn: () => api.purchasing.vendor(id),
    enabled,
  });

export const useVendorStatement = (id: string, from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: PURCHASING_KEYS.statement(id, from, to),
    queryFn: () => api.purchasing.statement(id, from, to),
    enabled,
    placeholderData: keepPreviousData,
  });

export const usePurchaseOrders = (status: PurchaseOrderStatus | null, vendorId: string | null) =>
  useQuery({
    queryKey: PURCHASING_KEYS.orders(status, vendorId),
    queryFn: () => api.purchasing.orders(status ?? undefined, vendorId ?? undefined),
    placeholderData: keepPreviousData,
  });

export const usePurchaseOrder = (id: string, enabled = true) =>
  useQuery({
    queryKey: PURCHASING_KEYS.order(id),
    queryFn: () => api.purchasing.order(id),
    enabled,
  });

export const useGrns = (
  filter: { status?: GrnStatus; vendorId?: string; purchaseOrderId?: string },
  enabled = true,
) =>
  useQuery({
    queryKey: PURCHASING_KEYS.grns(filter),
    queryFn: () => api.purchasing.grns(filter),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useGrn = (id: string, enabled = true) =>
  useQuery({
    queryKey: PURCHASING_KEYS.grn(id),
    queryFn: () => api.purchasing.grn(id),
    enabled,
  });

export const useVendorPayments = (
  filter: { vendorId?: string; from?: string; to?: string },
  enabled = true,
) =>
  useQuery({
    queryKey: PURCHASING_KEYS.payments(filter),
    queryFn: () => api.purchasing.payments(filter),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useVendorDues = (asOf: string) =>
  useQuery({
    queryKey: PURCHASING_KEYS.dues(asOf),
    queryFn: () => api.purchasing.dues(asOf),
    placeholderData: keepPreviousData,
  });

/**
 * useErrorMessage, in purchase words: a document that moved on (approved,
 * posted, cancelled) and a payment above what a bill still owes.
 */
export function usePurchaseErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (isApiError(error, 'INVALID_STATE_TRANSITION')) return t('purchase.errors.invalidState');
      if (isApiError(error, 'OVERPAYMENT')) return t('purchase.errors.overpayment');
      return errorMessage(error);
    },
    [t, errorMessage],
  );
}
