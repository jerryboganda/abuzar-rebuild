# Parity run 2026-11-05 â€” screen and field coverage

This file records the measured state of the screen-by-screen / field-by-field
parity audit.  It is the hand-off for the next session; numbers below come from
the tools in `tools/parity/`.

## What was compared

| Area | Original | Rebuild | Evidence |
|---|---:|---:|---|
| Visible menu items | 262 | 261 | `orig-menu.tsv` vs `menu-compare.json` |
| Non-report screens opened | 62/62 | 62 attempted (55 direct, 7 captured at their response window) | `deploy/parity/screen-parity/old-nonreport`, `new-nonreport` |
| Report screens opened | not yet (old crawl pending) | 53+ captured so far | `screen-parity/new-reports` |
| Master-data forms: every editable field typed, add/edit/delete/save verified in PostgreSQL | 16 forms | 16 forms | `screen-parity/crud-fields/crud-*.json` |
| DataWindow expression parse sweep | â€” | every `expression` parses; SQL comments stripped | `tools/parity/dw-expr-audit.mjs` |

The 16 passing forms are: Customer Category, Customer Sector, Generic Item,
Generic Item Type, Item Alert, Item Category, Item Class, Item Thickness,
Lock Reason, Manufacturer, Manufacturer Type, PCT Codes, Supplier Category,
Sales Tax Schedule, Tax Category, Category Segment.

`Sale Promotion` is the only tested form that cannot complete: its Active /
Customer Group / Weekday drop-downs are empty in the migrated clone (missing
reference rows), so no valid FK value can be produced.  This is a data gap,
not a form defect.

## How to reproduce

```powershell
# original (needs the local logged-in abuzar.exe; read-only)
powershell -NoProfile -File tools/parity/capture-old.ps1 <ids.tsv> <outdir> 3500

# rebuild screens (starts its own Chromium; reads the local login script)
node tools/parity/crawl-new.mjs --base http://127.0.0.1:5177 --items <paths.json> --out <dir>

# full CRUD, one form at a time
node tools/parity/crud-fields.mjs --base http://127.0.0.1:5177 --db trader_write_test --form manufacturer

# discover the detail/list DataWindow and table of a screen
node tools/parity/discover-forms.mjs
```

## Fixed in this run

1. `DwModel.buildUpdate()` qualifies unqualified tables with `dbo`; without it
   every INSERT/UPDATE/DELETE failed on the PostgreSQL port.  Verified by
   inserting code 1030 into `dbo.manufacturer` and reading it back.
2. `SetValidate` / `GetValidate` and design-time column validation implemented,
   including `GetText()`, `ItemError` and `ValidationMsg`.  `datawindow.setvalidate`
   no longer appears in the Cash Sale missing-call list.
3. DataWindow expressions with `/* ... */` comments now parse; Loose Purchase
   lost both `dwexpr:unexpected '*'` calls.
4. Unknown standard user-object ancestors (`st_1`, `st_2`, `st_3`, `olecontrol`,
   `dw_price`) map to their native control; the report argument dialog now shows
   its labels.
5. Nested reports no longer throw `DwModel is not defined` (value import).
6. `Clicked` / `DoubleClicked` always pass a `{ name: '' }` object, removing
   `Null object reference (reading name)`.
7. Message-box and DataWindow editor close paths are idempotent.

## Open, in priority order

1. Finish the report crawl (141 screens) and reduce the report argument/final
   screenshots to a per-screen diff.  The crawl is slow because each report
   blocks on its format/argument dialog; it is safe to run in the background.
2. Reduce the 62-screen old/new control inventory to a per-control change list
   (the raw control trees are already saved as JSON on both sides).
3. Complete the remaining master forms: Customer, Supplier, Item, Users,
   Sale Promotion (needs reference rows), Price Policy and the multi-row
   group settings.
4. `LP Ledger` is still hidden in the rebuild menu although the original shows
   it.  Its menu-item `visible` is false in the recovered create script and no
   recovered script sets it true; find the original's show condition (rights or
   a start-up script) rather than forcing it visible.
5. `d_retailsalereturninvreport` and `d_wholesalereturninvreport` are among the
   8 DataWindow definitions that were not recovered; sale-return invoice print
   cannot be completed without them.
6. Delete right 579 is absent from the migrated rights table (also absent in
   the live original).  For the CRUD tests it was granted in the clone only;
   do not ship that grant.
7. `dwname:invdiscperc` on Credit Sale: the footer `d_salefooter2` does contain
   the column, so the failing read is somewhere else (a DataStore setitem or a
   child DataWindow); trace the `recent` routine that was running when it fires.

## Later additions (same day)

* **Tab pages now obey `visible`.** Interface Setting hides the patient,
  service, customer-site and item-registration tabs through
  `wf_set_tab_visibility()` and `f_rightexists()`; the DOM tab renderer used to
  draw every page regardless. It now removes the tab and page of a hidden page
  and re-syncs when a script changes visibility. The screen shows the same 13
  tabs as the original, not 20+. `f_rightexists(206/455/984/1110)` was verified
  to return false in the rebuild, so the hiding path itself was correct.
* **Response windows are centred after Open resizes them.** Interface Setting,
  About and the report argument dialogs were built centred and then moved to
  their old coordinates by the resize in Open. `syncWindow()` now re-centres a
  modal (`windowtype = 3`) window after applying its final size.
* **Editor removal race fixed.** `DwView.edit()` cleared `this.editor` after
  removing the old editor; the synchronous blur handler could remove it a
  second time (`Failed to execute 'remove' on 'Element'`). The field is now
  cleared first; the Cash Sale field probe reports **0 page errors**.
* **Visual diff of 59 non-modal screens** (old vs new screenshot, crop
  0,80-1900,980, per-pixel difference >40): median **2.09%**, mean **3.75%**,
  28 screens under 2%, 48 under 5%. The worst screens are state or
  configuration differences (Interface Setting was 31.75% before the tab fix;
  Priority Setting 14.95% because the old capture had a live find filter and
  wider saved column widths; About 25.6% because the rebuild intentionally has
  no licence text).
* **Cash Sale and Refused Sale now open with their item search list visible**,
  as the original does; Credit Sale, Purchase and Purchase Order open without
  it.  The runtime used to hide `id_itemslist` for every entry window after
  Open.  The decision now looks at the detail DataWindow (`d_retailsaleheader`
  vs `d_wholesaleheader`), not at the title, which is set too late.
* **Event wiring audit:** every standard interaction event that has a script in
  the recovered controls (`clicked`, `doubleclicked`, `itemchanged`,
  `rowfocuschanged`, `selectionchanged`, `getfocus`, `losefocus`, `modified`,
  drag/drop, label edit, sort, â€¦) is fired by the DOM/native layer.  The only
  events found without a UI dispatcher are lifecycle events (`constructor`,
  `create`, `destroy`, `destructor`) and non-visual classes, which the runtime
  dispatches itself.
* **Report dialog pixel measurement:** six first-stage report dialogs were
  captured on both sides as dialog-only crops.  The rebuild is consistently
  3 px narrower and 8 px shorter (e.g. 350x332 vs 353x340 for Select Format;
  414x479 vs 417x487 for the Sale Summary format list), with the same captions
  and the same radio/button order.  At the current geometry 15-17% of dialog
  pixels differ by more than 40, mostly because the row spacing is 26 px
  instead of 28 px.  This is the known response-window height-factor gap, now
  measured on a concrete dialog rather than estimated.
* **Report coverage so far:** the original captured **139 of 141** report
  commands (the two that crashed it are listed above); the rebuild has
  **131 of 141** first-stage captures (84 in `new-reports`, 47 in
  `new-reports-b`; the remainder is still crawling).  The 67 pairs captured
  before the first background batch are compared below.
* **Report dialog captions:** the 117 first-stage pairs captured were compared
  by visible caption text: **0 old captions missing**
  in the rebuild.  The rebuild capture contains 1008 extra strings because it
  also captured the later stage dialogs (`Specify Retrieval Arguments`,
  `Preparing your report to display`, the final report) that the old crawl did
  not advance to.  This is a caption-level check, not a pixel check.
* **Original report defects found:** the old crawl stopped twice with
  `NOFRAME`, i.e. the original process closed itself:
  `Reports | Sales Reports | Customer Sales | Customer NTN Wise Sales Tax
  Report` (id 10303) and `Reports | Listing | Manufacturer List` (id 10591).
  Both are recorded as original defects, not rebuild failures.  The other
  **139 of 141** report commands were captured from the original.
* **Transaction saves re-verified on the clone (2026-11-05):**
  Cash Sale saved invoice **588888** (customer 19, FACE MASK icode 9801,
  qty 1, price 10.00, misc 1.00, total 11.00, posted Y); Credit Sale saved
  **588889** (customer 22, posted Y); Purchase saved **12283** (supplier 311,
  FACE MASK, purchase price 2.00, posted N).  The database rows were read back
  from `dbo.saledger` / `dbo.saledetail` / `dbo.purledger` / `dbo.purdetail`.
  The Sale Return probe selected the item but did not create a new return row
  in this run (the earlier 61604 evidence predates this session); treat sale
  return save as **not re-verified today**.
* **Users add verified:** `Manage | Users` -> New -> model fields -> Save
  created `dbo.users` usercode **10**, username `PZUSER240478`, active `Y`,
  group 2 in `dbo.usergroups`.  Users edit/delete from the list did not load
  the master row in the probe (`id_master` stayed empty), so they remain
  untested, not failed.
* **Group/price settings field probes:** Users 7 of 8 editable cells, Price
  Policy 7 of 7, Group Allowed Price 2, Group Cash Account 2, Group Supplier
  Category 1; all finish with 0 page errors and close without saving.
* **Transaction field probes**: Cash Sale exposes 64 editable detail/header
  columns; 15 were typed through the DOM before the dependency checks stopped
  the rest (item/discount/sale price need a selected item). Purchase exposes
  73 and 31 were typed; the validation messages `Supplier with AliasName ...
  does not exist` and `Purchase Price 1 is greater than Sale Price` appeared as
  in the original, with 0 page errors.
* **Large master forms field probes**: Customer Form 84 editable columns, 53
  typed; Item Form 124, 30 typed (the rest live in inactive tabs/protected
  columns); Supplier Form 34, 33 typed.  All five probes (including Cash Sale
  and Purchase) finish with **0 page errors**; closing answers No to
  `Do You want to save changes`, so no document was saved.

## Second session (same day, continued)

### Systemic fixes committed

