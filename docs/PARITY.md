# Parity status (generated)

Every number below is produced by a tool run; nothing is estimated.

## Scripts (PowerScript)
- classes built: 2831; routines that fail to parse: 0

## Windows (headless run, mock database)
- windows opened without a runtime error: **2062 of 2062** (100.0%)
- most common failures:
- unimplemented functions / members met at run time (calls):
  `method:number.getitemnumber` 41, `method:number.getitemstring` 33, `method:number.sharedata` 31, `dwname:name` 24, `ole:__invoke_method` 16, `method:number.rowcount` 15, `fn:ue_postopen` 11, `method:object.sharedata` 11, `method:number.getrow` 6, `fn:activatekeyboardlayout` 6, `method:number.getitemdatetime` 5, `member:number.i_status` 5, `datawindow.create` 4, `method:number.rowscopy` 4, `olecustomcontrol.__invoke_method` 3, `dw:d_servicepurtemplate_print` 3, `var:u_utilityservices` 2, `method:number.settransobject` 2, `dw:1` 2, `fn:registryget` 2, `dw:d_deletedue_detail` 2, `olecustomcontrol.connecttonewobject` 2, `dw:d_wholesalereturninvreport` 2, `member:number.s_name1` 2, `dw:d_populate_sales_for_proformainv_header` 2

## Against a real server and PostgreSQL 17 (CI end-to-end job, run 41716174427, commit da153f3)
- DataWindow retrieve statements that run: **8618 of 8668** (99.4%)
- embedded statements that run (null parameters, errors of integrity / data classes not counted as failures): **1847 of 1862** (99.2%)
- translated procedures that run with neutral arguments: **511 of 638** (80.1%)
- windows opened without a runtime error (retried with the usual Message.StringParm codes): **2046 of 2062** (99.2%)
- DataWindows whose computed fields and expression properties evaluate with synthetic rows (no database): **8748 of 8748** (100.0%)
- start-up with the first administrator: completed
- main menu after the rights were applied (headless run): 265 of 1476 items visible, 9 of 13 top-level menus
- real user interface in Chromium: sign-in, menu bar [File | Purchase | Sales | Reports | Basic Data | Maintenance | Manage | Window | Help], 0 toolbar buttons; a sample of 52 windows: 51 opened, 2 raised an exception, 0 browser errors

## SQL translation (PostgreSQL 17)
- statements: 128 dynamic, 4194 not-applicable, 54 untranslatable, 12273 translated
- routines: 74 function:translated, 603 proc:translated, 35 proc:partial, 1 proc:stub, 3 proc:excluded, 10 trigger:translated

## DataWindows
- definitions available: 8740

