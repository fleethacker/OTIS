# Source handoff

Source revision: `ce3c03c45f94ca17ddc4214305e6f96f9611c891`. Export policy: `portable-source-v1`.

This archive contains committed application source and portable framework inputs. See `../docs/ark-handoff.md` for local development guidance and `manifest.json` for provenance and machine-readable omissions.

The export excludes known Ark internals, local credentials, and disposable output by path. It does not scan arbitrary file contents for secrets or prove that the application builds.

## Omitted or replaced files (20)

- ".ark-hooks/commit-msg": ark-private
- ".ark-hooks/pre-commit": ark-private
- ".ark-manifest.json": ark-private
- "AGENTS.md": public-guidance-replacement
- "CLAUDE.md": public-guidance-replacement
- "ark/.gitignore": ark-private
- "ark/codegen/ent/generate.go": ark-private
- "ark/codegen/ent/go.mod": ark-private
- "ark/codegen/ent/go.sum": ark-private
- "ark/go/AGENTS.md": public-guidance-replacement
- "ark/go/CLAUDE.md": public-guidance-replacement
- "ark/testing/README.md": ark-private
- "ark/testing/uds.ts": ark-private
- "ark/uds-package/package.yaml": ark-private
- "ark/uds-package/values.schema.json": ark-private
- "ark/ui/.gitignore": ark-private
- "ark/ui/AGENTS.md": public-guidance-replacement
- "ark/ui/CLAUDE.md": public-guidance-replacement
- "ark/ui/README.md": public-guidance-replacement
- "docs/ark-handoff.md": public-guidance-replacement
