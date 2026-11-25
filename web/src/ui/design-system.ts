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
.presentation-header.mh-context > :not(.mh-popover) {position:relative;}
.mh-context .mh-mark {width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;font-size:14px;box-shadow:0 6px 20px rgb(15 107 111 / .45);}
.mh-context .mh-brand b {letter-spacing:.03em;line-height:1.2;}
.mh-context .mh-sub {font-size:11px;}
.mh-context .mh-search {flex:0 1 clamp(220px,25vw,360px);min-width:150px;width:auto;padding:7px 10px;border-radius:9px;background:rgb(255 255 255 / .05);transition:border-color .2s,background .2s,box-shadow .25s;}
.mh-context .mh-search span:first-of-type {white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.mh-context .mh-search:hover {background:rgb(255 255 255 / .08);box-shadow:0 0 0 4px rgb(79 184 178 / .12);}
.mh-context .mh-chip {padding:5px 10px;transition:background .2s,color .2s;}
.mh-context .mh-theme button {width:30px;height:28px;transition:background .25s,color .25s,transform .2s;}
.mh-context .mh-theme button:hover {transform:rotate(-12deg);}
.mh-context .mh-icon {width:34px;height:32px;border-radius:9px;position:relative;}
.mh-context .mh-badge {position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;background:#c9302c;color:#fff;font:700 10px/17px var(--p-font);text-align:center;border:2px solid var(--p-chrome);}
.mh-context .mh-avatar {width:28px;height:28px;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;font-size:11px;}
.mh-context .mh-crumbs {display:flex;align-items:center;gap:4px;font-size:13px;flex:0 1 clamp(0px,calc(100vw - 1150px),400px);min-width:0;overflow:hidden;white-space:nowrap;container-type:inline-size;}
/* a short breadcrumb shows where you are (the window), not one letter of each level */
@container (max-width:300px){.mh-context .mh-crumbs > .mh-crumb,.mh-context .mh-crumbs > .mh-sep{display:none}}
/* a long path never pushes the header onto a second row: the earlier steps shrink first, the window title last */
.mh-context .mh-crumbs > * {flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.mh-context .mh-crumbs > strong {flex:0 1 auto;min-width:0;}
.mh-context .mh-crumbs > .mh-crumb {flex-shrink:8;}
.mh-context .mh-crumbs > .mh-sep {flex:none;}
.mh-context .mh-crumbs::before {content:none;}
.mh-context .mh-crumbs .mh-sep {opacity:.5;}
.mh-context .mh-crumbs .mh-crumb {border:0;background:none;color:inherit;cursor:pointer;padding:3px 6px;border-radius:6px;}
.mh-context .mh-crumbs .mh-crumb:hover {color:var(--p-chrome-text);background:var(--p-chrome-hover);}
.mh-context .mh-crumbs strong {padding-left:4px;}
@media (max-width:1460px){.mh-context .mh-period{display:none}}
@media (max-width:560px){.mh-context .mh-brand{flex:1 0 100%}.mh-context .mh-fill{display:none}}
@media (max-width:560px){.presentation-ui .ds-statusbar{flex-wrap:nowrap;padding:0 12px 0 0}.presentation-ui .ds-status-right{flex-wrap:nowrap}.presentation-ui .ds-status-right > span:not(:first-child){display:none!important}}
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
@media (max-width:900px){.modern-entry-window .modern-surface .simplified-form:not(.simplified-summary) .simplified-row{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
@media (max-width:850px){.presentation-ui:has(>.presentation-sidebar){grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);overflow:hidden}.presentation-ui > .presentation-work{grid-row:2;min-height:0}}
@media (max-width:900px){.presentation-ui .toolbar.mh-toolbar{position:static;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}}
/* a long command set (report windows: 25 commands) scrolls sideways instead of wrapping onto a second row */
.presentation-ui .toolbar.mh-toolbar {flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;}
.presentation-ui .toolbar.mh-toolbar > :not(.mh-spacer) {flex:none;}
/* when the commands do not fit, they scroll; Exit stays in reach at the right edge */
.presentation-ui .toolbar.mh-toolbar > .mh-group-exit {position:sticky;right:0;z-index:2;background:var(--p-surface);box-shadow:-10px 0 10px var(--p-surface);}
.modern-entry-window .entry-tabs.ds-tabs-in-toolbar > .strip {display:none!important;}
.presentation-ui .toolbar.mh-toolbar .ds-rep-back {display:inline-flex;align-items:center;gap:6px;color:var(--p-muted);}
.presentation-ui .toolbar.mh-toolbar .ds-rep-back .mh-label {display:inline!important;}
.presentation-ui .toolbar.mh-toolbar .ds-rep-pill {font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--p-info-soft);color:var(--p-info);}

/* ---------- Home tab bar and panel ---------- */
.presentation-ui .ds-home-bar {display:flex;align-items:center;gap:10px;padding:9px 16px;background:var(--p-surface);border-bottom:1px solid var(--p-hair);min-height:52px;}
.presentation-ui .ds-home-bar[hidden] {display:none;}
.presentation-ui .ds-home-bar .mh-title {font-size:17px;font-weight:600;letter-spacing:-.01em;color:var(--p-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
/* a long window title gives way to the commands: it shortens with an ellipsis (the full title is the tab's and the tooltip's) */
.presentation-ui .toolbar.mh-toolbar > .mh-title {flex:0 1 auto;min-width:6em;overflow:hidden;text-overflow:ellipsis;}
/* the frame's status line keeps no 3-D bevel of the original (a white edge and divider on the dark theme) */
.presentation-ui .ds-statusbar > .status {border:0!important;box-shadow:none!important;}
.presentation-ui .ds-statusbar > .ds-status-right {border-left:1px solid var(--p-hair)!important;padding-left:16px;}
.presentation-ui .ds-home-bar .ds-spacer {flex:1;}
.presentation-ui .ds-home-bar .tb {display:flex;align-items:center;gap:6px;border:0;background:none;padding:6px 10px;border-radius:8px;cursor:pointer;color:var(--p-text);font:500 calc(14px * var(--p-scale)) var(--p-font);transition:background .15s,box-shadow .2s,transform .1s;}
.presentation-ui .ds-home-bar .tb:hover {background:var(--p-sunk);}
.presentation-ui .ds-home-bar .tb:active {transform:scale(.95);}
.presentation-ui .ds-home-bar .tb.mh-primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));color:var(--p-on-accent);box-shadow:0 4px 14px var(--p-glow);}
.presentation-ui.ds-home-on .toolbar.mh-toolbar {display:none!important;}
.presentation-ui .mdi-client > .ds-home-host {z-index:100000;}
/* the frame's menus open over the Home page and over every sheet (sheets climb in z-index each time one is activated) */
.presentation-ui .menubar .mi.open {z-index:1000000;}
.presentation-ui .menu-drop {z-index:1000000;}
/* ---------- notifications and shortcuts ---------- */
.mh-popover .mh-pop-title {margin:4px 8px 8px;font-weight:600;font-size:13px;}
.mh-popover .mh-note {display:flex!important;gap:10px;align-items:flex-start;padding:10px 8px!important;border-radius:8px;}
.mh-popover .mh-note b {display:block;font-weight:500;}
.mh-popover .mh-note small {display:block;color:var(--p-muted);font-size:12px;}
.mh-popover .mh-note-dot {width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--p-info);}
.mh-popover .mh-note-dot.bad {background:var(--p-danger);} .mh-popover .mh-note-dot.warn {background:var(--p-warn);} .mh-popover .mh-note-dot.ok {background:var(--p-ok);}
.mh-context button.mh-brand {border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:2px 6px 2px 0;border-radius:9px;}
.mh-context button.mh-brand:disabled {cursor:default;}
.mh-popover {padding:8px;min-width:250px;border-radius:12px;box-shadow:var(--p-shadow-lg);}
.mh-popover button {display:flex!important;align-items:center;gap:10px;padding:8px!important;border-radius:7px!important;cursor:pointer;color:var(--p-text);font:inherit;}
.mh-popover button .mh-i {flex:none;color:var(--p-muted);}
.mh-popover button:hover:not(:disabled) {background:var(--p-selected)!important;}
.mh-popover .mh-check {margin-left:auto;color:var(--p-accent);}
.mh-popover .mh-danger-item, .mh-popover .mh-danger-item .mh-i {color:var(--p-danger)!important;}
.mh-popover .mh-pop-sec {border-top:1px solid var(--p-hair);margin:6px 0 0;padding-top:6px;}
.mh-popover .mh-pop-row {padding:5px 8px!important;font-size:13px;}
.mh-popover .mh-pop-row b.ok {color:var(--p-ok);} .mh-popover .mh-pop-row b.bad {color:var(--p-danger);}
.mh-popover .mh-pop-row b.num {font-family:var(--p-mono);}
.mh-popover .mh-pop-user {display:flex;gap:10px;align-items:center;margin:4px 8px 8px;font-size:13px;}
.mh-popover .mh-pop-user .mh-avatar {width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;background:linear-gradient(135deg,#0f6b6f,#1d5f80);color:#fff;font-size:11px;font-weight:600;}
.mh-popover .mh-pop-user b {display:block;font-weight:600;}
.mh-popover .mh-pop-user small {display:block;color:var(--p-faint);font-size:12px;font-weight:400;}
.mh-palette {width:min(680px,calc(100vw - 32px));border-radius:16px;}
.mh-palette .mh-q {padding:14px 16px;}
.mh-palette input {font-size:17px;}
.mh-palette .mh-scopes {display:flex;gap:6px;padding:9px 16px;border-bottom:1px solid var(--p-hair);flex-wrap:wrap;}
.mh-palette .mh-scope {border:1px solid var(--p-line);background:var(--p-surface);border-radius:999px;padding:5px 12px;font:12.5px var(--p-font);cursor:pointer;color:var(--p-muted);transition:all .2s;}
.mh-palette .mh-scope[aria-pressed=true] {background:var(--p-text);color:var(--p-canvas);border-color:var(--p-text);}
.mh-palette [role=option] {padding:9px 10px;border-radius:9px;}
.mh-palette [role=option] .mh-kind {width:30px;height:30px;border-radius:8px;background:var(--p-sunk);display:grid;place-items:center;color:var(--p-muted);flex:none;}
.mh-palette [role=option] .mh-text {flex:1;min-width:0;}
.mh-palette [role=option] small {display:block;color:var(--p-muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mh-palette [role=option].mh-hot {background:var(--p-selected);}
.mh-palette [role=option] > kbd {margin-left:auto;}
.mh-palette mark {background:none;color:var(--p-accent);font-weight:600;}
.mh-palette .mh-palette-foot {gap:14px;flex-wrap:wrap;}
.presentation-ui .presentation-tabs .ds-no-tabs {padding:8px 4px 10px;color:var(--p-muted);font-size:13px;}
.ds-nothing {max-width:640px;margin:40px auto;padding:44px 16px;text-align:center;color:var(--p-muted);}
.ds-nothing .ds-i {width:56px;height:56px;color:var(--p-line);margin-bottom:8px;}
.ds-nothing h2 {color:var(--p-text);margin:4px 0;font-size:20px;}
.ds-nothing kbd {font:500 .72em var(--p-mono);border:1px solid var(--p-line);border-bottom-width:2px;border-radius:5px;padding:0 5px;}
.ds-nothing .ds-btn.primary {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent);margin-top:8px;}
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
.presentation-ui .ds-statusbar {display:flex;align-items:center;gap:16px;padding:0 16px 0 0;border-top:1px solid var(--p-hair);background:var(--p-surface);color:var(--p-muted);font:12px var(--p-font);flex-wrap:wrap;}
.presentation-ui .pbwin:has(> div > .mdi-client) .ds-statusbar > .status {flex:1;min-width:0;border-top:0;background:none;}
.presentation-ui .ds-status-right {margin-left:auto;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
.presentation-ui .ds-status-right > span {display:inline-flex;align-items:center;white-space:nowrap;}
/* (.ds-live.ds-off: the plain .ds-live rule below came later with the same weight and painted "offline" green) */
.presentation-ui .ds-status-right .ds-live.ds-off {background:var(--p-danger);animation:none;}
.presentation-ui .ds-status-right .num {font-family:var(--p-mono);}
.presentation-ui .ds-status-right .ds-live {display:inline-block;width:7px;height:7px;border-radius:50%;background:#4ec98a;margin-right:6px;animation:ds-pulse 2s infinite;}

/* ---------- cards (data surfaces, panels) ---------- */
/* transaction pages: the cards sit inset on the canvas like the sale and purchase pages, without the source control's own square
   frame around the rounded card */
.modern-entry-window .entry-detail.ds-transaction:not(:has(.simplified-summary)) {padding:0 16px 16px;}
.modern-entry-window .entry-detail.ds-transaction > .entry-control {border:0!important;background:transparent!important;box-shadow:none!important;}
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
/* a report criteria dialog paints no required mark, as the original (the requirement is still announced and enforced) */
.modern-window:not(.modern-entry-window) .modern-surface .surface-required::after {content:none;}
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
/* dark: the sunk tone is next to the surface tone, so a read-only field is recessed below the canvas with a hairline instead (it read as an editable box) */
:is([data-theme=dark] .modern-surface,.modern-surface[data-theme=dark]) .surface-field > .surface-value:not(.editable):not(.surface-choice):not([role=button]):not(.simplified-summary *) {background:var(--p-canvas);border-color:var(--p-hair)!important;}
.modern-surface .surface-number,.modern-surface .surface-total-value {font-family:var(--p-mono);font-variant-numeric:tabular-nums;}
/* an open editor that does not hold the keyboard looks like any other field: only the focused one carries the accent ring */
.modern-surface :is(input,textarea,select).surface-editor:not(:focus):not([type=checkbox]) {border-color:var(--p-line);box-shadow:none;}
/* one-column forms (masters such as Customer): the caption beside its field, the form no wider than a readable line */
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) {max-width:68em;grid-template-rows:none!important;grid-auto-rows:auto;row-gap:8px!important;}
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field {display:grid!important;grid-template-columns:minmax(9em,13em) 1.2em minmax(0,1fr);align-items:center;column-gap:4px;}
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field > .surface-label {grid-column:1;margin:0;white-space:normal;overflow-wrap:anywhere;}
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field > .surface-required {grid-column:2;}
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field > :not(.surface-label):not(.surface-required) {grid-column:3;min-width:0;}
/* the required mark follows the caption's text (it stood at the far end of the caption column, beside the field) */
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field > .surface-required::after {visibility:hidden;}
.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field:has(> .surface-required) > .surface-label::after {content:" *";color:var(--p-danger);font-weight:700;}
@media (max-width:700px){.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field {grid-template-columns:minmax(0,1fr) auto;}.modern-entry-window .modern-surface .surface-row.has-grid.grid-one-column:not(.simplified-row) > .surface-field > :not(.surface-label):not(.surface-required) {grid-column:1 / -1;}}
/* a form with no record yet (a transaction still opening) is an empty card, as the original's empty form: the "No rows" line is
   kept for assistive technology only; lists keep it visible */
.modern-entry-window .modern-surface .surface-body:not(.surface-body-grid) > .surface-empty {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
/* check boxes of a form: a real box with its caption (the generic "field under its caption" rule made the box a thin bar), without
   the frame of a text field */
.modern-surface .surface-field > .surface-value.surface-toggle {display:flex!important;align-items:center;gap:10px;border:0!important;background:transparent!important;box-shadow:none!important;padding-inline:0!important;}
.modern-surface .surface-toggle .cbx {flex:none;display:inline-block;width:18px;height:18px;border:1.5px solid var(--p-faint);border-radius:5px;background:var(--p-surface);transition:background .15s,border-color .15s;}
.modern-surface .surface-toggle:hover .cbx {border-color:var(--p-accent);}
.modern-surface .surface-toggle .cbx.on {background:var(--p-accent);border-color:var(--p-accent);}
.modern-surface .surface-toggle:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;border-radius:6px;}
/* read-only cells of a grid are plain text on the row (the sunk box of a read-only form field made rows look patchy) */
.modern-surface td.surface-field > .surface-value:not(.editable):not(.surface-choice):not([role=button]) {background:transparent!important;border-radius:0;}
/* a list page whose Find DataWindow holds no row (the original shows no box either) keeps no empty frame */
.modern-entry-window .entry-find:has(.surface-body:not(.surface-body-grid) > .surface-empty) {height:0!important;min-height:0!important;border:0!important;margin:0!important;padding:0!important;overflow:hidden;}
/* a button in a grid cell (the "---" picker of a row) keeps its caption on one line inside its narrow column */
.modern-surface .surface-grid td > button.surface-button {white-space:nowrap;width:100%;min-width:0;min-height:28px;padding:0 4px!important;border-radius:6px;}
.modern-surface .surface-grid td:has(> button.surface-button) {padding:3px 4px;}
/* a command button among the fields of a form lines up with the fields of its row (it has no caption above it) */
.modern-surface .simplified-row > .surface-button,.modern-surface .simplified-row > .grid-cell:has(> button.surface-button:only-child) {align-self:end!important;}
/* a check box whose caption stands before it keeps the box next to the caption */
.modern-surface .surface-field > .surface-value.surface-toggle.dw-checkbox-left {justify-content:flex-start;}
.modern-surface .surface-toggle.dw-checkbox-left .cbx {margin-inline-start:4px!important;}
/* figures the source leaves without a caption of their own (they stand beside "%", "Stock:" or "As/Doc" in the original) get a
   readable caption; the accessible name stays the original's */
.modern-surface .surface-field[data-field=rppmargin] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=purprice] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=rpp] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=avgprice] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=retailprice] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=itemtotalval] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=totalstock] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=doccode] > .surface-label.presentation-visually-hidden,.modern-surface .surface-field[data-field=customerbalance] > .surface-label.presentation-visually-hidden {position:static!important;width:auto!important;height:auto!important;clip:auto!important;clip-path:none!important;overflow:visible!important;white-space:nowrap;margin:0 0 3px!important;font-size:0!important;color:var(--p-muted);display:inline-block;}
.modern-surface .surface-field[data-field=rppmargin] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=purprice] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=rpp] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=avgprice] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=retailprice] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=itemtotalval] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=totalstock] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=doccode] > .surface-label.presentation-visually-hidden::before,.modern-surface .surface-field[data-field=customerbalance] > .surface-label.presentation-visually-hidden::before {font-size:12.5px;font-weight:500;}
.modern-surface .surface-field[data-field=rppmargin] > .surface-label.presentation-visually-hidden::before {content:"RPP margin %";}
.modern-surface .surface-field[data-field=purprice] > .surface-label.presentation-visually-hidden::before {content:"Purchase price";}
.modern-surface .surface-field[data-field=rpp] > .surface-label.presentation-visually-hidden::before {content:"RPP";}
.modern-surface .surface-field[data-field=avgprice] > .surface-label.presentation-visually-hidden::before {content:"Avg. price";}
.modern-surface .surface-field[data-field=retailprice] > .surface-label.presentation-visually-hidden::before {content:"Retail price";}
.modern-surface .surface-field[data-field=itemtotalval] > .surface-label.presentation-visually-hidden::before {content:"Item value";}
.modern-surface .surface-field[data-field=totalstock] > .surface-label.presentation-visually-hidden::before {content:"T/Stock";}
.modern-surface .surface-field[data-field=doccode] > .surface-label.presentation-visually-hidden::before {content:"As/Doc";}
.modern-surface .surface-field[data-field=customerbalance] > .surface-label.presentation-visually-hidden::before {content:"Amount";}
/* editors of a grid row leave the row's lines visible (they filled the row edge to edge and touched each other) */
.modern-surface .surface-grid td.surface-field > .surface-value.editable,.modern-surface .surface-grid td.surface-field > .surface-value.surface-choice {min-height:28px!important;padding-block:3px!important;margin-block:2px;}
/* a one-word heading wider than its narrow column is not broken letter by letter */
.modern-surface .surface-grid th {overflow-wrap:normal!important;word-break:normal!important;}
/* list pages keep the margin of every other page */
.modern-entry-window .page > .entry-list {padding:0 16px 16px;box-sizing:border-box;}
/* a group box inside a four-column form takes a row of its own under the fields, its members four to a row */
.modern-surface .simplified-form:not(.simplified-summary) .simplified-row > .surface-group {grid-column:1 / -1!important;order:150;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 14px;padding-block:10px 4px;border-block-start:1px solid var(--p-hair);}
.modern-surface .simplified-form:not(.simplified-summary) .simplified-row > .surface-group > .surface-group-caption {grid-column:1 / -1;font-weight:600;}
/* a grid inside a dialog is as wide as its columns: the current-row band ends with the last cell */
.modern-window .window-fields .window-data table.surface-grid {width:100%!important;}
.modern-surface .surface-grid th {vertical-align:bottom;}
/* a group box's bottom edge clears its last option */
/* (group boxes keep the source's own spacing: moving a frame put its caption on its first option) */
/* the report viewer's frame is a quiet hairline like every card */
.modern-window .ctl.lowered.window-embedded {border-color:var(--p-hair)!important;}
/* an editable drop-down's arrow is part of the field (no divider, no button face) */
.modern-surface .dw-choice-toggle {border:0!important;background:transparent!important;color:var(--p-muted)!important;}
.modern-surface .dw-choice-toggle:hover:not(:disabled) {color:var(--p-text)!important;background:var(--p-sunk)!important;border-radius:0 8px 8px 0;}
/* a caption above its field starts where the field starts (the source right-aligns captions that stand left of a field) */
.modern-surface .surface-row:not(.grid-one-column) > .surface-field > .surface-label {text-align:start!important;}
.modern-window .window-data .surface-field > .surface-label {text-align:start!important;display:block;}
.modern-surface .surface-field > .window-caption {text-align:start!important;padding:0 0 3px!important;}
/* Compact density (the default): fields one size smaller and closer, so a transaction fits a laptop screen */
.modern-surface[data-density=compact] .surface-field > .surface-value.editable,.modern-surface[data-density=compact] .surface-field > .surface-value[role=button],.modern-surface[data-density=compact] .surface-field > .surface-value.surface-choice {min-height:34px;padding:5px 10px;}
/* (the padding above also reset the drop-down's room for its chevron: a narrow "Lock Reason" cell ran "GENERAL" into the arrow) */
.modern-surface[data-density=compact] .surface-field > .surface-value.surface-choice {padding-inline-end:2.2em;}
.modern-surface[data-density=compact] section.surface-row {gap:10px 14px;padding:12px 16px;}
.modern-surface[data-density=compact] .surface-label {margin-bottom:3px;}
/* summary panels (bill summary, payment): one tight line per figure, a dash for a figure that has no value yet */
.modern-surface .simplified-summary .simplified-row {gap:0!important;padding:8px 16px 12px!important;}
.modern-surface .simplified-summary .surface-field {padding:2px 0!important;align-items:center!important;}
.modern-surface .simplified-summary .surface-field .surface-label {font-size:13px!important;margin:0!important;}
.modern-surface .simplified-summary .surface-field .surface-value {font-size:13.5px!important;}
.modern-surface .simplified-summary .surface-field .surface-value.editable {min-height:32px!important;padding:4px 10px!important;}
.modern-surface .simplified-summary .surface-field > .surface-value:not(.editable):empty::after {content:"—";color:var(--p-faint);}
.modern-surface .simplified-summary .simplified-row > .surface-caption,.modern-surface .simplified-summary .simplified-row > .grid-cell:not(.surface-field):not(.simplified-more):not(.surface-group) {padding:2px 0!important;font-size:13px!important;}

