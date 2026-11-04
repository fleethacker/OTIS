# Parser server extension interface

The normative contributor contract is now [ICD 1.0.0](../ICD.md), with [JSON Schemas](../schemas/README.md). The [implemented SDK and host foundation](../../backend/README.md) provide the compiling contributor workflow. This earlier design note provides rationale; use the ICD and SDK when a proposed interface detail differs. The crates are local and have not been published to a package registry.

Status: foundation and initial OPTASK contribution implemented, 2026-11-04; operational adapters remain subsequent work. **Confirmed:** build the server's parser interface first so other teams can contribute additional message types as Rust modules/crates compiled into the server. The host interface permits additional parsers. Current OPTASK example coverage is listed in the root README; no broader edition compliance is claimed.

Packaging is confirmed: compiled Rust modules/crates. Independently installable runtime plugins are outside this version's scope. The precise trait signatures, crate boundaries, common fact types, and contribution checks below remain design proposals.

## First deliverable

Establish the parser contract, registry, contributor guide, and fixture-based conformance harness before coupling the first OPTASK parser to email or OpenSearch. Show that an independently written example parser can register, receive the documented input, and return the documented output through the host. The production enabled-type allowlist initially contains only the agreed OPTASK types.

The parser extension contract is separate from the UI's HTTP API. Other teams contribute domain interpretation; the host retains transport, durability, limits, storage, search, and external request handling.

## Responsibility split

| Host owns | Message parser owns |
| --- | --- |
| IMAP receipt, durable queue, MIME/charset handling | Exact message identifiers and supported profile/layout declarations |
| Original bytes, decoded text, representation IDs and source mapping | Format-specific ordering, fields, repeated segments, and structural validation |
| Common USMTF scanner and lossless ordered records | Message-specific interpretation of tasking, time, frequencies, and POCs |
| Registry, dispatch, enabled-type configuration, resource accounting | Evidence-backed mappings and explicit ambiguity/unsupported diagnostics |
| Versioned common result types, canonical serialization | Typed output using the shared contract, plus permitted namespaced extension facts |
| OpenSearch mappings, indexing, model calls, retention, UI API | Its own labeled fixtures and declared interpretation limits |

The shared scanner handles USMTF syntax, including free-text slash rules and columnar structure. A parser does not reimplement MIME decoding or use its own global slash splitter. If a future message family needs another grammar, register a separate explicit decoder contract rather than disguising that content as USMTF.

## Proposed interface operations

Names below describe the intended contract; they are not final Rust signatures or public HTTP routes.

| Operation | Input | Output / guarantees |
| --- | --- | --- |
| Describe parser | None | Stable parser ID/version, supported exact message identifiers, declared releases/layouts, capabilities, interface version |
| Assess compatible profile | Bounded envelope evidence and decoded record view | Supported, unsupported, or ambiguous with explicit evidence; no network or mutation |
| Parse/interpret | Borrowed message/record view and immutable parse context | Bounded typed facts, diagnostics, coverage report, source links, and rule provenance |

Prefer a pure synchronous domain interface with borrowed input and a bounded output collector. Keep async mail/storage tasks outside it. The host bounds concurrent parse jobs and isolates CPU/blocking work from networking. Exact Rust types and crate layout are execution deliverables after review.

### Input contract

- Immutable decoded source, explicit encoding/representation identity, and offsets mapped to that representation.
- Ordered set/field occurrences, raw placeholders, and preserved unknown records.
- Candidate message identity/profile evidence; keep declared values intact.
- Read-only command/alias/roster context and rule revisions where applicable.
- Explicit parse limits and a cancellation/work-budget interface to be finalized.
- Any reference time supplied as an explicit input with provenance. No hidden current-date substitution.

Parsers must not access mail credentials, OpenSearch clients, model inference, filesystem paths, or network endpoints through their context. That keeps domain code testable offline and prevents a parser implementation from bypassing queue/indexing policy.

### Output contract

The parser emits two bounded outputs: compact core facts for display/query, and separate audit events containing parser/interface version, chosen profile/evidence, per-fact spans/field positions, rule provenance, unresolved content and detailed diagnostics. The host stages both durably, then batches audit writes to the dedicated OpenSearch audit index. Core facts retain only revision-scoped IDs and the small uncertainty/review flags users need. A successful return can still describe partial interpretation; it must not imply every record was understood.

