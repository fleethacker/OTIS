import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement, type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router-dom";
import { ConnectQueryProvider } from "@defense-unicorns/ark-ui";
import { themeName } from "../theme";

/**
 * Mount a component inside the same provider stack App.tsx uses in
 * production (ConnectQueryProvider). The daisyUI theme is set via the
 * `data-theme` attribute on document.documentElement before each test
 * runs, so daisyUI classes resolve to real colors during the render.
 *
 * Use this for every UI slice render test — it catches the class of bugs
 * where typecheck and lint pass but the component throws at mount
 * (missing provider, mismatched React Query instance, component throws
 * caught by React's error boundary).
 *
 * Example:
 *   import { renderWithProviders } from '../test-utils/render'
 *   import { MyPage } from './MyPage'
 *
 *   test('MyPage mounts', () => {
 *     const { getByText } = renderWithProviders(<MyPage />)
 *     expect(getByText('Welcome')).toBeInTheDocument()
 *   })
 *
 * A MemoryRouter is included, so pages using react-router hooks
 * (useParams / useNavigate / <Link> / <Navigate>) mount for real instead
 * of throwing a router-context error that masks the slice's actual mount
 * bug. Pass `route` to start at a specific path (e.g. for a `:id` route).
 *
 * Network: ConnectQueryProvider will attempt real fetch calls against
 * `/` — in jsdom these typically fail and useQuery hooks stay in
 * loading state, which is fine for mount tests. For tests that need
 * specific response data, stub with msw or mock the connect-query
 * helpers at the module level.
 */
type ProviderOptions = Omit<RenderOptions, "wrapper"> & {
  /** Initial route for the in-memory router. Defaults to "/". */
  route?: string;
};

function makeWrapper(route: string) {
  return function AllProviders({ children }: PropsWithChildren) {
    // Set the theme once per render — idempotent, no-ops if already set.
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", themeName);
    }
    return (
      <ConnectQueryProvider baseUrl="/">
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </ConnectQueryProvider>
    );
  };
}

export function renderWithProviders(ui: ReactElement, options?: ProviderOptions) {
  const { route = "/", ...rest } = options ?? {};
  return render(ui, { wrapper: makeWrapper(route), ...rest });
}
