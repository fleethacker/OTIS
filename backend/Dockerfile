# syntax=docker/dockerfile:1
FROM rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS build
WORKDIR /build/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/crates ./crates
COPY backend/examples ./examples
COPY backend/config ./config
COPY apps/watch-desk/proto /build/apps/watch-desk/proto
COPY docs/opensearch /build/docs/opensearch
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/backend/target cargo build --release --locked -p parse-command-intake -p parse-command-server && cp target/release/parse-command-intake target/release/parse-command-server /tmp/

FROM build AS test
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/backend/target cargo test --workspace --locked --offline

FROM debian:bookworm-slim
RUN mkdir -p /var/lib/parse-command /var/lib/parse-command-private /opt/parse-command && chown 65532:65532 /var/lib/parse-command /var/lib/parse-command-private && chmod 700 /var/lib/parse-command /var/lib/parse-command-private
COPY --from=build /tmp/parse-command-intake /tmp/parse-command-server /usr/local/bin/
COPY backend/search/assets/tokenizer.json /opt/parse-command/tokenizer.json
USER 65532:65532
WORKDIR /var/lib/parse-command
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/usr/local/bin/parse-command-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/parse-command-server"]
CMD ["serve", "/etc/parse-command/config.json"]
