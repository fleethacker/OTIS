// Production build script for the Ark generated app UI.
//
// Pipeline:
//   1. Tailwind v4 + daisyUI v5 CSS → build/styles.css (@tailwindcss/cli)
//   2. React/TSX → build/main.js (Bun.build, JS entry)
//   3. index.html → build/index.html (copied, refs stable filenames)
//
// Go embeds the build/ directory via `//go:embed all:ui/build` and serves
// the assets from the same binary as the API. Stable filenames (no
// hashing) keep the embed contract simple — no manifest indirection.
//
// Usage:
//   bun run build         — one-shot production build
//   bun run build --watch — incremental rebuild on file changes

import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arkSourceStamp } from "./ark-source-stamp";
import { uiRuntimeAssets } from "./build-ui-assets";

const root = join(process.cwd(), "ui");
const routes = Bun.spawn(
  [
    process.execPath,
    "--no-env-file",
    `--config=${join(import.meta.dir, "bunfig.toml")}`,
    join(import.meta.dir, "generate-routes.ts"),
  ],
  { stdout: "inherit", stderr: "inherit" }
);
if ((await routes.exited) !== 0) throw new Error("Route generation failed");
const outdir = join(root, "build");
const watch = process.argv.includes("--watch");

// Live-preview source stamping: only when ARK_STAMP_SOURCE=1 (set by
// BinaryRunner for preview builds), so the shipped bundle stays clean.
// See scripts/ark-source-stamp.ts / docs/adrs/adr-0026-live-preview-annotation.md.
const stampPlugins =
  process.env.ARK_STAMP_SOURCE === "1" ? [arkSourceStamp({ appRoot: join(root, "..") })] : [];
if (stampPlugins.length > 0) {
  console.log("[build] live-annotation source stamping ON (data-ark-src)");
}

// Clean for a deterministic bundle, but PRESERVE the tracked .gitkeep across
// the wipe. Its absence makes `//go:embed all:ui/build` fail on a fresh clone,
// and deleting it dirties every story commit — the build used to silently rm it
// here, so each `git add -A` staged a spurious `ui/build/.gitkeep` deletion.
// Read its exact bytes before the wipe, restore them after.
const gitkeepPath = join(outdir, ".gitkeep");
const gitkeep = existsSync(gitkeepPath) ? readFileSync(gitkeepPath) : null;
if (!watch && existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}
mkdirSync(outdir, { recursive: true });
if (gitkeep !== null) {
  writeFileSync(gitkeepPath, gitkeep);
}

// 1. CSS — Tailwind v4 + daisyUI v5.
console.log("[build] tailwindcss → styles.css");
const cssFlags = watch ? "--watch=always" : "--minify";
const cssTool = join(
  Bun.resolveSync("@tailwindcss/cli/package.json", import.meta.dir),
  "../dist/index.mjs"
);
const cssProcess = Bun.spawn(
  [
    process.execPath,
    "--no-env-file",
    `--config=${join(import.meta.dir, "bunfig.toml")}`,
    cssTool,
    "-i",
    "src/index.css",
    "-o",
    "build/styles.css",
    cssFlags,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" }
);
if (!watch && (await cssProcess.exited) !== 0) throw new Error("Tailwind build failed");

const runtimeAssets = uiRuntimeAssets(root, outdir);

// 2. JS bundle.
console.log("[build] bun build → main.js");
const buildResult = await Bun.build({
  entrypoints: [join(root, "src/main.tsx")],
  outdir,
  target: "browser",
  tsconfig: join(import.meta.dir, "tsconfig.json"),
  format: "esm",
  // One embedded app bundle avoids cross-chunk interop errors in libraries
  // that use dynamic imports. Apps choose their own optional libraries, then
  // the browser journey proves the resulting bundle works at runtime.
  splitting: false,
  minify: !watch,
  sourcemap: watch ? "linked" : "none",
  plugins: [...stampPlugins, runtimeAssets.plugin],
  naming: {
    entry: "[name].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
});

if (!buildResult.success) {
  console.error("[build] bun build failed:");
  for (const message of buildResult.logs) {
    console.error(message);
  }
  process.exit(1);
}

// 3. Publish worker assets and link CSS emitted from JavaScript imports.
runtimeAssets.publish(buildResult);

console.log(`[build] done → ${outdir}`);

if (watch) {
  console.log("[build] watching for changes (Ctrl+C to stop)");
  const { watch: fsWatch } = await import("node:fs");
  let rebuilding = false;
  fsWatch(join(root, "src"), { recursive: true }, async (_event, filename) => {
    if (rebuilding || !filename) return;
    rebuilding = true;
    console.log(`[build] change detected: ${filename}, rebuilding…`);
    const result = await Bun.build({
      entrypoints: [join(root, "src/main.tsx")],
      outdir,
      target: "browser",
      tsconfig: join(import.meta.dir, "tsconfig.json"),
      format: "esm",
      splitting: false, // match the production bundle above.
      sourcemap: "linked",
      plugins: [...stampPlugins, runtimeAssets.plugin],
      naming: {
        entry: "[name].[ext]",
        chunk: "chunks/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
      },
    });
    if (!result.success) {
      console.error("[build] rebuild failed:");
      for (const message of result.logs) console.error(message);
    } else {
      runtimeAssets.publish(result);
      console.log("[build] rebuild done");
    }
    rebuilding = false;
  });
}
