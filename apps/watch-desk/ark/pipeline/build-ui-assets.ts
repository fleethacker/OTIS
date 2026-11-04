// Runtime assets that the JavaScript bundle does not publish by itself.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { BunPlugin, BuildOutput } from "bun";

export function uiRuntimeAssets(root: string, outdir: string) {
  const mapDistributions = new Set<string>();
  const plugin: BunPlugin = {
    name: "ark-ui-runtime-assets",
    setup(build) {
      build.onResolve({ filter: /^maplibre-gl(?:\/|$)/ }, (args) => {
        // Resolve from the importing app, using its selected dependency version.
        const from = args.importer ? dirname(args.importer) : root;
        mapDistributions.add(dirname(Bun.resolveSync("maplibre-gl", from)));
        return undefined;
      });
    },
  };

  function publish(result: BuildOutput) {
    for (const distribution of mapDistributions) {
      const worker = join(distribution, "maplibre-gl-worker.mjs");
      if (!existsSync(worker)) continue; // v5 embeds its worker; v6 serves ESM files.
      for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        copyFileSync(join(distribution, name), join(outdir, name));
      }
    }
    const links = result.outputs
      .filter((output) => output.path.endsWith(".css"))
      .map((output) => {
        const url = encodeURI(relative(outdir, output.path));
        return `<link rel="stylesheet" href="/${url}" />`;
      })
      .join("\n");
    const html = readFileSync(join(root, "index.html"), "utf8");
    writeFileSync(join(outdir, "index.html"), html.replace("</head>", `${links}\n</head>`));
  }

  return { plugin, publish };
}
