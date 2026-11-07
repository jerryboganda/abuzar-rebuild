// Stylesheet of the desktop shell (Windows 10 look: the original runs on the native Windows controls).
export const CSS = `
/* Arial Narrow is not present on every Windows installation; the original
   reports were laid out with its metrics.  Liberation Sans Narrow is the
   metric-compatible replacement, so report columns keep the same widths. */
@font-face { font-family: 'Arial Narrow'; font-style: normal; font-weight: 400; src: url('/fonts/LiberationSansNarrow-Regular.ttf') format('truetype'); }
@font-face { font-family: 'Arial Narrow'; font-style: normal; font-weight: 700; src: url('/fonts/LiberationSansNarrow-Bold.ttf') format('truetype'); }
@font-face { font-family: 'Liberation Sans Narrow'; font-style: normal; font-weight: 400; src: url('/fonts/LiberationSansNarrow-Regular.ttf') format('truetype'); }
@font-face { font-family: 'Liberation Sans Narrow'; font-style: normal; font-weight: 700; src: url('/fonts/LiberationSansNarrow-Bold.ttf') format('truetype'); }

/* Desktop shell: the native Tauri frame is the main window's title bar. */
body.tauri-shell .pbwin[data-win="w_main"] > .tbar { display:none; }
:root { --face:#f0f0f0; --shadow:#a0a0a0; --dark:#696969; --hi:#ffffff; --sel:#0078d7; --font: 12px "Segoe UI", Tahoma, Arial, sans-serif; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; overflow:hidden; background:#ababab; font: var(--font); user-select:none; }
#desktop { position:absolute; inset:0; overflow:hidden; }
.pbwin { position:absolute; background:var(--face); border:1px solid #707070; box-shadow:0 2px 12px rgba(0,0,0,.35); display:flex; flex-direction:column; }
.pbwin.sheet { box-shadow:none; border:1px solid #888; }
.pbwin.sheet.max { left:0 !important; top:0 !important; width:100% !important; height:100% !important; border:none; }
.pbwin.sheet.max > .tbar { display:none; }
.pbwin.active .tbar { background:#f3f3f3; color:#000; }
.tbar { height:26px; flex:0 0 26px; background:#fff; color:#000; display:flex; align-items:center; padding:0 0 0 6px; cursor:default; }
.tbar .ic { width:16px; height:16px; margin-right:6px; flex:none; }
.pbwin.sheet .tbar { height:22px; flex-basis:22px; }
.tbar .ttl { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:pre; }
.tbar .cls { width:46px; height:100%; display:flex; align-items:center; justify-content:center; font-size:13px; }
.tbar .cls:hover { background:#e81123; color:#fff; }
.client { position:relative; flex:1; overflow:hidden; }
.ctl { position:absolute; }
.ctl.hidden { display:none !important; }
button.ctl { background:#fdfdfd; border:1px solid #d0d0d0; border-bottom-color:#bcbcbc; padding:0 4px; border-radius:4px; color:#000; }
button.ctl:hover:not(:disabled) { background:#f6f6f6; }
button.ctl:active:not(:disabled) { background:#ebebeb; }
button.ctl:disabled { color:#a0a0a0; background:#f5f5f5; border-color:#e0e0e0; }
button.ctl.default { border:1px solid #0078d4; background:#e0eef9; }
button.ctl.default:hover:not(:disabled) { background:#cce4f7; }
.ctl.st { overflow:hidden; white-space:pre; }
input.ctl, textarea.ctl, select.ctl { border:1px solid #7a7a7a; background:#fff; padding:0 2px; font:inherit; user-select:text; }
input.ctl:focus, textarea.ctl:focus, select.ctl:focus { outline:1px solid #0078d7; outline-offset:-2px; }
.pb-dropdown {display:flex;min-width:0;color:#000;}
.pb-dropdown [hidden] {display:none!important;}
.pb-dropdown>.dropdown-input,.pb-dropdown>.dropdown-select {flex:1;width:0;min-width:0;height:100%;font:inherit;color:inherit;background:#fff;border:1px solid #7a7a7a;padding:0 2px;user-select:text;}
.pb-dropdown>.dropdown-toggle {flex:none;width:22px;height:100%;padding:0;display:flex;align-items:center;justify-content:center;color:inherit;background:var(--face);border:1px solid #7a7a7a;border-left:0;border-radius:0;}
.pb-dropdown>.dropdown-toggle:hover:not(:disabled) {background:#e3edfc;}
.pb-dropdown :disabled {color:GrayText;}
.pb-dropdown .dropdown-list {position:fixed;inset:auto;margin:0;padding:2px;border:1px solid #7a7a7a;background:#fff;color:inherit;font:inherit;overflow:auto;overscroll-behavior:contain;box-shadow:0 3px 8px #0003;}
.pb-dropdown .dropdown-list [role=option] {padding:3px 6px;overflow-wrap:anywhere;cursor:default;min-height:1.5em;}
.pb-dropdown .dropdown-list [aria-selected=true] {background:var(--sel);color:#fff;}
.pb-dropdown .dropdown-list [role=option]:hover {outline:1px solid var(--sel);outline-offset:-1px;}
.pb-dropdown :focus-visible {outline:2px solid var(--sel);outline-offset:-2px;}
.pb-calendar {background:#fff!important;color:#000;border:1px solid #7a7a7a;padding:3px;overflow:auto;user-select:none;}
.pb-calendar[data-autosize=true] {width:19em!important;height:auto!important;}
.calendar-header {display:flex;align-items:center;gap:2px;}
.pb-calendar button {font:inherit;color:inherit;background:transparent;border:1px solid transparent;padding:2px;cursor:pointer;min-width:0;}
.calendar-header>button:first-child,.calendar-header>button:last-child {flex:none;width:1.75em;display:flex;justify-content:center;align-items:center;}
.calendar-header>button:nth-child(2) {flex:1;overflow-wrap:anywhere;font-weight:600;}
.pb-calendar button:hover:not(:disabled),.pb-calendar [role=gridcell]:hover:not([aria-disabled=true]) {background:#e3edfc;}
.pb-calendar table {width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font:inherit;}
.pb-calendar th {font-weight:400;}
.pb-calendar td,.pb-calendar th {padding:2px 0;text-align:center;line-height:1.3;}
.pb-calendar [role=gridcell] {cursor:pointer;}
.pb-calendar [aria-selected=true] {background:var(--sel);color:#fff;}
.pb-calendar .calendar-trailing {color:#666;}
.pb-calendar .calendar-trailing[aria-selected=true] {color:#fff;}
.pb-calendar .calendar-today-mark {box-shadow:inset 0 0 0 1px currentColor;}
.pb-calendar .calendar-today {width:100%;white-space:normal;overflow-wrap:anywhere;}
.pb-calendar [data-mode=months] td,.pb-calendar [data-mode=years] td {height:2.5em;}
.pb-calendar :disabled,.pb-calendar [aria-disabled=true] {color:GrayText;cursor:default;}
.pb-calendar :focus-visible {outline:2px solid var(--sel);outline-offset:-2px;}
.pb-calendar [aria-selected=true]:focus-visible {outline-color:currentColor;}
.calendar-announcement {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
@media(forced-colors:active) {.pb-calendar [aria-selected=true] {background:Highlight!important;color:HighlightText!important;forced-color-adjust:none;}.pb-calendar .calendar-today-mark {box-shadow:none;border:1px solid currentColor;}}
.dw-edit[role=combobox] {padding-inline-end:26px;}
.dw-choice-toggle {display:flex;align-items:center;justify-content:center;padding:0;color:inherit;background:var(--face);border:1px solid #7a7a7a;cursor:pointer;}
.dw-choice-toggle[hidden] {display:none;}
.dw-edit.dw-choice-automatic[role=combobox] {padding-inline-end:2px;}
.dw-choice-popup {position:fixed;inset:auto;margin:0;padding:2px;border:1px solid #7a7a7a;background:#fff;color:#000;font:inherit;overflow:auto;overscroll-behavior:contain;box-shadow:0 3px 8px #0003;text-align:start;white-space:normal;}
.dw-choice-popup [role=option] {padding:4px 8px;overflow-wrap:anywhere;cursor:default;min-height:1.5em;}
.dw-choice-popup [aria-selected=true] {background:var(--sel);color:#fff;}
.dw-choice-popup [role=option]:hover {outline:1px solid var(--sel);outline-offset:-1px;}
@media(forced-colors:active) {.dw-choice-popup [aria-selected=true] {background:Highlight;color:HighlightText;forced-color-adjust:none;}}
@media(forced-colors:active) {.pb-dropdown .dropdown-list [aria-selected=true] {background:Highlight;color:HighlightText;forced-color-adjust:none;}}
.ctl.lowered { border:1px solid; border-color:#a0a0a0 #fff #fff #a0a0a0; box-shadow: inset 1px 1px 0 #696969; }
.ctl.raised { border:1px solid; border-color:#fff #696969 #696969 #fff; }
.ctl.box { border:1px solid #000; }
fieldset.ctl { border:1px solid #a0a0a0; margin:0; padding:0; border-radius:2px; }
fieldset.ctl > legend { padding:0 3px; margin-left:6px; }
label.ctl { display:flex; align-items:center; gap:4px; white-space:nowrap; }
.tabctl { position:absolute; }
.tabctl .strip { display:flex; height:23px; }
.tabctl .t { display:flex; align-items:center; gap:3px; padding:0 6px 0 4px; border:1px solid #e5e5e5; border-bottom:none; background:#f0f0f0; margin-right:-1px; white-space:pre; }
.tabctl .t .pic { display:block; width:16px; height:16px; background:url(toolbar.png) no-repeat; flex:none; }
.tabctl .t.on { background:#f9f9f9; outline:1px dotted #000; outline-offset:-3px; }
.tabctl .page { position:absolute; left:0; right:0; bottom:0; top:23px; background:#f0f0f0; border:1px solid #e5e5e5; }
.dw { position:absolute; inset:0; overflow:auto; background:#fff; user-select:text; }
.dw-recovery {padding:12px;color:CanvasText;background:Canvas;font:var(--font);}
.dw-recovery label,.dw-recovery textarea,.dw-recovery button {display:block;max-width:100%;margin-block:8px;}
.dw-recovery textarea {width:100%;font:inherit;line-height:1.5;resize:vertical;user-select:text;}
.dw-recovery button {font:inherit;white-space:normal;}
.dw-inner { position:relative; min-width:100%; }
.dw .o { pointer-events:auto; }
.dw .o .dd-arrow { position:absolute; right:0; top:0; bottom:0; width:16px; background:#fdfdfd url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23303030' stroke-width='1.4'/%3E%3C/svg%3E") center/9px 6px no-repeat; border-left:1px solid #adadad; pointer-events:none; }
.dw .o .dd-spin { position:absolute; right:0; top:0; bottom:0; width:14px; background:#fdfdfd url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 10'%3E%3Cpath d='M1 4l3-3 3 3M1 6l3 3 3-3' fill='none' stroke='%23303030' stroke-width='1.2'/%3E%3C/svg%3E") center/8px 10px no-repeat; border-left:1px solid #adadad; pointer-events:none; }
.lv { display:flex; flex-wrap:wrap; align-content:flex-start; gap:6px; padding:4px; overflow:auto; background:#fff; border:1px solid #828790; box-sizing:border-box; }
.lvi { width:84px; display:flex; flex-direction:column; align-items:center; text-align:center; padding:4px 2px; font-size:12px; cursor:default; }
.lvi.on { background:#0078d7; color:#fff; }
.lvp { background:center/contain no-repeat; margin-bottom:2px; }
.dw .o.editable { cursor:text; }
.dw .dw-radio-options {display:grid;grid-template-columns:repeat(var(--dw-radio-columns,1),minmax(0,1fr));min-width:0;gap:2px;margin:0;padding:0;border:0;font:inherit;color:inherit;text-align:left;white-space:normal;}
.dw .dw-radio-option {display:flex;align-items:center;gap:4px;min-width:0;cursor:pointer;}
.dw .dw-radio-option > span:last-child {overflow-wrap:anywhere;}
.dw .dw-radio-option input {flex:none;margin:0;}
.dw .dw-radio-marker {position:relative;flex:none;width:13px;height:13px;border:1px solid currentColor;border-radius:50%;box-sizing:border-box;}
.dw .dw-radio-marker.on::after {content:"";position:absolute;inset:25%;border:.15em solid currentColor;border-radius:50%;}
.dw fieldset.dw-radio-options input:focus-visible {outline:2px solid Highlight;outline-offset:2px;}
.dw .row.sel { background:#0078d7; }
.dw .row.sel .o { color:#fff !important; }
.dw .o.placeholder { border:1px dashed #bbb; }
.dw .o .cbx { flex:none; width:13px; height:13px; border:1px solid #8a8a8a; border-radius:3px; background:#fff; box-sizing:border-box; }
.dw .o.dw-checkbox-left .cbx { margin-inline-start:auto; }
.dw .o .cbx.on { background:#0067c0 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.4 2.4 4.6-5' fill='none' stroke='%23fff' stroke-width='1.6'/%3E%3C/svg%3E") center/11px no-repeat; border-color:#0067c0; }
.dw .o.btn { background:#e1e1e1; border:1px solid #adadad; text-align:center; }
.menubar { display:flex; background:#fff; height:20px; flex:0 0 20px; border-bottom:1px solid #f2f2f2; box-shadow:0 1px 0 #f0f0f0; padding:0 0 0 0; }
.menubar .mi { padding:0 8px; line-height:18px; position:relative; white-space:nowrap; }
.menubar .mi:hover, .menubar .mi.open { background:#e5e5e5; }
.menu-drop { position:absolute; left:0; top:19px; min-width:120px; background:#f9f9f9; border:1px solid #d6d6d6; border-radius:8px; box-shadow:0 6px 14px rgba(0,0,0,.18); z-index:1000; padding:4px; }
.menu-drop .it { height:22px; line-height:22px; padding:0 10px 0 0; margin:0 2px; display:flex; align-items:center; white-space:nowrap; position:relative; border-radius:4px; }
.menu-drop .it .ck { flex:0 0 32px; text-align:center; font-size:11px; }
.menu-drop .it .lb { flex:1; padding-right:28px; }
.menu-drop .it .hk { padding-left:24px; color:#000; }
.menu-drop .it .ar { width:14px; text-align:right; }
.menu-drop .it .ar::after { content:''; display:inline-block; width:5px; height:5px; border-top:1px solid #000; border-right:1px solid #000; transform:rotate(45deg); margin-right:3px; }
.menu-drop .it:hover { background:#ebebeb; }
.menu-drop .it.dis { color:#8a8a8a; }
.menu-drop .it.dis .hk { color:#8a8a8a; }
.menu-drop .sep { height:1px; background:#d0d0d0; margin:3px 2px 3px 32px; }
.menu-drop .it .sub { position:absolute; left:100%; top:-4px; display:none; margin-left:-2px; }
.menu-drop .it:hover > .sub { display:block; }
.toolbar { display:flex; background:#f0f0f0; height:28px; flex:0 0 28px; align-items:center; padding:0 0 0 3px; border-top:1px solid #a0a0a0; border-bottom:1px solid #a0a0a0; box-shadow:inset 0 1px 0 #fff, 0 1px 0 #696969; margin-bottom:1px; }
.toolbar::before { content:''; flex:0 0 5px; height:22px; margin-right:3px; border-left:1px solid #fff; border-right:1px solid #a0a0a0; box-shadow:2px 0 0 #fff, 3px 0 0 #a0a0a0; }
.toolbar .tb { width:23px; height:24px; padding:0; margin:0; background:transparent; border:1px solid transparent; display:flex; align-items:center; justify-content:center; }
.toolbar .tb .pic { display:block; width:16px; height:16px; background:url(toolbar.png) no-repeat; image-rendering:pixelated; }
.toolbar .tb .pic.gl { background:none; font:13px Segoe UI Symbol,Segoe UI Emoji,Segoe UI,sans-serif; line-height:16px; text-align:center; }
.toolbar .tb:hover:not(:disabled) { border-color:#fff #a0a0a0 #a0a0a0 #fff; }
.toolbar .tb:active:not(:disabled) { border-color:#a0a0a0 #fff #fff #a0a0a0; }
.toolbar .tb.dis .pic { filter:grayscale(1) opacity(.55); }
.toolbar .tb-gap { flex:0 0 2px; height:22px; margin:0 1px; border-left:1px solid #a0a0a0; border-right:1px solid #fff; }
.status { height:17px; flex:0 0 17px; background:#f0f0f0; border:1px solid; border-color:#a0a0a0 #fff #fff #a0a0a0; margin:1px 0 0 0; padding:0 3px; line-height:15px; }
.modal-bg { position:absolute; inset:0; background:transparent; z-index:900; }
.msgbox { position:absolute; background:#fff; border:1px solid #c8c8c8; border-radius:8px; overflow:hidden; box-shadow:0 8px 24px rgba(0,0,0,.28); min-width:284px; max-width:520px; z-index:2000; }
.msgbox .body { padding:22px 20px 20px; display:flex; align-items:center; gap:14px; white-space:pre-wrap; user-select:text; }
.msgbox .tbar { height:25px; flex-basis:25px; font-size:12px; color:#444; }
.msgbox .btns { background:#f0f0f0; padding:10px 12px; display:flex; justify-content:flex-end; gap:8px; }
.msgbox button { min-width:72px; height:20px; background:#fdfdfd; border:1px solid #d0d0d0; border-bottom-color:#bcbcbc; border-radius:4px; font:inherit; }
.msgbox button:focus { border-color:#0078d4; outline:1px solid #0078d4; outline-offset:0; }
.mdi-client { position:relative; flex:1; background:#ababab; overflow:hidden; }
`
