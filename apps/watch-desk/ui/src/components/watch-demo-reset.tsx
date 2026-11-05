import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readJson } from "./source-data";
import { sessionFetch } from "./session-access";
import { formatSinceUTC, isoBoundary, parseSinceUTC } from "./watch-boundary";
import { useUpdateWatchSession } from "./watch-session";
import { AppButton, Notice, TextInput } from "./ui";

type Choice = "today" | "turnover" | "custom";
const BASES = ["last_seen", "turnover", "default_24h"] as const;

/**
 * Demo only. Resets the signed-in person's own catch-up: the server clears their
 * reviews and moves "since you were last here" to the chosen time. Shown only when
 * the server reports the Watch Desk demo flag.
 */
export function DemoReset() {
  const client = useQueryClient();
  const updateWatch = useUpdateWatchSession();
  const [choice, setChoice] = useState<Choice>("today");
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  function body(): { lastSeenAt?: string } {
    if (choice === "today") return {};
    if (choice === "turnover") return { lastSeenAt: "turnover" };
    const at = parseSinceUTC(custom);
    if (at === undefined) throw new Error("Enter a valid UTC date/time, e.g. 05 NOV 2026 0600Z.");
    if (at > Date.now() || Date.now() - at > 42 * 86400000) throw new Error("The time must be within the last 42 days and not in the future.");
    return { lastSeenAt: new Date(at).toISOString() };
  }
  async function reset() {
    setNotice("");
    setFailure("");
    setPending(true);
    try {
      const request = body();
      const reply = await readJson(await sessionFetch("/api/v1/changes/demo-reset", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      }));
      const at = typeof reply.lastSeenAt === "string" ? isoBoundary(reply.lastSeenAt) : undefined;
      const basis = BASES.find((value) => value === reply.basis);
      if (at === undefined || typeof reply.since !== "string" || basis === undefined) throw new Error("Reset response is invalid");
      updateWatch({ since: reply.since, basis });
      await client.invalidateQueries({ queryKey: ["watchdesk-changes"] });
      setNotice(`Catch-up reset to ${formatSinceUTC(at)}`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not reset the catch-up. Retry.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="settings-demo-reset" aria-label="Demo">
      <h3>Demo</h3>
      <fieldset disabled={pending}>
        <legend>Reset to</legend>
        <label>
          <input type="radio" name="demo-reset-time" checked={choice === "today"} onChange={() => setChoice("today")} />
          0600Z today
        </label>
        <label>
          <input type="radio" name="demo-reset-time" checked={choice === "turnover"} onChange={() => setChoice("turnover")} />
          Latest turnover
        </label>
        <div className="settings-demo-time">
          <label>
            <input type="radio" name="demo-reset-time" checked={choice === "custom"} onChange={() => setChoice("custom")} />
            Specific time
          </label>
          <TextInput className="input-sm" aria-label="UTC time" placeholder="05 NOV 2026 0600Z" value={custom}
            onFocus={() => setChoice("custom")} onChange={(e) => { setChoice("custom"); setCustom(e.target.value); }} />
        </div>
      </fieldset>
      <div className="settings-actions">
        <AppButton size="sm" disabled={pending} onClick={() => void reset()}>
          Reset my catch-up
        </AppButton>
      </div>
      <small>{"Clears your reviews and sets 'since you were last here' to the chosen time. Demo only."}</small>
      {failure && <Notice tone="error" role="alert">{failure}</Notice>}
      {notice && <Notice tone="success" role="status">{notice}</Notice>}
    </section>
  );
}
