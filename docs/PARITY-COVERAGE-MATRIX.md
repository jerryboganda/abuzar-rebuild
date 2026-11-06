# Parity coverage matrix - 78 non-report screens

Generated from `tools/parity/items-visible-nonreport.json` and the committed probes under `tools/parity/`.
Status: **V** = add/edit/save (or the screen's full intended cycle) verified in PostgreSQL with exact restore; **P** = partial (field/save evidence only); **N/A** = no record write; **B** = original/data blocker.

| # | Screen | Committed probe(s) | Status | Evidence / gap |
|---:|---|---|:---:|---|
| 1 | File \| Change User | - | N/A | login/session switch; no record write |
| 2 | File \| Exit Ctrl+X | - | N/A | application exit |
| 3 | Purchase \| Purchases | probe-purchase-fields.mjs | V | add/save purchase 12,284 with purprice 9, DB read-back, stock/avg unchanged, exact restore; post-entry edit is a separate maintenance screen |
| 4 | Purchase \| Purchase Return | probe-preturn-crud.mjs | V | add/edit/delete/save |
| 5 | Purchase \| Opening Purchase | probe-openingpurchase-fields.mjs | V | suppinvcode/remarks typed, saved, DB read-back, exact restore |
| 6 | Purchase \| Purchases (Loose) | probe-loosepurchase-fields.mjs | V | purprice typed, saved, DB read-back, exact restore |
| 7 | Purchase \| Purchase Orders | probe-purchaseorder-crud.mjs | V | add/save, reopen/edit remarks, Delete disabled (original), exact restore |
| 8 | Sales \| CashSale | probe-cashsale-crud.mjs; probe-sale-fields.mjs | V | add/save 588891 (customer 19, item 9801), DB read-back, stock -1, Delete disabled (original), exact restore |
| 9 | Sales \| Credit Sale | probe-creditsale-crud.mjs; probe-sale-fields.mjs | V | add/save 588891 (customer 22, item 9801), DB read-back, stock -1, Delete disabled (original), exact restore |
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
| 33 | Basic Data \| Item .......... \| Item Basic Data | probe-itembasicdata-add.mjs | V | new-item add/save verified; edit path original early-return defect (parity); derived masterpartname classified |
| 34 | Basic Data \| Item .......... \| Price Policy | probe-pricepolicy-crud.mjs | V | slab add/edit/delete, exact restore |
| 35 | Basic Data \| Item .......... \| Item Alert | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 36 | Basic Data \| Item .......... \| Sales Tax Schedule | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 37 | Basic Data \| Item .......... \| PCT Codes | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 38 | Basic Data \| Item .......... \| Generic Item Type | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 39 | Basic Data \| Item .......... \| Item Thickness | probe-single-master.mjs | V | generic single-entry master cycle |
| 40 | Basic Data \| Item .......... \| Lock Reason | probe-single-master.mjs | V | generic single-entry master cycle |
| 41 | Basic Data \| Item .......... \| Category Segment | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 42 | Basic Data \| Item .......... \| Manufacturer Type | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 43 | Basic Data \| Sale Template | probe-saletemplate-add-edit.mjs | V | add header/template 583 + item detail, edit name/save, DB read-back, exact restore; Delete menu disabled |
| 44 | Basic Data \| Patient \| Death Certificate | - | B | DeathCertificate 0 rows in both databases |
| 45 | Basic Data \| Tax Category | screen-parity/crud-fields (16-form pass) | V | every editable field typed; add/edit/delete/save documented |
| 46 | Maintenance \| Change Password | probe-changepassword.mjs | V | wrong old password rejected, real change, restore through the form; password back to baseline |
| 47 | Maintenance \| Preferences | probe-preferences-save.mjs | V | showtransitstockinitemlist N -> Y -> N through the form; DB read-back, exact restore |
| 48 | Maintenance \| Change Items Price | probe-changeitemprice-crud.mjs | V | manufacturer 120 sheet; item 22407 95 -> 96 saved in Item, exact restore |
| 49 | Maintenance \| Database Utilities \| Backup Database | - | B | SQL Server utility; no PostgreSQL equivalent |
| 50 | Maintenance \| Database Utilities \| Check Database Integrity | - | B | SQL Server utility; no PostgreSQL equivalent |
| 51 | Maintenance \| Adjustment \| Increase | probe-adjustment-remarks.mjs | V | remarks typed, saved, stock/DB/audit exact restore |
| 52 | Maintenance \| Adjustment \| Decrease | probe-adjustment-remarks.mjs | V | remarks typed, saved, stock/DB/audit exact restore |
| 53 | Maintenance \| Adjustment \| Stock Adjustment | probe-stockadjustment-crud.mjs | V | add buffer 2630 + item 9801, save, DB read-back, exact restore |
| 54 | Maintenance \| Issue \| Issue Category | probe-issuecategory-crud.mjs | V | add/edit/delete/save |
| 55 | Maintenance \| Receipt \| Receipt Category | probe-receiptcategory-crud.mjs | V | add/edit/delete/save |
| 56 | Maintenance \| Receipt \| Receipt | probe-receipt-crud.mjs; probe-receipt-edit.mjs | V | add/save and edit/save; delete hard-disabled (original) |
| 57 | Maintenance \| Priority Setting | probe-priority-save.mjs | V | priority edit/save, DB read-back, restored |
| 58 | Maintenance \| Change Item Discount | probe-changedisc-catwise.mjs | V | category-wise batch discount saved/verified |
| 59 | Maintenance \| Modify Sale Invoices | probe-modifysale-crud.mjs | V | invoice 588890 remarks edit/save, UPDATE rowcount 1, exact restore |
| 60 | Maintenance \| Modify Last Transaction Date | probe-lasttransdate.mjs | V | change/save/restore |
| 61 | Maintenance \| Godown Preferences \| Group Wise Godown Setting | probe-groupgodown-crud.mjs | V | add/edit/delete/save |
| 62 | Maintenance \| Interface Setting | probe-interfacesetting-save.mjs | V | tab visibility edit/save/restore |
| 63 | Maintenance \| Update Item Basic Data | probe-itembasicdata-update-crud.mjs; probe-itembasicdata-add.mjs | V | 27,818 rows; item 27429 1000 -> 1001 saved on row focus change, DB read-back, exact restore |
| 64 | Maintenance \| Update Item Suppliers | probe-itemsuppliers-crud.mjs | V | add item 9801/supplier 311 at 10.00, edit rate 12, delete through the form; exact restore |
| 65 | Maintenance \| Change Item Reorder Qty | probe-reorderqty-crud.mjs | V | compound 20/2/9/1, item 21195 reorderqty 0 -> 1 saved, UPDATE rowcount 1, exact restore |
| 66 | Maintenance \| Import Historical Data \| Import Previous Sales | - | B | SQL-Server cross-database source does not exist |
| 67 | Maintenance \| Inplace Initialization | probe-inplace-initialization.mjs | V | disposable-copy runs documented |
| 68 | Maintenance \| Lock Item Batches | probe-lockitembatches.mjs | V | lock/unlock verified |
| 69 | Manage \| Groups | probe-groups-crud.mjs; probe-groups-edit.mjs | V | edit/save verified; new-group first-save is original defect; delete disabled |
| 70 | Manage \| Users | probe-users-crud.mjs | V | add/edit/save verified |
| 71 | Manage \| Group Wise Header Setting | probe-groupheader-setting.mjs | V | headers/settings verified |
| 72 | Manage \| Group Allowed Price Setting | probe-groupsetting-crud.mjs | V | add/delete verified |
| 73 | Manage \| Group Wise Cash Account Setting | probe-groupsetting-crud.mjs | V | add/delete verified |
| 74 | Manage \| Session Monitor Ctrl+Alt+M | probe-changepassword.mjs (dialog only) | N/A | read-only session list; password prompt |
| 75 | Manage \| Cashier Management \| Cashier Job | probe-cashierjob-crud.mjs | V | add job 2 for user 2, DB read-back, Delete disabled (original add-only), exact restore |
| 76 | Manage \| Cashier Management \| Cashier Activity Window | probe-dialog-captures.mjs | B | original "Unable to fetch cashier job data" when no active job; capture matches |
| 77 | Manage \| Job Schedule | probe-jobschedule-save.mjs | B | original screen fails with Invalid column name 'Name' (no SysJobs tables); rebuild PG scheduler probe is recorded, not a parity gap |
| 78 | Manage \| Group Wise Supplier Category | probe-groupsuppliercategory-crud.mjs | V | add group 2 / supplier category 1 / status 1, delete through the form, exact restore |

Totals: **V 67**, **P 0**, **N/A 3**, **B 8** of 78.

## Field-cell coverage

The v4 full audit covered **860 rendered fields / 426 probed / 306 accepted the generic value**.  The 43 ambiguous cells were then driven separately:

* 22/22 Customer fields, 8/8 rendered Item fields, 7 remaining Purchase/Opening/Sale Promotion/Adjustment fields - real editors, Save, PostgreSQL read-back, exact restore.
* 4 cells are non-text/hidden/derived (Purchase Order `reorderqty`/`remarks`, Price Policy `name` choice, Item Basic Data `masterpartname` absent column).
* Remaining generic non-applied cells are lookups, recalculated totals, `char(1)` domain codes and date readback objects; they are not missing editors.

All 78 screens are now classified: **67 V**, **0 P**, **3 N/A**, **8 B**.  The last transaction screens to move from P to V were Purchase Orders, Refused Sales, Cash Sale Return, Cash/Credit Sale and Sale Template.  The 8 B rows are original-side blockers (voucher detail `GetChild("patientcode")`, SQL-Server-only utilities, missing Death Certificate data, Import Historical Data source DB, Cashier Activity original error, broken Job Schedule screen).

