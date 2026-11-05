# Watch planning integration

The watch-planning contribution originally arrived as a `main-3` source snapshot.
It is now integrated with current main's native OIDC, hidden OpenSearch state,
ICD 1.3.0, CASREP support and UDS deployment safeguards. This document describes
that source integration; historical snapshot checks do not certify this merge.

## Watch and message workflow

Station assignments and department responsibilities define explicit command and
message-category scope. Per-account relevance preferences can narrow it. The
server applies that scope to search, paging, details, evidence, notifications,
related messages and canonical private-state operations. Names and contact fields
do not infer access. Native IdP groups remain authoritative for Admin/Viewer roles;
station administration cannot change them.

Watch context has its own `/watch-settings` page. The administrator Settings modal
retains Preferences, Command, AI and Users. Shared outgoing command and authority
must be configured before generating an acknowledgement draft. Drafts remain
private and unsent.

Login briefings page a frozen availability window. Each arrival and its sequence
commit together in a bounded compare-and-swap custody ledger, preventing a login
checkpoint from observing an allocated but uncommitted arrival. Source issue time
and arrival time remain separate. Access-token refresh does not advance the login
window. Related-message search uses the exact authorized source key; the client
cannot substitute arbitrary source content.

Daily crypto recurrence expands only within requested calendar bounds, with a
link back to the source fact. Source evidence and unresolved times remain intact.
See [the application API](rust-application-api.md#watch-station-and-briefing-apis)
for the route contracts.

## Deployment and retained state

All runtime persistence uses OpenSearch. Native user records hold station/account
metadata; application state holds responsibilities and watch context; custody holds
routing bindings and immutable availability. Existing main architecture and
security controls remain authoritative.

`PARSE_COMMAND_REQUIRE_STATION_ASSIGNMENT=true` requires an assigned station before
scoped reads. Local Compose defaults to `false`; the UDS example enables it. The
UDS profile retains native confidential-client registration, a separately retained
session-key/CA Secret, verified IMAP TLS, strict mesh policy, configurable hidden
state/custody indices, artifact verification and migration safeguards. No additional
runtime database or application PVC is introduced.

Source routing is opt-in: `intake.sourceRouting` contains an approved `policyId`
and exact `commandIds`, or is `null`. Existing revisions cannot silently change
routing. Use `backend/tools/migrate_routing.py` for read-only inspection, then
create-only binding after validation with writers stopped. Follow
[the intake procedure](../../backend/INTAKE.md#source-routing-and-fictional-fixtures)
and preserve retained custody.

The read-only SQLite importer preserves supported earlier accounts, preferences,
responsibilities, watch context, private drafts/history, notifications and custody
routing/availability. Unknown tables, ambiguous routing or owner mappings and
unresolved `local` timezone values stop import for review. Follow
[the migration procedure](settings-oidc.md#storage-and-migration).

## Explicit fictional demo

Prepare assets and provision the model on a fresh volume using the
[combined-stack runbook](combined-stack.md) before starting the application.
The optional fictional watch setup is explicit:

```sh
docker compose -f docker-compose.yml -f compose.watchdesk-demo.yml config --quiet
docker compose -f docker-compose.yml -f compose.watchdesk-demo.yml \
  up --build -d --wait --wait-timeout 180 server web
```

`PARSE_COMMAND_PUBLIC_URL` must match the exact browser origin, including a changed
port. Demo opt-in enables the fictional roster and exact-hash fixture assignment;
it does not submit mail, reparse retained messages or reset state. Organizational
sign-in uses `compose.oidc.yml` or [the UDS runbook](../../deploy/uds/README.md).

## Verification boundary

Run the backend, application, schema, migration, Compose and deployment checks
specified by their runbooks after integration. Validate OpenSearch behavior with
isolated test indices. Container builds, live Keycloak/browser SSO, UDS admission,
disconnected installation, actual SMTP-to-IMAP-to-UI flow, resource measurement
and backup/upgrade/rollback remain separate deployment acceptance gates. No live
container, mailbox or volume is changed by this branch update.
