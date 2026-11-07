# Agent handoff (2026-11-06)

Everything a new coding agent (opencode or another) needs to continue this work without the previous conversation.
Read `CLAUDE.md` (rules), `README.md` (architecture), `docs/PARITY.md` (numbers), `docs/FIDELITY.md` (findings) and `docs/ROADMAP.md` first; this file is the state and the next steps.

**UI enhancement remains incomplete.** Cashier closing, multiple-invoice cash
tendering and category changes have scoped Modern modals and original-script synthetic coverage.
Real authorization and database acceptance remain outstanding. Current counts,
result paths and acceptance boundaries are maintained in
`UI-ENHANCEMENT.md` under **Current local evidence**; do not reuse older handoff
numbers as the latest result. The browser fixtures use synthetic records,
with backend/external requests and native desktop access forbidden.
It fixed source list ordering, Resource Category multiline, Grade decimal spin,
non-erasable constructor properties, keyboard-event typing and Classic
`aria-invalid` recovery. Real pointer tracing found two Modern cell handlers
toggling a checkbox twice; the shared renderer now owns the only click route.
Exact ItemChanged sequences cover F2/Space, field/marker clicks and return to
keyboard use. Grid cells no longer inherit the form scroll margin that obscured
full-width cells at 320px/200%. Lookup tests use real Tab traversal and correct
content-box bounds. Appearance settings preserve uppercase, unaccepted drafts.
Live TabSequence overrides still enable/disable the shared click route. Text
redraw restores focus with `preventScroll`, retaining user-positioned ancestors;
active multiline input and genuine form text-editor focus request post-paint
field visibility. Genuine form radio focus also reveals the complete option label
after painting; passive radio redraw retains scrolling. Grid, dropdown and checkbox
focus do not request extra editor redraws.
Browser checks cover typing after scrolling away and passive numeric/text
redraw preserving deliberate scrolling. A deterministic paused-paint regression exposed stale
grid focus restoration; the renderer now reads current focus just before DOM
replacement, preserving newer cell focus and respecting focus outside the grid.

Editable popup DDDWs now share a guarded display-text/key editor in both
presentations. `d_arg_manf` and `d_arg_manf2` are explicit Manufacturer form
mappings. Exact typed labels resolve before validation; explicit duplicate-row
selection keeps its own key. GetText/SetText, ordered EditChanged, source
keyboard/Enter continuations, IME, retry and stale recovery stay on the shared
runtime path. Typing limits cannot reject longer explicitly selected labels.
Case-insensitive source NULL initialization prevents numeric argument fields
from starting as NaN. The source-customer search routine runs against synthetic
child rows; source Enter/validation routes are controlled harnesses, not
accepted sales/purchase workflows.

The popup and input survive redraw independently of the child row. Classic
asynchronous row fill no longer closes a focused popup or reclaims newer
external focus. Real appearance checks now include the entire input/toggle
and host, not just the popup; a separate preview control/view avoids native
geometry overwriting narrow fixture bounds. Preview replacement and repeated
close release only the owned control/view. Large popups use bounded,
variable-height option windows and source-sized row budgets; full-set keyboard
navigation retains source indices. The loaded choice array remains O(N).

Twenty-seven criteria components now have explicit global mappings, bringing the
global registry to forty-seven. The criteria fixture seeds nine original child
definitions with synthetic rows and strips retrieval SQL. It covers readonly and
editable captions, duplicate-key selection, veto/retry, source-zero-TabSequence
dependencies, remarks limits/nulls and voucher/invoice order. Full child detail
grids and owning report workflows remain separate work.
Twenty-eight criteria owners now have complete mapped controls and original-script
synthetic coverage. Item/date/top-customer selection retains both selector
ancestors, alias procedure routing, sorted native selection, All, dates/count and
exact key/flag returns. The count guard deliberately excludes transient search
fields; all-items DataStore failure is visible and cancels. Native Sort resets
the current row without focus events, preserving the original removal routine.
Modern native controls keep a two-pixel themed focus outline while the concurrent
Classic focus rule remains unchanged. Current source-matched evidence and all
remaining release gates are in `UI-ENHANCEMENT.md`.
Numeric date-mask entry and initial editor text now use the same source order,
not the regional order beneath a day-first display. Unchanged date-only edits
preserve stored times; changing a mask while typing retains the draft for recovery.
Other temporal mask grammars retain the previous regional editor behavior and
still need separate native equivalence work.

