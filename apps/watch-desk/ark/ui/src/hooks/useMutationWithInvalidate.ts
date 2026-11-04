/**
 * useMutationWithInvalidate — `useMutation` with required cache
 * invalidation. Wraps Connect-Query's `useMutation` and forces the
 * caller to declare which queries to invalidate when the mutation
 * succeeds. Without this wrapper, agents routinely shipped mutations
 * that updated the server but not the UI — the canonical
 * pause-needs-refresh / edit-needs-refresh failure mode where the
 * cache stayed stale until a full page reload.
 *
 * Usage:
 *
 *   import {
 *     useMutationWithInvalidate,
 *     useQueryKey,
 *   } from "@defense-unicorns/ark-ui";
 *   import { listCompetitors, pauseCompetitor }
 *     from "../gen/app/v1/app-AppService_connectquery";
 *
 *   const listKey = useQueryKey(listCompetitors);
 *   const pause = useMutationWithInvalidate(pauseCompetitor, [listKey]);
 *
 *   <button onClick={() => pause.mutate({ id })}>Pause</button>
 *
 * The `[listKey]` argument is REQUIRED. Pass an empty array `[]` ONLY
 * for the rare fire-and-forget case where no query needs to refresh
 * (analytics pings, audit logs); when you do, leave a one-line
 * comment explaining why so the next reviewer knows it's deliberate.
 *
 * The returned object is the same `UseMutationResult` Connect-Query
 * returns — `.mutate(input)`, `.mutateAsync(input)`, `.isPending`,
 * `.isError`, `.error`, `.reset()`, etc. — so existing code calling
 * `.mutate(...)` Just Works.
 *
 * The wrapper layers its `onSuccess` AFTER any `onSuccess` you pass
 * via options. Order is intentional: your handler runs first (toast
 * a confirmation, navigate, etc.), then invalidations fire (so the
 * UI updates). If your handler depends on the post-invalidation
 * state, do it inside an `onSettled` instead.
 */
import {
  useMutation as connectUseMutation,
  type UseMutationOptions as ConnectUseMutationOptions,
  createConnectQueryKey,
} from "@connectrpc/connect-query";
import { useQueryClient, type QueryKey, type UseMutationResult } from "@tanstack/react-query";
import type {
  DescMessage,
  DescMethodUnary,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import type { ConnectError } from "@connectrpc/connect";

/**
 * Each invalidate target is a Connect-Query method (the most common
 * case — invalidate every cached query for that RPC) or a TanStack
 * QueryKey (escape hatch for non-Connect-Query state).
 */
export type InvalidateTarget = DescMethodUnary<DescMessage, DescMessage> | QueryKey;

/**
 * Options accept the same shape as Connect-Query's `useMutation` —
 * passed through verbatim except `onSuccess`, which the wrapper layers
 * around.
 */
export type UseMutationWithInvalidateOptions<
  I extends DescMessage,
  O extends DescMessage,
  Ctx = unknown,
> = ConnectUseMutationOptions<I, O, Ctx>;

/**
 * useMutationWithInvalidate — see file header for the full contract.
 */
export function useMutationWithInvalidate<
  I extends DescMessage,
  O extends DescMessage,
  Ctx = unknown,
>(
  schema: DescMethodUnary<I, O>,
  invalidates: InvalidateTarget[],
  options?: UseMutationWithInvalidateOptions<I, O, Ctx>
): UseMutationResult<MessageShape<O>, ConnectError, MessageInitShape<I>, Ctx> {
  const queryClient = useQueryClient();
  const userOnSuccess = options?.onSuccess;

  return connectUseMutation(schema, {
    ...options,
    onSuccess: async (data, variables, onMutateResult, context) => {
      // User-provided handler runs first so a `mutate(...)` caller's
      // post-success behavior (toast, route push, form reset) sees
      // the mutation result before any cache invalidation kicks off.
      if (userOnSuccess !== undefined) {
        await userOnSuccess(data, variables, onMutateResult, context);
      }

      // Invalidate every declared target. Run them in parallel — each
      // produces an independent network roundtrip, no ordering deps.
      await Promise.all(
        invalidates.map((target) => {
          const queryKey: QueryKey = isMethodInfo(target)
            ? createConnectQueryKey({ schema: target, cardinality: undefined })
            : target;

          return queryClient.invalidateQueries({ queryKey });
        })
      );
    },
  });
}

/**
 * useQueryKey — convenience for callers that need the QueryKey for a
 * Connect-Query method without subscribing to it (e.g. for direct
 * `queryClient.invalidateQueries` outside the wrapper, or for
 * `setQueryData` to push optimistic updates). Returns the SAME key
 * Connect-Query uses internally so cache hits land correctly.
 */
export function useQueryKey<I extends DescMessage, O extends DescMessage>(
  schema: DescMethodUnary<I, O>
): QueryKey {
  return createConnectQueryKey({ schema, cardinality: undefined });
}

/**
 * isMethodInfo — discriminator between the two InvalidateTarget
 * shapes. Connect-Query method descriptors carry a `kind: "rpc"` /
 * `methodKind` field plus `name` and `parent`; raw QueryKeys are
 * always arrays.
 */
function isMethodInfo(t: InvalidateTarget): t is DescMethodUnary<DescMessage, DescMessage> {
  return !Array.isArray(t) && typeof t === "object" && t !== null && "methodKind" in t;
}
