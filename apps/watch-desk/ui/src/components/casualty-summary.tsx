import type { MessageRecord } from "../gen/app/v1/models_pb";
import { isObject, structuredPayload, type Fields } from "./structured-message-format";

export function CasualtySummary({ message }: { message: MessageRecord }) {
  const payload = structuredPayload(message);
  const value = payload?.casualty;
  if (payload?.type !== "CASREP" || value === undefined || !isObject(value)) {
    return null;
  }
  const labels: [string, string][] = [
    ["Report action", "report_type"],
    ["Casualty serial", "serial"],
    ["Reporting UIC", "reporting_uic"],
    ["Equipment", "equipment"],
    ["Equipment code", "eic"],
    ["Category", "category"],
    ["Cause code", "cause"],
    ["Update sequence", "update_sequence"],
    ["Initial report reference", "initial_report_label"],
    ["Estimated repair date", "repair_estimate_date"],
    ["Repair estimate comments", "repair_estimate_comments"],
  ];
  return (
    <section className="usmtf-set-card" aria-label="Casualty summary">
      <header>
        <h3>Casualty report</h3>
      </header>
      <p className="text-sm">Source report · Requires review</p>
      <div className="usmtf-set-fields">
        {labels.map(
          ([label, key]) =>
            typeof value[key] === "string" && (
              <dl key={key}>
                <dt>{label}</dt>
                <dd>{value[key]}</dd>
              </dl>
            )
        )}
      </div>
      {typeof value.repair_estimate_date === "string" && (
        <p className="text-sm">
          Estimated date only; no repair appointment or completion is confirmed.
        </p>
      )}
      {value.report_type === "CANCEL" && (
        <p className="text-sm">The report is withdrawn. Repair completion is not implied.</p>
      )}
      {isObject(payload.casualty_history) && <CasualtyHistory history={payload.casualty_history} />}
      {payload.casualty_history_state === "unavailable" && (
        <p role="status" className="text-sm">
          Report history is unavailable.
        </p>
      )}
      {Array.isArray(payload.review_flags) &&
        payload.review_flags.includes("casualty_time_conflict") && (
          <p role="status" className="text-warning">
            Source dates conflict. Review the original message before acting.
          </p>
        )}
    </section>
  );
}

function CasualtyHistory({ history }: { history: Fields }) {
  const state = typeof history.state === "string" ? history.state : "unresolved";
  const label =
    state === "reported_casualty"
      ? "Casualty reported"
      : state === "reported_corrected"
        ? "Correction reported"
        : state === "report_cancelled"
          ? "Report withdrawn"
          : "History requires review";
  return (
    <section aria-label="Reported casualty history" className="mt-4">
      <h4>{label}</h4>
      <p className="text-sm">Source report history · Requires review</p>
      {state === "unresolved" && (
        <p className="text-warning">
          Reports are missing or conflict. Confirm the source reports before acting.
        </p>
      )}
      {Array.isArray(history.history) && (
        <ol>
          {history.history.map(
            (entry, index) =>
              isObject(entry) && (
                <li key={index}>
                  {typeof entry.report_type === "string" ? entry.report_type : "Report"}
                  {typeof entry.update_sequence === "string" ? ` ${entry.update_sequence}` : ""}
                  {typeof entry.issued_at === "string"
                    ? ` · ${entry.issued_at}`
                    : " · Issue time unavailable"}
                </li>
              )
          )}
        </ol>
      )}
    </section>
  );
}
