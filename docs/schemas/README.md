# Parsed-message schemas — ICD 1.2.0

The [ICD](../ICD.md) defines semantics and contributor obligations. These Draft 2020-12 JSON Schemas define the approved wire shape:

| Entry schema | Resource ID | Document |
| --- | --- | --- |
| [message.schema.json](message.schema.json) | `urn:parse-command:icd:1.2.0:message` | Compact user-facing message |
| [passage.schema.json](passage.schema.json) | `urn:parse-command:icd:1.2.0:passage` | Lexical/vector search passage |
| [audit-event.schema.json](audit-event.schema.json) | `urn:parse-command:icd:1.2.0:audit-event` | Audit envelope with opaque evidence payload |
| [types.schema.json](types.schema.json) | `urn:parse-command:icd:1.2.0:types` | Shared type definitions |

Version 1.2 adds optional `recurrences` with `rN` fact IDs; existing activity fields
are unchanged. Source spans and parser-rule provenance remain in linked audit.
Unsupported rules/missing anchors must remain visible review, never acquire an
issue/receipt-time anchor. See the ICD recurrence section for the bounded Zulu
convention and the distinction from a full iCalendar component.

Register all resources locally; references are URNs, not URLs to fetch. Enable `date-time` format checking in addition to structural validation. JSON parsing must reject NaN/Infinity, and the host must enforce finite vectors and the selected model dimension.

Core objects reject extra properties. Arrays can be empty; required nullable fields retain explicit nulls. Short fact IDs are scoped by message/revision. Generic parser-specific detail belongs in audit rather than arbitrary new indexed core properties.

Schema cannot establish source authority, correct profile selection, valid command routing, interval ordering, exact expiry arithmetic or cross-document consistency. The [validation tool](../tools/validate_samples.py) checks the fixture-specific invariants in addition to schema rules. Operational interpretation still requires the source definitions/SME.

Build/test dependency: `jsonschema>=4.18,<5` and its dependencies. This is not a runtime dependency of the Rust server. Invoke from the Git folder:

```sh
python3 docs/tools/validate_samples.py --samples ../OPTASK_Messages/parsed
```

Fixtures are deliberately outside Git. See their external README for load commands; index mapping bodies are in [docs/opensearch](../opensearch/README.md).
