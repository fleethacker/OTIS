import { useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TbX } from "react-icons/tb";
import { AuditEvidence } from "./audit-evidence";
import { MessageReader } from "./message-reader";
import { MessageSearchCard } from "./message-search-card";
import { SourceError, useSource, type EffectiveMessageScope } from "./source-data";
import { useSession } from "./session";
import { StationSummary } from "./station-assignment";

export function EffectiveScopeSummary({ scope }: { scope: EffectiveMessageScope }) {
  return (
    <div className="text-sm space-y-1" aria-label="Effective message scope">
      <p>
        {scope.matchNone
          ? "Your current station and preferences select no messages."
          : scope.allCommands
            ? "All commands within your saved relevance settings"
            : `Commands: ${scope.commandIds.length > 0 ? scope.commandIds.join(", ") : "No assigned commands selected"}`}
      </p>
      <p>
        {scope.includeUnassigned
          ? "Messages without an assigned command are included."
          : "Messages without an assigned command are excluded."}
      </p>
      <p>
        {scope.messageTypes === null
          ? "All message categories within this command scope"
          : `Message categories: ${scope.messageTypes.length > 0 ? scope.messageTypes.join(", ") : "None selected"}`}
      </p>
    </div>
  );
}

export function SimilarMessages() {
  const [params, setParams] = useSearchParams();
  const { session } = useSession();
  const anchor = params.get("similarTo") ?? "";
  const mode = params.get("similarMode") === "keyword" ? "keyword" : "hybrid";
  const validAnchor = anchor.trim() !== "" && !anchor.startsWith("legacy:");
  const record = params.get("record") ?? "";
  const result = useSource("similar", { key: anchor, mode }, validAnchor);
  const detail = useSource(
    "detail",
    { key: record, dataset: "canonical" },
    validAnchor && record !== "" && !record.startsWith("legacy:")
  );
  const list = useRef<HTMLElement>(null);
  const selected = detail.data?.messages[0];
  const data = result.isError ? undefined : result.data;
  const meta = data?.meta;
  const originalSubject = meta?.similarTo?.subject ?? "";
  function select(key: string) {
    const next = new URLSearchParams(params);
    next.delete("tab");
    if (key === "") {
      next.delete("record");
    } else {
      next.set("record", key);
    }
    setParams(next);
  }
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Similar messages</h1>
          <p className="mt-2 text-bc-muted">
            Find related traffic within your assigned station and saved preferences.
          </p>
        </div>
        <Link className="btn btn-ghost btn-sm" to="/messages">
          Message Search
        </Link>
      </header>
      <StationSummary
        assignment={meta?.stationContext?.stationAssignment ?? session?.user?.stationAssignment}
        required={session?.stationAssignmentRequired}
      />
      {meta?.effectiveScope && <EffectiveScopeSummary scope={meta.effectiveScope} />}
      {!validAnchor ? (
        <p role="alert">
          Choose a current source message to find similar messages. Legacy or missing message
          references cannot be used.
        </p>
      ) : (
        <>
          <Link className="link" to={`/messages?${new URLSearchParams({ record: anchor })}`}>
            Open original message
            {originalSubject !== "" ? `: ${originalSubject}` : ""}
          </Link>
          {result.isPending && <p role="status">Finding similar messages…</p>}
          {result.isError && (
            <div className="alert" role="alert">
              <div>
                <p>Similar messages could not be loaded. {result.error.message}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void result.refetch()}
                  >
                    Retry similar messages
                  </button>
                  {mode === "hybrid" &&
                    result.error instanceof SourceError &&
                    result.error.code === "unavailable" && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.set("similarMode", "keyword");
                          next.delete("record");
                          setParams(next);
                        }}
                      >
                        Try keyword search
                      </button>
                    )}
                </div>
              </div>
            </div>
          )}
          {data && (
            <>
              <p role="status" className="text-sm">
                {data.messages.length} similar messages in this result window ·{" "}
                {meta?.executedMode === "keyword" ? "Keyword search" : "Hybrid search"}.{" "}
                {meta?.windowLimited === true
                  ? "The search limit was reached; more matches may exist."
                  : "Results are ranked within a bounded search window."}
              </p>
              {data.messages.length === 0 && (
                <section className="unfinished">
                  <h2>No similar messages found</h2>
                  <p>
                    No matching messages were returned within your station, preferences, and this
                    search window.
                  </p>
                </section>
              )}
              <div className="messages-workspace" data-reader-open={record !== ""}>
                <section
                  className="record-list"
                  aria-label="Similar message list"
                  tabIndex={-1}
                  ref={list}
                >
                  {data.messages.map((message) => (
                    <div key={message.sourceMessageId} className="border-b border-base-300 pb-3">
                      <MessageSearchCard
                        message={message}
                        header={meta?.messageHeaders?.[message.sourceMessageId]}
                        selected={record === message.sourceMessageId}
                        onSelect={() => select(message.sourceMessageId)}
                      />
                      {(meta?.matchedExcerpts?.[message.sourceMessageId] ?? []).map(
                        (excerpt, index) => (
                          <div
                            className="px-3 py-2 space-y-2 text-sm"
                            key={`${excerpt.passageId}:${index}`}
                          >
                            <blockquote className="whitespace-pre-wrap break-words">
                              {excerpt.text}
                            </blockquote>
                            <AuditEvidence
                              source={message.sourceMessageId}
                              passageId={excerpt.passageId}
                              label="View excerpt evidence"
                            />
                          </div>
                        )
                      )}
                    </div>
                  ))}
                </section>
                {record !== "" && (
                  <div className="message-viewer">
                    <button
                      className="btn btn-ghost btn-xs message-viewer-close"
                      type="button"
                      aria-label="Close message"
                      onClick={() => {
                        select("");
                        list.current?.focus();
                      }}
                    >
                      <TbX aria-hidden="true" />
                    </button>
                    {record.startsWith("legacy:") ? (
                      <p role="alert">This legacy record cannot be opened from similar messages.</p>
                    ) : detail.isPending ? (
                      <p role="status">Loading selected message…</p>
                    ) : detail.isError ? (
                      <div role="alert">
                        Selected message could not be loaded. {detail.error.message}
                        <button className="btn btn-sm" onClick={() => void detail.refetch()}>
                          Retry selected message
                        </button>
                      </div>
                    ) : selected ? (
                      <MessageReader
                        key={`${selected.sourceMessageId}:${params.get("tab") ?? ""}`}
                        message={selected}
                      />
                    ) : (
                      <p>Message record not found. No other record has been substituted.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
