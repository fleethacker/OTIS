# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2 AS ui
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY ark/ui/package.json ./ark/ui/package.json
RUN bun install --frozen-lockfile
COPY ark/pipeline/toolchain/package.json /opt/ark-toolchain/package.json
COPY ark/pipeline/toolchain/bun.lock /tmp/ark-toolchain-original.lock
COPY scripts/portable-lock.ts ./scripts/portable-lock.ts
# The export's protected lockfile contains cluster-local registry URLs.
# Normalize a build-only copy; preserve versions, integrity and protected source.
RUN bun scripts/portable-lock.ts /tmp/ark-toolchain-original.lock /opt/ark-toolchain/bun.lock \
    && cd /opt/ark-toolchain && bun install --frozen-lockfile
COPY ark ./ark
COPY ui ./ui
COPY scripts/bind-tools.ts ./scripts/bind-tools.ts
# Protected builders resolve their tools from ark/node_modules. Keep the
# framework and lockfiles unchanged; no installed Ark CLI is needed to package.
RUN ln -s /opt/ark-toolchain/node_modules ark/node_modules \
    && bun scripts/bind-tools.ts /opt/ark-toolchain \
    && bun --no-env-file --config=ark/pipeline/bunfig.toml ark/pipeline/build-ui.ts

FROM golang:1.27.3-bookworm AS go
WORKDIR /src
ENV CGO_ENABLED=0 GOWORK=off
COPY go.mod go.sum ./
COPY ark/go/go.mod ark/go/go.sum ./ark/go/
RUN go mod download
COPY . .
COPY --from=ui /src/ui/build ./ui/build
RUN go build -mod=readonly -trimpath -ldflags='-s -w' -o /out/watch-desk . \
    && go build -mod=readonly -trimpath -ldflags='-s -w' -o /out/healthcheck ./cmd/healthcheck \
    && mkdir /out/data

# Portable diagnostics using the exported toolchain, independent of a host CLI.
# Canonical Ark jobs remain the release validation entry points.
FROM go AS go-test
RUN go test -count=1 -v ./... && go vet ./...

FROM ui AS ui-test
RUN bun --no-env-file --config=/src/ark/pipeline/bunfig.toml \
    --tsconfig-override=/src/ark/pipeline/tsconfig.json test \
    --preload ./ark/pipeline/test-setup.ts ./ui/src/

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=go /out/watch-desk /app/watch-desk
COPY --from=go /out/healthcheck /app/healthcheck
COPY --from=go --chown=65532:65532 /out/data /data
COPY LICENSE /app/LICENSE
COPY --chown=65532:65532 internal/data/seed_data.json /app/internal/data/seed_data.json
ENV PORT=8080 ARK_DB_PATH=/data/watch-desk.db ARK_DATA_DIR=/data
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
    CMD ["/app/healthcheck"]
ENTRYPOINT ["/app/watch-desk"]
