# Parse Command — Working Notes

## Session — 2026-11-04

### Confirmed context

- Team: Parse Command.
- The objective is a real operational capability. The user explicitly corrected framing that reduced the effort to a demo.
- Two hackathon days are available to prepare the proof of concept.
- User supplied the challenge requirements; they also appear in the project README.
- User confirmed availability of representative messages and access to watchstanders or subject-matter experts who can validate interpretations. These resources have not yet been inspected or consulted in this session.
- User requested an abbreviated PDLC process using skills from ~/dougbot. Read the pdlc-documentation skill and both references.
- No existing PDLC documents or research notes were found. No Linear connector is available in this session.

### Open questions

- Select the first end-to-end operational scenario and its expected result; this will anchor proof-of-concept scope and validation.
- Inspect representative messages and establish expected extractions with an SME.
- Establish acceptance thresholds and distinguish proof-of-concept acceptance from operational readiness.
- Define POC mapping inputs, command applicability rules, time interpretation, and message amendment handling.
- Decide whether response drafting or existing-schedule conflict detection belongs in the two-day milestone. The supplied challenge labels both as nice-to-have; no decision to exclude them has been confirmed.

### Parking lot

- Source traceability, user review, uncertainty flags, and a configurable command roster were proposed by the assistant. They are candidates for discussion, not accepted requirements.
- Technical architecture and implementation choices have not been discussed. The PDLC skill covers the problem statement and solution narrative; its guide treats technical design as a separate engineering document.

### Next conversation

Ask for the single end-to-end scenario the proof of concept must handle, starting with a message and ending with what a watchstander needs to know or do. Use it to establish acceptance criteria with the available SME.

## Session — 2026-11-04 — Engineering planning

### Confirmed context

- User requested a detailed plan before execution and durable Markdown knowledge from the three manuals, starting exclusively with all OPTASK messages.
- Product has three parts: Rust email intake/queue/parser, OpenSearch persistence/local ingest embeddings/hybrid stored templates/configurable lifecycle, and teammate-owned UI. Docker Compose deployment is required.
- Defensive code, resource/memory efficiency, resilience, and entirely airgapped runtime are mandatory. User clarified builds and preparation may use the network.
- Laptop-style CPU-only target, no GPU; exact hardware and message size remain undecided. Traffic is hundreds of messages in bursts every few hours.
- Mail access is IMAP/POP3, not SMTP polling. TLS is required eventually but may be ignored for v1 per explicit user direction. IMAP vs POP3 vs both remains a follow-up question.
- Requested retention is 90 days hot and 365 days cold. Total-duration interpretation and whether cold must remain searchable are follow-up questions.

### Research and artifacts

- Found three PDFs and fourteen OPTASK text fixtures in the parent FleetHacker directory.
- Read OPTASK-relevant sections of all three manuals; extracted all PDF text locally and documented the actual review scope. Source register records source hashes and page references.
- Five supplied OPTASK variants have corresponding message definitions in the 2003 catalog; nine have later examples without corresponding message definitions there. Important MSGID/CRYPTDAT/DALKFREQ/IVCCN layouts differ across editions.
- No explicit flight-quarters phrase was found in the extracted catalog/examples; an operational fixture and SME interpretation remain necessary.
- Created docs/README.md, knowledge notes, detailed engineering plan, UI contract proposal, and decision register. Implementation has not begun.
- Platform research used official OpenSearch, Docker, DJL, and mail-protocol documentation without uploading manual contents or traffic.

### Open questions

- Pending user follow-ups: protocol choice, retention semantics, controlling format release and all-OPTASK inventory.
- Need mail packaging/authentication, command/POC roster, partial-date and amendment rules, UI contract, security/marking requirements, and recovery objectives before their dependent implementation.
- Model/version selection and numeric resource guarantees remain unselected until the deployment budget and compatibility tests are available.

### Proposals awaiting agreement

- Embedded SQLite durable journal within one Rust process; format-aware deterministic parser with versioned profiles; canonical OpenSearch message documents and derived passages; Rust-mediated bounded UI API.
- Explicit enrichment status and lexical fallback while a local model is unavailable. These are proposed failure behaviors, not yet accepted policy.

## Session — 2026-11-04 — Follow-up decisions and interface-first direction

