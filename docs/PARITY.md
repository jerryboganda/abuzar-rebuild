# Parity status (generated)

Every number below is produced by a tool run; nothing is estimated.

## Scripts (PowerScript)
- classes built: 2831; routines that fail to parse: 0

## Windows (headless run, mock database)
- windows opened without a runtime error: **2046 of 2062** (99.2%)
- most common failures:
  - 7 x Null object reference (reading count)
  - 5 x Null object reference (reading datawindow)
  - 1 x Null object reference (reading column)
  - 1 x Null object reference (reading printer)
  - 1 x Null object reference (reading bsa)
  - 1 x Null object reference (reading icode)
- unimplemented functions / members met at run time (calls):
  `var:w_main` 173, `method:number.sharedata` 125, `method:number.rowcount` 111, `member:number.object` 96, `method:number.getitemnumber` 57, `method:number.getitemstring` 49, `member:number.datawindow` 32, `dwname:name` 24, `method:number.rowscopy` 20, `method:object.settransobject` 16, `ole:__invoke_method` 16, `member:number.name` 16, `var:u_utilityservices` 12, `method:object.typeof` 12, `method:object.sharedata` 11, `fn:ue_postopen` 11, `graph.findseries` 6, `assign:m_multi_entry` 6, `assign:m_entry` 6, `assign:m_mainmenu` 6, `assign:m_single_entry` 6, `method:number.getrow` 6, `radiobutton.clicked!` 5, `member:number.i_status` 5, `method:number.getitemdatetime` 5

## Against a real server and PostgreSQL 17 (CI end-to-end job, run 41707322748, commit 7533f71)
- DataWindow retrieve statements that run: **8618 of 8668** (99.4%)
- embedded statements that run (null parameters, errors of integrity / data classes not counted as failures): **1847 of 1862** (99.2%)
- translated procedures that run with neutral arguments: **511 of 638** (80.1%)
- windows opened without a runtime error (retried with the usual Message.StringParm codes): **2046 of 2062** (99.2%)
- DataWindows whose computed fields and expression properties evaluate with synthetic rows (no database): **8748 of 8748** (100.0%)
- start-up with the first administrator: completed
- main menu after the rights were applied (headless run): 265 of 1476 items visible, 9 of 13 top-level menus
- real user interface in Chromium: sign-in, menu bar [File | Purchase | Sales | Reports | Basic Data | Maintenance | Manage | Window | Help], 0 toolbar buttons; menu walk: 75 of 110 items opened in 441 s, 28 did not click; the window sample did not finish: the 20-minute watchdog fired at w_selectformat_topncustomers;

## SQL translation (PostgreSQL 17)
- statements: 128 dynamic, 4194 not-applicable, 54 untranslatable, 12273 translated
- routines: 74 function:translated, 603 proc:translated, 35 proc:partial, 1 proc:stub, 3 proc:excluded, 10 trigger:translated

## DataWindows
- definitions available: 8740