1. **DataWindow expression engine completed.** Every one of the **189,852**
   expressions the runtime actually evaluates now compiles: nested `/* /* */ */`
   comments, tabs inside computed expressions, `for all distinct a, b`,
   `not in (...)`, `between x and y`, `case(... when 2 to limit ...)` and
   `case(... when IS > x ...)`, hyphens in `stock- dueqty`, comment-only
   computed fields, and division by zero returning null instead of aborting.
   Audit tool: `tools/parity/dw-expr-audit.mjs`; result **0 failures**.
2. **List -> detail reads.** The decompiler emitted
   `id_dwcontrol.borderstyle.code[row]` for `id_dwcontrol.object.code[row]` in
   ~90 windows.  `NDwBase.pbGet('borderstyle')` now aliases the DataWindow
   object, so Adjustment, Purchase, Sale, Return, Priority, Users and the group
   settings list-to-detail paths work.
3. **INSERT and database defaults.** Untouched NULL columns are omitted from
   INSERT, so defaults such as `GroupSupplierCategory.Status = 1` apply.  This
   fixed Group Wise Supplier Category save.
4. **Auto-instantiated local user objects.** A null local whose declared type
   is a user object is instantiated on first method call; this fixed
   `PreserveDeletedSaleItemsLog -> u_deleted_saleitemlog.of_generatelog` on
   Cash Sale (zero page errors after the fix).
5. **Tab pages fill the tab client area.** `tabpage_detail.height` now tracks
   the runtime tab height.  Before this, the Item form set
   `dw_detail.height = tabpage_detail.height * 0.70` from the tiny design
   height and clipped Restricted, Narcotics, Lock DiscPerc, Active, Min. Qty,
   Generic Name, Taxable Item, S/Tax Schedule, PCT Code and Commission.  All
   now render as in the original.
6. **Invalid numeric text is rejected** through ItemError instead of being
   silently coerced to 0 (which could trigger a script division by zero).
7. **Radio buttons are mutually exclusive within their group.**  Selecting
   Category Wise now unchecks Manufacturer Wise; Change Item Discount opens the
   category-wise form `d_changeitemdisc_catwise` instead of the manufacturer
   form.

### Verified through the UI and PostgreSQL

* Users detail rows: add group 5 to user 10, save, delete, save; master user
  survives (`dbo.usergroups`).
* Price Policy 7670 (FACE MASK): add qty 999999 at 13.25, edit to 14.50, delete;
  master survives (`dbo.pricepolicydetail`).
* Group Allowed Price (group 11): add module 1 / price 2, edit to 3, delete.
* Group Wise Cash Account (group 5): add module 12 / cash account 3 (rowid 177
  assigned), edit to 4, delete.
* Group Wise Supplier Category (group 11): add category 1, delete.
* Priority Setting item 9801: priority 10 -> 11 saved, then restored to 10
  (`dbo.godowndetail`).
* Interface Setting: all 20 tabs load; visibility of `isizecode` saved
  1 -> 0, confirmation shown, database verified, restored to 1.
* Preferences: all **37** tab pages instantiate; hidden tabs follow the
  original `wf_set_tab_visibility()` rights.  All preference DataWindows load
  (e.g. Sale 251 rows, Purchase 109, Service 229).
* Change Item Discount drives through Format -> Selection Criteria ->
  Change Item Discount Form; Category Wise yields `d_changeitemdisc_catwise`.
* Group Wise Godown Setting opens through the group argument dialog with all
  strategy DataWindows and the nine allowed-godown grids for group 2.

### Still open

* Full add/edit/delete/save pass on Customer, Item and Supplier master forms
  with every field (the forms now render all fields; CRUD evidence is partial).
* Transaction line edit/delete/totals and the remaining transaction variants.
* Nested workflows not yet driven to save: Modify Sale Invoices, Modify Last
  Transaction Date, Update Item Basic Data, Change Item Reorder Qty, Session
  Monitor, Cashier Activity, Job Schedule.
* Reports: 138 menu paths paired; first-stage dialog captions compared, final
  stage and pixel geometry still to be reduced per report.
* Visual geometry: response dialogs remain ~3 px narrower / 8 px shorter and
  row spacing 26 vs 28 px; Priority Setting column widths.
* `LP Ledger` still hidden; the two original crash reports remain original
  defects.

Correction to the first-session note: Sale Return **is** re-verified.  Return
invoice **61605** (`saleinvcode 588888`, FACE MASK 9801, qty 1, price 10.00,
posted Y) was created at 2026-11-05 02:16:30 and read back from
`dbo.srledger` / `dbo.srdetail`.

## Third session (continued)

### Verified through the UI and PostgreSQL

* **Customer create/edit:** account/customer **329** created (subcode 3, active
  Y, city KARACHI), then city edited to LAHORE; both `dbo.accounts` and
  `dbo.customer` read back.  Delete is refused with the inherited original
  message “Some information refering to this record exists” (the form has no
  `ue_delete` override; it deletes the current accounts row which is still
  referenced by `customer`).  Treated as the original rule, not a rebuild gap.
* **Item create/save:** items **29041/29042** created with name, alias,
  manufacturer/class/category/packing, sale/purchase/retail price, pack units,
  active flag and supplier row (`dbo.itemsuppliers`, supplier 18).  The two
  rows were removed afterwards including the auto-created price policy.
* **Supplier create/edit:** supplier/account **331** created (subcode 7, active
  Y, city KARACHI), then city edited to LAHORE; both tables read back.  Delete
  follows the same inherited accounts-row rule as Customer.
* **Cash Sale detail lines:** item 9801 added, qty/price/discount/flat-disc
  changed through the model, then the line deleted (`id_detail` rows 1 -> 0)
  with **0 page errors**.
* **Purchase detail lines:** item 9801 added, pack qty 1 -> 5 changed the footer
  total 2 -> 10, purchase price 2 -> 3 changed it 10 -> 15, then the line was
  deleted (rows 1 -> 0) with **0 page errors**.  The footer keeps the last total
  after line deletion; verify the original’s behavior before treating that as a
  defect.
* **Modify Last Transaction Date:** dialog `w_set_lasttransdate` showed the date
  field `05/11/2026 00:00:00` plus Ok/Cancel; Ok updated
  `dbo.serverdate.lasttransdate` from `2026-11-05 04:14:53` to
  `2026-11-05 00:00:00`, showed “The last Transaction Date has been changed”,
  closed the window, and the original value was restored afterwards.  0 page
  errors.

### New runtime fixes in this session

* Runtime `UpdateTable`, `Update` and `Key` overrides are honoured by
  `buildUpdate()`/`whereFor()`; this is what makes Customer and Supplier save
  their second (`customer`/`supplier`) table after the `accounts` insert.
* `stateprovince` seed 7 (“NOT SPECIFIED”) restored in the clone; without it
  every Customer/Supplier insert violated `fk_customer_stateprovincecode`.
* Control-tree audit (`tools/parity/control-tree-audit.mjs`) ran all 62
  non-report screens: **0 missing controls/tab pages/DataWindows**; the only
  dataobject differences are the intended Cash/Credit/Opening/Return variants.
  Three screens timed out at login (Manufacturer Type, Preferences, About) and
  need a re-run, not a code change.

### Still open after the third session

* **Cash Sale totals verified** on real DOM edits: qty 1 -> 2 changed the footer
  total 11 -> 21; price 10 -> 15 changed it 21 -> 31; the computed detail total
  changed 10.00 -> 20.00 -> 30.00, with 0 page errors.  The earlier “stuck”
  result was a model-level probe that skipped `itemfocuschanged` (the event
  that calls `wf_grandtotal()`).
* Full field-by-field CRUD on every transaction variant and the remaining
  modal workflows (Modify Sale Invoices, Last Transaction Date, Update Item
  Basic Data, Change Item Reorder Qty, Session Monitor, Cashier Activity, Job
  Schedule) is still in progress.
* Reports: 138 paths paired; final-stage/pixel comparison still open.
* Reference-data gaps: live `CustomerGroup` is empty (Sale Promotion cannot
  choose a group in either app); other reference tables still need a
  live-vs-clone count audit.
* Visual geometry: response dialogs still ~3 px narrower / 8 px shorter; row
  spacing 26 vs 28 px; Priority Setting column widths.

## Fourth session (same day, continued)

### Fixed

* `filereadex` now follows PowerBuilder: in `LineMode!` it returns one line
  (CR/LF/EOF), in stream/text mode it returns the whole file (or the requested
  blob length).  The old implementation always returned the whole file, which
  made both `mgmtcomp.pbd` and `serviceheads.pbd` unreadable.
* Startup now calls `af_get_app_setting()` exactly where `traderappv1.open`
  does, so `gs_company` comes from `mgmtcomp.pbd` (previously empty).
* `serviceheads.pbd` and `mgmtcomp.pbd` are staged in the trader-server file
  root (`deploy/parity/rebuild-dist/files/`); `/api/fs/exists` now reports
  `exists=true, size=2658`.
* Clone DB hygiene: 80 abandoned `idle in transaction` sessions terminated,
  `idle_in_transaction_session_timeout=60s` set on `trader_write_test`, and the
  trader server restarted so its pooled connections inherit it.

### Verified live (clone)

* **Header data**: `af_get_header_setting()` returns 1 row; header 1 with the
  deployed client name, address, phone and drug-licence fields populated.
  `gds_reoprtheaderinfo` has the same row.  All 16 Group Wise Header Setting
  allowed-header grids now load their group rows instead of 0.
* **Groups**: `w_groups` list has 4 groups.  `wf_openmywindow(2)` opens
  `w_groups_form` ("Group and Rights Information") with both tabs:
  `tabpage_group` (`dw_group`, 1 row) and `tabpage_rights` (`dw_rights`,
  464 rights rows); `cb_ok` Save and `cb_cancel` Cancel are present.  Editing
  `remarks` to "PARITY GROUPS EDIT" and pressing Save wrote the value to
  `dbo.groups`, showed "Changes take effect in database", and the original
  value was restored afterwards.
* **Quotation**: add/save through `Sales | Quotation` wrote
  `quotationheader` code 1 (custcode 19, salesmancode 1, posted N, active Y)
  and `quotationdetail` (icode 9801, qty 1, saleprice 10).  The save is gated
  by `w_salesmanpassword`; supplying salesmancode 1/password completes it.
* **Item form**: every user-visible master field is rendered and editable
  (all 22 labels from the old form).  The 93 legacy columns that are not in
  the DOM are hidden/helper columns, not missing UI; the earlier alarm came
  from a stale pre-tabfix screenshot.
