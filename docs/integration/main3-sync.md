# Watch Desk integration against the supplied main-3 snapshot

The baseline is the user-supplied `Parse-Command-main-3` folder. The combined source
is a separate working copy. The original download and earlier Watch Desk working
copy remain intact. These folders contain source snapshots, not verified Git
history; the exported patch records file hashes instead of claiming an upstream
commit or a completed push.

## What changed

The update carries recurring calendar events, watch context/turnover, station and
department responsibilities, per-account relevance preferences, frozen login
briefings, related-message search, verified IMAP TLS, explicit source routing and
fictional demo fixtures onto the new main architecture. ICD 1.2.0 includes bounded
daily crypto recurrence while preserving source evidence and unresolved times.

The new main remains authoritative for native OIDC, Admin/Viewer roles, shared
settings, per-user IANA timezones, USMTF presentation, encrypted sessions and
activity-triggered renewal. Viewer accounts can save their own unsent drafts.
Station administration does not edit provider roles. Watch context has its own
`/watch-settings` page; the administrator Settings modal retains Preferences,
Command, AI and Users. Shared outgoing command/authority are required for draft
generation. No message is sent by saving or copying a draft.

All runtime persistence uses OpenSearch. Account/station metadata extends native
user records; custody records store routing bindings and immutable availability.
One compare-and-swap record commits each arrival with its sequence, so a login
checkpoint cannot observe an allocated but uncommitted arrival. Login windows
remain frozen across access-token refresh. Search, paging, notifications and
canonical private-state operations enforce assigned scope on the server.

The read-only SQLite importer preserves supported earlier accounts, preferences,
responsibilities, watch context, drafts/history, notifications, custody, routing
and availability. It stops on unknown tables, ambiguous routing, provider owner
mappings or unresolved `local` timezone values. Those cases require a reviewed
mapping before migration; no arbitrary ownership reassignment is performed.
See [the migration procedure](settings-oidc.md#storage-and-migration).

Existing main-3 OpenSearch installations also need a checked unrouted-policy
binding for their retained revisions. `backend/tools/migrate_routing.py` defaults
to read-only inspection, then supports create-only binding after validation with
writers stopped. It rejects nonempty or ambiguous routing. Follow the commands
in [source routing](../../backend/INTAKE.md#source-routing-and-fictional-fixtures);
keep the same retained custody data.

UDS packaging now registers a native confidential OIDC client, mounts its generated
secret and an external encryption-key/CA Secret, and uses OpenSearch for all runtime
state. It retains one search PVC and leaves old SQLite claims for migration and
rollback. Old Authservice token forwarding, public-key mounts, app session TTL
and verified-claim station mapping are not part of this native contract. The input
validator rejects obsolete deployment options so they cannot be silently ignored.

## Local use

Follow [the combined-stack runbook](combined-stack.md) after preparing the bundled
search assets. Open `http://127.0.0.1:8080`; `PARSE_COMMAND_PUBLIC_URL` must match
the exact browser origin. The optional fictional watch setup is explicit:

```sh
docker compose -f docker-compose.yml -f compose.watchdesk-demo.yml up --build -d --wait
```

This enables documented demo defaults; it does not resend mail or reset retained
state. An existing interpretation revision cannot silently change its routing
policy. Preserve original custody and use deliberate migration/replay when needed.
For organizational sign-in use `compose.oidc.yml` or the
[UDS runbook](../../deploy/uds/README.md).

## Apply in the real Git clone

Use the newly generated `parse-command-main3-update.patch`, not the earlier
feature-snapshot patch. It contains the source delta from this supplied main.
Before applying it, use GitHub Desktop or an authenticated terminal on your own
machine to fetch the repository and bring your feature branch up to date with
its intended base. Keep any unrelated local changes safe first.

From a clean real checkout matching the supplied baseline:

```sh
git apply --check /path/to/parse-command-main3-update.patch
git apply /path/to/parse-command-main3-update.patch
git diff --check
git status --short
```

Review and commit the resulting changes on your feature branch, then push using
that machine's GitHub account. If the check reports conflicts because GitHub has
advanced beyond this snapshot, reconcile those changes before applying; do not
force-push, replace repository history or initialize/push the downloaded folder.
The companion manifest identifies every before/after source hash and patch hash.

## Verification

Verified on this combined source (2026-11-05):

- 116 Rust tests passed, including doctests and the normally ignored OpenSearch
  integration tests. Only the two optional external-corpus cases were excluded.
  Workspace Clippy, formatting and generated-type checks passed.
- 159 UI tests across 52 files passed. Protected typecheck, lint, production bundle
  and eight-route generation passed. Go compatibility tests and vet passed.
- 18 migration and 11 deployment Python tests passed; all five JSON schemas and
  six Compose configurations validated.
- Isolated OpenSearch 3.9 exercised state persistence, native session validation,
  station scope, briefing snapshots, notifications, TLS intake and routing.
  Synthetic SQLite import/readback/repeat preserved source file hashes and refused
  a conflicting target. Existing-main3 routing migration was read-only by default,
  preserved its projection and safely accepted an identical repeated apply.
- UDS/Helm rendered 18 objects for fresh storage and 17 for an adopted claim,
  checked native OIDC/secret/network configuration and linted all three packages.

The patch is checked against the exact supplied snapshot, applied to a temporary
copy, and compared by hash and executable mode with every candidate source file.
Bundled Ark files and the source corpus remain unchanged and outside the patch.
The patch manifest records those checks and every before/after file hash.

These checks used temporary synthetic state. The local test OpenSearch runs core
storage without ML/security plugins; it is not a packaged inference or mesh test.
Live IdP/browser SSO, container image/archive builds, UDS admission, disconnected
installation, real SMTP→IMAP→UI acceptance and production-data migration remain
unverified for this candidate. Complete the deployment runbooks' acceptance gates
before treating this source update as an operational deployment.
