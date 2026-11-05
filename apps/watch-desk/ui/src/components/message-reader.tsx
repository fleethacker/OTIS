import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TbSearch } from "react-icons/tb";
import { DraftEditor } from "./draft-editor";
import { StructuredMessage } from "./structured-message";
import { messageTitle } from "./structured-message-format";
import { MessageLifecycle } from "./message-lifecycle";
import { MessageAcknowledgement } from "./message-acknowledgement";
import { MessageMap } from "./message-map";
import { RecordStatus } from "./ui";
import type { MessageRecord } from "../gen/app/v1/models_pb";

export function MessageReader({ message }: { message: MessageRecord }) {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "lifecycle" ? "lifecycle" : "parsed");
  const id = useId();
  const returnTo = params.get("returnTo");
  const views = ["parsed", "raw", "lifecycle"];
  const needsReview = message.processingStatus === "needs_review";
  return (
    <DraftEditor source={message.sourceMessageId}>
      <article className="message-reader" aria-label="Selected message">
        <header>
          <h2>{messageTitle(message)}</h2>
          {message.sourceMessageId !== "" && !message.sourceMessageId.startsWith("legacy:") && (
            <Link
              className="btn btn-outline btn-sm message-similar-action"
              to={`/messages?${new URLSearchParams({ similarTo: message.sourceMessageId, ...(returnTo !== null ? { returnTo } : {}) })}`}
            >
              <TbSearch aria-hidden="true" />
              Find similar messages
            </Link>
          )}
          <div className="message-reader-status">
            {needsReview && (
              <RecordStatus value="needs_review" className="status-pill status-pill-review">
                needs review
              </RecordStatus>
            )}
            {message.processingStatus === "parsed" && (
              <RecordStatus value="parsed" className="status-pill" />
            )}
            <MessageAcknowledgement message={message} />
          </div>
        </header>
        <div className="reader-content">
          <MessageMap message={message} />
          <div role="tablist" aria-label="Message views" className="tabs tabs-border">
            {views.map((view, index) => (
              <button
                key={view}
                id={`${id}-${view}`}
                role="tab"
                aria-controls={`${id}-panel-${view}`}
                aria-selected={tab === view}
                tabIndex={tab === view ? 0 : -1}
                className={`tab ${tab === view ? "tab-active" : ""}`}
                onClick={() => setTab(view)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? views.length - 1
                        : event.key === "ArrowRight"
                          ? (index + 1) % views.length
                          : event.key === "ArrowLeft"
                            ? (index + views.length - 1) % views.length
                            : -1;
                  if (next < 0) {
                    return;
                  }
                  event.preventDefault();
                  setTab(views[next]);
                  document.getElementById(`${id}-${views[next]}`)?.focus();
                }}
              >
                {["Parsed Message", "Raw message", "Lifecycle"][index]}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${id}-panel-${tab}`}
            aria-labelledby={`${id}-${tab}`}
            tabIndex={0}
          >
            {tab === "parsed" ? (
              <section aria-label="Parsed Message">
                <StructuredMessage message={message} />
              </section>
            ) : tab === "lifecycle" ? (
              <MessageLifecycle message={message} />
            ) : (
              <section aria-label="Raw message">
                {message.rawText ? (
                  <pre className="usmtf-raw" tabIndex={0} role="region" aria-label="Raw message text">
                    <code>{message.rawText}</code>
                  </pre>
                ) : (
                  <p className="text-sm">Raw message unavailable.</p>
                )}
              </section>
            )}
          </div>
        </div>
      </article>
    </DraftEditor>
  );
}