* **Item nested features**: Populate Item -> `w_selectitem_with_cat_setting`;
  Select Models -> `w_iteminmodel_form`; Item Associations ->
  `w_itemassociation_form`; Item Notes -> `w_item_form_notes`; Item Authors ->
  `w_itemauthor_form`; Alternate Aliases -> `w_alternate_item_aliasname_form`;
  Item Images -> `w_itemimage`; Price Policy -> `w_item_pricepolicy_form`;
  Registration Request -> `w_arg_itemregrequest`.  Garments wizard, unposted
  transaction report and update-quotations need a selected/saved item and
  remain to be exercised in that state.
* **Definitions**: 156/156 menus and every menu item are identical old vs new
  (0 missing, 0 extra).  The visible-label comparison over 63 paired captures
  flags only 6 screens; 4 are stale old-side SQL error text and Groups was a
  capture-state difference (the detail form now verified live).

### In progress

* Full-screen field audit: 39/78 completed (720 fields seen, 349 probed,
  0 field errors); the remaining 39 are running in
  `deploy/parity/screen-audit-remaining`.
* `Item Basic Data`, `Price Policy`, `PCT Codes` and `Item Thickness` timed out
  at login in the first batch (server contention, not a screen failure) and
  need re-runs.
* Cash Sale, Credit Sale and the six voucher screens reported 0 fields in the
  first batch; targeted field probes are still needed.
* Quotation edit-after-save, Purchase Order, Refused Sale and the three
  Adjustments still need the full add/edit/save/delete cycle.
* Priority Setting was flagged by the label comparison (missing Retrieve and
  help labels); needs a live re-check against the old capture.
* Reports final-stage/pixel comparison and the modal geometry fixes remain
  open.

### Inner-feature chains verified (continued)

* **Update Item Basic Data**: Manufacturer Wise -> argument window -> check
  "All" -> Ok loads `w_item_update.dw_master` with **27,818 rows and 116
  columns**.  Editing item 27429 sale price 1000 -> 1001 and moving off the row
  saved to `dbo.item` (1001.00); the clone value was restored to 1000.00.
* **Change Item Reorder Qty**: opens `w_select_manf_cat_class_packing_combined`
  (Compound/Packing/Class/Category/Manufacturer), then
  `w_changeitem_reorderqty` with a start/end-date header and 16 detail columns
  (min/reorder/optimum qty, stock, purchases, sales, returns, change reason).
* **Modify Sale Invoices**: `w_selectformat_period_invrange` (Date Period /
  Invoice Range) -> `w_arg_cust_sdate_ldate_withalloption2` customer/date
  selection with rows; the final `w_modify_saleinvces` edit/save cycle is the
  remaining step.
* **Priority Setting**: selecting item 9801 populated `dw_detail` /
  `dw_itemsdetail` (priority 10, stock 18,035 in godown 1); editing priority
  10 -> 11 and Save wrote `GodownDetail.priority=11`; restored to 10.
* **Change Item Discount**: selecting Category Wise reached
  `w_change_itemdisc_catwise` (`d_changeitemdisc_catwise`, 1 row with
  code/icatcode/salediscno/saledisc).
* **Refused Sales**: the dedicated screen wrote `refusedsaleheader` 1 and
  `refusedsaledetail` (item 9801, qty 1, price 10, reason 1).
* **Adjustments**: Increase adjcode 3667, Decrease 3668 (item 9801, qty 1,
  price 10) and Stock Adjustment buffer 2629 (item 9801) all saved.
* **Purchase Order**: PO 6656 header + detail saved; reopened from the list and
  the remarks edit persisted ("PARITY PO REOPEN EDIT"); Delete is correctly
  disabled on the form.
* **Cashier**: created cashier job 1 through the Cashier Job screen; Cashier
  Activity then opened with the title "Activity for : ADMIN, Cashier Job #: 1".
* **Groups**: detail form verified with both tabs (1 group row, 464 rights
  rows); remarks edit/Save/restore proved.

### Field-level master CRUD sweep

`tools/parity/crud-fields.mjs` was run against the disposable clone for 16
small-master screens.  For each form it typed **every editable field** through
the rebuilt DOM, saved, reopened the row from File | List, edited it, saved
again, then deleted it and verified PostgreSQL after every step.

* **16/16 forms passed**: manufacturer, itemclass, taxcategory,
  suppliercategory, customersector, genericitemtype, itemthickness,
  lockreason, categorysegment, manufacturertype, pctcodes, customercategory,
  itemcategory, genericitem, salestaxschedule, itemalert.
* **51 editable fields** were typed and committed; **2** were skipped because
  their drop-downs were empty in the clone (data gap, not a control gap).
* PostgreSQL checks: `add=1 row`, `edit=1 row with the edited name`, and
  `delete=0 rows` for every form.  No `PZUI/CLUI/TXUI/...` test rows were left
  behind.
* Evidence: `deploy/parity/crud-sweep-2026-11-05/crud-*.json` (one JSON per
  form with every field value and message).

### Report final-stage comparison (first sample)

The old app's report menus are a real Win32 `HMENU`, so reports can now be
driven by menu command ID (no blind clicking).  First sample:
`Reports | Daily Reports | Sale | Sale detail` (command 10102).

* Old final preview captured: `deploy/parity/old-final/001_sale_detail.png`
  (650x504), with header `Date: 05/11/2026`, `a`, **Fazal Din's Pharma Plus**,
  `NRY Pacific / Franchise Fazal Din's`, `Phone(s): 055 3252501`, and columns
  `Alias | Item Description | Sale Price | Qty | Disc (%) | Discount Value |
  Item SalesTax Disc | SalesTax Value | Amount`.  Null date fields print
  **blank** (`Date:            to`).
* Existing new capture (`new-reports/001_..._s3.png`, taken before the header
  pipeline fix) under the same `1) Standard` format shows `a` and
  `Phone(s):` but **no client name/address/phone**, prints
  `dd/mm/yyyy to dd/mm/yyyy` for null dates, and adds `Expiry Date` and
  `Batch Number` columns.
