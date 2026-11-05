<p align="center">
  <img src="apps/watch-desk/docs/branding/otis/otis-patch-master.png" alt="OTIS — Keeping the Watch" width="320">
</p>

<h1 align="center">OTIS</h1>
<p align="center"><strong>Operational Tasking Integration System · Keeping the Watch</strong></p>

OTIS turns formatted naval messages into searchable tasking and a consolidated
schedule, helping watchstanders find what matters to their command and trace it
back to the source.

Built by the **Parse Command** team at **FleetHacker2026**, a **Task Force Hopper
Hackathon Event**.

[View the briefing](https://fleethacker.github.io/OTIS/) ·
[Documentation](docs/README.md) · [Architecture](docs/integration/architecture.md) ·
[Operations](docs/integration/combined-stack.md) · [UDS deployment](#uds-deployment)

## What OTIS does for the fleet

A ship comes back online after days without connectivity and the inbox floods: family mail, other commands, ads, and dozens of naval messages. One of them moves tomorrow's UNREP. Today someone has to watch the mailbox, move traffic into a public folder by hand, and every department scans the whole pile for what concerns them. OTIS runs on the ship's own server, works without internet, and does that triage the moment traffic arrives.

- **Nobody babysits the mailbox.** OTIS watches the command's message inbox around the clock, files every naval message as it lands, and keeps the original exactly as received.
- **Tasking becomes a schedule.** OPTASKs are read automatically: activities, comms plan windows, crypto changeovers, reporting deadlines, locations and points of contact go onto one calendar by day, week or month, in Zulu or local time. Recurring events like daily comms checks carry their real times.
- **Each ship sees its own picture, and the group sees the whole.** Filter the calendar to your ship, or lay several ships side by side, so a strike group, ARG or DESRON staff can see who is doing what and when.
- **Catch up in minutes after a watch or a blackout.** At login, each person sees what changed since they were last on: new tasking, what it adds to the schedule, and what still needs a human look. They work it off item by item or mark the whole set reviewed, ordered by when each message was actually sent.
- **Find any message fast.** Search by keyword or by meaning across all traffic, filtered by command, message type, originator and date. Coordinates in a message can be shown on an offline map.
- **Casualty reports in one place.** CASREPs are read with equipment, repair estimates, assistance and parts requested, and each casualty's INITIAL, UPDATE, CORRECT and CANCEL history stays linked.
- **Higher-network traffic without the flood.** When traffic for a ship arrives on the higher network, the lower-network watch gets a short "traffic waiting" notice with ship, count and precedence. The notice carries no message content. It clears itself once the traffic has been pulled up, and the higher side can see that the notice was sent and acknowledged.
- **Tasking goes onto your own calendar.** A sailor picks their ship, the event types they care about and a date range, then syncs just those events into their mailbox calendar, or downloads them for Outlook. Only relevant OPTASKs land on their calendar, and it adds no extra email traffic.
- **From reading to responding.** Acknowledgement drafts are prepared from the message for the user to review and route through the normal approval chain.
- **Trust what you see.** Every scheduled item traces back to the exact source text. Incomplete or uncertain times stay visible for review instead of being guessed, and an event log records receipt and processing.
- **Built for the ship.** It runs entirely on the ship's internal server and keeps working with no internet connection. Access is limited to authorized users by role, and it can use the command's single sign-on.

**Next:** shared calendar visibility across participating commands and for an ISIC across its units; routing drafts for approval through OTIS instead of printing them.

## Quick start

Use **Docker Compose 2.24.4+**, **Python 3.9+**, and at least **4 GB of Docker
memory**. The committed native dependency lock is validated on **Linux ARM64**;
other architectures need the preparation described in the
[search runbook](backend/search/README.md). Linux hosts also need
`vm.max_map_count` set to at least `262144`.

From the repository root, prepare the local search assets while connected:

```sh
python3 -m venv /tmp/otis-search-venv
/tmp/otis-search-venv/bin/pip install -r backend/search/requirements.lock
/tmp/otis-search-venv/bin/python backend/search/prepare_assets.py
python3 backend/search/prepare_native.py --arch arm64
```

Start the demo mailbox, build the application stack, and provision the local model:

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
docker compose up --build -d --wait --wait-timeout 180
/tmp/otis-search-venv/bin/python backend/search/deploy.py
curl --fail http://localhost:8080/api/health
```

Open **[OTIS at localhost:8080](http://localhost:8080)**. The default profile uses
local demo authentication. OpenSearch is available at `http://localhost:9200`;
SMTP and IMAP use loopback ports `1025` and `1143`. This profile uses plaintext
mail and disables OpenSearch authentication/TLS for local development.

Send a UTF-8 test message whose body starts with `MSGID/`, `EXER/` or `OPER/`:

```sh
python3 demo/mail.py send /absolute/path/to/message.txt \
  --subject 'SUBJ: DEMO OPTASK exercise'
python3 demo/mail.py inbox --limit 20
```

Messages are ingested automatically. For historical examples, navigate the
calendar to the source message dates. See the [mail demo guide](demo/README.md)
for mailbox details and the [test-data guide](test-data/README.md) for sample
provenance and usage. Startup does not automatically send sample messages.

Stop the application with `docker compose down`, then stop the mailbox with
`docker compose -f demo/docker-compose.yml down`. Both retain persistent volumes.
For offline transfers, restarts, or existing-state migration, follow the
[stack runbook](docs/integration/combined-stack.md) and
[settings and migration guide](docs/integration/settings-oidc.md).

## Supported OPTASK messages

Example-based regression coverage includes **AAW, ASUW, ASW, COMMS, COP-CTP, EW,
GENERAL, IM, LINK, LINK ID SUPP, MCM, MINING, NUC, and RAS**. See the
[Rust backend guide](backend/README.md) for parser implementation and verification.

**CASREP** is also supported as a separate message family. See the
[CASREP guide](docs/integration/casrep.md) for report actions, indexing and search.
GENADMIN remains a separate unsupported type.

Support applies to the tested layouts, rather than every USMTF edition or message
type. Extracted tasking requires human review, and missing or uncertain values
remain explicit. Production Outlook/Exchange authentication and TLS integration
require separate implementation and acceptance; the demo exercises SMTP/IMAP.

## Repository guide

| Path | Contents |
| --- | --- |
| [`apps/watch-desk/`](apps/watch-desk/) | OTIS React UI, branding, and original Go reference source |
| [`backend/`](backend/) | Rust parser SDK, application server, durable IMAP intake, and local search tooling |
| [`demo/`](demo/) | SMTP/IMAP demo mailbox and message helper |
| [`test-data/`](test-data/) | Shared test messages and provenance |
| [`docs/`](docs/) | Data contracts, schemas, search mappings, and operating guides |
| [`site/`](site/) | GitHub Pages briefing |

Parser contributors should start with the [parsed-message ICD](docs/ICD.md)
and [JSON Schemas](docs/schemas/README.md). Operational acceptance examples and
manual-derived knowledge remain outside Git; see the backend and test-data guides.

## UDS deployment

Deploy the UDS platform first, then install the OTIS application bundle into it.
The application bundle contains the UI, Rust server, OpenSearch and local model
bootstrap. It requires **Linux ARM64** nodes and **UDS Core 1.14.3** with Keycloak.
Use **UDS CLI 0.38.0** and its embedded **Zarf 0.86.0** (`uds zarf`), plus
`kubectl`, **Python 3.14+** and Helm. Building packages also requires Git and
Docker/BuildKit with Linux ARM64 support. Pins are recorded in
[`deploy/uds/versions.json`](deploy/uds/versions.json).

The current native OIDC profile still requires a fresh migration, browser and
recovery acceptance rehearsal. Read the [validation record](deploy/uds/VALIDATION.md)
before choosing a release; earlier live results cover the previous architecture.
The [full UDS runbook](deploy/uds/README.md) covers identity, storage, migration,
backup and recovery in detail. Run the commands below from the repository root.

### 1. Deploy the UDS platform

For an existing platform, have its operator confirm Core 1.14.3 with either
`core-base` + `core-identity-authorization` or the standard `core` package, then
continue to application packaging below. Nodes need working DNS, a default
StorageClass (or an explicit application override), storage compatible with
`fsGroup`, and `vm.max_map_count >= 262144`.

For a **new isolated local ARM64 environment**, use the pinned official
`k3d-core-slim-dev` bundle. Allocate at least 8 CPUs, 16 GiB Docker memory and
50 GiB free disk for the local validation profile, with ports 80/443 available.
This slim platform includes base and identity services; see the
[local profile](deploy/uds/profiles/local-arm64.json) for its scope.

On a connected preparation machine, inspect and download the platform:

```sh
OTIS_PLATFORM_REF=oci://ghcr.io/defenseunicorns/packages/uds/bundles/k3d-core-slim-dev:1.14.3
OTIS_PLATFORM_DIR=/absolute/path/to/platform
mkdir -p "$OTIS_PLATFORM_DIR"
uds inspect "$OTIS_PLATFORM_REF" --architecture arm64
uds pull "$OTIS_PLATFORM_REF" --architecture arm64 --output "$OTIS_PLATFORM_DIR"
```

Transfer the archive and pinned tools to the target if deploying offline. Inspect
the platform variables, then deploy **once to an unused cluster name**:

```sh
uds inspect "$OTIS_PLATFORM_DIR/uds-bundle-k3d-core-slim-dev-arm64-1.14.3.tar.zst" \
  --architecture arm64 --list-variables
uds deploy "$OTIS_PLATFORM_DIR/uds-bundle-k3d-core-slim-dev-arm64-1.14.3.tar.zst" \
  --architecture arm64 --set CLUSTER_NAME=parse-command-issue9
```

**The upstream K3d package deletes a same-named cluster. Never rerun this platform
deployment over retained application data.** Change `CLUSTER_NAME` if that name
already exists. Complete platform DNS and certificate trust for `uds.dev`,
including `sso.uds.dev` and the application hostname, before installing OTIS.

### 2. Build the OTIS application packages

On the connected build machine, choose a new release version and the target
namespace. The namespace is embedded in the packages and must match deployment
configuration; changing it requires a rebuild. If you already have a release,
transfer and verify it as described below, then continue to target configuration.

```sh
OTIS_VERSION=0.1.0-dev.1
OTIS_NAMESPACE=parse-command
python3 -m unittest discover -s deploy/uds/tools/tests -v
python3 deploy/uds/tools/validate.py
python3 deploy/uds/tools/build.py --version "$OTIS_VERSION" \
  --namespace "$OTIS_NAMESPACE" --prepare-assets
OTIS_RELEASE="deploy/uds/.artifacts/$OTIS_VERSION"
python3 deploy/uds/tools/verify_artifacts.py --release "$OTIS_RELEASE"
```

The ignored release directory contains three Zarf packages under `packages/`,
`uds-bundle-parse-command-arm64-<version>.tar.zst`, `artifact-lock.json` and
`SHA256SUMS`. It includes all application images, charts, model and native
libraries needed at runtime. Completed versions cannot be overwritten.

The builder uses a loopback registry at `127.0.0.1:5119`; it does not publish to
a public registry. When finished, stop it with
`docker stop parse-command-issue9-registry`. Before a later build, inspect the
stopped container and explicitly restart it with
`docker start parse-command-issue9-registry`.

For offline deployment, transfer the complete release directory, the tracked
files under `deploy/uds/` (preserving their paths), and pinned operator tools to
the target. Set `OTIS_RELEASE` to the transferred release directory there and
`OTIS_VERSION` to its version. Verify its `SHA256SUMS` after transfer
(`sha256sum -c SHA256SUMS` on Linux, or `shasum -a 256 -c SHA256SUMS` on macOS,
from inside that directory). Development bundles are unsigned; team releases
require the approved signing and trusted-key distribution process in the runbook.

### 3. Configure the target and provision secrets

For a fresh install, copy the configuration example, then edit it for the target:

```sh
cp deploy/uds/uds-config.example.yaml deploy/uds/uds-config.yaml
```

Set `shared.NAMESPACE` to the built namespace. Under `shared.COMMON`, configure
`domain`, `host`, `clientId`, storage, the real `imapHost`/`imapPort`/`imapCidr`,
and private Keycloak routing. Set matching mailbox host/port and the real username
under `shared.SERVER.intake`. The example `.invalid` endpoint cannot be deployed.
Keep implicit TLS on port 993 unless your verified TLS mailbox uses another port.

Provision Keycloak users in `/Parse Command/Admin` or `/Parse Command/Viewer`;
keep `COMMON.allowedGroups` aligned with `SERVER.adminGroup`/`viewerGroup`.
The UDS config package registers the confidential client and creates its Secret.
Rust handles native OIDC at `https://<host>.<domain>/auth/callback`; leave
Authservice interception disabled. Both browser and server must reach the trusted
HTTPS issuer through the configured DNS/private gateway and permitted egress.

Select the target context explicitly (`k3d-parse-command-issue9` for the local
example) and create a dedicated namespace for a fresh install:

```sh
OTIS_CONTEXT=k3d-parse-command-issue9
OTIS_NAMESPACE=parse-command
kubectl --context "$OTIS_CONTEXT" get nodes
kubectl --context "$OTIS_CONTEXT" create namespace "$OTIS_NAMESPACE"
```

Prepare protected files outside Git and release archives, using mode 0600:
the mailbox password, its trusted CA chain, the issuer CA chain, and an exact
**32-byte binary session encryption key**. For a fresh install, generate the key
once with `openssl rand -out /secure/otis/session-key 32` in an existing protected
directory. Retain and back up that key across upgrades.

Create the Secrets using the chart's default names (adjust names if overridden):

```sh
kubectl --context "$OTIS_CONTEXT" -n "$OTIS_NAMESPACE" create secret generic parse-command-imap \
  --from-file=password=/secure/otis/imap-password \
  --from-file=ca.crt=/secure/otis/mail-ca.crt
kubectl --context "$OTIS_CONTEXT" -n "$OTIS_NAMESPACE" create secret generic parse-command-sso \
  --from-file=session-key=/secure/otis/session-key \
  --from-file=ca.pem=/secure/otis/issuer-ca.pem
```

Reuse the namespace and retained Secrets for upgrades. Existing SQLite state
requires the [state adoption and recovery procedure](deploy/uds/README.md#state-adoption-and-recovery)
before starting the new workers.

### 4. Deploy and verify the application bundle

With `OTIS_VERSION`, `OTIS_RELEASE`, `OTIS_CONTEXT` and the edited config set on
the target, validate and install the complete bundle:

```sh
python3 deploy/uds/tools/validate.py --config deploy/uds/uds-config.yaml
python3 deploy/uds/tools/verify_artifacts.py --release "$OTIS_RELEASE"
python3 deploy/uds/tools/deploy.py --context "$OTIS_CONTEXT" \
  --config deploy/uds/uds-config.yaml \
  --bundle "$OTIS_RELEASE/uds-bundle-parse-command-arm64-$OTIS_VERSION.tar.zst"
kubectl --context "$OTIS_CONTEXT" -n "$OTIS_NAMESPACE" get packages,pods,pvc
```

The installer checks the bundle checksum, namespace, ARM64 nodes, pinned Core
and required Secret keys, deploys the packages in order, and waits for workload
rollouts. It uses the explicit context without changing your current context.

Open **[OTIS at parse-command.uds.dev](https://parse-command.uds.dev)** for the
default host/domain, or your configured HTTPS origin, and sign in through
Keycloak. Verify Package readiness and ready mesh sidecars, then exercise a
synthetic message through the TLS mailbox, source/detail/audit views, keyword,
semantic and hybrid search, and save/reopen a private draft. Use
`python3 deploy/uds/tools/smoke.py --help` for the authenticated mail/API check.
Health and ready pods alone do not prove the application workflow; complete the
[native acceptance gates](deploy/uds/README.md#install-and-verify-a-separate-target).

Offline runtime still needs DNS, the private Zarf registry, Keycloak and the
configured mailbox. Back up OpenSearch state, the session key, configuration and
artifact lock before upgrades. Preserve search and legacy claims; never delete
namespaces, clusters or PVCs as a recovery shortcut.
