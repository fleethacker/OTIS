import type { ComponentType } from "react";

/** Application-authored metadata exported beside a page's default component. */
export interface RouteMeta {
  path: string;
  label: string;
  icon?: string;
  order?: number;
  hideFromNav?: boolean;
}

export interface PageModule {
  default: ComponentType;
  route: RouteMeta;
}

export interface RegisteredRoute extends RouteMeta {
  Component: ComponentType;
  key: string;
}

function isPageModule(module: unknown): module is PageModule {
  if (module === null || typeof module !== "object") return false;
  const candidate = module as { default?: unknown; route?: unknown };
  if (typeof candidate.default !== "function") return false;
  if (candidate.route === null || typeof candidate.route !== "object") return false;
  const route = candidate.route as { path?: unknown; label?: unknown };
  return typeof route.path === "string" && typeof route.label === "string";
}

/** Duplicate concrete paths would silently shadow application pages. */
export function assertNoPathCollisions(routes: readonly { path: string; key: string }[]): void {
  const seen = new Map<string, string>();
  for (const route of routes) {
    if (route.path === "*") continue;
    const prior = seen.get(route.path);
    if (prior !== undefined) {
      throw new Error(
        `route-registry: path "${route.path}" is registered by two pages: ${prior} and ${route.key}. ` +
          `Pick one to own the path; rename or delete the other.`
      );
    }
    seen.set(route.path, route.key);
  }
}

/**
 * Bind the application's generated page map to Ark's route policy. The build
 * owns discovery of app files; this function validates metadata, orders pages,
 * and rejects ambiguous paths without importing application modules itself.
 */
export function discoverRoutes(pageModules: Record<string, unknown>): RegisteredRoute[] {
  const routes = Object.entries(pageModules)
    .flatMap(([key, module]): RegisteredRoute[] => {
      if (!isPageModule(module)) return [];
      return [{ ...module.route, Component: module.default, key }];
    })
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  assertNoPathCollisions(routes);
  return routes;
}
