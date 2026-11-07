# Modern presentation design

The confirmed product constraints are in `PRODUCT.md`. This document describes
the implemented Modern workspace foundation, not a completed screen catalog.
Classic retains its existing appearance and the same runtime/business engine.

Current local counts and evidence paths are maintained in
`docs/UI-ENHANCEMENT.md` under **Current local evidence**. Coverage includes
frontend contracts, strict presentation types, the isolated static build,
both-mode interaction, responsive appearances and emulated forced colors,
including pixel-level selected-text legibility.
This is synthetic browser evidence, not packaged/native, production-workflow
or assistive-technology acceptance. Rejected edits must never be described as saved; a source
correction owns the returned field/row, and leaving a DataWindow must retain
its unaccepted draft. Native radio controls retain a keyboard focus outline.
Grid keyboard targets use no extra form scroll margin, so full-width cells
remain revealable. Pointer checkboxes share one activation route; Space and
pointer sequences are checked for exactly one ItemChanged per activation.
Active multiline typing and genuine form text-editor focus reveal the editor
after repaint. Reflow keeps previously visible form focus onscreen, while
deliberately scrolled-away focus is restored without autoscrolling.
An asynchronous grid redraw respects the latest
cell or external focus instead of returning to an earlier focus snapshot.
When a form repaint expands a status or field, a previously visible focused
sibling control in the same mapped window stays visible too. This prevents
a wrapped summary from clipping the dialog action reached by Tab. It must not
refocus a control, scroll an unrelated window, or undo deliberate scrolling
away from the focused control.

## Visual direction

Use a Windows-familiar working interface: Segoe UI with Tahoma/Arial fallbacks,
clear labels, compact navigation, visible keyboard focus, and restrained blue
selection. Preserve existing terminology and branding. Do not introduce
decorative dashboards, emoji navigation, or a frontend framework.

The seven-surface prototype in `web/prototypes/modern` is the all-role design
reference. Production workspace tokens live in
`web/src/ui/presentation-styles.ts`; unmapped compatibility controls do not
inherit them.

## Workspace tokens

| Purpose | Light | Dark |
|---|---|---|
| Surface | `#ffffff` | `#202630` |
| Canvas | `#f3f5f8` | `#171d25` |
| Navigation rail | `#edf1f6` | `#1b222c` |
| Primary text | `#192432` | `#edf2f9` |
| Secondary text | `#4c5d70` | `#b3c0d0` |
| Boundary | `#7d8c9d` | `#7a8a9e` |
| Accent / focus | `#095ac6` | `#9cc9ff` |
| Text on accent | `#ffffff` | `#10243b` |
| Selection | `#e3edfc` | `#293d59` |
| Error text | `#b51c2b` | `#ffb5bd` |

Workspace body type starts at 14px with 1.5 line height and a user-controlled
100-200% multiplier. Dialog headings use 1.5em. Compact controls start at 32px;
Comfortable actions start at 42px. Compatibility form geometry and Classic print
fonts remain unchanged until their explicit migration.

Use modest 4-8px corner radii, structural separators, and a visible 2px focus
outline. No motion is necessary to complete the current workspace tasks.
Native controls, keyboard behavior, and error clarity take priority over effects.
Modern native-control focus selectors must outrank Classic input/select focus
rules without changing those Classic rules. The two-pixel themed outline remains
visible on native fields, selected lists and actions across the appearance matrix.

Forced-color mode uses system `Highlight`/`HighlightText` selection rather
than app palette tokens. Current rows, focus, mixed checkbox state, invalid
input and default actions retain visible outlines, patterns or markers.
Selected readonly values, source suffixes and detailed lookup rows narrowly suppress browser
text backplates; native editor/control descendants restore automatic system
colors. Do not apply `forced-color-adjust:none` to the whole workspace.
Entering/leaving high contrast must preserve unaccepted drafts and focus.
Both emulated light/dark system palettes pass with the opposite app theme,
including 200% text at 320px. Actual Windows high-contrast and assistive
technology remain separate acceptance gates.

## Forms and lists

