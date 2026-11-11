// Approved Waseela Trader design system (user sign-off 2026-11-12, mockup "Waseela Trader Suite" v4).
// Applied on top of PRESENTATION_CSS in the Modern interface only; Classic keeps the original look.  Tokens, type, components and
// motion follow the mockup exactly; every rule restyles existing elements and never removes a control, field or command.
export const DESIGN_CSS = `
/* ---------- tokens (mockup :root values) ---------- */
.presentation-ui,.presentation-settings,.modern-surface,.modern-window,.modern-entry-window,.mh-palette,.mh-popover,.ds-boot {
  --p-surface:#ffffff;--p-canvas:#f3f5f7;--p-rail:#eef1f4;--p-sunk:#eef1f4;--p-text:#18212b;--p-muted:#56636f;--p-faint:#636f7a;
  --p-line:#b9c2cc;--p-hair:#dde2e8;--p-accent:#0f6b6f;--p-accent-2:#12797d;--p-on-accent:#ffffff;--p-selected:#e1f0ef;
  --p-glow:rgb(15 107 111 / .28);--p-danger:#b3261e;--p-danger-soft:#fbe6e4;--p-ok:#1f7a45;--p-ok-soft:#e3f3e9;
  --p-warn:#a15c00;--p-warn-soft:#fdf0db;--p-info:#2457a6;--p-info-soft:#e4ecf8;
  --p-chrome:#13232a;--p-chrome-text:#e7f0f1;--p-chrome-muted:#9fb3b8;--p-chrome-line:#2a3f46;--p-chrome-hover:#1d3138;
  --p-scrim:rgb(10 18 22 / .5);--p-shadow:0 1px 2px rgb(16 24 32 / .06),0 8px 24px rgb(16 24 32 / .08);--p-shadow-lg:0 24px 64px rgb(16 24 32 / .22);
  --p-font:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--p-mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
  --p-ease:cubic-bezier(.2,.8,.2,1);--p-spring:cubic-bezier(.34,1.56,.64,1);
  font-family:var(--p-font);
}
:is(.presentation-ui,.presentation-settings,.modern-surface,.modern-window,.modern-entry-window,.mh-palette,.mh-popover,.ds-boot)[data-theme=dark] {
  --p-surface:#161d23;--p-canvas:#0f1418;--p-rail:#1c252c;--p-sunk:#1c252c;--p-text:#e6ecf1;--p-muted:#a3b0bc;--p-faint:#8c99a5;
  --p-line:#3c4a56;--p-hair:#27323b;--p-accent:#4fb8b2;--p-accent-2:#6fd0c9;--p-on-accent:#06201f;--p-selected:#163331;
  --p-glow:rgb(79 184 178 / .3);--p-danger:#f08077;--p-danger-soft:#3a1916;--p-ok:#5fc68a;--p-ok-soft:#14301f;
  --p-warn:#e6a64a;--p-warn-soft:#33260f;--p-info:#86aef0;--p-info-soft:#17233a;
  --p-chrome:#0a1013;--p-chrome-text:#e6ecf1;--p-chrome-muted:#8296a0;--p-chrome-line:#1f2d33;--p-chrome-hover:#152027;
  --p-scrim:rgb(0 0 0 / .62);--p-shadow:0 1px 2px rgb(0 0 0 / .4),0 8px 24px rgb(0 0 0 / .35);--p-shadow-lg:0 24px 64px rgb(0 0 0 / .6);
}
.presentation-ui {font:calc(14px * var(--p-scale)) / 1.5 var(--p-font);-webkit-font-smoothing:antialiased;background:var(--p-canvas);}
.presentation-ui .presentation-stage,.presentation-ui .presentation-work,.presentation-ui .mdi-client {background:var(--p-canvas)!important;}
.presentation-ui .presentation-stage {color:var(--p-text);font:inherit;}

.presentation-ui :focus-visible,.mh-palette :focus-visible,.mh-popover :focus-visible,.presentation-settings :focus-visible {outline:2.5px solid var(--p-accent);outline-offset:2px;}
.mh-context :focus-visible {outline-color:var(--p-chrome-text);}
/* ---------- motion ---------- */
@keyframes ds-up {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ds-pop {from{opacity:0;transform:scale(.96) translateY(-6px)}to{opacity:1;transform:none}}
@keyframes ds-drop {from{opacity:0;transform:translateY(-6px) scale(.98)}to{opacity:1;transform:none}}
@keyframes ds-fade {from{opacity:0}to{opacity:1}}
@keyframes ds-pulse {0%,100%{box-shadow:0 0 0 0 rgb(78 201 138 / .55)}70%{box-shadow:0 0 0 7px rgb(78 201 138 / 0)}}
@keyframes ds-sheen {from{transform:translateX(-120%) skewX(-20deg)}to{transform:translateX(320%) skewX(-20deg)}}
@keyframes ds-grow-x {from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes ds-draw {to{stroke-dashoffset:0}}
.presentation-ui .pbwin.sheet.ds-enter {animation:ds-up .4s var(--p-ease);}
.presentation-ui .menu-drop {animation:ds-drop .18s var(--p-ease);}
.mh-popover {animation:ds-drop .18s var(--p-ease);}
.mh-palette[open] {animation:ds-pop .22s var(--p-spring);}
.presentation-compatibility-dialog[open] .pbwin,.presentation-settings[open],.presentation-dialog[open] {animation:ds-pop .24s var(--p-spring);}
.presentation-ui .mh-context .mh-dot {animation:ds-pulse 2s infinite;}
@media (prefers-reduced-motion:reduce){
  .presentation-ui *,.presentation-ui *::before,.presentation-ui *::after,.mh-palette,.mh-popover,.presentation-settings,.presentation-compatibility-dialog *,.ds-boot *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}

/* ---------- context bar: ambient glow and brand (mockup .ctx) ---------- */
.presentation-header.mh-context {position:relative;overflow:hidden;padding:8px 16px;}
.presentation-header.mh-context::before {content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(600px 120px at 15% -40%,rgb(79 184 178 / .25),transparent 70%),radial-gradient(500px 120px at 85% 140%,rgb(43 95 143 / .22),transparent 70%);}
.presentation-header.mh-context > * {position:relative;}
.mh-context .mh-mark {width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;font-size:14px;box-shadow:0 6px 20px rgb(15 107 111 / .45);}
.mh-context .mh-brand b {letter-spacing:.03em;line-height:1.2;}
.mh-context .mh-sub {font-size:11px;}
.mh-context .mh-search {flex:0 1 360px;min-width:200px;width:auto;padding:7px 10px;border-radius:9px;background:rgb(255 255 255 / .05);transition:border-color .2s,background .2s,box-shadow .25s;}
.mh-context .mh-search:hover {background:rgb(255 255 255 / .08);box-shadow:0 0 0 4px rgb(79 184 178 / .12);}
.mh-context .mh-chip {padding:5px 10px;transition:background .2s,color .2s;}
.mh-context .mh-theme button {width:30px;height:28px;transition:background .25s,color .25s,transform .2s;}
.mh-context .mh-theme button:hover {transform:rotate(-12deg);}
.mh-context .mh-icon {width:34px;height:32px;border-radius:9px;position:relative;}
.mh-context .mh-badge {position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#c9302c;color:#fff;font:700 10px/17px var(--p-font);text-align:center;border:2px solid var(--p-chrome);}
.mh-context .mh-avatar {width:28px;height:28px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;font-size:11px;}
.mh-context .mh-crumbs {display:flex;align-items:center;gap:4px;font-size:13px;}
.mh-context .mh-crumbs::before {content:none;}
.mh-context .mh-crumbs .mh-sep {opacity:.5;}
.mh-context .mh-crumbs .mh-crumb {border:0;background:none;color:inherit;cursor:pointer;padding:3px 6px;border-radius:6px;}
.mh-context .mh-crumbs .mh-crumb:hover {color:var(--p-chrome-text);background:var(--p-chrome-hover);}
.mh-context .mh-crumbs strong {padding-left:4px;}
@media (max-width:1460px){.mh-context .mh-period{display:none}}
@media (max-width:1050px){.mh-context .mh-search{order:9;flex-basis:100%}.mh-context .mh-crumbs,.mh-context .mh-chip{display:none}}

/* ---------- menu bar and drop-downs ---------- */
.presentation-ui .menubar {gap:2px;padding:0 16px;border-bottom:1px solid var(--p-hair);font:inherit;}
.presentation-ui .menubar .mi {position:relative;padding:10px 12px;border-radius:7px;color:var(--p-muted);font-weight:500;transition:color .2s,background .2s;}
.presentation-ui .menubar .mi::after {content:"";position:absolute;left:12px;right:12px;bottom:2px;height:2px;border-radius:2px;background:var(--p-accent);transform:scaleX(0);transition:transform .3s var(--p-ease);}
.presentation-ui .menubar .mi.ds-current {color:var(--p-accent);}
.presentation-ui .menubar .mi.ds-current::after {transform:scaleX(1);}
.presentation-ui .menubar .mi u {text-underline-offset:3px;}
.presentation-ui .menu-drop {min-width:250px;border:1px solid var(--p-hair);border-radius:12px;box-shadow:var(--p-shadow-lg);padding:6px;font:400 calc(14px * var(--p-scale))/1.45 var(--p-font);}
.presentation-ui .menu-drop .it {min-height:0;padding:8px 10px;border-radius:7px;}
.presentation-ui .menu-drop .it .hk {font:500 .72em var(--p-mono);border:1px solid var(--p-line);border-bottom-width:2px;border-radius:5px;color:var(--p-muted);background:var(--p-surface);}
.presentation-ui .menu-drop .sep {background:var(--p-hair);margin:4px 6px;}

/* ---------- command bar ---------- */
.presentation-ui .toolbar.mh-toolbar {gap:10px;padding:9px 16px;border-bottom:1px solid var(--p-hair);position:sticky;top:0;z-index:20;}
.mh-toolbar .mh-title {font-size:17px;font-weight:600;}
.mh-toolbar .mh-state {display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;padding:2px 10px;border-radius:999px;background:var(--p-warn-soft);color:var(--p-warn);white-space:nowrap;}
.mh-toolbar .mh-state::before {content:"";width:6px;height:6px;border-radius:50%;background:currentColor;}
.mh-toolbar .mh-state.ok {background:var(--p-ok-soft);color:var(--p-ok);}
.mh-toolbar .mh-state:empty {display:none;}
.mh-toolbar .mh-group {padding:3px;border-radius:10px;background:var(--p-sunk);}
.mh-toolbar .mh-group-label {font-size:10px;letter-spacing:.08em;color:var(--p-faint);padding:0 5px 0 7px;}
.presentation-ui .mh-toolbar .tb {gap:6px;padding:6px 10px;border-radius:8px;font:500 calc(14px * var(--p-scale)) var(--p-font);transition:background .15s,box-shadow .2s,transform .1s;}
.presentation-ui .mh-toolbar .tb:active:not(:disabled) {transform:scale(.95);}
.presentation-ui .mh-toolbar .tb:hover:not(:disabled) {box-shadow:0 1px 3px rgb(0 0 0 / .12);}
.presentation-ui .mh-toolbar .tb.mh-primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));box-shadow:0 4px 14px var(--p-glow);}
.presentation-ui .mh-toolbar .tb.mh-primary:disabled {background:var(--p-sunk);color:var(--p-muted);box-shadow:none;opacity:1;}
.presentation-ui .mh-toolbar .tb:disabled {opacity:.36;}
.mh-toolbar .mh-pos {font:12px var(--p-mono);color:var(--p-muted);padding:0 8px;white-space:nowrap;}
@media (max-width:1360px){.mh-toolbar .mh-label,.mh-toolbar .mh-group-label{display:none}.mh-toolbar .tb.mh-primary .mh-label{display:inline}}
@media (max-width:900px){.presentation-ui .toolbar.mh-toolbar{position:static;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}}

/* ---------- Home tab bar and panel ---------- */
.presentation-ui .ds-home-bar {display:flex;align-items:center;gap:10px;padding:9px 16px;background:var(--p-surface);border-bottom:1px solid var(--p-hair);min-height:52px;}
.presentation-ui .ds-home-bar[hidden] {display:none;}
.presentation-ui .ds-home-bar .ds-spacer {flex:1;}
.presentation-ui .ds-home-bar .tb {display:flex;align-items:center;gap:6px;border:0;background:none;padding:6px 10px;border-radius:8px;cursor:pointer;color:var(--p-text);font:500 calc(14px * var(--p-scale)) var(--p-font);transition:background .15s,box-shadow .2s,transform .1s;}
.presentation-ui .ds-home-bar .tb:hover {background:var(--p-sunk);}
.presentation-ui .ds-home-bar .tb:active {transform:scale(.95);}
.presentation-ui .ds-home-bar .tb.mh-primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));color:var(--p-on-accent);box-shadow:0 4px 14px var(--p-glow);}
.presentation-ui.ds-home-on .toolbar.mh-toolbar {display:none!important;}
.presentation-ui .mdi-client > .ds-home-host {z-index:100000;}
/* ---------- notifications and shortcuts ---------- */
.mh-popover .mh-pop-title {margin:4px 8px 8px;font-weight:600;font-size:13px;}
.mh-popover .mh-note {display:flex!important;gap:10px;align-items:flex-start;padding:10px 8px!important;border-radius:8px;}
.mh-popover .mh-note b {display:block;font-weight:500;}
.mh-popover .mh-note small {display:block;color:var(--p-muted);font-size:12px;}
.mh-popover .mh-note-dot {width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--p-info);}
.mh-popover .mh-note-dot.bad {background:var(--p-danger);} .mh-popover .mh-note-dot.warn {background:var(--p-warn);} .mh-popover .mh-note-dot.ok {background:var(--p-ok);}
.mh-shortcuts {padding:0;}
.mh-shortcuts h2 {font-size:17px;margin:0;padding:18px 20px 6px;}
.mh-shortcuts .mh-keys {display:grid;grid-template-columns:auto 1fr;gap:8px 18px;padding:12px 20px;max-height:60vh;overflow:auto;font-size:13px;}
.mh-shortcuts .mh-keys kbd {justify-self:start;font:500 .78em var(--p-mono);border:1px solid var(--p-line);border-bottom-width:2px;border-radius:5px;padding:0 6px;color:var(--p-muted);background:var(--p-surface);}
.mh-shortcuts .mh-palette-foot {justify-content:flex-end;}
.mh-shortcuts .mh-close {min-height:40px;padding:0 16px;border-radius:9px;border:1px solid var(--p-accent);background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));color:var(--p-on-accent);font:500 14px var(--p-font);cursor:pointer;}
/* ---------- window tabs ---------- */
.presentation-ui .presentation-tabs {gap:4px;padding:8px 16px 0;background:var(--p-canvas);border-bottom:1px solid var(--p-hair);scrollbar-width:none;}
.presentation-ui .presentation-tab>[role=tab] {display:inline-flex;align-items:center;gap:8px;padding:7px 6px 7px 12px;border-radius:9px 0 0 0;}
.presentation-ui .presentation-tab>[aria-selected=true] {box-shadow:inset 0 2px 0 var(--p-accent);}
.presentation-ui .presentation-tab:has(>[aria-selected=true])>button:last-child {box-shadow:inset 0 2px 0 var(--p-accent);border-radius:0 9px 0 0;}
.presentation-ui .presentation-tab .ds-tab-dot {width:7px;height:7px;border-radius:50%;background:var(--p-warn);}
.presentation-ui .presentation-tab .ds-tab-icon {width:15px;height:15px;flex:none;}
.presentation-ui .presentation-tab.ds-fresh {animation:ds-up .3s var(--p-ease);}

/* ---------- status bar ---------- */
.presentation-ui .pbwin:has(> div > .mdi-client) .status {display:flex;align-items:center;gap:16px;height:auto;padding:6px 16px;border-top:1px solid var(--p-hair);background:var(--p-surface);color:var(--p-muted);font:12px var(--p-font);}
.presentation-ui .ds-status-right {margin-left:auto;display:flex;gap:16px;flex-wrap:wrap;}
.presentation-ui .ds-status-right .ds-live {display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ec98a;margin-right:6px;animation:ds-pulse 2s infinite;}

/* ---------- cards (data surfaces, panels) ---------- */
.presentation-ui .modern-surface {border:1px solid var(--p-hair);border-radius:14px;box-shadow:var(--p-shadow);}
.presentation-ui .modern-entry-window .entry-data>.modern-surface {border-radius:14px;}
.modern-surface .surface-status {font-size:12.5px;color:var(--p-muted);padding:10px 16px;}
.modern-surface section.surface-row {gap:14px 16px;padding:16px 18px;}

/* every surface: required marks as a red asterisk (the word stays for screen readers), plain row counts hidden */
.modern-surface .surface-field > .surface-label {display:inline-block;}
.modern-surface .surface-field > .surface-required {display:inline;}
.modern-surface .surface-field > .surface-label + .surface-required + * ,.modern-surface .surface-field > .surface-label + :not(.surface-required) {display:block;}
.modern-surface .surface-required {font-size:0;line-height:0;}
.modern-surface .surface-required::after {content:"*";font-size:calc(13px * var(--p-scale));line-height:1;color:var(--p-danger);margin-left:3px;}
.modern-surface th > span {display:inline;}
.modern-surface > .surface-status.surface-status-summary {display:none;}
/* labels and inputs (mockup .f / .in) */
.modern-surface .surface-label {font-size:12.5px;font-weight:500;color:var(--p-muted);margin-bottom:5px;}
.modern-surface .surface-field > .surface-value.editable,.modern-surface .surface-field > .surface-value[role=button],.modern-surface .surface-field > .surface-value.surface-choice {
  min-height:40px;padding:8px 12px;border:1px solid var(--p-line);border-radius:8px;background:var(--p-surface);transition:border-color .15s,box-shadow .2s;
}
.modern-surface .surface-field > .surface-value.editable:hover {border-color:var(--p-faint);}
.modern-surface .surface-field input.surface-editor,.modern-surface .surface-field select,.modern-surface .surface-field textarea {border-radius:8px;}
.modern-surface .surface-field:focus-within > .surface-value,.modern-surface .surface-field > .surface-value:focus,.modern-surface input.surface-editor:focus {
  outline:none;border-color:var(--p-accent)!important;box-shadow:0 0 0 4px var(--p-glow);
}
.modern-surface .surface-field > .surface-value:not(.editable):not(.surface-choice):not([role=button]) {background:var(--p-sunk);border-radius:8px;color:var(--p-muted);}
.modern-surface .surface-number,.modern-surface .surface-total-value {font-family:var(--p-mono);font-variant-numeric:tabular-nums;}

/* tables (mockup th/td) */
.modern-surface th {padding:10px 12px;background:var(--p-surface);border-bottom:1px solid var(--p-hair);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--p-muted);}
.modern-surface td {border-bottom:1px solid var(--p-hair);}
.modern-surface .surface-grid tbody tr {transition:background .15s;}
.modern-surface .surface-grid tbody tr:hover {background:var(--p-sunk);}
.modern-surface .surface-grid tbody tr:hover .surface-value {background:transparent;}
.modern-surface .surface-grid .cur {background:var(--p-selected);box-shadow:inset 3px 0 0 var(--p-accent);}
.modern-surface .surface-grid .cur .surface-value {background:transparent;}
.modern-surface .row.sel {background:var(--p-selected);box-shadow:inset 3px 0 0 var(--p-accent);}
.modern-surface .row.sel .surface-value {background:transparent;}
.modern-surface .row.sel .o {color:var(--p-text)!important;}
.modern-surface .surface-band {background:var(--p-sunk);border-top:1px solid var(--p-hair);font-weight:600;}
.modern-surface .surface-band dt {font-weight:500;color:var(--p-muted);}

.modern-surface .simplified-form:not(.simplified-summary) .simplified-row {grid-auto-flow:row dense;}
.modern-surface .simplified-form .simplified-row > .grid-cell:not(.surface-field):not(.simplified-more):empty {display:none;}
/* fields the source keeps invisible (no grid cell, zero size) stay in the page but take no slot of the card grid */
.modern-surface .simplified-form:not(.simplified-summary) .simplified-row.has-grid > .surface-field:not(.grid-cell) {position:absolute!important;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
/* section headings of the approved design (card header) */
.modern-surface .simplified-surface > .simplified-head {margin:0!important;padding:14px 18px 12px!important;border-bottom:1px solid var(--p-hair);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
.modern-surface .simplified-surface > .simplified-head h2 {font-size:15px;font-weight:600;margin:0;}
.modern-surface .simplified-surface > .simplified-head span {color:var(--p-muted);font-size:12.5px;}
.modern-surface .simplified-grid > .simplified-toggle {margin:10px 18px 8px;}
/* summary panel total band, wherever the total sits inside the summary form */
.modern-surface .simplified-summary .simplified-emphasis {order:300!important;display:grid!important;grid-template-columns:max-content auto minmax(0,1fr)!important;align-items:center;margin:12px -16px -16px!important;padding:14px 16px!important;border-radius:0 0 10px 10px;background:var(--p-text)!important;position:relative;overflow:hidden;}
.modern-surface .simplified-summary .simplified-emphasis::after {content:"";position:absolute;top:0;bottom:0;width:30%;background:linear-gradient(90deg,transparent,rgb(255 255 255 / .16),transparent);animation:ds-sheen 3.5s ease-in-out infinite 1s;pointer-events:none;}
.modern-surface .simplified-summary .simplified-emphasis .surface-label {color:var(--p-surface)!important;text-transform:uppercase;letter-spacing:.08em;font-size:11.5px;opacity:.8;}
.modern-surface .simplified-summary .simplified-emphasis .surface-value {grid-column:3!important;justify-self:end;background:transparent!important;border:0!important;box-shadow:none!important;color:var(--p-surface)!important;font:600 26px var(--p-mono)!important;width:auto!important;padding:0!important;min-height:0!important;}
.modern-surface .simplified-summary .simplified-emphasis .surface-required {display:none;}
.modern-surface .simplified-summary .surface-group {display:contents;}
/* ---------- buttons (mockup .btn) ---------- */
.modern-window button.ctl.window-button:not(.window-embedded *),.modern-window .window-actions button,.presentation-settings button,.modern-surface .surface-button button,.modern-surface button.surface-button {
  min-height:40px;padding:0 16px;border-radius:9px;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);font:500 calc(14px * var(--p-scale)) var(--p-font);cursor:pointer;transition:transform .12s,background .15s,box-shadow .2s,border-color .15s;
}
.modern-window button.ctl.window-button:hover:not(:disabled):not(.window-embedded *),.modern-window .window-actions button:hover:not(:disabled),.presentation-settings button:hover {background:var(--p-sunk);border-color:var(--p-faint);}
.modern-window button.ctl.window-button:active:not(:disabled),.modern-window .window-actions button:active:not(:disabled) {transform:scale(.97);}
.modern-window .window-actions button.default:not(:disabled),.modern-window button.ctl.default:not(:disabled):not(.window-embedded *),.presentation-settings button[type=submit] {
  background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent);box-shadow:0 6px 18px var(--p-glow);
}

/* ---------- inputs inside dialogs and response windows ---------- */
.modern-window :is(input,select,textarea).ctl:not([type=checkbox]):not([type=radio]):not(.window-embedded *) {
  min-height:40px;border:1px solid var(--p-line)!important;border-radius:8px!important;background:var(--p-surface)!important;padding:0 12px;transition:border-color .15s,box-shadow .2s;
}
.modern-window :is(input,select,textarea).ctl:focus:not(.window-embedded *) {outline:none;border-color:var(--p-accent)!important;box-shadow:0 0 0 4px var(--p-glow);}
.modern-window .window-field label,.modern-window .window-caption {font-size:12.5px;font-weight:500;color:var(--p-muted);}

/* ---------- dialogs and response windows (mockup .modal) ---------- */
.modern-window .window-actions {display:flex!important;flex-direction:row!important;justify-content:flex-end;align-items:center;flex-wrap:wrap;}
.modern-window .window-actions > button.ctl:not(.window-embedded):not(.window-embedded *):not(.window-source-layout *),.modern-window .window-actions > button {width:auto!important;flex:0 0 auto!important;min-width:96px;height:auto!important;position:static!important;}
.modern-window .window-actions button.ctl.ds-primary:not(:disabled):not(.window-embedded *):not(.window-source-layout *),.modern-window .window-actions button.ds-primary:not(:disabled) {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent))!important;border-color:var(--p-accent)!important;color:var(--p-on-accent)!important;box-shadow:0 6px 18px var(--p-glow);}

.presentation-compatibility-dialog::backdrop,.presentation-settings::backdrop,.mh-palette::backdrop {background:var(--p-scrim);backdrop-filter:blur(3px);}
.presentation-compatibility-dialog .modern-window.pbwin,.presentation-settings {border:1px solid var(--p-hair);border-radius:16px;box-shadow:var(--p-shadow-lg);overflow:hidden;}
.modern-window.pbwin>.tbar {padding:18px 20px 6px;border-bottom:0;}
.modern-window.pbwin>.tbar .ttl {font-size:17px;font-weight:600;}
.modern-window .window-actions {gap:8px;padding:14px 20px;border-top:1px solid var(--p-hair);}
.presentation-settings {padding:0;background:var(--p-surface);color:var(--p-text);font-family:var(--p-font);}
.presentation-settings form {padding:18px 20px;}
.presentation-settings select {min-height:40px;border:1px solid var(--p-line);border-radius:8px;padding:0 10px;background:var(--p-surface);color:var(--p-text);}

/* runtime message boxes and prompts (mockup .modal) */
.presentation-runtime-dialog {width:min(480px,calc(100vw - 32px));padding:0!important;}
.presentation-runtime-dialog h2 {display:flex;align-items:center;gap:10px;margin:0;padding:18px 20px 0;font:600 17px/1.3 var(--p-font);color:var(--p-text);}
.presentation-runtime-dialog .presentation-message-icon svg {width:22px;height:22px;color:var(--p-accent);}
.presentation-runtime-dialog .presentation-copy {margin:0;padding:12px 20px 16px;color:var(--p-muted);white-space:pre-wrap;}
.presentation-runtime-dialog label,.presentation-runtime-dialog input {margin:0 20px 12px;}
.presentation-runtime-dialog input {min-height:40px;border:1px solid var(--p-line);border-radius:8px;padding:0 12px;background:var(--p-surface);color:var(--p-text);width:calc(100% - 40px);}
.presentation-runtime-dialog footer {display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--p-hair);margin:0;}
.presentation-runtime-dialog footer button {min-width:96px;}
.presentation-runtime-dialog footer button.ds-primary,.presentation-settings footer button.ds-primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent))!important;border-color:var(--p-accent)!important;color:var(--p-on-accent)!important;box-shadow:0 6px 18px var(--p-glow);}
/* ---------- entry window Detail / List tabs (mockup .tabs) ---------- */
.modern-entry-window .entry-tabs>.strip {gap:4px;border-bottom:1px solid var(--p-hair);background:transparent;padding:0 16px;}
.modern-entry-window .entry-tabs>.strip>.t {border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:9px 12px;color:var(--p-muted);font-weight:500;transition:color .2s,border-color .2s;}
.modern-entry-window .entry-tabs>.strip>.t.on {color:var(--p-accent);border-bottom-color:var(--p-accent);background:none;}
.modern-entry-window.pbwin,.modern-entry-window>.client {background:var(--p-canvas);}

/* ---------- sign-in (before the Modern workspace starts) ---------- */
body.ds-boot {background:var(--p-canvas);}
body.ds-boot #desktop {background:var(--p-canvas)!important;}
body.ds-boot .ds-login-art {position:fixed;inset:0 auto 0 0;width:52vw;background:var(--p-chrome);color:var(--p-chrome-text);display:flex;flex-direction:column;justify-content:space-between;padding:clamp(24px,5vw,56px);overflow:hidden;z-index:0;font-family:var(--p-font);}
body.ds-boot .ds-login-art .ds-blob {position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:ds-blob 16s ease-in-out infinite;}
@keyframes ds-blob {0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(30px,-40px) scale(1.12)}66%{transform:translate(-25px,25px) scale(.92)}}
body.ds-boot .ds-login-art > :not(.ds-blob) {position:relative;}
body.ds-boot .ds-login-art h1 {font-size:clamp(28px,3.4vw,44px);line-height:1.12;margin:0 0 14px;letter-spacing:-.02em;max-width:16ch;text-wrap:balance;}
body.ds-boot .ds-login-art p {color:var(--p-chrome-muted);max-width:44ch;margin:0;}
body.ds-boot .ds-login-brand {display:flex;align-items:center;gap:12px;font-weight:600;letter-spacing:.02em;}
body.ds-boot .ds-login-mark {width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;display:grid;place-items:center;font-weight:700;font-size:14px;box-shadow:0 6px 20px rgb(15 107 111 / .45);}
body.ds-boot .pbwin[data-win=w_login1] {left:calc(52vw + (48vw - 400px) / 2)!important;top:calc(50vh - 190px)!important;width:400px!important;border:0!important;background:transparent!important;box-shadow:none!important;font-family:var(--p-font);}
body.ds-boot .pbwin[data-win=w_login1] > .tbar {background:transparent!important;color:var(--p-text);height:auto;padding:0 0 18px;font:600 24px/1.2 var(--p-font);}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ic,body.ds-boot .pbwin[data-win=w_login1] > .tbar .cls {display:none;}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ttl {font-size:0;white-space:normal;}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ttl::before {content:"Welcome back";display:block;font:600 24px/1.2 var(--p-font);letter-spacing:-.01em;color:var(--p-text);}
body.ds-boot .pbwin[data-win=w_login1] > .tbar .ttl::after {content:"Sign in with your Trader user name.";display:block;margin-top:4px;font:400 14px/1.4 var(--p-font);color:var(--p-muted);}
body.ds-boot .pbwin[data-win=w_login1] > .client {background:transparent!important;}
body.ds-boot .pbwin[data-win=w_login1] button {border-radius:9px;min-height:40px;font:500 14px var(--p-font);border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);cursor:pointer;transition:transform .12s,filter .15s;}
body.ds-boot .pbwin[data-win=w_login1] button:active {transform:scale(.97);}
body.ds-boot .pbwin[data-win=w_login1] button:first-of-type {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent);box-shadow:0 6px 18px var(--p-glow);}
body.ds-boot .pbwin[data-win=w_login1] button:first-of-type:hover {filter:brightness(1.06);}
body.ds-boot .pbwin[data-win=w_login1] {height:auto!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client {position:relative;height:250px!important;overflow:visible;}
body.ds-boot .pbwin[data-win=w_login1] .ctl:has([data-obj=login]) {left:0!important;top:0!important;width:100%!important;height:150px!important;}
body.ds-boot .pbwin[data-win=w_login1] .ctl:has([data-obj=login]) :is(.dw,.dw-inner,.band) {width:100%!important;height:100%!important;background:transparent!important;overflow:visible!important;}
body.ds-boot .pbwin[data-win=w_login1] .ctl:has([data-obj=login]) .o-text {left:0!important;width:100%!important;height:auto!important;font:500 12.5px var(--p-font)!important;color:var(--p-muted)!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=salesmancode_t] {top:0!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=password_t] {top:74px!important;}
body.ds-boot .pbwin[data-win=w_login1] :is([data-obj=login],[data-obj=password]) {left:0!important;width:100%!important;height:40px!important;padding:9px 12px!important;border:1px solid var(--p-line)!important;border-radius:8px!important;background:var(--p-surface)!important;color:var(--p-text)!important;font:14px var(--p-font)!important;box-sizing:border-box;transition:border-color .15s,box-shadow .2s;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=login] {top:22px!important;}
body.ds-boot .pbwin[data-win=w_login1] [data-obj=password] {top:96px!important;}
body.ds-boot .pbwin[data-win=w_login1] :is([data-obj=login],[data-obj=password]):focus-within,body.ds-boot .pbwin[data-win=w_login1] .dw-edit:focus {border-color:var(--p-accent)!important;box-shadow:0 0 0 4px var(--p-glow)!important;outline:none;}
body.ds-boot .pbwin[data-win=w_login1] .dw-edit {box-sizing:border-box;padding:9px 12px!important;border:1px solid var(--p-accent)!important;border-radius:8px!important;background:var(--p-surface)!important;color:var(--p-text)!important;font:14px var(--p-font)!important;box-shadow:0 0 0 4px var(--p-glow)!important;outline:none;}
body.ds-boot .pbwin[data-win=w_login1] .ctl:not(:has([data-obj])):has(>.dw) {display:none;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl {top:170px!important;height:44px!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:first-of-type {left:0!important;width:calc(68% - 4px)!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client > button.ctl:last-of-type {left:68%!important;width:32%!important;}
body.ds-boot .pbwin[data-win=w_login1] > .client::after {content:"Forgot your password? Ask an administrator to reset it in Manage › Users.";position:absolute;left:0;right:0;top:232px;text-align:center;font:12px var(--p-font);color:var(--p-faint);}
@media (max-width:860px){body.ds-boot .ds-login-art{display:none}body.ds-boot .pbwin[data-win=w_login1]{left:calc(50vw - 200px)!important;max-width:calc(100vw - 32px)}}
`
