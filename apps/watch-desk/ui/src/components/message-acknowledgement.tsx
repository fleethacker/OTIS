import { useSettings } from "./settings-data";
import { useContext, useState } from "react";
import { useQuery, useMutationWithInvalidate } from "@defense-unicorns/ark-ui";
import { readPreparation, savePreparation } from "../gen/app/v1/drafts-DraftService_connectquery";
import type { MessageRecord } from "../gen/app/v1/models_pb";
import { Modal } from "./modal";
import { PrivateVerified } from "./private-verification";
import { acknowledgementDefaults } from "./acknowledgement-format";
import { formatPreparation, responses, validatePreparation } from "./preparation-format";

export function MessageAcknowledgement({ message }: { message: MessageRecord }) {
  const verified = useContext(PrivateVerified);
  return verified ? (
    <Acknowledgement key={message.sourceMessageId} message={message} />
  ) : (
    <span className="status-pill">Acknowledgement unavailable</span>
  );
}
function Acknowledgement({ message }: { message: MessageRecord }) {
  const { shared } = useSettings();
  const read = useQuery(readPreparation, { sourceMessageId: message.sourceMessageId });
  const save = useMutationWithInvalidate(savePreparation, [readPreparation]);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [generated, setGenerated] = useState("");
  const [failure, setFailure] = useState("");
  const [copied, setCopied] = useState(false);
  const [family = "", response = ""] = selection.split(":");
  const fields = {
    ...acknowledgementDefaults(message, {
      outgoing: shared?.settings.outgoingCommand ?? "",
      authority: shared?.settings.actionAuthority ?? "",
    }),
    family,
    response,
    confirmed: true,
  };
  const errors = validatePreparation(fields);
  const missing = Object.keys(errors).filter((key) => key !== "family" && key !== "response");
  const preview = Object.keys(errors).length === 0 ? formatPreparation(fields) : "";
  async function generate() {
    setFailure("");
    setCopied(false);
    try {
      const result = await save.mutateAsync({
        sourceMessageId: message.sourceMessageId,
        fieldsJson: JSON.stringify(fields),
        generate: true,
      });
      setGenerated(result.generatedText);
    } catch {
      setFailure("Draft could not be saved. Retry.");
    }
  }
  return (
    <div className="message-acknowledgement">
      <span
        className="status-pill"
        title={read.data?.acknowledged === true ? "Externally recorded acknowledgement" : undefined}
      >
        {read.isPending
          ? "Acknowledgement loading"
          : read.isError
            ? "Acknowledgement unavailable"
            : read.data.acknowledged
              ? "Acknowledged"
              : generated || read.data.generatedText
                ? "Draft ready · unsent"
                : "Not acknowledged"}
      </span>
      <button
        className="btn btn-outline btn-sm"
        type="button"
        disabled={read.isPending || read.isError}
        onClick={() => {
          setOpen(true);
          setSelection("");
          setGenerated("");
          setFailure("");
          setCopied(false);
        }}
      >
        Send Acknowledgement
      </button>
      {read.isError && (
        <button className="btn btn-ghost btn-xs" type="button" onClick={() => void read.refetch()}>
          Retry
        </button>
      )}
      {open && (
        <Modal
          title="Acknowledgement"
          onClose={() => {
            if (!save.isPending) {
              setOpen(false);
            }
          }}
        >
          <form
            className="acknowledgement-form"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <dl className="acknowledgement-reference">
              <div>
                <dt>From</dt>
                <dd>{fields.outgoing}</dd>
              </div>
              <div>
                <dt>Authority</dt>
                <dd>{fields.authority}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>
                  {[fields.type, fields.originator, fields.serial, fields.dtg]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </div>
            </dl>
            <label>
              Acknowledgement type
              <select
                className="select select-sm"
                value={selection}
                disabled={save.isPending}
                required
                onChange={(event) => {
                  setSelection(event.target.value);
                  setGenerated("");
                  setFailure("");
                  setCopied(false);
                }}
              >
                <option value="">Select type</option>
                <optgroup label="Command response">
                  {Object.entries(responses.ACTAGCY).map(([code, label]) => (
                    <option key={code} value={`ACTAGCY:${code}`}>
                      {code} — {label.split(":")[0]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Intelligence validation">
                  {Object.entries(responses.ICVALID).map(([code, label]) => (
                    <option key={code} value={`ICVALID:${code}`}>
                      {code} — {label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {missing.length > 0 && (
              <p role="alert">
                Reference incomplete:{" "}
                {missing
                  .map(
                    (key) =>
                      ({
                        outgoing: "outgoing command",
                        authority: "responding authority",
                        type: "message type",
                        originator: "originator",
                        dtg: "issue time",
                        serial: "source serial",
                        context: "exercise / operation",
                      })[key] ?? key
                  )
                  .join(", ")}
                .
              </p>
            )}
            {(generated || preview) && (
              <label>
                Draft · unsent
                <textarea
                  className="textarea acknowledgement-preview"
                  readOnly
                  rows={6}
                  value={generated || preview}
                />
              </label>
            )}
            {failure && <p role="alert">{failure}</p>}
            <footer>
              {generated ? (
                <>
                  <span className="status-pill">Draft saved · unsent</span>
                  <button
                    className="btn btn-outline btn-sm"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(generated)
                        .then(() => setCopied(true))
                        .catch(() => setFailure("Copy failed. Select the draft text to copy."));
                    }}
                  >
                    {copied ? "Copied" : "Copy draft"}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  type="submit"
                  disabled={!preview || save.isPending}
                >
                  {save.isPending ? "Saving…" : "Generate draft"}
                </button>
              )}
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
