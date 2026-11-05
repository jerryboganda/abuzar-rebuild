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






