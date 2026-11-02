// Stylesheet of the desktop shell (Windows 10 look: the original runs on the native Windows controls).
export const CSS = `
:root { --face:#f0f0f0; --shadow:#a0a0a0; --dark:#696969; --hi:#ffffff; --sel:#0078d7; --font: 12px "Segoe UI", Tahoma, Arial, sans-serif; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; overflow:hidden; background:#ababab; font: var(--font); user-select:none; }
#desktop { position:absolute; inset:0; overflow:hidden; }
.pbwin { position:absolute; background:var(--face); border:1px solid #707070; box-shadow:0 2px 12px rgba(0,0,0,.35); display:flex; flex-direction:column; }
.pbwin.sheet { box-shadow:none; border:1px solid #888; }
.pbwin.sheet.max { left:0 !important; top:0 !important; width:100% !important; height:100% !important; border:none; }
.pbwin.sheet.max > .tbar { display:none; }
.pbwin.active .tbar { background:#0078d7; color:#fff; }
.tbar { height:30px; flex:0 0 30px; background:#fff; color:#000; display:flex; align-items:center; padding:0 0 0 8px; cursor:default; }
.pbwin.sheet .tbar { height:22px; flex-basis:22px; }
.tbar .ttl { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tbar .cls { width:46px; height:100%; display:flex; align-items:center; justify-content:center; }
.tbar .cls:hover { background:#e81123; color:#fff; }
.client { position:relative; flex:1; overflow:hidden; }
.ctl { position:absolute; }
.ctl.hidden { display:none !important; }
button.ctl { background:#e1e1e1; border:1px solid #adadad; padding:0 4px; border-radius:0; color:#000; }
button.ctl:hover:not(:disabled) { background:#e5f1fb; border-color:#0078d7; }
button.ctl:disabled { color:#838383; background:#cccccc; border-color:#bfbfbf; }
button.ctl.default { border:2px solid #0078d7; }
.ctl.st { overflow:hidden; white-space:pre; }
input.ctl, textarea.ctl, select.ctl { border:1px solid #7a7a7a; background:#fff; padding:0 2px; font:inherit; user-select:text; }
.ctl.lowered { border:1px solid; border-color:#a0a0a0 #fff #fff #a0a0a0; box-shadow: inset 1px 1px 0 #696969; }
.ctl.raised { border:1px solid; border-color:#fff #696969 #696969 #fff; }
.ctl.box { border:1px solid #000; }
fieldset.ctl { border:1px solid #a0a0a0; margin:0; padding:0; border-radius:2px; }
fieldset.ctl > legend { padding:0 3px; margin-left:6px; }
label.ctl { display:flex; align-items:center; gap:4px; white-space:nowrap; }
.tabctl { position:absolute; }
.tabctl .strip { display:flex; height:24px; border-bottom:1px solid #d9d9d9; }
.tabctl .t { padding:2px 8px; border:1px solid #d9d9d9; border-bottom:none; background:#f0f0f0; margin-right:-1px; }
.tabctl .t.on { background:#fff; font-weight:600; }
.tabctl .page { position:absolute; left:0; right:0; bottom:0; top:24px; background:#fff; border:1px solid #d9d9d9; border-top:none; }
.dw { position:absolute; inset:0; overflow:auto; background:#fff; user-select:text; }
.dw-inner { position:relative; min-width:100%; }
.dw .o { pointer-events:auto; }
.dw .o.editable { cursor:text; }
.dw .row.cur { outline:1px dotted #000; outline-offset:-1px; }
.dw .row.sel { background:#0078d7; }
.dw .row.sel .o { color:#fff !important; }
.dw .o.placeholder { border:1px dashed #bbb; }
.dw .o.btn { background:#e1e1e1; border:1px solid #adadad; text-align:center; }
.menubar { display:flex; background:#fff; height:22px; flex:0 0 22px; border-bottom:1px solid #e5e5e5; }
.menubar .mi { padding:0 8px; line-height:22px; position:relative; white-space:nowrap; }
.menubar .mi:hover, .menubar .mi.open { background:#cce8ff; }
.menu-drop { position:absolute; left:0; top:22px; min-width:190px; background:#f2f2f2; border:1px solid #ccc; box-shadow:2px 2px 4px rgba(0,0,0,.3); z-index:1000; padding:2px 0; }
.menu-drop .it { padding:3px 24px 3px 24px; display:flex; justify-content:space-between; gap:24px; white-space:nowrap; position:relative; }
.menu-drop .it:hover { background:#91c9f7; }
.menu-drop .it.dis { color:#8a8a8a; }
.menu-drop .sep { height:1px; background:#d7d7d7; margin:3px 2px; }
.menu-drop .it .sub { position:absolute; left:100%; top:-3px; display:none; }
.menu-drop .it:hover > .sub { display:block; }
.toolbar .tb { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:44px; height:42px; padding:1px 4px; background:transparent; border:1px solid transparent; font:9px Segoe UI,Tahoma,Arial,sans-serif; color:#000; }
.toolbar .tb .g { font:16px Segoe UI Symbol,Segoe UI Emoji,Segoe UI,sans-serif; line-height:20px; }
.toolbar .tb:hover:not(:disabled) { background:#e5f1fb; border-color:#99c9ef; }
.toolbar .tb.dis { opacity:.4; }
.toolbar .tb-gap { width:10px; flex:0 0 10px; }
.toolbar { display:flex; background:#f0f0f0; min-height:34px; flex:0 0 auto; align-items:center; padding:0 4px; gap:2px; border-bottom:1px solid #d0d0d0; }
.status { height:22px; flex:0 0 22px; background:#f0f0f0; border-top:1px solid #d0d0d0; padding:0 6px; line-height:22px; }
.modal-bg { position:absolute; inset:0; background:rgba(0,0,0,.12); z-index:900; }
.msgbox { position:absolute; background:#fff; border:1px solid #707070; box-shadow:0 4px 18px rgba(0,0,0,.4); min-width:300px; max-width:520px; z-index:2000; }
.msgbox .body { padding:18px 18px 14px; display:flex; gap:14px; white-space:pre-wrap; user-select:text; }
.msgbox .btns { background:#f0f0f0; padding:10px; display:flex; justify-content:flex-end; gap:8px; }
.msgbox button { min-width:76px; height:24px; background:#e1e1e1; border:1px solid #adadad; }
.msgbox button:focus { outline:2px solid #0078d7; outline-offset:1px; }
.mdi-client { position:relative; flex:1; background:#ababab; overflow:hidden; }
`
