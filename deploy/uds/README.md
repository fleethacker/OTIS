# OTIS UDS packaging (issue #9)

The [architecture overview](../../docs/integration/architecture.md) shows UDS
Core on Kubernetes beneath OTIS workloads, the runtime integration points and
the separate local Compose view.

This ARM64 bundle follows current main: OTIS, native Rust OIDC and hidden
OpenSearch state/custody indices. Prior SQLite/Authservice validation is historical.
A fresh isolated native identity/migration/workflow/recovery rehearsal remains
required before merge. See VALIDATION.md for tested revisions and limits.

The deployed application is React/nginx → Rust application server → OpenSearch
3.9.0 with local CPU MiniLM inference. The original Go code is reference source.
Docker Compose remains the supported local demo workflow. The application bundle
assumes an existing compatible UDS platform; it never creates/deletes a cluster,
installs a demo mailbox, or connects to a public model service.

## Pinned first target

| Component | Pin |
| --- | --- |
| Architecture | Linux ARM64 only |
| UDS CLI | 0.38.0 |
| Zarf | 0.86.0, embedded in `uds zarf` (standalone 0.82.0 is not used) |
| UDS Core | 1.14.3, base + identity layers with Keycloak |
| Local platform | Official `k3d-core-slim-dev:1.14.3`, UDS K3d 0.21.0-airgap |
| Kubernetes in that profile | `v1.36.4-k3s1` |
| OpenSearch | 3.9.0, base digest in its existing Dockerfile |
| Model | all-MiniLM-L6-v2 1.0.1, 384 dimensions; archive SHA in `versions.json` |

[`profiles/local-arm64.json`](profiles/local-arm64.json) records the proposed local
profile. Start local validation with 8 CPUs, 16 GiB Docker memory and 50 GiB
free disk. The earlier instance used about 5 GiB with one synthetic message; this is not
a load-capacity claim.
Record peak startup and workload consumption with `docker stats` before choosing
team capacity. The integrated native profile needs a new validation target.

The official slim-dev bundle contains `core-base` and
`core-identity-authorization`: Istio, Pepr/UDS Operator, Keycloak and Authservice,
plus the K3d development support services such as local storage, ingress and
Minio. It omits the full demo's monitoring/logging, runtime-security and backup
layers. Keep the application's SSO, verified IMAP TLS, local semantic/hybrid
search and retained storage. Runtime state now shares the search PVC; old
SQLite custody/private claims remain migration sources. Required backup/recovery tests still apply.
Preflight also supports the standard `core` package at the same pinned release;
partial identity/base installs and mismatched Core package versions are rejected.
Use the pinned tag rather than `latest` so the validation target remains stable.

Node prerequisites: working DNS, a default persistent StorageClass (or an explicit
one), storage permissions via `fsGroup`, sufficient file descriptors and
`vm.max_map_count >= 262144` on the Linux nodes. Set node sysctls through the
platform operator; this chart does not request privileged init containers.

