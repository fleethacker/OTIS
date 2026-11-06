# ARM64 scan remediation — 2026-11-06

The supplied SARIF digests match release 0.2.0. Bootstrap and search belong to
`parse-command-opensearch`; server and UI belong to their respective packages.
The deeper source/container candidate is `0.2.1`.

## Measured results

| Image | Supplied report | First patch | Deeper patch | Current critical | Current high |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bootstrap | 429 | 184 | 4 | 0 | 2 |
| Search | 87 | 5 | 0 | 0 | 0 |
| Server | 208 | 45 | 0 | 0 | 0 |
| UI | 255 | 3 | 3 | 0 | 0 |
| Total | 979 | 237 | 7 | 0 | 2 |

The first and deeper patches use Grype 0.121.0 with the same database built at
`2026-11-06T06:21:59Z`. The supplied reports use another snapshot. Counts are
package occurrences, not unique CVEs. No findings are suppressed. Full local
JSON, source audit evidence and build/test logs live in ignored
`.work/deep-remediation-2026-11-06/`.

## Additional source fixes

| Rust dependency | Before | After | Finding |
| --- | --- | --- | --- |
| Tokio | 1.48.0 | 1.51.6 | [RUSTSEC-2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386.html), AsyncFd I/O unsoundness |
| time | 0.3.45 | 0.3.47 | [RUSTSEC-2026-0009](https://rustsec.org/advisories/RUSTSEC-2026-0009.html), RFC2822 parser stack exhaustion |
| serde_with | 3.17.0 | 3.21.0 | [GHSA-7gcf-g7xr-8hxj](https://github.com/advisories/GHSA-7gcf-g7xr-8hxj), serialization panic |

Server/state Tokio pins and Cargo.lock are updated, including required companion
crates. An OSV batch query covers all 361 updated registry crate/version pairs,
including optional/platform/build/dev dependencies. App-owned `bun audit --json`
returns no advisories. The retained Go application is not the production server.

The crate audit does not independently audit all vendored C/assembly or prove
function reachability. In particular, static linking does not patch native code.
The musl version comes from the pinned Rust/Alpine build, and Rust compiler/std
release advisories were reviewed separately through 1.99.1; no additional
published ARM64 Linux security fix requiring a compiler upgrade was identified.

## Container and aggregate rebuilds

- Server: rebuild both Rust executables with the pinned Rust 1.97.1/Alpine 3.24
  musl toolchain (musl 1.2.6-r2). A build guard rejects any ELF shared-library
  dependency. The runtime is pinned Distroless static Debian 13, removing the
  glibc/GCC/zlib shared-runtime packages. Preserve UID/GID 65532 and private
  directory mode 0700. It has zero image findings, with the separate source
  advisories below still documented.
- Bootstrap: use pinned [Chainguard Python](https://images.chainguard.dev/directory/image/python/overview)
  with stable [Python 3.15.2](https://www.python.org/downloads/release/python-3152/)
  and OpenSSL 4.0.3. It retains the supplier's full package metadata, has no
  shell/pip, and passes the unchanged standard-library bootstrap logic. Official
  Alpine Python was also tested, but its older SQLite adds more findings.
- Search: keep OpenSearch 3.9.0 and the existing model/native hashes. The first
  patch upgrades 54 standalone JAR copies using 14 checksum-pinned Maven
  artifacts and updates the two Amazon Linux packages. The deeper patch rebuilds
  upstream Security 3.9.0.0 `:libs:opensaml:shadowJar`, resolving Jackson 2.22.3,
  Guava 33.7.2-jre and failureaccess 1.0.3. Source commit
  `3193d192d048a60fc8e63b3d172a7eb3dc9148a0` and archive SHA-256 are pinned.
  The upstream Gradle wrapper verifies its distribution checksum; selected JAR
  hashes are verified against the dependency lock. All 3,393 original executable
  classes remain byte-identical; four JSpecify annotation classes are added.
- UI: retain pinned nginx 1.30.6 Alpine slim from the first patch. A tested
  Chainguard nginx alternative adds a high glibc finding. Normal package-manager
  removal retains BusyBox because of runtime shell dependencies. No forced
  removals or metadata edits are used to chase a lower count.

### Correction to the first report

The earlier claim that OpenSAML contained actual vulnerable Jackson/Guava classes
was incorrect. Upstream excludes `com/**`; those classes were absent. Its five
findings came from retained Maven dependency metadata. The upstream source
rebuild now resolves patched dependencies and emits accurate metadata through
its normal Shadow task, without manually rewriting archive entries or adding
scanner exclusions. Search now scans clean.

## Remaining work

The seven image findings are:

| Image | Dependency | Finding | Severity |
| --- | --- | --- | --- |
| Bootstrap | sqlite-libs 3.54.1-r0 | CVE-2026-119586 | High |
| Bootstrap | glibc-2.44 2.44-r13 | CVE-2026-84243 | High |
| Bootstrap | python-3.15 | CVE-2026-116566 | Medium |
| Bootstrap | python-3.15 | CVE-2026-103995 | Low |
| UI | busybox / busybox-binsh / ssl_client | CVE-2025-60876 (three occurrences) | Medium |

No fixed versions are listed in these feeds. The Python findings point to 3.16
in the other distribution's data, requiring upstream release/applicability
triage. BusyBox's finding concerns untrusted URLs passed to wget; the current
healthcheck uses a fixed loopback URL. That is an applicability observation,
not a suppression or a claim that the installed package is patched.

Two source advisory groups remain: unpatched `rsa` 0.9.10
([RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html)) and
informational unmaintained `paste` 1.0.15. The reviewed app uses RSA public-key
verification and XChaCha20Poly1305 session encryption; no RSA private-key signing
or decryption path was found. Changing tokenizer semantics solely to remove the
compile-time paste advisory is deferred.

The protected Ark build/test toolchain separately has three Happy DOM advisories.
Its Happy DOM/global-registrator 20.14.5 needs a compatible upstream upgrade to
at least 21.0.4. Those dependencies are absent from the nginx runtime. Repository
AGENTS.md treats bundled Ark assets and pinned toolchain files as read-only and
requires a compatible approved upgrade; neither those files nor gate overrides
were edited. See the local [source audit](.work/deep-remediation-2026-11-06/source-audit.md)
for exact advisory IDs and the upgrade procedure. This candidate does not claim
a clean build-toolchain audit.

## Validation and local candidate

- Four ARM64 images build (UI retains the already verified first-patch image).
- All 115 default Rust tests pass, including IMAP CA/hostname verification;
  54 opt-in integration/corpus tests are excluded. The test stage alone installs
  the OpenSSL CLI needed to generate its short-lived certificates.
- Clippy with `--workspace --all-targets --locked --offline -- -D warnings`,
  Rust formatting and generated-type verification pass.
- Four dependency/rebuild regressions, 20 UDS tool tests and chart/package
  validation pass. Search verifies native hashes and loads its CPU helper with
  build networking disabled.
- Offline bootstrap runs twice and after search restart with the same model ID
  and actual 384-dimensional inference. The combined runtime smoke verifies
  server health/publication readiness, SPA/proxy behavior under Compose and UDS
  nginx configs, and nonroot/private-directory permissions on an isolated volume.

Build and verify the unsigned local candidate:

```sh
python3 deploy/uds/tools/build.py --version 0.2.1 --namespace parse-command
python3 deploy/uds/tools/verify_artifacts.py --release deploy/uds/.artifacts/0.2.1
```

The candidate includes three packages, the application bundle, immutable image
references and SHA256SUMS. Original releases are retained. No deployment is
performed; native UDS OIDC/mesh, real mailbox and recovery acceptance remain
separate from these local checks.
