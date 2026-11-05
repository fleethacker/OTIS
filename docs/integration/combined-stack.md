# Parse Command combined stack

> Current authentication, settings and state migration are defined in [Settings, OIDC and hidden state](settings-oidc.md).

See the [architecture overview](architecture.md) for the Compose data flows and
the separate Kubernetes/UDS Core deployment layers.

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
| `server` | Hidden OpenSearch custody/application indices | Internal `server:8081`; no host port |
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

IMAP custody retains each receipt before advancing its cursor. Canonical projections
and audit/publication outboxes use replayable steps and conditional writes; the
atomic boundary is one hidden OpenSearch document. Rust derives passage/provenance jobs from the preserved UTF-8 source and
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

Use the [verified snapshot migration procedure](settings-oidc.md#storage-and-migration).
Stop existing writers, take consistent snapshots, import and verify both hidden
state indices, then start the coordinated replacement with
`PARSE_COMMAND_REQUIRE_STATE_MIGRATION=true`. Preserve mailbox identity and parser
revision. Never start an independent intake worker against the same custody index.

```sh
docker compose exec -T server parse-command-intake status /etc/parse-command/config.json
```

Old SQLite volumes remain available for migration and rollback; the new runtime
neither mounts nor writes them. The importer preserves legacy records already
present in the Rust private store. It does not automatically assign their private
ownership to SSO accounts.

## Rollback

Retain the previous images and frozen SQLite snapshots. Stop new writers before
rollback and snapshot the new OpenSearch state. Reconcile messages, drafts,
preferences and other changes made since cutover before restarting an older
writer. Restoring a pre-cutover snapshot alone does not preserve newer state.
Never remove an old or new data volume to resolve a startup or migration error.

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

The base stack uses the explicit local-demo auth/plaintext IMAP profile already
approved for v1. The optional OIDC overlay enables native Keycloak authentication;
its acceptance and cutover status is recorded in [verification](settings-oidc-verification.md).
On-premises Exchange PKI/TLS remains unimplemented. Runtime airgap assets are bundled, but an ordinary
Docker bridge is not an egress firewall; enforce enclave network isolation at
the deployment boundary. No service needs an external runtime endpoint.
