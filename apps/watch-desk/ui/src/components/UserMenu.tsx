import { useLayoutEffect, useRef, useState } from "react";
import { TbLogout } from "react-icons/tb";
import { useIdentity } from "../hooks/useIdentity";
import { AppButton, Notice } from "./ui";

/**
 * UserMenu — avatar + username dropdown with a Sign out action.
 *
 * Mount in the AppShell header (or wherever the layout places persistent
 * identity chrome). The presentation belongs to this app and may be adapted.
 * Sign out uses the app's native session endpoint before reloading the calendar.
 * useIdentity calls the shipped GetIdentity RPC.
 *
 * Accessibility: the trigger is a real <button> exposing aria-haspopup="menu"
 * and aria-expanded bound to the open state, so screen readers announce that a
 * menu opens and whether it is open. The menu is controlled (we render it only
 * when open rather than leaning on daisyUI's CSS :focus, which would leave
 * aria-expanded lying), closes on Escape (returning focus to the trigger) and
 * on focus leaving the menu.
 *
 * @param openUp — prefer opening upward for sidebar footers. The menu flips
 * direction and shifts horizontally as needed to remain inside the viewport.
 */
export function UserMenu({ openUp = false }: { openUp?: boolean } = {}) {
  const { username, email, role, isLoading } = useIdentity();
  const [open, setOpen] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  async function logout() {
    setLogoutFailed(false);
    try {
      const response = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) {
        throw new Error("Sign-out failed");
      }
      window.location.replace("/calendar");
    } catch {
      setLogoutFailed(true);
    }
  }
  // Held so Escape can return focus to the trigger (a11y: focus must not be
  // lost to <body> when the menu closes).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const positionMenu = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) {
        return;
      }
      const anchor = trigger.getBoundingClientRect();
      const gap = 8;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const above = anchor.top - height - gap;
      const below = anchor.bottom + gap;
      const top =
        (openUp || below + height > window.innerHeight - gap) && above >= gap ? above : below;
      menu.style.left = `${Math.max(gap, Math.min(anchor.right - width, window.innerWidth - width - gap))}px`;
      menu.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`;
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, openUp]);

  if (isLoading) {
    return null;
  }

  // No identity → render nothing. In production the UDS mesh authenticates
  // before the app ever loads, so username is always set; in dev the AuthGate
  // routes un-sessioned users to the picker before this mounts. We deliberately
  // do NOT render a "Sign in" button: it used to navigate to /__ark/mock-login,
  // which in a deployed package is a dead path that falls through to the SPA
  // catch-all (the "stuck on Building your application" bug).
  if (!username) {
    return null;
  }

  const initial = username.slice(0, 1).toUpperCase();

  return (
    <div
      className="account-menu relative inline-block"
      // Escape closes and returns focus to the trigger; closing on focus-out
      // (focus left the whole dropdown subtree) handles click-away and Tab-out.
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <AppButton
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu"
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
        variant="ghost"
        size="sm"
        className="account-trigger"
      >
        {/* Avatar — w-7 h-7 paired so the placeholder renders as a square
            circle, not collapsed to text-only height inside the trigger. */}
        <div className="avatar placeholder">
          <div className="bg-primary/20 text-primary w-7 h-7 rounded-full grid place-items-center">
            <span className="text-xs font-semibold">{initial}</span>
          </div>
        </div>
        <span className="account-name text-sm font-medium">{username}</span>
      </AppButton>
      {/* Rendered only while open so aria-expanded stays truthful and the menu
          is genuinely controlled (not CSS-:focus-driven). Header rows (username
          + email + role) are NOT daisyUI `menu-title`: that is single-line
          uppercase-styled and the email/role rows pick it up incorrectly. */}
      {open && (
        <div
          ref={menuRef}
          id="user-menu"
          role="menu"
          aria-label="Account"
          className="fixed bg-base-100 rounded-box z-50 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] p-0 overflow-y-auto border border-base-300 shadow-lg"
        >
          <div className="px-4 py-3 border-b border-base-300">
            <div className="font-semibold text-sm text-base-content">{username}</div>
            {email !== "" && <div className="text-xs text-bc-muted mt-0.5">{email}</div>}
            {role !== "" && (
              <div className="text-xs text-bc-muted">{role === "admin" ? "Admin" : "Viewer"}</div>
            )}
          </div>
          {logoutFailed && (
            <Notice tone="error" role="alert">
              Sign-out failed. Retry.
            </Notice>
          )}
          <ul className="menu menu-sm gap-0 px-1 py-1">
            <li>
              <AppButton
                variant="ghost"
                size="sm"
                className="account-signout"
                type="button"
                role="menuitem"
                onClick={() => void logout()}
              >
                <TbLogout />
                Sign out
              </AppButton>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
