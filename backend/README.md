# Parse Command backend

The Rust parser foundation lives here. Shared contracts remain in [`../docs/ICD.md`](../docs/ICD.md); the imported UI and its Go presentation service live in [`../apps/watch-desk/`](../apps/watch-desk/). See the [integration analysis](../docs/integration/ark-export.md) and [decision to retain Go for now](../docs/decisions/0001-retain-watch-desk-go-service.md). SDK version 0.2.0 implements ICD 1.1.0 as local, compiled crates; nothing is published to a package registry.

The root [`compose.intake.yml`](../compose.intake.yml) overlay runs this worker
with Watch Desk, OpenSearch and the demo mail server in one Compose project.
See the [combined-stack guide](../docs/integration/combined-stack.md). The existing
standalone intake deployment in `compose.intake.yaml` remains supported.

| Package | Responsibility |
| --- | --- |
| `parse-command-types` | Strict core message, passage and audit DTOs, semantic validation, UTC timestamps and deterministic IDs |
| `parse-command-parser-api` | Borrowed scanner views, contributor trait, typed failures, cooperative work budget and bounded output sink |
| `parse-command-core` | Explicit registry/allowlist, profile selection, host metadata, core/audit separation and validated results |
| `parse-command-intake` | Demo mailbox monitor, custody journal, bounded MIME decoding and parser staging |
| `parse-command-optask` | Profile-specific OPTASK interpretation with rule provenance and external sample regression coverage |
| `examples/reference-parser` | Independent synthetic contributor crate exercised through the host; no production enablement |

This milestone provides a synchronous library host and OPTASK contribution. The [intake worker](INTAKE.md) adds read-only IMAP polling, MIME framing, SQLite custody and durable outbox staging. Continuous OpenSearch delivery, passage construction, embeddings and HTTP remain subsequent adapters. A successful parse returns an in-memory result, not a persistence acknowledgement. Unsupported or failed accepted email remains in the custody journal with an explicit state.

## Build and verify

Use Rust 1.85 or newer, with Cargo available on PATH. From this directory:

```sh
cargo test --workspace --locked --offline
cargo clippy --workspace --all-targets --locked --offline -- -D warnings
cargo fmt --all --check
python3 tools/generate_types.py --check
```

Without a host Rust toolchain, run the workspace tests in the pinned build image
from the repository root:

```sh
docker build --target test -f backend/Dockerfile -t parse-command-backend-tests:local .
```

This target includes the demo configs needed by the synthetic custody tests.
External corpus regressions remain opt-in and are not copied into the image.

Dependencies are pinned in `Cargo.lock`. Offline builds require the dependencies to have been provisioned beforehand; runtime airgap does not imply an unprepared machine can build offline. These libraries perform no network, filesystem, model or wall-clock calls during parsing. The external fixture test explicitly reads local files only when requested:

```sh
PARSE_COMMAND_SAMPLES=/absolute/path/to/OPTASK_Messages/parsed \
  cargo test -p parse-command-core --locked --offline external_fixture_conformance -- --ignored
```

The external test checks all message/passage/audit DTOs against the Rust contract and round-trips them without field loss. It also scans all fourteen preserved source bodies and verifies their exact message types and hashes. It does not verify OPTASK semantic interpretation. Keep supplied traffic, fixtures and USMTF knowledge outside this repository. Constructed generic contract cases live in the test sources.

To run the separate OPTASK semantic regression against the same external fixtures:

```sh
PARSE_COMMAND_SAMPLES=/absolute/path/to/OPTASK_Messages/parsed \
  cargo test -p parse-command-optask --locked --offline external_optask_regression -- --ignored
```