/* tables (mockup th/td) */
.modern-surface th {padding:10px 12px;background:var(--p-surface);border-bottom:1px solid var(--p-hair);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--p-muted);}
.modern-surface td {border-bottom:1px solid var(--p-hair);}
.modern-surface .surface-grid tbody tr {transition:background .15s;}
.modern-surface .surface-grid tbody tr:hover {background:var(--p-sunk);}
.modern-surface .surface-grid tbody tr:hover .surface-value {background:transparent;}
.modern-surface .surface-grid .cur {background:var(--p-selected);box-shadow:inset 3px 0 0 var(--p-accent);}
/* a one-row grid of a dialog (the Machine of a criteria window, a lookup's code and name) is a field, not a list: no current-row tint */
.modern-window .window-data .modern-surface .surface-grid .cur:only-child {background:transparent;box-shadow:none;}
/* the fields of the current row stay field-coloured on its tint (a tinted, empty drop-down read as disabled) */
.modern-surface .surface-grid .cur :is(.surface-value.editable,.surface-choice,:is(input,select,textarea).surface-editor:not([type=checkbox])) {background-color:var(--p-surface);}
.modern-surface .surface-grid .cur .surface-value {background:transparent;}
.modern-surface .row.sel {background:var(--p-selected);box-shadow:inset 3px 0 0 var(--p-accent);}
.modern-surface .row.sel .surface-value {background:transparent;}
.modern-surface .row.sel .o {color:var(--p-text)!important;}
.modern-surface .surface-band {background:var(--p-sunk);border-top:1px solid var(--p-hair);font-weight:600;}
.modern-surface .surface-band dt {font-weight:500;color:var(--p-muted);}
/* each total is its own cell with a hairline before it: right-aligned values no longer read as the caption of the next total
   ("0.00 Total 0.00 Tax Value") */