Forty-seven explicit DataWindow mappings provide the Modern component pilots;
see `docs/UI-ENHANCEMENT.md` for the identities and limits. Forms use visible
labels and responsive field columns. Lists use aligned headings, semantic grid
cells, one keyboard entry point, sticky headings and bounded row rendering.
Source-required editable form fields show a plain `Required` hint; grid headers
show the declared column requirement. Inputs retain original labels and existing
help while exposing required state to accessibility. Use the same metadata rule
as FindRequired, not inferred schema/business rules or native HTML constraints.
Dynamic guidance must not accept, drop or rewrite a draft. Protected/generated
form values and computations do not gain editable requirements. When a sticky
heading and a complete row cannot fit, headings scroll normally instead of
covering the editor.
Compact rows start at 35px and Comfortable rows at 42px, multiplied by text size.
Borders are included in virtual-row measurements.
Calculated grid cells remain readonly and navigable without replacing the
current business-data column. Explicit script column selections take precedence
over remembered presentation focus. The aging-detail comparison column names
its originally blank heading; hidden business keys stay hidden.
Numeric adjustment controls use named, scalable buttons with at least 24px
targets and a single keyboard-focusable text editor. Up/Down step the draft;
ordinary validation accepts it. Buttons do not obscure numbers, and selected
rows retain a contrasting focus outline. Unsupported spin styles keep Classic
rather than presenting a nonfunctional Modern affordance.

Distributor, amount/price/discount and letter criteria use the same explicit
form bindings and source labels. Hidden city defaults remain in the model;
the original disabled price stays readonly. Letter fields keep their source
To/Subject/Detail order, multiline hints, CRLF and individual empty-text rules.
Layout reflow must not invent validation, shorten rejected drafts or substitute
HTML number/required constraints for the shared input engine. Component mapping
does not imply that the surrounding argument window or reporting flow is migrated.

Source-bound suffixes preserve units and trailing instructions beside or below
their fields, with wrapping at enlarged text sizes. Keep their source identities
separate from primary labels and attach them as accessible descriptions. Hidden
or empty suffixes leave no stale description; runtime text/visibility changes
must preserve drafts, caret and focus. Literal script captions must not be
serialized back into property-command syntax.

Six transaction grids add source-computed summary/footer totals. Their named,
readonly outputs retain the original labels and precision; they never become
editable record columns. Totals stay within the viewport during horizontal
scrolling. Sticky footers reserve focus space and return to normal vertical
flow in short panes. Source SetColumn takes precedence over retained total
focus, including when the current record is outside the rendered window.
Print preview remains on the Classic path.

Readonly fields use the canvas tone. Current and selected list rows override
that fill so selection text retains its paired contrast in both themes.
Keyboard focus and selected-row semantics are not expressed through color alone.
Text, labels and validation feedback must survive redraws; interrupted edits
remain copyable until explicitly discarded.

Editable Manufacturer criteria use the shared display-text input with a
non-Tab-stop toggle and named top-layer listbox. Popup arrows announce and
reveal the selected child row without replacing unfinished text. Typed exact
labels resolve to source keys, while explicit duplicate selections preserve
their chosen key. The first Escape closes the list and the second cancels.
Paired text/selection colors, wrapping options and a complete focused input
remain visible through 200% text and 320px effective width. Repaints retain
selection and IME text; Classic popup restoration cannot steal newer external
focus. Above 100 choices, the popup keeps visible variable-height rows, eight
overscan rows on either side and at most one pinned active option. Both the
live DOM and option-node cache stay bounded; wrapped labels remain complete,
with source-sized row budgets and viewport clamping. Manual scrolling does not
select, type or mutate a source cursor. Keyboard search still covers every
choice, and exact original keys survive duplicate labels and distant selection.
The complete data/height arrays remain O(N). These two argument forms are not
accepted transaction workflows; packaged-device and assistive-technology
acceptance remain outstanding.

Source ShowList opens its choices on genuine field focus and removes the
decorative arrow; it does not create a permanently visible panel. Readonly and
editable fields reuse the same popup, focus ownership and rejection recovery.
Editable code-table labels retain their original keys and normal validation.
Left-caption checkboxes keep one visible, wrapping source caption before a
right-aligned, scalable native checkbox. The whole field remains a pointer
target; the native editor retains its own keyboard outline and rejected state.
Grid status text stays horizontally aligned with the viewport. Source financial
expressions and declared formats are not replaced by presentation calculations.

