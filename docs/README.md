# Parse Command design and knowledge

Contract baseline: 2026-11-04. The compact parsed-message structure is approved; ICD 1.1.0 and the schemas specify the contributor contract. The [Rust backend](../backend/README.md) implements the parser SDK, in-memory host and OPTASK contribution, with regression coverage against the supplied examples. The demo intake worker durably stages email receipts and parser results; the application server continuously publishes messages, passages and audit batches to OpenSearch. The [supported-message list](../README.md#supported-optask-messages) identifies tested profiles.

The current [Rust application API](integration/rust-application-api.md) and
[combined-stack runbook](integration/combined-stack.md) describe the deployed
React → Rust → OpenSearch boundary and migration of private SQLite state.
The [integration analysis](integration/ark-export.md), export inventory and
[ADR 0001](decisions/0001-retain-watch-desk-go-service.md) retain the original
Go import decision, superseded by the approved bulk Rust integration.

The objective is an operational capability; the two-day hackathon milestone is its first proof of concept. Confirmed constraints: Rust ingestion/parsing service, OpenSearch persistence and local embedding inference, hybrid keyword/semantic search, Docker Compose, strict airgap architecture, defensive implementation, resource efficiency, resilience, and initial coverage of all OPTASK messages. A teammate owns the UI.

Confirmed baseline: runtime-only airgap, CPU-only laptop target with no GPU, IMAP-only mail access with TLS deferred in v1, bursts of hundreds of messages every few hours, and 365 days total searchable retention measured from USMTF issue time: 90 hot days followed by 275 cold days. Use the 2003 USMTF catalog as the parser baseline; infer extensions from later examples where the evidence supports them, recording their provenance and uncertainty. Build the parser extension interface first; teams contribute Rust modules/crates compiled into the server. Physical storage topology, expiry cutoff granularity, and hardware limits remain open.

| Document | Purpose |
| --- | --- |
| [Parsed-message ICD 1.1.0](ICD.md) | Normative compact message/passage/audit contract and parser contribution rules |
| [JSON Schemas](schemas/README.md) | Locally resolvable validation resources for the approved wire shape |
| [Stored search templates and frontend contract](opensearch/search-contract.md) | Local CPU narrative embeddings, typed filters and keyword/semantic/hybrid requests |
| [UI test mappings](opensearch/README.md) | Isolated lexical test index definitions; fixtures stay outside Git |
| [Implementation plan](planning/implementation-plan.md) | Proposed architecture, work packages, dependencies, validation gates, and two-day sequencing |
| [Settings, users, and OIDC plan](planning/settings-and-oidc.md) | Proposed shared settings, per-user timezone, Admin/Viewer roles, UDS/Keycloak integration, migration, and validation |
| [Parser extension interface](planning/parser-extension-interface.md) | First-build priority: contributor contract, registration, isolation, and test harness |
| [Sample-data location](review/json-structure/README.md) | Pointer to external fixtures; payloads are not stored in this Git folder |
| [Decisions and questions](planning/decisions-and-questions.md) | Confirmed requirements and unresolved choices; no implied defaults |
| [UI integration contract proposal](planning/ui-integration-contract.md) | Proposed backend boundary for the teammate; not yet an agreed API |

Evidence labels used throughout: **Confirmed** means specified by the user; **Source fact** means supported by an identified source; **Proposed** is a design recommendation awaiting agreement; **Open** means unresolved. A proposed value or approach is not an accepted requirement.

The existing `.pdlc-docs/` files capture the earlier WHY/WHAT discussion. These files develop the engineering plan requested subsequently. This folder contains summaries and design notes, not copies of the manuals or operational traffic.

Email framing is confirmed: SMTP delivery, IMAP retrieval, body beginning with `MSGID`, and an email subject prefixed by `SUBJ:`. Core `subject` is the decoded display/search value; original header and transformation details go to audit. Existing body-only fixtures have null subjects.

Detailed USMTF knowledge and manual-derived notes are kept outside Git at `../OPTASK_Messages/knowledge`; they are distributed with the external sample data. Do not recreate a knowledge corpus under this documentation folder.

- [Settings, OIDC and hidden state](integration/settings-oidc.md): implementation contract, roles, configuration and migration.
