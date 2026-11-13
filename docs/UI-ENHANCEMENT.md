# Classic and Modern presentation work

The approved direction is one application with shared business rules and two
presentation modes. Modern will be the default for users without a preference;
Classic remains available. A mode change applies at the next sign-in.
See `../PRODUCT.md` for the confirmed scope and constraints.

## Execution policy (2026-11-08)

Follow `AGENTS.md`, **Project execution policy**: complete the agreed code
scope before one consolidated final browser pass; do not run focused or full
browser checks per slice. Write fixtures during implementation and retain
non-browser correctness checks. Fix findings after the final pass, but do not
claim browser re-verification of those fixes or run another browser pass
without explicit authorization. Use recommended defaults for routine choices
and save consequential assumptions rather than repeatedly prompting the user.
Required approvals remain mandatory. This policy supersedes older execution
instructions below; acceptance requirements and historical evidence are unchanged.

## Current state

**Source-derived Modern layouts now cover most windows; nothing new is browser-verified, and the enhancement remains incomplete and unreleased.**
Measured from the working tree by `tools/parity/ui_completion_audit.mjs` (see
`ui-completion-audit.md`, re-measured 2026-11-11 after the source-layout work
below): 2,062 of 2,062 inventoried windows (100%) have a Modern layout. 183 are
hand-reviewed (9 workspace/tool, 55 criteria, 4 calculator, 2 calendar and 113
entry windows), plus 2 shell surfaces. 1,877 are generated from the recovered definitions by
`web/tools/derive-*.ts`: 1,628 dialog and sheet windows and 249 entry masters (a
print/report or artwork-only DataWindow inside a window keeps its original
element in the Modern frame; a report's own design is redesigned separately).
The two staggered-row criteria dialogs `w_arg_cust_sdate_ldate_v13` and
`w_arg_customers_sdate_ldate_v7` now use source-proportional placement; no
window keeps the labelled Classic layout. The missing/recovered cases:
`w_dashboard`'s top-10 graph is mapped by alias to the recovered
`d_dashboard_top10sellingitems` and embedded, the `w_populate_*` master/detail/footer
DataWindows are runtime-assigned and embedded, `w_delete_due`'s unrecoverable
`d_deletedue_detail` keeps its original Classic element, and the MDI frame and
background `w_main`/`w_bkg` use shell surfaces without dialog reflow. For DataWindows, 6,373 of
8,740 (72.9%) have a validated surface: 302 reviewed and 6,071 generated only
(overlaps counted once), with **no compatibility fallbacks left**
(grids may carry per-row button columns, multiline fields and report headers). A generated screen
catalog (`web/tools/derive-screen-data-surfaces.ts`) covers 45 entry-hosted
on-screen DataWindows without a contextual mapping. Grouped-band support derives
the grouped on-screen/report surfaces, while grouped print/report documents stay
excluded from on-screen generation. On-screen coverage is now 3,194 of 3,194
(100%), all as validated surfaces. Print, PDF and report layouts are
exempt from structural parity (decision 16): 5,546 DataWindows are
evidence-classified that way.
Before the report-header work the same tool measured 2,037 windows, 3,294
DataWindows and 3,031 of 3,194 on-screen DataWindows; the rise is the newly
derived report headers, not reviewed screen acceptance. Generated mappings are
validated against the source and re-validated at runtime, but they are **not
individually reviewed and have no browser evidence**. A tableblob column is a
read-only image field (`kind: 'image'`): stored PNG/JPEG/GIF/BMP bytes render as
an image and an empty blob keeps the source-labelled placeholder area. A grid's
header-band computes and columns, and a background-layer text/compute in the
report heading, are a report header above the table, arranged from their source
geometry; a header text hidden under a later opaque object is accounted for and
not painted. A grid field whose caption is painted in the detail band keeps that
caption inside its row, alongside header-captioned columns. A form button below
the last field of a groupbox is placed at that group's trailing edge. A
non-visual `timing` control stays in the runtime with a hidden element and no
presentation content. A window-level `graph` control remains embedded as its
original runtime element. Staggered rows keep their source row-sharing through
the grid planner's row-track spans; the former blanket refusal is replaced by a
row-relation regression test. A recovered DataWindow whose exported name differs
from the window reference is resolved through `DATAWINDOW_ALIASES`; a DataWindow
whose object the window script assigns at run time, or whose definition is
unrecoverable, keeps its original element. `w_main`/`w_bkg` are shell surfaces,
not reflowed dialogs. Entry-hosted on-screen DataWindows with no contextual
mapping are collected in the generated `DERIVED_SCREEN_DATA_SURFACES` catalog
(45 surfaces here); print/report candidates stay excluded. Grouped DataWindows
are grids: a detail-only grouped printout maps its expression text as captions,
while real group header/trailer fields and totals become band entries. Grouped
DataWindows classified as print/report documents stay out of the on-screen
catalogue. A form's visible bitmap objects are painted artwork at their source
geometry (the image-file holder keeps the original renderer, so a runtime
`Filename` change is live), and a checkbox whose source `on`/`off` values are
identical is a read-only fixed indicator instead of an editable choice. A
group-header checkbox column is an interactive band field: toggling commits its
source on/off value through the same ItemChanged path as a grid cell. The Graph
(OLE, processing 6) presentation keeps its original embedded object in a Modern
form, and the RichText (processing 7) presentation maps its recovered input field
to a multiline form field; the exporter's lost object name is restored from the
single table column. The browser structure gate found staggered-row and compact
card/footer forms whose row-sharing the planner did not reproduce. All 20 are
now Modern layouts: the twelve compact card/footer/SMS surfaces pass after
fields spanning several tracks fill them while single-track fields size to their
content, and the six staggered footers plus the two criteria dialogs use a
source-proportional placement mode (`sourceLayout: true`) that copies each
field's source box scaled to the container so overlapping source rows survive.
Two of the original eight staggered DataWindows (`d_mr_pc`,
`d_patientvisit_obs_us`) already passed after fields stopped stretching to their
row tracks and ungrouped fields stayed direct form children. The generated
compatibility catalog (`DERIVED_COMPATIBILITY_DATA_SURFACES`) is empty and no
window keeps the labelled Classic layout. The replaced surfaces and windows are
listed with their evidence in `ui-compatibility-acceptance.md`; none is accepted
as a complete Modern screen yet.
Verified complete Modern screens and accepted workflows remain zero.

Non-browser checks on this tree: 938 frontend tests, strict presentation types,
nine static-inventory tests and an 82-module static build all pass. The
consolidated browser pass on the 18-surface tree completed with **61,823
assertions, 1,881 appearances, 0 failures, 0 errors, 0 page errors and 0
forbidden requests**; the structure gate reported 0 failures. The dialog-final
tree passes the focused dialog gate (24 assertions, 0 failures). Its consolidated
rerun reached 61,847 in-page assertions with 0 structure failures and then
stopped in the 320 px dialog appearance capture on input contrast; the contrast
fix is in the tree. The latest full reruns stopped on five focus checks in
`checkWindowSurfaces` (browser environment focus, not a structure failure), so a
clean consolidated result for the dialog-final tree is not recorded. The
12,819-assertion regression listed below belongs
to commit `0571876b` and says nothing about the generated families or the
fixes made since. Mapping counts are not a completion percentage; no aggregate
percentage is defined.

### Generated layouts (current tree, 2026-11-10)

Generators read `data/src` only and write checked-in TypeScript plus a backlog
that names every item left on the Classic layout and the reason:

| Generator | Output | Result |
|---|---|---|
| `derive-data-surfaces.ts` | `derived-data-surfaces.ts`, `ui-derived-surfaces-backlog.json` | 5,366 global DataWindow surfaces; 369 pending (101 background computes, 70 processing style 3, 59 size 5, 31 style 4, 25 background text, 24 header computes, 17 summary reports, 10 header text, 9 header reports and the rest smaller causes) |
| `derive-entry-windows.ts` | `derived-entry-windows.ts`, `ui-derived-windows-backlog.json` | 249 derived entry masters; 0 pending |
| `derive-modal-windows.ts` | `derived-modal-windows.ts`, `ui-derived-modal-windows-backlog.json` | 1,628 of 1,628 non-reviewed dialog and sheet windows; 0 pending |

`tests/derived-surfaces.test.ts` checks that each generated file matches a fresh
run, that every surface passes `dataSurfaceIssues` and `windowSurfaceIssues`
against the real runtime tree, and that the generators **reproduce the
reviewed mappings they can derive**: every comparable reviewed DataWindow
surface, all 55 reviewed criteria layouts (hidden inherited captions included)
and every reviewed entry control tree and detail order.
`tests/derived-parity.test.ts` checks every generated surface and window against
the source-position validators (`dataSurfacePositionIssues`,
`windowSurfacePositionIssues`) and pins each defect of the 2026-11-09 parity
review on its real definition.

### Parity review fixes (2026-11-09)

A review of the generators against the recovered definitions found captions
paired with the wrong field, fields shown that Classic hides and the reverse,
and controls moved out of their source place. Fixed in the generators and
validators, regenerated, and refused (Classic layout kept) where no correct
mapping exists:

1. A hidden grid column owns the header painted exactly over it (PowerBuilder
   hides the header with the column), so a column a script shows gets its source
   header, not its raw name, and the header is never a loose caption above the
   grid (`d_item_update`). A free header over a hidden tabular column is refused.
2. A header or detail band without height paints nothing: its objects are
   decorations, never captions or fields, and they no longer make a form a grid
   (`d_arg_region` was a one-column grid headed by a hidden "Category").
3. Text, columns and computed values in the background layer are painted content
   (a "Patient Name: ..." heading): the DataWindow is refused instead of dropping
   them as decorations (`d_visithistory`, `d_view_item_satisfiable`).
4. Dialog captions pair globally by cost with the closed height of a drop-down
   and never across another control; hidden inherited controls take the pairing
   of the ancestor that places them (`w_arg_cust_sdate_ldate_v13`,
   `w_arg_manfs_cats_classes_packs_dates_v3`, `w_arg_accounts`).
5. A visibility that is the constant 0 (`1~t0`) hides an object for good, and
   alternative fields painted over each other share their one source caption
   (`d_inpatientsalereturn`, `d_serviceorderheader`, `d_receiptheader`).
6. A trailing text named after the field it follows (`<column>_t`) is that
   field's suffix, not the next field's caption (`d_patientvisit_gyn_us`).
7. A command button the source places among the content keeps its position
   (`buttons`); only the window's own button row or column is `actions`.
8. Visible pictures, colour keys and progress bars are positioned content
   (`artwork`); hidden ones stay `auxiliary`.
9. Each groupbox records the content it encloses (`members`); Modern keeps the
   box caption with exactly those controls, and the main frame labels the whole
   content only when it encloses all of it.
10. A heading or button of a grouped form stays in its groupbox, or the form is
    refused (`d_adjustmentpreferences`).
11. Document classification no longer exempts an on-screen DataWindow with
    enterable columns, and letterhead evidence ignores per-row detail lookups
    (`d_guestroom_detail`, `d_emp_employee`, `d_cashactivitymonitorlist`).
12. Form fields read row by row (jitter of a few units no longer reorders a row),
    a report title never heads the first grid column, and the dead column-named
    path of the modal generator is removed.

Position checks run in the generators and the tests; the runtime keeps the
structural checks, because a script may re-lay controls while a window opens.
Caption visibility expressions at run time and the run-time order of a column a
script switches on are owned by the DataWindow renderer and are not part of these
generator fixes.

Decisions recorded for future sessions:

1. Reviewed mappings always win. Generated ones fill gaps and are re-validated on
   every paint or open; a mismatch falls back to Classic with a visible notice.
2. A DataWindow hosted by an entry master keeps a context-only mapping (it is
   embedded in that window's layout), as the reviewed masters do. Only other
   DataWindows are mapped globally.
3. Calibration found 18 reviewed Code/Name lists that placed Code before Name where
   the source puts Name first. They now follow the recovered x positions
   (`NAME_FIRST_LISTS`); tests compare every single-entry list with the source.
4. A bare DataWindow field with no source caption is named after its column,
   as the reviewed Price selector is. These windows are listed under
   `columnNamedFields` in the modal backlog.
5. A criteria list may be captioned by a source label instead of a groupbox
   (`lists[].label`), a dropdown or multiline edit may be a field, and pictures,
   rectangles and progress bars are passive auxiliary controls.
6. Totals take the footer text when there is one, otherwise the column header
   above; the band heading "Totals" is generic and not source text. Hidden
   inherited controls pair with the nearest hidden caption because their design
   positions are unreliable.
7. A visible field the source leaves uncaptioned gets an accessible-only name from
   its column (`labelHidden`, visually hidden), so no wording is invented on screen.
   Source text that names no field (a heading, a note, a script-set value) is kept
   in place as a form caption (`captions`). Form labels pair by globally cheapest
   vertical-then-horizontal distance; the fallbacks above would hide a bad pairing,
   so the reviewed-mapping calibration test is the guard. A freeform DataWindow whose
   captions sit in a header band is generated as a grid (`sourceProcessing: 0`).
8. Tabs, user objects, OLE, rich-text, list views and hyperlinks in a response
   window are embedded: kept as their original element, with their own children,
   inside the Modern frame (`embedded`). Only the window's own controls are mapped.
   A caption object that is blank in the source keeps an accessible-only name until a
   script sets it, and a grid's header text that names no column is a grid caption.
   Fields outside every groupbox form one plain section; bitmaps and drawn boxes are
   accounted for as `decorations` and not painted; so is any object the source
   places below its band height (the original clips it).
11. A form's DataWindow buttons are real buttons that raise the same Clicked event, with
   the button's name as the object, that the Classic view raises for that object (the
   runtime has no ButtonClicked event in either view). A lone totals-band text such as
   "Total:" is shown above the totals (`bands[].captions`).
12. A spin setting the editor cannot honour (a date mask, an unbounded integer range) is
   acknowledged per field (`spinPlain`) and edited as plain text, as the Classic view does.
13. Detail-page controls that are not mapped DataWindows, and DataWindows whose object is
   assigned at run time, keep their original element in the entry layout (`kind: 'control'`).
   A DataWindow known to the source but not yet mappable still blocks its window.
14. Ordinary windows opened as workspace sheets (unset or popup window type) are
   reflowed like dialogs (`sheet: true`); the MDI frame and background never are. A
   dialog field or list the source leaves uncaptioned gets an accessible-only name
   (`fields[].name`, `lists[].name`) from its box or control, and a DataWindow whose
   object is assigned at run time is embedded as its original element.
15. A grouped grid (`grouped: true`) shows the source's group header and trailer bands at
   every break, using the Classic view's break rule (`group-plan.ts`, unit-tested) and the
   runtime's group-scoped aggregates. Row windowing counts group bands as rows, so scroll
   position, row indexes and spacers stay consistent. Group titles with no source caption are
   named accessibly and not painted. Forms with groups still wait for a reviewed mapping.
16. Parity standard (user decision, 2026-11-08, final; see AGENTS.md "UI standard"): Modern is
   compulsory, not optional, and must be enterprise-grade and fully functional. It must keep
   100% structural parity of the UI/UX frontend with Classic (structure, not design): same
   controls and control types, order, arrangement and proportions (two fields sharing a row 50/50,
   one dropdown and one text field, stay that way), visible/hidden fields, tabs, groups, actions,
   validation and behaviour; visual design is free. PDF, print and report output is EXEMPT from
   parity and may be redesigned freely into modern-grade graphics (its data content must stay
   correct; on-screen criteria and print-settings dialogs keep parity). Classic is the reference
   baseline and runtime fallback. Modern becomes the default
   startup once the structure-parity gate, the completed browser pass and business acceptance
   of the transaction screens exist. The original app is needed running for side-by-side
   captures (not yet done).
17. Structural arrangement (decision 16 made concrete; `grid-plan.ts`, unit-tested). Modern forms,
   dialogs and entry-window extras follow the source geometry instead of an auto-fit grid: every
   field, caption, button, rule and groupbox is placed on a CSS grid whose tracks come from the
   source coordinates (objects that share a row share grid rows, a tall list beside two stacked
   fields spans both rows, column widths follow the source widths, row heights follow the source
   distances at a scale where a typical field is four text lines high and grow with content,
   empty space is not a track, and a container (groupbox, embedded tab or DataWindow) sizes by
   its own content). An offline simulation of the gate over the 744 on-screen forms predicted
   13 mismatches for snapped rows and 4 for proportional rows.
   Only track geometry is derived: DOM order, and so the original tab order, is untouched, which
   also closes the eight forms whose tab order interleaves rows. Groupboxes are placed as cells and
   arrange their own fields. Narrow containers stack the cells. Grid columns of grids (tables)
   follow source width proportions (`colgroup`). Entry windows keep extra controls a standard
   layout has no slot for (for example `st_3`/`em_invno` on the sale list page). Gate: the
   generated-family browser checks record, in Classic, which controls share a row (real DOM geometry)
   and require the Modern phase to reproduce those rows for every generated form DataWindow and
   dialog; its first run found 274 mismatches (87 after correcting its own measurement), which
   this grid replaces. On-screen print/report layouts (labels, invoices) are exempt. Not browser
   verified until that gate passes.
   Open structural mismatches. Last CI browser run (commit `492e59ee`, run 42520697084): 46,151
   assertions passed, 13 failed, every failure a Classic/Modern structure-gate case; every other
   suite in that pass was clean (the first complete pass had 274 gate failures). The 13:
   `d_alnaseeb_deliveryorder_saleinvprint` (a print layout), `d_mr_pc`, `d_old_general1`,
   `d_normalpurchasereturnfooter`, `d_opensalereturnfooter`, `d_patientvisit_obs_us`,
   `d_salereturnfooter_view`, `d_servicefooter_view`, `d_smscenter_composesms`,
   `d_smscenter_preview`, `w_arg_cust_sdate_ldate_v13`, `w_arg_customers_sdate_ldate_v7`,
   `w_arg_manfs_cats_classes_packs_dates_v3`. Cause class: source fields much shorter than a Modern
   field (for example a 17-unit computed flag beside 56-unit fields) or staggered by less than a
   Modern line, so Modern's minimum field height changes which neighbours overlap.
   Resolution (2026-11-09): a wrong structure is a defect, so the ten that still failed in CI run
   42540521435 are refused by the generators (`STAGGERED_ROWS` in `derive-data-surfaces.ts`,
   `STAGGERED_DIALOGS` in `derive-modal-windows.ts`) and keep the labelled Classic layout until the
   grid planner reproduces staggered rows; the others were fixed or refused by the review fixes.
18. Workflow parity on the real system (CI `e2e` job). The real application signs in against
   the Rust server and PostgreSQL (converted schema, seed and bootstrap data) and clicks every item
   of the menu observed in the original, once in Classic and once in Modern
   (`web/e2e/browser-smoke.mjs`, `CRAWL_MODE`). For each command the runtime records whether it
   ran, the windows it leaves open and their titles, every message box, the report it produced
   (DataWindow, rows, visibility, preview) and the windows its scripts close;
   `web/tools/compare-crawls.mjs` compares the two item by item (clock values in titles ignored).
   First result (run 42524908981, commit `d7f06b56`): 78 of 78 crawled commands had an identical
   outcome; the crawl budget then covered 78 of 110 menu items (28 did not click in either mode,
   the same items), so the budget was raised to cover the whole menu. Whole-menu result (run
   42528203005, commit `e9a821e5`): 110 of 110 menu items walked in each mode (53 did not click in
   either mode: items the administrator profile does not enable), 114 of 114 recorded outcomes
   identical in Classic and Modern; repeated on run 42531947327 (commit `9b78e789`) with the same
   result. The automated WCAG 2.2 A/AA scan (axe-core) of 159 generated-dialog appearances found
   0 violations after the scroll-region fix. This compares what the
   commands do, not every field edit inside a window; data-entry workflows inside windows are
   covered by the synthetic browser suite, not by this crawl.
   Run 42535404058 (commit `825c25c0`) compared 0 items: a probe added to the crawl threw at the
   first item and the step piped into `tee` without `pipefail`, so it reported success. Both are
   fixed (`6a0994c2`: the probe, and bash with pipefail as the workflow default shell).
19. Behaviour reference (2026-11-09, A-Z review of the Modern frontend and the shared runtime
   views). The reference for behaviour is the original PowerBuilder application; Classic is the
   rebuild's baseline. Where Classic itself departed from PowerBuilder, the shared code was fixed
   so both presentations behave like the original, never Modern alone:
   - DataWindow click order: GetFocus (when the DataWindow lacked it), then Clicked while
     GetRow()/GetColumn() are still the row and column being left (Clicked returning 1 keeps the
     focus), then the pending entry is accepted (ItemChanged/ItemError), then
     RowFocusChanging/RowFocusChanged, then the clicked field opens. Evidence:
     `w_backupinfo_for_verificatioin` dw_backupinfo.clicked runs
     `selectrow(getrow(), false); selectrow(row, true)`, which only works with the old row
     current. Before, a click on another cell discarded the typed entry (no ItemChanged) and
     Clicked saw the new row. The order against the running original is still to be observed
     in the final pass.
   - Tab order: Modern windows keep the source TabOrder (`data-tab`, `source-tab-order.ts`) for
     Tab, Shift+Tab, Send()-based Enter navigation and tab-page entry; a container's controls are
     ranked by the container's order first; tab stops without a TabOrder stay out of the sequence.
   - Message boxes follow the Windows rules in both presentations: Escape answers Cancel or the
     only button and nothing else, an out-of-range default focuses the first button, an empty
     title stays empty. A dialog can no longer close while its script waits.
   - Focus after a message box or response window returns to the control that had it and its
     GetFocus runs (PowerBuilder behaviour; Classic leaves the focus on the page). Classic menu
     accelerators now wait while a response window or message box is open, and presses on the
     frame, its menu and the windows opened before a response window are ignored (no overlay, so
     Classic looks the same). The window z-order is renumbered before it reaches the menus (1000)
     and message boxes (2000); it grew by one per window press and, in a long session, sheets
     could be drawn over an open menu or message box.
   - Tab after the last field of the last row accepts the entry and moves on to the window's next
     control in the source tab order (Shift+Tab before the first field: the previous control), as
     PowerBuilder does: 431 recovered DataWindow Enter handlers send Tab to their own DataWindow
     (`send(handle(this), 256, 9, ...)`) to reach the next control, which only works that way
     (`w_arguements.dw_control` → the dates and OK). A DataWindow outside a window, or alone in
     it, keeps the keyboard on its field. (An interim rule from the DataWindow review kept the
     keyboard on the field in every case; it was reversed on this evidence.)
   - Tab from a read-only or computed field (a Modern tab stop that is not the current column)
     moves to the next enterable field after it in reading order (Shift+Tab: the previous one),
     or into the current field; before, it moved on from the current column and could leave the
     keyboard stuck (`w_discountcalculator`: focus on Name, current column Rate, the last).
   - A user tab switch holds the new page (and its controls wherever the Modern layout placed
     them) until SelectionChanged and what it posts have run, as PowerBuilder processes the next
     input only then; a SetFocus aimed into the page is applied when it is released.
   - Modern dialogs keep Tab in the window's source order and wrap to its first field; the
     title-bar Close button is a mouse control outside the cycle (as in Windows).
   - ShareData: a change made through one DataWindow repaints every DataWindow sharing the
     buffer (until ShareDataOff); before, only the control the change was made through repainted.
   - A Modern editor opened by Tab or Enter is scrolled into view when it takes the focus (it is
     focused without the browser's scroll); at 683x384 and 200% the next calculator field was
     half hidden below the dialog.
   - Printing with "Print layout: Modern" never fails the print call: a document without a usable
     Modern template prints with the Classic layout and says so; preview templates are used only
     in the Modern workspace.
   - Server: a decimal or NULL host variable that is an operand of arithmetic is substituted as a
     numeric value (`round(:ld_price * :ll_packunits, 2)` in the item price update failed in
     PostgreSQL; T-SQL converts implicitly). Everywhere else the substitution is unchanged.
   - Server, checked read-only against the original's SQL Server 2022 (Windows auth, table-free
     probes and Query Store metadata): PowerBuilder sends retrieval arguments as literals, and
     `ORDER BY 'salerowid'` sorts by that select-list column (error 408 otherwise). The
     populate-from-posted-invoices sort (`ORDER BY :ai_ordercol` in `d_postedsale_for_population`
     and `d_postedsale_for_proformainvoice`, used by the sale, advanced sale and pro-forma windows)
     was refused by PostgreSQL; a plain name there now names the output column. All original
     logins are `us_english` (month first): sessions set `DateStyle 'ISO, MDY'`, so the dashboard
     drill-downs' `CAST(:as_date AS DATETIME)` of a `mm/dd/yyyy` label no longer depends on the
     PostgreSQL cluster locale.
   - Modern keeps a field's source colours but draws black or white text where the source text
     is unreadable on them (`w_graph_color`'s white-on-green channel field, 1.37:1); Classic is
     unchanged. The accessibility step now scans every representative dialog instead of
     stopping at the first appearance failure.
   - Open: the observed original shows "Sale And Return" where the recovered `m_mainmenu` sets
     "Sale And Return (One Category)" and no script renames it; the rebuild follows the recovered
     definition until the original can be checked.
9. The Modern workspace sidebar now browses the live menu by module (collapsed
   groups, lazily filled, open state retained) as well as searching it; availability
   is still the live visible/enabled state, rechecked before every command.
10. Modern `frame` is the top-left free groupbox. Visible DataWindows follow
   source reading order and hidden print companions follow by name.

### Static use evidence

The inventory now records, without classifying documents, where each DataWindow
is used: 1,662 sit on visible window controls, 226 only on hidden controls, 200
only nested in reports; scripts assign 2,438 (1,326 to report targets, 231 to
print targets, 588 to datastores); 1,157 have no static or script use. Formal
document classification and approved templates remain open.

### Document classification (evidence, not approval)

`web/tools/classify-documents.ts` writes `ui-print-classification.json`: each of the 8,740
DataWindows lands in one class from script and window evidence only. 5,138 are print or
report candidates (231 assigned to print targets, 4,903 report targets, page-numbered or
company-letterhead layouts, 4 registered templates); 1,701 sit on screen controls; 465 are
datastores with no screen; 812 have no evidence. Structural flags: 4,547 carry a company
letterhead or reprint counter, 4,211 use page numbers, 2,041 have groups, 147 are crosstabs,
70 graphs, 59 composites. Under the 2026-11-08 rule (decision 16) print, PDF and report design
is exempt from structural parity and may be redesigned freely; only its data must stay correct.
Of the 5,391 DataWindows without a Modern surface, 5,031 are such print/report candidates;
360 are not and remain open on-screen work (85 column-in-header, 70 graphs, 34 line-in-summary,
28 composites, 21 grouped, 18 text-in-header and smaller causes). The 104 windows still without
a layout are mostly hosts of these report layouts.

### Consolidated browser pass (2026-11-10)

The single consolidated pass (`presentation-smoke.mjs`, no flags) completed on a
static build of this tree:

| Result | Value |
|---|---|
| Browser assertions | **61,777 passed, 0 failed** |
| Appearance cases | **1,881** |
| Runtime/page errors | **0** |
| Forbidden requests | **0** |
| Forced-color assertions | **148 passed, 0 failed** |
| Accessibility scan | axe-core not installed, not run |

The structure gate covers all 5,348 generated DataWindow surfaces, the generated
entry masters and all generated dialog/sheet windows in Classic and Modern,
plus the earlier reviewed families, appearance captures and the
30,000-choice / 100,000-row timing fixtures. It verifies that

- `d_serviceresult_comments` now renders its recovered `comments` input field
  (the fixture restores the exporter's lost object name);
- `d_mr_pc` and `d_patientvisit_obs_us` pass after fields stop stretching to
  their source row tracks and ungrouped fields remain direct form children;
- Tab in the calculator windows now scrolls the focused field into view without
  overriding a user-positioned scroll on a programmatic redraw;
- the two staggered criteria dialogs still fail the row-sharing gate and keep
  Classic; six staggered DataWindows are the remaining explicit compatibility
  fallbacks. The twelve compact card/footer/SMS surfaces now derive and pass
  the gate after fields spanning several tracks fill them while single-track
  fields size to their content.

This is a structure and synthetic browser pass, not business acceptance, not
complete screen acceptance, and not a substitute for native, PostgreSQL,
hardware or assistive-technology acceptance. The measured result is summarized
in `ui-browser-structure-2026-11-10.json`.

### Previous committed snapshot (`0571876b`)

**Sixteen more single-entry masters were authored at that commit.**
As of this snapshot the registry holds 168 authored windows out of the 2,062
inventoried (8.15%; 9.18% of inherited control paths): 70 modal layouts (55
criteria, 5 native-field, 4 transaction, 4 calculator and 2 calendar windows)
and 98 entry windows.
The entry windows are 3 multi-entry and 95 single-entry layouts, of which 43 are
standard Code/Name masters and 52 are richer masters; the newest sixteen are
listed under "Additional single-entry masters". There are 47 global DataWindow
mappings and three print-template families (sales preview, purchase preview and
the blocked item label); no Modern print template is approved. The other 1,894
windows still use labelled Classic compatibility layouts.

The verified snapshot passes 796 frontend tests, strict presentation types and
the nine static-inventory tests. The full browser regression passes 12,819
assertions and 789 appearances, plus 148 additional forced-color assertions.
All 95 single-entry masters pass 4,007 focused Classic/Modern assertions.
A focused print run
adds 84 assertions across five settings and four document appearances without
printer access. There are no failures, runtime/page errors or forbidden
requests. These are synthetic, isolated checks, not acceptance of any complete
business workflow: verified complete Modern screens remain zero, no window has
recorded Classic evidence, runtime reachability or role coverage, and normal
startup stays Classic. `node tools/parity/ui_completion_audit.mjs` regenerates
the measured coverage report in `ui-completion-audit.md`; its verdict is
**not 100% complete**.

The audit describes this verified snapshot, not concurrent working-tree edits.
Authored DataWindow coverage is 271 of 8,740 definitions (3.10%); 8,469 still
have no explicit surface. These counts measure authored presentation mappings,
not the percentage of accepted business workflows. No defensible aggregate
completion percentage is established by combining these different denominators.

### Previous DataWindow-calendar snapshot

**Both shared calendar owners are implemented; enhancement remains incomplete and unreleased.**
The registry contains 55 criteria owners and 70 modal layouts. `w_calendar2`
shares the three-control Modern calendar layout. Its two original F4 handlers
reject invalid drafts, retain millisecond clocks and cancellation values,
initialize empty datetimes at midnight and restore the visible editor and
focus. The original colon-separated millisecond mask now parses and formats
independently of regional date order.

The source-matched snapshot passes 745 frontend tests, strict presentation types
and 624 focused both-host assertions/eight DataWindow-calendar appearances.
Consolidated regression passes 11,909 assertions and 781 appearances, including
eight appearances of each calendar owner, plus 148 additional forced-color
assertions. All 67 production modules, 25 copied fixtures and 127 inputs match;
there are no failures, runtime/page errors or forbidden requests.
`datawindow-calendar-verification.json` records final identity and evidence
hashes. These are isolated source-handler checks, not acceptance of the complete
customer-comments window, remaining callers or business workflows. Complete
catalogs and production acceptance remain open; normal startup stays Classic.

### Previous native-date calendar snapshot

**The shared F4 calendar is implemented; enhancement remains incomplete and unreleased.**
That registry contained 55 criteria owners and 69 modal layouts, including the
original three-control `w_calendar`. The verified snapshot passes 739 frontend
tests, strict presentation types and 924 focused both-host browser assertions.
Eight calendar appearances cover light/dark, 100/200% text, 320px and short
viewports, including two forced-color cases. Consolidated regression passes
11,285 assertions and 773 appearances, plus 148 additional forced-color
assertions. All 67 production modules, 24 copied fixtures and 126 inputs match;
there are no failures, runtime/page errors or forbidden requests.
`calendar-verification.json` records final identity and evidence hashes.

The shared native calendar preserves selected-date output references, source
DateChanged and double-click handlers, today/week-number properties and modal
returns. F4 retains the field's date mask and existing clock, and restores the
invoking field and owning cancellation structure. Source focus requested before
a Modern modal becomes visible is applied after showing it. Rapid Enter or OK
waits for queued calendar changes rather than returning stale dates. Date cells
retain full text scaling and at least four pixels of measured horizontal room
around their glyphs; other dialogs retain their existing outer margins.
Normal startup remains Classic. Full catalogs/workflows and packaged Windows,
database, assistive-technology and hardware acceptance remain outstanding.

### Previous date/choice snapshot

**Six date/choice owners are added; enhancement remains incomplete and unreleased.**
That registry contained 55 criteria owners and 68 modal layouts. The previous
snapshot passes 726 frontend tests, strict presentation types and 734 focused
both-host browser assertions/48 appearances, including real secondary-selector
keyboard/pointer actions, native date recovery and As On navigation. The full
source-matched regression passes 10,645 assertions and 765 appearances, plus 148
forced-color assertions, without failures, runtime/page errors or forbidden requests.
All 65 modules, 24 fixtures and 123 inputs match the recorded final snapshot.
Prior full-run results below belong to their own snapshots.

The source cost-price lookup retains keys 5/6 and default 6; Cash/Credit/Both
retains codes 1/2/3 and default 1. Guards apply to the visible `dw_price` editor.
The inherited non-blocking customer AcceptText call remains intact; no extra
guard is imposed on the unused hidden buffer. Original null behavior, sparse
sales flags, cashflow account/suppression codes and remarks values are preserved.
Single-field external captions remain live accessible labels outside the
DataWindow, and actual Tab follows restored selection focus after editor repaint.
That snapshot did not include the shared native calendar opened by F4.

### Previous date-option snapshot

**Nine additional date/filter dialogs are implemented; enhancement remains incomplete and unreleased.**
That registry contained 49 criteria owners and 62 modal layouts, alongside the
unchanged 47 global DataWindow and 82 entry mappings. The date-option snapshot
passes 713 frontend tests, strict presentation types and 1,282 focused browser
assertions in both hosts. Seventy-two appearances cover light/dark, 100/200% text,
320px and short viewports, including runtime-revealed inherited options. Real
Tab/Space/arrow/Enter and pointer checks cover every added owner. The source-matched
consolidated regression passes 9,913 assertions and 717 appearances, plus 148
forced-color assertions, without failures, runtime/page errors or forbidden requests.
All 65 production modules, 24 copied fixtures and 123 inputs match the final
snapshot. The prior print results below remain historical evidence.

The nine owners preserve source checkbox/radio captions and defaults, all posting
combinations, issue/due/post date values, purchase/sale type values and sparse
transaction return codes. All Transactions checks and disables all fifteen
choices; clearing it clears and re-enables them. Only purchase/sale type enforce
the original reversed-range status-zero-and-close rule. Atomic date preflight
and fresh cancellation leave the unused customer buffer hidden and empty.
Native options missing a source TabOrder gain normal Modern tab stops, while
explicit zero exclusions and Classic remain unchanged. None of these synthetic
dialog checks accepts a complete report workflow, database result or native build.

### Previous print snapshot

The integrated snapshot passes 694 frontend tests, strict presentation types and
84 focused browser assertions in both hosts. Five settings appearances cover
light/dark, 100/200% text and 320px/short viewports; four synthetic document
appearances cover the first/last Classic and Modern pages. All 65 production
modules, 24 copied browser fixtures and 123 tracked source/test/configuration
inputs match the tested snapshot. The consolidated run passes 8,633 assertions,
645 appearances and an additional 148 forced-color assertions.
Independent print-family inheritance, readable options, storage-failure retry and
unavailable-template messages are integrated. Decorative rules now preserve
measured field/band positions, including zero-height groups. Sales/purchase
invoice previews are not approved official layouts; labels remain blocked.
No database, native desktop or printer was accessed.

### Earlier numeric-snapshot history

Local checks of the expanded registry exposed source-order, multiline, decimal-spin,
strip-only compilation, keyboard-event typing, numeric-date-mask and literal
property-assignment defects, now corrected. The numeric snapshot passed 685
frontend tests and strict presentation types with a 63-module static build.
It passes 8,549 browser assertions and 636 appearance cases, including
forty owning criteria dialogs. Both independent tested builds contain identical
production modules and 23 copied browser fixtures. It covers real keyboard/pointer interaction,
light/100% and dark/200% layouts, and narrow effective viewports.
During browser verification, concurrent work added `modern-print.ts` and
`print-templates.ts` and changed `ui-preferences.ts`, `presentation-styles.ts`,
`presentation-ui.ts` and `print.ts`. These edits were preserved. Initial
provenance recorded 59 of 63 production modules and all 23 copied fixtures
matching the then-current 65-module tree, with 692 passing frontend tests.
A second full run on `numeric-current-build` also passed 8,549 assertions,
636 appearances and 148 forced-color assertions. Concurrent work then changed
the shared `presentation-browser.mjs` and `presentation-smoke.mjs`, added
`presentation-print-browser.mjs`, and continued changing `modern-print.ts`.
That phase's latest completed frontend/type run had 693 passing tests, but subsequent
source drift prevents attributing it or either full result to the final checkout.
The verification scripts deliberately reject that source/fixture mismatch.
All numeric-owner edits remain preserved; no competing print edits were reverted.
Those runs did not establish new Modern document behavior. Their print-unavailable
statements describe the tested numeric snapshot, not the subsequent integration.
Do not treat either result as complete print acceptance.
An additional 148 forced-color assertions pass across four emulated
light/dark system-palette and viewport cases. Selected text is checked at the
pixel level, not only through computed colors. This is not native Windows
high-contrast or assistive-technology acceptance.
The concurrent HTTP backup-parser TS2322 is resolved by a type-only capture
annotation; its backup behavior was preserved. The historical failed check
and snapshot mismatch remain recorded, not overwritten. The fresh build includes
the current HTTP implementation and the concurrent Classic focus rule. Modern
native controls retain their stronger two-pixel themed focus outline without
changing Classic's rule. The expanded forty-dialog focused fixture passes
1,908 assertions and 304 appearances, including real item-search keyboard/pointer
actions, failed-retrieval recovery, native date correction/navigation, all
fifteen single-lookup owners, six inherited reference-text owners and six numeric
owners. Exact source captions, Boolean return flags,
untouched null/zero behavior and persistent ShowList/Tab behavior are retained.
The six text owners share a context-local `d_arg_ref.refno` surface; only
container number, reference number and SMS center enforce the source null check.
Numeric owners preserve source percentage limits, scalar return channels and
ordering flags; range labels remain beside their own fields through repaint.
Native datetime GetData rejects impossible dates without rollover or partial
return-field writes. Original KeyDown/Handle/Send navigation skips hidden and
disabled controls; native error borders remain visible in forced colors.
Its preferences and SQL/RPC results are synthetic.
The older 143-test / 518-browser-assertion result belongs only to the previous
dropdown baseline. CI, packaged Windows, hardware,
printing and complete business-workflow acceptance remain outstanding.
Do not enable Modern by default or describe this working tree as release-ready.

The corrective pass also removed duplicate Modern checkbox click activation:
real browser clicks could finish one asynchronous commit between listeners and
then toggle the value back. Cells now use the shared renderer's one click route;
Space, F2 and pointer sequences assert exact ItemChanged counts. Grid keyboard
targets no longer inherit form scroll margins that obscured full-width cells.
The shared click route honors live TabSequence overrides, including fields
disabled in source metadata. Text-editor redraw retains `aria-invalid` and
restores focus without scrolling user-positioned ancestors. Active multiline
typing reveals the restored editor after painting, rather than letting browser
caret scrolling leave half of it offscreen. Reflow keeps previously visible form
focus onscreen, but passive redraw does not undo deliberate scrolling away.
Genuine focus on a form text editor or native radio option uses post-paint
reveal; radio focus reveals its complete label. Grid, dropdown and checkbox
focus do not schedule extra editor redraws. Grid painting snapshots focus
immediately before replacing the DOM, not before asynchronous rendering. A newer
cell focus or focus outside the DataWindow therefore survives a pending paint.
A complete-run failure also exposed a wrapped-status reflow: the short `Ready`
message after acceptance could become a taller form summary after Tab focused
OK, pushing the action below the scrollport. Repaint now reveals an already
visible focused sibling in the same mapped window if layout growth obscures it,
without changing focus or undoing deliberate scrolling away. A deterministic
calculator regression fails on the old build and covers both visibility
preservation and passive-scroll ownership on the corrected build.
Fixture repairs preserve source
uppercase rules, real Handle/Send navigation, synthetic replacement-child
retrieval and isolation; they do not suppress database failures. Appearance
changes preserve the unaccepted draft without writing it to the buffer.

An **opt-in Modern workspace foundation is integrated into the shared runtime**.
The user directed autonomous implementation after seeing the prototype; another
visual-direction approval is not blocking this foundation. This is not a
released Modern mode or completed all-role production pilot.

Use `?app=1&presentation=1` on an isolated development/test application to enable
the post-login presentation selector. Without `presentation=1`, startup remains
Classic. The installed application's entry URL has not been changed.

After successful login closes, the host loads versioned local preferences scoped
to the API server, actual database, application user and workstation. The storage
key hashes this tuple; preferences contain neither credentials nor business
drafts. New preview users select Modern by default. Mode changes apply at the
next sign-in; theme/density/text preferences apply to the Modern workspace now.
Unsupported or corrupt settings stop selection with an explicit error rather
than being silently overwritten. Removing the preview flag restores the normal
Classic startup without deleting preferences.

The Modern host provides live menu-command search, retained workspace tabs,
CloseQuery-aware closing, Appearance, and native message/prompt dialogs. Classic
and Modern use the same runtime, DataWindow commit/validation helper, menu
events, and message-box response codes. Modern search and dialogs cannot
dispatch background transaction accelerators.

Existing response windows retain their original runtime and DOM instances inside
native modal containers. Background forms are inert; native Escape cannot bypass
the runtime close lifecycle. Accepted closes restore the invoking window and
editor; cancelled CloseQuery retains the response. Nested response windows and
message dialogs preserve their own focus and return channels.

**Sixty-eight modal surfaces have Modern layouts: fifty-five criteria windows, five native-field dialogs, four
transaction calculators, the associated-sale invoice picker, cashier-shift closing
and multiple-invoice cash tendering plus category changes. The picker
now runs its original shared-buffer, validation, keyboard and structure-return
flow with strict synthetic SELECT results; real database acceptance remains
outstanding. Forty-seven DataWindow
components have global Modern mappings, and the aging-entry outer layout has
a scoped Find mapping. Another 43 standard Code/Name entry windows now have
synthetically verified outer layouts and control-local form/list mappings.
Contact Group now also has an authored outer layout and contextual member grid,
using the shared guarded choice editor. The entry registry therefore contains
98 mappings (aging, Contact Group, Contact Card, 43 Code/Name entries and 52 richer masters),
not 98 accepted workflows. The richer masters include Checklist Item, Shift, Tax Category,
Relation, Disease Type, the item brand/colour/fabric/size/sleeve/style/yarn masters, Model,
Rank, Site, Unit, County, Eye Vision, Generic Item Type, Godown Group, IOL Power, Item Design,
Item Thickness, Resource Category, School, Surgery, Surgery Procedure, Ward, Author, Dosage
Unit, Grade, Class, Item Class, Item Packing, Measuring Unit, Transport Route, Discharge
Referral, Vehicle Type, PCT Codes, Tests, Item Meter, Biometric Machine, CRS Client List,
Customer Sector, Dosage, Instruction, Precaution, Region, Route, Sale Type, Weighing Scale
and Goods Company.
Unmapped business windows still use labelled Classic compatibility layouts.
These entry layouts are not accepted complete workflows;
accepted production Modern business workflows remain zero.** Classic printing
is isolated from workspace themes. The opt-in host now enables only explicitly
registered Modern previews; unavailable Modern requests fail visibly instead
of substituting Classic or claiming that a print job occurred.

`../DESIGN.md` records the implemented visual direction and its boundaries.

## Independent document presentation

The explicit registry contains sales invoice `d_retailsaleinvreport` and purchase
invoice `d_purchaseinvreportstock_retailer` as previews. Item-label definitions
`d_itemlabels_4` and `d_labelbarcode_rahat` stay blocked until paper dimensions,
margins and target-printer information are known. No entry is approved for
official use. Unknown documents require Classic; selecting Modern reports the
missing template and a recovery action before printing.

Appearance stores only explicit per-family choices. `Default` follows global
Print layout, and selecting it clears an override. Saving a theme/density/text
change does not pin inherited layouts. Unknown saved family keys are retained.
An unavailable stored choice stays visible with its reason and can be cleared;
the disabled Modern option cannot be newly chosen by keyboard. Shared linked
help explains inheritance and approval status without oversized select labels.
Failed saves retain the draft and previous preferences; retry and Cancel keep
their normal semantics. Old v1 preferences without a family map remain readable.

Modern print uses the shared values, bands, dimensions and pagination. Decorative
rules are pseudo-element overlays: ordinary borders shifted absolute field
origins and expanded source zero-height bands. The fixture measures rendered
object/band rectangles under the real print stylesheet, not just inline widths
or detached text. Its three-page synthetic report keeps all 120 detail rows,
both group totals (1830/5430), total 7260 and exact page numbers. Empty output and
zero-height groups retain Classic behavior. First/last pages stay white and
their body content stays above the footer.

The focused command is
`node .\e2e\presentation-smoke.mjs <isolated-build> <new-output-directory> --print-only`
from `web`. It runs both hosts, real Tab/Home/End/Enter/Cancel interactions,
storage-failure recovery, readable-option measurements and five settings/four
document appearances. The same checks are wired into the consolidated fixture.
These are synthetic browser results, not native print-dialog, physical printer,
barcode/scanner, real invoice or complete report-catalog acceptance.

## Forced-color interaction states

Modern selected rows and lookup choices use the system `Highlight`/
`HighlightText` pair. An unselected current grid row has a dashed outline,
and selected-cell focus uses the contrasting selection text color. Checkbox
ticks, mixed-state dashes, radio markers and native focus outlines remain
visible. Invalid fields use a dashed system-text border rather than relying
on red, and default window actions, settings Save and lookup Select retain a
two-pixel system-highlight border.

Chromium's forced-color text backplates could conceal the selected text even
when computed foreground/background colors were correct. Only selected
readonly value cells, source suffixes and detailed lookup rows suppress this adjustment, using
explicit system colors; descendant native editors, buttons and popups restore
automatic forced-color handling. Ordinary light/dark styling remains unchanged
outside forced-color mode.

The browser matrix combines light/dark system palettes with an intentionally
opposite app theme at 1366px/100% and 320px/200%. It covers workspace tabs,
selected/current grid rows, pointer/F2/Space checkbox changes, keyboard radio
changes, real validation rejection, default actions, virtual popup selection
and detailed lookup navigation. Rejected drafts and focus survive entering
and leaving forced colors without modifying the stored record. Pixel-level
checks require both glyph and background pixels in selected grid/lookup text
to detect unreadable solid backplates.

The current full run passes 148 assertions, including required-field guidance
and selected source-suffix paint checks added after the initial 132-assertion
high-contrast baseline. The emulated system
selection pairs measure at least 14.371:1. These measured palettes do not stand
in for arbitrary user-defined system colors or actual Windows/WebView2,
screen-reader and keyboard-only acceptance. No OS settings were changed.

## Source-required field guidance

Modern forms show a visible `Required` hint for editable fields whose source
Edit, EditMask, DDLB or DDDW flag requires a value. Grid headers show the
declared column requirement; editable cells and their native editors expose
the corresponding accessible state and description. Original field labels,
multiline instructions and externally supplied descriptions remain intact.
Protected/generated form fields, hidden fields and computed outputs do not
become inputs the user is instructed to fill.

The shared `dwRequired` helper is the existing FindRequired metadata rule,
extracted without changing its search or validation behavior. Dynamic flags
update the guidance while text drafts, caret and stored values are retained.
Required state belongs on the actual input or supported field role, not an
editor's generic group container. Optional/required Manufacturer inputs and
multiline Contact Card descriptions have explicit browser checks.

No native HTML `required` constraint, validation rule or automatic acceptance
is added. Business-handler rules without a declared source flag are not
guessed. Classic presentation and printing retain their original path.
Required hints use the existing text palette and remain readable in enlarged
text and forced colors. Grid headings return to normal scrolling if the
sticky heading and one whole row cannot fit the pane; larger panes retain
sticky headings. The existing actual-editor bounds checks cover the enlarged
short-pane cash-denomination case rather than allowing a clipped editor.

## Source-bound criteria forms

Twenty-seven global mappings now reflow criteria forms:
`d_arg_academicclass2`, `d_arg_activeclass_single`, `d_arg_packlayout`,
`d_arg_pricetype_markupperc`, `d_arg_servicetemplate_remarks`,
`d_arg_servicetemplate_remarks2`, `d_arg_zone_details`,
`d_arg_quotation_customer_remarks`, `d_arg_svouchcode_lvouchcode`,
`d_arg_sinvcode_linvcode_singlerow`,
`d_arg_distcode_targetsystem` and its HighQ, MassPharma and Vikor variants,
`d_arg_zonaldailsale`, `d_arg_margin_markup_range`, `d_arg_distcode`,
`d_arg_distcode_city`, `d_arg_distcode_city2`, `d_arg_otbill`,
`d_arg_saleprice`, `d_arg_saleprice_disabled`, `d_arg_saleprice_discperc` and
`d_arg_letter`, `d_arg_percentage_reduce_raise`, `d_arg_top_n_customers` and
`d_arg_custref`. Every presentation object remains explicitly bound;
unsupported additions still fail the mapping gate rather than disappearing.

| Criteria | Preserved source behavior |
|---|---|
| Distributor code / city | Exact labels and field order; code keeps its case and 30-character limit, city converts to uppercase and keeps its 60-character edit limit. The second city variant retains its hidden field/label and `"."` default until the source reveals them. |
| OT bill / sale price / discount | Original decimal conversion and validation expressions remain authoritative. Negative sale prices and discounts outside 0-100 are rejected without storing or truncating the draft; inclusive discount endpoints remain valid. |
| Disabled sale price | The original zero TabSequence prevents editing; its value remains readable/copyable, without an editable required cue. No behavior is inferred from the definition's name. |
| Letter | To, Subject, Detail follow source visual/tab order rather than export-array order. All three are multiline, retain 4000-character limits and CRLF data, and keep their different NilIsNull flags. IME composition, selection and unapplied drafts survive repaint. |
| Distributor export targets | Four variants preserve their own static System code table, order and stored values, alongside the 30-character Dist. Code input. |
| Zonal daily sales | Report Type and Report Column retain their source lists, defaults and single-change selection behavior. |
| Margin / mark-up range | The sorted Mark-Up/Margin list and required percentage inputs preserve source defaults, 0-100 spin range and step 1. |
| Class / packing layout | Exact child identities, data/display columns, popup width and row budget. Only the single-class variant accepts typed captions; choosing duplicate captions retains the selected row's key. |
| Price type / mark-up | Original Price Type lookup and zero defaults; decimal mark-up retains its required flag and mask without inventing a percentage range. |
| Service template / remarks / due date | Source template lookup, uppercase 100-character optional remarks and null-on-empty policy. The dated variant retains its required date-only `dd/mm/yyyy` mask. |
| Zone details | Zone lookup stays editable; source zero TabSequence keeps Company and Dist. Code readonly. The dependent company display still resolves its own child key. |
| Quotation / customer / remarks | Both original child/key/display bindings remain distinct; synthetic fixtures replace the customer default with a synthetic key. Remarks preserve case, the 100-character limit and empty-string policy. |
| Voucher / invoice ranges | Voucher Type precedes From/To despite table-column order; same-line From/To labels remain distinct. Invoice range retains source defaults 0 and 100. |
| Percentage adjustment | Original Reduce/Raise codes, zero default, decimal mask, 0-100 validation and step 1. The source `%` suffix remains distinct from the caller-dependent label. |
| Top customers | Source default 20 and 1-9999999 spin range; `Show Top` and `Customer(s)` remain separate source objects. |
| Customer-reference replacement | Four exact source choice codes; `Replace Column` and `With Sale Invoice No. Column` are preserved without shortening the instruction. |

Trailing units and instructions are explicit `suffixObject` bindings to detail-band
text, not guessed labels. They wrap beside or below the input, use literal text,
and join its accessible description alongside existing help and required cues.
Empty or source-hidden suffixes remove only their own description. Live changes
preserve the unaccepted draft, caret, focus and stored value. Supported source
property expressions are evaluated per row, with independent accessible IDs.
This reuses the existing expression grammar; it does not extend native mask or
arbitrary property-expression parity. Grid suffixes, missing/non-text identities
and duplicate bindings are rejected by the mapping gate.

The focused fixture has 773 assertions across Classic and Modern, plus 108
appearance cases covering light/100%, dark/200% and 683px/320px layouts.
Choice tests verify the exact source options and stored codes; real keyboard
checks cover single Tab acceptance, To/Subject/Detail navigation, Shift+Enter
line insertion, popup navigation and complete visible editors. Lookup children
use nine retrieval-free source definitions and synthetic rows only. Duplicate-key
selection, editable exact-caption resolution, validation veto/retry and rejected
draft repaint run in both modes. Synthetic buffers and intercepted
control events exercise the shared input engine, not the owning report windows'
business handlers. Classic page construction remains isolated from Modern
styling; no printer output is produced.

The due-date fixture exposed regional parsing beneath an explicit date mask.
The shared editor now formats and parses complete numeric day/month/year masks,
including supported clock suffixes and named short-date/time aliases.
Unchanged date-only editing preserves any stored time without an ItemChanged;
invalid dates remain recoverable, and a live mask change retains an unapplied
draft instead of reinterpreting it. Other mask grammars keep their prior regional
editable text; textual-month, partial-date and complete native mask-engine parity
are not claimed by this correction.

These are component migrations, not twenty-seven completed reporting workflows.
The forty owning-dialog integrations below cover a subset of inherited and direct
argument windows. The remaining windows, full multi-column child detail layouts,
remaining date criteria, report retrieval, authorization and document output
require separate mappings and acceptance.
The zone/date/top-customer, customer-reference and item-selection owners now
have the mappings described below. None of these component or dialog mappings completes
the calling report/invoice workflows.

## Source-bound criteria dialogs

Forty complete outer layouts now bind the existing controls and reuse their
original window/ancestor routines:

| Window | Scope |
|---|---|
| `w_arg_activeclass_single` | Class selection; inherited price flags, checkboxes and source return structure |
| `w_arg_letter_sdate_ldate` | To/Subject/Detail, inherited hidden date inputs and original text/date return fields |
| `w_arg_pricetype_markup` | User-group-scoped price child retrieval, positive price-type validation and nonnegative mark-up |
| `w_arg_sdate_ldate_margin_markup_range` | Native start/end dates, criteria/percentages and original minimum/maximum validation |
| `w_arg_quotation_customer_remarks` | Distinct quotation/customer keys, remarks, validation focus and structure return |
| `w_select_case` | Packing-layout key, numeric OK/cancellation return and title-bar close |
| `w_arg_percentage_reduce_raise` | Caller-supplied caption, original Reduce/Raise ItemChanged wording, percentage validation and intervention/decimal return |
| `w_arg_zone_sdate_ldate_top_n_customer` | Editable zone lookup, native date range, separate customer-count buffer and original structure return |
| `w_sale_replace_custref` | Four original reference-column codes, numeric OK/-1 Cancel and safe title-bar cancellation |
| `w_arg_items_sdate_ldate_topn` | Alias/name search, available grid, sorted native selected list, All option, native dates, customer count and original key/flag return |
| `w_arg_sdate` | Specified native date/time; hidden ending date/customer buffer and original structure return |
| `w_arg_sdate_notime` | Date-only mask with source datetime type and today override after inherited Open |
| `w_arg_sdate_ldate` | Both native dates, original midnight/end-of-day defaults and unchanged range semantics |
| `w_arg_acc_sdate_ldate` | Account lookup and original dates/key return |
| `w_arg_antinortixitem_sdate_ldate` | Item lookup, empty primary retrieval then insertion, dates/key and visible failure cancellation |
| `w_arg_doct_sdate_ldate` | Editable doctor lookup with its distinct doctor-code child key |
| `w_arg_godown_sdate_ldate` | Godown lookup, dates and explicit untouched-null-to-zero return |
| `w_arg_manf_sdate_ldate` | Existing manufacturer surface with original external `Company:` caption |
| `w_arg_patient_sdate_ldate_old` | Patient lookup with the original patient display column and dates |
| `w_arg_region_sdate_ldate` | Editable region lookup and native dates |
| `w_arg_singleregion` | Region selection only; inherited dates remain hidden and are not returned |
| `w_arg_singlezone` | Zone selection only; no top-customer count buffer |
| `w_arg_sman_sdate_ldate` | Sales-person lookup with distinct child key and explicit null-to-zero return |
| `w_arg_subacc_sdate_ldate` | Subaccount lookup with original automatic ShowList and native dates |
| `w_arg_supp_label` | Supplier selection, source-visible `All:` checkbox and Boolean suppression flag |
| `w_arg_supp_sdate_ldate_old` | Editable supplier lookup, dates and original Classic date tab indices |
| `w_arg_user_sdate_ldate` | User lookup with distinct source data/display columns and dates |
| `w_arg_custgroup` | Customer-group lookup, dates and Boolean suppression/hide flags; hidden item-group model column stays hidden |
| `w_arg_batchno` | `Batch Number:` label and source text return through `d_arg_ref.refno` |
| `w_arg_containerno` | `Container No.:` label and the original required-value check |
| `w_arg_masterpart` | `Master Part No:` label with optional reference-text return |
| `w_arg_phoneno` | `Phone Number:` label with optional reference-text return |
| `w_arg_ref` | `Reference No.:` label and the original required-value check |
| `w_arg_smscenter` | `SMS Center No.:` label and the original required-value check |
| `w_arg_day` | Integer Day criterion, explicit header-band label and original scalar/Boolean returns |
| `w_arg_discperc` | Discount percentage with source 0-100 validation, decimal return and increment-one spinner |
| `w_arg_gstperc` | GST percentage with its own validation message, 0-100 limits and no spinner |
| `w_arg_scode_lcode` | Start/end codes, source-visible Alphabetical/Code Wise options and original ordering-flag branch |
| `w_arg_scode_lcode2` | Start/end codes with inherited hidden option visibility and the same original flag branch |
| `w_arg_sinvcode_linvcode` | Starting/last document numbers, field-local captions and original integer return fields |

The explicit registry validates the complete instantiated inheritance tree, not
only child-definition overrides. Source-hidden date fields, standalone captions,
checkboxes, radios and the price DataWindow remain attached and can be revealed
by their existing runtime properties. The price selector is context-local,
not an additional global mapping. Original radio groups and enabled state remain
authoritative; native options use DOM tab order in Modern. An original groupbox
provides a live caption without becoming a visibility container for its fields.
Hiding both an input and its source label removes their empty Modern layout row.

The fifteen single-lookup additions retain all fourteen inherited controls.
Their primary surfaces are context-local, except that manufacturer reuses its
already mapped global field contract. They do not increase the forty-seven
global or twenty-seven criteria-component counts. External source captions
remain the selectors' accessible labels across live updates and repaint.
Source child data/display columns, editability, required policy, ShowList and
positive width/row budgets remain authoritative. Zero width and absent row
budgets retain the shared selector defaults rather than invented limits.
The subaccount ShowList intentionally remains open after selection; Tab accepts
and dismisses it before moving to the next action. This is not an ordinary
dropdown that should automatically disappear on selection.
The region source is `d_region`; the customer-group source is
`d_arg_custrgroup`. Its hidden `itemgroupcode` model column is not an extra
visible criterion. The extra customer-count buffer is bound to the top-customer
owner, not to every owner using `d_arg_zone`.

The six reference-text owners use a scoped presentation contract for the
one-column `d_arg_ref` DataWindow (`refno`, `char(100)`), preserving each
external label without adding a global mapping. Their Open, acceptance and
cancellation paths are checked in both presentations. Only container number,
reference number and SMS center reject null, matching their recovered source;
batch number, master part and phone remain optional. Hidden inherited dates are
not returned or validated by these owners.

The six numeric owners add five context-local DataWindow bindings without
changing the global catalog. Original Open inserts one row; integer defaults
remain null and the two percentages begin at zero. Day explicitly binds its
`day_t` text to the source header band despite freeform processing. The mapping
gate still rejects an undeclared or incorrect label band.
For the two-field ranges, original `st_3` and `st_2` caption nodes move into their
corresponding field wrappers. Their DOM identities, live text and accessible
associations survive repaint. The hidden ending date instead binds its actual
`st_4` caption; it cannot claim the visible ending-code label.
Only Discount % has increment-one spin controls. Both percentages retain
inclusive 0-100 validation and their individual original error messages.
Rejected numeric drafts and ItemChanged vetoes remain correctable; no-row
percentage returns retain status -1. Source-required editing metadata does
not create whole-buffer validation for untouched defaults. Unused hidden dates
are neither returned nor newly validated. Range values are not reordered, and
no start-before-end rule is invented. The code-range handler's original
Boolean branch is retained even though its flag names do not directly describe
the visible Alphabetical/Code Wise options. Cancel and title-bar close cannot
reuse a previous successful numeric result.

Scoped acceptance guards run before original lookup keys are read. Actual
ItemChanged veto/retry, unmatched editable captions and duplicate-caption
selection are covered in both presentations. An explicitly selected duplicate
retains its own key; typed exact text retains the shared first-match rule.
Untouched null criteria still reach the original routine: only godown and
sales-person owners explicitly convert null to zero. Required editing metadata
does not become an invented whole-buffer requirement. Native date preflight
only covers dates consumed by each source OK handler; region-only, zone-only
and supplier-label owners do not consume their hidden dates.
Supplier-label `All:` stays visible, and `i_supress`/`i_hide` retain their
declared Boolean types despite their prefixes. Cancellation starts with each
new owner's structure; title-bar close cannot reuse an earlier selected key.
The item criterion preserves its empty Retrieve/InsertRow sequence. A failed
Retrieve reports its normal DBError and cancels before insertion rather than
leaving a success-capable empty dialog.

The three native-date owners retain the empty, hidden `d_arg_cust` buffer and
its source Customer caption. Its lookup binding is context-local, not an
additional global mapping or a new retrieval. The base preference still chooses
today at midnight or the configured starting datetime; the ending date defaults
to today at 23:59:59. The date-only owner's original Open deliberately replaces
that inherited starting preference with today. The fixture checks both branches.

Native datetime EditMask GetData now uses the same strict numeric-mask parser
as DataWindow editing instead of JavaScript date rollover. Supported numeric
masks determine day/month/year order regardless of regional settings or legacy
numeric destination placeholders. Impossible calendar dates, clocks, empty text
and trailing garbage return -1 without replacing the input or receiving value.
A date-only mask still returns the source datetime type at midnight.
Unrelated text/numeric conversion and unsupported mask paths are unchanged;
this is not a complete native mask-engine implementation. See the documented
[EditMask GetData contract](https://docs.appeon.com/pb2022/powerscript_reference/getdata_func.html).
That newer reference is documentation evidence, not a PB 12.5 runtime observation.

Scoped, idempotent guards validate every consumed native date into a temporary
value before the original OK handler can write its return structure. An invalid
ending date therefore cannot leave a partially updated starting date. Feedback
states the declared mask and returns focus to the retained input. Native inputs
expose `aria-invalid`, a themed error border and a forced-color dashed system
border; their base important border cannot override the error state. Successful
GetData clears invalid state, including after a change to another mask type.
Original date-range ordering is preserved: these owners do not impose
start-before-end, and no new ordering rule is invented. Open initializes their
own cancellation structure, so title-bar closing cannot reuse a previous
successful result.

Shared native KeyDown dispatch reaches the original Enter/Handle/Send routines.
Plain-control Send navigation now skips CSS-hidden and disabled controls, with
positive tab indices before natural DOM order. The source Enter handler cannot
also click a default button. Both-mode checks include a synthetic default-button
collision and disabled ending field; real typing verifies correction, focus,
single acceptance and keyboard Cancel. Escape does not close these three owners:
their source Cancel buttons have no Cancel shortcut, so that behavior is not
silently added. F4 calendar workflows still require separate acceptance.

The zone dialog explicitly places its source Zone caption and selector before
the native dates, then the customer count. Optional content-order declarations
must contain each field group, caption, DataWindow, additional frame, native list
and option exactly once; the primary frame and actions retain their fixed outer
positions. Data-label bindings
reuse existing standalone captions instead of duplicating them, and reject
unknown fields, non-form surfaces and duplicate associations. The original
Zone caption stays live as the selector's accessible label. Its editable
`ddd_zones` lookup retains source case policy, keys, ten rows and 100% width;
`d_arg_zone` is context-local, not a forty-eighth global mapping.

Both zone and count drafts must be accepted before the original ancestor
handler runs. An unmatched typed zone or invalid count remains available for
correction instead of returning the prior buffer. Original zero, negative and
null count validation keeps its message and count-field focus. An untouched
null zone still becomes zero (no zone filter), and the original default count
is twenty. Success returns the zone, both day-first native dates and count;
Cancel retains the source structure's zero status.

The customer-reference chooser preserves codes 1-4 and the original trailing
invoice-column instruction. It accepts a corrected selection before returning
its numeric code, while rejected choices cannot close with a previous code.
Open initializes only `message.doubleparm` to -1, matching explicit Cancel, so
title-bar closing cannot reuse a positive result from a previous dialog. The
untitled Modern dialog uses its live DataWindow label as its accessible name,
including after redraw; Close occupies a separate row above its data rather
than covering the field. No visible title or default/Cancel-button behavior is
invented. Real Tab sequences exercise the zone/date/count and reference/action
orders and modal wrap at every appearance size.

The item-selection owner keeps both selector ancestors and its original group
captions. Only its one-row search grid has a context-local form presentation,
with an explicit processing-style declaration that preserves source header
identities. The available grid and native selected list retain their source
events, sorted selection identity and hidden business keys. Original Enter and
double-click removal restore the correct available item: native Sort resets the
current row before the source deletes its temporary null row, without emitting
row-focus callbacks. OK guards the count draft, not the intentionally cleared
required search Name. Selected-only and All retain exact keys, dates and flags.
Failed all-items DataStore retrieval has explicit database feedback and cancels;
title-bar closing cannot reuse a previous successful structure.

Scoped, idempotent runtime corrections now prevent OK from returning a previous
buffer when AcceptText rejects the current draft. Quotation remarks are accepted
before their original validation/return script reads them. Packing's explicit
return handler also checks acceptance. Failed parent/price-child retrieval
reports its existing database error and returns the original cancellation type
instead of leaving an empty dialog able to succeed. A null price type now follows
the existing invalid-price-type message rather than slipping past `<= 0`.
Shared CloseWithReturn ignores already-closed windows, preserving
the completed result against late posted closes. Calls inside an active Close
handler still publish their return, as used by 71 recovered Close/CloseQuery
routines; a closing flag alone must not reject them. Packing initializes only its
numeric cancellation result to zero, including title-bar cancellation.

The percentage dialog preserves the original initial `Reduce ... To:` wording
and the later `Reduce/Raise ... By:` ItemChanged wording. Negative and over-100
drafts invoke ItemError, retain the draft and cannot return a stale percentage.
Corrected decimal input and the intervention code return through the original
structure; cancellation retains its original -1 status.

This exposed a shared native-object assignment defect: already evaluated text
was interpolated into a Modify command, truncating multiword captions and
allowing apparent assignments inside the text to be reinterpreted. Object
properties now use a literal setter. Modify still parses command strings;
both paths share case-insensitive keys, boolean normalization, ordered
visibility updates, table select/sort/filter side effects and version
invalidation. Spaces, quotes, empty strings, newlines and tilde text survive
without changing unrelated properties. The synthetic window helper waits for
EditChanged processing before invoking OK, rather than weakening the runtime's
pending-input rejection guard.

The focused fixture passes 1,908 assertions in both presentations and 304 appearance
cases, including narrow 200% layouts with inherited options both hidden and
revealed. It runs original Open, validation, OK, Cancel and posted-close routines;
covers corrected/rejected text, both native date return fields, six inherited
reference-text owners, six numeric owners, distinct keys,
failed retrieval, listener cleanup, list add/remove/re-add, date preflight
atomicity, preference branches and return-channel lifetime.
Real keyboard/pointer input covers alias case conversion, Enter/Handle/Send,
ArrowDown, F4, grid selection, native list removal and selection/acceptance in
all fifteen new lookup owners. Automatic ShowList remains open after selection;
real Tab accepts, dismisses the list and focuses the next action. Numeric checks
include invalid drafts, percentage boundaries, veto/retry, exact decimal/range
returns, no-row failure, live field-local captions and fresh cancellation.
Plain Tab traversal verifies the exact focused field node rather than assuming
that DOM focus must also change the model's current column. Preferences,
the user-group result and retrieval records are explicitly synthetic. Retrieval
SQL is removed from fixture metadata except the item-search definition, whose
GetSQLSelect text selects the original alias-procedure branch. A strict synthetic
procedure supplies only expected output references; no original query executes.
This does not verify real query results,
permissions, report generation, calendar-popup workflows, every native date-mask
variant or production completion.

## Current shared-validation and entry-workflow implementation

The shared contracts below have current unit/type and synthetic browser evidence;
complete production-workflow acceptance remains a separate gate:

- Validation/conversion precedes ItemChanged. Failed validation invokes
  ItemError directly. ItemChanged return 2 and ItemError return 3 discard the
  draft without overwriting stored values or script SetItem corrections.
  Navigation and native AcceptText distinguish discarded from accepted input.
- AcceptText inside ItemChanged is scoped to the interpreter's actual caller
  chain, including helper functions and ancestor calls. Unrelated concurrent
  acceptance cannot inherit that exemption; posted work starts a separate
  chain. No-object AcceptText succeeds.
- Empty-string-is-null flags and text limits are retained. Numeric syntax is
  checked before model coercion, and dates/times become typed runtime values;
  invalid input cannot silently become a zero, null, truncated string or
  malformed temporal value.
- Shared editors now honor `Edit.Case` (`any`, `upper`, `lower`) and live
  overrides before EditChanged, validation and ItemChanged. SetText uses the
  same case conversion for mounted and nonvisual drafts; SetItem and merely
  focusing a stored value do not rewrite its case. Case expansion is subject
  to the existing length checks rather than silent truncation. AutoSelect
  follows explicit Edit/EditMask flags rather than selecting every field.
  IME composition is retained without partial notifications or acceptance;
  completion converts once and preserves the caret through expanded text.
- FindRequired honors its row/column starting position, primary/filter buffer,
  modified-only flag and runtime Required overrides. End-of-search sets row to
  zero while returning success. It distinguishes empty strings from nulls.
- Live SetFocus opens the current editor without changing window-opening focus
  order. Keyboard navigation stops if a source handler redirects the row or
  column. Leaving a DataWindow retains the unaccepted draft; it does not by
  itself call AcceptText.
- Failed retrieves/updates dispatch DBError and retain the standard visible
  message unless the handler suppresses it. Nonvisual DataStores do not show
  a default dialog. Missing database connections report unsaved changes.

Authored browser cases now use the actual inherited aging negative-limit,
forward/backward duplicate-limit and required-description handlers. A separate
strict in-memory SQL call recorder uses four existing translations and the
original update-table metadata to exercise New Item, required-field rejection,
Delete Item, uniqueness checks, key propagation, existing-record master/detail
edits, save ordering and rollback on master/detail failures. It also checks that
a missing required description stops before SQL or writes. It has no database,
native bridge or external-server access. These cases pass; they are not evidence of PostgreSQL persistence
or production workflow parity.

Known boundaries: the recovered `f_validatedw` starts its search at RowCount
rather than row one; its business routine has not been rewritten. Transaction
DBError forwarding and exact SQL/error-row details are not implemented by this
change. Remaining selector variants, full native DataStore/no-editor equivalence,
locale-specific case/IME behavior, complete temporal mask/locale parity,
remaining screens and all print families remain open.

## Cashier-shift closing

`w_cashiershift_closing` now retains its five original controls in a Modern
modal, with the three DataWindows displayed as shift details, denomination
counts and closing figures. The denomination grid reuses its global mapping;
the other two forms are context-local. All source fields, computed values,
lookup keys, formatting and conditional visibility remain authoritative.
Closed shifts protect every source column and disable Close Shift.

Six explicitly bound horizontal separators preserve their source visibility.
Mappings reject missing, duplicate, vertical, reordered or non-detail lines,
and separators cannot be combined with form groups. They are decorative
structure, not substitute fields or invented business sections.

The real Open, posted initialization, validation, totals, closing and Cancel
routines run in both presentations. A strict synthetic transaction distinguishes
committed records from pending writes and rejects unexpected queries,
parameters, procedures and writes. Detail updates preserve their source
key-only predicate; cash-count updates preserve all-original-column predicates.
Both newly initialized denominations and existing cash counts are exercised.

The focused fixture has 72 assertions covering invalid quantities/amounts,
missing transfer accounts, cancelled authorization, unposted transactions,
backward/forward/failed server-date checks, successful closing, detail/cash
failure rollback and retry, closed-shift protection and failed opening.
Authorization is only a synthetic `w_salesmanpassword` result boundary, not
an exercised login or credential check. Server-date work retains its separate
`sqlca` transaction; these cases do not establish PostgreSQL persistence.

Two cashier-specific production class fixes are intentional:

- Three spurious outer returns in `cb_ok.clicked` prevented successful closing.
  The existing offline lifter confirmed the original bytecode guards continue
  at offsets 1028, 1628 and 6676; only their inner failure branches return.
  The parsed-source regression preserves valued returns and unrelated routines.
- Both `Update(true)` calls now use `Update(true, false)`. Original/dirty
  snapshots survive a later rollback, so retry cannot omit the already-issued
  detail update. A successful close destroys these window-owned buffers.
  This is a scoped reliability correction, not a recovered financial formula.

Modern plain-text activation resolves the current cell after source GetFocus
or Clicked repaint, with live model/record/focus guards across asynchronous
eligibility checks. Choices retain their separate single-activation route.
Keyboard activation likewise uses the fresh cell rather than a detached node.
The shared text editor consumes Escape before removing its input, preventing
the same keystroke from also invoking the window's native Cancel button.
An unconsumed DataWindow Escape can then reach Cancel; it waits for any mapped
key handler, respects return code 1, and cannot reclaim focus or cancel a
closing window. Controlled delayed-key cases cover this native routing boundary
in both modes; they are not additional recovered cashier business scripts.
The documented [DataWindow KeyDown return contract](https://docs.appeon.com/pb2022/datawindow_reference/dwevt_KeyDown.html)
supports the 0/1 behavior, but is not PB 12.5 native-runtime acceptance.

Eight appearance cases cover open/closed shifts, light/100%, dark/200%,
1366x768, 683x384 and 320x768. They check live readonly focus, exact 14/28px
text scaling, source visibility, contrast, actual quantity/transfer typing,
Cancel, two-stage Escape and one Enter-to-close sequence. The readonly
measurement reads the current focused DOM atomically after repaint rather than
assuming a previously resolved element handle remains attached.

Complete cashier-job supervision, upstream shift creation, hardware and production
settlement acceptance remain separate work. This modal does not complete the
cashier role, and Modern remains opt-in.

## Multiple-invoice cash tendering

`w_cashierjobactivity_cashtendered` now retains all six original controls. Its
context-local Modern mappings place `dw_header` before `dw_cash`, followed by
Print, OK and Cancel. The original source-hidden `dw_print` remains attached
through an explicit auxiliary binding. Auxiliary bindings accept only retained
DataWindows and participate in the same missing/duplicate/unsupported-control
gate; no report is relabeled as a Modern form or silently discarded.

The header keeps source order, the sorted Sale/Sale Return choice keys, readonly
amounts and the signed `c_total` expression. Cash Tendered remains editable;
Cash Charged and Cash Back remain readonly. Source labels, `[general]` payment
formatting, null initial values, transaction ownership and return channels remain
unchanged. The window owns its entry buffers and receives a row-ID argument;
it does not share the associated-invoice picker's caller buffer.

The 101-assertion both-mode fixture executes original Open, document lookup,
validation, balance, supervision, Print and closing routines. It uses the real
`ProcCaller`, built production procedure signature and exact translated SQL.
Unknown queries, parameters, direct writes, procedures and transaction boundaries
fail the fixture. Synthetic cases cover missing/assigned/supervised documents,
duplicate module/document pairs, sale-return totals, invalid or cleared tender,
the exact absolute tender required for net returns, Cancel, connection/job
failure, row-ID versus empty-document preferences and keep-open success/failure.

Supervision commits **per document**, not as an atomic batch. A failed second
procedure leaves the first committed. The original keep-open preference also
resets the buffers after failure when set to `Y`; this behavior is recorded,
not silently changed or described as full draft recovery. The ordinary Sale and
Sale Return choices are covered; alternate activity insertion for ModuleID >100,
actual stored-procedure side effects and complete cashier settlement remain
outside this synthetic acceptance boundary.

The fixture exposed a shared FOR-loop error: completed nonempty loops left their
counter at the last executed iteration. In the recovered 934-byte
`wf_superviseall`, offset 22 increments `ll_counter`, offset 60 tests the bound,
offset 372 loops back to 18, and offset 388 tests `ll_counter > 1` before printing.
The offline lifter reported no problems. The interpreter now stores the next
counter before testing the limit, matching this bytecode and its existing empty
loop behavior. Unit cases cover forward/backward/zero-iteration loops, fractional
steps, changed limits/counters, Continue and non-incrementing Exit/Return.
Single-document Print now reaches both original report variants. The fixture
retains row-ID arrays, tendered retrieve arguments and hidden Classic metadata,
but intercepts the final print request; it neither prints nor accepts a template.

The original final-blank-row RowFocusChanging veto is now honored by pointer,
Tab and Modern grid navigation before selecting another record. Shared admission
waits once and guards source/destination identity, selection, lifetime and focus.
Controlled delayed results verify rejection, accepted movement, replacement rows
and newer external focus. Original Ctrl+I/Ctrl+D, Enter and Escape are exercised;
real browser pointer input also verifies that a rejected row change cannot open
an editor in another record.

Eight appearance cases cover net sale/return, light/100%, dark/200%, 1366x768,
683x384 and 320x768. They exercise real tender typing and Cancel, exact source
display text, 14/28px readonly text, visible action focus and contrast. Null
cash values cannot satisfy the zero-change assertion. This remains opt-in
synthetic UI evidence, not native/database/hardware or production acceptance.

## Cashier category changes

`w_cashierjobactivity_changecategory` now has a context-local nine-field Modern
form and retains all three original controls. Invoice number, remarks, amount,
charged cash and change remain readonly. Category, account and supervision
choices retain their source lookup/code-table keys and become protected when
charged cash equals the amount. Tender calculations and the original cash/credit
account defaults remain in PowerScript, not in the presentation mapping.
The focused fixture passes 112 both-mode assertions, including the inclusive
zero-tender boundary, exact fractional change and unchanged OK with a read-only
commit and no update or supervision.

The original current-user group lookup runs on `sqlca`; the activity, account
child and permission RPC use the modal's owned transaction. The fixture uses the
real `ProcCaller`, the original padded INOUT permission buffer and built
production SQL/signatures. It distinguishes ordinary customer-only filtering,
allowed customer categories and a valid `0` no-permitted-category response.
Unavailable activity data, failed group/permission queries and blank permission
responses close with explicit feedback and a negative return. A failed account
retrieve reports the database/choice errors without substituting an unfiltered
list.

Source-backed tests exposed a shared joined-column retrieval defect:
`Accounts.Name` and `SubAccounts.Name` both arrive with SQL column name `name`.
When the result count matches the DataWindow, duplicate/aliased names now retain
source positions; only complete unique names qualify for name-based reordering.
The account's display name no longer becomes its subaccount label.

Scoped, idempotent runtime corrections intentionally harden error paths without
changing balance calculations or procedure arguments. OK checks AcceptText
before either save route. An explicit supervision value of `N` still uses the
original DataWindow update with original-value predicates, excluding the derived
`Posted` expression. Its dirty/original snapshots are retained until the modal
closes; failed updates roll back the owned transaction before a retry.
Supervision value `Y` still calls the original RPC with actual tendered, charged
and change amounts, not the multiple-invoice window's substituted amounts.

Commit exceptions retain the dialog and edits, report the problem and attempt
rollback. The message explicitly says that the save could not be confirmed and
the document must be checked before retrying. A simulated lost acknowledgment
after a successful commit verifies that the UI does not return acceptance or
automatically repeat the posting; rollback cannot undo an already committed
document. Failed Open returns cannot confuse an input row ID of `1` with the
caller's acceptance sentinel.

Keyboard checks execute the real registered Handle/Send implementations, not
the generic system-function placeholders. Both-mode original Enter and real
browser Enter, account selection, draft Escape and window Cancel are covered.
Eight cash/credit appearance cases cover light/100%, dark/200% and enlarged
narrow layouts. A visible focused form field is revealed again if repaint
changes its geometry; intentionally scrolled-away fields stay offscreen.
Visibility admission allows one CSS pixel for rounded scroll/client sizes,
while final appearance assertions still require the entire focused value inside
the viewport.

These are synthetic transport and browser checks, not stored-procedure,
PostgreSQL, packaged WebView2 or production cashier acceptance. The monitor's
original entry route only admits existing activities with ModuleID below 100.
Alternate activity insertion and the complete cashier monitor/job workflows
remain separate work.

## Transaction calculator dialogs

The retained-control modal renderer now supports context-local DataWindows.
`w_discountcalculator`, `w_pricecalculator`, `w_qty_rate_value_calculator`
and `w_set_flatdiscamt` keep
their original controls, default/cancel buttons, caller arguments, Open,
ItemChanged, ItemError and CloseWithReturn scripts. Their forms preserve all
28 source field/calculation objects and labels, including hidden bindings.
No financial formula or
business script is duplicated in the presentation layer.

The quantity calculator also introduces explicitly bound form groups. Group
membership must account for every field exactly once, in presentation order;
missing, additional, duplicate or changed objects retain Classic. Source group
captions stay live. A hidden groupbox removes its decoration/caption, not its
independently visible fields. This is not an automatic coordinate-based
grouping or permission to omit unlabeled decorations.

The discount calculator preserves its source Flat/Percentage keys, original
net-rate validation, calculated discount and caller return structure. A mixed
caller mode reveals the source-hidden radio field; a fixed-discount caller
keeps it hidden. Its stored discount, sale price, pack units and unit-price
compute remain hidden rather than becoming extra editable fields.

The calculator fixture executes the original scripts with four exact
statement translations and the invoice calculator's constant-row retrieval.
The synthetic database rejects all other queries, writes, procedures and
commits. Quantity precision comes from a synthetic preference DataStore and
the recovered preference functions. Coverage includes invalid rates and
quantities, the inclusive GST boundary, the exclusive discount boundary,
source rounding, quantity/rate/value propagation, original return structures
and Cancel sentinels. Browser input also checks one ItemChanged per edit and
one Clicked per OK action.

Preview activation captures the current runtime/catalog/query/global state and
restores that activation's snapshot on close. It cannot remove event routes
registered by later fixtures. Sixteen calculator appearance/input cases cover
light/100% and dark/200% at desktop and narrow effective widths. They check the
fresh focused element and accepted buffer value together, including complete
field visibility, rather than assuming acceptance means navigation has finished.
Passive numeric-editor repaint also preserves draft, selection and ancestor
scroll positions.

These dialogs do not complete their parent sales or purchase workflows.
Editable customer/supplier selectors,
remaining transaction and grouped/trailer bands, cashier hardware, real database persistence
and production acceptance remain separate open work. Modern remains opt-in.

## Guarded DataWindow radio choices

Reviewed standalone radio styles use the shared choice editor in both modes.
The native fieldset retains source code-table order, keys, captions and column
count, with one Tab entry, Arrow-key selection and visible keyboard focus.
Radio glyphs inherit the selected text size, and focus uses the current theme's
accent rather than the legacy system highlight. Active focus reveals the whole
option label after repaint; passive repaint preserves deliberate scrolling.
Modern options reflow without changing their order. Unknown or null stored
keys remain unmatched; opening a field never selects or writes a default.
Inactive text casing, edit limits and NilIsNull do not rewrite radio keys;
schema limits and original validation still apply.

Each changed choice invokes the original acceptance path once. Successful
changes leave the native group available; explicit AcceptText or Tab closes
it without replaying the accepted key. Rejection, SetText, repaint, loading,
concurrent acceptance and stale configuration retain the existing draft/error
guards. Escape cancels an unapplied draft without cancelling the window.

Restoring focus after acceptance must not reopen the editor. Static pointer
options stay attached until click selects the requested index, including zero.
Tab-only entry synchronizes the source column and ItemFocusChanged without
inventing a Clicked event. Both presentations use live field eligibility and
TabSequence for backward navigation to a source-revealed radio field.

Explicit Modern mappings currently accept radios only in form surfaces with
the reviewed source column count. Mixed selector styles, left-side captions,
unknown radio properties, radio grids and detailed radio lookup layouts
remain unsupported. Unsupported configuration cannot silently become a free
text editor; it retains compatibility or reports the editing limitation.

## Standard single-entry layouts (synthetic coverage)

The entry registry now explicitly names 43 direct `w_single_entry` descendants
whose recovered form and list each contain Code and Name/Description. Every
mapping retains all 22 inherited control paths, including the initially hidden
`dw_print` and `dw_listprint`. Detail placements are checked for omissions and
duplicates as well as missing, additional, moved or differently typed controls.
Unexpected structures retain the whole compatibility layout.

The families are accounts (1), customer components (2), employee (5),
prescription basics (7), guest components (3), patient components (3),
sale order (2), service components (2), service modules (1), single-entry
masters (11), item masters (3), and student components (3).
`web/src/ui/window-surfaces.ts` is the exact class/DataWindow/label catalog.
Source titles, including existing odd captions, are not corrected by the
presentation layer. Hidden table columns remain in the model, not new fields.

The 86 form/list bindings are **control-local**, not added to `DATA_SURFACES`.
Other uses of these DataWindows, including print companions, do not acquire
the new layout. The adapter reuses the original controls and shared runtime;
it does not replace menus, validation, save/retrieve routines or persistence.
Find, criteria, shared appearance, guarded tabs and keyboard ordering reuse
the existing entry adapter. Hidden print controls remain reachable if scripts
show them; their contents and output still use the Classic path.

Authored checks inspect all 43 exact inherited trees and DataWindow label
bindings. The synthetic browser fixture covers each window in both modes,
initial selection, case-aware edits, Save availability, Cancel on guarded List
navigation, source labels, cleanup and structural fallback. Representative
cases exercise the actual inherited sort/filter/ascending-text Find routines,
required-field helper, IME completion, and context isolation from print
companions. Eight additional appearance cases cover Detail/List, light/100%
and dark/200%, including 683px and 320px effective widths.

These fixtures deliberately omit concrete-window business scripts and
open/retrieve/save/print execution; the selected inherited UI routines run
against synthetic buffers and menu state. This coverage passes in the current
5,345-assertion matrix. The 43 mappings are not 43 accepted workflows.
Native PowerBuilder 12.5 case/locale and IME
parity still need comparison; the implementation follows the documented
[Edit properties](https://docs.appeon.com/pb2022/datawindow_reference/XREF_71002_Edit_property.html)
and [SetText contract](https://docs.appeon.com/pb2022/datawindow_reference/dwmeth_SetText.html).

## Guarded choices and Contact Group (synthetic coverage)

The initial `dw/choices.ts` subset covered noneditable,
non-show-list dropdowns and unsorted code tables. `ui/dw-choice-editor.ts`
uses native select options indexed independently of their data values, so
null, empty strings, numeric zero and duplicate display labels do not collapse.
Inactive text-case properties cannot change selected keys. An absent current
value gets an explicit placeholder, never the first available option.

Selections use shared validation and ItemChanged/ItemError decisions.
Rejection and script SetText corrections retain the pending selection.
For these noneditable choices, native GetText reads the data-key draft, not the displayed label. Blur does
not accept; keyboard and pointer navigation await acceptance, and Escape
cancels outside an in-flight acceptance. Repaints retain the same select
instance without taking focus back from another control. Failed automatic
lookup retrieval is cached until an explicit Enter retry, not retried by every
repaint.

Asynchronous commits check parent model/record/column, editability, dropdown
configuration and the selected child row's identity, key and label. Destroyed
children cannot supply accepted options. GetChild honors dynamic lookup names;
replacement, parent model replacement and destruction invalidate owned child
controls and detach their repaint callbacks. A late definition load cannot
reattach a destroyed child. Modern retains stale entries for copying rather
than applying them to the replacement record.

`w_contactgroup` retains all 23 inherited controls. Its control-local
`d_contactgroupdetail` grid maps 11 source presentation objects: serial number,
contact-card choice, contact detail fields, readonly SMS choice and website.
Hidden `code` and `acccode` remain model fields, not invented visible columns.
The master/list reuse existing global mappings; the member grid is not added
to the global catalog. Wide grid cells and headings are capped
against their own viewport so focus can be revealed at narrow effective widths.

Helper/native tests and both-mode synthetic browser fixtures pass.
The contact fixture uses sanitized metadata and synthetic child rows, executing
the actual ItemChanged, ItemError, ItemFocusChanged, duplicate-member helper,
`wf_validateitem` and `wf_setcontactdetails` paths. It checks ten-field
propagation (including the hidden account key), duplicate correction, pending
text, guarded pointer transitions, retry, stale parent/child/configuration
changes and lifecycle cleanup. Twelve appearance cases cover Detail, Choices
and List at light/100% and dark/200%, including 683px and 320px widths.
The detailed-browser slice below adds four Lookup cases to that matrix.

This is not complete Contact Group business acceptance. Its real window-open,
contact-selection dialog, uniqueness SQL, Save/Retrieve and Print paths are
not executed by this fixture. The native select presents the configured display
column; the reviewed Modern browser below is not a general replacement for all
multi-column DataWindow popups. At that stage, editable, sorted, always-visible, checkbox/radio
and other lookup interactions, exact
PowerBuilder 12.5 key/text semantics, packaged WebView2 behavior and production
persistence remain open. Local browser evidence does not close these gates.

## Editable DataWindow lookups

The shared choice editor now supports reviewed popup DDDWs with
`dddw.allowedit=yes`. `d_arg_manf` and `d_arg_manf2` add explicit Modern
Manufacturer forms; their original required/optional distinction and numeric
`manfcode` key remain unchanged. Both Classic and Modern use the same editor,
child model, validation and source-event path.

GetText/SetText and ordered EditChanged carry editable display text. Typing does
not write a key or commit the first prefix match. An exact typed display match
resolves to its code-table key before ItemChanged; repeated typed labels use
the first matching row. Explicit selection preserves the chosen row's key, and
an untouched repeated label preserves its original key. Unmatched input goes
through ordinary typed-column validation and ItemError. Inactive `edit.limit`
does not truncate lookup keys; schema limits remain authoritative.
The lookup's own typing limit cannot reject an explicitly selected longer
display label.

The input retains DOM focus while its named top-layer listbox exposes the
active option. Arrow exploration moves the original child's current/selected
row without overwriting typed text. Enter selects; the first Escape dismisses
the popup and the second cancels the entry. Tab waits for validation. Original
`ue_dwnkey` handlers and posted EditChanged work settle before an unconsumed
popup key acts. A source Enter handler that SetItems its own selected child key
does not cause a duplicate ItemChanged.
Typed Enter runs the declared `ue_enterkey` continuation after acceptance,
rather than replacing it with an extra Tab. Popup selection cannot overwrite
an unfinished IME composition.

Lookup casing, limits, source SetText corrections, IME completion, explicit
load retry, concurrent acceptance, deleted child rows and copyable stale
configuration are covered. Repaints retain the input and text selection.
Editable lookup casing is part of the explicit UI binding: changing the source
case policy during composition now preserves a copyable draft and blocks
acceptance until the user discards it. Unsupported policy changes cannot
silently continue through a stale editor.
Classic's asynchronous row fill restores an open popup only while its input
still owns focus; a paused-paint case prevents reclaiming newer external
focus. A metadata correction treats `initial="Null"` case-insensitively before
numeric conversion, so real manufacturer argument fields start as null rather
than NaN.

The integration fixture executes the recovered sale `wf_setcustomername`
routine on synthetic child rows. Its source-Enter and manufacturer validation
routes are controlled synthetic harnesses, not full sale/purchase scripts or
accepted transactions. The code-table rule is corroborated by
[official code-table documentation](https://docs.appeon.com/pb2025/pbug/ug22759.html);
that newer reference is not PB 12.5 runtime verification. Popup semantics also
follow the [ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

Five appearance cases cover light/100%, dark/200%, 1366/683/320px widths and
a 220px-high pane, now with 1,004 synthetic choices.
The preview owns a separate control/view so the source window's fixed geometry
cannot overwrite its viewport-bound host. Checks include the complete input
and toggle bounds, accessible name, focused/active option, text contrast and
repeatable disposal. Large popups now use bounded variable-height rendering;
see the windowing slice below. This is separate from the detailed browser's
explicit search and paging.

The later selector slice below extends this shared editor to focus-open lists
and editable DDLBs. Remaining editable lookup layouts and full
cashier/sale/purchase workflows are separate work. Neither the shared primitive
nor these argument forms establishes coverage of all 305 inventoried editable
DDDW fields.

## Focus-open lists and remaining recovered selector variants

DataWindow DDDW/DDLB `ShowList=yes` means opening the list when the column gains
focus, not a permanently expanded panel. It hides the down arrow even with
`UseAsBorder=yes`. This follows the official
[DDDW](https://docs.appeon.com/pb2022/datawindow_reference/XREF_54577_dddw_property.html)
and [DDLB](https://docs.appeon.com/pb2022/datawindow_reference/XREF_16948_ddlb_property.html)
property definitions; native window DropDownListBox controls have a separate
ShowList contract. The recovered catalog contains 206 DDDW and 19 DDLB
focus-open field occurrences. All 3,002 recovered DDDWs specify
`HSplitScroll=no`; dynamic split-scroll requests remain explicitly unsupported.
These are metadata counts, not accepted workflows.

Readonly automatic choices use a named readonly combobox and the shared
top-layer popup. Arrows, Home/End, Page Up/Down and prefix/repeated-letter
search browse without changing the parent value. Enter or Space selects the
original key and retains the focused list; Tab accepts and navigates. Source
key handlers can veto normal browsing. Rejection, loading/retry, removed child
rows, redraw and newer external focus retain their existing guards. Editable
automatic lookups preserve typing, IME and two-stage Escape. A pending source
SetText correction can accept an unmatched valid value without dereferencing
a missing choice or falsely reporting failure after a successful write.
Drop-down lookup widths honor the recovered `DDDW.PercentWidth` column-width
percentage, while clamping oversized popups to the visible viewport. Reviewed
global bindings record their exact percentage so source metadata changes cannot
silently alter popup geometry.

Readonly, non-ShowList lookups with an explicit percentage or positive row count use the same
controlled popup instead of a native select with browser-chosen geometry.
They stay collapsed on focus, show a readonly display label, and retain the
original data key for GetText/SetText and acceptance. Browsing does not change
the parent value or the child DataWindow's buffers, current row or column.
Enter/Space accepts once; Escape dismisses the list before cancelling the
field. F4/Alt+Down gives the detailed browser precedence when one is available;
the popup toggle and detail action no longer overlap. Null, zero, unlisted
keys, duplicate labels, loading/retry and source vetoes retain their guards.
A source binding change preserves a pending readonly SetText key in the
copyable recovery panel, whether acceptance happens before or after repaint.
Source-directed row/column transitions still follow normal validation; they
are not mistaken for a changed choice policy.
Unconstrained, noneditable, nonautomatic choices still use native selects.

Five additional global mappings retain every source field and hidden key:

| Definition | Reviewed presentation |
|---|---|
| `d_arg_genericitemtype` | Focus-open Generic Item Type lookup; F4/Alt+Down opens its actual Code/Name/Description detail browser |
| `d_changeitem_price_marginbased` | Margin base and both percentage limits, retaining sorted source keys |
| `d_change_purinv` | Thirteen-column purchase-change grid, including editable Page Size, department auto-opening and the original due-date compute |
| `d_customer_category` | Five-field category form, including the exact customer-segment lookup and both left-caption sale flags |
| `d_stockleder_inputs` | Both original left-caption maintenance flags, without executing maintenance |

`d_change_purinv.purinvpagesize` is the sole recovered editable DDLB. It shares
display-text/key separation, source case/typing-limit policy, ordered
EditChanged, GetText/SetText, IME and stale-draft ownership with editable DDDWs.
Full/Half/Quarter resolve to F/H/Q. Freeform text still goes through the
one-character schema and original validation; blank retains source NilIsNull.
Selected keys are not rewritten by inactive Edit.Case/Edit.Limit settings.

All four recovered left-caption checkboxes preserve exact captions, Y/N keys,
mixed-state display, source protection and single pointer/Space activation.
Modern captions wrap while the native checkbox remains on their right; its
focus ring and rejected proposed state survive repaint. Classic also retains
the source caption beside its focused native editor. Horizontal grid movement
keeps status text aligned to the viewport instead of scrolling it out of view.

The synthetic selector runner includes 12 automatic-list and 28 additional
selector appearances at light/100%, dark/200% and desktop/narrow/short sizes.
The email Subject auto-opening example uses a fixture-only contextual
`d_emailsubject` binding; it is not a global mapping or an accepted email
workflow. No customer permissions, invoice persistence or stock maintenance
are performed. The purchase due-date expression still uses the shared
evaluator/formatter and its unchanged source mask. A separate synthetic native
engine probe confirms that its date-only result with `dd/mm/yyyy hh:mm`
must show missing time as `??:??`, not literal hour tokens or invented midnight.
Both presentations now retain those markers while preserving the Date result
and the original invoice DateTime. Twenty-two exact native observations cover
RelativeDate, leap-day and year-end values, minute/month context, missing time
tokens and one-, two-, three- and six-digit fractional masks; all match the shared expression
engine. The formatter comparator no longer silently excludes question-mark
output. See `FIDELITY.md` for the native probe's identity and scope; this is
separate from the browser fixture's no-native-access boundary.
Remaining dropdown input/scrollbar properties, multi-column inline layouts,
native scrolling, packaged-device performance and production acceptance remain
open. Bounded popup DOM rendering is covered below.

## Source-sized lookup rows and paging

Positive `DDDW.Lines` values now travel through the shared lookup binding,
editor and every affected global/contextual mapping. Invalid, fractional or
out-of-range settings fail explicitly; supported counts are integers up to
32767. Live changes fail the reviewed mapping gate and retain pending keys
before or after repaint. The five-line purchase-type lookup now uses a
readonly popup even though its source has no explicit width, without changing
the child buffer, row or column during browsing.

The popup measures a single-line option under its actual font and presentation,
adds its padding and borders, and caps the result at the available space above
or below the input. Wrapped labels consume more of that budget instead of
widening the popup or hiding their text. Fewer loaded values do not create
empty rows. Missing or zero Lines retains the previous bounded fallback
(320px for existing custom popups); the native meaning of zero/default sizing
has not been established. DDLB does not acquire an undocumented Lines policy.
The recovered metadata and
[DDDW property reference](https://docs.appeon.com/pb2022/datawindow_reference/XREF_54577_dddw_property.html)
support the positive-count contract, not a claim of native PB 12.5 pixel parity.

Page Up/Down moves through the actual rendered row geometry, including wrapped
labels and clipped viewports, rather than a fixed ten choices. Original key
handlers may veto it; paging does not type, accept a key or move DOM focus.
Enter still accepts the highlighted original key once. Options retain their
DOM identity while retained across navigation, reopening, remounting and
source-driven parent/child redraws. Large-list windowing may evict offscreen
options; the active descendant and selected state remain distinct from the
accepted parent value.

Both-presentation checks cover 100%/200% text, placement above/below, counts
3/7/15/32767 and the fallback, wrapped labels, source key vetoes and stale
row-policy recovery. A 10,000-choice fixture verifies nearby node reuse and
bounded windowing. Real manufacturer appearances use 1,004 synthetic rows and
its source seven-line budget, including 320px width and 220px height.
Scrollbar policy, AutoHScroll, native sizing/defaults and assistive-technology
acceptance remain open.

## Bounded large-lookup rendering

The shared popup now windows lists with more than 100 choices. It renders the
visible range, eight overscan rows on either side, and at most one separately
pinned active option. The retained node cache is bounded by the same range;
scrolling through the list does not accumulate detached options. Lists of
100 choices or fewer retain full rendering and their existing node identities.
Empty lists retain their explicit message without inventing a selection.
Reopening with a smaller list discards the old virtual dimensions.

`dw-choice-rows.ts` maintains measured variable heights in a prefix-sum index.
Labels continue to wrap without line clamping. Actual row measurements preserve
the current scroll anchor, including the bottom edge; width, font and scale
changes reset estimates and measure the visible window again. Scroll rendering
is coalesced per animation frame and cancelled when the popup closes. Index
queries and individual height updates are logarithmic, but the complete choice
array and numeric height arrays remain O(N). Source validation and full-set
typeahead are not claimed to have logarithmic cost.

Every retained option exposes its original position and full set size. The
active descendant remains mounted even when the user manually scrolls away.
Manual scrolling neither selects a value nor changes the source cursor.
Home/End, measured Page Up/Down, prefix/repeated-letter search, duplicate labels
and distant pointer acceptance retain original indices and exact keys. Editable
browsing still updates its source child cursor; ordinary readonly browsing
still leaves the child buffers, row and column unchanged. Source redraws reuse
overlapping nodes without replacing the input, its draft or its focus.

Both-mode browser checks include empty/one/100/101-choice boundaries,
10,000-choice wrapped/unwrapped lists, distant scrolling, active-node pinning,
font/width changes, remounting, duplicate-label navigation, stale-policy
recovery and real Manufacturer/Customer Segment definitions with 1,004/1,002
synthetic rows. The focused run passes 840 assertions and 45 appearances.
The final local 10,000-choice probe creates 12-16 option nodes, rather than
10,000, in its three measured scenarios. Opening took 2.0-9.5ms versus
155.3-181.2ms in the saved baseline; these are individual local observations,
including cold-start effects, not statistical or packaged-device guarantees.
All keyboard and source acceptance guards remain in the shared editor/runtime.
This does not complete inline multicolumn layouts, scrollbar policy, native
scrolling, assistive-technology or production-workflow acceptance.

## Detailed contact lookup (synthetic coverage)

The mapped contact-card field now adds a named browse button and F4 / Alt+Down
beside its shared readonly combobox. Ctrl+F4 remains available to the containing
window. `CONTACT_LOOKUP_SURFACE` reviews all eleven presentation columns of
`ddd_contactcardlist`, in source display order, retaining the original
`Contactcardname` header. The non-presentational `acccode` and `accountname`
fields are not added to the grid, details or search.

`ui/dw-lookup-dialog.ts` provides a loaded-record browser through the existing
tracked `PresentationUi` presenter. It inherits current theme, density and text
scale, contains keyboard focus and blocks parent commands. It does not retrieve,
filter, sort or reposition the native child. Search uses visible loaded values,
including SMS code-table labels; option indices remain tied to the original
records even when names repeat. Formatting is requested in bounded 50-row
pages, only the current page is rendered, and an expandable selected-row
section exposes full long values.

Arrow keys inspect cells, Home/End move within a row, Ctrl+Home/End reach the
first/last result, and PageUp/PageDown move by a page. Enter in search moves to
the grid rather than committing an unseen first match. Enter in the grid or
Select returns an original option index; Cancel/Escape returns no selection.
The picker closes before the selected key enters the shared acceptance path,
so original validation can open its own dialog without competing modality.
Rejected selections retain the native draft. Programmatic AcceptText is blocked
while browsing.

Parent/control or child notifications close obsolete browsers; editor abort
and owner disposal cancel loading as well. Native child destruction now notifies
its owner once before releasing subscriptions. Guards additionally snapshot the
displayed child values and definition/overrides, preventing a decision based on
stale extra details from reaching the parent buffer. Picker teardown does not
redirect focus from Modern's retained unapplied-entry control to shell search.

Static hidden columns are omitted. Unreviewed child objects, nested selectors,
dynamic visibility/headers or masked/non-general formats keep the basic list
with an explicit warning instead of silently dropping information or searching
concealed values. This conservative gate deliberately does not claim support
for arbitrary computed/formatted lookup layouts.

New authored coverage includes exact source headers, hidden-field exclusion,
duplicate-name disambiguation, cancellation/rejection, source validation
modality, stale details/configuration, child destruction and owner closure.
A standalone browser fixture covers 10,003 loaded rows, bounded DOM/formatting,
keyboard paging, no matches, long multilingual literal text, error/shape
failures and late results. Four additional appearance cases inspect all eleven
columns and expanded values at light/100% and dark/200%, including 683px and
320px widths: sixteen Contact Group cases in total. These cases and the related
catalog/native tests and type checking pass. Real Tab traversal covers the
search, roving grid cell, expanded-detail summary and footer actions; scrollport
measurements exclude borders. Packaged WebView2 behavior remains unverified.

## Guarded checkboxes and richer masters (synthetic coverage)

The shared closed-choice editor now supports reviewed two-value checkboxes
with real native inputs, not a hidden select or a direct buffer toggle.
Stored null/unknown values remain distinguishable as mixed; merely leaving
an unchanged field does not turn them into the configured off value.
GetText/SetText use the original on/off data keys rather than DOM indices.
Focus, SetFocus, Tab, F2 and redraw do not toggle a supported checkbox.
Pointer activation and Space select a key through the existing guarded
ItemChanged/ItemError path. Rejection retains the native draft and script
corrections; concurrent acceptance shares one write. Initial activation waits
for loading/ownership, and a pointer destination waits for prior acceptance
and source focus events without toggling a replacement record.

Checkbox signatures include on/off/caption properties and newly added selector
styles. Runtime readonly/disabled state and record/control identity are checked
around asynchronous validation. Inactive text-case, Edit.Limit and NilIsNull
settings cannot rewrite configured checkbox keys; schema size and existing
validation still apply. Unsupported mixed/three-state styles and unreviewed
left-caption layouts remain outside the Modern mapping gate.
Classic retains its inactive checkbox appearance; mapped Modern fields use
theme tokens and checked/mixed semantics. List cells retain grid roles and
readonly checkbox state. Detailed lookup grids do not yet admit checkbox
columns because their display/search contract needs separate review.

Three explicit `w_single_entry` mappings retain the original inherited controls
and hidden print companions:

| Window | Detail fields | List display order |
|---|---|---|
| `w_checklistitem_form` | Code, Name, Auto Check (`Y`/`N`) | Name, Code, Auto Check |
| `w_shift_form` | Code, Name, Description | Computed S No., Code, Name |
| `w_taxcategory_form` | Code, Name, Tax % | Name, Code, Taxperc |

Shift's hidden `tmp` data column is not exposed, and its serial number remains
the original `GetRow()` expression. Tax Category retains the original
`authorcode_t`/`remarks_t` label identities and `Taxperc` list wording.
That slice brought the registry to **46 single-entry mappings and 48 entry mappings overall**.

Authored regressions cover exact metadata/control trees, checkbox value identity,
inactive text properties, focus/Tab/F2, one-click selection, SetText, retained
rejection, concurrent acceptance, stale configuration/records, destruction and
queued pointer destinations. The both-mode fixture uses the actual inherited
UI routines and synthetic rows; concrete-window duplicate queries,
save/retrieve/print and persistence are still excluded. It also covers the new
description/decimal fields and readonly computed/list fields.
Twenty-four additional Detail/List appearance cases cover the three masters
at light/100% and dark/200% across 1366px, 683px and 320px widths. Auto Check
adds real browser Space and pointer transitions. The single-entry appearance
matrix contained 32 cases at that stage; the current expanded single-entry
matrix has 48 passing cases. These mappings are not accepted
production workflows or evidence of full checkbox/native parity.

## Sorted choices, multiline editing and Contact Card (synthetic coverage)

Contact Card (`w_contactcard_form`) now has explicit control-local Modern
detail/list layouts. It brought the registry to 49 entry mappings at that point,
including 46 single-entry windows. Its complete 24-control tree retains the
inherited Detail/List criteria and Find controls, hidden detail/footer/item-list
companions, and the added hidden `dw_print` with its recovered
`d_visitprescription_print` association. No print binding was replaced.

Detail preserves Code, A/c Name, Title, Name, Address, Phone, Fax, Email, Mobile,
Use for SMS and Web in source order. The eleven-column readonly list retains
Account Name in place of the hidden account key. The account selector uses
`ddd_allaccountslist_null` and the shared basic native selector; its nested
alert lookup is not silently admitted to detailed browsing.

Sorted Title and SMS choices declare their ordering in the mapping gate.
The editor uses the same stable, case-insensitive locale comparison as native
dropdown controls without reordering source metadata or changing data keys.
The code-table parser handles doubled slashes found in the recovered titles,
preserving M/S, C/O and H/Dr., empty keys, duplicate labels and first-tab pair
boundaries. Sort-setting changes invalidate a pending selection. These are
source-backed authoring decisions, not measured Windows locale or vendor
escape-parser equivalence.

The shared text editor now creates a real textarea for plain string Edit fields
with explicit horizontal auto-scroll off and vertical auto-scroll on. Password,
code-table, masked, radio and unrecognized scroll settings are excluded.
Modern additionally requires an explicit form-only multiline binding. Address
is the first such binding; list virtualization and single-line list geometry
are unchanged.

Untouched source line endings survive focus, redraw and acceptance. Textareas
display LF internally; newly edited text reaches GetText, EditChanged,
validation and the model as CRLF. SetText replacements retain their supplied
line endings. Source case rules, schema/edit limits and ItemChanged/ItemError
still use the shared pipeline. Redraw retains selection direction and editor
scroll positions without stealing external focus, and waits for active IME
composition to finish. Multiline style/owner/editability changes retain the
unapplied entry in a readonly, copyable recovery field in both presentations;
Modern's existing recovery UI now also preserves line breaks.

Enter still accepts and invokes the recovered handler; Contact Card's handler
routes it to Tab. **Shift+Enter is an intentional new line-entry gesture** for
supported multiline editors in either presentation, with visible Modern help.
It is not claimed as verified original keyboard behavior.

Relation (`w_relation_form`) adds a contextual layout for
its Code, Name and Description detail and its serial/Code/Name list. The original
`GetRow()` serial-number compute and source labels remain mapped; the shared
single-entry layout retains its hidden print companions.

Twelve more recovered Code/Name/Description masters now have explicit,
contextual layouts: Disease Type, Item Brand, Item Colour, Item Fabric, Item
Size, Item Sleeve, Item Style, Item Yarn, Model, Rank, Site and Unit. The lists
retain their original field order and `GetRow()` serial where present; Disease
Type has no serial; Site places its serial before Code and Name. `w_site_form`
reuses `d_shift` definitions but keeps its mapping control-local. The registry
also covers twelve masters whose source lists include Description: County, Eye
Vision, Generic Item Type, Godown Group, IOL Power, Item Design, Item Thickness,
Resource Category, School, Surgery, Surgery Procedure and Ward. Item Design's
distinct source label strings are retained.
Eight additional masters add explicit contextual layouts for Author, Dosage
Unit, Grade, Class, Item Class, Item Packing, Measuring Unit and Transport
Route. Their original remarks, local dosage labels, numerical factors, measured
quantities and transport charges are retained. The registry then had **82
authored entry mappings** (79 single-entry: 43 Code/Name and 36 richer); the
sixteen masters under "Additional single-entry masters" raise it to 98.
Metadata assertions now pass; none of these layouts establish complete business
workflows. Grid-order regressions compare the reviewed declarations against the
source objects' horizontal positions, independently of export-array order.
DataWindow properties are top-level dotted keys, not window-style `fields`
arrays; earlier probes using the latter shape were invalid evidence. Runtime
layouts remain explicit rather than sorting or migrating screens heuristically.

Resource Category explicitly maps Description as multiline. Grade's decimal
Numerical Factor uses the source `0~999` bounds and integer increment. Stepping
and boundary checks preserve exact decimal drafts; unsupported fractional
configuration and unbounded exponents are not silently coerced. Both-mode
single-entry fixtures seed and edit every additional mapped field, check all
computed serials, and interpret source label mnemonics. Resource Category has
rejection/redraw/cancellation cases; Grade has draft, pointer, keyboard, bounds
and rejection cases. Classic/native spinner equivalence remains unaccepted.

Authored helper, metadata and both-mode browser cases cover the exact tree and
fields, stable duplicate sorting, slash titles, native keys, CRLF preservation,
limits, selection, redraw, IME, retained source corrections and asynchronous
ownership/configuration rejection. The fixture runs the recovered account-copy
and Enter handlers. Three existing translated account/customer/supplier
statements are whitelisted against a strict in-memory recorder; synthetic
results exercise customer, supplier and null-account field propagation.
Unexpected queries, writes, transactions and procedures fail explicitly.
This does not verify actual SQL execution, persistence, account-query failure
paths, open-time setup, Save, Retrieve or Print.

Twelve authored Detail/Editing/List appearance cases cover light/compact/100%
at 1366px and dark/comfortable/200% at 1366px, 683px and 320px. They include real
browser Shift+Enter/Enter, accessible names, focus visibility, contrast and
contained horizontal overflow. The separate single-entry and Contact Group
matrices now contain 48 and 16 cases, including sixteen added Resource Category
and Grade Detail/List appearances. Local unit, metadata, type and static-build
checks and the expanded browser/appearance matrix pass.
Fixture boundaries now reject leaked dialogs and preserve failure-state
diagnostics. Replacement contact children use explicit synthetic retrieval
instead of accidentally invoking a disconnected database operation.
Production acceptance remains zero and Modern remains opt-in.

### Additional single-entry masters

Sixteen more masters raise the registry to **98 authored entry mappings** (95
single-entry: 43 Code/Name and 52 richer). Like the earlier masters, each uses
the standard single-entry outer layout with an explicit control-local Detail
form on `dw_detail`, an explicit List grid in the recovered column order, and
the hidden `dw_print` and `dw_listprint` companions marked auxiliary. Recovered
label objects name every field, and a computed serial (`compute_1`) leads the
list wherever the source has one.

| Window | Detail fields | List column order |
|---|---|---|
| `w_dischargerefferal_form` | code, name | name |
| `w_vehicletype_form` | code, name | name, code |
| `w_pctcodes_form` | code, name, remarks | name, remarks |
| `w_tests_form` | code, name, testprice | code, name |
| `w_itemmeter_form` | code, name, description, currentreading | name, description, code, currentreading |
| `w_goodscompany_form` | code, name, address1, address2, city, country, phone, fax, email | code, name |
| `w_biometricmachine` | code, name, manufacturer, model, ipaddress, port | name, ipaddress, port, manufacturer, model, code |
| `w_crs_clientlist` | code, name, address1, address2, phone, phone2, fax, email, web, cp, cpphone, cpmobile | the same twelve columns |
| `w_custsector_form` | code, name, aliasname, description | name, aliasname, description, code |
| `w_dosage_form` | code, name, dosefactor, description, localdosage | serial, code, name, localdosage |
| `w_instruction_form` | code, name, description, localinstruction | serial, code, name, localinstruction |
| `w_precaution_form` | code, name, localprecaution | name, localprecaution, code |
| `w_region_form` | code, name, manager, remarks | code, name |
| `w_route_form` | code, name, description, localroute | serial, code, name, localroute |
| `w_saletype_form` | code, name, description, counter | code, name |
| `w_weighingscale_form` | code, name, manufacturer, model, scaleid, scaleidpos, barcodelen, itemstartpos, itemendpos, weightstartpos, weightendpos | code, name, manufacturer, model, scaleid |

The both-mode single-entry fixture seeds, edits and checks every
mapped field and computed serial for these windows as for the earlier masters,
and its synthetic drafts honour each column's recovered edit mask. Goods
Company's Phone column is `char(15)`; a prior 17-character synthetic draft
correctly triggered validation. The fixture now uses a shorter literal-text
sample and separately checks over-limit rejection, retained drafts and exact
15-character acceptance in both modes. The registry-level test asserts the
95, 43, 52 and 98 totals. Eight Goods Company Detail/List appearance cases
increase the single-entry appearance matrix from 48 to 56. These layouts are
not accepted complete workflows.

## Explicit Modern data-surface pilots

The Modern host now selects semantic forms/lists for these reviewed definitions:

| Definition | Presentation | Mapped fields |
|---|---|---|
| `d_aginginterval` | Form | Code, description |
| `d_agingintervallist` | Grid | Code, name |
| `d_agingintervaldetail` | Grid | Calculated serial number, comparison, editable limit |
| `d_contactgroup` | Form | Code, name |
| `d_contactgrouplist` | Grid | Code, name |
| `d_summaryaccount_list` | Grid | Code, alias, name |
| `d_arg_date` | Form | Date |
| `d_arg_manf` | Form | Optional manufacturer, editable lookup with numeric key |
| `d_arg_manf2` | Form | Required manufacturer, editable lookup with numeric key |
| `d_invbankpaymentdetail` | Grid + footer | Serial, invoice, account, cheque, description, debit and original total |
| `d_invbankreceiptdetail` | Grid + footer | Serial, invoice, account, cheque, description, credit and original total |
| `d_invcashpaymentdetail` | Grid + footer | Serial, invoice, account, description, debit and original total |
| `d_invcashreceiptdetail` | Grid + footer | Serial, invoice, account, description, credit and original total |
| `d_cashiershift_cashdenomination` | Grid + summary | Type, currency, name, denomination, quantity, computed amount and "Change Left" |
| `d_assocadvsaleinvlist` | Grid + summary | Sale invoice, amount and original total |

Bindings are explicit in `web/src/ui/data-surfaces.ts`; label objects and the
shared formatter retain the original terminology and value formats. Every
presentation object must be accounted for. Changed structures, additional
objects, undeclared or unsupported selectors, grouped bands and print preview retain Classic rendering
rather than silently omitting content. Unmapped compatibility editors retain
their normal redraw behavior.

### Computed transaction totals

The six `TRANSACTION_DATA_SURFACES` bind every detail object, header and total
explicitly, in source display order. Account/currency selectors retain their
reviewed child DataWindow identities. Hidden record keys are not displayed.
Totals use the shared DataWindow expression evaluator and formatter: no
financial calculation is duplicated in the presentation layer.

Summary bands follow the detail rows and disappear with empty data; footers
remain when empty, matching Classic. Zero-height source bands are not shown.
Runtime visibility and formatting remain source-owned; hiding a label does
not hide its value, or vice versa. Totals are named readonly keyboard targets,
not extra model rows or editable data columns. Explicit source SetColumn
returns focus to the real column, even after scrolling away from its row.

The grid body spans the table's full scrollable width while totals stay within
the component viewport. Footer scroll padding leaves focused editors clear of
sticky content; short viewports release vertical stickiness when a header,
footer and two rows do not fit. Horizontal anchoring remains active. Passive
recalculation preserves another row's draft, caret, GetText binding and scroll
position. Ordinary text inputs may be recreated during repaint; input state
and focus, not DOM identity, are the contract.

Synthetic fixtures exercise all six definitions in both presentations:
accepted/rejected edits, source precision, separate label/value visibility,
zero-height and empty bands, filter/reset/delete, 1,000-row aggregates with
bounded Modern rendering, and Classic fallback/print isolation. Appearance
cases additionally check actual keyboard editing, both scroll axes and a
220px-high viewport. They do not execute voucher posting or cashier settlement.
Group/trailer bands, other transaction definitions, runtime band-height and
computed-expression replacement, complete workflows and document templates
remain separate work. This is not a claim of full report or transaction parity.

`ModernDwView` reuses the existing model, ItemChanged/ItemError validation path
and text editor. Forms expose field labels and validation state; lists expose
named grid cells, row/column counts, a roving keyboard entry point and sticky
headings. A 10,000-row list renders at most 60 rows plus one pinned editing row.
The virtual row height includes borders, and programmatic selection scrolls
the target below sticky headings.

Pending text and selection survive asynchronous redraws. Rejected edits keep
their error state. Replaced/cleared definitions, replaced rows and newly
protected/readonly fields retain an unapplied draft for copying and explicit
discard; they cannot apply it to a different record. Drafts remain in memory,
never in saved appearance preferences.

The view binds AcceptText when a model attaches, not on the next animation
frame, and restores the previous callback on replacement/disposal. Concurrent
validation is rejected without reentering it. Update respects a rejected
AcceptText before issuing SQL. Dataobject loads use latest-assignment ownership,
and clearing or missing definitions notify views. Control Hide/Show subscriptions
also include DataWindows, not only ordinary controls.

The aging-interval detail mapping explicitly distinguishes calculated cells from
data columns. It evaluates the original `getrow()` and comparison expressions;
the hidden `code` key stays in the model. The originally blank comparison header
has the explicit label "Comparison". Calculations are readonly and keyboard
navigable without selecting data column zero or firing fictitious ItemFocusChanged
events. Ordinary redraws retain calculated-cell focus; an explicit SetColumn,
including the already-current column, restores the data-column entry point.
SetColumn notifications do not introduce new business-script events.

Synthetic checks cover limit editing/rejection, insertion/deletion with
recalculated serial numbers, row-versus-item focus ordering, hidden keys,
Classic print isolation and complete focused-cell visibility at narrow widths.
This component baseline does not execute the full `w_agingintervals` workflow.
The newer source-validation and recorded-SQL cases above pass with synthetic data.

The Modern numeric field now has named Increase/Decrease buttons and a
keyboard-operable spin editor. The original safe integer bounds and positive
integer increment drive stepping; values clamp at the ends instead of wrapping.
Grouped input remains accepted, blank/invalid drafts are not silently replaced
with zero, and unaccepted adjustments remain cancellable with Escape. Stepping
updates the draft, not the model; the existing ItemChanged/conversion/validation
path accepts it once. Typed-value validation is not replaced by spin bounds.

Unmodified Up/Down adjust only while editing; modified shortcuts and text
editing remain available, and the original `ue_dwnkey` notification still runs
once. Buttons stay outside the tab sequence because the focused editor provides
the keyboard equivalent. Their targets are at least 24 by 24 CSS pixels,
including at narrow widths. Runtime bounds, increment and Spin changes are
honored; protected fields cannot be adjusted. Unsupported configurations retain
Classic with a diagnostic and preserve any unapplied draft. A delayed pointer
action cannot create an editor for a replaced model. Clicking inside an existing
Modern editor also no longer recreates it or discards its draft.

This implementation covers number and decimal storage columns with safe integer
bounds and a positive integer step. Draft arithmetic and button-boundary checks
use exact decimal values. Date/time, fractional-bound/increment and code-table
spin variants remain unmapped; Classic/native spin behavior and Windows message-order parity
are not claimed. References:
[EditMask properties](https://docs.appeon.com/pb2022r3/datawindow_reference/XREF_58903_EditMask_property.html),
[DataWindow KeyDown](https://docs.appeon.com/pb2019r3/datawindow_reference/ch08s30.html)
and [ARIA spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/).

These are component pilots, not nine completed workflows or a production rollout.
Transaction/master-detail window layouts, selector families, remaining computed/grouped surfaces,
all-role business flows and the remaining catalog still require migration and
acceptance.

## Complete response-dialog layouts

`web/src/ui/window-surfaces.ts` explicitly maps these native-control windows:

| Window | Original validation retained |
|---|---|
| `w_arg_amount` | Rejects negative values |
| `w_arg_decimal_val` | Inclusive 0-100 range; caller-supplied label |
| `w_arg_integer_val` | Rejects negative values; caller-supplied label; does not introduce rounding |
| `w_arg_noofsiblings` | Rejects negative values |
| `w_printer_copies` | Rejects zero/negative copies; this dialog does not print |
| `w_assocadvsaleinvlist_form` | Original shared-buffer, duplicate, existence, association and posted-sale checks execute with strict synthetic query results; no real database acceptance |
| `w_cashiershift_closing` | Original quantity, transfer-account, unposted-transaction and server-date checks; strict synthetic closing, rollback/retry and closed-shift protection; authorization result only |

The layout reparents the existing inputs, labels and buttons; it does not
recreate runtime objects or substitute validation. Every control must be
accounted for with the expected native type. Missing, additional, duplicate or
nested controls keep the entire Classic compatibility layout. Classic mode
retains its own layout and executes the same scripts.

Modern layouts use flow-based fields/actions, left-aligned field labels, original
numeric alignment, visible keyboard focus and a real Close button that respects
CloseQuery. Dynamic title, label, enabled and visibility bindings remain live.
Untitled dialogs use their original field label as the accessible name rather
than inventing a title. Changing/clearing a title updates that relationship;
close disconnects the name observer. Appearance applies to these complete
windows, not to unrelated compatibility controls.

Synthetic checks execute the five recovered scripts through real
OpenWithParm/CloseWithReturn, including rejection, inclusive boundaries, Cancel
sentinels and the numeric return channel. Browser checks cover original default
button behavior, single keyboard activation, Tab/Shift+Tab containment, and
Escape not bypassing missing Cancel bindings. They do not establish original
PowerBuilder event-message equivalence: `w_arg_noofsiblings.ue_keydown` aliases
remain a known shared-runtime/native parity gap, not an added Modern shortcut.
The associated-sale invoice picker maps `dw_viewheader` to the exact
`d_assocadvsaleinvlist` source order and totals band. Its dedicated fixture now
opens the actual response window with the recovered `s_dw_header` structure,
original scripts and a synthetic caller DataWindow. It checks shared-buffer
identity, optional blank-row cleanup, duplicate correction, invoice totals
(including NULL), missing/already-associated/unposted invoices, and the
modify-mode exclusion of the caller's advance invoice. The original
OpenWithParm/CloseWithReturn, Cancel, Ctrl+I/Ctrl+D and Enter sequences execute
in both presentations. Five exact translated SELECT statements are recorded;
the caller transaction and `sqlca` total-query transaction remain distinct.
Unexpected queries, retrieves, writes, procedures and commits fail the fixture.

Real modal interactions cover typed keys and queried totals, readonly total
focus, OK, two-stage Escape and keyboard-only button activation. Shared fixes
route unhandled DataWindow keys to their source event, retain keyboard focus
after cancelling a Classic text editor, and normalize event-enum names in
TriggerEvent/PostEvent. Source Enter handlers on buttons suppress the duplicate
browser click. Deleting an untouched text row no longer creates a spurious
Modern recovery panel; deleting a changed row preserves its unapplied text in
either mode, including after repaint.

This is original-script synthetic evidence, not PostgreSQL persistence,
posting, a complete advance-sale workflow or an accepted all-role pilot.
Cancel retains the source shared-buffer semantics; it is not an invented
transaction rollback.

## Inherited aging-entry layout pilot

`modern-entry-window.ts` reflows the exact 23 inherited control paths of
`w_agingintervals`, keeping the actual controls, Detail/List tab lifecycle,
master/detail/list models, Sort Criteria, Filter Criteria, Find instructions,
and hidden footer/item-list controls. Additional, missing, moved or changed
control paths retain the entire Classic layout rather than dropping controls.
Unmapped auxiliary DataWindow contents still use their Classic renderer when
shown; the outer layout alone is not complete Modern screen coverage.

The master form and detail grid flow vertically. The List page groups original
sort/filter controls above Find and the results grid. Positive native tab indices
are normalized within the Modern layout so keyboard traversal follows that
structure. Original labels, group captions, enabling and visibility remain live.
Decorative group captions do not newly disable their independent controls.
Radio groups are isolated per owning control container, so changing one retained
window cannot visually uncheck a second window's sort direction.

Find uses a context-only Modern mapping after the entire window passes its
structural check. Its original label and instructions name and describe both
the field and its live editor; other windows keep their compact compatibility
Find layout unless explicitly mapped by the standard-entry family. Appearance
reaches the whole mapped entry, not just its grids.
At narrow effective sizes the workspace scrolls vertically instead of collapsing
the working area. Focused fields scroll fully into view, while redraw restoration
does not snap a user-scrolled draft back into view.

Synthetic checks instantiate the recovered inherited control metadata and run
the recovered tab/input/Find, filter/unfilter and ascending-sort routines.
They exposed stale dropdown `Text`: user selection and native SelectItem now
update it before source handlers read their criteria. Checks cover current
operator/value filtering, restored rows, selected-column type/index, two open
windows, dynamic labels, hidden auxiliaries, cleanup and structural fallback.
The fixture deliberately omits window-open/data-loading SQL and substitutes
synthetic models/menu state; it does not execute a database save.

The original editable filter-value dropdown now accepts both typed and listed
values, including a source-backed freeform comparison and re-filtering after
choosing another value. Changing the filter column runs its recovered
Reset/InsertItem/Sorted population routine. The entry remains a layout pilot,
not an accepted complete business workflow: Other Find branches, real database save and packaged acceptance remain open;
the separate synthetic fixtures above cover aging duplicate/name validation.

## Editable native dropdowns

`dropdown.ts` gives DropDownListBox a real input and named listbox when AllowEdit
is true, while retaining a native select for noneditable controls. Both
presentations share this implementation and the original runtime control.
Modern criteria inherit the window's theme, density and text scale; Classic
retains its existing control sizing and fonts. Existing report fonts are
intentionally unchanged for compatibility, not replaced to satisfy a generic
font-style recommendation.

Typing updates Text and clears the list selection without creating an item or
raising SelectionChanged. Modified is delivered when changed input is finished
with Enter, Tab or blur, before LoseFocus; unchanged Enter and IME confirmation
do not invent a modification. List acceptance sends a one-based SelectionChanged.
Clicking an editable-list option, including the current option, sends
SelectionChanged before Clicked. Arrow keys explore choices without overwriting
typed text; Enter accepts and Escape dismisses without clearing it. Ordinary
text editing stays browser-native. F4/Alt+Down open choices, while modified
shortcuts retain their existing route.

Control notifications are serialized. Editing/choice acceptance waits while
Modified or SelectionChanged runs, without stealing focus from a native select.
Failures reach the runtime error handler and a visible message, retaining the
text; they are not automatically retried. Disposal removes observers, document
listeners and the popup and drops queued events. Already-running source code is
not aborted. This is per-control sequencing, **not** a global transaction/action
barrier or a claim of exact PowerBuilder message order.

Runtime AllowEdit, Enabled, Visible and Limit changes reach the same binding.
SetText/SelectItem replace text without a false user event, and SelectText reaches
the edit portion. Reset clears text and choices; insertion/deletion and sorting
retain valid selected indices. Sorted insertions return their final position,
including duplicate labels. Sorting uses the host's locale comparison; exact
native locale/case ordering, all SelectItem overloads, ShowList, DropDown/CloseUp
events and picture-list families remain uncharacterized or unmigrated.

The popup uses the browser top layer, remains anchored during focus scrolling,
and scrolls internally when necessary. Its input remains the keyboard focus
owner, with expanded/active-option semantics and explicit names. Four real
keyboard/pointer appearance cases cover text limits, freeform filtering, list
acceptance, Escape retention, re-filtering, popup bounds and selected/unselected
text contrast through 200% text and 320px effective width. These are browser
checks, not assistive-technology or packaged WebView2 acceptance.
The in-page fixture synthesizes blur when a background browser canvas changes
activeElement without native focus events. The separate foreground Playwright
matrix exercises real typing, Tab, popup keys and pointer selection.

References: [Modified](https://docs.appeon.com/pb2025r2/powerscript_reference/modified_event.html),
[SelectionChanged](https://docs.appeon.com/pb2025r2/powerscript_reference/selectionChanged_event.html),
[InsertItem](https://docs.appeon.com/pb2025r2/powerscript_reference/insertitem_func.html),
[native combo reset](https://learn.microsoft.com/en-us/windows/win32/controls/cb-resetcontent)
and [ARIA combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

## Guarded form tabs

Pointer navigation first accepts active DataWindow editors and waits for any
validation already started by blur, then runs the original `SelectionChanging`
event before hiding the current page. Rejected validation retains the page and
Modern draft without opening a premature save confirmation. Waiting does not
duplicate ItemChanged, and stale/unapplied Modern entries still block navigation.
Returning 1 from SelectionChanging retains the page; an accepted transition
updates the original control once, runs `SelectionChanged` once, and drains
posted work. Clicking the already-active tab no longer reinitializes its form.
Overlapping requests, unavailable pages, reordered/removed pages, destroyed
controls and script-directed selection changes cannot apply a stale user
transition. Errors reach the existing runtime error handler, and the pending
state is released for a retry.

This fixes a source-backed data-loss risk in both presentations: the previous
pointer handler skipped `w_multi_entry.tab_retrieve.selectionchanging`, including
its Yes/No/Cancel decision and failed-commit cancellation.
The fixture executes those recovered confirmation/selection routines with actual
Detail/List captions. Save/list handlers and commit outcomes are synthetic:
these checks verify dispatch and cancellation, not database writes or a complete
aging-window workflow.

Modern adds named tab lists, paired panels, a single keyboard entry point and
visible focus. Left/Right/Home/End move focus without running business events;
Enter/Space explicitly activate a page. Tab enters the active panel, including
legacy positive-tab-order fields; Shift+Tab returns from its first control.
Runtime labels, selected pages, visibility and disabling update the semantics.
Focus cannot remain in a hidden panel; SetFocus reaches the semantic tab.
Modified shortcuts are not consumed by navigation, and original key events are
forwarded. Classic keeps its original tab appearance; Modern compatibility tabs
keep the light compatibility palette and use a 28px scrollable tab strip.

The programmatic `SelectedTab`/`SelectTab` runtime paths and initial-window tab
events have not been redesigned here. Their complete cancellation, reentrancy
and native-message parity remain open. Other controls and complete window reflow
remain separate migration work. References:
[SelectionChanging](https://docs.appeon.com/pb2025r2/powerscript_reference/selectionChanging_event.html)
and [ARIA tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

## Complete entry-window prerequisites

`w_agingintervals` inherits 23 control paths, not just its three mapped
DataWindows. Its reviewed outer layout now includes sort/filter controls and
contextual `d_find`; hidden footer/item-list controls are retained when shown.
Other windows still give `d_find` a small compatibility slot, so it is not
globally mapped as a tall form.

The shared text editor now dispatches ordered `EditChanged(row, column, text)`
notifications in both presentations. The fixture executes the recovered
`dw_detail.editchanged` Save-enabling routine and `dw_find.editchanged` with
`f_binarysearch`. Ascending text Find selects matching synthetic rows and updates
Detail/menu availability; missing and empty searches clear the selection.
Typing changes the draft, not the stored item. This is source-backed live Find
coverage, not database-save acceptance or coverage of every search branch.

`GetText` reads the active draft and `SetText` replaces it without a model write
or invented user-input event. Binding ownership follows the model, row object
and column. Script-corrected rejection, SetFocus and SelectText preserve the
draft; numeric accessibility values also follow programmatic replacements.
Both observing views own model AcceptText synchronously; temporary print views
do not take ownership.

UI acceptance waits for pending input delivery before validation. Native
AcceptText conservatively returns failure while input/validation is pending;
input failures are reported and block acceptance until correction or explicit
cancellation. Successful acceptance clears obsolete Modern failure feedback.
A message opened by EditChanged does not accidentally commit the draft on blur.
Escape, explicit stale-draft discard and disposal invalidate queued delivery;
closing a window cannot deliver the next queued input or commit its draft.
This does not abort an already executing source routine or arbitrary SQL.

Remaining contracts include no-active-editor/DataStore GetText/SetText (which
retain the previous model-backed fallback), native AcceptText reentrancy and
no-object behavior, descending/numeric/date Find, selectors and complete
entry-window reflow. Conservative asynchronous busy handling is not a claim
of exact PowerBuilder message-order equivalence. References:
[EditChanged](https://docs.appeon.com/pb2022r3/datawindow_reference/dwevt_EditChanged.html),
[GetText](https://docs.appeon.com/pb2022r3/datawindow_reference/dwmeth_GetText.html),
[SetText](https://docs.appeon.com/pb2022r3/datawindow_reference/dwmeth_SetText.html)
and [AcceptText](https://docs.appeon.com/pb2022r3/datawindow_reference/dwmeth_AcceptText.html).

## Native window appearance

The desktop configuration enables Tauri's official global window API and adds
only `core:window:allow-set-theme` to the existing main-window capability. Normal
startup restores Light chrome; an authenticated Classic host also stays Light
regardless of the saved Modern theme. Modern sends Light, Dark or `null` for
System through `Window.setTheme`, preserving system following rather than
pinning the current color. Existing window controls and CSP are unchanged.

Native requests are serialized across host instances so an earlier operation
cannot finish after a later preference. Repeated media changes do not create a
theme feedback loop. Errors are visible without discarding preferences or
stopping the workspace; saving Appearance again explicitly retries a failed
request. Plain browser use does not call a native API, while a detected desktop
with a missing bridge reports an error instead of silently claiming success.

Unit tests and a mocked native bridge in the browser fixture cover this
contract, including failure/retry and system color-scheme changes. They do
**not** verify Windows chrome pixels, WebView2 propagation or a packaged build.
The preview injects its mock instead of reading or replacing native globals,
including when it is embedded inside another Tauri application's browser panel.
That requires the authorized desktop CI/build and Windows acceptance gate.
API references: [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#settheme)
and [core permissions](https://v2.tauri.app/reference/acl/core-permissions/).

## Isolated all-role design prototype

Prototype surfaces: Cash Sale, Pack Purchase, Items, Account Ledger, Reports,
Document preview, and Appearance. It demonstrates light/dark/system appearance,
Compact/Comfortable density, text size, retained edits while changing tabs,
sample item selection, validation feedback, and independent print-layout choice.
The Classic-print selection explicitly refers to the existing renderer rather
than displaying an invented imitation.

Run the isolated preview from the repository root:

```powershell
python -I -m http.server 5199 --bind 127.0.0.1 --directory web\prototypes\modern
```

Open `http://127.0.0.1:5199/`. These files are outside `web/public` and `web/src`,
so the existing production static build does not package the prototype.
`web/prototypes/modern/checks.js` exports `runPrototypeChecks()` for browser
interaction, viewport, label, and token-contrast checks. Those checks do not
establish full WCAG conformance or packaged Windows behavior.

The prototype has no database, runtime, persistent settings, or printer access.
Its example transactions and document values are synthetic.

## Actual-runtime synthetic preview

`web/e2e/presentation.html` uses the real runtime, presentation host, controls,
DataWindow model and Classic page builder with synthetic window/menu definitions,
the forty-seven global mapped presentation definitions, the compatibility Find definition,
thirteen non-criteria modal definitions/scripts and forty criteria owners with
their ancestors, the inherited aging-entry control
metadata, 79 explicit single-entry definitions with context-scoped data
surfaces, the Contact Group and Contact Card layouts and selected contact validation
scripts, shared choice-state cases, selected tab/input/filter/sort scripts and binary-search routine,
editable-lookup, automatic-list and selector-variant metadata, the selected sale child-row routine, synthetic
rows and in-memory settings.
The presentation fixtures include only explicitly allowed SQL translations
executed against synthetic in-memory recorders, never a live database or
customer records. They do not authenticate, connect to a backend, post a
transaction, access a printer, or exercise the native Tauri title bridge.

From the rebuild root, with the declared web development dependencies installed:

```powershell
npm --prefix web run typecheck:presentation
node --test "web/tests/*.test.ts"
node web/tools/build-static.ts web/dist
node web/e2e/presentation-smoke.mjs
```

The static builder replaces its output directory; use only a dedicated generated
directory, never a repository or session root. The browser runner also accepts
explicit build/output directories. It serves only loopback, rejects backend and
external requests, and closes its helper server/browser when finished.
Appending `--fixtures-only` after both explicit directories prepares synthetic
fixture files without starting a server/browser or changing result artifacts:

```powershell
node web/e2e/presentation-smoke.mjs <generated-build-directory> <results-directory> --fixtures-only
```

This preparation does not rebuild production modules and is not a passing
browser check. Run the static builder and the default runner for release evidence.

Use `--editable-lookups-only` in the same final argument position to run shared
choice cases, editable lookup, automatic-list, readonly Contact Group/Card and
remaining selector checks in both presentations, plus 45 appearance cases
(5 editable lookup, 12 automatic, 28 selector variants). It writes
`editable-lookup-result.json`, including
`automaticChoiceCases` and `selectorVariantCases`, without replacing
the full suite's `result.json`; use a separate results directory to keep
failure diagnostics independent. This focused check is not a substitute for
the full browser suite.

Use `--transaction-bands-only` to exercise both presentations and the six
transaction grids' 30 appearance cases. It writes `transaction-band-result.json`
in the chosen results directory. Like the lookup runner, it is not a substitute
for the full regression suite. Geometric comparisons allow at most half a CSS
pixel for native scroll-offset rounding; they still check the complete editor
against the actual sticky header cells and footer.

Use `--associated-invoices-only` to run the associated-invoice modal's original
scripts in both modes and its four appearance cases, real keyboard/pointer
actions and return structures. It writes `associated-invoice-result.json`;
use an independent results directory. It does not replace the full suite or
the native/database acceptance gates.

Use `--cashier-only` for cashier closing's 72 both-mode assertions and eight
appearance cases, including real Cancel, Escape and Enter actions. It writes
`cashier-result.json` in an independent results directory. It uses synthetic
records and an authorization result, not a database or login, and does not
replace the full shared suite.

Use `--payment-only` for multiple-invoice cash tendering's 101 both-mode assertions,
eight appearance cases and real keyboard/pointer row-rejection check. It writes
`payment-result.json`. Records and procedure results are synthetic, and the final
print request is intercepted. Use an independent results directory; this is not
a substitute for the full suite or database/printing acceptance.

Use `--category-only` for category changes' 112 both-mode assertions and eight
appearance cases. It writes `category-result.json` and includes real Enter,
account selection, two-stage Escape, permission failures, optimistic conflicts,
rollback/retry and ambiguous commit outcomes. Use an independent results
directory. SQL/RPC contracts and transaction outcomes are synthetic; this runner
does not replace the full suite or production cashier acceptance.

Use `--forced-colors-only` for the four emulated system-palette/viewport cases.
It writes `forced-colors-result.json`: in-page prerequisite assertions
establish the real preview factories, and `forcedColors` contains the separate
148 interaction/style/paint assertions and four cases. The full runner includes
these same forced-color checks under `result.json`'s `forcedColors` property;
they are not included in its ordinary in-page assertion or appearance counts.
Use independent results directories. Browser emulation does not change Windows
settings or replace native/assistive-technology acceptance.

Use `--criteria-only` for the twenty-seven source-bound criteria forms' 773 both-mode
assertions and 108 appearance cases. It writes `criteria-result.json`, including
`criteriaCases`, in an independent results directory. The full runner includes
the same component and appearance checks. Other focused runners do not execute
criteria appearances. This does not exercise inherited report-window workflows
or replace the full regression and native/database acceptance gates.

Use `--criteria-windows-only` for the fifty-five complete criteria-dialog integrations.
It writes `criteria-window-result.json` with both-mode assertions and
`criteriaWindowCases`, plus real item-search keyboard, native-list pointer,
native-date error/recovery/Enter/Cancel, all fifteen lookup-owner selection/
acceptance checks, six inherited reference-text owners and six numeric owners.
The full runner includes the same checks and appearances;
other focused runners do not exercise this owning-window fixture.

Use `--date-options-only` for the nine added native date/filter owners. It writes
`date-option-result.json` with 1,282 both-mode assertions and 72 appearances,
plus real date recovery, Tab/Space/radio-arrow/Enter and pointer checks. It covers
every Boolean/radio combination, fifteen individual transaction positions,
All on/off, source-specific reversed ranges, cancellation after prior success,
inherited date preferences and listener cleanup. The focused harness compares
unchecked runtime defaults as Boolean values: the source may omit a false field
rather than explicitly assign it. These owners never validate or populate their
unused hidden customer buffer.

Use `--date-choices-only` for As On, cost price, Cash/Credit/Both, cashflow and
remarks owners. Its `date-choice-result.json` contains 734 both-host assertions
and 48 appearances. Real keyboard/pointer checks exercise secondary selector
labels, choice acceptance, post-selection Tab, radio arrows and date recovery.
The actual source parent still calls customer AcceptText without blocking on its
failure; only the secondary buffer gains a new acceptance guard.

The item/date/top-customer owner keeps its two selector ancestors, original
group captions, native selected list, All option, dates and count buffer.
Only this owner's one-row search grid is explicitly rendered as a form:
its declared processing style and header label identities are still validated.
The available-item grid and hidden keys are unchanged. Extra source frames
and list captions are included in complete ownership and content-order checks.
Native list sorting preserves selected-item identity through insertion and
deletion; focus, Enter and double-click dispatch the original handlers.

The original remove routine depends on Sort moving the current row to 1 without
row-focus callbacks before deleting a temporary null row. The native wrapper
now follows that documented contract, without rewriting the recovered routine.
See [PowerBuilder Sort](https://docs.appeon.com/pb2022/datawindow_reference/dwmeth_Sort.html);
this is documentation-backed behavior with synthetic regression evidence,
not a new observation of the original executable.
Acceptance guards only the actual count draft, not the intentionally cleared
required Name search field. All-items and selected-only returns retain their
original flags, keys and dates. Title-bar closing cannot reuse a previous
successful structure. Failed all-items DataStore retrieval now reports the
database error explicitly before cancellation; visible DataWindows keep their
own DBError path. Empty available lists retain the inherited validation/return.
The fixture retains original GetSQLSelect metadata so alias lookup really enters
the source procedure branch, while a strict synthetic procedure supplies only
its expected output references. Calling reports, persisted database results and
native acceptance are not established by this dialog's checks.

### Shared source calendar and F4 return

`components/w_calendar` now binds its original MonthCalendar, default OK and
Cancel controls to the shared runtime. `NCalendar` implements single-date
SetSelectedDate/GetSelectedDate and SetToday/GetToday. Programmatic selection
returns zero and fires DateChanged; GetSelectedDate writes through `Ref`;
SetToday changes only the marker. Unqualified native output calls now receive
references just like receiver-qualified calls. The original source DateChanged
uses the unqualified form. These contracts are documentation-backed, not new
observations of the operational executable:
[SetSelectedDate](https://docs.appeon.com/pb2019/powerscript_reference/ch10s639.html),
[GetSelectedDate](https://docs.appeon.com/pb2019/powerscript_reference/ch10s268.html),
[SetToday](https://docs.appeon.com/pb2019/powerscript_reference/ch10s651.html) and
[GetToday](https://docs.appeon.com/pb2021/powerscript_reference/ch02s04s351.html).

The shared DOM renderer has a six-week grid, locale weekday/month names,
four-day-first-week numbering, today marker/action, month/year selection,
arrows, PageUp/Down, Home/End and native default/cancel actions. Month changes
clamp month ends and leap days within 1601-9999. A source MaxSelectCount of 31
does not enable multiselect; range selection, date-limit and bold-date APIs are
not implemented or claimed. Locale week information must be available in the
browser; native WebView2 compatibility remains an explicit acceptance gate.

Intentional compatibility corrections select today for invalid initial dates,
report unsupported initial dates before recovery, and clear the title-close
string return channel. Original OK, Cancel and posted-close scripts remain
unchanged. Inherited native-date F4 handlers convert the regional return back
to the field's declared numeric mask, keep the clock only for timed fields, and
restore the parent's argument structure and field focus. The renderer retains
same-shaped cells so selection redraw does not interrupt real double-clicks.
Calendar button acceptance waits for queued DateChanged work; delayed-source
cases exercise both immediate Enter and immediate OK in both hosts.

The focused fixture exercises `w_arg_sdate`, `w_arg_sdate_notime`,
`w_arg_sdate_ldate` (both fields) and `w_arg_ason` in mdy and dmy regions.
It covers OK, Cancel, title-close, pending-event acceptance and source-listener
cleanup. Real browser input also covers F4, arrows, PageUp, Enter, Escape,
double-click, month/year choices, Today and empty date-only recovery.
Other callers and complete business workflows are not accepted by these checks.
Other direct native callers occur in `w_listarguments`, `w_arg_agingbased_epi`,
`w_inpatientservice`, `w_service` and `f_getdatefromcalendar`. Do not infer their
acceptance from the four criteria-owner cases.

`web/tests/calendar-callers.test.ts` runs the recovered source handlers of those
callers against a synthetic calendar opener: `f_getdatefromcalendar` returns the
selected reference text, or an empty string when cancelled; the aging-date and
list start/end-date F4 handlers keep each field's mask and existing clock and
leave the field unchanged on cancellation; and the inpatient-service and service
DataWindow F4 handlers keep the source's second-precision clock and the stored
value on cancellation. These are isolated source-handler checks, not acceptance
of those windows or their workflows.

### DataWindow calendar and precise drafts

`components/w_calendar2` reuses the same MonthCalendar renderer and complete
three-control Modern layout. It retains the original ISO `yyyy-mm-dd` input and
output, and Cancel restores the original date rather than clearing the return.
Title-close is initialized to that same original value so it cannot reuse a
previous selection. Original OK, Cancel and posted-close routines are unchanged.
Invalid and unsupported initial-date recovery is shared with `w_calendar`.

The two original callers are `components/u_dwstandard.ue_dwnkey` and
`custcomponents/w_customercomments.dw_itemsdetail.ue_dwnkey`. Source-scoped
corrections stop F4 when AcceptText rejects the current draft, preserve the
entire accepted clock and restore DataWindow focus after the modal returns.
An initially empty datetime receives midnight only when a date is chosen.
The source's seconds-only clock conversion is deliberately extended to
milliseconds; otherwise choosing a date or cancelling would discard fractional
seconds. The recovered `dd/mm/yyyy hh:mm:ss:fff` editor mask now recognizes
colon-separated fractions through the existing numeric-mask parser and
formatter, rather than silently reverting to regional display/input order.
The visible restored editor is checked against the exact accepted value, not
only the backing buffer.

The dedicated fixture supplies the actual standard source routines separately
from the older criteria fixture's metadata-only userobject. It asserts the
resolved F4 handler before opening and applies the original customer-comments
override to a synthetic owner. Recovered `d_arg_date` remains datetime with its
original mask; the date-only variant explicitly changes its type and mask for
native API coverage. Both hosts and both regional orders cover populated/empty
buffers, edited valid/invalid drafts, OK/Cancel/title close, exact nonzero
millisecond clocks, restored text/focus and cleanup. Real keyboard/pointer
checks cover F4, PageUp, Enter and double-click for both handlers. This does not
accept the complete customer-comments window or its database workflow.

Current local evidence:

| Check | Result and boundary |
|---|---|
| Authored coverage | 168 of 2,062 inventoried windows (8.15%; 3,005 of 32,730 inherited control paths, 9.18%): 70 modal layouts (55 criteria, 5 native-field, 4 transaction, 4 calculator and 2 calendar) and 98 entry windows (95 single-entry: 43 Code/Name and 52 richer); 47 global DataWindow mappings |
| Frontend, inventory and strict types | 796 frontend tests and 9 static-inventory tests pass; the strict presentation type check passes |
| Full browser regression | 12,819 assertions and 789 appearances, plus 148 forced-color assertions; no failures, runtime/page errors, forbidden requests or native access |
| Focused single-entry regression | All 95 registered masters in Classic and Modern: 4,007 assertions; Phone over-limit rejection and exact-boundary recovery included |
| Focused print | 84 assertions, five settings and four document appearances; no printer access |
| Static build | 67 production modules |
| Generated audit | `ui-completion-audit.md`; verdict not 100% complete |
| Production acceptance | Verified complete screens remain zero; the 1,894 other windows, 8,469 DataWindows, the document/print catalog, the all-role pilot, per-window Classic evidence, packaged Windows/WebView2, authenticated PostgreSQL, assistive technology and hardware remain open |

The full run for this snapshot is `goodscompany-complete-regression\result.json`
(build `goodscompany-final-build`), with focused evidence in
`single-entry-complete-verified\single-entry-result.json` and
`goodscompany-final-print\print-result.json`, all session artifacts. The
committed `--single-entry-only` runner now exercises every registered
single-entry master in both modes, rather than a fixed debugging subset.
Concurrent Email Template/fixture edits appeared during verification and
remain uncommitted; this audit was generated from the frozen tested registry,
not those newer edits.

The previous `final-candidate-evidence-1\result.json` snapshot contained 167
windows and passed 12,730 assertions/781 appearances; a second full run on a
byte-identical build produced those same historical totals.

Previous DataWindow-calendar evidence:

| DataWindow calendar integration check | Result and boundary |
|---|---|
| Authored coverage | 55 criteria owners, 70 modal layouts and both source calendar owners |
| Frontend and strict types | 745 tests pass; presentation type check passes |
| Focused browser | 624 both-host assertions and eight DataWindow-calendar appearances pass; no failures, runtime/page errors, forbidden requests or native access |
| Layout and contrast | Full 200% date text retains at least 4px measured horizontal room at 320px; ordinary calendar text at least 6.384:1 and emulated forced-color text at least 14.371:1 |
| Snapshot identity | 67 production modules, 25 copied fixtures and 127 unchanged inputs match the focused and consolidated runs |
| Consolidated regression | 11,909 assertions and 781 appearances, including eight of each calendar and 424 criteria-window appearances, plus 148 forced-color assertions; no failures, runtime/page errors or forbidden requests |
| Production acceptance | Complete catalogs/workflows, additional native callers/properties, packaged Windows/WebView2, authenticated PostgreSQL, assistive technology and hardware remain open |

Final identity, evidence hashes and remaining gates are recorded in
`datawindow-calendar-verification.json`; the full result is
`datawindow-calendar-final-consolidated\result.json`. Focused evidence is
`datawindow-calendar-final-focused\datawindow-calendar-result.json`; matching
source inputs, frontend/type logs and static build use the
`datawindow-calendar-final-*` prefix in session artifacts. The initial
`datawindow-calendar-candidate-focused` and `datawindow-calendar-owner-focused`
failures retain the missing source-handler fixture defect. The later
`datawindow-calendar-editor-detail` log records the source-mask fallback failure.
These failures and intermediate snapshots are preserved, not reclassified as
passing final evidence.

Previous native-date calendar evidence:

| Calendar integration check | Result and boundary |
|---|---|
| Frontend and strict types | 739 tests pass; presentation type check passes |
| Focused browser | 924 both-host assertions and eight calendar appearances pass; no failures, runtime/page errors, forbidden requests or native access |
| Layout and contrast | Full 200% date text retains at least 4px measured horizontal room at 320px; ordinary calendar text at least 6.384:1 and emulated forced-color text at least 14.371:1 |
| Snapshot identity | 67 production modules, 24 copied fixtures and 126 unchanged inputs match the focused and consolidated runs |
| Consolidated regression | 11,285 assertions and 773 appearances, including eight calendar and 424 criteria-window appearances, plus 148 forced-color assertions; no failures, runtime/page errors or forbidden requests |
| Production acceptance | Complete catalogs/workflows, other native properties, packaged/native, authenticated database, assistive technology and hardware remain open |

That snapshot's identity, evidence hashes and remaining gates are recorded in
`calendar-verification.json`; the full result is
`calendar-final-consolidated\result.json`. Focused evidence is
`calendar-final-focused\calendar-result.json`; matching
source inputs, frontend/type logs and static build use the `calendar-final-*`
prefix in session artifacts. The initial `calendar-candidate-focused` failure
preserves the Modern modal's premature source-focus defect. The passing
`calendar-focus-focused` snapshot precedes the final queued-event guards and
narrow-screen spacing correction. Neither replaces final consolidated evidence.

Previous date/choice evidence:

| Date/choice integration check | Result and boundary |
|---|---|
| Frontend and strict types | 726 tests pass; presentation type check passes |
| Focused browser | 734 both-host assertions and 48 appearances pass, including actual secondary-selector and As On keyboard/pointer paths |
| Snapshot identity | 65 production modules, 24 copied fixtures and 123 unchanged source/test/configuration inputs match the focused and consolidated runs |
| Consolidated regression | 10,645 assertions and 765 appearances, including 424 criteria-window appearances, plus 148 forced-color assertions; no failures, runtime/page errors or forbidden requests |
| Measured contrast | Minimum ordinary text 5.959:1; the added dialogs 6.759:1; emulated system selection 14.371:1 |
| Production acceptance | Complete catalogs/workflows, shared native calendar, packaged/native, authenticated database, assistive technology and hardware remain open |

Final source/build/fixture equality, exact evidence hashes and remaining gates
are recorded in `date-choice-verification.json`. The full result is
`date-choice-keyboard-consolidated\result.json`.
Focused evidence is `date-choice-keyboard-focused\date-choice-result.json`,
with the matching input manifest, frontend/type logs and build under
`date-choice-keyboard-*`. `date-choice-candidate-focused` retains the initial
fixture's incorrect assumptions that the parent never called customer AcceptText
and that a single external caption moved inside its DataWindow.
`date-choice-current-focused` retains the stale-editor keyboard-target failure.
The corrected check follows actual post-selection focus rather than a removed
editor. Neither failure required changing the original business scripts.

Previous date-option evidence:

| Date-option integration check | Result and boundary |
|---|---|
| Frontend and strict types | 713 tests pass; presentation type check passes |
| Focused browser | 1,282 both-host assertions and 72 appearances pass, including real keyboard/pointer checks; no runtime/page errors, forbidden requests or native access |
| Snapshot identity | 65 production modules, 24 copied fixtures and 123 unchanged source/test/configuration inputs match the focused run |
| Consolidated regression | 9,913 assertions and 717 appearances, including 376 criteria-window appearances, plus 148 forced-color assertions pass without failures, runtime/page errors or forbidden requests |
| Measured contrast | Minimum ordinary text 5.959:1; the added date/filter dialogs 6.759:1; emulated system selection 14.371:1 |
| Production acceptance | Complete catalogs/workflows, packaged/native, authenticated database, assistive technology and hardware remain open |

Focused evidence is `date-option-keyboard-focused\date-option-result.json`.
Its input manifest is `date-option-keyboard-inputs.json`; frontend/type logs
and the 65-module build use the same prefix. The complete result is
`date-option-keyboard-consolidated\result.json`; `date-option-verification.json`
records final input/build/fixture equality, measured results, evidence hashes
and remaining acceptance gates. The earlier
`date-option-candidate-focused` is retained as a failed snapshot: its new tests
confused omitted false fields with explicit Boolean false, and exposed native
options missing TabOrder that Modern keyboard navigation could not reach.
The corrected fixture keeps the original runtime values, and the renderer only
adds tab stops for absent ordering rather than explicit exclusions.

Previous print-snapshot evidence:

| Integrated print check | Result and boundary |
|---|---|
| Frontend and strict types | 694 tests pass; presentation type check passes |
| Focused print browser | 84 assertions in both hosts; five settings and four synthetic document appearances; no runtime/page errors, backend/external requests or native access |
| Focused contrast and geometry | Settings text at least 6.384:1; white-paper text 21:1; all option labels fit at 320px/200%; field and band rectangles match Classic |
| Snapshot identity | 65 production modules, 24 copied fixtures and 123 unchanged source/test/configuration inputs |
| Consolidated regression | 8,633 assertions, 645 appearances and an additional 148 forced-color assertions pass; no failures, runtime/page errors or forbidden requests; minimum ordinary text contrast 5.959:1 |
| Production acceptance | Still open for complete catalogs/workflows, packaged/native, authenticated database, assistive technology and hardware |

Focused evidence is `print-integration-current-focused\print-result.json`;
`print-integration-current-inputs.json` records its inputs, with
`print-integration-current-frontend.log` and `print-integration-current-types.log`.
The consolidated result is `print-integration-current-consolidated\result.json`;
`print-integration-verification.json` records matching production/fixture/input
hashes and all measured results. During the full run another edit appended a
duplicate `runPrintChecks` with the old helper signature, shadowing the complete
both-host runner. Only that redundant definition was removed; final source
equality with the tested snapshot then passed. This preserves the intended
focused entry point rather than accepting the broken duplicate.
The failed `print-integration-layout-focused` records the original clipped
selector; `print-integration-geometry-focused` records the field-position/hidden
band defect. Both are retained as failures, not overwritten with passing output.
The earlier `print-integration-consolidated` exposed an outdated call signature
in the shared fixture; the print checks now run at the isolated Classic/Modern
stages instead of perturbing the shell's intermediate state checks.

Earlier numeric-snapshot evidence:

| Check | Result and boundary |
|---|---|
| Static inventory tests | Prior baseline: 9 passing; metadata only |
| Standalone prototype | Prior baseline: 117 assertions; synthetic design examples |
| Frontend regression tests | 685 passing for the numeric snapshot; 692 pass in the combined tree after concurrent print additions. Coverage includes forty criteria owners, exact lookup keys/Boolean flags, contextual single-zone ownership, native numeric datetime GetData, invalid-state recovery after mask changes, atomic date preflight and source-preserving cancellation guards; six reference-text owner contracts with source-specific null policy; six numeric owners with exact field types, percentage/spin policy, external range captions and explicit Day header-band rejection gates; explicit source-processing/header bindings, frame/list/content-order rejection gates, sorted native-list selection identity, Sort current-row behavior without focus callbacks, item-selection count-only acceptance and retrieval/cancellation guards; separate zone/count acceptance, reference numeric cancellation, twenty-seven criteria mappings, source suffix identity/gating, exact percentage/count/reference contracts, literal native property assignment and shared Modify side effects, original criteria-dialog acceptance guards, exact child/key/display bindings, readonly dependencies, remarks/date/range contracts, numeric date-mask parsing/formatting and regional fallback, exact static choice lists/defaults, percentage spin ranges, source field order, hidden city/default, disabled price, monetary validation and multiline/null-policy contracts; shared required-flag aliases/overrides and unchanged FindRequired behavior; fractional/large variable-row prefix indexing and invalid measurement boundaries; source `DDDW.Lines` bounds, explicit mapping and live-policy rejection; native-backed missing-time/fraction formatting and comparator coverage; recovered `DDDW.PercentWidth` selector bindings; ShowList, editable DDLB and left-caption selector contracts/mappings; category source bindings, scoped acceptance/commit/failed-Open guards and duplicate/reordered/partial result mapping; FOR counter termination, payment/auxiliary bindings, cashier source corrections and exact field/separator bindings, parsed event-enum dispatch, transaction-band mappings and rejection gates, editable lookup metadata/key limits and NULL initialization, calculator/group/radio bindings, source-order/field mappings, exact decimal stepping, validation, choice/text ownership, guarded navigation, runtime/native controls, script analysis and lifetime cases |
| Strict type check | Current working tree passes; the historical HTTP backup-parser TS2322 is resolved with its behavior preserved |
| Isolated static build | Two identical 63-module numeric snapshots, followed by a 65-module combined snapshot. Both full runs pass the existing regression suite. Continuing concurrent print/fixture edits subsequently break source equality; neither full result establishes final current-tree acceptance |
| Actual-runtime browser fixture | Frozen numeric snapshot: 8,549 assertions pass with no failures, runtime errors or page errors; synthetic data, twenty-seven source-bound criteria forms, live suffix text/visibility/descriptions and retained drafts, forty complete criteria dialogs including fifteen single-lookup, six inherited reference-text and six numeric owners, native dates, item selection, zone/count validation and reference cancellation, original percentage captions and decimal return, lookup veto/retry and duplicate-key selection, source Boolean flags and untouched null/zero semantics, timestamp-preserving masked date edits and live mask recovery, atomic native date preflight and preference branches, source KeyDown navigation and default-button collision prevention, focused sibling-action visibility through reflow, required-field form/grid/editor guidance, bounded variable-height lookup windows, source-sized paging and option reuse, forty-seven global mappings, 82 entry mappings, fifty-three modal mappings including the shared-buffer invoice picker, cashier closing, cash tendering and category changes, selected source handlers, strict recorded-SQL/RPC fixtures, production Handle/Send and a mocked native theme bridge |
| Browser layout/keyboard checks | Frozen numeric snapshot: 636 verified appearances in one complete run: 9 component, 8 native-field dialog, 16 calculator, 8 aging-entry, 48 single-entry, 16 Contact Group, 12 Contact Card, 4 editable-dropdown, 5 editable-lookup, 12 automatic-choice, 28 selector-variant, 30 transaction-band, 4 associated-invoice, 8 cashier closing, 8 payment, 8 category, 108 criteria and 304 complete criteria-window cases; four workspace viewport sizes plus short transaction/lookup panes; real native date rejection/recovery and Enter/Cancel, selection/acceptance in all fifteen lookup owners, persistent ShowList/Tab behavior and numeric field-order Tab/Space/Enter; native Modern focus remains at least two pixels despite the Classic focus rule |
| Component/window text contrast | All measured text passes 4.5:1; lowest observed ratio 5.959:1 across the 636 snapshot appearance cases, including criteria fields/suffixes, required guidance, active editors, popup choices and totals |
| Forced-color interaction and paint | Additional 148 passing assertions and four emulated system-palette/viewport cases; selected grid, source-suffix and lookup glyphs remain legible, native editors retain system colors, required hints fit enlarged text, rejected drafts/focus remain intact; minimum measured system selection contrast 14.371:1 |
| Browser fixture isolation | No backend/external requests or native desktop access; helper browser/server closed after each run |
| Isolated native formatting oracle | 22 synthetic literal observations match the shared expression engine, with none skipped; SHA-matched original DataWindow DLLs, no ERP launch or Retrieve/Connect; see `FIDELITY.md` |
| Packaged/native UI, database, hardware acceptance | Not performed for these changes |

The latest complete numeric-snapshot browser evidence is in the session's
`numeric-criteria-consolidated\result.json` (8,549 assertions, 636 appearances,
plus 148 forced-color assertions). Focused owning-dialog evidence is in
`numeric-criteria-final-focused\criteria-window-result.json` (1,908 assertions,
304 appearances). `numeric-criteria-verification.json` records both identical
tested builds, current source/test hashes, matching fixtures, measured results
and the explicit concurrent-print differences. Its `currentSourceMatch` is
false; the integrated 65-module tree is not silently attributed these results.
`numeric-criteria-concurrent-frontend.log` and
`numeric-criteria-concurrent-types.log` separately record the combined tree's
692 passing tests and strict types. The earlier numeric logs retain the
685-test snapshot.
The subsequent `numeric-current-consolidated\result.json` also records 8,549
assertions, 636 appearances and 148 forced-color assertions on its 65-module
build. `numeric-current-frontend.log` and `numeric-current-types.log` record
693 passing tests and strict types. `numeric-current-inputs.json` captures the
inputs before those checks. `verify-numeric-current.mjs` refused to issue a
current-source verification report after detecting subsequent changes to the
browser fixture; another read then found `modern-print.ts` changed too.
These results remain separate snapshots, not a basis for freezing or overwriting
another editor's work. The subsequent print integration is recorded separately above.
The preceding `text-criteria-verification.json`,
`text-criteria-consolidated\result.json` (8,243 assertions / 588 appearances) and
`text-criteria-retry-focused\criteria-window-result.json` (1,602 / 256) remain
historical evidence for the 672-test reference-text snapshot.
The previous `lookup-criteria-verification.json` and its result paths retain
the preceding 659-test, 7,997-assertion snapshot.
The complete result includes
`criteriaWindowCases` once; component-only runs do not execute extra owning-window
appearances. Node-side real-input assertions are additional checks, not part of
the reported in-page assertion count.

Earlier numeric failures remain recorded. The first mapping missed Day's
header-band `day_t`; the normal freeform detail-label gate then correctly
rejected an incomplete correction. An explicit source-band binding resolved it,
with negative tests for missing/wrong-band declarations. The first browser run
passed all 1,908 in-page assertions and real numeric input checks, then failed
because the appearance helper equated plain Tab focus with model-column state.
The corrected check verifies the exact focused field node without changing
runtime selection or edit events. Initial provenance verification separately
detected concurrent print edits; those edits remain intact and outside the
snapshot's browser-acceptance claim.

Earlier lookup runs remain separate: `lookup-criteria-focused` exposed fixture
assumptions about Boolean flags and the quotation-specific cancellation value.
`lookup-criteria-verified-focused` passed all 1,356 in-page assertions but its
real-input helper used `OK` instead of source `Ok`. `lookup-criteria-input-focused`
attempted to click through the source-persistent subaccount ShowList.
The corrected real-input sequence verifies that selection keeps this list open
and Tab accepts, dismisses it and focuses the next action. No production
semantics were changed to satisfy these fixture assumptions.

The preceding native-date baseline remains in `native-date-verification.json`,
`native-date-complete\result.json` (7,244 assertions / 420 appearances) and
`native-date-keyboard-focused\criteria-window-result.json` (603 / 88), with
628 frontend tests in `native-date-keyboard-frontend.log`.

Earlier native-date failures are retained separately. `native-date-focused` and
`native-date-final-focused` exposed fixture attempts to focus Letter inputs that
the source both hides and disables; the fixture now explicitly reveals/enables
and then restores them. `native-date-verified-focused` exposed a real invalid-
border cascade defect. `native-date-recovery-focused` exposed missing native
KeyDown dispatch and hidden-control Send navigation. These are resolved in the
matching final snapshot, not counted as passing runs. A passing test run with
in-page assertions alone was not treated as sufficient when real input failed.

The preceding item-selection baseline remains in
`item-selection-current-complete\result.json` (7,018 assertions, 396 appearances,
plus 148 forced-color assertions), `item-selection-current-focused\criteria-window-result.json`
(377 assertions, 64 appearances) and `item-selection-verification.json`.
Its 617 frontend tests and strict types are in `item-selection-current-frontend.log`
and `item-selection-current-types-final.log`. The mistyped script invocation in
`item-selection-current-types.log` is historical, not type-check evidence.

The first successful item-selection full run in `item-selection-complete`
predates a concurrent Classic focus-rule edit. That edit is preserved; a stronger
Modern selector and a real-browser focus-width assertion prevent the Classic rule
from overriding Modern focus. `item-selection-current-build` and its matching
focused/full runs establish that earlier baseline; the native-date snapshot
retains both focus rules.
The earlier `item-selection-interaction` failure exposed missing feedback for
headless all-items retrieval and is not passing evidence.

The preceding nine-owner baseline remains in
`criteria-owners-complete-final\result.json` (6,953 assertions, 392 appearances)
and `criteria-owners-windows\criteria-window-result.json` (312 assertions,
60 appearances). Its `criteria-owners-verification.json` recorded 62 of 63
production matches and the historical HTTP module/type mismatch;
`criteria-owners-current-types.log` retains that resolved TS2322 failure.
The interrupted `criteria-owners-complete` directory has no passing result.
Neither historical mismatch describes the current verified snapshot.

The preceding suffix/percentage baseline remains in
`criteria-affixes-complete\result.json` (6,871 assertions, 380 appearances),
`criteria-affixes-components\criteria-result.json` (773 assertions, 108 appearances),
`criteria-affixes-windows\criteria-window-result.json` (230 assertions, 48 appearances)
and `criteria-affixes-forced-final\forced-colors-result.json` (148 assertions).
`criteria-affixes-verification.json` records only that earlier snapshot.

The preceding linked-criteria baseline remains in
`linked-criteria-complete\result.json` (6,560 assertions, 320 appearances),
`criteria-windows-results\criteria-window-result.json` (184 assertions, 40
appearances) and `linked-criteria-focused-final\criteria-result.json` (695
assertions, 96 appearances). `linked-criteria-verification.json` describes only
that earlier source slice. The preceding static-list expansion remains in
`criteria-followup-full-results\result.json` (6,206 assertions, 280 appearances).
The older `criteria-verification.json` covers its own preceding slice, not
either subsequent criteria expansion.
`calculator-focus-before.json` reproduces clipped post-Tab actions; all eight
corrected real-keyboard repetitions in `calculator-focus-trace.json` retain
complete visible focus. The deterministic reflow/passive-scroll checks and
all original calculator appearance checks also pass in the final full run.
Failed or interrupted runs, including `criteria-complete`,
`criteria-complete-results` and `criteria-affixes-forced`, are not passing
evidence. The preceding completed required-guidance baseline remains in
`required-guidance-complete\result.json`; `required-guidance-verification.json`
records its 63 matching production modules, 21 matching copied fixtures and
87 source/test hashes, plus the 30 measured transaction-header policies
(29 sticky, one normal-scrolling short-pane case).
The completed earlier high-contrast baseline is retained in
`forced-colors-full-final\result.json`; its focused evidence is in
`forced-colors-final\forced-colors-result.json`.
`forced-colors-verification.json` records all 63 matching production modules,
21 matching copied fixtures, 87 source/test hashes including the Node-side
forced-color helper, final counts and glyph/background pixel measurements.
Screenshots and diagnostics remain beside each result.
The preceding completed lookup evidence is retained in
`lookup-window-verified\result.json`; focused selector/contact evidence is
in `lookup-window-focused-final\editable-lookup-result.json` (840
assertions, 45 appearances). `lookup-window-verification.json` records the
matching 63 production modules, all 21 copied browser fixtures, 86 source/test
hashes and final metrics. `lookup-window-before.json` and
`lookup-window-after-final.json` retain the isolated 10,000-choice measurements.
Native format expressions, output and comparison
are in `date-mask-oracle`. Focused category evidence remains in
`presentation-category-boundaries\category-result.json`.

The browser fixture checks retained edits/focus, deferred mode changes, storage
errors, title/close bindings in both modes, dialog semantics and response codes,
menu dispatch, accelerator ownership, nested response/message modality, active
window restoration, CloseQuery, subscriptions, print isolation and cleanup.
It also checks real-definition bindings, 10,000-row list windowing, virtual-row
visibility, pending/rejected/stale editing, definition replacement/clearing,
readonly changes during validation, acceptance ownership, computed-cell navigation,
explicit data-column reselection, row recalculation and Classic fallback.
Real browser pointer and keyboard checks also exercise repeated numeric steps,
grouped input, deferred acceptance and Tab advancing to the next row. Contrast
checks include the new controls and active editors.
Form-tab checks additionally cover actual pointer/keyboard activation, preserving
the current page through confirmation, failed/successful synthetic commit
outcomes, dynamic page changes, single event dispatch and released subscriptions.
Delayed field-acceptance cases verify that neither presentation can navigate
before the existing validation finishes; the original confirmation sees the
accepted buffer value, while rejection leaves the original page selected.
Real pointer checks cover immediate rejection and correction: pressing a tab
does not blur/revalidate the same entry, rejected drafts keep input focus, and
accepted navigation preserves focus explicitly requested by SelectionChanged.
They do not count as another complete Modern window mapping.
Shared-editor cases also cover live GetText/SetText ownership, corrected
rejection, ordered rapid input before validation, source-driven Save availability,
live Find and clear through real keyboard input, busy acceptance,
input failure/correction, input-event messages and queued-event cancellation on
close. The currently running event is allowed to finish; later queued work is
invalidated without writing the draft.
The component appearance matrix covers light/Compact/100%, dark/Comfortable/200%,
and 280px-wide components at 200%; two-dimensional lists may scroll horizontally,
while forms must reflow without horizontal scrolling. These component checks
do not establish full business-window reflow or assistive-technology conformance.
The separate response-dialog matrix covers light/Compact/100% and
dark/Comfortable/200% at 1366x768, 683x384 and 320x768, including long titles and
labels. It checks every focused control remains visible and the dialog has an
accessible name. This is browser reflow evidence, not native Windows scaling.
It found and corrected a dialog focus escape and focus obscuration on resize;
the component pass also corrected selected-row text losing contrast against
readonly backgrounds. Checks enforce behavior and computed contrast rather
than accepting a screenshot alone.
The response-dialog pass also corrected unrelated maximized-sheet text leaking
into changed response titles, unnamed modal containers for untitled windows, and
legacy right-aligned labels in flow-based forms.
The entry matrix covers both Detail and List at light/Compact/100% on 1366x768,
and dark/Comfortable/200% on 1366x768, 683x384 and 320x768. It checks actual Find
typing, criterion keyboard order, named groups, full focused-control visibility,
text contrast and retained text across Appearance changes. Appearance changes
retain the source-cased live draft without accepting it or saving a transaction.
This is not packaged Windows scaling or full WCAG acceptance.

The new blocking `presentation` CI job installs pinned TypeScript/Playwright
tools, checks types and frontend tests, generates both metadata inventories,
builds the fixture, runs Chromium, and retains metadata and synthetic screenshots
even on failure. It has not been run remotely:
no commit or push is authorized/performed by this UI work.

## Static inventory

```powershell
python -I tools\parity\test_ui_inventory.py
python -I tools\parity\ui_inventory.py --out "$env:TEMP\trader-ui-inventory.json"
```

The tool reads only the redacted `data/src` definitions. It does not open the
application, connect to a database, or read the deployment's login files.
It merges inherited window control paths, honors explicit false overrides, and
selects DataWindow definitions using the same `_index.json` mapping as the runtime.
It does not emit SQL, scripts, record values, or control default text.

The initial source digest
`9d085572f3b7afe03672d8eaabd21f2d2bf282d3ebdd879b824b4931b718e2d2`
produced:

| Static metadata | Count |
|---|---:|
| Object definitions | 2,830 |
| Window definitions | 2,062 |
| Window control paths after window inheritance | 32,730 |
| Indexed and available DataWindows | 8,740 |
| Shadowed/unselected bundle definitions | 8 |
| DataWindow columns | 189,073 |
| Menu trees | 156 |
| Menu-item occurrences across all trees | 207,400 |
| Missing static control/nested-report DataWindow references | 5 |
| Verified Modern screens | 0 |

Menu-item occurrences include repetition across inherited menu trees; they are
not unique user commands. DataWindows include grids, dropdowns, reports, and
other presentations; they are not all printable templates. The eight unselected
bundle entries must not be interpreted as eight missing indexed definitions.

The generated artifact records limitations and missing references explicitly.
Runtime callers, dynamic layouts, rights/role variants, document classification,
actual printer dimensions, and per-state evidence still need completion before
the release denominator is established.

All five missing static references are window-control references, not nested
report references. This is metadata-only classification; runtime replacements
or reachability have not been verified:

| Missing DataWindow | Referencing windows |
|---|---|
| `d_deletedue_detail` | `w_delete_due` |
| `d_diseasetreatmenttemplate_printout` | `w_diseasetreatmenttemplate` |
| `d_populate_sales_for_proformainv_header` | `w_populate_finalizedsaleorder`, `w_populate_saleinvoices` |
| `d_servicepurtemplate_print` | `w_serviceinvpurtemplate`, `w_serviceinvpurtemplate_popup`, `w_servicepurtemplate` |
| `d_top10sellingitemsgraph` | `w_dashboard` |

## Script migration dependencies

Generate the definition inventory first, then analyze the redacted scripts:

```powershell
node web\tools\ui-script-inventory.mjs data\src\scripts "$env:TEMP\trader-ui-inventory.json" "$env:TEMP\trader-ui-script-inventory.json"
```

The analyzer uses the existing PowerScript parser without executing routines.
It emits catalogued target identities, symbolic receivers, locally declared
receiver types, routine-start locations and AST paths. It never emits SQL,
arbitrary string values, record values or script bodies, and stops on parse
errors rather than claiming a complete inventory.

The script/definition source digest
`213ac4f8cc7efa06682441f3232aa994461d0fb236d917a8f4cecdd342044f43`
produced the following candidates:

| Static dependency metadata | Count |
|---|---:|
| Parsed script files | 2,780 |
| Parsed routines | 37,792 |
| Relevant sites | 53,976 |
| Window-open sites | 3,975 |
| Distinct known window targets | 1,413 |
| Unresolved window-open sites | 426 |
| Dataobject assignments | 3,809 |
| Assignments to locally declared DataStores | 1,088 |
| Explicit empty Dataobject bindings | 5 |
| Unresolved Dataobject assignments | 840 |
| Presentation-property assignments | 26,024 |
| Layout calls | 5,262 |
| Focus calls | 10,938 |
| Output calls | 529 |
| Message-parameter sites | 3,439 |

Parsed-routine counts refer to the parser's script-body inventory, not the
37,895-routine exported catalog. Dataobject assignments include nonvisual
DataStores; unclassified receivers must not be assumed to be screen controls.
An empty binding is recorded as a clear, not a missing DataWindow.

Known targets are static candidates, not proof of reachability, role access or
successful navigation. Inheritance, aliases, returned values and inter-routine
dataflow are not expanded. Output sites do not identify approved documents,
paper sizes or printers. These dependencies guide caller/state sampling and
semantic mappings; they do not increase verified Modern coverage.

## Shared-engine baseline

`web/tests/presentation-lifecycle.test.ts` characterizes the existing runtime
using synthetic class definitions and a recording host, without a DOM, server,
or recovered business fixtures. It covers:

- Control constructors, UI creation, Open, posted events, initial tab selection,
  and initial DataWindow focus in their current order.
- Sheet parent identity and modal/sheet flags.
- Reusing an open window without rerunning Open or losing its unsaved values.
- CloseQuery cancellation, accepted close, child destruction, modal return
  channels, and overlapping close requests.
- Window timer retention after a cancelled close and cleanup after accepted close.

Run this baseline with the related interpreter/model tests:

```powershell
node --test web\tests\presentation-lifecycle.test.ts web\tests\interp.test.ts web\tests\dw.test.ts
```

These are characterization tests, not full parity evidence. `UiHost` now types
the actual create/show/activate/close, focus, menu and print callers. `dw-edit.ts`
owns the characterized ItemChanged/conversion/validation/ItemError/write order;
both presentations reuse it. Unsupported validation retains Classic's permissive
behavior with a warning instead of a silent fallback.

Hosts own their global keyboard listeners and styles. Closed windows remove
subscriptions, menu/drag listeners and timers; DataWindow views cancel queued
work and release model listeners. Temporary print/nested-report views do not
subscribe as live editors. Full native focus, complex editor/dropdown/scanner
ordering, and role-by-role workflow equivalence remain open.

## Integration gates

Complete the runtime/role/caller baseline, Modern field/form/grid presentations
and document-template infrastructure before the production pilot. Then migrate
the screen and document catalogs with explicit field/action/state evidence.
Neither synthetic prototype coverage nor compatibility layouts count toward
that denominator.

The final Modern-default rollout remains gated on complete screen/document
coverage, keyboard/assistive-technology and WCAG 2.2 AA acceptance, packaged
Windows/WebView2 behavior, performance, and available scanner/printer evidence.
Native title-bar theme integration is implemented but not packaged/native-verified.
Exact printer models and
paper/label dimensions remain unknown. Rust,
PostgreSQL and packaged desktop verification runs in authorized GitHub Actions,
not through a local toolchain installation.

Classic behavior and printing must remain independently verifiable. Screen
coverage and print-template coverage are separate. Missing authoritative
definitions and unavailable hardware remain blockers, not completed features.
Use synthetic fixtures and isolated test databases; do not upload operational
screenshots or data to this public repository.