Specified date, date-only and start/end date owners now retain every inherited
control, including the empty hidden customer buffer and source-specific date
visibility. The date-only Open still overrides the inherited preference with
today, as its source does. Native datetime GetData reuses strict masked parsing:
impossible dates/clocks return -1 without replacing the destination or text.
Scoped preflight guards validate every consumed date before any return-field
write. Rejection has focused feedback, `aria-invalid`, a themed error border and
a dashed system-color border. Successful conversion clears stale invalid state,
including after a mask-type change. Title-bar closing cannot reuse a previous
success. No date-range ordering or source-absent Escape shortcut is added.
The shared native KeyDown route now reaches original Enter/Handle/Send scripts;
plain-control navigation skips CSS-hidden and disabled fields and follows
positive-then-zero tab order. Source Enter navigation cannot also activate a
default button. Both-mode checks cover hidden/disabled navigation and a synthetic
default-button collision; real keyboard input covers correction, acceptance and
explicit Cancel. Calendar popups and full native mask equivalence remain open.

Fifteen additional single-lookup owners preserve their account/item/doctor/
godown/manufacturer/patient/region/zone/sales-person/subaccount/supplier/user/
customer-group bindings. Their selectors are context-local; the existing global
manufacturer surface is reused, and the single-zone owner does not inherit a
top-customer count buffer. Original external captions remain live accessible
labels. Source editability, automatic subaccount list, width/row budgets,
hidden dates and the supplier-label visible All option are retained.
Suppression/hide return fields are Boolean despite their `i_` prefixes.
Untouched null selections keep source semantics, including explicit godown and
sales-person null-to-zero conversion. Edited invalid choices, rejected
ItemChanged and invalid consumed dates cannot return stale success.
The item criterion retains empty retrieval followed by insertion; failure
reports its error and cancels before insertion. Machine/date dependent lookup,
shared global item lookup and distributor export workflows remain separate work.

Six additional transaction grids now have explicit detail and computed
summary/footer mappings. Totals reuse source expressions and formatting,
preserve empty/hidden semantics, and remain readonly without selecting fake
columns. Filter/delete/reset and accepted/rejected input recalculate through
the existing model. Horizontal containment now spans the whole table;
short panes disable vertical stickiness, and source SetColumn restores the
real record even from an offscreen total. Passive updates retain draft text,
caret, focus, GetText and scrolling. Print preview retains Classic.
These isolated buffers do not establish voucher posting or cashier settlement.

The invoice picker now has a real `OpenWithParm` fixture with the recovered
`s_dw_header`, shared caller buffer, original source routines and five exact
translated SELECT statements. It covers optional blank cleanup, duplicate
correction, invoice totals, missing/already-associated/unposted invoices,
modify-mode exclusion, Cancel, Ctrl+I/Ctrl+D and Enter-to-return. Query
recorders distinguish the caller transaction from `sqlca` and forbid all
unexpected retrievals/writes. Synthetic success is not persistence/posting
acceptance or a complete advance-sale flow.

Cashier closing preserves source field order, conditional figures, lookup keys,
six horizontal separators and closed-shift protection. Offline bytecode confirms
three spurious returns blocked successful closing; the production class-fix hook
removes them. Its two updates now retain dirty/original snapshots until closing,
so a cash-write rollback cannot make retry omit the prior detail update.
The 72-assertion fixture records exact translated queries, key-only detail and
all-column cash-count predicates, separate server-date transactions and atomic
synthetic commit/rollback. The authorization dialog supplies only a synthetic
result; no credentials are tested. Eight appearance cases cover open/closed
shifts, exact 100/200% text, narrow layouts and real keyboard/pointer input.

Modern text activation now resolves its live cell after source-driven repaint,
with stale-model/record/focus guards. The shared editor consumes Escape before
removing the input, so it cannot also press the native Cancel button. Unconsumed
DataWindow Escape reaches native Cancel only after its source key result allows
it; return 1, changed focus and an already closing window suppress that fallback.
Controlled delayed-key cases supplement the source-workflow fixture in both modes.

Multiple-invoice cash tendering retains all six source controls, including its
hidden Classic print companion through a guarded auxiliary binding. Header and
cash mappings are context-local. The 101-assertion fixture uses original
sale/return lookup, signed totals, tender validation, keyboard commands, owned
transactions, native ProcCaller and exact SQL/RPC contracts. It records the
source's per-document commits and preference-driven failure resets, not an atomic
batch or guaranteed failed-draft retention. Single-document Print now runs:
offline bytecode proved that the shared interpreter must retain a FOR counter's
terminating value. Exit/Return still do not increment it.

Shared pointer/Tab/Modern grid navigation now awaits RowFocusChanging and guards
pending decisions against replaced rows, changed selection/lifetime and external
focus. The final-blank-row veto and original Ctrl+I/Ctrl+D/Enter/Escape run in
both modes; delayed admission and real pointer checks cover rejection without
editing another record. Eight appearance cases cover sale/return and enlarged
narrow layouts. Both original report selections and retrieve arguments reach a
controlled print boundary; no printer or stored-procedure side effects are accepted.
ModuleID >100 insertion, upstream cashier-job/shift flows and production settlement
remain separate work. See the detailed cash-tendering section in UI-ENHANCEMENT.md.

