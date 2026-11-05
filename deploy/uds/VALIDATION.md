# Native OIDC / main-3 candidate validation

This packaging source is adapted to the supplied `main-3` snapshot and the carried
Watch Desk features. Older issue #9 image/archive results belong to earlier
source and are not acceptance evidence for this candidate.

The input/unit suite checks platform versions, verified mailbox TLS, explicit
routing, native role/group inputs, rejection of obsolete Authservice/SQLite
settings, required secret keys and authenticated smoke preconditions. Helm/UDS
rendering checks the native callback, PKCE client, encrypted-session mounts,
hidden-state configuration, stripped identity headers, strict mesh policy,
nonroot workloads and retained search storage, plus three Zarf definitions.

The final integration results and limitations are recorded in
[main-3 integration](../../docs/integration/main3-sync.md). Container image builds,
live Keycloak/UDS admission, disconnected installation, real SMTP→IMAP→UI flow and
backup/upgrade/rollback gates remain separate required deployment acceptance.
