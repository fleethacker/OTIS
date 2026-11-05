import { sessionFetch } from "./session-access";
import { readJson, sourceScopeKey } from "./source-data";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "./session";
export function AuditEvidence({
  source,
  passageId,
  label = "Source audit evidence",
}: {
  source: string;
  passageId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const { session } = useSession();
  const result = useQuery({
    queryKey: [
      "parse-command-evidence",
      session?.user?.id,
      source,
      passageId,
      sourceScopeKey(session),
    ],
    enabled: open,
    queryFn: async ({ signal }) => {
      const response = await sessionFetch("/api/v1/messages/evidence", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: source, passageId }),
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
      <summary>{label}</summary>
      {open &&
        (result.isPending ? (
          <p role="status">Loading evidence…</p>
        ) : result.isError ? (
          <p role="alert">{result.error.message}</p>
        ) : result.data.records.length === 0 ? (
          <p>Source evidence is not available for this selection.</p>
        ) : (
          <pre className="audit-evidence">{JSON.stringify(result.data.records, null, 2)}</pre>
        ))}
    </details>
  );
}
