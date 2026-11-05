#!/usr/bin/env python3
"""Replay explicit ANCHOR declarations against an isolated local, authenticated app.

Source files must first pass through priority_scenario and the normal publisher.
This tool writes only workflow declarations/clock, never parsed message documents.
"""
import argparse
import http.cookiejar
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=["original", "amendment", "cancellation", "ambiguous"])
    parser.add_argument("--base-url", required=True, help="Isolated local UI origin, including port")
    parser.add_argument("--cookie-file", help="Netscape cookie file containing an authenticated admin session")
    parser.add_argument("--register-only", action="store_true", help="Keep the current clock to exercise future effective times")
    args = parser.parse_args()
    origin = args.base_url.rstrip("/")
    url = urlsplit(origin)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"} or url.path or url.username:
        parser.error("Use a loopback-only isolated local HTTP origin")
    jar = http.cookiejar.MozillaCookieJar()
    if args.cookie_file:
        jar.load(args.cookie_file, ignore_discard=True, ignore_expires=False)
    client = build_opener(HTTPCookieProcessor(jar))

    def call(route, body):
        request = Request(origin + "/api/v1/" + route, data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json", "Origin": origin})
        try:
            with client.open(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            details = json.load(error)
            raise SystemExit(f"{error.code}: {details.get('message', 'Request failed')}") from None

    work = call("work/list", {})
    if not work.get("configured"):
        raise SystemExit("Run the Agent 1 setup and parser/publication replay first")
    call("anchor/setup", {"expectedVersion": work["version"]})
    if args.stage != "original":
        bindings = json.loads((Path(__file__).resolve().parents[1] / "config/priority-2/sources.json").read_text())
        name = "conflicting-amendment" if args.stage == "ambiguous" else args.stage
        source = next(row for row in bindings if row["name"] == name)
        current = call("anchor/current", {})
        cancel = args.stage == "cancellation"
        call("anchor/declare", {
            "expectedVersion": current["version"], "logicalEventId": source["logicalEventId"],
            "versionId": name, "source": {"messageKey": source["sourceKey"], "factId": source["factId"]},
            "relationship": {"kind": "cancels" if cancel else "amends", "target": "amendment" if cancel else "original"},
            "effectiveAt": "2026-11-10T09:30:00Z" if cancel else "2026-11-10T08:30:00Z",
            "provenance": "Explicit whole-event relationship in the authored priority-2 synthetic scenario; no amendment-language inference",
        })
        if not args.register_only:
            current = call("anchor/current", {})
            target = "2026-11-10T09:30:00.000Z" if cancel else "2026-11-10T08:45:00.000Z"
            if current["scenarioNow"] < target:
                call("work/clock", {"expectedVersion": current["version"], "scenarioNow": target})
    current = call("anchor/current", {})
    print(json.dumps(current, indent=2))


if __name__ == "__main__":
    main()
