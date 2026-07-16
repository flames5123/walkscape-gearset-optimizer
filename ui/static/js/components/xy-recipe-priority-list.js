/**
 * X-per-Y Recipe Priority List — shared component used by:
 *   1. Settings Modal > Optimization > Recipe section (Detailed mode)
 *   2. Column 3 optimize-button Quick Settings panel (Quick mode)
 *
 * Data model (per entry):
 *   {
 *     mode: 'ratio' | 'budget',
 *     x:          string  // ratio only — one of AXIS_OPTIONS
 *     y:          string  // ratio only
 *     weight:     int 0-100
 *     quality:    string  // ratio + y=quality
 *     targetItem: string  // ratio + y=target_item (e.g. 'cat:chests')
 *     budgetMats:   string  // budget only (user input)
 *     budgetTarget: string  // budget only
 *     hiddenInQuick: bool  // eye icon state
 *   }
 *
 * Port notes:
 *   - The UI is adapted from ui/static/craftingpoll.html + craftingpoll.js
 *     (the functional mockup) with the poll-specific bits (autosave, vote
 *     form, session identity) stripped.
 *   - Info popover wiring uses the same `info-popover.js` module the rest
 *     of the app uses; this component calls `wireInfoIcons()` on any fresh
 *     subtree it inserts.
 *   - Floating dropdowns (X/Y axis pickers, quality picker, target-item
 *     picker) are appended to document.body and positioned fixed so they
 *     escape overflow:hidden ancestors. Matches the main-app pattern.
 */

import { wireInfoIcons as _wireInfoIcons } from '../info-popover.js';

// ----------------------------------------------------------------------------
// DYNAMIC STYLE INJECTION
// ----------------------------------------------------------------------------
// The new X-per-Y recipe priority UI uses styles that live in the poll page's
// inline <style> block but not in styles.css. We inject them the first time
// a mount happens so the component is self-contained and we don't have to
// modify the shared stylesheet. Idempotent — running multiple times is safe.

