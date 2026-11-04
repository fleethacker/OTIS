import { useMemo } from "react";
import { useTransport } from "@connectrpc/connect-query";
import { createClient, type Client } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";

/**
 * useClient returns a ConnectRPC client bound to the transport from the
 * nearest `ConnectQueryProvider`. Use it for server-streaming RPCs and the
 * occasional call where a `useQuery` / `useMutation` hook doesn't fit —
 * instead of hand-rolling a `createConnectTransport({ baseUrl })` per call
 * site.
 *
 * Why this matters: there is exactly one transport (the provider's), so
 * configuration lives in one place and a test / Storybook / UI-harness
 * override (`<ConnectQueryProvider transport={mock}>`) applies to every RPC,
 * streaming included. Hand-rolled transports silently bypass that.
 */
export function useClient<S extends DescService>(service: S): Client<S> {
  const transport = useTransport();
  return useMemo(() => createClient(service, transport), [service, transport]);
}

// Re-export so consumers can read the active transport directly when needed.
export { useTransport };
