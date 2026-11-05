import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  TbArrowLeft,
  TbBell,
  TbCheck,
  TbChecks,
  TbCircleCheck,
  TbInbox,
  TbAlertTriangle,
  TbX,
} from "react-icons/tb";
import { useIdentity } from "../hooks/useIdentity";
import { calendarReturn, messageHref } from "./calendar-links";
import {
  notificationTime,
  notificationItems,
  notificationTitle,
  useNotifications,
  useNotificationMembers,
  useReadNotification,
  type DeskNotification,
} from "./notification-data";

export function Notifications() {
  const identity = useIdentity();
  if (identity.isLoading || !identity.username) {
    return null;
  }
  const key = JSON.stringify([identity.username, identity.email]);
  return <NotificationPanel key={key} identity={key} />;
}
export function NotificationPanel({ identity }: { identity: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DeskNotification | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const feed = useNotifications(identity);
  const mark = useReadNotification(identity);
  const members = useNotificationMembers(
    identity,
    selected?.kind === "traffic" ? selected.id : undefined
  );
  const first = feed.data?.pages[0];
  const unread = first?.unread ?? 0;
  const items = notificationItems(feed.data?.pages);
  const detail = items.find((item) => item.id === selected?.id) ?? selected;
  const returnTo =
    location.pathname === "/calendar"
      ? location.pathname + location.search
      : calendarReturn(new URLSearchParams(location.search).get("returnTo"));
  useEffect(() => {
    if (!open) {
      return;
    }
    heading.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current && !root.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, selected?.id]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function openItem(item: DeskNotification) {
    if (item.unread) {
      try {
        await mark.mutateAsync({ id: item.id, version: item.version });
      } catch {
        return;
      }
    }
    if (item.kind === "traffic" && item.count === 1 && item.messageKey) {
      void navigate(messageHref(item.messageKey, returnTo));
      close();
    } else {
      setSelected(item);
    }
  }
  const Icon =
    detail?.kind === "failed"
      ? TbAlertTriangle
      : detail?.kind === "recovered"
        ? TbCircleCheck
        : TbInbox;
  return (
    <div
      ref={root}
      className="notification-anchor"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost notification-bell"
        aria-label={
          feed.isError
            ? "Notifications, unavailable"
            : `Notifications${unread > 0 ? `, ${unread} unread` : ""}`
        }
        title="Notifications"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setSelected(null);
          setOpen((value) => !value);
        }}
      >
        <TbBell aria-hidden="true" />
        {!feed.isError && unread > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {feed.isError
          ? "Notifications unavailable"
          : feed.isPending
            ? ""
            : `${unread} unread notifications`}
      </span>
      {open && (
        <section
          id={panelId}
          className="notification-panel"
          aria-labelledby={`${panelId}-title`}
          aria-busy={mark.isPending}
        >
          <div className="notification-heading">
            {selected && (
              <button
                type="button"
                className="btn btn-ghost notification-icon-button"
                aria-label="Back to notifications"
                title="Back to notifications"
                onClick={() => setSelected(null)}
              >
                <TbArrowLeft aria-hidden="true" />
              </button>
            )}
            <h2 id={`${panelId}-title`} ref={heading} tabIndex={-1}>
              Notifications
            </h2>
            {!feed.isError && unread > 0 && (
              <span className="notification-unread-total">{unread}</span>
            )}
            <div className="notification-heading-actions">
              <button
                type="button"
                className="btn btn-ghost notification-icon-button"
                aria-label="Mark all as read"
                title="Mark all as read"
                disabled={unread === 0 || mark.isPending || feed.isError || !first}
                onClick={() => first && mark.mutate({ through: first.watermark })}
              >
                <TbChecks aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-ghost notification-icon-button"
                aria-label="Close notifications"
                title="Close notifications"
                onClick={close}
              >
                <TbX aria-hidden="true" />
              </button>
            </div>
          </div>
          {mark.isError && (
            <div role="alert" className="notification-error">
              Couldn't mark as read.{" "}
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => mark.mutate(mark.variables)}
              >
                Retry
              </button>
            </div>
          )}
          <div className="notification-scroll">
            {feed.isError ? (
              <div role="alert" className="notification-empty">
                Unable to load notifications{" "}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void feed.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : feed.isPending ? (
              <p role="status" className="notification-empty">
                Loading…
              </p>
            ) : detail ? (
              <div className="notification-detail">
                <h3>
                  <Icon aria-hidden="true" />
                  {notificationTitle(detail)}
                </h3>
                {detail.context && <p>{detail.context}</p>}
                <time dateTime={detail.at}>{notificationTime(detail.at)}</time>
                {detail.kind === "traffic" ? (
                  members.isError ? (
                    <div role="alert">
                      Unable to load messages{" "}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void members.refetch()}
                      >
                        Retry
                      </button>
                    </div>
                  ) : members.isPending ? (
                    <p role="status">Loading…</p>
                  ) : (
                    <>
                      <ul className="notification-member-list">
                        {[
                          ...new Map(
                            members.data.pages
                              .flatMap((page) => page.items)
                              .map((item) => [item.messageKey, item])
                          ).values(),
                        ].map((item) => (
                          <li key={item.messageKey}>
                            <Link to={messageHref(item.messageKey, returnTo)} onClick={close}>
                              <strong>{item.subject || item.context || "Message"}</strong>
                              <span>{item.context}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {members.hasNextPage && (
                        <button
                          className="btn btn-ghost btn-sm notification-more"
                          disabled={members.isFetchingNextPage}
                          onClick={() => void members.fetchNextPage()}
                        >
                          Show more
                        </button>
                      )}
                    </>
                  )
                ) : (
                  <>
                    {detail.detail && (
                      <p className="notification-failure-reason">{detail.detail}</p>
                    )}
                    {detail.kind === "failed" && (
                      <p>
                        {detail.resolvedAt !== null
                          ? `Recovered ${notificationTime(detail.resolvedAt)}`
                          : "Recovery pending"}
                      </p>
                    )}
                    {detail.messageKey && (
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={`${messageHref(detail.messageKey, returnTo)}&tab=lifecycle`}
                        onClick={close}
                      >
                        View message
                      </Link>
                    )}
                  </>
                )}
              </div>
            ) : items.length === 0 ? (
              <p className="notification-empty">
                {first?.catchingUp === true ? "Updating…" : "You're up to date"}
              </p>
            ) : (
              <>
                <ul className="notification-list">
                  {items.map((item) => {
                    const RowIcon =
                      item.kind === "failed"
                        ? TbAlertTriangle
                        : item.kind === "recovered"
                          ? TbCircleCheck
                          : TbInbox;
                    const title = notificationTitle(item);
                    return (
                      <li
                        key={item.id}
                        className={item.unread ? "notification-unread" : "notification-read"}
                      >
                        <button
                          type="button"
                          className="notification-open"
                          disabled={mark.isPending}
                          onClick={() => void openItem(item)}
                        >
                          <RowIcon
                            className={`notification-type notification-type-${item.kind}`}
                            aria-hidden="true"
                          />
                          <span className="notification-copy">
                            <strong>{title}</strong>
                            <span className="notification-context">
                              {item.context ||
                                (item.kind === "traffic"
                                  ? "Message traffic"
                                  : item.detail || "Message intake")}
                            </span>
                            <time dateTime={item.at}>{notificationTime(item.at)}</time>
                          </span>
                        </button>
                        {item.unread && (
                          <button
                            type="button"
                            className="btn btn-ghost notification-mark"
                            disabled={mark.isPending}
                            aria-label={`Mark as read: ${title}`}
                            title="Mark as read"
                            onClick={() => mark.mutate({ id: item.id, version: item.version })}
                          >
                            <span className="notification-dot" aria-hidden="true" />
                            <TbCheck aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {feed.hasNextPage && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm notification-more"
                    disabled={feed.isFetchingNextPage}
                    onClick={() => void feed.fetchNextPage()}
                  >
                    Show more
                  </button>
                )}
                {first?.catchingUp === true && (
                  <p role="status" className="notification-sync">
                    Updating…
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
