# Classic/Modern completion audit

Generated from the working tree on 2026-11-10T07:08:43.438Z.
Static source digest: `fb6f64cdf4822011bb1a6d9146687eb864535ff855af20d461495f448655bb4c`.

## Verdict

**NOT 100% COMPLETE.** The plan's own release gates still include an incomplete
screen/document catalog, no accepted all-role pilot, no approved Modern print
templates, and no packaged Windows/WebView2, assistive-technology or physical
printer/scanner acceptance. The measured local checks are real, but they cover
only the authored surfaces.

## Measured evidence

| Check | Result |
|---|---|
| Frontend tests | 930 passed, 0 failed |
| Strict presentation types | Passed |
| Static inventory tests | 9 passed, 0 failed |
| Static build | 80 modules |
| Full browser suite | 61777 assertions, 1881 appearances; 0 failures, 0 errors, 0 page errors, 0 forbidden requests |
| Forced-color checks | 148 assertions, 0 failures, 4 cases |
| Focused print checks | not supplied |
| Additional calendar callers | `web/tests/calendar-callers.test.ts` covers f_getdatefromcalendar, aging/list F4 fields and inpatient/service DataWindow F4 fields inside the frontend suite above |

## Coverage

| Denominator | Count |
|---|---:|
| Window definitions | 2062 |
| Inherited window control paths | 32730 |
| DataWindow definitions | 8740 |
| DataWindow columns | 189073 |
| Missing static DataWindow references | 5 |
| Windows with a Modern layout (reviewed + generated) | 2060 (99.90%) |
| - reviewed by hand | 183 (8.87%) |
| - generated from the source definitions (validated, not individually reviewed or browser-verified) | 1875: 1626 modal and 249 entry layouts |
| Authored layouts by registry | 9 workspace/tool, 55 criteria, 113 entry, 4 calculator, 2 calendar, 2 shell |
| Windows without a Modern layout | 2 |
| DataWindows with a Modern surface (reviewed + generated) | 6373 (72.92%); 302 reviewed (48 global with nested lookups, 266 contextual) and 6071 generated only, overlaps counted once |
| DataWindows without a Modern surface | 2367 |
| - compatibility fallbacks (Classic rendering retained, not Modern field layouts) | 6 |
| On-screen DataWindows (excluding print/report layouts, which are exempt from parity) with a Modern surface | 3194 of 3194 (100.00%); 5546 print/report candidates exempt |
| Authored names absent from the static inventory | 0 windows, 0 DataWindows |
| Modern print template families | 3 |
| Registered Modern print definitions | 4 |
| Approved Modern print templates | 0 |
| Preview Modern print templates | 2 |
| Blocked Modern print templates | 1 |
| Verified complete Modern screens | 0 |
| Print and report candidates (evidence classes, not approvals) | 5546 of 8740: datastore-only 345, hidden-control-only 55, nested-in-report 102, no-evidence 760, print-target 229, referenced-by-name 238, registered-template 4, report-or-document 5313, screen-control 1658, script-assigned-control 36 |
| Document uses classified | {"unclassified":8740} |
| DataWindow use evidence (static controls and scripts; not a classification) | not in this inventory |

The static inventory reports **0 verified Modern screens** because it has no
complete per-screen acceptance evidence. Authored mappings are presentation
components, not accepted business workflows.

## Work packages

