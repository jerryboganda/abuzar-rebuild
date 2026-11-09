export const PRESENTATION_CSS = `
.presentation-ui,.presentation-settings,.modern-surface,.modern-window,.modern-entry-window {
  --p-surface:#fff;--p-canvas:#f3f5f8;--p-rail:#edf1f6;--p-text:#192432;
  --p-muted:#4c5d70;--p-line:#7d8c9d;--p-accent:#095ac6;--p-on-accent:#fff;
  --p-selected:#e3edfc;--p-danger:#b51c2b;--p-scale:1;
  color-scheme:light;color:var(--p-text);font:calc(14px * var(--p-scale))/1.5 "Segoe UI",Tahoma,Arial,sans-serif;
}
.presentation-ui[data-theme=dark],.presentation-settings[data-theme=dark],.modern-surface[data-theme=dark],.modern-window[data-theme=dark],.modern-entry-window[data-theme=dark] {
  color-scheme:dark;--p-surface:#202630;--p-canvas:#171d25;--p-rail:#1b222c;--p-text:#edf2f9;
  --p-muted:#b3c0d0;--p-line:#7a8a9e;--p-accent:#9cc9ff;--p-on-accent:#10243b;
  --p-selected:#293d59;--p-danger:#ffb5bd;
}
.presentation-ui {position:absolute;inset:0;display:grid;grid-template-columns:220px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);background:var(--p-surface);}
.presentation-header {grid-column:1/-1;display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:10px 18px;border-bottom:1px solid var(--p-line);}
.presentation-header strong {font-weight:650;}
.presentation-header span {color:var(--p-muted);flex:1;font-size:.86em;}
.presentation-sidebar {background:var(--p-rail);padding:14px;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:10px;}
.presentation-sidebar label {display:block;font-weight:600;}
.presentation-sidebar input {width:100%;margin-top:6px;min-width:0;}
.presentation-sidebar p {margin:0;color:var(--p-muted);font-size:.86em;}
.presentation-commands {display:flex;flex-direction:column;gap:5px;}
.presentation-command {text-align:left;overflow-wrap:anywhere;}
.presentation-command .command-shortcut {float:right;padding-inline-start:12px;color:var(--p-muted);}
.presentation-command:disabled .command-shortcut {color:inherit;}
.presentation-module {display:flex;flex-direction:column;gap:5px;}
.presentation-module > summary {cursor:pointer;min-height:32px;padding:5px 10px;font-weight:600;overflow-wrap:anywhere;}
.presentation-module > summary:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
.presentation-module[open] > .presentation-command {margin-block-start:5px;}
.presentation-work {display:flex;flex-direction:column;min-width:0;min-height:0;}
.presentation-tabs {display:flex;gap:4px;padding:8px 12px 0;background:var(--p-rail);overflow-x:auto;min-height:42px;}
.presentation-tab {display:flex;align-items:center;flex:none;}
.presentation-tab>[role=tab] {border-radius:5px 0 0 0;white-space:nowrap;border-bottom:0;}
.presentation-tab>[aria-selected=true] {background:var(--p-surface);box-shadow:inset 0 2px var(--p-accent);}
.presentation-tab>button:last-child {min-width:30px;border-radius:0 5px 0 0;border-bottom:0;padding:4px;}
.presentation-compatibility {margin:0;padding:5px 14px;background:var(--p-canvas);color:var(--p-muted);font-size:.86em;}
.presentation-stage {position:relative;flex:1;min-height:0;min-width:0;color-scheme:light;color:#000;font:var(--font);}
.presentation-stage [hidden] {display:none!important;}
.keyboard-tabs>.strip {height:28px;overflow-x:auto;overflow-y:hidden;}
.keyboard-tabs>.strip>.t {flex:none;min-height:28px;cursor:pointer;}
.keyboard-tabs>.strip>.t:focus-visible {outline:2px solid currentColor;outline-offset:-3px;}
.keyboard-tabs>.strip>.t[aria-disabled=true] {cursor:default;}
.keyboard-tabs>.page {top:28px;}
.keyboard-tabs>.page:focus-visible {outline:2px solid currentColor;outline-offset:-3px;}
.presentation-ui .presentation-action,.presentation-settings button,.presentation-settings select,
.presentation-ui .presentation-sidebar input,.presentation-ui .presentation-command,.presentation-ui .presentation-tab button {
  font:inherit;min-height:32px;border:1px solid var(--p-line);border-radius:4px;padding:5px 10px;
  background:var(--p-surface);color:var(--p-text);cursor:pointer;
}
.presentation-ui[data-density=comfortable] .presentation-action,
.presentation-ui[data-density=comfortable] .presentation-command,
.presentation-settings[data-density=comfortable] button {min-height:42px;}
.presentation-ui .presentation-action:hover,.presentation-command:hover,.presentation-settings button:hover {background:var(--p-selected);}
.presentation-ui .presentation-action:focus-visible,.presentation-sidebar :focus-visible,
.presentation-tab button:focus-visible,.presentation-settings :focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
.presentation-settings {width:min(650px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;border:1px solid var(--p-line);border-radius:8px;padding:24px;background:var(--p-surface);box-shadow:0 8px 28px #00000040;}
.presentation-settings fieldset {min-width:0;margin:16px 0;padding:12px 14px;border:1px solid var(--p-line);border-radius:6px;}
.presentation-settings legend {padding:0 6px;font-weight:650;}
.presentation-print-families p {margin:6px 0;color:var(--p-muted);font-size:.9em;}
.presentation-print-families .print-family {display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,auto);gap:8px 12px;align-items:center;margin-top:10px;}
.presentation-print-families .print-family label {font-weight:600;overflow-wrap:anywhere;}
.presentation-print-families .print-family select {min-width:0;}
.presentation-print-families .print-family p {grid-column:1/-1;margin:0;}
@media (max-width:520px) {.presentation-print-families .print-family {grid-template-columns:minmax(0,1fr);}}
.presentation-settings::backdrop {background:#0c192b70;}
.presentation-compatibility-dialog {position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden;color-scheme:light;color:#000;font:var(--font);}
.presentation-compatibility-dialog::backdrop {background:#0c192b70;}
.presentation-modern-dialog[open] {display:grid;place-items:center;padding:16px;}
.modern-window.pbwin {position:relative!important;inset:auto!important;width:min(34em,100%)!important;height:auto!important;max-height:100%;min-height:0;border:1px solid var(--p-line);border-radius:8px;overflow:auto;background:var(--p-surface);box-shadow:0 8px 28px #00000040;}
.modern-window.pbwin>.tbar {height:auto;flex:none;padding:12px 16px;gap:12px;background:var(--p-surface);color:var(--p-text);align-items:flex-start;}
.modern-window .tbar .ic {display:none;}
.modern-window .tbar .ttl {font-size:1.35em;line-height:1.25;font-weight:650;white-space:normal;overflow-wrap:anywhere;align-self:center;}
.modern-window.window-untitled>.tbar {position:absolute;top:0;right:0;padding:12px 16px 0;}
.modern-window.window-untitled .ttl {display:none;}
.modern-window.window-untitled>.client {padding-top:20px;}
.modern-window.window-untitled .window-field:first-child label {min-height:calc(1em + 12px);padding-right:calc(2em + 20px);}
.modern-window .tbar .cls {flex:none;min-width:32px;min-height:32px;width:auto;height:auto;font:inherit;padding:0 8px;color:var(--p-text);border:1px solid var(--p-line);border-radius:4px;background:var(--p-surface);cursor:pointer;}
.modern-window>.client {position:static;flex:none;overflow:visible;background:var(--p-surface)!important;padding:4px 20px 20px;}
.modern-window .window-fields {display:grid;gap:16px;}
.modern-window .window-field {display:grid;gap:6px;min-width:0;align-content:start;}
.modern-window .window-fields.has-grid {grid-template-columns:var(--grid-columns);grid-template-rows:var(--grid-rows);column-gap:0;row-gap:0;align-items:stretch;}
.modern-window .window-fields.has-grid > .grid-cell {padding:3px 8px;min-width:0;}
@media (max-width:520px) {
  .modern-window .window-fields.has-grid {grid-template-columns:minmax(0,1fr);grid-template-rows:none;row-gap:12px;}
  .modern-window .window-fields.has-grid > * {grid-column:auto!important;grid-row:auto!important;}
}
.modern-window .window-field:has(>input.hidden):has(>label>.hidden),.modern-window .window-field>label:has(>.hidden) {display:none;}
.modern-window .window-frame {min-width:0;border:0;margin:0;padding:0;background:transparent!important;color:var(--p-text)!important;}
/* A groupbox drawn over the area its members occupy on the grid: behind them, its caption on its top band, never taking a click. */
.modern-window .window-fields.has-grid > .window-frame-area {z-index:0;pointer-events:none;align-self:stretch;height:100%!important;box-sizing:border-box;border:1px solid var(--p-line)!important;border-radius:6px;margin:0 2px;padding:0 8px;}
.modern-window .window-fields.has-grid > .window-frame-area > legend {padding:0 4px;}
.modern-window .window-fields.has-grid > .grid-cell:not(.window-frame-area) {z-index:1;}
@media (max-width:520px) {.modern-window .window-fields.has-grid > .window-frame-area {border-width:0 0 1px!important;border-radius:0;margin:0;padding:0;}}
.modern-window .window-frame legend {padding:0;white-space:normal;overflow-wrap:anywhere;font-weight:600;color:var(--p-text)!important;background:transparent!important;}
.modern-window .window-list {display:grid;gap:6px;min-width:0;align-content:start;}
.modern-window .window-list select.ctl {min-width:0;min-height:10em;padding:6px;background:var(--p-surface)!important;border:1px solid var(--p-line)!important;border-radius:4px;}
/* A container or rich control kept as its original element (a tab control with its pages) scrolls inside the dialog instead of widening it. */
/* The container takes its cell's width (its source width would widen the dialog past a narrow screen) and keeps its own height; its
   children keep their Classic positions inside it and scroll there. */
.modern-window .window-embedded {position:relative!important;left:auto!important;top:auto!important;width:100%!important;max-width:100%;min-width:0;}
/* Only a container (tab control, user object) scrolls; a link or text control never becomes a scroll region a keyboard cannot reach. */
.modern-window .window-embedded[data-embedded-scroll] {max-height:calc(100vh - 14em);overflow:auto;}
.modern-window .window-caption {white-space:normal;overflow-wrap:anywhere;background:transparent!important;color:var(--p-text)!important;}
.modern-window .window-option {display:flex;align-items:center!important;gap:8px;min-height:36px;padding:6px 0!important;white-space:normal;overflow-wrap:anywhere;background:transparent!important;color:var(--p-text)!important;}
.modern-window .window-option input {flex:none;accent-color:var(--p-accent);}
.modern-window .window-option span {outline:none!important;}
.modern-window .window-option:has(input:focus-visible) {outline:2px solid var(--p-accent);outline-offset:2px;}
.modern-window[data-density=comfortable] .window-option {min-height:42px;}
/* Reflowed controls only: a container kept as its original element (a tab control, an embedded DataWindow) keeps its own size and its
   children keep their Classic positions and colours inside it. */
.modern-window .ctl:not(.window-embedded):not(.window-embedded *) {position:static!important;inset:auto!important;width:100%!important;height:auto!important;font:inherit!important;color:var(--p-text)!important;}
/* A DataWindow host stays the containing block of its view: a view that falls back to Classic rendering (no surface for a dataobject a
   script assigns, print preview) is positioned inside its box, never over the dialog. */
.modern-window .ctl.window-data:not(.window-embedded):not(.window-embedded *) {position:relative!important;}
/* Artwork (a picture, a colour key, a progress bar) keeps its source size, never wider than its cell. */
.modern-window .ctl.window-artwork:not(.window-embedded):not(.window-embedded *) {width:min(var(--artwork-width,100%),100%)!important;height:var(--artwork-height,auto)!important;overflow:hidden;}
/* A command button placed among the content (a "...." picker beside its option) is a Modern button at its natural width. */
.modern-window button.ctl.window-button:not(.window-embedded *) {width:auto!important;max-width:100%;justify-self:start;min-height:36px;padding:6px 14px;border:1px solid var(--p-line)!important;border-radius:4px;background:var(--p-surface)!important;color:var(--p-text)!important;cursor:pointer;}
.modern-window button.ctl.window-button:hover:not(:disabled):not(.window-embedded *) {background:var(--p-selected)!important;}
/* disabled and default states win over the reflow colours above */
.modern-window :is(input,textarea,select,button).ctl:disabled:not(.window-embedded *) {background:var(--p-canvas)!important;color:var(--p-muted)!important;cursor:default;}
.modern-window .window-actions button.ctl.default:not(:disabled):not(.window-embedded *) {color:var(--p-on-accent)!important;}
.modern-calendar-window.pbwin {width:min(27em,100%)!important;}
.modern-calendar-window>.client {padding-inline:8px;}
@media (max-width:400px) {.presentation-modern-dialog[open]:has(>.modern-calendar-window) {padding-inline:4px;}}
.modern-window .pb-calendar {width:100%!important;min-width:0;padding:4px;background:var(--p-surface)!important;border-color:var(--p-line);}
.modern-window .pb-calendar button,.modern-window .pb-calendar td,.modern-window .pb-calendar th {min-height:36px;font:inherit;}
.modern-window .pb-calendar td,.modern-window .pb-calendar th {height:2em;padding:3px 0;}
.modern-window .pb-calendar [aria-selected=true] {background:var(--p-accent);color:var(--p-on-accent);}
.modern-window .pb-calendar .calendar-trailing {color:var(--p-muted);}
.modern-window .pb-calendar .calendar-trailing[aria-selected=true] {color:var(--p-on-accent);}
.modern-window .pb-calendar button:hover:not(:disabled),.modern-window .pb-calendar [role=gridcell]:hover:not([aria-disabled=true]) {background:var(--p-selected);color:var(--p-text);}
.modern-window .pb-calendar [aria-selected=true]:focus-visible {outline-color:var(--p-on-accent);}
.modern-window .pb-calendar [aria-disabled=true] {color:var(--p-muted);}
.modern-window .window-field label .ctl {display:block;white-space:normal;overflow-wrap:anywhere;background:transparent!important;color:var(--p-text)!important;font-weight:600!important;text-align:left!important;}
.modern-window input.ctl:not(.window-embedded *) {min-width:0;min-height:36px;padding:6px 10px;background:var(--p-surface)!important;border:1px solid var(--p-line)!important;border-radius:4px;}
.modern-window .window-actions {display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:24px;}
.modern-window .window-actions button {width:auto!important;min-width:6em;min-height:36px;padding:6px 14px;border:1px solid var(--p-line);background:var(--p-surface);cursor:pointer;}
.modern-window .window-actions button.default {background:var(--p-accent);color:var(--p-on-accent)!important;}
.modern-window .window-actions button:hover:not(:disabled),.modern-window .tbar .cls:hover {background:var(--p-selected);}
.modern-window .window-actions button.default:hover:not(:disabled) {background:var(--p-accent);text-decoration:underline;}
.modern-window button:disabled,.modern-window input:disabled,.modern-window select:disabled {background:var(--p-canvas)!important;color:var(--p-muted)!important;cursor:default;}
.modern-window[data-density=comfortable] input.ctl:not(.window-embedded *),.modern-window[data-density=comfortable] button {min-height:42px;}
.modern-window :focus-visible,.modern-window .ctl:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
.modern-data-window.pbwin {width:min(58em,100%)!important;}
.modern-data-window.window-untitled>.tbar {position:static;justify-content:flex-end;}
.modern-data-window.window-untitled>.client {padding-top:12px;}
.modern-window .window-data {position:relative!important;min-width:0;border:1px solid var(--p-line);border-radius:4px;overflow:hidden;}
.modern-window .window-data>.modern-surface {position:relative;inset:auto;min-height:6em;}
.modern-window .window-data:has(>.dw:not(.modern-surface)) {height:20em!important;}
.modern-window .window-data>.dw:not(.modern-surface) {font:var(--font);color:#000;color-scheme:light;}
.modern-entry-window.pbwin {inset:0!important;width:100%!important;height:100%!important;min-width:0;min-height:0;border:0;background:var(--p-surface);}
.modern-entry-window>.tbar {height:auto;min-height:32px;flex:none;background:var(--p-surface);color:var(--p-text);padding:4px 12px;}
.modern-entry-window>.tbar .ttl {font:inherit;font-weight:600;white-space:normal;overflow-wrap:anywhere;}
.modern-entry-window>.client {background:var(--p-surface)!important;overflow:auto;padding:12px;min-height:0;}
.modern-entry-window .entry-control {position:relative!important;inset:auto!important;width:100%!important;height:auto!important;min-width:0;font:inherit!important;color:var(--p-text)!important;background:transparent!important;}
/* an extra DataWindow placed as a plain control (a detail list whose height a script sets) keeps a visible box, as in Classic */
.modern-entry-window .entry-extras>.entry-control:has(>.dw:not(.modern-surface)) {min-height:10em;}
.modern-entry-window .entry-tabs>.strip {height:auto;min-height:36px;gap:8px;border-bottom:1px solid var(--p-line);}
.modern-entry-window .entry-tabs>.strip>.t {font:inherit;padding:8px 16px;margin:0;background:var(--p-canvas);border:1px solid var(--p-line);white-space:normal;min-width:5em;justify-content:center;}
.modern-entry-window .entry-tabs>.strip>.t.on {background:var(--p-selected);outline:none;border-bottom:3px solid var(--p-accent);}
.modern-entry-window .entry-tabs>.strip>.t:focus-visible {outline:2px solid var(--p-accent);outline-offset:-3px;}
.modern-entry-window .entry-tabs>.strip>.t[aria-disabled=true] {color:var(--p-muted);}
.modern-entry-window .entry-tabs>.page {position:static;inset:auto;border:0;background:var(--p-surface);padding-top:16px;}
.modern-entry-window .entry-detail,.modern-entry-window .entry-list {display:grid;gap:20px;min-width:0;}
.modern-entry-window .entry-data {border:1px solid var(--p-line);border-radius:4px;overflow:hidden;}
.modern-entry-window .entry-form>.modern-surface {position:relative;inset:auto;min-height:6em;}
.modern-entry-window .entry-form:has(>.dw:not(.modern-surface)) {height:9em!important;}
.modern-entry-window .entry-grid,.modern-entry-window .entry-auxiliary {height:clamp(14em,42vh,26em)!important;}
.modern-entry-window .entry-data>.dw:not(.modern-surface) {font:var(--font);color:#000;color-scheme:light;}
.modern-entry-window .entry-extras {display:grid;gap:12px;margin-top:12px;}
.modern-entry-window .entry-extras.has-grid {grid-template-columns:var(--grid-columns);grid-template-rows:var(--grid-rows);column-gap:0;row-gap:0;align-items:stretch;}
.modern-entry-window .entry-extras.has-grid > .grid-cell {padding:3px 8px;min-width:0;}
@media (max-width:520px) {.modern-entry-window .entry-extras.has-grid {grid-template-columns:minmax(0,1fr);grid-template-rows:none;row-gap:12px;} .modern-entry-window .entry-extras.has-grid > * {grid-column:auto!important;grid-row:auto!important;}}
.modern-entry-window .entry-criteria {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,23em),1fr));gap:24px;}
.modern-entry-window .entry-criteria-group {display:grid;align-content:start;gap:10px;min-width:0;}
.modern-entry-window .entry-caption {border:0;padding:0;margin:0;font-weight:600!important;}
.modern-entry-window .entry-caption legend {padding:0;white-space:normal;overflow-wrap:anywhere;}
.modern-entry-window .entry-order,.modern-entry-window .entry-filter-actions {display:flex;flex-wrap:wrap;align-items:center;gap:12px;}
.modern-entry-window .entry-order .entry-control {display:flex;align-items:center;gap:8px;width:auto!important;min-height:32px;}
.modern-entry-window .entry-order input {width:18px;height:18px;flex:none;accent-color:var(--p-accent);}
.modern-entry-window .entry-order input:focus {outline:2px solid var(--p-accent)!important;outline-offset:2px!important;}
.modern-entry-window .entry-order input:focus+span {outline:none!important;}
.modern-entry-window .entry-filter-fields {display:grid;grid-template-columns:minmax(0,1fr) minmax(5em,.6fr) minmax(0,1fr);gap:8px;}
.modern-entry-window select.entry-control,.modern-entry-window button.entry-control {background:var(--p-surface)!important;border:1px solid var(--p-line);border-radius:4px;min-height:36px;padding:6px 10px;}
.modern-entry-window button.entry-control {width:auto!important;min-width:6em;cursor:pointer;}
.modern-entry-window button.entry-control:hover:not(:disabled) {background:var(--p-selected)!important;}
.modern-entry-window .pb-dropdown>.dropdown-input,.modern-entry-window .pb-dropdown>.dropdown-select,.modern-entry-window .pb-dropdown>.dropdown-toggle {height:auto;min-height:36px;font:inherit;background:var(--p-surface);color:var(--p-text);border-color:var(--p-line);border-radius:4px;padding:6px 10px;}
.modern-entry-window .pb-dropdown>.dropdown-input {border-start-end-radius:0;border-end-end-radius:0;}
.modern-entry-window .pb-dropdown>.dropdown-toggle {width:2em;border-start-start-radius:0;border-end-start-radius:0;padding:0;}
.modern-entry-window .pb-dropdown>.dropdown-toggle:hover:not(:disabled) {background:var(--p-selected);}
.modern-entry-window .pb-dropdown .dropdown-list {background:var(--p-surface);color:var(--p-text);border-color:var(--p-line);}
.modern-entry-window .pb-dropdown .dropdown-list [role=option] {padding:6px 10px;min-height:36px;}
.modern-entry-window .pb-dropdown .dropdown-list [aria-selected=true] {background:var(--p-selected);color:var(--p-text);outline:2px solid var(--p-accent);outline-offset:-2px;}
.modern-entry-window .pb-dropdown :disabled {color:var(--p-muted);background:var(--p-canvas);}
.modern-entry-window[data-density=comfortable] .pb-dropdown>.dropdown-input,.modern-entry-window[data-density=comfortable] .pb-dropdown>.dropdown-select,.modern-entry-window[data-density=comfortable] .pb-dropdown>.dropdown-toggle {min-height:42px;}
@media(forced-colors:active) {.modern-entry-window .pb-dropdown .dropdown-list [aria-selected=true] {background:Highlight;color:HighlightText;outline-color:HighlightText;}}
/* The same Modern drop-down colours in dialogs (the reflow colours its text; its Classic white field would make it unreadable in the
   dark theme).  A container kept as its original element keeps its Classic colours. */
.modern-window .pb-dropdown:not(.window-embedded *)>:is(.dropdown-input,.dropdown-select,.dropdown-toggle) {background:var(--p-surface);color:var(--p-text);border-color:var(--p-line);}
.modern-window .pb-dropdown:not(.window-embedded *)>.dropdown-toggle:hover:not(:disabled) {background:var(--p-selected);}
.modern-window .pb-dropdown:not(.window-embedded *) .dropdown-list {background:var(--p-surface);color:var(--p-text);border-color:var(--p-line);}
.modern-window .pb-dropdown:not(.window-embedded *) .dropdown-list [aria-selected=true] {background:var(--p-selected);color:var(--p-text);outline:2px solid var(--p-accent);outline-offset:-2px;}
.modern-window .pb-dropdown:not(.window-embedded *) :disabled {color:var(--p-muted);background:var(--p-canvas);}
.modern-entry-window .entry-control:disabled {background:var(--p-canvas)!important;color:var(--p-muted)!important;}
.modern-entry-window .entry-search {display:grid;gap:6px;max-width:52em;min-width:0;}
.modern-entry-window .entry-search .st {white-space:normal;line-height:1.5!important;overflow-wrap:anywhere;}
.modern-entry-window .entry-search .st:first-child {font-weight:600!important;}
.modern-entry-window .entry-search .st:not(:first-child) {color:var(--p-muted)!important;font-size:.9em!important;}
.modern-entry-window .entry-decoration {height:0!important;overflow:hidden;pointer-events:none;}
.modern-entry-window[data-density=comfortable] select.entry-control,.modern-entry-window[data-density=comfortable] button.entry-control,.modern-entry-window[data-density=comfortable] .entry-order .entry-control {min-height:42px;}
.modern-entry-window :focus-visible {outline:2px solid var(--p-accent);outline-offset:-2px;}
.modern-entry-window [tabindex],.modern-entry-window input,.modern-entry-window select,.modern-entry-window button {scroll-margin:12px;}
.modern-entry-window .surface-grid [tabindex] {scroll-margin:0;}
@container (max-width:32em) {.modern-entry-window .entry-filter-fields {grid-template-columns:minmax(0,1fr);}}
.modern-entry-window>.client {container-type:inline-size;}
.presentation-settings h2 {margin:0 0 8px;font-size:1.5em;overflow-wrap:anywhere;}
.presentation-settings p {color:var(--p-muted);margin:0 0 16px;}
.presentation-settings .presentation-copy {white-space:pre-wrap;overflow-wrap:anywhere;}
.presentation-message-icon {display:inline-flex;align-items:center;margin-right:.4em;vertical-align:middle;}
.presentation-message-icon svg {width:1em;height:1em;}
.presentation-visually-hidden {position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
.presentation-settings input {font:inherit;min-width:0;width:100%;min-height:32px;padding:5px 8px;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);}
.presentation-settings label {display:flex;justify-content:space-between;align-items:center;gap:16px;margin:16px 0;font-weight:600;}
.presentation-settings select {width:13em;max-width:100%;font-weight:400;}
.presentation-settings .presentation-error {color:var(--p-danger);}
.presentation-settings footer {display:flex;flex-wrap:wrap;justify-content:end;gap:8px;margin-top:22px;}
.presentation-settings button[type=submit] {background:var(--p-accent);color:var(--p-on-accent);}
.presentation-lookup {width:min(72em,calc(100vw - 32px));box-sizing:border-box;}
.presentation-lookup .lookup-search {display:grid;gap:6px;}
.presentation-lookup .lookup-search input {font-weight:400;}
.presentation-lookup .lookup-status {margin-bottom:8px;}
.presentation-lookup .lookup-grid-wrap {container-type:inline-size;max-height:45vh;overflow:auto;border:1px solid var(--p-line);}
.presentation-lookup table {border-spacing:0;min-width:100%;width:max-content;}
.presentation-lookup th {position:sticky;top:0;z-index:1;padding:8px 12px;text-align:start;background:var(--p-rail);border-bottom:1px solid var(--p-line);max-width:100cqi;overflow-wrap:anywhere;}
.presentation-lookup td {padding:0;border-bottom:1px solid var(--p-line);cursor:pointer;}
.presentation-lookup td>span {display:block;padding:8px 12px;min-width:min(8em,100cqi);max-width:min(22em,100cqi);min-height:2.5em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
.presentation-lookup[data-density=comfortable] td>span {min-height:3em;}
.presentation-lookup .lookup-number {text-align:end;font-variant-numeric:tabular-nums;}
.presentation-lookup tr[aria-selected=true] {background:var(--p-selected);}
.presentation-lookup td:focus {outline:2px solid var(--p-accent);outline-offset:-2px;}
.presentation-lookup .lookup-details {margin-top:16px;}
.presentation-lookup summary {cursor:pointer;font-weight:600;overflow-wrap:anywhere;}
.presentation-lookup dl {margin:12px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14em),1fr));gap:6px 16px;}
.presentation-lookup dl>div {min-width:0;}
.presentation-lookup dt {font-weight:600;}
.presentation-lookup dd {margin:0;white-space:pre-wrap;overflow-wrap:anywhere;}
.presentation-lookup .lookup-pages {display:flex;flex-wrap:wrap;gap:8px;margin-inline-end:auto;}
.presentation-lookup button {overflow-wrap:anywhere;max-width:100%;}
.presentation-lookup button:disabled {background:var(--p-canvas);color:var(--p-muted);cursor:default;}
.presentation-lookup .lookup-select:not(:disabled) {background:var(--p-accent);color:var(--p-on-accent);}
.presentation-lookup .lookup-select:hover:not(:disabled) {text-decoration:underline;}
@media(forced-colors:active) {.presentation-lookup tr[aria-selected=true] {background:Highlight;color:HighlightText;}.presentation-lookup td:focus {outline-color:HighlightText;}}
.appearance-trigger {margin-left:auto!important;padding:2px 8px!important;cursor:pointer;}
.modern-surface {background:var(--p-surface)!important;color:var(--p-text);container-type:inline-size;}
.modern-surface .surface-status {position:sticky;left:0;width:100cqi;max-width:100%;padding:8px 12px;margin:0;color:var(--p-muted);overflow-wrap:anywhere;}
.modern-surface .surface-empty {padding:20px;margin:0;color:var(--p-muted);}
.modern-surface .surface-grid {border-spacing:0;min-width:100%;width:max-content;}
.modern-surface th {position:sticky;top:0;z-index:2;padding:8px 12px;text-align:left;background:var(--p-rail);border-bottom:1px solid var(--p-line);font-weight:600;max-width:100cqi;overflow-wrap:anywhere;}
.modern-surface .surface-header-flow th {position:static;}
.modern-surface td {padding:0;border-bottom:1px solid var(--p-line);}
.modern-surface .surface-value {position:relative;min-width:min(8em,100cqi);min-height:var(--surface-row-height);padding:6px 12px;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(34em,100cqi);}
.modern-surface td .surface-value {height:calc(var(--surface-row-height) - 1px);min-height:0;}
.modern-surface td .surface-multiline {white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;text-overflow:clip;}
.modern-surface .surface-number {text-align:right;font-variant-numeric:tabular-nums;}
.modern-surface .surface-spinner,.modern-surface .surface-spin-heading {padding-right:calc(4em + 12px);}
.modern-surface .surface-spinner {min-width:calc(9em + 8px);isolation:isolate;}
.modern-surface .surface-spin-controls {position:absolute;inset:0 2px 0 auto;z-index:2;display:flex;gap:2px;}
.modern-surface .surface-spin-controls button {width:2em;min-width:24px;min-height:24px;padding:0 4px;line-height:1;border:1px solid var(--p-line);border-radius:0;background:var(--p-rail);color:var(--p-text);font:inherit;cursor:pointer;}
.modern-surface .surface-spin-controls button:hover:not(:disabled) {background:var(--p-selected);}
.modern-surface .surface-spin-controls button:disabled {color:var(--p-muted);cursor:default;}
.modern-surface .surface-spin-controls svg {display:block;width:1em;height:1em;margin:auto;}
.modern-surface .surface-spinner .surface-editor {z-index:1;padding-right:calc(4em + 12px);}
.modern-surface .surface-grid .cur {background:var(--p-selected);}
.modern-surface .surface-grid .cur .surface-value {background:var(--p-selected);}
.modern-surface .row.sel {background:var(--p-accent);}
.modern-surface .row.sel .surface-value {background:var(--p-accent);}
.modern-surface .row.sel .o {color:var(--p-on-accent)!important;}
.modern-surface .surface-spacer {padding:0;border:0;}
.modern-surface .surface-body-grid {width:max-content;min-width:100%;}
.modern-surface .surface-body-with-footer {display:flex;flex-direction:column;min-height:100%;}
.modern-surface .surface-body-with-footer > * {flex-shrink:0;}
.modern-surface .surface-band {position:sticky;left:0;width:100cqi;max-width:100%;padding:10px 12px;border-top:1px solid var(--p-line);background:var(--p-canvas);color:var(--p-text);}
.modern-surface .surface-band-footer {bottom:0;z-index:2;margin-top:auto;}
.modern-surface .surface-band-flow {bottom:auto;}
.modern-surface .surface-band dl {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16em),1fr));gap:12px;margin:0;}
.modern-surface .surface-band dl > div {display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;min-width:0;}
.modern-surface .surface-band dt {font-weight:600;overflow-wrap:anywhere;}
.modern-surface .surface-band dd {min-width:0;max-width:100%;margin:0;}
.modern-surface .surface-total-value {position:relative;font:inherit;line-height:1.5;overflow-wrap:anywhere;padding:2px;}
.modern-surface section.surface-row {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16em),1fr));gap:16px;padding:12px;}
.modern-surface .surface-group {grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16em),1fr));gap:16px;min-width:0;padding-block:12px;border-block-start:1px solid var(--p-line);}
.modern-surface section.surface-row.has-grid,.modern-surface .surface-group.has-grid {display:grid;grid-template-columns:var(--grid-columns);grid-template-rows:var(--grid-rows);column-gap:0;row-gap:0;align-items:stretch;}
.modern-surface .grid-cell.surface-field,.modern-surface .grid-cell.surface-caption,.modern-surface .grid-cell.surface-button {padding:3px 8px;min-width:0;}
.modern-surface .has-grid > .grid-cell.surface-group {min-width:0;}
@container (max-width:30em) {
  .modern-surface section.surface-row.has-grid,.modern-surface .surface-group.has-grid {grid-template-columns:minmax(0,1fr);grid-template-rows:none;row-gap:12px;}
  .modern-surface .grid-cell {grid-column:auto!important;grid-row:auto!important;}
}
.modern-surface .surface-group-caption {grid-column:1/-1;font-weight:650;overflow-wrap:anywhere;}
.modern-surface .surface-group-plain {border-color:transparent;}
.modern-surface .surface-caption {grid-column:1/-1;margin:0;overflow-wrap:anywhere;}
.modern-surface .surface-separator {grid-column:1/-1;width:100%;margin:0;border:0;border-block-start:1px solid var(--p-line);}
.modern-surface .surface-field {min-width:0;}
.modern-surface .surface-label {display:block;margin-bottom:6px;font-weight:600;overflow-wrap:anywhere;}
.modern-surface .surface-input-group {display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;}
.modern-surface .surface-input-group > .surface-value {flex:1 1 8em;}
.modern-surface .surface-suffix {max-width:100%;overflow-wrap:anywhere;}
.modern-surface .row.sel .surface-suffix {color:var(--p-on-accent);}
.modern-surface section .surface-value {min-width:0;max-width:none;border:1px solid var(--p-line);border-radius:4px;}
.modern-surface section .surface-multiline {height:calc(6em + 14px);white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;}
.modern-surface .surface-help,.modern-surface .surface-required {display:block;color:var(--p-muted);line-height:1.5;margin-block:4px;}
.modern-surface .surface-required {font-weight:400;}
.modern-surface .row.sel .surface-required {color:var(--p-on-accent);}
.modern-surface [aria-readonly=true] {background:var(--p-canvas);}
.modern-surface .surface-editor {position:absolute;inset:0;width:100%;height:100%;min-width:0;font:inherit;color:var(--p-text);background:var(--p-surface);border:1px solid var(--p-accent);padding:6px 12px;text-align:inherit;}
.modern-surface textarea.surface-editor {resize:none;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;}
.modern-surface .surface-multiline:has(textarea.surface-editor) {overflow:hidden;}
.modern-surface .surface-choice {padding-inline-end:2.2em;cursor:pointer;}
.modern-surface .surface-choice-arrow {position:absolute;inset-inline-end:.8em;top:50%;width:.45em;height:.45em;border-inline-end:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:translateY(-75%) rotate(45deg);pointer-events:none;}
.modern-surface .surface-radio {height:auto;min-height:var(--surface-row-height);white-space:normal;cursor:pointer;}
.modern-surface .surface-radio > .dw-radio-options {grid-template-columns:repeat(auto-fit,minmax(min(100%,12em),1fr));gap:8px;}
.modern-surface .surface-radio:has(fieldset.dw-radio-options) > span.dw-radio-options {display:none;}
.modern-surface fieldset.dw-radio-options.surface-editor {position:relative;inset:auto;width:100%;height:auto;padding:0;background:transparent;border:0;}
.modern-surface .dw-radio-option {gap:10px;min-height:32px;padding:4px 0;}
.modern-surface .dw-radio-option input,.modern-surface .dw-radio-marker {font:inherit;width:1.1em;height:1.1em;accent-color:var(--p-accent);}
.modern-surface fieldset.dw-radio-options input:focus-visible {outline:2px solid var(--p-accent);outline-offset:2px;}
.modern-surface .dw-radio-options:disabled {color:var(--p-muted);cursor:progress;}
.modern-surface select.surface-editor:disabled {color:var(--p-muted);background:var(--p-canvas);}
.modern-surface select.surface-editor[aria-busy=true] {cursor:progress;}
.modern-surface .surface-toggle {display:flex;align-items:center;gap:10px;cursor:pointer;}
.modern-surface .surface-toggle[aria-readonly=true] {cursor:default;}
.modern-surface .surface-toggle.dw-checkbox-left {white-space:normal;height:auto;min-height:var(--surface-row-height);}
.modern-surface .dw-checkbox-caption {min-width:0;overflow-wrap:anywhere;}
.modern-surface .surface-field:has(.dw-checkbox-left) > .surface-label {display:none;}
.modern-surface .surface-toggle .cbx {position:relative;width:1.25em;height:1.25em;border:1px solid var(--p-line);background:var(--p-surface);}
.modern-surface .surface-toggle .cbx.on {background:var(--p-accent);border-color:var(--p-accent);}
.modern-surface .surface-toggle .cbx.on::after {content:"";position:absolute;inset:15% 28% 25% 30%;border-inline-end:2px solid var(--p-on-accent);border-bottom:2px solid var(--p-on-accent);transform:rotate(45deg);}
.modern-surface .surface-toggle .cbx.mixed::after {content:"";position:absolute;inset:42% 18%;background:var(--p-text);}
.modern-surface .surface-toggle:has(input.surface-editor[type=checkbox]) .cbx {visibility:hidden;}
.modern-surface input.surface-editor[type=checkbox] {inset:0 auto 0 12px;width:1.25em;height:1.25em;margin-block:auto;padding:0;accent-color:var(--p-accent);}
.modern-surface input.surface-editor[type=checkbox]:focus-visible {outline-offset:2px;}
.modern-surface .dw-checkbox-left input.surface-editor[type=checkbox] {inset:0 12px 0 auto;}
@media(forced-colors:active) {.modern-surface .surface-toggle .cbx.on {background:Highlight;border-color:Highlight;}.modern-surface .surface-toggle .cbx.on::after {border-color:HighlightText;}}
.modern-surface .surface-choice-details select.surface-editor {width:calc(100% - 2.4em);inset-inline-end:2.4em;}
.modern-surface .dw-choice-browse {position:absolute;inset-block:0;inset-inline-end:0;width:2.4em;min-width:32px;min-height:32px;z-index:2;padding:0 4px;font:inherit;border:1px solid var(--p-line);background:var(--p-rail);color:var(--p-text);cursor:pointer;}
.modern-surface .dw-choice-browse:hover:not(:disabled) {background:var(--p-selected);}
.modern-surface .dw-choice-browse:disabled {background:var(--p-canvas);color:var(--p-muted);cursor:default;}
.modern-surface input.surface-editor[role=combobox] {padding-inline-end:2.6em;text-align:start;}
.modern-surface input.surface-editor.dw-choice-automatic[role=combobox] {padding-inline-end:10px;}
.modern-surface .dw-choice-toggle {position:absolute;inset-block:0;inset-inline-end:0;width:2.4em;min-width:24px;min-height:24px;z-index:2;font:inherit;border-color:var(--p-line);background:var(--p-rail);color:var(--p-text);}
.modern-surface .dw-choice-toggle:hover:not(:disabled) {background:var(--p-selected);}
.modern-surface .dw-choice-toggle:disabled {color:var(--p-muted);cursor:default;}
.modern-surface .surface-choice-details input.surface-editor[role=combobox] {padding-inline-end:5em;}
.modern-surface .surface-choice-details input.surface-editor.dw-choice-automatic[role=combobox] {padding-inline-end:2.6em;}
.modern-surface .surface-choice-details .dw-choice-toggle {inset-inline-end:2.4em;}
.modern-surface .dw-choice-popup {background:var(--p-surface);color:var(--p-text);border-color:var(--p-line);}
.modern-surface .dw-choice-popup [role=option] {padding:6px 10px;min-height:2em;}
.modern-surface .dw-choice-popup [aria-selected=true] {background:var(--p-selected);color:var(--p-text);outline:2px solid var(--p-accent);outline-offset:-2px;}
.modern-surface .dw-choice-popup [role=option]:hover {outline-color:var(--p-accent);}
@media(forced-colors:active) {.modern-surface .dw-choice-popup [aria-selected=true] {background:Highlight;color:HighlightText;outline-color:HighlightText;}}
.modern-surface :focus-visible {outline:2px solid var(--p-accent);outline-offset:-2px;}
.modern-surface .row.sel .surface-value:focus-visible {outline-color:var(--p-on-accent);}
.modern-surface [aria-invalid=true] {border-color:var(--p-danger);}
.modern-window .window-field input[aria-invalid=true] {border-color:var(--p-danger)!important;}
.modern-surface .surface-stale {padding:16px;color:var(--p-danger);}
.modern-surface .surface-stale label {display:block;color:var(--p-text);}
.modern-surface .surface-stale input,.modern-surface .surface-stale textarea,.modern-surface .surface-stale button {display:block;width:100%;font:inherit;margin:8px 0;padding:8px;border:1px solid var(--p-line);background:var(--p-surface);color:var(--p-text);}
.modern-surface .surface-stale textarea {resize:vertical;line-height:1.5;}
@media(max-width:850px) {
  .presentation-ui {grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(24em,1fr);overflow:auto;}
  .presentation-sidebar {max-height:180px;padding:8px 14px;}
  .presentation-commands {max-height:90px;overflow:auto;}
}
@media(max-width:480px) {.presentation-settings label {align-items:stretch;flex-direction:column;gap:6px;}.presentation-settings select{width:100%;}}
@media(forced-colors:active) {
  .presentation-tab>[aria-selected=true] {outline:2px solid Highlight;}
  .modern-surface .row.sel,.modern-surface .row.sel .surface-value {background:Highlight;}
  /* Suppress selection text backplates, but keep native editors on system colors. */
  .modern-surface .row.sel .surface-value {forced-color-adjust:none;border-color:HighlightText;}
  .modern-surface .row.sel .o {color:HighlightText!important;}
  .modern-surface .row.sel .surface-suffix {forced-color-adjust:none;color:HighlightText;}
  .modern-surface .row.sel .surface-value :is(.surface-editor,input,textarea,select,button,.dw-choice-popup,.surface-spin-controls) {forced-color-adjust:auto;}
  .presentation-lookup tr[aria-selected=true] {forced-color-adjust:none;}
  .presentation-lookup tr[aria-selected=true] td {border-color:HighlightText;}
  .modern-surface .surface-grid .cur:not(.sel) .surface-value:not(:focus-visible) {outline:1px dashed Highlight;outline-offset:-1px;}
  .modern-surface .row.sel .surface-value:focus-visible {outline-color:HighlightText;}
  .modern-surface .surface-toggle .cbx {background:Canvas;border-color:CanvasText;}
  .modern-surface .surface-toggle .cbx.mixed::after {background:CanvasText;}
  .modern-surface [aria-invalid=true] {border-color:CanvasText;border-style:dashed;}
  .modern-window .window-field input[aria-invalid=true] {border-color:CanvasText!important;border-style:dashed!important;}
  .modern-window .window-actions button.default:not(:disabled),
  .presentation-settings button[type=submit]:not(:disabled),
  .presentation-lookup .lookup-select:not(:disabled) {border:2px solid Highlight;}
}
`
