# Fidelity against the running original

Everything here was measured on the original `abuzar.exe` (Windows 11, 96 dpi, 1920x1080) running against its SQL Server, not derived from the recovered definitions.
Tools: `tools/orig/` (crawler, crop, icon and sprite builders), `web/tools/{gen-profile,menu-parity,toolbar-dump}.ts`, `web/e2e/browser-smoke.mjs` (menu walk of the rebuild).

## Method
1. `tools/orig/crawl.ps1 dump` reads the live menu tree of the original through the Win32 menu API (UI Automation does not see PowerBuilder menus): 265 entries, with command ids,
   accelerators (`&`), shortcut text, separators and disabled state -> `docs/observed/original-menu-frame.tsv`.
2. `crawl.ps1 open` posts `WM_COMMAND` with each id, waits until the screen stops changing, saves a 1920x1080 screenshot per window (`<id>_<menu path>.png`), the dialogs it raised
   and the menu bar the sheet brings, then closes everything (answers "save changes?" with No).  It only opens windows; it skips Exit, Change User, backup / integrity, import,
   initialisation and batch lock.  The original ends with "Application terminated" on some windows (R0002 runtime errors in its own scripts); the crawler stops there.
3. The rebuild walks the same menu paths in Chromium (CI) and saves screenshots with the same ids (`ci-screens` release), so every original window has a counterpart to compare.