The [supported-message list](../README.md#supported-optask-messages) identifies the tested profiles. This test compares every approved example fact and header value, and allows additional explicit participants and uncertainty fields. It checks 13 periods, 27 frequencies, 25 activities and 8 contacts. Human approval of the sample wire structure does not by itself validate operational interpretation.

## Use the OPTASK contribution

Add `parse-command-optask` as a path dependency of the consuming backend crate. Construct `Box::new(parse_command_optask::OptaskParser)` in the host registry and explicitly enable the required exact identifiers from `SUPPORTED_MESSAGE_TYPES`; the library does not enable them globally. Pass decoded body and email subject separately to `ParserHost::parse`.

The profile selector distinguishes the short 2003 header from the observed standard/version-bearing headers. Known layouts have separate field rules. The 2003 subset requires an explicit host security context because that header supplies no policy; it does not manufacture a security policy or issue timestamp. Context reference times are not used to fill missing event dates.

Core status remains `partial` while records are retained without semantic projection. Bad record layouts produce audit diagnostics and a review flag while subsequent sound records remain available. All facts from a record are validated before emission; output-limit or cancellation errors still abort the entire result. Unknown classifications retain conflict status, and source caveats flag security review. Source POCs/participants do not assign local C2 roles or resolve command aliases.

The implementation validates exact integer-Hz conversion, date calendars, verified-time checksums and conditional period qualifiers. Baseline daily crypto recurrence evidence stays in audit; partial times are not expanded into a dated schedule. Full issue timestamps alone establish retention. Resource limits remain caller-supplied, and the crate adds no new third-party dependencies to the foundation's dependency set.

## Add a parser crate

1. Create a crate under `crates/` (automatically a workspace member). Depend on `parse-command-parser-api` and `parse-command-types` via workspace dependencies; inherit the workspace package settings and lints.
2. Start with [`examples/reference-parser/src/lib.rs`](examples/reference-parser/src/lib.rs). Implement `MessageParser::descriptor`, `assess` and `parse`. Declare exact message identifiers, profiles, ICD major version and emitted fact categories.
3. Use borrowed `MessageView` records, fields, rows and UTF-8 byte spans. `FieldView::raw()` preserves alignment; `normalized()` explicitly folds wrapped whitespace. Validate message-specific field layouts yourself. Unknown records remain available in the ordered view and host audit.
4. Assess profiles from body evidence. Return unsupported or ambiguous when appropriate. Email subjects are metadata and must not select a parser. Use static rule IDs for applicable evidence.
5. Emit a `HeaderInterpretation`, typed core facts and separate `AuditEntry` values through `ParseSink`. Every fact needs an audit entry whose `subject_id` matches its revision-scoped ID. Put spans, rule provenance and detailed evidence in audit payloads. Do not invent absent times or C2 routing.
6. Call `context.budget.checkpoint(units)` in loops. Return partial completeness and user-facing review flags for incomplete interpretations. No parser receives mail, storage or network clients.
7. Add your crate to the consuming host's dependencies, construct it in `Registry::new`, and explicitly enable its full message type in the registry's `BTreeSet`. Merely compiling the crate does not enable it. Identical claims fail registration; multiple applicable candidates fail selection regardless of registration order.
8. Exercise valid, missing, repeated, malformed, ambiguous and limit cases through `ParserHost`. Use the core integration tests as a host harness. Domain fixtures and their rule citations remain outside Git.

The embedding DTO supports separately constructed search passages; parsers do not run embeddings or emit replacement message storage envelopes. Schema changes start in `docs/schemas/types.schema.json`; regenerate with `python3 tools/generate_types.py`, then inspect and test the generated diff. Handwritten semantic validation remains in `parse-command-types/src/lib.rs`.

## Host guarantees and limits

The caller must provide all input/output/count/depth limits, enabled types, revision, recording timestamp, command IDs, cancellation and work budget. Test limits are test fixtures, not laptop capacity recommendations. No deployment resource defaults have been selected.

The host hashes the exact decoded UTF-8 body, derives expiry as 365 elapsed days from a resolved issue timestamp, and leaves unresolved expiry null. It strips one leading `SUBJ:` marker from decoded email metadata while retaining the original decoded value in audit. The intake MIME adapter preserves original receipt/header bytes and representation provenance in custody/audit. Only an explicit host policy override can validate security markings. Complete parser output remains `needs_review`; partial output remains `partial`.

The bounded sink checks fields, unique IDs, fact counts, serialized bytes and audit structure; a failed emission stays failed even if a contributor ignores the error. The host rechecks final envelope bytes and fact-to-audit links before returning either result stream. No partial result is returned after failure. Errors carry static codes and offsets, not message text; callers must also avoid logging source or output objects.

Compiled contributors are trusted code with process authority. Cooperative cancellation cannot preempt a loop that never checks its budget, and output limits cannot prevent allocations inside arbitrary contributor code. Dependency review, malformed-input tests and future process/container limits remain necessary. This interface does not establish durability, performance capacity or operational authorization.

## Application server

`parse-command-server` combines durable intake, continuous batched OpenSearch publication, typed read APIs, generated ConnectRPC services and owner-scoped private SQLite state. The parser SDK remains transport independent. See the [combined stack](../docs/integration/combined-stack.md) and [application API](../docs/integration/rust-application-api.md). Building the server requires Rust 1.97.1 in the pinned Docker build; the parser foundation retains its declared minimum. The root build context supplies the original application proto files and canonical index definitions.
