# Fidelity against the running original

Everything here was measured on the original `abuzar.exe` (Windows 11, 96 dpi, 1920x1080) running against its SQL Server, not derived from the recovered definitions.
Tools: `tools/orig/` (crawler, crop, icon and sprite builders), `web/tools/{gen-profile,menu-parity,toolbar-dump}.ts`, `web/e2e/browser-smoke.mjs` (menu walk of the rebuild).

## Method
1. `tools/orig/crawl.ps1 dump` reads the live menu tree of the original through the Win32 menu API (UI Automation does not see PowerBuilder menus): 265 entries, with command ids,
   accelerators (`&`), shortcut text, separators and disabled state -> `docs/observed/original-menu-frame.tsv`.
2. `crawl.ps1 open` posts `WM_COMMAND` with each id, waits until the screen stops changing, saves a 1920x1080 screenshot per window (`<id>_<menu path>.png`), the dialogs it raised
   and the menu bar the sheet brings, then closes everything (answers "save changes?" with No).  It only opens windows; it skips Exit, Change User, backup / integrity, import,
   initialisation and batch lock.  The original ends with "Application terminated" on some windows (R0002 runtime errors in its own scripts); the crawler stops there.
3. The rebuild walks the same menu paths in Chromium (CI) and saves screenshots with the same ids (`ci-screens` release), so every original window has a counterpart to compare.

## Measured facts
| What | Value |
| --- | --- |
| Visible menu of the compared deployment (ADMIN) | 265 entries / 9 top menus, a subset of the 1,476 items of `m_entry`; reproduced exactly by `db/pg/96_rights_profile.sql` (CI check `menu-parity.ts`) |
| PowerBuilder unit | 7/32 px horizontally, 16/64 px vertically (dialog base unit 7 x 16): Login window 1582 PBU = 346 px, Ok button at 306 PBU = 68 px |
| Title bar | 25 px (+ 1 px border), `#f3f3f3` active, application icon 16 px from `abuzar.exe` (`public/app-icon.png`) |
| Menu bar | 18 px high, white, Segoe UI 9 pt, 8 px padding per item; two hairlines below, then the toolbar |
| Toolbar | etched `#a0a0a0` / `#fff` above, `#a0a0a0` / `#696969` below, 24 px band, 16 px pictures, 23 px pitch, 2 px etched separators, gripper at the left; none while no sheet is open |
| Toolbar order | by `toolbaritemorder`, not by tree order (the sheet menus list New Item / Delete Item after Save in tree position but order 4-5) |
| Pictures | `PBVM125.dll` holds the bitmaps (16x16, 8 bit) and a name table (UTF-16 name pointer + resource id, 523 pairs) -> `docs/observed/pb-stock-pictures.json`; the toolbar's `Find!` shows `Search!` (1048) |
| Status bar | 15 px sunken panel, "Ready", the menu item's microhelp while a menu item is highlighted |
| MDI client | `#ababab`, 2 px sunken edge |
| Tab control | flat themed tabs, 16 px picture (`Table!` 1082, `EditDataGrid!` 1682), text keeps its trailing blanks (tab 184 px wide), selected tab `#f9f9f9` with dotted focus rectangle, page `#f0f0f0` with 1 px `#e5e5e5` border |
| Buttons | Windows 11: `#fdfdfd`, 1 px `#d0d0d0`, radius 4; default button `#e0eef9` with `#0078d4` |
| Edit boxes (border style 5) | themed, 1 px `#abadb3`, white |
| Message box | 284 px, white body with 32 px blue circle `?`, `#f0f0f0` button strip, 72 x 20 buttons |
| Scroll bars of a DataWindow control | only when the control has `HScrollBar` / `VScrollBar` (d_login's dw_remote has none: invisible in the original) |
| String display format `'*****';'*****'` | sections text; zero-length; null, quoted literals - the password column shows `*****` whatever it holds |

## Behaviours found by running both side by side
* A tab control raises SelectionChanging / SelectionChanged for its first page when the window comes up: the entry windows (Users, Item, Sale Template) build their blank new form there.
* `getenvironment` reports the real screen: windows size their tab and DataWindows as 99 % / 98 % of it (`pixelstounits(screenwidth)`), the control tree of the original confirms it (tab 1901 x 897 px on 1920 x 1080).
* Posted events (`post event`, `postevent`) run one after the other, each to its end; while a modal window or a message box waits for its answer the queue goes on.
* `DataWindow.GetChild` leaves the variable usable even when the column has no dropdown (reports call `SetTransObject` on it without testing the return code).
* A control inside the rectangle of a hidden group box that carries no `visible` attribute is hidden in the original (the invoice / price fields of the argument windows); `dw_itemslist` of the entry windows is hidden until a script shows it.
* Group boxes are only a frame and a caption: transparent, never in front of the controls inside them. Border defaults to on for edit-like controls, off for labels and check boxes.
* A DataWindow control scrolls only where it has `HScrollBar` / `VScrollBar`; a form taller than the control shows from its top.
* String display formats `'*****';'*****'` show for empty columns, too (password columns).
* `Backup Database` is a `pg_dump`; SQL Agent job lookups (`SysJobs`) read `dbo.sysjobs`.
* A DataWindow control whose design-time `dataobject` is set takes a new one when a script assigns it (`wf_assigndatawindowobjects` of the purchase / sale return windows): the definition is reloaded; the first rebuild kept the design-time one and `GetChild` then failed.
* A `DataWindowChild` variable is usable before `GetChild` filled it (calls answer -1, no null-object error): `w_purchase` (Opening Purchase) filters one it never assigned and the original opens the window.
* `DataWindow.Show()` / `Hide()` and `x`, `y`, `width`, `height`, `visible` set from scripts reach the screen: the report window shows its preview after the retrieve.
* The height of a drop-down list box in the definition includes its list; the closed control is one line (21 px).
* Windows open in steps (posted events): a screenshot taken 2.5 s after `OpenSheetWithParm` can still show the window's design-time title (Opening Purchase showed `Pack Purchase`).
* `InsertRow` gives the new row's current cell the item focus (`ItemFocusChanged`): `dw_itemsdetail.itemfocuschanged` of the entry windows sets `editflag`, which `wf_validatedate` returns (`if not wf_validatedate() then close(this)` in the open event of purchase, sale return, quotation, adjustment, sale template ...). Without it those windows closed themselves; the original shows them open and asks `Do You want to save changes` when an untouched one is closed.
* A column whose initial value is `today` takes the current date / time when a row is inserted (the sale template's date shows `02/11/2026 11:46`).
* `object.<col>.visible = false` (a boolean) hides the column: it used to arrive as `no`, which the view did not read as 0, so every preference-driven hiding (header, item code, alias, godown column ...) was ignored. `visible` / `protect` are stored as `1` / `0`.
* A grid DataWindow (processing 1) leaves a hidden column out together with its header and total, and the columns on its right move left (Adjustment Increase shows No / Item Name / Batch / Expiry / Qty / Price / Total).
* First-run preferences: `GroupCustomerCategory` is off (the migration of the original updates `preferences.groupcustomercategory = 'N'`), otherwise Cash / Credit Sale refuse to open for a group without customer categories.
## Not yet matched
* The window height of response windows: measured factor 0.924 of the height in units (Login 234 px, Select Format 306 px), the reason is unknown.
* Dropdown menu pixel metrics (width, padding) were approximated from screenshots; the crawler does not open dropdowns.
* One menu caption: the original shows "Sale And Return " where `m_entry` has "Sale And Return (One Category)" (changed by a script path not yet found).
* Data-dependent screens need real data in the rebuild's database.
