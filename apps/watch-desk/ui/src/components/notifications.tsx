import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@defense-unicorns/ark-ui";
import { TbBell } from "react-icons/tb";
import { useIdentity } from "../hooks/useIdentity";
import { readSchedules } from "../gen/app/v1/source_data-SourceDataService_connectquery";
import { calendarReturn, messageHref } from "./calendar-links";
import {
  notifications,
  readNotificationState,
  saveNotificationState,
  utcDay,
} from "./notification-data";

export function Notifications() {
  const identity = useIdentity();
  if (identity.isLoading || !identity.username) {
    return null;
  }
  // Remount before accessing storage when the signed-in identity changes.
  const key = JSON.stringify([identity.username, identity.email]);
  return <NotificationPanel key={key} identity={key} />;
}

export function NotificationPanel({ identity }: { identity: string }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(utcDay);
  const [stored, setStored] = useState(() => readNotificationState(identity));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const location = useLocation();
  const result = useQuery(readSchedules, {});
  // A failed refresh must not leave stale action items presented as current.
  const items = notifications(result.isError ? [] : (result.data?.messages ?? []), day);
  const unread = items.filter((n) => !stored.keys.includes(n.key)).length;
  const returnTo =
    location.pathname === "/calendar"
      ? location.pathname + location.search
      : calendarReturn(new URLSearchParams(location.search).get("returnTo"));
  const reminderParams = new URLSearchParams(new URL(returnTo, "https://watch.invalid").search);
  reminderParams.set("date", day);
  reminderParams.set("view", "day");
  const reminderHref = `/calendar?${reminderParams}`;

  useEffect(() => {
    const check = () => setDay(utcDay());
    // Only a foreground UI clock: no delivery, worker or scheduled notification.
    const timer = window.setInterval(check, 1000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    if (!open) {
      return;
    }
    heading.current?.focus();
    const outside = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function mark(keys: string[]) {
    const next = [...new Set([...stored.keys, ...keys])];
    const saved = saveNotificationState(identity, next);
    setStored({ keys: next, failed: !saved });
    heading.current?.focus();
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div
      className="notification-anchor"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        className="btn btn-ghost notification-bell"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="desk-notifications"
        onClick={() => setOpen(!open)}
      >
        <TbBell aria-hidden="true" />{" "}
        <span className="notification-count" aria-hidden="true">
          {unread}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {unread === 0 ? "No unread notifications" : `${unread} unread notifications`}
        {result.isError
          ? "; action-item count unavailable"
          : result.isPending
            ? "; action items loading"
            : ""}
      </span>
      {open && (
        <section
          id="desk-notifications"
          className="notification-panel"
          aria-labelledby="notification-title"
        >
          <div className="notification-heading">
            <h2 id="notification-title" ref={heading} tabIndex={-1}>
              Notifications
            </h2>
            <button className="btn btn-ghost btn-sm" onClick={close}>
              Close
            </button>
          </div>
          <p>{unread === 0 ? "No unread notifications" : `${unread} unread`} · In-app only</p>
          <p className="notification-note">
            Reading is not resolution. No acknowledgement is required by these notices.
          </p>
          {stored.failed && (
            <p role="status">
              Browser storage unavailable. Read state is kept only while this page stays open.
            </p>
          )}
          <div className="notification-tools">
            <button
              className="btn btn-sm"
              disabled={unread === 0}
              onClick={() => mark(items.map((n) => n.key))}
            >
              Mark all as read
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={result.isFetching}
              onClick={() => void result.refetch()}
            >
              Refresh action items
            </button>
          </div>
          {result.isPending && <p role="status">Loading source action items…</p>}
          {result.isError && (
            <div className="alert" role="alert">
              Action items unavailable. A failed fetch does not confirm there are no issues.
              <button className="btn btn-sm" onClick={() => void result.refetch()}>
                Retry action items
              </button>
            </div>
          )}
          {result.data && !result.isError && (
            <p className="notification-note">
              {result.data.notice} · {result.data.source}
            </p>
          )}
          <ul className="notification-list">
            {items.map((n) => (
              <li
                key={n.key}
                className={
                  stored.keys.includes(n.key) ? "notification-read" : "notification-unread"
                }
              >
                <div className="notification-meta">
                  <strong>{n.type}</strong>
                  <span>{stored.keys.includes(n.key) ? "Read" : "Unread"}</span>
                </div>
                {n.fictional === true && (
                  <p className="review-cue">Fictional · Illustrative, not validated USMTF</p>
                )}
                <Link
                  to={n.message !== undefined ? messageHref(n.message, returnTo) : reminderHref}
                  onClick={() => {
                    mark([n.key]);
                    close();
                  }}
                >
                  <strong>{n.title}</strong>
                  {n.message !== undefined && <span className="record-id">{n.message}</span>}
                </Link>
                <p>{n.context}</p>
                {!stored.keys.includes(n.key) && (
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`Mark as read: ${n.title}`}
                    onClick={() => mark([n.key])}
                  >
                    Mark as read
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!result.isPending && !result.isError && items.length === 1 && (
            <p>No outstanding action items in the returned source data.</p>
          )}
          <p className="notification-note">
            Read state is private to this identity in this browser. No email, push or cross-device
            delivery.
          </p>
        </section>
      )}
    </div>
  );
}
