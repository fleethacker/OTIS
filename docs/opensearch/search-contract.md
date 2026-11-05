# Passage search contract v1

Search targets `parse-command-search-passages`. The cluster executes local
MiniLM inference for both ingest and query text. Canonical message and audit
indices remain separate; passage hits link to the parent through `message_id`
and `revision`. No generated vector is returned to the frontend.

The [bootstrap implementation](../../backend/search/README.md) installs these
stored Mustache templates:

| Mode | Stored template | Ranking | Request option |
| --- | --- | --- | --- |
| `keyword` | `parse-command-passages-keyword-v1` | BM25 across `text` and `subject` | No search pipeline |
| `semantic` | `parse-command-passages-semantic-v1` | Local query embedding, cosine k-NN | No search pipeline |
| `hybrid` | `parse-command-passages-hybrid-v1` | BM25 plus semantic, reciprocal rank fusion | `search_pipeline=parse-command-hybrid-rrf-v1` |

The initial RRF configuration uses OpenSearch's rank constant 60 and equal
contributions. This is a baseline for relevance evaluation, not an SME-tuned
operational ranking. All modes return at most 20 passage hits; neural branches
consider at most 100 candidates per shard. There is one test shard and no
replica. Queries have a five-second search timeout. This version supports the
first page only; offsets, arbitrary sort/DSL and unbounded candidate counts are
not part of this contract.

## Typed parameters

Use the [bounded reference caller](../../backend/search/query.py) and
[`parameters`](../../backend/search/search_config.py) as the implementation
reference. A server adapter should construct these parameters from typed input.

| Parameter | Type / bounds | Meaning |
| --- | --- | --- |
| `query` | Nonblank UTF-8 string, at most 240 bytes | Literal query text, JSON-escaped by Mustache string rendering (arrays use `toJson`) |
| `command_ids` | Array of at most 32 nonblank strings, each at most 256 UTF-8 bytes | Any exact canonical command ID |
| `types` | Same array bounds | Any exact message type, such as `OPTASK COMMS` |
| `classifications` | Same array bounds | Any exact source classification label |
| `issued_from` | Optional UTC ISO instant ending in `Z` | Inclusive USMTF issue-time lower bound |
| `issued_to` | Optional UTC ISO instant ending in `Z` | Exclusive USMTF issue-time upper bound |
| `has_command_ids`, `has_types`, `has_classifications` | Booleans computed by the caller | Whether the corresponding nonempty list is applied |

An omitted/empty list adds no restriction for that field. The trusted helper
computes the `has_*` flags; do not accept independent flags or arbitrary DSL
from browser input. Bounds and UTC/range ordering are validated by the caller,
not by Mustache. Every keyword and neural branch applies the same metadata
filters before retrieval. Neural branches additionally require
`embedding_status=ready`. Missing issue times do not match an issue-time range.
These filters describe retrieval; they do not establish an access grant.
Current source markings and command mappings retain their existing review states.

Example hybrid request:

```http
POST /parse-command-search-passages/_search/template?search_pipeline=parse-command-hybrid-rrf-v1&allow_partial_search_results=false
Content-Type: application/json

{
  "id": "parse-command-passages-hybrid-v1",
  "params": {
    "query": "communications handover",
    "command_ids": [],
    "has_command_ids": false,
    "types": ["OPTASK COMMS"],
    "has_types": true,
    "classifications": [],
    "has_classifications": false
  }
}
```

Use the keyword or semantic template ID and omit `search_pipeline` for those
modes. The template embeds the bootstrap-selected model ID; frontend callers
do not select arbitrary models. An issue-time filter is optional for the
historical test corpus. The current sample command IDs can be unresolved;
filtering does not infer assignments from a mentioned unit.

## Response and failure handling

Consume `hits.hits[*]._score` and the selected `_source` fields: passage `id`,
`message_id`, `revision`, `ordinal`, `type`, `originator`, issue/expiry times,
security/command metadata, `subject`, `text` and `embedding_status`.
`query.py` wraps these in `requested_mode`, `executed_mode`, `took_ms`,
`page_limit`, `pagination` and `hits`. A passage score does not confirm a
scheduled event. Multiple matching passages may belong to one message; grouping
within the returned page is a presentation choice and not global message
pagination or a complete parent count. Total hits are deliberately not tracked.

Reject HTTP errors, timed-out responses and failed shards instead of displaying
them as complete results. Keyword mode remains independent of model readiness.
Semantic/hybrid model failures return errors; there is no silent fallback. An
adapter may explicitly retry keyword search only if it reports the changed
executed mode and reason to the user. Failed passage embeddings leave their
text available for keyword retrieval, with visible status.

Detailed source spans stay in `passage_prepared` audit payloads keyed by
`payload.passage_id`, parent and revision. The audit payload is deliberately
not indexed: retrieve bounded message/revision audit records and select the
passage entry in the trusted backend. Search responses do not copy the source
body or token evidence. Resolve the canonical message with the exact parent
and revision rather than treating a passage as the authoritative record.

The current Rust application uses the v2 passage templates with a larger
candidate window, plus list/detail/timeline/evidence/status templates. See the
[application API](../integration/rust-application-api.md). The v1 templates above
remain a diagnostic compatibility contract. Continuous publication is active;
validation indices intentionally retain historical messages without expiry.

## CASREP metadata (ICD 1.2.0)

CASREP source sets join narrative passages. Compact casualty metadata provides
identical serial/UIC/category/action/EIC/identifier filters in keyword and semantic
branches; canonical results are checked again. Keyword search boosts an exact
`casualty.identifiers` match. The canonical index uses nested logistics/publication
arrays; the passage stores only filter fields. See the [CASREP contract](../integration/casrep.md)
for the separately rebuildable source-history index and unresolved-history rules.
