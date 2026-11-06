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
| Master-data forms: every editable field typed, add/edit/delete/save verified in PostgreSQL | 16 forms | 16 forms + 29 extra masters (Godown, Area, Region, Sub Area, Sales Person, Item Packing, Item Size, Unit, Item Style, Item Colour, Item Sleeve, Item Yarn, Item Fabric, Item Brand, Sale Type, Purchase Type, Issue Type, Ward, Relation, Rank, Disease, Patient Location, Diagnostic Item Type, Symptom Type, Visit Type, Department, Section, Zone, Model) | `screen-parity/crud-fields/crud-*.json`, `tools/parity/probe-godown-crud.mjs`, `tools/parity/probe-area-crud.mjs`, `tools/parity/probe-single-master.mjs`, `tools/parity/probe-zone-crud.mjs` |
| DataWindow expression parse sweep | â€” | every `expression` parses; SQL comments stripped | `tools/parity/dw-expr-audit.mjs` |

The 16 passing forms are: Customer Category, Customer Sector, Generic Item,
Generic Item Type, Item Alert, Item Category, Item Class, Item Thickness,
Lock Reason, Manufacturer, Manufacturer Type, PCT Codes, Supplier Category,
Sales Tax Schedule, Tax Category, Category Segment.  **Godown**, **Area**,
**Region**, **Sub Area**, **Sales Person**, **Item Packing**, **Item Size**,
**Unit**, **Item Style** and **Item Colour** were added as separate full
add/edit/delete cycles (their menu items are hidden by the rights state; the
probes fire the real `m_godown` / `m_area0` / `m_region0` / `m_subarea` /
`m_salesperson` / `m_itempacking0` / `m_5` / `m_unit` / `m_itemstyle` /
`m_itemcolour` / `m_itemsleeve` / `m_itemyarn` / `m_itemfabric` /
`m_itembrand` / `m_saletype` / `m_purchasetype` / `m_issuetype` /
`m_patientward` / `m_relation` / `m_rank` / `m_disease` /
`m_patientlocation` / `m_diagnosticitemtype` / `m_symptomtype` /
`m_visittype` / `m_department` / `m_section` / `m_zone0` / `m_model`
handlers).  **Section** is now verified with a temporary Department row; in
normal use it remains data-blocked because `Department` is empty in both live
and clone.  **Zone** is verified with temporary ContactGroup rows (see below);
its File | Delete becomes enabled but has no `ue_delete` handler.  **Model**
is now populated/looked-up by a verified master cycle, which removes the
`Model` data gap for the nested item-model feature.  **Item Design**
(`w_itemdesign_form`) is an orphaned window (no menu/`opensheet` reference)
and **Item Type** has no master window; the `itemtype` table is not exposed
through a form.

`Sale Promotion` was the only tested form that could not complete without
reference rows: its Customer Group drop-down is empty when `CustomerGroup` is
empty, so no valid FK value can be produced.  With a temporary CustomerGroup 1
plus one CustomerGroupDetail fixture it now passes add/edit/delete/save (below);
normal use remains data-blocked in both apps because `CustomerGroup` is empty.
This is a data gap, not a form defect.

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
8. `@@CURSOR_ROWS` was emitted as `(-1)`, so every cursor loop using the
   `SET @rows = @@CURSOR_ROWS` idiom never ran (32 call sites).  The generator
   now counts the cursor's SELECT at that point; `sp_PostPayroll` therefore
   updates `Posted/PostDate/PostedBy` instead of reporting success without
   writing anything.  Regression case added to `tools/tsql/selftest.py`.

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
* **Corrected in the visual-geometry pass (later the same day):** the modal
  frame now matches exactly.  Select Format is **353x340** (old 353x340),
  Sale Summary is **417x487** (old 417x487) and Select Column Criteria is
  **236x253** (old 236x253); client areas are 347x308 / 411x455 / 230x221.
  Row pitch re-measured on both sides: 23-24 px (detail), 20 px (summary),
  23 px (column criteria) — the earlier generic “26 vs 28” did not reproduce
  on these pairs.  `syncWindow` adds the measured 4 px width / 9 px height
  and 3 px modal frame, and centres modals on integer pixels.
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
  choose a group in either app without fixtures; it was verified with a
  temporary group 1 + group detail, below); other reference tables still need
  a live-vs-clone count audit.
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
  original field-validation path exactly.  This was later bypassed with
  temporary fixtures; see the verification below.

### Sale Promotion add/edit/delete/save (verified with temporary fixtures)

A temporary **CustomerGroup 1** (`PARITY CUST GROUP ...`) and one
`CustomerGroupDetail (1, 22, rowid 1)` were inserted; `WeekDays` already
contains codes 1-7 and the `ddd_weekdays_all` drop-down also offers 0
`<All Days>`.

* **Add:** promotion code **5**, active **Y**, group **1**, default item disc
  **5**, weekday **0**, start `2026-11-05`, end `2027-11-05`;
  “Changes take effect in database”.  The form's Customer update changed
  customer 22 `DefaultItemDiscPerc` **1 -> 5**.
* **Edit:** name/remarks changed and discount **5 -> 6**; save updated the
  promotion row and customer 22 to **6**.
* **Delete:** `File | List` -> `ue_detail` showed `m_delete` **enabled**;
  `ue_delete` asked “Delete this record permanently from Database?” and then
  showed “Record Deleted Successfully”; `salepromotion` row **0**.
  `_tabmaxkey('SalePromotion')` stayed 5 (the table id is not decremented).
* Exact restore: `salepromotion 0 / max 0`, `CustomerGroup 0`,
  `CustomerGroupDetail 0`, customer 22 `DefaultItemDiscPerc 1`,
  `_tabmaxkey('SalePromotion') 4`,
  `audit_log 1,079 / max 1,127`, residue 0.

Probe: `tools/parity/probe-salepromotion-crud.mjs` — measured `ok=true`.

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

### Standalone Item Price Policy screen (verified; slab maintenance)

`Basic Data | Item .......... | Price Policy` opens
`w_itempricepolicy_form` (`w_multi_entry`).  Master `d_pricepolicyheader`
updates `PricePolicy` (one row per item, `icode` UNIQUE); detail
`d_pricepolicydetail` updates `PricePolicyDetail` (keys `code` + `qtylimit`).

Measured data constraint: **28,966 items, 28,966 policies, 0 items without a
policy**, and `pricepolicy.icode` is UNIQUE, so the screen cannot create a
second header for an existing item.  The reachable workflow is slab
maintenance on an existing policy.

On item 9801's policy **7670**:

* Selected the policy from the list (row 19,728; header code 7670) and opened
  the detail: one slab `qtylimit 0 / price 250 / expiry 2012-12-12`.
* Added slab `qtylimit 1 / price 251 / expiry 2030-12-12` through
  `ue_newitem`, saved: `pricepolicydetail` count **28,966 -> 28,967**; the
  header name changed from `9801.` to `FACE MASK ` (the screen sets
  `name = item.name`); “Changes take effect in database”.
* **Original quirk:** after the save, `id_master.code` was blank
  (`code ""`, status 1).  A second in-place save was rejected with
  “Price Policy already exists for this item”; `ue_save` clears the header
  code after `super::ue_save`.  Reopening via `File | List` -> `ue_detail`
  restored code 7670 and both detail rows to status 0.
* Edited the new slab to price **252**, saved; then reopened and deleted the
  slab, saved: `pricepolicydetail` back to **28,966**, with the original
  `qtylimit 0 / price 250` row intact.
* Exact restore: `pricepolicy 28,966 / max 28,966` with header 7670 name
  `9801.` / icode 9801; `pricepolicydetail 28,966`;
  `_tabmaxkey('PricePolicy') 28,968`; `audit_log 1,079 / max 1,127`; no
  residue.

Probe: `tools/parity/probe-pricepolicy-crud.mjs` - measured `ok=true`.

### Supplier Form (verified; master + manufacturer detail)

`Basic Data | Supplier .......... | Supplier` opens `w_supplier_manf`
(`w_multi_entry`).  Master `d_supplier_detail` updates `Accounts` then
`Supplier`; detail `d_supmanf` updates `SupplierManufacturers`
(`suppcode` + `manfcode`).  The save chain requires **both** a master change
and `id_detail.update() > 0`; a detail row also pushes its purchase-order
policy values to the selected Manufacturer.

* **Add:** temporary supplier code **334** (`_tabmaxkey('Accounts')
  333 -> 334`) with detail manufacturer **1** (`base 45 / projection 30 /
  policy 1`).  Save wrote the `accounts` and `supplier` rows and
  `suppliermanufacturers (334,1)`; "Changes take effect in database".
* **Edit:** city `KARACHI -> LAHORE`, alias changed, added manufacturer **2**
  detail (`45 / 30 / 1`); save wrote `(334,1)` + `(334,2)`, supplier city
  LAHORE.
* **Detail delete:** removed both detail rows, restored city `KARACHI` and
  the alias, saved: `suppliermanufacturers` **0**; the supplier/account rows
  remained until SQL cleanup.
* Manufacturer 1/2 policy fields stayed **45 / 30 / 1** (the detail update
  was a no-op).
* Supplier header delete has no `ue_delete` handler; the temporary
  supplier/account rows were removed by SQL after the detail cycle (the
  original supplier-delete behavior already documented).
* Exact restore: `accounts 257 / max 325`, `supplier 225 / max 325`,
  `suppliermanufacturers 0`, `_tabmaxkey('Accounts') 333`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-supplier-crud.mjs` - measured `ok=true`.

### Item Basic Data new-item add (verified; edit path original early-return defect)

`Basic Data | Item .......... | Item Basic Data` opens
`w_item_basicdata_form` (`w_multi_entry`, title "Item Form").  Master
`d_item_basicdata_detail` updates `Item`; detail `d_item_suplier` updates
`ItemSuppliers`; nested buffers are `d_iteminmodel`, `d_itemassociation`,
`d_associateditempart` and `d_itemauthor`.

The new-item path requires non-empty iteminmodel / itemassociation /
associateditempart / itemauthor buffers; temporary **Model 1**, **Author 1**
and **ItemPart 2** were inserted, and ItemPart 1 was used for the item.

* **Add:** new item code **29,043** (generated name
  `PARITY ITEM BASIC ... GEN`, customicode `PIB...`), supplier **18** detail,
  `iteminmodel (29043,1)`, `itemassociation (29043,9800)`,
  `associateditempart (1,2)`, `itemauthor (29043,1)`,
  `itempartinmodel (1,1)`, `itemnotes (29043)`;
  `_tabmaxkey('Item') 29,042 -> 29,043`; "Changes take effect in database".
* **Edit path is an original defect:** `ue_save` for `ib_modify = true`
  writes an itemlog and returns before updating the item/supplier.  Measured:
  changing `remarks` generated `INSERT INTO dbo.itemlog` but
  `item.remarks` stayed empty; the itemlog insert rolled back and no
  item/supplier update occurred.
* The form has no `ue_delete` handler; cleanup SQL removed the temporary item
  and all nested rows.
* Exact restore: `item 28,966 / max 29,040`, `itempart 1 / max 1`,
  `model 0`, `author 0`, `itempartinmodel 0` (rowid sequence 19),
  `iteminmodel 0`, `itemassociation 0`, `associateditempart 0`,
  `itemauthor 0`, `itemsuppliers 21,141`, `itemnotes 28,961`,
  `pricepolicy 28,966`, `_tabmaxkey`: Item 29,042 / ItemPart 1 / Model 0,
  `itemlog 98,632 / max 152,907`, `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-itembasicdata-add.mjs` - measured `ok=true`.

### Main Item Form header add + File | Delete (verified; no ue_delete handler)

`Basic Data | Item .......... | Item` opens `w_item_form` (`w_multi_entry`,
title "Item Form").  Master `d_item_detail` updates `Item`, detail
`d_item_suplier` updates `ItemSuppliers`, and the hidden buffers are
`d_iteminmodel`, `d_itemassociation`, `d_itemauthor`,
`d_alternateitemalias`, `d_itemimage`, `d_pricepolicyheader` and
`d_pricepolicydetail`.

* **Add:** `ue_newform`, master fields + supplier **18** detail, Save.  The
  header received generated code **29,043** (`_tabmaxkey('Item') 29,042 ->
  29,043`) with name `PARITY ITEM MAIN ...`, alias, prices 10/5/10 and the
  supplier detail.  PostgreSQL wrote `item` (104 columns), `itemsuppliers
  (29043,18)`, `itemnotes (29043)`, `pricepolicy 28,969` (`name 29043.`) and
  `pricepolicydetail` (`qtylimit 0 / price 10 / expiry 2012-12-12`);
  `_tabmaxkey('PricePolicy') 28,968 -> 28,969`; "Changes take effect in
  database".
* **Reopen:** File | List retrieved **28,967** rows; `ue_detail` loaded
  master code 29,043 from the list.
* **File | Delete is an original no-op:** `ue_detail` enables
  `m_delete` (text `&Delete`), but `w_item_form` and its ancestors define no
  `ue_delete` event.  Clicking the menu item and calling `ue_delete`
  directly both returned without a dialog or SQL; `item` and `itemsuppliers`
  still contained code 29,043.  This is original behavior, not a rebuild gap.
* **Systemic fix - `f_validatedw` second gate:** the recovered function
  contained two `FindRequired` calls; the second tested `FindRequired(...) =
  1`.  `FindRequired` returns 1 both when it finds a null and when it finds
  none (it then sets `ll_row` to 0), so every `w_item_form` save showed
  `Please enter a value for '!.` and returned before SQL.  The class fix now
  rewrites the second gate to `ll_row <> 0`; the regression test is
  `web/tests/class-fixes.test.ts`.
