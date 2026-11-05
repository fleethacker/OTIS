# OTIS rebrand validation

Run date: 2026-11-05. Host: macOS ARM64. Branch: `codex/otis-rebrand`.

## Portable diagnostics

Run from `apps/watch-desk/` with the existing installed application and exported
toolchain dependencies:

| Check | Result |
| --- | --- |
| Exported UI builder | Passed; generated routes, CSS, JavaScript, and local hashed image assets |
| UI unit tests | 87 passed, 0 failed; includes About navigation and the renamed acknowledgement text |
| Go tests | Passed; optional external corpus remains absent in this clean checkout |
| Go vet | Passed |
| Exported TypeScript checker | Passed |
| Exported lint/format checks | Passed |
| Authored diff whitespace check | Passed |

Commands:

```sh
bun --no-env-file --config=ark/pipeline/bunfig.toml ark/pipeline/build-ui.ts
bun --no-env-file --config=ark/pipeline/bunfig.toml --tsconfig-override=ark/pipeline/tsconfig.json test --preload ./ark/pipeline/test-setup.ts ./ui/src/
GOWORK=off go test -count=1 ./...
GOWORK=off go vet ./...
bun --no-env-file --config=ark/pipeline/bunfig.toml ark/pipeline/typecheck.mjs
bun --no-env-file --config=ark/pipeline/bunfig.toml ark/pipeline/lint.mjs
```

## Browser review

A temporary loopback-only server served the actual UI build with isolated
authentication, settings, empty message, and notification fixtures. This was a
UI review; it did not exercise a production backend, real sign-in, or message
ingestion. No fixture server or browser harness is included in application code.

Headless Chromium review passed for:

- OTIS browser title, branded header and sign-in screen.
- Local loading of the 256px mascot and 800px emblem.
- SVG favicon decoding without an external request.
- Navigation-menu and footer links to About OTIS, return to Calendar, and direct
  About-page reload.
- Light/dark presentation and viewport widths of 320, 390, 640, 768, and 1440px.
- No horizontal page overflow or overlap between the brand, clock, and account
  controls at the reviewed widths.
- No unexpected browser errors or external resource requests during the
  authenticated branding review.

## Canonical Ark limitation

`ark run job build`, `ark run job test-go`, `ark run job test-ui`, and the
relevant preparation journey were attempted. The installed development CLI
rejects the export's protected pipeline files before running these jobs. This
is the preexisting mismatch documented in
[`docs/integration/validation.md`](../../../../../docs/integration/validation.md#toolchain-limits).
The protected `ark/` files remain unchanged. The portable results above are
not a successful canonical Ark pipeline or journey run.
