#!/usr/bin/env python3
"""Inventory every original export member without copying corpus content to docs."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL_ONLY = {
    "internal/service/testdata/structured-messages.json",
    "ui/tests/journey/fixtures/present-extensible-structured-message-cards.json",
}


def classify(path):
    name = PurePosixPath(path).name
    if path.startswith(".ark-handoff/"):
        return "approved-context", "Export provenance and approved product intent"
    if path in ("AGENTS.md", "CLAUDE.md", "docs/ark-handoff.md"):
        return "guidance", "Public application instructions and build/handoff constraints"
    if path.startswith(("ark/pipeline", "ark/hooks/", "ark/codegen/")) or path == "ark/boot-readiness.json":
        return "framework-tooling", "Read-only Ark build, generation, validation or hook tooling"
    if path.startswith("ark/go/"):
        return "framework-go", "Read-only Ark startup, identity, SQLite, RPC, jobs or diagnostics"
    if path.startswith("ark/ui/"):
        return "framework-react", "Read-only Ark providers, identity, RPC, icons and theme primitives"
    if path.startswith("ent/schema/"):
        return "editable-schema", "Editable ENT schema: " + name
    if path.startswith(("ent/", "gen/", "ui/src/gen/")) or path == "ui/src/route-registry.generated.ts":
        return "generated", "ENT, protobuf, Connect client or route output; regenerate from source"
    if path.startswith("proto/"):
        return "editable-proto", "Presentation RPC schema; separate from the ICD JSON contract"
    if path.endswith("_test.go") or ".test." in path or path.startswith("ui/tests/"):
        return "test", "Unit, persistence, contract or browser regression: " + name
    if path.startswith("internal/service/testdata/"):
        return "test-input", "Reference fixture or developer fixture generator; not ingestion"
    if path == "internal/data/seed_data.json":
        return "fictional-seed", "Fictional USS Meridian SQLite seed; not operational imports"
    if path.startswith("internal/"):
        return "application-go", "Application handler, source validation, errors or registry: " + name
    if path.startswith("ui/src/"):
        return "application-react", "Application page, component, routing, identity or styling: " + name
    if path.startswith("docs/") or path.endswith(".md") or path == "LICENSE":
        return "documentation", "Application documentation, design history, licensing or handoff"
    return "build-input", "Entry point, pinned dependencies, workspace or codegen configuration"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    counts = Counter()
    total_bytes = 0
    jsonc = []
    rows = ["archive_path\tdestination\tbytes\tsha256_original\tcategory\tdisposition\tresponsibility"]
    with tarfile.open(args.archive, "r:gz") as archive:
        for member in sorted(archive.getmembers(), key=lambda item: item.name):
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or ".." in path.parts:
                raise SystemExit("Expected safe regular file: " + member.name)
            data = archive.extractfile(member).read()
            data.decode("utf-8")
            if path.suffix == ".json":
                try:
                    json.loads(data)
                except json.JSONDecodeError:
                    # Several tooling .json files intentionally use JSONC.
                    jsonc.append(member.name)
            category, purpose = classify(member.name)
            counts[category] += 1
            total_bytes += len(data)
            destination = ROOT / "apps/watch-desk" / member.name
            if member.name in LOCAL_ONLY:
                disposition = "local-only ignored external corpus"
            elif not destination.exists():
                disposition = "missing"
            elif destination.read_bytes() != data:
                disposition = "integration edit; original retained in archive"
            else:
                disposition = "preserved source"
            rows.append("\t".join([
                member.name, str(destination.relative_to(ROOT)), str(len(data)),
                hashlib.sha256(data).hexdigest(), category, disposition, purpose,
            ]))
    output = ROOT / "docs/integration"
    output.mkdir(parents=True, exist_ok=True)
    (output / "ark-export-files.tsv").write_text("\n".join(rows) + "\n")
    summary = {
        "archive": args.archive.name,
        "archive_sha256": hashlib.sha256(args.archive.read_bytes()).hexdigest(),
        "files": sum(counts.values()), "uncompressed_bytes": total_bytes,
        "categories": dict(sorted(counts.items())),
        "non_strict_json_tooling_files": jsonc,
    }
    (output / "ark-export-provenance.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
