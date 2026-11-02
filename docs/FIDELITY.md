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

## Not yet matched
* The window height of response windows: the original's client area of the Login window is 234 px, the definition says 1016 PBU = 254 px.
* Dropdown menu pixel metrics (width, padding) were approximated from screenshots; the crawler does not open dropdowns.
* One menu caption: the original shows "Sale And Return " where `m_entry` has "Sale And Return (One Category)" (changed by a script path not yet found).
* Data-dependent screens need real data in the rebuild's database.
