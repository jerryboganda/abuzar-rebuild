# Save / post test of every entry screen (2026-11-25)

Every data-entry screen of the Modern frontend was driven through a real save (and post where the screen has posting) on the
scratch database `waseela_rehearsal` (local test server, port 8790), then reopened and checked against the database.
Nothing was written to production or to the original app's database.

## Results

| Area | Screens | Result |
|---|---|---|
| Basic Data forms | 23 | 20 saved, matched the DB and reopened correctly. Price Policy only edits an existing policy (the original's rule); Sale Promotion needs customer groups (the scratch DB has none); Sale Template's Header list is empty (see "Open") |
| Purchases | Purchases, Opening, Loose, Orders, Return | saved and posted; stock, `avgprice` and ledger entries match hand calculations |
| Sales | Cash/Credit Sale, Cash/Credit Sale Return, Open Cash/Credit Sale Return, Quotation, Refused Sales | saved (posted on save where the original posts); stock and ledger match |
| Maintenance | Adjustments, Change Items Price, Priority, Change Item Discount, Modify Sale Invoices, Update Item Suppliers, Lock Item Batches | saved, DB and reopen checked |
| Manage | Groups, Group Allowed Prices, Group Cash Account, Group Supplier Category | saved, DB and reopen checked |

## Defects found and fixed (all deployed)

| Defect | Fix | Commit |
|---|---|---|
| `GetItemStatus` of a column of a new row returned `new!`; PowerBuilder returns only `notmodified!`/`datamodified!` for a column. 154 script checks (`if getitemstatus(row,"col",primary!) = notmodified!`) were false on new lines: Sale Template lines saved with price 0 | `runtime/native/dwctrl.ts` + test | 65126d6c |
| Closed tabs never released their server sessions; the test server filled its 60 slots | `pagehide` + keepalive close in `app/httpdb.ts`; QA runners close the page before the browser | 65126d6c, c9250052 |
| The purchase badge said "Draft · not saved" on a saved invoice (the window's own SetItem after a reopen) | `DwModel.hasPendingUpdate` used by `ui/ds-purchase.ts` | 65126d6c |
| Open Sale Returns, and a second return against a sale, failed with a NOT NULL violation (`srledger.fbrposfee`): a NULL a script set was sent explicitly in the INSERT. PowerBuilder leaves NULL columns out, so the default 0 applies (the original has 73 such returns, all 0) | `dw/model.ts` + test | c9250052 |
| `String(double)` printed 585.5700000000001 (RPP, any price with a double rounding artefact): now the shortest text rounded to 16 digits, measured with the original's engine | `runtime/values.ts` + test | this commit |
| Session Monitor listed nothing: the connection query filtered by the app's database name (`trader`) instead of the actual PostgreSQL database; user name showed 0 for text; computer name blank | `datname = current_database()`, client address as computer name, user name left blank (`runtime/sql-fixes.ts`) | this commit |
| Session Monitor's bottom options band ("Maximum Users Allowed", "Refresh after every n Seconds") was clipped to a 30 px strip, the spin buttons unreachable | window-specific layout rule in `ui/design-system.ts` | this commit |
| A plain drop-down kept showing "Choose a value" after a script set the record's value following the editor's creation (Cashier Job's Job Owner) | `DwChoiceEditor.syncRecordValue` | this commit |
| Server time was the start of the transaction (`localtimestamp`), so the back-date check (`ServerDate.LastTransDate`) refused saves ("Back Date Invoice Check violates", Change Items Price 4 of 5 times) and stale times were stored | `statement_timestamp()` in `GetDateTime`, dynamic `GETDATE()` and the fiscalization stamps | 29d646ed |

## Session Monitor

The server (commit e96c7735, compiled and deployed on the VPS) names each connection `waseela (<usercode>)` (`application_name`) when
the client opens it with its user, and the monitor query shows that user code, like the original's session table
(`tempdb..SysIsolaation`, filled at login). Computer names are the client addresses (a browser has no computer name) and your own
session is not highlighted (no session id in the browser).

## Header files on the production server (done 2026-11-25)

`serviceheads.pbd` and `mgmtcomp.pbd` (company name and report headers; the original reads them through the server's file root at
login) were missing on the VPS. They were copied byte for byte from the shop's installation (`deploy/Application`, same SHA-1 as
the staged copies in `deploy/parity/rebuild-dist/files/`) into the persistent Docker volume `pharmacy_files` (`/srv/files` of
`pharmacy-app`), owner `postgres`; the server reports both (`/api/fs/exists`: 2658 and 2603 bytes). The volume survives redeploys.
Rollback: `docker exec pharmacy-app rm /srv/files/serviceheads.pbd /srv/files/mgmtcomp.pbd`. The files hold the client's name,
address and licence data: never commit them to the public repository.

## Verified against the original's own behaviour (no change)

* "Item Validation: Item can not be sold, its Stock is Zero" and the close prompts match the original (reproduced live).
* The Lock Item Batches / Priority Setting lists open sorted descending although "Ascending" is checked: `w_multi_entry`
  initialises `is_sortsequence` to "D" and the original's script only ticks the radio.
* A purchase return lowers stock at save, before posting (as the earlier return 1488 did); quotation and refused sale store 0 for
  invoice total / sale price (the original's scripts never write them). The rebuild runs the recovered scripts as they are
  (`w_purchasereturn.wf_updateitemstock*` run in the save), so the timing is the original's own code.
* The purchase summary's RPP showed `585.5700000000001` (fixed, commit below): the original's DataWindow engine prints a double as its
  shortest text, rounded to 16 digits (`Evaluate('String(58557/100)')` = `585.57`, `54145/100` = `541.45`, `10/3` = `3.333333333333334`,
  `1/3` = `0.3333333333333333`, `1/10+2/10` = `0.3`); the rebuild expanded to 17 digits first. `runtime/values.ts`, test in `tests/dw-itemstatus.test.ts`.

## Side by side with the original (2026-11-25, 63 screens)

Every menu screen of the original `abuzar.exe` (read-only walk by Win32 menu messages, `PrintWindow` captures) was compared with the Modern
frontend. Fixed (commits f9072e29, d5fed75b, deployed):

| Screen | Difference | Fix |
|---|---|---|
| Sale Promotion | default name `<Enter Promotion Name Here>` shown in capitals in the original | a column's Case (upper / lower) applies to the display and the editor's start text; an untouched Case=Upper edit is not a change |
| Quotation | default customer `****CASH SALES CUSTOMER` showed empty | an editable drop-down follows a value a script sets after the editor was built |
| Customer Form | Opening Date comes before Name (Local Language) | `InterfaceSetting` ties (same SequenceId): SQL Server's order is reproduced for the two visible pairs (`runtime/sql-fixes.ts`) |
| Groups (and the other `w_listview_form` lists) | "Find:" box missing | `d_find` gets its row, the original's keypressed / editchanged script runs |
| Cash Sale item popup | Location column pushed out of the popup | long cells are cut short (`ui/ds-purchase.ts`) |
| About | System Information below the fold; "More Info. . ." wrapped | compact rows (`ui/design-system.ts`) |
| Item Basic Data supplier grid | heading `:Bonus` | stray leading colon dropped with the trailing ones |

Not code defects (nothing to change):

* **Adjustment Decrease shows a "Post" button** the original's File menu does not have (and Print is hidden): the menu items are shown or hidden by the user's
  group rights; the test user's group differs from the original session's `ADMIN`.
* **Job Schedule** shows Activate off / Every blank: the schedule lives in SQL Server Agent jobs (`msdb`), which PostgreSQL does not have; the window reads an empty list by design.
* **About licence lines** are blank (licensed-to, product licence id): the original reads its activation data; licensing is not reproduced (decision, `CLAUDE.md`).
* Stock figures and times differ between the screens (live data of two databases).

Found and fixed after the table (commit 87871ecb, deployed):

* **Blank Credit Sale** showed Misc(+) / Sales 0.00, the original 1.00 (the POS fee): the sale windows total their lines in `dw_detail.GetFocus`, which the rebuild raised before
  the blank form (`ue_newform`, posted by the tab's SelectionChanged) existed. The window now waits for the posted events before the first DataWindow takes the keyboard
  (`runtime/native/windowing.ts`).
* **Refused Sale**: its item list took a grid row of its own and pushed the godown stock grid 360 px down; it now drops over the lines card.
* Item Basic Data supplier grid heading `:Bonus`: the leading colon is dropped on the simplified surfaces too.

## Menus compared item by item (2026-11-25, second round)

The File and Item menu of the window each of the 63 non-report menu leaves opens was read from the running original (Win32 menu, ADMIN) and from the rebuild
(same leaves): after the fixes below there is **no difference in the entries or in their enabled state on any of the 63 windows**.

| Finding | Cause | Fix |
|---|---|---|
| Customer Form lacked "Set Guarantee Person", "View Customer Comments" (and Show Account Ledger kept no caption); the purchase, patient, visit-appointment, service and Modify Sale Invoices menus lost 5 more items' captions and click scripts | the decompiler named the routines of 11 menu items `None`; the class builder merged them under one owner and only the last of each event survived | `data/src/scripts/*/m_*.pbs`: the owner is the item's field name (taken from the p-code, 6 files, order checked); `re-tools` still writes `None` |
| `Print` missing on Purchase Return / Opening / Loose / Orders, Cash and Credit Sale, the sale returns, Quotation and the three Adjustment windows; Adjustment Decrease showed a `Post` the original does not have; the sale windows' post entry is "Post Sale Invoices" / "Post Sale Returns" in the original; Priority Setting and Lock Item Batches have no Item menu | the scripts and p-code say `m_print.Visible = false` and nothing shows it again, yet the running original lists it; the cause (a PowerBuilder menu rule) was not found | `web/src/runtime/menu-fixes.ts` copies the measured result per window (test `tests/menu-fixes.test.ts`); without it the transaction windows could not print the current invoice |

### The two things set aside before, now settled

* **About, licence lines**: they come from the report-header files (`f_reportheaderinfo`: `serviceheads.pbd`, `mgmtcomp.pbd`). With the files in the server's file root the dialog shows
  "Fazal Din's Pharma Plus", "NRY Pacific / Franchise Fazal Din's" and the licence id exactly like the original (checked locally); the production server has the files since this morning, so it
  shows them. The last licence-id digit group differs (`.3567.0.7968` against `.3567.6.7968`): the original derives it from its activation counter, which is not reproduced (licensing decision).
* **Job Schedule** shows nothing saved because the rebuild never had a scheduler: the original's screen configures **SQL Server Agent jobs** and the shop's server runs nine of them. The four local ones matter:
  `SP_ApplySalePromotions` (every 10 min: switches customers' promotion discounts on and off), `SP_StockLedger` (every 2 h: copies new posted documents into `stockledger`, which the stock-in-hand-on-a-back-date,
  stock register (moving average) and packing-wise trading P&L reports read), `SP_AutoStockVerification` (8 h) and `SP_AutoTimeOut_Attendance` (10 min); the others are backups (`backup.exe`) and
  parent/child-server and CRS transfers. The translated procedures exist in PostgreSQL and work (on the scratch database `sp_stockledger()` added the 35 ledger rows of the 20 documents posted during the tests), but nothing called them,
  so on production the ledger would stop growing with the first new posted document (it ends at 2025-01-04 today, like the posted documents: no new transaction yet).
  `server/src/jobs.rs` is the missing scheduler: `JOBS=all` (or `JOBS=stockledger,applysalepromotions,...`) runs the procedures on the original's intervals, each on its own connection, off by default
  (it writes to the database, so enabling it on production is the owner's decision). To enable: set `JOBS: all` in `/opt/pharmacy/compose.yml` (environment of `pharmacy-app`) and `docker compose up -d`.
  The Job Schedule window itself still reads an empty list (its Agent tables do not exist in PostgreSQL).

## Walks after the fixes (2026-11-25, local server, scratch DB, Light theme)

* `e2e/modern-visual-qa.mjs` over all 203 menu screens: 0 page errors, 0 layout issues; one message box (Cashier Activity Window: "Unable to fetch cashier job data from database", the original shows the same).
* `QA_ELEMENTS=1 QA_FIELDS=1` over the 61 non-report screens: 244 elements clicked, 250 fields typed, 0 errors, every field reachable. The message boxes are the windows' own
  validations (required item name, "Item can not be sold, its Stock is Zero", "Confirm Changes", ...). Nothing is saved by the walks.

## Report screens: every criteria dialog and every preview element (2026-11-25)

`QA_ELEMENTS=1 QA_FIELDS=1 QA_REPORTS=1` over all **141 report menu leaves**: the criteria dialog each opens (3,251 elements clicked, 196 fields typed; Cancel left for the run), then
`QA_RUN=1 QA_ELEMENTS=1 QA_REPORTS=1`: each report run like a user (every dialog answered with Ok, "All" ticked) and the **2,671 elements of the preview toolbar clicked** (Print and Close skipped).
Result: no page error except one flow, **Category Wise | Gross Profit → preview toolbar Retrieve → close the "Select format" window with its × button**: `f_retrieve_report3` reads
`as_reparg = message.powerobjectparm; as_reparg.i_status` after a window that only returns through Ok, so closing it without Ok leaves nothing in the message object ("Null object reference").
The script is the original's own (the window has no Cancel); with Ok the report runs. 20 of the 141 runs showed no report on the first look: 12 stopped on the report's own input validation
(a name / supplier / sales person / invoice number has to be chosen), 6 were only slower than the walk's 3 s wait (Reorder Level Report, Manufacturer List and Dead Item List render after 20 to 120 s: the
report is 818 / 126 pages; Dead Item List's query takes 23 s on the unvacuumed local scratch database against 6.5 s on the original SQL Server, production's tables are vacuumed and analysed since 2026-11-14).

## Left in the scratch database

Rows named `QA 1125 ...` and `QA CLASS 1125` (Basic Data), purchases 12281-12283 (posted), purchase return 1489, sales 588887-588888,
sale returns 61607, 61609, 61614, 61615, quotation 2, refused sale 1, adjustments 3670-3673, stock adjustment buffer 2629.
Scratch only; production is untouched.
