# Sample-data location

The compact JSON structure is approved and specified by [ICD 1.0.0](../../ICD.md), [JSON Schemas](../../schemas/README.md), and [UI test mappings](../../opensearch/README.md).

All raw and parsed sample traffic stays outside the Git folder. From the Parse-Command checkout, the locations are:

- Raw text: `../OPTASK_Messages`
- Parsed JSON, audit entries and OpenSearch Bulk files: `../OPTASK_Messages/parsed`

The external parsed directory contains its own README, manifest, per-message/per-passage JSON, collection NDJSON, Bulk request files, validation results and checksums. It includes 14 messages, 151 passages and 115 audit events preserving 462 source records. The supplied sources are body-only, so email subjects are null; no subjects or embeddings were fabricated.

Earlier review payloads have been relocated out of this documentation directory. This signpost intentionally contains no sample payloads.
