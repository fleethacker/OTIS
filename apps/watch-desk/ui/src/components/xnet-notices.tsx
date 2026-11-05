import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAcknowledgeXnet, useDeskNetwork, useXnetNotices, xnetRequest, xnetTime, xnetTitle, type XnetMessageNotice, type XnetNotice } from "./xnet-data";
import { AppButton, Notice } from "./ui";
import "./xnet.css";

export function DeskNetworkLabel() {
  const desk = useDeskNetwork();
  return <p className="xnet-view-note">Desk: {desk === "ALL" ? "ALL networks (fictional)" : `${desk} (fictional)`}. Demo view filter only — not access control.</p>;
}
export function XnetNoticeList({ items }: { items: XnetNotice[] }) {
  const acknowledge = useAcknowledgeXnet();
  if (items.length === 0) return null;
  return (
    <div className="xnet-notices">
      {acknowledge.isError && <Notice tone="error" role="alert">Could not acknowledge notice. Try Acknowledge again.</Notice>}
      <ul aria-label="Cross-network traffic notices">
        {items.map((notice) => {
          const prominent = ["FLASH", "IMMEDIATE"].includes(notice.payload.highestPrecedence);
          return (
            <li key={notice.id} className={`xnet-notice ${prominent && !notice.clearedAt ? "xnet-prominent" : "xnet-quiet"}`}>
              <strong>{notice.clearedAt ? `HIGH (fictional) traffic notice for ${notice.payload.shipId} · ${notice.payload.count} messages · ${notice.payload.highestPrecedence}` : xnetTitle(notice)}</strong>
              <span title={notice.payload.latestWaitingAt}>Latest waiting {xnetTime(notice.payload.latestWaitingAt)}</span>
              {notice.clearedAt ? (
                <span>cleared <time dateTime={notice.clearedAt} title={notice.clearedAt}>{xnetTime(notice.clearedAt)}</time></span>
              ) : (
                <>
                  {notice.acknowledgedAt && <span>Acknowledged by you at {xnetTime(notice.acknowledgedAt)}{notice.unread ? " · new traffic since acknowledgement" : ""}</span>}
                  {notice.unread && <AppButton size="sm" disabled={acknowledge.isPending} aria-label={`Acknowledge traffic notice for ${notice.payload.shipId}`} onClick={() => acknowledge.mutate(notice)}>Acknowledge</AppButton>}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
export function XnetBanner() {
  const desk = useDeskNetwork();
  const feed = useXnetNotices();
  const items = feed.data?.items ?? [];
  return (
    <section className="xnet-banner" aria-label="Fictional desk network">
      <DeskNetworkLabel />
      {desk !== "HIGH" && (feed.isError ? (
        <Notice tone="error" role="alert">Cross-network notices unavailable. <AppButton size="sm" onClick={() => void feed.refetch()}>Retry notices</AppButton></Notice>
      ) : feed.isPending ? <Notice role="status">Loading cross-network notices…</Notice> : (
        <>
          <XnetNoticeList items={items.filter((n) => !n.clearedAt)} />
          {items.some((n) => n.clearedAt) && <details><summary>Cleared traffic notice history</summary><XnetNoticeList items={items.filter((n) => n.clearedAt !== null)} /></details>}
        </>
      ))}
    </section>
  );
}
/** Mount only after a canonical message has actually been rendered, never for
 * search cards, background prefetches, or failed detail requests. */
export function XnetMessageStatus({ messageKey, networks = [] }: { messageKey: string; networks?: ("HIGH" | "LOW")[] }) {
  const desk = useDeskNetwork();
  const client = useQueryClient();
  const [failure, setFailure] = useState(false);
  const [retry, setRetry] = useState(0);
  const high = networks.includes("HIGH");
  const eligible = high && desk !== "LOW";
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let active = true;
    setFailure(false);
    void xnetRequest("opened", { key: messageKey }, controller.signal).then(() => {
      if (active) void client.invalidateQueries({ queryKey: ["xnet"] });
    }).catch(() => { if (active) setFailure(true); });
    return () => { active = false; controller.abort(); };
  }, [messageKey, eligible, desk, client, retry]);
  const notices = useQuery({
    queryKey: ["xnet", desk, "message", messageKey],
    queryFn: ({ signal }) => xnetRequest<{ items: XnetMessageNotice[] }>("message", { key: messageKey }, signal),
    enabled: eligible,
    retry: false,
    staleTime: 5000,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  return (
    <div className="xnet-message-status">
      <p>Arrival: {networks.length ? networks.map((n) => `${n} (fictional)`).join(" · ") : "network not recorded"}</p>
      {failure && <Notice tone="error" role="alert">Could not record this message as copied. <AppButton size="sm" onClick={() => setRetry((v) => v + 1)}>Retry copy record</AppButton></Notice>}
      {eligible && notices.isError && <Notice tone="error" role="alert">Traffic notice status unavailable. <AppButton size="sm" onClick={() => void notices.refetch()}>Retry notice status</AppButton></Notice>}
      {eligible && notices.data?.items.map((notice) => <p key={notice.shipId}>
        Notice sent to LOW desk at {xnetTime(notice.sentAt)} for {notice.shipId} · {notice.acknowledgements.length ? notice.acknowledgements.map((ack) => `acknowledged by ${ack.username} at ${xnetTime(ack.at)}${ack.version < notice.version ? " (before latest traffic)" : ""}`).join(" · ") : "not yet acknowledged"}
        {notice.clearedAt && ` · cleared ${xnetTime(notice.clearedAt)}`}
      </p>)}
    </div>
  );
}
