# syntax=docker/dockerfile:1
FROM rust:1.97.1-alpine3.24@sha256:3c38f3f82c2f3d73da3b38e18d279393a04cb43ddded0e35088a8c3324d40900 AS build
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/crates ./crates
COPY backend/examples ./examples
COPY backend/config ./config
COPY apps/watch-desk/proto /build/apps/watch-desk/proto
COPY docs/opensearch /build/docs/opensearch
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,id=otis-cargo-musl,target=/build/backend/target \
    cargo build --release --locked -p parse-command-intake -p parse-command-server \
    && cp target/release/parse-command-intake target/release/parse-command-server /tmp/ \
    && test -z "$(scanelf --needed --nobanner --format '%n#p' /tmp/parse-command-intake /tmp/parse-command-server)"
RUN install -d -o 65532 -g 65532 -m 0700 /runtime/var/lib/parse-command /runtime/var/lib/parse-command-private

FROM build AS test
# The IMAP TLS regression creates short-lived test certificates with the CLI.
RUN apk add --no-cache openssl
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,id=otis-cargo-musl,target=/build/backend/target cargo test --workspace --locked --offline

FROM build AS lint
RUN rustup component add clippy
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,id=otis-cargo-musl,target=/build/backend/target \
    cargo clippy --workspace --all-targets --locked --offline -- -D warnings

FROM gcr.io/distroless/static-debian13:nonroot@sha256:25ac8f0c3b2334a9eb05452266bd4697864a8c8ef0ef71e5e6480d7f92868329
# The musl build must have no shared-library dependencies before reaching this stage.
COPY --from=build /runtime/ /
COPY --from=build /tmp/parse-command-intake /tmp/parse-command-server /usr/local/bin/
COPY backend/search/assets/tokenizer.json /opt/parse-command/tokenizer.json
USER 65532:65532
WORKDIR /var/lib/parse-command
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/usr/local/bin/parse-command-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/parse-command-server"]
CMD ["serve", "/etc/parse-command/config.json"]
