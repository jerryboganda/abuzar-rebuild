# Parity run 2026-11-05 — screen and field coverage

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
| DataWindow expression parse sweep | — | every `expression` parses; SQL comments stripped | `tools/parity/dw-expr-audit.mjs` |

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
  drag/drop, label edit, sort, …) is fired by the DOM/native layer.  The only
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
* **Report dialog captions:** the first 67 report dialogs that both sides
  captured were compared by visible caption text: **0 old captions missing**
  in the rebuild.  The rebuild capture contains 585 extra strings because it
  also captured the later stage dialogs (`Specify Retrieval Arguments`,
  `Preparing your report to display`, the final report) that the old crawl did
  not advance to.  This is a caption-level check, not a pixel check.
* **Original report defect found:** the old crawl stopped at item 68
  (`Reports | Sales Reports | Customer Sales | Customer NTN Wise Sales Tax
  Report`) with `NOFRAME`: the original process closed itself on that report.
  It is recorded as an original defect, not a rebuild failure.
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

