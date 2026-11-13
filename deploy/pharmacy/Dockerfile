# Waseela / Trader rebuild: server binary + static web, served by trader-server on 8787
FROM rust:1-bookworm AS server
WORKDIR /src
COPY . .
RUN cargo build --release -p trader-server -j 4

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY web /src/web
RUN node web/tools/build-static.ts /out

FROM postgres:17-bookworm
# only pg_dump/pg_restore are used from this image (Database Utilities > Backup); PostgreSQL itself runs in its own container
COPY --from=server /src/target/release/trader-server /usr/local/bin/trader-server
COPY --from=web /out /srv/web
RUN mkdir -p /srv/files && chown postgres:postgres /srv/files
USER postgres
ENV BIND=0.0.0.0:8787 STATIC_DIR=/srv/web FS_ROOT=/srv/files
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/trader-server"]
