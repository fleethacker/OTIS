import { AppButton, Notice, SelectInput, TextArea, TextInput } from "./ui";
import { useEffect, useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutationWithInvalidate } from "@defense-unicorns/ark-ui";
import {
  readPreparation,
  savePreparation,
  recordAcknowledgement,
} from "../gen/app/v1/drafts-DraftService_connectquery";
import {
  blankPreparation,
  responses,
  validatePreparation,
  type PreparationFields,
} from "./preparation-format";
import "./preparation.css";

interface Activity {
  id: number;
  kind: string;
  recorder: string;
  recorded_at: string;
  occurred_at: string | null;
  note: string;
  provenance: string;
}

export function Preparation({
  source,
  subject,
  tracking = false,
}: {
  source: string;
  subject?: string;
  tracking?: boolean;
}) {
  const read = useQuery(readPreparation, { sourceMessageId: source });
  const save = useMutationWithInvalidate(savePreparation, [readPreparation]);
  const record = useMutationWithInvalidate(recordAcknowledgement, [readPreparation]);
  const [edited, setEdited] = useState<PreparationFields | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof PreparationFields, string>>>({});
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState("");
  const [note, setNote] = useState("");
  const [occurred, setOccurred] = useState("");
  const [external, setExternal] = useState(false);
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  let initial = blankPreparation;
  let history: Activity[] = [];
  let corrupt = false;
  try {
    const parsed: unknown = JSON.parse(read.data?.fieldsJson ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    initial = { ...blankPreparation };
    for (const key of Object.keys(initial) as (keyof PreparationFields)[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (value !== undefined) {
        if (typeof value !== typeof initial[key]) {
          throw new Error();
        }
        Object.assign(initial, { [key]: value });
      }
    }
    history = JSON.parse(read.data?.historyJson ?? "[]") as Activity[];
    if (!Array.isArray(history)) {
      throw new Error();
    }
  } catch {
    corrupt = true;
  }
  const fields = edited ?? initial;
  const dirty = !tracking && JSON.stringify(fields) !== (baseline ?? JSON.stringify(initial));
  const trackingDirty = tracking && (!!note || !!occurred || external);
  useEffect(() => {
    if (!dirty && !trackingDirty) {
      return;
    }
    const question = "Discard unsaved preparation changes? Cancel to preserve changes and stay.";
    const click = (event: MouseEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest("a, .record-entry") : null;
      if (target && !window.confirm(question)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const pop = () => {
      if (!window.confirm(question)) {
        void navigate(location.pathname + location.search, { replace: true });
      }
    };
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop);
    };
  }, [dirty, trackingDirty, location.pathname, location.search, navigate]);
  const output = preview ?? (edited === null ? (read.data?.generatedText ?? "") : "");
  const busy = save.isPending || record.isPending;
  function change<K extends keyof PreparationFields>(key: K, value: PreparationFields[K]) {
    setEdited({ ...fields, [key]: value, ...(key === "family" ? { response: "" } : {}) });
    setPreview("");
    setStatus("Output invalidated. Regenerate before copying.");
    setFailure("");
    setErrors({});
  }
  async function persist(generate: boolean) {
    const validation = validatePreparation(fields, generate);
    setErrors(validation);
    setFailure("");
    setStatus("");
    if (Object.keys(validation).length > 0) {
      return;
    }
    const submitted = JSON.stringify(fields);
    try {
      const result = await save.mutateAsync({
        sourceMessageId: source,
        fieldsJson: submitted,
        generate,
      });
      setBaseline(submitted);
      setPreview(result.generatedText);
      setStatus(generate ? "Generated and saved · Unsent" : "Preparation saved · Unsent");
    } catch {
      setFailure("Preparation save failed. Inputs retained; retry saving or generating.");
    }
  }
  async function track(acknowledged: boolean) {
    setFailure("");
    setStatus("");
    if (acknowledged && !external) {
      setFailure("Confirm that acknowledgement occurred outside OTIS.");
      return;
    }
    if (
      occurred &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(occurred) ||
        !Number.isFinite(Date.parse(occurred)))
    ) {
      setFailure(
        "Occurrence time must be RFC3339 with an explicit timezone, or empty for unknown."
      );
      return;
    }
    try {
      await record.mutateAsync({
        sourceMessageId: source,
        acknowledged,
        confirmedExternal: external,
        note,
        occurredAt: occurred,
      });
      setNote("");
      setOccurred("");
      setExternal(false);
      setStatus(
        acknowledged
          ? "External acknowledgement recorded."
          : "Personal tracking reset; history retained."
      );
    } catch {
      setFailure("Tracking save failed. Inputs retained; retry the action.");
    }
  }
  const input = (key: Exclude<keyof PreparationFields, "confirmed">, label: string) => (
    <div className="preparation-field" key={key}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <TextInput
        id={`${id}-${key}`}
        value={fields[key]}
        aria-invalid={errors[key] !== undefined}
        aria-describedby={errors[key] !== undefined ? `${id}-${key}-error` : undefined}
        onChange={(e) => change(key, e.target.value)}
      />
      {errors[key] !== undefined && <p id={`${id}-${key}-error`}>{errors[key]}</p>}
    </div>
  );
  return (
    <section
      className="preparation"
      aria-label={tracking ? "Private acknowledgement tracking" : "Prepare acknowledgement"}
    >
      <h3>{tracking ? "Private acknowledgement tracking" : "Prepare acknowledgement"}</h3>
      {!tracking && (
        <>
          <p className="record-id">
            Source: {source} · {subject}
          </p>
          <p>
            Private preparation · Unsent. Nothing is transmitted. No source values are assumed.
            Returning to this tab resets unsaved edits for privacy.
          </p>
        </>
      )}
      {read.isPending ? (
        <p role="status">Loading private preparation…</p>
      ) : read.isError || corrupt ? (
        <Notice role="alert" tone="error">
          Private preparation unavailable. Existing data has not been replaced.
          <AppButton size="sm" onClick={() => void read.refetch()}>
            Retry private preparation
          </AppButton>
        </Notice>
      ) : (
        <>
          {tracking ? (
            <>
              <p>
                <strong>
                  {read.data.acknowledged
                    ? "Acknowledged · User-reported outside OTIS"
                    : "Not recorded as acknowledged in personal tracking"}
                </strong>
              </p>
              <p>
                Separate from read-only upstream evidence below. Not verified transmission or
                command approval. Saving, generating and copying are not acknowledgement.
              </p>
              <fieldset disabled={busy}>
                <legend>Record or correct personal tracking</legend>
                <label>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={external}
                    onChange={(e) => setExternal(e.target.checked)}
                  />{" "}
                  I confirm acknowledgement occurred outside OTIS.
                </label>
                <label htmlFor={`${id}-note`}>Optional tracking note</label>
                <TextInput
                  id={`${id}-note`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                />
                <label htmlFor={`${id}-occurred`}>
                  Occurrence time (RFC3339 with timezone; blank if unknown)
                </label>
                <TextInput
                  id={`${id}-occurred`}
                  value={occurred}
                  onChange={(e) => setOccurred(e.target.value)}
                />
                <div className="preparation-actions">
                  <AppButton variant="primary" onClick={() => void track(true)}>
                    Record external acknowledgement
                  </AppButton>
                  <AppButton variant="outline" onClick={() => void track(false)}>
                    Reset personal tracking
                  </AppButton>
                </div>
              </fieldset>
              <h4>Private activity history</h4>
              {history.length === 0 ? (
                <p>No private activity recorded.</p>
              ) : (
                <ol>
                  {history.map((event) => (
                    <li key={event.id}>
                      <strong>
                        {event.kind === "acknowledged"
                          ? "Acknowledged · User-reported"
                          : event.kind === "reset"
                            ? "Personal tracking reset"
                            : `${event.kind} · Unsent preparation`}
                      </strong>
                      <p>
                        Recorder: {event.recorder} · Recorded: {event.recorded_at}
                      </p>
                      <p>Occurred: {event.occurred_at ?? "Unavailable"}</p>
                      {event.note && <p>{event.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <>
              <fieldset disabled={busy}>
                <legend>1. Verified identities and reference</legend>
                {input("outgoing", "Outgoing originator")}
                {input("letter", "Reference letter (A-Z)")}
                {input("type", "Reference message type")}
                {input("originator", "Original reference originator")}
                {input("dtg", "Reference issue DTG (DDHHMMZMONYYYY)")}
                {input("serial", "Verified source serial (optional)")}
                {input("authority", "Responding authority")}
              </fieldset>
              <fieldset disabled={busy}>
                <legend>2. Response and context</legend>
                <label htmlFor={`${id}-family`}>Response family</label>
                <SelectInput
                  id={`${id}-family`}
                  value={fields.family}
                  onChange={(e) => change("family", e.target.value)}
                >
                  <option value="">Choose a family</option>
                  <option value="ACTAGCY">Normal command response (ACTAGCY)</option>
                  <option value="ICVALID">Intelligence validation (ICVALID)</option>
                </SelectInput>
                <label htmlFor={`${id}-response`}>How can your command respond?</label>
                <SelectInput
                  id={`${id}-response`}
                  value={fields.response}
                  onChange={(e) => change("response", e.target.value)}
                >
                  <option value="">Choose a response</option>
                  {Object.entries(responses[fields.family] ?? {}).map(([code, label]) => (
                    <option key={code} value={code}>
                      {code} — {label}
                    </option>
                  ))}
                </SelectInput>
                <label htmlFor={`${id}-context-kind`}>Optional context (mutually exclusive)</label>
                <SelectInput
                  id={`${id}-context-kind`}
                  value={fields.contextKind}
                  onChange={(e) => change("contextKind", e.target.value)}
                >
                  <option value="">No context</option>
                  <option>EXER</option>
                  <option>OPER</option>
                </SelectInput>
                {input("context", "Exercise identity or operation codeword")}
                {input("notes", "Reviewer notes (private metadata, not message body)")}
                <label>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={fields.confirmed}
                    onChange={(e) => change("confirmed", e.target.checked)}
                  />{" "}
                  I confirm understanding, responding authority and reference scope. Workflow
                  safeguard only; not an F541 field or proof of authorization.
                </label>
                {Object.keys(errors).length > 0 && (
                  <Notice role="alert" tone="error">
                    {Object.entries(errors).map(([key, error]) => (
                      <p key={key}>
                        {key}: {error}
                      </p>
                    ))}
                  </Notice>
                )}
                <div className="preparation-actions">
                  <AppButton variant="outline" onClick={() => void persist(false)}>
                    Save preparation
                  </AppButton>
                  <AppButton variant="primary" onClick={() => void persist(true)}>
                    Generate message
                  </AppButton>
                </div>
              </fieldset>
              <p>{dirty ? "Unsaved changes · Unsent" : "Private preparation · Unsent"}</p>
              <label htmlFor={`${id}-preview`}>Reviewable message (plain text)</label>
              <TextArea id={`${id}-preview`} readOnly rows={7} value={output} />
              <AppButton
                variant="outline"
                disabled={!output || busy}
                onClick={() => {
                  setStatus("");
                  setFailure("");
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(output);
                      setStatus("Message copied. Paste manually into email; nothing sent.");
                    } catch {
                      setFailure("Copy failed. Select the preview text and copy manually.");
                    }
                  })();
                }}
              >
                Copy message
              </AppButton>
              <p>
                Limited 2003-reference profile: one reference, one response, single-field EXER or
                OPER, complete Zulu DTG only. Repeated references/authorities, other date
                alternatives, DECL/classified release and full character/profile certification are
                unsupported. Apply approved release procedures outside OTIS.
              </p>
            </>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
      {failure && (
        <Notice role="alert" tone="error">
          {failure}
        </Notice>
      )}
    </section>
  );
}