.modern-surface .surface-band-footer dl {column-gap:0;overflow:hidden;}
.modern-surface .surface-band-footer dl > div {margin-left:-1px;padding-inline:16px;border-left:1px solid var(--p-hair);}
/* totals of a line grid read as plain figures (the source paints them as black boxes) */
.modern-surface .surface-band .surface-total-value {background:transparent!important;border:0!important;box-shadow:none!important;color:var(--p-text)!important;padding:0 2px;}
.modern-surface .surface-band dl > div:has(> dt:only-child) > dt {color:var(--p-text);font-weight:600;}

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
.modern-surface .simplified-summary .simplified-emphasis .surface-value {font-size:26px!important;}
/* dark: the band in --p-text turned white (a light island); it stays a deep band with light figures */
:is([data-theme=dark] .modern-surface,.modern-surface[data-theme=dark]) .simplified-summary .simplified-emphasis {background:var(--p-selected)!important;box-shadow:inset 0 1px 0 color-mix(in srgb,var(--p-accent) 45%,transparent);}
:is([data-theme=dark] .modern-surface,.modern-surface[data-theme=dark]) .simplified-summary .simplified-emphasis :is(.surface-label,.surface-value) {color:var(--p-text)!important;}
.modern-surface .simplified-summary .simplified-emphasis {margin-top:8px!important;padding:10px 16px!important;}
.modern-surface .simplified-summary .simplified-more {margin-top:4px!important;padding-top:4px!important;}
.modern-surface .simplified-summary .surface-group {display:contents;}
/* ---------- options: radio buttons and check boxes drawn in the design's own look (an unselected one is an outlined ring, not a
   grey disc that reads as disabled) ---------- */
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input:is([type=radio],[type=checkbox]):not(.window-embedded *) {appearance:none;-webkit-appearance:none;inline-size:20px;block-size:20px;margin:0;flex:none;display:inline-grid;place-content:center;border:1.5px solid var(--p-faint);background:var(--p-surface);cursor:pointer;transition:border-color .15s,background .15s,box-shadow .2s;}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input[type=radio]:not(.window-embedded *) {border-radius:50%;}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input[type=checkbox]:not(.window-embedded *) {border-radius:5px;}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input:is([type=radio],[type=checkbox]):hover:not(:disabled) {border-color:var(--p-accent);}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input:is([type=radio],[type=checkbox]):checked {border-color:var(--p-accent);background:var(--p-accent);}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input[type=radio]:checked::after {content:"";width:8px;height:8px;border-radius:50%;background:var(--p-on-accent);}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input[type=checkbox]:checked::after {content:"";width:10px;height:5px;border:solid var(--p-on-accent);border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg);}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input:is([type=radio],[type=checkbox]):disabled {opacity:.45;cursor:not-allowed;}
.modern-window .window-option {gap:10px;}
.modern-window .window-option {padding-inline:6px!important;margin-inline:-6px;}
:is(.modern-window,.modern-entry-window) :is(.window-option,label.ctl) input:is([type=radio],[type=checkbox]):focus-visible {outline:none!important;box-shadow:0 0 0 3px var(--p-glow);}
/* a dialog without a default button still shows which button accepts it (the look only: the keys stay the source's) */
.modern-window .window-actions:not(:has(button.default)) button:first-child:not(:disabled) {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent)!important;box-shadow:0 6px 18px var(--p-glow);}
/* a tab control inside a dialog carries the design's surfaces: no white page, light frame or clipped grid of the original */
.modern-window .tabctl.window-embedded {background:transparent!important;color:var(--p-text)!important;color-scheme:inherit;}
/* more tabs than fit: the strip fades at its right edge, so a cut caption reads as "more this way" (it scrolls sideways) */
/* Tabs wrap onto more rows instead of scrolling sideways behind a fade: Preferences has 19 visible tabs and the strip showed 11,
   with no scrollbar or arrow to reach the others.  The page follows the strip (a column), so a wrapped strip pushes it down. */
