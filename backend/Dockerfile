FROM rust:1.85.1-bookworm AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY examples ./examples
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target cargo build --release --locked -p parse-command-intake && cp target/release/parse-command-intake /tmp/parse-command-intake

FROM build AS test
COPY config ./config
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target cargo test --workspace --locked --offline

FROM debian:bookworm-slim
RUN mkdir -p /var/lib/parse-command && chown 65532:65532 /var/lib/parse-command && chmod 700 /var/lib/parse-command
COPY --from=build /tmp/parse-command-intake /usr/local/bin/parse-command-intake
USER 65532:65532
WORKDIR /var/lib/parse-command
ENTRYPOINT ["/usr/local/bin/parse-command-intake"]
CMD ["watch", "/etc/parse-command/config.json"]
