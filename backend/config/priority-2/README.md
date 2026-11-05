# Meridian ANCHOR scenario

These fictional messages extend the four priority-1 sources. All scenario times
are November 10, 2026 UTC. `sources.json` pins exact body hashes, parser revision
and selected facts. Relationships are separately authored inputs, never inferred
from arrival, body hash or parser revision.

| Declaration | Source fact | Relationship | Effective | Interval |
| --- | --- | --- | --- | --- |
| `original` | Priority-1 original `a1` | Original | 08:00 | 09:00–09:45 |
| `amendment` | `amendment.txt` `a1` | Amends `original` | 08:30 | 10:30–11:15 |
| `cancellation` | `cancellation.txt`, message-level | Cancels `amendment` | 09:30 | None |
| `conflicting-amendment` | `conflicting-amendment.txt` `a1` | Amends `original` | 08:30 | 12:00–12:45; unresolved with effective sibling |

Amendment `a2` is unrelated at 14:00–14:30. Changing/cancelling `a1` leaves `a2`
and the other two priority-1 tasks unchanged. Cancellation has real parser
source evidence, with no invented activity. The manifest's exact selected `a1`
candidate facts are withheld from scheduling until explicitly linked.

## Replay

Use a dedicated cluster because canonical aliases are fixed. Preserve existing
data; restart a demonstration with a new hidden application-state index. Never
delete shared indices. Scenario time cannot move backward.

From `backend/`, stage all seven messages before starting the normal server:

```sh
cargo build --locked --offline -p parse-command-server --bin parse-command-server --example priority_scenario
cargo run --locked --offline -p parse-command-server --example priority_scenario -- /path/to/isolated-intake.json --anchor
```

Copy the priority-1 intake config to a loopback endpoint with a unique
`.parse-command-priority-1-*` custody index and `priority-1-demo-v1` revision.
The stager calls the real MIME/intake parser. The normal Rust publisher creates
canonical records. `--duplicate --anchor` stages new receipts with identical
bodies, preserving canonical source and task identities. Repeating either
command is idempotent. See the priority-1 replay guide for server configuration.

For the duplicate-receipt demonstration, stop only the isolated test backend,
stage the second receipt set, then restart that same backend/state:

```sh
cargo run --locked --offline -p parse-command-server --example priority_scenario -- /path/to/isolated-intake.json --duplicate --anchor
```

The actual acceptance run retained seven projections after fourteen receipts
(seven parsed plus seven duplicate). Source ingestion does not register lineage,
reset tasks, review an instruction or change the scenario clock.

Sign in as local-demo Admin and set up Meridian through Assigned work. Export
that isolated session into a Netscape cookie file outside the repository, then:

```sh
python3 tools/replay_priority2.py original --base-url http://127.0.0.1:18422 --cookie-file /private/tmp/meridian.cookies
python3 tools/replay_priority2.py amendment --base-url http://127.0.0.1:18422 --cookie-file /private/tmp/meridian.cookies
python3 tools/replay_priority2.py cancellation --base-url http://127.0.0.1:18422 --cookie-file /private/tmp/meridian.cookies
```

The helper posts authenticated same-origin workflow commands, never fabricated
parsed documents. `--register-only` preserves scenario time for future effects.
The normal amendment stage advances to 08:45; cancellation advances to 09:30.
The unchanged original stage leaves the clock at its current value.

Use a fresh isolated application-state index for each of these variants:

| Variant | Replay sequence after Agent 1 setup | Expected result |
| --- | --- | --- |
| Future effective amendment | `original`; `amendment --register-only`; then `amendment` | At 08:15 the original token/review remains valid and next change is 08:30. At 08:45 the amendment becomes current and needs review. |
| Out-of-order cancellation | `original`; `cancellation`; then `amendment` | Missing amendment target is unresolved at 09:30. Supplying it resolves directly to cancellation; the helper does not rewind the clock. |
| Ambiguous lineage | `original`; `amendment`; then `ambiguous` | Both effective siblings target `original`; current version is unresolved with no selected active interval. |

Each stage still needs the same `--base-url` and `--cookie-file` arguments shown
above. The `ambiguous` stage alone has no competing sibling; register the normal
amendment first to exercise ambiguity. Replaying the identical amendment after
cancellation remains a no-op and cannot resurrect the event.

## Answer key

1. At 08:15, review the original. Register future amendment: token/review stay
   valid and the forthcoming change is visible.
2. Advance to 08:45: 09:00–09:45 becomes 10:30–11:15. Owner/task ID remain fixed,
   progress resets, new review is required and stale submissions return 409.
3. Reader shows exact sources and before/after time. Review refreshes the shared
   queue; private outbound drafts remain separate. Parsed flags stay unvalidated.
4. At 09:30, cancellation removes the interval and obsolete deadline, retains
   history/cancellation-review work and leaves `a2`.
5. Duplicate declarations never duplicate tasks. Missing targets, cycles and
   conflicting effective branches never silently choose a winner.
6. All history sources must be within scope. Admin declares; owner/Admin reviews.
   Operational role labels add no authentication privilege.

The task's 09:00 review deadline remains labelled **Local demo policy**, separate
from either source interval. Advance to 09:01 before reviewing the amendment to
show overdue review. After cancellation, the old deadline and reminder state are
cleared, while cancellation-review work remains. Reviewed, completed and parsed
fact validation are separate states throughout.

## Checks

After real source publication, from `backend/`:

```sh
PARSE_COMMAND_TEST_OPENSEARCH_URL=http://127.0.0.1:19420 cargo test --locked --offline -p parse-command-server --test anchor -- --include-ignored --test-threads=1
```

The real Chrome harness requires fresh application state and published sources.
From the checkout root, with installed Chrome/Playwright:

```sh
node scripts/priority-2-browser.cjs
```

Default origin is `http://127.0.0.1:18422`. Override `PRIORITY_2_BASE_URL` and
`PRIORITY_2_OUTPUT` as needed. It signs in, sets up work, reviews through UI,
posts explicit declarations/clock changes and saves screenshots/results. No
network mocks are used. After duplicate intake and restarting the same retained
test backend/state, compare its current view against the browser-run snapshot:

```sh
node scripts/priority-2-persistence.cjs
```

That script requires the prior `results.json` in the same output directory. It
checks exact view/token/review persistence, three tasks and no resurrected event.
It is a persistence check, not a new scenario reset.

Validation counts and the runtime used for this branch are recorded below.
Do not treat the earlier prototype runtime or its historical test counts as
validation of this integration.

See [the integration record](../../../docs/integration/anchor-pb4t-calendar.md) for
the complete actual check results, blockers and runtime details. PB4T consumes
`anchor::current_view`/`current_views` and the opaque `versionToken`; the numeric
`eventVersion` is only path depth. Use the unfiltered current-event view and
revalidate status, source and token inside the shared workflow CAS.
