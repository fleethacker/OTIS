import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransportProvider, createConnectQueryKey } from "@connectrpc/connect-query";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { Interceptor, Transport } from "@connectrpc/connect";

interface ConnectQueryProviderProps {
  children: React.ReactNode;
  baseUrl?: string;
  /** Transport interceptors — applied to every Connect request. */
  interceptors?: Interceptor[];
  /**
   * Provide a pre-built transport instead of the default HTTP one — e.g. an
   * in-memory `createRouterTransport(...)` for tests, Storybook, or a UI
   * harness. When set, `baseUrl` / `interceptors` are ignored.
   */
  transport?: Transport;
  /**
   * Override the shared QueryClient. Useful when a test/harness wants an
   * isolated cache per mount instead of the module-level default.
   */
  queryClient?: QueryClient;
}

// Create a default query client with sensible defaults for Ark apps
const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

/**
 * ConnectQueryProvider wraps the application with Connect-Query and TanStack Query.
 * This enables type-safe, cache-managed ConnectRPC calls throughout the app.
 *
 * @example
 * ```tsx
 * <ConnectQueryProvider baseUrl="/api">
 *   <App />
 * </ConnectQueryProvider>
 * ```
 */
export function ConnectQueryProvider({
  children,
  baseUrl = "/",
  interceptors = [],
  transport,
  queryClient,
}: ConnectQueryProviderProps) {
  // Default HTTP transport — only used when no explicit `transport` is given.
  const httpTransport = React.useMemo(
    () =>
      createConnectTransport({
        baseUrl,
        useBinaryFormat: false,
        interceptors,
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [baseUrl]
  );

  const activeTransport = transport ?? httpTransport;
  const client = queryClient ?? defaultQueryClient;

  return (
    <QueryClientProvider client={client}>
      <TransportProvider transport={activeTransport}>{children}</TransportProvider>
    </QueryClientProvider>
  );
}

// Re-export Connect-Query utilities for convenience
export { createConnectQueryKey };
