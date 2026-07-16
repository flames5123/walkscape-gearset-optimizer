/**
 * SummaryDashboard — Final card at the bottom of the crafting tree
 * showing aggregated totals: steps, time, XP, shopping list, cost, steps breakdown.
 *
 * Summary-level additions (side drops, net profit, target yield, LP mode badge)
 * reuse the existing `.tree-summary-metrics` / `.tree-summary-metric` layout so
 * they visually match the rest of the page.
 */

import Component from './base.js';
import { wireDropAnchor } from '../drop-item-popover.js';
import api from '../api.js';

import { formatFixed } from '../utils/number-format.js';

class SummaryDashboard extends Component {
    constructor(element, props = {}) {
        super(element, props);
        // props: { summary }
        // Section collapse state persists in localStorage so the user's
        // choice survives reload AND component re-renders inside the
        // same tree (every recalc destroys + rebuilds the summary).
        // Stored as a JSON map { sectionKey: bool } where true = collapsed.
        try {
            this._collapsed = JSON.parse(
                localStorage.getItem('craftingTreeSummaryCollapsed') || '{}'
            ) || {};
        } catch (_) {
            this._collapsed = {};
        }
        // Side-drops exclusion: items the user has explicitly opted OUT of
        // the Side Drops Value / Net Profit computation. Stored as a JSON
        // array of item_ids (Set serialized) under
        // `craftingTreeSideDropsExcluded`. Per-tree feels wrong since the
        // user's intent ("never count Hardened kelp in profit") is usually
        // global across goals — and item_ids are unique. Keying by item_id
        // means switching trees keeps the same exclusions, which matches
        // the persistence pattern used for collapse state above.
        try {
            const raw = localStorage.getItem('craftingTreeSideDropsExcluded');
            const parsed = raw ? JSON.parse(raw) : [];
            this._excludedDrops = new Set(Array.isArray(parsed) ? parsed : []);
        } catch (_) {
            this._excludedDrops = new Set();
        }
        this.render();
    }

    /**
     * Map a craft quality tier to the rarity class our CSS already uses
     * for drop-shadow border filters. Targets Normal..Eternal as
     * common..ethereal — same mapping the gear preview uses.
     */
    _qualityToRarity(quality) {
        const map = {
            Normal: 'common', Good: 'uncommon', Great: 'rare',
            Excellent: 'epic', Perfect: 'legendary', Eternal: 'ethereal',
        };
        if (!quality) return null;
        return map[String(quality)] || null;
    }

    /**
     * Resolve the rarity class for a row entry. Quality (Normal/Good/...)
     * wins when present (sub-target craft drops); fall back to entry.rarity
     * (the resolved item's own rarity attr — common for raw materials,
     * higher tiers for crafted-item drops). Returns '' when neither
     * applies so the icon falls back to the unstyled image.
     */
    _rowRarityClass(entry) {
        if (!entry) return '';
        const fromQuality = this._qualityToRarity(entry.quality);
        const r = fromQuality || entry.rarity || '';
        if (!r) return '';
        return ` rarity-${String(r).toLowerCase()}`;
    }

    /**
     * Split a row's display name into (baseName, quality). The summary
     * carries display names like "Steel pickaxe (Good)" for sub-target
     * craft tiers and "Hardened kelp (Fine)" for fine materials. The
     * popover catalog only has the BASE name, and the wiki has one
     * page per crafted item — so we strip the recognized trailing
     * suffix and surface the quality separately. Quality preference:
     * (1) explicit `entry.quality` from the backend (sub-target craft
     * drops), (2) `entry.is_fine` flag → "Fine", (3) parsed " (X)"
     * suffix in the display name where X is a known tier. Anything
     * else returns the original name with empty quality so the call
     * site falls back to a base-name-only popover.
     */
    _splitQualitySuffix(itemName, entry) {
        const KNOWN_TIERS = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal', 'Fine'];
        const name = String(itemName || '');
        // Try to split the display name on a recognized trailing suffix.
        // Case-insensitive match so "fine"/"FINE" still resolve. The
        // regex is greedy on the leading name so item names containing
        // parenthesized text (rare but possible) only lose the LAST
        // " (Tier)" segment.
        const match = name.match(/^(.+?)\s*\((Normal|Good|Great|Excellent|Perfect|Eternal|Fine)\)\s*$/i);
        let baseName = name;
        let parsedTier = '';
        if (match) {
            baseName = match[1];
            // Normalize tier capitalization to the canonical form
            // (catalog stats_by_quality keys are PascalCase).
            const lower = match[2].toLowerCase();
            const canonical = KNOWN_TIERS.find(t => t.toLowerCase() === lower);
            parsedTier = canonical || match[2];
        }
        // Backend-provided quality wins over parsed suffix when both
        // are present (the parse is just defensive).
        const explicit = entry && entry.quality
            ? KNOWN_TIERS.find(t => t.toLowerCase() === String(entry.quality).toLowerCase()) || entry.quality
            : '';
        const fineFlag = entry && entry.is_fine ? 'Fine' : '';
        const quality = explicit || fineFlag || parsedTier || '';
        return { baseName, quality };
    }

    /**
     * Wrap a section's content in a collapsible card. The header gets
     * an expand-arrow that flips between collapsed/expanded; clicking
     * anywhere on the header toggles. Initial display state is read
     * from localStorage so the user's choice survives recalcs.
     */
    _section(key, titleHtml, bodyHtml) {
        const collapsed = !!this._collapsed[key];
        const arrowExpanded = collapsed ? '' : ' expanded';
        const bodyStyle = collapsed ? ' style="display:none"' : '';
        return `
            <div class="tree-summary-section" data-section="${key}">
                <div class="tree-summary-section-title tree-summary-section-toggle" role="button" tabindex="0">
                    <span class="expand-arrow${arrowExpanded}">▼</span>
                    ${titleHtml}
                </div>
                <div class="tree-summary-section-body"${bodyStyle}>${bodyHtml}</div>
            </div>`;
    }