Five explicitly mapped response dialogs reflow their original native inputs,
labels and actions. Labels align left; numeric values retain their original
alignment. Untitled native-field windows use the existing field label to name the dialog and
place Close beside it, without fabricating a visible title. Long headings wrap
with a 1.25 line height; actions wrap when required. Keyboard focus can reach
every control without leaving the modal or losing the original return channel.

Fifty-five criteria dialogs use this same layout with complete inherited controls,
including hidden dates, captions, checkboxes, native radio groups and a
context-local price selector. Groupbox captions remain live without hiding
their fields when the decorative frame is hidden. Native options follow Modern
DOM tab order and use a themed whole-option focus outline; empty hidden
field/label rows do not consume layout space. Original validation messages,
focus and return structures remain in the shared runtime. Scoped acceptance,
failed-retrieval and stale-close guards prevent returning an old or failed value.
The percentage dialog retains its caller-defined label and the original
initial `To:` versus changed `By:` wording, rather than rewriting business copy.
The zone/date/top-customer dialog keeps source order across separate DataWindows
and native date controls. Explicit content orders must bind every content item
exactly once; externally bound captions remain live accessible field labels,
not duplicated headings. Both editable buffers are guarded before source
validation and return. The customer-reference chooser keeps its four source
codes and -1 cancellation, including title-bar closing after a prior selection.
Untitled data dialogs derive their name from the live source field label across
redraws and reserve a separate Close row so it cannot cover the form.

Fifteen single-lookup owners reuse this contract without expanding the global
DataWindow catalog. Each external source caption names the actual selector;
manufacturer retains `Company:`, and labels remain live across repaint.
Child data/display columns, editability, ShowList, percentage width and row
budgets follow the recovered definitions. A single-zone owner must not acquire
the top-customer owner's extra count buffer merely because they share a lookup.
Selection-only owners keep dates hidden. The supplier-label All checkbox stays
visible; returned suppression/hide flags remain Boolean. AcceptText guards
reject an edited invalid choice without imposing new validation on untouched
null criteria. Godown and sales-person owners retain their explicit null-to-zero
conversion. Date guards apply only to dates consumed by the original handler.
Failed item-criteria retrieval reports the failure and returns cancellation
before the source can insert a replacement row.

Six reference-text owners reuse a context-local field without duplicating their
source captions or imposing required validation on optional references.
Six numeric owners preserve Day, Discount %, GST %, code and document ranges.
Multiple external labels move with their original DOM identities into the
corresponding field wrappers, remaining live through redraw. The Day header
label is explicitly bound to its source band even though the form is freeform.
Percentage limits remain inclusive 0-100; only the source discount field spins.
Range ordering and Boolean flags follow the original routines, not assumptions
from their captions. Plain Tab focus is verified against the actual field node;
it must not manufacture a source selection or edit event.

Nine date/filter owners cover cash/credit sales and returns, stock adjustments,
outstanding invoices, posting status, date category, purchase/sale types and
transaction selection. Their hidden customer buffer remains empty and unused.
The layouts preserve source option captions, checked defaults, visual order,
radio groups and exact return codes. All Transactions checks and disables its
fifteen choices; clearing it clears and re-enables them. Only the purchase/sale
type owners reject reversed ranges with status zero and close, as their original
scripts require. Date preflight and fresh cancellation do not introduce new
business validation. A missing native option TabOrder receives a normal Modern
tab stop; an explicitly declared zero remains excluded, and Classic is unchanged.

Six more owners cover As On, two cost-price variants, Cash/Credit/Both,
cashflow account choices and remarks. Cost and payment-type selectors retain
their separate `dw_price` buffer and literal external source labels. Cost lookup
keys stay 5/6 with default 6; payment-type codes stay 1/2/3 with default 1.
Only that actual secondary editor receives the extra AcceptText guard. The
inherited non-blocking customer AcceptText call is preserved rather than
converted into new hidden-buffer validation. Original null values, cash/credit
arrays and account/remarks flags are unchanged.

