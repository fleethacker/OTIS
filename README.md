# Parse Command - FleetHacker 2026

## Overview
Warfare commanders disseminate operational orders via dense, formatted telecommunication messages. Watchstanders must parse hundreds of lines of text to determine when their ship is scheduled for events.

### Requirements
A parser that takes raw formatted military text (USMTF format), extracts frequency plans, crypto change-over windows, and flight quarters event times, and plots them on a consolidated visual timeline.

Must:

- Extract tasking/events/correspondence for specified command(s)
- Identify proper coordinating POC within Command C2 (CO/XO/OPS/CHENG/etc.) Nice-To-Have:
- Generates draft response (in proper format) and has ready for review to POC
- Has access to and is aware of Command schedule identifying conflicts early


### Expected Deliverables
A tool that seamlessly converts mock USMTF raw text into a synchronized 24-hour visual schedule for watchstanders and shipboard leaders.

## Local application stack

The imported **Watch Desk** app lives in [`apps/watch-desk/`](apps/watch-desk/).
Its Go service serves the React UI and persists private drafts/preparations in
SQLite. The Rust parser and durable IMAP worker live in [`backend/`](backend/README.md).
The [integration analysis](docs/integration/ark-export.md) covers all 346 exported
files, both sets of context, contract differences, build portability and remaining
work. [ADR 0001](docs/decisions/0001-retain-watch-desk-go-service.md) records the
decision to keep Go for now for later team review.

Build and start Watch Desk plus OpenSearch (Docker with Compose required):

```sh
docker compose up --build -d --wait
curl http://localhost:8080/api/health
curl http://localhost:9200
```