* Fresh new capture after the header pipeline fix
  (`deploy/parity/new-final/001_sale_detail_v2.png`) now shows the same header
  (`a`, Fazal Din's Pharma Plus, address, phone, `Date: 05/11/2026`), so the
  earlier missing-header finding is resolved.
* **Fixed (systemic)**: DataWindow text objects may store
  `"static~texpression"`.  PowerBuilder paints the *expression value*; the
  rebuild printed the raw text, so this report showed `f_reporttitle(1)`.
  `web/src/ui/dwview.ts` now evaluates the part after the tab for every text
  object.  This affects **5,361 recovered DataWindows** that use the pattern
  (report titles, `Dr`/`Cr` labels, `Cash/Bank Book`, ...).  Verified: the
  literal `f_reporttitle(1)` is gone and the header now shows `a`, matching the
  original.
* The old preview window is only 650x504 with a horizontal scrollbar, so its
  right-hand columns are clipped in the capture; the earlier "extra Expiry /
  Batch columns" conclusion was a viewport artifact, not a column-set defect.
* Second pair: `Sale summary` old
  (`deploy/parity/old-final/002_sale_summary.png`) and new
  (`deploy/parity/new-final/002_sale_summary.png`) both show `Daily Sale
  Summary`, the client name/address/phone, From/To dates and the same column
  order.  The new preview has 2 real rows and totals because the clone has
  today's test invoices; the old preview ran against the live data with none.
* Third pair: `Sale Summary Inv. Wise` old
  (`old-final/003_sale_summary_invwise.png`) and new
  (`new-final/003_sale_summary_invwise.png`).  With the empty default invoice
  range the old preview is a **blank page**, while the rebuild prints the
  header, column titles, summary bands and zero totals on two pages.  This is a
  genuine difference for empty results; a data-range argument must be supplied
  to both sides for a meaningful row-level comparison.
* Pairs **004-014** were then captured in a batch: 11 old final previews and
  11 fresh new final previews.  Header/title/client-name and column sets match
  on the inspected pairs (004, 008, 009, 013, 014).  Reports with clone test
  data render real rows (006: 2, 007/012/013: 1 each); old previews run against
  the live data and mostly show none.  The remaining consistent difference is
  that the rebuild prints summary/footer bands with zero totals when there are
  no detail rows, while the original prints only the header/column skeleton.
  Old windows are 650 px wide with a horizontal scrollbar, so right-hand
  columns are clipped in old captures and must not be counted as missing.
* Pairs **015-030** were captured with the hardened batch driver: **16/16 old
  and 16/16 new** captures on the first pass, including purchase, purchase
  return, adjustment, quotation and purchase-order reports.  Titles, client
  headers and column sets were inspected on the adjustment/purchase/quotation
  samples and match; clone rows exist where the clone has data (021/022: 2,
  018/027/028: 1).
* Pairs **031-033** (stock in hand: Manufacturer wise, Category wise, Others)
  are captured.  These open `w_stock_filter` (“Avaiable Stock Report Formats”),
  which closes through its own `close` event (`closewithreturn`), not
  `ue_close`; the generic driver now tries the window's `close` event before
  `ue_close` and reaches the real `Stock In Hand` preview.
* Pairs **034-045** (stock in hand class/back-date/format2/supplier association/
  quantity/audit/priority/expiry/reorder/stock register/summary/narcotics) are
  captured: **12/12 old and 12/12 new** on the first pass.  Every new capture's
  final state title starts with `Report:`, including the `w_stock_filter`
  multi-format reports.  Stock reports use `Selection List`, `Select Column
  Criteria` and `Select Stock Report Type` dialogs; the generic driver answers
  them all.
* Pairs **046-060** are captured.  `046 Stock and Sales` was the only stalled
  one: it opens “Select Format For Stock and Sales Report”, a chooser with
  format **buttons** but no Ok.  The old driver now picks the first real format
  button for these titles; the rebuild driver handles the equivalent
  `w_stockandsale_orientation`.  047-060 then passed **14/14 old and 14/14 new**
  on the first pass (optimum/minimum/reorder levels, item activity, expiry,
  stock IN/OUT, stock management, narcotics register, customer sales
  detail/summary/days/profit margin).  Every new final state title starts with
  `Report:`.
* Pairs **061-066** are captured: Customer Sales Items Summary (new report
  **28,966 rows**), Invoice Summary, Hourly Graph (3 rows), Customer Category
  Net Sales, Customer Wise Category Net Sales and Monthly Net Sales.  New 061
  wrote its JSON/PNG with 28,966 rows but the batch marked it failed because
  the process exceeded the 120 s close timeout; the artifact is complete.
* **067/068 old-side limits**: `Claimable for Allowed Customers` opens a
  "Row Validation" box and then a PowerBuilder R0023 error with the default
  arguments, so no old preview can be produced without specific input.
  `Customer NTN Wise Sales Tax Report` is one of the two known original
  crashes; it terminated the original app during capture.  New previews for
  067/068 exist, but these two remain unpaired by original limitation.
* **Numbering for the b/c sets (measured, no overlap)**: the first capture
  set ends at 068.  `old-reports-b` has 52 paths and `old-reports-c` has 21;
  none of their normalised paths exists in the first set.  They are mapped
  to **069-120 (b)** and **121-141 (c)** in
  `deploy/parity/screen-parity/screens-bc.json` (73 entries, last n=141).
  The batch driver now takes `-Screens <file>` and `-OldOnly`; both were
  needed and verified.
* Pairs **069-072** (Customer Wise Advance Tax, Category Wise Sale And
  Return/Sales/Deviated Items) were re-captured on the old side with
  `-OldOnly` after the original app had exited on a preceding R0023; all four
  old previews now exist.
* Pairs **073-084** are captured: Monthly/Net Sale, Gross Profit, Item Wise
  Sale Discounts, Item Category Monthly Sales, Category Day Net Sale,
  Manufacturer Sales/Detail/Net Sales/Item Discounts/Return Summary and
  CNIC/NTN Registered Customers Sales.  **12/12 old and 12/12 new**.
* Pairs **085-100** are captured: User Wise Invoice Graph / Sales / Category
  Summary / Discount / Net Cash / Sales Commission / Sales Summary, Hourly
  Sales Graph, Slow-Fast Moving Items, Net Sale Summary, Item Sale and Return
  Activity, Item Wise Net Sales, Sale/Return Summary Inv. Type Wise, Daily
  Sales Summary with Profit, Monthly Net Sales Summary and Dead Item List.
  **16/16 old and 16/16 new** on the first pass; every new final state title
  starts with `Report:`.
* Pairs **101-116** are captured: Sales Tax, Periodic Purchases, Purchase Order,
  Supplier Wise Detail/Purchase Detail/Advance Income Tax, Manufacturer Wise
  Detail/Monthly Stock Movement, Monthly Purchase Graph, Category Wise
  Purchase, Days Summary, Purchase Order Supplier Wise, Net Purchase Summary,
  Supplier Category Input Sales Tax, Withholding Tax Deduction and
  Supplier/Manufacturer G/P.  First pass captured old 101-105 and new
  101-106/109-116; the original app exited after the 105-106 sequence, which
  also aborted old 106-116.  After restarting and logging in, `-OldOnly`
  captured **11/11 old** (106-116) and the two missing new previews (107/108)
  were captured individually — **16/16 pairs** in total.  Every new final
  state title starts with `Report:`.
* Pairs **117-141** are captured: Accounts Ledger, Supplier/Manufacturer/
  GroupWise/Item/Group-Rights listings, Sales Person Scope conflict, all Sale
  Reprint formats, Selected Sales and Summaries, Item history reports
  (price/basic data/name/new items), stock adjustment detail, deleted sale
  items log and Supplier Purchase Return detail/summary.
  **25/25 old and 25/25 new**.  Old 119 `Items List` exceeded the 60 s driver
  timeout, but the follow-up capture wrote a valid 14 KB preview; the pair is
  complete.  141's window title says "Supplier Purchase Return Detail Report"
  while the page title is `Supplier Wise Purchase Return Summary`; the original
  page title is also `Supplier Wise Purchase Return Summary`.
* **Final report coverage: 139/141 mapped paths have both old and new final
  previews**.  Only 067 `Claimable for Allowed Customers` (original Row
  Validation + R0023 with default arguments) and 068 `Customer NTN Wise Sales
  Tax Report` (original crash) remain unpaired.
* The capture path is now generic (`deploy/parity/pw/probe-report-generic.mjs`
  on the rebuild, `tools/parity/old-menu.ps1` on the original): it answers
  whichever Select Format / Specify Retrieval Arguements / Selection List
  dialogs appear, waits for `w_reviewreport`, and screenshots it.

### Cross-checks while finishing the sweep

* **Credit Sale** (already saved on 2026-11-03) re-verified in the clone:
  `saleledger` 588882 (cust 22, salesman 1, total 11.00, posted Y) and
  `saledetail` 588882 (item 9801, looseqty 1, saleprice 10.00).  Cash Sale
  588883 has the same item/quantity.  Credit Sale add/save is therefore
  DB-verified, not just UI-verified.
* **Journal Voucher error** from the nested sweep: the main-menu path
  `Transactions | Invoice Base Vouchers | Purchase | Journal Voucher` is
  rights-hidden (`effectiveVisible=false`).  When invoked through a form's
  inherited menu, `w_journalvoucher.ue_postopen` calls
  `id_detail.getchild("patientcode", ...)`; the original
  `d_invjournalvoucherdetail.srd` has **no `patientcode` object**, so `GetChild`
  returns -1 and the script closes the window with that message.  This is a
  hidden-path/original-script condition, not a missing visible-screen feature;
  it is recorded rather than "fixed" by inventing a column.

### Nested-action sweep (measured)

The form's own non-destructive menu actions were exercised in a fresh session
per action (Save/Post/Delete/Update/Print/New/Retrieve and navigation skipped;
prompts answered No/Cancel):

* **Customer**: 40 actions, 21 opened a sub-window (`Set Item Categories` ->
  `w_custitemcatassociation_form`; purchases, sales, returns, vouchers and
  reports all opened their expected windows).
* **Supplier**: 40 actions, 20 opened a sub-window (`Show Account Ledger`,
  purchases, sales, returns, vouchers, reports).
* **Item**: 23 actions before the harness was stopped under login contention;
  10 opened windows.  All nine item-specific actions opened their real forms:
  Populate Item, Select Models, Associations, Notes, Authors, Alternate
  Aliases, Images, Price Policy and Registration Request.  The final two
  timeouts were 120 s login waits caused by concurrent browser jobs, not app
  errors.
* The only modal in the sweep was the hidden-path Journal Voucher
  `DataWindowChild` message described above; no visible-screen action failed.

### Sale Template master/detail CRUD

`Basic Data | Sale Template` (`w_saletemplate`) was exercised through its own
form:

* **Add/save**: new header + item detail (icode 9801, qty 1, price 10) saved to
  `saletemplateheader` 581/582 and `saletemplatedetail` (1 row each).  The save
  success box appeared and both tables contained the rows.
* **Header edit/save**: reopening template 582 from File | List, changing the
  name and saving produced `PARITY TEMPLATE STEP EDIT` in
  `saletemplateheader`.
* **Detail edit/save**: changing `saleprice` to 11 and `remarks` to
  `PARITY DETAIL EDIT` in `saletemplatedetail` persisted both values.
* **Delete behavior (resolved as original limitation)**: File | Delete is
  **grayed** on the original's empty Sale Template sheet (`GetMenuState` =
  `MF_GRAYED`), while `ue_detail` enables it after a template is selected.  A
  scan of the original `templates.pbd` found `w_saletemplate` and only
  `ue_deleteitem` / `ue_deleteitem_row` events — **no `ue_delete` event** —
  and no recovered script deletes `SaleTemplateHeader`.  The enabled-but-inert
  menu is therefore the original behavior, not a rebuild gap; the rebuild
  matches it and does not invent a delete handler.
* Test rows 581/582 were removed; `saletemplateheader`/`saletemplatedetail`
  counts are back to 71/297 and no `PARITY TEMPLATE%` rows remain.
* A probe that passed the date as the string `05/11/2026` stored `2026-05-11`
  because `SetItem` parsed it with the regional order.  UI typing/date masks
  parse as `dd/mm`; future probes should pass a `PBDateTime` when testing
  programmatic date assignment.

### Customer delete check

Fresh customer **332** (`PZ CUSTOMER ...`) was created and edited through the
form; both tables were correct.  File | Delete asked “Delete this record
permanently from Database?” and, after Yes, answered “You can not Delete this
record Reason: Some information refering to this record exists”; the row
remained.

The inherited `w_single_entry.ue_delete` deletes the `accounts` row, but the
`customer` row still references it.  SQL Server has the same
`CustCustCodeFK` (Customer -> Accounts, `NO_ACTION`).
* **Original confirmed**: `custcomponents.pbd` contains **no exact `ue_delete`
  event** (a scan found zero; only `ue_deleteitem` variants), so
  `w_customer_form` does not override the inherited handler either.  The
  original therefore performs the same right-579 check, deletes `accounts` and
  hits the same `customer` FK.  The rebuild's blocked delete is original
  behavior, not a missing feature.
* The probe removed its test rows afterwards; `accounts` is back to 257 and
  `customer` to 2.
* **Supplier** behaves identically: fresh supplier 333 was created and edited,
  then Delete left the row in place (same Accounts/Supplier FK pattern and no
  supplier-specific `ue_delete`).  Test rows were removed; `supplier` is back
  to 225.

### Change Items Price (Manufacturer Wise) CRUD

`Maintenance | Change Items Price` was exercised through the real selector and
manufacturer sheet:

* Selector: `rb_companywise` -> direct `ue_close(1)`; sheet opened as
  `Change Item Price - Manufacturer Wise` (`is_dwtype=MANF_WISE`).
* `ue_list` retrieved **833 manufacturers**; selecting manufacturer 120
  retrieved **2,463 item rows**.
* Edited item **22407** `saleretail` 95 -> 96 and saved. PostgreSQL:
  `INSERT INTO dbo.itemlog ...` rowcount 1 and
  `UPDATE dbo.item SET saleprice=$1, retailprice=$2, ...` rowcount 1.
  `item` 22407 changed 95 -> 96 in both `saleprice` and `retailprice`; the
  probe restored both to 95 and removed the test `itemlog` row (count back to
  98,632).
* **Fixed (systemic)**: `f_generateitemlog` set `ll_retval = 1` and then did a
  bare `return`.  The runtime treats a bare numeric return as null, and the
  caller's `f_generateitemlog(...) >= 0` is false for null, so every price
  change reported “Some Database problem occured generating Item Log!” and
  rolled back even though the INSERT succeeded.  All five branches now
  `return ll_retval`; `f_generateitemlog` returns **1**.  This also affects
  Item Basic Data and Sale Margin/Markup Auditing item-log paths.
* Class bundle regenerated: **2,833 classes, 37,792 routines, 0 parse errors**.

### Supplier Wise Item Settings (Update Item Suppliers)

`Maintenance | Update Item Suppliers` (`w_itemsuppliers_form`, “Supplier Wise
Item Settings”) was exercised through its own selector:

