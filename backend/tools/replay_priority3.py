#!/usr/bin/env python3
"""Replay and verify the three synthetic Meridian integrations against a local app.

Prerequisites: publish priority-1 and priority-2 sources through priority_scenario
and the normal Rust publisher into isolated state. This script never imports,
rewrites, resets or deletes source/workflow data. --stage conflict prepares the
calendar for a human decision; accept/cancel continue it. verify is read-only.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import json
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import (
    HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener,
)

INITIAL = "2026-11-10T08:15:00Z"
AMENDED_AT = "2026-11-10T09:01:00Z"
CANCELLED_AT = "2026-11-10T09:30:00Z"
EVENT = "meridian-2026-11-10:original"


class DemoError(Exception):
    """An explicit unmet replay prerequisite or failed answer-key check."""


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def interval_matches(value, start, end):
    return isinstance(value, dict) and (
        instant(value["start"]) == instant(f"2026-11-10T{start}:00Z")
        and instant(value["end"]) == instant(f"2026-11-10T{end}:00Z")
    )


class LocalRedirects(HTTPRedirectHandler):
    def __init__(self, origin):
        super().__init__()
        self.origin = origin

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        if (parsed.scheme, parsed.netloc) != (self.origin.scheme, self.origin.netloc):
            raise DemoError("Refusing a redirect outside the selected local app origin")
        if urlsplit(req.full_url).path == "/__ark/mock-login":
            # Keep the session cookie without following the SPA redirect; this
            # also supports isolated Rust API listeners without static assets.
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Replay:
    def __init__(self, args):
        self.args = args
        self.origin = args.base_url.rstrip("/")
        self.jar = http.cookiejar.MozillaCookieJar()
        if args.cookie_file:
            self.jar.load(args.cookie_file, ignore_discard=True, ignore_expires=False)
        self.client = build_opener(LocalRedirects(urlsplit(self.origin)), HTTPCookieProcessor(self.jar))
        self.started = time.perf_counter()
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.checks = []
        self.calls = []
        self.source_before = {}
        self.source_evidence = []
        self.bindings = {}
        for priority in (1, 2):
            path = args.config_root / f"priority-{priority}" / "sources.json"
            for row in json.loads(path.read_text()):
                self.bindings[row["name"]] = row

    def call(self, route, body=None, *, form=False, parse_json=True):
        headers = {"Origin": self.origin}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
            data = (urlencode(body) if form else json.dumps(body)).encode()
        request = Request(self.origin + route, data=data, headers=headers)
        started = time.perf_counter()
        status = None
        try:
            with self.client.open(request, timeout=30) as response:
                status = response.status
                content = response.read()
                return json.loads(content) if parse_json else content
        except HTTPError as error:
            status = error.code
            if form and not parse_json and error.code in (302, 303):
                return b""
            try:
                message = json.load(error).get("message", "Request failed")
            except (ValueError, AttributeError):
                message = "Request failed"
            raise DemoError(f"HTTP {error.code} at {route}: {message}") from None
        except URLError as error:
            raise DemoError(f"Local app unavailable at {route}: {error.reason}") from None
        finally:
            self.calls.append({"route": route, "status": status, "seconds": round(time.perf_counter() - started, 4)})

    def post(self, route, body=None):
        return self.call("/api/v1/" + route, {} if body is None else body)

    def check(self, name, condition, observed=None):
        row = {"name": name, "passed": bool(condition), "elapsedSeconds": round(time.perf_counter() - self.started, 4)}
        if observed is not None:
            row["observed"] = observed
        self.checks.append(row)
        if not condition:
            raise DemoError(name)

    def login(self):
        if self.args.demo_login:
            # This route is unavailable outside local_demo. No role or credential
            # form is submitted until the server confirms demo role support.
            roles = self.call("/__ark/mock-roles")
            self.check("Server explicitly permits local demo login", any(row.get("name") == "admin" for row in roles.get("roles", [])))
            self.call("/__ark/mock-login", {"role": "admin", "return": "/calendar"}, form=True, parse_json=False)
        session = self.call("/auth/session")
        self.check("Authenticated local-demo administrator", session.get("mode") == "local_demo" and session.get("identity", {}).get("role") == "admin" and isinstance(session.get("userId"), str) and bool(session["userId"]))
        self.actor = session["userId"]

    def source(self, name):
        key = self.bindings[name]["sourceKey"]
        result = self.post("messages/detail", {"key": key})
        rows = [row for row in result.get("messages", []) if row.get("sourceMessageId") == key]
        if len(rows) != 1 or not isinstance(rows[0].get("rawText"), str) or not rows[0]["rawText"]:
            raise DemoError(f"Readable {name} source missing; run parser/publication replay before this script")
        raw = rows[0]["rawText"]
        digest = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()
        self.check(f"{name} source body matches its exact content identity", digest == key.rsplit("@", 1)[0])
        return raw, {"name": name, "sourceKey": key, "contentSha256": digest, "utf8Bytes": len(raw.encode())}

    def capture_sources(self):
        for name in ("original", "amendment", "cancellation"):
            raw, evidence = self.source(name)
            self.source_before[name] = raw
            self.source_evidence.append(evidence)

    def unchanged_sources(self):
        for name, before in self.source_before.items():
            after, _ = self.source(name)
            self.check(f"{name} source body remained byte-for-byte unchanged during this run", before == after)

    def work(self):
        return self.post("work/list")

    def current(self):
        return self.post("anchor/current")

    def event(self, response=None):
        response = self.current() if response is None else response
        rows = [row for row in response.get("items", []) if row.get("logicalEventId") == EVENT]
        if len(rows) != 1:
            raise DemoError("Expected exactly one ANCHOR current-event entry for Meridian communications")
        return rows[0]

    def selected_task(self, response=None):
        response = self.work() if response is None else response
        rows = [row for row in response.get("items", []) if row.get("logicalEventId") == EVENT]
        if len(rows) != 1:
            raise DemoError("Expected exactly one source-linked communications review task")
        return rows[0]

    def clock(self, value):
        work = self.work()
        if instant(work["scenarioNow"]) > instant(value):
            raise DemoError("Refusing to move the scenario clock backwards; use fresh isolated state")
        if instant(work["scenarioNow"]) < instant(value):
            self.post("work/clock", {"expectedVersion": work["version"], "scenarioNow": value})

    def declare(self, name):
        row = self.bindings[name]
        current = self.current()
        event = self.event(current)
        if any(item["id"] == name for item in event.get("history", [])):
            return
        self.post("anchor/declare", {
            "expectedVersion": current["version"], "logicalEventId": row["logicalEventId"],
            "versionId": name, "source": {"messageKey": row["sourceKey"], "factId": row["factId"]},
            "relationship": {"kind": "cancels" if name == "cancellation" else "amends", "target": "amendment" if name == "cancellation" else "original"},
            "effectiveAt": CANCELLED_AT if name == "cancellation" else "2026-11-10T08:30:00Z",
            "provenance": "Explicit authored Meridian whole-event scenario relationship; no inferred amendment language",
        })

    def fresh_through_conflict(self):
        work = self.work()
        if work.get("configured") and instant(work["scenarioNow"]) > instant(INITIAL):
            raise DemoError("all/conflict require fresh state at 08:15 with original-only lineage; no reset is performed. Use accept, cancel or verify to continue")
        current = self.current()
        if any(version.get("id") != "original" for item in current.get("items", []) for version in item.get("history", [])):
            raise DemoError("all/conflict refuse existing lineage beyond the original; select fresh isolated state")
        if not work.get("configured"):
            self.post("work/setup")
        work = self.work()
        self.check("Three source-linked tasks, unrelated traffic excluded", len(work.get("items", [])) == 3 and not any(row.get("logicalEventId") == self.bindings["unrelated"]["logicalEventId"] for row in work["items"]), len(work.get("items", [])))
        self.check("Unknown deadline remains explicit", any(row.get("dueAt") is None for row in work["items"]))
        self.check("Unassigned owner remains explicit", any(row.get("ownerId") is None for row in work["items"]))
        self.post("anchor/setup", {"expectedVersion": work["version"]})
        original = self.event()
        self.check("Original communications is 09:00–09:45", original.get("status") == "active" and interval_matches(original.get("current", {}).get("interval"), "09:00", "09:45"))
        task = self.selected_task()
        progress = task["progress"]
        self.post("work/review", {"taskId": task["id"], "expectedVersion": task["version"], "eventVersion": task["eventVersion"], "currentVersionToken": original["versionToken"]})
        reviewed = self.selected_task()
        self.check("Review records reading without task completion", reviewed.get("reviewed") is True and reviewed["progress"] == progress and reviewed["progress"] != "completed")
        self.declare("amendment")
        self.clock(AMENDED_AT)
        event = self.event()
        self.check("Amendment moves exactly one current event to 10:30–11:15", event.get("status") == "active" and event.get("current", {}).get("id") == "amendment" and interval_matches(event["current"].get("interval"), "10:30", "11:15"))
        work = self.work()
        task = self.selected_task(work)
        self.check("Material amendment requires fresh review", task.get("reviewed") is False and event["versionToken"] != original["versionToken"] and len(task.get("reviews", [])) >= 1)
        self.check("09:00 local policy deadline is overdue at 09:01", task.get("overdue") is True and "local demo policy" in task.get("dueBasis", "").lower(), {"dueAt": task.get("dueAt"), "dueBasis": task.get("dueBasis"), "scenarioNow": work["scenarioNow"]})
        self.check("Repeated source materialization duplicates no tasks", len(work["items"]) == 3 and {row["id"] for row in self.work()["items"]} == {row["id"] for row in work["items"]})
        view = self.ensure_planning()
        self.check_conflict(view)
        return view

    def read_planning(self):
        return self.post("planning/read")

    def ensure_planning(self):
        view = self.read_planning()
        if not view.get("configured"):
            self.post("planning/setup", {"expectedVersion": view["version"]})
            view = self.read_planning()
        return view

    def training(self, view):
        inputs = view.get("inputs") or {}
        event_id = inputs.get("rules", {}).get("eventId")
        rows = [event for event in inputs.get("events", []) if event["id"] == event_id and event.get("fixed") is False]
        if len(rows) != 1:
            raise DemoError("Expected one movable local training event")
        return rows[0]

    def check_conflict(self, view):
        assessment = view.get("assessment") or {}
        fixed = [event for event in (view.get("inputs") or {}).get("events", []) if event.get("fixed")]
        self.check("Same actual person P-01 collides 10:45–11:15", any(row.get("personId") == "P-01" and interval_matches(row.get("overlap"), "10:45", "11:15") for row in assessment.get("collisions", [])))
        self.check("Current fixed communications retains 10:30–11:15", len(fixed) == 1 and interval_matches(fixed[0].get("interval"), "10:30", "11:15"))
        self.check("Earliest feasible alternative is 11:15–11:45", assessment.get("status") == "feasible" and interval_matches(assessment.get("alternative"), "11:15", "11:45"), {"checkedStarts": assessment.get("checkedStarts"), "explanation": assessment.get("explanation")})
        self.check("Unvalidated source calculation is labelled provisional", assessment.get("provisional") is True)

    def propose(self, view):
        candidates = [row for row in view.get("proposals", []) if row.get("status") == "pending" and row.get("inputVersion") == view.get("inputVersion")]
        if not candidates:
            self.post("planning/propose", {"expectedVersion": view["version"]})
            view = self.read_planning()
            candidates = [row for row in view.get("proposals", []) if row.get("status") == "pending" and row.get("inputVersion") == view.get("inputVersion")]
        if not candidates:
            raise DemoError("No saved pending proposal for current inputs")
        return view, candidates[-1]

    def decide(self, decision, *, verify_rejection=False):
        view = self.ensure_planning()
        if decision == "accept" and interval_matches(self.training(view).get("interval"), "11:15", "11:45"):
            self.check("Accepted local plan already persisted", any(row.get("decision") == "accept" for row in view.get("decisions", [])))
            return view
        self.check_conflict(view)
        before = copy.deepcopy(view["inputs"]["events"])
        view, proposal = self.propose(view)
        self.post("planning/decide", {"expectedVersion": view["version"], "proposalId": proposal["id"], "decision": decision, "reason": "Synthetic combined replay: preserve fixed source window and declared personnel constraints"})
        after = self.read_planning()
        records = [row for row in after.get("decisions", []) if row.get("proposalId") == proposal["id"] and row.get("decision") == decision]
        self.check(f"{decision} decision persisted with authenticated actor and input version", len(records) == 1 and records[0].get("actor") == self.actor and records[0].get("inputVersion") == proposal["inputVersion"] and bool(records[0].get("recordedAt")))
        if verify_rejection:
            self.check("Rejected proposal changes no schedule event", after["inputs"]["events"] == before)
        else:
            self.check("Acceptance updates only local training to 11:15–11:45", interval_matches(self.training(after).get("interval"), "11:15", "11:45") and [row for row in after["inputs"]["events"] if row.get("fixed")] == [row for row in before if row.get("fixed")])
            self.check("Accepted local plan survives another read", self.training(self.read_planning()) == self.training(after))
        return after

    def cancel(self):
        view = self.read_planning()
        self.check("Cancellation starts from an accepted local plan", interval_matches(self.training(view).get("interval"), "11:15", "11:45") and any(row.get("decision") == "accept" for row in view.get("decisions", [])))
        before = copy.deepcopy(self.training(view))
        self.declare("cancellation")
        self.clock(CANCELLED_AT)
        event = self.event()
        self.check("Cancellation withdraws the source-directed event", event.get("status") == "cancelled" and event.get("current", {}).get("interval") is None)
        task = self.selected_task()
        self.check("Obsolete reminders stop and cancellation review remains", task.get("remindersActive") is False and task.get("overdue") is False and task.get("reviewed") is False and task.get("instructionStatus") == "cancelled")
        after = self.read_planning()
        self.check("Cancellation preserves accepted local training", self.training(after) == before)
        self.check("Cancelled communications leaves active planning schedule", not any(event.get("fixed") for event in after["inputs"]["events"]))
        history = {row["id"] for row in event["history"]}
        self.check("Original, amendment and cancellation remain in history", {"original", "amendment", "cancellation"}.issubset(history))
        return after

    def verify(self):
        event = self.event()
        view = self.read_planning()
        self.check("Persisted planning scenario is readable", view.get("configured") is True)
        if event["status"] == "cancelled":
            self.check("Cancelled source stays out of active planning", not any(row.get("fixed") for row in view["inputs"]["events"]))
        elif event["status"] == "active" and event.get("current", {}).get("id") == "amendment":
            if interval_matches(self.training(view).get("interval"), "10:45", "11:15"):
                self.check_conflict(view)
            else:
                self.check("Persisted accepted local training has its chosen interval", interval_matches(self.training(view).get("interval"), "11:15", "11:45"))
        else:
            raise DemoError("verify expects the prepared conflict, accepted plan, or cancelled final scenario")
        self.check("All planning decisions retain actor, time and input version", all(row.get("actor") and row.get("recordedAt") and row.get("inputVersion") for row in view.get("decisions", [])))
        return view

    def run(self):
        self.login()
        self.capture_sources()
        if self.args.stage in ("all", "conflict"):
            self.fresh_through_conflict()
        if self.args.stage == "all":
            self.decide("reject", verify_rejection=True)
        if self.args.stage in ("all", "accept"):
            self.decide("accept")
        if self.args.stage in ("all", "cancel"):
            self.cancel()
        final = self.verify()
        self.unchanged_sources()
        self.final = {"scenarioNow": final["scenarioNow"], "workflowVersion": final["version"], "localTraining": self.training(final), "assessment": final.get("assessment"), "decisionCount": len(final.get("decisions", []))}

    def report(self, failure=None):
        return {
            "stage": self.args.stage, "baseUrl": self.origin,
            "passed": failure is None, "failure": failure,
            "startedAt": self.started_at, "elapsedSeconds": round(time.perf_counter() - self.started, 4),
            "passedChecks": sum(row["passed"] for row in self.checks),
            "failedChecks": sum(not row["passed"] for row in self.checks),
            "checks": self.checks, "httpCalls": self.calls,
            "sourceEvidence": self.source_evidence, "final": getattr(self, "final", None),
            "notes": [
                "Fictional November 10, 2026 UTC scenario. Planning personnel, qualification, availability and deadline policy are authored separately from parsed source messages.",
                "Recorded timings are this automated HTTP replay, not a human performance benchmark.",
                "No source data or workflow state is reset, deleted or imported by this script.",
                "Rendered UI, restart persistence, authorization and race tests are separate validation evidence.",
            ],
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Isolated loopback app origin, including port")
    parser.add_argument("--stage", choices=["all", "conflict", "accept", "cancel", "verify"], default="all")
    parser.add_argument("--cookie-file", type=Path, help="Existing Netscape cookie file for an authorized admin session")
    parser.add_argument("--demo-login", action="store_true", help="Use the explicitly confirmed local-demo admin login; cookies remain in memory")
    parser.add_argument("--config-root", type=Path, default=Path(__file__).resolve().parents[1] / "config", help="Directory containing priority-1 and priority-2 source manifests (default: backend/config)")
    args = parser.parse_args()
    parsed = urlsplit(args.base_url.rstrip("/"))
    try:
        valid = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not any((parsed.path, parsed.query, parsed.fragment, parsed.username, parsed.password)) and parsed.port is not None
    except ValueError:
        valid = False
    if not valid:
        parser.error("Use an explicit loopback-only HTTP origin and port, without path, credentials, query or fragment")
    replay = None
    try:
        replay = Replay(args)
        replay.run()
    except (DemoError, OSError, ValueError, KeyError, TypeError) as error:
        if replay is not None:
            print(json.dumps(replay.report(str(error)), indent=2))
        else:
            print(json.dumps({"passed": False, "failure": str(error)}, indent=2))
        return 1
    print(json.dumps(replay.report(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
