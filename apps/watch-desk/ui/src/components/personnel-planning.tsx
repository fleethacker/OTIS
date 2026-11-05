import {
  isPlanningView,
  planningQueryKey,
  usePlanning,
  type PlanningInterval,
} from "./personnel-planning-data";
export type { PlanningView, PlanningProposal } from "./personnel-planning-data";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { accountRequest, useSession } from "./workflow-session";
import { sourceScopeKey } from "./source-data";
import { messageHref } from "./calendar-links";

function utc(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unresolved time"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
function planningInterval(value: PlanningInterval | null) {
  if (value === null) {
    return "Unresolved times";
  }
  const start = new Date(value.start);
  const end = new Date(value.end);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return "Unresolved times";
  }
  const a = start.toISOString();
  const b = end.toISOString();
  return `${a.slice(0, 10)} ${a.slice(11, 16)}–${a.slice(0, 10) === b.slice(0, 10) ? "" : `${b.slice(0, 10)} `}${b.slice(11, 16)} UTC`;
}
export function PersonnelPlanning({ returnTo = "/calendar" }: { returnTo?: string }) {
  const { session } = useSession();
  if (session?.authenticated !== true || !session.permissions.includes("schedule:read")) {
    return null;
  }
  // Reset transient decision/error state whenever identity or effective source scope changes.
  return (
    <PlanningPanel
      key={JSON.stringify([session.user?.id, sourceScopeKey(session)])}
      returnTo={returnTo}
    />
  );
}
function PlanningPanel({ returnTo }: { returnTo: string }) {
  const { session } = useSession();
  const client = useQueryClient();
  const result = usePlanning();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  // Failed reads must never leave an actionable stale schedule on screen.
  const data = result.isError ? undefined : result.data;
  const pendingProposals =
    data?.proposals.filter((proposal) => proposal.status === "pending") ?? [];
  const currentProposals = pendingProposals.filter(
    (proposal) => proposal.inputVersion === data?.inputVersion
  );
  const pending = currentProposals.slice(-1).pop() ?? pendingProposals.slice(-1).pop();
  const pendingIsStale = pending !== undefined && pending.inputVersion !== data?.inputVersion;
  const otherStaleProposals = pendingProposals.filter(
    (proposal) => proposal.id !== pending?.id && proposal.inputVersion !== data?.inputVersion
  );
  const assessment = data?.assessment;
  const inputs = data?.inputs;
  async function refreshRelated() {
    await Promise.all([
      client.invalidateQueries({ queryKey: planningQueryKey }),
      client.invalidateQueries({ queryKey: ["assigned-work"] }),
      client.invalidateQueries({ queryKey: ["anchor-current"] }),
      client.invalidateQueries({ queryKey: ["parse-command-source"] }),
    ]);
  }
  async function mutate(operation: "setup" | "propose" | "decide", fields: object = {}) {
    if (!data || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await accountRequest<unknown>(`/api/v1/planning/${operation}`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: data.version, ...fields }),
      });
      if (!isPlanningView(saved)) {
        throw new Error("Personnel planning response could not be verified. Refresh to try again.");
      }
      await refreshRelated();
      setNotice(
        operation === "decide"
          ? "Decision saved. The local plan shown below reflects the persisted state."
          : operation === "propose"
            ? "Proposal saved for coordinator review."
            : "Fictional personnel planning inputs prepared."
      );
      setReason("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Planning could not be saved. Recalculate and try again."
      );
      await result.refetch();
    } finally {
      setBusy(false);
    }
  }
  const mayDecide = data?.canCoordinate === true;
  return (
    <section
      className="card border border-base-300 bg-base-100 p-4 gap-4"
      aria-labelledby="personnel-planning-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold" id="personnel-planning-heading">
          Personnel planning
        </h2>
        <button
          className="btn btn-sm"
          type="button"
          disabled={busy || result.isFetching}
          onClick={() => void result.refetch()}
        >
          Refresh personnel planning
        </button>
      </div>
      <p className="text-sm text-bc-muted">
        Fictional Meridian scenario · November 10, 2026 · UTC. Personnel and local training are
        separately authored planning records.
      </p>
      {result.isPending && <p role="status">Loading personnel planning…</p>}
      {result.isError && (
        <p role="alert">Personnel planning could not be checked. {result.error.message}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && !data.configured && (
        <div className="space-y-3">
          <p>No personnel planning scenario is configured.</p>
          {mayDecide && session?.authMode === "local_demo" && (
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy}
              onClick={() => void mutate("setup")}
            >
              Prepare fictional personnel scenario
            </button>
          )}
        </div>
      )}
      {data?.configured === true && (
        <>
          <p className="text-sm">Scenario clock: {utc(data.scenarioNow)}</p>
          {assessment?.provisional === true && (
            <p className="text-sm text-warning font-medium">
              Provisional assessment — includes unvalidated source facts. A planning decision does
              not validate those facts.
            </p>
          )}
          {inputs && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {inputs.events.map((event) => (
                  <article
                    className="rounded-box border border-base-300 p-3 space-y-2"
                    key={event.id}
                    aria-label={event.title}
                  >
                    <h3 className="font-semibold">{event.title}</h3>
                    <p>{planningInterval(event.interval)}</p>
                    <p className="text-sm">
                      {event.fixed ? "Fixed source-directed event" : "Movable local training plan"}
                    </p>
                    <p className="text-sm">
                      Assigned people:{" "}
                      {event.personIds
                        .map((id) => {
                          const person = inputs.people.find((entry) => entry.id === id);
                          return person
                            ? `${person.name} (${id})`
                            : `${id} — personnel record missing`;
                        })
                        .join(", ") || "Assignment unknown"}
                    </p>
                    <p className="text-sm">
                      Required qualifications:{" "}
                      {event.requiredQualifications === null
                        ? "Unknown"
                        : event.requiredQualifications.length === 0
                          ? "None declared"
                          : event.requiredQualifications.join(", ")}
                    </p>
                    <p className="text-sm">
                      {event.bufferBeforeMinutes === null && event.bufferAfterMinutes === null
                        ? "No setup/rest buffer declared"
                        : `Setup/rest buffers: before ${event.bufferBeforeMinutes === null ? "not declared" : `${event.bufferBeforeMinutes} minutes`}; after ${event.bufferAfterMinutes === null ? "not declared" : `${event.bufferAfterMinutes} minutes`}`}
                    </p>
                    {event.sourceRef === "" ? (
                      <p className="text-sm">Source unresolved</p>
                    ) : event.sourceRef.startsWith("local:") ? (
                      <p className="text-sm break-all">Local planning source: {event.sourceRef}</p>
                    ) : (
                      <Link
                        className="link text-sm break-all"
                        to={messageHref(event.sourceRef, returnTo)}
                      >
                        View source: {event.title}
                      </Link>
                    )}
                    <p className="text-xs break-all text-bc-muted">
                      Input version: {event.version === "" ? "unresolved" : event.version}
                    </p>
                  </article>
                ))}
              </div>
              <div className="text-sm space-y-2">
                {inputs.people.map((person) => (
                  <p key={person.id}>
                    {person.name} ({person.id}) · Qualifications:{" "}
                    {person.qualifications === null
                      ? "Unknown"
                      : person.qualifications.length === 0
                        ? "None"
                        : person.qualifications.join(", ")}{" "}
                    · Availability:{" "}
                    {person.availability === null
                      ? "Unknown"
                      : person.availability.length === 0
                        ? "Unavailable"
                        : person.availability.map(planningInterval).join("; ")}
                  </p>
                ))}
                <p>
                  Personnel observed: {utc(inputs.rosterObservedAt)} · Valid until:{" "}
                  {utc(inputs.rosterValidUntil)}
                </p>
                <p>
                  Move window: {planningInterval(inputs.rules.window)} · Duration:{" "}
                  {inputs.rules.durationMinutes} minutes · Later starts on a{" "}
                  {inputs.rules.gridMinutes}-minute grid.
                </p>
                <p>
                  {inputs.scheduleComplete
                    ? "Declared complete scenario coverage"
                    : "Incomplete schedule coverage"}
                  : {planningInterval(inputs.coverage)}
                </p>
              </div>
            </>
          )}
          {assessment && (
            <div className="space-y-3" aria-label="Personnel assessment">
              {assessment.collisions.map((collision, i) => (
                <div
                  className="rounded-box border border-warning p-3"
                  key={`${collision.personId}-${i}`}
                >
                  <p className="font-medium">Personnel conflict: {collision.personId}</p>
                  <p>
                    {collision.eventIds
                      .map((id) => inputs?.events.find((event) => event.id === id)?.title ?? id)
                      .join(" and ")}
                  </p>
                  <p>
                    Overlap: {planningInterval(collision.overlap)}
                    {collision.includesBuffer ? " (includes declared buffers)" : ""}
                  </p>
                </div>
              ))}
              {assessment.status === "incomplete" && (
                <p role="status" className="font-medium">
                  Incomplete assessment — resolve the missing or stale inputs before proposing a
                  move.
                </p>
              )}
              {assessment.alternative && (
                <p className="font-medium">
                  Earliest feasible alternative: {planningInterval(assessment.alternative)}
                </p>
              )}
              <ul className="list-disc pl-5 text-sm space-y-1">
                {assessment.explanation.map((explanation, i) => (
                  <li key={i}>{explanation}</li>
                ))}
              </ul>
              <p className="text-sm">Permitted starts checked: {assessment.checkedStarts}</p>
              {mayDecide && (
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  disabled={
                    busy ||
                    result.isFetching ||
                    assessment.status !== "feasible" ||
                    assessment.alternative === null
                  }
                  onClick={() => void mutate("propose")}
                >
                  Calculate and save proposal
                </button>
              )}
            </div>
          )}
          {pending && (
            <div className="border-t border-base-300 pt-3 space-y-3" aria-label="Saved proposal">
              <h3 className="font-semibold">Saved local training proposal</h3>
              <p>{planningInterval(pending.alternative)}</p>
              <p className="text-sm break-all">
                Calculated by {pending.actor} at {utc(pending.createdAt)} · Input version:{" "}
                {pending.inputVersion}
              </p>
              {pendingIsStale && (
                <p role="status" className="text-sm text-warning">
                  Planning inputs changed. Recalculate before deciding on this proposal.
                </p>
              )}
              {mayDecide && (
                <>
                  <label className="flex flex-col gap-2 text-sm">
                    Decision reason (optional)
                    <input
                      className="input w-full"
                      value={reason}
                      maxLength={500}
                      disabled={busy}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="btn btn-sm btn-primary"
                      type="button"
                      disabled={
                        busy ||
                        result.isFetching ||
                        pendingIsStale ||
                        assessment?.status === "incomplete"
                      }
                      onClick={() =>
                        void mutate("decide", {
                          proposalId: pending.id,
                          decision: "accept",
                          reason,
                        })
                      }
                    >
                      Accept local training move
                    </button>
                    <button
                      className="btn btn-sm"
                      type="button"
                      disabled={busy || result.isFetching || pendingIsStale}
                      onClick={() =>
                        void mutate("decide", {
                          proposalId: pending.id,
                          decision: "reject",
                          reason,
                        })
                      }
                    >
                      Reject proposal
                    </button>
                  </div>
                  <p className="text-sm text-bc-muted">
                    Acceptance rechecks current inputs and changes only local training. Rejection
                    leaves the schedule unchanged.
                  </p>
                </>
              )}
            </div>
          )}
          {otherStaleProposals.length > 0 && (
            <div className="border-t border-base-300 pt-3 space-y-2">
              <h3 className="font-semibold">Earlier proposals with changed inputs</h3>
              <ul className="space-y-2 text-sm">
                {otherStaleProposals.map((proposal) => (
                  <li key={proposal.id}>
                    Stale proposal: {planningInterval(proposal.alternative)} · Input version:{" "}
                    {proposal.inputVersion}. Recalculation required; no decision is available for
                    this version.
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.decisions.length > 0 && (
            <div className="border-t border-base-300 pt-3 space-y-3">
              <h3 className="font-semibold">Planning decision history</h3>
              <ul className="space-y-3">
                {data.decisions.map((decision, i) => (
                  <li key={`${decision.proposalId}-${i}`} className="text-sm space-y-1">
                    <p>
                      {decision.decision === "accept"
                        ? "Accepted local training move"
                        : "Rejected proposal"}{" "}
                      · {decision.actor} · {utc(decision.recordedAt)}
                    </p>
                    <p className="break-all">Input version: {decision.inputVersion}</p>
                    {decision.reason && <p>Reason: {decision.reason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