Common fact categories serve the shared product: tasking/correspondence, command applicability, coordinating contacts/roles, temporal facts, frequency plans, and amendment/cancellation references. Unknown categories can be preserved in a namespaced, versioned extension envelope with bounded size. OpenSearch does not dynamically map arbitrary extension keys; contributors cannot introduce an unbounded field schema.

For inferred later-example rules, put the example/definition reference, layout signature, rule revision and affected fact IDs in the audit output. Preserve an `inferred` or unresolved status in the compact core where users need it. Preserve ambiguity if the evidence cannot select a meaning. Model numeric confidence is not required and is not a substitute for rule evidence.

Do not invent timestamps or durations to satisfy the timeline DTO. Do not assign a local C2 role solely because a message includes a POC. Return unresolved states in the common types.

## Registry and dispatch

1. Register parser descriptors from compiled Rust modules/crates through an explicit registry.
2. Validate interface compatibility, stable IDs, and conflicting claims at startup/build validation.
3. Discover the exact USMTF message identifier with the common scanner. Use full identifiers: `OPTASK LINK` and `OPTASK LINK ID SUPP` are different.
4. Filter candidates by configured enabled types and supported profile/layout evidence.
5. Dispatch only when the applicable implementation is unambiguous. Never pick the first registered parser or rely on registration order.
6. Preserve unsupported/ambiguous messages and report why interpretation did not complete. Their durable receipt is not lost.

The initial 2003 baseline and later-example extensions may be profiles within one parser or separate implementations; the contract must represent both without falsifying the source's declared edition. Choose granularity during interface review, not by accidental source-file layout.

## Defensive resource and isolation contract

Configure maximum input bytes, record/field count, nesting, emitted facts, diagnostics, and total output bytes. Limit CPU concurrency and avoid unnecessary source-text copies. Use offsets/borrowed views where practical; output owns only the data needed beyond the parse call.

Compiled Rust modules run with the process's authority. A Rust trait is an organizational interface, not a sandbox: it cannot contain arbitrary memory allocation, an infinite loop, unsafe code, or a process abort. Cooperative budgets, dependency review, fuzzing, resource tests, and the process/container limits are necessary. A timeout around a synchronous call does not forcibly stop it. If untrusted independently installed modules are required, design and measure a separate isolation mechanism before promising containment.

No parser may treat text inside a message as executable configuration, retrieve message URLs, or deserialize arbitrary code. Malformed input produces typed, bounded diagnostics rather than a panic. Keep logging at the host boundary and redact message contents.

## Contributor workflow

1. Declare the message identifiers, format/profile evidence, known limitations, and supported common facts.
2. Implement only domain validation/interpretation through the common interface.
3. Add cited format definitions or labeled examples for every semantic rule, marking inferred extensions explicitly.
4. Supply minimal valid, repeated-segment, missing-data, ambiguous-profile, malformed, and limit-boundary fixtures with expected outputs.
5. Run the common conformance harness, parser-specific tests, fuzz corpus, and resource checks.
6. Register the parser and update the capability/coverage manifest. Keep production enablement controlled; adding a parser need not automatically enable its message types.
7. Package through the approved build path. New parser artifacts and dependencies are prepared before transfer into the airgapped runtime.

The contributor guide should include one small reference parser and show how a team adds a second parser without changing the IMAP adapter, durable queue, OpenSearch writer, or UI contract. A generic example parser can be test-only so it does not expand production scope beyond OPTASK.

## Interface acceptance gate

- An independently authored fixture parser is discovered and invoked through the same interface as OPTASK.
- Adding it requires no host transport/storage changes.
- Exact identifier and profile conflicts are detected deterministically.
- Unsupported types, ambiguous profiles, and unknown records remain inspectable.
- Common output serializes consistently and preserves valid source spans.
- Inferred rules carry provenance; cancellation/date uncertainty remains explicit.
- Input/output/work limits have meaningful boundary tests; a trait is never presented as a security sandbox.
- Contract compatibility is versioned; incompatible extensions fail clearly rather than corrupting persisted records.
- A parser/version update can reprocess retained source with traceable results under the agreed revision policy.

Only after this gate should the first OPTASK parsers be integrated into durable mail processing. The UI-facing API can be drafted concurrently against the same common result types.
