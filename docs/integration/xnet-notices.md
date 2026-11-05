# Fictional cross-network traffic notices (UNCLASSIFIED demo)

Models the notice and the watch workflow only. Moving information between classification levels requires an accredited cross-domain solution; this does not provide one.

One application instance models **HIGH (fictional)** and **LOW (fictional)**
mailboxes/desks. These names are not classifications; all supplied traffic is
synthetic and UNCLASSIFIED. No message content is transferred by this feature,
no SMTP notice is sent, and no transmission scheduling is implemented. “Notice
sent” means the content-free notice was durably projected into this application's
LOW desk inbox, not delivered to another system.

## Watch workflow

Preferences adds an owner-scoped `deskNetwork`: `LOW`, `HIGH`, or `ALL` (default).
This is a **demo view filter only, not access control**. Users may change their
own selection; existing authentication, Admin/Viewer roles and ownership remain
in force. Direct source/evidence reads are not a network security boundary.

- LOW shows LOW message browsing/search/calendar results, LOW ordinary bell
  notifications, and separate cross-network notices above the calendar and in
  the bell. HIGH shows HIGH results and the notice status when opening a message.
  ALL shows both and unlabelled legacy arrivals. Unknown network is never inferred
  from security markings, subjects or source text.
- A published HIGH message with explicit approved command IDs adds one waiting
  member to each applicable ship's open notice. Subsequent messages aggregate;
  retries/republication do not increment the count. No IDs means no notice, not
  “all ships”. The supplied example uses the application's fictional roster ID
  `demo-meridian` (display name “USS Meridian”); the UI shows the roster display
  name when the ID is in the command list and falls back to the raw ID otherwise.
- The strict [payload schema](../schemas/xnet-notice.schema.json) allows **only**
  `shipId`, `count`, `highestPrecedence`, `firstWaitingAt`, `latestWaitingAt`.
  It contains no source message key, subject, sender/originator, body, source sets,
  task titles, task times or source issue times. Waiting timestamps are IMAP
  receipt times (custody time only if unavailable), never extracted event times.
  A separately typed envelope carries an opaque notice ID/version and workflow
  sent/cleared/own-acknowledged timestamps. HIGH status may additionally show
  authenticated acknowledgers' display names and times.
- Acknowledge records the authenticated owner's identity and server time. It is
  separate from the ordinary bell's “Mark all as read”. Additional HIGH messages
  make the notice unread again; acknowledging a stale version cannot acknowledge
  unseen traffic. FLASH/IMMEDIATE are prominent, ROUTINE is quiet.
- Rendering a successfully loaded HIGH message on a HIGH or ALL desk records it
  as **copied**, for all explicit ships on that message. Search/prefetch alone
  does not copy; LOW opens never copy. Any eligible user's open counts. Once all
  members for a ship are copied, its notice clears. Opening one of two messages
  leaves one waiting; the summary precedence then reflects that remaining member.
  Cleared history retains the episode's total summary. Later new traffic starts a
  new episode; acknowledgement is not inherited. No content is removed by clearing.

## Source metadata and persistence

`arrival_network` is optional on each strict intake config. Missing means unknown.
Each custody receipt stores its arrival network. Body/revision deduplication still
shares a canonical projection; its `arrivals` map preserves the first accepted
receipt envelope per network, and indexed custody flags enable view filtering.
The message JSON API exposes `meta.arrivalNetworks[messageKey]` on list/search/
calendar/detail responses, outside the unchanged parser ICD and protobuf records.
A same-body arrival on both networks appears in both views and is counted only
once for HIGH. Its first accepted HIGH envelope supplies HIGH applicability and
precedence; duplicate deliveries do not silently rewrite an existing notice.