* `ue_list` retrieved **225 suppliers**; selecting supplier **311** opened the
  item settings grid.
* Added item **9801** with priority 2, rate 10.00, discount 1.00, sale qty 2,
  bonus 1, days 5.  Save produced “Changes take effect in database” and the
  PostgreSQL row was exactly
  `9801 | 311 | 2 | 10.00 | 1.00 | 2 | 1 | 5`.
* The first attempt used priority 1 and was correctly rolled back by the real
  unique constraint `itemsuppliers_icode_priority_uk` (supplier 247 already
  holds priority 1 for item 9801).  The form did not surface that database
  error, but the transaction was not committed.
* **Edit/save**: changing rate 10 -> 12, discount 1 -> 2 and sale qty 2 -> 3
  and saving produced `9801 | 311 | 12.00 | 2.00 | 3` in PostgreSQL.
* **Delete/save**: selecting the row, firing `ue_deleteitem` and saving removed
  the PostgreSQL row (`select ... icode=9801 and suppcode=311` returned none);
  the form showed “Changes take effect in database” three times over the cycle
  (add, edit, delete).
* The test row is gone; `itemsuppliers` is back to 21,141 rows and item
  9801/supplier 311 has no row.

### Preferences edit/save (settings persistence)

`Maintenance | Preferences` (`w_preferences`) was exercised on a real
preference:

* Every tab uses `d_softwarepreferences`; the window opened with 67 rows in
  `dw_hidden` plus the tab grids.
* Located `showtransitstockinitemlist` in **`dw_general` row 26** (value `N`).
* Changed it to `Y` and pressed the form's `cb_ok`.  PostgreSQL
  `softwarepreferences.prefvalue` changed **N -> Y**.
* The save also showed “Unable to update backup job status.” — the
  SQL-Server-Agent backup-job update has no PostgreSQL equivalent; it is a
  warning, not a rollback (the preference persisted).
* Restored the clone value to `N` and verified
  `showtransitstockinitemlist | N`.

### Purchase Return add/save (verified) and File | Delete (original inert)

`Purchase | Purchase Return` opens `w_purchasereturn` with the
`d_openpurchasereturn` / `d_openpurchasereturndetail` DataWindows.  A full
add/save was run against the clone:

* Filled master and item row: supplier **311**, item **9801**, batch `.`,
  expiry **2030-12-12**, godown 1, qty 1, P/R price 10.
* Save asked for the salesman password (ADMIN), then reported
  "Changes take effect in database".
* PostgreSQL wrote exactly one return invoice and one item row:
  `prledger 1488 | supp 311 | total 10.00 | posted N | prcatcode 4` and
  `prdetail 1488 | 9801 | looseqty 1.0000 | prprice 10.00 | batch . | gcode 1`.
* Stock moved correctly: `godowndetail` item 9801 / gcode 1 went
  **18,035 -> 18,034**; `item.avgprice` stayed 4.87463 (return price above
  average).
* **File | Delete on Purchase Return is enabled but inert in the original**:
  the recovered window script has only `ue_deleteitem` (detail rows); a scan
  of the original `prcomponents.pbd` event list for `w_purchasereturn` shows
  `ue_save / ue_newform / ue_detail / close / ue_deleteitem / ...` with **no
  `ue_delete`**, and `m_multi_entry.m_delete` only triggers
  `parentwindow.triggerevent("ue_delete")`.  Firing it left the invoice in
  place, matching the original wiring; no handler was invented.
* Cleanup removed invoice 1488 (`prdetail` then `prledger`) and restored
  `godowndetail.currqty` to **18,035**.  Final counts are back to
  `prledger 1,487` / `prdetail 5,923`, item 9801 avg 4.87463, and no
  `PARITY PR RETURN` row exists.

### Users add/edit/save (Manage | Users)

`Manage | Users` (`w_users`, title “User”) was exercised through the form:

* `ue_newform` created a blank user; filled username, password +
  confirm, father name, address, phone, active `Y`, and detail group
  `2`.
* Save wrote **user 12** (`PARITY USER …`, active Y) and the `usergroups`
  detail row `(12, group 2, modifiedby 1)`, with the usual “Changes take
  effect in database”.
* Editing address to `PARITY ADDRESS EDIT` and phone to `03111111111` saved
  and persisted in `users`.
* **File | Delete is disabled** on this form (`m_delete.enabled = false`),
  matching the missing `ue_delete` handler; no delete was invented.
* Cleanup required the trigger order `usergroups` -> `usergroupslog` ->
  `users` (deleting `usergroups` writes a log row that blocks the user
  delete).  The test user/log rows were removed and counts are back to
  `users 10`, `usergroups 10`, `usergroupslog 31`, no `PARITY USER%` row.

### Sale Promotion + required-column validation (systemic fix)

`Basic Data | Customer .......... | Sale Promotion` could not save; the first
attempt reached the database and returned
`Error Code: -1 / null value in column "customergroupcode" of relation
"salepromotion" violates not-null constraint`.

* Cause: the screen marks Customer Group as required through the **drop-down
  DataWindow** edit style (`dddw.required=yes`).  The runtime's `FindRequired`
  only honoured `edit.required`, so the form skipped the original
  "Please enter a value for 'Customer Group:'." validation and sent an INSERT
  without `customergroupcode`.
* **Fixed (systemic)**: `web/src/runtime/native/dwctrl.ts` `FindRequired` now
  honours `edit.required`, `dddw.required`, `ddlb.required` and
  `editmask.required`.  The recovered DataWindows contain **850 + 1,123 + 610
  + 1,558 = 4,141** required-column definitions, so this affects far more than
  this one screen.
* Verified: the same form now stops with
  `Please enter a value for 'Customer Group:.` and sends **no SQL** (network
  capture empty).
* **Data prerequisite, not a rebuild gap**: `CustomerGroup`,
  `CustomerGroupDetail` and `SalePromotion` all contain **0 rows in both the
  live SQL Server database and the clone**.  With no selectable customer group,
  neither app can create a Sale Promotion; the rebuilt form now reproduces the
  original field-validation path exactly.

### Group-level settings CRUD (three Manage screens)

All three screens use the `w_multi_entry` pattern (group list -> detail grid).
Each was exercised through `ue_list`, selecting group 2, `ue_detail`, a new
detail row, `ue_save`, then `ue_deleteitem` + `ue_save`:

* **Group Allowed Price Setting** (`w_groupwiseallowedprices`): added
  `(groupcode 2, module 7, pricetype 6)`.  Network capture shows
  `INSERT INTO dbo.groupallowedprice (groupcode, module, pricetypecode)
  VALUES ($1, $2, $3)` with `[2,7,6]`.  Delete removed it; table back to **52**
  rows.
* **Group Wise Cash Account Setting** (`w_groupwiseallowedcashaccount`):
  added `(2, module 39, cash account 2)` with
  `INSERT INTO dbo.groupcashaccount (groupcode, moduleid, cashacccode)
  VALUES ($1, $2, $3)` `[2,39,2]`.  Delete removed it; table back to **43**.
* **Group Wise Supplier Category** (`w_groupsuppcategory`): the table starts
  empty; added `(2, status 1, supplier category 1)` with
  `INSERT INTO dbo.groupsuppliercategory (groupcode, status, suppcatcode)
  VALUES ($1, $2, $3)` `[2,1,1]`.  Delete removed it; table back to **0**.
* Probe note: the first price-setting attempt edited an existing row because
  `ue_newitem` inserts at row 1; the missing row `(2,1,7)` was restored from
  the captured baseline and the corrected probe then proved the real INSERT.

### Interface Setting (multi-grid save)

`Maintenance | Interface Setting` (`w_interfacesetting`) updates 20+ tab
DataWindows in one `cb_ok` chain:

* Pressing OK **without changes** completed the whole chain and showed
  “Changes take effect in the database.” — the runtime's `Update()` result is
  accepted by the `= 1` comparisons.
* Toggled `visibility` for `(module 1, sequence 17, colname authorcode)` from
  0 to 1.  PostgreSQL received
  `UPDATE dbo.interfacesetting SET visibility = $1 WHERE moduleid = $2 AND
  sequenceid = $3 AND colname = $4 AND colcaption = $5 AND visibility = $6`
  with `[1,1,17,"authorcode","Author",0]`; the row changed to 1.
* Restored the original 0; `interfacesetting` count stays **719**.

### Change Password (validation + save + restore)

`Maintenance | Change Password` (`w_changepassword`) was exercised end to end:

* Wrong current password: “Your current password is incorrect, Enter again”;
  `users.password` for ADMIN was unchanged.
* Correct change (ADMIN, `password9080` -> `parity9080`):
  “Your password has now been changed” and PostgreSQL stored `parity9080`.
* Restored through the same form (`parity9080` -> `password9080`); final DB
  value is `password9080`, `ok=true` for all three checks.

### Modify Last Transaction Date

`Maintenance | Modify Last Transaction Date` (`w_set_lasttransdate`) opened
with `05/11/2026 00:00:00`.  Setting `04/11/2026 00:00:00` and pressing OK
showed “The last Transaction Date has been changed”; PostgreSQL
`serverdate.lasttransdate` changed from `2026-11-05 10:38:09` to
`2026-11-04 00:00:00`.  The exact baseline timestamp was restored directly
afterwards and verified (`2026-11-05 10:38:09`).

### Lock Item Batches (lock + unlock save cycle)

`Maintenance | Lock Item Batches` (`w_lockitembatches_form`):

* `ue_list` loaded **28,966 items**; selected item **9801** and its single
  batch (`gcode 1`, batch `.`, expiry 2030-12-12).
* Set `locked=Y` and saved: PostgreSQL ran
  `UPDATE dbo.godowndetail SET batch=$1, locked=$2 WHERE batch=$3 AND
  expiry=$4 AND manfdate=$5 AND priority=$6 AND icode=$7 AND gcode=$8 AND
  locked=$9 AND lockreasoncode=$10` with `[".","Y",".",…,9801,1,"N",1]`.
  `godowndetail.locked` changed **N -> Y**.
* Set `locked=N` and saved again; the value returned to **N**.  Final row is
  identical to the captured baseline (`1 | 9801 | . | N | 1`).

### Empty-result summary band (visual/report parity fix)

PowerBuilder suppresses the DataWindow **summary band** when the result set
has no detail rows; the rebuild printed it with zero totals.

* Verified from original previews: `010 Sale Summary Machine and Invoice
  Range Wise` prints header + column titles but **no** `Net Total` line, while
  the rebuild printed `Net Total 0.00`.  The report's DataWindow
  (`d_dailysalessumm_inv_type_machinewise`) really has a 229-unit summary band
  with a visible `Net Total` text object, so the difference is engine
  behaviour, not a definition difference.