Category changes retain nine source fields, readonly/conditional protection,
real account/code-table keys and original tender calculations. Strict synthetic
SQL/RPC contracts separate the user-group query on `sqlca` from owned activity,
account and permission operations. Scoped class-load guards reject pending or
invalid input, failed data/permission loads and failed commits. Direct updates
retain dirty/original snapshots and roll back failures. All failed Open exits
return -1, including when input row ID 1 would otherwise resemble acceptance.
Lost commit acknowledgment warns to check the document before retrying, retains
the dialog and does not automatically repeat posting. These are intentional
rebuild error-handling improvements, not bytecode-correction claims.

Joined result columns use position when complete names are duplicated/aliased;
complete unique names still support reordering, and partial named results retain
their existing mapping. Account names therefore remain distinct from subaccount
names. The category fixture's 112 assertions include zero/fractional tender,
unchanged read-only saving and negative failed-Open returns. Repaint reveals previously visible form focus after reflow without undoing
deliberate scrolling away; one-pixel admission tolerance accounts for CSSOM
rounding, not a weaker final visibility assertion. The browser harness now
registers production file/platform functions after system/window functions, so
original Handle/Send are real. Native-field fixtures select windows by registry
bindings rather than guessing whether a custom control descends from DataWindow.
The category fixture's eight cash/credit appearances include real Enter,
account selection and two-stage Escape. Complete cashier workflow, alternative
insertion, native/database and hardware acceptance remain outstanding.

This exposed shared keyboard and draft defects: unhandled DataWindow keys
now reach their source event, Classic Escape retains DataWindow focus, and
TriggerEvent/PostEvent normalize parsed event enums. Source button Enter
handlers own activation instead of also receiving a duplicate browser click.
Modern drops an invalidated but untouched text editor without a recovery
interruption; changed text remains copyable in both modes after deletion,
including after repaint. The plain-text configuration guard uses the same
record/column identity check as commit, not a blanket choice-editor check.

The registry contains 82 entry mappings (79 standard singles), forty-four global
DataWindow mappings and nineteen modal layouts (six criteria dialogs, five native-field dialogs,
four calculators, the associated-sale invoice picker, cashier closing, cash tendering
and category changes).
The criteria registry binds complete inherited argument-window trees plus
Quotation/Customer and Packing Layout. Native hidden options/date rows remain
live; the price selector is context-local. The source-workflow fixture explicitly
substitutes preferences, group lookup and retrieval records. Scoped guards
retain rejected drafts, close failed retrievals with cancellation values and
preserve the completed return against stale closes without blocking active Close
handlers. Native/database/report/calendar
acceptance remains separate; see `UI-ENHANCEMENT.md` for current evidence.
The calculators are `w_discountcalculator`, `w_pricecalculator`,
`w_qty_rate_value_calculator` and `w_set_flatdiscamt`; their 28 source
field/calculation bindings are context-local, not global mappings. Explicit
form groups preserve source caption/visibility semantics and exact membership.
The discount calculator uses guarded native radios in both presentations, source
Flat/Percentage keys and unchanged validation/return scripts. Hidden source
fields stay hidden. Native options scale with text and use themed focus outlines.
Pointer activation preserves index zero; Tab-only entry selects the source column
without inventing Clicked. Acceptance/Escape cannot reopen the editor, and
Classic backward navigation now reads live field eligibility and TabSequence.
Original Open/ItemChanged/ItemError/OK/Cancel routines run against strict
synthetic query results and precision preferences; no financial formulas are
duplicated in the UI. Preview activation snapshots and restores the live
runtime state each time, so cleanup cannot erase subsequently registered routes.
The current appearance-case counts and result paths are maintained in
`UI-ENHANCEMENT.md`, including the complete criteria-window matrix.
Mappings are not accepted workflows. CI, native/hardware,
printing and production workflow gates remain open. Do not reuse the old
143/518 result as current evidence. The chronological authoring notes below
retain their original counts and verification deferral; the current results
above supersede those "unrun" notes.