The body-only OPTASK format implemented here does not expose a reliable precedence
field. Fixtures therefore use the real email envelope header
[`MMHS-Primary-Precedence` (RFC 6477 §3.8)](https://www.rfc-editor.org/rfc/rfc6477.html#section-3.8).
The supported subset is a single bare label FLASH/IMMEDIATE/PRIORITY/ROUTINE
(case-insensitive) or numeric 4/3/2/1. Missing, duplicate, malformed, commented or
unsupported values remain **“not stated”**; even the word FLASH in prose or a
subject cannot supply it. For an aggregate, the highest explicitly stated value
among currently waiting members is shown; unknown members do not invent a rank.
This is not a complete MMHS implementation.

At this branch's starting revision, intake passed an empty command list to the
parser. The new examples use the command ID `demo-meridian` from
`backend/config/watchdesk-demo.json` (display name USS Meridian). The explicit
**demo-only** `X-Demo-Command-IDs` email header supplies host command context,
restricted by each mailbox's `demo_command_ids` allowlist. It does not infer
applicability from participants or narrative, and is not an operational roster
resolver. Headers/raw bytes remain in custody; the parser itself is unchanged.

State follows the existing hidden OpenSearch/CAS pattern:

- `.parse-command-custody-v1`: receipts, projection arrival envelopes, existing
  publication/custody events. Mailbox identity also binds the network and demo
  command allowlist. Existing unlabelled accounts are not relabelled automatically.
- `.parse-command-state-v1`: `xnet_ship` aggregate/history and per-owner
  acknowledgements; `xnet_copy` replayable copy markers; `xnet_cursor` event
  progress. A copy is journalled before updating ships; pending copies are repaired
  by background sync after interruption. The server's existing lease and notification
  mutex coordinate the feature. Ordinary notification groups are partitioned by
  arrival networks; a LOW bell cannot expose HIGH group members through the UI.

Authenticated same-origin JSON POST routes are under `/api/v1/xnet/`:

| Operation | Request | Result |
|---|---|---|
| `list` | `{}` | `{items: [...]}`; open notices and cleared history for LOW/ALL |
| `acknowledge` | `{shipId, id, version}` | Own acknowledgement only; owner/time never accepted from JSON |
| `message` | `{key}` | HIGH/ALL per-ship sent/acknowledged/cleared status for that source |
| `opened` | `{key}` | Idempotent copy marker only for published HIGH traffic on HIGH/ALL |

All request shapes reject unknown properties. Viewer and Admin use the same own-
acknowledgement operation; neither can impersonate another acknowledger. No SQLite,
source-index field additions, generated code changes or new dependencies are used.

Demo bounds: eight mailbox configs total, 32 explicit commands per message,
500 projections per network-filtered view, 100 ships per notice listing, 2,000
retained message members/256 episodes/500 acknowledgers per ship episode (the
2,000-member bound is per ship across history), and 2 MiB response/state-document
limits. Exceeding bounds fails visibly rather than dropping history or broadening
filters. ALL browsing does not perform the bounded network lookup. This is a small
workflow demo, not a production retention/capacity design.

## Run with the two fictional mailboxes

Use the existing stack's prepared images/toolchain. Do not run a second intake
worker against the same custody index. Retain all UI, mail, state and custody
volumes. Nothing in this section requires deleting existing data.

1. Start the separate demo mail environment with its account-preserving overlay:

   ```sh
   docker compose -f demo/docker-compose.yml -f demo/compose.xnet.yml up -d --wait
   docker compose -f demo/docker-compose.yml -f demo/compose.xnet.yml exec mailserver setup email add high@parse-command.test
   docker compose -f demo/docker-compose.yml -f demo/compose.xnet.yml exec mailserver setup email add low@parse-command.test
   ```

   Enter unique local-demo passwords at the interactive prompts, not on command
   lines. Check existing accounts before adding them; these commands are only for
   new accounts. Continue using this mail overlay on restarts: the base initializer
   alone replaces the account file with its original seed. The overlay leaves an
   existing account file untouched and introduces no new volume.

2. Inject the same passwords into the current shell without printing or writing
   them to a file (Bash; do not enable shell tracing):

   ```sh
   read -rsp 'HIGH fictional mailbox password: ' PARSE_COMMAND_IMAP_PASSWORD_HIGH; printf '\n'
   read -rsp 'LOW fictional mailbox password: ' PARSE_COMMAND_IMAP_PASSWORD_LOW; printf '\n'
   export PARSE_COMMAND_IMAP_PASSWORD_HIGH PARSE_COMMAND_IMAP_PASSWORD_LOW
   docker compose -f docker-compose.yml -f compose.xnet.yml config --quiet
   docker compose -f docker-compose.yml -f compose.xnet.yml up -d --wait
   unset PARSE_COMMAND_IMAP_PASSWORD_HIGH PARSE_COMMAND_IMAP_PASSWORD_LOW
   ```

   This selects `backend/config/xnet-high.json` as the primary config and
   `xnet-low.json` via `PARSE_COMMAND_ADDITIONAL_MAILBOX_CONFIGS` (OS path-list
   syntax). Both configs share custody and publication; each has its own account,
   username, cursor, network and password environment reference. The original inbox
   remains intact but is not polled by this opt-in profile. Runtime credentials
   still require a proper deployment secret mechanism beyond this local demo.

3. Open Preferences and set the first user to LOW **before opening any HIGH
   message**. Use another browser profile/account on HIGH, or change your own
   preference when demonstrating copying. Demo Viewer is `dev-user`; demo Admin is
   `dev-admin`. Two tabs for the same account share one preference and one ack.

4. Preview and explicitly send the two HIGH examples and one LOW example:

   ```sh
   uv run --no-project python demo/xnet_mail.py
   uv run --no-project python demo/xnet_mail.py --send
   ```

   The sender only targets loopback SMTP `127.0.0.1:1025` and verifies the fixed
   fictional recipients. SMTP acceptance is not proof of intake/publication.
   Wait for publication: LOW should have one ordinary message and a banner like
   “Traffic waiting on HIGH (fictional) for USS Meridian · 2 messages · IMMEDIATE
   · since 1412Z”. Actual waiting times are current receipt times. Fixture source
   checks are dated **05 Nov 2026**; select that date to see their calendar points.

5. Acknowledge on LOW. On HIGH, open one message: its status shows the LOW notice
   time and `dev-user`'s acknowledgement, and one message remains waiting. Open
   the other: the notice clears into history. Return to LOW to inspect it.

6. Send the third, unstated-precedence example after clearing:

   ```sh
   uv run --no-project python demo/xnet_mail.py --send --only-unstated
   ```

   It starts a new notice with **not stated**, despite FLASH in its subject/prose.
   Alternatively `--include-unstated` sends all four examples initially. Re-sending
   identical bodies is a deduplication test, not new traffic and not a reset.

## Verification handoff and decisions for Parker

No builds, container runs or external publication were performed by the coding
session. Container feedback reports Rust green at `49d4732`; the Viewer timezone
UI failure also occurs before any feature UI changes and is not being repaired here.
New fixture/UI commits require their own container verification.

Run the documented Rust workspace checks and Ark `build`, `test-go`, `test-ui`
jobs. The new Rust tests cover the strict payload allowlist, source precedence,
aggregation/replay, per-user acknowledgements and clearing; ignored tests in
`parse-command-intake/tests/networks.rs` and `parse-command-server/tests/xnet.rs`
require an isolated OpenSearch endpoint. Do not report those as run based on the
ordinary cargo suite. The UI tests exercise the visible banner/bell, acknowledgement,
quiet history, HIGH copying and LOW non-copy behavior.

Also validate Compose without printing interpolated secrets:

```sh
docker compose config --quiet
docker compose -f docker-compose.yml -f compose.intake.yml config --quiet
docker compose -f docker-compose.yml -f compose.xnet.yml config --quiet
docker compose -f docker-compose.yml -f compose.intake.yml -f compose.xnet.yml config --quiet
docker compose -f demo/docker-compose.yml -f demo/compose.xnet.yml config --quiet
```

Open decisions: approve the operational command/roster source in place of the demo
header; choose duplicate-envelope precedence/applicability policy; decide whether
an open should represent copying in a future operational workflow; select history
retention, pagination/capacity and verified transport policies before expanding beyond
this fictional single-instance demonstration.
