# ADR 0002: ARM64 UDS deployment profile

Date: 2026-11-04; updated 2026-11-05 after main PR #15 and OTIS PR #18.
Status: accepted target and native identity/state architecture; integrated
platform acceptance remains in progress under issue #9.

The user approved Linux ARM64, UDS Core Keycloak SSO, configurable deployment
inputs, and the pinned local slim-dev profile. Pins are Core 1.14.3, UDS CLI
0.38.0 / embedded Zarf 0.86.0, UDS K3d 0.21.0-airgap / Kubernetes v1.36.4-k3s1.
Only ARM64 currently has a verified native inference library lock. Namespace
is pinned during bundle build; hostnames, storage, resources, mailbox and
identity inputs remain deployment configuration.

Three application packages contain the Rust server, OTIS React/nginx UI and
OpenSearch 3.9.0 with offline model/bootstrap assets. The retained Go import is
reference source. Compose remains a separate local-demo workflow. The application
bundle never creates a cluster or implicitly installs a demo mailbox.

## Native OIDC replaces the first Authservice design

Main PR #15 introduced native Rust authorization-code OIDC with PKCE, provider
JWT verification, opaque cookies, encrypted provider tokens, renewal and local
logout. UDS registers the confidential client at `/auth/callback` and provides
its client Secret; Authservice is not enabled for the UI. The server receives
the trusted local issuer CA and a persistent exact 32-byte encryption key.
Admin/Viewer IdP groups determine access. Private ownership retains the stable
issuer/subject hash. See the native authentication contract for session,
revocation, role and origin rules. Realm-wide logout remains follow-up work.

`PARSE_COMMAND_DEPLOYMENT_PROFILE=uds` requires native `oidc` authentication,
verified implicit IMAP TLS and the explicit `uds_mesh_mtls` search policy.
Local Compose remains on its own declared authentication profile. The server's
OIDC HTTP client reaches only the configured local issuer origin with trusted
TLS, no redirects, and bounded requests; no public identity service is required.

## State, migration and rollback

Main moved runtime custody and private state into separate hidden OpenSearch
indices. Search documents and these hidden indices share the retained search
PVC in this single-node profile. This supersedes the first profile's physically
separate SQLite custody/private PVCs. Hidden indices are logical separation,
not independent volume backups or authorization boundaries. Old claims and
snapshots are retained as migration/rollback sources and never mounted into
the new runtime or automatically deleted.

Migration reads consistent offline SQLite snapshots. Trusted prior UDS owners
require explicit `--preserve-oidc-owners`; malformed or unapproved OIDC owner
imports fail closed. Demo owners retain the `demo:` namespace. There is no
name/email-based reassignment or automatic live migration. A coordinated
cutover must stop writers, import and verify state, require completion markers,
and rehearse restoration. Returning to SQLite after new writes requires a
reconciliation plan; binary redeployment alone is not a safe state rollback.

## Search and platform boundary

Search uses STRICT sidecar mTLS, least-privilege NetworkPolicies and receiver
AuthorizationPolicies restricted to server/bootstrap service accounts. Its
native security plugin is explicitly disabled under that verified mesh boundary.
Search has no ingress/node port; the hidden state index makes this boundary
especially important. Independent in-process TLS/authentication and HA remain
team decisions. IMAP uses hostname/CA-verified implicit TLS and a referenced
password Secret; OAuth-only mail systems require a separate adapter.

The pre-rebase SQLite/Authservice profile passed local slim-dev workflow and
recovery validation using about 5 GiB of memory with one synthetic message.
Those results do not establish native OIDC/state migration acceptance or load
capacity. The running validated instance is retained while integration proceeds.
At the user's request only its isolated local client has optional MFA; shared
Keycloak defaults are unchanged. See `deploy/uds/VALIDATION.md` for evidence
and the remaining native-profile deployment gate.

Production capacity, storage snapshots/backup repository, retention/HA,
operational artifact signing, realm logout and AMD64 remain team decisions.

References: [native OIDC and hidden-state contract](../integration/settings-oidc.md),
[UDS runbook](../../deploy/uds/README.md),
[pinned slim-dev bundle](https://github.com/defenseunicorns/uds-core/blob/v1.14.3/bundles/k3d-slim-dev/uds-bundle.yaml).
