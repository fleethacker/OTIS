import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Identity fields supplied by the application's generated query descriptor. */
export interface IdentityFields {
  username: string;
  email: string;
  groups: string[];
  role: string;
}

interface IdentityQueryState<E> {
  data: IdentityFields | undefined;
  isLoading: boolean;
  error: E;
}

/**
 * Keep cached application data tied to the current auth session. The app owns
 * its identity RPC descriptor; Ark owns session-change observation and cache
 * invalidation. Clearing all query freshness prevents old-user data surviving
 * a login, logout, or role change in another tab.
 */
export function useIdentityState<E>(query: IdentityQueryState<E>) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries();
    };
    const onMessage = (event: MessageEvent) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "ark-auth-changed"
      ) {
        invalidate();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") invalidate();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("storage", invalidate);
    window.addEventListener("focus", invalidate);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", invalidate);
      window.removeEventListener("focus", invalidate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queryClient]);

  return {
    username: query.data?.username ?? "",
    email: query.data?.email ?? "",
    groups: query.data?.groups ?? [],
    role: query.data?.role ?? "",
    isLoading: query.isLoading,
    error: query.error,
  };
}
