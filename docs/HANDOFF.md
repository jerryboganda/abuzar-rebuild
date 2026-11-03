# Agent handoff (2026-11-04)

Everything a new coding agent (opencode or another) needs to continue this work without the previous conversation.
Read `CLAUDE.md` (rules), `README.md` (architecture), `docs/PARITY.md` (numbers), `docs/FIDELITY.md` (findings) and `docs/ROADMAP.md` first; this file is the state and the next steps.

## 1. The goal

Rebuild the compiled PowerBuilder 12.5 ERP/POS "Trader App v1" ("Waseela", Abuzar Consultancy, FazalDin PP19 deployment; no source exists) as
**Tauri 2 + Rust (axum + sqlx) + PostgreSQL 17** with **100% visual and functional parity**.  The user's decisions: parity only (enhancements later), old customer data is not needed,
no licence/activation checks in the rebuild.  The user wants "everything remaining done, nothing left behind" and honest, measured numbers (what is verified vs open).

How it works: the vendor's recovered PowerScript (37,895 routines) is parsed and run unmodified by a TypeScript async interpreter (`web/src/runtime`); PowerBuilder natives
(windows, controls, DataWindow, transactions, system functions) are TypeScript; DataWindows (8,748) render from their recovered definitions; the Rust server is the data tier;
the original T-SQL was translated to PostgreSQL by `tools/tsql/` (`db/pg/*.sql`).

## 2. Repositories and machines

| what | where | rule |
|---|---|---|
| the rebuild (this repo) | `C:\Projects\Abuzar\rebuild`, GitHub `jerryboganda/abuzar-rebuild` | **public since 2026-11-04** (the user's permanent decision: GitHub Actions is free on public repos; the private repo's billing blocked every job). Everything pushed is world-readable. |
| the research project | `C:\Projects\Abuzar` (parent folder; remote `jerryboganda/abuzarREA`) | **never push it**: it is public and its index holds the vendor's binaries. It holds the recovered inputs (`recovered/`, `db/schema/`, `re-tools/`) the rebuild imports with `tools/import_research.py` and the T-SQL source `tools/tsql/build.py --src C:\Projects\Abuzar` reads. |
| live original database | SQL Server 2022 Express `.\SQLEXPRESS2022`, database `FazalDinPP19DataBaseV2` (Windows auth) | metadata-only comparisons (`INFORMATION_SCHEMA`, `sys.parameters`, `sys.dm_exec_describe_first_result_set`, small behaviour probes such as `@@ROWCOUNT`). `sqlcmd` needs `-C` (trust the certificate). No customer rows in anything committed. |

Windows 11, shells are Git Bash and PowerShell.  Node 26 runs `.ts` files directly (`node file.ts`).  Python is run as `python -I`.  A 32-bit Python (`C:\Tools\py32\python.exe`) hosts the original's
`pbdwe125.dll` as a DataWindow oracle (`re-tools/dw_oracle` in the research project).

## 3. Rules that must stay true

* Never commit or print: the vendor backup/media passwords, the app login the user once pasted, hard-coded credentials, customer data, vendor binaries/backups.  Do not crack the `.BAK` files, do not bypass licensing (only inventory it).
* Never push `C:\Projects\Abuzar` (the parent repo).
* Validation is GitHub Actions (`ci.yml`: database, server, web, desktop, e2e; `release.yml`: installer; `sql.yml`).  The user once chose "CI only, no local PostgreSQL/Rust"; a PostgreSQL 17 service now exists on the machine and a local `cargo` run left a `Cargo.lock` (apparently from an earlier opencode session; not verified, and not on the PATH of the previous agent).  Node and Python tests run locally.
* `.github/workflows/ci.yml` has `concurrency: cancel-in-progress` on the ref: dispatch **one** run at a time (`gh workflow run ci.yml`).  An e2e job takes about 25 minutes.
* Git hygiene: never `git add -A`; add explicit paths; end doc/data-only commit messages with `[skip ci]`; check `node --check` / selftests *before* the commit command (a broken file was pushed once because the check was chained with `;`).
* When the user's input is needed, ask in a popup with recommended options, keep status lines short, never stall silently.

## 4. State at handoff (all measured by tools; see `docs/ci-results.json`)

* CI run 41716174427 (commit da153f3, later runs 41719169707, 41722595632, 41725588959 also green): windows opened headless **2046 / 2062**; DataWindow retrieves against PostgreSQL **8618 / 8668**; embedded statements **1847 / 1862**; procedures **511 / 638**; DataWindow expression evaluation 8748 / 8748; Chromium sample 51 of 52 windows opened.
* Installer: GitHub release **build-9** (commit 7533f71): `Trader_0.1.0_x64-setup.exe`, `trader-desktop.exe`, `trader-server.exe`, `db/pg/*.sql`.  Releases are pre-releases named `build-<run number>`.
* Local checks: `python -I tools/tsql/selftest.py` (29 cases), `node --test web/tests/` (29 tests), `node web/tools/smoke-windows.ts web/public/data - report.json` (about 5 minutes; run in slices with a regex filter such as `'^w_[a-c]'` to parallelise).
* Not "production": there is no server deployment target defined yet.  The deliverables are the release installer plus the PostgreSQL scripts (`docs/OPERATIONS.md`).