The item-selection criteria owner retains its source selection/selected/date
captions, native sorted list and All option. An explicit processing-style binding
reflows only its one-row search grid as a form while validating the original
header labels; the available-item grid remains a grid. Native list focus,
keyboard removal and double-click removal keep their original events. Additional
frames and list captions participate in exact ownership/content-order validation,
and hiding a decorative caption does not hide its controls. Search drafts are
transient: All or an already populated selection must not fail because the
cleared search Name is required. Only the count draft is guarded on OK.
Retrieval failures and stale-close returns cannot masquerade as success.

Specified-date, date-only and start/end-date arguments retain their native
inputs, literal captions and original defaults. Empty hidden customer controls
do not become visible criteria or trigger retrieval. Numeric datetime masks
determine date order; impossible dates and clocks stay editable with explicit
feedback and focus. A native input's base border must not override its themed
error color or forced-color dashed border. Both dates are checked before either
returned date is changed. Correction clears the error without losing the text.
Enter follows the original KeyDown/Handle/Send navigation, skips hidden/disabled
controls and must not also activate a default button. Explicit Cancel and
title-bar closing cannot return an earlier success. Source-absent Escape
shortcuts and start-before-end rules are not inferred.

Four transaction calculators extend this structure with control-local
DataWindow forms inside a wider, viewport-bounded dialog. Item context and
readonly results retain the canvas fill; decimal values remain right aligned.
Quantity calculations retain the source Item Information group and separate
the editable values with a structural rule. Captions and groups do not change
field ownership or visibility. Source labels, validation and financial
expressions remain authoritative; the Modern layer only changes presentation.
The flat/percentage discount selector uses a labeled native radio group with
one Tab entry, visible focus and responsive option wrapping. Radio glyphs scale
with text and the focus outline uses the paired theme accent. Active radio
focus reveals its whole label after repaint; passive redraw retains scroll.
Unknown keys stay
unselected. AcceptText and Escape restore focus without reopening the editor;
Tab-only entry updates the active source field without synthesizing a click.
Source-hidden choices and calculated fields stay hidden.

The associated-sale invoice picker uses the same modal with its source-ordered
grid, readonly total and original OK/Cancel controls. Shared-buffer validation
and return scripts have synthetic coverage in both presentations. Cancelling an
editor retains DataWindow keyboard focus; the next Escape reaches source
cancellation. Source Enter activation is never duplicated by a browser click.
Untouched deleted rows do not interrupt work with a recovery panel, while
changed deleted rows retain their unapplied text and isolate recovery-field
keys from business actions. These are not real database acceptance claims.

Cashier-shift closing retains its original details, denomination grid and
figures in source display order. Six explicitly bound horizontal rules preserve
conditional source visibility without inventing groups. Open shifts retain
their editable cash/transfer fields; closed shifts expose the original extra
figures, protect every column and disable Close Shift. Calculations and lookup
keys stay in the shared engine. Narrow layouts reflow forms while the
denomination grid remains horizontally scrollable.

Multiple-invoice cash tendering keeps its source-ordered document grid and signed
total above the payment fields. Sale/return selection retains the original sorted
code table. Charged cash and change are readonly, copyable and keyboard-focusable;
source numeric formats remain unchanged. The three original actions remain Print,
OK and Cancel. An explicit auxiliary binding retains the hidden Classic report
control without reinterpreting its grouped report as a Modern form.

Pointer and keyboard row changes wait for the source RowFocusChanging result.
A rejected or stale transition cannot select another record or open its editor.
An external focus change during the decision is respected. Original per-document
supervision and preference-driven buffer resets are preserved, not presented as
atomic batch saving or production payment acceptance.

Cashier category changes keep all nine source fields and both original actions.
Readonly invoice, remarks, amount, charged cash and change remain copyable;
category/account/supervision choices retain their original keys and conditional
protection. Group permissions constrain the account list without changing its
names to subaccount labels. Rejected drafts cannot reach saving, failed loads
return rejection, and unconfirmed commits retain edits with a warning to inspect
the document before retrying. Repaint keeps previously visible focus in view
after reflow, but does not scroll back to a deliberately hidden field.

Text-field activation resolves the live cell after source-driven repaint.
Escape first discards the editor and retains DataWindow focus; an unconsumed
second Escape invokes native Cancel, after any source key handler has completed.
Return code 1 suppresses that action, and delayed keys cannot close a window
after focus leaves the originating DataWindow. Retry after a failed closing
write retains both shift and cash-count edits. Synthetic workflow coverage is
not authorization, real persistence or cashier-hardware acceptance.

