import { useEffect, useState, type PropsWithChildren } from "react";
import { QueryClient } from "@tanstack/react-query";
import { ConnectQueryProvider } from "@defense-unicorns/ark-ui";
import { sessionInterceptor } from "./session-access";
import { useSession } from "./workflow-session";

export function SessionQueryProvider({ children }: PropsWithChildren) {
  const { session } = useSession();
  return <ScopeQueries key={session?.scope ?? "unavailable"}>{children}</ScopeQueries>;
}

function ScopeQueries({ children }: PropsWithChildren) {
  // AuthGate's opaque scope includes native owner, role and source access.
  // Ark's default cache is module-wide, so remounting its provider alone would
  // retain source records and settings from the previous authenticated scope.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: 0 },
        },
      })
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client]
  );
  return (
    <ConnectQueryProvider baseUrl="/" interceptors={[sessionInterceptor]} queryClient={client}>
      {children}
    </ConnectQueryProvider>
  );
}
