# Combined Watch Desk, intake and search stack

Updated 2026-11-04 after rebasing PR #3 onto PR #2's merge commit
`77d5267fe29589bb99a9ce3fc5020e37c4381ffb`.

## What now runs together

The default `docker-compose.yml` still starts Watch Desk and OpenSearch.
The optional root `compose.intake.yml` adds the mail server and the existing
Rust worker from PR #2, using `extends` rather than copying their implementations
or changing their standalone deployment files. Docker Compose **2.24.4 or newer**
is required for the overlay's `!override` network replacement.

All commands below run from the repository root:

```sh
docker compose -f docker-compose.yml -f compose.intake.yml config --quiet
docker compose -f docker-compose.yml -f compose.intake.yml up --build -d --wait --wait-timeout 180
```

| Service | Responsibility | State / endpoint |
| --- | --- | --- |
| `web` | React assets, Go ConnectRPC, private drafts/preparation | `watch-desk-data`; localhost:8080 |
| `opensearch` | Search storage, ready for explicit indexing | `opensearch-data`; localhost:9200 |
| `mail-config` | One-shot copy of the public demo account/configuration | `mail-config`; exits successfully before mail startup |
| `mailserver` | Local SMTP delivery and IMAP inbox | Separate mail data/state/log volumes; localhost:1025 and :1143 |
| `intake` | Bounded IMAP polling, MIME decoding, OPTASK parsing, custody/outbox staging | `custody`; no published ports |

The overlay resolves build and bind-mount paths from the repository root.
Intake connects to `mailserver:143` on this project's `mail` network. It requires
no pre-existing `parse-command-demo_mail` network. The existing standalone
`demo/docker-compose.yml` and `backend/compose.intake.yaml` remain available;
choose one mail deployment at a time because their loopback mail ports overlap.
An existing standalone mailbox/journal is not silently adopted by this project.

Mail configuration uses the public demo account documented in
[`demo/README.md`](../../demo/README.md). It is an isolated local plaintext
profile. Exchange PKI/authentication and operational authorization retain the
boundaries documented in [`backend/INTAKE.md`](../../backend/INTAKE.md).

## Data boundaries

There are separate data paths today:

1. SMTP → IMAP → Rust intake/parser → durable custody and audit outbox.
2. Browser → Go ConnectRPC → Watch Desk's SQLite source records/private state.

Watch Desk still reads its explicitly fictional seed. Starting the worker does
not populate the UI or automatically index its staged projections. The worker
reports `delivery: local_only`; `parsed` means committed to local custody, not
published to OpenSearch. The existing host-journal test loader can explicitly
populate isolated search indices, but it does not acknowledge the runtime outbox
or act as a continuous writer. Follow its runbook and do not copy only an active
SQLite main file while leaving committed WAL data behind.

The Rust read API, continuous index/audit delivery and Go `ScheduleSource`
translation remain integration work. Preserve message/revision IDs, unresolved
time states and private ownership. ICD 1.1.0 geometry must not manufacture ship
ownership, dates or confirmed calendar events. The current UI can retain/display
additional structured fields, but this is not a map implementation or live feed.
[ADR 0001](../decisions/0001-retain-watch-desk-go-service.md) retains Go for now and
records the team's later consolidation decision.

## Inspect the running services

```sh
docker compose -f docker-compose.yml -f compose.intake.yml ps --all
docker compose -f docker-compose.yml -f compose.intake.yml exec -T intake parse-command-intake status /etc/parse-command/config.json
docker compose -f docker-compose.yml -f compose.intake.yml logs --tail=50 intake
python3 demo/mail.py inbox
curl --fail http://localhost:8080/api/health
curl --fail http://localhost:9200/_cluster/health
```

The worker has no HTTP readiness endpoint or Compose healthcheck; `--wait`
confirms its process is running and waits for the mail server and web/search
healthchecks. Inspect worker status/logs to confirm successful polling. A fresh
empty inbox can correctly report zero receipts/projections; it must not claim a
successful parsed message or an indexed source merely because startup succeeds.

`demo/mail.py check` deliberately sends a synthetic transport probe. Sending
messages is a separate test action, not part of the startup/read-only checks
above. External message files remain outside Git and container build contexts.
Use the documented `demo/mail.py send` command when deliberately exercising
parsing with a selected local corpus.

## State and shutdown

Use both Compose files consistently for the combined project:

```sh
docker compose -f docker-compose.yml -f compose.intake.yml stop
docker compose -f docker-compose.yml -f compose.intake.yml down
```

Both retain volumes. Do not add `--volumes` unless intentionally erasing the
UI, search, mail and custody datasets. The UI database and Rust journal are
independent; neither is a substitute for the other's state. Use a different
Compose project name for disposable tests, and never remove an existing journal
to get past a processing or account-binding error.

## Build checks and offline preparation

```sh
docker build --target test -t parse-command-intake-tests:local backend
docker build --target go-test -t parse-command/watch-desk-go-test:local apps/watch-desk
docker build --target ui-test -t parse-command/watch-desk-ui-test:local apps/watch-desk
```

The Rust target uses the pinned Rust builder, includes the configs needed by
synthetic custody tests and runs workspace tests offline after dependency
preparation. External corpus tests remain opt-in. These diagnostics do not
replace the documented canonical Ark checks or the backend's format/clippy/
type-generation checks. See [validation results](validation.md).

Prepare all four runtime images on a connected machine:

```sh
docker compose -f docker-compose.yml -f compose.intake.yml build web intake
docker compose -f docker-compose.yml -f compose.intake.yml pull opensearch mailserver mail-config
docker save -o /absolute/output/parse-command-combined-images.tar \
  parse-command/watch-desk:local parse-command-intake:local \
  opensearchproject/opensearch:3.9.0 \
  ghcr.io/docker-mailserver/docker-mailserver:16.0.1
```

Transfer the archive, repository and demo configuration to a compatible offline
host, then load the images and start without building or pulling:

```sh
docker load -i /absolute/input/parse-command-combined-images.tar
docker compose -f docker-compose.yml -f compose.intake.yml up --no-build --pull never -d --wait --wait-timeout 180
```

Runtime assets and dependencies are packaged. The local bridge profile permits
loopback host access; the deployment environment enforces the enclave boundary.
Resource limits inherited from the demo worker are demo settings, not operational
capacity guarantees. No embedding model or cloud service is introduced here.