Open [Watch Desk](http://localhost:8080). This is an isolated local development
profile with a mock role picker and clearly fictional USS Meridian schedules.
**The UI still reads SQLite; an OpenSearch-backed schedule adapter is subsequent
work.** The Rust intake worker stages parsed messages and audit work in its own
SQLite custody journal. Continuous OpenSearch delivery and the Rust read API
remain follow-up work. A healthy Compose stack does not imply a completed
parser-to-UI pipeline.

OpenSearch 3.9.0 runs at `http://localhost:9200` with a 512 MB JVM heap and a
persistent Docker volume. Authentication and TLS are disabled for local development;
both published service ports bind to `127.0.0.1`. Containers share a private bridge
network; assets are bundled for runtime use without external CDNs. Optional port
and mock-auth overrides are in [`.env.example`](.env.example).

Allocate at least 4 GB of memory to Docker. On Linux, set `vm.max_map_count` to at
least `262144` on the Docker host, as described in the
[OpenSearch Docker setup guide](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/docker/).

Stop with `docker compose down`; both indexed data and private app state remain
in separate volumes. Run only the search service with
`docker compose up -d --wait opensearch`.

### Demo email inbox

To include the mail server and Rust intake worker in the same Compose project,
use the optional overlay (Docker Compose 2.24.4+):

```sh
docker compose -f docker-compose.yml -f compose.intake.yml up --build -d --wait --wait-timeout 180
docker compose -f docker-compose.yml -f compose.intake.yml exec intake parse-command-intake status /etc/parse-command/config.json
```

This reuses the services from PR #2 and creates a project-local mail network;
it needs no separately started demo stack. SMTP/IMAP bind to loopback ports 1025
and 1143. Do not run the standalone mail stack on the same ports simultaneously.
The UI still shows its separate fictional dataset. See the
[combined-stack guide](docs/integration/combined-stack.md) for data boundaries,
verification, persistent state and offline preparation.

The original standalone mail workflow remains available. See
[demo/README.md](demo/README.md) for credentials, external message delivery and
the Exchange production boundary:

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
python3 demo/mail.py check
```

## Architecture

| Location | Responsibility |
| --- | --- |
| `apps/watch-desk/` | React UI, Go presentation API, private SQLite state, bundled Ark dependencies and original handoff guidance |
| `backend/` | Rust parser SDK, OPTASK contribution, durable IMAP intake, types and tests |
| `demo/` | SMTP/IMAP demo server and local mail helper |
| `test-data/` | Shared naval message collections on Thomas-Branch, with provenance and explicit-use guidance |
| `docs/` | Canonical ICD/schemas/mappings, original engineering planning, integration analysis and decisions |
| `.pdlc-docs/` | Larger-project product context |
| `apps/watch-desk/.ark-handoff/` | Original approved UI context and export provenance |
| `docker-compose.yml` | Local stack, service health, persistent volumes and private network |
| `compose.intake.yml` | Optional combined mail-server and Rust intake services |

See [container operation and offline preparation](docs/integration/ark-export.md#docker-compose-operation)
and [validation results](docs/integration/validation.md). Follow root
[`AGENTS.md`](AGENTS.md) and nested application guidance when making changes.

## Parser contract

The [parsed-message ICD](docs/ICD.md) defines compact core data, batched OpenSearch audit records, and the interface for teams contributing Rust parser crates. [JSON Schemas](docs/schemas/README.md), [UI test index mappings](docs/opensearch/README.md), and the [external-fixture validator](docs/tools/validate_samples.py) accompany the contract.

Raw and parsed OPTASK acceptance data are kept outside this Git folder at `../OPTASK_Messages` and `../OPTASK_Messages/parsed`. The parsed directory's README contains fixture-load instructions. The OPTASK acceptance corpus is not published in this repository.

On `Thomas-Branch`, the project owner authorized sharing the separate naval
message collections under [`test-data/messages/`](test-data/messages/). See
[`test-data/README.md`](test-data/README.md) for their original locations,
preserved revision, usage and unverified dataset status. These files are explicit
test inputs; startup does not load or send them automatically.

## Supported OPTASK messages

The Rust implementation is in [`backend/`](backend/README.md). The following exact message identifiers have end-to-end regression coverage against the supplied examples and their approved parsed documents:

| Message | Tested declared version |
| --- | --- |
| OPTASK AAW | B.1.01.13 |
| OPTASK ASUW | B.1.01.12 |
| OPTASK ASW | B.1.01.12 |
| OPTASK COMMS | B.1.01.12 |
| OPTASK COP-CTP | B.1.01.03 |
| OPTASK EW | B.1.01.12 |
| OPTASK GENERAL | B.1.01.12 |
| OPTASK IM | B.1.01.12 |
| OPTASK LINK | B.1.02.04 |
| OPTASK LINK ID SUPP | B.1.01.12 |
| OPTASK MCM | B.1.01.12 |
| OPTASK MINING | B.1.01.12 |
| OPTASK NUC | B.1.01.12 |
| OPTASK RAS | B.1.01.12 |

This coverage reproduces all approved example facts: 13 periods, 27 frequencies, 25 activities and 8 contacts. Extraction includes frequency plans, crypto changeover points, communications windows/checks, replenishment rendezvous, explicit task records, reporting requirements and source POCs where present. Detailed evidence stays in separate audit documents.

Support is specific to these tested layouts and extraction rules. Output remains marked `partial` because unprojected records are preserved for review; the example-based profiles do not establish full edition compliance. Missing dates and unresolved command/C2 mappings remain explicit. The parser performs no runtime network or model calls. UI integration lives in [`apps/watch-desk/ui/`](apps/watch-desk/ui/).

## Initial inbox test

The [intake runbook](backend/INTAKE.md) covers starting the demo monitor, inspecting per-email custody, restart/retry behavior and loading isolated OpenSearch UI test indices. The worker retains original email bytes and commits parser results with a durable audit outbox before marking a receipt parsed. Duplicate bodies share a projection; IMAP server receipt time selects the newest subject and differences remain flagged.

The [ICD 1.1.0](docs/ICD.md) adds optional geographic locations: points, channel endpoint lines and area polygons, with WGS84 as the approved default only when a datum is absent. Source evidence remains in audit. The demo worker monitors IMAP continuously; production Exchange PKI and continuous OpenSearch delivery remain subsequent acceptance work.
