# Issue #9 validation evidence

## Rebase onto current main and OTIS (2026-11-05)

The signed, validated SQLite/Authservice checkpoint is commit `f551c8d`, pushed
before rebasing and retained on `codex/issue-9-validated-before-rebase-20261105`.
The branch integrates main `f1a91be`, including OTIS PR #18, README refresh
PR #19 and maritime UI theme PR #21. Main PR #15
replaced runtime SQLite with hidden OpenSearch state/custody indices and adopted
native Rust OIDC sessions. Current charts follow that contract: `/auth/callback`,
Admin/Viewer roles, generated confidential-client Secret and a retained session
encryption key. Authservice and static-public-key verification are superseded.

The running validated cluster and its volumes have not been upgraded or migrated
by this rebase. The complete live results below are **historical evidence for
the pre-rebase architecture**, not acceptance of the integrated native OIDC
release. A fresh isolated native OIDC, migration, intake/search and recovery
validation remains required before merging the updated deployment profile.
Current rebase checks passed: 58 Rust tests (including four new native-router/UDS
policy regressions), Clippy, rustfmt and generated-type validation; 104 UI tests,
TypeScript/lint/format diagnostics and an actual OTIS runtime image smoke test
with no network/ports and a read-only root. Fifteen deployment tests and three
migration-owner tests passed. Default/legacy/adopted chart variants render
18/20/17 objects and all three Zarf definitions lint. Both Compose configurations
and the native OIDC overlay render correctly. Canonical Ark jobs remain blocked
by the installed CLI rejecting the existing protected export pipeline assets;
protected framework/pipeline files were unchanged. The final UI image and checks were rerun after PR #21; backend/deployment
content was verified unchanged across that UI-only rebase. Go diagnostics were
not rerun because no Go source changed. OpenSearch-dependent tests remain separately
reported rather than counted among the default unignored suite.


## Local UDS validation — 2026-11-05

The isolated `parse-command-issue9` K3d cluster was created from the official
ARM64 `k3d-core-slim-dev:1.14.3` archive. Tested tooling was UDS CLI 0.38.0,
embedded Zarf 0.86.0, Core base + identity/authorization 1.14.3, UDS K3d
0.21.0-airgap and Kubernetes v1.36.4-k3s1. The Docker engine provides 18 CPUs
and 15.66 GiB memory. The user's global Kubernetes context was not changed.

Application candidate `0.1.0-localvalidation.9` contains the fixes described
below, based on signed commit `81316ba` plus its recorded working-tree snapshot.
Its ignored `artifact-lock.json` records the complete source hash and immutable
image digests. Later documentation changes do not change those tested images.
The preceding `.6` images were repackaged as `0.1.0-localvalidation.7` for a
compatible package-version upgrade/rollback, and `0.1.0-localrestoration.1` for
restoration in a separate namespace. The final candidate adds the independent
allowed-group enforcement discovered in the final negative test. These are development artifacts, not signed releases.

Observed passing checks:

- The actual three Zarf packages and combined bundle install successfully. UDS
  Package admission reports Ready; server, UI and search each run with a ready
  Istio sidecar. The model hook terminates successfully with a native sidecar.
- Trusted HTTPS ingress reaches the UI. Browser sign-in follows real Keycloak
  authorization-code SSO. Rust returns an issuer-scoped `oidc:` subject for both
  REST and generated RPC requests. At the user's request, **only the isolated
  local application client** uses a copied UDS browser flow with optional OTP;
  realm defaults and repository deployment policy retain the standard MFA flow.
- One constructed synthetic OPTASK email was sent through a dedicated TLS SMTP
  fixture and read through verified TLS IMAP. Custody, publication, browser
  detail/raw-source/audit views and browser hybrid search all worked. The
  keyword, semantic and hybrid API modes each returned the synthetic source.
- Alice saved and reopened a private draft and preparation through the browser.
  Two real Keycloak subjects independently saved/read their own private state;
  neither could read or replace the other's draft/preparation.
- The node's IPv4 and IPv6 OUTPUT/FORWARD rules rejected public destinations,
  while retaining loopback/private platform and mailbox connectivity. A public
  HTTP connection was rejected and firewall counters increased. With the host
  build registry stopped, transferred bundles redeployed using the private Zarf
  registry. No public image/model dependency was available to the node/pods.
  The host remained connected for administration and artifact preparation;
  this is application deployment/runtime isolation, not whole-host isolation.
- Repeated model initialization and a stopped/restarted OpenSearch process
  preserved one model metadata record and the same model ID. Real finite
  384-vector inference recovered. Counts stayed at one canonical source, one
  search passage and eight audit records, with unchanged audit IDs. Both users'
  private state and the original three claim UIDs remained unchanged.
- With search stopped, Rust liveness stayed HTTP 200 and readiness became HTTP
  503 after its bounded publication polling interval. The UI showed a load
  failure and recovered after search/model recovery. An unrelated service
  account could not read OpenSearch while the application could.
