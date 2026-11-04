// Ark UI Framework - Main entry point
// MIT/Apache 2.0 License

// Ark-owned core primitives. Optional maps, charts, forms, tables, editors,
// and their dependencies belong to the app that chooses them.
export * from "./composites";

// Provider stack — ConnectQueryProvider for server-state.
export * from "./providers";

// Session lifecycle and route policy. Applications supply their generated
// identity query and page-module map through small app-owned bindings.
export * from "./auth";
export * from "./routes";

// Connect-Query hook re-exports (the most-used import path for apps).
export {
  useQuery,
  useSuspenseQuery,
  useInfiniteQuery,
  useMutation,
} from "@connectrpc/connect-query";
export { useQueryClient } from "@tanstack/react-query";

// Connect transport — for the rare server-streaming RPC case where apps
// build their own client.
export * as Connect from "@connectrpc/connect";
export * as ConnectWeb from "@connectrpc/connect-web";
export type { Transport } from "@connectrpc/connect";
export { createClient } from "@connectrpc/connect";
export { createConnectTransport } from "@connectrpc/connect-web";

// Core icons used by Ark's own shell and generated auth controls. Other icon
// families are app dependencies selected with the app's visual direction.
export * from "react-icons/lu";
export * from "react-icons/hi2";

// Hooks + utils — small helpers that ship alongside the composites.
export * from "./hooks";
export * from "./utils";
