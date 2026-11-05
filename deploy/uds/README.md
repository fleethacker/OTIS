# Parse Command UDS packaging (issue #9)

This is an ARM64 implementation in development. Three real Zarf packages and a
UDS bundle can be built; cluster admission, SSO/browser, disconnected install
and recovery acceptance still require the validation gates below. Do not treat
a successful build or HTTP health check as deployment acceptance.

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
| UDS Core | 1.14.3, upstream standard profile with Keycloak/Authservice |
| Local platform | Official `k3d-core-demo:1.14.3`, UDS K3d 0.21.0-airgap |
| Kubernetes in that profile | `v1.36.4-k3s1` |
| OpenSearch | 3.9.0, base digest in its existing Dockerfile |
| Model | all-MiniLM-L6-v2 1.0.1, 384 dimensions; archive SHA in `versions.json` |

[`profiles/local-arm64.json`](profiles/local-arm64.json) records the proposed local
profile. Budget 8 CPUs, 24 GiB Docker memory and 50 GiB free disk for the full
platform plus application; measure actual usage before setting team capacity.
The current host Docker engine has about 16 GiB, and no Kubernetes context was
configured during implementation. A full platform installation is not validated.
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
3.11+, Helm and Git. Image/model/native downloads occur only during preparation
and image builds. No Python packages are installed in the bootstrap image.

From the repository root:

```sh
python3 deploy/uds/tools/validate.py
python3 deploy/uds/tools/build.py --version 0.1.0-dev.1 --prepare-assets
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
uds inspect oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-demo:1.14.3 --architecture arm64
uds pull oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-demo:1.14.3 --architecture arm64 --output /secure/transfer/platform
```

Transfer the platform archive if needed, application release directory and
checksums, offline copies of UDS/kubectl, and deployment inputs to the target.
The application bundle includes its images, charts, model and native libraries;
it does not need the build registry or the source tree to install. Recheck
`SHA256SUMS` after transfer. Keep secrets outside the release directory.

## Deployment inputs and identity

Copy `uds-config.example.yaml` to ignored `uds-config.yaml`, then replace the
example values. The example is JSON, which is valid YAML. `shared.NAMESPACE`
selects one namespace consistently across all three packages; `shared.COMMON`
sets domain, UI subdomain, SSO client ID, storage class and mailbox egress.
`SEARCH`, `SERVER` and `UI` override each chart's `config` object, including
resource requests/limits, PVC sizes/existing claims and secret references. Read
`charts/*/values.yaml` for the complete defaults. Use a separate namespace/client
ID for a separate instance. The internal Services remain `web`, `server` and
`opensearch`; external search endpoints are deliberately unsupported by this
profile.

Create a dedicated application namespace and two existing Secrets before installation.
The helper refuses platform namespaces or a namespace with unrelated pods:

- `parse-command-imap`: `password` and `ca.crt`, containing the mailbox login
  password and its PEM CA chain. The password is read from the Secret-backed
  environment variable each poll; rotate by updating the Secret and restarting
  the server. The CA is mounted read-only. The configured host must match its
  certificate; implicit IMAP TLS (normally port 993) is required. STARTTLS,
  plaintext remote IMAP and OAuth/XOAUTH2 are not implemented. Validate that the
  selected real mail service permits password-based IMAP over TLS.
- `parse-command-oidc-verification`: `public.pem`, the active Keycloak realm
  **RS256 RSA public verification key**, obtained over trusted TLS from the
  selected cluster's realm. Do not place a signing private key here. For example,
  get `public_key` from `https://sso.<domain>/realms/uds`, wrap its base64 body as
  `-----BEGIN PUBLIC KEY-----` / `-----END PUBLIC KEY-----`, and verify the
  fingerprint with the platform owner before creating the Secret.

Use `kubectl --context <target> -n <namespace> create secret generic <name>
--from-file=...` with protected local files. Avoid passwords on command lines,
checked-in Secret manifests and command-output transcripts. Give files mode
0600. Never include these Secrets in a Zarf package at create time.

UDS registers the client and protects UI pods with Authservice. Grant users the
`/Parse Command/Users` or `/Parse Command/Admin` group, or configure approved
`common.allowedGroups`. A group mapper includes memberships in the ID token.
Rust independently checks RS256 signature, issuer, audience, expiry and optional
not-before. It derives private ownership from issuer + subject, and derives the
administrator role from `SERVER.adminGroup`. Spoofed forwarded-user headers and
local-demo cookies are insufficient. Mock role-picker/login/logout endpoints
are disabled in UDS mode. Platform SSO logout UX remains a validation/follow-up
item; do not present the local mock logout as a Keycloak session logout.