- User selected IMAP only.
- User clarified 365 days total retention, with 90 hot and 275 cold days, all searchable; retention starts at USMTF issue time.
- User selected the 2003 format baseline and authorized inferring additional sets/layouts from later examples where possible. Preserve rule provenance and ambiguity; later full-spec compliance is not implied.
- User directed that the first build deliverable be the parser server interface, enabling other teams to contribute message types. Teams will supply Rust modules/crates compiled into the server; runtime plugin loading is not required.
- Added docs/planning/parser-extension-interface.md and changed the implementation sequence to put the contract, registry, common types, contributor guide, and conformance harness before mail/storage integration.
- Verified OpenSearch ISM logical lifecycle states, allocation actions, and searchable snapshots in official docs. Proposed laptop profile keeps sealed old indices open/read-only/searchable on existing storage; separate physical cold storage is not selected. Amazon managed-service cold storage has different query semantics and is not proposed.
- Remaining decisions include missing/ambiguous issue-time policy, index expiry granularity and late writes into sealed data, IMAP authentication/MIME packaging, command/POC rules, actual resource envelope, UI contract, and operational acceptance fixtures.
- Changes remain planning/knowledge documents only; user has not yet requested execution of the implementation plan.

## Session — 2026-11-04 — Candidate JSON validation

- User requested actual sample parsing and JSON for validation before approving the structure. Formal schema design and published ICD follow explicit approval; do not treat this review as approval or publish an ICD yet.
- Read all fourteen text fixtures in the parent OPTASK_Messages folder and consulted installed OpenSearch search skills plus official hybrid, neural, nested, and embedding-processor documentation.
- Produced fourteen complete canonical JSON message documents preserving 462 source records and 151 candidate passage projections under docs/review/json-structure/.
- Created validation-preview.json, full review-examples.json, corpus manifest, NDJSON collections, illustrative hybrid/timeline/embedding JSON, and artifact verification results. Generation used a one-off local review script, not a production Rust parser.
- Proposed canonical message documents plus flat passage documents for shared BM25/vector retrieval. Only query-relevant fact tuples need nested mappings; raw records should be stored without indexing every field.
- Semantic extraction is explicitly partial. Missing times/command roster/local C2 mapping remain unresolved, inferred rules have provenance, IM issue month lacks a year/day/time, and historical periods are preserved rather than rewritten.
- Proposed lexical-first passage persistence keeps BM25 available while vectors are pending, refining the earlier canonical-message BM25 fallback; this design change awaits structure approval.
- Verified JSON, source hashes/byte spans, field references, parent/passage linkage, URL handling, missing channel preservation, and unresolved dates. OpenSearch execution, embeddings, and SME correctness checks have not run.

## Session — 2026-11-04 — Compact core and separate audit index

- User rejected the large evidence-heavy core payload shape and directed moving evidence, field positions and related details to a batched audit log, keeping core indices focused on information presented to users.
- User selected a separate OpenSearch audit index rather than rotated local log files.
- Revised all fourteen sample message documents and 151 passages. Audit holds all 462 source records, original sources/hashes, detailed interpreted facts, diagnostics and passage-source links in 115 review events. Core links by message/revision/short subject ID.
- Proposed audit payload indexing disabled with only lookup/time/type/security metadata indexed; durable staging, bounded Bulk batches, per-item acknowledgment, retry/replay and backpressure are documented. No audit Bulk request was sent.
- Compact sample source JSON shrank from 280,203 to 15,742 bytes for messages (94.4%) and 230,797 to 113,583 bytes for search passages (50.8%); combined core reduction is 74.7%. One COMMS core document shrank from 12,843 to 1,786 bytes. These are source JSON sizes, not measured index/RAM savings. Evidence is relocated and still consumes audit storage.
- The compact proposal replaces the previous review shape. Formal schema/mappings/ICD still await approval. Audit retention/time origin, batch limits and source cleanup ordering remain unresolved.

## Session — 2026-11-04 — Approved contract and external fixture handoff