Shared selectors now cover focus-open ShowList, the sole recovered editable
DDLB and all four left-caption checkboxes. Five further global mappings are
`d_arg_genericitemtype`, `d_changeitem_price_marginbased`, `d_change_purinv`,
`d_customer_category` and `d_stockleder_inputs`. Explicit bindings retain
editing/case, sort, automatic-opening and caption-placement contracts.
The new source fixtures exercise corrected freeform values during pending
acceptance, actual three-column detail browsing, single pointer/Space
activation, source protection, rejected drafts and stale-policy recovery.
The email Subject auto-opening example is fixture-only, not a global mapping.
No recovered DDDW enables HSplitScroll; dynamic split requests remain guarded.
The purchase due-date Date result with a mixed date/time mask still renders
literal hour tokens in the shared formatter. Verify original PB formatting
before changing it; do not change the source RelativeDate formula or mask.

Full editable transaction lookup layouts, inline multi-column/split selectors,
unsupported radio variants, remaining transaction
definitions and grouped/trailer bands, runtime band-height/computed-expression
replacement and complete sale/purchase/cashier workflows remain
unfinished. Accepted production Modern workflows and Modern print templates
remain zero. The latest local evidence is in the session's
`presentation-selectors-shared-final` directory, including real selector and payment
row-veto checks. `presentation-category-boundaries` separately records all 112
category assertions and eight appearances. `presentation-selector-variants-layout`
records the focused selector run: 336 assertions and 36 appearances.
The focused runners
`--editable-lookups-only`, `--transaction-bands-only` and
`--associated-invoices-only`, `--cashier-only`, `--payment-only` and `--category-only` exercise both modes and appearance cases but cannot
replace the complete regression suite.

Current additions include correct
ItemChanged/ItemError outcomes, caller-scoped reentrant AcceptText, required/null
search semantics, typed temporal input, text limits, source-directed focus,
external-blur draft retention and visible default DBError handling.
`presentation-entry-workflow.mjs` now authors original aging New/Delete/Save
paths against a strict in-memory SQL recorder, including uniqueness, master-key
propagation and rollback. It is not real persistence acceptance.
The entry registry now adds 43 exact `w_single_entry` Code/Name windows with
context-only form/list bindings and all 22 inherited controls retained.
Shared input now honors Edit.Case, AutoSelect and IME completion; SetText
normalizes drafts without rewriting stored SetItem values. The Modern radio
focus rule now overrides the legacy inline outline. New catalog, both-mode
browser and eight single-entry appearance cases are authored but unrun.
The browser fixtures execute selected ancestor UI scripts, not the concrete
windows' save/retrieve/print workflows. The 43 mappings are not accepted
production workflows. See the standard-entry section for exact boundaries.
The next authored slice adds guarded native code-table/lookup selection and
the Contact Group outer/member layout: 45 entry mappings in total, still zero
accepted production workflows. Selected keys retain their types and pending
native text bindings; rejection, retry, redraw, pointer/keyboard navigation,
record/configuration changes and child invalidation are guarded. Native child
controls are now owned by their parent control and invalidated on replacement
or destruction; late child definition loads cannot revive them.
New helper/native and both-mode browser cases execute the recovered contact
member validation/copying routines with synthetic rows. Twelve additional
Contact Group appearance cases are authored but unrun.
The subsequent slice adds the reviewed eleven-column `ddd_contactcardlist`
browser beside the native select: F4/Alt+Down, loaded-value search, 50-row
pages and expandable details. It uses the tracked presenter and the same
guarded choice acceptance; it does not mutate or retrieve the child.
Hidden fields are excluded, unsupported child layouts warn and retain the
basic list, and stale details/metadata cannot be committed. Child destruction
notifies the owner once; owner changes/disposal cancel the browser without
stealing retained-draft focus. The new generic browser fixture covers 10,003
synthetic rows and asynchronous/error cases. Contact integration and four
Lookup appearance cases are also authored (sixteen Contact Group cases total).
No new checks have run. This is one reviewed lookup, not all dropdown variants;
Contact Group open/selection/SQL/save/print workflows remain open.
The preceding slice adds native two-value checkbox editing through the same
guarded choice state machine. Focus/Tab/F2/redraw do not toggle; pointer/Space
activation, retained rejection, SetText and queued destinations use shared
validation and identity checks. Mixed/unknown stored values are preserved.
Inactive text properties cannot rewrite checkbox keys. Checklist Item, Shift
and Tax Category now have explicit form/list mappings, including the original
checkbox codes, computed row number and label/order quirks: 46 single-entry
and 48 total entry mappings. New helper/metadata and both-mode browser cases
are authored; 24 additional appearance cases bring the single-entry matrix
to 32. None have run. Concrete-window business queries, persistence and print
remain outside these fixtures. Do not treat mapping counts as acceptance.
Contact Card brought the registry to 49 entry mappings at that point. Its eleven-field
detail/list layouts retain all 24 controls and the hidden print companion.
Sorted Title/SMS choices preserve slash-containing keys and stable duplicate
ordering. Address uses the shared multiline editor with CRLF-aware live text,
selection/scroll retention, deferred IME redraw and copyable recovery in both
modes. Enter retains the source handler; Shift+Enter intentionally adds a line.
Helper/metadata and both-mode browser cases are authored, including the original
account-copy routine with three whitelisted statements and synthetic recorded
query results. Twelve Contact Card appearance cases are added. No new checks
have run; native collation/keyboard equivalence, real SQL and complete
open/save/retrieve/print workflows remain unaccepted.

