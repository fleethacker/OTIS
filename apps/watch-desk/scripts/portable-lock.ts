// Normalize only the exported registry host in a disposable lockfile copy.
// Dependency versions, metadata and integrity hashes remain byte-for-byte intact.
import { resolve } from "node:path";

const [source, destination] = process.argv.slice(2);
if (!source || !destination || resolve(source) === resolve(destination)) {
  throw new Error("Usage: bun scripts/portable-lock.ts SOURCE DISTINCT_DESTINATION");
}
const original = await Bun.file(source).text();
const portable = original.replaceAll(
  "http://proxy.git-pkgs-proxy.svc.cluster.local:8080/npm/",
  "https://registry.npmjs.org/"
);
await Bun.write(destination, portable);
