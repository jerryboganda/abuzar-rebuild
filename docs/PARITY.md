# Parity status (generated)

Every number below is produced by a tool run; nothing is estimated.

## Scripts (PowerScript)
- classes built: 2831; routines that fail to parse: 0

## Windows (headless run, mock database)
- windows opened without a runtime error: **1850 of 2062** (89.7%)
- most common failures:
  - 74 x Null object reference (calling rowcount)
  - 15 x Null object reference (calling sharedata)
  - 11 x Null object reference (reading l_codeN)
  - 8 x Null object reference (array access)
  - 7 x Null object reference (reading dw_header)
  - 6 x Null object reference (array assignment)
  - 6 x Null object reference (calling typeof)
  - 6 x Null object reference (reading ar_icode)
- unimplemented functions / members met at run time (calls):
  `datawindow.settaborder` 325, `window.ue_postopen` 185, `sql:select:SELECT MIN ( GroupCode ) INTO :ll_groupcode FROM UserGroups ` 106, `sql:select:SELECT styledesc , stylename INTO :ls_editstyle, :ls_stylena` 54, `datastore.constructor` 42, `sql:select:SELECT Isnull ( COUNT ( gcode ) , 0 ) INTO :ll_godowncount F` 39, `sql:select:SELECT SaleGodownStrategy INTO :ll_strategy FROM groups WHER` 21, `fn:fileexists` 18, `graph.findseries` 18, `transaction.getglobalcode` 15, `sql:select:Select textcatalog , Convert ( DateTime , cataloglength ) , ` 14, `datawindow.selecttext` 13, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:ls` 13, `fn:rgb` 12, `dwname:accountname` 12, `sql:select:Select enabled INTO :li_enabled From SysJobs Where Name =:gs` 10, `fn:ue_postopen` 7, `transaction.dbms_version` 7, `fn:filedelete` 7, `transaction.virtualgl` 6, `sql:select:SELECT PurchaseGodownStrategy INTO :ll_strategy FROM groups ` 6, `method:object.sharedata` 6, `dwname:name` 6, `sql:select:Select Convert ( int , Convert ( DateTime , GetDate ( ) ) ) ` 4, `radiobutton.clicked!` 4

## SQL translation (PostgreSQL 17)
- statements: 127 dynamic, 4035 not-applicable, 56 untranslatable, 12047 translated
- routines: 74 function:translated, 603 proc:translated, 35 proc:partial, 1 proc:stub, 3 proc:excluded, 10 trigger:translated

## DataWindows
- definitions available: 8740