Relation and thirty-two additional masters now have control-local mappings,
retaining source fields, list order and `GetRow()` serials where present. The
authored registry now has 82 mappings (79 single-entry).
Metadata assertions now pass, including source-position ordering and mixed-case
Dataobject identifiers. Browser fixtures seed and edit all additional fields,
test serials and source mnemonics, and add Resource Category/Grade cases; the
single-entry appearance matrix now has 48 cases. Shared steppers accept decimal
storage with safe integer bounds/increments and preserve exact drafts. Enter
retains its source route; Shift+Enter is the explicit multiline gesture.
The browser run exposed an unstubbed replacement contact-child retrieval:
the fixture now supplies synthetic rows and fails if a scenario leaks dialogs.
The full synthetic browser matrix now passes; no complete production runtime
acceptance is claimed. The fixture uses real Handle/Send bindings for recovered
Contact Card Enter-to-Tab, preserves editing-row identity in destination tests,
and isolates scenarios so leaked dialogs fail at their source.
See `docs/UI-ENHANCEMENT.md` for exact current boundaries. Preserve shared
checkout changes; no commit, push, deployment or Modern-default release is
authorized by the uninterrupted-work request.

**UI enhancement update:** the user has now approved planning and phased work on
Classic/Modern presentation, superseding the earlier "enhancements later" scope
for UI/UX only. `PRODUCT.md` records the decisions; `docs/UI-ENHANCEMENT.md`
records the static inventory, synthetic all-role prototype, opt-in runtime
foundation and remaining gates. The user subsequently directed autonomous
implementation, so another prototype-approval prompt is not blocking progress.
`?app=1&presentation=1` enables the post-login workspace host; ordinary startup
is still Classic. Shared edit/validation, typed host calls, scoped preferences,
tabs, live command search and accessible message/prompt dialogs are implemented.
Existing response windows now have native modal containment with nested-dialog
focus/activation restoration. Seven explicitly mapped DataWindow components now
have Modern forms/lists, shared validation, retained drafts, synchronous
AcceptText ownership and bounded 10,000-row list rendering. Model clearing,
replacement and readonly changes cannot redirect an unapplied Modern entry.
The aging-interval detail pilot includes readonly serial/comparison calculations,
editable limits, hidden-key preservation and separate presentation/data-column
focus. Explicit SetColumn, even to the same column, overrides calculated-cell
navigation without adding ItemFocusChanged. Modern numeric stepping now uses
actual bounds/increments, named buttons and unmodified Up/Down in the editor.
Drafts, grouped input, rejection/cancellation, runtime configuration and model
replacement are covered. Full aging-window validation/save, nonnumeric spin
variants and Classic/native stepping parity remain open.
Five response dialogs now have full Modern layouts retaining the original
controls and scripts (`window-surfaces.ts`, `modern-window.ts`). Dynamic titles,
field-derived modal names, visibility/enabled state, CloseQuery and numeric
return channels are covered. Original `ue_keydown` alias/native parity remains
open; no new shortcut semantics were invented.
Form-tab pointer transitions in both presentations first accept active editors
and await pending field validation, then run the recovered SelectionChanging
guard, including Cancel and failed-save cancellation. Rejection keeps the page
and Modern draft; waiting does not duplicate ItemChanged. Modern
adds manual keyboard activation, live tab/panel semantics and hidden-focus
recovery. Tests execute the actual inherited confirmation scripts with synthetic
save/list outcomes; they do not prove database commits. Programmatic
SelectedTab/SelectTab and initial-tab event parity remain open.
Shared text inputs now deliver ordered EditChanged notifications. Recovered
scripts enable Save while typing and drive ascending-text Find selection and
Detail/menu availability. GetText/SetText own the live draft by model/row/column;
SetText and focus changes preserve unaccepted text without inventing input
events. Script-corrected rejection, queued-input acceptance, failure/correction,
message-box blur safety and cancellation on close are covered in both modes.
Native acceptance fails conservatively while busy; this is not full native
reentrancy parity. Cancellation invalidates queued work, not a running routine.
The aging-entry outer layout now reflows its exact 23 inherited control paths,
including sort/filter controls, original Find labels/instructions and hidden
auxiliaries. Structural mismatches retain the entire Classic layout; Find is
mapped only inside an accepted entry layout. Native dropdown selection/SelectItem
now synchronize Text, enabling the actual filter/unfilter and ascending-sort
scripts with synthetic rows. Radio groups no longer interfere across windows.
`ddlb_data.AllowEdit = true` now uses a real editable combo in both modes.
Typed Text does not invent a selection; Modified finishes an edit, while
list acceptance uses SelectionChanged. Per-control notification sequencing,
dynamic state/focus, native text replacement, reset/insert/delete/sort,
error reporting and disposal are covered. The recovered filter-column
population and freeform/listed-value filtering run on synthetic rows.
This is still a layout pilot: exact native message/locale behavior, other list
families and original database validation/save remain open.
Native chrome is now wired through Tauri's public global window API with the
main-window-only theme permission. Requests serialize across hosts; Classic
restores Light, Modern System passes null, errors are visible and Save retries.
This is unit/mocked-bridge evidence, not packaged Windows verification.
Local UI evidence: 143 frontend tests, nine static inventory tests, strict type
checking, and 518 runtime browser assertions plus four workspace viewports,
nine component, eight dialog, eight entry and four editable-dropdown
appearance/contrast cases (minimum observed text contrast 6.18:1). The metadata-only script analyzer
records 53,976 dependency sites in 37,792 parsed routines; these are migration
candidates, not runtime coverage. Commands and limitations are in
`docs/UI-ENHANCEMENT.md`.
Other outer business windows remain labelled compatibility layouts. Neither the
component pilots, five synthetic-tested dialog layouts nor authored entry layouts establish accepted
production Modern workflows; those and verified Modern print templates remain
zero. See `DESIGN.md` for tokens.
No commit, push, release, or deployment is authorized by design approval.

