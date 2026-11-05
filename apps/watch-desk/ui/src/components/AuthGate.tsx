import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { beginSessionAccess } from "./session-access";
import { SessionVisibility } from "./session-visibility";
import otisIcon from "../assets/otis/otis-logo.png";
import { AppButton } from "./ui";
import { BrowserPreferenceScope } from "./calendar-preferences";
interface Session {
  scope: string;
  expiresAt: number | null;
  sessionExpiresAt: number | null;
  mode: string;
}
// Application-owned authentication. Neither network failures nor provider outages
// enable demo access. Only user activity triggers refresh; polling never does.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<"loading" | "checking" | "ready" | "expired" | "error">(
    "loading"
  );
  const access = useRef<ReturnType<typeof beginSessionAccess> | null>(null);
  const busy = useRef<ReturnType<typeof beginSessionAccess> | null>(null);
  const expiry = useRef<number | null>(null);
  const check = useCallback(async (renew = false, obscure = false) => {
    const currentAccess = access.current;
    if (currentAccess === null || busy.current === currentAccess) {
      return;
    }
    busy.current = currentAccess;
    if (obscure) {
      setState("checking");
    }
    try {
      let response = await fetch(renew ? "/auth/refresh" : "/auth/session", {
        method: renew ? "POST" : "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!renew && response.status === 401) {
        response = await fetch("/auth/refresh", { method: "POST", credentials: "same-origin" });
      }
      if (currentAccess !== access.current) {
        return;
      }
      if (response.status === 401 || response.status === 403) {
        currentAccess.deny();
        expiry.current = null;
        setState("expired");
        setSession(null);
        return;
      }
      if (!response.ok) {
        throw new Error("Session unavailable");
      }
      const value = (await response.json()) as Session;
      if (currentAccess !== access.current) {
        return;
      }
      if (
        typeof value.scope !== "string" ||
        value.scope.length !== 64 ||
        !(
          value.expiresAt === null ||
          (typeof value.expiresAt === "number" && value.expiresAt > Date.now() / 1000)
        ) ||
        !(
          value.sessionExpiresAt === null ||
          (typeof value.sessionExpiresAt === "number" && value.sessionExpiresAt > Date.now() / 1000)
        )
      ) {
        throw new Error("Invalid session");
      }
      expiry.current = value.expiresAt;
      currentAccess.accept(value.scope, value.expiresAt);
      setSession(value);
      setState("ready");
    } catch {
      if (currentAccess !== access.current) {
        return;
      }
      currentAccess.deny();
      expiry.current = null;
      setState("error");
      setSession(null);
    } finally {
      if (busy.current === currentAccess) {
        busy.current = null;
      }
    }
  }, []);
  useEffect(() => {
    const currentAccess = beginSessionAccess();
    access.current = currentAccess;
    void check();
    return () => {
      currentAccess.release();
      if (access.current === currentAccess) {
        access.current = null;
      }
    };
  }, [check]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible") {
        void check(false, true);
      }
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [check]);
  useEffect(() => {
    const activity = () => {
      if (
        document.visibilityState === "visible" &&
        expiry.current !== null &&
        expiry.current <= Date.now() / 1000 + 10
      ) {
        void check(true);
      }
    };
    document.addEventListener("pointerdown", activity);
    document.addEventListener("pointermove", activity);
    document.addEventListener("keydown", activity);
    document.addEventListener("wheel", activity, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("pointermove", activity);
      document.removeEventListener("keydown", activity);
      document.removeEventListener("wheel", activity);
    };
  }, [check]);
  useEffect(() => {
    if (session?.sessionExpiresAt === null || session?.sessionExpiresAt === undefined) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        access.current?.deny();
        expiry.current = null;
        setSession(null);
        setState("expired");
      },
      Math.max(0, session.sessionExpiresAt * 1000 - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [session]);
  return (
    <>
      {session && (state === "ready" || state === "checking") ? (
        <SessionVisibility.Provider value={state === "ready"}>
          <div style={{ display: state === "ready" ? "contents" : "none" }}>
            <BrowserPreferenceScope.Provider value={session.scope}>
              <Fragment key={session.scope}>{children}</Fragment>
            </BrowserPreferenceScope.Provider>
          </div>
        </SessionVisibility.Provider>
      ) : null}
      {state !== "ready" ? (
        <main className="session-gate">
          <img className="session-otis-mark" src={otisIcon} width={88} height={88} alt="" />
          <h1>OTIS</h1>
          <p>Operational Tasking Integration System</p>
          {state === "loading" || state === "checking" ? (
            <p role="status">Signing in…</p>
          ) : (
            <>
              <p role="alert">
                {state === "error" ? "Sign-in unavailable." : "Sign in to continue."}
              </p>
              <a
                className="btn btn-primary"
                href={`/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              >
                Sign in
              </a>
              <AppButton onClick={() => void check(true)}>Retry</AppButton>
            </>
          )}
        </main>
      ) : null}
    </>
  );
}
