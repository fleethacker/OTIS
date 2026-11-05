# Mailbox intake and retained custody

The worker retrieves SMTP-delivered email through IMAP, decodes the message body and subject, invokes the compiled OPTASK parser, and persists the result in a hidden OpenSearch custody index. The application server continuously publishes the outbox to OpenSearch; `parsed` means durably staged, not yet necessarily indexed.

All commands below run from the repository root. Supplied examples and runtime data stay outside Git. Set `PARSE_COMMAND_OPENSEARCH_URL` for the host or container. Runtime custody uses `.parse-command-custody-v1`; raw mail and internal state remain outside the core search indices.

## Run on the host

```sh
docker compose -f demo/docker-compose.yml up -d --wait
python3 demo/mail.py send ../OPTASK_Messages/*.txt
cargo build --manifest-path backend/Cargo.toml --locked -p parse-command-intake
export PARSE_COMMAND_IMAP_PASSWORD='ParseCommandDemoOnly123!'
export PARSE_COMMAND_OPENSEARCH_URL=http://127.0.0.1:9200
backend/target/debug/parse-command-intake once backend/config/demo-intake.json
backend/target/debug/parse-command-intake status backend/config/demo-intake.json
backend/target/debug/parse-command-intake receipts backend/config/demo-intake.json
backend/target/debug/parse-command-intake watch backend/config/demo-intake.json
```

`once` drains staged jobs, examines one bounded UID range and processes staged work again. Repeat it to drain a large backlog; `watch` does this continuously. `status` returns counts, cursor epochs and pending audit work without connecting to the mailbox. `receipts` streams receipt IDs, UIDs, timestamps, states, diagnostics, body/revision links, subjects and original-email hashes/byte counts. `export` streams core message NDJSON. These explicit data-export commands may contain message metadata; routine watch logs contain diagnostic codes only.

The configured password environment variable is read on each poll. Credentials are not written to the journal or logs. The checked-in password and numeric limits are exclusively for the local demo; they are not production capacity recommendations. Configuration is strict JSON and all resource limits are explicit. The hidden-index envelope is strict, payloads are unindexed, and writes use optimistic concurrency.

## Run with Compose