- User approved the compact structure and requested parsed fixtures for the UI team's OpenSearch test instance plus an ICD for parser crate contributors.
- User selected FleetHacker/OPTASK_Messages/parsed alongside the original raw sources, outside the Git folder; reiterated that sample data must stay outside Git. Earlier review payloads in docs are being relocated there, not retained as a repository corpus.
- Created docs/ICD.md (ICD 1.0.0), four locally resolvable Draft 2020-12 schemas, three isolated lexical UI test mapping bodies, and docs/tools/validate_samples.py.
- Prepared 14 message documents, 151 passages and 115 separate audit events, with collection/per-document JSON, Bulk action/source bodies, load instructions, schema-validation results and checksums. No instance is populated by this task; fixtures retain their historical dates, unresolved states and unvalidated markings, and test mappings attach no retention policy.
- User added email subject capture and confirmed SMTP delivery / IMAP retrieval, MSGID at the start of the body, and SUBJ: at the start of the email subject value. Added required nullable subject to core message/passage schemas; original header and normalization evidence stay in audit. Existing body-only fixtures have null subjects.
- ICD specifies shared Rust trait/type responsibilities and serialized shapes, without claiming a published or implemented host SDK crate. User will push the documentation to GitHub; no push is performed here.
- JSON Schema validation and negative cases passed for all fixtures along with source/span, fact/audit/parent linkage, interval/expiry/frequency and Bulk framing checks. Live indexing, embeddings, SME semantic correctness, and Rust host/SDK integration remain untested.

### Handoff verification

- Installed and hash-verified the external bundle at FleetHacker/OPTASK_Messages/parsed, including Bulk files and validation/load instructions. Removed 27 earlier repository review-payload files only after external copies were verified. Original raw files were not modified.
- User moved docs/knowledge to FleetHacker/OPTASK_Messages/knowledge and requested keeping USMTF knowledge out of Git. Removed repository knowledge links and relocated detailed ICD format rules to that external knowledge directory; kept the Git ICD focused on the data/interface contract.
- Revalidated all external fixtures against four schemas and the original source files. Repository JSON now consists only of schemas and mappings; no fixture JSON/NDJSON remains under docs/review.
- Concurrent Git activity committed the documentation and earlier sample payloads while this work was underway. Found sample files in commit 1f3048d, included in the locally recorded origin/main history. Current-tree sample deletions are pending. Asked whether to prepare a history-cleanup plan; no history rewrite or push was performed.

## Session — 2026-11-04 — Settings and OIDC planning

- User requested pushing the completed workflow first, then reviewing GitHub settings backlog and planning a user store with OIDC, with questions before implementation.
- Published workflow commits through PR #14, head `3656195`; observed it merged into main at `60ac735`. Created `codex/settings-oidc-plan` from that main revision for planning only.
- Read GitHub issues #6 and #11 for settings, plus related summary and UDS packaging dependencies #7, #9, and #13. The current implementation target is Rust/React, superseding the older Go context in #6.
- User confirmed UDS/Keycloak, approved IdP users with an IdP group granting administration, per-user display timezone with shared UTC default, and exactly two user types: Admin and Viewer.
- Created `docs/planning/settings-and-oidc.md` with proposed OpenSearch shared settings, SQLite users/sessions/preferences, stable issuer/subject identity, migration safeguards, role permissions, compact UI, and test gates. These engineering choices remain proposals pending plan approval.
- Asked whether Viewers may prepare acknowledgement drafts, which local GenAI interface to support, and whether dedicated Admin/Viewer test groups are acceptable. Production issuer/hostnames and resource allocation remain deployment inputs.
- User confirmed Viewers may create their own drafts, the first GenAI connection will use an enclave-local OpenAI-compatible API, and the local SSO groups are `/Parse Command/Admin` and `/Parse Command/Viewer`.
- User directed following IdP session limits. Removed the proposed fifteen-minute inactivity, eight-hour maximum, and five-minute revalidation timers from the plan. Local disable/revoke remains effective on the next request; actual Keycloak expiry, renewal, and group-change behavior will be verified during integration. This answer resolves the session-policy question without approving implementation of the overall plan.
- Applied dougbot PDLC documentation and UDS context guidance. Consulted official OpenID, OAuth, OpenSearch, and UDS sources. No credentials, sample traffic, or manual contents were uploaded.
- Local read-only inventory found no Kubernetes context or UDS/k3d CLI. Docker exposes 11.73 GiB RAM, while the documented full UDS demo calls for 10 GiB; the plan accounts for existing application memory and a smaller identity-layer test option.
- No settings/authentication code, database migration, or UDS deployment was performed in this planning step.

### Approved implementation and subsequent steering