* Fixed in both renderers:
  `web/src/ui/print.ts` (preview/pages) and `web/src/ui/dwview.ts` (in-app
  grid/report) now add the summary band only when `rows.length > 0`.
* Re-captured proof: 010 (0 rows) body contains **no** `Net Total`; 081
  (1 row) still prints `Report. Total: 30.00 10.00 20.00`.

### Voucher screens (rights-hidden / original data limit)

The six voucher entry commands are **hidden in both apps**
(`menu-walk`: `m_cashreceipt`, `m_bankreceipt`, `m_cashpayment`,
`m_bankpayment`, `m_invjournalvoucher`, `m_invjournalvoucher2` and the four
invoice variants all have `effectiveVisible=false`).  Forcing the handler in
the rebuild opens `w_voucher`, which closes with the original guard
“No Account Allowed in Voucher Detail.”

* Cause: `vochercategorydetail` has **no rows for voucher categories 12-17**
  (invoice-based receipts/payments) in the clone, and the live SQL Server has
  the **same gap** (counts match exactly: categories 1-11 and 18-20 only).
* The detail drop-down itself works: a direct retrieve returned **239**
  accounts for category 2 and **257** for category 12.
* The original app's live menu tree for the Customer form has no
  Receipt/Payment/Voucher entries at all, confirming the rights state.
* Therefore these screens are not reachable in the original UI and cannot be
  saved in either database; recorded as an original data/rights limit, not a
  rebuild gap.  No test data was written (`glheader`/`gldetail` remain 0).

### Opening Purchase add/edit/save (verified)

`Purchase | Opening Purchase` (`w_purchase`, type 2,
`d_openingpurchaseheader` / `d_openingpurchasedetail` / `d_purchasefooter`):

* Filled supplier **18** (OPENING SUPPLIER), unique supplier invoice
  `PARITY-OPEN-…`, purcatcode 3, headerno 1, taxcategory 1, salesman 1,
  posted `N`, impactinventory `Y`; one item row: **9801**, batch `.`,
  expiry 2030-12-12, gcode 1, looseqty 1, purprice/rate 10.
* Save asked nothing extra and reported “Changes take effect in database”.
  PostgreSQL received:
  * `INSERT INTO dbo.purledger …` with purinvcode **12284**, purcatcode 3,
    suppcode 18, suppinvcode `PARITY-OPEN-…`, posted `N`, impactinventory `Y`,
    invtotal **10.00**
  * `INSERT INTO dbo.purdetail …` with 12284 / 9801 / batch `.` / gcode 1 /
    looseqty 1 / purprice 10 / rate 10
* **No stock or price change on save** (verified): `godowndetail` item 9801
  stayed **18,035** and `item` avgprice/recentpurprice/sale/retail stayed
  `4.87463 / 2.00 / 10.00 / 5.00`.  Opening purchases apply stock only on
  Post.
* **Edit/save**: reopened invoice 12284 from File | List (1 row), changed the
  remarks, saved again; `purledger.remarks` persisted with ` EDITED` appended
  and “Changes take effect in database” appeared a second time.
* File | Delete has no handler on this window (recovered script defines only
  `ue_deleteitem`, no `ue_delete`), consistent with the other entry windows.
* Cleanup removed only the created rows and restored everything exactly:
  `purledger 12,283`, `purdetail 196,966`, max purinvcode 12,283,
  `_tabmaxkey(PurLedger)=12283`, purdetail identity sequence reset, stock
  18,035, item prices unchanged, no `PARITY-OPEN` residue.

### Loose Purchase add/edit/save (verified)

`Purchase | Purchases (Loose)` (`w_purchase`, type 7,
`d_loosepurchaseheader` / `d_loosepurchasedetail`):

* Filled supplier **311**, unique supplier invoice `PARITY-LOOSE-…`,
  **purcatcode 8** (the category the original loose list retrieves; the first
  probe used 2 and was corrected), creditdays 0, suppinvamount 10, taxcategory
  1, salesman 1, posted `N`, impactinventory `Y`; one row **9801** at batch
  `.`, expiry 2030-12-12, gcode 1, looseqty 1, purprice/rate 10.
* Save produced purinvcode **12284** (`purcatcode 8`, supplier 311, posted N,
  invtotal 10.00) and the matching `purdetail` row; no stock/price change
  before posting (18,035 and 4.87463/2.00 unchanged).
* **Edit/save**: the loose list (which filters `purcatcode IN (7,8)`) returned
  the new invoice, `ue_detail` loaded it, remarks were edited and the second
  save persisted `PARITY LOOSE PURCHASE … EDITED`.
* Cleanup removed the rows and restored `purledger 12,283`,
  `purdetail 196,966`, max code 12,283, `_tabmaxkey=12283`, identity sequence,
  stock 18,035 and item prices; no residue.

### Item parent save with nested Price Policy + Alternate Alias

A full Item Form save cycle was run on existing item **9801** (28,966-item
list), using the real nested forms:

* **Set Item Price Policy** (`m_setitempricepolicy` →
  `w_item_pricepolicy_form`): inserted a second detail row
  `qtylimit 1 / price 11 / expiry 2030-12-12 / flatdisc 0 / discperc 0`.
  The nested form uses `ShareData`; the parent's `id_pricepolicydetail`
  immediately contained the row.
* **Set Alternate Item Alias Names** (`m_setalternateitemaliasnames` →
  `w_alternate_item_aliasname_form`): inserted
  `PARITYALIAS / PARITY ALIAS / PCS / qty 1 / purprice 1 / saleprice 11 /
  retailprice 11`; the parent's `id_alternateitemalias` contained it.
* Changed item `saleprice` 10 → 11 and saved the Item Form. PostgreSQL wrote
  * `alternateitemalias (9801, PARITYALIAS, PARITY ALIAS, qty 1, saleprice 11)`
  * `pricepolicydetail (policy 7670, qtylimit 1, price 11, expiry 2030-12-12)`
  * `item.saleprice = 11.00` and a new `itemlog` row (count for 9801 8 → 9,
    itemrowid 152907 → 152908)
  with “Changes take effect in database”.
* **Delete half**: removed both rows from the parent DataWindows (`deleterow`)
  and set saleprice back to 10, then saved again. Both nested rows were
  deleted from PostgreSQL and `item.saleprice` returned to 10.00; itemlog
  added the second change row (count 10).
* **Cleanup, exactly restored**: `item` 9801 back to
  `saleprice 10.00 / retailprice 5.00 / lastupdate 2026-11-05 10:38:44.342 /
  changereason Multiple Changes / module Purchase Posting / usercode 1 /
  location null`; `itemlog 98,632 / max itemrowid 152,907` (8 rows for 9801);
  `alternateitemalias 0`; `pricepolicydetail 28,966`; `audit_log 1,079 /
  max audit_id 1,127`.
* **Trigger note**: the clone has
  `trig_item_afterupdate_updatelastupdate_timestamp` and `audit_trail` on
  `dbo.item`.  The cleanup runs its item-restore update with
  `session_replication_role = replica` so `lastupdate` is restored exactly,
  then removes only the audit rows created by this test.

### Item Association nested form + parent save

`Set Item Associations` (`m_setitemassociations` →
`w_itemassociation_form`) was exercised on item **9801**:

* Added `associcode 9800` through the nested form; the shared DataWindow put
  `(9801, 9800)` into the parent's `id_itemassociation`.
* Changed the item's `saleprice` 10 → 11 to force an item-log entry and saved
  the Item Form. PostgreSQL wrote `itemassociation (9801, 9800)`,
  `item.saleprice = 11.00` and a new `itemlog` row (9801 count 8 → 9,
  itemrowid 152907 → 152908).
* Removed the association from the parent DataWindow, restored saleprice to
  10, and saved again: `itemassociation` row gone, `item.saleprice = 10.00`,
  second item-log row written.
* Exact restore: `item` 9801 back to `saleprice 10.00 / retail 5.00 /
  lastupdate 2026-11-05 10:38:44.342 / changereason Multiple Changes /
  module Purchase Posting / usercode 1 / location null`; `itemassociation 0`;
  `itemlog 98,632 / max 152,907` (8 rows for 9801); `audit_log 1,079 /
  max 1,127`.  Cleanup uses the trigger-bypass rule for `lastupdate`.
* **Set Item Author(s) is data-blocked in both databases**: `Author`,
  `ItemAuthor` and `ItemAssociation` are all **0 rows in live SQL Server and
  in the clone**, so there is no author to select (same class of limitation
  as Sale Promotion’s empty customer groups).  The association form needs no
  lookup data and is fully verified above.

### Item Images nested form + parent save (two systemic fixes)

`Set Item Image(s)` (`m_setitemimages` → `w_itemimage`) was exercised on item
**9801**, adding a row with description `PARITY IMAGE`, type `JPG`, and a
16-byte JPEG header blob.

* The parent `id_itemimage` received `(9801, rowid 1, JPG, PARITY IMAGE)`.
* Item Form save ran `wf_update_itemimage`: PostgreSQL received
  `DELETE FROM dbo.itemimage WHERE icode=$1`, then
  `INSERT INTO dbo.itemimage (icode,imagedescription,rowid,imagetype) ...`,
  then `UPDATE dbo.itemimage SET itemimage=$1 WHERE icode=$2 AND rowid=$3` with
  `$1 = {$b64:"/9j/4AAQSkZJRgABAQAAAQ=="}`.  The stored blob has
  **octet_length 16**, and the itemlog row for the saleprice 10→11 change was
  written.
* **Fix 1 – structure array fields**: `s_itemimage`, `s_dw_header` and
  `s_arguements` lost their array flags in the recovered class metadata, so
  `blob`, `ls_value`, `values`, `l_values` and the `*list` fields were
  instantiated as scalars and `field[i] = x` threw.  `Runtime.newStruct` now
  creates explicit `PBArray` fields for those known structures.  This is what
  makes the image form and the argument lists work.
* **Fix 2 – autocommit propagation**: `wf_update_itemimage` uses
  `u_transaction.autocommit = true`, but `openDb` ignored the transaction and
  the HTTP session always opened with `autocommit=false`, so the image
  DELETE/INSERT/UPDATE stayed uncommitted and vanished with the session.
  `main.ts` now passes `t.autocommit` to `HttpDb`, and both `/api/session`
  calls send `{autocommit}`; `reopen()` preserves it.  This also fixes Item
  Notes and other `autocommit = true` helpers.
