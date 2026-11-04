# Initial mailbox test

The worker retrieves SMTP-delivered email through IMAP, decodes the message body and subject, invokes the compiled OPTASK parser, and commits the result to a local SQLite custody journal. OpenSearch delivery remains a separate stage: `parsed` means locally staged for delivery, not indexed. The provided loader can populate isolated local test indices for UI testing.

All commands below run from the repository root. Supplied examples and runtime data stay outside Git. The host demo journal is `/tmp/parse-command-intake-demo/custody.sqlite`; choose persistent storage before relying on it beyond a local test. The container journal uses a named Docker volume.

## Run on the host

```sh
docker compose -f demo/docker-compose.yml up -d --wait
python3 demo/mail.py send ../OPTASK_Messages/*.txt
cargo build --manifest-path backend/Cargo.toml --locked -p parse-command-intake
export PARSE_COMMAND_IMAP_PASSWORD='ParseCommandDemoOnly123!'
backend/target/debug/parse-command-intake once backend/config/demo-intake.json
backend/target/debug/parse-command-intake status backend/config/demo-intake.json
backend/target/debug/parse-command-intake receipts backend/config/demo-intake.json
backend/target/debug/parse-command-intake watch backend/config/demo-intake.json
```

`once` drains staged jobs, examines one bounded UID range and processes staged work again. Repeat it to drain a large backlog; `watch` does this continuously. `status` returns counts, cursor epochs and pending audit work without connecting to the mailbox. `receipts` streams receipt IDs, UIDs, timestamps, states, diagnostics, body/revision links, subjects and original-email hashes/byte counts. `export` streams core message NDJSON. These explicit data-export commands may contain message metadata; routine watch logs contain diagnostic codes only.

The configured password environment variable is read on each poll. Credentials are not written to the journal or logs. The checked-in password and numeric limits are exclusively for the local demo; they are not production capacity recommendations. Configuration is strict JSON and all resource limits are explicit. On Unix, the journal requires a private directory (0700) and database (0600); it creates them securely when absent.

## Run with Compose

Start the demo mail server first, then build during connected preparation:

```sh
docker compose -f backend/compose.intake.yaml build
docker compose -f backend/compose.intake.yaml up -d --pull never
docker compose -f backend/compose.intake.yaml exec intake parse-command-intake status /etc/parse-command/config.json
docker compose -f backend/compose.intake.yaml logs --tail 50 intake
```

The runtime joins only the existing demo mail network and publishes no ports. It runs without root privileges, with a read-only root filesystem, a persistent custody volume and explicit demo memory/CPU/log limits. Runtime performs no package/model downloads or external HTTP requests. Export/load the built `parse-command-intake:local` image before offline deployment. Do not remove the custody volume to resolve a processing error.

## Custody and restart behavior

Receipt identity is `(account_id, mailbox, UIDVALIDITY, UID)`, independent of Internet Message-ID and USMTF body identity. A UIDVALIDITY change starts a fresh cursor epoch and rescan; earlier receipt history remains. Identical decoded bodies share one message/revision projection, while every email retains its own raw bytes, headers, subject and receipt audit entry. Different bodies sharing an Internet Message-ID are independent messages.

The display subject comes from the most recently received email according to the server’s IMAP INTERNALDATE, with the local durable receipt sequence breaking ties. The untrusted email Date header does not choose it. Older mail rediscovered after UIDVALIDITY changes cannot replace a newer subject. Differences in decoded subjects retain `subject_conflict`, including after later equal-subject deliveries. The original subjects remain in receipt history.

Raw RFC email bytes, their hash, receipt metadata and scan-cursor advancement commit in the same SQLite transaction. Parsing occurs while a job remains `staged`; the worker never persists a temporary processing state that could strand a job. Core projection, audit outbox entries and terminal receipt state commit together. A crash before that commit leaves a staged job for replay; committed jobs are not parsed again during normal restart. Transactions use SQLite WAL and FULL synchronous mode. This provides process-restart recovery within SQLite/filesystem guarantees, not host-loss replication or a power-loss certification.

| State | Meaning |
| --- | --- |
| `staged` | Full email bytes retained; processing pending |
| `parsed` | Canonical core and audit work committed locally |
| `duplicate` | Separate email retained; existing body/revision projection reused and latest subject applied |
| `unsupported` | Full email retained; no applicable parser profile |
| `quarantined` | Full email retained with MIME/parser/attempt diagnostic |
| `oversized_upstream` | Limit recorded; full source remains only upstream and is not claimed accepted/processed |
| `vanished_upstream` | UID disappeared during retrieval; source was not accepted |