const _STYLE_ID = 'xy-recipe-priority-list-styles';
// Exported so the activity-side sort list (which renders via
// renderSortList in settings-modal, not via mountXyPriorityList) can
// still get the reorder-strip CSS. Activity reuses the same .xy-reorder-strip
// class so the up/down arrows + hamburger layout matches recipe.
export function ensureXyStyles() { injectStylesOnce(); }
function injectStylesOnce() {
    if (document.getElementById(_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = _STYLE_ID;
    style.textContent = `
/* ========== X-per-Y Recipe Priority List ========== */

.xy-priority-entry .sort-item-content { flex: 1; min-width: 0; }
.xy-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 4px; }
.xy-wrap { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; }
.xy-wrap .mockup-dropdown-label { text-align: left; }
.xy-per {
    color: var(--text-muted); font-style: italic; user-select: none;
    min-width: 24px; text-align: center; font-size: 0.9em; padding-bottom: 8px;
}
.mockup-dropdown-label {
    display: block; font-size: 0.72em; color: var(--text-muted); margin-bottom: 3px;
}
.mockup-reveal { margin-top: 10px; }

.budget-inputs-row { display: flex; gap: 8px; flex-wrap: wrap; }
.budget-inputs-row .calculator-input-group { flex: 1; min-width: 130px; }
.budget-inputs-row .calculator-label {
    font-size: 0.72em; text-transform: none; letter-spacing: 0;
    display: block; margin-bottom: 3px; color: var(--text-muted);
}
.budget-inputs-row input {
    width: 100%; box-sizing: border-box; padding: 6px 8px;
    background: var(--bg-primary); color: var(--text-primary);
    border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.9em;
}

.xy-row-budget {
    display: flex; flex-direction: column; align-items: flex-start;
    gap: 2px; padding: 2px 0 6px 0;
}
.xy-budget-label { font-weight: 600; color: var(--text-primary); }
.xy-budget-hint {
    font-size: 0.82em; color: var(--text-muted); font-style: italic; cursor: help;
}

.axis-icon { width: 20px; height: 20px; flex-shrink: 0; vertical-align: middle; }

.xy-wrap .target-dropdown-value { display: flex; align-items: center; gap: 4px; }
.xy-dropdown-btn { padding-left: 6px; padding-right: 6px; }
.xy-dropdown-btn .target-dropdown-value { min-width: 0; flex: 1; }
.xy-dropdown-btn .target-dropdown-value span {
    white-space: normal; line-height: 1.15; word-break: break-word;
}

.target-dropdown.xy-floating .target-item {
    display: flex; align-items: center; gap: 6px;
}
.target-dropdown.xy-floating .target-item.disabled {
    opacity: 0.45; cursor: not-allowed; font-style: italic;
}
.target-dropdown.xy-floating .target-item.disabled:hover { background: transparent; }
.target-dropdown.xy-floating .target-item.quality-item {
    color: white; font-weight: 600;
}
.target-dropdown.xy-floating .target-item.quality-item.rarity-common    { background: var(--rarity-common); }
.target-dropdown.xy-floating .target-item.quality-item.rarity-uncommon  { background: var(--rarity-uncommon); }
.target-dropdown.xy-floating .target-item.quality-item.rarity-rare      { background: var(--rarity-rare); }
.target-dropdown.xy-floating .target-item.quality-item.rarity-epic      { background: var(--rarity-epic); }
.target-dropdown.xy-floating .target-item.quality-item.rarity-legendary { background: var(--rarity-legendary); }
.target-dropdown.xy-floating .target-item.quality-item.rarity-ethereal  { background: var(--rarity-ethereal); }
.target-dropdown.xy-floating .target-item.quality-item:hover { filter: brightness(1.1); }

.quality-btn-wrap .target-dropdown-button.rarity-common    { background: var(--rarity-common);    border-color: var(--rarity-common-border);    color: white; }
.quality-btn-wrap .target-dropdown-button.rarity-uncommon  { background: var(--rarity-uncommon);  border-color: var(--rarity-uncommon-border);  color: white; }
.quality-btn-wrap .target-dropdown-button.rarity-rare      { background: var(--rarity-rare);      border-color: var(--rarity-rare-border);      color: white; }
.quality-btn-wrap .target-dropdown-button.rarity-epic      { background: var(--rarity-epic);      border-color: var(--rarity-epic-border);      color: white; }
.quality-btn-wrap .target-dropdown-button.rarity-legendary { background: var(--rarity-legendary); border-color: var(--rarity-legendary-border); color: white; }
.quality-btn-wrap .target-dropdown-button.rarity-ethereal  { background: var(--rarity-ethereal);  border-color: var(--rarity-ethereal-border);  color: white; }

.target-item-btn-wrap .target-dropdown-value { display: flex; align-items: center; gap: 6px; }
/* Selected chip (dropdown closed) inside XY recipe priority list:
   default 32x32, dense icons 30x30, vertical-only negative margin to
   keep the row compact without shifting horizontal alignment. */
.target-item-btn-wrap .target-dropdown-value .target-icon {
    width: 32px; height: 32px; flex-shrink: 0;
    margin: -6px 0;
}
.target-item-btn-wrap .target-dropdown-value .target-icon[src*="/keywords/"],
.target-item-btn-wrap .target-dropdown-value .target-icon[src*="/coins.svg"],
.target-item-btn-wrap .target-dropdown-value .target-icon[src*="guild_token"],
.target-item-btn-wrap .target-dropdown-value .target-icon[src*="double_rewards"] {
    width: 30px; height: 30px;
    margin: -5px 0;
}

/* Dropdown items (open) inside XY recipe priority list: same sizes
   as the main dropdown but with tighter margins on all sides so the
   recipe Detailed/Quick settings panel stays compact. */
.target-dropdown.xy-floating .target-item .target-icon {
    width: 32px; height: 32px;
    margin: -6px -5px;
}
.target-dropdown.xy-floating .target-item .target-icon[src*="/keywords/"],
.target-dropdown.xy-floating .target-item .target-icon[src*="/coins.svg"],
.target-dropdown.xy-floating .target-item .target-icon[src*="guild_token"],
.target-dropdown.xy-floating .target-item .target-icon[src*="double_rewards"] {
    width: 30px; height: 30px;
    margin: -5px;
}

.xy-sort-list .sort-item,
.xy-sort-list-quick .xy-priority-entry {
    padding: 10px 10px 10px 6px;
}

/* The shared .sort-list rule in styles.css has min-height: 200px which was
   sized for Detailed-mode lists with many entries. In Quick mode we often
   have a single entry (e.g. Steps-for-Budget only) and the extra blank
   space under it looks like a rendering bug. Collapse the list to its
   natural height in Quick mode. */
.xy-sort-list-quick {
    min-height: 0;
    /* Also drop the max-height scroll cap — Quick mode entries are few
       enough that the outer column scrolls naturally, and an inner
       scrollbar visually competes with the column scrollbar. */
    max-height: none;
    overflow: visible;
}

.sort-add-wrapper { margin-bottom: var(--spacing-sm, 8px); }
.sort-add-btn {
    width: 100%; padding: 8px 12px;
    background: var(--bg-primary); color: var(--text-primary);
    border: 1px dashed var(--border-color); border-radius: 4px; cursor: pointer;
    font-size: 0.9em; transition: all 0.15s ease;
    display: flex; align-items: center; justify-content: center; gap: 8px;
}
.sort-add-btn:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
.sort-add-btn .expand-arrow { font-size: 0.7em; opacity: 0.7; }

.sort-weight-row { margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }

/* Weight slider: match the slider style used by Activity Optimization
   Settings (blue accent track via accent-color). Explicitly does NOT
   style the number input — leave that to the app's global input styles
   so it looks identical to the activity side. Also strips the UA
   number-input spinner arrows since the user doesn't want up/down
   arrows on the weight field itself. */
/* Weight slider — matches the activity optimization detailed settings:
   a flat linear-gradient background showing the filled portion in blue,
   applied as an inline style on input events (see updateSliderTrack
   below). Kept to bare height/padding here so the inline gradient
   renders uniformly across browsers. */
.sort-weight-row .weight-slider {
    flex: 1; min-width: 60px;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-primary);
    outline: none;
    cursor: pointer;
}
.sort-weight-row .weight-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    border: none;
}
.sort-weight-row .weight-slider::-moz-range-thumb {
    width: 16px; height: 16px;
    border-radius: 50%;
    background: var(--accent-primary);
    cursor: pointer;
    border: none;
}
.sort-weight-row .weight-input {
    width: 48px; padding: 3px 5px; font-size: 0.9em;
    text-align: right;
    -moz-appearance: textfield;  /* hide Firefox spinner */
}
.sort-weight-row .weight-input::-webkit-outer-spin-button,
.sort-weight-row .weight-input::-webkit-inner-spin-button {
    -webkit-appearance: none;    /* hide WebKit/Blink spinner */
    margin: 0;
}
.sort-weight-row .weight-pct { color: var(--text-secondary); font-size: 0.9em; }

/* Detailed-mode reorder strip: three buttons stacked vertically.
   Natural-height so it collapses when the row body is short (compact
   view) and spreads when the row is tall (edit view with X/Y
   dropdowns). align-self stretch matches the row height,
   justify-content space-between puts the up arrow at the top,
   down arrow at the bottom, and hamburger in the middle. */
.xy-reorder-strip {
    display: flex; flex-direction: column; align-items: stretch;
    justify-content: space-between;
    flex-shrink: 0;
    align-self: stretch;
    width: 34px;
    padding: 0 4px 0 0;
    user-select: none;
}
.xy-reorder-strip .xy-move-up,
.xy-reorder-strip .xy-move-down {
    flex: 0 0 auto;
    background: none; border: 1px solid transparent; border-radius: 4px;
    color: var(--text-muted); padding: 2px 0;
    cursor: pointer; font-size: 0.85em; line-height: 1;
    transition: all 0.12s ease;
    display: flex; align-items: center; justify-content: center;
}
.xy-reorder-strip .xy-move-up:hover:not(:disabled),
.xy-reorder-strip .xy-move-down:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
}
.xy-reorder-strip .xy-move-up:disabled,
.xy-reorder-strip .xy-move-down:disabled {
    opacity: 0.25; cursor: not-allowed;
}
.xy-reorder-strip .drag-handle {
    flex: 0 0 auto;
    padding: 4px 0;
    color: var(--text-muted);
    cursor: grab;
    font-size: 1.1em;
    display: flex; align-items: center; justify-content: center;
    /* Hint to the browser that this element drives touch-drag; avoids
       the mobile Safari "ghost image" flicker when starting a drag. */
    touch-action: none;
}
.xy-reorder-strip .drag-handle:active { cursor: grabbing; }

/* Per-entry action column. Grid layout:
   [duplicate, remove]
   [hide, edit]
   When no duplicate (budget): [remove], [hide], [edit] stacked.
   On narrow containers (.xy-list-narrow) everything stacks single-column. */
.sort-item-actions {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    gap: 3px; flex-shrink: 0; align-items: center; justify-items: center;
    transition: opacity 0.15s ease;
    /* Override the entry-level align-items:flex-start so the action
       column sits vertically centered on the card instead of pinned to
       the top corner. The priority badge above still gets flex-start
       via its own align-self rule. */
    align-self: center;
}
.sort-item-actions .sort-duplicate-btn { grid-column: 1; grid-row: 1; }
.sort-item-actions .sort-remove-btn    { grid-column: 2; grid-row: 1; }
.sort-item-actions .sort-hide-btn      { grid-column: 1; grid-row: 2; }
.sort-item-actions .sort-edit-btn      { grid-column: 2; grid-row: 2; }
.sort-item-actions.no-duplicate { display: flex; flex-direction: row; gap: 3px; }
.sort-item-actions.no-duplicate .sort-hide-btn   { order: 1; }
.sort-item-actions.no-duplicate .sort-remove-btn { order: 2; }

/* Unified icon-button sizing for the 4 action icons (duplicate, remove,
   hide, edit). Before this, each button had its own padding/border
   style — edit had a visible border + 14x14 svg, the others had
   transparent borders + 16x16 svgs. Normalize to one consistent
   footprint so all four look like a quartet. Scoped to
   .sort-item-actions so it doesn't touch activity's legacy
   .sort-remove-btn/.sort-duplicate-btn usage in styles.css. */
.sort-item-actions .sort-duplicate-btn,
.sort-item-actions .sort-remove-btn,
.sort-item-actions .sort-hide-btn,
.sort-item-actions .sort-edit-btn {
    box-sizing: border-box;
    width: 30px; height: 30px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
/* Override the hide/edit in the grid — now they're
   fixed-size square icons. */
.sort-item-actions .sort-duplicate-btn svg,
.sort-item-actions .sort-remove-btn svg,
.sort-item-actions .sort-hide-btn svg,
.sort-item-actions .sort-edit-btn svg {
    width: 16px; height: 16px;
}

/* Edit-mode pencil button (per-entry + global). Yellow when active,
   muted when inactive. Base border/size is set by the unified
   .sort-item-actions rule above; this rule handles color/hover/active
   states and styling for the global edit button (which is outside
   .sort-item-actions and needs its own padding/border). */
.sort-edit-btn, .xy-global-edit-btn {
    background: transparent;
    color: var(--text-muted); cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.xy-global-edit-btn {
    border: 1px solid var(--border-color);
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-flex; align-items: center;
    justify-content: center; gap: 4px; font-size: 0.85em;
}
.sort-edit-btn:hover, .xy-global-edit-btn:hover {
    color: #00bfff; border-color: #00bfff;
    background: rgba(0, 191, 255, 0.1);
}
.sort-edit-btn.active, .xy-global-edit-btn.active {
    color: #00bfff; border-color: #00bfff;
    box-shadow: 0 0 6px rgba(0, 191, 255, 0.5);
}
.sort-edit-btn svg, .xy-global-edit-btn svg {
    stroke: currentColor; stroke-width: 2;
    fill: none; stroke-linecap: round; stroke-linejoin: round;
}
.xy-global-edit-btn svg { width: 14px; height: 14px; }

/* Global edit toggle bar — rendered at the top of the list container
   in both Detailed and Quick modes. Positioned as a single right-
   aligned button so it reads visually as "on the right of the
   optimization settings heading" above the mount. No border, minimal
   padding — the button is the whole UI. */
.xy-global-edit-bar {
    display: flex; align-items: center; justify-content: flex-end;
    padding: 2px 0 6px 0; margin-bottom: 0;
    font-size: 0.85em; color: var(--text-muted);
    user-select: none;
}
.xy-global-edit-bar .xy-global-edit-label { display: none; }

/* When the bar is rendered into the Quick panel header slot, drop the
   extra vertical padding so the button lines up with the title text
   and don't add a trailing margin that shifts the content below. */
.quick-opt-edit-bar-slot .xy-global-edit-bar {
    padding: 0;
    margin: 0;
}

/* Quick panel heading row layout: flex with:
   [arrow][title] take up available space, [(i)] fixed, [Edit all] fixed right.
   On narrow: title text wraps while (i) and Edit all hold position.
   The parent .quick-opt-settings-header already has display:flex +
   gap:6px + align-items:center from styles.css. We override with
   specific behavior here. */
.quick-opt-settings-header {
    flex-wrap: nowrap !important;
}
/* Title takes leftover space so (i) and edit are pushed right. */
.quick-opt-settings-header .quick-opt-settings-title {
    flex: 1 1 auto;
    min-width: 0;
}
.quick-opt-settings-header .quick-opt-header-info {
    flex: 0 0 auto;
    padding: 0 2px;
}
.quick-opt-settings-header .quick-opt-header-info:hover { opacity: 1; }
.quick-opt-settings-header .quick-opt-edit-bar-slot {
    flex: 0 0 auto;
    cursor: default;
}

/* Compact X/Y text shown when editing=false. One bold line with
   wrap, inline with the weight slider column. The reveal section
   (target-quality / target-item picker) remains visible below. */
.xy-row-compact {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 4px; padding: 2px 0;
}
.xy-row-compact .xy-compact-label {
    font-weight: 700; color: var(--text-primary);
    white-space: normal; word-break: break-word; line-height: 1.2;
}

.sort-hide-btn {
    background: none; border: 1px solid transparent; border-radius: 4px;
    color: var(--text-muted); padding: 4px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;
}
.sort-hide-btn:hover {
    background: rgba(241, 196, 15, 0.1);
    border-color: #f1c40f; color: #f1c40f;
}
.entry-hidden-in-quick .sort-hide-btn {
    color: #f1c40f; border-color: rgba(241, 196, 15, 0.35);
}

.quick-empty-hint {
    padding: 14px 16px; font-size: 0.85em; color: var(--text-muted);
    background: var(--bg-primary); border: 1px dashed var(--border-color);
    border-radius: 4px; line-height: 1.5;
}

/* Quick-mode list is bounded and scrollable — matches the previous Quick
   panel which stayed compact at the top of Column 3. Without this the
   list grows unboundedly and pushes the Optimize button far down. */
.xy-sort-list-quick {
    max-height: 320px;
    overflow-y: auto;
    overflow-x: hidden;
    /* Leave a little padding so the last entry isn't flush against the
       bottom edge when the list is scrolled to the end. */
    padding-right: 2px;
}

/* Quick-mode entries are slimmer flat rows — no card border, no drag cursor. */
.xy-priority-entry-quick {
    display: flex; align-items: center; gap: var(--spacing-sm, 8px);
    padding: 6px 2px;
}
.xy-priority-entry-quick + .xy-priority-entry-quick {
    border-top: 1px dashed var(--border-color);
}

/* Priority-number badge — positioned top-right of the row so it doesn't
   steal horizontal space from the X/Y dropdowns, and so the index is
   visible at a glance without scanning down the row. */
.xy-priority-badge {
    font-size: 0.72em; color: var(--text-muted); font-weight: 600;
    padding: 2px 4px 0 4px; min-width: 22px; text-align: right;
    align-self: flex-start; white-space: nowrap;
}
.xy-priority-entry { align-items: flex-start; }
.xy-priority-entry-quick { display: flex; align-items: flex-start; }
.xy-priority-entry-quick .sort-item-content { flex: 1; min-width: 0; }

/* Group collapsed row — shared target dropdown, combined label, (i) info,
   expand arrow on the right. */
.xy-priority-group {
    display: flex; align-items: center; gap: var(--spacing-sm, 8px);
    padding: 8px 4px; border-bottom: 1px dashed var(--border-color);
}
.xy-priority-group + .xy-priority-entry-quick,
.xy-priority-entry-quick + .xy-priority-group {
    border-top: none;
}
.xy-priority-group .sort-item-content { flex: 1; min-width: 0; }
.xy-group-label {
    font-size: 0.85em; color: var(--text-secondary);
    margin-bottom: 4px; font-weight: 600;
}
.xy-group-info { font-style: normal; margin-left: 2px; cursor: help; }
.xy-group-expand {
    cursor: pointer; color: var(--text-muted);
    padding: 4px 6px; user-select: none; align-self: center;
    transition: transform 0.15s ease;
}
.xy-group-expand:hover { color: var(--accent-primary); }
.xy-group-expand .expand-arrow {
    font-size: 0.9em; display: inline-block;
    transition: transform 0.15s ease;
    transform: rotate(-90deg);
}
.xy-group-expand.expanded .expand-arrow { transform: rotate(0deg); }

/* Expanded group member — rendered just below its group row with a
   subtle left indent so the hierarchy is readable. */
.xy-priority-entry-quick.xy-entry-expanded {
    padding-left: 18px; border-top: 1px dotted var(--border-color);
    background: rgba(255, 255, 255, 0.02);
}
.xy-priority-entry-quick.xy-entry-expanded + .xy-priority-entry-quick.xy-entry-expanded {
    border-top: 1px dotted var(--border-color);
}

/* Wrapper holding all the expanded members of a group. Starts hidden
   (display:none via inline style when collapsed) and is shown/hidden
   with jQuery slideDown/slideUp so toggling the group animates. */
.xy-group-members-wrap {
    overflow: hidden;
}
.xy-group-members-wrap > .xy-priority-entry-quick.xy-entry-expanded:first-child {
    border-top: 1px dotted var(--border-color);
}

/* Shared-target dropdown wrapper inside the group row. Slid up when
   expanded (since the individual members below each have their own
   target dropdowns — showing a global one would be redundant). */
.xy-group-shared-target {
    overflow: hidden;
}
.xy-priority-group.group-expanded .xy-group-shared-target {
    display: none;
}

/* Narrow container: stack X/Y vertically and compact the action column.
   Triggered by the .xy-list-narrow class, applied via a ResizeObserver
   on each mounted list root (see watchContainerWidth below). This avoids
   CSS container queries, which imply layout containment and in some
   browsers interfere with the floating-dropdown positioning (the axis
   pickers escape overflow:hidden ancestors via position:fixed on body,
   but container-type: inline-size subtly breaks that path). */
.xy-list-narrow .xy-row { flex-direction: column; align-items: stretch; gap: 4px; }
.xy-list-narrow .xy-wrap { width: 100%; }
.xy-list-narrow .xy-per { padding-bottom: 0; padding: 2px 0; text-align: center; }
/* Narrow container: default to 2×2 grid (saves vertical space when
   entry is compact/non-editing). When editing, switch to single-column
   so the taller row has a slimmer action strip. */
.xy-list-narrow .sort-item-actions {
    grid-template-columns: auto auto; grid-template-rows: auto auto;
}
.xy-list-narrow .sort-item-actions .sort-remove-btn    { grid-column: 2; grid-row: 1; }
.xy-list-narrow .sort-item-actions .sort-duplicate-btn { grid-column: 1; grid-row: 1; }
.xy-list-narrow .sort-item-actions .sort-hide-btn      { grid-column: 1; grid-row: 2; }
.xy-list-narrow .sort-item-actions .sort-edit-btn      { grid-column: 2; grid-row: 2; }
/* When editing: single-column to save horizontal space on the tall row. */
.xy-list-narrow .xy-entry-editing .sort-item-actions {
    grid-template-columns: auto; grid-template-rows: auto auto auto auto;
}
.xy-list-narrow .xy-entry-editing .sort-item-actions .sort-remove-btn    { grid-column: 1; grid-row: 1; }
.xy-list-narrow .xy-entry-editing .sort-item-actions .sort-duplicate-btn { grid-column: 1; grid-row: 2; }
.xy-list-narrow .xy-entry-editing .sort-item-actions .sort-hide-btn      { grid-column: 1; grid-row: 3; }
.xy-list-narrow .xy-entry-editing .sort-item-actions .sort-edit-btn      { grid-column: 1; grid-row: 4; }
/* Legacy viewport fallback — phones always get the mobile layout. */
@media (max-width: 480px) {
    .xy-row { flex-direction: column; align-items: stretch; gap: 4px; }
    .xy-wrap { width: 100%; }
    .xy-per { padding-bottom: 0; padding: 2px 0; text-align: center; }
    .sort-item-actions {
        grid-template-columns: auto auto; grid-template-rows: auto auto;
    }
    .sort-item-actions .sort-remove-btn    { grid-column: 2; grid-row: 1; }
    .sort-item-actions .sort-duplicate-btn { grid-column: 1; grid-row: 1; }
    .sort-item-actions .sort-hide-btn      { grid-column: 1; grid-row: 2; }
    .sort-item-actions .sort-edit-btn      { grid-column: 2; grid-row: 2; }
    .xy-entry-editing .sort-item-actions {
        grid-template-columns: auto; grid-template-rows: auto auto auto auto;
    }
    .xy-entry-editing .sort-item-actions .sort-remove-btn    { grid-column: 1; grid-row: 1; }
    .xy-entry-editing .sort-item-actions .sort-duplicate-btn { grid-column: 1; grid-row: 2; }
    .xy-entry-editing .sort-item-actions .sort-hide-btn      { grid-column: 1; grid-row: 3; }
    .xy-entry-editing .sort-item-actions .sort-edit-btn      { grid-column: 1; grid-row: 4; }
}

/* Keep the shared (i) popover above our floating dropdown. */
.info-popover { z-index: 20000 !important; }
    `;
    document.head.appendChild(style);
}

// Safe wrapper around wireInfoIcons that tolerates jQuery objects, arrays,
// NodeLists, and $.parseHTML results (whose first entry may be a text
// node that the raw wireInfoIcons chokes on).
function wireInfoIcons(target) {
    if (!target) return;
    if (typeof target.each === 'function' && typeof target.get === 'function') {
        target.each((_, el) => { if (el && el.nodeType === 1) _wireInfoIcons(el); });
        return;
    }
    if (typeof target.length === 'number' && typeof target !== 'string') {
        for (const el of target) if (el && el.nodeType === 1) _wireInfoIcons(el);
        return;
    }
    if (target.nodeType === 1) _wireInfoIcons(target);
}

// Find the nearest ancestor of $el that is actually scrollable (has
// overflow-y: auto/scroll and has scrollTop > 0 capability). Used by
// render() to preserve the outer scroll position when we rebuild the
// panel — without this, the user's scroll jumps to the top every time
// they click duplicate/remove/hide.
function findScrollableAncestor($el) {
    if (!$el || !$el.length) return null;
    let node = $el[0].parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight;
        if (canScroll) return $(node);
        node = node.parentElement;
    }
    return null;
}

// ----------------------------------------------------------------------------
// CONSTANTS
// ----------------------------------------------------------------------------

// Axis catalog. Some axes are x-only (total_crafts is always X because
// "X per Total Crafts" collapses to "X per Craft") or y-only (Craft, Step
// are always denominators; Quality and Target item are always targets).
//
// Note: 'displayed_steps' was removed from the dropdown per user feedback
// (few people use it vs. the probability-weighted expected_steps). Any
// existing entries saved with x='displayed_steps' are silently migrated
// to x='expected_steps' in normalizeEntry below.
// Axis catalog. Some axes are x-only (total_crafts is always X because
// "X per Total Crafts" collapses to "X per Craft") or y-only (Craft, Step
// are always denominators; Quality and Target item are always targets).
//
// Naming notes:
//   - The X option "expected_steps" is labeled "Steps" (not "Expected
//     Steps") because the distinction doesn't read well in the UI — the
//     user thinks in "steps per X" and rarely cares about the
//     expected-vs-displayed nuance.
//   - The Y option "step" (and only "step") is the denominator for "XP
//     per step" etc. The old Y option "expected_steps" was removed
//     entirely since it duplicated "step" — any entry saved with
//     y='expected_steps' is migrated to y='step' in normalizeEntry.
//   - The action icon is a green checkmark with a black border. Inlined
//     as a data: URL so we don't depend on a specific asset file.
const _ACTION_ICON_DATA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path d="M5 12.5 L10 17.5 L19 7.5" fill="none" stroke="#000000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M5 12.5 L10 17.5 L19 7.5" fill="none" stroke="#27ae60" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
);
export const AXIS_OPTIONS = [
    { value: 'action', label: 'Action', yOnly: false, xOnly: false, icon: _ACTION_ICON_DATA },
    { value: 'craft', label: 'Craft', yOnly: true, xOnly: false, icon: '/assets/icons/attributes/double_rewards.svg' },
    { value: 'expected_steps', label: 'Steps', yOnly: false, xOnly: true, icon: '/assets/icons/attributes/steps_required.svg' },
    { value: 'materials', label: 'Materials', yOnly: false, xOnly: false, icon: '/assets/icons/attributes/materials.svg' },
    { value: 'quality', label: 'Quality', yOnly: true, xOnly: false, needs: 'quality', icon: '/assets/icons/attributes/quality_outcome.svg' },
    { value: 'step', label: 'Step', yOnly: true, xOnly: false, icon: '/assets/icons/attributes/steps_required.svg' },
    { value: 'target_item', label: 'Target item', yOnly: true, xOnly: false, needs: 'target_item', icon: '/assets/icons/keywords/chest.svg' },
    { value: 'total_crafts', label: 'Total Crafts', yOnly: false, xOnly: true, icon: '/assets/icons/attributes/double_rewards.svg' },
    { value: 'xp', label: 'XP', yOnly: false, xOnly: false, icon: '/assets/icons/attributes/bonus_experience.svg' },
];

