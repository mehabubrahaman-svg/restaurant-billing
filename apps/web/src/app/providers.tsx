import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '../i18n';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The Hub is on the LAN: there is no internet to wait for.
      queries: { networkMode: 'always', staleTime: 30_000 },
      mutations: { networkMode: 'always' },
    },
  });
}

export function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {/* Animations are short (≤ 200 ms) and switched off for prefers-reduced-motion. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