- A wrong IMAP password produced `intake_error: imap_command retry_pending`;
  an unrelated CA produced `intake_error: imap_tls_handshake retry_pending`.
  Correct credentials/CA were restored. A packaged bootstrap with its model
  asset directory masked empty failed visibly with networking disabled and no
  download fallback. Missing Secrets and a mismatched bundle
  namespace were rejected before package deployment. Routine application logs
  did not print test credentials or message bodies.

The working set measured approximately 4.85–5.07 GiB for the cluster node plus
15 MiB for its load balancer and 38–48 MiB for the mail fixture. The stopped
build registry used 27 MiB when active. This is one synthetic message at idle/light use, not a load
capacity or production sizing result. `capacityValidated` therefore remains
false. The 1 GiB JVM heap stays within the 3 GiB search container limit; circuit
breakers remain enabled.

## Findings fixed during live validation

1. Zarf did not substitute a runtime variable in chart namespace metadata. The
   namespace is now an explicit bundle-build input, recorded in the artifact
   lock and checked against deployment configuration before cluster mutation.
2. Zarf create-time substitution did not reach referenced chart values files.
   The builder now materializes concrete digest values and verifies actual
   packaged values, namespace metadata and image inventories before bundling.
3. A 512 MiB search heap repeatedly tripped the parent circuit breaker during
   model upload. The UDS default is now 1 GiB. Explicit HTTP 429 rejections retry
   the same chunk/request with finite backoff instead of restarting the entire
   upload; ambiguous connection failures are not automatically replayed.
4. The UDS nginx override omitted three temporary paths required by a read-only
   root filesystem. All temporary paths now use `/tmp`.
5. The proxy required an internal service Host and HTTP/1.1 to traverse the
   strict Istio mesh. Its configuration now lives in a chart file with a pod
   checksum, so configuration changes trigger a rollout.
6. Generated RPC handlers still called demo-session authentication directly.
   They now use the same verified header-identity path as REST. A regression
   checks valid OIDC identity, invalid audience, expiry, and rejected demo/header
   fallback through the real generated router, including draft authorization.

7. A correctly signed/audienced token without an allowed group could bypass the
   interactive group check. Rust now requires membership in the configured
   allowed group paths for every REST/RPC request, independently of gateway SSO.

## Automated checks

- 60 Rust tests passed in the pinned offline ARM64 toolchain container; Clippy,
  rustfmt and generated-type checks passed. Existing certificate/hostname,
  signature/issuer/audience/expiry/not-before, custody and demo regressions pass.
- Three bootstrap HTTP retry tests passed, covering exact chunk replay, finite
  retry budget and no replay of ambiguous/non-throttling failures.
- Six pinned-platform preflight tests passed. Chart rendering and Zarf lint
  passed for 20 Kubernetes objects. Completed packages passed archive-content
  checks, including concrete image digest values and namespace metadata.
- The earlier isolated internal-Docker-network check passed two model bootstrap
  runs and a search restart without public egress. The live UDS checks above
  provide the separate admission, identity and application-workflow evidence.

## Recovery rehearsal

With the server and search stopped, all three complete volumes were archived
and AES-256 encrypted under an isolated local GPG home. SQLite copies included
WAL/SHM files; OpenSearch's entire stopped data directory was copied. The
ciphertext hashes and original claim/PV identities were recorded privately.
Archives were decrypted into three **new** claims in
`parse-command-restoration`, with a separate hostname and SSO client. The
original claims were never deleted or overwritten.

Restoration passed real authenticated API checks against the pre-backup
baseline: identical source/audit IDs, model ID, one source, one passage, eight
audit records, both users' drafts/preparations and all three search modes.
All restored claim UIDs differed from the originals. The restored copy was
stopped afterward; its claims and encrypted backups remain available.

A compatible package-version upgrade `.6` → `.7` and rollback `.7` → `.6`
preserved the original three PVC UIDs, model ID, counts and private state.
This exercised package/Helm recovery with identical immutable application
images, not a database migration or OpenSearch version downgrade. The final
security-fixed `.9` upgrade passed the same baseline checks. Its final clean
bundle deployment completed with all three workloads ready. REST and RPC each
returned HTTP 401 for forged and signed-but-disallowed-group tokens; anonymous
requests redirected to real SSO. The final browser session signed in without
MFA enrollment and reopened Alice's saved draft/preparation and synthetic source.

## Limits and retained local state

This does not certify production load, HA, every storage class, a physical
network airgap, full-platform recovery, newer component versions, AMD64,
OpenSearch version downgrade or an application/database schema migration.
Active-key rotation/JWKS, operational artifact signing, SSO logout behavior,
mail OAuth and legacy demo-owner reassignment remain team decisions.

Existing Compose mail/custody/private/search volumes were not repurposed or
removed. The isolated cluster, synthetic mailbox, encrypted backups, new restore
claims, development archives and private validation records remain local and
ignored by Git. The platform bundle must not be rerun over this retained cluster:
its upstream cluster-creation action deletes a same-named cluster.
