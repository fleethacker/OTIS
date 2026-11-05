import type { RouteMeta } from "../route-registry";
import { Navigate } from "react-router-dom";

export const route: RouteMeta = { path: "/settings", label: "Settings", order: 20 };

export default function Settings() {
  return <Navigate to="/account" replace />;
}
