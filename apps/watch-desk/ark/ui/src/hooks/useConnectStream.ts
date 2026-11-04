import { useState, useCallback } from "react";

/**
 * Hook for handling ConnectRPC streaming methods.
 * Use this for server-streaming RPCs since Connect-Query doesn't support streaming yet.
 *
 * @param serviceMethod - The streaming service method
 * @returns Stream control object with start function and state
 *
 * @example
 * ```tsx
 * const buildStream = useConnectStream(
 *   (req) => client.buildApplication(req)
 * );
 *
 * // Start streaming
 * buildStream.start({ workspaceId, synthesis }, (update) => {
 *   console.log('Progress:', update);
 * });
 *
 * // Access state
 * if (buildStream.isStreaming) {
 *   // Show loading state
 * }
 * ```
 */
export function useConnectStream<TRequest, TResponse>(
  serviceMethod: (request: TRequest) => AsyncIterable<TResponse>
) {
  const [current, setCurrent] = useState<TResponse | null>(null);
  const [updates, setUpdates] = useState<TResponse[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const start = useCallback(
    async (
      request: TRequest,
      onUpdate?: (update: TResponse) => void
    ): Promise<TResponse | null> => {
      setIsStreaming(true);
      setError(null);
      setUpdates([]);
      setCurrent(null);

      try {
        let lastUpdate: TResponse | null = null;

        for await (const update of serviceMethod(request)) {
          lastUpdate = update;
          setCurrent(update);
          setUpdates((prev) => [...prev, update]);
          onUpdate?.(update);
        }

        setIsStreaming(false);
        return lastUpdate;
      } catch (err) {
        const streamError = err instanceof Error ? err : new Error(String(err));
        setError(streamError);
        setIsStreaming(false);
        throw streamError;
      }
    },
    [serviceMethod]
  );

  const reset = useCallback(() => {
    setCurrent(null);
    setUpdates([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  return {
    start,
    reset,
    current,
    updates,
    isStreaming,
    error,
  };
}