* Exact restore: `item 28,966 / max 29,040`, `itemsuppliers 21,141`,
  `itemnotes 28,961`, `pricepolicy 28,966`, `pricepolicydetail 28,966`,
  `itemassociation / iteminmodel / itemauthor / alternateitemalias 0`,
  `itemimage 361`, `itemlog 98,632 / max 152,907`,
  `_tabmaxkey`: Item 29,042 / PricePolicy 28,968, `serverdate` unchanged,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-item-main-add-delete.mjs` - measured `ok=true`.

### Item Description single-field edit (verified; menu right-hidden)

`Basic Data | Item .......... | Item Description` is invisible under the
current rights (the original `m_itemdescription.create` also sets
`visible = false`), so the probe opened `w_item_form2` with the real
`opensheetwithparm(..., 1, ...)` handler.  `w_item_form2` (`w_single_entry`,
title "Item Description Form") uses `d_item_detail2`, whose only updateable
column is `Item.RemarksForPurchase`, and `d_item_list2` (28,966 rows).

* `ue_list` -> row 9,239, `ue_detail` loaded item **9801**;
  `remarksforpurchase` was NULL.
* Set `PARITY ITEM DESCRIPTION` and Save: `UPDATE dbo.item SET
  remarksforpurchase = $1 WHERE icode = $2 AND remarksforpurchase IS NULL`,
  rowcount 1; "Changes take effect in database".
* No itemlog row.  The item trigger advanced `lastupdate` to
  `2026-11-06 00:46:05.303`; cleanup restored
  `remarksforpurchase NULL / lastupdate 2026-11-05 10:38:44.342` with
  `session_replication_role = replica`, then removed audit rows above 1,127.
* Exact restore: `item 28,966 / max 29,040`, `itemlog 98,632 / max 152,907`,
  `audit_log 1,079 / max 1,127`, original row value and timestamp.

Probe: `tools/parity/probe-itemdescription-edit.mjs` - measured `ok=true`.

### Sales Team add/edit + File | Delete (verified; right-hidden, no ue_delete)

`Basic Data | Customer .......... | Sales Team` is invisible (right 480,
`m_salesteam.visible = false`), so the probe opened `w_salesteam` directly
through `opensheetwithparm`.  Master `d_salesteam` updates `SalesTeam`, detail
`d_salesteamdetail` updates `SalesTeamMember`, list `d_salesteamlist` joins
`Manufacturer`.

* **Add:** team code **1** through `f_newtableid("salesteam")`
  (`_tabmaxkey('SalesTeam') 0 -> 1`), name, manufacturer 1, manager, remarks,
  and member `salesmancode 1`.  PostgreSQL wrote `salesteam (1, 1, ...)` and
  `salesteammember (1, 1)`; "Changes take effect in database".
* **Edit:** `ue_list` returned the one team; `ue_detail` loaded it.  Name,
  manager and remarks changed and Save wrote the `UPDATE dbo.salesteam ...`
  (rowcount 1).
* **File | Delete is an original no-op:** `m_delete` was enabled, but
  `w_salesteam` and its ancestors define no `ue_delete` event.  Clicking it
  left both the team and the member row in place.
* Exact restore: `salesteam 0 / max 0`, `salesteammember 0`,
  `_tabmaxkey('SalesTeam') 0`, `serverdate` unchanged,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-salesteam-crud.mjs` - measured `ok=true`.

### Prospective Customer add/edit/delete (verified)

`Basic Data | Customer .......... | Prospective Customer` is invisible under
the current rights (right 855), so the probe opened
`w_prospectivecustomer_form` with the real `opensheetwithparm` handler.
`w_single_entry`, title "Prospective Customer Form"; `d_prospectivecustomer_detail`
updates `ProspectiveCustomer`, list `d_prospectivecustomer_list`.

* **Add:** code **1** through `f_newtableid("ProspectiveCustomer")`
  (`_tabmaxkey 0 -> 1`), alias, name, category 1, area 1, sub-area 1,
  address/city/country, licence expiry 2030-12-12, message 1, salesman 1.
  PostgreSQL inserted the 21-column row; "Changes take effect in database".
  The first attempt with `messagecode 0` correctly failed on
  `fk_message_prospectivecustomer` (real FK), so 1 was used.
* **Edit:** File | List returned the one row; `ue_detail` loaded it.  Name,
  city (`KARACHI -> LAHORE`) and address1 changed and Save updated the row.
* **Delete:** File | Delete showed the original confirmation
  "Delete this record permanently from Database?"; Yes produced
  `DELETE FROM dbo.prospectivecustomer WHERE ...` (rowcount 1) and
  "Record Deleted Successfully".
* Exact restore: `prospectivecustomer 0 / max 0`,
  `_tabmaxkey('ProspectiveCustomer') 0`, `site 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-prospectivecustomer-crud.mjs` - measured `ok=true`.

### Guest Room Floor / Type / Status masters (verified; right-hidden)

The three guest-room lookup masters are created with `visible = false` in
`m_entry`; the probe fires their real `m_guestroomfloor` /
`m_guestroomtype` / `m_guestroomstatus` menu handlers.  Each uses
`w_single_entry` and a two-column `..._detail` (`code`, `name`) plus a
`..._list`.

* **Guest Room Floor** (`guestroomfloor`, key `guestroomfloorcode`, tab
  `GuestRoomFloor`): add `PARITY FLOOR ...`, edit, then `ue_delete` (right
  579) deleted it; "Changes take effect in database" twice and "Record
  Deleted Successfully".
* **Guest Room Type** (`guestroomtype`, key `guestroomtypecode`, tab
  `GuestRoomType`): same add/edit/delete cycle.
* **Guest Room Status** (`guestroomstatus`, key `guestroomstatuscode`, tab
  `GuestRoomStatus`): same add/edit/delete cycle.
* The `m_delete` menu item is disabled right after Save (the original
  `ue_save` only enables `m_new`); it becomes enabled after File | List ->
  Detail.  The probe calls the real `ue_delete` handler directly, which is
  the same handler the menu fires.
* Exact restore for all three: 0 rows / tab 0 / `audit_log 1,079 / max
  1,127`, no residue.

Probe: `tools/parity/probe-single-master.mjs` with `guestroomfloor`,
`guestroomtype`, `guestroomstatus` - measured `ok=true` for all three.

### Guest Room add/edit + File | Delete (verified; delete hard-disabled)

`m_guestroom` (hidden) opens `w_guestroom_form` (`w_multi_entry`, title
"Guest Room Form").  Master `d_guestroom_detail` updates `GuestRoom`; the
detail `d_guestroomservice` updates `GuestRoomService`; list
`d_guestroom_list` joins floor/type/status and the active check-in.

* Temporary floor/type/status fixtures (`PARITY ... FIXTURE`) were inserted
  for the required drop-downs, then removed.
* **Add:** name `PARITY ROOM ...`, capacity 2, floor/type/status 1,
  occupied N.  `wf_tabnewid("GuestRoom")` generated code **1**
  (`_tabmaxkey 0 -> 1`); `INSERT INTO dbo.guestroom (guestroomcode, name,
  capacity, guestroomfloorcode, guestroomtypecode, guestroomstatuscode)
  VALUES (1, ...)`; "Changes take effect in database".  The form also issued
  its service-invoice cleanup (`DELETE FROM dbo.guestroomservice WHERE
  guestroomcode=1`) before the insert, as the script does.
* **Reopen:** File | List returned the room; Detail loaded code 1.
* **Edit:** name + capacity 2 -> 3:
  `UPDATE dbo.guestroom SET name=$1, capacity=$2 WHERE guestroomcode=$3 ...`
  (rowcount 1).
* **File | Delete is hard-disabled:** `w_guestroom_form` and its ancestors
  define no `ue_delete`, and `m_delete` is disabled; the room stayed in place.
  This is original behavior, not a rebuild gap.
* Exact restore: `guestroom 0`, floor/type/status 0, `guestroomservice 0`,
  `_tabmaxkey('GuestRoom') 0`, `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-guestroom-crud.mjs` - measured `ok=true`.

### Guest master add/edit/delete (verified; right-hidden)

`m_guestregistration` (hidden) opens `w_guest_form` (`w_single_entry`, title
"Guest Form").  `d_guest_detail` updates `Guest`; `d_guest_list` lists it.
The form is the guest registration dialog path (`w_guestregistration` is the
smaller modal that reuses `d_guest_detail`).

* **Add:** name, NIC, gender M, active Y, customer 22, regno left empty
  (auto-generated), mobile/address and the remaining optional fields.
  `sqlca.gettabmaxkey("Guest")` generated code **1**
  (`_tabmaxkey 0 -> 1`); `regno` became `1`; the INSERT wrote all 19 columns
  with `usercode 1`; "Changes take effect in database".
* **Edit:** File | List returned the guest; Detail loaded code 1.  Name,
  mobile and address changed and the UPDATE wrote all comparison columns
  (rowcount 1).
* **Delete:** File | Delete showed "Delete this record permanently from
  Database?", the DELETE hit `Guest` (rowcount 1) and reported "Record
  Deleted Successfully".
* Exact restore: `guest 0 / max 0`, `_tabmaxkey('Guest') 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-guest-crud.mjs` - measured `ok=true`.

### Guest Check-In add/edit (verified with a group cash-account fixture)

`m_guestcheckin` (hidden) opens `w_guestcheckin` (`w_multi_entry`, title
"Guest Check In Form").  Master `d_guestcheckin` updates `GuestCheckin`;
detail `d_guestcheckinservice` updates `GuestCheckInService`; the save also
updates `GuestRoom.Occupied` and reconciles `MasterCashWin`.

* **Data prerequisite, not a rebuild gap:** the live and cloned databases
  have no `groupcashaccount` row for module **42** (guest check-in), so the
  original path shows "No Cash Account Attached to the group of the user
  logged on" and aborts before SQL.  The probe inserted the temporary row
  `(groupcode 2, moduleid 42, cashacccode 2)` and removed it afterwards.
* **Add:** temporary guest 1 and room 1 (floor/type/status fixtures), guest
  code 1, room 1, check-in/arrival dates 2026-11-06, departure 2026-11-07,
  stay 1, persons 1, cash account 2.  `wf_tabnewid("GuestCheckIn")` generated
  code **1** (`_tabmaxkey 0 -> 1`); the INSERT wrote `guestcheckin` (code,
  server date, usercode 1, guest 1, room 1, `checkout N`, remarks, cash
  fields) and the form set `GuestRoom.Occupied = 'Y'`; "Changes take effect
  in database".
* **Edit:** File | List returned the check-in; Detail loaded it.  Remarks
  changed and the UPDATE matched.  **Original defect:** the edit path leaves
  `ldt_server_datetime` uninitialized and unconditionally assigns it to
  `Date`, so the reopened row's `date` becomes `1900-01-01 00:00:00`; the
  check-in date itself (`checkindate`) is unchanged.  This is the recovered
  script's behavior, not a rebuild regression.
