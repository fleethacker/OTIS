import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, copyFile, open } from "node:fs/promises";

import { join } from "node:path";

/** Captured journey failure evidence excludes process environment and database contents. */
export interface JourneyAppEvidence {
  seed: Buffer;
  seedTruncated: boolean;
  logs: string[];
}

// No compiler, package scripts, or port reservation races live in test workers.
// Every instance owns its database and descendants, including failed startup.
export async function startJourneyApp(
  root: string,
  binary: string,
  fixture: string,
  dataRoot: string,
  role?: string,
  captureEvidence?: (evidence: JourneyAppEvidence) => void
) {
  if (
    role !== undefined &&
    (role.trim() !== role || role.length === 0 || role === "1" || /[\0\r\n]/.test(role))
  ) {
    throw Error("Journey role must name an app role; omit it to use the default identity");
  }
  const data = await mkdtemp(join(dataRoot, "app-"));
  try {
    await copyFile(fixture, join(data, "seed.json"));
  } catch (error) {
    await rm(data, { recursive: true, force: true });
    throw error;
  }
  let seed = Buffer.alloc(0);
  let seedTruncated = false;
  if (captureEvidence) {
    try {
      const file = await open(join(data, "seed.json"), "r");
      try {
        const limit = 5 << 20;
        const buffer = Buffer.alloc(limit + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
          if (chunk.bytesRead === 0) break;
          bytesRead += chunk.bytesRead;
        }
        seed = Buffer.from(buffer.subarray(0, Math.min(bytesRead, limit)));
        seedTruncated = bytesRead > limit;
      } finally {
        await file.close();
      }
    } catch (error) {
      await rm(data, { recursive: true, force: true });
      throw error;
    }
  }
  const child = spawn(binary, [], {
    cwd: root,
    detached: false, // Remain in the Ark executor group when a worker is forcibly killed.
    env: {
      ...process.env,
      PORT: "0",
      ARK_SERVER_READY_FD: "3",
      ARK_DB_PATH: join(data, "app.db"),
      DATABASE_URL: join(data, "app.db"),
      ARK_SEED_PATH: join(data, "seed.json"),
      ARK_MOCK_AUTH: "1",
      ARK_MOCK_AUTH_AS: role ?? "1",
    },
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });
  const logs: string[] = [];
  let logBytes = 0;
  const collect = (chunk: Buffer) => {
    logBytes += chunk.length;
    if (logBytes <= 1 << 20) logs.push(chunk.toString());
    else if (logs.at(-1) !== "\nlevel=ERROR journey output exceeded 1 MiB\n") {
      logs.push("\nlevel=ERROR journey output exceeded 1 MiB\n");
      terminate(child, "SIGKILL");
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const onWorkerExit = () => terminate(child, "SIGKILL");
  process.once("exit", onWorkerExit);
  let closing: Promise<void> | undefined;
  const stopApp = async () => {
    process.removeListener("exit", onWorkerExit);
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) resolve();
      else child.once("exit", () => resolve());
    });
    terminate(child, "SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 500);
      }),
    ]);
    clearTimeout(timer);
    terminate(child, "SIGKILL");
    await exited;
    child.stdio[3]?.destroy();
    try {
      captureEvidence?.({ seed, seedTruncated, logs });
    } finally {
      await rm(data, { recursive: true, force: true });
    }
  };
  // Concurrent explicit and automatic teardown must await the same cleanup.
  const close = () => (closing ??= stopApp());
  try {
    const port = await assignedPort(child, logs);
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error(`Journey app exited: ${logs.join("")}`);
      let healthy = false;
      try {
        const response = await fetch(`${url}/api/health`, {
          redirect: "manual",
          signal: AbortSignal.timeout(500),
        });
        healthy = response.status === 200;
      } catch {
        /* Listener readiness is distinct from application health. */
      }
      if (healthy) {
        if (role !== undefined) await assertJourneyIdentity(url, role);
        return { url, logs, close };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error(`Journey app did not become healthy: ${logs.join("")}`);
  } catch (error) {
    await close();
    throw error;
  }
}

async function assertJourneyIdentity(url: string, role: string) {
  const response = await fetch(`${url}/__ark/mock-whoami`, {
    redirect: "manual",
    signal: AbortSignal.timeout(500),
  });
  if (response.status !== 200)
    throw Error(`Journey identity unavailable for role ${JSON.stringify(role)}`);
  const identity: unknown = await response.json();
  if (
    typeof identity !== "object" ||
    identity === null ||
    !("role" in identity) ||
    identity.role !== role
  ) {
    throw Error(`Journey identity does not match requested role ${JSON.stringify(role)}`);
  }
}

function terminate(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function assignedPort(child: ChildProcess, logs: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let record = "";
    const timer = setTimeout(() => finish(Error("Journey app readiness timed out")), 8_000);
    const pipe = child.stdio[3];
    const finish = (error?: Error, port?: number) => {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      pipe?.removeAllListeners("data");
      if (error) reject(error);
      else resolve(port!);
    };
    const onError = (error: Error) => finish(error);
    const onExit = () => finish(Error(`Journey app exited before readiness: ${logs.join("")}`));
    child.once("error", onError);
    child.once("exit", onExit);
    pipe?.on("data", (data: Buffer) => {
      record += data.toString();
      if (Buffer.byteLength(record) > 256) {
        finish(Error("Oversized journey readiness record"));
        return;
      }
      if (!record.includes("\n")) return;
      try {
        const ready = JSON.parse(record.trim());
        if (
          Object.keys(ready).length !== 2 ||
          ready.version !== 1 ||
          !Number.isInteger(ready.port) ||
          ready.port < 1 ||
          ready.port > 65535
        )
          throw Error("Invalid journey readiness record");
        finish(undefined, ready.port);
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}
