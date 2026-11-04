// Feature pages own their components and route metadata. The generated page map
// binds them to Ark's route validation; adding a page needs no registry edit.
import { discoverRoutes } from "@defense-unicorns/ark-ui";
import { pageModules } from "./route-registry.generated";

export type { RouteMeta, PageModule, RegisteredRoute } from "@defense-unicorns/ark-ui";
export { assertNoPathCollisions } from "@defense-unicorns/ark-ui";

export const routes = discoverRoutes(pageModules);
export const navRoutes = routes.filter((route) => route.hideFromNav !== true);