const X_OPTIONS = AXIS_OPTIONS.filter(o => !o.yOnly);
const Y_OPTIONS = AXIS_OPTIONS.filter(o => !o.xOnly);

const QUALITIES = [
    { value: 'Normal', cls: 'rarity-common' },
    { value: 'Good', cls: 'rarity-uncommon' },
    { value: 'Great', cls: 'rarity-rare' },
    { value: 'Excellent', cls: 'rarity-epic' },
    { value: 'Perfect', cls: 'rarity-legendary' },
    { value: 'Eternal', cls: 'rarity-ethereal' },
];

// Recipe-only target category. Activities have more but this component
// only covers recipe optimization, which has exactly one target category
// today (chests — the recipe's output when it's a chest).
// `_chestsCategory(recipeSkill)` returns the Chests category with the
// info tooltip showing the skill-specific chest name (e.g. "Tailoring
// chest" for a tailoring recipe). Falls back to "Primary chest" when
// skill is null (e.g. settings modal with no active recipe).
function _chestsCategory(recipeSkill) {
    const skill = (recipeSkill || '').trim();
    if (skill) {
        const chestName = skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase() + ' chest';
        return { value: 'cat:chests', name: 'Chests', icon: '/assets/icons/keywords/chest.svg', infoItems: [chestName] };
    }
    return { value: 'cat:chests', name: 'Chests', icon: '/assets/icons/keywords/chest.svg', infoItems: ['Primary chest'] };
}
const BASE_TARGET_CATEGORIES = [
    // Alphabetical order: Chests, Coins, Coins (no chests). The two
    // Coins targets are synthetic aggregates — the optimizer computes
    // expected coin yield per craft (quality-weighted output value +
    // side drops like Silver nugget on smelting, plus chest sell value
    // for the non-"no chests" variant).
    _chestsCategory(null),
    // Regular drop_table entries — rendered like normal droppable items
    // (no IF italics/opacity/✦ prefix, not gated by Include item finding
    // toggle). When a recipe doesn't drop the item, the existing NA-in-yellow
    // fallback applies via the unresolved target path.
    { value: 'cat:drop:silver_nugget', name: 'Silver Nugget', icon: '/assets/icons/items/materials/silver_nugget.svg' },
    { value: 'cat:drop:silver_nugget_fine', name: 'Silver Nugget (Fine)', icon: '/assets/icons/items/materials/silver_nugget.svg', isFine: true },
    // Synthetic Coins aggregate targets (see coin_value.py). Alphabetical
    // order keeps them next to Chests/Silver Nugget in the dropdown.
    { value: 'cat:coins', name: 'Coins', icon: '/assets/icons/items/coins.svg' },
    { value: 'cat:coins_no_chests', name: 'Coins (no chests)', icon: '/assets/icons/items/coins.svg' },
];

// Item-finding categories shown when "Include item finding categories"
// is enabled. Matches the poll (recipe-compatible IF drops only).
const IF_CATEGORIES = [
    { value: 'cat:if:adventurers_guild_tokens', name: "Adventurers' Guild Tokens", icon: "/assets/icons/items/adventurers'_guild_token.svg", infoItems: ["Adventurers' guild token"] },
    { value: 'cat:if:ectoplasm', name: 'Ectoplasm', icon: '/assets/icons/items/materials/ectoplasm.svg', infoItems: ['Ectoplasm'] },
    { value: 'cat:if:ectoplasm_fine', name: 'Ectoplasm (Fine)', icon: '/assets/icons/items/materials/ectoplasm.svg', isFine: true, infoItems: ['Ectoplasm (Fine)'] },
    { value: 'cat:if:gold_nugget', name: 'Gold Nugget', icon: '/assets/icons/items/materials/gold_nugget.svg', infoItems: ['Gold nugget'] },
    { value: 'cat:if:gold_nugget_fine', name: 'Gold Nugget (Fine)', icon: '/assets/icons/items/materials/gold_nugget.svg', isFine: true, infoItems: ['Gold nugget (Fine)'] },
    { value: 'cat:if:random_gem', name: 'Random Gem', icon: '/assets/icons/keywords/gem.svg', infoItems: ['Rough opal', 'Rough star pearl', 'Rough topaz', 'Rough wrentmarine', 'Rough jade', 'Rough ruby', 'Rough sun stone', 'Rough ethernite'] },
    { value: 'cat:if:random_gem_fine', name: 'Random Gem (Fine)', icon: '/assets/icons/keywords/gem.svg', isFine: true, infoItems: ['Rough opal (Fine)', 'Rough star pearl (Fine)', 'Rough topaz (Fine)', 'Rough wrentmarine (Fine)', 'Rough jade (Fine)', 'Rough ruby (Fine)', 'Rough sun stone (Fine)', 'Rough ethernite (Fine)'] },
    { value: 'cat:if:random_piece_of_junk', name: 'Random Piece of Junk', icon: '/assets/icons/keywords/trash.svg', infoItems: ['Trash', 'Fishbone', 'Grass', 'Mud', 'Copper arrows', 'Milkweed', 'Moondaisy', 'Sea shell', 'Birch skis', 'Clay skydisc', 'Rough opal', 'Simple torch', 'Rusty chest', 'Sunken chest'] },
    { value: 'cat:if:random_piece_of_junk_fine', name: 'Random Piece of Junk (Fine)', icon: '/assets/icons/keywords/trash.svg', isFine: true, infoItems: ['Trash (Fine)', 'Fishbone (Fine)', 'Grass (Fine)', 'Mud (Fine)', 'Copper arrows (Fine)', 'Milkweed (Fine)', 'Moondaisy (Fine)', 'Sea shell (Fine)'] },
    { value: 'cat:if:sea_shells', name: 'Sea Shells', icon: '/assets/icons/items/materials/sea_shell.svg', infoItems: ['Sea shell'] },
    { value: 'cat:if:skill_chest', name: 'Random Skill Chest', icon: '/assets/icons/keywords/skilling_chest.svg', infoItems: ['Agility chest', 'Carpentry chest', 'Cooking chest', 'Crafting chest', 'Fishing chest', 'Foraging chest', 'Hunting chest', 'Mining chest', 'Smithing chest', 'Tailoring chest', 'Trinketry chest', 'Woodcutting chest'] },
];

let _nextEntryId = 1;

function clampWeight(n) {
    const parsed = Number(n);
    if (isNaN(parsed)) return 100;
    return Math.max(0, Math.min(100, Math.floor(parsed)));
}

// Build the default recipe priority list. Keep in sync with the
// `DEFAULT_RECIPE_ORDER` + `LEGACY_RECIPE_KEY_MIGRATION` tables in
// ui/optimization_settings_migration.py so server and client agree on
// what "reset to default" means for recipe sorting. The reset-to-default
// button in the inline panel calls this to rebuild recipeSorting.
//
// Order matches the server (skipping `current_steps` / displayed_steps
// which was removed from the axis options per user feedback).
export function defaultRecipeEntries() {
    return [
        makeRatioEntry('materials', 'quality', { hiddenInQuick: false }),   // materials_for_target
        makeRatioEntry('total_crafts', 'quality', { hiddenInQuick: false }),   // total_crafts
        makeRatioEntry('expected_steps', 'craft', { hiddenInQuick: true }),    // expected_steps_per_item
        makeRatioEntry('materials', 'craft', { hiddenInQuick: true }),    // materials_per_craft
        makeRatioEntry('xp', 'step', { hiddenInQuick: true }),    // primary_xp_per_step
        makeRatioEntry('expected_steps', 'quality', { hiddenInQuick: false }),   // steps_for_target
        makeRatioEntry('xp', 'action', { hiddenInQuick: true }),    // primary_xp_per_action
        makeRatioEntry('materials', 'target_item', { hiddenInQuick: true, targetItem: 'cat:chests' }),  // materials_per_chest
        makeBudgetEntry({ hiddenInQuick: false }),    // steps_for_budget
        makeRatioEntry('xp', 'materials', { hiddenInQuick: true }),    // xp_per_material
    ];
}

// Create a ratio entry. `extras` may override quality/targetItem/weight/hiddenInQuick/editing.
// `editing` defaults to false (compact display). Callers that want the
// dropdowns visible from the get-go (e.g. add/duplicate handlers) pass
// `editing: true` so the user can pick X/Y axes immediately.
export function makeRatioEntry(x, y, extras = {}) {
    return {
        id: _nextEntryId++,
        mode: 'ratio',
        x, y,
        quality: extras.quality || 'Perfect',
        targetItem: extras.targetItem || null,
        weight: typeof extras.weight === 'number' ? clampWeight(extras.weight) : 100,
        hiddenInQuick: !!extras.hiddenInQuick,
        editing: !!extras.editing,
    };
}

// Create a budget entry.
export function makeBudgetEntry(extras = {}) {
    return {
        id: _nextEntryId++,
        mode: 'budget',
        budgetMats: extras.budgetMats || '',
        budgetTarget: extras.budgetTarget || '',
        weight: typeof extras.weight === 'number' ? clampWeight(extras.weight) : 100,
        hiddenInQuick: !!extras.hiddenInQuick,
    };
}

// Normalize an entry from the server into the in-memory shape. Assigns a
// local ID if one isn't present (IDs are not persisted across sessions).

// Dedup entries by strict signature (x, y, targetItem, quality-if-quality-Y).
// Handles the displayed_steps→expected_steps silent migration producing
// duplicates (e.g. two "Steps/Craft" entries from expected_steps_per_item +
// current_steps). Keeps the first occurrence.
function dedupEntries(entries) {
    const seen = new Set();
    return entries.filter(e => {
        const sig = e.mode === 'budget'
            ? 'budget'
            : `${e.x}|${e.y}|${e.targetItem || ''}|${e.y === 'quality' ? (e.quality || '') : ''}`;
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
    });
}

function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'number' ? raw.id : _nextEntryId++;
    if (id >= _nextEntryId) _nextEntryId = id + 1;
    if (raw.mode === 'budget') {
        return {
            id,
            mode: 'budget',
            budgetMats: typeof raw.budgetMats === 'string' ? raw.budgetMats : '',
            budgetTarget: typeof raw.budgetTarget === 'string' ? raw.budgetTarget : '',
            weight: clampWeight(raw.weight),
            hiddenInQuick: !!raw.hiddenInQuick,
        };
    }
    if (raw.mode !== 'ratio') return null;
    // Silent migrations for axis values removed from AXIS_OPTIONS:
    //   - 'displayed_steps' collapsed into 'expected_steps' (X only) so
    //     saved entries still have a valid label and still score.
    //   - Y='expected_steps' collapsed into Y='step' since users want a
    //     single "per step" option (they don't need to differentiate
    //     expected vs displayed in the Y denominator).
    let x = raw.x;
    let y = raw.y;
    if (x === 'displayed_steps') x = 'expected_steps';
    if (y === 'displayed_steps') y = 'step';
    if (y === 'expected_steps') y = 'step';
    // Silent migration (2026-05-31): cat:if:sea_shells_fine target was
    // removed when the 'cat:sea_shells' synthetic aggregator landed —
    // fine sea shells fold into normals automatically. Recipes never
    // had cat:sea_shells_fine in BASE since the synthetic was always
    // activity-only, so only the IF variant needs rewriting here.
    let targetItem = raw.targetItem || null;
    if (targetItem === 'cat:if:sea_shells_fine') targetItem = 'cat:if:sea_shells';
    return {
        id,
        mode: 'ratio',
        x,
        y,
        quality: raw.quality || 'Perfect',
        targetItem,
        weight: clampWeight(raw.weight),
        hiddenInQuick: !!raw.hiddenInQuick,
        // `editing` flag — when true, the row shows the X/Y dropdowns for
        // editing; when false, it shows the compact "X/Y" text label.
        // Legacy entries without this field default to false so existing
        // users see the familiar compact view.
        editing: !!raw.editing,
    };
}

function isValidAsY(xVal, yVal) {
    if (xVal === yVal) return false;
    const y = AXIS_OPTIONS.find(o => o.value === yVal);
    if (!y) return false;
    if (y.xOnly) return false;
    if (yVal === 'target_item' && xVal === 'target_item') return false;
    return true;
}

function axisIconHtml(value) {
    const opt = AXIS_OPTIONS.find(o => o.value === value);
    if (!opt || !opt.icon) return '';
    return `<img src="${opt.icon}" alt="" class="axis-icon" onerror="this.style.display='none'" />`;
}

function xLabel(val) { return AXIS_OPTIONS.find(o => o.value === val)?.label || val; }
function yLabel(val) { return AXIS_OPTIONS.find(o => o.value === val)?.label || val; }
function yOption(val) { return AXIS_OPTIONS.find(o => o.value === val); }

// Returns false when `val` maps to a drop_table item NOT present in the
// current recipe's drop table; true otherwise (including for unknown values
// and missing data, so new categories default to "assume valid"). Only
// cat:drop:* entries currently gate on recipe drop_table contents — chests
// and cat:if:* are handled elsewhere.
function isTargetAvailable(val, recipeDropTable) {
    if (!val || !val.startsWith('cat:drop:')) return true;
    if (!Array.isArray(recipeDropTable)) return true;
    const DROP_CATEGORY_ITEM_REFS = {
        'cat:drop:silver_nugget': 'Material.SILVER_NUGGET',
        'cat:drop:silver_nugget_fine': 'Material.SILVER_NUGGET',
    };
    const itemRef = DROP_CATEGORY_ITEM_REFS[val];
    if (!itemRef) return true;
    const requiresFine = val.endsWith('_fine');
    return recipeDropTable.some(d =>
        d && d.item_ref === itemRef && (!requiresFine || d.has_fine_material === true)
    );
}

