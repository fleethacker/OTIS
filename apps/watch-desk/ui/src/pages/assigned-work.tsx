import { AnchorEvents } from "../components/anchor-history";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { RouteMeta } from "../route-registry";
import { accountTime, useSession } from "../components/workflow-session";
import { useWork, useWorkMutation, type WorkTask } from "../components/work-data";

export const route: RouteMeta = { path: "/assigned-work", label: "Assigned work", order: 2 };
const progressLabel = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

function TaskCard({ task, coordinate }: { task: WorkTask; coordinate: boolean }) {
  const mutation = useWorkMutation();
  const { session } = useSession();
  const reviewedByMe = task.reviews.some(
    (review) =>
      review.actor === session?.user?.id &&
      review.eventVersion === task.eventVersion &&
      review.source.messageKey === task.source.messageKey &&
      review.source.factId === task.source.factId
  );
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState(task.ownerId ?? "");
  const [progress, setProgress] = useState(task.progress);
  useEffect(() => {
    setReason("");
    setOwner(task.ownerId ?? "");
    setProgress(task.progress);
  }, [task.version, task.ownerId, task.progress]);
  function update(operation: string, extra: object = {}) {
    mutation.mutate({
      operation,
      body: {
        taskId: task.id,
        expectedVersion: task.version,
        eventVersion: task.eventVersion,
        ...((task.currentVersionToken ?? "") !== ""
          ? { currentVersionToken: task.currentVersionToken }
          : {}),
        ...extra,
      },
    });
  }
  return (
    <article
      className="card border border-base-300 bg-base-100 p-5 space-y-4"
      aria-label={task.action}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{task.action}</h2>
          <p>
            Meridian · {task.responsibilityName} · {task.ownerName ?? "Unassigned"}
            {task.personId !== null ? ` · ${task.personId}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-outline">{progressLabel[task.progress]}</span>
          <span className={`badge ${task.reviewed ? "badge-success" : "badge-warning"}`}>
            {task.reviewed ? "Version reviewed" : "Review required"}
          </span>
          {task.overdue && <span className="badge badge-error">Overdue review</span>}
        </div>
      </div>
      {task.currentEvent && <AnchorEvents items={[task.currentEvent]} reviewControls={false} />}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Review due</dt>
          <dd>{task.dueAt !== null ? accountTime(task.dueAt) : "Due time unknown"}</dd>
          <dd className="text-sm text-bc-muted">{task.dueBasis}</dd>
        </div>
        <div>
          <dt className="font-semibold">Source event</dt>
          <dd>
            {task.start !== null && task.end !== null
              ? `${accountTime(task.start)} – ${accountTime(task.end)}`
              : task.instructionStatus === "cancelled"
                ? "Cancelled — removed from active scheduling"
                : "Event time unresolved"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold">Assignment reason</dt>
          <dd>{task.assignmentReason}</dd>
        </div>
      </dl>
      <details>
        <summary className="cursor-pointer font-semibold">Source evidence and review flags</summary>
        <p className="text-sm my-2">
          Parsed facts remain {task.factStatus || "unvalidated"}; source status: {task.sourceStatus}
          . Internal review does not validate extraction.
        </p>
        {task.reviewFlags.length > 0 && (
          <p className="text-sm">Review flags: {task.reviewFlags.join(", ")}</p>
        )}
        <pre className="whitespace-pre-wrap break-words text-sm bg-base-200 p-3 rounded-box">
          {task.sourceExcerpt}
        </pre>
        <p className="text-sm mt-2">
          Source contacts (separate from local owners):{" "}
          {(task.sourceContacts?.length ?? 0) > 0
            ? (task.sourceContacts ?? [])
                .map((c) => [c.name, c.position, c.unit].filter(Boolean).join(" · "))
                .join("; ")
            : "None listed"}
        </p>
      </details>
      <Link
        className="link break-all text-sm"
        to={`/messages?${new URLSearchParams({ record: task.source.messageKey })}`}
      >
        Open exact source · {task.source.factId ?? "message"}
      </Link>
      <p className="text-xs break-all text-bc-muted">
        {task.source.messageKey} · Event version {task.eventVersion}
      </p>
      <div className="space-y-3 border-t border-base-300 pt-3">
        <p className="text-sm">
          Review, task completion and formal sending are separate. These controls send no message.
        </p>
        <button
          className="btn btn-sm"
          disabled={!task.canAct || mutation.isPending || reviewedByMe}
          onClick={() => update("review")}
        >
          Reviewed this version
        </button>
        {task.canAct && (
          <>
            <label className="block">
              Decision reason
              <input
                className="input input-bordered w-full mt-1"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain a progress or assignment change"
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label>
                Task progress
                <select
                  className="select select-bordered block mt-1"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value as WorkTask["progress"])}
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <button
                className="btn btn-sm"
                disabled={mutation.isPending || !reason.trim() || progress === task.progress}
                onClick={() => update("progress", { progress, reason })}
              >
                Save progress
              </button>
            </div>
          </>
        )}
        {coordinate && (
          <div className="flex flex-wrap items-end gap-3">
            <label>
              Local owner
              <select
                className="select select-bordered block mt-1"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              >
                <option value="">Unassigned</option>
                <option value="demo:dev-user">P-01 · Meridian OPS demo owner</option>
                <option value="demo:dev-admin">Demo coordinator</option>
                {task.ownerId !== null &&
                  !["demo:dev-user", "demo:dev-admin"].includes(task.ownerId) && (
                    <option value={task.ownerId}>{task.ownerName ?? task.ownerId}</option>
                  )}
              </select>
            </label>
            <button
              className="btn btn-sm"
              disabled={mutation.isPending || !reason.trim() || owner === (task.ownerId ?? "")}
              onClick={() => update("assign", { ownerId: owner || null, reason })}
            >
              Reassign
            </button>
          </div>
        )}
        {!task.canAct && (
          <p className="text-sm text-bc-muted">
            The designated owner or coordinator can update this work.
          </p>
        )}
        {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      </div>
      <details>
        <summary className="cursor-pointer">
          Review and decision history ({task.history.length})
        </summary>
        <ul className="space-y-2 mt-2">
          {task.history.map((entry, i) => (
            <li key={`${entry.recordedAt}-${i}`} className="text-sm">
              {entry.action} · {entry.actor} · {accountTime(entry.recordedAt)}
              <p>{entry.reason}</p>
            </li>
          ))}
        </ul>
        {task.reviews.map((review, i) => (
          <p className="text-sm mt-2" key={`${review.actor}-${i}`}>
            Reviewed version {review.eventVersion} by {review.actor} at{" "}
            {accountTime(review.recordedAt)} · {review.source.factId ?? "message"}
          </p>
        ))}
      </details>
    </article>
  );
}
export default function AssignedWork() {
  const result = useWork();
  const mutation = useWorkMutation();
  const [filter, setFilter] = useState("all");
  const data = result.isError ? undefined : result.data;
  const items =
    data?.items.filter(
      (task) =>
        filter === "all" ||
        (filter === "unassigned" && task.ownerId === null) ||
        (filter === "overdue" && task.overdue) ||
        (filter === "unknown" && task.dueAt === null)
    ) ?? [];
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assigned work</h1>
          <p className="text-bc-muted mt-2">Source-linked coordination for fictional Meridian</p>
        </div>
        <button className="btn" disabled={result.isFetching} onClick={() => void result.refetch()}>
          Refresh work
        </button>
      </header>
      {result.isPending && <p role="status">Loading assigned work…</p>}
      {result.isError && (
        <p className="alert" role="alert">
          Work could not be loaded. {result.error.message}
        </p>
      )}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
      {data && (
        <>
          <section className="rounded-box bg-base-200 p-4 space-y-3">
            <p>Deterministic synthetic scenario · {accountTime(data.scenarioNow)}</p>
            <p className="text-sm">
              Local demo policy and P-01 are authored scenario inputs. Decision history uses actual
              server time.
            </p>
            {!data.configured ? (
              <>
                {data.canCoordinate ? (
                  <button
                    className="btn btn-primary"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ operation: "setup", body: {} })}
                  >
                    Set up Meridian scenario
                  </button>
                ) : (
                  <p>A coordinator must set up the scenario.</p>
                )}
              </>
            ) : (
              data.canCoordinate && (
                <div className="flex flex-wrap gap-2">
                  {["08:15", "09:01"].map((time) => (
                    <button
                      key={time}
                      className="btn btn-sm"
                      disabled={mutation.isPending}
                      onClick={() =>
                        mutation.mutate({
                          operation: "clock",
                          body: {
                            expectedVersion: data.version,
                            scenarioNow: `2026-11-10T${time}:00Z`,
                          },
                        })
                      }
                    >
                      Set scenario clock to {time} UTC
                    </button>
                  ))}
                </div>
              )
            )}
            {data.pendingSources.length > 0 && (
              <p role="status">
                Awaiting parser publication: {data.pendingSources.join(", ")}. Replay the synthetic
                source files, then refresh.
              </p>
            )}
          </section>
          <label>
            Show work
            <select
              className="select select-bordered ml-2"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All visible work</option>
              <option value="unassigned">Unassigned</option>
              <option value="unknown">Unknown deadline</option>
              <option value="overdue">Overdue review</option>
            </select>
          </label>
          {data.configured && items.length === 0 && <p>No visible work matches this filter.</p>}
          <section aria-label="Task queue" className="space-y-4">
            {items.map((task) => (
              <TaskCard key={task.id} task={task} coordinate={data.canCoordinate} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