* Exact restore: `guestcheckin 0`, `guestcheckinservice 0`,
  `guestroom 0`, `guest 0`, `mastercashwin 0`, `groupcashaccount 43 /
  max rowid 176`, `_tabmaxkey('GuestCheckIn') 0`,
  `serverdate 2026-11-06 00:38:24`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-guestcheckin-add.mjs` - measured `ok=true`.

### Guest Registration modal add (verified)

`w_guestregistration` (title "Guest Registration", `w_single_entry`-style
modal opened by the check-in screen's Register Guest action) uses one
`d_guest_detail` and the Save button `cb_ok`.

* Filled name, NIC, gender M, active Y, customer 22 and the optional guest
  fields, with regno left blank.
* Save ran `wf_getserverdatetime` (updating `ServerDate.LastTransDate`),
  generated `Guest` code **1** (`_tabmaxkey 0 -> 1`), copied it to `regno`,
  set `usercode 1`, inserted the Guest row and closed with
  "Changes take effect in database".
* Exact restore: `guest 0 / max 0`, `_tabmaxkey('Guest') 0`,
  `serverdate 2026-11-06 00:38:24`, `audit_log 1,079 / max 1,127`,
  no residue.

Probe: `tools/parity/probe-guestregistration-add.mjs` - measured `ok=true`.

### Guest Check-Out save paths (verified; original no-commit branch)

`m_guestcheckout` (hidden) opens `w_guestcheckout_form` (`w_single_entry`,
title "Guest Check Out Form"); it lists checked-in guests through
`d_guestcheckin`/`d_guestcheckinlist`.  The probe used a temporary guest,
room (occupied Y) and GuestCheckin 1 (checkout N).

* **CheckOut = Y path:** the recovered `ue_save` sets `checkoutby`/
  `checkoutdate`, runs `sqlca.guestcheckinbalance`, calls
  `wf_set_guest_inactive` -> `UPDATE dbo.guest SET active='N'`, then
  **returns without COMMIT and without `id_detail.update()`**.  Measured:
  the UPDATE was sent (rowcount 1), but an outside session still saw
  `Guest.Active = 'Y'`, `GuestCheckin.CheckOut = 'N'`,
  `CheckoutDate/By` empty, `GuestRoom.Occupied = 'Y'`, and no success
  message.  This is an original defect, not a rebuild gap.
* **CheckOut = N path:** Save updates `GuestCheckin`
  (`UPDATE ... SET checkout='N', checkoutdate, checkoutby ...`), frees the
  room (`UPDATE GuestRoom SET Occupied='N'`), commits and shows "Changes take
  effect in database".  The commit also persists the pending Guest.Active='N'
  update from the first path (`Active = 'N'` measured after this save).
* Exact restore: `guestcheckin 0`, `guestroom 0`, `guest 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-guestcheckout.mjs` - measured `ok=true`.

### Guest Transfer add (verified; password dialog + room swap)

`m_guesttransfer` (hidden) opens `w_guesttransfer_form` (`w_single_entry`,
title "Guest Transfer Form").  The form inserts a `GuestTransfer` row and then
moves the guest's current room in `GuestCheckIn` and swaps both rooms'
`Occupied` flags.

* Fixtures: guest 1, rooms 1 (occupied Y) and 2 (occupied N), check-in 1
  (checkout N, current room 1).
* **Add:** detail row `guestcheckincode 1`, `lastroom 1`, `newroom 2`,
  remarks.  Save opened `w_salesmanpassword`; ADMIN/password9080 accepted.
  Measured SQL: `f_newtableid("GuestTransfer")` -> code **1**
  (`_tabmaxkey 0 -> 1`); `INSERT INTO dbo.guesttransfer (guesttransfercode,
  guestcheckincode, date, usercode, lastroom, newroom, remarks) VALUES
  (1, 1, ..., 1, 1, 2, ...)`;
  `UPDATE dbo.guestcheckin SET currentroom = 2 WHERE guestcheckincode = 1`;
  `UPDATE dbo.guestroom SET occupied = 'Y' WHERE guestroomcode = 2`;
  `UPDATE dbo.guestroom SET occupied = 'N' WHERE guestroomcode = 1`;
  "Changes take effect in database".
* Exact restore: `guesttransfer 0 / max 0`, `guestcheckin 0`,
  `guestroom 0`, `guestroomfloor/type/status 0`, `guest 0`,
  `_tabmaxkey('GuestTransfer') 0`, `audit_log 1,079 / max 1,127`,
  no residue.

Probe: `tools/parity/probe-guesttransfer-add.mjs` - measured `ok=true`.

### Patient Admission add (verified with patient/bed fixtures)

`m_admitpatient` (hidden) opens `w_patientadmission_form` (title "Patient
Admission Form").  Master `d_patientadmission_detail` updates
`PatientAdmission`; the recurring-services detail is
`d_admitedpatient_recurringservices`; list `d_patientadmission_list`.

* The live/clone `Patient` and `PatientLocation` tables are empty; temporary
  `Ward` 1, `PatientLocation` 1 ("PARITY BED 1"), and `Patient` 1
  (`PARITY-P1`, customer 19) were inserted.
* **Add:** patient 1, customer 19, location 1, disease 1, diagnosis,
  remarks, procedure/transport charges 0, cash account 2.  Save ran
  `wf_getserverdatetime` (ServerDate updated), generated admission code **1**
  (`_tabmaxkey 0 -> 1`) and inserted:
  `INSERT INTO dbo.patientadmission (admissioncode, patientcode, custcode,
  locationcode, date, usercode, diseasecode, diagnosis, remarks,
  cashacccode, cashtendered, cashcharged, cashback, procedurecharges,
  proceduregstperc, transportcharges, dischargereasoncode) VALUES (1, 1, 19,
  1, ..., 1, 1, ...)`.
  No `MasterCashWin` rows were written (the cash-window list is empty); no
  group cash-account problem because module 36 is configured for group 2.
  "Changes take effect in database".
* Exact restore: `patientadmission 0 / max 0`, `patient 0`,
  `patientlocation 0`, `ward 0`, `mastercashwin 0`,
  `_tabmaxkey('PatientAdmission') 0`, `serverdate 2026-11-06 00:38:24`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-patientadmission-add.mjs` - measured `ok=true`.

### Patient Transfer add (verified; bed move)

`m_trasnferpatient` (hidden) opens `w_patienttransfer_form` (title is
"Patient Admission Form" in the recovered object).  Detail
`d_patienttransferdetail` updates `PatientTransfer`; save also updates the
admission's current location.

* Fixtures: ward 1, beds 1 and 2, patient 1, admission 1 at bed 1.
* **Add:** admission 1, source 1, target 2, remarks.  Password
  ADMIN/password9080 accepted; `f_newtableid("PatientTransfer")` -> code 1;
  `INSERT INTO dbo.patienttransfer (transfercode, admissioncode, date,
  sourcelocation, targetlocation, usercode, remarks) VALUES (1, 1, ..., 1,
  2, 1, ...)`; `UPDATE dbo.patientadmission SET locationcode = 2 WHERE
  admissioncode = 1` (rowcount 1); "Changes take effect in database".
* Exact restore: `patienttransfer 0 / max 0`, `patientadmission 0`,
  `patient 0`, `patientlocation 0`, `ward 0`,
  `_tabmaxkey('PatientTransfer') 0`, `serverdate 2026-11-06 00:38:24`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-patienttransfer-add.mjs` - measured `ok=true`.

### Patient Admission edit + two-stage Discharge (verified with right fixtures)

The live rights catalog is missing **5022 (initial discharge), 5023 (final
discharge), 5140 (edit admission) and 1782 (modify initial-discharge date)**.
Temporary `rights` + `grouprights` rows for group 2 were inserted for this
probe and removed afterwards; without them the discharge form opens with
"Rights Limitations" and the admission edit cannot enter modify mode.

* **Admission edit:** reopened admission 1 through File | List; with right
  5140 `ib_modify = true`.  Changed diagnosis/remarks and saved:
  `DELETE FROM dbo.admittedpatientrecurringservices WHERE admissioncode=1`
  (no rows) and `UPDATE dbo.patientadmission SET diagnosis=$1, remarks=$2
  WHERE admissioncode=1 ...`; the row then read
  `PARITY DIAGNOSIS EDITED` / `PARITY DISCHARGE ...`.  "Changes take effect
  in database".
* **Initial discharge:** checked-in admission 1; set `Discharged1='Y'`
  (`Discharged='N'`) and saved.  Measured persisted row:
  `Discharged1='Y'`, `Discharged1By=1`,
  `Discharged1On=2026-11-06 06:13:44.634`, `Discharged='N'`;
  "Changes take effect in database".  The admission remains counted as
  occupied (the occupancy query filters on `Discharged='N'`).
* **Final discharge is an original early-return defect:** setting
  `Discharged='Y'` and saving runs the balance/dischargeability checks and
  sends `UPDATE dbo.patient SET active='N'`, then **returns before
  `PatientAdmission.update()`**.  Measured after the final save:
  `Discharged` is still `N`, `DischargedBy/On` are empty, the admission is
  still counted as occupying bed 1 (1 row), and no success message is shown.
* Exact restore: admissions/patients/locations/wards = 0,
  `_tabmaxkey('PatientAdmission') 0`, temporary rights 0,
  `serverdate 2026-11-06 00:38:24`, `audit_log 1,079 / max 1,127`,
  no residue.

Probe: `tools/parity/probe-patientadmission-edit-discharge.mjs` - measured
`ok=true` (the final-discharge early return is recorded as parity behavior).

### Employee lookup masters (verified; right-hidden)

The employee lookup forms are created with `visible = false`; the probe fires
their real `m_entry` handlers.  All are `w_single_entry` forms.

* **Employee Category** (`m_employeecategory` -> `w_emp_category`,
  `emp_category`, key `empcatcode`, tab `EMP_Category`): baseline 1 row
  (`REGULAR EMPLOYEES`), tab 1; add code 2, edit, delete.
* **Employee Designation** (`m_employeedesignation` -> `w_emp_designation`,
  `emp_designation`, key `desigcode`, tab `EMP_Designation`): baseline 1 row
  (`DEFAULT`), tab 1; add code 2, edit, delete.
* **Pay Allowances** (`m_payallowances` -> `w_emp_allowances`,
  `emp_allowance`, key `allowancecode`, tab `EMP_Allowance`): 0 rows, tab 0;
  add code 1 with `attendancewise N / percentage 0 / flatamount 0`, edit to
  percentage 1 / flatamount 10, delete.
* **Attendance Status/Policy** (`m_attendancestatuspolicy` ->
  `w_emp_attendancestatus`, `emp_attendancestatus`, key
  `attendancestatuscode`, tab `EMP_AttendanceStatus`): baseline 12 policy
  rows, tab 12; add code 13 (`half 0`, `deductionperc 0`, `autoset N`,
  `timetype 1`, `margin 0`), edit deduction 1 / margin 5, delete.
* Exact restore for all four: original rows and tab counters, no residue,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-single-master.mjs` with `empcategory`,
`empdesignation`, `empallowance`, `empattendancestatus` - `ok=true` for all.

### Employee Education / Certification / Skill (verified via reopen)

`m_education`, `m_certificationcourse` and `m_skillcapability` open
`w_emp_education`, `w_emp_certification` and `w_emp_skill`.  Their tables use
**database identity keys** (`emp_education.educationcode`,
`emp_certification.certificationcode`, `emp_skill.skillcode`), and the
recovered DataWindow carries no `Identity` attribute.

* Add: `INSERT INTO dbo.emp_education (name) ...` (the identity key is
  omitted, as in PowerBuilder), new code **2**; "Changes take effect in
  database".
* **Immediately after Insert the buffer key is still null**, so an in-place
  Update sends `WHERE educationcode IS NULL` and matches 0 rows.  The real
  user path - File | List -> Detail - reloads the row with code 2 and was
  used for the verified edit/delete: `UPDATE ... WHERE educationcode = 2 ...`
  (rowcount 1), then `DELETE ... WHERE educationcode = 2 ...` (rowcount 1),
  "Record Deleted Successfully".
* Exact restore for each: table 0 rows, identity sequence back to
  `last_value 1 / is_called true`, `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-empidentity-crud.mjs` with `education`,
`certification`, `skill` - `ok=true` for all three.

### Employee Department master + weekday timing (verified; no ue_delete)

`m_employeedepartment` (hidden) opens `w_emp_dept` (`w_multi_entry`, title
"Employee Department Form").  Master `d_emp_dept_detail` updates
`EMP_Department`; detail `d_emp_dept_daytiming` updates
`EMP_DepartmentTiming`; list `d_emp_dept_list`.

* Baseline: 1 department (`DEFAULT`), 0 timing rows, `_tabmaxkey
  ('EMP_Department') 1`.
* **Add:** code **2**, name `PARITY EMPDEPT ...`, timing weekday 1 with the
  DataWindow defaults `09:00:00 / 12:59:59 / 14:00:00 / 17:59:59`.
  PostgreSQL inserted both rows; `_tabmaxkey -> 2`; "Changes take effect in
  database".
* **Edit:** File | List returned 2 departments; `ue_detail` loaded code 2 and
  its timing row.  Name and `shtimeout 17:59:59 -> 18:30:00` were updated by
  two UPDATE statements (rowcount 1 each); second "Changes take effect".
