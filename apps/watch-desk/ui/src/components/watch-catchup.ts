import { useState } from "react";
import { useChanges, type ChangeRequest, type WatchChange } from "./watch-changes";
import { isoBoundary, latestTurnover, useWatchClock } from "./watch-boundary";
import { pinnedWatch, useWatchSession } from "./watch-session";

export function reviewKnown(row: WatchChange) { return row.messageKey !== null && row.reviewedAt !== undefined; }
export function needsWatchReview(row: WatchChange) { return !row.issuedAt || !row.commandIds.length; }
export function useWatchCatchup({ rawSince, turnovers, filters, now: fixedNow, enabled = true }: {
  rawSince: string | null; turnovers?: string[]; filters: ChangeRequest["filters"]; now?: number; enabled?: boolean;
}) {
  const session = useWatchSession();
  const pinned = pinnedWatch(session);
  const clock = useWatchClock(fixedNow === undefined && enabled);
  const now = fixedNow ?? clock;
  const closed = rawSince?.startsWith("closed:") === true;
  const choice = rawSince === null ? (pinned ? "session" : "auto") : closed ? rawSince.slice(7) : rawSince;
  const sessionChoice = choice === "session" && pinned !== undefined;
  const automatic = choice === "auto" || (choice === "session" && !pinned);
  const boundary = sessionChoice ? pinned!.at : automatic ? latestTurnover(now, turnovers) : isoBoundary(choice);
  const invalid = !automatic && !sessionChoice && boundary === undefined;
  const basis = sessionChoice ? pinned!.basis : automatic ? "turnover" : "explicit";
  const snapshotKey = JSON.stringify([session?.scope, session?.since, choice, filters]);
  const [snapshot, setSnapshot] = useState({ key: snapshotKey, until: now + 1 });
  if (snapshot.key !== snapshotKey) setSnapshot({ key: snapshotKey, until: now + 1 });
  const until = pinned ? (snapshot.key === snapshotKey ? snapshot.until : now + 1) : now + 1;
  const valid = boundary !== undefined && boundary < until && until - boundary <= 42 * 86400000;
  const query = useChanges({
    ...(sessionChoice ? {} : { since: boundary === undefined ? "" : new Date(boundary).toISOString() }),
    until: new Date(until).toISOString(), filters,
  }, enabled && valid);
  const unavailable = !valid || query.isError;
  const pages = unavailable || query.isRefetching ? [] : query.data?.pages ?? [];
  const first = pages[0];
  const items = [...new Map(pages.flatMap((page) => page.items).map((row) => [row.messageKey ?? row.id, row])).values()];
  const unknown = (first?.unknownTime ?? []).filter((row) => !items.some((item) => item.messageKey && item.messageKey === row.messageKey));
  const all = [...items, ...unknown];
  const tracked = all.filter(reviewKnown);
  const reviewed = tracked.filter((row) => row.reviewedAt !== null).length;
  const unreviewed = tracked.filter((row) => row.reviewedAt === null);
  const newMessageKeys = new Set(items.filter((row) => row.reviewedAt === null && row.messageKey).map((row) => row.messageKey!));
  const open = rawSince !== null ? !closed : unreviewed.length > 0;
  return { query, valid, unavailable, pages, first, items, unknown, all, tracked, reviewed, unreviewed, newMessageKeys,
    now, until, boundary, basis, choice, invalid, open, sessionAvailable: !!pinned,
    returned: pages.reduce((n, page) => n + page.returnedNewCount, 0),
    hidden: pages.reduce((n, page) => n + page.hiddenCount, 0),
    refresh: () => {
      if (pinned && snapshot.until !== now + 1) setSnapshot({ key: snapshotKey, until: now + 1 });
      else void query.refetch();
    },
  };
}
export type WatchCatchup = ReturnType<typeof useWatchCatchup>;