    render() {
        const rawSummary = this.props.summary;
        if (!rawSummary || !rawSummary.total_steps) {
            this.$element.html('');
            return '';
        }

        // When LP Holistic Mode has run, the backend merges LP-optimized
        // totals over the naive ones (e.g. LP re-routes flax demand
        // through butterfly catching instead of kayaking). That conflicts
        // with the per-node card display which stays naive. To keep the
        // page internally consistent we pick:
        //   - toggle OFF (default): naive totals (match what the cards
        //                           sum to, modulo ceiling)
        //   - toggle ON          : LP-optimized totals (+ per-node LP
        //                          insight strips that explain the plan)
        // The backend snapshots the naive values under naive_* keys
        // before applying LP so we can swap without re-running any math.
        // If naive_* aren't present (older cached data) we fall through
        // to whatever's on the summary object.
        const useLp = !!window._craftingTreeShowHolisticDetails
            && rawSummary.lp_mode === 'on'
            && rawSummary.naive_total_steps != null;
        const useNaive = !useLp && rawSummary.naive_total_steps != null;
        let summary = useNaive
            ? {
                ...rawSummary,
                total_steps:       rawSummary.naive_total_steps,
                total_actions:     rawSummary.naive_total_actions,
                time_days:         rawSummary.naive_time_days,
                xp_by_skill:       rawSummary.naive_xp_by_skill,
                shopping_list:     rawSummary.naive_shopping_list,
                cost_breakdown:    rawSummary.naive_cost_breakdown,
                steps_breakdown:   rawSummary.naive_steps_breakdown,
                target_yield:      rawSummary.naive_target_yield,
                target_value:      rawSummary.naive_target_value,
                side_drops:        rawSummary.naive_side_drops,
                side_drops_value:  rawSummary.naive_side_drops_value,
                material_cost:     rawSummary.naive_material_cost,
                net_profit:        rawSummary.naive_net_profit,
            }
            : rawSummary;

        // Override total_steps / total_actions with the ceiled-sum of card
        // totals so the summary arithmetically matches what the user can
        // add up from the visible cards. CraftingTreeView annotates this
        // onto the summary after each tree calculation. Only applied when
        // the Holistic toggle is OFF — when ON the user opted in to
        // seeing LP's optimized plan (which uses different numbers).
        // Bug 3cead1f0, 2026-05-09.
        if (!useLp) {
            // Derive steps-per-day from a known-consistent (steps, days)
            // pair on the raw summary. The backend always computes
            // time_days = total_steps / daily_steps, so this ratio equals
            // daily_steps regardless of which totals we display. Prefer the
            // naive pair (matches this non-LP display path); fall back to
            // the LP pair for older cached data missing naive_*.
            const stepsPerDay = (() => {
                const pairs = [
                    [rawSummary.naive_total_steps, rawSummary.naive_time_days],
                    [rawSummary.total_steps, rawSummary.time_days],
                ];
                for (const [st, dy] of pairs) {
                    if (typeof st === 'number' && typeof dy === 'number'
                            && st > 0 && dy > 0) {
                        return st / dy;
                    }
                }
                return null;
            })();
            if (typeof rawSummary.displayed_cumulative_steps === 'number'
                    && isFinite(rawSummary.displayed_cumulative_steps)) {
                const dispSteps = rawSummary.displayed_cumulative_steps;
                const patch = { total_steps: dispSteps };
                // Bug 61f25e7e: the day count MUST be recomputed from the
                // displayed cumulative total. Previously total_steps was
                // overridden to displayed_cumulative_steps (e.g. 20,192)
                // while time_days was left as naive_time_days (e.g. 0.9),
                // so the headline read "20,192 steps / 0.9 days" instead
                // of "20,192 steps / 2.0 days". Keep the two in sync.
                if (stepsPerDay) {
                    patch.time_days = dispSteps / stepsPerDay;
                }
                summary = { ...summary, ...patch };
            }
            if (typeof rawSummary.displayed_cumulative_actions === 'number'
                    && isFinite(rawSummary.displayed_cumulative_actions)) {
                summary = { ...summary, total_actions: rawSummary.displayed_cumulative_actions };
            }
        }

        // Debug log so we can cross-check summary totals against per-node
        // totals (look for [CT-MATH] in tree-node-card.js). Filter console
        // with [CT-SUMMARY] to isolate. Disable by setting
        // window._craftingTreeDebug = false.
        if (window._craftingTreeDebug !== false) {
            console.log('[CT-SUMMARY]', {
                total_steps: summary.total_steps,
                total_actions: summary.total_actions,
                target_yield: summary.target_yield,
                lp_mode: rawSummary.lp_mode,
                lp_applied_to_display: useLp,
                naive_total_steps: rawSummary.naive_total_steps,
                lp_total_steps_in_raw: rawSummary.total_steps,
                displayed_cumulative_steps: rawSummary.displayed_cumulative_steps,
                displayed_cumulative_actions: rawSummary.displayed_cumulative_actions,
                material_cost: summary.material_cost,
                side_drops_count: (summary.side_drops || []).length,
                time_days: summary.time_days,
            });
        }

        const coinIcon = '<img src="/assets/icons/items/coins.svg" class="coin-icon" alt="coins">';

        const sideDropsValue = Number(summary.side_drops_value || 0);
        const targetValue = Number(summary.target_value || 0);
        const showExtendedMetrics = sideDropsValue > 0 || targetValue > 0;

        const html = `
            <div class="tree-summary-card">
                <div class="tree-summary-header">
                    📊 Summary
                    ${this._renderLpBadge(summary.lp_mode, summary.lp_error)}
                </div>

                ${showExtendedMetrics
                ? this._renderExtendedMetrics(summary, coinIcon)
                : this._renderCompactMetrics(summary, coinIcon)}

                ${this._renderTargetYield(summary.target_yield, coinIcon)}
                ${this._renderSideDrops(summary.side_drops, coinIcon)}
                ${this._renderXP(summary.xp_by_skill, summary.skill_progression)}
                ${this._renderShoppingList(summary.shopping_list)}
                ${this._renderCostBreakdown(summary.cost_breakdown, coinIcon)}
                ${this._renderStepsBreakdown(summary.steps_breakdown)}
                ${this._renderTreeUpgrades(rawSummary.tree_upgrades)}
            </div>
        `;
        this.$element.html(html);
        this._wireSectionToggles();
        this._wireSideDropsCheckboxes();
        this._wireSummaryDropPopovers();
        this._wireTreeUpgrades();
        return html;
    }

