# Meridian priority 1 synthetic scenario and answer key

Everything in this directory is fictional, authored for this integration.
No source traffic is copied here. All event, issue and scenario times use UTC
on November 10, 2026. Actual decision times use the server clock.

## Authored records (not parser output)

- Applicability policy `priority-1-authored-applicability-v1` assigns these intake
  messages to exact command ID `demo-meridian`. The MSGID originator does not
  establish that assignment.
- Responsibility profiles: `priority-1-ops` / OPS and
  `priority-1-engineering` / Engineering, both covering exact `OPTASK COMMS`.
  They are ordinary responsibility-directory records created by explicit setup.
- Fictional person P-01 maps to existing local-demo owner `demo:dev-user`
  (Viewer). `demo:dev-admin` is the coordinator (existing Admin privilege).
  Engineering starts without a designated person. No qualification or
  availability claim is made by this slice.
- Routing rule `meridian-complan-review-v1` selects the exact source/fact bindings
  in `sources.json`, requires the explicit command mapping, message type and
  parsed `communications_plan_window`, and verifies the declared plan name.
- Local demo policy: original review due 09:00; Engineering review due 10:00;
  follow-up has no deadline. An event start is never treated as a deadline.
- Initial scenario clock: 08:15. Advancing to 09:01 makes the original review
  overdue if its exact version has not been reviewed, even if task progress
  was marked completed.

The implementation lives in `parse-command-server/src/work.rs`; setup does not
parse or insert invented canonical facts. The four message files go through the
existing MIME/parser/custody and publisher APIs. `sources.json` pins exact body
hashes, parser revision `priority-1-demo-v1`, logical event IDs and fact IDs.

## Answer key

| Input | Parser evidence | Expected task/owner | Deadline |
| --- | --- | --- | --- |
| `original.txt` | `a1`, 09:00–09:45 COMPLAN; `c1` external POC | One OPS task, P-01 / dev-user | 09:00, Local demo policy |
| `unknown-deadline.txt` | `a1`, unresolved start/end | One OPS task, P-01 / dev-user | Unknown |
| `unassigned.txt` | `a1`, 10:00–10:30 COMPLAN | One Engineering task, unassigned | 10:00, Local demo policy |
| `unrelated.txt` | Informational remarks, no COMPLAN | No task | None |

Expected initial queue: **3 tasks from 4 actual parsed sources**. The source POC
is LT EXAMPLE at EXTERNAL UNIT; it never becomes the local owner.

Acceptance steps:

1. At 08:15, verify the three tasks, local rule reasons and separate source POC.
2. Open the exact original source; verify readable COMPLAN and raw/audit evidence.
3. Advance to 09:01: original shows **Overdue review**.
4. Sign in as Viewer/P-01 and select **Reviewed this version**: review becomes
   visible; progress remains **Not started**; source flags remain unchanged.
5. Record progress separately, then reload. Reassign Engineering as coordinator
   with an explicit reason, then reload. Both changes persist with actor/history.
6. Replay the same receipts: no new projections or tasks. Replay with
   `--duplicate`: four duplicate receipts, still four projections and three tasks.
7. Restart only the isolated server: existing task ownership, progress and reviews
   survive. No task is reset by setup or queue materialization.
8. Verify missing identity, Viewer reassignment, stale versions, forged actor,
   missing origin, out-of-scope reads/mutations and assigning an out-of-scope owner
   are rejected. An operational role label does not authorize mutation.

## Replay

Use a dedicated OpenSearch instance because canonical aliases are fixed by the
existing application. Never point this scenario at a shared deployment. The
checked-in `intake.json` names a local test endpoint at port 19420 and a hidden
`.parse-command-priority-1-custody-v1` index. For another dedicated test instance,
copy the config and explicitly change `opensearch_url` and `custody_index`.
The stager requires a `.parse-command-priority-1-` custody prefix.

From `backend/`, with the repository's prepared Rust toolchain/dependencies:

```sh
cargo build --locked --offline -p parse-command-server --bin parse-command-server --example priority_scenario
cargo run --locked --offline -p parse-command-server --example priority_scenario -- config/priority-1/intake.json
```

This stages synthetic MIME directly through `Service::process`, prints actual
custody status and parser projections, and sends no email. Run it before starting
the server; it is not a mailbox transport test. Start the **existing Rust server**
with the copied intake config, verified tokenizer assets, `local_demo` auth,
`PARSE_COMMAND_ALLOW_FIXTURES=false`, an
isolated state index, and matching loopback public/listen/proxy ports. See the
[integration record](../../../docs/integration/anchor-pb4t-calendar.md) for the current validation runtime. The existing publisher
creates canonical sources, audit records and read templates; no direct fabricated
projection import is used.

Sign in as Admin, open **Assigned work**, choose **Set up Meridian scenario**,
then refresh. Setup is explicit and idempotent. If sources are pending, wait for
normal publication; a failed source service is an error, never fixture data.

To demonstrate a second receipt carrying each identical body, stop only that
test server, run the same command with final argument `--duplicate`, then restart
it. Repeating either command again is idempotent. A fresh demonstration uses a
new isolated state/custody index or a new dedicated cluster; there is no broad
reset/delete operation.

From the checkout root, against a fresh isolated scenario state:

```sh
node scripts/priority-1-browser.cjs
python3 scripts/priority-1-http.py
```

The browser harness requires prepared Playwright plus Chrome and defaults to
`http://127.0.0.1:18420`. It performs real UI actions without network mocks;
`PRIORITY_1_BASE_URL` and `PRIORITY_1_OUTPUT` override isolated origin/output.
The HTTP harness checks real auth/source-scope failures, checks native session identity, and can run after the browser harness.
Source-scope denial is covered by the isolated Rust integration tests; this
branch does not add the older account-settings editor.

From `backend/`, after the real sources are published:

```sh
PARSE_COMMAND_TEST_OPENSEARCH_URL=http://127.0.0.1:19420 cargo test --locked --offline -p parse-command-server --test work -- --include-ignored
```

It creates and removes only its uniquely named hidden test state index. It reads
canonical sources from the dedicated test cluster and never substitutes mocks.
