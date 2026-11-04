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

## Technology Utilized

### Local OpenSearch

Start the single-node OpenSearch instance (Docker with Compose required):

```sh
docker compose up -d --wait
curl http://localhost:9200
```

OpenSearch 3.9.0 runs at `http://localhost:9200` with a 512 MB JVM heap and a
persistent Docker volume. Authentication and TLS are disabled for local development;
the published port is bound to `127.0.0.1`.

Allocate at least 4 GB of memory to Docker. On Linux, set `vm.max_map_count` to at
least `262144` on the Docker host, as described in the
[OpenSearch Docker setup guide](https://docs.opensearch.org/latest/install-and-configure/install-opensearch/docker/).

Stop it with `docker compose down`; indexed data remains in the volume.

## Architecture

## Parser contract

The [parsed-message ICD](docs/ICD.md) defines compact core data, batched OpenSearch audit records, and the interface for teams contributing Rust parser crates. [JSON Schemas](docs/schemas/README.md), [UI test index mappings](docs/opensearch/README.md), and the [external-fixture validator](docs/tools/validate_samples.py) accompany the contract.

Raw and parsed sample data are kept outside this Git folder at `../OPTASK_Messages` and `../OPTASK_Messages/parsed`. The parsed directory's README contains fixture-load instructions. No sample corpus is published in this repository.
