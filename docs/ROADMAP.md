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
| Windows that need arguments | 16 of 2,062 windows fail when opened bare: 14 read `message.powerobjectparm` / `stringparm` (popups and response windows opened by a caller) and 3 are abstract ancestors (`w_entry`, `w_single_entry`, `w_listview_form`) that no script opens directly - checked in the recovered scripts, not against the original; the headless run supplies loose argument structures only | scenario tests with real data |
| Data-dependent expressions | every one of the 8,748 DataWindows evaluates all computed fields and expression properties for three synthetic rows without error (127,955 expressions, `web/tools/dw-eval-sweep.ts`, a CI step); correctness of the values against the original needs its data | the original with data |
| First-run data | the recovered data has no base rows of a new company database: the chart of accounts (main accounts, categories, sub-accounts, system accounts) and the group / user rows. `85_base.sql`, `92_menu_rights.sql` (rights rows generated from the main menu, index paths validated against 242 seeded rights) and `95_bootstrap.sql` (admin / admin) make the application start; the chart of accounts must be set up by the user in the Accounts windows | the vendor's pre-built empty database (restore of a backup the user can open) |
| Translated procedures that fail when run | 123 of 638 with neutral arguments (CI e2e run 42749952934), classified against the reference SQL Server 2022 database of this deployment (2026-11-10, read-only metadata and counts): the cross-site transfer, data carry, drop box, CRS push and Waseela Mini web orders (linked-server / database-name prefixes; `DataTransferLog`, `CRS_DataTransferLog` and `DataTransferDate` hold 0 rows, there is no linked server and no second database - never used here); SQL Server administration (DBCC, `sysobjects`, jobs, `xp_cmdshell`, `WAITFOR`); `OPENROWSET` Excel import; procedures whose objects the original database does not have either (`StockInAllGodown`, `ServiceSRHeader`, `AdjDetail.BonusQty` in `sp_IncomeStatment` - they fail on the original too); sweep artefacts (empty database-name arguments; `sp_DateWiseSaleBreakup` with 0 days loops on SQL Server as well). `sp_FiscalizeSaleInvoice` / `sp_FiscalizeSRInvoice` (`sp_OACreate`) now run natively (`fiscal.ts`) | the cross-site transfer only if a second site is ever connected (postgres_fdw or an API) |
| DataWindow retrieves that fail | 32 of 8,668 (CI e2e run 42749952934): 15 linked-server pass-through DataWindows (`ddd_access_*`, `ddd_dropbox_*`, empty names in the sweep), 1 CRS branch stock, 1 `OPENROWSET`, 1 `SysColumns`; the other 14 read columns or tables that the original database lacks as well (`Preferences.Terms`, `SalesMan.Password`, `GodownDetail.ReorderQty` / `OptimumQty`, `DispatchHeader.BiltyNumber`, `UserAttendance.In_DateTime`, `DepartmentSection`, `ClinicTest`, `BalanceCategory` - checked on the reference database: the original fails the same way). The 13 failing embedded statements are the same kind (`Script`, `Lockers`, `Customer.Code`, `ItemPacking.ICatCode` ... absent in the original; the `PrescriptionHeaderLog` insert supplies 16 values for 15 columns on SQL Server too) | - |
| SQL Server Agent jobs | 24 jobs are defined on the reference server (auto posting, promotions, stock ledger, CRS push ...), but none has ever run: `msdb.dbo.sysjobhistory` holds no outcome for any of them and the Agent services are stopped (SQL Server Express) - no scheduled processing is part of this deployment's workflow (`86_jobs.sql` keeps the definitions) | - |
| OLE / external DLL calls | `bcp_*`, `sysdrv`, `cl32` (mail), winsock for SMTP (the fiscal client's winsock is answered by the rebuild's fiscal service), `pb2xls`, crystal viewers | replacements: SMTP service, XLSX export (server), HTML viewers |

## Beyond parity (done)
Start-up verified in CI against PostgreSQL 17 (login through the original login window, post-login code, main window), MDI toolbar from the menu items, QR codes of the fiscal invoices (decoded by OpenCV in CI: versions 1-30, all four levels), Windows installer as a release asset (`release.yml`), Windowed rendering of large DataWindows (the original draws only what is visible), print preview of report windows, page-across printing of wide reports, label sheets, Code 39 barcodes drawn without the barcode fonts, SaveAs to CSV / text / xlsx / HTML / XML, shared-token protection of the server API for LAN use (`API_TOKEN`), audit trail of master data (`db/pg/80_audit.sql`), typed procedure calls, a procedure sweep in CI.

## Enhancements planned (beyond parity)
**Working-tree additions with local synthetic coverage:** shared validation outcome/event ordering,
caller-scoped AcceptText, required-field search, typed temporal edits, text
limits, redirected focus and default database-error feedback are implemented.
Original aging validation and New/Delete/Save fixtures, using an isolated SQL
call recorder, now pass the local frontend/type/browser checks. The radio,
checkbox and multiline-focus corrections are covered by those checks.
Three source-backed transaction calculators now have Modern dialog layouts;
current verification details and remaining gates are in `UI-ENHANCEMENT.md`.
These additions do not close production workflow, full catalog, printing or
hardware gates.

Classic/Modern UI and independent print-layout enhancement are now approved for
phased implementation. Static inventory, an isolated all-role prototype and an
opt-in runtime workspace foundation are available. The foundation adds scoped
preferences, retained tabs, live command search and Modern dialogs. Seven explicit
DataWindow component pilots add semantic forms/lists, guarded editing and
virtualized rows, including readonly calculations alongside editable aging
limits. Modern numeric steppers preserve typed input, draft acceptance and
validation. Other spin variants, native parity and full aging-window rules remain open.
Five native-control response dialogs have full Modern layouts
with original scripts and return channels. The aging entry now has an exact
inherited outer-layout pilot with context-only Find and source-backed
filter/unfilter/ascending sort on synthetic rows. Dropdown selection Text and
cross-window radio isolation were corrected. Its editable filter-value combo now
supports freeform/listed criteria, source-driven population, native text/list
mutation, serialized notifications and accessible keyboard/pointer choices.
Exact native message/locale semantics, other list families and database workflow
acceptance remain open. Other outer windows and unmapped
controls remain labelled Classic compatibility layouts. Complete Modern screen/document coverage, native
accessibility and hardware acceptance
remain open; the Modern-default rollout is not enabled. See
`UI-ENHANCEMENT.md`, `../PRODUCT.md` and `../DESIGN.md`. This does not mark the
existing parity or hardware gaps above resolved.
The Tauri native theme bridge is implemented with ordered updates and visible
failure/retry, but its actual packaged Windows behavior remains unverified.
User-initiated form-tab changes now wait for pending field validation and honor
the original unsaved-change guard in both presentations. Modern adds
keyboard-operable tabs and live panel semantics;
programmatic tab/event parity and complete outer-window migration remain open.
Ordered EditChanged delivery and model/row/column-owned live GetText/SetText now
cover source-driven Save availability and ascending-text Find in both modes.
Input-event messages retain drafts; input errors block acceptance until
correction/cancellation, and closing invalidates queued delivery. Native busy
acceptance is conservative, not full PowerBuilder reentrancy parity. No-active-
editor/DataStore text behavior, other search branches, selectors and complete
business-window validation/save remain open.

Argon2 password hashing with migration of the plain-text `users.password`, server-side rights enforcement (the original trusts the client), audit trail, `pg_dump` based backup replacing the vendor backup code, proper database migrations replacing the upgrade script chain, HTTPS + authentication for multi-user (LAN) mode.
