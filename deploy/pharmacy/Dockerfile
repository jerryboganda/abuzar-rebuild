# Waseela / Trader rebuild: server binary + static web, served by trader-server on 8787
FROM rust:1-bookworm AS server
WORKDIR /src
# only the Rust workspace: a change of the web code does not rebuild the server
COPY Cargo.toml Cargo.lock ./
COPY server server
COPY src-tauri src-tauri
RUN cargo build --release -p trader-server -j 4

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY web /src/web
RUN node web/tools/build-static.ts /out

# generated class/DataWindow/SQL data (web/public/data is not in git): built from the same commit as the code, exported by
# deploy.sh with `docker build --target data-out -o type=local,dest=...` (same steps as the CI job)
FROM node:22-bookworm-slim AS data
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY tools/build_sql_tables.py tools/build_sql_tables.py
COPY data/sql data/sql
COPY data/src data/src
COPY web/src web/src
COPY web/tools web/tools
RUN mkdir -p /out/dw \
 && python3 -I tools/build_sql_tables.py data/sql /out/sql.json \
 && node web/tools/build-classes.ts data/src/objects data/src/scripts /out/classes data/src/menu_trees \
 && test ! -s /out/build-classes-errors.txt \
 && cp data/src/dw/* /out/dw/ && cp data/src/names/names.json /out/

FROM scratch AS data-out
COPY --from=data /out /

FROM postgres:17-bookworm
# only pg_dump/pg_restore are used from this image (Database Utilities > Backup); PostgreSQL itself runs in its own container
COPY --from=server /src/target/release/trader-server /usr/local/bin/trader-server
COPY --from=web /out /srv/web
RUN mkdir -p /srv/files && chown postgres:postgres /srv/files
USER postgres
ENV BIND=0.0.0.0:8787 STATIC_DIR=/srv/web FS_ROOT=/srv/files
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/trader-server"]