.modern-window .tabctl.window-embedded {display:flex!important;flex-direction:column;max-height:100%;}
.modern-window .tabctl.window-embedded > .strip {flex-wrap:wrap;height:auto!important;overflow:visible!important;row-gap:2px;flex:none;}
.modern-window .tabctl.window-embedded > .page {position:relative!important;inset:auto!important;flex:1 1 auto;min-height:0;margin-top:8px;}
/* a window that is one tab control (Preferences, Job Schedules) gives it the height above the Save/Cancel row: the source height of
   the tab control made the window scroll as well, under a fade that hid the last rows */
.modern-window > .client > .window-fields:has(> .tabctl.window-embedded):not(:has(> :not(.tabctl,.hidden))) > .tabctl.window-embedded {max-height:max(320px,calc(100dvh - 230px))!important;}
/* a page holding one list (Preferences) scrolls in that list only, not in the page and the window as well */
.modern-window .tabctl.window-embedded > .page > .ctl:only-child:has(> .modern-surface) {top:0!important;height:100%!important;}
.modern-window .tabctl.window-embedded > .page {background:var(--p-surface)!important;border:1px solid var(--p-hair)!important;border-radius:0 10px 10px 10px;overflow:auto;}
.modern-window .tabctl.window-embedded > .page > .ctl:has(> .modern-surface) {max-width:100%!important;}
.modern-window .tabctl.window-embedded > .page > .ctl > .modern-surface {overflow:auto!important;border:0!important;box-shadow:none!important;border-radius:0!important;}
.modern-window.pbwin:has(.tabctl.window-embedded .modern-surface) {width:min(max(64em,calc(var(--source-width,0px) * 1.3)),100%)!important;}
/* controls the tab pages keep at their source positions take the theme's colours (no light-grey lists and white boxes on dark) */
.modern-window .tabctl.window-embedded :is(input:not([type=checkbox]):not([type=radio]),select,textarea).ctl {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-line)!important;border-radius:6px;}
.modern-window .tabctl.window-embedded :is(input,select,textarea).ctl:disabled {background:var(--p-sunk)!important;color:var(--p-muted)!important;}
.modern-window .tabctl.window-embedded .ctl:is(.st,label,legend),.modern-window .tabctl.window-embedded fieldset.ctl > legend {color:var(--p-text)!important;background:transparent!important;}
.modern-window .tabctl.window-embedded fieldset.ctl {border-color:var(--p-hair)!important;background:transparent!important;border-radius:8px;}
.modern-window .tabctl.window-embedded input:is([type=checkbox],[type=radio]) {accent-color:var(--p-accent);}
.modern-window .tabctl.window-embedded input:is([type=checkbox],[type=radio]) {appearance:none;-webkit-appearance:none;width:16px;height:16px;margin:0 6px 0 0;flex:none;display:inline-grid;place-content:center;vertical-align:middle;border:1.5px solid var(--p-faint);background:var(--p-surface);cursor:pointer;}
.modern-window .tabctl.window-embedded input[type=radio] {border-radius:50%;}
.modern-window .tabctl.window-embedded input[type=checkbox] {border-radius:4px;}
.modern-window .tabctl.window-embedded input:is([type=checkbox],[type=radio]):checked {border-color:var(--p-accent);background:var(--p-accent);}
.modern-window .tabctl.window-embedded input[type=radio]:checked::after {content:"";width:6px;height:6px;border-radius:50%;background:var(--p-on-accent);}
.modern-window .tabctl.window-embedded input[type=checkbox]:checked::after {content:"";width:8px;height:4px;border:solid var(--p-on-accent);border-width:0 0 2px 2px;transform:translateY(-1px) rotate(-45deg);}
.modern-window .tabctl.window-embedded input:is([type=checkbox],[type=radio]):disabled {opacity:.45;}
.modern-window .tabctl.window-embedded .ctl > input:not([type=checkbox]):not([type=radio]),.modern-window .tabctl.window-embedded .pb-dropdown :is(select,input) {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-line)!important;border-radius:6px;}
.modern-window .tabctl.window-embedded .pb-dropdown :is(select,input):disabled,.modern-window .tabctl.window-embedded .ctl > input:disabled {background:var(--p-sunk)!important;color:var(--p-muted)!important;}
.modern-window .tabctl.window-embedded :is(label.ctl,.ctl.st,legend) {font:500 12.5px/1.3 var(--p-font)!important;white-space:nowrap;}
.modern-window .tabctl.window-embedded .page .ctl:not(fieldset):not(.dw),.modern-window .tabctl.window-embedded .page .ctl > input {border-color:var(--p-line)!important;}
/* About: captions on one line, the link in the interface font */
.pbwin[data-win=w_about] .window-caption,.pbwin[data-win=w_about] .window-field label .ctl {white-space:nowrap!important;overflow-wrap:normal!important;}
.pbwin[data-win=w_about] .ctl {font-family:var(--p-font)!important;}
.pbwin[data-win=w_about] .window-caption {overflow:visible!important;height:auto!important;line-height:1.5!important;}
/* the three groups (company, license, system information) fit a 900 px window: slimmer license boxes and caption rows, so System Information is not cut off below the fold */
/* Job Schedule: the schedule DataWindow (interval + unit) sits in a 143 x 28 box of the source: the surface's status line and field boxes did not fit and the unit cell fell outside the
   clipped box, so the interval could not be typed; its box grows to hold both cells side by side */
