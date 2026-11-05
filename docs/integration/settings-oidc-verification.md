# Settings and OIDC verification — 2026-11-05

The application implementation is in `codex/settings-oidc-plan`. The release has
not replaced the active application on port 8080. The OIDC preview is available at
`https://parse-command.uds.dev` through the local UDS gateway (also bound to port
8082). It uses copied state in separate hidden indices and cannot retrieve demo
mail. It reads the existing canonical message corpus. Full local UDS Core and
Registry are deployed; final application migration and cutover remain pending.

## Completed checks

- Rust workspace tests and Clippy with warnings denied; pinned Linux container
  test/build. The final focused backend run passed 30 tests, including actual
  OpenSearch integration checks in unique temporary indices.
- 87 UI tests, protected TypeScript/lint/format checks, and the release UI build.
- Real OpenSearch checks cover conditional updates, private owner isolation,
  revocation/disablement, custody replay, subject selection, notification replay,
  pagination, settings revision conflicts and HTTP Origin/role/logout enforcement.
- Signed asymmetric OIDC token tests reject invalid issuer, audience, signature,
  expiry, nonce, authorized party, missing approval group and access-token hash.
  Username changes preserve ownership; a changed subject cannot renew another
  account's session. Wrong browser binding and replayed callbacks fail closed.
- A 200-message synthetic custody burst drained in batches of at most 17 while
  reopening the worker between every batch; all receipts/projections survived,
  and replay did not duplicate an existing receipt. The test completed in about
  eight seconds locally, excluding compilation. It does not measure real mailbox
  delivery, embedding publication or peak memory.
- AuthGate tests cover unavailable authentication and clearing private component
  state after an account change on focus. Provider tokens never enter UI state.
- Base Compose, compatibility overlay and OIDC overlay validate.

## Migration rehearsal

Consistent SQLite backup-API snapshots remain outside Git. Read-only migration
verified every written record and its normalized content; a second identical
import passed without duplication. Completion markers were written last.

| Preserved source | Count |
|---|---:|
| IMAP receipts | 57 |
| Canonical projections | 27 |
| Publication jobs | 1,530 |
| Audit outbox records | 1,032 |
| Custody events | 114 |
| Publication events | 27 |
| Message numeric-identity mappings | 135 |
| Saved preparations / activities | 2 / 2 |
| Legacy messages | 5 |
| Notification groups / members | 4 / 27 |

The normalized import created 185 application-state and 2,795 custody records.
These are aggregate counts, not one-to-one copies of SQL table rows. Expired demo
sessions and ephemeral private cursors/windows were invalidated intentionally.
Live SQLite volumes remain intact; a final frozen snapshot/import is still required
at cutover. The preview has since written its own settings/read-window state, so
it is no longer an untouched import destination.

## Running preview

Browser checks confirmed:

- Viewer can edit Preferences and sees read-only Command settings; Admin also sees
  AI and Users and can save shared settings.
- Saving `America/Chicago` changes the clock and message/lifecycle display times;
  the acknowledgement reference remains Zulu. Saved preferences and command
  defaults persisted through replacement of both preview containers.
- Saving the approved `FLEETHACKER` placeholder as command and authority populates
  both values in the new acknowledgement form.
- Message cards, source-set names, GENTEXT headings and lifecycle history remain
  available. Acknowledgement sent stays Pending.
- Browsing returns 20 then 7 records for the 27-record corpus. Hybrid search
  executes with local MiniLM and RRF; one smoke query took approximately 260 ms.
  Twelve browse requests at concurrency four completed in 137–233 ms each in one
  local run. These are smoke observations, not capacity or relevance guarantees.

Idle samples measured the new Rust preview at about 12–14 MiB, its web container
at 2.5–4 MiB and shared OpenSearch at 1.4–1.5 GiB. It excludes an IdP and is not a peak
memory or production sizing measurement. A replacement-server test exposed the
previous container's unexpired writer lease; startup now waits up to 30 seconds
and still refuses a live competing writer. Provisioning waits for the primary
shard before accepting state operations.

## Local UDS and sign-in

- Full UDS Core 1.14.3 and UDS Registry 0.52.1 run in the dedicated local
  `parse-command-uds` cluster. The native Parse Command SSO client uses its exact
  HTTPS callback, PKCE S256, and the approved Admin/Viewer groups.
