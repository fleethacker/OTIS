import { useId, useState } from "react";
import { DraftEditor } from "./draft-editor";
import { StructuredMessage } from "./structured-message";
import { messageTitle } from "./structured-message-format";
import { MessageAcknowledgement } from "./message-acknowledgement";
import type { MessageRecord } from "../gen/app/v1/models_pb";

export function MessageReader({ message }: { message: MessageRecord }) {
  const [tab, setTab] = useState("parsed");
  const id = useId();
  const views = ["parsed", "raw"];
  const needsReview =
    message.processingStatus === "needs_review" ||
    message.events.some((event) => event.scheduleStatus === "needs_review");
  return (
    <DraftEditor source={message.sourceMessageId}>
      <article className="message-reader" aria-label="Selected message">
        <header>
          <h2>{messageTitle(message)}</h2>
          <div className="message-reader-status">
            {needsReview && <span className="status-pill status-pill-review">needs review</span>}
            <MessageAcknowledgement message={message} />
          </div>
        </header>
        <div className="reader-content">
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
                {["Parsed Message", "Raw message"][index]}
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
            ) : (
              <section aria-label="Raw message">
                {message.rawText ? (
                  <pre className="usmtf-raw">{message.rawText}</pre>
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
