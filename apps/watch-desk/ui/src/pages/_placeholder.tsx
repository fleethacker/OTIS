import { Link, Navigate, useLocation } from "react-router-dom";
import type { RouteMeta } from "../route-registry";
import { navRoutes, routes } from "../route-registry";

/**
 * Has any real page landed yet? This is the "is the app still scaffolding"
 * signal, and it counts REGISTERED pages — not nav-visible ones.
 *
 * It used to read `navRoutes.length === 0`, which conflates "nothing built"
 * with "nothing in the nav menu". Those differ for exactly the app shape the
 * design system calls single-task: one page, correctly marked
 * `hideFromNav: true` because a one-page app needs no nav. In that app
 * `navRoutes` is permanently empty, so a finished, deployed build rendered
 * "Building your application" for every dead link — the precise failure this
 * file's doc comment says it exists to prevent.
 *
 * Must be a FUNCTION, not a module-scope const: `_placeholder` and
 * `route-registry` are a cycle (see the import note in the test), so reading
 * `routes` at module-evaluation time hits the ESM temporal dead zone
 * ("Cannot access 'routes' before initialization"). Calling it during render
 * defers the read until both modules have finished initializing.
 */
function pagesHaveLanded(): boolean {
  return routes.some((r) => r.path !== "*");
}

/**
 * _placeholder is the catch-all `path: "*"` page. It has three jobs, in order:
 *
 *   1. Before any feature page exists (early scaffolding, `navRoutes` empty),
 *      render the "Building your application" card.
 *   2. Once real nav routes exist, redirect "/" to the first one.
 *   3. For any OTHER unmatched URL once the app is built, render a real
 *      "Page not found" — NOT the building card.
 *
 * Why (3) matters: showing "Building your application" for a wrong/dead link
 * masks routing bugs as "still building" — a mistyped or stale path (e.g. a map
 * click-through pointing at `/areas/4` when the page lives at
 * `/area-detail?area=4`) looks like an unbuilt feature instead of a broken
 * link, so it dead-ends silently. And in a deployed, finished app it is simply
 * false: no agents are building anything. A real 404 that lists the actual
 * routes makes the broken link obvious and recoverable.
 */
export const route: RouteMeta = {
  path: "*",
  label: "Not found",
  hideFromNav: true,
};

export default function Placeholder() {
  const location = useLocation();

  // Nothing built yet → the genuine "building" placeholder for any path.
  if (!pagesHaveLanded()) {
    return <BuildingCard />;
  }

  // App has pages → send "/" to the first one. Prefer a nav-visible route;
  // fall back to any registered page, because a single-task app hides its
  // only page from the nav and would otherwise have no redirect target.
  if (location.pathname === "/") {
    const home = navRoutes.find((r) => r.path !== "*") ?? routes.find((r) => r.path !== "*");
    if (home) {
      return <Navigate to={home.path} replace />;
    }
  }

  // App is built but this path matched nothing → a real 404, not "building".
  return <NotFoundCard pathname={location.pathname} />;
}

/**
 * The early-scaffold state: the app shell exists but no feature pages yet.
 *
 * Exported for the unit test, same reason as NotFoundCard below: which branch
 * `Placeholder` takes depends on the ambient `navRoutes`, which changes as the
 * app gets built. A test that reaches this card only by assuming the registry
 * is still empty passes in the bare template and fails the moment App Shell
 * lands its first page — so the copy is asserted against the component
 * directly, and the branching is tested separately as branching.
 */
export function BuildingCard() {
  return (
    <div
      className="min-h-screen bg-base-100 flex items-center justify-center p-6"
      data-ark-preview-placeholder="building"
    >
      <div className="card bg-base-200 border border-base-300 w-full max-w-lg">
        <div className="card-body items-center text-center gap-3">
          <span className="loading loading-spinner loading-lg text-primary" aria-label="Loading" />
          <h2 className="card-title text-xl">Building your application</h2>
          <p className="text-sm text-bc-muted">
            AI agents are building features in parallel. Each feature lands as a new page — this
            catch-all renders until a real page registers itself at this path.
          </p>
          <p className="text-xs text-bc-subtle">Check the build panel for real-time progress.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * A real "page not found" for an unmatched URL in a built app. Lists the actual
 * nav routes so a broken/stale link is obvious and one click recovers. Exported
 * for the unit test (the bare-template `navRoutes` is empty, so the catch-all
 * itself only reaches the building state in isolation).
 */
export function NotFoundCard({ pathname }: { pathname: string }) {
  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-6">
      <div className="card bg-base-200 border border-base-300 w-full max-w-lg">
        <div className="card-body items-center text-center gap-3">
          <span className="text-5xl font-bold text-base-content/30" aria-hidden>
            404
          </span>
          <h2 className="card-title text-xl">Page not found</h2>
          <p className="text-sm text-bc-muted">
            Nothing is routed at <code className="font-mono text-base-content">{pathname}</code> —
            usually a broken or stale link.
          </p>
          {navRoutes.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {navRoutes.map((r) => (
                <Link key={r.path} to={r.path} className="btn btn-sm btn-outline btn-primary">
                  {r.label}
                </Link>
              ))}
            </div>
          )}
          <p className="text-xs text-bc-subtle pt-1">
            If this app is still being built, the page may not have landed yet — check the build
            panel.
          </p>
        </div>
      </div>
    </div>
  );
}