* **File | Delete is an original no-op:** `m_delete` was enabled, but
  `w_emp_dept` and its ancestors define no `ue_delete`; the department and
  its timing row stayed in place.
* Exact restore: `emp_department 1 / max 1`, `emp_departmenttiming 0`,
  `_tabmaxkey('EMP_Department') 1`, `audit_log 1,079 / max 1,127`, no
  residue.

Probe: `tools/parity/probe-empdept-crud.mjs` - measured `ok=true`.

### Online Attendance kiosk clock-in/clock-out (verified; timeslab defect recorded)

`m_employeeonlineattendance` (hidden) opens the modal `w_emp_attendance`
(empty title, `windowtype 3`).  `wf_validate_empid` looks up
`EMP_Employee.AllowAttendanceViaID`, calls `markattendance` ->
`sp_markattendance`, then retrieves the result into the kiosk display.

* Temporary employee `PARITYATT...` with `AllowAttendanceViaID='Y'`.
* **First scan:** `wf_validate_empid` returned 0 and inserted
  `EMP_Attendance` code **2** (identity sequence 1 -> 2):
  `empcode 1`, `fingercode 1`, `timein 2026-11-06 06:24:03.347`,
  `timeout NULL`, `attendancestatuscode 1`, `payed N`.
* **Second scan:** the same open row was closed:
  `timeout 2026-11-06 06:24:08.645` on the same attendance code 2.
* Exact restore: `emp_attendance 0`, identity sequence back to
  `last_value 1 / is_called true`, employee 0, `serverdate 2026-11-06
  00:38:24`, `audit_log 1,079 / max 1,127`.
* **Timeslab path defect (recorded):** the installation has
  `ApplyDeptTimeSlabsInOnlineAtten='Y'`, but the generated
  `sp_markattendance` converts department times with
  `to_char(..., 'HH24:MI:SS:MS')`/`left(...,10)` and assigns the resulting
  time-only text (`'00:00:00:0'`) to a `timestamp` variable.  SQL Server
  implicitly anchors that to 1900-01-01; PostgreSQL rejects it
  (`invalid input syntax for type timestamp: "00:00:00:0"`).  Replacing the
  colon with the valid decimal millisecond separator still leaves
  `"00:00:00.0"` time-only, so the fix needs to carry a date (or use a
  `time` variable).  The probe exercised the non-timeslab branch with the
  preference temporarily `N` (restored to `Y`); the timeslab branch remains
  a rebuild port gap, not a missing screen.
* The kiosk display DataWindow was not resolved through the user-object
  traversal in this probe (`dw_control` rows null), but the DB path above is
  the same one the retrieved kiosk display reads.

Probe: `tools/parity/probe-attendance-kiosk.mjs` - measured `ok=true` for the
non-timeslab branch.

### Item Meter master (verified; right-hidden)

`m_itemmeter` (hidden) opens `w_itemmeter_form` (`w_single_entry`, title
"Item Meter Form").  `d_itemmeter_detail` updates `itemmeter`
(`itemmetercode`, `name`, `description`, `currentreading`), list
`d_itemmeter_list`.

* Baseline: 0 rows, `_tabmaxkey('ItemMeter') 0`.
* Add code **1** with description `PARITY ITEM METER` and current reading 0;
  edit to description `... EDITED` and reading 5; delete through `ue_delete`
  (right 579).  All three saves reported "Changes take effect in database";
  delete reported "Record Deleted Successfully".
* Exact restore: `itemmeter 0 / max 0`, `_tabmaxkey('ItemMeter') 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-single-master.mjs itemmeter` - measured
`ok=true`.

### Item Allowed Meter assignment (verified)

`m_itemallowedmeter` (hidden) opens `w_itemallowedmeter`
(`w_multi_entry`, title "Item Allowed Meter").  The master is the existing
item (`d_itemallowedmeter_header` on `Item`); the detail
`d_itemallowedmeter_detail` updates `ItemAllowedMeter`
(`icode`, `itemmetercode`, `priority`).

* With temporary `ItemMeter 1`, set master code **9801** (`FACE MASK`) and
  detail meter 1 / priority 10, then Save:
  `INSERT INTO dbo.itemallowedmeter (icode, itemmetercode, priority)
  VALUES (9801, 1, 10)` (rowcount 1); "Changes take effect in database".
* Removed the detail row from the buffer and saved again:
  `DELETE FROM dbo.itemallowedmeter WHERE icode = 9801 AND itemmetercode = 1
  AND priority = 10` (rowcount 1).
* The form never updates `Item`; item 9801 stayed
  `saleprice 10.00 / lastupdate 2026-11-05 10:38:44.342`.
* Exact restore: `itemallowedmeter 0`, `itemmeter 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-itemallowedmeter-crud.mjs` - measured `ok=true`.

### Employee Holiday Calendar (verified via reopen)

`m_holidaycalendar` (hidden) opens `w_emp_holiday` (`w_multi_entry`,
title "Holiday Calendar").  The master `d_emp_holiday_header` is only a month
filter (`SELECT DATE=:ad_date`); the detail `d_emp_holiday_detail` updates
`EMP_Holiday` (`holidayid` identity, `date`, `name`, `payrateperc`) and the
list `d_emp_holiday_list` returns the distinct month starts.

* **Add:** detail row `2026-12-25`, `PARITY HOLIDAY ...`, `150`:
  `INSERT INTO dbo.emp_holiday (date, name, payrateperc) ...` (identity key
  omitted, new code **2**); "Changes take effect in database".  The identity
  sequence started at 1/true, so the generated key is 2.
* **Reopen:** File | List returned the `2026-12-01` month row; Detail
  retrieved the month and loaded code 2, so the identity key was in the buffer.
* **Edit:** name + `payrateperc 150 -> 200`:
  `UPDATE dbo.emp_holiday SET name=$1, payrateperc=$2 WHERE holidayid=$3 ...`
  (rowcount 1).
* **Delete:** removed the detail row in the buffer and Save:
  `DELETE FROM dbo.emp_holiday WHERE holidayid=$1 ...` (rowcount 1).
  File | Delete on the form is an original no-op (`ue_delete` absent).
* Exact restore: `emp_holiday 0`, identity sequence `last_value 1 / is_called
  true`, `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-emp-holiday-crud.mjs` - measured `ok=true`.

### Employee Pay Deductions (verified; File | Delete FK-blocked)

`m_paydeductions` (hidden) opens `w_emp_deduction` (`w_single_entry`, title
"Employee Deduction Form").  Its `ue_save` inserts the Accounts row, then
switches the DataWindow update table to `emp_deduction` for the deduction
attributes, then restores Accounts as the update table.

* **Add:** account **334** (`f_newtableid("Accounts")`,
  `_tabmaxkey 333 -> 334`) with subcode 24, unique name/alias, active Y,
  restricted N, alert 1, balance limit 100; then
  `INSERT INTO dbo.emp_deduction (deductioncode, description, percentage,
  flatamount) VALUES (334, 'PARITY PAY DEDUCTION', 5, 10)`.
  Both statements committed; "Changes take effect in database".
* **Edit:** description -> `... EDIT`, percentage 5 -> 7:
  `UPDATE dbo.emp_deduction ... WHERE deductioncode=334 ...` (rowcount 1).
  The recovered save marks `remarks.Update=No` after the first save, so the
  Accounts remarks deliberately stays at its original value - original
  behavior, not a rebuild gap.
* **File | Delete is original FK behavior:** after save the update table is
  Accounts again, so Delete issues `DELETE FROM dbo.accounts WHERE ...` and
  PostgreSQL raises `fk_accounts_emp_deduction_deductioncode`; the form shows
  "You can not Delete this record Reason: Some information refering to this
  record exists" and both rows remain.
* Exact restore: `accounts 257 / max 325`, `emp_deduction 0`,
  `_tabmaxkey('Accounts') 333`, `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-empdeduction-crud.mjs` - measured `ok=true`.

### Employee Advances + voucher (verified, including password dialog)

`m_employeeadvances` (hidden) opens `w_emp_advance` (`w_multi_entry`, title
"Employee Advances").  Save is add-only: it opens the modal
`w_salesmanpassword`, checks the entered user/password against `users`, calls
`wf_tabnewid("EMP_Advance")`, creates the accounting voucher through
`u_transaction.createvoucher(5, 2, ...)` and inserts `EMP_Advance`.

* Temporary employee fixture `PARITY001`/`PARITY EMPLOYEE` with
  `AdvAccCode 24` (the advance dropdown `ddd_employees_advance_null` is empty
  without an employee); advance row: date 2026-11-06, cash account 2, advance
  account 24, amount 1000, installment 100, refno `PARITY-ADV-...`.
* Save opened `w_salesmanpassword`; entering **1 / password9080** and clicking
  Ok closed it with usercode 1.  Measured SQL:
  `_tabmaxkey('EMP_Advance') 0 -> 1`;
  `INSERT INTO dbo.glheader` (glvochcode 1, vouchercode 1, vochcatcode 5,
  remarks); `INSERT INTO dbo.gldetail` debit account 24 = 1000.00 and credit
  account 2 = 1000.00; then
  `INSERT INTO dbo.emp_advance (advancecode, date, usercode, acccode,
  empadvacccode, amount, returnedamt, installment, glvochcode, refno,
  remarks) VALUES (1, ..., 1, 2, 24, 1000, 0, 100, 1, ...)`.
  Message: "Changes Take Effect in database".
* Exact restore: `emp_advance 0`, `emp_employee 0`, `glheader 0`, `gldetail
  0`, `_tabmaxkey('EMP_Advance') 0`, GL sequence back to 0,
  `audit_log 1,079 / max 1,127`, no residue.
* Probe note: programmatic `setitem` leaves the DOM DwView acceptance wrapper
  in a failed-input state (no editor draft), so the probe commits through the
  DataWindow model (`acceptText` returns 1) while `f_validatedw` still runs
  `FindRequired`; a real keyboard entry does not need that workaround.

Probe: `tools/parity/probe-empadvance-add.mjs` - measured `ok=true`.

### Payroll add (verified, including password dialog)

`m_payroll` (hidden) opens `w_payroll` (`w_multi_entry`, title "Payroll").
Master `d_emp_payroll` updates `EMP_Payroll`; detail
`d_emp_payrollallowances` updates `EMP_PayrollAllowances`; footer
`d_emp_payrolldeduction` updates `EMP_PayrollDeductions`; footer2
`d_emp_payrollfooter` is a computed net-payable display.

* Temporary employee fixture `PARITY001` / `PARITY EMPLOYEE`.
* **Add:** one payroll row for employee 1, paid N, cash account 2, from
  2026-11-01 to 2026-11-30, workdays/presents 26, per-hour rate 100,
  basic pay 2600, all overtime/bonus/deduction fields 0.  Save opened
  `w_salesmanpassword`; ADMIN/password9080 accepted, then:
  `wf_tabnewid("Emp_Payroll")` -> code **1**
  (`_tabmaxkey 0 -> 1`), and
  `INSERT INTO dbo.emp_payroll (payrollcode, date, posted, usercode,
  lastsaved, fromdate, todate, empcode, workdays, presents, absents, leaves,
  sundays, holidays, hoursworked, perhourrate, basicpay, overtimehours,
  overtimerate, overtime, bonuspay, specialpay, additionalpay, otherpay,
  fine, penalty, othercharge, advance, netpayable, remarks, paid, paidvia,
  paymentdate, paymentrefno) VALUES (1, ..., 1, 1, ..., 2600, ..., 'N', 2,
  ..., 'CASH')`.
  Measured row: `basicpay 2600.00`, `netpayable 2600.00`, `paid N`,
  `usercode 1`; "Changes take effect in database".
* No allowances/deductions rows are written for this zero-deduction case
  (both tables stayed at 0).
* **Edit:** File | List returned the payroll row; Detail loaded code 1.
  Basic pay changed 2600 -> 2700 and remarks changed; Save opened the same
  password dialog, then `UPDATE dbo.emp_payroll` wrote
  `basicpay 2700.00`, recomputed `netpayable 2700.00`, and the edited remarks
  (success message again).
