import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ConnectQueryProvider } from "@defense-unicorns/ark-ui";
import { useIdentity } from "./hooks/useIdentity";
import { routes } from "./route-registry";
import { AppLayout } from "./components/app-layout";
import { sessionInterceptor } from "./components/session-access";

/**
 * App is the single mount point — it wires:
 *
 * 1. Connect-Query provider (server state for every page)
 * 2. React-router BrowserRouter (URL → page)
 * 3. Routes auto-discovered from `ui/src/pages/*.tsx`
 *
 * No persistent chrome by default. App Shell decides whether the app
 * has a layout wrapper — a sidebar/navbar/three-pane shell, naked
 * pages, or some routes wrapped and others not. If a wrapper fits,
 * App Shell adds `<Route element={<AppLayout />}>` around `routes.map`
 * here and ships the actual layout in `ui/src/components/app-layout.tsx`.
 *
 * Theming: app-owned CSS follows the browser color preference by default.
 * An explicit app setting can select a scheme with `<html data-theme="...">`.
 * App.tsx does not need a theme provider.
 *
 * Feature stories add pages by dropping a new file under `ui/src/pages/`
 * with `export const route` + `export default function`. The route
 * registry picks them up automatically via
 * `route-registry.generated.ts` (rewritten on each `bun run build`),
 * so this file never needs editing for a new route — which is what
 * keeps parallel feature agents from conflicting on App.tsx.
 */
function AppContent() {
  // Mount the identity hook at the root so its cross-tab session
  // listeners (storage / focus / visibilitychange) register once for
  // the whole app. Child components calling useQuery(getIdentity) dedupe
  // against this fetch — the call here is for the side-effect listeners,
  // not for the returned value.
  useIdentity();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {routes.map((r) => (
            <Route key={r.key} path={r.path} element={<r.Component />} />
          ))}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ConnectQueryProvider baseUrl="/" interceptors={[sessionInterceptor]}>
      <AppContent />
    </ConnectQueryProvider>
  );
}