Key rotation is explicit: replace `public.pem`, restart the server and re-run
SSO checks. One active verification key is supported; a rolling multi-key JWKS
rotation policy is follow-up work. No public JWKS or cloud identity endpoint is
queried at runtime. See [ADR 0002](../../docs/decisions/0002-uds-arm64-deployment.md)
for the search TLS/identity boundary and team decisions.

## Install on the selected compatible cluster

The platform owner must first install/configure UDS Core, gateway certificates,
DNS and storage. Create the namespace and Secrets using that target context.
Supply an explicit mailbox CIDR; no unrestricted egress rule is provided. Keep
`COMMON.imapHost/imapPort` identical to `SERVER.intake.host/port`. The complete
bounded intake configuration is required; it is never synthesized from a demo
mailbox at deployment time.

From an offline copy of this repository's deployment tooling:

```sh
python3 deploy/uds/tools/validate.py --config deploy/uds/uds-config.yaml
python3 deploy/uds/tools/deploy.py \
  --context <target-context> \
  --config deploy/uds/uds-config.yaml \
  --bundle deploy/uds/.artifacts/<version>/uds-bundle-parse-command-arm64-<version>.tar.zst
```

The helper checks the transferred bundle hash, ARM64 nodes, Core, namespace and
Secret-key presence. It uses a private temporary kubeconfig and does not switch
the user's global context. It installs UDS identity/network configuration first, waits for namespace
sidecar injection, then installs OpenSearch/bootstrap, server and UI. Without this helper the equivalent operation is `UDS_CONFIG=/absolute/path/
uds-config.yaml uds deploy <bundle> --confirm --architecture arm64`; retain the
same preflight checks when doing so.

The search bootstrap verifies the model archive, reuses exactly one matching
model registration, resumes chunk upload, deploys locally, checks mapping/model
metadata, installs templates/pipelines and runs real inference with a finite
384-vector check. Hook failures fail installation. It reruns on package upgrade;
it never resets indices or downloads a model URL. It probes actual inference
and requests a bounded redeploy/warmup when persisted deployed metadata outlives
the process-local model cache. The Rust readiness check also uses real inference. The Rust publisher owns the
canonical messages/audit indices and v2 query templates. Neither package relies
on issue #6's optional indices or a manually run old Python loader. Current
index names and the local no-retention profile are preserved; retention/HA and
index-generation migrations are not implemented by this change.

## Verify the real workflow

Use a dedicated synthetic test mailbox and operator-approved test identity.
`tools/smoke.py --help` documents explicit SMTP/TLS sender, token-file and CA
inputs. The installer never sends mail. Supply a small synthetic OPTASK body
with a GENTEXT narrative. The tool sends one uniquely titled email through SMTP,
waits for IMAP intake/publication and a real authenticated application read,
and checks model/publication status. It does not inject directly into SQLite
or OpenSearch.

Browser gate: open `https://<host>.<domain>`, follow the Keycloak sign-in, locate
the printed synthetic subject, inspect its source/evidence, exercise
keyword/semantic/hybrid search for its narrative, then save/reopen a private
draft/preparation. Confirm another subject cannot read that state. Health and
smoke-script success do not replace this browser gate.

Required cluster acceptance:

1. Transfer to a clean compatible cluster and disable public egress before
   application install. Keep cluster DNS, private registry, platform identity and
   the configured mailbox reachable. Install solely from transferred archives;
   verify no external image/model fetch and no fixture data in the application.
2. Repeat the search package deployment twice, then restart search and the
   server. Confirm one matching model, stable document IDs/counts, restored
   inference and no duplicate publication. Check `/api/ready` returns 503 when
   model/publication are unavailable; `/api/health` is process liveness only.
3. Verify ingress TLS, Keycloak callback and audience, denied anonymous/forged
   identities, allowed groups and private-user isolation. Verify direct search
   access from an unrelated namespace/service account is denied. Inspect UDS
   Package readiness, NetworkPolicies, PeerAuthentication and AuthorizationPolicy.