* Exact restore: `emp_payroll 0 / max 0`, `emp_employee 0`,
  `emp_payrollallowances 0`, `emp_payrolldeductions 0`,
  `_tabmaxkey('Emp_Payroll') 0`, `serverdate 2026-11-06 00:38:24`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-payroll-add.mjs` - measured `ok=true`.

### Payroll Post (verified after the cursor-rows fix)

The Post menu item runs `w_payroll.wf_post()` -> `wf_post_payroll(1)`: a
`w_salesmanpassword` dialog, then `w_arg_sinvcode_linvcode` for the payroll
range, then `sp_postpayroll`.

* Temporary employee + unposted payroll row (code 1, basic/net pay 2600).
* Password ADMIN/password9080 and range 1..1 accepted.  Measured result:
  `emp_payroll.posted = 'Y'`, `postdate = 2026-11-06 05:51:06.264`,
  `postedby = 1`, and the message "Posting Successfully done."  No GL header
  or detail rows are written by this procedure (both stayed 0).
* **Systemic fix:** the generator had emitted `@@CURSOR_ROWS` as `(-1)`, so
  the procedure's `WHILE @counter <= @totalrows` loop never executed and the
  UI reported success without changing the row.  `tools/tsql/tstmt.py` now
  counts the cursor SELECT when `SET @rows = @@CURSOR_ROWS` follows `OPEN`;
  `db/pg/60_procedures.sql` was regenerated (32 call sites) and
  `tools/tsql/selftest.py` has a regression case.
* Exact restore: `emp_payroll 0 / max 0`, `emp_employee 0`, `emp_advance 0`,
  `glheader/gldetail 0`, `_tabmaxkey('Emp_Payroll') 0`,
  `serverdate 2026-11-06 00:38:24`, `audit_log 1,079 / max 1,127`,
  no residue.

Probe: `tools/parity/probe-payroll-post.mjs` - measured `ok=true` after
applying the regenerated `sp_postpayroll` to the clone.

### Payroll Payment (verified; batch payment + password)

`w_payroll.wf_payroll_payment()` is enabled from the list tab and opens
`w_emp_payroll_payment` (title "Employee Payroll Payment").  Its
`d_emp_paid_payrolllist` retrieves `EMP_Payroll` rows with `Posted='Y' AND
Paid='N'`.

* Temporary employee + posted/unpaid payroll 1 (`netpayable 2600`).
* The payment window listed 1 row.  Set `Paid='Y'`, `PaidVia=2`,
  `PaymentRefNo='CASH'`, `PaymentRemarks='PARITY PAYMENT REMARKS'` and Save.
  Password ADMIN/password9080 accepted; `wf_getserverdatetime` updated
  ServerDate; the update wrote `paid='Y'`,
  `paymentdate=2026-11-06 05:54:43`, `paidby=1`, `paidvia=2`,
  `paymentrefno='CASH'`, `paymentremarks='PARITY PAYMENT REMARKS'`;
  "Changes take effect in database".
* Exact restore: `emp_payroll 0 / max 0`, `emp_employee 0`,
  `_tabmaxkey('Emp_Payroll') 0`, `serverdate 2026-11-06 00:38:24`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-payroll-payment.mjs` - measured `ok=true`.

### Employee master add/edit (verified; creates the salary account)

`m_employeeprofile` (hidden) opens `w_employee_list` (title "Employee List");
its `ue_new` opens the modal `w_emp_form` (title "Employee Form",
`windowtype 3`).  The form has eight tabs and 62 master columns.

* **Add:** EMPID, full name, gender M, marital S, employee/birth/join dates,
  category/department/designation 1, active Y, and the salary-account fields
  (`accounts_name`, `accounts_aliasname`, `accounts_subcode 24`, active Y,
  restricted N, `openadvaccount N`).
* Save (`cb_ok`) created the salary account:
  `_tabmaxkey('accounts') 333 -> 334`,
  `INSERT INTO dbo.accounts (acccode, subcode, name, aliasname, openingdate,
  active, restricted, alertcode) VALUES (334, 24, 'PARITY EMPLOYEE AC ...',
  'PE...', ..., 'Y', 'N', 1)`, then
  `_tabmaxkey('emp_employee') 0 -> 1` and
  `INSERT INTO dbo.emp_employee` with 23 columns, `acccode = 334`.
  The form then wrote its (empty) photo blob:
  `UPDATE dbo.emp_employee SET picture = ...` and closed.
* **Reopen:** the list was refreshed with `ue_list` (one row), then
  `wf_openmywindow(1)` opened the form with code 1 and the saved full name.
* **Edit:** full name and mobile changed; `UPDATE dbo.emp_employee SET
  fullname = $1, mobileno = $2 WHERE empcode = ... AND ...` matched
  (rowcount 1).  The salary account was retrieved, not re-created.
* **Delete:** `w_employee_list` / `w_listview_form` define no `ue_delete`,
  and `m_delete` is disabled; the original employee list has no delete
  action.  Cleanup is by SQL (the probe removed both rows).
