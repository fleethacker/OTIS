# Settings, OIDC, and hidden application state

The Rust server implements native OpenID Connect authorization code flow with PKCE
S256 against an enclave-local Keycloak issuer. The browser holds an opaque cookie;
provider tokens are encrypted with XChaCha20-Poly1305 in hidden OpenSearch state.
This document describes the implementation contract. Local IdP deployment and
end-to-end acceptance results are recorded separately; a compile is not an SSO test.

## Access and settings

Only the configured Admin or Viewer IdP groups grant access. Admin takes precedence.
Viewers can search/read, create their own unsent acknowledgement drafts, save their
own timezone, and mark their own notifications read. Admin also edits shared
settings and can disable, enable, or revoke a user's local sessions. Admin has no
implicit access to other users' private drafts. Stable ownership derives from
issuer + subject; email and username are display attributes.

Admins open Settings from the small gear at the right of the header. The compact
modal contains Preferences, Command, AI and Users. Escape or the close button
returns focus to the gear; unsaved edits survive closing and reopening within the
same page session. Viewers retain Preferences in the account menu. Shared values follow
[`settings.schema.json`](../schemas/settings.schema.json). The shared timezone is
UTC; each user may select an IANA zone. Calendar boundaries, issue-date filters,
clock, message presentation, and notifications use that preference. Stored source
instants and generated USMTF drafts remain UTC. Existing drafts are preserved.
Settings version 2 adds the Watch Desk fields `turnoverUtc`, `defaultShips`,
`operationName` and `groupCommand`; stored version 1 documents load with their
defaults. The first `commandIds` entry is the own ship shown in the header and
`shipName` is its display name. With `PARSE_COMMAND_WATCHDESK_DEMO=true`, an empty
store is seeded from the fictional roster in `backend/config/watchdesk-demo.json`.
An absent outgoing command or action authority blocks new draft generation.
Sending remains unavailable and does not create a sent timestamp.

All `/api/v1/settings/{operation}` operations use JSON POST and authenticated
same-origin cookies. Mutations require an exact configured `Origin`.

| Operation | Access | Request / result |
|---|---|---|
| `get` | Both | Shared settings + opaque `revision`; Viewer response omits AI configuration |
| `preferences` | Both | Own `{timezone, deskNetwork}` (`deskNetwork` defaults to `ALL`) |
| `save-preferences` | Both | `{timezone, deskNetwork?}`; omitted network preserves the current value |
| `options` | Admin | Indexed command IDs, approved model endpoints and credential references |
| `update` | Admin | `{settings, revision}`; stale saves return 409 |
| `suggestions` | Both | Operation/exercise names found in published messages, with line citations; dismissed ones omitted |
| `use-suggestion` | Admin | `{suggestion, revision}`; sets `operationName` through the `update` checks; the audit entry records the citations |
| `dismiss-suggestion` | Admin | `{suggestion, revision}`; hides the suggestion for all users |
| `test-ai` | Admin | Test saved connection with bounded `GET /models`; no source content sent |
| `users` | Admin | `{after?}`; up to 50 users with `nextAfter` |
| `update-user` | Admin | `{user, revision, action: enable\|disable\|revoke}` |

`PARSE_COMMAND_AI_ENDPOINTS` is a deployment-controlled comma-separated allowlist
of enclave-local OpenAI-compatible base URLs, normally ending `/v1`.
`PARSE_COMMAND_AI_SECRET_REFS` lists allowed environment variable names beginning
`PARSE_COMMAND_AI_SECRET_`. Resolve credentials on the server; never submit secret
values through Settings. No public provider or default remote endpoint is configured.

The optional [fictional cross-network notice demo](xnet-notices.md) adds the per-user
`deskNetwork` preference (`LOW` / `HIGH` / `ALL`). It is a view filter, not access
control; both roles can change their own selection. It does not change SSO grants.

## Keycloak / UDS client contract

| Setting | Local test value |
|---|---|
| Public application origin | `https://parse-command.uds.dev` |
| Issuer | `https://sso.uds.dev/realms/uds` |
| Client | `parse-command`, confidential, standard code flow enabled |
| Exact redirect URI | `https://parse-command.uds.dev/auth/callback` |
| Web origin | `https://parse-command.uds.dev` |
| PKCE | S256 required |
| Group claim | `groups`, full paths, included in ID tokens |
| Allowed groups | `/Parse Command/Admin`, `/Parse Command/Viewer` |
| Direct access / implicit grants | Disabled |