- User approved the settings/OIDC plan and replaced the proposed SQLite persistence with hidden OpenSearch indices for all state, explicitly including IMAP custody, retries and publication outboxes. The migration and authentication implementation are in progress; they have not been deployed or accepted as complete.
- User requested auditing every parsed-message card that used numbered field labels and displaying the full handbook set name beside its identifier. The shared viewer now uses the supplied handbook's definitions across all available sets. Where newer example definitions are unavailable, the user directed showing the original values without invented labels.
- The UI catalog contains 105 set names and 444 field positions, including repeated fields and descriptor alternatives. Seven names missing from the initial field-index extraction were recovered from the set tables. The existing edition-specific layout differences remain explicit.
- Manual files, raw samples and extraction notes remain outside Git. The repository contains only runtime display metadata and synthetic regression cases for this change.

## Session — 2026-11-05 — Settings, hidden state and OIDC implementation

- Implemented shared settings, per-user timezone, Admin/Viewer management and native Rust OIDC; private state, custody, retries and publication now use two hidden OpenSearch indices. SQLite remains only a read-only migration input. See `docs/integration/settings-oidc.md` for the current contract.
- Added strict state envelopes, real-time conditional writes, bounded queues/search windows/cleanup, encrypted provider tokens, hashed cookies, same-origin mutations, local disable/revoke and a single-writer lease. Application idle/absolute session limits are not imposed over the IdP policy.
- Migrated consistent snapshot copies into isolated hidden indices and verified every record, content hashes and an idempotent repeated import. Preserved 57 receipts, 27 projections, 1,530 publication jobs, 1,032 audit records, private preparations/history and notification ownership. Live source volumes remain untouched.
- The preview on port 8082 uses copied hidden state and no mailbox password; the user-facing application on port 8080 remains the previous deployment. Browser checks verified Viewer/Admin settings, saved timezone, acknowledgement defaults, message cards and lifecycle history.
- User approved local `sso.uds.dev` and `parse-command.uds.dev`. UDS layer registry access and the full demo memory budget prevent the proposed minimal UDS install. Asked whether standalone Keycloak is acceptable or layer access can be supplied; no substitution or full-stack cutover has occurred pending that answer.
- Verification and outstanding actual-IdP/cutover gates are recorded in `docs/integration/settings-oidc-verification.md`. A signed-token test is not an end-to-end Keycloak or UDS acceptance result.

### Full local UDS deployment decision

- Timeout update, 2026-11-05: user explicitly selected 15 minutes of inactivity.
  Local Keycloak realm/client idle limits are 900 seconds; the existing maximum
  session and access-token limits remain. The UI must distinguish token expiry
  from the provider's session deadline and renew only on user activity.

- Local sign-in update, 2026-11-05: the user fixed the host file and explicitly
  declined an authenticator. The local Parse Command client now uses a copied
  UDS browser flow with second-factor subflows disabled. Fresh Admin/Viewer
  password-only logins pass; unapproved groups and Viewer user-management access
  remain denied. Realm defaults, PKCE and IdP session limits are preserved.
  Reapplication and rollback metadata live outside Git under `../uds-local`.

- User explicitly requested full UDS Core including UDS Registry, superseding the smaller-layer and standalone Keycloak alternatives above.
- Existing authenticated access can read the official Registry project and pull its packaged release. Downloaded Core 1.14.3 and Registry 0.52.1 ARM64 artifacts; verified UDS CLI 0.41.0 and k3d 5.9.0 release checksums.
- Deployment assets and private configuration remain in the external `FleetHacker/uds-local` directory. The custom full Core bundle preserves upstream packages/components and disables external Google federation. Its Kubernetes configuration is isolated and its host ports bind to loopback.
- Registry's packaged vulnerability database will be used with external updates disabled. Actual cluster readiness, runtime isolation and OIDC acceptance remain to be verified before application cutover.

### Compact settings modal and loopback UI test

- Added the requested admin-only Tabler settings gear at the right of the header.
  It opens the existing settings controls in the reusable native modal with compact
  tabs/forms. Closing preserves edits; Escape returns focus. Viewers keep personal
  Preferences in their account menu.
- User requested testing on 127.0.0.1. The compatible local test runs on port 8083
  with separate copied hidden indices and local demo accounts; 8080 and the HTTPS
  SSO preview retain their deployments. Local config remains outside Git.
- Protected type/lint/format checks, 86 UI tests, release build and browser checks
  pass. Browser verified Admin/Viewer visibility, saved defaults, and close/reopen.
- Pre-PR review found that portalled dialogs could remain visible during session
  revalidation. The shared modal now follows the authentication visibility boundary;
  a regression verifies hiding, same-account draft retention, and account-change
  clearing. Protected checks and all 87 UI tests pass.