* Exact restore: `emp_employee 0 / max 0`, `accounts 257 / max 325`,
  `_tabmaxkey('Accounts') 333`, `_tabmaxkey('EMP_Employee') 0`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-employee-crud.mjs` - measured `ok=true`.

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
* **Set Item Author(s)** was data-blocked by empty `Author`/`ItemAuthor`
  tables; it is now verified with a temporary `Author 1` fixture (see the
  next section).  `ItemAssociation` was also empty, but the association form
  needs no lookup rows and is fully verified above.

### Set Item Author(s) nested form + parent save (verified; original buffer-reset omission)

`Set Item Author(s)` (`m_setitemauthors` → `w_itemauthor_form`) shares
`d_itemauthor` with the parent Item Form's `id_itemauthor` (keys `icode` +
`authorcode`).  `Author` and `ItemAuthor` are empty in both databases, and the
Author master itself is not reachable from the main menu (`m_author` is
created hidden in the generic `m_entry` class), so the probe inserted a
temporary **Author 1** row via SQL and removed it afterwards.

* Added `authorcode 1` through the nested form; the shared row appeared in the
  parent as `(icode 9801, authorcode 1)`.
* Changed item `saleprice` 10 → 11 and saved the Item Form. PostgreSQL wrote
  `itemauthor (9801, 1)`, `item.saleprice = 11.00`, and a new `itemlog` row
  (`max itemrowid 152908`); “Changes take effect in database”.
* **Measured original defect:** immediately after the save the parent
  `id_itemauthor` row still had `getitemstatus = 3` (**new-modified**).
  `w_item_form.ue_save` calls `resetupdate()` on master, detail,
  iteminmodel, itemassociation, alternateitemalias and pricepolicyheader,
  but **not** on `id_itemauthor`.  An in-place delete of the author therefore
  only removed it from the buffer; the DB row stayed.
* **Working delete:** reopened the item through `File | List` → `ue_detail`
  (author row status became **0, not modified**), deleted the author, restored
  `saleprice` to 10, and saved. PostgreSQL removed `itemauthor (9801,1)`,
  set `item.saleprice = 10.00`, and wrote the second item-log row; second
  “Changes take effect in database”.
* Exact restore: `author 0`, `itemauthor 0`, item 9801 back to
  `saleprice 10.00 / retail 5.00 / lastupdate 2026-11-05 10:38:44.342 /
  changereason Multiple Changes / module Purchase Posting / usercode 1 /
  location null` (trigger bypass), `itemlog 98,632 / max 152,907`
  (8 rows for 9801), `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-item-author-save.mjs` — measured `ok=true`.

### Customer Item Categories Association nested form + parent save (verified)

`m_setitemcategories` → `w_custitemcatassociation_form` shares the Customer
Form's hidden `d_custitemcatassociation` (`id_cust_itemcat_association`, keys
`custcode` + `icatcode`).  The Customer Form is `w_customer_form`
(`w_single_entry`); its save chain calls
`id_cust_itemcat_association.update()` with the default reset flag.

The probe created a temporary customer through the verified add flow (code
**334**) and a temporary `ItemCategory` **8** (`PARITY TEMP CAT ...`) via SQL
(the item-category master itself is already verified).

* Added `icatcode 8` through the popup; the shared parent row was
  `(custcode null, icatcode 8)` with status **3** before the save.
* Saved the customer: PostgreSQL wrote `custitemcatassociation (334, 8)`,
  the `accounts`/`customer` rows for code 334, and
  `_tabmaxkey('Accounts') 333 -> 334`; “Changes take effect in database”.
  After the save the association row status was **0** (reset by `update()`
  with the default reset flag).
* Deleted the association row from the parent `id_cust_itemcat_association`
  buffer, changed the customer city `KARACHI -> LAHORE` to force the customer
  update, and saved: `custitemcatassociation` **0**, city **LAHORE**; second
  “Changes take effect in database”.
* **Customer delete remains the original referential guard:** `ue_delete`
  showed “You can not Delete this record Reason: Some information refering to
  this record exists”.  The temporary customer was therefore removed by SQL
  in cleanup (the existing Customer/Supplier probes already document this
  original behaviour).
* Exact restore: `accounts 257 / max 325`, `customer 2 / max 22`,
  `custitemcatassociation 0`, `itemcategory 7` (code 8 removed),
  `_tabmaxkey('Accounts') 333`, `_tabmaxkey('ItemCategory') 9`,
  `audit_log 1,079 / max 1,127`, no residue.

Probe: `tools/parity/probe-custitemcat-crud.mjs` — measured `ok=true`.

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

### Inplace Initialization (verified on a disposable copy) and Import Historical Data (SQL-Server-only)

**Inplace Initialization (measured):**

* `Maintenance | Inplace Initialization` opens the “Select Format” window
  with Normal selected by default; the Inplace radio can be selected.
* The key gate was exercised on the successful run: status code **46810**,
  accepted key **46832** (difference 22, even).  The key window handed off to
  `w_inplace_initialization`, which showed “Transfer Item Stock” and
  “Transfer Acc. Balances” checked by default.
* Confirmation “Your are going to perform a critical Operation … Do you want
  to continue” was answered Yes, and the app showed
  **"Operation has been completed Successfully"** with both transfer options
  enabled.
* **Completed on a disposable copy.** `trader_init_test` (2,044 MB) was
  created from the clone; user triggers were disabled and
  `session_replication_role` set to `replica` on that disposable copy only.
  The reset still contended with the application's idle-in-transaction
  sessions (PostgreSQL keeps their ACCESS SHARE locks), so the harness
  terminated the one remaining blocking session after `sp_init_delete_table`
  started.  Both transfer options were enabled for this run.
* **Before -> after (measured, transfer enabled):**
  `saleledger 588884 -> 0`, `saledetail 1306121 -> 0`,
  `srledger 61604 -> 0`, `srdetail 89595 -> 0`, `prledger 1487 -> 0`,
  `prdetail 5923 -> 0`, `itemlog 98632 -> 0`, `stockledger 1621864 -> 0`;
  stock carried: `godowndetail 6430 rows / 256678 qty -> 6430 rows /
  256678 qty`; one opening purchase created: `purledger 12283 -> 1`,
  `purdetail 196966 -> 6430`; opening vouchers created:
  `glheader 0 -> 3`, `gldetail 0 -> 136`; `virtualgl 2004104 -> 0`;
  `_utn 1628962 -> 6571`, `_tabmaxkey('SaleLedger') 588890 -> 0`,
  `eventlog 2 -> 3` (the new "Inplace Initialization Performed." row);
  `previoussalehistory 94572` unchanged.
* **Caveats (measured):** triggers were disabled and
  `session_replication_role=replica` was set on the disposable copy, and the
  app's idle transaction had to be terminated to release PostgreSQL locks.
  Those are real production considerations (audit-trigger volume and
  idle-in-transaction locks), not missing UI controls.  The no-transfer path
  also completed earlier (all stock/transactions cleared, `_utn` 1).
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
  `godowndetail 6430`, `glheader 0`, `gldetail 0`,
  `virtualgl 2004104`, `previoussalehistory 94572`, `sysjobs 0`,
  `sysjobschedules 0`, `audit_log 1079`.

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

### Modal frame geometry (fixed)

Measured on the paired old crops and freshly captured rebuild dialogs:

| Dialog | Old | New before | New after |
|---|---:|---:|---:|
| Select Format (Sale detail) | 353x340 | 349x331 | **353x340** |
| Select Format (Sale summary) | 417x487 | 413x478 | **417x487** |
| Select Column Criteria | 236x253 | 234x245 | **236x253** |

Client areas now match too: 347x308 / 411x455 / 230x221.  The fix is in
`WinView.syncWindow` (`web/src/ui/dom-ui.ts`): response windows
(`windowtype = 3`, title bar, not a sheet) add the measured **4 px width /
9 px height**, use a **3 px frame**, and centre on integer pixels.  Non-modal
windows and MDI sheets are unchanged.

Row pitch was re-measured on both sides instead of relying on the old note:
Select Format detail **23-24 px**, Sale summary **20 px**, Select Column
Criteria **23 px**.  The earlier generic "26 vs 28 px" did not reproduce on
these pairs.  The focused first radio row now matches as well: text rows are
**60, 83, 106, 129, 152** on both sides after the radio alignment fix below.
Priority Setting columns are measured separately below (no width change; the
old capture had saved user widths and a Find/scroll state).

Probe: `tools/parity/probe-dialog-geometry.mjs`; captures in
`deploy/parity/geometry/`.

### Focused radio-row geometry (fixed)

The remaining 3 px was in the radio rows of **Select Column Criteria**.  The
DOM row boxes were already 23 px apart, but the native radio input's default
`margin-top: 3px` plus the flex `align-items: center` pushed the text/radio ink
3 px below the old rows.

Fix in `web/src/ui/dom-ui.ts` (radiobutton branch only): label content is
top-aligned (`align-items:flex-start`, no padding), the radio input gets
`margin-top:2px` and no native focus ring, and keyboard focus draws the
original **1 px dotted outline on the text span**.

Measured result:

* Old dialog text-row tops: **60, 83, 106, 129, 152**.
* New after fix: **60, 83, 106, 129, 152** (before: 60, 86, 109, 132, 155).
* Dialog size remains **236x253**; old-vs-new pixel difference improved from
  **12.90%** to **12.26%** (pct > 40), with the remaining difference in fonts
  and control chrome.

Priority Setting rows were re-measured in the same pass: the list DOM rows are
**16 px** apart with 16 px row heights, matching the old list; the apparent
first-row difference is the old capture's selected/scrolled state, not a
layout gap.  Recapturing in the current state shows `.` (not `_SetCol`) in the
Item Packing column.

### Priority Setting columns (re-measured; no width change)

Measured at the list header row:

| Boundary | Old x | New x |
|---|---:|---:|
| left edge | 12 | 7 |
| after Alias | 91 | 84 |
| after Item Name | 319 | 312 |
| after Item Packing | 436 | 429 |
| after Stock | 487 | 480 |
| after Active | 527 | 520 |
| after Manufacturer | 751 | 744 |
| after Item Category | 937 | 930 |
| right edge | 1128 | 1122 |

All column widths match except the first (**79 vs 77 px**) and the last
(**191 vs 192 px**); row pitch is **16 px** on both sides.  The old capture’s
14.95% diff came from its saved Find/scroll state
(`Find: ZYTO 500MG TAB`), user-resized columns and native-vs-browser font
rendering — not a missing column rule.  Recapturing with the same Find text
and the same first row gives a **14.57%** pixel diff, so no CSS column-width
change was made (changing it would overfit a saved user layout).

Probe: `tools/parity/probe-priority-geometry.mjs`.

### Groups: edit verified, add is an original defect, delete disabled

**Edit/save (verified on group 12, SALES OFFICER):**

* Opened `Manage | Groups`, `wf_openmywindow(12)`: 1 group row, 464 rights
  rows, **113 checked**.
* Changed both `groupname` and `remarks`, pressed Save -> “Changes take effect
  in database”, form closed.
* SQL trace: `DELETE FROM dbo.grouprights WHERE groupcode = 12` (113 rows),
  `UPDATE dbo.groups ... WHERE groupcode = 12` (1 row), then **113**
  `INSERT INTO dbo.grouprights` rows.  The saved rights set is identical to
  the baseline (`missing 0`, `extra 0`).
* Exact restore: `SALES OFFICER` and empty remarks restored, 113 group-12
  rights reinserted from the snapshot, `grouprights 688`, `groupallowedgodown
  33`, `groupallowedheader 35`, `_tabmaxkey('Groups') 12`,
  `audit_log 1,079 / max 1,127`, scratch table dropped.

**New group (original defect, reproduced in the rebuild):**

* First OK sends `UPDATE _tabmaxkey Groups = 13`, `INSERT INTO dbo.groups`
  code 13, **8** `groupallowedgodown` and **8** `groupallowedheader` rows, and
  fills the hidden rights DataWindow (measured 3 checked rows with
  `groupcode 13`).  The original then **returns without COMMIT** and leaves
  the form open.
* The recovered script calls `parent.id_group.update(true, false)`:
  `resetflag = false` keeps the row flagged as **new**.  The second OK
  therefore runs the `lb_modify` branch and sends a **second**
  `INSERT INTO dbo.groups` for code 13, which fails with
  `duplicate key value violates unique constraint "pk___1__11"` and shows
  “Can not save group level settings … Details: -”.  The first press’s rows
  are still uncommitted.
* The original’s `u_transaction.constructor` sets `autocommit = false`; its
  `ue_close` runs `SQL stop` and the connection string has
  `CommitOnDisconnect='No'`, so closing the form rolls the transaction back.
  New-group creation therefore cannot commit in this original build — this is
  an original defect, not a missing rebuild feature.
* The leftover idle-in-transaction session was terminated; the uncommitted
  rows rolled back and the baseline re-verified (`groups 4`, `rights 688`).

**Delete:** `w_groups.ue_list` sets `im_menu.m_file.m_delete.enabled = false`;
the rebuild measured the same `enabled = false`.  The original has no group
delete workflow of its own.

Probes: `tools/parity/probe-groups-edit.mjs`,
`tools/parity/probe-groups-two-phase.mjs` (and the earlier
`probe-groups-crud.mjs` for the first-press trace).

### Receipt and Issue / Delivery Challan transaction saves (verified; shared department data gap)

Both screens require a **posted and enabled** category.  The clone has one for
each: `ReceiptCategory` 1 `GENERAL` (`AccountFor = N`) and `IssueCategory` 1
`GENERAL` (`AccountFor = N`).  Both also require a salesman password
(`Salesalesmanwindow = Y`); user **1 / ADMIN / password9080** was accepted.

**Receipt** (`Maintenance | Receipt | Receipt`, menu item `m_receiptform`,
visible):

* Master: temporary `deptcode 1`, `recipientcode 2`, `pricetypecode 1`,
  `headerno 1`, `headerinvno 1`, `receiptcategorycode 1`,
  `accountfor N`, `gcode 1`.
* Detail: item **9801 FACE MASK**, batch `.`, expiry `2030-12-31`,
  qty **1**, price **10**; the real `wf_validateitem()` path resolved the
  item and returned success.
* Save showed “Changes take effect in database” and wrote
  `receiptheader` (code **1**, receiptcode **1**, posted **N**,
  salesmancode **1**) and `receiptdetail` (icode **9801**, qty **1**,
  price **10**).  `_tabmaxkey('ReceiptHeader') 0 -> 1`,
  `receiptcategory.counter 0 -> 1`; stock stayed **18035**, `itemlog` and
  `_utn` unchanged.  Exact cleanup restored all of them.

**Issue / Delivery Challan** (`Maintenance | Issue | Issue`, menu item
`m_issue_form`, parent `m_issue` hidden by menu rights):

* Master: temporary `deptcode 1`, `recipientcode 2`, `acccode 2`,
  `areacode 1`, `smancode 1`, `pricetypecode 1`, `headerno 1`,
  `headerinvno 1`, `issuecategorycode 1`, `accountfor N`, `gcode 1`.
* Detail: item **9801**, batch `.`, expiry `2030-12-12`, qty **1**,
  price **10**; `wf_validateitem(true)` and `wf_validategodown()` passed.
* Save showed “Changes take effect in database” and wrote `issueheader`
  (code **1**, issuecode **1**, posted **Y**, salesmancode **1**) and
  `issuedetail` (icode **9801**, qty **1**, price **10**).
  `_tabmaxkey('IssueHeader') 0 -> 1`, `issuecategory.counter 0 -> 1`,
  `_utn 1,628,962 -> 1,628,963`; stock was deducted
  **18035 -> 18034**.  Exact cleanup restored the header/detail rows,
  counters, UTN, the full `godowndetail` row and `item.totalpieces` /
  `lastupdate` (the item-update trigger was disabled only for the restore
  `UPDATE`).

**Shared data gap (measured):** the `department` table has **0 rows in both
the live SQL Server database and the PostgreSQL clone**, while `deptcode` is a
required `ddd_department` field and an FK on both headers.  A real user
therefore cannot complete either save in either app.  A temporary department
row was created in the clone **only** to exercise the save path, then removed.

Probes: `tools/parity/probe-receipt-crud.mjs`,
`tools/parity/probe-issue-crud.mjs`; both measured `ok=true`.

### Priority Setting edit/save (verified)

* Opened `Maintenance | Priority Setting` (`w_itempriority_form`, title
  “Item Priority Form”): list **28,966** items.
* Selected item **9801** (list row 19,728) through the real `ue_detail`
  handler; the detail grid returned **1** batch row for godown 1:
  batch `.`, expiry `2030-12-12`, priority **10**, qty **18,035**.
* Changed `priority` to **11** and pressed Save: “Changes take effect in
  database”; `dbo.godowndetail` now had priority **11**
  (`lastupdated` moved to the save time).
* Restored the full row (priority **10**, original `manfdate` and
  `lastupdated`) with `session_replication_role=replica` so the clone’s
  `trig_godowndetail_afterupdate_lastupdated` trigger could not rewrite the
  timestamp.  `audit_log 1,079 / max 1,127` and `_utn 1,628,962` unchanged.
* Probe: `tools/parity/probe-priority-save.mjs` — measured `ok=true`.

**Patient Death Certificate (data-blocked):** `DeathCertificate` has **0
rows in the live SQL Server database and 0 in the clone**, and the form
requires selecting a patient/death record.  No workflow can be exercised in
either app; this is a shared data gap, not a rebuild defect.

### Receipt and Issue edit/save, and delete (measured)

**Delete is not available in either screen.**  `wf_initmodify` sets
`im_menu.m_file.m_delete.enabled = false` for both, `w_multi_entry.ue_list`
also disables it, and neither window defines a `ue_delete` handler.  The
measured state after reopening a saved record is `deleteEnabled = false`.
Deleting a receipt/issue therefore has no original workflow; cleanup is SQL.

**Receipt edit/save:**

* Created an unposted receipt (code 1) as before, then opened it through
  `ue_list` -> `ue_detail`: 1 list row, `receipt posted = N`, save enabled,
  delete disabled.
* Right **562** (Receipt modify) is **not present in the `rights` catalog**
  (`rights` has 464 rows, max 5289; 562 does not exist in either live or
  clone), so the normal rights gate can never enable edit.  The probe forced
  `ib_receiptmodify = true` to exercise the dormant code path.
* Changed `remarks` and detail `qty 1 -> 2`; Save showed “Changes take effect
  in database” and `receiptheader.remarks` / `receiptdetail.qty` were updated.
* Exact restore: rights 688, department 0, receipt rows 0,
  `_tabmaxkey('ReceiptHeader') 0`, category counter 0, stock 18,035,
  `itemlog 98,632`, `_utn 1,628,962`, `audit 1,079 / max 1,127`.

**Issue / Delivery Challan edit/save:**

* Right **560** (Issue modify) is also absent, and `IssuePosting = Y` makes a
  saved issue posted, which `ue_detail` refuses to edit.  The probe
  temporarily set `IssuePosting = N` and forced `ib_issuemodify = true`,
  created an **unposted** issue (code 1, posted N), then reopened it through
  the list: save enabled, delete disabled, `ib_modify = true`.
* Changed `remarks` and detail `qty 1 -> 2`; Save showed “Changes take effect
  in database”; the header/details were updated, stock moved
  18,035 -> 18,034 (add) -> **18,033** (edit), and `_utn` advanced by 2.
* Exact restore: `IssuePosting` back to **Y**, department 0, issue rows 0,
  `_tabmaxkey('IssueHeader') 0`, category counter 0, `_utn 1,628,962`,
  the full `godowndetail` row 18,035 and `item` pieces/lastupdate unchanged,
  `audit 1,079 / max 1,127`.

Probes: `tools/parity/probe-receipt-edit.mjs`,
`tools/parity/probe-issue-edit.mjs` (both `ok=true`).

### Godown master add/edit/delete (verified)

`Basic Data | Godown` (`m_godown`, hidden by the rights/menu state) opens
`w_godown_form` (`w_single_entry`, title “Godown Form”).  The detail
DataWindow is `d_godown_detail1` updating `dbo.godown`; columns: `code`,
`name`, `location`, `godowngroupcode`, `autosatisfydue`,
`considerstockinpo`, `localgodownname`.

* **Add:** set all editable fields, `File | Save` -> “Changes take effect in
  database”; `godown` row code **2** written and `_tabmaxkey('godown')
  1 -> 2`.
* **Edit:** changed `name` and `location`, saved -> row updated, second
  “Changes take effect in database”.
* **Delete:** the `m_delete` menu was measured **disabled** on the new/edit
  form; the window's `ue_delete` (right **579**, present in group 2) showed
  “Delete this record permanently from Database?” and then “Record Deleted
  Successfully”; the row was gone.  (`w_single_entry.ue_detail` enables
  `m_delete` when right 579 is present in list mode; the probe invokes the
  same window event directly.)
* Exact restore: `godown 1` row (`GODOWN1`), `_tabmaxkey('godown') 1`,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-godown-crud.mjs` — measured `ok=true`.

