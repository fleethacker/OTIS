import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

// Resolve the native checker entry from the protected toolchain, not app scripts.
export function toolEntry(name) {
  const manifest = Bun.resolveSync(`${name}/package.json`, import.meta.dirname);
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const entry = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0];
  return resolve(dirname(manifest), entry);
}

function spawnTool(name, args, cwd, stdout) {
  // tsc is a normal executable: managed npm bin locally, Wolfi bin in the image.
  const command =
    name === "tsc"
      ? [name, ...args]
      : [
          process.execPath,
          "--no-env-file",
          `--config=${join(import.meta.dirname, "bunfig.toml")}`,
          toolEntry(name),
          ...args,
        ];
  return Bun.spawn(command, {
    cwd,
    stdout,
    stderr: "inherit",
    env: {
      ...process.env,
      PATH: `${resolve(import.meta.dirname, "../node_modules/.bin")}:${process.env.PATH ?? ""}`,
    },
  });
}

// Run native tools with their ordinary human output and exit status.
export async function runTool(name, args, cwd = process.cwd()) {
  const code = await spawnTool(name, args, cwd, "inherit").exited;
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

// Remove previous checker reports before lint starts, including early policy failures.
export function clearLintReports() {
  for (const name of ["oxlint", "rumdl"]) {
    rmSync(join(process.cwd(), ".ark/validation", `${name}.json`), { force: true });
  }
}

// Keep native JSON reports separate from stderr and render their human diagnostics.
export async function runCheckerReport(name, args, cwd = process.cwd()) {
  const child = spawnTool(name, args, cwd, "pipe");
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  let report;
  try {
    report = JSON.parse(output);
  } catch {
    process.stdout.write(output);
    throw new Error(`Checker JSON report unavailable: ${name} (exit ${code})`);
  }
  const diagnostics = name === "oxlint" ? report.diagnostics : report;
  if (!Array.isArray(diagnostics)) {
    throw new Error(`Checker JSON report invalid: ${name}`);
  }
  const directory = join(process.cwd(), ".ark/validation");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.json`), output);
  for (const diagnostic of diagnostics) {
    const file = diagnostic.filename ?? diagnostic.file;
    const location = diagnostic.labels?.[0]?.span ?? diagnostic;
    process.stdout.write(
      `${file}:${location.line}:${location.column} ${diagnostic.code ?? diagnostic.rule} ${diagnostic.message}\n`
    );
  }
  if (code !== 0) throw new Error(`${name} failed (exit ${code})`);
}

// TS7's native CLI replaces the removed TypeScript JS compiler API. Resolve
// only the canonical configuration's paths; application tsconfig cannot weaken it.
export async function withProject(run) {
  const directory = mkdtempSync(join(tmpdir(), "ark-typecheck-"));
  try {
    const config = JSON.parse(readFileSync(join(import.meta.dirname, "tsconfig.json"), "utf8"));
    for (const key of ["include", "exclude"]) {
      config[key] = config[key].map((path) => resolve(process.cwd(), "ark/pipeline", path));
    }
    config.compilerOptions.typeRoots = [join(process.cwd(), "node_modules/@types")];
    const project = join(directory, "tsconfig.json");
    writeFileSync(project, JSON.stringify(config));
    await run(project, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
