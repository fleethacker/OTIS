// Expose missing build/check packages to app CSS and TypeScript resolution.
// React and its renderer share one installation, as in Ark's checker bindings.
// Other existing app dependencies keep their own locked installation.
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [directory] = process.argv.slice(2);
if (!directory) throw new Error("Usage: bun scripts/bind-tools.ts TOOLCHAIN_DIRECTORY");
const tools = resolve(directory);
const manifest = await Bun.file(join(tools, "package.json")).json();
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  const target = join(process.cwd(), "node_modules", name);
  if (existsSync(target)) {
    if (name !== "react" && name !== "react-dom") continue;
    const appPackage = await Bun.file(join(target, "package.json")).json();
    const toolPackage = await Bun.file(join(tools, "node_modules", name, "package.json")).json();
    if (appPackage.version !== toolPackage.version) {
      throw new Error(`Refusing mismatched shared ${name} versions`);
    }
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(join(tools, "node_modules", name), target);
}
