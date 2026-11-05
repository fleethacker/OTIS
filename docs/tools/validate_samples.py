#!/usr/bin/env python3
"""Validate external Parse Command fixtures against the local ICD resources.

Build/test tool only. Requires jsonschema 4.x and referencing; no network access.
No fixture payloads are printed and no OpenSearch requests are made.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import sys


def read_json(path: Path):
    def reject_constant(value):
        raise ValueError(f"Non-finite JSON constant {value}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)


def read_lines(path: Path):
    result = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            raise ValueError(f"{path.name}:{number}: blank NDJSON line")
        result.append(json.loads(line, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value))))
    return result


def require(condition, message):
    if not condition:
        raise ValueError(message)


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", required=True, type=Path, help="External parsed fixture directory")
    parser.add_argument("--schemas", type=Path, default=Path(__file__).resolve().parents[1] / "schemas")
    parser.add_argument("--raw-source-dir", type=Path, help="Optionally compare original .txt files to preserved source hashes")
    args = parser.parse_args()
    try:
        from jsonschema import Draft202012Validator, FormatChecker
        from referencing import Registry, Resource
    except ImportError as error:
        raise ValueError("Install the build/test dependency jsonschema>=4.18,<5; this is not a runtime dependency") from error

    registry = Registry()
    resources = {}
    for path in sorted(args.schemas.glob("*.schema.json")):
        schema = read_json(path)
        Draft202012Validator.check_schema(schema)
        resources[schema["$id"]] = schema
        registry = registry.with_resource(schema["$id"], Resource.from_contents(schema))
    validators = {}
    for kind in ["message", "passage", "audit-event"]:
        schema = resources[f"urn:parse-command:icd:1.3.0:{kind}"]
        validators[kind] = Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())

    messages = read_lines(args.samples / "messages.ndjson")
    passages = read_lines(args.samples / "passages.ndjson")
    audit = read_lines(args.samples / "audit/events.ndjson")
    datasets = {"messages": messages, "passages": passages, "audit": audit}
    for kind, records in [("message", messages), ("passage", passages), ("audit-event", audit)]:
        seen = set()
        for number, record in enumerate(records, 1):
            errors = sorted(validators[kind].iter_errors(record), key=lambda error: str(list(error.path)))
            require(not errors, f"{kind} #{number}: schema error at {list(errors[0].path) if errors else []}: {errors[0].validator if errors else ''}")
            require(record["id"] not in seen, f"Duplicate {kind} ID")
            seen.add(record["id"])

    forbidden = {"evidence", "field_positions", "source_spans", "context_record_ids", "raw_text", "diagnostics", "records", "parsing", "interpretation"}
    def check_core(value):
        if isinstance(value, dict):
            require(not forbidden.intersection(value), "Audit detail leaked into a core object")
            for nested in value.values():
                check_core(nested)
        elif isinstance(value, list):
            for nested in value:
                check_core(nested)
    for record in messages + passages:
        check_core(record)

    parents = {(m["id"], m["revision"]): m for m in messages}
    require(len(parents) == len(messages), "Duplicate message/revision")
    ordinals = set()
    for p in passages:
        key = (p["message_id"], p["revision"])
        require(key in parents, "Passage has no parent revision")
        parent = parents[key]
        for pkey, mkey in [("type", "type"), ("subject", "subject"), ("originator", "originator"), ("issued_at", "issued_at"),
                           ("expires_at", "expires_at"), ("security", "security"), ("command_ids", "command_ids")]:
            require(p[pkey] == parent[mkey], f"Passage/parent {pkey} mismatch")
        ordinal = (*key, p["ordinal"])
        require(ordinal not in ordinals, "Duplicate passage ordinal")
        ordinals.add(ordinal)

    for message in messages:
        key = (message["id"], message["revision"])
        events = [e for e in audit if (e["message_id"], e["revision"]) == key]
        require(bool(events), "Missing audit for message revision")
        sources = [e for e in events if e["kind"] == "source_preserved"]
        parses = [e for e in events if e["kind"] == "parse_completed"]
        require(len(sources) == 1 and len(parses) == 1, "Fixture requires one preserved source and completed parse per revision")
        source = sources[0]["payload"]["source"]
        data = source["raw_text"].encode("utf-8")
        digest = hashlib.sha256(data).hexdigest()
        require(digest == source["sha256"] == message["id"].split(":", 1)[1], "Source hash mismatch")
        require(len(data) == source["byte_length"], "Source byte length mismatch")
        if args.raw_source_dir:
            filename = source["filename"]
            require(Path(filename).name == filename, "Source filename must not traverse directories")
            original = args.raw_source_dir / filename
            require(hashlib.sha256(original.read_bytes()).hexdigest() == digest, "Original source file differs from preserved fixture source")
        records = parses[0]["payload"]["records"]
        record_map = {r["id"]: r for r in records}
        require(len(record_map) == len(records), "Duplicate source record ID")
        cursor = 0
        for record in records:
            span = record["span"]
            start, end = span["start_byte"], span["end_byte"]
            require(cursor <= start < end <= len(data), "Invalid source span")
            require(not data[cursor:start].strip(), "Non-whitespace source bytes omitted")
            raw = data[start:end].decode("utf-8")
            require(raw.startswith(record["set_id"] + "/") and raw.endswith("//"), "Record span does not match set")
            require(span["start_line"] == data[:start].count(b"\n") + 1, "Start line mismatch")
            require(span["end_line"] == data[:end].count(b"\n") + 1, "End line mismatch")
            cursor = end
        require(not data[cursor:].strip(), "Source tail not preserved")

        subjects = [f["id"] for name in ["periods", "frequencies", "activities", "contacts", "locations", "recurrences"] for f in message.get(name, [])]
        require(len(subjects) == len(set(subjects)), "Duplicate core subject ID")
        facts = [e for e in events if e["kind"] == "fact_interpreted"]
        require({e.get("subject_id") for e in facts} == set(subjects), "Core/audit subject set mismatch")
        require(len(facts) == len(subjects), "Duplicate core subject audit")
        for event in facts:
            detail = event["payload"]["original_fact"]
            require(detail["evidence"]["record_id"] in record_map, "Unknown evidence record")
            record = record_map[detail["evidence"]["record_id"]]
            require(all(1 <= position <= len(record["fields"]) for position in detail["evidence"].get("field_positions", [])), "Evidence field out of range")
        for event in events:
            require(event["security"] == message["security"], "Audit security projection mismatch")
            if event["kind"] == "search_projection_prepared":
                for projection in event["payload"]["passages"]:
                    require(any(p["id"] == projection["id"] and (p["message_id"], p["revision"]) == key for p in passages), "Audit passage link missing")
                    for span in projection["source_spans"]:
                        require(0 <= span["start_byte"] < span["end_byte"] <= len(data), "Audit passage span out of bounds")

        if message["issued_at"] is None:
            require(message["expires_at"] is None, "Unresolved issue date has an expiry")
        else:
            require(dt(message["expires_at"]) == dt(message["issued_at"]) + timedelta(days=365), "Expiry not 365 elapsed days from issue")
        for frequency in message["frequencies"]:
            if "upper_hz" in frequency:
                require(frequency["hz"] is not None and frequency["upper_hz"] >= frequency["hz"], "Invalid frequency range")
        for item in message["periods"] + message["activities"]:
            for endpoint in ["start", "end", "as_of", "deadline"]:
                at, status = item.get(endpoint + "_at"), item.get(endpoint + "_status")
                require(not (at and status in ["missing_date", "missing_date_and_zone", "missing_month_and_year", "unresolved"]), "Resolved time has unresolved endpoint status")
            if item.get("start_at") and item.get("end_at"):
                require(dt(item["end_at"]) >= dt(item["start_at"]), "End precedes start")

    for event in audit:
        require((event["message_id"], event["revision"]) in parents, "Orphan fixture audit entry")
    manifest = read_json(args.samples / "manifest.json")
    for field, actual in [("message_count", len(messages)), ("passage_count", len(passages)), ("audit_event_count", len(audit))]:
        require(manifest[field] == actual, f"Manifest {field} mismatch")
    for kind, documents in datasets.items():
        path = args.samples / "bulk" / (kind + ".bulk.ndjson")
        require(path.read_bytes().endswith(b"\n"), "Bulk file missing terminal newline")
        lines = read_lines(path)
        require(len(lines) == 2 * len(documents), "Bulk action count mismatch")
        for number, document in enumerate(documents):
            operation = "create" if kind == "audit" else "index"
            action = lines[2 * number][operation]
            require(action["_index"] == manifest["index_aliases"][kind], "Wrong Bulk target alias")
            require(action["_id"] == document["id"] and len(action["_id"].encode()) <= 512, "Invalid Bulk ID")
            require(lines[2 * number + 1] == document, "Bulk source differs from fixture")
    files = list((args.samples / "messages").glob("*.json"))
    require(len(files) == len(messages), "Per-message fixture count mismatch")
    for path in files:
        document = read_json(path)
        require(document == parents[(document["id"], document["revision"])], "Per-message fixture mismatch")
    passage_files = list((args.samples / "passages").glob("*.json"))
    require(len(passage_files) == len(passages), "Per-passage fixture count mismatch")
    passage_lookup = {p["id"]: p for p in passages}
    for path in passage_files:
        document = read_json(path)
        require(document == passage_lookup[document["id"]], "Per-passage fixture mismatch")

    # Reject representative invalid payloads so a permissive/broken schema is not mistaken for validation.
    probes = []
    bad = dict(messages[0]); bad["evidence"] = {}; probes.append(("message", bad))
    bad = dict(passages[0]); bad["embedding_status"] = "ready"; bad.pop("embedding", None); probes.append(("passage", bad))
    bad = dict(audit[0]); bad.pop("payload"); probes.append(("audit-event", bad))
    for kind, bad in probes:
        require(not validators[kind].is_valid(bad), f"Invalid {kind} accepted")
    print(json.dumps({"icd_version": "1.3.0", "schemas": len(resources), "messages": len(messages),
                      "passages": len(passages), "audit_events": len(audit), "result": "PASS",
                      "checks": ["JSON Schema and negative probes", "source hashes/spans", "core/audit/parent linkage",
                                 "time/frequency invariants", "Bulk framing/IDs/aliases"],
                      "not_run": ["live OpenSearch indexing", "embedding inference", "SME semantic validation", "Rust SDK integration"]}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError) as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
