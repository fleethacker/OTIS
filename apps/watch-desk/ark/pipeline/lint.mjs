import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { clearLintReports, runCheckerReport, runTool, withProject } from "./typescript-project.mjs";

const root = process.cwd();
const config = import.meta.dirname;
const fix = process.argv.includes("--fix");
const staged = process.argv.includes("--staged");
clearLintReports();
async function git(args) {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  const status = await child.exited;
  if (status !== 0) throw new Error(`git ${args[0]} failed (exit ${status})`);
  return output;
}
const stagedPaths = staged
  ? (await git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACM"]))
      .split("\0")
      .filter(
        (file) =>
          file === "DESIGN.md" ||
          (file.startsWith("ui/src/") &&
            !file.startsWith("ui/src/gen/") &&
            /\.(?:tsx?|md)$/.test(file))
      )
  : [];
// Validate the complete selection before mutating even the first file.
if (stagedPaths.length > 0) {
  await git(["diff", "--quiet", "--", ...stagedPaths]).catch(() => {
    throw new Error(
      "Cannot format partially staged files; stage or discard their unstaged changes first."
    );
  });
}
const selected = (file) => !staged || stagedPaths.includes(file);
const sources = [];
const formattedSources = [];
for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: join(root, "ui/src") })) {
  if (file.startsWith("gen/") || !selected(`ui/src/${file}`)) continue;
  formattedSources.push(join(root, "ui/src", file));
  if (file.startsWith("test-utils/") || /\.test\.tsx?$/.test(file)) continue;
  const path = join(root, "ui/src", file);
  const parsed = parseSync(path, readFileSync(path, "utf8"));
  if (
    parsed.comments.some((comment) =>
      /^\s*(?:eslint|oxlint)-(?:disable|enable)/.test(comment.value)
    )
  ) {
    throw new Error(`Required lint policy cannot be disabled by source directives: ${file}`);
  }
  sources.push(path);
}
if (!staged)
  await withProject(async (project, temporary) => {
    const policy = JSON.parse(readFileSync(join(config, "oxlint.json"), "utf8"));
    for (const override of policy.overrides) {
      override.files = override.files.map((pattern) => resolve(root, "ui", pattern));
    }
    policy.jsPlugins = policy.jsPlugins.map((plugin) => resolve(config, plugin));
    const effective = join(temporary, "oxlint.json");
    writeFileSync(effective, JSON.stringify(policy));
    if (sources.length > 0) {
      await runCheckerReport(
        "oxlint",
        [
          "--config",
          effective,
          "--disable-nested-config",
          "--no-ignore",
          "--type-aware",
          "--tsconfig",
          project,
          "--max-warnings=0",
          "--format=json",
          ...(fix ? ["--fix"] : []),
          ...sources,
        ],
        join(root, "ui")
      );
    }
  });
if (formattedSources.length > 0)
  await runTool("oxfmt", [
    "--config",
    join(config, "oxfmt.json"),
    "--disable-nested-config",
    "--ignore-path",
    join(config, "ignore"),
    fix ? "--write" : "--check",
    ...formattedSources,
  ]);

const markdown = [];
if (selected("DESIGN.md") && existsSync(join(root, "DESIGN.md")))
  markdown.push(join(root, "DESIGN.md"));
for await (const file of new Bun.Glob("**/*.md").scan({ cwd: join(root, "ui/src") })) {
  if (!file.startsWith("gen/") && selected(`ui/src/${file}`))
    markdown.push(join(root, "ui/src", file));
}
if (markdown.length > 0) {
  // Explicit inputs and inline owned settings prevent workspace/global rumdl
  // discovery or .gitignore from suppressing required Markdown checks.
  const policy = Bun.TOML.parse(readFileSync(join(config, "rumdl.toml"), "utf8"));
  const settings = ["--no-config"];
  for (const [section, values] of Object.entries(policy)) {
    for (const [name, value] of Object.entries(values)) {
      if (name === "include" || name === "exclude") continue;
      settings.push("--config", `${section}.${name} = ${JSON.stringify(value)}`);
    }
  }
  if (fix) await runTool("rumdl", [...settings, "fmt", ...markdown]);
  await runCheckerReport("rumdl", [...settings, "check", "--output-format", "json", ...markdown]);
  await runTool("rumdl", [...settings, "fmt", "--check", ...markdown]);
}

if (stagedPaths.length > 0) await git(["add", "--", ...stagedPaths]);
