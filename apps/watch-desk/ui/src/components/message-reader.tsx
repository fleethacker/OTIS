import { useId, useState } from "react";
import { DraftEditor, PrivateComposer, PrivateTracking } from "./draft-editor";
import { recordStatus } from "./message-format";
import { useDisplayTime } from "./display-time";
import { StructuredMessage } from "./structured-message";
import { messageTitle } from "./structured-message-format";
import type { MessageRecord, ExtractedEvent, SourceLineReferences } from "../gen/app/v1/models_pb";

function evidence(value?: SourceLineReferences) {
  return !value
    ? "Unavailable"
    : value.lines.length > 0
      ? `Lines ${value.lines.join(", ")}`
      : "No supporting lines supplied";
}
function EventFields({ event }: { event: ExtractedEvent }) {
  const { format: utc } = useDisplayTime();
  return (
    <section className="parsed-event">
      <h3>
        {event.title || "Event title unavailable"}{" "}
        {event.isRevised && <span className="revision">Revised</span>}
      </h3>
      {event.scheduleStatus === "needs_review" && (
        <p className="review-cue">Needs review — {event.reviewReason ?? "Schedule unresolved"}</p>
      )}
      <dl className="message-meta">
        <dt>Unit</dt>
        <dd>{event.unit ?? "Unavailable"}</dd>
        <dt>Location</dt>
        <dd>{event.location ?? "Unavailable"}</dd>
        <dt>Start</dt>
        <dd>{utc(event.startAt)}</dd>
        <dt>End</dt>
        <dd>{utc(event.endAt)}</dd>
        <dt>Time evidence</dt>
        <dd>{evidence(event.timeSourceLines)}</dd>
        <dt>Location evidence</dt>
        <dd>{evidence(event.locationSourceLines)}</dd>
      </dl>
      {event.isRevised && event.revisions.length === 0 && <p>Revision history unavailable.</p>}
      {event.revisions.map((revision) => (
        <div className="revision-history" key={String(revision.id)}>
          <strong>Revision {String(revision.sequence)}</strong>
          <p>{revision.description ?? "Description unavailable"}</p>
          <p>
            Recorded: {utc(revision.revisedAt)} · Source:{" "}
            {revision.sourceMessageId ?? "Unavailable"}
          </p>
          <p>
            Prior: {utc(revision.priorStartAt)} → {utc(revision.priorEndAt)}
          </p>
          <p>
            Replacement: {utc(revision.replacementStartAt)} → {utc(revision.replacementEndAt)}
          </p>
          <p>Time evidence: {evidence(revision.timeSourceLines)}</p>
        </div>
      ))}
    </section>
  );
}
export function MessageReader({ message }: { message: MessageRecord }) {
  const { format: utc } = useDisplayTime();
  const [tab, setTab] = useState("parsed");
  const tabId = useId();
  const views = ["parsed", "raw", "lifecycle"];
  const timeLines = new Set(
    message.events.flatMap((e) => [
      ...(e.timeSourceLines?.lines ?? []),
      ...e.revisions.flatMap((r) => r.timeSourceLines?.lines ?? []),
    ])
  );
  const locationLines = new Set(message.events.flatMap((e) => e.locationSourceLines?.lines ?? []));
  return (
    <article className="message-reader" aria-label="Selected message">
      <header>
        <p className="record-id">{message.sourceMessageId}</p>
        <h2>{messageTitle(message)}</h2>
        <p>{recordStatus(message.processingStatus)}</p>
      </header>
      {message.provenance === "fictional" && (
        <p className="preview-notice">
          Fictional USS Meridian example · Illustrative syntax, not validated USMTF.
        </p>
      )}
      {message.provenance === "reference" && (
        <p className="preview-notice">
          Attachment reference · {message.referenceAttribution ?? "Attribution unavailable"} · Not
          operational data or validated USMTF.
        </p>
      )}
      <dl className="message-meta">
        <dt>Sender</dt>
        <dd>{message.sender ?? "Unavailable"}</dd>
        <dt>Received</dt>
        <dd>{utc(message.receivedAt)}</dd>
        <dt>Recipients</dt>
        <dd>
          {message.recipients
            ? message.recipients.values.join(", ") || "None listed"
            : "Unavailable"}
        </dd>
      </dl>
      <DraftEditor source={message.sourceMessageId}>
        <div className="reader-layout">
          <div className="reader-content">
            <div role="tablist" aria-label="Message views" className="tabs tabs-border">
              {views.map((view, index) => (
                <button
                  key={view}
                  id={`${tabId}-${view}`}
                  role="tab"
                  aria-controls={`${tabId}-panel-${view}`}
                  aria-selected={tab === view}
                  tabIndex={tab === view ? 0 : -1}
                  className={`tab ${tab === view ? "tab-active" : ""}`}
                  onClick={() => setTab(view)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 2
                          : event.key === "ArrowRight"
                            ? (index + 1) % 3
                            : event.key === "ArrowLeft"
                              ? (index + 2) % 3
                              : -1;
                    if (next < 0) {
                      return;
                    }
                    event.preventDefault();
                    setTab(views[next]);
                    document.getElementById(`${tabId}-${views[next]}`)?.focus();
                  }}
                >
                  {["Parsed fields", "Raw message", "Lifecycle"][index]}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${tabId}-panel-${tab}`}
              aria-labelledby={`${tabId}-${tab}`}
              tabIndex={0}
            >
              {tab === "raw" ? (
                <section aria-label="Raw message">
                  <p className="feature-note">
                    Highlighted evidence: Time / Location. Only supplied source references are
                    marked.
                  </p>
                  {message.rawText ? (
                    <ol className="raw-lines">
                      {message.rawText.split("\n").map((line, index) => (
                        <li
                          key={index}
                          className={
                            timeLines.has(index + 1) || locationLines.has(index + 1)
                              ? "source-evidence"
                              : ""
                          }
                        >
                          <code>{line || " "}</code>
                          {(timeLines.has(index + 1) || locationLines.has(index + 1)) && (
                            <span className="evidence-label">
                              {[
                                timeLines.has(index + 1) && "Time",
                                locationLines.has(index + 1) && "Location",
                              ]
                                .filter(Boolean)
                                .join(" / ")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>Raw message unavailable.</p>
                  )}
                </section>
              ) : tab === "parsed" ? (
                <section aria-label="Parsed fields">
                  <p className="feature-note">
                    Upstream extracted fields; no raw syntax is parsed here.
                  </p>
                  {message.structuredPayloadJson !== undefined && (
                    <StructuredMessage message={message} />
                  )}
                  {message.events.length === 0 && <p>Extracted events unavailable.</p>}
                  {message.events.map((e) => (
                    <EventFields key={String(e.id)} event={e} />
                  ))}
                </section>
              ) : (
                <section aria-label="Message lifecycle">
                  <PrivateTracking source={message.sourceMessageId} />
                  <h3>Processing history</h3>
                  <p className="feature-note">
                    Partial history — only supplied processing evidence is shown. Other milestones
                    are unavailable; current status does not establish a complete sequence. Saved
                    drafts are unsent, not acknowledgements.
                  </p>
                  {message.lifecycleEntries.length === 0 ? (
                    <p>Lifecycle history unavailable.</p>
                  ) : (
                    <ol className="message-lifecycle">
                      {message.lifecycleEntries.map((entry) => (
                        <li key={entry.id}>
                          <strong>
                            {entry.milestone.charAt(0).toUpperCase() + entry.milestone.slice(1)}
                          </strong>
                          <p>
                            {entry.recordedAt ? (
                              <time>{utc(entry.recordedAt)}</time>
                            ) : (
                              "Time unavailable — position in chronology unknown"
                            )}
                          </p>
                          {entry.detail && <p>{entry.detail}</p>}
                          {entry.provenance && (
                            <p className="feature-note">Source: {entry.provenance}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}
              {tab === "raw" && (
                <section aria-label="Extracted schedule">
                  <h3>Extracted schedule</h3>
                  {message.events.length === 0 && <p>Extracted events unavailable.</p>}
                  {message.events.map((e) => (
                    <EventFields key={String(e.id)} event={e} />
                  ))}
                </section>
              )}
            </div>
          </div>
          <aside className="message-actions" aria-label="Message actions">
            <h3>Message actions</h3>
            <button className="btn btn-outline btn-sm" disabled>
              Summarize
            </button>
            <p>Planned future AI feature. No summary generated.</p>
            <PrivateComposer source={message.sourceMessageId} subject={messageTitle(message)} />
          </aside>
        </div>
      </DraftEditor>
    </article>
  );
}