The aging-entry outer layout keeps Detail/List rather than replacing their
workflow. Master fields sit above limits; List groups Sort Criteria and Filter
Criteria above the original Find instructions and results. Existing control
labels and handlers remain authoritative. Find is scoped to this full layout,
not globally enlarged inside other windows' small slots. Hidden auxiliary
controls remain available, and incompatible contents retain Classic rendering.
The editable filter-value combo supports both listed and freeform values.
Exploring its popup does not overwrite typed text; Enter accepts and Escape
dismisses. Choices inherit the window's appearance and remain visible above
clipped panels. Control events and text/list state are shared with Classic;
production workflow and exact native-behavior acceptance remain open.

The same entry structure now has explicit bindings for 43 standard Code/Name
masters. Detail retains the source field labels and hidden print companions;
List keeps the original criteria, Find and results. Form/list mappings are
local to those controls rather than global by DataWindow name. These layouts
and their case-aware input/IME behavior have synthetic browser coverage.
No business workflow or Modern print acceptance is implied.

Contact Group now uses the same inherited structure with its existing master,
member grid and List. The member grid keeps all source columns and labels,
while hidden data keys remain hidden. Explicit choice bindings use a native
select with named loading, missing-value, rejection and retry states; stored
keys are separate from display labels. Accepted navigation waits for shared
validation, Escape cancels, and redraws do not steal focus or discard a draft.
Individual grid columns are constrained by their own viewport while the grid
can still scroll horizontally.

The contact-card lookup additionally offers a named browse button and F4 /
Alt+Down. Its tracked, focus-contained dialog preserves all eleven reviewed
source columns and keeps hidden account fields out of both display and search.
Use loaded-record search, bounded 50-row pages and expandable full row details
to distinguish repeated names without changing the child buffer. Search Enter
moves to the grid; selection uses the existing guarded commit after browsing
closes. Cancel changes nothing. Source/owner changes dismiss obsolete browsing,
while unsupported visibility/formatting retains the basic list with a warning.
Theme, density, text scaling and forced-color focus styling use shared tokens
and native controls. This slice has synthetic browser coverage; other lookup variants
and full Contact Group workflows remain open.

Checklist Item, Shift and Tax Category add three richer standard masters
without changing their original fields, labels or ordering. Native checkbox
editing shares the guarded choice state machine: focus/Tab/F2 do not toggle,
Space/pointer activation selects the configured key, rejection retains the
draft, and unknown stored values stay mixed until explicitly changed.
Readonly list cells expose checkbox state without becoming editable.
These additions use the existing appearance tokens and have synthetic browser
coverage; complete business workflows remain unaccepted.

Contact Card keeps all eleven fields and its inherited Detail/List workflow.
Title and SMS selectors sort display labels while preserving source data keys.
Address uses a wrapping four-line textarea and a bounded, scrollable readonly
value; the list stays single-line. Visible help explains Shift+Enter for a new
line, while Enter keeps the source form action. Labels, helper text, editor
focus and recovery fields use the same theme/density/text-size tokens.
Multiline drafts retain selection, editor scroll and source line endings;
repaint waits for IME completion and does not steal external focus. Interrupted
drafts remain copyable without flattening their lines. These layouts, keyboard
gestures and twelve appearance cases have synthetic browser coverage, not
packaged or production-workflow acceptance.

## Layout and interaction

- Keep workspaces as tabs backed by existing runtime/window instances. Never
  recreate a form to switch tabs or persist transaction drafts in preferences.
- Search the currently available menu tree. Recheck availability after menu
  Selected handlers and execute existing Clicked/posted events.
- Close through CloseQuery. Cancelled closes retain the window and its edits.
- Form-tab navigation waits for pending field validation and the original
  unsaved-change decision; rejected entries retain their page. In Modern,
  arrow keys move tab focus; Enter/Space activate explicitly. Keep labels and
  selected/disabled/hidden state live, with a single tab-list entry point and
  no focus left inside a hidden panel. These tab affordances do not convert the
  surrounding compatibility form into a fully migrated Modern screen.
