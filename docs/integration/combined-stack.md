# Parse Command combined stack

> Current authentication, settings and state migration are defined in [Settings, OIDC and hidden state](settings-oidc.md).

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
# Fresh volume: provision OpenSearch before the application creates its indices.
docker compose up --build -d --wait --wait-timeout 180 opensearch
uv run --no-project --python 3.9 --with-requirements backend/search/requirements.lock \
  python backend/search/deploy.py
docker compose up --build -d --wait --wait-timeout 180 server web
curl http://127.0.0.1:8080/api/health
curl http://127.0.0.1:8080/api/v1/source/status
```

Register/deploy the approved model through `backend/search/deploy.py` **before the
server first creates the passages index on a fresh volume**. The deployment tool
compares index generation metadata and refuses an existing incompatible index;
it does not silently take over an index the application already created. For an
existing volume, inspect the actual mapping/model generation and plan a reviewed
migration instead of deleting it. Rust installs its indices/templates and continuously
publishes canonical data without requiring the model. Enrichment and neural/hybrid
search become available when the local model is ready. There are no runtime
model/dependency downloads. Provisioning needs prepared local Python dependencies
or a connected preparation environment; the `uv` command is not an airgap download plan.

### Fictional Watch Desk demo opt-in

The multi-ship demo requires `compose.watchdesk-demo.yml`, which sets server-only
`PARSE_COMMAND_WATCHDESK_DEMO=true`. The base stack intentionally leaves the fictional
roster and exact-hash fixture assignment off. After the fresh-volume provisioning
step above, start the demo application with:

```sh
docker compose -f docker-compose.yml -f compose.watchdesk-demo.yml config --quiet
docker compose -f docker-compose.yml -f compose.watchdesk-demo.yml \
  up --build -d --wait --wait-timeout 180 server web
```

Only constructed bodies in `backend/config/watchdesk-fixtures/` are demo inputs.
Verify the isolated mailbox/destination before any explicit submission; startup
never sends them. Use 5 Nov 2026 in Calendar. Opt-in does not reparse/backfill stored
messages, erase volumes or establish production command/acknowledgement authority.

### x86_64 (amd64) local notes

These are reported local provisioning observations, not a reviewed cross-platform
runtime profile. Apply them in a local build/runtime override; this documentation
change does not alter the committed Dockerfile, Compose environment or native lock.

- **DJL flavour:** x86_64 needs `PYTORCH_FLAVOR=cpu-precxx11` to select the prepared
  native helper. ARM64 always uses precxx11. The preparation script downloads that
  flavour for either architecture. Make the variable available to both image-time
  Java priming and runtime OpenSearch; merely exporting it on the host does not inject
  it into a Docker build or Compose service.
- **512m heap:** adding `-XX:MaxNewSize=96m` to `OPENSEARCH_JAVA_OPTS` avoided parent
  circuit-breaker HTTP 429s during model chunk upload on the local x86_64 run. Retain
  the existing heap/offline/thread options when adding it. This workaround is
  **unverified on ARM64** and is not a production sizing recommendation; do not disable
  circuit breakers or reset data to hide resource failures.
- **Provisioning Python:** `backend/search/requirements.lock` needs Python **3.9** in
  the reported setup. Its click/typer pins conflict under Python 3.12. Use the explicit
  3.9 environment above (also for `prepare_assets.py`), not an unqualified system
  interpreter or a silent dependency-lock rewrite.
- **Bootstrap order:** run `deploy.py` before the server first creates the passages
  index on a fresh volume. Otherwise deployment refuses the existing incompatible
  index metadata (`index_model_or_chunker_conflict_new_generation_required`). This
  is a generation guard, not permission to delete an existing index.
- **Native lock provenance:** the amd64 native lock was computed locally from
  `publish.djl.ai` downloads and is **unreviewed**. The committed validated baseline
  is ARM64; this checkout does not supply a reviewed amd64 lock. Preparation's
  generated `assets/native/amd64/SHA256SUMS` is not independent approval. Review
  provenance/checksums and run actual offline inference before accepting an amd64
  image; process health alone is insufficient.

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