function displayTargetItem(val, recipeSkill, recipeDropTable) {
    if (!val) return '<span>Select…</span>';
    // For cat:chests, derive the chest name from the recipe's skill so
    // the (ⓘ) tooltip shows e.g. "Tailoring chest" for a tailoring
    // recipe instead of the hardcoded "Primary chest".
    const base = val === 'cat:chests' ? _chestsCategory(recipeSkill) : BASE_TARGET_CATEGORIES.find(c => c.value === val);
    const ifCat = IF_CATEGORIES.find(c => c.value === val);
    const cat = base || ifCat;
    if (!cat) {
        if (val.startsWith('if:')) return `<span>${val.slice(3)}</span>`;
        return `<span>${val}</span>`;
    }
    const fineClass = cat.isFine ? 'fine-item' : '';
    const unavailable = !isTargetAvailable(val, recipeDropTable);
    const unavailableStyle = unavailable ? ' style="opacity:0.5;font-style:italic;"' : '';
    const naLabel = unavailable ? ' <span style="color:#f1c40f;font-size:0.8em;font-weight:bold;">N/A</span>' : '';
    const iconHtml = cat.icon
        ? `<img src="${cat.icon}" alt="${cat.name}" class="target-icon ${fineClass}" onerror="this.style.display='none'" />`
        : '';
    let infoHtml = '';
    if (cat.infoItems && cat.infoItems.length > 0 && !unavailable) {
        const itemListHtml = cat.infoItems.map(name => {
            const isFine = name.includes('(Fine)');
            const baseName = name.replace(/ \(Fine\)/, '').trim();
            const iconName = baseName.toLowerCase().replace(/ /g, '_').replace(/'/g, "'");
            const iconPath = _guessItemIconPath(iconName, cat.value);
            const fineStyle = isFine ? ' filter:drop-shadow(1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(-1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(0 1px 0 var(--fine-color,#4fc3f7)) drop-shadow(0 -1px 0 var(--fine-color,#4fc3f7));' : '';
            return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;"><img src="${iconPath}" style="width:32px;height:32px;${fineStyle}" onerror="this.style.display='none'" /><span>${name}</span></div>`;
        }).join('');
        const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
        infoHtml = ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.9em;font-style:normal;">ⓘ</span>`;
    }
    return `${iconHtml}<span${unavailableStyle}>${cat.name}${naLabel}${infoHtml}</span>`;
}

// ----------------------------------------------------------------------------
// FLOATING DROPDOWN (fixed-position, appended to document.body)
// ----------------------------------------------------------------------------

let _openDropdown = null; // { $el, $triggerArrow, onClose, for, openAbove }
// Guard so window resize/scroll reflow doesn't fight the open animation
// by overwriting `top` while jQuery.animate is driving it.
let _animatingOpen = false;

// ----------------------------------------------------------------------------
// AUTO-SCROLL HELPERS (shared across all mounts)
// ----------------------------------------------------------------------------
// During touch drag, when the finger nears the top or bottom of the active
// scroll container, kick off a velocity-based scroll loop so the list can
// continue being reordered without the user having to manually scroll.
//
// `findScrollParent` walks up from the given element looking for the nearest
// ancestor with overflow-y auto/scroll AND a scrollable scrollHeight. Falls
// back to document.scrollingElement so it always returns something scrollable.

function findScrollParent(el) {
    let node = el && el.parentElement;
    while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const oy = style.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
            return node;
        }
        node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
}
export { findScrollParent };

let _autoScrollRAF = null;
let _autoScrollVelocity = 0;
let _autoScrollTarget = null;

function _autoScrollStep() {
    if (!_autoScrollTarget || _autoScrollVelocity === 0) {
        _autoScrollRAF = null;
        return;
    }
    _autoScrollTarget.scrollTop += _autoScrollVelocity;
    _autoScrollRAF = requestAnimationFrame(_autoScrollStep);
}

function updateAutoScroll(clientY, scrollParent) {
    if (!scrollParent) { stopAutoScroll(); return; }
    _autoScrollTarget = scrollParent;
    const rect = scrollParent === document.scrollingElement || scrollParent === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scrollParent.getBoundingClientRect();
    const EDGE = 60;   // distance from edge that starts scroll
    const MAX = 14;    // max px per frame at the edge
    const fromTop = clientY - rect.top;
    const fromBot = rect.bottom - clientY;
    if (fromTop < EDGE && fromTop > -EDGE) {
        // Scale 0 at EDGE -> 1 at 0, clamp negative (finger past top).
        const r = Math.max(0, Math.min(1, 1 - fromTop / EDGE));
        _autoScrollVelocity = -Math.round(MAX * r);
    } else if (fromBot < EDGE && fromBot > -EDGE) {
        const r = Math.max(0, Math.min(1, 1 - fromBot / EDGE));
        _autoScrollVelocity = Math.round(MAX * r);
    } else {
        _autoScrollVelocity = 0;
    }
    if (_autoScrollVelocity !== 0 && !_autoScrollRAF) {
        _autoScrollRAF = requestAnimationFrame(_autoScrollStep);
    }
}

function stopAutoScroll() {
    if (_autoScrollRAF) { cancelAnimationFrame(_autoScrollRAF); _autoScrollRAF = null; }
    _autoScrollVelocity = 0;
    _autoScrollTarget = null;
}
export { updateAutoScroll, stopAutoScroll };

function closeGlobalDropdown(immediate = false) {
    if (!_openDropdown) return;
    const { $el, $triggerArrow, onClose, openAbove } = _openDropdown;
    _openDropdown = null;
    if ($triggerArrow) $triggerArrow.removeClass('expanded');
    if (immediate) {
        $el.remove();
        if (onClose) onClose();
    } else if (openAbove) {
        // Collapse downward toward trigger (reverse of open animation).
        // At this point $el is visible at finalTop with its natural
        // rendered height — safe to read offsetHeight.
        const curTop = parseInt($el.css('top'), 10);
        const curHeight = $el[0].offsetHeight;
        $el.css({ overflow: 'hidden' });
        $el.animate({
            top: (curTop + curHeight) + 'px',
            height: '0px',
        }, 180, () => { $el.remove(); if (onClose) onClose(); });
    } else {
        $el.slideUp(180, () => {
            $el.remove();
            if (onClose) onClose();
        });
    }
}

// Position the floating dropdown under (or above) the trigger. Returns
// the measurement/placement info the caller needs to drive the open
// animation: { openAbove, finalTop, finalHeight, triggerRect }. Natural
// height is measured via a visibility:hidden + display:block flip so
// offsetHeight is readable (a display:none element always reports 0).
// finalHeight is returned so openDropdownUnder doesn't have to re-
// measure a display:none element and end up animating to 0 (which was
// the root cause of the flip-up "hiding and showing" glitch).
function positionDropdownUnder($trigger, $dd) {
    const rect = $trigger[0].getBoundingClientRect();
    let naturalHeight = $dd[0].offsetHeight;
    if (naturalHeight === 0) {
        const prevDisplay = $dd[0].style.display;
        const prevVisibility = $dd[0].style.visibility;
        $dd.css({ visibility: 'hidden', display: 'block' });
        naturalHeight = $dd[0].offsetHeight;
        $dd.css({ visibility: prevVisibility || '', display: prevDisplay || '' });
    }
    const GAP = 4;
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    const finalHeight = openAbove
        ? Math.min(naturalHeight, spaceAbove)
        : naturalHeight;
    const finalTop = openAbove
        ? (rect.top - finalHeight - GAP)
        : (rect.bottom + GAP);
    $dd.css({
        position: 'fixed',
        top: finalTop + 'px',
        left: rect.left + 'px',
        width: Math.max(rect.width, 200) + 'px',
        zIndex: 10000,
        margin: 0,
    });
    return { openAbove, finalTop, finalHeight, triggerRect: rect };
}