Current complete-window candidate: `w_agingintervals` inherits 23 control paths,
including Detail/List tabs, filter/sort controls, `d_find`, and hidden item-list
and footer controls. Its outer layout is now mapped, but three mapped DataWindows
alone were not the full window. Editable filter values are now supported, including
keyboard/pointer popup operation at 200% text and narrow effective widths.
Ordered EditChanged and active live-text ownership are now implemented and
verified, including the original Save and ascending-text Find routines. Remaining
shared-editor boundaries: no-active-editor/DataStore text methods still use the
model fallback; native reentrant/no-object AcceptText, other Find branches and
selector editors need characterization. Do not count this isolated synthetic
fixture as complete aging-window validation, SQL-save or production acceptance.
`reports/w_arg_date` is also not a simple date dialog: it inherits list/category
selection and uses `d_arg_class`. Do not map either from its name alone.

## 1. The goal

Rebuild the compiled PowerBuilder 12.5 ERP/POS "Trader App v1" ("Waseela", Abuzar Consultancy, FazalDin PP19 deployment; no source exists) as
**Tauri 2 + Rust (axum + sqlx) + PostgreSQL 17** with **100% visual and functional parity**.  The user's decisions: parity only (enhancements later), old customer data is not needed,
no licence/activation checks in the rebuild.  The user wants "everything remaining done, nothing left behind" and honest, measured numbers (what is verified vs open).

How it works: the vendor's recovered PowerScript (37,895 routines) is parsed and run unmodified by a TypeScript async interpreter (`web/src/runtime`); PowerBuilder natives
(windows, controls, DataWindow, transactions, system functions) are TypeScript; DataWindows (8,748) render from their recovered definitions; the Rust server is the data tier;
the original T-SQL was translated to PostgreSQL by `tools/tsql/` (`db/pg/*.sql`).

## 2. Repositories and machines

| what | where | rule |
|---|---|---|
| the rebuild (this repo) | `C:\Projects\Abuzar\rebuild`, GitHub `jerryboganda/abuzar-rebuild` | **public since 2026-11-04** (the user's permanent decision: GitHub Actions is free on public repos; the private repo's billing blocked every job). Everything pushed is world-readable. |
| the research project | `C:\Projects\Abuzar` (parent folder; remote `jerryboganda/abuzarREA`) | **never push it**: it is public and its index holds the vendor's binaries. It holds the recovered inputs (`recovered/`, `db/schema/`, `re-tools/`) the rebuild imports with `tools/import_research.py` and the T-SQL source `tools/tsql/build.py --src C:\Projects\Abuzar` reads. |
| live original database | SQL Server 2022 Express `.\SQLEXPRESS2022`, database `FazalDinPP19DataBaseV2` (Windows auth) | metadata-only comparisons (`INFORMATION_SCHEMA`, `sys.parameters`, `sys.dm_exec_describe_first_result_set`, small behaviour probes such as `@@ROWCOUNT`). `sqlcmd` needs `-C` (trust the certificate). No customer rows in anything committed. |