The root Compose project deploys the server alongside OpenSearch and Watch Desk:

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
docker compose build server web
docker compose up -d --pull never --wait --wait-timeout 180
docker compose exec -T server parse-command-intake status /etc/parse-command/config.json
docker compose logs --tail 50 server
```

The service is `server`, the container is `parse-command-server`, and its image is
`parse-command-server:local`. The crate and CLI retain `parse-command-intake`.
The server joins the external demo mail network and the application's network and publishes no
ports. It retains the nonroot user, read-only root filesystem and explicit memory/CPU/log limits. Runtime performs no package/model
downloads or external HTTP requests. Export/load the built server image before
offline deployment. Do not remove custody to resolve a processing error.

The standalone `backend/compose.intake.yaml` remains available as an alternative
`server` service for the standalone demo mailbox. Do not run both against the
same custody index. See the [combined-stack guide](../docs/integration/combined-stack.md)
and the [state migration guide](../docs/integration/settings-oidc.md) before adopting existing data.

## Custody and restart behavior

Receipt identity is `(account_id, mailbox, UIDVALIDITY, UID)`, independent of Internet Message-ID and USMTF body identity. A UIDVALIDITY change starts a fresh cursor epoch and rescan; earlier receipt history remains. Identical decoded bodies share one message/revision projection, while every email retains its own raw bytes, headers, subject and receipt audit entry. Different bodies sharing an Internet Message-ID are independent messages.

The display subject comes from the most recently received email according to the server’s IMAP INTERNALDATE, with the local durable receipt sequence breaking ties. The untrusted email Date header does not choose it. Older mail rediscovered after UIDVALIDITY changes cannot replace a newer subject. Differences in decoded subjects retain `subject_conflict`, including after later equal-subject deliveries. The original subjects remain in receipt history.

Raw RFC email bytes and their hash are durably acknowledged before the mailbox cursor advances. A lost write response leaves the cursor behind, so replay verifies the stable receipt identity and original hash. Parsing keeps the job staged until the projection and receipt updates complete; separate writes are replayable rather than a cross-document transaction. Publication jobs keep attempt history and pending work until each Bulk item is confirmed. A single-writer server lease prevents concurrent workers. OpenSearch outages stop acceptance and cause retry without advancing custody. This provides process-restart recovery within OpenSearch's request-durable translog guarantees; the single-node profile is not host-loss replication.

| State | Meaning |
| --- | --- |
| `staged` | Full email bytes retained; processing pending |
| `parsed` | Canonical core and audit work staged in hidden custody |
| `duplicate` | Separate email retained; existing body/revision projection reused and latest subject applied |
| `unsupported` | Full email retained; no applicable parser profile |
| `quarantined` | Full email retained with MIME/parser/attempt diagnostic |
| `oversized_upstream` | Limit recorded; full source remains only upstream and is not claimed accepted/processed |
| `vanished_upstream` | UID disappeared during retrieval; source was not accepted |

Polling uses read-only EXAMINE, bounded UID ranges and BODY.PEEK. It does not depend on unread flags, mark messages Seen, delete mail, or expunge. Size limits apply before body fetch, and literal/response/wire/command-deadline limits constrain the protocol reader. A full journal stops further intake and leaves staged work intact. Watch mode retries infrastructure failures with capped backoff. Cooperative shutdown finishes bounded steps; incomplete steps replay; domain parsing and network reads remain bounded.

Accepted custody data is not automatically purged. Retained serialized-byte and receipt-count limits produce backpressure. These are not physical disk/translog caps; monitor disk headroom separately. Snapshot the OpenSearch state together with message/audit indices. The read-only SQLite importer and rollback procedure are in the [state migration guide](../docs/integration/settings-oidc.md).

An account ID is bound to its configured endpoint, username, mailbox and parser revision. Changing those against an existing journal fails clearly. Reprocessing under a new revision requires an explicit migration/replay workflow; do not edit custody states or silently reuse the old revision. Configure a separate hidden custody index for independent tests.

## Source routing and fictional fixtures

`sourceRouting` is optional operator-approved applicability for every message from one configured source. For example:

```json
"sourceRouting": {
  "policyId": "approved-feed-v1",
  "commandIds": ["SHIP-A", "SHIP-B"]
}
```

Command IDs are exact, unique identifiers; intake sorts this set before parsing and fingerprints it together with the policy ID. Neither subject text nor originator text assigns a command. Each receipt retains a `source_routing_applied` audit event with the source, policy fingerprint and command IDs. Applicability does not grant access.

A hidden custody `source_routing_revision` record binds each parser revision to one routing policy, across all source accounts sharing that custody index. A different policy or switching demo assignments on/off requires a new revision and an explicit replay plan; existing projections remain unchanged. An unbound historical OpenSearch revision fails with `source_routing_revision_unbound`. For retained new-main state that previously used no routing, stop every application and standalone intake writer, wait for the worker lease to expire, and inspect the existing revision:

```sh
python3 backend/tools/migrate_routing.py --url http://127.0.0.1:9200 --custody-index .parse-command-custody-v1 --revision intake-optask-geo-1
# Review the counts and fingerprint, then run the same command with --apply.
python3 backend/tools/migrate_routing.py --url http://127.0.0.1:9200 --custody-index .parse-command-custody-v1 --revision intake-optask-geo-1 --apply
```

The first command is read-only. The apply command repeats the metadata-only scan, rejects an active server lease or changed snapshot, and creates only the missing binding. It never overwrites an existing policy. Every relevant retained core must have an explicit empty command-ID list; any source-routing/demo audit evidence or nonempty/unknown command set fails closed for a separate reviewed migration. Raw mail and parser prose are excluded from the scan. Do not delete custody or invent a binding to bypass this check.

`demo_fixture_assignments: true` enables only the exact body hashes in `backend/config/watchdesk-demo.json`. Its fictional catalog includes command assignments, bounded recurring radio checks and one explicit unvalidated security policy for the synthetic baseline crypto fixture. Modified or unknown bodies receive none of those demo privileges. It is mutually exclusive with `sourceRouting`, and both checked-in mailbox configurations leave it disabled. Use a separate custody index, account identity and revision for this demonstration.

## MIME and geographic contract

The decoder bounds header bytes/counts, part count, nesting and decoded body bytes. It handles base64, quoted-printable and unencoded UTF-8/ASCII text/plain, including bounded multipart mixed/alternative/related wrappers. Exactly one eligible inline plain-text body is required; attachments and HTML are not executed or interpreted as orders. Ambiguous/malformed email is retained for review. Decoded source whitespace and line endings remain unchanged. Subject decoding and one leading `SUBJ:` removal are separate from body-based parser dispatch. Both local custody time and IMAP server receipt time are retained separately. Original headers and selected-part byte provenance accompany the receipt audit event; full original email remains in hidden OpenSearch custody.

ICD 1.2.0 retains optional `locations` with `geo_point` and GeoJSON `geo_shape` mappings. Supported coordinate forms produce points, channel endpoint lines, and closed area polygons. Circle centers retain their radius without invented polygon vertices. WGS84 is the approved default only when no datum is declared; explicit different/unknown datums and unresolved locations retain review states without map geometry. Geometry does not imply tasking or local C2 responsibility. Detailed tokens, spans and rules remain in audit. ICD 1.2.0 also carries bounded recurrence rules; ordinary date and time fields do not imply recurrence.

## Populate the local UI test indices

The application server continuously publishes queued records and validates each Bulk item. Use the demo sender for new test traffic. `backend/tools/load_intake_test.py` is retained only as a legacy read-only SQLite fixture loader; it is not part of runtime intake or the current persistence architecture.

## Production boundary

The intended mailbox is enclave-local on-premises Exchange protected by PKI. `transport: "tls"` uses implicit TLS, normally port 993, and verifies the server certificate and configured hostname before sending IMAP credentials. The bundled root store can be extended with a mounted PEM CA file through `tls_ca`; mount that file read-only when using containers. An untrusted certificate or hostname mismatch fails closed. There is no plaintext fallback or STARTTLS downgrade. Client-certificate authentication is not implemented by this adapter; the approved Exchange authentication mechanism still needs deployment validation.

`plaintext_demo` is deliberately restricted to loopback or the demo `mailserver` container name. The password is read from the configured environment variable on each poll. Production limits and recovery objectives must be set for the deployment. No cloud mailbox or token-service dependency is introduced by intake. The application server includes continuous OpenSearch publication and the UI API; see the [combined-stack runbook](../docs/integration/combined-stack.md).

## Importing the earlier branch's saved state

`backend/tools/migrate_state.py` reads consistent SQLite snapshots and imports documents into the new hidden indices. SQLite is an import/rollback format only; it is not runtime persistence. Run the tool without `--apply` first. It checks retained raw-email hashes, routing fingerprints, demo assignment evidence and immutable availability history before writing. It never overwrites differing target records, verifies every imported document, and writes the migration marker last.

The importer carries forward local demo accounts, station assignments, responsibility profiles, account settings/audits, shared watch context, first-publication history and saved login checkpoints. Native authentication maps earlier `platform_admin` to `admin` and `user`/`viewer` to `viewer`, matching new main's roles. Existing sessions, login attempts and search windows expire. Earlier provider accounts require an explicit reviewed ownership mapping; browser-local timezone preferences require an explicit IANA timezone. Unknown tables, unknown routing fingerprints and conflicting history fail before import instead of being silently skipped.

First-publication history is an immutable, bounded custody log. Migration retains the old sequence high-water mark, including gaps from retry/audit events, so the next arrival cannot be skipped by a saved login checkpoint. The 20,000-entry and 16 MiB limits fail closed; larger histories require an explicit archival migration.

Synthetic importer regressions run with `python3 -m unittest discover -s backend/tools -p 'test_migrat*.py'`. Intake's TLS/config/MIME unit tests run with `cargo test --manifest-path backend/Cargo.toml --locked -p parse-command-intake`; the TLS test opens a temporary loopback listener. Custody integration tests require an isolated OpenSearch endpoint, `PARSE_COMMAND_TEST_OPENSEARCH_URL`, and `-- --include-ignored`. Tests create uniquely named `.parse-command-test-custody-*` indices and remove only those indices when that test endpoint is explicitly configured.

## Historical initial verification evidence (SQLite prototype)

Verified locally on 2026-11-04: the fourteen external example emails produced fourteen distinct core projections; an additional same-body email with a changed subject remained a separate duplicate receipt, updated the display subject and retained the conflict flag. The transport probe was quarantined independently. An abrupt SIGKILL/restart retained all sixteen receipt records, fourteen projections and 558 pending audit events without duplication.

The local OpenSearch 3.9.0 test indices accepted fourteen message documents and 558 audit documents. Actual nested spatial queries matched five documents with points and two with polygons. The source corpus yielded fifteen points, two polygons and six unresolved locations; synthetic regression cases also exercise channel LineString output. The idle Rust worker measured about 7.3 MiB container memory usage at this small workload within the configured 128 MiB demo cap; this is not a burst/maximum-input capacity measurement.
