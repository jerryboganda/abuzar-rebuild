# Parity status (generated)

Every number below is produced by a tool run; nothing is estimated.

## Scripts (PowerScript)
- classes built: 2831; routines that fail to parse: 0

## Windows (headless run, mock database)
- windows opened without a runtime error: **2030 of 2062** (98.4%)
- most common failures:
  - 10 x Null object reference (calling rowcount)
  - 5 x Null object reference (reading datawindow)
  - 4 x Null object reference (reading count)
  - 3 x Null object reference (calling settransobject)
  - 2 x Null object reference (calling reset)
  - 1 x Null object reference (calling getchild)
  - 1 x Null object reference (calling retrieve)
  - 1 x Null object reference (reading column)
- unimplemented functions / members met at run time (calls):
  `dwname:accountname` 312, `method:number.sharedata` 114, `method:number.rowcount` 111, `member:number.object` 96, `method:number.getitemnumber` 57, `method:number.getitemstring` 49, `member:number.datawindow` 32, `dwname:name` 24, `method:number.rowscopy` 20, `graph.findseries` 18, `method:object.settransobject` 16, `ole:__invoke_method` 16, `member:number.name` 16, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:ls` 13, `method:object.typeof` 12, `fn:ue_postopen` 11, `method:object.sharedata` 11, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:gs` 10, `method:number.getrow` 6, `radiobutton.clicked!` 5, `method:number.getitemdatetime` 5, `datawindow.create` 4, `member:number.i_status` 4, `picture.clicked!` 3, `oleobject.__invoke_method` 3

## Against a real server and PostgreSQL 17 (CI end-to-end job, run 41389483241, commit ca6e858)
- DataWindow retrieve statements that run: **8607 of 8666** (99.3%)
- embedded statements that run (null parameters, errors of integrity / data classes not counted as failures): **1846 of 1862** (99.1%)
- translated procedures that run with neutral arguments: **510 of 638** (79.9%)
- windows opened without a runtime error (retried with the usual Message.StringParm codes): **2031 of 2062** (98.5%)
- start-up with the first administrator: completed

## SQL translation (PostgreSQL 17)
- statements: 128 dynamic, 4194 not-applicable, 56 untranslatable, 12271 translated
- routines: 74 function:translated, 603 proc:translated, 35 proc:partial, 1 proc:stub, 3 proc:excluded, 10 trigger:translated

## DataWindows
- definitions available: 8740

