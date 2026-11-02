# Parity status (generated)

Every number below is produced by a tool run; nothing is estimated.

## Scripts (PowerScript)
- classes built: 2831; routines that fail to parse: 0

## Windows (headless run, mock database)
- windows opened without a runtime error: **1953 of 2062** (94.7%)
- most common failures:
  - 71 x Null object reference (calling rowcount)
  - 11 x Null object reference (array assignment)
  - 5 x Null object reference (reading datawindow)
  - 4 x Null object reference (reading count)
  - 3 x Null object reference (calling settransobject)
  - 2 x Null object reference (calling reset)
  - 2 x Null object reference (calling __invoke_method)
  - 1 x Null object reference (calling getchild)
- unimplemented functions / members met at run time (calls):
  `method:number.getitemnumber` 42, `method:number.sharedata` 39, `method:number.getitemstring` 34, `method:number.rowcount` 21, `datawindow.selecttext` 18, `fn:fileexists` 18, `graph.findseries` 18, `dwname:name` 18, `transaction.getglobalcode` 17, `fn:rgb` 14, `fn:filedelete` 13, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:ls` 13, `dwname:accountname` 12, `method:object.typeof` 12, `fn:ue_postopen` 11, `method:object.sharedata` 11, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:gs` 10, `datawindow.findrequired` 10, `fn:fileopen` 9, `fn:filewriteex` 9, `fn:fileclose` 9, `transaction.dbms_version` 7, `transaction.virtualgl` 7, `method:number.getrow` 6, `member:number.object` 6

## SQL translation (PostgreSQL 17)
- statements: 127 dynamic, 4035 not-applicable, 56 untranslatable, 12047 translated
- routines: 74 function:translated, 603 proc:translated, 35 proc:partial, 1 proc:stub, 3 proc:excluded, 10 trigger:translated

## DataWindows
- definitions available: 8740

