# Settings, users, and OIDC SSO

Status: approved for implementation, with the confirmed OpenSearch-only storage amendment below. Updated 2026-11-05.

The existing message workflow is published and merged in [PR #14](https://github.com/fleethacker/Parse-Command/pull/14). The user approved one coordinated settings and authentication release, then explicitly required migrating all persistence to OpenSearch, including the existing IMAP custody/retry/outbox journal. Implementation and verification remain in progress.

## Confirmed decisions

- Target enclave-local UDS/Keycloak. The user approved local test hostnames `sso.uds.dev` and `parse-command.uds.dev`. A local UDS Core deployment may be used for testing if necessary.
- Admit approved IdP users and map an IdP group to application administrators.
- Use hidden OpenSearch indices for all internal durable state, including users, sessions, preferences, settings, private message state, IMAP custody, retry state, and publication outboxes. SQLite is a read-only migration source, not a runtime store.
- Follow the IdP's session limits and renewal policy; do not impose separate application idle, absolute, or fixed revalidation timers.
- Expose exactly two user types: **Admin** and **Viewer**.
- Viewers may create their own reviewable acknowledgement drafts. Both roles may save personal timezone preferences and mark their own notifications read.
- Restrict the local SSO test to `/Parse Command/Admin` and `/Parse Command/Viewer`; deployment group names remain configurable.
- The first GenAI connection interface is an enclave-local OpenAI-compatible API. Summary generation remains separate backlog work.
- Save display timezone per user, with a shared UTC default. Source text and acknowledgement drafts retain Zulu times.
- Keep runtime entirely airgapped, CPU-only, resource-conscious, and resilient.
- Keep the UI compact, with concise labels and no implementation prose or internal identifiers.
- Generate reviewable acknowledgement drafts; sending remains unimplemented and send time remains pending.

The approved architecture incorporates the storage amendment below. Deployment-specific credentials and hostnames remain inputs, not inferred production values.

## Backlog scope

| Item | Work in this release |
| --- | --- |
| [#6 Shared settings and Settings page](https://github.com/fleethacker/Parse-Command/issues/6) | Shared ship/unit identity, explicit command selection, acknowledgement defaults, local GenAI connection configuration, validation, persistence, and Admin-only editing |
| [#11 Display timezone](https://github.com/fleethacker/Parse-Command/issues/11) | Per-user preference, shared UTC default, consistent presentation and civil-date handling |
| User store and OIDC | Rust login/session handling, durable users, Admin/Viewer authorization, personal-state ownership, and a compact user administration view |
| [#9 UDS/Zarf packaging](https://github.com/fleethacker/Parse-Command/issues/9) | Define and test the SSO integration contract; full application packaging remains separate work |
| [#7 On-demand summaries](https://github.com/fleethacker/Parse-Command/issues/7), [#13 Persistent summaries](https://github.com/fleethacker/Parse-Command/issues/13) | Provide their settings dependency; generation and persistence are separate features |

Issue #6 refers to the original Go export. Implementation targets the current Rust service and React UI. The existing MiniLM model remains an embedding model; it cannot satisfy the summary-generation backlog.

## Architecture and ownership

Keep the current UI, Rust server, and OpenSearch Compose services. The enclave IdP is an external platform dependency. Rust handles the OIDC exchange and application sessions; the browser receives an opaque session cookie. The application does not need an additional authentication proxy or database server.

| Data | Store | Ownership |
| --- | --- | --- |
| Shared command, acknowledgement, and model settings | Hidden OpenSearch application-state index, one versioned document | Admin writes; authenticated users receive permitted nonsecret values |
| Users, external identities, local access status | Hidden OpenSearch application-state index | Server-managed; Admin can disable/reactivate local access |
| Sessions and temporary login transactions | Hidden OpenSearch application-state index, bounded and expired | Server only |
| Timezone preference | Hidden OpenSearch application-state index, keyed by stable user ID | Each user writes their own preference |
| Drafts, preparations, activity, notification read state | Hidden OpenSearch application-state index with stable user ownership | Existing private ownership preserved |
| IMAP receipts, cursors, parse results, retries, publication outbox and history | Hidden OpenSearch custody index | Intake and publication workers only |
| IdP credentials, CA trust, model credentials | Deployment secret files/environment references | Server only; never ordinary indexed fields or browser payloads |

The existing SQLite `identities` table maps message source keys to numeric IDs and is a migration input distinct from users. Use strict hidden-index envelopes with unindexed payloads, one primary shard per state index, request-level translog durability, real-time ID reads, and optimistic concurrency. A single document is the atomic write boundary; related state must either share an aggregate or use replayable idempotent steps. Index hiding is not authorization. Restrict OpenSearch connectivity and enforce role/owner checks in Rust.

OpenSearch availability now gates authentication, private-state writes, and durable intake. Fail closed on state-store errors. Do not advance an IMAP cursor until its receipt is acknowledged by OpenSearch. On recovery, replay persisted pending work with stable IDs and conditional updates. Search refresh lag must never determine whether a receipt, session, or revocation exists. Batched refreshes are for queue discovery only. Keep pending and failed work out of automatic expiry; expire ephemeral login/search/session records through bounded cleanup.

## Roles and access

| Capability | Viewer | Admin |
| --- | --- | --- |
| Search, calendar, source messages, parsed sets, lifecycle | Yes | Yes |
| Save own timezone; mark own notifications read | Yes | Yes |
| Create/edit own acknowledgement draft | Yes | Yes |
| Edit shared command/model settings | No | Yes |
| List users; disable/reactivate access; revoke sessions | No | Yes |
| Change IdP group membership | No | Managed in Keycloak |
| Access another user's private draft | No | No implicit access |
| Send acknowledgement email | Unavailable | Unavailable |

The confirmed local test groups are `/Parse Command/Admin` and `/Parse Command/Viewer`. Membership in either admits a user. Admin takes precedence when both are present. Missing, malformed, or unmatched claims deny access. Do not treat general realm registration, an email domain, or the first successful login as approval.

Enforce permissions in every Rust API/RPC handler, including existing preparation and acknowledgement-state mutations. Hiding a control is not authorization. Users cannot select their own role. Application Admin does not imply UDS platform administrator.

Proposed initial deployment shares the existing message corpus across approved users. Calendar command defaults are filters, not access controls. If command-specific access restrictions are required, that is a separate authorization decision that must be resolved before deployment.

## OIDC and sessions

Use a maintained Rust OIDC implementation and pin a version compatible with the workspace toolchain after a build check. Use authorization code flow with PKCE S256, one-use state, and nonce. Validate the issuer, signature, audience, authorized party where required, expiry, and nonce; reject reused or expired callbacks. These choices follow [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) and [OAuth security guidance](https://www.rfc-editor.org/rfc/rfc9700.html).

Identify each account by a unique `(issuer, subject)` pair linked to a stable local user ID. Username and email are display attributes, not ownership keys. Renaming them must not lose preferences or grant access to another account. [OIDC claim stability](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) defines this distinction.

Proposed routes are `/auth/login`, `/auth/callback`, and a CSRF-protected logout operation. Use an explicit configured public URL and exact callback registration. Replace the current HTTP/Host-based origin assumptions with a trusted-proxy boundary suitable for HTTPS. Preserve safe local return paths. Update Nginx routing so authentication routes reach Rust.

Use random opaque session IDs, store their hashes, and set HttpOnly, Secure, SameSite=Lax cookies for the HTTPS SSO deployment. Bind login transactions to the initiating browser, enforce CSRF protection on mutations, and keep provider tokens out of browser storage and logs. Bound authentication concurrency, HTTP response sizes, retries, and timeouts. Validate the enclave CA and restrict discovery/token/key traffic to configured IdP endpoints; do not follow arbitrary redirects.

Local account disablement and session revocation take effect on the next authenticated request. Check active-account status server-side. Follow Keycloak's configured realm/client session limits and token renewal policy, without separate application idle, absolute, or fixed revalidation timers. Validate token expiry and obtain fresh authorization through the IdP when renewal is required; loss of the required group denies access. Do not treat an ID token's expiry as the complete IdP session policy. Background notification polling must not trigger renewals that keep an otherwise inactive session alive. Verify the actual client policy and measure group-change propagation during integration testing rather than assuming cached claims reflect current membership.

Proposed revalidation uses a server-side refresh grant with fresh validated identity/group claims, where the configured Keycloak client supports it. Encrypt retained provider tokens with a deployment-supplied key using a vetted authenticated-encryption library, rotate refresh tokens when returned, and never expose them to the browser. If fresh authorization cannot be established, require a new authorization flow. Verify group removal and account disablement against the actual UDS client; refresh success alone is not proof of continued approval.

Support local logout and evaluate Keycloak [RP-initiated logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html). If back-channel logout is included, validate its signed logout tokens and replay protections before revoking matching sessions. Provider outages reject new logins and cannot activate demo access. Existing sessions are usable only within the approved validity/revalidation policy. A break-glass account is not an assumed requirement.

Replace the application-owned demo authentication integration without modifying bundled `ark/` code. Explicit development mode can retain demo identities for isolated tests; SSO mode must not expose the role picker, automatic demo role, or a fallback identity. Network errors must not be interpreted as authenticated access.

## Shared settings

Create a strict, versioned settings schema stored in the hidden application-state index. Use one primary shard for the laptop profile. Apply no message retention policy, embeddings, or search pipeline to settings. Bootstrap only an absent document; never reset an existing configuration at startup.

| Field | Behavior |
| --- | --- |
| Ship name and unit name | Human-readable command identity; do not use labels as inferred aliases |
| Default command selection | Explicit identifiers selected from indexed command values; drives initial calendar scope only |
| Outgoing command | Replaces `FLEETHACKER` in new drafts; validate the contract's 30-character limit |
| Action authority | Separate acknowledgement field; validate the contract's 50-character limit |
| Default display timezone | UTC for this release; users may override with a valid IANA zone |
| GenAI connection | Enclave-local OpenAI-compatible API, approved endpoint, model ID, bounded request settings, optional secret reference |

Expose typed settings read/update operations through Rust. Return only nonsecret configuration and a revision token. Require Admin on writes, validate server-side, reject unknown schema versions, and use OpenSearch [optimistic concurrency](https://docs.opensearch.org/latest/api-reference/document-apis/index-document/) to reject stale saves instead of overwriting another Admin's edit.

Record actor, timestamp, revision, and a redacted change audit with the settings mutation. If audit delivery is queued separately, make it replayable and reconcile ambiguous write outcomes; do not claim atomicity across OpenSearch documents. Failed saves remain visibly unsaved. Reads and connection tests have bounded timeouts; missing settings show an explicit unconfigured state. OpenSearch failure denies authentication rather than bypassing stored access state.

Connection endpoints must be restricted by deployment configuration to approved enclave services. Secret references resolve server-side. An Admin cannot use a connection test to fetch arbitrary URLs. No public model provider, runtime download, or external telemetry is introduced.

## UI and existing behavior

Proposed entry point: **Settings** in the account menu. Use the existing compact visual style, Tabler icons, keyboard-accessible controls, and short validation messages.

| Area | Contents |
| --- | --- |
| Preferences | Timezone selector and Save, available to both roles |
| Command | Ship, unit, command selection, outgoing command, action authority; Admin editing |
| AI | Local endpoint/model configuration and bounded connection test; Admin only |
| Users | Name, Admin/Viewer role, active/disabled state, last login; Admin disable/reactivate and session revocation |

No role switcher or editable SSO identifier appears. Settings form navigation, save/error states, and unsaved-change handling will be shown in the implementation review; additional product controls require agreement.

Load new-draft defaults from shared settings. Preserve existing drafts and preparations. Missing required settings prevents generation with a concise field error; do not use the sender or source originator as a substitute for our command. Draft creation never records a sent acknowledgement.

Apply calendar defaults only when no explicit user selection exists. Preserve URL-selected filters, including intentionally empty selections. Proposed no-match behavior is an empty scoped result with a short notice, rather than silently displaying all commands. The selected identifier must correspond to stored source values; neither ship labels nor approximate text matching establishes ownership.

Resolve display timezone from the user's preference, then the shared UTC default. Apply it to the header clock, calendar, message issue times, lifecycle, and notifications. Use civil-day boundaries for date filters, including 23/25-hour DST days. Stored timestamps, source text, generated USMTF drafts, and retention calculations remain UTC. Do not rewrite source instants when preferences change.

## Migration and custody

Freeze the old writers and take consistent snapshots of both SQLite databases before migration. Import rows into versioned hidden OpenSearch aggregates using stable IDs, verify counts and content hashes, and persist a migration completion marker only after all verification passes. Retain source snapshots and volumes for rollback; do not delete them as part of deployment. Keep migration code separate from runtime persistence.

Migrate private-state ownership to stable local user IDs with idempotent imports. Keep current demo owners as explicitly identified legacy/demo accounts. Never auto-merge an SSO account with a demo account by matching username or email. Any later transfer of private state needs an explicit mapping and audit. Invalidate incompatible demo sessions during the SSO cutover.

Settings and presentation API schemas are separate from the parsed-message ICD. Regenerate protobuf/Connect output from source definitions. Do not hand-edit generated code or extend message documents with authentication state.

## Local UDS/Keycloak test

Read-only inventory on 2026-11-04 found Docker and `kubectl`, no configured Kubernetes context, and no UDS or k3d CLI. Docker reports 18 CPUs and 11.73 GiB RAM; the running OpenSearch container used about 1.8 GiB at inspection. These are observations, not resource guarantees.

The [full UDS local demo](https://docs.defenseunicorns.com/core/v1-13/getting-started/local-demo/overview/) calls for four cores and 10 GiB available RAM. Plan an isolated test environment and check available headroom before installing it alongside Parse Command. The [UDS functional layers](https://docs.defenseunicorns.com/core/v1-13/concepts/platform/functional-layers/) permit Base plus Identity & Authorization; that is the proposed smaller UDS test target, subject to artifact access and a measured budget. Pin compatible versions and confirm host architecture. Do not silently increase Docker resources, replace the current cluster/context, or stop application services to make it fit.

For a UDS deployment, register a confidential client through `Package.spec.sso`, pass the generated secret to Rust, register the exact callback, configure full-path group claims, and set the two permitted groups. UDS documents [native SSO registration](https://docs.defenseunicorns.com/core/v1-13/how-to-guides/identity--authorization/register-and-customize-sso-clients/) and [group restrictions](https://docs.defenseunicorns.com/core/v1-13/how-to-guides/identity--authorization/enforce-group-based-access/). Rust still enforces application roles and private-state ownership.

Provide TLS and a trusted local CA, with one issuer URL reachable consistently by the browser and Rust. The approved local hostnames are `sso.uds.dev` and `parse-command.uds.dev`; the client contract is recorded in `docs/integration/settings-oidc.md`. Production issuer, application hostname, client ID, CA path, and group names remain deployment inputs. Keep credentials and test users outside Git. Prepare artifacts online if necessary, then verify the test runs with internet egress blocked.

The user subsequently explicitly requested **full UDS Core including UDS Registry** locally. This replaces the smaller-layer proposal and the standalone Keycloak alternative. Existing GitHub/registry access can retrieve the required artifacts. Prepare pinned ARM64 packages outside Git, retain all Core components, disable the demo's external identity federation, and measure actual resource use. Full application Zarf packaging stays tracked by #9.

## Implementation sequence

Deliver these work packages as one coordinated change under the user's approval:

1. **Contracts and migrations.** Finalize permissions, settings schema, user/session schema, ownership migration, typed API responses, and deployment configuration. Capture database backups and rollback checks.
2. **Rust authentication and authorization.** Implement OIDC, session management, stable identities, role checks, local disable/revoke, CSRF, proxy/origin handling, and explicit demo/SSO modes.
3. **Settings persistence and APIs.** Provision the OpenSearch settings document, validation, concurrency checks, redacted audit, per-user preferences, and Admin user-management endpoints.
4. **UI and workflow integration.** Add compact Settings/Users views, wire identity and timezone throughout the app, replace acknowledgement placeholders, and apply verified calendar defaults.
5. **Integration and release.** Exercise Admin/Viewer/denied-user journeys against the chosen local Keycloak/UDS environment, test migrations and failures, build the full stack, measure resources, and perform one coordinated deployment preserving existing data.

## Acceptance evidence

- Approved Admin and Viewer can log in; an unapproved account cannot. Missing claims, invalid signatures/audiences/issuers, expired/replayed callbacks, forged headers, and CSRF attempts fail closed.
- Viewer cannot call any Admin API directly. Draft permission matches the approved matrix. Two users cannot read or mutate each other's private drafts or notification read state.
- Username/email changes preserve the correct account; equal emails under different subjects or issuers never merge. Local disable/revoke is effective on the next request. Session expiry and renewal follow the configured IdP policy; verify group-change propagation and deny access when fresh authorization is required but unavailable.
- Cookie/logout, expiry, key rotation, provider outage, restart, and callback errors are tested. No tokens or secrets appear in browser storage, ordinary settings fields, logs, or Git.
- Settings survive restart; conflicting Admin edits produce a conflict response; failed saves are not acknowledged as successful. Empty/missing/invalid settings produce explicit state, not fabricated values.
- New acknowledgement drafts use configured command/authority; existing preparations remain intact. Send time remains pending.
- Each user's timezone survives a new session; UTC is the default. Calendar and issue-date filtering are correct across DST and midnight; source text and retention are unchanged.
- Calendar defaults match explicit stored command values, preserve user filters, and do not silently broaden unmatched selections.
- All current Rust/UI checks plus focused auth/settings/browser tests pass. Validate Compose, regenerate contracts, build with the pinned Linux toolchain, and test against isolated data.
- Record idle and burst resource measurements and verify runtime has no internet dependency. A service health check alone does not establish correct authorization or migration.

## Decisions still needed

1. Deploy the explicitly requested full Core + Registry environment using the available registry access. Core 1.14.3 and Registry 0.52.1 ARM64 artifacts are prepared outside Git; cluster readiness and measured resource use remain acceptance work. Keep the application release on port 8080 intact until coordinated cutover.
2. Provision the selected IdP, client secret, trusted CA and HTTPS routing, then test actual login/refresh/group changes. Verify the IdP's configured session policy; this is not inferred from unit tests.

## Implementation status — 2026-11-05

The Rust/React implementation, hidden-state migration tool, settings schema and OIDC deployment overlay are present. An isolated preview uses copied custody/private state on port 8082. The active application on port 8080 remains on the prior release until the coordinated migration and SSO acceptance run are ready. See [verification evidence](../integration/settings-oidc-verification.md) for completed checks and outstanding release gates.
