// Build-time source stamping for live-preview annotation (Ark).
//
// Stamps every host (intrinsic, lowercase-tag) JSX element with a
// `data-ark-src="<app-relative-path>:<line>"` attribute pointing at the
// source location that produced it. The live-annotation overlay reads the
// nearest stamped ancestor (overlay.js `closest('[data-ark-src]')`), so a
// pinned element resolves to an exact file:line instead of a brittle CSS
// selector — including third-party widgets (maps, charts), which
// resolve to the wrapper component you actually wrote.
//
// Mechanism: locate JSX opening/self-closing elements via the Oxc
// AST and SPLICE the attribute into the original source text (no re-emit),
// so Bun still does the real transpile and line numbers / sourcemaps stay
// accurate. Bun then compiles `data-ark-src` through as a normal DOM
// attribute (React passes data-* attributes to the DOM verbatim).
//
// Dev/preview only: build.ts adds this plugin solely when
// ARK_STAMP_SOURCE=1, which BinaryRunner sets for preview builds — so the
// shipped UDS bundle carries no stamps. See
// docs/adrs/adr-0026-live-preview-annotation.md (Phase 2).

import type { BunPlugin } from "bun";
import { relative } from "node:path";
import { parseSync, Visitor } from "oxc-parser";

/** isHostTag reports whether a JSX tag is an intrinsic (DOM) element —
 *  lowercase first char and no dots. `div`/`button`/`h2` are host;
 *  `Card` / `motion.div` are components (their own host elements get
 *  stamped inside their own files). */
function isHostTag(tag: string): boolean {
  return /^[a-z]/.test(tag) && !tag.includes(".");
}

/** stampTsx inserts `data-ark-src="relPath:line"` after the tag name of
 *  every host JSX element. Exported for unit testing. */
export function stampTsx(code: string, relPath: string): string {
  const parsed = parseSync("f.tsx", code);
  // Syntax diagnostics belong to Bun's build pipeline. Avoid modifying a
  // partially recovered tree and let the compiler report the original source.
  if (parsed.errors.length > 0) {
    return code;
  }

  const inserts: Array<{ pos: number; text: string }> = [];
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }

  const sourceLineAtOffset = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (lineStarts[middle] <= offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  };

  new Visitor({
    JSXOpeningElement(node) {
      const tag = code.slice(node.name.start, node.name.end);
      // Skip if a stamp (or hand-written data-ark-src) is already present.
      const openingElement = code.slice(node.start, node.end);
      if (isHostTag(tag) && !openingElement.includes("data-ark-src")) {
        inserts.push({
          pos: node.name.end,
          text: ` data-ark-src="${relPath}:${sourceLineAtOffset(node.name.start)}"`,
        });
      }
    },
  }).visit(parsed.program);

  if (inserts.length === 0) {
    return code;
  }
  // Apply back-to-front so earlier offsets stay valid as we splice.
  inserts.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const ins of inserts) {
    out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  }
  return out;
}

/** arkSourceStamp is the Bun build plugin. appRoot is the generated app
 *  root; stamped paths are relative to it (e.g. `ui/src/components/X.tsx`). */
export function arkSourceStamp(opts: { appRoot: string }): BunPlugin {
  return {
    name: "ark-source-stamp",
    setup(build): void {
      build.onLoad({ filter: /\.tsx$/ }, async (args) => {
        // Only stamp first-party app source — never node_modules or any
        // file resolved outside the app root (e.g. a linked framework lib).
        const relPath = relative(opts.appRoot, args.path);
        if (args.path.includes("/node_modules/") || relPath.startsWith("..")) {
          return undefined;
        }
        const code = await Bun.file(args.path).text();
        return { contents: stampTsx(code, relPath), loader: "tsx" };
      });
    },
  };
}