### Area master add/edit/delete (verified)

`Basic Data | Customer .......... | Area` (command `m_area0`, hidden by the
rights/menu state) opens `w_area_form` (`w_single_entry`, title “Area Form”).
The detail DataWindow is `d_area_detail` updating `dbo.area`; fields:
`code`, `name`, `manager`, `regioncode`, `shortname`, `shortname1`,
`shortname2`, `tag`.  Required: `manager`, `regioncode`, `tag`, `name`; the
table also has unique `name` and `shortname`.

* **Add:** set all fields (`regioncode 1`, `tag Y`, unique name/shortname),
  Save -> “Changes take effect in database”; row code **2** written and
  `_tabmaxkey('Area') 1 -> 2`.
* **Edit:** changed `name`, `manager` and `shortname`, saved -> row updated,
  second “Changes take effect in database”.
* **Delete:** `ue_delete` (right **579**) showed the confirmation and
  “Record Deleted Successfully”; the row was gone.  The `m_delete` menu was
  measured disabled on the new/edit form; `w_single_entry.ue_detail` enables
  it in list mode when right 579 is present.
* Exact restore: `area` 1 row (`DEFAULT AREA`), `_tabmaxkey('Area') 1`,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-area-crud.mjs` - measured `ok=true`.

**Inventory note:** `w_godowngroup_form` (the `GodownGroup` master) has no
recovered menu handler or `opensheet` reference; it is an orphaned window,
not a reachable page.  The real Area command is `m_area0`.

### Region, Sub Area, Sales Person, Item Packing (verified) and Price Type (no master form)

All four were driven through the real menu command and `w_single_entry`
(`File | Save`, then `ue_delete` with right 579 and its confirmation); each
measured `ok=true` with exact table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit | Delete |
|---|---|---:|---|---|---|
| Region | `m_region0` | 1 / 1 | code 2, tab 1→2 | name/manager/remarks | “Record Deleted Successfully” |
| Sub Area | `m_subarea` | 1 / 1 | code 2, tab 1→2 | name/manager/distance | same |
| Sales Person | `m_salesperson` | 1 / 1 | code 2, tab 1→2 | name/address/phone | same |
| Item Packing | `m_itempacking0` | 1 / 1 | code 2, tab 1→2 | name (char(20))/factor | same |

Item Packing’s first edit test used a 21-character test name and the
`char(20)` column truncated it; the rerun used a 20-character name and the
edit passed.  No production rows were changed.

**Price Type (not a reachable master):** there is no `w_pricetype` /
`w_pricetype_form` window in the recovered object set; the only Price Type
windows are report argument dialogs (`w_arg_*pricetype*`).  The
`pricetype` table has 8 rows but no screen to add/edit/delete them.

**Zone (verified with temporary ContactGroup fixtures):** `w_zone` saves
only when both `ZoneAreas.update()` and `ZoneContactGroup.update()` return
> 0. `ContactGroup` has **0 rows in the live SQL Server DB and 0 in the
clone**, so the probe inserted temporary `ContactGroup` 1/2 rows, added a
zone with one area + one contact group, edited both, and removed every
fixture.  `File | Delete` becomes enabled after `ue_detail`, but neither
`w_zone` nor its ancestors define a `ue_delete` handler, so delete is inert;
cleanup is SQL.

Probe: `tools/parity/probe-single-master.mjs <region|subarea|salesman|itempacking>`
— all four measured `ok=true`.

### Item Size, Unit, Item Style, Item Colour (verified)

All four are `w_single_entry` forms driven through their real menu commands;
each measured `ok=true` with add, edit, `ue_delete` confirmation and exact
table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit |
|---|---|---:|---|---|
| Item Size | `m_5` | 1 / 1 | code 2, tab 1→2 | name + description |
| Unit | `m_unit` | 1 / 1 | code 2, tab 1→2 | name + description |
| Item Style | `m_itemstyle` | 2 / 2 | code 3, tab 2→3 | name + description |
| Item Colour | `m_itemcolour` | 2 / 2 | code 3, tab 2→3 | name + description |

Delete in every case showed “Delete this record permanently from Database?”
then “Record Deleted Successfully”; final counters were
`ItemSize 1`, `Unit 1`, `ItemStyle 2`, `ItemColour 2`, and
`audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-single-master.mjs <itemsize|unit|itemstyle|itemcolour>`
— all four measured `ok=true`.

### Item Sleeve, Item Yarn, Item Fabric, Item Brand (verified)

All four are `w_single_entry` forms driven through their real menu commands;
each measured `ok=true` with add, edit, `ue_delete` confirmation and exact
table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit |
|---|---|---:|---|---|
| Item Sleeve | `m_itemsleeve` | 1 / 1 | code 2, tab 1→2 | name + description |
| Item Yarn | `m_itemyarn` | 1 / 1 | code 2, tab 1→2 | name + description |
| Item Fabric | `m_itemfabric` | 1 / 1 | code 2, tab 1→2 | name + description |
| Item Brand | `m_itembrand` | 1 / 1 | code 2, tab 1→2 | name + description |

Delete in every case showed the confirmation then “Record Deleted
Successfully”; final counters were `ItemSleeve 1`, `ItemYarn 1`,
`ItemFabric 1`, `ItemBrand 1`, and `audit_log 1,079 / max 1,127`.

**Section:** covered by its own full cycle below; its `deptcode` FK needs a
department, and `Department` is empty in both databases, so it remains a
shared data gap for normal users.

Probe: `tools/parity/probe-single-master.mjs <itemsleeve|itemyarn|itemfabric|itembrand>`
— all four measured `ok=true`.

### Sale Type, Purchase Type, Issue Type (verified)

All three are `w_single_entry` forms driven through their real menu commands;
each measured `ok=true` with add, edit, `ue_delete` confirmation and exact
table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit | Delete |
|---|---|---:|---|---|---|
| Sale Type | `m_saletype` | 2 / 2 | code 3, tab 2→3 | name + description | “Record Deleted Successfully” |
| Purchase Type | `m_purchasetype` | 0 / 0 | code 1, tab 0→1 | name | same |
| Issue Type | `m_issuetype` | 0 / 0 | code 1, tab 0→1 | name | same |

Final counters: `SaleType 2`, `PurchaseType 0`, `IssueType 0`,
`audit_log 1,079 / max 1,127`.

**Inventory note:** **Item Design** (`w_itemdesign_form`) is an orphaned
window — no recovered menu handler or `opensheet` reference.  **Item Type**
has no master window at all; the `itemtype` table is not exposed through a
form.  The reachable type masters are the generic/manufacturer/sale/purchase/
issue types above.

Probe: `tools/parity/probe-single-master.mjs <saletype|purchasetype|issuetype>`
— all three measured `ok=true`.

### Ward, Relation, Rank, Disease (verified)

All four are `w_single_entry` forms driven through their real menu commands;
each measured `ok=true` with add, edit, `ue_delete` confirmation and exact
table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit |
|---|---|---:|---|---|
| Ward | `m_patientward` | 0 / 0 | code 1, tab 0→1 | name + description |
| Relation | `m_relation` | 1 / 1 | code 2, tab 1→2 | name + description |
| Rank | `m_rank` | 1 / 1 | code 2, tab 1→2 | name + description |
| Disease | `m_disease` | 1 / 1 | code 2, tab 1→2 | name + description, `diseasetypecode 1` |

Delete in every case showed the confirmation then “Record Deleted
Successfully”; final counters were `Ward 0`, `Relation 1`, `Rank 1`,
`Disease 1`, and `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-single-master.mjs <ward|relation|rank|disease>`
— all four measured `ok=true`.

### Patient Location (verified with a temporary Ward)

`m_patientlocation` opens `w_patientlocation_form` (`w_single_entry`); the
detail DataWindow updates `PatientLocation` with `code`, `name`, `wardcode`,
`description`; `wardcode` is required and is an FK to `ward`.

Because `ward` is empty in both databases, the probe inserted a temporary
`Ward 1` (`PARITY TEMP WARD`) for the test and removed it in a `finally`
block.

* **Add:** Patient Location code **1**, `_tabmaxkey('PatientLocation') 0 -> 1`;
  Save showed “Changes take effect in database”.
* **Edit:** name + description updated and saved.
* **Delete:** confirmation then “Record Deleted Successfully”.
* Exact restore: `patientlocation 0`, `_tabmaxkey('PatientLocation') 0`,
  temporary `ward` removed and `_tabmaxkey('Ward') 0`,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-single-master.mjs patientlocation` (with the
temporary Ward fixture) — measured `ok=true`.

### Diagnostic Item Type, Symptom Type, Visit Type (verified)

All three are `w_single_entry` forms driven through their real menu commands;
each measured `ok=true` with add, edit, `ue_delete` confirmation and exact
table/tabmax/audit restore.

| Master | Menu | Rows (before/after) | Add | Edit |
|---|---|---:|---|---|
| Diagnostic Item Type | `m_diagnosticitemtype` | 4 / 4 | code 5, tab 4→5 | name |
| Symptom Type | `m_symptomtype` | 4 / 4 | code 5, tab 4→5 | name |
| Visit Type | `m_visittype` | 8 / 8 | code 9, tab 8→9 | name |

Delete in every case showed the confirmation then “Record Deleted
Successfully”; final counters were `DiagnosticItemType 4`, `SymptomType 4`,
`VisitType 8`, and `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-single-master.mjs <diagnosticitemtype|symptomtype|visittype>`
— all three measured `ok=true`.

### Department and Section (verified)

**Department** (`m_department` → `w_department`, `w_single_entry`) is a clean
0-row master: add code **1**, `_tabmaxkey('department') 0 -> 1`; edit
name/description/active; delete with confirmation.  Exact restore:
`department 0`, tab 0, `audit_log 1,079 / max 1,127` — measured `ok=true`.

**Section** (`m_section` → `w_section_form`, `w_single_entry`) requires
`deptcode`, and `Department` is empty in both databases.  The probe inserted
a temporary `Department 1` for the test, then ran add (code **1**,
`_tabmaxkey('Section') 0 -> 1`), edit and delete; the temporary department was
removed in a `finally` block.  Exact restore: `section 0`, tab 0,
`department 0`, tab 0, audit 1,079 / 1,127 — measured `ok=true`.

Probes: `tools/parity/probe-single-master.mjs department` and
`... section` (with the temporary department fixture).

### Zone (verified with temporary ContactGroup fixtures)

`m_zone0` opens `w_zone` (`w_multi_entry`).  Saving requires
`ZoneAreas.update() > 0` **and** `ZoneContactGroup.update() > 0`, but
`ContactGroup` is empty in both databases.  The probe inserted temporary
`ContactGroup` 1/2 rows, then:

* **Add:** Zone code **1**, one `ZoneAreas` row (area 1) and one
  `ZoneContactGroup` row (group 1), `_tabmaxkey('Zone') 0 -> 1`; Save showed
  “Changes take effect in database”.
* **Edit:** changed name + remarks, re-saved the area row (rowid) and changed
  the contact group to 2; second save message; `ZoneContactGroup` became
  `(1,2)`.
* **Delete state:** `m_delete` is disabled before detail, but `ue_detail`
  enables it.  Neither `w_zone` nor its ancestors define a `ue_delete`
  handler, so the menu item is inert; cleanup is SQL (as in the probe).
