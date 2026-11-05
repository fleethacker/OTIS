import type { Interceptor } from "@connectrpc/connect";

interface PendingRequest {
  scope: string;
  finish: (error?: Error) => void;
}

class SessionAccess {
  private current: { scope: string; expiresAt: number | null } | null = null;
  private closed = false;
  private pending = new Set<PendingRequest>();

  accept(scope: string, expiresAt: number | null) {
    if (this.closed) {
      return;
    }
    this.current = { scope, expiresAt };
    for (const request of this.pending) {
      request.finish(request.scope === scope ? undefined : new Error("Session changed"));
    }
  }

  deny() {
    this.current = null;
    for (const request of this.pending) {
      request.finish(new Error("Session unavailable"));
    }
  }

  release() {
    this.deny();
    this.closed = true;
    if (active === this) {
      active = undefined;
    }
  }

  async wait(signal?: AbortSignal | null) {
    if (signal?.aborted === true) {
      throw new DOMException("Request aborted", "AbortError");
    }
    if (this.closed || this.current === null) {
      throw new Error("Session unavailable");
    }
    if (this.current.expiresAt === null || this.current.expiresAt > Date.now() / 1000 + 1) {
      return;
    }
    if (this.pending.size >= 128) {
      throw new Error("Too many pending requests");
    }
    const scope = this.current.scope;
    await new Promise<void>((resolve, reject) => {
      const abort = () => request.finish(new DOMException("Request aborted", "AbortError"));
      const request: PendingRequest = {
        scope,
        finish: (error) => {
          this.pending.delete(request);
          signal?.removeEventListener("abort", abort);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      };
      this.pending.add(request);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

let active: SessionAccess | undefined;

export function beginSessionAccess() {
  active?.release();
  active = new SessionAccess();
  return active;
}

// Waiting never refreshes a token. Only AuthGate's user-activity path resumes
// requests, so background polling cannot prolong an idle session.
export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit) {
  await active?.wait(init?.signal);
  return fetch(input, init);
}

export const sessionInterceptor: Interceptor = (next) => async (request) => {
  await active?.wait(request.signal);
  return next(request);
};
