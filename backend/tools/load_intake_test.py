#!/usr/bin/env python3
"""Load an intake journal into isolated local test indices; never acknowledge the runtime outbox."""
import argparse
import json
from pathlib import Path
import sqlite3
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:9200"
ROOT = Path(__file__).resolve().parents[2]


def request(method, path, body=None, ndjson=False):
    if body is not None and not isinstance(body, bytes):
        body = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=body, method=method,
        headers={"Content-Type": "application/x-ndjson" if ndjson else "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        data = response.read(8_388_609)
        if len(data) > 8_388_608:
            raise RuntimeError("response_limit")
        return json.loads(data)


def bulk(rows, index):
    batch = bytearray()
    count = 0
    total = 0

    def flush():
        result = request("POST", "/_bulk", bytes(batch), True)
        items = result.get("items", [])
        if len(items) != count or any(item.get("index", {}).get("status") not in (200, 201) for item in items):
            raise RuntimeError("bulk_item_failure")

    for doc_id, source in rows:
        entry = (json.dumps({"index": {"_index": index, "_id": doc_id}}) + "\n" + source + "\n").encode()
        if len(entry) > 2_097_152:
            raise RuntimeError("single_document_limit")
        if count and (count >= 100 or len(batch) + len(entry) > 2_097_152):
            flush()
            total += count
            batch.clear()
            count = 0
        batch.extend(entry)
        count += 1
    if count:
        flush()
        total += count
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("journal", type=Path)
    args = parser.parse_args()
    # Preflight before any mutation. Endpoint is deliberately fixed to the local demo.
    info = request("GET", "/")
    health = request("GET", "/_cluster/health")
    if health.get("status") not in ("green", "yellow"):
        raise RuntimeError("cluster_not_ready")
    names = {"messages": "parse-command-intake-test-messages-v1", "audit": "parse-command-intake-test-audit-v1"}
    for kind, name in names.items():
        definition = json.loads((ROOT / "docs/opensearch" / ("messages.ui-index.json" if kind == "messages" else "audit.ui-index.json")).read_text())
        definition["aliases"] = {}
        definition["settings"] = {"number_of_shards": 1, "number_of_replicas": 0}
        try:
            request("GET", "/" + name)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            request("PUT", "/" + name, definition)
        else:
            request("PUT", "/" + name + "/_mapping", definition["mappings"])
    # Permit SQLite to initialize WAL sidecars, while prohibiting SQL mutations.
    db = sqlite3.connect(args.journal.resolve().as_uri() + "?mode=rw", uri=True)
    db.execute("PRAGMA query_only=ON")
    messages = bulk(((m + ":" + rev, core) for m, rev, core in db.execute("SELECT message_id,revision,core FROM projections ORDER BY message_id,revision")), names["messages"])
    audits = bulk(db.execute("SELECT id,document FROM audit_outbox ORDER BY id"), names["audit"])
    request("POST", "/" + ",".join(names.values()) + "/_refresh")
    # Actual indexed geographic query, independent of vector inference.
    mapped = request("POST", "/" + names["messages"] + "/_search", {"size": 0, "query": {"nested": {"path": "locations", "query": {"bool": {"should": [{"exists": {"field": "locations.point"}}, {"exists": {"field": "locations.shape"}}], "minimum_should_match": 1}}}}})
    points = request("POST", "/" + names["messages"] + "/_search", {"size": 0, "query": {"nested": {"path": "locations", "query": {"geo_bounding_box": {"locations.point": {"top_left": {"lat": 90, "lon": -180}, "bottom_right": {"lat": -90, "lon": 180}}}}}}})
    shapes = request("POST", "/" + names["messages"] + "/_search", {"size": 0, "query": {"nested": {"path": "locations", "query": {"geo_shape": {"locations.shape": {"shape": {"type": "envelope", "coordinates": [[-180, 90], [180, -90]]}, "relation": "intersects"}}}}}})
    print(json.dumps({"version": info.get("version", {}).get("number"), "messages_written": messages,
        "audit_written": audits, "messages_with_indexed_geometry": mapped["hits"]["total"], "indices": names,
        "point_query_hits": points["hits"]["total"], "shape_query_hits": shapes["hits"]["total"],
        "runtime_outbox": "unchanged_pending", "retention": "test_indices_only_no_expiry"}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        # Do not print HTTP bodies, message documents, credentials or SQLite bindings.
        raise SystemExit("intake_test_load_failed: " + type(error).__name__)