* Exact restore: `zone 0`, `zoneareas 0`, `zonecontactgroup 0`,
  `contactgroup 0`, `_tabmaxkey('Zone') 0`, `ContactGroup 0`,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-zone-crud.mjs` — measured `ok=true` for add/edit
and exact restore; delete is the original inert-menu behavior.

### Sale Order (add/edit/delete/save verified with temporary rights)

`m_saleorder` → `w_salesorder` (`w_multi_entry`).  `SaleOrderCategory` 1 is
posted; header/detail were empty.

* **Add:** customer 22 (credit walking), item 9801, qty 1, price 10.  Save
  wrote `saleorderheader` code **1** (posted N, finalized N, deleted N) and
  `saleorderdetail` (item 9801, qty 1, price 10);
  `_tabmaxkey('SaleOrderHeader') 0 -> 1`,
  `saleordercategory.counter 0 -> 1`; “Changes take effect in database”.
* **Edit:** reopened via `ue_list -> ue_detail`, changed remarks and detail
  qty 1 -> 2, set the cell-edit flag (direct `setitem` does not fire the
  normal `itemchanged`), saved: header remarks updated, `modifycounter 1`,
  detail qty 2.
* **Delete:** rights **572/573 do not exist** in this deployment's `rights`
  catalog, so `ue_deleteinvoice` normally rejects with “Not enough rights to
  delete Sales Order”.  The probe inserted temporary rights 572/573 with
  `object = 'W'` (the `d_security` query filters on that object level) plus
  group-2 grants, reopened the list, selected the row and called
  `ue_deleteinvoice`: password accepted, confirmation accepted, and the header
  was soft-deleted (`deleted = 'Y'`) with “Sale Order Successfully Deleted”.
  The temporary rights and grants were then removed.
* **Save quirk (measured):** the deployed `SaleOnZeroPrice = N` hits an
  unconditional `return` in `w_salesorder.ue_save` after the zero-price check,
  so no sale order can be saved with that preference.  The probe temporarily
  set it to `Y`, then restored it to **N**.
* Exact restore: sale-order header/detail 0, tab 0, category counter 0,
  stock 18,035, `itemlog 98,632`, `_utn 1,628,962`,
  `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-saleorder-crud.mjs` — add/edit/delete/restore
`ok=true`.

### Model master (verified)

`m_model` → `w_model_form` (`w_single_entry`); the detail DataWindow updates
`Model` with `code`, `name`, `description`.

* **Add:** code **1**, `_tabmaxkey('Model') 0 -> 1`; “Changes take effect in
  database”.
* **Edit:** name + description updated and saved.
* **Delete:** confirmation then “Record Deleted Successfully”.
* Exact restore: `model 0`, `_tabmaxkey('Model') 0`,
  `audit_log 1,079 / max 1,127`.

This removes the `Model` lookup data gap; the nested **Set Models** item form
is verified in its own cycle below.

Probe: `tools/parity/probe-single-master.mjs model` — measured `ok=true`.

### Set Models nested feature (verified)

The Item Form menu command `m_selectmodels` opens `w_iteminmodel_form`
(shared header DataWindow `d_iteminmodel`, keys `icode` + `modelcode`).  A
temporary `Model` row (code 1, “PARITY TEMP MODEL”) was inserted because the
`Model` table is empty in both databases.

On item **9801**:

* Opened the popup, added `modelcode 1`, closed it; the parent
  `id_iteminmodel` showed `(9801, 1)`.
* Changed item `saleprice 10 -> 11` to force an item log, then saved the
  parent Item form: `iteminmodel (9801,1)` written and a new `itemlog` row
  created (`max itemrowid 152908`); “Changes take effect in database”.
* Deleted the model row from the parent grid, restored `saleprice 10`, saved
  again: `iteminmodel` row removed; second save message.
* Exact restore: `iteminmodel 0`, temporary `model` row removed (`model 0`),
  item 9801 fields (`saleprice 10`, original `lastupdate` with the trigger
  disabled), `itemlog 98,632 / max 152,907`, `audit_log 1,079 / max 1,127`.

Probe: `tools/parity/probe-item-model-save.mjs` - measured `ok=true`.

### Item Part multi-entry add/edit/detail-delete (verified)

`m_itempart` opens `w_item_part_form` (`w_multi_entry`, “Item Parts Form”).
The master DataWindow `d_item_part` updates `ItemPart`; the detail
`d_itempartinmodel` updates `ItemPartInModel` (keys `code` + `modelcode`).
`Model` is empty in both databases, so the probe inserted temporary Model 1/2
rows and removed them in a `finally` block.

* **Add:** set every editable master field (`name`, `description`,
  `application`, `remarks`, `icatcode 1`, `iccode 1`, `manfcode 1`,
  `gcode 1`, `purprice 0`, `saleprice 0`, `reorderlevel 0`, `minlevel 0`,
  `maxlevel 0`, `qtyused 0`) plus detail `modelcode 1`. Save wrote
  `itempart` code **2** and `itempartinmodel (2,1)`;
  `_tabmaxkey('ItemPart') 1 -> 2`; “Changes take effect in database”.
* **Edit (reopen path):** `File | List` -> `ue_list` -> select the row ->
  `ue_detail`. The detail retrieve reset the buffer
  (`getitemstatus = 0` = not modified), the row read back as `(2,10,1)`.
  Added `modelcode 2`, changed name/remarks, saved: master updated and
  `itempartinmodel` became `(2,1)` + `(2,2)`.
* **Detail delete:** reopened again (both detail rows status 0), deleted both
  rows and saved: `itempartinmodel` **0**, master row still present.
* **Header delete:** `m_delete.enabled = false` and the window has no
  `ue_delete` handler, so header delete has no original workflow; cleanup is
  SQL (as in the probe).
* **Measured original defect (same pattern as Groups):** `ue_save` calls
  `id_detail.update(true, false)` but only `id_master.resetupdate()`.  A second
  save in the same un-reopened buffer therefore sent
  `INSERT dbo.itempartinmodel (2,1)` again and failed with
  `duplicate key value violates unique constraint "pk_itempartinmodel"`; the
  detail update returned <= 0, so the master UPDATE rolled back and the name
  stayed unchanged.  Reopening through `ue_detail`/`retrieve` resets both
  buffers and the edit works.  This is the original code’s behavior, not a
  rebuild gap.
* Exact restore: `itempart 1` (`DEFAULT`), `itempartinmodel 0`, `model 0`,
  `_tabmaxkey('ItemPart') 1`, `Model 0`,
  `audit_log 1,079 / max 1,127`, no residue, no open transactions.

Probe: `tools/parity/probe-itempart-crud.mjs` - measured `ok=true`.

### Item Part masteripartcode / cascade branch (measured; original no-commit defect)

Created two temporary parts through the real form: parent **A** (code 2, no
master) and child **B** (code 3, `masteripartcode = 2`).  Reopened **A**
through `ue_detail` and set `masteripartcode = 1` (DEFAULT is top-level, so
`wf_validate_masterpartno(1) = 0`), then saved.

* The original showed **“This Part No. is already master to 1 Item Part(s),
  Cascading Update Now”**.
* SQL trace: `UPDATE dbo.itempart SET masteripartcode = $1 WHERE
  (masteripartcode = $2)` with params `[1,2]`, **rowcount 1**.
* The cascade branch then **returns without COMMIT**.  A separate psql
  connection (before ending the transaction) still saw A `masteripartcode`
  NULL and B `masteripartcode` **2**.
* After ending the remaining idle session (`xact = 0`), A was still NULL and
  B was still **2**: the cascade UPDATE rolled back
  (`cascadeCommitted = false`).  This is the original code’s behavior —
  `u_transaction` has `autocommit = false`, `CommitOnDisconnect = 'No'`, and
  `w_multi_entry.wf_disconnect` runs `SQL stop`.
* The branch also returns before the master `UPDATE`, so the current part’s
  own `masteripartcode` change is discarded; only the children were targeted.
* Exact restore: `itempart 1` (`DEFAULT`), `itempartinmodel 0`, `model 0`,
  `_tabmaxkey('ItemPart') 1`, `Model 0`,
  `audit_log 1,079 / max 1,127`, residue 0, open transactions 0.

Probe: `tools/parity/probe-itempart-cascade.mjs` — measured `ok=true`.

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
  **16/16 forms** (51 fields) plus **Godown**, **Area**, **Region**,
  **Sub Area**, **Sales Person**, **Item Packing**, **Item Size**, **Unit**,
  **Item Style**, **Item Colour**, **Item Sleeve**, **Item Yarn**,
  **Item Fabric**, **Item Brand**, **Sale Type**, **Purchase Type**,
  **Issue Type**, **Ward**, **Relation**, **Rank**, **Disease**,
  **Patient Location**, **Diagnostic Item Type**, **Symptom Type**,
  **Visit Type**, **Department**, **Section**, **Zone** and **Model**
  add/edit/delete and
  **Sale Template header+detail**
  add/edit/save verified (File | Delete is original enabled-but-inert);
  committed transaction CRUD
  verified for quotation, purchase order, refused sale, adjustments, cashier
  job, groups, **Item Part** (master + model detail; `masteripartcode`
  cascade measured as an original no-commit branch), update-item-basic-data,
  standalone **Price Policy** slab add/edit/delete, **Supplier** master +
  manufacturer detail add/edit/detail-delete, **Item Basic Data** new-item
  add (temporary model/author/part fixtures; edit path original early-return
  defect), **Sale Promotion** add/edit/delete (temporary customer-group
  fixtures), compound reorder qty,
  credit/cash sale,
  change-items-price, supplier-wise-item-settings (add/edit/delete),
  purchase-return add/save, opening-purchase and loose-purchase
  add/edit/save, **Receipt** and **Issue / Delivery Challan**
  add/save (temporary department; exact stock/counter restore) and
  **edit/save** (unposted; modify rights 562/560 absent, dormant path
  exercised with the window flag), **Sale Order** add/edit/soft-delete/save
  (delete exercised with temporary rights 572/573 that are absent from the
  catalog), Item Form parent saves with nested
  price-policy/alias, association, author, image, model, customer item-category
  association and RichText notes
  rows, group-wise godown/header
  settings, Change Item Discount (category wise, 29 items), Job Schedule
  (PG scheduler; original screen broken in this deployment), users add/edit,
  Priority Setting batch-priority edit/save (item 9801, 10 -> 11, restored),
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
    Receipt and Issue add/save and edit/save are now verified (edit required
    forcing the modify flag because right codes 562/560 are absent from both
    databases).  **Delete is hard-disabled** in both screens
    (`m_delete.enabled = false`, no `ue_delete` handler), so they still need a
    `department` row that does not exist in live or clone (shared data gap,
    above).  **Sale Order** add/edit/soft-delete/save are verified; its delete
    was exercised with temporary rights 572/573 (absent from the catalog),
    and the deployed `SaleOnZeroPrice = N` makes `ue_save` return before
    writing (temporarily set to Y for the cycle).  **Patient
    Admission/Transfer** are data-blocked: `Patient` has 0 rows in both
    databases.
  * Nested forms: **Set Item Price Policy**, **Set Alternate Item Alias
    Names**, **Set Item Associations**, **Set Item Image(s)**, **Set Item
    Notes**, **Set Models** and **Set Item Author(s)** now have verified
    add + parent-save cycles (the image delete-all path is an original
    early-return limitation, above; the author buffer is not reset by the
    original save, so its delete path requires reopening the item).  The
    **Customer Item Categories Association** is now verified with temporary
    customer/category fixtures (above).  **Patient Death Certificate** is
    data-blocked too (`DeathCertificate` 0 rows in both databases).
  * ~~**Change Item Discount** would bulk-update a whole category~~ -
    resolved: category-wise update of all 29 active category-6 items plus 29
    itemlog rows verified and fully restored.
  * ~~**Group Wise Header Setting** probe hung~~ — resolved: opened directly
    with the group parameter and completed a remove/restore save cycle
    (35-row snapshot identical).
  * **Inplace Initialization**: both paths completed on disposable copies
    (success message; transactions cleared; no-transfer: `_utn` 1; transfer:
    stock carried, opening purchase `purledger 1 / purdetail 6430`, opening
    vouchers `glheader 3 / gldetail 136`).  Production still needs a longer
    budget and handling for audit-trigger volume and idle-in-transaction
    locks.
  * **Import Historical Data**: SQL-Server cross-database only (source
    database qualifiers/`CONVERT`); no PostgreSQL equivalent or source
    database exists, so it was not run.
  * Visual: Priority Setting's remaining difference is capture-state/font
    rendering (column widths match within 2 px; old capture had a
    `Find: ZYTO 500MG TAB` state and saved user widths; row pitch is 16 px on
    both sides).  The Select Column Criteria focused-radio gap is fixed
    (text rows 60/83/106/129/152 on both sides).  Modal frames match
    353x340 / 417x487 / 236x253.
  * 067/068 final reports remain unpaired by original-side limits.
  * Sale Template and Customer/Supplier deletes are confirmed original
    behaviours, not rebuild gaps.
  * Groups **new-group creation is an original defect**: the first Save leaves
    the row flagged as new (`update(true, false)`) and uncommitted; the second
    Save re-inserts and hits the primary key.  Groups **edit/save works** and
    is verified; the list's File | Delete is disabled in the original.
    **Item Part has the same master-only reset pattern**: its `ue_save` calls
    `id_detail.update(true, false)` but only `id_master.resetupdate()`, so a
    second save without reopening re-inserts the detail row and hits
    `pk_itempartinmodel`; reopening via `ue_detail` resets the detail and the
    edit/detail-delete cycle passes (measured above).  Its
    **`masteripartcode` cascade branch also returns without COMMIT**: the
    children UPDATE is measured (`rowcount 1`) but rolls back on close
    (`probe-itempart-cascade.mjs`).
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