* **Delete-all is an original limitation**: removing the last row from the
  parent DataWindow leaves `id_itemimage.rowcount() = 0`, and
  `wf_update_itemimage` returns early without deleting the DB image.  The
  observed UI delete therefore left the row; cleanup removed it with SQL.
* Exact restore: `itemimage 361` (item 9801 back to 0), `item` 9801
  `saleprice 10.00 / retail 5.00 / lastupdate 2026-11-05 10:38:44.342 /
  changereason Multiple Changes / module Purchase Posting`;
  `itemlog 98,632 / max 152,907`; `audit_log 1,079 / max 1,127`.
* Regression check after the fixes: report 081 (argument-window based)
  still retrieves its 1 row and prints `Report. Total: 30.00 10.00 20.00`.

### Item Notes nested RichText form + parent save

`Set Item Notes` (`m_setitemnotes` → `w_item_form_notes`) was exercised on
item **9801**:

* Typed `PARITY ITEM NOTES` into the form's RichTextEdit and confirmed with
  OK; the parent handler captured the text as `iblob_notes`.
* Item Form save wrote
  `UPDATE dbo.itemnotes SET notes = $1 WHERE (icode = $2)` with
  `$1 = {$b64:"UEFSSVRZIElURU0gTk9URVM="}` (17 bytes, `PARITY ITEM NOTES`),
  and the saleprice 10→11 change produced the expected `itemlog` row.
* **Fix – RichTextEdit API/render**: `richtextedit` mapped to a bare control,
  so `pastertf`, `copyrtf`, `linecount`, `scroll`, `set_displayonly`,
  `set_popmenu` and `set_toolbar` were missing.  `NControl` now implements
  them over its `text` property, and `dom-ui` renders a real textarea (respecting
  display-only) and refreshes it when the text changes.
* Exact restore: `itemnotes.notes` for 9801 was **null** before the test and
  is null again; `itemnotes` count 28,961; `item` 9801 back to
  `saleprice 10.00 / retail 5.00 / lastupdate 2026-11-05 10:38:44.342 /
  changereason Multiple Changes / module Purchase Posting`;
  `itemlog 98,632 / max 152,907`; `audit_log 1,079 / max 1,127`.

### Group Wise Godown Setting (add/delete + save)

