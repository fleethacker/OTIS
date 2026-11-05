import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { shiftReturn } from "./briefing-data";
import { useSession } from "./session";

// Platform SSO can start an application session without visiting our login URL.
// Consume the server's one-time handoff before navigating so later refreshes or
// workspace navigation cannot repeatedly interrupt the current watch.
export function ShiftLanding() {
  const { session } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const consumed = useRef<string | null>(null);
  useEffect(() => {
    const startedAt = session?.login?.startedAt;
    if (
      session?.authenticated !== true ||
      session.openBriefing !== true ||
      startedAt === undefined ||
      consumed.current === startedAt
    ) {
      return;
    }
    consumed.current = startedAt;
    if (location.pathname === "/shift") {
      return;
    }
    const returnTo = shiftReturn(location.pathname + location.search + location.hash);
    void navigate(`/shift?${new URLSearchParams({ returnTo })}`, { replace: true });
  }, [
    session?.authenticated,
    session?.openBriefing,
    session?.login?.startedAt,
    location,
    navigate,
  ]);
  return null;
}