4. Try a wrong mailbox password, untrusted CA, wrong hostname, unavailable search,
   absent/incorrect model and absent Secret. Confirm visible deployment failure
   or bounded retry diagnostics, without credentials/source text in routine logs.
5. Save receipts, audit/publication counts, source IDs, a draft and preparation;
   restart workloads and upgrade with the same PVCs, then compare. Execute the
   backup/restore and rollback rehearsal below before accepting team deployment.

## Upgrade, recovery and removal

Three independent PVCs are retained with `helm.sh/resource-policy: keep`:
`parse-command-custody`, `parse-command-private`, `parse-command-search`. Override
`existingClaim` to adopt an existing claim. Use different claims for each store;
never run two writers against either SQLite journal. New claims keep databases
under `data/custody.sqlite` and `data/ui.sqlite` so the nonroot process owns its
private 0700 directory beneath the group-writable PVC mount. An adopted claim
must have that layout and correct ownership before use; Compose root-level
database files require a controlled offline migration. The server uses Recreate
upgrades and one replica. Search is a single-node StatefulSet. Storage sizes may
only expand when the StorageClass supports it; changing class/claim requires a
planned migration, not a release override on a live dataset.

Before upgrading, stop new mail delivery to the test account, drain/record
publication, scale the server to zero and take consistent custody/private-volume
snapshots or offline copies including any WAL files. Capture OpenSearch using a
configured snapshot repository, or stop search and snapshot its entire volume.
Encrypt backups and retain the deployment config, key fingerprints and artifact
lock with them. Do not copy live SQLite database files without their WAL, or
live OpenSearch data directories. Rehearse restoration to **new** claims and a
separate namespace/client ID before relying on the backup.

Deploy the next version with the same namespace/config/PVCs. Re-run all adapter
and private-state gates. For compatible application-only rollbacks, redeploy
the prior transferred bundle using the same config. Database/index migrations
may prevent binary rollback; if compatibility is unknown, stop writers and
restore the pre-upgrade snapshots into new claims with the matching prior
bundle. Do not downgrade OpenSearch against an upgraded data directory. This
change adds no automatic downgrade or destructive index migration.

Legacy Go state is never automatically mounted, copied, seeded or overwritten.
Keep the original volume read-only and backed up. Use the existing
`parse-command-server migrate-private <read-only-source>/app.db
<private-target>/ui.sqlite` command in a controlled one-shot workload, with the
server stopped. Review its migration counts and refuse conflicting targets.
Legacy demo owners do not automatically become SSO subjects: the team must
approve any ownership reassignment before adopting shared private state.

Removal stops/removes application Helm/Zarf resources while retaining the three
PVCs. Record exact claim/PV identities first. Do not delete the namespace, PVCs,
PV storage or local K3d cluster as an uninstall shortcut. Reinstall with explicit
`existingClaim` values to reuse retained data. Deleting retained data is a
separate operator action outside this runbook.

An additional isolated model check is available after building:

```sh
python3 deploy/uds/tools/verify_bootstrap.py --release deploy/uds/.artifacts/<version>
```

It creates a new internal Docker network with no published ports, runs the
packaged bootstrap twice and after a search restart, and checks stable model ID
and real inference. It removes only its own test containers/network and retains
its newly created test volume. This checks offline bootstrap behavior, not UDS
mesh/admission or mail/UI behavior.

## Diagnostics and development verification

Inspect `kubectl --context <target> -n <namespace> get pods,pvc,package`, then
`describe pod` for scheduling, Secret mounts, storage and admission errors.
Inspect bootstrap Job events/logs for model hash/mapping conflicts and inference
failures; successful hook Jobs are removed. Server logs emit static intake
categories (including TLS handshake failure) and retry notices. Authenticated
`GET /api/v1/source/status` reports publication and embedding status. `/api/ready`
is model + publication readiness, not proof that an IMAP credential is valid.
Check receipts via the existing intake CLI for mailbox/parser diagnoses. Avoid
printing stored messages or Kubernetes Secret data into shared logs.

Run `tools/validate.py`, Python compilation, package creation, bundle inspection,
and the required backend workspace tests/Clippy/format/type-generation checks.
`tools/check.Dockerfile` prepares the pinned temporary Rust test toolchain when
there is no host Rust installation. TLS tests create ephemeral test certificates
with OpenSSL; no signing key is committed. The OIDC fixture contains only a
public key and pre-signed synthetic tokens. See `VALIDATION.md` for actual evidence
and remaining gates.