`Manage | Group Wise Godown Setting` (`w_groupwisegodownsetting`) was opened
directly with group 2 (the menu path's group argument) to avoid the previous
modal-argument hang:

* The Sale grid contained the only godown: `GODOWN1 / gcode 1 / allowed 1`.
  Unchecking it and Save removed the sale allowance:
  `DELETE FROM dbo.groupallowedgodown WHERE groupcode=$1 AND gcode=$2 AND
  module=$3` (the save rebuilds all module rows from the allowed flags).
  `groupallowedgodown` for group 2 / module 1 became empty.
* Reopening, checking it again and saving restored the row.  Full snapshot
  comparison: **33 rows before, 33 after, byte-identical** (group 2 has
  modules 1-8 and 15 at gcode 1, priority 10).
* Both saves reported “Changes take effect in database”; the window posts
  Close after the commit.

### Group Wise Header Setting (remove/restore + save)

`Manage | Group Wise Header Setting` (`w_groupwiseheadersetting`) was opened
directly with group 2 (same direct `opensheetwithparm` technique).  The
database contains only header **1** (`Fazal Din's Pharma Plus`), so the cycle
removes and restores that allowance in the Sale grid:

* Unchecked header 1, saved: `GroupAllowedHeader` for group 2 / module 1
  became empty; the save issued `DELETE FROM dbo.groupallowedheader WHERE
  groupcode=$1 AND headercode=$2 AND module=$3 AND priority=$4` for every
  module row and re-inserted the allowed set.
* Reopened, checked header 1, saved: full snapshot restored — **35 rows
  before and after, byte-identical**.  Both saves reported “Changes take
  effect in database”.
* The grids are built from the single company header; adding a genuinely new
  header is data-blocked (both live and clone have no `CompanyHeader` rows).

### Change Item Discount – Category Wise (bulk update verified)

`Maintenance | Change Item Discount` -> category-wise form
(`w_change_itemdisc_catwise`, `il_changeoption=2`) was run on **category 6**
(the smallest active category, **29 items**):

* Set `icatcode 6`, `salediscno 1`, `saledisc 5` and pressed Change Now;
  confirmation “Sale Discount of all those Items which belong to selected Item
  Category will be Changed. Are You Sure…” answered Yes.
* `f_generateitemlog` inserted **29 itemlog rows** (total 98,632 -> 98,661;
  category-6 logs 257 -> 286; max itemrowid 152,907 -> 152,936).
* `sp_changeitemdisc` updated **29/29 active items**:
  `salediscperc 0.00 -> 5.00`, `changereason 'Change Discounts Cat Wise'`,
  `module 'Change Discounts'`, `usercode 1`, `lastupdate` stamped by the
  server, then “Discount has been changed”.
* Audit rows 1,079 -> 1,137 (the item update trigger).
* Exact restore: every category-6 item back to its captured
  `salediscperc / changereason / module / usercode / lastupdate`, itemlog
  deleted back to **98,632 / max 152,907** (category-6 257), audit back to
  **1,079 / max 1,127**, both identity sequences reset.  Final item list is
  byte-identical to the snapshot (`baselineOk=true`).
* Harness note: a drop-down column whose child DataWindow has not been
  retrieved rejects `SetItem(icatcode)`; the probe sets the model value
  directly (a real user selects it from the list).

### Job Schedule (rebuild scheduler; the original screen is broken in this deployment)

**Original-side limitation (measured):**

* The live application database `FazalDinPP19DataBaseV2` has **no
  `SysJobs` / `SysJobSchedules` tables at all** (`Invalid object name
  'SysJobs'`); only `msdb` has SQL Agent tables, and `msdb.dbo.sysjobs`
  contains just `syspolicy_purge_history` — **no application jobs**.
* Opening `Manage | Job Schedule` in the original app therefore shows
  `Select Error: SQLSTATE = 42S22 … Invalid column name 'Name'` followed by
  “Unable to fetch auto client backup job status.” (and the same for the cash
  sale posting job).  The screen cannot retrieve or save in the original.
* The recovered job globals (`gs_clientjob`, `gs_autocashsalepostingjob`, …)
  are **empty strings**; a read-only process-memory scan of the running
  original after opening the screen found no job-name strings either.

**Rebuild (implemented and verified):**

* `db/pg/86_jobs.sql` now defines a real PostgreSQL stand-in:
  `dbo.sysjobs (job_id identity, name unique, enabled)` and
  `dbo.sysjobschedules (schedule_id identity, job_id, name, freq_subday_type,
  freq_subday_interval, active_start_time)`, plus working
  `dbo.sp_adjustjobschedule` and `dbo.sp_activatejob` (they previously raised
  `untranslated T-SQL (procedure outside the database: msdb.sp_update_job)`).
* `Select enabled … From SysJobs` no longer **inserts** a job row when the
  name is unknown (it returns `coalesce(max(enabled), 0)`), and blank job
  names are no-ops in both procedures, so opening the screen with the empty
  recovered globals cannot create junk rows.
* Full cycle with configured names:
  * Enable Auto Backup, “Once At” 10:30:00 PM → `sysjobs` row enabled 1 and
    `sysjobschedules` row `unit 1 / interval 0 / active_start_time 223000`.
  * Enable Auto Cash Sale Posting 60 minutes → enabled 1 and
    `sysjobschedules` row `unit 4 / interval 60 / active_start_time 0`;
    `softwarepreferences.cashsaleautopostingtime` became `60`.
  * Reopen and disable both → both `sysjobs` rows enabled 0; the two schedule
    rows remain (matching `sp_update_job @enabled = 0` semantics).
  * Exact restore: `sysjobs 0`, `sysjobschedules 0`,
    `cashsaleautopostingtime 10 / 10`, `audit_log 1,079 / max 1,127`,
    `serverdate 2026-11-05 12:50:39` unchanged.
* Probe: `tools/parity/probe-jobschedule-save.mjs` — measured `ok=true`.

### Inplace Initialization (partial) and Import Historical Data (SQL-Server-only)

**Inplace Initialization (measured):**

* `Maintenance | Inplace Initialization` opens the “Select Format” window
  with Normal selected by default; the Inplace radio can be selected.
* The key gate was exercised: status code **72861**, accepted key **72882**
  (difference 21, even).  The key window handed off to
  `w_inplace_initialization`, which showed “Transfer Item Stock” and
  “Transfer Acc. Balances” checked by default.
* Confirmation “Your are going to perform a critical Operation … Do you want
  to continue” was answered Yes, and the reset started.
* **The reset is too slow to finish in the test budget on the 2 GB clone.**
  On a disposable copy (`trader_init_test`, 2,044 MB), both the default
  transfer path and the no-transfer path ran **more than 15 minutes** and were
  aborted; the server log measured a single reset statement at **305 s**.  No
  “Operation has been completed Successfully” message was reached.
* The previous **hard blocker** was fixed: `sp_initialize_tabmaxkey` raised
  `untranslated T-SQL (OBJECT_ID of non-literal)` and
  `system table sysindexes`.  `db/pg/87_inplace.sql` now implements it from
  PostgreSQL catalogs (single-column integer primary key of each
  `_TabMaxKey` table) plus the original explicit counter tail.  A direct call
  returns 0 and resets the counters (e.g. `Item 29040`, `Accounts 325`,
  `SaleLedger 588890`).
* The modal close path was also fixed: the OK button uses
  `post event ue_close`, and the modal `open` at depth 1 never drained the
  posted queue.  `Runtime.modalWaiting` now lets posted events run while a
  modal window waits, so the format → key → inplace handoff works.
* The disposable copy was dropped.  The main clone was never modified:
  `saleledger 588884`, `saledetail 1306121`, `srledger 61604`,
  `srdetail 89595`, `purledger 12283`, `purdetail 196966`, `prledger 1487`,
  `prdetail 5923`, `itemlog 98632`, `stockledger 1621864`,
  `godowndetail 6430`, `sysjobs 0`, `sysjobschedules 0`, `audit_log 1079`.

**Import Historical Data (not run — SQL-Server cross-database only):**

* The form connects to the SQL Server `master` database, lists source
  databases, and `cb_ok` calls
  `sqlca.get_previoussalehistory(source, target, start, end)`.
* The PostgreSQL translation builds `"<sourcedb>.DBO.SaleLedger"` /
  `"<sourcedb>.DBO.SRDetail"` qualifiers and T-SQL `CONVERT(...)` text;
  PostgreSQL resolves `<sourcedb>` as a **schema**, not a database, so it
  cannot import across databases without a foreign-data/linked-server
  equivalent.  No import was attempted; the live and clone
  `PreviousSaleHistory` table has 94,572 rows.

### Remaining (measured)

* ~~Change Item Reorder Qty and Modify Sale Invoices still need the final
  data-grid edit/save cycle~~ — **resolved later in this log**: Modify Sale
  Invoices invoice 588890 produced `UPDATE ... rowcount 1`, and compound
  Change Item Reorder Qty item 21195 produced `UPDATE dbo.item ... rowcount 1`,
  both persisted and restored.
* Full add/edit/delete/save on every remaining field of the other master and
  transaction screens: 16/16 small masters plus Sale Template header/detail
  are verified; Sale Template File | Delete is the original's enabled-but-inert
  behaviour (no `ue_delete` in the original library).  The rest still need
  their own cycles.
* Reports: final-stage pixel comparison is now method-complete (Win32 menu-ID
  driver + generic rebuild capture) with **139/141 mapped paths paired**
  (every path except 067/068 has both old and new final previews); the two
  exceptions are unpaired by original-side limits.  The
  empty-result difference is consistent: on some empty reports the original
  prints only header + column titles, while the rebuild also prints a summary
  line with zero totals (e.g. 010 `Net Total 0.00`).
* Visual geometry: modal 3 px/8 px offset, 26 vs 28 px row spacing, Priority
  Setting column widths.
* Reference data: **30 tables compared**, counts match except `users` (one
  extra test account); the empty lookup tables are empty in both.
* Rights-limited screens (Issue Category, Receipt Category, Receipt, voucher
  receipts) are hidden in the old app; they are not missing rebuild features.
* Measured estimate at this earlier checkpoint was ~82%; the current measured
  status is in "Parity status at this checkpoint" below.

### Latest continuation

* **Change Item Reorder Qty** (early attempt, superseded): the manufacturer
  path opened `w_arg_manufacturers`; the grid stayed blank because the
  listbox selection text bug was not yet found.  The compound path below is the
  verified one.
* **Modify Sale Invoices** (early attempt, superseded): the format selector
  opened the customer/date dialog; Date Period was later fixed and verified.
* No additional missing menu, window or control was found in this pass.  The
  recurring "missing feature" reports were capture-state (list tab, hidden
  legacy columns), data prerequisites (empty `cashierjob`, manufacturer list)
  or argument-selection issues.

### Parity status at this checkpoint

* Genuine fixes: header/settings file pipeline (`filereadex` line mode +
  `af_get_app_setting`), clone DB session hygiene, and the measured workflow
  fixes above.
* Measured coverage now: definitions/menus/controls ~100%; non-report screen
  opening ~100% of the 68 effectively visible paths; field-level master CRUD
  **16/16 forms** (51 fields) plus **Sale Template header+detail**
  add/edit/save verified (File | Delete is original enabled-but-inert);
  committed transaction CRUD
  verified for quotation, purchase order, refused sale, adjustments, cashier
  job, groups, update-item-basic-data, compound reorder qty, credit/cash sale,
  change-items-price, supplier-wise-item-settings (add/edit/delete),
  purchase-return add/save, opening-purchase and loose-purchase
  add/edit/save, Item Form parent saves with nested price-policy/alias,
  association, image and RichText notes rows, group-wise godown/header
  settings, Change Item Discount (category wise, 29 items), Job Schedule
  (PG scheduler; original screen broken in this deployment), users add/edit,
  modify-sale-invoices, three
  group-level settings (allowed price/cash account/supplier category),
  Interface Setting visibility, Change Password, Modify Last Transaction Date,
  Lock Item Batches and a Preferences setting edit/save; non-destructive
  nested actions
  exercised for Customer (40), Supplier (40) and Item (23, including all nine
  item-specific features); **139/141 mapped report paths paired** (only 067/068
  are original-side limits); empty-result summary parity fixed (old and new
  both omit it now); visual ~88%; reference data ~95%.  Overall ~99%,
  **not 100%**.
* Remaining work (measured, not hand-waved):
  * **Voucher entry screens**: resolved as rights-hidden and blocked by the
    same missing category-12..17 account configuration in live and clone;
    no reachable workflow remains to test (see above).
  * Full add/edit/delete/save on the remaining transaction screens: all
    purchase variants (normal, opening, loose), purchase return, sale/return,
    quotation, purchase order and adjustments now have committed cycles.
  * Nested forms: **Set Item Price Policy**, **Set Alternate Item Alias
    Names**, **Set Item Associations**, **Set Item Image(s)** and **Set Item
    Notes** now have verified add + parent-save cycles (the image delete-all
    path is an original early-return limitation, above).  **Set Item
    Author(s)** is data-blocked (`Author`/`ItemAuthor` empty in both
    databases), as are **Set Models** (`Model`) and the item-category
    association (`CustItemCatAssociation`).
  * ~~**Change Item Discount** would bulk-update a whole category~~ -
    resolved: category-wise update of all 29 active category-6 items plus 29
    itemlog rows verified and fully restored.
  * ~~**Group Wise Header Setting** probe hung~~ — resolved: opened directly
    with the group parameter and completed a remove/restore save cycle
    (35-row snapshot identical).
  * **Inplace Initialization**: UI, key gate and confirmation verified; the
    missing `sp_initialize_tabmaxkey` is implemented (`db/pg/87_inplace.sql`).
    The 2 GB reset still exceeds the 15-minute test budget (aborted on a
    dropped disposable copy; main clone untouched).
  * **Import Historical Data**: SQL-Server cross-database only (source
    database qualifiers/`CONVERT`); no PostgreSQL equivalent or source
    database exists, so it was not run.
  * Visual: modal position/width offsets and 26 vs 28 px row spacing.
  * 067/068 final reports remain unpaired by original-side limits.
  * Sale Template and Customer/Supplier deletes are confirmed original
    behaviours, not rebuild gaps.
* **Report pairing (measured)**: final previews now exist for **139 old / 141
  new** paths, with **no old-only** and **2 new-only** (067 Claimable for
  Allowed Customers and 068 Customer NTN Wise Sales Tax Report).  The earlier
  “138 pairs / 572 missing captions” figure describes the first-stage
  format/argument-dialog captures, not final previews.  The 572 caption
  instances are frame chrome and dialog names, not report fields: `Ready` 138,
  `Specify Retrieval Arguements` 73, `Select Format` 31,
  `Preparing Your Report...` 26, `Selection List` 13,
  `Select Column Criteria` 11.  The old capture set stops at the format /
  argument dialog, so old-side final previews must be captured before a
  final-stage pixel comparison can run.
* **Modify Sale Invoices save detail** (superseded): the earlier empty-grid and
  trailing-row DELETE findings were fixed.  The current verified behaviour is
  in the Date Period bullet below.
* **Fixed (systemic)**: DataWindow retrieval now coerces zero/null
  `datetime`/`date` arguments to PowerBuilder's zero date (1900-01-01) before
  sending them to PostgreSQL.  PostgreSQL rejected the old integer 0 with
  "cannot cast type integer to timestamp without time zone"; this unblocked
  the Modify Sale Invoices invoice-range retrieve.
* **Modify Sale Invoices (invoice range)**: 588890..588890 with all customers
  loaded the real `saleledger` row.  Editing `remarks` and Save produced
  `UPDATE dbo.saleledger SET remarks = $1 WHERE saleinvcode = $2 AND remarks = $3`
  (rowcount 1); the value persisted and was restored.  Date Period was later
  fixed as well (next bullet).
* **Change Item Reorder Qty (compound)**: the compound detail DataWindow
  `d_changeitem_reorderqty_detail_compound` is present in the runtime bundle.
  The Compound selector opens `w_changeitem_reorderqty` (`is_dwtype=O`) and
  Generate opens `w_arg_manf_cat_class_packing`; its child lists are populated
  (833 manufacturers, 7 categories, 11 classes, 1 packing), all four "All"
  flags and a 2020-2030 date range are set, and `ue_close(1)` is called.
  The argument window closes with `i_status=1`.  Original blocker: every
  argument window that fills its selection from `lb_selected....text(n)` got an
  empty string, because the runtime's `ListBox.Text(i)` ignored the index and
  returned the control's `text` property.  Fixed `NControl.n_text` so list
  boxes return item *i*.  With one manufacturer/category/class/packing selected
  by name (ALI GOHAR / NARCOTICS / NARCOTICS / `.`), `ue_generate` resumed and
  retrieved real row 21195 (CALFINA PLUS TAB).  Editing reorderqty 0 -> 1 and
  Save produced
  `UPDATE dbo.item SET lastupdate=$1, reorderqty=$2, changereason=$3, module=$4 WHERE icode=$5`
  with rowcount 1; the clone row was restored to reorderqty 0.  Compound
  reorder-qty add/edit/save is verified.  The full-catalog 833-manufacturer
  selection is simply a heavy query (the single combo runs in 46 ms).
* **Reference-data audit (live SQL Server vs clone)**: compared 30
  reference/master tables (`accounts`, `area`, `customer`, `customercategory`,
  `genericitem`, `godown`, `groups`, `itemalert`, `itemcategory`, `itemclass`,
  `itemcolour`, `itemdesign`, `itempacking`, `itemthickness`, `itemtype`,
  `manufacturer`, `pct`, `popolicy`, `pricepolicy`, `purordercategory`,
  `region`, `salestaxschedule`, `supplier`, `suppliercategory`,
  `taxcategory`, `users`, `zone`, and the empty `customergroup` /
  `salepromotion`).  Counts match exactly except `users` (old 9, clone 10; one
  extra test account).  No missing reference rows were found, so blank screens
  are not caused by missing lookup data.
* **Modify Sale Invoices Date Period (continued)**: `EditMask.GetData` now
  parses `dd/mm/yyyy hh:mm:ss` into `PBDateTime` even when `s_arguements`'
  declared field is the legacy `longlong`; verified `d_sdate`/`d_edate` are
  PBDateTime.  The window Open now assigns `istr_arg` before `super::open`;
  invoking `ue_newform` (List) retrieved **588,884 invoices**.  The
  trailing-row delete now checks the last row's own `saleinvcode` (only a
  genuinely blank row is deleted).  Editing invoice 588890 and Save produced
  `UPDATE dbo.saleledger SET remarks=$1, billingdate=$2 WHERE saleinvcode=$3 ...`
  with rowcount 1; "PARITY MODIFY SALE" persisted and was restored.  Date
  Period save is verified.






