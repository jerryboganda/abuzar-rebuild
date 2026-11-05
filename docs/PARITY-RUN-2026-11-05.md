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
* **Delete gap**: File | Delete is **enabled** on the form, and firing it runs
  the inherited `m_delete.clicked` -> `ue_delete`, but no row is deleted.  The
  recovered `w_saletemplate` has no `ue_delete` event, and no recovered script
  contains `DELETE SaleTemplateHeader`; the handler was not recovered.  This is
  a real missing feature, recorded rather than guessed.
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
`CustCustCodeFK` (Customer -> Accounts, `NO_ACTION`), so this may be the
original's intended block or an unrecovered customer-specific delete handler.
It is recorded as an open behavior question, not "fixed" by inventing a
cascade.  The probe removed its test rows afterwards; `accounts` is back to
257 and `customer` to 2.
* **Supplier** behaves identically: fresh supplier 333 was created and edited,
  then Delete left the row in place (same Accounts/Supplier FK pattern).  Test
  rows were removed; `supplier` is back to 225.

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

### Remaining (measured)

* ~~Change Item Reorder Qty and Modify Sale Invoices still need the final
  data-grid edit/save cycle~~ — **resolved later in this log**: Modify Sale
  Invoices invoice 588890 produced `UPDATE ... rowcount 1`, and compound
  Change Item Reorder Qty item 21195 produced `UPDATE dbo.item ... rowcount 1`,
  both persisted and restored.
* Full add/edit/delete/save on every remaining field of the other master and
  transaction screens: 16/16 small masters plus Sale Template header/detail
  are verified; Sale Template delete is a recorded missing handler (enabled
  menu, no recovered `ue_delete`).  The rest still need their own cycles.
* Reports: final-stage pixel comparison is now method-complete (Win32 menu-ID
  driver + generic rebuild capture) with **45/138 pairs captured**
  (001-045), all old and new final previews present; 93 remain.  The
  empty-result difference is consistent: old shows header only, new also
  prints summary/footer bands with zero totals.
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
  add/edit/save verified (delete handler missing); committed transaction CRUD
  verified for quotation, purchase order, refused sale, adjustments, cashier
  job, groups, update-item-basic-data, compound reorder qty, credit/cash sale,
  change-items-price and modify-sale-invoices; non-destructive nested actions
  exercised for Customer (40), Supplier (40) and Item (23, including all nine
  item-specific features); **45/138 report final-stage pairs captured**;
  visual ~85%; reference data ~95%.  Overall ~89%, **not 100%**.
* Remaining work: full field-level add/edit/delete/save on the other master and
  transaction screens; **93 report final-stage pairs**; Sale Template
  `ue_delete` handler; Customer/Supplier delete behavior; modal geometry; a
  handful of DataWindow/visual edge cases.
* **Report pairing (measured)**: old 139 / new 141 / **138 pairs**, 1 old-only,
  3 new-only.  The 572 missing caption instances are frame chrome and dialog
  names, not report fields: `Ready` 138, `Specify Retrieval Arguements` 73,
  `Select Format` 31, `Preparing Your Report...` 26, `Selection List` 13,
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






