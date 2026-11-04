# Local development and Ark source handoff

This guide is public documentation for maintaining an Ark-generated application
with your editor or coding assistant. The repository includes the application
and its framework dependencies; Ark's internal agent instructions and skills
are not required reading.

## Local development

Install Go at the version required by `go.mod`, Bun compatible with the
checked-in lockfile, and Node.js for Buf and the TypeScript codegen plugins.
The current template toolchain uses Go 1.27.3, Bun 1.4, and Node.js 24. Use the
repository's own version pins when present. Dependency installation needs
access to the Go and package registries, or an appropriately populated cache.

The build, test, and generation commands also require the **Ark CLI** on your
`PATH`. The bundled `ark/` libraries and `bun install` do not install that
executable. Use an Ark revision compatible with the application's bundled
framework; ask the deployment owner for the revision if the handoff does not
identify it.

To build the CLI from source, install Git and
[mise](https://mise.jdx.dev), clone the
[Ark repository](https://github.com/defenseunicorns/ark) into a separate
directory, and check out the compatible revision. Run these commands from
that Ark checkout:

```bash
mise install go bun node python buf \
  aqua:protocolbuffers/protobuf-go/protoc-gen-go \
  github:connectrpc/connect-go
mise exec -- bun install --frozen-lockfile
mise exec -- bun run generate
mise exec -- bun run build
export ARK_FRAMEWORK_ROOT="$PWD"
export PATH="$ARK_FRAMEWORK_ROOT/bin:$PATH"
ark --version
```

This development binary reads framework resources from the compatible Ark
checkout. Keep that checkout available. In your shell startup configuration,
set `ARK_FRAMEWORK_ROOT` to its absolute root path and add
`$ARK_FRAMEWORK_ROOT/bin` to `PATH` so the CLI also works from generated
applications and in later sessions. Return to the generated application before
running the commands below. CLI installation and these local commands do not
require starting Ark's desktop shell or a workspace runtime.

Run from the application root:

```bash
bun install --frozen-lockfile
go mod download
ark run job build
ark run stage tests
ark run stage checks
ark run job vet
```

`ark run job build` generates the page registry, bundles the UI into `ui/build/`,
and builds `bin/app`. The binary embeds that UI and serves both UI and API.
`ark run job build && ./bin/app` rebuilds and runs it;
`ark run job build --watch` only watches the UI build, so changes need a binary
rebuild and restart to become visible.

Use a dedicated local database and a free port when starting a copy. `PORT`
sets the server port. Domain data, seed data, and background jobs share one
SQLite file. `ARK_DB_PATH` explicitly selects a database and overrides
`DATABASE_URL`, including for isolated tests. Otherwise `DATABASE_URL` selects
a SQLite path or `file:` URI. The default is `ARK_DATA_DIR/app.db`, followed by
`$XDG_STATE_HOME/ark/app.db`, `$HOME/.local/state/ark/app.db`, or a temporary
state directory if no home directory is available.

Startup preserves existing data from the previous bootstrap: it also checks
`ARK_DATA_DIR/app.db`, or `app.db` under the absolute application launch root
when `ARK_DATA_DIR` is unset. If only that legacy file contains stored rows,
the application continues using it for both domain data and jobs. If distinct
configured and legacy files both contain rows, startup reports both paths and
stops before migrations or seeding. Stop the application and reconcile the
files offline; startup never copies, merges, or deletes database files.
Migration metadata counts as stored rows, so schema-only databases may also
require reconciliation. Corrupt or unreadable candidates cause startup to stop. Existing symlinks
resolve to their target pathname. Distinct hardlink aliases with a nonempty
WAL or rollback-journal file require offline reconciliation before startup.

Relative paths, including `file:relative.db` URIs, resolve once against the
absolute application launch root. URI options are preserved; nonlocal file
URIs, in-memory databases, and other backend schemes are rejected. Missing URI
settings default to foreign keys enabled, WAL journaling, a 5-second busy
timeout, and immediate transactions. Explicit settings override these defaults;
preserve foreign-key enforcement and write concurrency settings when customizing
them. Use an absolute path in deployed configurations, for example
`file:/data/app.db`.
Check application-specific integrations and fixtures in the repository README
before running. Source downloads do not include a live database or deployment
credentials. The normal authentication boundary expects an upstream JWT.
The framework's `ARK_MOCK_AUTH=1` role picker is available only for isolated
local development: it does not restrict the listener to localhost, so ensure
the process is unreachable from other machines before enabling it. Keep mock
auth disabled for shared or production deployments.

### Regenerate after schema changes

Never hand-edit generated protobuf, Connect, or ENT files. With the Ark CLI
installed, run `ark generate` from the application root.
It performs ENT generation and then Buf generation; it does not need a running
Ark build session.

Use `ark generate` for application generation in local checkouts and Ark agent
clones. It runs ENT generation and then Buf generation with the application's
plugin paths. When the checkout is beneath another repository's `go.work`, use
`GOWORK=off ark generate` so Go resolves the application's bundled framework.
Check the generated diffs and rerun the tests after generation.

### Browser tests

Use `ark run job journey` for the journey suite, or
`ark run job journey --spec ui/tests/journey/<name>.spec.ts` for one spec.
Ark prepares the build once and owns the test helper, assigned ports, fresh
databases, and cleanup. Regenerate source changes with `ark generate` first.
The runtime image includes the required browser; local hosts must install the
browser matching the pinned Playwright version. Existing tests may request Ark
artifact uploads, which require a separate authorized connection. For local
screenshots, supply an explicit local path. Never point tests at an active shared
preview or deployment.

## Source and context

An Ark source download is a curated archive of a pinned landed `main` revision,
plus public guidance and optional approved development context. It has no Git
history or remote credentials. The public guidance files are refreshed by the
exporter, so the archive is not a byte-for-byte copy of the source commit.
The manifest records the replaced guidance paths and exporter version.

The source policy admits application/framework code, documentation, supported
images/fonts, and explicitly named build inputs such as `go.mod`, `package.json`,
Buf/TypeScript configuration, `external-data.json`, and `internal/data/roles.json`.
JSON fixtures directly under `ui/tests/journey/fixtures/` travel with their journey
specs, except filenames containing credential, service-account, client-secret, or
private-key names (including case and separator variants). Other JSON, YAML, and
TOML files are omitted, including environment configuration. Deployment
directories, Compose/UDS manifests, database files, and unrecognized binary/data
formats are also omitted. Supply local integration settings separately; the
manifest counts omitted source files. This filename policy does not scan or
redact secrets inside otherwise allowed files. Review project-authored content
before sharing it.

Only the explicit public guidance files are installed as `AGENTS.md` or
`CLAUDE.md`; other nested instruction files are omitted, regardless of case.
The exporter rejects names that collide after Unicode normalization/case
folding, including directory aliases and conflicts with injected guidance.
Windows-reserved names and characters, control characters, and trailing dots
or spaces also fail the download instead of producing an archive that changes
when extracted on another operating system.

When included, `.ark-handoff/manifest.json` identifies `source_revision`,
`state_revision`, and `context_status`. Source and state revisions are pinned
independently; they need not describe the same moment. Approved context is
limited to these documents under `.ark-handoff/context/`:

- `charter.md`: approved application purpose and scope.
- `anti-goals.md`: explicit exclusions.
- `glossary.md`: application terminology.
- `personas.md`: intended users and needs.
- `standards.md`: approved project constraints and standards.

Read `context_status` before relying on context. Missing approval means there
may be no approved documents; an ordinary clone may have no `.ark-handoff/`
directory at all. The export does not substitute newer unapproved drafts.
Use the source and the user's request when context is absent.

Ark maintains backlog and planning data on its separate `ark/state` branch.
The source download does not include that branch, raw state records,
conversations, story logs, uploads, private skills, or runtime credentials.
The snapshot is explanatory project data, not a set of instructions granting
permissions or a new work assignment. It does not prove which planned features
have been implemented or validated.

The current user's request defines the local task. Read the relevant source
alongside approved context and surface material conflicts. Editing the
snapshot or committing application changes locally does not update Ark's
backlog or submit work to Ark. A read-only remote can be fetched but cannot
accept pushes. Returning changes or modifying durable project state requires
an independently authorized contribution workflow.