function openDropdownUnder($trigger, itemsHtml, onSelect, forKey) {
    closeGlobalDropdown(true);
    const $dd = $('<div class="target-dropdown xy-floating" style="display:none;"></div>');
    $dd.html(itemsHtml);
    $('body').append($dd);
    const placement = positionDropdownUnder($trigger, $dd);
    const { openAbove, finalTop, finalHeight, triggerRect } = placement;
    const $arrow = $trigger.find('.target-dropdown-toggle .expand-arrow, .expand-arrow').first();
    $arrow.addClass('expanded');

    if (openAbove) {
        // Grow upward: start pinned at the trigger's top edge with
        // height:0, animate top AND height together so the dropdown
        // appears to emerge upward from the trigger. Same pattern as
        // location-dropdown.js. Using the finalHeight measured during
        // positionDropdownUnder (NOT re-reading offsetHeight here —
        // $dd was display:none during measurement so it'd report 0
        // and the animation would silently be a no-op, then snap to
        // full height at the end).
        const GAP = 4;
        $dd.css({
            display: 'block',
            top: (triggerRect.top - GAP) + 'px',
            height: '0px',
            overflow: 'hidden',
        });
        _animatingOpen = true;
        $dd.animate({
            top: finalTop + 'px',
            height: finalHeight + 'px',
        }, 200, function () {
            $(this).css({ height: '', overflow: '' });
            _animatingOpen = false;
        });
    } else {
        $dd.slideDown(200);
    }

    _openDropdown = { $el: $dd, $triggerArrow: $arrow, for: forKey || null, openAbove };

    wireInfoIcons($dd);

    $dd.on('click', '.target-item', (e) => {
        e.preventDefault(); e.stopPropagation();
        const $ti = $(e.currentTarget);
        if ($ti.hasClass('disabled')) return;
        onSelect($ti.data('value'));
        closeGlobalDropdown();
    });

    // Reposition on resize/scroll — but skip while the open animation
    // is still running. Otherwise the animation target (finalTop) and
    // the re-positioner fight over the same `top` property and the
    // dropdown flickers.
    const onReflow = () => {
        if (!_openDropdown || _animatingOpen) return;
        positionDropdownUnder($trigger, $dd);
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    $dd.on('remove', () => {
        window.removeEventListener('resize', onReflow);
        window.removeEventListener('scroll', onReflow, true);
    });
}

// ----------------------------------------------------------------------------
// DROPDOWN CONTENT BUILDERS
// ----------------------------------------------------------------------------

function renderXOptionsHtml() {
    return X_OPTIONS.map(o =>
        `<div class="target-item" data-value="${o.value}">${axisIconHtml(o.value)}<span>${o.label}</span></div>`
    ).join('');
}

function renderYOptionsHtml(currentX) {
    return Y_OPTIONS
        .filter(o => isValidAsY(currentX, o.value))
        .map(o => `<div class="target-item" data-value="${o.value}">${axisIconHtml(o.value)}<span>${o.label}</span></div>`)
        .join('');
}

// Copied from optimize-button.js _guessItemIconPath — determines the
// correct icon path for a given item name within a category.
function _guessItemIconPath(iconName, categoryValue) {
    // Known items that live outside materials/ (equipment, containers, etc.)
    const OVERRIDES = {
        birch_skis: '/assets/icons/items/equipment/birch_skis.svg',
        clay_skydisc: '/assets/icons/items/equipment/clay_skydisc.svg',
        simple_torch: '/assets/icons/items/equipment/simple_torch.svg',
        rusty_chest: '/assets/icons/items/containers/rusty_chest.svg',
        sunken_chest: '/assets/icons/items/containers/sunken_chest.svg',
        // Currencies live at the top-level /assets/icons/items/ dir.
        "adventurers'_guild_token": "/assets/icons/items/adventurers'_guild_token.svg",
    };
    if (OVERRIDES[iconName]) return OVERRIDES[iconName];
    if (categoryValue && (categoryValue.includes('chest') || categoryValue.includes('skill_chest') || categoryValue.includes('bird_nest'))) {
        return `/assets/icons/items/containers/${iconName}.svg`;
    }
    if (categoryValue && categoryValue.includes('collectible')) {
        return `/assets/icons/items/collectibles/${iconName}.svg`;
    }
    if (categoryValue && categoryValue.includes('fishing_bait')) {
        return `/assets/icons/items/consumables/${iconName}.svg`;
    }
    return `/assets/icons/items/materials/${iconName}.svg`;
}

function renderQualityOptionsHtml() {
    return QUALITIES.map(q =>
        `<div class="target-item quality-item ${q.cls}" data-value="${q.value}"><span>${q.value}</span></div>`
    ).join('');
}

function renderTargetItemOptionsHtml(includeItemFinding, recipeDropTable) {
    const rowHtml = (cat, { isIf = false } = {}) => {
        const fineClass = cat.isFine ? 'fine-item' : '';
        const ifClass = isIf ? 'equipment-drop-item' : '';
        const prefix = isIf ? '✦ ' : '';
        const unavailable = !isTargetAvailable(cat.value, recipeDropTable);
        const unavailableStyle = unavailable ? ' style="opacity:0.5;font-style:italic;"' : '';
        const naLabel = unavailable ? ' <span style="color:#f1c40f;font-size:0.8em;font-weight:bold;">N/A</span>' : '';
        let infoIconHtml = '';
        if (cat.infoItems && cat.infoItems.length > 0 && !unavailable) {
            // Render each item with a 32x32 icon matching the activity
            // dropdown's info popover. Icon path uses the same logic as
            // optimize-button.js _guessItemIconPath.
            const itemListHtml = cat.infoItems.map(name => {
                const isFine = name.includes('(Fine)');
                const baseName = name.replace(/ \(Fine\)/, '').trim();
                const iconName = baseName.toLowerCase().replace(/ /g, '_').replace(/'/g, "'");
                const iconPath = _guessItemIconPath(iconName, cat.value);
                const fineStyle = isFine ? ' filter:drop-shadow(1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(-1px 0 0 var(--fine-color,#4fc3f7)) drop-shadow(0 1px 0 var(--fine-color,#4fc3f7)) drop-shadow(0 -1px 0 var(--fine-color,#4fc3f7));' : '';
                // Skip icon for chest category entries (e.g. "Primary chest",
                // "Tailoring chest") — there's no individual item sprite for
                // these; the category icon on the row is sufficient.
                const isChestEntry = cat.value === 'cat:chests';
                const iconImg = isChestEntry ? '' : `<img src="${iconPath}" style="width:32px;height:32px;${fineStyle}" onerror="this.style.display='none'" />`;
                return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">${iconImg}<span>${name}</span></div>`;
            }).join('');
            const escapedHtml = itemListHtml.replace(/"/g, '&quot;');
            infoIconHtml = ` <span class="travel-info-icon" data-info-html="${escapedHtml}" role="button" tabindex="0" aria-label="Items in category" style="font-size:0.9em;font-style:normal;">ⓘ</span>`;
        }
        return `
            <div class="target-item ${fineClass} ${ifClass}" data-value="${cat.value}"${unavailableStyle}>
                <img src="${cat.icon}" alt="${cat.name}" class="target-icon" onerror="this.style.display='none'" />
                <span>${prefix}${cat.name}${naLabel}${infoIconHtml}</span>
            </div>
        `;
    };
    let html = '';
    for (const cat of BASE_TARGET_CATEGORIES) html += rowHtml(cat);
    if (includeItemFinding) {
        for (const cat of IF_CATEGORIES) html += rowHtml(cat, { isIf: true });
    }
    return html;
}

// ----------------------------------------------------------------------------
// ENTRY RENDERING
// ----------------------------------------------------------------------------

// Inline SVG for the edit-mode pencil icon (used on per-entry toggle and
// global toggle). 14x14 stroke-only icon; `currentColor` lets CSS flip
// between muted (inactive) and yellow (active).
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;

function buildHideIcon(hidden) {
    return hidden
        ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
           </svg>`
        : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
           </svg>`;
}

function renderWeightRow(entry) {
    const w = clampWeight(entry.weight);
    return `
        <div class="sort-weight-row" data-entry-id="${entry.id}">
            <input type="range" class="weight-slider" min="0" max="100" value="${w}" data-entry-id="${entry.id}" />
            <input type="number" class="weight-input" min="0" max="100" value="${w}" data-entry-id="${entry.id}" />
            <span class="weight-pct">%</span>
        </div>
    `;
}

function renderEntryReveal(entry, recipeSkill, recipeDropTable) {
    if (entry.mode === 'budget') {
        return `
            <div class="mockup-reveal">
                <div class="budget-inputs-row" data-entry-id="${entry.id}">
                    <div class="calculator-input-group">
                        <label class="calculator-label">Input Materials</label>
                        <input type="number" class="calculator-input budget-mats-input"
                               value="${entry.budgetMats || ''}" placeholder="0" min="0"
                               data-entry-id="${entry.id}" data-budget="mats" />
                    </div>
                    <div class="calculator-input-group">
                        <label class="calculator-label">Target Output</label>
                        <input type="number" class="calculator-input budget-target-input"
                               value="${entry.budgetTarget || ''}" placeholder="0" min="0"
                               data-entry-id="${entry.id}" data-budget="target" />
                    </div>
                </div>
            </div>
        `;
    }
    const y = yOption(entry.y);
    if (y && y.needs === 'quality') {
        const q = QUALITIES.find(q => q.value === entry.quality) || QUALITIES[4];
        return `
            <div class="mockup-reveal">
                <div class="xy-wrap quality-btn-wrap" data-entry-id="${entry.id}" data-xy-axis="quality">
                    <span class="mockup-dropdown-label">Target Quality</span>
                    <div class="target-dropdown-button xy-dropdown-btn ${q.cls}">
                        <div class="target-dropdown-value"><span>${q.value}</span></div>
                        <button class="target-dropdown-toggle" tabindex="-1">
                            <span class="expand-arrow">▼</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    if (y && y.needs === 'target_item') {
        return `
            <div class="mockup-reveal">
                <div class="xy-wrap target-item-btn-wrap" data-entry-id="${entry.id}" data-xy-axis="target_item">
                    <span class="mockup-dropdown-label">Target item</span>
                    <div class="target-dropdown-button xy-dropdown-btn">
                        <div class="target-dropdown-value">
                            ${displayTargetItem(entry.targetItem, recipeSkill, recipeDropTable)}
                        </div>
                        <button class="target-dropdown-toggle" tabindex="-1">
                            <span class="expand-arrow">▼</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    return '';
}

// ----------------------------------------------------------------------------
// PUBLIC COMPONENT
// ----------------------------------------------------------------------------

/**
 * Render and manage an X-per-Y priority list.
 *
 * @param {jQuery} $container  - element to render into (contents replaced)
 * @param {Object} options
 * @param {Array}  options.entries      - initial entry list
 * @param {string} options.mode         - 'detailed' (full) | 'quick' (filter-only)
 * @param {Function} options.onChange   - (entries) => void, fires on any edit
 * @param {boolean} options.includeItemFinding - toggles IF categories in dropdown
 * @returns {Object} controller { getEntries, setEntries, destroy, refresh, setIncludeItemFinding }
 */
export function mountXyPriorityList($container, options = {}) {
    injectStylesOnce();
    const state = {
        entries: dedupEntries((options.entries || []).map(normalizeEntry).filter(Boolean)),
        mode: options.mode === 'quick' ? 'quick' : 'detailed',
        includeItemFinding: !!options.includeItemFinding,
        // When false, Quick mode hides y=quality entries entirely. Doesn't
        // affect Detailed mode (users can still edit them there).
        isQualityRecipe: options.isQualityRecipe !== false,
        // Recipe's skill (e.g. "tailoring", "crafting") — used to name the
        // chest drop in the "Chests" target-item (ⓘ) tooltip. When unset
        // (e.g. settings modal with no active recipe), falls back to
        // "Primary chest".
        recipeSkill: options.recipeSkill || null,
        // Recipe's drop_table (from RecipeInstance.drop_table → GET /api/recipes).
        // Gates visibility of cat:drop:* target items: when the selected target
        // references an item not in this table, it renders greyed-out with
        // "N/A" in yellow, matching the activity-side convention for
        // collectibles/fine items that aren't in the drop table. null/missing
        // → "assume valid" (settings modal has no recipe context yet).
        recipeDropTable: Array.isArray(options.recipeDropTable) ? options.recipeDropTable : null,
        // Which grouped rows are expanded in Quick mode. Keyed by the
        // group signature (e.g. 'quality:Perfect', 'target_item:cat:chests').
        // Single-entry groups have no expand arrow so this is only useful
        // for multi-member groups. Can be pre-seeded via
        // options.initialExpandedGroups so a re-mount of the panel (e.g.
        // when optimization settings are saved and the whole optimize-button
        // re-renders) preserves which groups the user had open.
        expandedGroups: options.initialExpandedGroups instanceof Set
            ? new Set(options.initialExpandedGroups)
            : new Set(),
    };

    // Optional external slot for the global "Edit all / Collapse all"
    // button. When provided (as a jQuery element or CSS selector) the
    // button is rendered INTO this slot instead of inline above the
    // list. Used by the Quick panel so the button can sit next to the
    // "Quick Optimization Settings" heading. Clicks on the slot button
    // are wired via a second delegated handler because the global $container
    // click delegation doesn't see events outside $container.
    const $globalEditSlot = options.globalEditSlot
        ? (options.globalEditSlot.jquery ? options.globalEditSlot : $(options.globalEditSlot))
        : null;
    const hasExternalEditSlot = !!($globalEditSlot && $globalEditSlot.length);

    const onChange = typeof options.onChange === 'function' ? options.onChange : () => { };

    function priorityNumberFor(entry) {
        // 1-based index in the FULL list (matches current Quick UX — user
        // wanted to keep the `(#N)` priority display).
        const idx = state.entries.findIndex(e => e.id === entry.id);
        return idx >= 0 ? idx + 1 : '?';
    }

    function renderEntry(entry, opts = {}) {
        const inQuick = state.mode === 'quick';
        // Indented flag: renders a slightly smaller row without metric
        // chip (used when this entry is expanded INSIDE a group in Quick).
        const expandedFromGroup = !!opts.expandedFromGroup;
        const total = state.entries.length;
        const isSingle = total <= 1;
        const hiddenClass = entry.hiddenInQuick ? 'entry-hidden-in-quick' : '';
        const expandedCls = expandedFromGroup ? 'xy-entry-expanded' : '';
        const editingCls = entry.editing ? 'xy-entry-editing' : '';
        const rootClass = inQuick
            ? `xy-priority-entry xy-priority-entry-quick ${hiddenClass} ${expandedCls} ${editingCls}`
            : `sort-item xy-priority-entry ${hiddenClass} ${editingCls}`;
        const dragDraggable = inQuick ? '' : 'draggable="true"';
        // Detailed mode gets a vertical reorder strip: up arrow + hamburger
        // (still used as the drag handle on desktop) + down arrow. The
        // hamburger alone doesn't work reliably on mobile Safari (HTML5
        // drag-and-drop isn't triggered by touch), so the arrows are the
        // primary reorder mechanism on touch devices. Up/down are grayed
        // out at the boundaries — we compute the visible position below
        // so the disabled state is visible relative to this mode's list.
        // (Quick mode shows no drag controls; grouping + eye-icon handle
        // priority management there.)
        const visibleIndex = opts.visibleIndex;
        const visibleTotal = opts.visibleTotal;
        const atTop = typeof visibleIndex === 'number' && visibleIndex <= 0;
        const atBottom = typeof visibleIndex === 'number' && visibleTotal != null && visibleIndex >= visibleTotal - 1;
        const reorderStrip = inQuick ? '' : `
            <div class="xy-reorder-strip">
                <button class="xy-move-up" ${atTop ? 'disabled' : ''} title="Move up" data-entry-id="${entry.id}" tabindex="-1">▲</button>
                <span class="drag-handle" title="Drag to reorder">☰</span>
                <button class="xy-move-down" ${atBottom ? 'disabled' : ''} title="Move down" data-entry-id="${entry.id}" tabindex="-1">▼</button>
            </div>
        `;

        const priorityNum = priorityNumberFor(entry);
        const priorityBadge = inQuick
            ? `<span class="xy-priority-badge" title="Priority position">#${priorityNum}</span>`
            : '';

        // Body parts — split so we can interleave the weight row between
        // the compact label and the editing dropdowns. DOM order is
        // always [compact-label, weight, xy-row (editing), reveal].
        // With display:none applied based on entry.editing, the visible
        // sequence becomes:
        //   - compact:  label → weight → reveal
        //   - editing:  weight → X/Y dropdowns → reveal
        //   - budget:   budget-label → weight → reveal (inputs)
        // No flex `order` tricks needed — just the right DOM order plus
        // toggled visibility.
        const budgetRow = entry.mode === 'budget' ? `
                <div class="xy-row xy-row-budget">
                    <span class="xy-budget-label">Steps for Budget</span>
                    <span class="xy-budget-hint" title="Minimizes expected steps needed to turn Input Materials into Target Output">(minimize steps within this budget)</span>
                </div>
              ` : '';

        const compactRow = entry.mode === 'budget' ? '' : `
                <div class="xy-row-compact" style="display: ${entry.editing ? 'none' : 'flex'};" data-entry-id="${entry.id}">
                    <span class="xy-compact-label">${xLabel(entry.x)}/${yLabel(entry.y)}</span>
                </div>
              `;

        const xyRow = entry.mode === 'budget' ? '' : `
                <div class="xy-row" style="display: ${entry.editing ? 'flex' : 'none'};">
                    <div class="xy-wrap" data-entry-id="${entry.id}" data-xy-axis="x">
                        <span class="mockup-dropdown-label xy-label-x">What to Optimize</span>
                        <div class="target-dropdown-button xy-dropdown-btn">
                            <div class="target-dropdown-value">${axisIconHtml(entry.x)}<span>${xLabel(entry.x)}</span></div>
                            <button class="target-dropdown-toggle" tabindex="-1"><span class="expand-arrow">▼</span></button>
                        </div>
                    </div>
                    <span class="xy-per">per</span>
                    <div class="xy-wrap" data-entry-id="${entry.id}" data-xy-axis="y">
                        <span class="mockup-dropdown-label xy-label-y">Unit</span>
                        <div class="target-dropdown-button xy-dropdown-btn">
                            <div class="target-dropdown-value">${axisIconHtml(entry.y)}<span>${yLabel(entry.y)}</span></div>
                            <button class="target-dropdown-toggle" tabindex="-1"><span class="expand-arrow">▼</span></button>
                        </div>
                    </div>
                </div>
              `;

        const revealHtml = renderEntryReveal(entry, state.recipeSkill, state.recipeDropTable);

        // Action buttons — rendered in BOTH Quick and Detailed modes now
        // (user feedback: need duplicate / remove / hide on Quick too).
        // Quick mode drops the weight slider + drag handle but keeps actions.
        // Budget entries don't get the edit pencil (no X/Y to toggle).
        const editBtnHtml = entry.mode === 'budget' ? '' : `
                <button class="sort-edit-btn ${entry.editing ? 'active' : ''}"
                        title="${entry.editing ? 'Collapse to compact view' : 'Edit X/Y axes'}"
                        data-entry-id="${entry.id}">
                    ${PENCIL_SVG}
                </button>`;
        const actionsHtml = `
            <div class="sort-item-actions ${entry.mode === 'budget' ? 'no-duplicate' : ''}">
                ${entry.mode === 'budget' ? '' : `
                <button class="sort-duplicate-btn" title="Duplicate this priority" data-entry-id="${entry.id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="3" ry="3"></rect>
                        <path d="M5 15H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v1"></path>
                    </svg>
                </button>`}
                <button class="sort-remove-btn" ${isSingle ? 'disabled' : ''} title="Remove this priority" data-entry-id="${entry.id}">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
                <button class="sort-hide-btn" title="${entry.hiddenInQuick ? 'Show in Quick settings' : 'Hide from Quick settings'}" data-entry-id="${entry.id}">
                    ${buildHideIcon(entry.hiddenInQuick)}
                </button>
                ${editBtnHtml}
            </div>
        `;

        return `
            <div class="${rootClass}" data-entry-id="${entry.id}" ${dragDraggable}>
                ${reorderStrip}
                <div class="sort-item-content">
                    ${budgetRow}
                    ${compactRow}
                    ${!inQuick ? renderWeightRow(entry) : ''}
                    ${xyRow}
                    ${revealHtml}
                </div>
                ${priorityBadge}
                ${actionsHtml}
            </div>
        `;
    }

    // --- Quick mode grouping --------------------------------------------
    //
    // When multiple ratio entries share the same quality target, we
    // collapse them into a single row in Quick mode. One shared target
    // dropdown controls all of them — matches the pre-redesign Quick
    // panel behavior the user asked to preserve. Target_item entries
    // are intentionally NOT grouped (per user feedback in issue #5).
    //
    // The group signature looks like:
    //   'budget'                  — budget mode (always a singleton)
    //   'quality:Perfect'         — all entries with y='quality' + q=Perfect
    //   'solo:<entryId>'          — everything else (no grouping)

    function groupSignature(entry) {
        if (entry.mode === 'budget') return 'budget';
        if (entry.y === 'quality') return `quality:${entry.quality || 'Perfect'}`;
        // Note: y=target_item entries are NOT grouped by target — per user
        // feedback, the Quick panel should only combine quality dropdowns.
        // Each target_item entry gets its own row so the user can see and
        // edit its target item independently.
        return `solo:${entry.id}`;
    }

    function buildQuickGroups(entries) {
        const order = [];
        const groups = new Map();
        for (const entry of entries) {
            const sig = groupSignature(entry);
            if (!groups.has(sig)) {
                groups.set(sig, { signature: sig, entries: [] });
                order.push(sig);
            }
            groups.get(sig).entries.push(entry);
        }
        return order.map(sig => groups.get(sig));
    }

    function shortMetricLabel(entry) {
        // Compact "X" label for the combined group row. Strips the y-axis
        // label since the group row already shows the shared denominator.
        return xLabel(entry.x);
    }

    function renderGroupCollapsedRow(group) {
        const first = group.entries[0];
        const sig = group.signature;
        const isBudget = first.mode === 'budget';
        const isQuality = !isBudget && first.y === 'quality';
        const isSolo = sig.startsWith('solo:');

        // Single-entry solo groups don't get grouping UI — just the normal
        // entry rendering. Let the caller fall through to renderEntry.
        if (isSolo && group.entries.length === 1) {
            return renderEntry(first);
        }

        // Budget is always standalone (max 1 entry) but still uses group UI.
        if (isBudget) {
            return renderEntry(first);
        }

        // After dropping target_item grouping, only quality groups reach here.
        if (!isQuality) {
            // Safety: if somehow a non-quality group with multiple members
            // showed up, render them un-grouped rather than mis-combining.
            return group.entries.map(e => renderEntry(e)).join('');
        }

        const expanded = state.expandedGroups.has(sig);

        // Build the combined label: "Target Quality for Materials (#1), Total Crafts (#3)"
        const prefix = 'Target Quality for';
        const detailLines = group.entries.map(e => `${prefix} ${shortMetricLabel(e)} (#${priorityNumberFor(e)})`);
        const infoAttr = detailLines
            .join('\n')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;');

        // Shared target dropdown — changing it updates all members of the group.
        // Wrapped in .xy-group-shared-target so we can slideUp/slideDown it
        // when the group expand arrow is toggled. When expanded, individual
        // members each show their own dropdown, so the shared one is hidden.
        const q = QUALITIES.find(q => q.value === (first.quality || 'Perfect')) || QUALITIES[4];
        const sharedTargetBtnHtml = `
            <div class="xy-group-shared-target"${expanded ? ' style="display:none;"' : ''}>
                <div class="xy-wrap quality-btn-wrap" data-group-sig="${sig}" data-xy-axis="quality">
                    <div class="target-dropdown-button xy-dropdown-btn ${q.cls}">
                        <div class="target-dropdown-value"><span>${first.quality || 'Perfect'}</span></div>
                        <button class="target-dropdown-toggle" tabindex="-1"><span class="expand-arrow">▼</span></button>
                    </div>
                </div>
            </div>
        `;

        const groupLabel = 'Target Quality';
        const expandClass = expanded ? 'expanded' : '';
        const expandArrow = `<span class="xy-group-expand ${expandClass}" data-group-sig="${sig}" title="${expanded ? 'Collapse' : 'Expand to edit individually'}"><span class="expand-arrow">▼</span></span>`;
        const infoIcon = `<span class="travel-info-icon xy-group-info" data-info="${infoAttr}" role="button" tabindex="0" aria-label="Grouped priorities" style="font-style:normal;">ⓘ</span>`;

        // Note: No priority badges on the right — the (i) popover already
        // lists each grouped priority's #N, so duplicate numeric badges
        // were visual noise (per user feedback).
        const groupClass = expanded ? 'xy-priority-group group-expanded' : 'xy-priority-group';
        return `
            <div class="xy-priority-entry xy-priority-entry-quick ${groupClass}" data-group-sig="${sig}">
                <div class="sort-item-content">
                    <div class="xy-group-label">
                        ${groupLabel} ${infoIcon}
                    </div>
                    ${sharedTargetBtnHtml}
                </div>
                ${expandArrow}
            </div>
        `;
    }

    function renderAddMenuHtml() {
        const hasBudget = state.entries.some(p => p.mode === 'budget');
        const budgetDisabledCls = hasBudget ? ' disabled' : '';
        const budgetTitle = hasBudget
            ? 'A Budget Goal is already in the priority list'
            : 'Add a constrained-steps-for-budget goal';
        return `
            <div class="target-item" data-value="ratio" title="Add a new X-per-Y optimization priority">
                <span>Optimization Priority</span>
            </div>
            <div class="target-item${budgetDisabledCls}" data-value="budget" title="${budgetTitle}">
                <span>Budget Goal</span>
            </div>
        `;
    }

    function render() {
        // Scroll preservation — record the current scroll positions so we
        // can restore them after the HTML replacement. Without this, any
        // user interaction that triggers render() (duplicate, delete, hide,
        // group expand) would bounce the scroll position to the top, which
        // is jarring especially when the user is deep in a long Detailed
        // list or when the outer column has scrolled past the panel.
        const $existingList = $container.find('.sort-list').first();
        const prevListScroll = $existingList.length ? $existingList[0].scrollTop : 0;
        // Find nearest scrollable ancestor (handles both the outer page
        // and Column 3's overflow-y:auto content scroller).
        const $scrollAncestor = findScrollableAncestor($container);
        const prevAncestorScroll = $scrollAncestor ? $scrollAncestor[0].scrollTop : null;
        const prevWindowScroll = window.scrollY;

        const inQuick = state.mode === 'quick';
        let entriesToShow = state.entries;
        if (inQuick) {
            entriesToShow = entriesToShow.filter(e => !e.hiddenInQuick);
            // When the selected recipe is non-quality, quality-targeted
            // entries don't apply — hide them from Quick entirely. They
            // remain editable in Detailed for consistency across recipes.
            if (!state.isQualityRecipe) {
                entriesToShow = entriesToShow.filter(e => !(e.mode === 'ratio' && e.y === 'quality'));
            }
        }

        if (inQuick && entriesToShow.length === 0) {
            $container.html(buildQuickEmptyStateHtml());
            return;
        }

        let innerHtml;
        if (inQuick) {
            // Group same-quality entries into combined rows. Target_item
            // entries are no longer grouped per user feedback.
            const groups = buildQuickGroups(entriesToShow);
            const rows = [];
            for (const group of groups) {
                const expanded = state.expandedGroups.has(group.signature);
                if (group.entries.length > 1) {
                    // Multi-member group: show the collapsed grouped row, then
                    // wrap the member rows in a slide-able container so the
                    // expand arrow can animate them in/out without a re-render.
                    rows.push(renderGroupCollapsedRow(group));
                    const memberHtml = group.entries
                        .map(e => renderEntry(e, { expandedFromGroup: true }))
                        .join('');
                    const hiddenStyle = expanded ? '' : ' style="display:none;"';
                    rows.push(`<div class="xy-group-members-wrap" data-group-sig="${group.signature}"${hiddenStyle}>${memberHtml}</div>`);
                } else {
                    // Singleton — render as a normal entry (no group UI).
                    rows.push(renderEntry(group.entries[0]));
                }
            }
            innerHtml = rows.join('');
        } else {
            innerHtml = entriesToShow
                .map((e, i) => renderEntry(e, { visibleIndex: i, visibleTotal: entriesToShow.length }))
                .join('');
        }

        const addBtn = inQuick ? '' : `
            <div class="sort-add-wrapper">
                <button class="sort-add-btn" title="Add a new optimization priority or budget goal">
                    <span>+ Add Optimization Priority</span>
                    <span class="expand-arrow">▼</span>
                </button>
            </div>
        `;

        // Global edit-mode toggle — derived from entries. "All on" means
        // every ratio entry has editing=true. Budget entries don't count.
        // Yellow = at least one ratio entry is currently editing (so the
        // icon signals "some edits are in flight").
        const ratioEntries = state.entries.filter(e => e.mode === 'ratio');
        const anyEditing = ratioEntries.some(e => e.editing);
        const allEditing = ratioEntries.length > 0 && ratioEntries.every(e => e.editing);
        const globalEditBarHtml = ratioEntries.length === 0 ? '' : `
            <div class="xy-global-edit-bar">
                <button class="xy-global-edit-btn ${anyEditing ? 'active' : ''}"
                        title="${allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing'}">
                    ${PENCIL_SVG}
                    <span>${allEditing ? 'Collapse all' : 'Edit all'}</span>
                </button>
            </div>
        `;
        // When an external slot is provided (Quick panel header), render
        // the bar there so it sits inline with the "Quick Optimization
        // Settings" heading. Otherwise inline at the top of the list.
        const inlineEditBar = hasExternalEditSlot ? '' : globalEditBarHtml;

        $container.html(`
            ${inlineEditBar}
            ${addBtn}
            <div class="sort-list xy-sort-list ${inQuick ? 'xy-sort-list-quick' : ''}">${innerHtml}</div>
        `);

        if (hasExternalEditSlot) {
            $globalEditSlot.html(globalEditBarHtml);
        }

        wireInfoIcons($container);

        // Restore scroll positions on the replaced containers. The new
        // .sort-list is a different DOM node so we have to re-apply here.
        // Deferring to requestAnimationFrame ensures the browser has
        // computed the new content height before we try to set scrollTop.
        // Without this, setting scrollTop on a temporarily-shorter
        // document has no effect (the browser clamps it).
        const applyScrollRestore = () => {
            const $newList = $container.find('.sort-list').first();
            if ($newList.length && prevListScroll) $newList[0].scrollTop = prevListScroll;
            if ($scrollAncestor && prevAncestorScroll != null) $scrollAncestor[0].scrollTop = prevAncestorScroll;
            if (Math.abs(window.scrollY - prevWindowScroll) > 1) {
                window.scrollTo(window.scrollX, prevWindowScroll);
            }
        };
        requestAnimationFrame(() => {
            applyScrollRestore();
            // Second rAF: some layouts (flex inside overflow:auto) settle
            // over two frames — restore again to catch those.
            requestAnimationFrame(applyScrollRestore);
        });

        // If we just inserted a duplicated entry, slide it down from hidden
        // state for a smooth appearance animation.
        if (state._slideDownEntryId != null) {
            const id = state._slideDownEntryId;
            state._slideDownEntryId = null;
            const $newEntry = $container.find(`.xy-priority-entry[data-entry-id="${id}"]`).first();
            if ($newEntry.length) {
                $newEntry.hide().slideDown(200);
            }
        }

        // Initialize every weight slider's blue-fill gradient. Without this
        // freshly-rendered sliders stay at the flat bg-primary background
        // until the user interacts with them.
        $container.find('.sort-weight-row .weight-slider').each(function () {
            updateSliderTrack(this);
        });

        // Re-observe the list-root for width changes, since render() may
        // have replaced the .xy-sort-list node with a fresh one.
        if (typeof watchContainerWidth === 'function') watchContainerWidth();
    }

    function emit() { onChange(getEntries()); }

    // Toggle the edit state of every ratio entry at once. If any ratio
    // entry is currently non-editing, flip all to editing; otherwise
    // collapse all. Used by both the inline global-edit button inside
    // $container AND by an external slot (Quick panel header) if the
    // caller provides one via options.globalEditSlot.
    function handleGlobalEditToggle() {
        const ratio = state.entries.filter(en => en.mode === 'ratio');
        if (ratio.length === 0) return;
        const allEditing = ratio.every(en => en.editing);
        const next = !allEditing;
        const toFlip = ratio.filter(en => en.editing !== next);
        if (toFlip.length === 0) return;
        toFlip.forEach(en => { en.editing = next; });
        // Update pencil active class + editing class on ALL rows.
        $container.find('.sort-edit-btn').each(function () {
            const id = parseInt(this.dataset.entryId, 10);
            const en = state.entries.find(x => x.id === id);
            if (en) {
                $(this).toggleClass('active', !!en.editing);
                const $row = $(this).closest('.xy-priority-entry');
                // Fade the actions column during layout change.
                const $actions = $row.find('.sort-item-actions');
                $actions.animate({ opacity: 0 }, 80, function () {
                    $row.toggleClass('xy-entry-editing', !!en.editing);
                    $actions.animate({ opacity: 1 }, 100);
                });
            }
        });
        // Collect only the bodies that need animating.
        let $bodies = $();
        for (const en of toFlip) {
            $bodies = $bodies.add(
                $container.find(
                    `.xy-priority-entry[data-entry-id="${en.id}"] .xy-row, ` +
                    `.xy-priority-entry[data-entry-id="${en.id}"] .xy-row-compact`
                )
            );
        }
        $bodies.slideToggle(180);
        $bodies.promise().done(() => { updateGlobalEditBarLabel(); emit(); });
    }

    // After an in-place delete (see .sort-remove-btn handler), refresh
    // the priority badge numbers (Quick mode) and the up/down arrow
    // disabled-boundary states (Detailed mode) on the remaining rows.
    // Also updates sort-remove-btn disabled state when only one entry
    // Show the "all hidden" empty hint after the last Quick entry is
    // removed or hidden. Also slides up the .sort-list container so
    // the scrollable area disappears.
    function showQuickEmptyHint() {
        const $list = $container.find('.sort-list').first();
        if ($list.length) $list.slideUp(200);
        const $hint = $(buildQuickEmptyStateHtml()).css('display', 'none');
        $container.append($hint);
        $hint.slideDown(200);
    }

    // Build the Quick-mode empty-state markup. Shows a brief context
    // message explaining why the list is empty (all hidden vs
    // non-quality craft with no applicable entries) and an "Add
    // priority #1" button that directly inserts a new ratio entry at
    // index 0 so it becomes the top priority — no need to open the
    // Detailed settings for simple users. Defaults are context-aware:
    //   - quality recipe:      materials/quality  (most common default)
    //   - non-quality craft:   materials/craft    (any non-quality y
    //                          works; this one applies to every recipe)
    function buildQuickEmptyStateHtml() {
        const hintText = state.isQualityRecipe
            ? 'All priorities are hidden from Quick settings.'
            : 'No applicable priorities for this non-quality craft.';
        return `
            <div class="quick-empty-hint">
                <div style="margin-bottom: 10px;">${hintText}</div>
                <button class="sort-add-btn xy-quick-add-first-btn" title="Add a new optimization priority as #1">
                    <span>+ Add priority #1</span>
                </button>
            </div>
        `;
    }

    // Update the global "Edit all / Collapse all" button label + active
    // state in-place.
    function updateGlobalEditBarLabel() {
        const ratioEntries = state.entries.filter(e => e.mode === 'ratio');
        const anyEditing = ratioEntries.some(e => e.editing);
        const allEditing = ratioEntries.length > 0 && ratioEntries.every(e => e.editing);
        // Update inside $container (Detailed mode inline bar).
        const $btn = $container.find('.xy-global-edit-btn');
        $btn.toggleClass('active', anyEditing);
        $btn.find('span').text(allEditing ? 'Collapse all' : 'Edit all');
        $btn.attr('title', allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing');
        // Also update the external slot if present.
        if (hasExternalEditSlot) {
            const $slotBtn = $globalEditSlot.find('.xy-global-edit-btn');
            $slotBtn.toggleClass('active', anyEditing);
            $slotBtn.find('span').text(allEditing ? 'Collapse all' : 'Edit all');
            $slotBtn.attr('title', allEditing ? 'Collapse all to compact view' : 'Expand all for axis editing');
        }
    }

    // After an in-place delete (see .sort-remove-btn handler), refresh
    // is left. Cheap DOM-only pass — no full render, no scroll jump.
    function updateBadgesAndBoundaryStates() {
        const inQuick = state.mode === 'quick';
        const onlyOneLeft = state.entries.length <= 1;

        // Disable the remove button on the last remaining row to match
        // initial render behavior (can't delete the final priority).
        $container.find('.sort-remove-btn').each(function () {
            this.disabled = onlyOneLeft;
        });

        if (inQuick) {
            // Quick mode: priority badges reflect the entry's position
            // in state.entries — recompute using priorityNumberFor.
            $container.find('.xy-priority-entry').each(function () {
                const entryId = parseInt(this.getAttribute('data-entry-id'), 10);
                if (!Number.isFinite(entryId)) return;
                const entry = state.entries.find(e => e.id === entryId);
                if (!entry) return;
                const num = priorityNumberFor(entry);
                $(this).find('.xy-priority-badge').text('#' + num);
            });
        } else {
            // Detailed mode: refresh up/down disabled based on visible
            // position among the currently-rendered rows.
            const $rows = $container.find('.sort-list > .xy-priority-entry');
            const total = $rows.length;
            $rows.each(function (i) {
                const $up = $(this).find('.xy-move-up');
                const $down = $(this).find('.xy-move-down');
                $up.prop('disabled', i <= 0);
                $down.prop('disabled', i >= total - 1);
            });
        }
    }

    // FLIP-style swap animation for up/down arrow clicks. Directly
    // reorders the two DOM nodes (no full render()) and animates both
    // rows from their old visual position to their new one. The old
    // version called render() which rebuilt all HTML — the user saw
    // that full rebuild as a "section re-render" before the FLIP kicked
    // in, sometimes with the card briefly at the top of the list.
    // By skipping render() and using insertBefore/insertAfter on the
    // two specific rows, only the affected pair visibly moves.
    //
    // Direction is 'up' or 'down' (of the MOVED entry relative to its
    // neighbor). Also updates state.entries + priority/boundary states
    // + emits the onChange at the end.
    function animateReorderSwap(movedId, neighborId, direction) {
        const $movedBefore = $container.find('.xy-priority-entry[data-entry-id="' + movedId + '"]').first();
        const $neighborBefore = $container.find('.xy-priority-entry[data-entry-id="' + neighborId + '"]').first();
        if (!$movedBefore.length || !$neighborBefore.length) return;

        const beforeMoved = $movedBefore[0].getBoundingClientRect();
        const beforeNeighbor = $neighborBefore[0].getBoundingClientRect();

        const movedIdx = state.entries.findIndex(p => p.id === movedId);
        const neighborIdx = state.entries.findIndex(p => p.id === neighborId);
        if (movedIdx < 0 || neighborIdx < 0) return;
        const [moved] = state.entries.splice(movedIdx, 1);
        state.entries.splice(neighborIdx, 0, moved);

        if (direction === 'up') $movedBefore.insertBefore($neighborBefore);
        else $movedBefore.insertAfter($neighborBefore);

        const afterMoved = $movedBefore[0].getBoundingClientRect();
        const afterNeighbor = $neighborBefore[0].getBoundingClientRect();
        const dyMoved = beforeMoved.top - afterMoved.top;
        const dyNeighbor = beforeNeighbor.top - afterNeighbor.top;

        // FLIP via Web Animations API — browser-native, no paint-
        // separation tricks needed.
        const duration = 280;
        const easing = 'ease';
        if (dyMoved !== 0) {
            $movedBefore[0].animate([
                { transform: 'translateY(' + dyMoved + 'px)' },
                { transform: 'translateY(0)' }
            ], { duration, easing });
        }
        if (dyNeighbor !== 0) {
            $neighborBefore[0].animate([
                { transform: 'translateY(' + dyNeighbor + 'px)' },
                { transform: 'translateY(0)' }
            ], { duration, easing });
        }

        setTimeout(() => {
            // Refresh priority badges + up/down disabled boundary states
            // on all rows. Cheap — no render().
            updateBadgesAndBoundaryStates();
            emit();
            // Scroll follow — pull the moved row back into view if it
            // drifted past the edge of the active scroll container.
            try {
                const el = $movedBefore[0];
                if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            } catch (_err) { /* noop */ }
        }, 300);
    }

    // Apply the blue-fill linear-gradient background to a weight-slider
    // input. Matches the activity-side `_updateSliderTrack` so XY sliders
    // visually match the rest of the optimization UI. Called on input
    // events and once per render for each fresh slider.
    function updateSliderTrack(slider) {
        if (!slider) return;
        const min = Number(slider.min || 0);
        const max = Number(slider.max || 100);
        const val = Number(slider.value || 0);
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
        slider.style.background =
            'linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ' +
            pct + '%, var(--bg-primary) ' + pct + '%, var(--bg-primary) 100%)';
    }

    function getEntries() {
        // Return a deep-copy shaped for the backend (strip the local id).
        return state.entries.map(e => {
            if (e.mode === 'budget') {
                return {
                    mode: 'budget',
                    weight: clampWeight(e.weight),
                    budgetMats: e.budgetMats || '',
                    budgetTarget: e.budgetTarget || '',
                    hiddenInQuick: !!e.hiddenInQuick,
                };
            }
            return {
                mode: 'ratio',
                x: e.x,
                y: e.y,
                weight: clampWeight(e.weight),
                quality: e.quality || 'Perfect',
                targetItem: e.targetItem || null,
                hiddenInQuick: !!e.hiddenInQuick,
                editing: !!e.editing,
            };
        });
    }

    function setEntries(newEntries) {
        state.entries = dedupEntries((newEntries || []).map(normalizeEntry).filter(Boolean));
        render();
    }

    function setIncludeItemFinding(v) {
        state.includeItemFinding = !!v;
    }

    // --- Event handlers (delegated from $container) -------------------

    $container.on('click.xypl', (e) => {
        const t = e.target;

        // Group expand arrow (Quick mode only). Animate slide of the
        // member rows and the shared-target dropdown instead of calling
        // render() — this keeps the DOM stable (no flash) and gives a
        // smoother feel. State is still updated so a subsequent render
        // from duplicate/delete/hide lands on the right layout.
        const expBtn = t.closest('.xy-group-expand');
        if (expBtn) {
            e.preventDefault(); e.stopPropagation();
            const sig = expBtn.dataset.groupSig;
            if (!sig) return;
            const willExpand = !state.expandedGroups.has(sig);
            if (willExpand) state.expandedGroups.add(sig);
            else state.expandedGroups.delete(sig);

            const $arrow = $(expBtn);
            const $groupRow = $container.find(`.xy-priority-group[data-group-sig="${CSS.escape(sig)}"]`);
            const $shared = $groupRow.find('.xy-group-shared-target').first();
            const $members = $container.find(`.xy-group-members-wrap[data-group-sig="${CSS.escape(sig)}"]`).first();

            if (willExpand) {
                $arrow.addClass('expanded');
                $groupRow.addClass('group-expanded');
                // Simultaneously hide the shared dropdown and reveal
                // the member rows (issue #3 feedback).
                if ($shared.length) $shared.slideUp(180);
                if ($members.length) $members.slideDown(200);
            } else {
                $arrow.removeClass('expanded');
                if ($members.length) $members.slideUp(200);
                if ($shared.length) {
                    $shared.slideDown(180, () => {
                        // Drop the group-expanded class after the shared
                        // dropdown is fully back so CSS rules stay in sync.
                        $groupRow.removeClass('group-expanded');
                    });
                } else {
                    $groupRow.removeClass('group-expanded');
                }
            }
            return;
        }

        // XY dropdown button — X, Y, Quality, Target-item.
        // Grouped rows use data-group-sig on the wrap instead of data-entry-id;
        // selecting a value there updates every entry in that group.
        const btn = t.closest('.xy-dropdown-btn');
        if (btn) {
            e.preventDefault(); e.stopPropagation();
            const $wrap = $(btn).closest('.xy-wrap');
            const axis = $wrap.data('xy-axis');

            // Group-level dropdown: shared quality / target_item across members.
            const groupSig = $wrap.data('group-sig');
            if (groupSig) {
                const visible = state.entries.filter(e => {
                    if (e.hiddenInQuick) return false;
                    if (!state.isQualityRecipe && e.mode === 'ratio' && e.y === 'quality') return false;
                    return true;
                });
                const groupEntries = visible.filter(e => groupSignature(e) === groupSig);
                if (!groupEntries.length) return;

                if (_openDropdown && _openDropdown.for === `group:${groupSig}:${axis}`) {
                    closeGlobalDropdown();
                    return;
                }

                let itemsHtml;
                if (axis === 'quality') itemsHtml = renderQualityOptionsHtml();
                else if (axis === 'target_item') itemsHtml = renderTargetItemOptionsHtml(state.includeItemFinding, state.recipeDropTable);
                else return;

                openDropdownUnder($(btn), itemsHtml, (val) => {
                    let changed = false;
                    for (const e of groupEntries) {
                        if (axis === 'quality' && e.quality !== val) { e.quality = val; changed = true; }
                        if (axis === 'target_item' && e.targetItem !== val) { e.targetItem = val; changed = true; }
                    }
                    if (changed) {
                        // The group signature changed (since the shared target
                        // is part of the signature), so the group may merge
                        // with another existing group. Drop the old expanded
                        // state so we don't leak stale signatures.
                        state.expandedGroups.delete(groupSig);
                        render();
                        emit();
                    }
                }, `group:${groupSig}:${axis}`);
                return;
            }

            // Per-entry dropdown (existing behavior).
            const entryId = parseInt($wrap.data('entry-id'), 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry) return;

            if (_openDropdown && _openDropdown.for === `${entryId}:${axis}`) {
                closeGlobalDropdown();
                return;
            }

            let itemsHtml;
            if (axis === 'x') itemsHtml = renderXOptionsHtml();
            else if (axis === 'y') itemsHtml = renderYOptionsHtml(entry.x);
            else if (axis === 'quality') itemsHtml = renderQualityOptionsHtml();
            else if (axis === 'target_item') itemsHtml = renderTargetItemOptionsHtml(state.includeItemFinding, state.recipeDropTable);
            else return;

            openDropdownUnder($(btn), itemsHtml, (val) => {
                let changed = false;
                if (axis === 'x' && entry.x !== val) {
                    entry.x = val;
                    if (!isValidAsY(val, entry.y)) entry.y = 'craft';
                    changed = true;
                } else if (axis === 'y' && entry.y !== val) {
                    entry.y = val;
                    changed = true;
                } else if (axis === 'quality' && entry.quality !== val) {
                    entry.quality = val;
                    changed = true;
                } else if (axis === 'target_item' && entry.targetItem !== val) {
                    entry.targetItem = val;
                    changed = true;
                }
                if (changed) {
                    render();
                    emit();
                }
            }, `${entryId}:${axis}`);
            return;
        }

        // "Add priority #1" from the Quick-mode empty state. Inserts a
        // new ratio entry at index 0 so it becomes the top priority,
        // and makes it visible in Quick. Defaults are context-aware
        // (see buildQuickEmptyStateHtml for rationale). Matched before
        // the generic .sort-add-btn handler below since this button
        // carries both classes but should route here.
        if (t.closest('.xy-quick-add-first-btn')) {
            e.preventDefault(); e.stopPropagation();
            const newEntry = state.isQualityRecipe
                ? makeRatioEntry('materials', 'quality', { editing: true, hiddenInQuick: false })
                : makeRatioEntry('materials', 'craft', { editing: true, hiddenInQuick: false });
            state.entries.unshift(newEntry);
            state._slideDownEntryId = newEntry.id;
            render(); emit();
            return;
        }

        // Add priority (detailed only). New entries are inserted at
        // index 0 so they become priority #1 — users overwhelmingly add
        // a priority because it's the most important consideration for
        // the next optimization, not the least. Matches the Quick-mode
        // "+ Add priority #1" empty-state behavior for consistency.
        if (t.closest('.sort-add-btn')) {
            e.preventDefault(); e.stopPropagation();
            if (_openDropdown && _openDropdown.for === 'add-menu') {
                closeGlobalDropdown();
                return;
            }
            const $btn = $(t.closest('.sort-add-btn'));
            openDropdownUnder($btn, renderAddMenuHtml(), (kind) => {
                let newEntry;
                if (kind === 'budget') {
                    if (state.entries.some(p => p.mode === 'budget')) return;
                    newEntry = makeBudgetEntry();
                    state.entries.unshift(newEntry);
                } else {
                    // New ratio entries default to editing=true so the
                    // user can pick X/Y axes immediately without hunting
                    // for the pencil toggle.
                    newEntry = makeRatioEntry('materials', 'craft', { editing: true });
                    state.entries.unshift(newEntry);
                }
                // Flag for render() to slideDown the new entry.
                state._slideDownEntryId = newEntry.id;
                render(); emit();
            }, 'add-menu');
            return;
        }

        // Duplicate — insert new entry directly after the source then slide
        // it down for a smooth visual (issue #4).
        const dupBtn = t.closest('.sort-duplicate-btn');
        if (dupBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(dupBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx >= 0) {
                const src = state.entries[idx];
                // Duplicates open in edit mode too — user's usually
                // copying then immediately tweaking X/Y.
                const copy = src.mode === 'budget'
                    ? makeBudgetEntry({ budgetMats: src.budgetMats, budgetTarget: src.budgetTarget, weight: src.weight, hiddenInQuick: src.hiddenInQuick })
                    : makeRatioEntry(src.x, src.y, { quality: src.quality, targetItem: src.targetItem, weight: src.weight, hiddenInQuick: src.hiddenInQuick, editing: true });
                state.entries.splice(idx + 1, 0, copy);
                state._slideDownEntryId = copy.id;
                render(); emit();
            }
            return;
        }

        // Remove — slide up the affected row, then remove the DOM node
        // directly (no full render()). Previously we called render()
        // after the slideUp which rebuilt the whole list HTML — that
        // triggered a visible scroll-jump because the scroll restore
        // happens in rAF and the browser paints one frame of content
        // at wrong scroll before restore. Activity uses this in-place
        // pattern (settings-modal.js .sort-remove-btn handler) and it's
        // smooth; copying it here. The only post-op cleanup is updating
        // priority badges + up/down disabled state on the remaining
        // rows, and removing any now-empty Quick-mode group wrapper.
        const rmBtn = t.closest('.sort-remove-btn');
        if (rmBtn && !rmBtn.disabled) {
            e.preventDefault(); e.stopPropagation();
            if (state.entries.length <= 1) return;
            const entryId = parseInt(rmBtn.dataset.entryId, 10);
            const $row = $(rmBtn).closest('.xy-priority-entry');
            const $groupWrap = $row.closest('.xy-group-members-wrap'); // Quick mode only
            rmBtn.disabled = true; // stop double-clicks during the anim
            $row.css('pointer-events', 'none');
            const finish = () => {
                $row.remove();
                state.entries = state.entries.filter(p => p.id !== entryId);
                // Clean up an orphan group wrapper if the deleted row was
                // the last member of its Quick-mode group (leaves a stale
                // group-of-1 header otherwise).
                if ($groupWrap.length && $groupWrap.children('.xy-priority-entry').length === 0) {
                    const sig = $groupWrap.data('groupSig');
                    // Slide up the wrapper + group header so they don't
                    // just vanish abruptly.
                    const $groupHeader = sig
                        ? $container.find(`.xy-priority-group[data-group-sig="${CSS.escape(String(sig))}"]`)
                        : $();
                    $groupWrap.slideUp(200, () => { $groupWrap.remove(); });
                    $groupHeader.slideUp(200, () => { $groupHeader.remove(); });
                    if (sig) state.expandedGroups.delete(String(sig));
                }
                updateBadgesAndBoundaryStates();
                // If Quick mode and no visible entries remain, show hint.
                if (state.mode === 'quick') {
                    const visible = state.entries.filter(en => !en.hiddenInQuick);
                    if (visible.length === 0) showQuickEmptyHint();
                }
                emit();
            };
            if ($row.length) $row.slideUp(200, finish);
            else finish();
            return;
        }

        // Per-entry edit toggle (pencil). Flips entry.editing and
        // simultaneously slides BOTH body variants (expanded .xy-row
        // and compact .xy-row-compact) — jQuery's slideToggle toggles
        // each element based on its current visibility, so the hidden
        // one slides down AS the visible one slides up. Final render
        // happens after both animations complete to sync the global
        // edit bar text.
        const editBtn = t.closest('.sort-edit-btn');
        if (editBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(editBtn.dataset.entryId, 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry || entry.mode === 'budget') return;
            const $row = $(editBtn).closest('.xy-priority-entry');
            entry.editing = !entry.editing;
            $row.find('.sort-edit-btn').toggleClass('active', entry.editing);
            // Animate the actions column layout change (2×2 ↔ 1-col) with
            // a quick fade so the grid reflow isn't jarring.
            const $actions = $row.find('.sort-item-actions');
            $actions.animate({ opacity: 0 }, 80, function () {
                $row.toggleClass('xy-entry-editing', entry.editing);
                $actions.animate({ opacity: 1 }, 100);
            });
            const $bodies = $row.find('.xy-row, .xy-row-compact');
            $bodies.slideToggle(180);
            $bodies.promise().done(() => { updateGlobalEditBarLabel(); emit(); });
            return;
        }

        // Global edit toggle — flips all ratio entries toward the target
        // state (all-on if any is off, all-off if all are on). Only the
        // entries whose state actually changes get animated, so a second
        // click after a full expand doesn't re-animate entries that were
        // already editing.
        const globalEditBtn = t.closest('.xy-global-edit-btn');
        if (globalEditBtn) {
            e.preventDefault(); e.stopPropagation();
            handleGlobalEditToggle();
            return;
        }

        // Up / down arrow reorder (detailed mode only). Moves the entry
        // one position in state.entries, animates the swap via FLIP, and
        // scrolls the moved entry back into view so rapid clicks don't
        // send it offscreen. Previous version called render() after the
        // state mutation which rebuilt the entire list HTML on every
        // swap — the user saw the whole section flash + re-render before
        // the FLIP. In-place DOM reorder keeps everything stable and
        // the FLIP is the only visible motion.
        const upBtn = t.closest('.xy-move-up');
        if (upBtn) {
            e.preventDefault(); e.stopPropagation();
            if (upBtn.disabled) return;
            const entryId = parseInt(upBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx > 0) {
                const neighborId = state.entries[idx - 1].id;
                animateReorderSwap(entryId, neighborId, 'up');
            }
            return;
        }
        const downBtn = t.closest('.xy-move-down');
        if (downBtn) {
            e.preventDefault(); e.stopPropagation();
            if (downBtn.disabled) return;
            const entryId = parseInt(downBtn.dataset.entryId, 10);
            const idx = state.entries.findIndex(p => p.id === entryId);
            if (idx >= 0 && idx < state.entries.length - 1) {
                const neighborId = state.entries[idx + 1].id;
                animateReorderSwap(entryId, neighborId, 'down');
            }
            return;
        }

        // Hide / show in Quick. In Quick mode (where the toggle makes the
        // entry disappear from the list) we slide up first. In Detailed
        // mode the entry stays visible — just re-render to refresh the
        // eye icon color.
        const hideBtn = t.closest('.sort-hide-btn');
        if (hideBtn) {
            e.preventDefault(); e.stopPropagation();
            const entryId = parseInt(hideBtn.dataset.entryId, 10);
            const entry = state.entries.find(p => p.id === entryId);
            if (!entry) return;
            const inQuick = state.mode === 'quick';
            const willDisappear = inQuick && !entry.hiddenInQuick;
            const $row = $(hideBtn).closest('.xy-priority-entry');
            const finish = () => {
                entry.hiddenInQuick = !entry.hiddenInQuick;
                if (willDisappear) {
                    // Row is gone from Quick — remove DOM + update badges.
                    $row.remove();
                    updateBadgesAndBoundaryStates();
                    // If no visible entries remain, show the empty hint.
                    const visibleEntries = state.entries.filter(en => !en.hiddenInQuick);
                    if (visibleEntries.length === 0) showQuickEmptyHint();
                } else {
                    // Detailed or un-hiding: update icon + class in-place.
                    $row.toggleClass('entry-hidden-in-quick', entry.hiddenInQuick);
                    $(hideBtn).attr('title', entry.hiddenInQuick ? 'Show in Quick settings' : 'Hide from Quick settings');
                    $(hideBtn).html(buildHideIcon(entry.hiddenInQuick));
                }
                emit();
            };
            if (willDisappear && $row.length) $row.slideUp(200, finish);
            else finish();
            return;
        }

        // Click outside dropdown closes it
        if (_openDropdown && !t.closest('.target-dropdown.xy-floating') && !t.closest('.xy-dropdown-btn')) {
            closeGlobalDropdown();
        }
    });

    // Budget input persistence
    $container.on('input.xypl', 'input[data-budget]', function () {
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (!entry) return;
        if (this.dataset.budget === 'mats') entry.budgetMats = this.value;
        else entry.budgetTarget = this.value;
        emit();
    });

    // Weight slider
    $container.on('input.xypl', '.sort-weight-row .weight-slider', function () {
        const val = clampWeight(this.value);
        const $row = $(this).closest('.sort-weight-row');
        $row.find('.weight-input').val(val);
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (entry) entry.weight = val;
        updateSliderTrack(this);
        emit();
    });
    $container.on('input.xypl', '.sort-weight-row .weight-input', function () {
        const val = clampWeight(this.value);
        const $row = $(this).closest('.sort-weight-row');
        const $slider = $row.find('.weight-slider');
        $slider.val(val);
        const sliderEl = $slider[0];
        if (sliderEl) updateSliderTrack(sliderEl);
        const entryId = parseInt(this.dataset.entryId, 10);
        const entry = state.entries.find(p => p.id === entryId);
        if (entry) entry.weight = val;
        emit();
    });
    $container.on('blur.xypl', '.sort-weight-row .weight-input', function () {
        this.value = clampWeight(this.value);
    });

    // Drag-and-drop reorder (detailed only). Desktop uses HTML5 drag-and-
    // drop on the whole entry; mobile falls back to touch events on the
    // `.drag-handle` (☰) since iOS Safari doesn't fire HTML5 drag events
    // from touch input. Both paths share the same `draggedEl` reference
    // so the finish logic in dragend also runs when touchend fires.
    if (state.mode === 'detailed') {
        let draggedEl = null;
        let touchStartY = 0;
        let touchCurrentY = 0;
        let touchScrollParent = null;
        let touchClassTimer = null;

        function finishDragCommit() {
            if (draggedEl) $(draggedEl).removeClass('dragging');
            const newOrder = [];
            $container.find('.xy-sort-list').first().find('.xy-priority-entry').each(function () {
                const id = parseInt(this.dataset.entryId, 10);
                const entry = state.entries.find(p => p.id === id);
                if (entry) newOrder.push(entry);
            });
            draggedEl = null;
            if (newOrder.length === state.entries.length) {
                state.entries = newOrder;
                render(); emit();
            }
        }

        // ===== DESKTOP =====
        // Mirror the activity settings drag-guard: mousedown on any
        // interactive child temporarily strips draggable="true" from the
        // parent entry so the browser doesn't start an HTML5 drag from
        // an input/button. Without this, grabbing the slider thumb and
        // dragging horizontally makes the whole row drag-reorder — the
        // dragstart tag-check below can't save us because the drag
        // gesture has already begun.
        // Includes all XY-specific interactive selectors:
        //   .weight-slider / .weight-input — weight controls
        //   .sort-remove-btn / .sort-duplicate-btn / .sort-hide-btn — action buttons
        //   .xy-dropdown-btn — axis / quality / target-item pickers
        //   .xy-move-up / .xy-move-down — reorder arrows
        //   input[data-budget] — budget-mode number inputs
        const DRAG_GUARD_SELECTOR = [
            '.weight-slider', '.weight-input',
            '.sort-remove-btn', '.sort-duplicate-btn', '.sort-hide-btn',
            '.sort-edit-btn', '.xy-global-edit-btn',
            '.xy-dropdown-btn', '.target-dropdown-button',
            '.xy-move-up', '.xy-move-down',
            'input[data-budget]',
        ].join(', ');
        $container.on('mousedown.xypl', DRAG_GUARD_SELECTOR, function (e) {
            const $item = $(e.target).closest('.xy-priority-entry');
            if (!$item.length) return;
            $item.attr('draggable', 'false');
            $(document).one('mouseup', () => {
                $item.attr('draggable', 'true');
            });
        });

        $container.on('dragstart.xypl', '.xy-priority-entry', function (e) {
            const tag = e.target.tagName.toLowerCase();
            if (['input', 'button', 'select', 'textarea'].includes(tag)) { e.preventDefault(); return; }
            draggedEl = this;
            $(this).addClass('dragging');
            try { e.originalEvent.dataTransfer.effectAllowed = 'move'; } catch (err) { /* noop */ }
        });
        $container.on('dragend.xypl', '.xy-priority-entry', function () {
            stopAutoScroll();
            finishDragCommit();
        });
        $container.on('dragover.xypl', '.xy-priority-entry', function (e) {
            if (!draggedEl || this === draggedEl) return;
            e.preventDefault();
            try { e.originalEvent.dataTransfer.dropEffect = 'move'; } catch (err) { /* noop */ }
            const rect = this.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.originalEvent.clientY < midpoint) this.parentNode.insertBefore(draggedEl, this);
            else this.parentNode.insertBefore(draggedEl, this.nextSibling);
            // Auto-scroll when dragging near the edge — benefits desktop
            // drags inside the settings modal too, not just touch drags.
            if (!touchScrollParent) touchScrollParent = findScrollParent(draggedEl);
            updateAutoScroll(e.originalEvent.clientY, touchScrollParent);
        });

        // ===== MOBILE TOUCH =====
        // Only the ☰ handle initiates a touch drag — matches activity.
        // Touching the entry body otherwise lets native scroll take over.
        $container.on('touchstart.xypl', '.drag-handle', function (e) {
            const $item = $(this).closest('.xy-priority-entry');
            if (!$item.length) return;
            draggedEl = $item[0];
            touchStartY = e.originalEvent.touches[0].clientY;
            touchCurrentY = touchStartY;
            touchScrollParent = findScrollParent(draggedEl);
            // Slight delay before applying `dragging` so a quick scroll
            // gesture doesn't briefly flash the drag-state styling.
            touchClassTimer = setTimeout(() => {
                if (draggedEl) $(draggedEl).addClass('dragging');
            }, 100);
        });

        // touchmove listens on the container so it keeps working even if
        // the finger drifts off the handle onto another row.
        $container.on('touchmove.xypl', function (e) {
            if (!draggedEl) return;
            e.preventDefault();
            touchCurrentY = e.originalEvent.touches[0].clientY;
            const elements = $container.find('.xy-priority-entry').not('.dragging').toArray();
            let targetEl = null;
            for (const el of elements) {
                const r = el.getBoundingClientRect();
                if (touchCurrentY >= r.top && touchCurrentY <= r.bottom) { targetEl = el; break; }
            }
            if (targetEl && targetEl !== draggedEl) {
                const r = targetEl.getBoundingClientRect();
                const midpoint = r.top + r.height / 2;
                if (touchCurrentY < midpoint) targetEl.parentNode.insertBefore(draggedEl, targetEl);
                else targetEl.parentNode.insertBefore(draggedEl, targetEl.nextSibling);
            }
            updateAutoScroll(touchCurrentY, touchScrollParent);
        });

        $container.on('touchend.xypl touchcancel.xypl', function () {
            if (!draggedEl) return;
            if (touchClassTimer) { clearTimeout(touchClassTimer); touchClassTimer = null; }
            stopAutoScroll();
            finishDragCommit();
            touchStartY = 0;
            touchCurrentY = 0;
            touchScrollParent = null;
        });
    }

    // Watch each list-root's width and toggle .xy-list-narrow when narrow.
    // Replaces the earlier container-query approach — ResizeObserver avoids
    // the CSS layout-containment side effect that was interfering with the
    // floating axis / target-item dropdown positioning.
    const NARROW_THRESHOLD = 340;
    let _resizeObserver = null;
    function watchContainerWidth() {
        if (typeof ResizeObserver === 'undefined') return;
        if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (_e) {} _resizeObserver = null; }
        const roots = $container.find('.xy-sort-list, .xy-sort-list-quick').toArray();
        if (!roots.length) return;
        _resizeObserver = new ResizeObserver(entries => {
            for (const ent of entries) {
                const w = ent.contentRect ? ent.contentRect.width : ent.target.clientWidth;
                // Skip zero-width readings — they happen when an ancestor is
                // display:none (e.g. Quick Optimization Settings panel
                // collapsed). Treating w=0 as "narrow" applies .xy-list-narrow
                // and column-stacks the entries, poisoning the height jQuery
                // measures when slideDown opens the panel. See full root cause
                // comment in xy-activity-priority-list.js.
                if (w === 0) continue;
                ent.target.classList.toggle('xy-list-narrow', w < NARROW_THRESHOLD);
            }
        });
        for (const r of roots) _resizeObserver.observe(r);
    }

    // Initial render + width watcher.
    render();
    watchContainerWidth();

    // Attach click handler on the external edit-bar slot if provided.
    // The main delegated handler on $container doesn't see clicks on
    // elements outside $container, so we wire a parallel delegated
    // listener scoped to the slot.
    if (hasExternalEditSlot) {
        $globalEditSlot.on('click.xypl-slot', '.xy-global-edit-btn', (e) => {
            e.preventDefault(); e.stopPropagation();
            handleGlobalEditToggle();
        });
    }

    return {
        getEntries,
        setEntries,
        setIncludeItemFinding,
        // Insert a new ratio entry at index 0 (priority #1). Matches
        // both the Quick-mode empty-state "+ Add priority #1" button
        // and the Detailed-mode add — exposed here so external callers
        // (e.g. the "+" button in the Quick Optimization Settings
        // header) can add a top-priority entry without rendering their
        // own button. Defaults are context-aware: quality recipes get
        // materials/quality, non-quality crafts get materials/craft.
        addPriorityFirst: () => {
            const newEntry = state.isQualityRecipe
                ? makeRatioEntry('materials', 'quality', { editing: true, hiddenInQuick: false })
                : makeRatioEntry('materials', 'craft', { editing: true, hiddenInQuick: false });
            state.entries.unshift(newEntry);
            state._slideDownEntryId = newEntry.id;
            render();
            emit();
        },
        // Return a snapshot of the currently-expanded group signatures so
        // the caller can persist it across a destroy+mount cycle (issue #1
        // — duplicating inside an expanded group used to collapse it when
        // saveOptimizationSettings triggered a parent re-render).
        getExpandedGroups: () => new Set(state.expandedGroups),
        refresh: render,
        destroy: () => {
            $container.off('.xypl');
            closeGlobalDropdown(true);
            if (_resizeObserver) { try { _resizeObserver.disconnect(); } catch (_e) {} _resizeObserver = null; }
            $container.empty();
            if (hasExternalEditSlot) {
                $globalEditSlot.off('.xypl-slot');
                $globalEditSlot.empty();
            }
        },
    };
}