| Package | Status | Evidence |
|---|---|---|
| ui-baseline | partial | Static inventory covers 2062 windows and 8740 DataWindows; runtime role/caller and document-family classification are not complete. |
| ui-direction | partial | Windows-familiar tokens and the isolated prototype exist; the all-role production pilot and official document direction are not approved. |
| ui-contract | partial | Shared validation, choice, text, temporal, tab, modal and calendar contracts have characterization/synthetic coverage, including the additional f_getdatefromcalendar, aging/list and inpatient/service F4 callers; full native event/property equivalence remains open. |
| ui-preferences | partial | Versioned workstation/user/database preferences, hashed keys, deferred mode changes and per-family print choices are implemented; authenticated database/native acceptance is pending. |
| ui-primitives | partial | Modern controls, selectors, grids, dialogs, tabs, feedback, forced colors and print tokens exist; native chrome, assistive-technology and remaining selector variants remain open. |
| ui-shell | partial | 2060 windows have a reviewed or generated layout (none browser-verified); complete rights-aware navigation, the full catalog and role workflows are not covered. |
| ui-data-surfaces | partial | 6373 DataWindow definitions have a reviewed or generated surface (302 reviewed: 48 global, 266 contextual; 6071 generated only, none browser-verified); 2,367 inventoried DataWindows are unmapped. |
| ui-print-engine | partial | Classic isolation and per-family Modern choice are verified; 0 approved templates and 2 preview templates exist, with 1 blocked family. |
| ui-pilot | blocked | No all-role end-to-end Cash Sale, Purchase, Account Ledger and Manager reporting pilot has been accepted. |
| ui-screen-coverage | partial | 2060 of 2,062 windows have a reviewed or generated Modern layout; complete verified screens remain zero. |
| ui-print-coverage | blocked | 4 of 8,740 DataWindows are registered as print templates; no template is approved and item-label hardware dimensions are unknown. |
| ui-resilience | partial | Synthetic interaction, focus, contrast, scaling and lifecycle checks pass; native assistive technology, real hardware and production-data acceptance are not performed. |
| ui-release-verification | blocked | Packaged Windows/WebView2, authenticated PostgreSQL, native assistive technology, printer/scanner and remote CI gates are outstanding. |
| ui-handoff | partial | Product/design/evidence documents exist, but a complete screen/document acceptance matrix and release handoff cannot be produced while the above gates remain open. |

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Coverage inventory and explicit status for every screen/field/action/state | partial | 2060/2,062 windows and 6373/8,740 DataWindows have a reviewed or generated Modern surface; the inventory reports 0 verified Modern screens. |
| Classic has zero unexplained functional regressions | partial | Local Classic/Modern characterization and synthetic browser checks pass; no complete recorded Classic baseline over all workflows exists. |
| Modern and Classic produce identical business outcomes for the same synthetic transactions | partial | Component and transaction-dialog fixtures compare values; complete sale/purchase/cashier transactions are not accepted. |
| Shared-engine event characterization | verified | Editing, validation rejection, dropdown selection, item focus, posted events, dynamic visibility, modal return, CloseQuery and calendar ordering have tests. |
| All four screen/print combinations | partial | Two invoice preview definitions support Classic/Modern print; all remaining document families do not. |
| Printed documents preserve data and machine-readable payloads; every template tested empty/single/multipage/long/grouped | partial | Synthetic print fixtures cover values, groups, totals, page numbers, dimensions and empty reports for the preview engine; no official template catalog is approved. |
| Machine-consumed exports remain compatible | partial | CSV/text/xlsx/HTML/XML tests pass; every document family is not re-verified against its exports. |
| Fresh preferences start Modern; existing Classic honored; user/database isolation | verified | Unit and browser preference cases cover defaults, isolation, deferred mode, family inheritance and storage failure. |
| Mode change leaves edits intact and applies next sign-in | verified | Synthetic preference and workspace lifecycle checks pass; real authenticated sign-in is not exercised. |
| Tab activation does not rerun Open; dirty close follows CloseQuery | verified | Lifecycle and browser tests cover retained windows, close guards and modal returns. |
| Pending operations cannot be double-submitted; unknown writes shown as uncertain | partial | Cashier/category/payment fixtures cover duplicate submission and uncertain commits; full application write paths are not covered. |
| Theme/density/text changes retain edits, focus, validation and barcode input | partial | Synthetic appearance cases pass; barcode hardware and packaged WebView2 are not verified. |
| Repeated open/close releases listeners and temporary views | verified | Lifecycle and browser cleanup checks pass for the tested surfaces. |
| WCAG 2.2 AA through automated checks and manual Windows screen-reader/keyboard assessment | blocked | Automated contrast/focus/forced-color checks pass; manual Windows screen-reader assessment and a complete criterion audit are not performed. |
| Normal text 4.5:1; large text/non-text 3:1; state not color alone | verified | Measured minimum text contrast 5.95871405026296:1 across the measured appearance cases. |
| Keys, names, relationships, live feedback, focus containment/restoration, drag alternatives | partial | Synthetic browser checks cover the mapped surfaces; complete application coverage and native assistive technology are open. |
| Pointer targets 24x24 or documented exception | verified | Authored controls and appearance checks cover the mapped surfaces. |
| No keyboard trap; grid editing and accelerator map tested | partial | Mapped grid, dialog and tab cases pass; the complete historical accelerator map and every screen are not audited. |
| 1366x768 and 1920x1080 at 100/125/150/200% Windows scaling | partial | Browser 1366/1920/320/683 checks pass; physical Windows scaling is not measured. |
| 200% text and reflow at 320 CSS px equivalent | verified | Browser appearance cases cover 200% text at narrow effective widths for the mapped surfaces. |
| Light/dark, forced colors, reduced motion, validation/selection/disabled/focus/loading | partial | Browser light/dark and 148 forced-color assertions pass; native Windows high contrast and every loading/disabled state remain open. |
| p95 interaction feedback and tab-switch targets on the agreed Windows machine | blocked | No packaged Windows performance measurement on the reference machine. |
| 30,000-item lookup and 100,000-row report/grid fixtures | partial | Fixtures ran: lookup-30000-choices-open 101 ms; grid-100000-rows-attach-and-first-paint 91 ms; lookup-30000-choices-open 101 ms (local timings, not reference-machine p95). |
| Barcode sequence, rapid keyboard, active-cell preservation | partial | Synthetic keyboard/barcode and active-cell checks pass; scanner hardware is not verified. |
| No new browser exceptions, unhandled rejections or silent failures | verified | Current full browser run: 0 failures, 0 errors, 0 page errors, 0 forbidden requests. |
| Packaged Windows/WebView2 native theme, scaling, focus, shortcuts, print dialog, printers | blocked | Not performed on a packaged Windows/WebView2 build. |
| Local Node tests, type validation, static build | verified | 930 frontend tests passed, 0 failed; strict presentation types passed; 9 inventory tests passed, 0 failed; 80-module static build. |
| Blocking UI acceptance job / typed checks / deterministic fixtures | partial | A blocking CI presentation job and deterministic fixtures exist. Remote CI (the ci and sql workflows) is authoritative for the revision that contains this report and is not recorded in this file; last run supplied when generated: none. |
| Rust/PostgreSQL/desktop integration in authorized CI | blocked | Remote CI (the ci and sql workflows) is authoritative for the revision that contains this report and is not recorded in this file; last run supplied when generated: none. The presentation job itself uses synthetic fixtures, not an authenticated PostgreSQL session. |

## Blockers

- Complete screen/field/action/state catalog: 2 of 2,062 windows have no reviewed or generated Modern layout, and 0 complete workflows are accepted.
- Complete document catalog: 8,736 of 8,740 DataWindows are not registered as Modern print templates; 0 templates are approved.
- Document families are evidence-classified (5,546 print or report candidates of 8,740) but not approved; role and caller reachability stay unverified.
- No all-role Cash Sale, Purchase, Account Ledger and Manager pilot acceptance.
- No packaged Windows/WebView2 native theme, scaling, focus, shortcut, print-dialog or printer verification.
- No authenticated PostgreSQL end-to-end acceptance of the Modern presentation; the presentation job runs synthetic fixtures.
- No manual Windows screen-reader/keyboard WCAG 2.2 AA assessment.
- No physical printer, scanner, barcode-scanner or label-paper acceptance; label dimensions are unknown.
- No reference-machine p95 measurements.

## Conclusion

The end-to-end verification does **not** support a 100% completion claim. The
local automated suite is green and the Modern print engine and current dialog
families are verified for their scoped synthetic evidence, but the plan's
required screen/document catalog and native/hardware acceptance remain open.

This report only reads the working tree; it performs no commit, push, release,
deployment or live-system change.
