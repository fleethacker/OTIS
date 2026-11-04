# Decisions and open questions

Status: planning, 2026-11-04. No unconfirmed implementation choice below is a default. Answers should be recorded here before dependent implementation begins.

## Confirmed requirements

| ID | Requirement |
| --- | --- |
| R1 | Build a real operational capability; first proof of concept ready in two hackathon days |
| R2 | Lightweight Rust service receives mail traffic, queues it, and parses records |
| R3 | OpenSearch persists data, provides configurable lifecycle management, runs local embedding inference in an ingest pipeline, and hosts hybrid BM25/semantic search templates |
| R4 | A teammate owns the UI; this work provides its integration boundary |
| R5 | Deploy with Docker Compose |
| R6 | Resource/memory efficiency, resilience, defensive code, and entirely airgapped architecture are mandatory |
| R7 | Initial message scope is exclusively all OPTASK messages |
| R8 | Original product requirements include command-specific tasking/events/correspondence, coordinating C2 POC, frequency plans, crypto change-over windows, flight quarters, and a consolidated 24-hour schedule |
| R9 | Draft responses and awareness of an existing command schedule are desired capabilities; no decision has been made on their two-day inclusion |
| R10 | Representative messages and watchstander/SME access are available |
| R11 | Target a laptop-style, CPU-only architecture; no GPU. Exact architecture, CPU, RAM, and disk remain undecided |
| R12 | Expect bursts of hundreds of messages every few hours; exact peak count, rate, and size remain undecided |
| R13 | 365 days total searchable retention measured from USMTF issue time: first 90 days hot, following 275 days cold; cold must remain searchable without manual restore |
| R14 | Airgap requirement applies to runtime only; connected builds and artifact preparation are allowed |
| R15 | Implement IMAP only. TLS is required eventually, but the user explicitly permits omitting mail TLS for v1 |
| R16 | Use the 2003 USMTF baseline; infer additional sets/layouts from later supplied examples where feasible. Identify inferred rules separately from documented 2003 rules |
| R17 | First build milestone is the parser-server extension interface so other teams can contribute additional message types |
| R18 | Contributed parsers are Rust modules/crates compiled into the server; runtime-installable plugin loading is outside this version's scope |
| R19 | Keep core indices focused on user-facing/query data. Move evidence, field positions, parser trace and detailed diagnostics into a separate OpenSearch audit index written in batches |
| R20 | Compact structure approved. Store parsed fixtures alongside raw data under FleetHacker/OPTASK_Messages/parsed, outside Git. Put the ICD/schema design under Parse-Command/docs; user owns the GitHub push |
| R21 | Email is delivered via SMTP and retrieved via IMAP; body begins with MSGID; email Subject value begins with SUBJ:. Record decoded subject in core display/search data and original header/transformation in audit |

## Initial questions and answers

| ID | User answer / remaining decision | Affects |
| --- | --- | --- |
| Q1 | Answered: IMAP only; mail TLS deferred for v1. Authentication and MIME/message packaging remain unspecified. | Mail adapter, delivery acknowledgment, cursor persistence, integration test |
| Q2 | Answered: CPU-only laptop, no GPU, bursts of hundreds every few hours; 365 days total from USMTF issue time, 90 hot then 275 searchable cold. Exact hardware/size, cutoff granularity, and storage topology remain undecided. | Image/model selection, memory limits, queue sizing, lifecycle policy, measurable performance acceptance |
| Q3 | Answered: runtime-only airgap. No approved versions, models, or base images were identified in the reply. | Runtime supply bundle, version pinning, model and native engine packaging; offline build tooling is not required by the current scope |

