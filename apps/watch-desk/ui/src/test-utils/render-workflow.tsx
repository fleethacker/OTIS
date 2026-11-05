import { useEffect, useState, type ReactElement, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders as renderBase } from "./render";
import { SessionContext, type AccountSession } from "../components/workflow-session";

export const testSession: AccountSession = {
  authenticated: true,
  authMode: "local_demo",
  scope: "test-scope",
  user: { id: "test-user", username: "Test watchstander", role: "viewer" },
  permissions: ["schedule:read"],
  settings: { calendarRefreshSeconds: 30 },
};
function WorkflowTestProviders({ children }: PropsWithChildren) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client]
  );
  return (
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ session: testSession }}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}
export function renderWithProviders(ui: ReactElement, options?: Parameters<typeof renderBase>[1]) {
  return renderBase(<WorkflowTestProviders>{ui}</WorkflowTestProviders>, options);
}