- Keep background commands unavailable while a runtime modal is active.
  Searching commands must not accidentally invoke a transaction accelerator.
- Deliver text-input notifications in order before accepting a draft. Script
  text replacements and focus restoration must not discard unaccepted input or
  invent another keystroke. Input-event messages must not trigger blur validation;
  correction clears obsolete failure feedback. Cancellation invalidates queued
  delivery, not an already running business routine.
- Keep compatibility response windows inside native modal containers without
  replacing their runtime/control instances. Nested responses restore the
  invoking window, focus and close/return lifecycle.
- Dialogs expose names, descriptions, meaningful severity, and visible focus.
  Tab/Shift+Tab stay in the dialog; focus remains visible after resizing and
  returns to the previous control when the dialog finishes.
- Settings errors remain visible without discarding the user's choices.
  Interface changes take effect at the next sign-in, never mid-transaction.

At narrow effective widths, the navigation rail becomes a command area above
the workspace. Tabs can scroll horizontally; dialogs scroll vertically and
wrap their actions. The narrow workspace itself can scroll instead of shrinking
its working pane to zero. Focused fields stay fully visible; restoring an editor
after redraw does not undo deliberate scrolling. A 320px browser check is a reflow check, not an expansion
of scope to a mobile product. Native Windows display scaling is a separate gate.

## Migration boundaries

The current stage deliberately labels business windows **Classic compatibility
layouts**, except for 70 modal mappings (fifty-five criteria, five native-field,
four calculators, four transaction dialogs and two shared calendars) and 98 entry mappings. The entry registry contains
aging, Contact Group, Contact Card and 95 standard single-entry windows (43 Code/Name and 52 richer form/list mappings) with
contextual form/list bindings. Neither count is complete workflow acceptance.
Explicitly mapped DataWindow roots also use Modern tokens and semantic layouts; other
controls and outer window geometry remain unchanged. Theme and
text settings reach mapped surfaces without leaking into unmapped controls.
Component migration is not evidence of complete Modern screen coverage.
The native theme bridge follows Modern's Light/Dark/System choice and restores
Light for Classic; it uses the standard Tauri window controls. Its ordering,
failure recovery and preferences contract are synthetic-tested, but actual
Windows chrome and WebView2 behavior still require packaged acceptance.

The source calendar keeps its six-week grid, today marker, week numbers and
original OK/Cancel actions in both hosts. Modern supplies theme tokens, full
text scaling, roving grid focus and month/year choices without duplicating
business return logic. At narrow widths only the calendar's outer margin is
reduced to preserve separation between enlarged two-digit dates and week
numbers. Vertical overflow remains scrollable, including keyboard actions.
Source-requested initial focus waits until the modal is visible; acceptance
waits for queued selection events. Native Windows calendar equivalence and
assistive-technology acceptance remain separate gates.
The ISO-returning DataWindow calendar retains its distinct original-date Cancel
contract. It validates the active draft before opening, keeps the accepted
clock including milliseconds, and restores the exact source-masked editor text
and focus. Empty datetimes use midnight only after a date is chosen. Its source
handlers are exercised in an isolated synthetic owner; the complete
customer-comments window and database workflow are not accepted by that fixture.

Print appearance is independent of screen appearance. The opt-in host now
registers sales/purchase invoice previews separately from blocked item labels.
Global Print layout and explicit per-family choices are independent of the
screen mode. A family's `Default` choice follows the global layout without
materializing an override; selecting it again clears an existing override.
Short option labels remain readable at 320px/200%, with linked help explaining
inheritance, preview status and unavailable templates.

Modern print rules are absolute overlays, not borders on the source bands:
they cannot shift field origins or expand a zero-height band. Synthetic rendered
pages preserve field/band coordinates, detail rows, group totals, the full total
and page numbers. Paper stays white in either workspace theme. An unavailable
Modern request stops visibly and asks for Classic rather than claiming that a
substitute job was printed. These previews are not accepted official documents.
Complete field, pagination, barcode and device evidence remains required before
production approval.

See `docs/UI-ENHANCEMENT.md` for measured coverage, reproducible checks, preview
activation, and open acceptance gates. Do not infer WCAG conformance or release
readiness from the visual design alone.
