# Parse Command UDS packaging

This development candidate packages the combined Watch Desk application on the
supplied `main-3` baseline: React/nginx → Rust → OpenSearch 3.9.0. It uses native
OIDC and hidden OpenSearch application/custody indices. Docker Compose remains the
local demo workflow. A rendered chart is not cluster or SSO acceptance.

## Pinned target and build

Linux ARM64, UDS CLI 0.38.0 (embedded Zarf 0.86.0), UDS Core 1.14.3 and OpenSearch
3.9.0 are pinned in `versions.json`. The proposed local platform is
`k3d-core-slim-dev:1.14.3`; its profile in `profiles/local-arm64.json` is an
unmeasured validation budget. The application installer never creates a cluster.
The upstream platform bundle can delete a same-named cluster: do not redeploy it
onto retained application data. A compatible standard Core or both Core base
and identity/authorization layers are required.

Connected preparation requires Docker/BuildKit with Linux ARM64 support, Python
3.11+, Helm, the pinned UDS CLI and a Git checkout. From the repository root:

```sh
python3 -m unittest discover -s deploy/uds/tools/tests -v
python3 deploy/uds/tools/validate.py
python3 deploy/uds/tools/build.py --version 0.1.0-main3.1 --prepare-assets
```

The builder prepares checksum-locked model/native assets, builds server, UI,
search and bootstrap images, and packages their immutable digests into three
Zarf packages and one bundle. Its dedicated loopback registry is
`127.0.0.1:5119`; nothing is published to GitHub. Outputs under ignored
`.artifacts/<version>/` include `artifact-lock.json`, checksums and package SBOMs.
Choose a new immutable version after any source change. Sign team releases using
the team's approved process and transfer verification keys separately. The
application bundle contains the model and images; runtime needs no public model
or registry. Transfer UDS/kubectl, configuration and checksums separately.

## Deployment inputs

Copy `uds-config.example.yaml` to ignored `uds-config.yaml`. The JSON example is
valid YAML. Replace its placeholder mailbox host, username and specific unicast
CIDR. `COMMON` selects namespace-wide hostname/client, Admin/Viewer group paths,
storage class and mail/IdP network endpoints. `SERVER.intake` must be the complete
bounded TLS configuration, with `opensearch_url: http://opensearch:9200` and
`custody_index: .parse-command-custody-v1`. Credentials remain outside the bundle.

Create a dedicated application namespace and these existing Secrets from private
files using an explicit Kubernetes context:

- `parse-command-imap`: `password` and `ca.crt` (verified mailbox CA chain).
- `parse-command-session`: `session-key` (exactly 32 random binary bytes) and
  `ca.pem` (trusted IdP/gateway root chain). Preserve this encryption key across
  restarts. Replacing it invalidates encrypted native sessions.

`SERVER.sessionSecret` and `SERVER.imapSecret` can rename those references.
Preflight checks key presence without printing contents. The UDS operator creates
`sso-client-<clientId>` during installation; the server mounts only its `secret`
key as the confidential OIDC client secret. Do not pre-create or package it.
Restart the server after rotating mounted credentials or trust material.

The SSO registration follows the baseline's [native contract](../../docs/integration/settings-oidc.md):
exact `https://<host>.<domain>/auth/callback`, confidential authorization code flow,
PKCE S256, refresh tokens and full-path group claims. There is no Authservice
selector. Nginx proxies `/auth/` and strips forwarded identity and Authorization
headers; Rust validates native opaque session cookies. Configure direct/implicit
grants disabled at the IdP and verify the operator's hardened client settings.
The chart does not override realm/client session lifetimes. User activity controls
renewal; background requests do not keep idle sessions alive. Roles come from the
configured Admin/Viewer groups. Both can save their own unsent drafts.

The chart permits server egress to the configured HTTPS IdP gateway (default UDS
tenant gateway), plus the explicit mailbox CIDR. Adjust the gateway namespace,
selector, HTTPS pod target port and DNS routing for a custom platform. The gateway port is a pod target port for network policy, not the external browser port. Verify the issuer's HTTPS name
resolves to that gateway and that the platform admits the return traffic. Search
has no public ingress; strict mesh mTLS and service-account policy restrict it to
the application server and bootstrap. No unrestricted egress is declared.

