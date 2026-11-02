# What is done, what is open

Numbers live in `PARITY.md` and `SQL-TRANSLATION-REPORT.md` (generated). This file states what the numbers do **not** cover.

## Done and verified by a tool
- Database: schema, functions, views, procedures, triggers apply on PostgreSQL 17 (CI `database`, `sql.yml`); embedded and DataWindow statements prepare on PostgreSQL 17.
- Language: all recovered routines parse (`web/tools/parse-corpus.ts`); language semantics have unit tests (`web/tests`).
- Runtime: every window class opens headlessly against a mock database (`smoke-windows.ts`); against the real server in CI job `e2e`.
- Server: sessions, statement-level rollback, procedures with result sets, file and raw-print endpoints (integration tests in CI `server`).
- Desktop: Tauri shell builds on Windows in CI (`desktop`).

## Not done (needs the original, data, or hardware)
| area | why it is open | what is needed |
|---|---|---|
| Pixel parity | measured on the running original (`FIDELITY.md`): menu tree (265 entries, CI-checked), PowerBuilder unit 7/32 x 16/64 px, title / menu / toolbar / status bar, Windows 11 buttons and message boxes, original toolbar pictures from `PBVM125.dll`, window layouts of 100+ windows compared side by side; open: dropdown menu pixel metrics, response window height factor, data-dependent screens | the original running again (login by the user) for the remaining comparisons |
| Behavioural parity with real data | the original database backups are password-protected and were not used | a test database restored by the user, or the vendor's seed data |
| Crosstab DataWindows (147) | implemented from the `crosstab(...)` specification kept in the DataWindow source (`web/src/dw/crosstab.ts`), but three details are assumptions: crosstab columns sort ascending, an empty cell is blank, objects of the repeating zone replicate per column | a licensed original to compare one crosstab report with |
| Dynamic SQL (122 sites) | 23 are SQL Server session options (`Set ANSI_NULLS ON`, accepted as no-ops), plain data statements get the dialect basics (`web/src/runtime/dynsql.ts`); the rest is backup / restore / DBCC / schema upgrade (replaced by `pg_dump`-style tooling, not ported) and the **cross-site data transfer** (`*_datacarrydb`, `*_from_dropbox`, ~60 sites, linked-server stored procedures) | design of the transfer between two company databases (postgres_fdw or an API), then port |
| Vendor licence / dongle / activation | decided by the owner (2026-11-02): **the rebuild has no licence checks** - `f_islicenseexpire` and `f_getlicinfo` are native replacements (`web/src/runtime/sysfuncs.ts`), the vendor key scheme is not reproduced; the dongle (`sysdrv`) and activation window stay out of scope | - |
| Hardware | label printers (TSPL commands are produced, printing is raw to the queue - untested), fingerprint readers (`ole_grfinger`), TWAIN scanners, OLE chart / viewer controls | devices for testing |
| Windows that need arguments | the headless run supplies loose argument structures only; windows that depend on caller state are exercised only through their callers | scenario tests with real data |
| First-run data | the recovered data has no base rows of a new company database: the chart of accounts (main accounts, categories, sub-accounts, system accounts) and the group / user rows. `85_base.sql`, `92_menu_rights.sql` (rights rows generated from the main menu, index paths validated against 242 seeded rights) and `95_bootstrap.sql` (admin / admin) make the application start; the chart of accounts must be set up by the user in the Accounts windows | the vendor's pre-built empty database (restore of a backup the user can open) |
| Translated procedures that fail when run | 121 of 638 with neutral arguments: ~85 are the cross-site transfer (linked-server names), ~25 SQL Server administration (DBCC, jobs, `sysobjects`), ~8 genuine translation defects (e.g. column names inside dynamic SQL) | decision on cross-site transfer; the defects can be fixed one by one |
| DataWindow retrieves that fail | 74 of 8,666 (CI e2e): cross-database names, tables / columns the recovered schema does not have (`preferences.terms`, `godowndetail.reorderqty` ... - the original query would fail on the recovered schema, too), translator defects (UNION type unification, ambiguous columns) | the original database to compare against |
| OLE / external DLL calls | `bcp_*`, `sysdrv`, `cl32` (mail), winsock, `pb2xls`, crystal viewers | replacements: SMTP service, XLSX export (server), HTML viewers |

## Beyond parity (done)
Start-up verified in CI against PostgreSQL 17 (login through the original login window, post-login code, main window), MDI toolbar from the menu items, QR codes of the fiscal invoices (decoded by OpenCV in CI: versions 1-30, all four levels), Windows installer as a release asset (`release.yml`), Windowed rendering of large DataWindows (the original draws only what is visible), print preview of report windows, page-across printing of wide reports, label sheets, Code 39 barcodes drawn without the barcode fonts, SaveAs to CSV / text / xlsx / HTML / XML, shared-token protection of the server API for LAN use (`API_TOKEN`), audit trail of master data (`db/pg/80_audit.sql`), typed procedure calls, a procedure sweep in CI.

## Enhancements planned (beyond parity)
Argon2 password hashing with migration of the plain-text `users.password`, server-side rights enforcement (the original trusts the client), audit trail, `pg_dump` based backup replacing the vendor backup code, proper database migrations replacing the upgrade script chain, HTTPS + authentication for multi-user (LAN) mode.