For UDS packaging, use native `Package.spec.sso` registration and mount its generated
client secret in Rust. Do not enable the Authservice selector for this application:
Rust validates the OIDC flow, session, role and ownership itself. The [UDS packaging](../../deploy/uds/README.md) follows this native-client
contract; its pre-rebase Authservice validation remains historical evidence.

Apply `compose.oidc.yml` only after provisioning the client, trusted HTTPS ingress,
DNS and secret files. `PARSE_COMMAND_SSO_SECRETS` names a private directory outside
Git containing `client-secret`, a random **32-byte binary** `session-key`, and the
IdP root `ca.pem`, readable only by the server UID. Preserve the encryption key
across restarts; replacing it invalidates encrypted sessions. Never disable TLS
validation to connect to a test IdP. Provider discovery, JWKS and token calls must
remain on the configured issuer's HTTPS origin, with redirects disabled.

Routes: `GET /auth/login`, `GET /auth/callback`, `GET /auth/session`,
`POST /auth/refresh`, `POST /auth/logout`. HTTPS cookies are Secure, HttpOnly,
SameSite=Lax, host-only, Path=/; login transactions have one-use state, nonce, PKCE,
and an initiating-browser binding. CSRF checks reject missing/mismatched Origin on
POST. The UI fails closed on authentication errors. Session checks on focus conceal the private view until validation completes; an opaque owner/role scope remounts the application and its cache after an account or role change. OIDC mode disables demo role
selection and automatic demo identity; it never falls back during an IdP outage.

The session response distinguishes `expiresAt` (access-token validity) from
`sessionExpiresAt` (the IdP's refresh/session deadline, or null for no stated
deadline). Access-token expiry prompts renewal on user activity; it does not
by itself replace the page with a sign-in screen. Pointer, keyboard and scroll
activity can renew tokens. An idle tab does not renew in the background and
closes its private view at the IdP session deadline. API requests still reject
expired access tokens and locally disabled or revoked users.

While an idle tab's access token is expired, application requests wait locally
for activity-triggered renewal instead of polling with an invalid token. Waiting
requests retain their account/role scope, honor cancellation and are discarded
on expiry, failed renewal or an account/role change. The queue is bounded at 128;
waiting itself never refreshes a token or extends the session.

Access/ID token validity controls authenticated requests; refresh uses Keycloak's
returned expiry and refresh token rotation. No independent app idle or maximum
session limit is imposed. Only explicit user activity renews sessions; background
polling does not. User enablement and revocation epochs are read in real time on
every request. Group changes are applied with newly validated IdP claims on token
renewal. Local logout deletes the application session. Realm-wide / RP-initiated
logout and back-channel logout are not claimed by this implementation.

The approved local test inactivity limit is **15 minutes**. Keycloak's `uds`
realm SSO idle timeout and the Parse Command client idle override are 900 seconds;
the existing 10-hour maximum and 60-second access-token lifetime are unchanged.
Local setup/reapplication lives outside Git at
`../uds-local/tools/configure-session-timeout.py`.

## Storage and migration

Runtime persistence is entirely OpenSearch:

- `.parse-command-state-v1`: users, settings/audit, encrypted sessions, preferences,
  drafts/history, notifications/read state, bounded search windows and migrations.
- `.parse-command-custody-v1`: raw email receipts, mailbox cursors, parse projections,
  audit/publication outboxes, retries and lifecycle history.

Both indices are hidden, strict, one primary shard, zero replicas for the laptop
profile, and request-durable translogs. Payloads are unindexed; only the small state
envelope is searchable. Hidden indices are not an authorization boundary: prevent
untrusted clients from reaching OpenSearch, and keep its local demo port loopback.
Production transport/access policy must protect both message and state indices.

