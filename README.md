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

## Judge briefing

The animated judge-facing slick sheet is in [`site/index.html`](site/index.html).
See the [GitHub Pages guide](docs/integration/github-pages.md) for local preview,
publishing setup, and the deployment workflow.

## Local application stack

The imported **Watch Desk** app lives in [`apps/watch-desk/`](apps/watch-desk/).
Rust serves the application API, private drafts/preparations and continuous
IMAP-to-OpenSearch publication. A lightweight static/proxy web container serves
React. The Go implementation remains as reference source. See the
[combined-stack runbook](docs/integration/combined-stack.md) and
[frontend API and search templates](docs/integration/rust-application-api.md).
Admins open settings from the header gear. Native Keycloak OIDC, per-user
preferences and hidden OpenSearch state are described in the
[settings and SSO guide](docs/integration/settings-oidc.md). Existing SQLite
deployments require the documented snapshot migration before replacement.

Prepare the local model/native assets first using the
[search preparation runbook](backend/search/README.md#connected-preparation).
The committed native dependency lock is validated on Linux ARM64. Runtime images
and the model archive can then be transferred to an offline host.

Build and start Watch Desk, `parse-command-server` and OpenSearch (Docker Compose 2.24.4+ required):

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
docker compose up --build -d --wait
curl http://localhost:8080/api/health
curl http://localhost:9200
```

Open [Watch Desk](http://localhost:8080). This local-demo profile reads parsed
OpenSearch messages through Rust. Search combines BM25 and local MiniLM semantic
retrieval using OpenSearch reciprocal rank fusion. Full structured/raw content
and audit evidence load on demand. Existing legacy records and private history
are preserved by the optional migration; they are not substituted for indexed
messages. The SMTP/IMAP demo remains a separate environment.

The prepared OpenSearch 3.9.0 image runs at `http://localhost:9200` with a 512 MB JVM heap and a
persistent Docker volume. Authentication and TLS are disabled for local development;
both published service ports bind to `127.0.0.1`. Containers share a private bridge
network; assets are bundled for runtime use without external CDNs. Optional port
and mock-auth overrides are in [`.env.example`](.env.example).

Allocate at least 4 GB of memory to Docker. On Linux, set `vm.max_map_count` to at
least `262144` on the Docker host, as described in the
[OpenSearch Docker setup guide](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/docker/).

Stop with `docker compose down`; indexed data, custody and private app state remain
in the OpenSearch data volume. Retain old SQLite volumes for migration/rollback.
Run only the search service with
`docker compose up -d --wait opensearch`.

### Demo email inbox

The demo SMTP/IMAP mailbox is a separate environment under `demo/`.
The root Compose stack contains only the UI (`web`), OpenSearch and Rust server
(`server`, container `parse-command-server`). Start the demo environment first:

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
docker compose up --build -d --wait --wait-timeout 180
docker compose exec -T server parse-command-intake status /etc/parse-command/config.json
python3 demo/mail.py send ../OPTASK_Messages/*.txt
```

The server connects to `mailserver:143` on the demo environment's external
`parse-command-demo_mail` network. SMTP/IMAP bind to loopback ports 1025 and 1143.
Its hidden custody index and resource limits belong to the application stack. The
executable/crate remains `parse-command-intake`; its deployed image is
`parse-command-server:local`. Stop the standalone worker before adopting its
custody state through the [migration procedure](docs/integration/settings-oidc.md#storage-and-migration).
See the [stack guide](docs/integration/combined-stack.md).
`compose.intake.yml` is an empty compatibility file; no overlay is needed.

## Architecture

| Location | Responsibility |
| --- | --- |
| `apps/watch-desk/` | React UI, static/proxy runtime, original Go reference source, bundled Ark dependencies and handoff guidance |
| `backend/` | Rust parser SDK, OPTASK contribution, durable IMAP intake, types and tests |
| `demo/` | SMTP/IMAP demo server and local mail helper |
| `test-data/` | Shared naval message collections on Thomas-Branch, with provenance and explicit-use guidance |
| `docs/` | Canonical ICD/schemas/mappings, original engineering planning, integration analysis and decisions |
| `.pdlc-docs/` | Larger-project product context |
| `apps/watch-desk/.ark-handoff/` | Original approved UI context and export provenance |
| `docker-compose.yml` | Unified UI, server and OpenSearch stack with persistent volumes |
| `compose.intake.yml` | Compatibility overlay; server is now in the root stack |

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

| Message | Tested declared version | Tabler calendar icon (`react-icons/tb`) |
| --- | --- | --- |
| OPTASK AAW | B.1.01.13 | `TbRadar` |
| OPTASK ASUW | B.1.01.12 | `TbShip` |
| OPTASK ASW | B.1.01.12 | `TbSubmarine` |
| OPTASK COMMS | B.1.01.12 | `TbRadio` |
| OPTASK COP-CTP | B.1.01.03 | `TbMap2` |
| OPTASK EW | B.1.01.12 | `TbWaveSine` |
| OPTASK GENERAL | B.1.01.12 | `TbClipboardList` |
| OPTASK IM | B.1.01.12 | `TbDatabase` |
| OPTASK LINK | B.1.02.04 | `TbLink` |
| OPTASK LINK ID SUPP | B.1.01.12 | `TbIdBadge2` |
| OPTASK MCM | B.1.01.12 | `TbShieldCheck` |
| OPTASK MINING | B.1.01.12 | `TbBomb` |
| OPTASK NUC | B.1.01.12 | `TbRadioactive` |
| OPTASK RAS | B.1.01.12 | `TbGasStation` |

This coverage reproduces all approved example facts: 13 periods, 27 frequencies, 25 activities and 8 contacts. Extraction includes frequency plans, crypto changeover points, communications windows/checks, replenishment rendezvous, explicit task records, reporting requirements and source POCs where present. Detailed evidence stays in separate audit documents.

Support is specific to these tested layouts and extraction rules. Output remains marked `partial` because unprojected records are preserved for review; the example-based profiles do not establish full edition compliance. Missing dates and unresolved command/C2 mappings remain explicit. The parser performs no runtime network or model calls. UI integration lives in [`apps/watch-desk/ui/`](apps/watch-desk/ui/).

## Initial inbox test

The [intake runbook](backend/INTAKE.md) covers starting the demo monitor, inspecting per-email custody, restart/retry behavior and loading isolated OpenSearch UI test indices. The worker retains original email bytes and commits parser results with a durable audit outbox before marking a receipt parsed. Duplicate bodies share a projection; IMAP server receipt time selects the newest subject and differences remain flagged.

The [ICD 1.1.0](docs/ICD.md) adds optional geographic locations: points, channel endpoint lines and area polygons, with WGS84 as the approved default only when a datum is absent. Source evidence remains in audit. The demo worker monitors IMAP continuously; production Exchange PKI and continuous OpenSearch delivery remain subsequent acceptance work.
