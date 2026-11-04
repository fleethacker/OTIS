import { useEffect, useState } from "react";

/**
 * AuthGate pre-flights the dev mock-auth session before any ConnectRPC
 * query fires. In the wizard preview (ARK_MOCK_AUTH=1) the backend
 * 302-redirects every un-sessioned request to /__ark/mock-login;
 * ConnectRPC then follows the 302 with a GET, lands on HTML, and blows
 * up parsing it as protobuf. Probing /__ark/mock-whoami first lets us
 * navigate the window to the login page cleanly.
 *
 * Outcomes on mount:
 *   - 200: session valid → render children
 *   - 401: no session → window.location.replace to /__ark/mock-login
 *   - 404 or network error: not a dev environment (production UDS has
 *     no /__ark endpoints) → render children so the real JWT-backed
 *     flow proceeds untouched
 *
 * Loading UI: a centered spinner instead of a blank `null`. The
 * skeleton is delayed 200ms so fast probes (the common case) never
 * flash the loader at all — we only show it when the probe is slow
 * enough that a blank window would feel broken.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const skeletonTimer = window.setTimeout(() => {
      if (!cancelled) {
        setShowSkeleton(true);
      }
    }, 200);

    void fetch("/__ark/mock-whoami", { credentials: "same-origin" })
      .then((resp) => {
        if (cancelled) {
          return;
        }
        if (resp.status === 401) {
          const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace(`/__ark/mock-login?return=${returnTo}`);
          return;
        }
        // 200 (authed) or 404 (no mock shim, production) — continue.
        setReady(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        // Network error (backend still booting, etc.) — let the app
        // render and surface its own error state rather than blocking.
        setReady(true);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(skeletonTimer);
    };
  }, []);

  if (!ready) {
    if (!showSkeleton) {
      return null;
    }
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" aria-label="Loading" />
      </div>
    );
  }
  return <>{children}</>;
}