Windows 11, shells are Git Bash and PowerShell.  Node 26 runs `.ts` files directly (`node file.ts`).  Python is run as `python -I`.  A 32-bit Python (`C:\Tools\py32\python.exe`) hosts the original's
`pbdwe125.dll` as a DataWindow oracle (`re-tools/dw_oracle` in the research project).

## 3. Rules that must stay true

* Never commit or print: the vendor backup/media passwords, the app login the user once pasted, hard-coded credentials, customer data, vendor binaries/backups.  Do not crack the `.BAK` files, do not bypass licensing (only inventory it).
* Never push `C:\Projects\Abuzar` (the parent repo).
* Validation is GitHub Actions (`ci.yml`: database, server, web, desktop, e2e; `release.yml`: installer; `sql.yml`).  The user once chose "CI only, no local PostgreSQL/Rust"; a PostgreSQL 17 service now exists on the machine and a local `cargo` run left a `Cargo.lock` (apparently from an earlier opencode session; not verified, and not on the PATH of the previous agent).  Node and Python tests run locally.
* `.github/workflows/ci.yml` has `concurrency: cancel-in-progress` on the ref: dispatch **one** run at a time (`gh workflow run ci.yml`).  An e2e job takes about 25 minutes.
* Git hygiene: never `git add -A`; add explicit paths; end doc/data-only commit messages with `[skip ci]`; check `node --check` / selftests *before* the commit command (a broken file was pushed once because the check was chained with `;`).
* When the user's input is needed, ask in a popup with recommended options, keep status lines short, never stall silently.

## 4. State at handoff (all measured by tools; see `docs/ci-results.json`)

* CI run 41716174427 (commit da153f3, later runs 41719169707, 41722595632, 41725588959 also green): windows opened headless **2046 / 2062**; DataWindow retrieves against PostgreSQL **8618 / 8668**; embedded statements **1847 / 1862**; procedures **511 / 638**; DataWindow expression evaluation 8748 / 8748; Chromium sample 51 of 52 windows opened.
* Installer: GitHub release **build-9** (commit 7533f71): `Trader_0.1.0_x64-setup.exe`, `trader-desktop.exe`, `trader-server.exe`, `db/pg/*.sql`.  Releases are pre-releases named `build-<run number>`.
* Local checks: `python -I tools/tsql/selftest.py` (29 cases), `node --test web/tests/` (29 tests), `node web/tools/smoke-windows.ts web/public/data - report.json` (about 5 minutes; run in slices with a regex filter such as `'^w_[a-c]'` to parallelise).
* Not "production": there is no server deployment target defined yet.  The deliverables are the release installer plus the PostgreSQL scripts (`docs/OPERATIONS.md`).

## 5. How to work

```
python -I tools/tsql/selftest.py
node --test web/tests/
node web/tools/build-classes.ts data/src/objects data/src/scripts web/public/data/classes data/src/menu_trees   # web/public/data is generated and git-ignored
node web/tools/smoke-windows.ts web/public/data '^w_a' slice.json
python -I tools/tsql/build.py --src C:\Projects\Abuzar --repo <dir>        # regenerates db/pg/40-70 and data/sql/{units,proc_signatures}.json
```

* Regenerating SQL: `<dir>` must contain `db/pg/10_tables.sql` (type inference) **and `data/src/dw`** (otherwise `proc_signatures.json` loses its `datawindows` field).  Do a scratch regeneration and diff before overwriting the repo; the generated files must equal generator output (do not hand-edit them).  Rule verified on SQL Server: `SET @v = ...` leaves `@@ROWCOUNT` at 1; the translator emits `_rc := 1` after it.
* CI numbers: fetch the e2e log with `gh run view <run> --log --job <job id>` (`gh api .../logs` returns an empty file here), strip ANSI and the timestamp prefix, then `python -I tools/ci_results.py <log> <run> <sha> docs/ci-results.json` and regenerate `docs/PARITY.md` with `node web/tools/parity.ts <repo root with web/public/data> <merged smoke json> <empty file>` from a clean `git archive HEAD` export.
* Tooling traps: Bash heredocs collapse backslashes (write files with an editor tool, not `cat <<EOF`, when a string contains `\n`); Python on Windows needs Windows paths, not `/c/...`; regenerate statements with UTF-8 (a wrong codec produced garbled `routine` labels once).

## 6. Open items, most valuable first

