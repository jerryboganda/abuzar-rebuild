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
| Session Monitor listed nothing: the connection query filtered by the app's database name (`trader`) instead of the actual PostgreSQL database; user name showed 0 for text; computer name blank | `datname = current_database()`, client address as computer name, user name left blank (`runtime/sql-fixes.ts`) | this commit |
| Session Monitor's bottom options band ("Maximum Users Allowed", "Refresh after every n Seconds") was clipped to a 30 px strip, the spin buttons unreachable | window-specific layout rule in `ui/design-system.ts` | this commit |
| A plain drop-down kept showing "Choose a value" after a script set the record's value following the editor's creation (Cashier Job's Job Owner) | `DwChoiceEditor.syncRecordValue` | this commit |
| Server time was the start of the transaction (`localtimestamp`), so the back-date check (`ServerDate.LastTransDate`) refused saves ("Back Date Invoice Check violates", Change Items Price 4 of 5 times) and stale times were stored | `statement_timestamp()` in `GetDateTime`, dynamic `GETDATE()` and the fiscalization stamps | 29d646ed |

## Session Monitor

The server (commit e96c7735, compiled and deployed on the VPS) names each connection `waseela (<usercode>)` (`application_name`) when
the client opens it with its user, and the monitor query shows that user code, like the original's session table
(`tempdb..SysIsolaation`, filled at login). Computer names are the client addresses (a browser has no computer name) and your own
session is not highlighted (no session id in the browser).

## Open (a deployment step, not code)

* **`serviceheads.pbd` and `mgmtcomp.pbd` are not on the production server.** The original reads the company name and the report
  headers from these two vendor files (`af_get_header_setting`, `af_get_app_setting`) through the server's file root. The
  desktop deployment had them in `FS_ROOT` (`deploy/parity/rebuild-dist/files/`); on the VPS `/srv/files` is empty and is not a
  mounted volume, so (a) the company name and report headers are empty there and (b) Group Wise Header Setting shows no rows.
  Copying the files needs a persistent volume for `FS_ROOT` in `/opt/pharmacy/compose.yml` and the owner's go-ahead (the
  files carry the client's name, address and licence data). Nothing in the code needs to change.

## Verified against the original's own behaviour (no change)

* "Item Validation: Item can not be sold, its Stock is Zero" and the close prompts match the original (reproduced live).
* The Lock Item Batches / Priority Setting lists open sorted descending although "Ascending" is checked: `w_multi_entry`
  initialises `is_sortsequence` to "D" and the original's script only ticks the radio.
* A purchase return lowers stock at save, before posting (as the earlier return 1488 did); quotation and refused sale store 0 for
  invoice total / sale price (the original's scripts never write them). The rebuild runs the recovered scripts as they are
  (`w_purchasereturn.wf_updateitemstock*` run in the save), so the timing is the original's own code.
* The purchase summary's RPP shows `585.5700000000001`: PowerScript `string(double)` of a double prints 16 significant digits with
  the last one rounded from the 17th (measured with the original's DataWindow engine: `1/3` -> `0.3333333333333333`,
  `10/3` -> `3.333333333333334`, `0.1+0.2` -> `0.3`); the rule is in `runtime/values.ts` and was left as measured.
* Dates follow the browser's regional order (month first in the test browser), as the original follows Windows.

## Left in the scratch database

Rows named `QA 1125 ...` and `QA CLASS 1125` (Basic Data), purchases 12281-12283 (posted), purchase return 1489, sales 588887-588888,
sale returns 61607, 61609, 61614, 61615, quotation 2, refused sale 1, adjustments 3670-3673, stock adjustment buffer 2629.
Scratch only; production is untouched.
