import { runTool, withProject } from "./typescript-project.mjs";
// The native TS7 CLI has no JSON reporter; plain output retains stable diagnostic codes.
await withProject((project) =>
  runTool("tsc", ["--noEmit", "--pretty", "false", "--project", project])
);