**Protocol correction:** SMTP transfers mail; inbox retrieval requires a mail-access interface. See [IMAP RFC 9051](https://www.rfc-editor.org/rfc/rfc9051.html). No adapter has been silently substituted for the user's wording.

## Additional decisions required before their dependent work

| ID | Decision needed | Why it matters |
| --- | --- | --- |
| Q4 | Baseline resolved: 2003, with evidence-backed inferred extensions from later examples. Confirm any additional operational OPTASK variants beyond the fourteen supplied and any local deviations. | Inference is authorized, but sparse examples cannot establish every allowed layout/conditional rule |
| Q5 | Which operational fixtures and SME-approved expected outputs define acceptance, including an explicit flight-quarters example? | Prevents treating generic format examples as a correctness oracle |
| Q6 | What command roster, aliases, group memberships, and local C2 routing source should be used? | Originator, addressee, mentioned unit, tasked unit, and local coordinator are different concepts |
| Q7 | What rules resolve partial dates/zones, recurring times, enclosing periods, amendments, cancellation, and out-of-order receipt? | Determines what can safely appear as a resolved current schedule |
| Q8 | Body MSGID and email Subject SUBJ: framing are confirmed. MIME charset/content type, attachments, multiple messages and sectioned transmissions still need definition. | Determines decoding/limits; PDF/OCR ingestion is not implied |
| Q9 | What enclave identity/access control, markings/releasability, TLS/PKI, and audit requirements apply? Who may read, configure, replay, or correct records? | Determines API and storage permissions; command filtering alone is not authorization |
| Q10 | What outage duration, data-loss tolerance, restart time, and host-failure recovery are required? Is a single node acceptable? Where can local snapshots live? | A single host can be restart-resilient but does not provide host-level high availability |
| Q11 | What backend contract does the UI teammate need, and what is the 24-hour window/display-zone definition? Is live push required or is polling sufficient? | Enables early integration without inventing frontend behavior |
| Q12 | Which desired additional capabilities belong in the two-day milestone, and who owns them? | Avoids unplanned response drafting or external-schedule integration |
| Q13 | What should happen when issue time is absent, ambiguous, invalid, or implausibly future; and what cutoff granularity is acceptable? | Issue-time retention is confirmed, but the 2003 MSGID lacks a full issue timestamp and index age is not message age |
| Q14 | What audit retention/time origin, source-evidence cleanup policy and batch count/byte/flush-delay limits are required? | A separate batched audit index is confirmed; unflushed or independently expired audit data must not lose the only source evidence |

## Proposed choices to review

| ID | Proposal | Rationale / unresolved condition |
| --- | --- | --- |
| P1 | One Rust runtime process, with an embedded SQLite durable work journal and bounded workers | Avoids a separate broker; validate local disk durability and queue volume |
| P2 | Deterministic format-aware parser with versioned profiles; no generative parser in the core path | Efficient, reproducible, and explainable; complete semantics still need correct specs/SME rules |
| P3 | Canonical message documents plus derived search passages in OpenSearch | Keeps schedule facts independent of embedding readiness and avoids embedding an entire long order as one truncated vector |
| P4 | Local embedding inference within OpenSearch, packaged before offline startup | Matches the required ingest-pipeline ownership; model/runtime selected only after budget confirmation |
| P5 | Rust API mediates UI access to OpenSearch using stored query templates | Centralizes validation, authorization, source tracing, and query budgets |
| P6 | Bounded retries, persistent progress, quarantine, visible degraded states, explicit lexical fallback | Supports recovery without silently losing or pretending to semantically index messages; fallback policy needs agreement |
| P7 | Versioned schema/configuration and repeatable one-shot bootstrap from packaged files | Makes offline installation and restart behavior testable |

Follow-up answers recorded: IMAP only; 365 total days from USMTF issue time with searchable cold; 2003 baseline plus inferable later extensions; interface-first delivery with compiled Rust parser contributions. The remaining cold-storage decision is implementation topology, not whether cold data is searchable. Cutoff granularity and handling of unresolvable issue time remain open.

No numeric memory target, model name, OpenSearch release, network port, mail interval, API library, or crate version has been selected. Do not substitute restore-only archives for the confirmed searchable-cold requirement.
