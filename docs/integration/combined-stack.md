# Parse Command combined stack

The root Compose project contains `parse-command-server` (Rust), `web`
(React static assets and same-origin Nginx proxy), and CPU-only OpenSearch.
The SMTP/IMAP demo is a separate Compose project with independent mail volumes.
Go source is retained for reference/rollback; the deployed application runs Rust.

## Start

Prepare model/native assets using the [search runbook](../../backend/search/README.md).
The committed native lock is validated for Linux ARM64. Build-time downloads are
allowed; runtime needs only local mail, Rust and OpenSearch endpoints.

```sh
docker compose -f demo/docker-compose.yml up -d --wait --wait-timeout 180
docker compose config --quiet
docker compose up --build -d --wait --wait-timeout 180
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/v1/source/status
```

Register/deploy the approved model through `backend/search/deploy.py` as described
in that runbook when provisioning a fresh OpenSearch volume. Rust installs its
indices/templates and continuously publishes canonical data without requiring
the model. Enrichment and neural/hybrid search become available when the local
model is ready. There are no runtime model/dependency downloads.

| Service | Persistent state | Local endpoint |
| --- | --- | --- |
| `web` | None; read-only static/proxy runtime | `127.0.0.1:8080` |
| `server` | `custody`, `private-state` | Internal `server:8081`; no host port |
| `opensearch` | `opensearch-data` | `127.0.0.1:9200` |
| Separate `demo/` | Original mail volumes | SMTP `:1025`, IMAP `:1143` |

The root server joins external `parse-command-demo_mail` to reach `mailserver:143`.
Start the demo first. Root `down` does not stop the demo. Compose 2.24.4+ is needed
for `!override`; `compose.intake.yml` is an empty compatibility overlay.
Do not use `down -v` to repair integration or migration problems.

The server cap is 256 MiB / one CPU; web is 32 MiB. These are enforced demo
limits, not measured operational throughput guarantees. OpenSearch keeps the
existing 512 MiB JVM and prepackaged native CPU dependencies. HTTP, cursor,
publication batch, tokenizer, custody and private-store bounds are enforced.
Application JSON logs rotate; raw mail/text/credentials are not logged.

## Continuous publication

IMAP custody atomically retains each receipt, canonical projection and audit
outbox. Rust derives passage/provenance jobs from the preserved UTF-8 source and
observed narrative record spans. The approved tokenizer is checksum-verified;
chunks retain exact byte spans, stable IDs, 240-token windows, 24-token overlap
and the 256-model-token limit. Malformed source, invalid spans and conflicts fail
closed. The old Python snapshot publisher is a diagnostic tool, not a runtime
sidecar or required ingestion step.

Canonical records, lexical passages and immutable audits publish independently
of neural enrichment. Each bulk response item must succeed before its job is
acknowledged. Retries use capped backoff; source checksums prevent an older
publication response from acknowledging a newer subject projection. Audit
conflicts are compared rather than overwritten. Pending jobs survive restart;
index UUID changes replay retained jobs. Emptying an index in place without
changing UUID is not detected; restore/rebuild requires an explicit replay plan.

Indices are `parse-command-messages-v1`,
`parse-command-search-passages-minilm-v1`, and the retained
`parse-command-intake-test-audit-v1`. Existing test indices are preserved.
The API and stored templates are documented in [rust-application-api.md](rust-application-api.md).
No automatic retention deletion is enabled on these validation indices. The
agreed 365-day issue-time policy remains the deployment retention requirement;
physical hot/cold topology and policy rollout are separate work.

## Adopt existing custody and private state

1. Stop the old worker and Go application. Keep their volumes. Take consistent
   SQLite backups and preserve the old executable/image before replacement.
2. In ignored `.env`, set `PARSE_COMMAND_CUSTODY_VOLUME` to the original custody
   volume. Keep endpoint, account, mailbox and parser revision unchanged. Never
   run two workers against the same writable journal.
3. For a Go migration, set `PARSE_COMMAND_LEGACY_DB=/legacy/watch-desk.db`.
   The original `watch-desk-data` volume mounts read-only. Leave this variable
   empty for a fresh installation with no legacy database.
4. Start the complete Rust/web replacement. The importer copies the frozen
   database/WAL into a bounded writable staging directory, imports every legacy
   record and private owner/history atomically, stores counts/hash and removes
   staging files. Unsupported state fails startup; it does not reseed or clear
   either database. Unowned private rows remain preserved and inaccessible.
5. Check `/api/v1/source/status`, the UI, custody status and migration counts.
   Legacy fixtures remain an explicit dataset with `legacy:` keys. Canonical
   messages are not copied into the private SQLite database.

```sh
docker compose exec -T server parse-command-intake status /etc/parse-command/config.json
```

A volume created by the old standalone project may produce a Compose label
warning. Its configured explicit name selects the retained volume; do not remove
it to silence the warning. The migration can be prechecked on copies using:

```sh
parse-command-server migrate-private /absolute/frozen-go.sqlite /absolute/new/private.sqlite
```

## Rollback

Stop Rust/web writers before taking a consistent backup of **both current**
SQLite volumes, including new private writes. Keep `private-state` intact; do not
replace it with a pre-cutover copy. The old Go runtime cannot represent new
canonical revision keys. It may be restored against a separate copy of the
original Go volume for read-only historical inspection, with private writes
disabled at its ingress, while Rust private-state remains the authoritative
post-cutover record. A writable Go rollback requires an explicitly reviewed
reverse migration and ownership/revision reconciliation first. Never silently
route new drafts to an old database or claim that pre-cutover restoration
preserves post-cutover writes.

Local validation backups are outside Git at
`/tmp/parse-command-cutover-20261104`; retain/move them to durable storage if
needed beyond this machine's temporary-file lifecycle. The saved Go rollback
image is `parse-command/watch-desk-go-rollback:20261104`.

## Verification and boundaries

Use the Rust checks in `backend/README.md`. The Docker test command is now:

```sh
docker build --target test -f backend/Dockerfile -t parse-command-backend-tests:local .
docker build --target ui-test -t parse-command-ui-tests:local apps/watch-desk
```

Use the canonical Ark jobs when the compatible Ark CLI is installed. The export
contains protected builders/checkers but does not install that executable.
The Docker build-only UI stage includes its documented Node dependency and
locked checker tools; it does not modify Ark's pipeline or generated bindings.

This stack uses the explicit local-demo auth/plaintext IMAP profile already
approved for v1. On-premises Exchange PKI/TLS and operational user authentication
are not implemented here. Runtime airgap assets are bundled, but an ordinary
Docker bridge is not an egress firewall; enforce enclave network isolation at
the deployment boundary. No service needs an external runtime endpoint.