1. **Needs the user's machine**: start `abuzar.exe` (original, logged in) and compare side by side with the CI screens (`gh release download ci-screens`): the 48 report argument dialogs (`tools/orig/crawl.ps1 open <ids> <outdir> 5000`, compare with `sbs.ps1`), Purchase Order column order, Interface Settings, Group Wise Header Setting dialog, About window.  Then real-data screens/reports, hardware (printers, scanners, fingerprint, fiscal machine).  Pixel parity is not measurable without the original running.
2. **Production deployment**: undefined.  Ask the user what "production" is (a server, a customer PC, the release only) before deploying anything.
3. **Intermittent browser-walk freeze** (stalled in 3 of 7 CI runs, at `w_selectformat_topncustomers` once and at the 9th sampled window `w_arg_godown_sinv_linv_sale_sret` twice; all open fine headless and with the mock database; even `Debugger.pause` gets no answer, so the renderer is stuck below JavaScript).  `web/e2e/browser-smoke.mjs` now opens the CDP session first and prints the process table twice at a stall: read the next stalled run's log (`grep -E 'stuck:|processes '`).  Dispatch CI a few times until one stalls.
4. **16 windows that need caller arguments** (documented in `docs/FIDELITY.md`): they read `message.powerobjectparm` fields (a caller's DataWindow, `bsa`, `icode`...) or are abstract ancestors; a scenario test would open the caller and click.
5. **Failing SQL** (classified in `docs/FIDELITY.md`): 50 DataWindow retrieves (15 linked-server by design, 20 the original's own defects, 10 sweep artefacts, 3 no counterpart, 2 `ORDER BY @param`) and 128 procedures (122 classified); re-measure on PostgreSQL after any translator change.
6. Smaller known gaps: Windows digit-grouping and `Long/Integer` odd-string semantics; `docs/ROADMAP.md` "Not done" list.
7. `docs/handoff/60_procedures_hand_edit.patch` is an unreviewed hand edit of a generated file that an earlier session left (it removes the `srv, db, owner` parameters of `sp_crs_fetch_itemstockposition` for a "no linked servers" deployment).  Not applied: it would diverge from the generator and from `proc_signatures.json`; decide, then change the translator instead.

## 7. In-flight work of the previous opencode session

The working tree at handoff contains the last edits of that session, committed together with this file: the Tauri start-up detection and native window title (`web/src/main.ts`, `web/src/ui/dom-ui.ts`, `src-tauri/tauri.conf.json`), `data/sql/statements.json` (soundex), probe scripts under `tools/tsql/probe_*.py` (throwaway, hard-coded local paths), `tools/tsql/prepare_audit.py` (PREPARE every statement against a PostgreSQL database; needs `AUDIT_DATABASE_URL`) and `Cargo.lock`.  The fiscal relay (`server/src/fiscal.rs`, `/api/fiscal`) refuses non-local hosts.  Run CI on the final commit before relying on any of it.

## 8. 2026-11-05 update (supersedes the "not built" notes above)

* All local work committed and pushed to `main` (a161d851..ad458bb8, plus c772a3d9 below).  Local PostgreSQL 17.11 is up (postmaster runs manually, not as the service - do not "start the service" or it will fail on the stale `postmaster.pid`); databases `trader`, `trader_write_test` (2 GB clones) and `trader_install_check` (fresh, schema+seed only) exist.
* Fresh-install verification passed: every `db/pg/*.sql` applied with **zero errors** (56 `seed skipped` notices, expected); 763 tables; first administrator `ADMIN`.
* CI on the final HEAD is green: **database, server, web, desktop, e2e** (run 41940944791).  DataWindows executed **8624 of 8668**; expressions **8748 of 8748**; menu walk matched 265/265 items (1 known difference: `Reports | Sales Reports | Category Wise | Sale And Return`).  The known intermittent Chromium renderer freeze in the browser sample still occurs (non-fatal; 6/52 sample opened, 0 exceptions).
* Release **build-11** published (from c772a3d9): installer, standalone executables, `db/pg/*.sql`.  Installer smoke-tested on this machine: per-user silent install (`/S`) over the existing `%LOCALAPPDATA%\Trader`, embedded server healthy on 127.0.0.1:8787, session read of `dbo.users` OK, `trader-server.exe` healthy on a spare port.  `trader.conf` was removed afterwards; the app therefore has no database configured until one is supplied (first line, or `DATABASE_URL`; fallback `postgres://postgres@127.0.0.1:5432/trader`).
* Server hardening: a non-loopback `BIND` without `API_TOKEN` now refuses to start (`ALLOW_INSECURE_LAN=1` overrides); documented in OPERATIONS.md.
* Not done / user decisions: production host and database target (the app has no DSN configured anywhere), code signing, version/release channel (0.1.0, prerelease), the remaining parity items (reports crawl, two unrecovered DataWindows, `LP Ledger` menu, data-dependent screens, pixel geometry) - see ROADMAP.md.