The local **platform** bundle is separate from the application bundle. Its
upstream K3d package deletes a same-named cluster. Inspect it first, use the
unique `CLUSTER_NAME=parse-command-issue9` only on an empty local test environment,
and never redeploy it over retained application volumes. It uses the usual
80/443 ports and `uds.dev` DNS/trust conventions. Refer to the
[official local demo instructions](https://docs.defenseunicorns.com/core/getting-started/local-demo/overview/).

## Connected preparation and build

Required: Docker/BuildKit with Linux ARM64 support, the pinned UDS CLI, Python
3.14+, Helm and Git. Image/model/native downloads occur only during preparation
and image builds. No Python packages are installed in the bootstrap image.

See [ARM64 scan remediation](SCAN-REMEDIATION.md) for the patched runtime images,
dependency lock, measured scan results and remaining upstream findings.

From the repository root:

```sh
python3 -m unittest discover -s deploy/uds/tools/tests -v
python3 deploy/uds/tools/validate.py
python3 deploy/uds/tools/build.py --version 0.1.0-dev.1 --namespace parse-command --prepare-assets
```

The builder verifies the model archive and the existing ARM64 native SHA lock,
builds the actual server/UI/search images and a small Python/model bootstrap
image, pushes them to a dedicated loopback build registry at `127.0.0.1:5119`,
and packages immutable image digest references. The bootstrap image travels
inside the OpenSearch package. Package creation uses `--plain-http` solely for
that loopback build registry. Runtime image pulls use the target Zarf registry.
Nothing is pushed to GitHub or a public image/artifact registry.

Outputs are ignored under `.artifacts/<version>/`: three `.tar.zst` packages, the
application bundle, `artifact-lock.json`, SBOMs in the Zarf packages and
`SHA256SUMS`. The lock records source commit, dirty state, source-tree hash, tool
pins and the four actual image digests. Completed releases are immutable; choose
a new version after source changes. Interrupted builds can retry their version.
The local registry container is named `parse-command-issue9-registry`; stop it
when connected builds are finished. It has no application data. Before a later
build, inspect the stopped container and run
`docker start parse-command-issue9-registry`; the builder deliberately refuses
to reuse an occupied or stopped registry without that explicit restart.

For a team release, build from the signed committed candidate, sign the Zarf
packages/bundle with the team's approved signing process, and distribute the
verification key and checksums through a trusted channel. These development
artifacts are unsigned and contain uncommitted development code. Artifact
publishing/signing identity remains a team decision.

The official platform can be prepared separately on a connected machine:

```sh
uds inspect oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-slim-dev:1.14.3 --architecture arm64
uds pull oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-slim-dev:1.14.3 --architecture arm64 --output /secure/transfer/platform
```

Transfer the platform archive if needed, application release directory and
checksums, offline copies of UDS/kubectl, and deployment inputs to the target.
The application bundle includes its images, charts, model and native libraries;
it does not need the build registry or the source tree to install. Recheck
`SHA256SUMS` after transfer. Keep secrets outside the release directory.

## Native deployment inputs and identity

Copy `uds-config.example.yaml` to ignored `uds-config.yaml` and replace example
values. `shared.NAMESPACE` must match `build.py --namespace`; the pinned Zarf
CLI does not substitute runtime variables in chart namespace metadata. The
other shared inputs remain configurable at deployment. `COMMON` controls domain,
host, confidential client ID, role groups, storage, mail and private issuer
connectivity. `SERVER`, `SEARCH` and `UI` override chart configuration/resources.
Read `charts/*/values.yaml` for the complete defaults.

The current UI uses native Rust OIDC sessions, not Authservice. UDS registers
`https://<host>.<domain>/auth/callback` and the exact web origin. Do not enable
`enableAuthserviceSelector`. Rust handles PKCE, nonce/state, provider verification,
opaque cookies, encrypted tokens, renewal and local logout. Nginx proxies `/auth/`
alongside API/RPC routes using internal Host routing and HTTP/1.1. The native
[identity contract](../../docs/integration/settings-oidc.md) defines the details.

Access requires `/Parse Command/Admin` or `/Parse Command/Viewer` (configurable
role groups). The earlier `/Parse Command/Users` group alone is insufficient.
Align the UDS client group restriction with the Rust role groups. Bearer tokens
and forwarded user/group headers do not substitute for native session cookies.
Write requests require the configured HTTPS Origin.

Provision a dedicated namespace and required server Secrets from protected files:

- Mail Secret: `password` and `ca.crt`, for hostname/CA-verified implicit TLS IMAP.
  Rotate the Secret and restart the server. No remote plaintext, STARTTLS or
  OAuth/XOAUTH2 adapter is provided.
- Session/IdP Secret: exact **32-byte binary** `session-key` and trusted issuer
  CA chain `ca.pem`. Retain and back up this encryption key across upgrades;
  replacing it invalidates encrypted sessions.
- UDS generates the confidential-client Secret (key `secret`) during the config
  package, before starting Rust. The old static `public.pem` Secret is obsolete.

Use Secret names configured in the chart and `kubectl --context <target> -n
<namespace> create secret generic <name> --from-file=...`. Keep source files
mode 0600, outside Git and release archives. Avoid passwords on command lines
or in transcripts. Preflight validates required keys without printing values.

Native OIDC needs private HTTPS access to the configured issuer for discovery,
JWKS and token exchange. Supply working in-cluster DNS/private gateway routing,
trusted CA and narrowly scoped egress. Check the chart's issuer ingress namespace,
selector and port inputs against the target platform. Rust restricts requests to
the issuer origin, rejects redirects and never disables TLS validation.

`PARSE_COMMAND_DEPLOYMENT_PROFILE=uds` requires native `oidc`, verified IMAP TLS
and the explicit `uds_mesh_mtls` search boundary. Compose keeps its separate
local-demo profile. Realm-wide logout remains follow-up work. The retained old
local validation client has optional MFA at the user's request; shared Keycloak
policy and chart defaults were not weakened.

`SERVER.requireStationAssignment` enables the native station-assignment gate;
the example sets it to `true`. Assign the test account to its approved station
before running the synthetic-mail smoke test. Role groups remain independent of
station and responsibility metadata. All of that metadata persists in hidden
OpenSearch state, with no additional application PVC.

`SERVER.intake.sourceRouting` is optional and defaults to `null`. An approved
mailbox-wide policy uses an explicit `policyId` and 1–32 exact `commandIds`.
The validator rejects inferred or malformed policies. A retained intake revision
cannot silently change its routing binding; inspect/migrate existing custody
using [the routing procedure](../../backend/INTAKE.md#source-routing-and-fictional-fixtures).
Source routing never relaxes verified mailbox TLS or the mesh boundary.

## Install and verify a separate target

Configure pinned Core, certificates, storage, DNS, mailbox and identity first.
Never rerun the upstream K3d platform bundle over existing data: its cluster
creation action removes a same-named cluster. The application installer uses an
explicit context and dedicated namespace, without changing current-context.

```sh
python3 deploy/uds/tools/validate.py --config deploy/uds/uds-config.yaml
python3 deploy/uds/tools/verify_artifacts.py --release deploy/uds/.artifacts/<version>
python3 deploy/uds/tools/deploy.py --context <target> \
  --config deploy/uds/uds-config.yaml \
  --bundle deploy/uds/.artifacts/<version>/uds-bundle-parse-command-arm64-<version>.tar.zst
```

Transfer artifacts and verify checksums first. Disable public egress while
retaining DNS, private registry, Keycloak and configured mail connectivity. The
config package establishes strict mesh/network/SSO policy before creating app
pods. Search bootstrap verifies local model assets and real finite 384-vector
inference. Explicit HTTP 429 rejections use bounded same-request retries;
circuit breakers remain enabled. Rust provisions canonical indices/templates.

Required native acceptance gates:

1. Real browser Keycloak login for allowed Admin/Viewer users; rejected anonymous,
   wrong-group and forged identities; same-origin writes, renewal, logout and
   user revocation. `tools/smoke.py --help` describes native session inputs.
2. A uniquely titled constructed OPTASK email through a dedicated TLS SMTP test
   mailbox, then verified IMAP custody/publication and UI raw/detail/audit views.
   Exercise keyword, semantic and hybrid search; health alone is insufficient.
3. Save/reopen private drafts, preferences and notifications; verify a second
   subject cannot read them. Repeat model bootstrap and restart workloads,
   comparing model/source/audit IDs, counts and private ownership.
4. Verify Package readiness, mesh injection and denied direct search access from
   an unrelated workload. Test wrong mail password/CA/hostname, missing secrets
   or model, unavailable issuer/search, and HTTP 503 readiness during failure.
5. Rehearse migration, encrypted backup, restoration to new claims, coordinated
   upgrade and compatible rollback while preserving every original volume.

## State adoption and recovery

Main now persists all runtime data in OpenSearch. Hidden `.parse-command-state-v1`
holds sessions/users/settings/drafts/history/preferences/notifications; hidden
`.parse-command-custody-v1` holds receipts/cursors/durable work. These and public
search indices share the search PVC. Hidden indices are logical separation,
not independent backups or an authorization boundary. STRICT sidecar mTLS,
NetworkPolicies and receiver service-account policy protect search; it has no
public ingress and explicitly disables the native security plugin under that
mesh boundary.

The retained search claim has `helm.sh/resource-policy: keep`. Old SQLite
`parse-command-custody` and `parse-command-private` claims remain migration and
rollback sources. No install action copies, deletes or remaps them. Optional
legacy claim declarations do not mount them into the new runtime.

Stop old writers and take consistent SQLite snapshots including WAL state.
Run `backend/tools/migrate_state.py` without `--apply` first and rehearse against
isolated hidden indices. Trusted prior UDS owners require
`--preserve-oidc-owners`; first verify issuer/subject provenance. Without opt-in,
OIDC-looking owners fail closed; malformed owners always fail. Demo owners retain
`demo:` prefixes. Names/emails never authorize reassignment; migration does not
grant OIDC Admin access.

Import and compare both indices, then require completion markers using
`SERVER.requireStateMigration` before starting adopted workers. Keep old images,
claims, snapshots, configurations and key fingerprints. Recreate upgrades and a
single-worker lease prevent overlap. Returning to SQLite after new native writes
requires reconciliation and coordinated restoration, not just binary rollback.

Back up all OpenSearch state, the session encryption key, configuration and
artifact lock. Use a configured snapshot repository or stop server/search and
copy the full data directory. Encrypt backups and rehearse restoration to new
claims in a separate namespace/client. Schema/index changes can prevent binary
rollback; automatic downgrade is not implemented.

Removal must retain current search and legacy claims. Do not delete namespaces,
clusters, PVCs or storage directories as an uninstall/recovery shortcut.

## Diagnostics and verification

Run `tools/validate.py`, archive-content checks, Python tests/compilation and the
required backend workspace/Clippy/format/type-generation checks. Real OpenSearch
integration tests use isolated test indices, never operational state. The model
check remains available with `tools/verify_bootstrap.py --release <directory>`.

Inspect pod events and bootstrap logs; server diagnostics use bounded categories,
not passwords or source bodies. `/api/health` is liveness and `/api/ready` reflects
publication/model readiness; authenticated source status adds data readiness.
`VALIDATION.md` separates historical live validation from current rebase checks.
Archives, credentials, caches, source traffic and runtime data remain outside Git.
