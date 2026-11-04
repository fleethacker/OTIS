import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Preparation } from "./preparation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutationWithInvalidate } from "@defense-unicorns/ark-ui";
import { readDraft, saveDraft } from "../gen/app/v1/drafts-DraftService_connectquery";
import { getIdentity } from "../gen/app/v1/app-AppService_connectquery";

const Verified = createContext(false);
export function DraftEditor({ source, children }: { source: string; children?: ReactNode }) {
  const [session, setSession] = useState(0);
  useEffect(() => {
    const reset = () => setSession((value) => value + 1);
    const message = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "type" in event.data &&
        event.data.type === "ark-auth-changed"
      ) {
        reset();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        reset();
      }
    };
    window.addEventListener("message", message);
    window.addEventListener("storage", reset);
    window.addEventListener("focus", reset);
    window.addEventListener("online", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("message", message);
      window.removeEventListener("storage", reset);
      window.removeEventListener("focus", reset);
      window.removeEventListener("online", reset);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <PrivateSession key={session} source={source}>
      {children}
    </PrivateSession>
  );
}

// A local opaque session generation, not display-name identity, owns this cache.
// Never consult the shared QueryClient for private data (including inactive drafts).
// Returning from another tab conservatively discards unsaved text as well.
function PrivateSession({ source, children }: { source: string; children?: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
        },
      })
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client]
  );
  return (
    <QueryClientProvider client={client}>
      <VerifiedEditor source={source}>{children}</VerifiedEditor>
    </QueryClientProvider>
  );
}

function VerifiedEditor({ source, children }: { source: string; children?: ReactNode }) {
  const identity = useQuery(getIdentity);
  if (children !== undefined) {
    return (
      <Verified.Provider value={identity.isSuccess && !!identity.data.username}>
        {children}
      </Verified.Provider>
    );
  }
  if (!identity.isSuccess || !identity.data.username) {
    return (
      <section aria-label="Draft acknowledgement">
        <h3>Draft acknowledgement</h3>
        <p className="record-id">Re: {source}</p>
        {identity.isPending ? (
          <p role="status">Loading draft… Verifying current account.</p>
        ) : (
          <div role="alert">
            Account could not be verified. Private drafts are hidden.
            <button className="btn btn-sm" onClick={() => void identity.refetch()}>
              Retry account verification
            </button>
          </div>
        )}
      </section>
    );
  }
  return <Editor key={source} source={source} />;
}
export function PrivateComposer({ source, subject }: { source: string; subject: string }) {
  const verified = useContext(Verified);
  if (!verified) {
    return (
      <p role="status">Private preparation hidden while account verification is unavailable.</p>
    );
  }
  return (
    <div key={source}>
      <Preparation source={source} subject={subject} />
      <Editor source={source} />
    </div>
  );
}
export function PrivateTracking({ source }: { source: string }) {
  const verified = useContext(Verified);
  if (!verified) {
    return <p role="status">Private tracking hidden while account verification is unavailable.</p>;
  }
  return <Preparation key={source} source={source} tracking />;
}
function Editor({ source }: { source: string }) {
  const read = useQuery(readDraft, { sourceMessageId: source });
  const save = useMutationWithInvalidate(saveDraft, [readDraft]);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const initial = read.data?.draft?.text ?? "";
  const value = text ?? initial;
  const baseline = saved ?? initial;
  const dirty = value !== baseline;
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!dirty) {
      return;
    }
    const question =
      "Discard unsaved draft changes? Choose Cancel to preserve text and stay, or OK to discard and leave.";
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
  }, [dirty, location.pathname, location.search, navigate]);
  async function persist() {
    const submitted = value;
    setFailed(false);
    try {
      await save.mutateAsync({ sourceMessageId: source, text: submitted });
      setSaved(submitted);
    } catch {
      setFailed(true);
    }
  }
  return (
    <section aria-label="Draft acknowledgement">
      <h3>Draft acknowledgement</h3>
      <p className="record-id">Re: {source}</p>
      <p>Private saved text only. Nothing is transmitted.</p>
      <p>For privacy, returning to this tab resets unsaved edits and reloads your saved draft.</p>
      {read.isPending ? (
        <p role="status">Loading draft…</p>
      ) : read.isError ? (
        <div role="alert">
          Draft could not be loaded. Your saved text has not been replaced.
          <button className="btn btn-sm" onClick={() => void read.refetch()}>
            Retry loading draft
          </button>
        </div>
      ) : (
        <>
          <label htmlFor="draft-text">Acknowledgement text</label>
          <textarea
            id="draft-text"
            className="textarea draft-text"
            rows={8}
            value={value}
            onChange={(e) => {
              setText(e.target.value);
              setFailed(false);
            }}
          />
          <p role="status">
            {failed
              ? "Not saved · Unsent"
              : dirty
                ? "Unsaved changes · Unsent"
                : saved !== null || read.data.draft
                  ? "Saved · Unsent"
                  : "No saved draft · Unsent"}
          </p>
          {failed && <p role="alert">Save failed. Text is retained; retry Save draft.</p>}
          <button
            className="btn btn-primary btn-sm"
            disabled={save.isPending}
            onClick={() => void persist()}
          >
            {save.isPending ? "Saving…" : "Save draft"}
          </button>
          {dirty && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setText(baseline);
                setFailed(false);
              }}
            >
              Discard changes
            </button>
          )}
        </>
      )}
    </section>
  );
}
