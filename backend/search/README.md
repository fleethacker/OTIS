# Local passage embeddings and stored search templates

This provisions OpenSearch 3.9.0 for the approved CPU-only
`sentence-transformers/all-MiniLM-L6-v2` ONNX model, version 1.0.1, with 384
dimensions. [model.json](model.json) pins its official configuration, archive
size and SHA-256. Model files, tokenizer assets and deployment IDs stay in
ignored local directories. No message corpus is part of this folder.

The server, UI and prepared OpenSearch image share the root Compose project.
The demo mailbox remains a separate Compose environment. The Rust server continuously publishes canonical messages, lexical passages,
audit batches and retriable embedding jobs from its custody journal. The UI
reads through its typed API and stored templates. These Python tools remain
for provisioning, diagnostics and explicit snapshot validation; they do not
acknowledge the runtime outbox. See the [application API](../../docs/integration/rust-application-api.md).

## Connected preparation

Run from the repository root:

```sh
python3 -m venv /absolute/tools/search-venv
/absolute/tools/search-venv/bin/pip install -r backend/search/requirements.lock
/absolute/tools/search-venv/bin/python backend/search/prepare_assets.py
python3 backend/search/prepare_native.py --arch arm64
docker compose build server web opensearch
```

Connected preparation downloads the pinned DJL CPU tensor helper with resumable
transfers. Image assembly verifies the committed native-file checksums and loads
the helper with build networking disabled. The current native lock is validated
on Linux ARM64; preparing another architecture requires its own reviewed lock
and inference test. OpenSearch's ONNX translator uses that helper to reshape tensors. ONNX and
tokenizer native libraries are already bundled in the base image. Runtime sets
`DJL_OFFLINE=true` and `ai.djl.offline=true`; missing dependencies fail instead
of downloading. Inference uses CPU and bounded thread settings. ML memory/disk
circuit breakers remain enabled. This does not establish a production capacity
envelope; measure the complete JVM/native/page-cache footprint under bursts.

Transfer the built runtime images, model archive, source and a compatible
provisioning Python environment or wheelhouse to the offline machine. Preserve
the dependency licenses from the model/native packages. The official model
archive is downloaded only by `prepare_assets.py`, never by deployment/startup.

## Offline bootstrap

```sh
docker compose -f demo/docker-compose.yml up --no-build --pull never -d --wait
docker compose up --no-build --pull never -d --wait
/absolute/tools/search-venv/bin/python backend/search/deploy.py
```

Bootstrap preflights the local cluster and verifies the archive before model
registration. It uploads deterministic local binary chunks, polls deployment,
installs pipelines/mapping/templates and simulates actual vector generation.
It temporarily enables local-file registration and disables it in a `finally`
block. No URL registration, remote connector or public model fetch is used.
Model metadata/chunks persist in OpenSearch's data volume. Rerunning bootstrap
checks the registered hash, redeploys when necessary and rejects a conflicting
index/model/chunker generation. An interrupted registration resumes the same
chunk numbers; it does not create another model silently.

Bootstrap records local IDs in `state/deployment.json`. Rerun it after a node
restart to establish semantic readiness; process/cluster health alone is not
proof that a local model is deployed. First-start provisioning remains an
explicit offline operation.

## Prepare and load narrative passages

Take a consistent custody snapshot using SQLite backup or by stopping the
server before copying its journal and restarting it afterward. Never copy an
active SQLite main file while omitting its WAL. Then:

```sh
/absolute/tools/search-venv/bin/python backend/search/load_narratives.py /absolute/snapshot/custody.sqlite
/absolute/tools/search-venv/bin/python backend/search/verify.py
```

The loader uses the parser's audited record boundaries for the observed
`GENTEXT`, `NARR` and `AMPN` sets, including narrative records that also generated
structured facts. It deduplicates each source record, verifies source hashes,
and copies current core metadata/subject without inventing command ownership.
It uses the archive's actual tokenizer with truncation disabled: 240 content
tokens with 24-token overlap, at most 256 encoded tokens and 8192 UTF-8 bytes
per passage. Oversized unknown words are subdivided. Stable IDs include the
parent/revision, chunker generation and source span. Chunk provenance is stored
in separate `passage_prepared` audit documents, with byte spans in their payload.

Passage text and batched audit creates use Bulk requests, at most 16 passages per
batch and 2 MiB per request. Every result item is checked. Immutable audit
conflicts require equality apart from the original preparation timestamp.
Replays replace passages with stable IDs and retain the original audit entry.
The ingest pipeline removes supplied/stale vectors and computes new ones.
Unchanged passage text reuses its existing embedding within this pinned index generation.
Inference failure preserves text with `embedding_status=failed` and no vector;
the loader reports incomplete enrichment. Invalid/missing text fails ingestion.
Vectors never enter compact message documents or search responses.

Destination alias: `parse-command-search-passages`; backing index:
`parse-command-search-passages-minilm-v1`. Audit destination:
`parse-command-intake-test-audit-v1`, created by the existing intake test loader.
These are explicit test profiles with **no retention expiry** so historical
fixtures remain inspectable. Production issue-time lifecycle is separate work.

## Frontend integration

See [the search contract](../../docs/opensearch/search-contract.md). The installed
template IDs are:

- `parse-command-passages-keyword-v1`
- `parse-command-passages-semantic-v1`
- `parse-command-passages-hybrid-v1`

`query.py` is a bounded reference caller, not a new HTTP server or browser SDK:

```sh
/absolute/tools/search-venv/bin/python backend/search/query.py hybrid 'communications handover'
```

The live verifier uses a disposable synthetic index, exercises every retrieval
mode with command/type/classification/issue-time restrictions, verifies empty
filter results and query escaping, tests long Unicode tails and inference
failure, and deletes only its own newly created index. It never deletes the
application's loaded passages.

Primary references: [official model configuration](https://artifacts.opensearch.org/models/ml-models/huggingface/sentence-transformers/all-MiniLM-L6-v2/1.0.1/onnx/config.json),
[local models](https://docs.opensearch.org/latest/ml-commons-plugin/custom-local-models/),
[text embedding processor](https://docs.opensearch.org/latest/ingest-pipelines/processors/text-embedding/),
[reciprocal rank fusion](https://docs.opensearch.org/latest/search-plugins/search-pipelines/score-ranker-processor/).


## Offline restart verification

The explicit local test temporarily disconnects the OpenSearch node from its
application network, deploys the local model, simulates ingest and executes
hybrid search using loopback inside the container. It restores the original
network/aliases in a `finally` block. Run only against this local test stack;
search access is briefly interrupted:

```sh
docker compose up -d --no-build --pull never --force-recreate --wait opensearch
/absolute/tools/search-venv/bin/python backend/search/verify_offline.py --disconnect-node-for-test
```

Verified locally on 2026-11-04: 14 canonical messages, 92 ready narrative
passages, no failed embeddings; all 92 passages and 92 preparation audit records
passed ICD 1.1.0 validation. Repeated loads retained the same IDs and immutable
provenance. Twelve live retrieval/filter checks, escaping/bounds, long Unicode
and oversized-word chunking, inference-failure handling, and disconnected-node
restart/deployment/inference/hybrid retrieval passed. That validation preceded the Rust UI integration. The current application
uses Rust continuous publication and the v2 hybrid template; run
`python3 backend/search/verify_application_search.py` from the repository root to
check both retrieval clauses and actual RRF arithmetic without mutating data.
