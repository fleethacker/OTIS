#!/usr/bin/env python3
"""Real HTTP authorization/schema/version checks against an isolated PB4T app."""
import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("replay_priority3", ROOT / "backend/tools/replay_priority3.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    parsed = module.urlsplit(args.base_url)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or not parsed.port or parsed.path not in {"", "/"} or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        parser.error("An isolated loopback HTTP origin with an explicit port is required")
    settings = SimpleNamespace(base_url=args.base_url, cookie_file=None,
                               config_root=ROOT / "backend/config", demo_login=True)
    admin = module.Replay(settings)
    admin.login()  # Confirms local-demo mode before submitting a role.
    before = admin.post("planning/read")
    checks = []

    def expect(name, expected, client, route, body, origin=None):
        request = Request(client.origin + "/api/v1/" + route,
                          data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json",
                                   "Origin": origin or client.origin})
        try:
            with client.client.open(request, timeout=30) as response:
                status = response.status
                response.read()
        except HTTPError as error:
            status = error.code
            error.read()
        checks.append({"name": name, "expected": expected, "actual": status, "passed": status == expected})
        assert status == expected, f"{name}: expected {expected}, got {status}"

    anonymous = module.Replay(settings)
    expect("Anonymous planning read denied", 401, anonymous, "planning/read", {})
    viewer = module.Replay(settings)
    viewer.call("/__ark/mock-login", {"role": "viewer", "return": "/calendar"}, form=True, parse_json=False)
    expect("Scoped viewer can inspect planning", 200, viewer, "planning/read", {})
    for operation in ("setup", "propose", "decide", "personnel"):
        expect(f"Viewer cannot {operation}", 403, viewer, "planning/" + operation,
               {"expectedVersion": before["version"]})
    expect("Client cannot forge a decision actor", 422, admin, "planning/decide",
           {"expectedVersion": before["version"], "actor": "forged"})
    expect("Unknown constraint field rejected", 422, admin, "planning/propose",
           {"expectedVersion": before["version"], "ignoreQualification": True})
    expect("Stale aggregate version rejected", 409, admin, "planning/propose", {"expectedVersion": 0})
    expect("Cross-origin mutation rejected", 403, admin, "planning/propose",
           {"expectedVersion": before["version"]}, "http://untrusted.invalid")
    after = admin.post("planning/read")
    checks.append({"name": "Rejected requests preserve full planning view", "passed": before == after})
    assert before == after
    print(json.dumps({"passed": True, "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