`SERVER.requireStationAssignment: true` requires an administrator-assigned station
before source reads. Station/department responsibility settings narrow relevance;
they do not grant additional permissions or clearances. Approved source routing
must use exact command IDs and a versioned policy; mentioned ships do not establish
applicability. A changed routing policy requires a new interpretation revision and
explicit migration/replay. See [intake](../../backend/INTAKE.md).

Old Authservice keys/policies, custom app session TTLs and SQLite mount settings
are rejected by the input validator. They cannot be silently carried into this
native OIDC release. Provider assurance requirements belong in the approved IdP
policy; verified-claim station mapping is not implemented in this integration.

## Install and verify

Provision Core, DNS, trusted gateway certificates, storage and mailbox first.
Nodes need the existing OpenSearch file descriptor and `vm.max_map_count`
prerequisites. This chart requests no privileged init container.

```sh
python3 deploy/uds/tools/validate.py --config deploy/uds/uds-config.yaml
python3 deploy/uds/tools/deploy.py \
  --context <target-context> --config deploy/uds/uds-config.yaml \
  --bundle deploy/uds/.artifacts/<version>/uds-bundle-parse-command-arm64-<version>.tar.zst
```

The helper checks bundle hash, platform pins, namespace isolation and Secret keys,
uses a private temporary kubeconfig, and leaves the user's current context alone.
UDS installs identity/network configuration before search/bootstrap and application
workloads. The bootstrap verifies and registers the bundled model, installs its
search resources and probes real inference. It does not reset existing indices.
Rust owns canonical publication and hidden-state provisioning. Readiness includes
model/publication checks; liveness does not prove a working data adapter.

`tools/smoke.py --help` describes an explicit synthetic SMTP → IMAP → publication
→ authenticated search check. Supply a dedicated test mailbox, reviewed synthetic
body, trusted CAs and a protected Netscape-format cookie file exported from a
native test-account browser session (`--cookie-file`). It uses domain-scoped
cookies and never submits bearer tokens. Sign in again if that test session expires.
The installer never sends mail. A successful smoke script still requires browser
checks: login/renewal/logout, source detail, keyword/semantic/hybrid search,
calendar recurrence, watch context, shift briefings, station narrowing, IANA time
preferences, role changes, revocation and owner-isolated draft save/reopen.

## Migration, recovery and removal

The only new runtime PVC is retained `parse-command-search`; it stores canonical
messages plus hidden application and custody indices. `SEARCH.storage.existingClaim`
adopts an existing search claim. Server replicas remain one and Recreate upgrades
coordinate with the native worker lease. No runtime SQLite volumes are mounted.

For an earlier SQLite release, stop writers, take consistent private/custody
snapshots including WAL state, and use the [verified migration](../../docs/integration/settings-oidc.md#storage-and-migration).
Rehearse in isolated indices before setting `SERVER.requireStateMigration: true`.
Keep old custody/private PVCs, images and snapshots for rollback; this chart does
not delete them. Identity or ownership reassignment requires explicit review.
Unknown source state or ambiguous routing/ownership must not be discarded.

Back up the full OpenSearch indices using a configured snapshot repository; a
stopped volume snapshot is another controlled option. Do not copy live data
directories. Protect the session key and deployment inputs separately. Rehearse
restore into new claims and an isolated namespace/client. Before rollback, stop
new writers and reconcile all changes since cutover. Do not downgrade OpenSearch
against an upgraded data directory. Uninstall retains the search PVC; never
remove a namespace, cluster or volume as an integration workaround.

Required release gates remain: build fresh images/packages, admission on pinned
Core, disconnected installation, actual native SSO/browser and synthetic mail
flow, negative TLS/identity/configuration tests, resource measurement, restart
and upgrade persistence, backup/restore and rollback. See [validation](VALIDATION.md)
for checks performed on this source. No prior image or cluster evidence certifies
this changed candidate.

The native registration and network shapes follow the official
[UDS 1.14 SSO guide](https://docs.defenseunicorns.com/core/v1-14/how-to-guides/identity--authorization/register-and-customize-sso-clients/)
and [package reference](https://docs.defenseunicorns.com/core/v1-14/reference/operator--crds/packages-v1alpha1-cr/).
