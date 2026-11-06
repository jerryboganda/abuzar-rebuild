# Parity coverage matrix - 78 non-report screens

Generated from `tools/parity/items-visible-nonreport.json` and the committed probes under `tools/parity/`.
Status: **V** = add/edit/save (or the screen's full intended cycle) verified in PostgreSQL with exact restore; **P** = partial (field/save evidence only); **N/A** = no record write; **B** = original/data blocker.

| # | Screen | Committed probe(s) | Status | Evidence / gap |
|---:|---|---|:---:|---|
| 1 | File \| Change User | - | N/A | login/session switch; no record write |
| 2 | File \| Exit Ctrl+X | - | N/A | application exit |
| 3 | Purchase \| Purchases | probe-purchase-fields.mjs; probe-purchase-save-clone (untracked) | P | purprice typed/saved/restored; prior add/save evidence |
| 4 | Purchase \| Purchase Return | probe-preturn-crud.mjs | V | add/edit/delete/save |
| 5 | Purchase \| Opening Purchase | probe-openingpurchase-fields.mjs | V | suppinvcode/remarks typed, saved, DB read-back, exact restore |
| 6 | Purchase \| Purchases (Loose) | probe-loosepurchase-fields.mjs | V | purprice typed, saved, DB read-back, exact restore |
| 7 | Purchase \| Purchase Orders | probe-purchaseorder-crud.mjs | V | add/save, reopen/edit remarks, Delete disabled (original), exact restore |
| 8 | Sales \| CashSale | probe-sale-fields.mjs; docs 588888 | P | 8 editable cells (7 applied); invoice save previously verified; no delete |
| 9 | Sales \| Credit Sale | probe-sale-fields.mjs; docs 588889 | P | 7 editable cells (6 applied); invoice save previously verified; no delete |
| 10 | Sales \| Sale Return \| Cash Sale Return | probe-salereturn-cash-invoice.mjs | V | invoice 588890 validated/saved; SR 61606, stock +1, return counter, UTN; reopen protected, Delete disabled (original); exact restore |
| 11 | Sales \| Sale Return \| Credit Sale Return | probe-salereturn-credit.mjs | V | validate invoice, save, stock/UTN/sale counter, exact restore |
| 12 | Sales \| Open Sale Return \| Cash Sale Return | probe-salereturn-open.mjs (PARITY_OPEN_CASH=1) | V | save, DB read-back, exact restore |
| 13 | Sales \| Open Sale Return \| Credit Sale Return | probe-salereturn-open.mjs | V | save, DB read-back, exact restore |
| 14 | Sales \| Quotation | probe-quotation-edit-save.mjs; docs add | V | add/save evidence; reopen/edit remarks/save verified, exact restore |
| 15 | Sales \| Refused Sales | probe-refusedsale-crud.mjs | V | add/save, reopen/edit remarks, Delete disabled (original), exact restore |
| 16 | Transactions \| Invoice Base Vouchers \| Sale \| Cash Receipt | probe-voucher-invoice.mjs | V | invoice balance and GL rows verified, exact restore |
| 17 | Transactions \| Invoice Base Vouchers \| Sale \| Bank Receipt | probe-voucher-invoice.mjs | V | invoice balance and GL rows verified, exact restore |
| 18 | Transactions \| Invoice Base Vouchers \| Sale \| Journal Voucher | probe-voucher-journalinv.mjs | B | original GetChild("patientcode") closes the form |
| 19 | Transactions \| Invoice Base Vouchers \| Purchase \| Cash Payment | probe-voucher-invoice.mjs; probe-voucher-crud.mjs | V | GL rows verified, exact restore |
| 20 | Transactions \| Invoice Base Vouchers \| Purchase \| Bank Payment | probe-voucher-invoice.mjs | V | GL rows verified, exact restore |
| 21 | Transactions \| Invoice Base Vouchers \| Purchase \| Journal Voucher | probe-voucher-journalinv.mjs | B | original GetChild("patientcode") closes the form |
| 22 | Basic Data \| Customer .......... \| Customer | probe-customer-fields.mjs | V | 22/22 fields typed/saved/read back, exact restore |
| 23 | Basic Data \| Customer .......... \| Customer Category | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 24 | Basic Data \| Customer .......... \| Sale Promotion | probe-salepromotion-crud.mjs; probe-salepromotion-weekday.mjs | V | add/edit/delete + weekdaycode through dddw, exact restore |
| 25 | Basic Data \| Customer .......... \| Customer Sector | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 26 | Basic Data \| Supplier .......... \| Supplier | probe-supplier-crud.mjs | V | add/edit/delete/save |
| 27 | Basic Data \| Supplier .......... \| Supplier Category | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 28 | Basic Data \| Item .......... \| Item | probe-item-fields.mjs; probe-item-main-add-delete.mjs | V | 8/8 rendered fields + add/delete, exact restore |
| 29 | Basic Data \| Item .......... \| Manufacturer | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 30 | Basic Data \| Item .......... \| Item Class | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 31 | Basic Data \| Item .......... \| Item Category | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 32 | Basic Data \| Item .......... \| Generic Item | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 33 | Basic Data \| Item .......... \| Item Basic Data | probe-itembasicdata-add.mjs | P | add path/fields; masterpartname classified as derived |
| 34 | Basic Data \| Item .......... \| Price Policy | probe-pricepolicy-crud.mjs | V | slab add/edit/delete, exact restore |
| 35 | Basic Data \| Item .......... \| Item Alert | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 36 | Basic Data \| Item .......... \| Sales Tax Schedule | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 37 | Basic Data \| Item .......... \| PCT Codes | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 38 | Basic Data \| Item .......... \| Generic Item Type | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 39 | Basic Data \| Item .......... \| Item Thickness | probe-single-master.mjs | V | generic single-entry master cycle |
| 40 | Basic Data \| Item .......... \| Lock Reason | probe-single-master.mjs | V | generic single-entry master cycle |
| 41 | Basic Data \| Item .......... \| Category Segment | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 42 | Basic Data \| Item .......... \| Manufacturer Type | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 43 | Basic Data \| Sale Template | - | P | field audit only; no committed full cycle |
| 44 | Basic Data \| Patient \| Death Certificate | - | B | DeathCertificate 0 rows in both databases |
| 45 | Basic Data \| Tax Category | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 46 | Maintenance \| Change Password | probe-changepassword.mjs | P | window/focus and validation; password change not committed |
| 47 | Maintenance \| Preferences | - | P | edit/save documented; no committed probe |
| 48 | Maintenance \| Change Items Price | probe-changeitemprice-crud.mjs | V | manufacturer 120 sheet; item 22407 95 -> 96 saved in Item, exact restore |
| 49 | Maintenance \| Database Utilities \| Backup Database | - | B | SQL Server utility; no PostgreSQL equivalent |
| 50 | Maintenance \| Database Utilities \| Check Database Integrity | - | B | SQL Server utility; no PostgreSQL equivalent |
| 51 | Maintenance \| Adjustment \| Increase | probe-adjustment-remarks.mjs | V | remarks typed, saved, stock/DB/audit exact restore |
| 52 | Maintenance \| Adjustment \| Decrease | probe-adjustment-remarks.mjs | V | remarks typed, saved, stock/DB/audit exact restore |
| 53 | Maintenance \| Adjustment \| Stock Adjustment | - | P | stock buffer save documented; no committed probe |
| 54 | Maintenance \| Issue \| Issue Category | probe-issuecategory-crud.mjs | V | add/edit/delete/save |
| 55 | Maintenance \| Receipt \| Receipt Category | probe-receiptcategory-crud.mjs | V | add/edit/delete/save |
| 56 | Maintenance \| Receipt \| Receipt | probe-receipt-crud.mjs; probe-receipt-edit.mjs | V | add/save and edit/save; delete hard-disabled (original) |
| 57 | Maintenance \| Priority Setting | probe-priority-save.mjs | V | priority edit/save, DB read-back, restored |
| 58 | Maintenance \| Change Item Discount | probe-changedisc-catwise.mjs | V | category-wise batch discount saved/verified |
| 59 | Maintenance \| Modify Sale Invoices | - | P | filter/selection documented; final edit/save not committed |
| 60 | Maintenance \| Modify Last Transaction Date | probe-lasttransdate.mjs | V | change/save/restore |
| 61 | Maintenance \| Godown Preferences \| Group Wise Godown Setting | probe-groupgodown-crud.mjs | V | add/edit/delete/save |
| 62 | Maintenance \| Interface Setting | probe-interfacesetting-save.mjs | V | tab visibility edit/save/restore |
| 63 | Maintenance \| Update Item Basic Data | probe-itembasicdata-add.mjs | P | batch edit/save documented; field matrix partial |
| 64 | Maintenance \| Update Item Suppliers | probe-itemsuppliers-crud.mjs | V | add item 9801/supplier 311 at 10.00, edit rate 12, delete through the form; exact restore |
| 65 | Maintenance \| Change Item Reorder Qty | - | P | dialog/columns only |
| 66 | Maintenance \| Import Historical Data \| Import Previous Sales | - | B | SQL-Server cross-database source does not exist |
| 67 | Maintenance \| Inplace Initialization | probe-inplace-initialization.mjs | V | disposable-copy runs documented |
| 68 | Maintenance \| Lock Item Batches | probe-lockitembatches.mjs | V | lock/unlock verified |
| 69 | Manage \| Groups | probe-groups-crud.mjs; probe-groups-edit.mjs | V | edit/save verified; new-group first-save is original defect; delete disabled |
| 70 | Manage \| Users | probe-users-crud.mjs | V | add/edit/save verified |
| 71 | Manage \| Group Wise Header Setting | probe-groupheader-setting.mjs | V | headers/settings verified |
| 72 | Manage \| Group Allowed Price Setting | probe-groupsetting-crud.mjs | V | add/delete verified |
| 73 | Manage \| Group Wise Cash Account Setting | probe-groupsetting-crud.mjs | V | add/delete verified |
| 74 | Manage \| Session Monitor Ctrl+Alt+M | probe-changepassword.mjs (dialog only) | N/A | read-only session list; password prompt |
| 75 | Manage \| Cashier Management \| Cashier Job | - | P | cashier job add documented; no committed full cycle |
| 76 | Manage \| Cashier Management \| Cashier Activity Window | probe-dialog-captures.mjs | B | original "Unable to fetch cashier job data" when no active job; capture matches |
| 77 | Manage \| Job Schedule | probe-jobschedule-save.mjs | P | save path; original screen error in this deployment |
| 78 | Manage \| Group Wise Supplier Category | - | P | add/delete documented; no committed probe |

Totals: **V 54**, **P 14**, **N/A 3**, **B 7** of 78.

## Field-cell coverage

The v4 full audit covered **860 rendered fields / 426 probed / 306 accepted the generic value**.  The 43 ambiguous cells were then driven separately:

* 22/22 Customer fields, 8/8 rendered Item fields, 7 remaining Purchase/Opening/Sale Promotion/Adjustment fields - real editors, Save, PostgreSQL read-back, exact restore.
* 4 cells are non-text/hidden/derived (Purchase Order `reorderqty`/`remarks`, Price Policy `name` choice, Item Basic Data `masterpartname` absent column).
* Remaining generic non-applied cells are lookups, recalculated totals, `char(1)` domain codes and date readback objects; they are not missing editors.

The matrix above is the screen-level contract.  A **P** row still needs a committed full add/edit/delete/save probe.  Purchase Orders, Refused Sales and Cash Sale Return against an invoice were the first transaction screens in this state; all three are now **V** (`probe-purchaseorder-crud.mjs`, `probe-refusedsale-crud.mjs`, `probe-salereturn-cash-invoice.mjs`).