Realtime GET + optimistic concurrency protects mutations. Receipt persistence must
succeed before cursor advancement. Parse/projection and publication steps are
replayable with stable IDs; failed or ambiguous delivery stays pending. A single
server lease prevents overlapping workers; it is renewed every five seconds with
a 30-second expiry and fails closed on loss. After an abrupt stop a replacement
waits for up to 30 seconds for that lease to expire, then refuses to start if a live peer still holds it. Ephemeral records expire in bounded batches.
Custody/history are not silently purged. Capacity uses retained serialized bytes
and receipt count; disk/translog headroom must be monitored separately. The existing
365-day message retention policy does not apply to application state.

Migration tool: `backend/tools/migrate_state.py`. It opens SQLite **read-only** as a
snapshot import source; neither Rust runtime crate depends on SQLite.

1. Build/test the replacement before stopping writers.
2. Stop the old server; retain its image and volumes. Use SQLite's backup API for
   each live database, including WAL state, to external private snapshot files.
3. Run the migration without `--apply` to inspect counts. Rehearse against isolated
   hidden indices. Never use live mutable SQLite files with `immutable=1`.
4. Run with `--apply` for the destination indices. Creates are idempotent and existing
   documents must match exactly. Each batch is read back and compared. Snapshot and
   normalized-content hashes are recorded; completion markers are written last.
5. Set `PARSE_COMMAND_REQUIRE_STATE_MIGRATION=true` for an adopted deployment and
   start the coordinated release. This prevents workers starting with an incomplete
   import. Verify counts, cursor, drafts, histories, search and intake after restart.
6. Keep both source snapshots and old named volumes. Rollback requires stopping the
   new writers first; reconcile messages received since cutover before returning to
   the older snapshot. Do not delete volumes or change shared Git history.

Example (paths are local snapshot files, not production defaults):

```sh
python3 backend/tools/migrate_state.py \
  --private /secure/snapshot/private.sqlite \
  --custody /secure/snapshot/custody.sqlite \
  --state-index .parse-command-state-v1 \
  --custody-index .parse-command-custody-v1 --apply
```

Existing demo owners migrate to `demo:<previous-owner>`. For reviewed snapshots
from the previous UDS implementation, pass `--preserve-oidc-owners` to retain
canonical `oidc:<64 lowercase hex>` owners, whose issuer/subject hash matches
the native OIDC implementation. Without that explicit opt-in, OIDC-looking
owners fail migration rather than becoming unreachable demo owners. Malformed
OIDC owners always fail. The source issuer, subject provenance and group policy
must be verified first; display names/emails never authorize reassignment.
Migrated OIDC rows grant no Admin role; native login validates current IdP
claims before establishing access.

SSO owners are distinct;
there is no automatic transfer based on matching names/emails. Demo sessions and
short-lived search cursors are invalidated; drafts, preparations, orphan records,
notifications/read state, raw hashes and lifecycle history are preserved.

## Browser calendar preferences

Calendar display preferences are stored in IndexedDB on the current browser,
keyed by the server-verified user/role scope. They include Day/Week/Month, ship
selection, layout, interval, separate Day/Week zoom, and the Ships and Since last
watch panel states. Panels start closed without a saved choice.
Selecting ship Defaults resumes the shared setting instead of storing its current
resolved value. Message content, authentication tokens, dates, and search text are
not stored in this preference database.

Opening Calendar starts on today with an empty search. Explicit URL parameters
take precedence over saved preferences, preserving message return links and
shared calendar links. Preferences load before calendar data requests; unavailable
browser storage falls back to in-memory defaults for that visit. Server-side
preferences, settings, and operational state remain in OpenSearch.

## Checks

```sh
cargo test --workspace --manifest-path backend/Cargo.toml
cargo clippy --workspace --all-targets --manifest-path backend/Cargo.toml -- -D warnings
PARSE_COMMAND_TEST_OPENSEARCH_URL=http://127.0.0.1:9200 \
  cargo test -p parse-command-intake -p parse-command-server --tests \
  --manifest-path backend/Cargo.toml -- --include-ignored
```

Integration tests create/delete only uniquely named `.parse-command-test-*`
indices; they exercise actual OpenSearch, including realtime CAS, custody replay,
private ownership, revocation, preferences, notification replay and pagination.
Do not treat the default test suite's explicitly ignored integration tests as run.

Local verification and remaining release gates: [settings-oidc-verification.md](settings-oidc-verification.md).
