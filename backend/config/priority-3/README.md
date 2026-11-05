# Meridian personnel-planning scenario

These are separately authored fictional personnel, qualification, availability
and local planning records. They are not extracted from message contacts or the
command roster. All scenario times are November 10, 2026 UTC; recorded human
decisions use the actual server clock. See the [answer key](answer-key.md),
[shared contract](../../../docs/planning/priority-integration-contract.md) and
[integration record](../../../docs/integration/anchor-pb4t-calendar.md).

`personnel.json` supplies P-01, qualified for `demo-comms-training`, and assigns
that person to movable local training. The current-event adapter explicitly
binds the same person to the fixed communications window. Availability and the
move window are 09:00–12:00. Training starts at 10:45, lasts 30 minutes, may move
only later on a 15-minute grid, and has no declared setup/rest buffer. The
complete schedule assertion covers these fictional assignments only.

| Step | Expected result |
| --- | --- |
| Original communications 09:00–09:45 | No personnel collision with training. |
| Amended communications 10:30–11:15 | P-01 overlaps training 10:45–11:15. |
| Check starts 10:45, 11:00, 11:15 | Earliest feasible alternative 11:15–11:45, provisional because source facts remain unvalidated. |
| Reject | Decision persists; training stays 10:45–11:15. |
| Accept a current proposal | Only local training moves to 11:15–11:45; fixed communications and source bytes stay unchanged. |
| Cancel communications afterward | Fixed event leaves active scheduling; accepted local training and decision/source history remain. |

## Prerequisites and isolated state

Use the checkout containing all three integrations, the prepared Rust/UI
toolchains, and a dedicated OpenSearch test cluster. Canonical aliases are fixed
by the existing application, so a distinct hidden state index alone does not
isolate source publication from a shared deployment. Follow the
[priority-1](../priority-1/README.md) and [priority-2](../priority-2/README.md)
guides to stage all seven authored messages through the real MIME/intake parser
and normal Rust publisher. From `backend/`, before starting that test server:

```sh
cargo build --locked --offline -p parse-command-server --bin parse-command-server --example priority_scenario
cargo run --locked --offline -p parse-command-server --example priority_scenario -- /path/to/isolated-intake.json --anchor
```

Copy the priority-1 intake config, retaining revision `priority-1-demo-v1` and
using the dedicated loopback cluster plus a unique `.parse-command-priority-1-*`
custody index. Run the existing server with that config, verified tokenizer,
local-demo auth, fixtures disabled, and a fresh `PARSE_COMMAND_STATE_INDEX`.
The integration record documents the actual ports/configuration used for validation. The
commands below assume its isolated UI origin `http://127.0.0.1:18430`.

For each full replay or browser run, start with a fresh hidden application-state
index, such as `.parse-command-priority-3-replay-02`, on that dedicated cluster.
Already published exact sources may be reused. `all` and `conflict` require the
initial 08:15 clock and no lineage beyond the original; they refuse progressed
state. No helper resets/deletes workflow or source data, and scenario time
cannot move backward. Do not reset other agents' runtimes or shared indices.

## Full combined replay

From the checkout root, with the local app running and real sources readable:

```sh
python3 backend/tools/replay_priority3.py --base-url http://127.0.0.1:18430 --demo-login --stage all
```

The helper confirms local-demo login, uses an Admin session held in memory,
sets up shared work/history/personnel, reviews the original, applies the
amendment, advances to overdue review at 09:01, verifies the collision, rejects
then accepts, and finally declares/applies cancellation at 09:30. It compares
exact source content hashes/bytes before and after and prints JSON checks,
actual HTTP timings and the final persisted state. Timing is automated software
execution, not a human performance benchmark. Any failed check exits nonzero.

Use `--cookie-file /private/tmp/meridian.cookies` instead of `--demo-login` for
an existing authorized local-demo Admin session in Netscape cookie format.
`--config-root` can select a directory containing the priority-1/2 manifests.
The helper accepts an explicit loopback HTTP origin only and refuses redirects
outside it; it does not import fabricated parsed records.

## Staged calendar demonstration

On fresh isolated application state, stop at the conflict:

```sh
python3 backend/tools/replay_priority3.py --base-url http://127.0.0.1:18430 --demo-login --stage conflict
```

Open `/calendar?date=2026-11-10&view=day` as Admin. In **Personnel planning**,
inspect P-01, both intervals, the exact amended source and the provisional
alternative. Select **Calculate and save proposal**, reject it, and reload.
Then calculate again, accept, and reload. Both decisions and the local plan
persist; the fixed communications interval remains 10:30–11:15.

For automated rendered-calendar acceptance, prepare the same fresh conflict
state and run from the checkout root with Chrome and resolvable Playwright:

```sh
PRIORITY_3_BASE_URL=http://127.0.0.1:18430 node scripts/priority-3-browser.cjs
```

This signs in and performs the rendered reject/accept/reload sequence without
mocking API responses. `PRIORITY_3_OUTPUT` chooses the screenshots/results
directory. Do not run it after the `all` replay, which has already accepted and
cancelled the scenario. As an HTTP-only alternative after `conflict`:

```sh
python3 backend/tools/replay_priority3.py --base-url http://127.0.0.1:18430 --demo-login --stage accept
```

After acceptance through either path, apply cancellation and verify:

```sh
python3 backend/tools/replay_priority3.py --base-url http://127.0.0.1:18430 --demo-login --stage cancel
python3 backend/tools/replay_priority3.py --base-url http://127.0.0.1:18430 --demo-login --stage verify
```

`verify` reads the prepared conflict, accepted plan or cancelled final state
without changing scheduling/workflow data. Restart only this test backend using
the same hidden application-state index, then run `verify` again to inspect
persistence. Login may create/refresh its local demo session.

## Focused checks

From `backend/`, run the pure calculation/state/current-event adapter tests:

```sh
cargo test --locked --offline -p parse-command-server --lib pb4t::
```

After real priority-1/2 source publication on the dedicated cluster, run the
combined persistence, authorization, CAS and stale-amendment checks:

```sh
PARSE_COMMAND_TEST_OPENSEARCH_URL=http://127.0.0.1:19420 cargo test --locked --offline -p parse-command-server --test pb4t_integration -- --include-ignored --test-threads=1
```

These live tests create/remove only their own uniquely named hidden state
indices and read the canonical sources. The integration record documents actual results for
these tests, the full repository checks and rendered UI; commands here are
replay instructions, not claims that a check passed.

Against a configured scenario, the HTTP permission/schema checks are repeatable:

```sh
python3 scripts/priority-3-http.py --base-url http://127.0.0.1:18430
```

They verify anonymous/Viewer restrictions, forged actor and unknown-field
rejection, stale versions and cross-origin protection, then compare the complete
planning view to ensure denied requests did not change it.
