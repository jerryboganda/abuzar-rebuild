# Compatibility fallback acceptance register

Status: **0 DataWindow compatibility fallbacks and 2 Classic windows**, none
accepted as a Modern field layout. This register records the selected screen
batch and the evidence needed for a formal acceptance decision.

Evidence: `ui-browser-structure-2026-11-10.json` (consolidated pass: 61,777
assertions, 1,881 appearances, 0 structure failures before this batch) and
`ui-derived-compatibility-data-surfaces-backlog.json` (0 entries).

## Replaced in this batch (18)

The following surfaces now derive as Modern layouts and pass the focused
Classic/Modern row-sharing check.

### Compact card/footer/SMS surfaces (12)

Returned to the derived catalog after the structural-layout fix (fields size to
their own row; fields spanning several tracks fill them).

| DataWindow | Previous finding | Status |
|---|---|---|
| `d_emp_idcard_print` | compact card rows | replaced — derives and passes |
| `d_picknpay_emp_idcard_print` | compact card rows | replaced — derives and passes |
| `d_wise_emp_idcard_print` | compact card rows | replaced — derives and passes |
| `d_wise_emp_transportcard_print` | compact card rows | replaced — derives and passes |
| `d_wise_studentcard_print` | compact card rows | replaced — derives and passes |
| `d_wise_studenttransportcard_print` | compact card rows | replaced — derives and passes |
| `d_issuefooter_view` | adjacent rows overlap | replaced — derives and passes |
| `d_posted_opensalereturnfooter` | adjacent rows overlap | replaced — derives and passes |
| `d_posted_salefooter` | row relations differ | replaced — derives and passes |
| `d_salereturninsale_footer` | adjacent rows overlap | replaced — derives and passes |
| `d_smscenter_composesms` | `compute_1`/`smstext` row | replaced — derives and passes |
| `d_smscenter_preview` | `compute_1`/`smstext` row | replaced — derives and passes |

### Staggered footer surfaces (6)

These forms place fields on overlapping source rows that a CSS grid cannot
represent without merging rows. They now derive with `sourceLayout: true`, which
places every field at its source box scaled to the container; labels and suffixes
are painted at their source geometry without enlarging the measured field.
`ModernDwView` uses this mode only for these forms.

| DataWindow | Previous finding | Status |
|---|---|---|
| `d_alnaseeb_deliveryorder_saleinvprint` | staggered row relations | replaced — source-proportional layout |
| `d_normalpurchasereturnfooter` | adjacent rows overlap | replaced — source-proportional layout |
| `d_old_general1` | staggered row relations | replaced — source-proportional layout |
| `d_opensalereturnfooter` | adjacent rows overlap | replaced — source-proportional layout |
| `d_salereturnfooter_view` | adjacent rows overlap | replaced — source-proportional layout |
| `d_servicefooter_view` | near-threshold row overlap | replaced — source-proportional layout |

The focused structure gate for the six footers plus the compact student transport
card passes 35 assertions with 0 failures. The row-sharing gate applies a
one-CSS-pixel tolerance **only** to source-proportional surfaces, because the
copied source boxes land exactly on the half-overlap boundary after rounding; a
grid surface keeps the exact threshold (the tolerance would otherwise add a
border-line relation the Classic editor does not have).

## Remaining Classic windows (2)

| Window | Structure finding | Current treatment | Status |
|---|---|---|---|
| `w_arg_cust_sdate_ldate_v13` | staggered date/format row | labelled Classic window | pending |
| `w_arg_customers_sdate_ldate_v7` | list/row overlap | labelled Classic window | pending |

## Checkbox-loading hardening

A checkbox click that arrives while its choice editor is loading is queued on
the DataWindow view, not on the editor instance. A repaint that rebuilds the
editor takes the queued click from the view and applies it once; cancelling the
edit drops it. The focused shared-choice run passes 871 assertions with 0
failures.

## Acceptance rule

A Classic window may be accepted only when the business explicitly approves that
screen using the original Classic rendering, with the evidence above. Until then
the audit continues to report it as a Classic window, not a verified Modern
screen.
