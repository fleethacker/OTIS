# Issue #9 validation evidence

This is development work, not a completed disconnected-cluster certification.

Verified on the development ARM64 Docker engine:

- UDS CLI 0.38.0 embeds Zarf 0.86.0; the inspected official Core 1.14.3 ARM64
  bundle references Zarf 0.86.0 and UDS K3d 0.21.0-airgap/K3s v1.36.4-k3s1.
- Connected model and native preparation passed the existing size/SHA locks.
- The three real Zarf packages and application bundle were created locally as
  development versions through `0.1.0-issue9.4` (approximately 1.1 GiB combined
  bundle). `artifact-lock.json` records the exact source hash for each immutable
  development version. No application image was published externally.
- Workspace tests passed, including verified TLS success, hostname/CA rejection
  before LOGIN, bad JWT signature/issuer/audience/expiry/not-before rejection,
  stable private-owner subjects and demo/RPC/custody regressions. Clippy passed.
- Chart rendering/input checks and Zarf definition lint passed for 20 Kubernetes
  objects, separate retained claims, nonroot resources, SSO and mesh policy.

The isolated internal-Docker-network check passed on the `0.1.0-issue9.3`
application images and again on the exact `0.1.0-issue9.4` images: two bootstrap runs plus a search restart retained the same
model ID and passed real finite 384-vector inference, without public egress or
published ports. An earlier run exposed persisted model-state metadata surviving
the process cache; bootstrap now probes inference, requests redeployment on
failure and waits with a deadline. Rust readiness also probes real inference.
One fresh run returned HTTP 429 under transient startup pressure; another fresh
run with the same application images passed all three stages. Keep circuit
breakers enabled and validate heap/resource sizing and bounded Job retries on
the target. This Docker check does not establish UDS admission or application
workflow acceptance.

Still required before issue acceptance/merge: actual installation/admission on a
clean pinned UDS Core cluster, public-egress-disabled installation, browser SSO
and private state isolation, real synthetic SMTP→IMAP→publication→UI/search,
UDS bootstrap/restart, negative configuration tests and backup/upgrade/
rollback/restoration rehearsal. No Kubernetes context was configured for this
work. The host Docker engine currently provides roughly 16 GiB, below the
proposed 24 GiB budget for the full local platform plus application. No existing
mail, application volumes or clusters were deleted or repurposed.

The runbook makes these gates explicit. Development archives, source traffic,
credentials, local caches, generated SBOM reports and logs remain outside Git.