.pbwin[data-win=w_job_schedule] .ctl.lowered:has(> .dw [data-field=unitvalue]) {width:162px!important;max-width:162px!important;height:34px!important;overflow:visible!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) {width:162px!important;max-width:162px!important;height:34px!important;min-height:0!important;overflow:visible!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-status {display:none!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-body {padding:0!important;margin:0!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-row {display:flex!important;flex-wrap:nowrap!important;gap:6px;width:100%!important;max-width:162px!important;padding:0!important;margin:0!important;min-height:0!important;box-sizing:border-box;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-field {flex:1 1 0!important;width:auto!important;min-width:0!important;max-width:none!important;padding:0!important;min-height:0!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-field[data-field=unit] {flex:1.8 1 0!important;}
.pbwin[data-win=w_job_schedule] .dw.modern-surface:has([data-field=unitvalue]) .surface-value {min-height:30px!important;height:30px!important;min-width:0!important;width:100%!important;max-width:100%!important;box-sizing:border-box;}
.pbwin[data-win=w_about] .window-fields {--grid-density:.72;}
.pbwin[data-win=w_about] .window-fields .window-button {white-space:nowrap!important;}
.pbwin[data-win=w_about] .window-fields .window-field input.ctl {min-height:30px!important;height:30px!important;}
.pbwin[data-win=w_about] .window-fields .ctl.st.window-caption {padding-top:0!important;padding-bottom:0!important;line-height:1.35!important;}
.presentation-ui[data-theme=dark] .modern-window .tabctl.window-embedded,.modern-window[data-theme=dark] .tabctl.window-embedded {color-scheme:dark;}
.modern-window .tabctl.window-embedded button.ctl {background:var(--p-surface)!important;color:var(--p-text)!important;border:1px solid var(--p-line)!important;border-radius:8px;}
/* drop-downs of a tab page are drawn by the theme, enabled or not (the native disabled widget was a light grey box in the dark theme) */
.modern-window .tabctl.window-embedded .pb-dropdown select {appearance:none;-webkit-appearance:none;opacity:1!important;padding:0 16px 0 6px!important;font:500 12px/1.2 var(--p-font)!important;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='m2 2 4 4 4-4' fill='none' stroke='%238a98a6' stroke-width='1.6'/%3E%3C/svg%3E")!important;background-position:right 4px center!important;background-size:8px 6px!important;background-repeat:no-repeat!important;}
.modern-window .tabctl.window-embedded .pb-dropdown select:disabled {background-color:var(--p-sunk)!important;color:var(--p-muted)!important;border-color:var(--p-hair)!important;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='m2 2 4 4 4-4' fill='none' stroke='%238a98a6' stroke-width='1.6'/%3E%3C/svg%3E")!important;background-position:right 4px center!important;background-size:8px 6px!important;background-repeat:no-repeat!important;}
.modern-window .tabctl.window-embedded .ctl.pb-dropdown {border:0!important;background:transparent!important;box-shadow:none!important;}
.modern-window .tabctl.window-embedded input:is([type=checkbox],[type=radio]):disabled {opacity:1;border-color:var(--p-muted);background:var(--p-sunk);}
.modern-window .tabctl.window-embedded label.ctl:has(input:disabled) > span {color:var(--p-muted)!important;}
/* a one-line DataWindow of a tab page without a row is an empty box, not a clipped "No rows" note */
.modern-window .tabctl.window-embedded .page > .ctl.lowered > .modern-surface .surface-empty {display:none;}
.modern-window .tabctl.window-embedded .page > .ctl.lowered {border-radius:6px;background:var(--p-sunk)!important;}
.modern-window .tabctl.window-embedded :is(label.ctl,.ctl.st) {letter-spacing:-.01em;overflow:visible!important;}
.modern-window .tabctl.window-embedded label.ctl > input {margin-right:5px;}
/* an option of a tab page: its box and its caption on one line */
.modern-window .tabctl.window-embedded label.ctl:has(> input:is([type=radio],[type=checkbox])) {display:inline-flex!important;align-items:center;}
.modern-window .tabctl.window-embedded label.ctl > input:is([type=radio],[type=checkbox]) {vertical-align:middle;margin-top:0!important;margin-bottom:0!important;}
/* ---------- dialogs: one frame style, visible scrolling ---------- */
/* a resizable source window keeps no thick light frame around the card */
.presentation-compatibility-dialog .modern-window.pbwin {border-width:1px!important;border-color:var(--p-hair)!important;}
/* the card itself shows no focus frame when it (not one of its fields) holds the keyboard */
dialog.presentation-compatibility-dialog:focus,dialog.presentation-compatibility-dialog:focus-visible,.presentation-compatibility-dialog .modern-window.pbwin:focus,.presentation-compatibility-dialog .modern-window.pbwin:focus-visible {outline:none!important;}
/* a body taller than the screen scrolls with a bar the user can see (the last group was cut with no cue) */
dialog .modern-window.pbwin > .client {scrollbar-width:thin;scrollbar-color:var(--p-muted) transparent;scrollbar-gutter:stable;}
/* more of the body lies under the button bar: a soft edge above the bar while the body can still be scrolled down (it fades at the end) */
dialog .modern-window.pbwin > .client > .window-actions::before {content:"";position:absolute;inset:auto 0 100% 0;height:26px;pointer-events:none;opacity:0;
  background:linear-gradient(transparent,color-mix(in srgb,var(--p-text) 22%,transparent));}
@supports (animation-timeline:scroll()) {
  dialog .modern-window.pbwin > .client > .window-actions::before {animation:ds-more-below linear both;animation-timeline:scroll(nearest block);}
}
@keyframes ds-more-below {0%,94% {opacity:1;} 100% {opacity:0;}}
/* a check box of a grid stands under its heading's text, clear of the editor on its left */
.modern-surface table.surface-grid td.surface-field:has(> .surface-toggle) {padding-inline-start:12px!important;}
/* a form without a record below the main form (an inherited detail the screen does not fill) shows no empty card */
.modern-entry-window .entry-detail > .entry-form ~ .entry-form:has(> .modern-surface > .simplified-form > .surface-empty):not(:has(.surface-row)) {display:none!important;}
/* a command inside a form is as tall as a field, level with its caption */
/* a command with its caption in a one-column form ("Item Alert Color: [Select Color]"): the caption above, the command at the field edge */
.modern-surface .simplified-form > .surface-row.has-grid:not(.simplified-row) > button.surface-button.grid-cell {grid-column:1 / -1!important;justify-self:start;margin:24px 0 0 8px!important;min-width:14em;align-self:start;}
.modern-surface .simplified-form > .surface-row.has-grid:not(.simplified-row) > p.surface-caption.grid-cell {align-self:start;font:500 12.5px/1.3 var(--p-font)!important;color:var(--p-muted)!important;}
/* the Find box of a list page is one field, not a field in two frames */
.modern-entry-window .ctl.entry-find,.modern-entry-window .ctl.entry-find > .modern-surface {border:0!important;background:transparent!important;box-shadow:none!important;height:auto!important;min-height:0!important;overflow:visible!important;}
.modern-entry-window .ctl.entry-find .surface-row {padding:0!important;}
.modern-entry-window .ctl.entry-find .surface-field {padding-inline:0!important;}
/* a list whose Find box has no row (the window gives it none) shows no "Find:" caption and hint over nothing */
.modern-entry-window .entry-search:has(> .entry-find .surface-empty) > :is(:nth-child(1),:nth-child(2),.entry-find) {display:none!important;}
/* an editable drop-down of the criteria row is one field with its arrow inside, like the lists beside it */
.modern-entry-window .entry-criteria .pb-dropdown:has(> .dropdown-toggle) > input {border-right:0!important;border-radius:8px 0 0 8px!important;}
.modern-entry-window .entry-criteria .pb-dropdown > .dropdown-toggle {border:1px solid var(--p-line)!important;border-left:0!important;border-radius:0 8px 8px 0!important;background:var(--p-surface)!important;color:var(--p-muted)!important;}
.modern-entry-window .entry-criteria .pb-dropdown > .dropdown-toggle:hover {color:var(--p-text)!important;}
/* a check box in a row of captioned fields stands level with their editors, not with their captions */
.modern-surface .surface-row.simplified-row > .surface-field:has(> .surface-toggle) {align-self:end!important;padding-bottom:5px;}
/* a command in a row of fields: as wide and as tall as the fields beside it */
.modern-surface .surface-row.has-grid > button.surface-button.grid-cell {margin-inline:8px;height:34px!important;min-height:0!important;align-self:end;margin-bottom:3px;}
/* list boxes use the interface font; an option's focus frame is as wide as the option */
.modern-window select.ctl,.modern-window select.ctl option {font-family:var(--p-font)!important;}
.modern-window .window-fields.has-grid > .window-option {justify-self:start;width:fit-content!important;max-width:100%;}
.modern-entry-window .entry-criteria .dropdown-toggle {color:var(--p-muted)!important;}
.modern-entry-window .entry-criteria .dropdown-toggle svg path {stroke-width:1.2;}
/* selected text uses the accent, not the browser's blue */
.presentation-ui ::selection,dialog.presentation-compatibility-dialog ::selection {background:color-mix(in srgb,var(--p-accent) 38%,transparent);color:var(--p-text);}
/* a tab page drawn at the source's pixel size (Job Schedules) is shown a third larger, so its controls are as large as the rest */
.modern-window.pbwin[data-win=w_job_schedule] .tabctl.window-embedded > .page {zoom:1.3;}
.modern-window.pbwin[data-win=w_job_schedule] .tabctl.window-embedded > .page :is(label.ctl,.ctl.st,legend) {font-size:10px!important;}
.modern-window.pbwin[data-win=w_job_schedule] .tabctl.window-embedded > .page .pb-dropdown select {font-size:9.5px!important;}
/* the two arrows of a spin field are part of the field: no boxes of their own over its rounded end */
.modern-surface .surface-spin-controls {inset:1px 1px 1px auto!important;gap:0!important;}
.modern-surface .surface-value.surface-spinner,.modern-surface .surface-spinner .surface-editor {padding-right:calc(4em + 16px)!important;}
.modern-surface .surface-spin-controls button {border:0!important;border-left:1px solid var(--p-hair)!important;background:transparent!important;color:var(--p-muted)!important;min-height:0!important;}
.modern-surface .surface-spin-controls button:last-child {border-radius:0 7px 7px 0!important;}
.modern-surface .surface-spin-controls button:hover:not(:disabled) {background:var(--p-sunk)!important;color:var(--p-text)!important;}
/* the active tab of a dialog shows the accent, not the Classic dotted rectangle */
.modern-window .tabctl.window-embedded > .strip .t.on {outline:none!important;}
.modern-window .tabctl.window-embedded > .strip .t:focus-visible {outline:2px solid var(--p-accent)!important;outline-offset:-2px;border-radius:6px;}
/* the arrow of the editable criteria drop-down has the colour of the lists' arrows beside it */
.modern-entry-window .entry-criteria .pb-dropdown > .dropdown-toggle,.modern-entry-window .entry-criteria .pb-dropdown > .dropdown-toggle:hover {color:#8a98a6!important;}
/* every drop-down arrow has one colour (a DataWindow's arrow took the text colour, darker than the lists' arrows) */
.modern-surface .surface-choice-arrow {color:#8a98a6!important;}
/* the docked criteria card covers its whole strip (a line of the page behind showed at both sides) */
dialog.presentation-compatibility-dialog[open].ds-report-criteria {padding-inline:0!important;}
/* a text shown in a group or summary band uses the interface font; only figures use the figure font */
.modern-surface .surface-total-value:not(.surface-number) {font-family:var(--p-font)!important;}
/* an editor in the first column of a line grid starts under its heading, clear of the card edge and the row mark */
.modern-entry-window .modern-surface table.surface-grid tbody td.surface-field:first-child:has(> .surface-value.editable) {padding-inline-start:10px!important;}
/* a dialog never grows past the screen (a long option list ran under the application header) */
dialog.presentation-compatibility-dialog[open]:not(.ds-report-criteria) {max-height:calc(100vh - 32px)!important;}
/* a list inside a group box ends above the group's border */
.modern-window .window-fields.has-grid > .window-data:has(.surface-body-grid) {margin-bottom:10px;margin-inline:8px;width:auto!important;justify-self:stretch;}
/* a list scrolls inside its own box: the item selection list (27,818 rows shared from gd_itemsinfo) grew to 973,670px and showed an
   empty box while its rows were drawn far below, at the typed name */
.modern-window .window-data:not(.window-embedded) > .modern-surface:has(.surface-body-grid) {max-height:clamp(12em,40vh,22em);overflow:auto;}
/* an option's caption stays on one line ("All" broke into "Al / l" in a narrow column) */
.modern-window .window-option {white-space:nowrap;}
/* the chosen line of a list box reads as clearly as the others */
.modern-window select.ctl option:checked {background:var(--p-accent) linear-gradient(0deg,var(--p-accent),var(--p-accent))!important;color:var(--p-on-accent)!important;font-weight:600;}
/* a small DataWindow inside a dialog (one drop-down) has a whole, quiet frame instead of the original's two-edged 3-D border */
/* a form DataWindow inside a dialog (one or two fields) is part of the dialog, not a card in the card; a list keeps its frame */
.modern-window .window-fields .window-data:not(.window-embedded):not(.window-embedded *) {border:0!important;border-radius:0;box-shadow:none!important;background:transparent!important;}
.modern-window .window-fields .window-data:not(.window-embedded):has(.surface-body-grid) {border:1px solid var(--p-hair)!important;border-radius:10px;}
.modern-window .window-fields .window-data:not(.window-embedded):not(:has(.surface-body-grid)) section.surface-row {padding:0!important;}
.modern-window .window-fields .window-data:not(.window-embedded) > .modern-surface {background:transparent!important;}
/* the dialog's own caption names the DataWindow's field: the field's second caption is kept for assistive technology only */
.modern-window .window-data.window-data-captioned .surface-field > :is(.surface-label,.surface-required) {position:absolute!important;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.modern-window .window-fields.has-grid > .window-caption.window-caption-beside {padding-top:9px!important;}
.modern-window .window-fields .window-data:not(.window-embedded):not(.window-embedded *) > .modern-surface {border:0!important;box-shadow:none!important;}
/* its frame is as tall as its fields: stretched over the rows it shares, the frame's bottom edge ran through the next row's options */
.modern-window .window-fields.has-grid > .window-data:not(.window-embedded) {align-self:start;}
.modern-window .window-fields.has-grid > .window-caption-inline {align-self:start!important;z-index:2;pointer-events:none;padding-block:3px 0!important;white-space:nowrap;}
/* a command button among a dialog's fields keeps a button's height (it was stretched over the rows it shares) */
.modern-window .window-fields.has-grid > button.ctl.window-button:not(.window-embedded) {align-self:center!important;height:auto!important;max-height:44px;}
/* an option the source draws on a frame's edge covers the line behind its caption (as a caption on a group box does) */
.modern-window .window-fields.has-grid > .window-option {position:relative;z-index:2;}
.modern-window .window-fields.has-grid > .window-option > span {background:var(--p-surface);padding-inline:2px;}
/* list boxes: the chosen lines in the theme's selection colour (the browser's blue on grey text was unreadable) */
.modern-window select.ctl[multiple] option:checked,.modern-window select.ctl[size] option:checked {background:var(--p-selected) linear-gradient(0deg,var(--p-selected),var(--p-selected));color:var(--p-text);}
.modern-window select.ctl[multiple]:focus option:checked,.modern-window select.ctl[size]:focus option:checked {background:var(--p-accent) linear-gradient(0deg,var(--p-accent),var(--p-accent));color:var(--p-on-accent);-webkit-text-fill-color:var(--p-on-accent);font-weight:600;}
.modern-window select.ctl[multiple],.modern-window select.ctl[size] {scrollbar-width:thin;scrollbar-color:var(--p-faint) transparent;}
/* a field whose caption is hidden shows no lone required mark */
.modern-surface .surface-field > .surface-label.presentation-visually-hidden + .surface-required {display:none!important;}
/* the required mark of a grid heading keeps its place beside the caption (it wrapped under it in a narrow column) */
/* (the mark is drawn as part of the caption's last word, so it can neither wrap alone nor drift to the column's far edge) */
.modern-surface .surface-grid th > .surface-required::after {content:none;}
.modern-surface .surface-grid th > .surface-required {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.modern-surface .surface-grid th:has(> .surface-required) > span:first-child::after {content:" *";color:var(--p-danger);font-weight:700;text-transform:none;}
/* drop-down lists everywhere in the workspace share one arrow (some kept the browser's heavy native one) */
.presentation-ui :is(.modern-surface,.modern-window,.modern-entry-window) select:not([multiple]):not([size]):not(.window-embedded *) {appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a98a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 9px center!important;background-size:15px!important;padding-right:30px!important;}
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
/* a display-only edit (DisplayOnly = true: About's licence lines, totals shown in an edit) reads as text, not as a field to type in */
.modern-window :is(input:not([type=checkbox]):not([type=radio]),textarea).ctl[readonly] {background:var(--p-sunk)!important;border-color:var(--p-hair)!important;cursor:default;}
:is([data-theme=dark] .modern-window,.modern-window[data-theme=dark]) :is(input:not([type=checkbox]):not([type=radio]),textarea).ctl[readonly] {background:var(--p-canvas)!important;}
/* the accent ring is drawn by the shadow as well: on white the 4px glow alone read as no focus where a field's own border rule wins */
.modern-window :is(input,select,textarea).ctl:focus:not(.window-embedded *) {outline:none;border-color:var(--p-accent)!important;box-shadow:0 0 0 1px var(--p-accent),0 0 0 4px var(--p-glow);}
/* every form: a field's caption and its required mark share one line (a long caption wraps, the mark stays at its end) */
.modern-surface .surface-field:has(> .surface-label + .surface-required) {display:grid!important;grid-template-columns:minmax(0,max-content) minmax(0,1fr);align-items:end;column-gap:0;}
.modern-surface .surface-field:has(> .surface-label + .surface-required) > :not(.surface-label):not(.surface-required) {grid-column:1 / -1;}
.modern-surface .surface-field:has(> .surface-label + .surface-required) > .surface-required {justify-self:start;margin-block:0 4px;}
/* a dialog taller than the screen scrolls its content; its Ok / Cancel row stays in view at the bottom */
dialog .modern-window.pbwin > .client {flex:1 1 auto;min-height:0;overflow:auto!important;padding-bottom:0!important;}
dialog .modern-window.pbwin > .client > .window-actions {position:sticky;bottom:0;z-index:2;margin-inline:-20px;padding-inline:20px;background:var(--p-surface);border-top:1px solid var(--p-hair);}
/* a field labelled by a caption outside its DataWindow ("Format:" beside the format list) has no label of its own: its required
   mark is not drawn alone above it (it stays for assistive technology, the field keeps aria-required) */
.modern-window .surface-field:not(:has(> .surface-label)) > .surface-required {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
/* a DataWindow inside a groupbox: the groupbox is its frame, the panel draws no second border inside it */
.modern-window .window-fields.has-grid > .window-data[data-window-frame-member]:has(> .modern-surface) {border-color:transparent;}
/* a list box (ListBox / multi-select) shows its rows: it keeps a list's height, not a one-line field's */
.modern-window select.ctl:is([size]:not([size="0"]):not([size="1"]),[multiple]):not(.window-embedded *) {min-height:10em;padding:6px;}
.modern-window .window-list:has(> select.ctl) {display:flex;flex-direction:column;}
.modern-window .window-list > select.ctl:not(.window-embedded *) {flex:1 1 auto;}
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
/* the original's own icon keeps its meaning: amber for a warning, red for an error, blue for information */
.presentation-runtime-dialog .presentation-message-icon[data-severity=warning] svg {color:var(--p-warn);}
.presentation-runtime-dialog .presentation-message-icon[data-severity=error] svg {color:var(--p-danger);}
.presentation-runtime-dialog .presentation-message-icon[data-severity=information] svg {color:var(--p-info);}
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
/* message boxes on the sign-in screen (shown before the Modern shell exists, e.g. "Please enter password"): the approved dialog look */
body.ds-boot .modal-bg {background:var(--p-scrim);}
body.ds-boot .msgbox {background:var(--p-surface);color:var(--p-text);border:1px solid var(--p-hair);border-radius:14px;box-shadow:var(--p-shadow-lg);min-width:320px;font:400 14px/1.5 var(--p-font);animation:ds-pop .2s var(--p-ease);}
body.ds-boot .msgbox .tbar {background:transparent!important;height:auto;padding:16px 20px 0;color:var(--p-text);font:600 15px var(--p-font);}
body.ds-boot .msgbox .body {padding:12px 20px 18px;}
body.ds-boot .msgbox .btns {background:transparent;border-top:1px solid var(--p-hair);padding:12px 16px;}
body.ds-boot .msgbox button {min-width:88px;height:38px;border-radius:9px;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);font:500 14px var(--p-font);cursor:pointer;}
body.ds-boot .msgbox button:first-child {background:linear-gradient(180deg,var(--p-accent-2),var(--p-accent));border-color:var(--p-accent);color:var(--p-on-accent);}
body.ds-boot .msgbox button:focus-visible {outline:2.5px solid var(--p-accent);outline-offset:2px;}
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
/* captions the source draws large keep their rank: a heading (About's WASEELA) and a subheading (Abuzar Consultancy) */
.modern-window .ctl.st.window-caption.window-caption-heading {font:700 30px/1.15 var(--p-font)!important;color:var(--p-text)!important;letter-spacing:.02em;}
.modern-window .ctl.st.window-caption.window-caption-subheading {font:700 19px/1.25 var(--p-font)!important;color:var(--p-text)!important;}
/* Session Monitor: the source's one-line options band (Maximum Users Allowed / Refresh after every n Seconds) is drawn as a Modern form
   (label above its field, spin buttons): it keeps its own height at the bottom of the page and the list takes the rest */
.pbwin[data-win=w_connectionmonitor] .page > .ctl:has(.surface-spin-controls) {top:auto!important;bottom:0!important;height:auto!important;min-height:112px;overflow:visible!important;}
.pbwin[data-win=w_connectionmonitor] .page > .ctl.raised:not(.hidden):not(:has(.surface-spin-controls)) {height:calc(100% - 120px)!important;}
`
