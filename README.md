# Trader App rebuild (private)

Rebuild of the PowerBuilder 12.5 application "Trader App v1" as **Tauri 2 + Rust (axum, sqlx) + PostgreSQL 17**, derived from the
reverse engineering in the research project (the decompiled PowerScript, window / menu / DataWindow definitions and the SQL Server schema).

Rules: this repository stays **private**; no vendor secrets or customer data (`tools/redact.py` removes the few vendor credentials
found in the recovered code and scans for leaks); builds and tests run in GitHub Actions.

## Architecture

```
 recovered application data                    runtime (TypeScript, runs in the Tauri webview)               server (Rust)             PostgreSQL
 ─────────────────────────                    ──────────────────────────────────────────────                ─────────────             ──────────
 data/src/scripts   PowerScript (28k routines) → pbscript parser → AST ─┐
 data/src/objects   windows, menus, user objs  → class definitions ─────┤  Runtime (async interpreter,      axum gateway:             schema ported by
 data/src/menu_trees complete menu item trees                            │  system functions, native classes) sessions, simple-protocol    tools/tsql2pg_ddl.py,
 data/src/dw        8,748 DataWindows ─────────→ DwModel / DwView ───────┘  ↕ UiHost (DOM): windows, MDI,    queries, savepoint per    routines by
 data/sql           translated embedded SQL ───────────────────────────────→ menus, controls, DataWindows     statement (SQL Server     tools/tsql/
                                                                          ↕ HTTP /api  ────────────────────→  semantics)          (see docs/SQL-TRANSLATION.md)
```

* The original is a two-tier client: all business logic sits in window / user-object scripts that talk to SQL Server directly.  The
  rebuild runs that logic as-is: the recovered scripts are parsed once (`web/src/pbscript`) and executed by an async interpreter
  (`web/src/runtime`).  Behaviour that PowerBuilder implements natively (windows, controls, DataWindow, transactions, system
  functions) is implemented in TypeScript natives; everything the vendor wrote runs unmodified.
* The Rust server is the data tier: sessions with the same transaction semantics as the original (implicit transaction until COMMIT, a
  failing statement only undoes itself), parameter binding, and later reporting / printing / file / hardware services.
* DataWindows (8,748) are rendered from their recovered definitions: bands, positions, fonts, colours, computed fields (expression
  evaluator), grouping, editing; update statements are generated like PowerBuilder does (key + updatable columns, where-clause modes).

## Layout

| path | content |
|---|---|
| `db/pg/` | PostgreSQL schema (tables, FKs, indexes by `tools/tsql2pg_ddl.py`; functions, views, procedures, triggers by `tools/tsql/`) |
| `data/src/` | redacted import of the research data (scripts, objects, menu trees, DataWindow bundles, names) |
| `web/src/pbscript` | lexer, parser and AST of PowerScript (and the DataWindow expression dialect) |
| `web/src/runtime` | values (exact decimals, dates, masks), interpreter, system functions, native classes, wire format |
| `web/src/dw` | DataWindow definitions, expression evaluator, data model |
| `web/src/ui` | DOM implementation: windows, MDI frame, menus, controls, DataWindow view |
| `web/src/app` | start-up sequence, mock and HTTP database sessions |
| `web/tools` | build / analysis tools run with plain Node (no dependencies): class build, corpus parse, smoke run, dev server |
| `server/` | Rust server (axum + sqlx) |
| `tools/` | Python tools: schema conversion, redaction, DataWindow bundles, T-SQL translator (`tools/tsql/`) |

## Working with it

```
python -I tools/import_research.py <research project> .        # (re)import data/src from the research project
node web/tools/build-classes.ts data/src/objects data/src/scripts web/public/data/classes data/src/menu_trees
cp data/src/dw/* web/public/data/dw/ && cp data/src/names/names.json web/public/data/
node web/tools/dev-server.mjs 5173                              # http://localhost:5173/?app=1  (or ?w=<window class>)
node web/tools/smoke-windows.ts web/public/data - report.json  # open every window headlessly and list what is missing
node --test web/tests/*.test.ts
```

Rust and PostgreSQL are not needed locally: `.github/workflows/ci.yml` applies the schema to PostgreSQL 17, runs the server tests against it
and the web tests; `sql.yml` validates every translated routine and statement on PostgreSQL 17.

See `docs/PARITY.md` for the generated status of every area (numbers come from the tools, not from memory).
