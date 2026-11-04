# ADR 0001: Retain the Watch Desk Go service during integration

Date: 2026-11-04

Status: Accepted for the current integration. Long-term ownership remains a team
decision. The user explicitly requested keeping Go for now and recording the
choice so the team can revisit it.

## Context

Parse Command implements a Rust parser SDK and host, with ICD JSON for
OpenSearch core/passages/audit. After PR #2 merged, SDK 0.2.0 / ICD 1.1.0 also
provide OPTASK interpretation, geographic projections and durable IMAP intake.
The imported Watch Desk application has a React
UI and Go service with ConnectRPC, identity integration, SQLite/ENT persistence,
private acknowledgement drafts, structured preparation and private activity.
Removing Go immediately requires porting these contracts and behaviors before
the imported UI can retain its current functionality.

## Decision

Keep Watch Desk as a self-contained application at `apps/watch-desk/`, including
its Go module, Bun workspace, protobuf/ENT generators, tests, Ark dependencies
and handoff context. Its Go binary serves embedded React assets and the existing
same-origin ConnectRPC API. Keep parsing and parser contributions in `backend/`.

The base Compose stack packages Go/React and OpenSearch. The optional
`compose.intake.yml` overlay also runs the existing Rust intake executable and
demo mail server, reusing PR #2's service definitions. Rust owns intake, parsing
and local custody; continuous canonical publication and its read API remain
follow-up work. The proposed
read boundary is React → Go presentation service → Rust API → OpenSearch;
agree it with the team before implementation. OpenSearch credentials remain
server-side. No operational UI data adapter is implemented by this packaging step.

SQLite currently holds fictional source records as well as private UI state.
When the upstream adapter exists, canonical operational messages/facts must stay
under the Rust/OpenSearch contract. Retain private drafts/preparations in a
separate state store; do not use OpenSearch audit documents for private draft text.

## Consequences

- Preserves the tested UI, draft ownership, generated clients and source links.
- Adds Go and Bun to the build toolchains alongside Rust, plus a persistent UI
  volume. The browser still uses one origin.
- Requires a deliberate translation between ICD string/revision IDs and the
  presentation API's numeric record IDs, evidence and freshness semantics.
- Avoids interpreting message validity periods as scheduled ship events or
  changing parser contracts just to match the imported presentation model.

## Team decision to revisit

Revisit before operational API/schema stabilization, or when measured deployment
cost and maintenance ownership justify consolidation. Compare:

1. Keep Go as the presentation service and Rust as the domain/intake service.
2. Port Go RPCs, private persistence and identity boundary into Rust while
   preserving frontend clients or deliberately versioning their replacement.
3. Separate static UI serving and introduce an agreed gateway/API arrangement.

The team should consider maintainer expertise, memory/image costs, offline
packaging, authentication enforcement, transactional private state, migration
effort and duplication of domain rules. Any replacement must preserve private
owner isolation, source/revision identities, lossless payloads, unknown-time
behavior, and failure visibility. Require contract and browser regressions plus
a migration plan for persisted drafts/preparations. No option is preselected for
the later decision.
