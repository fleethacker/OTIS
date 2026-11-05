import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { create } from "@bufbuild/protobuf";
import { TbX } from "react-icons/tb";
import type { RouteMeta } from "../route-registry";
import { MessageRecordSchema } from "../gen/app/v1/models_pb";
import { MessageSearchCard } from "../components/message-search-card";
import { MessagePagination } from "../components/message-search-controls";
import { MessageReader } from "../components/message-reader";
import { useSource } from "../components/source-data";
import { briefingScopeLabel, shiftReturn, useBriefing } from "../components/briefing-data";
import { accountTime, defaultMessageScope, useSession } from "../components/session";
import { ResponsibilitySummary } from "../components/responsibility-selection";
import { StationSummary } from "../components/station-assignment";

export const route: RouteMeta = { path: "/shift", label: "Shift briefing", order: -1 };

export default function Shift() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const scope = session?.settings.messageScope ?? defaultMessageScope;
  const criteria = JSON.stringify([session?.user?.id, session?.login?.startedAt, scope]);
  const [page, setPage] = useState<{ criteria: string; token?: string }>({ criteria: "" });
  const token = page.criteria === criteria ? page.token : undefined;
  const result = useBriefing(token);
  const record = params.get("record") ?? "";
  const detail = useSource(
    "detail",
    { key: record, dataset: "canonical" },
    record !== "" && session?.login?.briefingAvailable === true
  );
  const cardList = useRef<HTMLElement>(null);
  const destination = shiftReturn(params.get("returnTo"));
  const selected = detail.data?.messages[0];
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
  function changePage(pageToken: string) {
    setPage({ criteria, token: pageToken });
    select("");
    cardList.current?.focus();
  }
  function retry() {
    if (token === undefined) {
      void result.refetch();
    } else {
      setPage({ criteria });
    }
  }
  const data = result.isError ? undefined : result.data;
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Shift briefing</h1>
          <p className="text-bc-muted mt-2">
            Messages ready for your watch, gathered when you sign in.
          </p>
        </div>
        <Link className="btn btn-primary" to={destination}>
          {destination.startsWith("/calendar")
            ? "Continue to Calendar"
            : "Continue to your workspace"}
        </Link>
      </header>
      <StationSummary
        assignment={session?.user?.stationAssignment}
        required={session?.stationAssignmentRequired}
      />
      <div className="rounded-box border border-base-300 bg-base-100 p-4 space-y-2">
        <p className="text-sm">Personal preferences within your authorized message scope</p>
        <p className="text-sm break-words">{briefingScopeLabel(data?.messageScope ?? scope)}</p>
        <ResponsibilitySummary selected={(data?.messageScope ?? scope).responsibilityIds ?? []} />
        <Link className="link text-sm" to="/account">
          Change relevant messages
        </Link>
      </div>
      {session?.login?.briefingAvailable !== true ? (
        <section className="card border border-base-300 p-5 gap-3">
          <h2 className="text-lg font-semibold">Start a fresh shift briefing</h2>
          <p>
            {session?.login?.briefingAvailable === false
              ? "Your briefing was unavailable when you signed in. Sign in again when the message source is available."
              : "This session started before shift briefings were available. Sign in again to gather your messages."}
          </p>
          <div>
            <a className="btn" href={`/auth/login?return=${encodeURIComponent(destination)}`}>
              Sign in again
            </a>
          </div>
        </section>
      ) : (
        <>
          {result.isPending && <p role="status">Gathering your shift briefing…</p>}
          {result.isError && (
            <div className="alert" role="alert">
              Shift briefing could not be loaded. {result.error.message}{" "}
              <button className="btn btn-sm" onClick={retry}>
                Retry briefing
              </button>
            </div>
          )}
          {data && (
            <>
              <section aria-label="Briefing window" className="space-y-2">
                <h2 className="text-lg font-semibold">
                  {data.firstLogin
                    ? "First briefing"
                    : data.since === session.login.previousLoginAt
                      ? "Since your previous sign-in"
                      : "Your catch-up messages"}
                </h2>
                <p>
                  {data.firstLogin
                    ? "All retained messages available at sign-in."
                    : `Messages gathered since the sign-in at ${accountTime(data.since)}.`}
                </p>
                <p className="text-sm text-bc-muted">
                  Through <time dateTime={data.through}>{accountTime(data.through)}</time>. This
                  briefing stays fixed while you work.{" "}
                  <Link className="link" to="/messages">
                    Open Message Search for newer traffic.
                  </Link>
                </p>
              </section>
              <MessagePagination
                meta={{
                  totalRecords: data.totalRecords,
                  page: data.page,
                  pageSize: data.pageSize,
                  totalPages: Math.max(1, Math.ceil(data.totalRecords / data.pageSize)),
                  nextPageToken: data.nextPageToken,
                  previousPageToken: data.previousPageToken,
                }}
                count={data.items.length}
                pending={result.isFetching}
                failed={result.isError}
                onPage={changePage}
              />
              {data.items.length === 0 && !result.isError && (
                <section className="unfinished">
                  <h2>
                    {data.firstLogin
                      ? "No retained messages match your scope"
                      : "No new messages match your scope"}
                  </h2>
                  <p>
                    {!scope.allCommands && scope.commandIds.length === 0 && !scope.includeUnassigned
                      ? "Your current relevance settings select no messages. Choose commands or include unassigned traffic in Account & settings."
                      : "There are no matching messages in this briefing window. You can continue to the calendar or change your relevant commands."}
                  </p>
                </section>
              )}
              <div className="messages-workspace" data-reader-open={record !== ""}>
                <section
                  ref={cardList}
                  tabIndex={-1}
                  aria-label="Shift message list"
                  className="record-list"
                >
                  {data.items.map((item) => (
                    <div key={item.messageKey}>
                      <MessageSearchCard
                        message={create(MessageRecordSchema, {
                          sourceMessageId: item.messageKey,
                          subject: item.subject,
                        })}
                        header={{
                          type: item.type || undefined,
                          originator: item.originator || undefined,
                          issuedAt: item.issuedAt ?? undefined,
                        }}
                        selected={record === item.messageKey}
                        onSelect={() => select(item.messageKey)}
                      />
                      <p className="text-xs text-bc-muted px-3 pb-3">
                        Available{" "}
                        <time dateTime={item.availableAt}>{accountTime(item.availableAt)}</time> ·{" "}
                        {item.commandIds.length === 0
                          ? "No assigned command"
                          : item.commandIds.join(", ")}
                      </p>
                    </div>
                  ))}
                </section>
                {record !== "" && (
                  <div className="message-viewer">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs message-viewer-close"
                      aria-label="Close message"
                      onClick={() => {
                        select("");
                        cardList.current?.focus();
                      }}
                    >
                      <TbX aria-hidden="true" />
                    </button>
                    {detail.isPending ? (
                      <p role="status">Loading selected message…</p>
                    ) : detail.isError ? (
                      <div role="alert">
                        Selected message could not be loaded. {detail.error.message}{" "}
                        <button className="btn btn-sm" onClick={() => void detail.refetch()}>
                          Retry selected message
                        </button>
                      </div>
                    ) : selected ? (
                      <MessageReader key={selected.sourceMessageId} message={selected} />
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