Polling uses read-only EXAMINE, bounded UID ranges and BODY.PEEK. It does not depend on unread flags, mark messages Seen, delete mail, or expunge. Size limits apply before body fetch, and literal/response/wire/command-deadline limits constrain the protocol reader. A full journal stops further intake and leaves staged work intact. Watch mode retries infrastructure failures with capped backoff. Cooperative shutdown finishes/rolls back the current transaction; domain parsing and network reads remain bounded.

Accepted data is not automatically purged. Retained-byte, receipt-count and database-page limits produce backpressure instead. WAL/checkpoint space requires disk headroom beyond the configured main-database cap. Audit retention, cleanup/replay policy and host-failure backups remain deployment decisions. Back up a live journal with SQLite's backup API, or stop the worker and checkpoint it first; copying only the live `.sqlite` file can omit committed WAL data.

An account ID is bound to its configured endpoint, username, mailbox and parser revision. Changing those against an existing journal fails clearly. Reprocessing under a new revision requires an explicit migration/replay workflow; do not edit SQL states or silently reuse the old revision. The two demo configs intentionally use independent host/container journals.

## MIME and geographic contract

The decoder bounds header bytes/counts, part count, nesting and decoded body bytes. It handles base64, quoted-printable and unencoded UTF-8/ASCII text/plain, including bounded multipart mixed/alternative/related wrappers. Exactly one eligible inline plain-text body is required; attachments and HTML are not executed or interpreted as orders. Ambiguous/malformed email is retained for review. Decoded source whitespace and line endings remain unchanged. Subject decoding and one leading `SUBJ:` removal are separate from body-based parser dispatch. Both local custody time and IMAP server receipt time are retained separately. Original headers and selected-part byte provenance accompany the receipt audit event; full original email remains in SQLite custody.

ICD 1.1.0 adds optional `locations` with `geo_point` and GeoJSON `geo_shape` mappings. Supported coordinate forms produce points, channel endpoint lines, and closed area polygons. Circle centers retain their radius without invented polygon vertices. WGS84 is the approved default only when no datum is declared; explicit different/unknown datums and unresolved locations retain review states without map geometry. Geometry does not imply tasking or local C2 responsibility. Detailed tokens, spans and rules remain in audit.

## Populate the local UI test indices

```sh
docker compose up -d --wait
python3 backend/tools/load_intake_test.py /tmp/parse-command-intake-demo/custody.sqlite
```

The stdlib-only loader checks the local cluster, uses isolated `parse-command-intake-test-messages-v1` and `parse-command-intake-test-audit-v1` indices, sends bounded Bulk batches, and checks every response item. Rerunning uses stable document IDs. It does not change the runtime outbox state or masquerade as a continuous writer. Test indices have no expiry because the supplied historical examples would already be expired under production issue-time retention. No search embedding/model is needed for this intake/spatial test.

## Production boundary

The intended mailbox is enclave-local on-premises Exchange protected by PKI. The current `plaintext_demo` transport is deliberately restricted to loopback or the demo `mailserver` container name. It is not a production Exchange adapter. Verified TLS/PKI, the exact approved authentication mechanism, production limits and recovery objectives require validation before enabling that endpoint. No cloud mail or token-service dependency is introduced. Continuous OpenSearch delivery, passages/embeddings and the UI HTTP service remain subsequent stages.

## Initial verification evidence

Verified locally on 2026-11-04: the fourteen external example emails produced fourteen distinct core projections; an additional same-body email with a changed subject remained a separate duplicate receipt, updated the display subject and retained the conflict flag. The transport probe was quarantined independently. An abrupt SIGKILL/restart retained all sixteen receipt records, fourteen projections and 558 pending audit events without duplication.

The local OpenSearch 3.9.0 test indices accepted fourteen message documents and 558 audit documents. Actual nested spatial queries matched five documents with points and two with polygons. The source corpus yielded fifteen points, two polygons and six unresolved locations; synthetic regression cases also exercise channel LineString output. The idle Rust worker measured about 7.3 MiB container memory usage at this small workload within the configured 128 MiB demo cap; this is not a burst/maximum-input capacity measurement.
