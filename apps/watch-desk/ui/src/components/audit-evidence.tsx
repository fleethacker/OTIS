import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
export function AuditEvidence({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  const result = useQuery({
    queryKey: ["parse-command-evidence", source],
    enabled: open,
    queryFn: async ({ signal }) => {
      const response = await sessionFetch("/api/v1/messages/evidence", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: source }),
        signal,
      });
      const payload = await readJson(response);
      if (!Array.isArray(payload.records)) {
        throw new Error("Invalid evidence response");
      }
      return { records: payload.records };
    },
    retry: false,
    gcTime: 60_000,
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Source audit evidence</summary>
      {open &&
        (result.isPending ? (
          <p role="status">Loading evidence…</p>
        ) : result.isError ? (
          <p role="alert">{result.error.message}</p>
        ) : (
          <pre className="audit-evidence">{JSON.stringify(result.data.records, null, 2)}</pre>
        ))}
    </details>
  );
}