- Verified actual Admin and Viewer login, refresh and settings authorization.
  An account outside both approved groups receives HTTP 403. TLS verification
  uses the trusted CA; hostnames resolve to localhost.
- At the user's request, the local Parse Command client now overrides its browser
  flow with `Parse Command Local Password Login`, a copy of the UDS flow with the
  second-factor subflows disabled. Fresh password-only sign-in succeeds for Admin
  and Viewer; Admin user management returns 200 and Viewer access returns 403.
  The copied flow retains required password, group and session-limit checks.
- The realm's default flow still requires OTP. The client's password grant and
  implicit flow remain disabled. This is a local test configuration, not a
  production MFA policy; the approved idle-timeout adjustment is recorded below.
- Reapply the local override after recreating the client using
  `../uds-local/tools/configure-password-login.py`. The rollback metadata and test
  credentials stay outside Git in the private local environment.
- Registry SSO and a small synthetic OCI artifact push succeeded. Registry
  restart/pull persistence and runtime isolation still need acceptance checks.
- The user selected **15 minutes of inactivity**, not a 15-minute active-session
  maximum. Keycloak realm/client idle settings are now 900 seconds, with the
  10-hour maximum and 60-second access tokens retained. The application exposes
  access and session deadlines separately so a one-minute token does not cause
  an early sign-in prompt. Focused UI tests cover idle expiry without background
  refresh and scroll-triggered renewal preserving the current draft.
- Rebuilt and redeployed both HTTPS preview containers after the timeout fix.
  A fresh Viewer login returned approximately 60 seconds of access-token validity
  and 900 seconds until the session deadline. The Rust signed-session integration
  test verifies distinct deadlines using real isolated OpenSearch records.
- Idle application requests wait for activity-triggered token renewal. Tests
  verify that waiting sends no request/refresh, resumes only for the same scope,
  and cancels on expiry, account/role changes or request cancellation. A late
  response from an old page cannot release a new page's requests.
- Browser verification on the final build kept the page idle for 91 seconds:
  Settings stayed visible and notifications remained available after the
  60-second access token expired. Normal navigation then renewed the token and
  loaded Message Search with 27 records. The 900-second end-of-session UI behavior
  was verified with the controlled-clock regression test, not a 15-minute browser
  wait.

## Local settings UI test

At the user's request, the new settings UI is available without SSO at
`http://127.0.0.1:8083`. Compose project `parse-command-settings-local` uses
`../uds-local/compose.preview-local.json`, the existing verified Rust image, and
UI image `parse-command/watch-desk:settings-local`. Port 8080 and the HTTPS OIDC
preview have not been replaced by this test deployment.

The test imports the preserved rehearsal snapshots into separate hidden indices
`.parse-command-ui-local-settings-state` and
`.parse-command-ui-local-settings-custody`; it reads the shared canonical corpus
but has no mailbox password or mail-network connection. Local UI test writes stay
in its own indices. The approved `FLEETHACKER` outgoing command/action authority
defaults were saved in this test instance.

Browser checks passed for the admin-only header gear, compact settings panels,
successful save and persistence after signing in again, close/Escape focus return,
and unsaved edits surviving close/reopen. Viewer has no gear and retains the
account-menu Preferences link. The existing page route remains compatible.

Pre-PR review added a regression for open dialogs during session revalidation.
Portalled dialogs close and hide while authentication is pending, preserve drafts
after the same account is confirmed, and clear private content on an account change.

## Remaining release gates

1. Complete Registry restart/pull persistence and repeatable local-only egress
   verification. Core and Registry are running; the complete deployment remains
   separate from the application Compose volumes.
2. Exercise actual IdP group removal, session expiry, key rotation and outage.
   Follow the configured provider limits; the local realm does not enable
   refresh-token rotation, so do not report it as tested.
3. Verify runtime isolation with the real IdP and a realistic intake/publication
   burst. The current preview intentionally has no mailbox credentials.
4. Stop old writers, take final frozen snapshots, import and verify production
   destination indices, then replace Rust/web together. Preserve new settings,
   preferences and other user writes made in the OIDC preview. Check private
   state, new mailbox receipts, publication and restarts. Retain rollback images,
   source snapshots and old volumes.

Do not close the settings/SSO backlog as deployed until these gates are complete.
