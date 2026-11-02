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
| Pixel parity | no screenshots of the original exist; PBU -> pixel factors (6/32, 13/64), font substitution and 3-D border rendering are assumptions | a licensed original install whose screens the user captures (or a calibration window) |
| Behavioural parity with real data | the original database backups are password-protected and were not used | a test database restored by the user, or the vendor's seed data |
| Crosstab DataWindows (147) | the crosstab specification (row / column / value definition) is not in the recovered DataWindow source; the pivot cannot be reproduced yet | recover the `crosstab` statement from the DataWindow syntax (describe `datawindow.syntax` of the original engine) |
| Dynamic SQL (122 sites) | SQL built at run time cannot be translated ahead of time; most sites are backup / restore / schema-upgrade code that has no meaning on PostgreSQL | review the list in `data/sql/statements.json` (`embedded-dynamic`) and port the functional ones by hand |
| Vendor licence / dongle / activation | inventory only by design | own licensing decision |
| Hardware | label printers (TSPL commands are produced, printing is raw to the queue - untested), fingerprint readers, TWAIN scanners, OLE chart / viewer controls | devices for testing |
| Windows that need arguments | the headless run supplies loose argument structures only; windows that depend on caller state are exercised only through their callers | scenario tests with real data |
| OLE / external DLL calls | `bcp_*`, `sysdrv`, `cl32` (mail), winsock, `pb2xls`, crystal viewers | replacements: SMTP service, XLSX export (server), HTML viewers |

## Enhancements planned (beyond parity)
Argon2 password hashing with migration of the plain-text `users.password`, server-side rights enforcement (the original trusts the client), audit trail, `pg_dump` based backup replacing the vendor backup code, proper database migrations replacing the upgrade script chain, HTTPS + authentication for multi-user (LAN) mode.
