import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from './problem';

/** Retries network and server errors twice; never retries an answer the API gave on purpose (4xx). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
}

export function QueryProvider({ client, children }: { client?: QueryClient; children: ReactNode }) {
  const [fallback] = useState(createQueryClient);
  return <QueryClientProvider client={client ?? fallback}>{children}</QueryClientProvider>;
}
