import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/endpoints';
import { toLatinDigits } from '../../lib/units';

export const CUSTOMER_KEYS = {
  all: ['customers'],
  search: (q: string) => ['customers', 'search', q] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
} as const;

/** Searching starts at this many characters (a few digits of a mobile number, or a name). */
export const MIN_SEARCH = 3;

/** The value, once it has stopped changing for `ms` (typing → one request). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** What is sent as `q`: Indic digits as 0-9, no spaces or dashes inside a number. */
export function searchTerm(input: string): string {
  const latin = toLatinDigits(input).trim();
  return /^[+\d\s-]+$/.test(latin) ? latin.replaceAll(/[\s-]/g, '') : latin;
}

/** Guests by mobile number or name (debounced); nothing is asked below MIN_SEARCH characters. */
export function useCustomerSearch(input: string) {
  const q = useDebounced(searchTerm(input));
  const enabled = q.length >= MIN_SEARCH;
  const query = useQuery({
    queryKey: CUSTOMER_KEYS.search(q),
    queryFn: ({ signal }) => api.customers.search(q, signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return { ...query, enabled, q };
}

export function useCustomer(id: string) {
  return useQuery({ queryKey: CUSTOMER_KEYS.detail(id), queryFn: () => api.customers.get(id) });
}

/** +919830012345 → "+91 98300 12345". Anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m === null ? phone : `+91 ${m[1]} ${m[2]}`;
}