## 5. How to work

```
python -I tools/tsql/selftest.py
node --test web/tests/
node web/tools/build-classes.ts data/src/objects data/src/scripts web/public/data/classes data/src/menu_trees   # web/public/data is generated and git-ignored
node web/tools/smoke-windows.ts web/public/data '^w_a' slice.json
python -I tools/tsql/build.py --src C:\Projects\Abuzar --repo <dir>        # regenerates db/pg/40-70 and data/sql/{units,proc_signatures}.json
```

* Regenerating SQL: `<dir>` must contain `db/pg/10_tables.sql` (type inference) **and `data/src/dw`** (otherwise `proc_signatures.json` loses its `datawindows` field).  Do a scratch regeneration and diff before overwriting the repo; the generated files must equal generator output (do not hand-edit them).  Rule verified on SQL Server: `SET @v = ...` leaves `@@ROWCOUNT` at 1; the translator emits `_rc := 1` after it.
* CI numbers: fetch the e2e log with `gh run view <run> --log --job <job id>` (`gh api .../logs` returns an empty file here), strip ANSI and the timestamp prefix, then `python -I tools/ci_results.py <log> <run> <sha> docs/ci-results.json` and regenerate `docs/PARITY.md` with `node web/tools/parity.ts <repo root with web/public/data> <merged smoke json> <empty file>` from a clean `git archive HEAD` export.
* Tooling traps: Bash heredocs collapse backslashes (write files with an editor tool, not `cat <<EOF`, when a string contains `\n`); Python on Windows needs Windows paths, not `/c/...`; regenerate statements with UTF-8 (a wrong codec produced garbled `routine` labels once).

## 6. Open items, most valuable first

1. **Needs the user's machine**: start `abuzar.exe` (original, logged in) and compare side by side with the CI screens (`gh release download ci-screens`): the 48 report argument dialogs (`tools/orig/crawl.ps1 open <ids> <outdir> 5000`, compare with `sbs.ps1`), Purchase Order column order, Interface Settings, Group Wise Header Setting dialog, About window.  Then real-data screens/reports, hardware (printers, scanners, fingerprint, fiscal machine).  Pixel parity is not measurable without the original running.
2. **Production deployment**: undefined.  Ask the user what "production" is (a server, a customer PC, the release only) before deploying anything.
3. **Intermittent browser-walk freeze** (stalled in 3 of 7 CI runs, at `w_selectformat_topncustomers` once and at the 9th sampled window `w_arg_godown_sinv_linv_sale_sret` twice; all open fine headless and with the mock database; even `Debugger.pause` gets no answer, so the renderer is stuck below JavaScript).  `web/e2e/browser-smoke.mjs` now opens the CDP session first and prints the process table twice at a stall: read the next stalled run's log (`grep -E 'stuck:|processes '`).  Dispatch CI a few times until one stalls.
4. **16 windows that need caller arguments** (documented in `docs/FIDELITY.md`): they read `message.powerobjectparm` fields (a caller's DataWindow, `bsa`, `icode`...) or are abstract ancestors; a scenario test would open the caller and click.
5. **Failing SQL** (classified in `docs/FIDELITY.md`): 50 DataWindow retrieves (15 linked-server by design, 20 the original's own defects, 10 sweep artefacts, 3 no counterpart, 2 `ORDER BY @param`) and 128 procedures (122 classified); re-measure on PostgreSQL after any translator change.
6. Smaller known gaps: Windows digit-grouping and `Long/Integer` odd-string semantics; `docs/ROADMAP.md` "Not done" list.
7. `docs/handoff/60_procedures_hand_edit.patch` is an unreviewed hand edit of a generated file that an earlier session left (it removes the `srv, db, owner` parameters of `sp_crs_fetch_itemstockposition` for a "no linked servers" deployment).  Not applied: it would diverge from the generator and from `proc_signatures.json`; decide, then change the translator instead.

## 7. In-flight work of the previous opencode session

The working tree at handoff contains the last edits of that session, committed together with this file: the Tauri start-up detection and native window title (`web/src/main.ts`, `web/src/ui/dom-ui.ts`, `src-tauri/tauri.conf.json`), `data/sql/statements.json` (soundex), probe scripts under `tools/tsql/probe_*.py` (throwaway, hard-coded local paths), `tools/tsql/prepare_audit.py` (PREPARE every statement against a PostgreSQL database; needs `AUDIT_DATABASE_URL`) and `Cargo.lock`.  The fiscal relay (`server/src/fiscal.rs`, `/api/fiscal`) refuses non-local hosts.  Run CI on the final commit before relying on any of it.
