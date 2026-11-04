# UI integration contract proposal

Status: proposed, not agreed. A teammate owns the UI. This document defines discussion points for the backend interface without selecting a frontend stack or implementing the UI.

## Ownership and boundary

Propose that the UI communicates only with the Rust API. Rust validates requests, applies authorization and query budgets, and calls OpenSearch stored templates. OpenSearch credentials and administrative endpoints stay outside the browser. UI assets and dependencies must be available inside the airgapped runtime.

Authentication, client identity, CORS/origin policy, TLS, URL paths, push versus polling, pagination style, and numeric limits need agreement. Deferring mail TLS in v1 does not decide these separate interface questions.

## Proposed operations

| Operation | Inputs to agree | Response content to agree |
| --- | --- | --- |
| List/query messages | Command(s), type, receipt/issue time filters, parse state, cursor, limit | Stable message/revision IDs, metadata, status, diagnostics summary |
| Inspect message | Message and optional revision ID | Compact metadata, extracted facts, contacts, markings, lineage and small review/status flags |
| Inspect source/audit | Message/revision and optional subject ID | Separately requested source text, record/field evidence, parser provenance and diagnostics, or audit flush pending |
| Retrieve timeline | Command(s), explicit window start/end, agreed display/time-zone policy | Resolved points/intervals, provenance, applicability, POC evidence, unresolved-items reference |
| Retrieve unresolved/untimed items | Command(s), reason/type, pagination | Correspondence/tasking that cannot yet be assigned a resolved timestamp; do not silently drop it |
| Search | Query text, lexical/semantic/hybrid mode, command/time/type filters, pagination | Parent/revision, matched passage text/IDs, ranking mode, completeness/degraded status; source spans available through audit detail |
| Read capabilities/health | Authorized caller as required | Format/profile support, model readiness, queue pressure, downstream availability, version information |

Manual correction, review actions, replay, configuration changes, response drafting, and existing-schedule integration require separate scope and permission decisions. A read API does not implicitly authorize mutation or outbound correspondence.

## Proposed shared record semantics

- **Identity:** Separate delivery receipt, immutable source message, logical message identity, and parsed revision/generation. Explicit lineage links for cancellation or amendment when supported.
- **Source evidence:** Detailed source text/representation, byte offsets, field positions, segment context and parser/profile version are fetched separately from the dedicated audit index using message ID + revision + subject ID. They are not part of normal timeline/search result payloads. Audit intent is durable before core publication, but an index flush may still be pending; expose that distinction on audit-detail requests. Evidence endpoints require the same applicable access controls as core data.
- **Time:** Original token, purpose, parsed precision/zone, qualifier, optional recurrence, context/rule evidence, resolution status, and resolved instants only when established. Distinguish validity intervals from event times and deadlines.
- **Applicability:** Explicit tasked entities, normalized command identity where resolved, match basis, unresolved references, and alias/group-policy revision. Receipt or mention does not imply task applicability.
- **Coordination:** Source POC, local C2 role/POC if mapped, mapping evidence, effective roster version, and unresolved/contradictory status.
- **Frequency:** Original value/units, normalized checked value where valid, designation/channel/function, context, and effective time evidence where known.
- **Status:** Retain only small user-visible completeness, inference/unresolved and review indicators in core results. Detailed diagnostics, unsupported records and parser execution traces live in audit. Service/enrichment readiness remains a separate operational capability.
- **Markings:** Preserve source markings/releasability evidence and enforce the agreed authorization policy on messages and passages alike. Do not infer an access grant from a misspelled or absent label.

## Error and degraded behavior

Use a stable structured error envelope with machine-readable code, safe explanation, request ID, retryability, and relevant capability status. Bound error detail and omit secrets/message bodies from logs.

The contract should distinguish malformed input, unauthorized access, unknown format/profile, unresolved time, partial interpretation, query limit, backend unavailable, and semantic model unavailable. A search fallback must explicitly identify the mode actually executed. An empty timeline is different from an unavailable timeline or one with unresolved source items.

OpenSearch projection updates are not cross-index atomic. State how canonical message availability and pending passage enrichment appear to clients; do not claim all views become visible at the same instant. If revision switching is required, agree a publication strategy before implementation.

## Fixture scenarios for the teammate

1. Valid frequency plan with multiple nets and explicit temporal context.
2. Crypto change-over point/recurrence with an unresolved date, alongside a resolved event.
3. Explicit flight-quarters interval from an SME-approved example.
4. Message relevant to multiple commands, with different coordinating evidence.
5. Unknown set/profile and untimed correspondence preserved for inspection.
6. Amendment/cancellation and out-of-order receipt under the agreed domain rules.
7. Canonical facts available while embeddings are pending; explicit lexical fallback.
8. No results, incomplete processing, downstream outage, and access-denied states.

Deliver the final schema and fixtures early in execution after teammate review. Do not choose response shapes based on an assumed frontend implementation.
