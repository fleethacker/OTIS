# ADR 0002: First UDS deployment profile

Date: 2026-11-04. Status: accepted target and identity direction; implementation
and platform acceptance are in progress under issue #9.

The user approved Linux ARM64 with a pinned local UDS profile, UDS Core Keycloak
SSO, and deployment-time hostnames, storage and mailbox inputs. The first target
is UDS Core 1.14.3, UDS CLI 0.38.0 / embedded Zarf 0.86.0 and the matching official
local ARM64 K3d slim-dev profile. The embedded Zarf version supersedes the
initially suggested standalone 0.82.0 after checking the installed CLI and release bundle.
Only ARM64 has a validated native inference dependency lock.

Three application packages contain OpenSearch/bootstrap, the Rust server, and
the React/static proxy UI. The Go source retained in ADR 0001 is reference code
after the team's approved Rust application integration on main. Compose remains
a separate local-demo workflow. No demo mail system is an implicit prerequisite
of the UDS application bundle.

UDS Authservice handles interactive SSO; Rust independently verifies the ID
token using an explicitly provisioned active RS256 public key, exact issuer and
client audience. No mock-role session fallback exists in this mode. Private
ownership uses an issuer-scoped subject, preventing mutable names/email from
reassigning drafts. A later decision must address multi-key/JWKS rotation, SSO
logout behavior and any approved migration of legacy demo-owned private data.

The **proposed search security policy for this first profile** is UDS sidecar
mutual TLS, STRICT PeerAuthentication, least-privilege NetworkPolicies and
receiver AuthorizationPolicies allowing only server/bootstrap service accounts.
OpenSearch's native security plugin is explicitly disabled under that boundary;
search has no ingress or public/node port. The Rust UDS mode requires the named
`uds_mesh_mtls` policy input. This depends on verified mesh injection and policy
admission: it is not suitable for an unmeshed cluster. Runtime acceptance must
prove denial from unrelated workloads before this profile is approved for shared
use. Native OpenSearch TLS/authentication is a future alternative if the team
requires independent in-process protection, broader clients or another topology.

IMAP uses certificate/hostname-verified implicit TLS and a referenced password
Secret; the unchanged plaintext transport is limited to explicit Compose demo
hosts. Password-based IMAP is a capability limit, not a claim of compatibility
with every Exchange deployment. OAuth-only mail systems need a separate adapter.

Custody, private state and search each retain independent PVCs. SQLite uses one
writer and Recreate upgrades; OpenSearch starts as one node. HA, production
resource sizing, retention, artifact registry/signing identity, backup repository,
SSO key rotation/logout, and a future AMD64 native lock remain team decisions.
The implementation runbook lists upgrade, recovery and acceptance gates; none is
established merely by successful package creation.

On 2026-11-05 the user selected `k3d-core-slim-dev` for local validation. Pin
version 1.14.3, whose published ARM64 bundle includes both `core-base` and
`core-identity-authorization`. The earlier full demo/24 GiB planning budget is
replaced by an unmeasured slim-dev target of 16 GiB. A cluster deployment and
resource measurements remain required before any capacity claim. Preflight
accepts both pinned layers or a pinned standard Core install, and rejects
missing identity or mismatched Core versions. SSO, TLS, search and data retention
remain part of the application profile.

Primary references: [UDS Authservice integration](https://github.com/defenseunicorns/uds-core/blob/v1.14.3/docs/how-to-guides/identity-and-authorization/protect-apps-with-authservice.mdx),
[matching platform bundle](https://github.com/defenseunicorns/uds-core/blob/v1.14.3/bundles/k3d-slim-dev/uds-bundle.yaml),
[package requirements](https://docs.defenseunicorns.com/core/v1-16/concepts/configuration--packaging/package-requirements/).
