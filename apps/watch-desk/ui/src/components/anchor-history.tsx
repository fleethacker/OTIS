import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { messageHref } from "./calendar-links";
import { sessionFetch } from "./session-access";
import { readJson } from "./source-data";
import { useAnchorCurrent, type AnchorVersion, type CurrentEventView } from "./anchor-data";
import { useSession } from "./workflow-session";

function utc(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Time unresolved"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function interval(value: AnchorVersion["interval"]) {
  if (value === null) {
    return "Time unresolved";
  }
  const start = new Date(value.start);
  const end = new Date(value.end);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return "Time unresolved";
  }
  const a = start.toISOString();
  const b = end.toISOString();
  return a.slice(0, 10) === b.slice(0, 10)
    ? `${a.slice(0, 10)} ${a.slice(11, 16)}–${b.slice(11, 16)} UTC`
    : `${utc(value.start)} – ${utc(value.end)}`;
}
function versionLabel(version: AnchorVersion) {
  return version.relationship.kind === "original"
    ? "Original"
    : version.relationship.kind === "amends"
      ? "Amendment"
      : "Cancellation";
}

function AnchorEvent({
  item,
  reviewControls,
}: {
  item: CurrentEventView;
  reviewControls: boolean;
}) {
  const [reloading, setReloading] = useState(false);
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const client = useQueryClient();
  const invalidate = () =>
    Promise.all(
      ["assigned-work", "priority-work", "parse-command-source", "anchor-current", "pb4t"].map(
        (key) => client.invalidateQueries({ queryKey: [key] })
      )
    );
  const review = useMutation({
    mutationFn: async () =>
      readJson(
        await sessionFetch("/api/v1/work/review", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: item.taskId,
            expectedVersion: item.taskVersion,
            eventVersion: item.eventVersion,
            currentVersionToken: item.versionToken,
          }),
        })
      ),
    onSuccess: invalidate,
    onError: invalidate,
  });
  async function reloadCurrent() {
    setReloading(true);
    try {
      await invalidate();
      review.reset();
    } finally {
      setReloading(false);
    }
  }
  const current = item.current;
  const previous = item.previous;
  const reviewable =
    ["active", "cancelled"].includes(item.status) &&
    current !== null &&
    item.versionToken !== null &&
    item.taskId !== null &&
    item.taskVersion !== null &&
    item.eventVersion !== null;
  const changed =
    current?.relationship.kind === "amends" &&
    previous !== null &&
    previous.interval !== null &&
    current.interval !== null;
  return (
    <article
      className="card border border-base-300 p-4 space-y-3"
      aria-label={`Event history ${item.logicalEventId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          {item.status === "unresolved"
            ? "Current version unresolved"
            : item.status === "cancelled"
              ? "Event cancelled"
              : item.status === "pending"
                ? "Event not yet effective"
                : "Current event"}
        </h3>
        {item.reviewed && reviewable && (
          <span className="badge badge-outline">Reviewed this version</span>
        )}
      </div>
      {changed && (
        <p>
          Time changed: {interval(previous.interval)} → {interval(current.interval)}.
        </p>
      )}
      {item.status === "active" && !changed && <p>{interval(current?.interval ?? null)}</p>}
      {item.status === "cancelled" && (
        <p>
          Removed from the active schedule. Obsolete task reminders stopped; cancellation review is
          retained.
        </p>
      )}
      {item.status === "unresolved" && (
        <p>
          No current instruction selected.{" "}
          {item.problems.map((problem) => problem.replace(/_/g, " ")).join("; ")}.
        </p>
      )}
      {item.nextEffectiveAt !== null && (
        <p>Next declared change takes effect {utc(item.nextEffectiveAt)}.</p>
      )}
      {item.status === "active" && current?.parsedReviewRequired === true && (
        <p>Parsed facts remain unvalidated.</p>
      )}
      {reviewable && !item.reviewed && (
        <p>
          {item.status === "cancelled"
            ? "Cancellation review required."
            : "Current version review required."}
        </p>
      )}
      {reviewControls && reviewable && item.canReview && !item.reviewed && (
        <button
          className="btn btn-sm btn-primary"
          disabled={review.isPending || review.isError || reloading}
          onClick={() => review.mutate()}
        >
          {review.isPending ? "Recording review…" : "Reviewed this version"}
        </button>
      )}
      {reviewControls && reviewable && !item.canReview && !item.reviewed && (
        <p>Your account cannot record this review.</p>
      )}
      {review.isError && (
        <div role="alert">
          <p>
            Review was not recorded. {review.error.message} Reload the current version before trying
            again.
          </p>
          <button
            className="btn btn-sm"
            disabled={reloading}
            onClick={() => {
              void reloadCurrent();
            }}
          >
            {reloading ? "Reloading current version…" : "Reload current version"}
          </button>
        </div>
      )}
      <p className="text-sm">
        Internal review records that you read this version. It does not complete the task, validate
        parsed facts, or send a message.
      </p>
      <details>
        <summary className="cursor-pointer font-medium">Sources and review history</summary>
        <ol className="space-y-3 mt-3">
          {item.history.map((version, index) => (
            <li key={`${version.id}:${index}`}>
              <Link className="link" to={messageHref(version.source.messageKey, returnTo)}>
                {versionLabel(version)} source
              </Link>
              <span>
                {" "}
                ·{" "}
                {version.id === current?.id
                  ? "Current version"
                  : item.status === "unresolved"
                    ? "Unresolved"
                    : item.history.indexOf(version) >
                        item.history.findIndex((entry) => entry.id === current?.id)
                      ? "Future version"
                      : "Superseded version"}
              </span>
              {version.relationship.kind !== "cancels" && <p>{interval(version.interval)}</p>}
              <p>
                Effective {utc(version.effectiveAt)}. {version.provenance}
              </p>
              {version.parsedReviewRequired && (
                <p className="text-sm">Parsed facts remain unvalidated.</p>
              )}
            </li>
          ))}
        </ol>
        <h4 className="font-medium mt-3">Internal reviews</h4>
        {item.reviews.length === 0 ? (
          <p>No review recorded.</p>
        ) : (
          <ul className="space-y-2">
            {item.reviews.map((entry, index) => (
              <li key={`${entry.actor}:${entry.recordedAt}:${index}`}>
                {entry.actor} · {entry.responsibilityId} · {utc(entry.recordedAt)} ·{" "}
                {(entry.currentVersionToken === item.versionToken && item.versionToken !== null) ||
                (entry.currentVersionToken === null &&
                  entry.eventVersion === 1 &&
                  entry.eventVersion === item.eventVersion &&
                  entry.source.messageKey === current?.source.messageKey &&
                  entry.source.factId === current.source.factId)
                  ? "Current version"
                  : "Earlier version"}
                {" · "}
                <Link className="link" to={messageHref(entry.source.messageKey, returnTo)}>
                  Reviewed source
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}
export function AnchorEvents({
  items,
  complete = true,
  reviewControls = true,
  scenarioNow,
}: {
  items: CurrentEventView[];
  complete?: boolean;
  reviewControls?: boolean;
  scenarioNow?: string;
}) {
  if (items.length === 0 && complete) {
    return null;
  }
  return (
    <section className="space-y-3 my-4" aria-label="Message history and version review">
      <h2 className="font-semibold">Message history and version review</h2>
      {scenarioNow !== undefined && <p className="text-sm">Scenario time: {utc(scenarioNow)}</p>}
      {!complete && (
        <p role="alert">
          Current-event coverage is incomplete. Scheduling assessment requires complete inputs.
        </p>
      )}
      {items.map((item) => (
        <AnchorEvent
          key={`${item.logicalEventId}:${item.versionToken ?? item.status}:${item.taskVersion}`}
          item={item}
          reviewControls={reviewControls}
        />
      ))}
    </section>
  );
}
export function AnchorHistory({ messageKey }: { messageKey: string }) {
  const { session } = useSession();
  const result = useAnchorCurrent(messageKey);
  if (session?.authenticated !== true || messageKey === "" || messageKey.startsWith("legacy:")) {
    return null;
  }
  if (result.isPending) {
    return <p role="status">Loading message history…</p>;
  }
  if (result.isError) {
    return (
      <div role="alert">
        Message history unavailable. {result.error.message}{" "}
        <button
          className="btn btn-sm"
          onClick={() => {
            void result.refetch();
          }}
        >
          Retry history
        </button>
      </div>
    );
  }
  if (result.data?.configured !== true) {
    return null;
  }
  return (
    <AnchorEvents
      items={result.data.items}
      complete={result.data.complete}
      scenarioNow={result.data.scenarioNow}
    />
  );
}