    /**
     * Bind click handlers for collapsible section titles. Persists the
     * collapsed/expanded state in localStorage under
     * craftingTreeSummaryCollapsed so the user's choice carries across
     * page reloads AND across the destroy+rebuild cycle that fires
     * every time _calculateOnly re-renders the summary.
     *
     * Uses jQuery slideToggle (matches the gear-preview, location-
     * dropdown, and craftingpoll patterns elsewhere in the codebase
     * — height + padding + margin animate together natively).
     */
    _wireSectionToggles() {
        const self = this;
        // Scope all events to this component's root so multiple
        // simultaneous summary instances (during transitions) don't
        // step on each other.
        this.$element.off('click.ct-summary-toggle keydown.ct-summary-toggle');
        this.$element.on('click.ct-summary-toggle', '.tree-summary-section-toggle', function () {
            const $title = $(this);
            const $section = $title.closest('.tree-summary-section');
            const key = $section.attr('data-section');
            if (!key) return;
            const $body = $section.children('.tree-summary-section-body');
            const $arrow = $title.find('.expand-arrow');
            const collapsed = !$body.is(':visible');
            if (collapsed) {
                $arrow.addClass('expanded');
                $body.slideDown(180);
                self._collapsed[key] = false;
            } else {
                $arrow.removeClass('expanded');
                $body.slideUp(180);
                self._collapsed[key] = true;
            }
            try {
                localStorage.setItem(
                    'craftingTreeSummaryCollapsed',
                    JSON.stringify(self._collapsed),
                );
            } catch (_) { /* noop — storage quota or disabled */ }
        });
        // Keyboard accessibility — Enter / Space on the focused header
        // triggers the same toggle. role=button + tabindex=0 are
        // already on the markup; this just hooks up the activation.
        this.$element.on('keydown.ct-summary-toggle', '.tree-summary-section-toggle', function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });
    }

    /**
     * Wire the per-row include/exclude checkboxes in the Side Drops table
     * + the master checkbox in the table header. Called once after every
     * render() so the bindings are fresh against the new DOM. Recomputes
     * Side Drops Value + Net Profit cells in place using
     * `this._sideDropsList` (stashed by _renderSideDrops) and
     * `this._netProfitInputs` (stashed by _renderExtendedMetrics) — no
     * round-trip to the backend, no full re-render of the summary.
     *
     * Persistence: the excluded set is stored as a JSON array in
     * localStorage.craftingTreeSideDropsExcluded so reloads remember the
     * user's choices per item_id. Newly-appearing items in a future
     * recalc default to "included" (not in the excluded set).
     */
    _wireSideDropsCheckboxes() {
        const self = this;
        // Scope handlers so multiple summary instances during transitions
        // don't double-fire. Mirrors the .ct-summary-toggle pattern above.
        this.$element.off(
            'change.ct-side-drops-cb',
            '.tree-summary-side-drops-row, .tree-summary-side-drops-master',
        );

        // Initial paint: master indeterminate when SOME but not ALL items
        // are checked. checkbox 'checked' attribute can't express the
        // intermediate state, so we set the DOM property after render.
        this._refreshMasterCheckboxState();

        this.$element.on(
            'change.ct-side-drops-cb',
            '.tree-summary-side-drops-row',
            function () {
                const $cb = $(this);
                const key = $cb.attr('data-row-key');
                if (!key) return;
                if ($cb.is(':checked')) {
                    self._excludedDrops.delete(key);
                } else {
                    self._excludedDrops.add(key);
                }
                self._persistExcludedDrops();
                self._refreshMasterCheckboxState();
                self._refreshSideDropsTotals();
            },
        );

        this.$element.on(
            'change.ct-side-drops-cb',
            '.tree-summary-side-drops-master',
            function () {
                const $master = $(this);
                const checked = $master.is(':checked');
                const list = self._sideDropsList || [];
                if (checked) {
                    // Master toggled ON → re-include every current item.
                    // We only clear keys we know about (the current side
                    // drops) so any stale exclusions for items not in
                    // this tree's drop list are preserved — they rejoin
                    // when (if) the item shows up again.
                    for (const e of list) {
                        self._excludedDrops.delete(self._sideDropRowKey(e));
                    }
                } else {
                    // Master toggled OFF → exclude every current item.
                    for (const e of list) {
                        self._excludedDrops.add(self._sideDropRowKey(e));
                    }
                }
                // Sync per-row checkboxes to the new state.
                self.$element.find('.tree-summary-side-drops-row').each(function () {
                    const $row = $(this);
                    const k = $row.attr('data-row-key');
                    $row.prop('checked', !self._excludedDrops.has(k));
                });
                self._persistExcludedDrops();
                self._refreshMasterCheckboxState();
                self._refreshSideDropsTotals();
            },
        );
    }

    /** Set the master checkbox's checked / indeterminate state from the
     * current excluded set. HTML can't express tri-state via attributes,
     * so this is always called after a state change. */
    _refreshMasterCheckboxState() {
        const list = this._sideDropsList || [];
        const $master = this.$element.find('.tree-summary-side-drops-master');
        if (!$master.length) return;
        const total = list.length;
        const includedCount = list.reduce(
            (n, e) => n + (this._excludedDrops.has(this._sideDropRowKey(e)) ? 0 : 1),
            0,
        );
        if (total === 0) {
            $master.prop('checked', true).prop('indeterminate', false);
        } else if (includedCount === total) {
            $master.prop('checked', true).prop('indeterminate', false);
        } else if (includedCount === 0) {
            $master.prop('checked', false).prop('indeterminate', false);
        } else {
            $master.prop('checked', false).prop('indeterminate', true);
        }
    }

    /** Recompute Side Drops Value + Net Profit metric cells in place
     * using the stashed list and target/material totals. Same formula as
     * _renderExtendedMetrics so the displayed values stay coherent on
     * every checkbox change without re-rendering the whole summary. */
    _refreshSideDropsTotals() {
        const list = this._sideDropsList || [];
        const inputs = this._netProfitInputs || { targetValue: 0, materialCost: 0 };
        const coinIcon = this._coinIconHtml || '';
        const effective = list.reduce((sum, e) => {
            const k = this._sideDropRowKey(e);
            if (this._excludedDrops.has(k)) return sum;
            return sum + Number(e.total_value || 0);
        }, 0);
        const formatted = effective.toLocaleString(undefined, { maximumFractionDigits: 0 });
        const $sd = this.$element.find('[data-side-drops-value-cell]');
        if ($sd.length) {
            $sd.html(`${formatted} ${coinIcon}`);
        }
        const $np = this.$element.find('[data-net-profit-cell]');
        if ($np.length) {
            const netProfit = Number(inputs.targetValue) + effective - Number(inputs.materialCost);
            const npFormatted = netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 });
            $np.html(`${npFormatted} ${coinIcon}`);
            // Flip the .tree-summary-metric--negative modifier on the
            // wrapping metric div when sign changes. Same affordance the
            // initial render uses.
            const $metric = this.$element.find('[data-net-profit-metric]');
            if ($metric.length) {
                $metric.toggleClass('tree-summary-metric--negative', netProfit < 0);
            }
        }
    }

    /** Persist the excluded item_id set to localStorage so reloads
     * remember the user's per-item include/exclude choices. */
    _persistExcludedDrops() {
        try {
            localStorage.setItem(
                'craftingTreeSideDropsExcluded',
                JSON.stringify(Array.from(this._excludedDrops)),
            );
        } catch (_) { /* noop — storage quota or disabled */ }
    }

    /**
     * Wire hover + click drop-item popovers on every Target Yield and
     * Side Drops row. Mirrors `_wireComparisonDropPopovers()` in
     * gearset-comparison-section.js — finds anchors stamped with
     * `data-drop-name` (and optionally `data-drop-container="1"`) and
     * defers to the shared `wireDropAnchor()` helper from
     * drop-item-popover.js so behavior matches the drops section
     * exactly: desktop hover shows / mouseout hides, click pins,
     * mobile tap toggles, outside tap dismisses.
     *
     * Re-runs on every render() because the summary tree DOM is
     * destroyed + rebuilt on each recalc. wireDropAnchor() guards
     * against double-wiring via a `data-dropWired` marker, but the
     * elements are fresh every render so that's a no-op here.
     */
    _wireSummaryDropPopovers() {
        const root = this.$element[0];
        if (!root) return;
        const anchors = root.querySelectorAll('.tree-summary-drop-anchor[data-drop-name]');
        anchors.forEach((anchor) => {
            const dropName = anchor.dataset.dropName;
            const isContainer = anchor.dataset.dropContainer === '1';
            if (!dropName) return;
            wireDropAnchor(anchor, dropName, isContainer);
        });
    }

    // ------------------------------------------------------------------
    // Compact metrics row (legacy 3-metric display)
    // ------------------------------------------------------------------
    _renderCompactMetrics(summary, coinIcon) {
        const totalCost = (summary.cost_breakdown || []).reduce((s, c) => s + c.total_cost, 0);
        return `
            <div class="tree-summary-metrics">
                <div class="tree-summary-metric">
                    <div class="tree-summary-metric-label">Total Steps</div>
                    <div class="tree-summary-metric-value">${summary.total_steps.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                </div>
                <div class="tree-summary-metric">
                    <div class="tree-summary-metric-label">Est. Time</div>
                    <div class="tree-summary-metric-value">${formatFixed(summary.time_days, 1)} days</div>
                </div>
                <div class="tree-summary-metric">
                    <div class="tree-summary-metric-label">Total Cost</div>
                    <div class="tree-summary-metric-value">
                        ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${coinIcon}
                    </div>
                </div>
            </div>`;
    }

    // ------------------------------------------------------------------
    // Extended metrics row — same flex layout, just more cells.
    // Shown when side_drops_value > 0 or target_value > 0.
    // ------------------------------------------------------------------
    _renderExtendedMetrics(summary, coinIcon) {
        const materialCost = Number(summary.material_cost
            ?? (summary.cost_breakdown || []).reduce((s, c) => s + c.total_cost, 0));
        const totalXp = Object.values(summary.xp_by_skill || {}).reduce((s, v) => s + (v || 0), 0);
        // Compute the *effective* side drops value — the sum of total_value
        // for items the user hasn't excluded via the per-row checkboxes
        // (see _renderSideDrops). When no exclusions are active this equals
        // summary.side_drops_value exactly. Net Profit is derived from the
        // same effective number, so when the user unchecks an item the
        // figures stay coherent. The backend's raw summary.side_drops_value
        // / summary.net_profit fields are NOT mutated — exclusion is a
        // pure UI overlay; an export of the saved tree state still carries
        // the unfiltered totals.
        const excluded = this._excludedDrops || new Set();
        const sideDropsList = summary.side_drops || [];
        const effectiveSideDropsValue = sideDropsList.reduce((sum, e) => {
            const key = this._sideDropRowKey(e);
            if (excluded.has(key)) return sum;
            return sum + Number(e.total_value || 0);
        }, 0);
        // Stash the target value so the change handler can recompute net
        // profit without re-reading the DOM. target_value comes from the
        // backend summary's target_yield rollup and doesn't change with
        // checkbox toggles.
        const targetValue = Number(summary.target_value || 0);
        this._netProfitInputs = { targetValue, materialCost };
        const effectiveNetProfit = targetValue + effectiveSideDropsValue - materialCost;
        const profitModifier = effectiveNetProfit >= 0 ? '' : ' tree-summary-metric--negative';

        const cells = [];

        cells.push(`
            <div class="tree-summary-metric">
                <div class="tree-summary-metric-label">Total Steps</div>
                <div class="tree-summary-metric-value">${summary.total_steps.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                <div class="tree-summary-metric-sub">${formatFixed(summary.time_days, 1)} days</div>
            </div>`);

        // "Material Cost" only counts shop-purchased / bank-withdrawn
        // materials — anything produced internally by sub-recipes /
        // activities is netted out into side_drops by the LP solver and
        // never hits a coin price. When the tree is fully self-sufficient
        // (no shopping, no bank source) materialCost is always 0 and the
        // "Net Profit" line collapses to target_value + side_drops_value,
        // which is already shown above. Showing both rows in that case
        // misleads users who think the recipe inputs should be subtracted
        // (Hardened kelp going into Kelp twine, etc.) — they're not, they
        // were produced for free by the tree itself. Bug 8047cd50
        // (darkbow): "net profit and material cost don't work yet.
        // Materials used in the recipe should be a cost and should be
        // subtracted from the profit."
        const _hasRealCost = materialCost > 0
            || ((summary.shopping_list || []).length > 0)
            || ((summary.cost_breakdown || []).length > 0);
        if (_hasRealCost) {
            cells.push(`
                <div class="tree-summary-metric">
                    <div class="tree-summary-metric-label">Material Cost</div>
                    <div class="tree-summary-metric-value">${materialCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${coinIcon}</div>
                </div>`);
        }

        cells.push(`
            <div class="tree-summary-metric">
                <div class="tree-summary-metric-label">Total XP Yield</div>
                <div class="tree-summary-metric-value">${totalXp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>`);

        // Side Drops Value cell — always rendered when there's any side
        // drop value (even after exclusions), so the user can re-include
        // items by toggling checkboxes and see the number recover live.
        // data-side-drops-value-cell tags the metric value <div> so the
        // checkbox change handler can update its text in place.
        if (effectiveSideDropsValue > 0 || sideDropsList.length > 0) {
            cells.push(`
                <div class="tree-summary-metric">
                    <div class="tree-summary-metric-label">Side Drops Value</div>
                    <div class="tree-summary-metric-value" data-side-drops-value-cell>${effectiveSideDropsValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${coinIcon}</div>
                </div>`);
        }

        // Net Profit only meaningful when there's a real material cost
        // to subtract (otherwise it's just target_value + side_drops which
        // are both already shown). See _hasRealCost reasoning above.
        // data-net-profit-cell tags the value div so the handler can
        // update both the number and the .tree-summary-metric--negative
        // modifier when the sign flips.
        if (_hasRealCost) {
            cells.push(`
                <div class="tree-summary-metric${profitModifier}" data-net-profit-metric>
                    <div class="tree-summary-metric-label">Net Profit</div>
                    <div class="tree-summary-metric-value" data-net-profit-cell>${effectiveNetProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${coinIcon}</div>
                </div>`);
        }

        // Stash the coin-icon HTML so the change handler can re-render
        // the metric values with the same trailing icon as the initial
        // paint (no need to re-fetch from the DOM).
        this._coinIconHtml = coinIcon;

        return `<div class="tree-summary-metrics">${cells.join('')}</div>`;
    }

    // ------------------------------------------------------------------
    // Target yield — shown when there are multiple quality variants or when
    // the target value is worth displaying.
    // ------------------------------------------------------------------
    _renderTargetYield(targetYield, coinIcon) {
        if (!targetYield || !targetYield.length) return '';
        const totalValue = targetYield.reduce((s, e) => s + (Number(e.value || 0)), 0);
        if (targetYield.length <= 1 && totalValue <= 0) return '';

        const rows = targetYield.map(e => {
            const qty = Number(e.quantity || 0);
            const value = Number(e.value || 0);
            // Quality drives the drop-shadow filter via .rarity-* class
            // — Normal→common, Good→uncommon, Great→rare, etc. Same
            // pattern the gear preview uses on .item-icon.
            const rarityCls = this._rowRarityClass(e);
            const iconHtml = e.icon_path
                ? `<img src="${this._escape(e.icon_path)}" class="tree-summary-row-icon${rarityCls}" alt="" onerror="this.style.display='none'"> `
                : '';
            // Wrap icon+name in a single anchor span so we can wire the
            // drop-item popover (same hover/click affordance as the
            // drops section). _wireSummaryDropPopovers below picks these
            // up by `.tree-summary-drop-anchor[data-drop-name]`. Skip
            // anchoring synthetic Coins/Currency rows — the popover
            // catalog has no entry for currency.
            //
            // Quality variants ("Steel pickaxe (Good)") and fine
            // materials ("Hardened kelp (Fine)") need special handling:
            // the catalog only has the BASE name ("Steel pickaxe"), and
            // the wiki has one page per crafted item (no per-quality
            // pages). We strip the trailing " (Quality)" suffix and pass
            // the base name to the popover, while passing the quality
            // tier separately so the popover can render the matching
            // tier's stats from the catalog item's stats_by_quality map.
            const itemName = String(e.item || '');
            const itemId = String(e.item_id || '');
            const isCurrency = itemId.startsWith('Currency.') || itemName === 'Coins';
            const { baseName, quality } = this._splitQualitySuffix(itemName, e);
            const dataQualityAttr = quality ? ` data-drop-quality="${this._escape(quality)}"` : '';
            const inner = `${iconHtml}${this._escape(itemName)}`;
            const cell = (baseName && !isCurrency)
                ? `<span class="tree-summary-drop-anchor" data-drop-name="${this._escape(baseName)}"${dataQualityAttr}>${inner}</span>`
                : inner;
            return `<tr>
                <td>${cell}</td>
                <td>${qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td>${value > 0 ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + coinIcon : '—'}</td>
            </tr>`;
        }).join('');
        const body = `<table class="tree-summary-table"><thead><tr><th>Item</th><th>Quantity</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('target_yield', '🎯 Target Yield', body);
    }

    // ------------------------------------------------------------------
    // Side drops table — sorted by total_value desc. Header uses the DR
    // (double-rewards) icon since side drops are the same kind of yield.
    // ------------------------------------------------------------------
    _renderSideDrops(sideDrops, coinIcon) {
        if (!sideDrops || !sideDrops.length) return '';
        const drIcon = '<img src="/assets/icons/attributes/double_rewards.svg" class="tree-stat-icon" alt="" onerror="this.style.display=\'none\'">';
        const sorted = [...sideDrops].sort((a, b) => (b.total_value || 0) - (a.total_value || 0));
        // Stash the sorted side-drops list so the checkbox change handler
        // can re-aggregate "Side Drops Value" and "Net Profit" without a
        // full re-render. Keyed only on item_id (since every drop has a
        // unique item_id within a tree); falls back to label when item_id
        // is missing (defensive — backend always emits item_id today).
        this._sideDropsList = sorted;
        // Compute included/excluded counts up front to drive the master
        // checkbox state (checked / unchecked / indeterminate).
        const totalCount = sorted.length;
        const excluded = this._excludedDrops || new Set();
        const includedCount = sorted.reduce(
            (n, e) => n + (excluded.has(this._sideDropRowKey(e)) ? 0 : 1),
            0,
        );
        const allChecked = includedCount === totalCount;
        const noneChecked = includedCount === 0;
        // Master checkbox: tri-state. We render `checked` when all items
        // are included and rely on the change handler to flip
        // `indeterminate` after render (HTML attribute can't express the
        // mid state). _wireSideDropsCheckboxes handles the post-render
        // indeterminate paint.
        const masterChecked = allChecked ? ' checked' : '';
        // Right-align the checkbox column header + cells via inline
        // style. This is a one-off layout tweak and doesn't justify a
        // styles.css addition (per user pref: don't touch CSS unless
        // asked). The inputs themselves inherit the page's native form
        // styling, so they look consistent with the rest of the app.
        const cbHeader = `<th style="text-align:right; width:1.5em;">`
            + `<input type="checkbox" class="tree-summary-side-drops-master"`
            + ` aria-label="Include all in Side Drops Value"${masterChecked}>`
            + `</th>`;
        const rows = sorted.map(e => {
            const qty = Number(e.quantity || 0);
            const unit = Number(e.unit_value || 0);
            const total = Number(e.total_value || 0);
            const fineCls = e.is_fine ? ' fine' : '';
            const rarityCls = e.is_fine ? '' : this._rowRarityClass(e);
            const iconHtml = e.icon_path
                ? `<img src="${this._escape(e.icon_path)}" class="tree-summary-row-icon${fineCls}${rarityCls}" alt="" onerror="this.style.display='none'"> `
                : '';
            const rowKey = this._sideDropRowKey(e);
            const rowChecked = excluded.has(rowKey) ? '' : ' checked';
            const cbCell = `<td style="text-align:right;">`
                + `<input type="checkbox" class="tree-summary-side-drops-row"`
                + ` data-row-key="${this._escape(rowKey)}"`
                + ` aria-label="Include ${this._escape(e.item || rowKey)} in Side Drops Value"`
                + `${rowChecked}>`
                + `</td>`;
            // Wrap icon+name in a single anchor span so we can wire the
            // drop-item popover (same hover/click affordance as the
            // drops section). Containers (Container.*) get the
            // container popover variant. Currency rows are skipped —
            // the popover catalog has no entry for Coins.
            //
            // Quality variants ("Steel pickaxe (Good)") and fine
            // materials ("Hardened kelp (Fine)") need special handling:
            // the catalog only has the BASE name and the wiki has one
            // page per crafted item. We strip the trailing " (Quality)"
            // suffix, pass the base name to the popover, and pass the
            // quality tier separately so the popover renders the
            // matching tier's stats. Containers don't carry quality.
            const itemName = String(e.item || '');
            const itemId = String(e.item_id || '');
            const isContainer = itemId.startsWith('Container.');
            const isCurrency = itemId.startsWith('Currency.') || itemName === 'Coins';
            const { baseName, quality } = isContainer
                ? { baseName: itemName, quality: '' }
                : this._splitQualitySuffix(itemName, e);
            const dataQualityAttr = (!isContainer && quality) ? ` data-drop-quality="${this._escape(quality)}"` : '';
            const inner = `${iconHtml}${this._escape(itemName)}`;
            const cell = (baseName && !isCurrency)
                ? `<span class="tree-summary-drop-anchor" data-drop-name="${this._escape(baseName)}"${isContainer ? ' data-drop-container="1"' : ''}${dataQualityAttr}>${inner}</span>`
                : inner;
            return `<tr>
                <td>${cell}</td>
                <td>${qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td>${unit > 0 ? unit.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + coinIcon : '—'}</td>
                <td>${total > 0 ? total.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + coinIcon : '—'}</td>
                ${cbCell}
            </tr>`;
        }).join('');
        const body = `<table class="tree-summary-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th>${cbHeader}</tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('side_drops', `${drIcon} Side Drops`, body);
    }

    /**
     * Stable key for a side-drops row. Backend always emits item_id; fall
     * back to item label for defensive null-safety. Same key is used for
     * the localStorage exclusion set so reload preserves the user's
     * choices.
     */
    _sideDropRowKey(entry) {
        if (!entry) return '';
        return String(entry.item_id || entry.item || '');
    }

    // ------------------------------------------------------------------
    // LP mode badge — green "on", amber "fallback", nothing for "off".
    // Gated on the "Show Holistic Mode details" toggle (persisted in
    // localStorage, default OFF). The underlying LP totals are still
    // applied regardless — this flag only controls visibility. Debug
    // info is also written to the console under [CT-LP-SUMMARY] when
    // window._craftingTreeDebug is not explicitly false, so engineers
    // can always inspect the LP state without toggling the UI.
    //
    // We always render the badge element when lp_mode is on/fallback and
    // apply `display:none` inline when the toggle is off. The toggle
    // handler can then slideDown/slideUp the existing node instead of
    // re-rendering the summary — avoids a jarring full rebuild.
    // ------------------------------------------------------------------
    _renderLpBadge(lpMode, lpError) {
        // The "Holistic Mode" / "Holistic Mode Fallback" badge was
        // retired 2026-05-15: LP is now enabled for ALL sessions, so
        // the badge no longer carried information beyond noise.
        // Fallback is still logged to the console as
        // [CT-LP-SUMMARY] so engineers can spot it without a UI
        // affordance.
        if (window._craftingTreeDebug !== false) {
            // eslint-disable-next-line no-console
            console.log('[CT-LP-SUMMARY]', { lp_mode: lpMode || 'off', lp_error: lpError || null });
        }
        return '';
    }

    _renderXP(xpBySkill, skillProgression) {
        if (!xpBySkill || !Object.keys(xpBySkill).length) return '';
        // Header icon: generic "bonus experience" attribute icon is the
        // closest app-wide XP glyph (used in gear/activity info panels
        // too). Each skill row also gets its own icon and a capitalized
        // first letter — skill keys from the backend are lowercase
        // (agility, woodcutting, etc.) but the user reads them as
        // proper nouns.
        //
        // skillProgression (keyed by lowercased skill name, emitted by
        // the backend from session.skills_xp + xp_to_level) carries
        // level_before and level_after per skill. When present AND the
        // optimize actually levels the skill up, the Level cell shows
        // "52 → 54". When the level doesn't change, it shows the
        // current level only. When the session didn't carry skill XP
        // (level_before === null), the column renders "—" so the
        // header alignment stays consistent.
        const progression = skillProgression || {};
        const hasProgression = Object.keys(progression).length > 0;
        const xpIcon = '<img src="/assets/icons/attributes/bonus_experience.svg" class="tree-stat-icon" alt="" onerror="this.style.display=\'none\'">';
        const rows = Object.entries(xpBySkill)
            .filter(([, xp]) => xp > 0)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([skill, xp]) => {
                const skillLower = String(skill || '').toLowerCase();
                const capName = skillLower
                    ? skillLower.charAt(0).toUpperCase() + skillLower.slice(1)
                    : '';
                const skillIcon = skillLower
                    ? `<img src="/assets/icons/text/skill_icons/${skillLower}.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'">`
                    : '';
                const xpText = xp.toLocaleString(undefined, { maximumFractionDigits: 1 });
                let levelCell = '';
                if (hasProgression) {
                    const p = progression[skillLower];
                    if (p && p.level_before != null && p.level_after != null) {
                        levelCell = p.level_after > p.level_before
                            ? `${p.level_before} → ${p.level_after}`
                            : `${p.level_before}`;
                    } else {
                        levelCell = '—';
                    }
                }
                const levelTd = hasProgression ? `<td>${levelCell}</td>` : '';
                return `<tr><td>${skillIcon} ${capName}</td><td>${xpText}</td>${levelTd}</tr>`;
            })
            .join('');
        const levelTh = hasProgression ? '<th>Level</th>' : '';
        const body = `<table class="tree-summary-table"><thead><tr><th>Skill</th><th>XP</th>${levelTh}</tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('xp_by_skill', `${xpIcon} XP by Skill`, body);
    }

    _renderShoppingList(list) {
        // Coin icon left of the "Shopping List" header (replaces the
        // 🛒 emoji that used to lead the title). Same icon also appears
        // next to cost values elsewhere on the dashboard — keeping the
        // association between shopping list and spend.
        const coinIcon = '<img src="/assets/icons/items/coins.svg" class="coin-icon" alt="coins">';
        if (!list || !list.length) {
            const emptyBody = '<p class="tree-summary-empty">No raw materials needed from bank</p>';
            return this._section('shopping_list', `${coinIcon} Shopping List`, emptyBody);
        }
        const rows = list.map(item => {
            const rarityCls = this._rowRarityClass(item);
            const iconHtml = item.icon_path
                ? `<img src="${this._escape(item.icon_path)}" class="tree-summary-row-icon${rarityCls}" alt="" onerror="this.style.display='none'"> `
                : '';
            return `<tr><td>${iconHtml}${this._escape(item.name)}</td><td>${formatFixed(item.quantity, 2)}</td></tr>`;
        }).join('');
        const body = `<table class="tree-summary-table"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('shopping_list', `${coinIcon} Shopping List`, body);
    }

    _renderCostBreakdown(costs, coinIcon) {
        if (!costs || !costs.length) return '';
        const rows = costs
            .slice()
            .sort((a, b) => b.total_cost - a.total_cost)
            .map(c => `<tr><td>${this._escape(c.item)}</td><td>${formatFixed(c.quantity, 2)}</td><td>${formatFixed(c.unit_value, 1)}</td><td>${formatFixed(c.total_cost, 1)} ${coinIcon}</td></tr>`)
            .join('');
        const body = `<table class="tree-summary-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('cost_breakdown', '🪙 Cost Breakdown', body);
    }

    _renderStepsBreakdown(steps) {
        if (!steps || !steps.length) return '';
        const stepsIcon = '<img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display=\'none\'">';
        const rows = steps
            .filter(s => s.steps > 0)
            .slice()
            .sort((a, b) => b.steps - a.steps)
            .map(s => {
                const iconHtml = s.source_icon
                    ? `<img src="${this._escape(s.source_icon)}" class="tree-summary-row-icon" alt="" onerror="this.style.display='none'"> `
                    : '';
                return `<tr><td>${iconHtml}${this._escape(s.source)}</td><td>${stepsIcon} ${s.steps.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td></tr>`;
            })
            .join('');
        const body = `<table class="tree-summary-table"><thead><tr><th>Source</th><th>Steps</th></tr></thead><tbody>${rows}</tbody></table>`;
        return this._section('steps_breakdown', `${stepsIcon} Steps Breakdown`, body);
    }

    /**
     * Render the "Non-owned/Locked Upgrades" section. Aggregated by the
     * backend's _aggregate_tree_upgrades helper into one entry per
     * (item, quality) with total step savings across the tree and a
     * per-node breakdown attached. User-requested feature 2026-05-19:
     * "shows the items, shows what activity/recipe (or multiple) it
     * will be an upgrade on, and then show how many steps TOTAL it
     * will save... List the recipe/activity below the item
     * (collapsible) and also have the 'source' modal in that section."
     *
     * Each entry is collapsible — clicking the row reveals a per-node
     * table of how much each node saves, plus a "Sources" expandable
     * that fetches /api/item-sources for the item and renders where
     * it drops / can be crafted (same data the slot popup uses).
     */
    _renderTreeUpgrades(treeUpgrades) {
        if (!Array.isArray(treeUpgrades) || treeUpgrades.length === 0) return '';

        const rows = treeUpgrades.map((entry, idx) => {
            const totalDelta = Math.round(entry.total_delta || 0);
            const sign = totalDelta < 0 ? '−' : (totalDelta > 0 ? '+' : '');
            const absSteps = Math.abs(totalDelta).toLocaleString();
            // Negative delta = improvement (fewer steps). Most upgrades
            // will be negative; show them as savings. The rare positive
            // case (a locked alt that's actually worse but in the list
            // due to scoring quirks) is highlighted as a cost.
            const savingsClass = totalDelta < 0 ? 'tree-upgrade-savings'
                : (totalDelta > 0 ? 'tree-upgrade-cost' : 'tree-upgrade-neutral');
            const stepsText = `${sign}${absSteps} steps total`;

            // Strip "(Quality)" off the name for icon path lookup but
            // keep it in the displayed name. Mirrors the popup's
            // _renderAltItemRow icon resolution.
            const baseName = String(entry.name || '')
                .replace(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/, '');
            const iconName = baseName.toLowerCase()
                .replace(/ /g, '_').replace(/[()]/g, '');
            const iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
            const rarityClass = this._rowRarityClass({
                quality: entry.quality, rarity: entry.rarity,
            });
            const iconHtml = `<img src="${iconPath}" class="tree-summary-row-icon${rarityClass}" alt="" onerror="this.style.display='none'">`;

            const lockedBadge = entry.is_locked
                ? ' <span class="tree-upgrade-locked-badge" title="Locked behind requirements">🔒</span>'
                : '';

            // Per-node breakdown table — sorted backend-side by biggest
            // savings within the entry.
            const nodeRows = (entry.nodes || []).map((n) => {
                const nodeIconHtml = n.icon_path
                    ? `<img src="${this._escape(n.icon_path)}" class="tree-upgrade-node-icon" alt="" onerror="this.style.display='none'"> `
                    : '';
                // Source-node label: the user wants the NODE'S item
                // (the thing being made/gathered) front-and-center, not
                // the recipe/activity ID buried inside a "Recipe: X"
                // prefix that's the same for every row of a parent
                // recipe. Show item_name first, then a small (Recipe)
                // / (Activity) suffix so the user can tell at a glance
                // whether to look in the crafting tab or the activity
                // tab. User feedback 2026-05-19.
                const sourceTypeLabel = n.source_type
                    ? ` (${n.source_type.charAt(0).toUpperCase()}${n.source_type.slice(1)})`
                    : '';
                const primaryLabel = n.item_name || n.source_id || '?';
                const sourceLabel = `${primaryLabel}${sourceTypeLabel}`;
                const replacesLabel = n.replaces ? ` (replaces ${this._escape(n.replaces)})` : '';
                const nodeDelta = Math.round(n.delta || 0);
                const nodeSign = nodeDelta < 0 ? '−' : (nodeDelta > 0 ? '+' : '');
                const nodeAbs = Math.abs(nodeDelta).toLocaleString();
                const slotLabel = this._formatSlotName(n.slot);
                return `<tr>
                    <td>${nodeIconHtml}${this._escape(sourceLabel)}<span class="tree-upgrade-node-replaces">${replacesLabel}</span></td>
                    <td>${this._escape(slotLabel)}</td>
                    <td class="${savingsClass}">${nodeSign}${nodeAbs} steps</td>
                </tr>`;
            }).join('');

            const missingReqsHtml = (entry.is_locked
                    && Array.isArray(entry.missing_requirements)
                    && entry.missing_requirements.length)
                ? `<div class="tree-upgrade-missing-reqs">⚠ Locked: ${
                    entry.missing_requirements.map(r => this._escape(r)).join('; ')
                  }</div>`
                : '';

            const escapedName = this._escape(entry.name || '');
            const escapedBase = this._escape(baseName);
            // Action buttons row at the TOP of the expanded details:
            //   - Sources: same `btn-source-dropdown` styling as
            //     column 1 owned items (item-row.js), expandable
            //     inline list.
            //   - Stats: `tree-summary-drop-anchor` element wired to
            //     drop-item-popover.js — same hover/click popover the
            //     side-drops and target-item rows use elsewhere in the
            //     summary. Quality is passed via data-drop-quality so
            //     the popover renders the right tier.
            // User feedback 2026-05-19.
            const dataQualityAttr = entry.quality
                ? ` data-drop-quality="${this._escape(entry.quality)}"`
                : '';
            const actionsHtml = `
                <div class="tree-upgrade-actions-row">
                    <button class="btn-source-dropdown tree-upgrade-sources-btn" data-item-name="${escapedBase}" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>
                    <button class="btn-source-dropdown tree-upgrade-stats-btn tree-summary-drop-anchor" data-drop-name="${escapedBase}"${dataQualityAttr} title="Show stats for this item" type="button">Stats</button>
                </div>
                <div class="tree-upgrade-sources-container" style="display:none"></div>`;
            return `
                <div class="tree-upgrade-entry" data-entry-idx="${idx}">
                    <div class="tree-upgrade-row" role="button" tabindex="0">
                        <span class="expand-arrow">▼</span>
                        ${iconHtml}
                        <span class="tree-upgrade-name">${escapedName}</span>
                        ${lockedBadge}
                        <span class="tree-upgrade-total ${savingsClass}">${stepsText}</span>
                    </div>
                    <div class="tree-upgrade-details" style="display:none">
                        ${missingReqsHtml}
                        ${actionsHtml}
                        <table class="tree-summary-table tree-upgrade-nodes-table">
                            <thead><tr><th>Source Node</th><th>Slot</th><th>Saved</th></tr></thead>
                            <tbody>${nodeRows}</tbody>
                        </table>
                    </div>
                </div>`;
        }).join('');

        const stepsIcon = '<img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display=\'none\'">';
        const countBadge = `<span class="tree-summary-count">${treeUpgrades.length}</span>`;
        return this._section(
            'tree_upgrades',
            `${stepsIcon} Non-owned/Locked Upgrades ${countBadge}`,
            `<div class="tree-upgrades-list">${rows}</div>`,
        );
    }

    /**
     * Friendly slot label so the per-node breakdown table reads
     * "Hands" / "Tool 0" instead of "hands" / "tool0".
     */
    _formatSlotName(slot) {
        if (!slot) return '';
        if (slot.startsWith('tool')) {
            // Tool slots are stored 0-indexed (tool0..tool5) but the user
            // sees them 1-indexed in the gear popup ("Tool 1".."Tool 6")
            // and gear-slot-grid label table. Match that convention here.
            // User feedback 2026-05-19: "don't say Tool 0 (hover over the
            // slot and in upgrade items) as it's tool 1."
            const n = parseInt(slot.slice(4), 10);
            return Number.isFinite(n) ? `Tool ${n + 1}` : `Tool ${slot.slice(4)}`;
        }
        if (slot === 'ring1' || slot === 'ring2') {
            return `Ring ${slot.slice(4)}`;
        }
        return slot.charAt(0).toUpperCase() + slot.slice(1);
    }

    /**
     * Wire click handlers for the tree-upgrades section: expand/collapse
     * the per-entry details and lazy-load + toggle the per-entry
     * Sources expandable. Mirrors the existing alt-sources flow in
     * item-selection-popup.js so the source rendering matches what the
     * user already sees in the slot popup.
     */
    _wireTreeUpgrades() {
        const self = this;
        // Remove previous bindings before adding new ones — this method
        // can re-fire on re-render.
        this.$element.off('click.tu keydown.tu');

        // Wire the per-entry Stats anchor (drop-item-popover) — same
        // hover/click affordance as side drops and target item. We do
        // this synchronously so the anchors are interactive
        // immediately; wireDropAnchor is idempotent (data-drop-wired
        // guard) so it's safe to call on every render.
        const root = this.$element[0];
        if (root) {
            const anchors = root.querySelectorAll('.tree-upgrade-stats-btn[data-drop-name]');
            anchors.forEach((a) => {
                wireDropAnchor(a, a.dataset.dropName, false);
            });
        }

        // Expand/collapse per-item row.
        this.$element.on('click.tu keydown.tu', '.tree-upgrade-row', function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            // Don't toggle if the click was on an action link inside
            // the details (defensive — nothing should bubble through
            // because details start hidden).
            if ($(e.target).closest('.tree-upgrade-sources-btn, .tree-upgrade-sources-container, .tree-upgrade-stats-btn').length) return;
            e.preventDefault();
            const $row = $(this);
            const $details = $row.siblings('.tree-upgrade-details');
            const $arrow = $row.find('.expand-arrow');
            $details.slideToggle(150);
            $arrow.toggleClass('expanded');
        });

        // Sources expandable inside an entry's details. Uses the same
        // `.open` class convention as column 1 owned items
        // (item-row.js + .source-arrow CSS).
        this.$element.on('click.tu', '.tree-upgrade-sources-btn', async function (e) {
            e.stopPropagation();
            e.preventDefault();
            const $btn = $(this);
            const itemName = $btn.data('item-name');
            const $container = $btn.closest('.tree-upgrade-details')
                .find('.tree-upgrade-sources-container');
            const $arrow = $btn.find('.source-arrow');

            // Toggle off if already loaded + visible.
            if ($container.is(':visible') && $container.children().length > 0) {
                $arrow.removeClass('open');
                $container.slideUp(150);
                return;
            }

            $arrow.addClass('open');
            $container.html('<div class="source-loading">Loading sources...</div>').slideDown(150);
            try {
                const data = await api.getItemSources();
                const lookupName = String(itemName).toLowerCase().trim();
                const sources = (data && data.sources && data.sources[lookupName]) || [];
                $container.html(self._renderSourcesList(sources));
            } catch (err) {
                console.warn('[ct-summary] sources fetch failed:', err);
                $container.html('<div class="source-empty">Failed to load sources</div>');
            }
        });

        // Source-item click navigates to column 3 + closes the tree
        // (same UX as the popup's source-item click in tree-context).
        this.$element.on('click.tu', '.tree-upgrade-sources-container .source-item:not(.source-item-no-click)', function (e) {
            const sourceType = $(this).data('source-type');
            const sourceId = $(this).data('source-id');
            const closeTree = () => {
                $('.crafting-tree-close-btn').first().trigger('click');
            };
            if (typeof window !== 'undefined' && window.store) {
                if (sourceType === 'activity_drop' && sourceId) {
                    window.store.update('column3.selectedActivity', sourceId);
                    window.store.update('column3.selectedRecipe', null);
                    closeTree();
                } else if ((sourceType === 'recipe_output'
                        || sourceType === 'recipe_drop'
                        || sourceType === 'recipe_input') && sourceId) {
                    window.store.update('column3.selectedRecipe', sourceId);
                    window.store.update('column3.selectedActivity', null);
                    closeTree();
                }
            }
        });
    }

    /**
     * Render the sources list HTML for an item (activity drops, recipe
     * outputs, etc). Mirrors the markup the slot popup uses so the
     * existing CSS for .source-item / .source-group-header / etc.
     * applies without changes.
     */
    _renderSourcesList(sources) {
        if (!Array.isArray(sources) || sources.length === 0) {
            return '<div class="source-empty">No sources found</div>';
        }
        const activityDrops = sources.filter(s => s.type === 'activity_drop');
        const itemFindingDrops = sources.filter(s => s.type === 'item_finding');
        const recipeDrops = sources.filter(s => s.type === 'recipe_drop');
        const recipeOutputs = sources.filter(s => s.type === 'recipe_output');
        const recipeInputs = sources.filter(s => s.type === 'recipe_input');
        const shopSources = sources.filter(s => s.type === 'shop');
        const chestSources = sources.filter(s => s.type === 'chest');

        const esc = (s) => this._escape(s);
        let html = '<div class="source-dropdown-list">';
        if (recipeOutputs.length) {
            html += '<div class="source-group-header">Crafted by</div>';
            for (const src of recipeOutputs) {
                html += `<div class="source-item" data-source-type="recipe_output" data-source-id="${esc(src.id)}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe">Recipe</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span></div></div>`;
            }
        }
        if (activityDrops.length) {
            html += '<div class="source-group-header">Dropped by</div>';
            for (const src of activityDrops) {
                const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                const secondary = src.secondary ? ' (secondary)' : '';
                html += `<div class="source-item" data-source-type="activity_drop" data-source-id="${esc(src.id)}" title="Click to select this activity"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-activity">Activity</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span><span>${esc(src.base_steps || '?')} steps</span><span>Drop: ${esc(dropRate)}${esc(secondary)}</span></div></div>`;
            }
        }
        if (recipeDrops.length) {
            html += '<div class="source-group-header">Dropped while crafting</div>';
            for (const src of recipeDrops) {
                const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                html += `<div class="source-item" data-source-type="recipe_drop" data-source-id="${esc(src.id)}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe-drop">Recipe Drop</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span><span>Drop: ${esc(dropRate)}</span></div></div>`;
            }
        }
        if (recipeInputs.length) {
            html += '<div class="source-group-header">Used as input by</div>';
            for (const src of recipeInputs) {
                html += `<div class="source-item" data-source-type="recipe_input" data-source-id="${esc(src.id)}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe-input">Recipe Input</span></div></div>`;
            }
        }
        if (itemFindingDrops.length) {
            html += '<div class="source-group-header">Item Finding</div>';
            for (const src of itemFindingDrops) {
                const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                html += `<div class="source-item source-item-no-click" title="Dropped via item finding gear"><div class="source-item-main"><span class="source-name">${esc(src.category || src.name || '?')}</span><span class="source-badge source-badge-item-finding">Item Finding</span></div>${chance ? `<div class="source-item-details"><span>${esc(chance)}</span></div>` : ''}</div>`;
            }
        }
        if (shopSources.length) {
            html += '<div class="source-group-header">Sold by</div>';
            for (const src of shopSources) {
                html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name || '?')}</span><span class="source-badge source-badge-shop">Shop</span></div><div class="source-item-details"><span>${esc(src.location || '')}</span><span>${esc(src.price_display || '')}</span></div></div>`;
            }
        }
        if (chestSources.length) {
            html += '<div class="source-group-header">Found in chests</div>';
            for (const src of chestSources) {
                const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                const qty = src.quantity_display || '';
                html += `<div class="source-item source-item-no-click source-item-chest"><div class="source-item-main"><span class="source-name">${esc(src.name || '?')}</span><span class="source-badge source-badge-chest">Chest</span></div><div class="source-item-details"><span>Chance per chest: ${esc(dropRate)}</span>${qty ? `<span>${esc(qty)}</span>` : ''}</div></div>`;
            }
        }
        html += '</div>';
        return html;
    }

    _escape(text) {
        if (text == null) return '';
        const s = String(text);
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

export default SummaryDashboard;
