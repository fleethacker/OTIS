# UI fixture index mappings

The 1.2 extension adds nested `recurrences` to messages. The Rust publisher checks
an existing 1.1/1.2 message mapping before an additive upgrade; it does not delete or
recreate the index, change other properties, or reset volumes. An incompatible
existing recurrence field or unrecognized schema requires operator migration.
Timeline candidate reads include recurrence-only and unanchored records; exact
window expansion and unsupported-rule review happen in Rust under the shared fact
bound. This is a bounded candidate read, not an unbounded/global recurrence total.

These index-creation bodies implement the compact [ICD 1.2.0](../ICD.md) shape for an isolated UI test dataset. They contain no sample messages. Raw and parsed fixtures remain outside Git at `../OPTASK_Messages/parsed` relative to the repository.

| Creation body | Suggested backing index | Alias |
| --- | --- | --- |
| [messages.ui-index.json](messages.ui-index.json) | `parse-command-ui-messages-v1` | `parse-command-ui-messages` |
| [passages.ui-index.json](passages.ui-index.json) | `parse-command-ui-passages-v1` | `parse-command-ui-passages` |
| [audit.ui-index.json](audit.ui-index.json) | `parse-command-ui-audit-v1` | `parse-command-ui-audit` |

Core objects have explicit mappings and `dynamic: strict`. Period/frequency/activity/contact tuples are nested where association matters; raw evidence is not nested/indexed. Audit `payload` is stored with `enabled: false`; lookup/security/time metadata remains searchable. Date mappings accept UTC ISO instants with or without fractional seconds; the JSON Schema additionally requires full date-times ending in Z.

The original fixture passage profile is lexical-only: `text` and `subject` are text fields for BM25, vectors are absent, and `embedding_status` is pending. The body-only fixtures have null subjects. Once a model/dimension/engine is selected, create a compatible vector mapping and local inference/search pipelines before semantic/hybrid queries are enabled. Do not add a dummy dimension, model ID or vector to make a test request succeed.

No production shard/replica, lifecycle, authentication or resource settings are selected here. In particular, **no retention policy is attached**, because the fixtures have historical issue/expiry dates and must remain inspectable for UI development. This is an explicit fixture profile, not a change to operational 90-hot/365-total issue-time retention.

The external fixture directory contains `bulk/messages.bulk.ndjson`, `bulk/passages.bulk.ndjson` and optional `bulk/audit.bulk.ndjson`, targeting the aliases above. Its README supplies commands for a user-selected endpoint. NDJSON collection files are not interchangeable with Bulk action/source files.

Core Bulk operations use `index` with stable IDs for repeatable fixture loads. Audit uses immutable `create`; a repeated audit load can return item-level 409s. Do not suppress those blindly: verify existing immutable source equality before treating a conflict as an idempotent replay. Inspect every Bulk response item even when the HTTP response succeeds.

If an index already exists, inspect its `_mapping`/contract metadata before reusing it; creation commands do not overwrite or reset it. No existing cluster or index was changed during preparation of these files.


## Local semantic and hybrid search

The [search contract](search-contract.md) and [bootstrap tools](../../backend/search/README.md)
add a separate vector passage generation for the approved CPU MiniLM model.
Bootstrap installs a local text-embedding ingest pipeline and versioned keyword,
semantic and hybrid stored templates. Historical lexical fixtures retain their
original mappings. The root OpenSearch image packages native inference assets
at build time and disables downloads at runtime. See the tools' runbook for
explicit offline provisioning, snapshot loading and live verification.