## Measured facts
| What | Value |
| --- | --- |
| Visible menu of the compared deployment (ADMIN) | 265 entries / 9 top menus, a subset of the 1,476 items of `m_entry`; reproduced exactly by `db/pg/96_rights_profile.sql` (CI check `menu-parity.ts`) |
| PowerBuilder unit | 7/32 px horizontally, 16/64 px vertically (dialog base unit 7 x 16): Login window 1582 PBU = 346 px, Ok button at 306 PBU = 68 px |
| Title bar | 25 px (+ 1 px border), `#f3f3f3` active, application icon 16 px from `abuzar.exe` (`public/app-icon.png`) |
| Menu bar | 18 px high, white, Segoe UI 9 pt, 8 px padding per item; two hairlines below, then the toolbar |
| Toolbar | etched `#a0a0a0` / `#fff` above, `#a0a0a0` / `#696969` below, 24 px band, 16 px pictures, 23 px pitch, 2 px etched separators, gripper at the left; none while no sheet is open |
| Toolbar order | by `toolbaritemorder`, not by tree order (the sheet menus list New Item / Delete Item after Save in tree position but order 4-5) |
| Pictures | `PBVM125.dll` holds the bitmaps (16x16, 8 bit) and a name table (UTF-16 name pointer + resource id, 523 pairs) -> `docs/observed/pb-stock-pictures.json`; the toolbar's `Find!` shows `Search!` (1048) |
| Status bar | 15 px sunken panel, "Ready", the menu item's microhelp while a menu item is highlighted |
| MDI client | `#ababab`, 2 px sunken edge |
| Tab control | flat themed tabs, 16 px picture (`Table!` 1082, `EditDataGrid!` 1682), text keeps its trailing blanks (tab 184 px wide), selected tab `#f9f9f9` with dotted focus rectangle, page `#f0f0f0` with 1 px `#e5e5e5` border |
| Buttons | Windows 11: `#fdfdfd`, 1 px `#d0d0d0`, radius 4; default button `#e0eef9` with `#0078d4` |
| Edit boxes (border style 5) | themed, 1 px `#abadb3`, white |
| Message box | 284 px, white body with 32 px blue circle `?`, `#f0f0f0` button strip, 72 x 20 buttons |
| Scroll bars of a DataWindow control | only when the control has `HScrollBar` / `VScrollBar` (d_login's dw_remote has none: invisible in the original) |
| String display format `'*****';'*****'` | sections text; zero-length; null, quoted literals - the password column shows `*****` whatever it holds |

## Behaviours found by running both side by side
* A tab control raises SelectionChanging / SelectionChanged for its first page when the window comes up: the entry windows (Users, Item, Sale Template) build their blank new form there.
* `getenvironment` reports the real screen: windows size their tab and DataWindows as 99 % / 98 % of it (`pixelstounits(screenwidth)`), the control tree of the original confirms it (tab 1901 x 897 px on 1920 x 1080).
* Posted events (`post event`, `postevent`) run one after the other, each to its end; while a modal window or a message box waits for its answer the queue goes on.
* `DataWindow.GetChild` leaves the variable usable even when the column has no dropdown (reports call `SetTransObject` on it without testing the return code).
* A control inside the rectangle of a hidden group box that carries no `visible` attribute is hidden in the original (the invoice / price fields of the argument windows); `dw_itemslist` of the entry windows is hidden until a script shows it.
* Group boxes are only a frame and a caption: transparent, never in front of the controls inside them. Border defaults to on for edit-like controls, off for labels and check boxes.
* A DataWindow control scrolls only where it has `HScrollBar` / `VScrollBar`; a form taller than the control shows from its top.
* String display formats `'*****';'*****'` show for empty columns, too (password columns).
* `Backup Database` is a `pg_dump`; SQL Agent job lookups (`SysJobs`) read `dbo.sysjobs`.
* A DataWindow control whose design-time `dataobject` is set takes a new one when a script assigns it (`wf_assigndatawindowobjects` of the purchase / sale return windows): the definition is reloaded; the first rebuild kept the design-time one and `GetChild` then failed.
* A `DataWindowChild` variable is usable before `GetChild` filled it (calls answer -1, no null-object error): `w_purchase` (Opening Purchase) filters one it never assigned and the original opens the window.
* `DataWindow.Show()` / `Hide()` and `x`, `y`, `width`, `height`, `visible` set from scripts reach the screen: the report window shows its preview after the retrieve.
* The height of a drop-down list box in the definition includes its list; the closed control is one line (21 px).
* Windows open in steps (posted events): a screenshot taken 2.5 s after `OpenSheetWithParm` can still show the window's design-time title (Opening Purchase showed `Pack Purchase`).
* `InsertRow` gives the new row's current cell the item focus (`ItemFocusChanged`): `dw_itemsdetail.itemfocuschanged` of the entry windows sets `editflag`, which `wf_validatedate` returns (`if not wf_validatedate() then close(this)` in the open event of purchase, sale return, quotation, adjustment, sale template ...). Without it those windows closed themselves; the original shows them open and asks `Do You want to save changes` when an untouched one is closed.
* A column whose initial value is `today` takes the current date / time when a row is inserted (the sale template's date shows `02/11/2026 11:46`).
* `object.<col>.visible = false` (a boolean) hides the column: it used to arrive as `no`, which the view did not read as 0, so every preference-driven hiding (header, item code, alias, godown column ...) was ignored. `visible` / `protect` are stored as `1` / `0`.
* A grid DataWindow (processing 1) leaves a hidden column out together with its header and total, and the columns on its right move left (Adjustment Increase shows No / Item Name / Batch / Expiry / Qty / Price / Total).
* Code-table columns (`values="Yes<tab>Y/No<tab>N/"` of the table definition with a drop-down list box style) show the display text (`Yes`) and edit with a list; a drop-down column that uses the arrow as its border (`dddw.useasborder` / `ddlb.useasborder`) shows the arrow all the time; a spin edit mask shows its arrows.
* DataWindow labels with a line break keep it and sit in the header box (`P/O Base` / `Period (Days)`); `groupbox` objects draw a thin rounded frame with the bold caption set into it; the parent redraws when a script retrieves a drop-down child.
* **Decompiler correction:** 793 loops of the recovered scripts had the loop variable as their own limit (`for i = 1 to i`); the limit was compared through a type cast and was lost. Corrected in `re-tools/pcode_struct.py`, scripts regenerated (rights loops, the customer form's field layout from `InterfaceSetting`, the item list loops now run).
* **Second decompiler correction:** 3,007 local variables lost their initial value (`boolean lb_check1 = true` ...); decoded from the local record and restored (`re-tools/decomp_obj.py local_init`). `for` loops re-evaluate their limit on every pass, as the compiled loop does.
* **Third decompiler correction:** by-reference parameters (`ref string as_appname`) were printed without `ref` in all 37,196 headers; 1,316 parameters restored. Without them returned values (the title's application name, the server date of every entry window) were lost.
* The footer band of a DataWindow is pinned to the bottom of the control (the totals of the entry windows sit at the foot of the grid), the summary band follows the last row.
* `db/pg/94_deployment_profile.sql` (generated by `tools/gen_deployment_profile.py` from the configuration tables of the compared deployment: `InterfaceSetting`, `SaleInterface`, flag preferences; no customer data, no secrets) makes the entry windows show the columns and fields the original shows.
* Named formats `[shortdate]` / `[longdate]` / `[time]` follow the regional settings (`11/2/2026 23:20`); an empty date column with an edit mask shows the zeroed mask (`00/00/0000`).
* The retail customer 19 (`****CASH SALES CUSTOMER`, alias `CASHSALES`, sub account `CUSTOMERS/DEBITORS`), area `DEFAULT AREA`, sub area `SUB DEFAULT AREA`, category `DEFAULT CATEGORY`, godown `GODOWN1` and the `ServerDate` row are first-run rows of the original.
* First-run preferences: `GroupCustomerCategory` is off (the migration of the original updates `preferences.groupcustomercategory = 'N'`), otherwise Cash / Credit Sale refuse to open for a group without customer categories.
* **Side-by-side crawl of 44 windows (original running, 7 s settle; 2026-11-03)** found and fixed: a date initial set from `string(datetime)` (day-first regional text: the default expiry `12/12/2030`, the sale promotion end date +365 days); an edit-mask date column that does not use the format shows its mask (pack purchase `dd/mm/yyyy hh:mm`, sale promotion `dd/mm/yyyy hh:mm:ss`, quotation valid-till `mm/dd/yyyy`); a null value shows the null row of its drop-down list (`<None>`), drop-down text is left-aligned; InterfaceSetting rows with equal sequence ids are ordered by column name (City / County / Post Code); the fixed purchase, sale, adjustment and notes categories are first-run rows (`Category: Opening Purchase`, and the foreign keys of every purchase / sale / adjustment header).
* **Focus:** the DataWindow that holds the keyboard when a window comes up gets `GetFocus` and its current cell in edit mode with the text selected (sale promotion `<ENTER PROMOTION NAME HERE>`, Refused Sale's detail grid, Cash Sale's item name cell with the item list popup); `SetFocus` between DataWindows raises `LoseFocus` / `GetFocus`; InsertRow raises the item focus only for the control that holds the keyboard (the Purchase Order opens without the item list, the header holds the focus); a protected current cell hands the keyboard to the first editable column of the tab order.
* Not comparable without data: windows whose lists are filled in the original (Item Priority, item list popup contents), the original's own `Preferences` window raised an error (`Invalid column name 'Name'`) in the capture, the dialogs captured instead of their window (`Do you want to save changes?` on the Item form).
* `DataWindow.Objects` (every object name, each followed by a tab) was not implemented: `f_setcolumnstyle(dw, 'Qty')` (called by 78 windows) walks it to give every `<qtystyle>` column the precision of the installation (`ColumnPreferences`: 0 decimals), so quantities showed `1.0000` instead of `1`.
* **The DataWindow engine of the original as an oracle** (`re-tools/dw_oracle`, 32-bit host of `pbdwe125.dll`; `Evaluate()` answers any DataWindow expression; the rebuild's results are compared by `web/tools/format-diff.ts` and `web/tools/expr-diff.ts`). 3,109 number / date-time / text format cases: 3,092 agree (the rest are numbers shown under date masks); 290 expression cases (round, mid, pos, string, date and time functions, conversions): 278 agree. Fixed from it: grouping is by three whatever the commas of a mask say; fraction digits are rounded to the placeholders and trimmed down to the number of `0`s (`###0.##0` shows `1.0`, `######.##` shows `1.`); `[currency]`; `[time]` is `hh:mm:ss`; `[general]` of a date is the short date; `am/pm` keeps the case of the mask; a day name after the time in one mask; `@` masks pad with blanks; a mask without digit places shows itself; doubles print with 16 digits (`1/3`); `Pos('abc', '')` is 0; `Number()`; `Real` / `Dec` read thousands separators.
* **Regional short date:** `String(date)`, `Date('3/11/2026')` and `[shortdate]` follow the order of the machine, measured month first on the reference machine (`11/3/2026`); the page takes it from the browser's locale (`?dateorder=dmy|mdy` overrides it). Windows' digit grouping setting is not modelled (three digits).
* Layout of grid DataWindows measured with the engine: a column that is switched on (`Visible=1`) is appended behind the last visible one in the order of the calls, so the Purchase Order follows the InterfaceSetting sequence (Min Qty after Optimum Qty).

## Focused temporal-format follow-up

The historical 3,109-case formatter comparison above excluded engine outputs
containing question marks. Those exclusions could hide real display
differences: a Date value has no time, and the original displays missing time
components as question marks rather than literal tokens or zeroes.

A separate, bounded 32-bit host of the existing DataWindow engine evaluated
22 synthetic literal expressions, using `d_purchaseorderdetail` from
`pocomponents.pbd` only as an evaluation container. It did not launch the ERP,
call Connect/Retrieve, read records, access backups or alter licensing.
The installed `pbdwe125.dll`, `PBVM125.dll` and `pbshr125.dll` were SHA-256
matched to their original Application copies before execution. Each probe
owned its process and had a 30-second timeout; no process-name termination
was used. This is repository-oracle evidence, not an REA Evidence record.

| Artifact | SHA-256 |
|---|---|
| `pbdwe125.dll` | `0681ebb22fa72c7eeabbca07ff964adf190384f2864968a43ad3115bf99a2a9d` |
| `pocomponents.pbd` | `016faa32e3287d7d61eba358c0fc35da4e7fac5c411048bc6775e9ebc187db2b` |
| `engine_host.py` | `aa1404707c1e6d8bf821e67b5d7816610ae578fd67e413422acf51b1569c31dc` |

Observed examples:

| Value and mask | Original output |
|---|---|
| Date 2026-11-13, `dd/mm/yyyy hh:mm` | `13/11/2026 ??:??` |
| RelativeDate of 2026-11-06 plus 7 days, same mask | `13/11/2026 ??:??` |
| DateTime 2026-11-13 05:09:13, same mask | `13/11/2026 05:09` |
| Date 2026-11-13, `h:m:s a/p` | `??:??:?? ?` |
| Date 2026-11-13, `mm:ss ddd mm` | `??:?? Fri 11` |
| Time 05:09:13.123, `hh:mm:ss.ff f fff ffffff` | `05:09:13.12 1 123 123000` |

The shared Date/DateTime formatter now uses one contextual tokenizer, preserving
the month/minute distinction and the engine's missing-component widths.
Time and DateTime also honor the observed one- and two-digit fraction tokens.
The purchase-change due-date formula and `dd/mm/yyyy hh:mm` mask are unchanged.
`format-diff.ts` includes question-mark outputs instead of treating them as
failed observations; its U+FFFF and crash handling are unchanged.
All 22 observations match through `expr-diff.ts`, with none skipped.
Unit cases and both-mode real-metadata browser cases retain these contracts.

Exact expressions, raw JSONL, all runtime hashes and the comparison are retained
in this session's `date-mask-oracle` artifacts, including its `tokens` and
`fractions` subdirectories. This focused result does not rerun or replace the
historical full-format corpus, prove all temporal masks, recover sub-millisecond
precision, or establish packaged/native UI or database acceptance.

## Not yet matched
* `Long('12.5')` / `Integer('12abc')`: the engine answers null / 0, the rebuild keeps the leading number (PowerScript behaviour the menu rights code relies on).
* The original crashed during the crawl after `Modify Last Transaction Date`; 16 more windows (Interface Setting, Groups, Users, Session Monitor ...) are not captured yet.
* The window height of response windows: measured factor 0.924 of the height in units (Login 234 px, Select Format 306 px), the reason is unknown.
* Dropdown menu pixel metrics (width, padding) were approximated from screenshots; the crawler does not open dropdowns.
* One menu caption: the original shows "Sale And Return " where `m_entry` has "Sale And Return (One Category)" (changed by a script path not yet found).
* Data-dependent screens need real data in the rebuild's database.

## The 50 DataWindow retrieves that fail on PostgreSQL (checked against the original's database, 2026-11-03)

Every failing retrieve of the CI sweep (run 41563063841, 8616 of 8666 run) was classified; the original statement was bound against the live SQL Server database of the deployment (`sys.dm_exec_describe_first_result_set`; for the PBSELECT-format ones the column or table was looked up in the catalog; metadata only, no rows read):

| group | count | verdict |
|---|---|---|
| linked-server pass-through (`ddd_access_*`, `ddd_dropbox_*`: `SRV.DB.OWNER.table` built by dynamic SQL, the sweep passes empty names) | 15 | cannot exist on PostgreSQL by design; a data-transfer feature |
| the original's own statement fails the same way: unknown column (`preferences.terms` x4, `godowndetail.reorderqty` x3, `userattendance.in_datetime`, `dispatchheader.biltynumber`, `salesman.password`), unknown table (`departmentsection`, `clinictest` x2, `balancecategory`), typo alias (`saleledgerl`, `studentservicetemplatedetail` in ORDER BY), ambiguous column (`printbalance`, `headerno`), ORDER BY column outside GROUP BY (`t.name`) | 20 | defects of the original; SQL Server rejects them with the same messages |
| `ORDER BY :ai_ordercol` (`d_postedsale_for_population`, `..._proformainvoice`) | 2 | SQL Server 2022 rejects it as well (Msg 1008, variable as column position); left as is |
| the sweep passes `''` / an array where the application passes a date text / a scalar (`d_dashboard_*_drilldown` x7, list arguments x3) | 10 | sweep artefact; SQL Server accepts the statement |

The rest (`d_selection_text` SysColumns, `d_purchase_resultset_from_excel` OPENROWSET, `d_crs_branch_itemstockposition`: the recovered V3 procedure has three more parameters than the DataWindow supplies and the deployed procedure has an empty body) are features without a PostgreSQL counterpart. No translator defect is among the 50.

## The failing procedures and embedded statements of the CI sweep (checked 2026-11-03)

Procedures (the sweep calls each of the 638 once with NULL arguments on the empty schema; 128 failed, 122 of them found in the recovered T-SQL source and classified by what it does):

| group | count | verdict |
|---|---|---|
| database / server name built into dynamic SQL (`@SRV.@DB.@OWNER.table`, data carry, drop box, CRS push, parent server, Waseelamini) | 68 | cross-database or linked-server work; the sweep's empty names give `..` |
| system catalogue or DDL on names (`sysobjects`, `OBJECT_ID(@name)`, `INFORMATION_SCHEMA`) | 21 | no PostgreSQL counterpart |
| other dynamic SQL, `msdb` jobs, `xp_cmdshell`, `sp_OACreate` (fiscalization), `WAITFOR`, `DBCC`, `OPENROWSET`, `SheerazDB*` | 24 | same |
| the original cannot run them either: `sp_incomestatment` (`adjdetail.bonusqty` does not exist), `sp_itemingodowns` (`StockInAllGodown`), `sp_postservicesrallocationheader` (`ServiceSRHeader`), `sp_test1` | 4 | defect of the original |
| `sp_datewisesalebreakup` | 1 | the sweep passes 0 days: the loop never ends in T-SQL either |
| `sp_salesman_collectionplan` | 1 | **real translator defect, fixed**: it returns a cursor over `#cust` and then drops `#cust` (error 55006); the translator now skips the DROP of a temp table an open result set reads (`tools/tsql/tstmt.py`; the one routine of 642 with the pattern is patched in `db/pg/60_procedures.sql`) |
| `sp_fiscalizesaleinvoice`, `sp_fiscalizesrinvoice`, `sp_init_update_tabmaxkey` | 3 | `sp_OACreate` / `OBJECT_ID(@name)`, as above |

Embedded statements (15 of 1862 fail): 13 fail on the original's database too (missing `script`, `lockers`, `groupitemwise*` tables, `salesman.password`, `customer.code`, `itempacking.icatcode`, `itemcategory.packcode`, `itemclass.catcode`, `issuereqdetail.gcode`; `prescriptionheaderlog` has 15 columns where the statement supplies 16); 2 (`NULL * NULL`, `NULL / NULL` in an UPDATE / INSERT) are artefacts of the sweep's null arguments.

## The windows that do not open bare in the headless smoke (2,046 of 2,062 open, checked 2026-11-04)

The smoke opens every window class with a mock database and a `message.powerobjectparm` that answers 0 / empty text for any field. 16 windows still fail; none is a runtime defect, each reads something its caller normally supplies:

| windows | what they read | why they cannot open bare |
|---|---|---|
| `w_alternate_item_aliasname_form`, `w_alternate_item_aliasname_req_form`, `w_item_pricepolicy_form` | `message.powerobjectparm.dw_header` (the caller's header DataWindow), passed to `f_setcolumnstyle` | the argument structure carries a DataWindow reference the smoke cannot invent |
| `w_graph_series`, `w_select`, `w_printer`, `w_visitprescription`, `w_saleinpurchase`, `w_findwindow` | fields of the argument structure (`datawindow`, `printer`, `bsa`, `icode`, column list) | same: values come from the opening window |
| `w_entry`, `w_single_entry`, `w_listview_form`, `w_popup_comprehensicesearch_selection(2)`, `w_popup_partialsearch_selection(_acc)` | the search/list DataWindow that a descendant sets before `wf_populate_ddlb` runs | abstract ancestors / popups, never opened without that setup |

An uncommitted edit that made `DataWindow.InsertRow` always fire `ItemFocusChanged` raised the failures to 180 (164 windows reach `w_main.SetMicroHelp` with no `w_main` in the smoke); it was reverted, and the documented rule stays: a grid that another DataWindow's focus has passed by gets no event.

## 2026-11-05 screen-by-screen and add/edit/delete run

Tools: `tools/parity/capture-old.ps1` (Win32 control tree + screenshot of every
opened original screen), `tools/parity/crawl-new.mjs` (Playwright; window,
control and DataWindow inventory of the rebuild), `tools/parity/crud-fields.mjs`
(types every editable cell, saves, edits from `File | List`, deletes and checks
the result in PostgreSQL).

### Menu

* Original live menu: 262 items. Rebuild visible menu: 261 items.
* Missing in the rebuild: `Reports | Sales Reports | Customer Sales | LP Ledger`
  (it exists in the menu class but is hidden; the original shows it).
* Renamed: `Reports | Sales Reports | Category Wise | Sale And Return` is
  `Sale And Return (One Category)` in the rebuild.
* No enabled/disabled differences among the common 261 items.

### Screens captured on both sides

* Non-report actionable screens: **62/62 opened in the original** (62 screenshots,
  every top-level control dumped) and **62 attempted in the rebuild** (55 windows
  opened directly, 7 response windows stopped at their modal and were captured;
  0 page errors).
* 141 report screens are being captured separately (`screen-parity/new-reports`);
  the first report argument dialogs already show the restored labels.

### Per-field add / edit / delete / save (PostgreSQL verified)

16 master-data forms passed the full field-driven add / edit / delete sequence
(every editable cell was clicked and typed, then `File | Save`, `File | List`,
select, `File | Detail`, edit, save, `File | Delete`, confirmed):

`Customer Category`, `Customer Sector`, `Generic Item`, `Generic Item Type`,
`Item Alert`, `Item Category`, `Item Class`, `Item Thickness`, `Lock Reason`,
`Manufacturer`, `Manufacturer Type`, `PCT Codes`, `Supplier Category`,
`Sales Tax Schedule`, `Tax Category`, `Category Segment`.

For each: the ADD row was read back from PostgreSQL, the EDIT changed the
same key in place (row count for the unique name prefix stayed 1, so no
insert-on-edit), and the DELETE removed it. `Sale Promotion` is the one
failure: its Active / Customer Group / Weekday drop-downs are empty in the
migrated clone, so the form cannot produce a valid FK value; this is missing
reference data, not a form failure (the same empty lists appear in the
original's database).

The edit step uses `File | List` -> select -> `File | Detail`,
then changes the name and saves; the row count for the prefix stays 1
(no insert-on-edit). Delete answers `Yes` to
`Delete this record permanently from Database?` and the row is gone.

### Defects found and fixed by this run

1. **DataWindow writes hit the wrong schema**: `buildUpdate()` emitted
   `INSERT INTO manufacturer ...` without `dbo`, so every add/edit on a
   DataWindow whose `update` table is unqualified failed with
   `relation ... does not exist`. Now qualifies unqualified tables with
   `dbo` (`web/src/dw/model.ts`). Evidence: the manufacturer INSERT
   succeeded (code 1030) and the row was read back from
   `dbo.manufacturer`.
2. **Column validation was absent**: `SetValidate`/`GetValidate` were not
   implemented and design-time `validation` rules were ignored. Added the
   run-time rule store, design-time lookup, `GetText()` in the expression
   evaluator, `ItemError`, and `ValidationMsg` display
   (`web/src/runtime/native/dwctrl.ts`, `web/src/ui/dwview.ts`,
   `web/src/dw/expr.ts`). `datawindow.setvalidate` no longer appears in the
   Cash Sale missing-call list.
3. **Recovered expressions contain SQL comments**, e.g.
   `Round(...) /* old formula */`; the parser rejected the `/ *` pair.
   `compileDw` now strips `/* ... */` and `//` comments. Loose Purchase
   dropped both `dwexpr:unexpected '*'` calls.
4. **Standard user-object ancestors were unresolved**: `st_1`, `st_2`,
   `st_3` (101 controls), `olecontrol` (8) and `dw_price` (2) became blank
   non-visual objects, losing labels/buttons/DataWindows. Unknown ancestors
   now map to their native class. The report argument dialog now shows
   `Selectable Areas`, `Selected Areas`, `Start Date`, `End Date`,
   `Cash`, `Credit` and `All`; before the fix those labels were absent.
5. **Nested reports threw `DwModel is not defined`** because the class was
   imported type-only; changed to a value import. Groups no longer logs
   `nested:DwModel is not defined`.
6. **Null `dwo` in `Clicked`/`DoubleClicked`**: clicks outside a cell passed
   `null`, so scripts doing `dwo.name` raised
   `Null object reference (reading name)`. The event now always receives a
   `{ name: '' }` object.
7. **Double-close races** in message boxes and DataWindow editors produced
   `Failed to execute 'remove' on 'Element'` page errors; close operations
   are now idempotent/`isConnected`-guarded.

### Remaining measured gaps

* 141 report screens are still being walked; report pixel/column parity is not
  yet asserted.
* `LP Ledger` remains hidden; the original's show condition is not recovered.
* `d_retailsalereturninvreport` and `d_wholesalereturninvreport` are two of the
  8 DataWindow definitions that were not recovered; sale-return invoice print
  cannot be completed without them.
* Delete right 579 is not seeded in the migrated rights table (also absent in
  the live original); the clone was granted it only for the CRUD test.
* The 62-screen control diff is captured but not yet reduced to a per-control
  change list.
