/**
 * NonOwnedUpgradesSection Component
 *
 * Column-2 collapsible section (styled like "Combined Stats") that aggregates
 * the per-slot "Non-owned/Locked Upgrades" alternatives — the same data the
 * gear-slot popups show — into ONE ranked list for the whole gearset.
 *
 * Design (confirmed with Jimmy 2026-07-01):
 *   - Data source: store.state.gearsets.alternatives (non-owned) and
 *     .lockedAlternatives (owned-but-locked), keyed by slot -> [alt, ...].
 *     In comparison mode the active slot's gearset2* variants are used.
 *     No new optimizer call — this reflects whatever the last run produced,
 *     exactly like the slot popups.
 *   - ONE row per item (dedup by uuid+quality). An item that upgrades more
 *     than one slot (e.g. a ring valid in both ring slots) shows only its
 *     single BEST slot — mirroring the equip reality that it can only be worn
 *     once. "Replaces: <SLOT>" in the expanded detail names that slot.
 *   - Two labeled, independently-collapsible sub-sections: "Non-owned" and
 *     "Owned but locked", each sorted tiniest -> biggest improvement.
 *   - The right-hand improvement value and the expanded stats are rendered by
 *     delegating to the live ItemSelectionPopup instance's formatters
 *     (_upgradeValueParts / _formatMetricName / renderStatsFromObject / ...),
 *     so this section always matches what the per-slot popups display,
 *     including the user's "Non-owned upgrade display" setting
 *     (average / percent / list).
 *
 * The crafting tree has the backend analogue (_aggregate_tree_upgrades ->
 * summary.tree_upgrades, rendered by crafting-tree-summary._renderTreeUpgrades);
 * this is the live single-gearset equivalent, aggregating across gear SLOTS
 * instead of tree NODES.
 */

import CollapsibleSection from './collapsible.js';
import store from '../state.js';
import api from '../api.js';
import { renderRequirementsRow } from '../utils/requirements.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';

// Slot identifier -> display name. Mirrors GearSlotGrid.getSlotDisplayName
// (that map lives on GearSlotGrid instances, which aren't globally exposed).
const SLOT_DISPLAY_NAMES = {
    cape: 'Cape', head: 'Head', back: 'Back', hands: 'Hands', chest: 'Chest',
    neck: 'Neck', primary: 'Primary', legs: 'Legs', secondary: 'Secondary',
    ring1: 'Ring 1', ring2: 'Ring 2', feet: 'Feet',
    tool0: 'Tool 1', tool1: 'Tool 2', tool2: 'Tool 3',
    tool3: 'Tool 4', tool4: 'Tool 5', tool5: 'Tool 6',
    consumable: 'Consumable', pet: 'Pet',
};

function slotDisplayName(slot) {
    return SLOT_DISPLAY_NAMES[slot]
        || (slot ? slot.charAt(0).toUpperCase() + slot.slice(1) : slot);
}

// Improvement magnitude used for BOTH dedup ("keep best slot") and ranking
// ("tiniest -> biggest"). Keys on |delta|, identical to the slot popup's
// _byImprovementAsc comparator (item-selection-popup.js). Only improvements
// are ever listed, so the absolute value is the improvement size regardless of
// whether the primary metric is maximize (XP/step) or minimize (steps/item).
function improvementMagnitude(alt) {
    if (alt && alt.delta != null && isFinite(alt.delta)) return Math.abs(alt.delta);
    if (alt && alt.delta_pct != null && isFinite(alt.delta_pct)) return Math.abs(alt.delta_pct);
    if (alt && alt.old_value != null && alt.new_value != null
            && Math.abs(alt.old_value) > 1e-9) {
        return Math.abs((alt.new_value - alt.old_value) / alt.old_value) * 100;
    }
    return 0;
}

// Stable per-item identity: uuid+quality (equip-identity), falling back to
// name. Keeping quality distinct means Great vs Excellent variants of the same
// item are separate rows — matching how the per-slot popups list them.
function altIdentity(alt) {
    const base = alt.uuid || alt.name || '';
    return `${base}\u0000${alt.quality || ''}`;
}

class NonOwnedUpgradesSection extends CollapsibleSection {
    constructor(element, props = {}) {
        super(element, {
            title: 'Non-owned/Locked Upgrades',
            icon: null,
            count: '',
            defaultExpanded: true,
            ...props,
        });

        // Which sub-group + row is expanded, e.g. "nonowned-2". Tolerated as
        // undefined during the base constructor's first render() call.
        this._expandedRowKey = null;
        // Per-group collapsed state (both open by default).
        this._groupCollapsed = { nonowned: false, locked: false };
        // Populated each render so click handlers can resolve a row -> entry.
        this._rows = { nonowned: [], locked: [] };

        // Re-render when the optimizer publishes fresh alternatives, when the
        // active comparison slot switches, or when comparison mode toggles.
        const rerender = () => this._rerender();
        this.subscribe('gearsets.alternatives', rerender);
        this.subscribe('gearsets.lockedAlternatives', rerender);
        this.subscribe('gearsets.gearset2Alternatives', rerender);
        this.subscribe('gearsets.gearset2LockedAlternatives', rerender);
        this.subscribe('gearsets.activeGearsetSlot', rerender);
        this.subscribe('gearsets.comparisonMode', rerender);
        // The optimizer writes gearsets.alternatives/lockedAlternatives but only
        // fires _notifySubscribers('gearsets.current') (state.js) — so without
        // this the section never refreshes after a re-optimize (only a page
        // reload did). gearsets.current also fires on gear edits (which clear
        // alternatives), so the section stays in sync. gearset2 covers the
        // comparison-slot equip path.
        this.subscribe('gearsets.current', rerender);
        this.subscribe('gearsets.gearset2', rerender);

        // Re-render now that subclass fields are set and window.itemSelectionPopup
        // exists (the base constructor already rendered once with defaults).
        this._rerender();
    }

    _rerender() {
        this.render();
        this.attachEvents();
    }

    /**
     * Return the active gearset's alternatives, honoring comparison mode.
     */
    _activeAlternatives() {
        const g = store.state.gearsets || {};
        const slot2 = g.comparisonMode && g.activeGearsetSlot === 2;
        return {
            alternatives: (slot2 ? g.gearset2Alternatives : g.alternatives) || null,
            locked: (slot2 ? g.gearset2LockedAlternatives : g.lockedAlternatives) || null,
        };
    }

    /**
     * Aggregate a per-slot {slot: [alt,...]} map into one entry per item,
     * keeping the single best-improving slot, sorted tiniest -> biggest.
     * @returns {Array<{alt, slot, mag}>}
     */
    _aggregate(bySlot) {
        if (!bySlot || typeof bySlot !== 'object') return [];
        const best = new Map();
        for (const [slot, alts] of Object.entries(bySlot)) {
            if (!Array.isArray(alts)) continue;
            for (const alt of alts) {
                if (!alt || !alt.name) continue;
                const key = altIdentity(alt);
                const mag = improvementMagnitude(alt);
                const existing = best.get(key);
                if (!existing || mag > existing.mag) {
                    best.set(key, { alt, slot, mag });
                }
            }
        }
        return Array.from(best.values()).sort((a, b) => a.mag - b.mag);
    }

    // ---- rendering ---------------------------------------------------------

    render() {
        const iconHtml = this.props.icon
            ? `<img src="${this.props.icon}" alt="${this.props.title}" class="icon">` : '';
        const html = `
            <div class="collapsible ${this.expanded ? 'expanded' : ''}">
                <div class="collapsible-header">
                    ${iconHtml}
                    <span class="title">${this.props.title}</span>
                    <span class="count">${this.props.count}</span>
                    <span class="expand-arrow ${this.expanded ? 'expanded' : ''}">▼</span>
                </div>
                <div class="collapsible-content" style="display: ${this.expanded ? 'block' : 'none'}">
                    ${this.renderContent()}
                </div>
            </div>
        `;
        this.$element.html(html);
        return html;
    }

    renderContent() {
        const { alternatives, locked } = this._activeAlternatives();

        // No optimization has produced alternatives yet.
        if (!alternatives && !locked) {
            this._rows = { nonowned: [], locked: [] };
            return `<div class="combined-stats-empty"><p>Run an optimization to see gear upgrades</p></div>`;
        }

        const nonowned = this._aggregate(alternatives);
        const lockedRows = this._aggregate(locked);
        this._rows = { nonowned, locked: lockedRows };

        const total = nonowned.length + lockedRows.length;
        if (total === 0) {
            return `<div class="combined-stats-empty"><p>No better alternatives found</p></div>`;
        }

        let html = '<div class="nonowned-upgrades-groups">';
        if (nonowned.length > 0) {
            html += this._renderGroup('nonowned', 'Non-owned', nonowned);
        }
        if (lockedRows.length > 0) {
            html += this._renderGroup('locked', 'Owned but locked', lockedRows);
        }
        html += '</div>';
        return html;
    }

    _renderGroup(group, label, rows) {
        // Guard: the base CollapsibleSection constructor calls render() ->
        // renderContent() -> _renderGroup() BEFORE this subclass's field
        // initializers run, so this._groupCollapsed can still be undefined on
        // the very first render (only reached when the session already has
        // restored alternatives). Default to expanded.
        const collapsed = !!(this._groupCollapsed && this._groupCollapsed[group]);
        const arrowClass = collapsed ? '' : 'expanded';
        const lockedCls = group === 'locked' ? ' locked-subheader' : '';
        const rowsHtml = rows.map((entry, idx) => this._renderRow(group, entry, idx)).join('');
        return `
            <div class="popup-alternatives-section nou-group" data-group="${group}">
                <div class="popup-alternatives-header nou-group-header${lockedCls}">
                    <span class="popup-alternatives-label">${label} <span class="popup-alternatives-count">${rows.length}</span></span>
                    <div class="popup-expand-btn-area nou-group-toggle">
                        <button class="popup-expand-btn"><span class="expand-arrow ${arrowClass}">▼</span></button>
                    </div>
                </div>
                <div class="popup-alternatives-list nou-group-list" style="display: ${collapsed ? 'none' : 'block'};">
                    ${rowsHtml}
                </div>
            </div>
        `;
    }

    _renderRow(group, entry, idx) {
        const { alt } = entry;
        const rowKey = `${group}-${idx}`;
        const rarityClass = alt.rarity ? `rarity-${alt.rarity}` : '';
        const lockedItemCls = group === 'locked' ? ' alt-item-locked' : '';

        // Icon path — same derivation as the slot popup's _renderAltItemRow.
        let baseName = alt.name;
        const qMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
        if (qMatch) baseName = baseName.slice(0, qMatch.index);
        const iconName = baseName.toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
        const iconPath = `/assets/icons/items/equipment/${iconName}.svg`;

        const expanded = this._expandedRowKey === rowKey;
        const arrowClass = expanded ? 'expanded' : '';
        const improvementHtml = this._renderImprovement(alt);

        return `
            <div class="popup-alt-item ${rarityClass}${lockedItemCls}" data-row-key="${rowKey}" data-group="${group}" data-row-idx="${idx}">
                <div class="popup-alt-item-main">
                    <img src="${iconPath}" alt="${alt.name}" class="popup-item-icon" onerror="this.style.display='none'">
                    <span class="popup-item-name">${alt.name}</span>
                    ${improvementHtml}
                    <div class="popup-expand-btn-area alt-expand-btn-area">
                        <button class="popup-expand-btn"><span class="expand-arrow ${arrowClass}">▼</span></button>
                    </div>
                </div>
                <div class="popup-alt-item-details" style="display: none;"></div>
            </div>
        `;
    }

    /**
     * Right-hand improvement value for a collapsed row. Delegates to the live
     * ItemSelectionPopup instance so it exactly matches the per-slot popups
     * (including the average/percent/list display setting). Mirrors the
     * value-adjustment block in _renderAltItemRow.
     */
    _renderImprovement(alt) {
        if (alt.new_value == null || alt.old_value == null) return '';
        const p = window.itemSelectionPopup;
        let oldDisp = alt.old_value;
        let newDisp = alt.new_value;
        const isTraveling = window.optimizeButton?.isTravelActivity?.();

        if (alt.primary_metric === 'materials_per_craft' && oldDisp && newDisp && !isTraveling) {
            oldDisp = 1 / oldDisp;
            newDisp = 1 / newDisp;
        }
        if (alt.primary_metric === 'materials_for_target' && window.recipeInfoSection && !isTraveling) {
            const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
            const odds = window.recipeInfoSection.calculateCraftingOdds();
            const targetOdd = odds.find(o => o.quality === targetQuality);
            if (targetOdd && targetOdd.avgMats != null) {
                oldDisp = targetOdd.avgMats;
                newDisp = oldDisp * (1 + (alt.delta_pct || 0) / 100);
            }
        }

        if (p && typeof p._upgradeValueParts === 'function') {
            const parts = p._upgradeValueParts(alt, oldDisp, newDisp);
            if (parts.isList) {
                return `<span class="alt-improvement alt-improvement-multiline" style="display:inline-block;text-align:right;line-height:1.35;">${parts.html}</span>`;
            }
            return `<span class="alt-improvement">${parts.html}</span>`;
        }
        // Fallback when the popup isn't available.
        return `<span class="alt-improvement">${oldDisp} ⟶ ${newDisp}</span>`;
    }

    /**
     * Build the expanded detail for a row: "Replaces: <slot>", the metric
     * improvement line, and the item's stats. Delegates formatting/stats to
     * the live ItemSelectionPopup instance.
     */
    _renderDetails(entry, group, idx) {
        const { alt, slot } = entry;
        const p = window.itemSelectionPopup;

        // Name the item being replaced in the best slot (or note it fills an
        // empty slot).
        const equipped = (store.getActiveGearset() || {})[slot];
        const replacedName = equipped && equipped.name ? equipped.name : null;
        const replacesHtml = `<div class="alt-metric-detail nou-replaces">Replaces: ${
            replacedName
                ? `${this._escape(replacedName)} (${slotDisplayName(slot)})`
                : `empty ${slotDisplayName(slot)}`
        }</div>`;

        let metricHtml = '';
        if (alt.primary_metric && p && typeof p._formatMetricName === 'function') {
            const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
            const sepIdx = alt.primary_metric.indexOf('::');
            const baseMetric = sepIdx >= 0 ? alt.primary_metric.slice(0, sepIdx) : alt.primary_metric;
            const metricTarget = sepIdx >= 0 ? alt.primary_metric.slice(sepIdx + 2) : null;

            let displayLabel = p._formatMetricName(baseMetric, metricTarget).replace('X Quality', targetQuality);
            let oldVal = alt.old_value;
            let newVal = alt.new_value;
            const isTraveling = window.optimizeButton?.isTravelActivity?.();

            if (baseMetric === 'materials_per_craft' && oldVal && newVal && !isTraveling) {
                oldVal = 1 / oldVal;
                newVal = 1 / newVal;
                displayLabel = 'Crafts/Mat';
            }
            if (baseMetric === 'materials_for_target' && window.recipeInfoSection) {
                const odds = window.recipeInfoSection.calculateCraftingOdds();
                const resolvedTarget = metricTarget || targetQuality;
                const targetOdd = odds.find(o => o.quality === resolvedTarget);
                if (targetOdd && targetOdd.avgMats != null) {
                    oldVal = targetOdd.avgMats;
                    newVal = oldVal * (1 + (alt.delta_pct || 0) / 100);
                    displayLabel = `Materials for ${resolvedTarget}`;
                }
            }

            if (typeof p._upgradeValueParts === 'function' && oldVal != null && newVal != null) {
                const parts = p._upgradeValueParts(alt, oldVal, newVal);
                if (parts.isList) {
                    metricHtml = `<div class="alt-metric-detail">${displayLabel}:<div class="alt-metric-detail-list" style="margin-top:2px;line-height:1.35;">${parts.html}</div></div>`;
                } else {
                    metricHtml = `<div class="alt-metric-detail">${displayLabel}: ${parts.html}</div>`;
                }
            }
        }

        // Resolve the catalog item for wiki/keywords/requirements/stats.
        let baseName = alt.name;
        const qMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
        if (qMatch) baseName = baseName.slice(0, qMatch.index);
        const fullItem = this._resolveCatalogItem(alt.name, alt.uuid)
            || this._resolveCatalogItem(baseName, null);

        // Action links — same set as the slot popup's alt detail. Wiki is a
        // plain anchor; Sources/Equip/Equip&Compare are wired in attachEvents.
        // Locked (owned-but-locked) rows omit Equip/Equip&Compare, matching the
        // popup.
        const wikiName = baseName.replace(/ /g, '_');
        const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;
        const dataAttrs = `data-item-name="${this._escape(alt.name)}" data-item-uuid="${alt.uuid || ''}" data-item-quality="${alt.quality || ''}" data-slot="${slot}"`;
        const rowKey = `${group}-${idx}`;
        const equipLinks = group === 'locked' ? '' : `
                <a href="#" class="wiki-link nou-equip-btn" ${dataAttrs} onclick="event.preventDefault();">Equip</a>
                <a href="#" class="wiki-link nou-equip-compare-btn" ${dataAttrs} onclick="event.preventDefault();">Equip &amp; Compare</a>`;
        const actionsHtml = `
            <div class="alt-action-links">
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link" onclick="event.stopPropagation()">Wiki</a>
                <a href="#" class="wiki-link nou-sources-btn" data-row-key="${rowKey}" data-item-name="${this._escape(baseName)}" onclick="event.preventDefault();">Sources <span class="source-arrow">▼</span></a>
                ${equipLinks}
            </div>
            <div class="alt-sources-container nou-sources-container" data-row-key="${rowKey}" style="display: none;"></div>`;

        // Keywords (hide the internal shiny_* set, matching the popup).
        let keywordsHtml = '';
        if (fullItem && fullItem.keywords && fullItem.keywords.length > 0) {
            const hidden = ['shiny_ring', 'shiny_necklace', 'shiny_bracelet'];
            const visible = fullItem.keywords.filter(kw => !hidden.includes(kw.toLowerCase()));
            if (visible.length > 0) {
                keywordsHtml = `<div class="keywords">${visible.map(kw => `<span class="keyword">${this._escape(kw)}</span>`).join('')}</div>`;
            }
        }

        // Requirements (Agility 12/12, custom stats like "Underwater swimming
        // x25"). renderRequirementsRow tags custom-stat rows with
        // data-open-custom-stats, and main.js document-delegates the click to
        // open the Custom Stats popup — so this works with no extra wiring.
        let requirementsHtml = '';
        if (fullItem && fullItem.requirements) {
            requirementsHtml = renderRequirementsRow(fullItem.requirements);
        }

        // Stats.
        let statsHtml = '';
        if (fullItem && p && typeof p.renderStatsFromObject === 'function') {
            let stats = fullItem.stats || {};
            if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality && alt.quality) {
                stats = fullItem.stats_by_quality[alt.quality] || stats;
            }
            statsHtml = p.renderStatsFromObject(stats);
            if (fullItem.gated_stats && typeof p.renderGatedStats === 'function') {
                statsHtml += p.renderGatedStats(fullItem.gated_stats, fullItem);
            }
        }

        return `${replacesHtml}${metricHtml}${actionsHtml}${keywordsHtml}${requirementsHtml}${statsHtml}`;
    }

    // ---- action helpers (mirror the slot popup, non-tree context) ----------

    _escape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Resolve a catalog item by uuid (preferred) then by exact name. */
    _resolveCatalogItem(name, uuid) {
        const catalogItems = api._catalogCache?.items || [];
        let item = null;
        if (uuid) item = catalogItems.find(i => i.uuid === uuid);
        if (!item && name) item = catalogItems.find(i => i.name === name);
        const popupItems = window.itemSelectionPopup?.items;
        if (!item && name && Array.isArray(popupItems)) item = popupItems.find(i => i.name === name);
        return item || null;
    }

    /** Build a gearset slot-item from a catalog item + optional quality. Mirrors
     *  the slot popup's alt-equip slotItem construction. */
    _buildSlotItem(targetItem, quality) {
        const qualityToRarity = {
            Normal: 'common', Good: 'uncommon', Great: 'rare',
            Excellent: 'epic', Perfect: 'legendary', Eternal: 'ethereal',
        };
        if (targetItem.type === 'crafted_item' && quality) {
            let itemStats = targetItem.stats || {};
            if (targetItem.stats_by_quality) {
                itemStats = targetItem.stats_by_quality[quality] || itemStats;
            }
            return {
                itemId: targetItem.id, uuid: targetItem.uuid || '', name: targetItem.name,
                icon_path: targetItem.icon_path, rarity: qualityToRarity[quality] || 'common',
                quality, keywords: targetItem.keywords || [], is_fine: targetItem.is_fine || false,
                is_generic: targetItem.is_generic || false, icon: targetItem.icon || null,
                icon_color: targetItem.icon_color || null, stats: itemStats,
            };
        }
        return {
            itemId: targetItem.id, uuid: targetItem.uuid || targetItem.id, name: targetItem.name,
            icon_path: targetItem.icon_path, rarity: targetItem.rarity || 'common',
            quality: targetItem.quality || null, keywords: targetItem.keywords || [],
            is_fine: targetItem.is_fine || false, is_generic: targetItem.is_generic || false,
            icon: targetItem.icon || null, icon_color: targetItem.icon_color || null,
            stats: targetItem.stats || {},
        };
    }

    /** Equip an alt into its best slot (column-2 live gearset). */
    _equipToSlot(name, uuid, quality, slot) {
        const targetItem = this._resolveCatalogItem(name, uuid);
        if (!targetItem) {
            api.showInfo(`${name} is not in your inventory. Check sources to find it.`);
            return;
        }
        const slotItem = this._buildSlotItem(targetItem, quality);
        store.updateGearSlot(slot, slotItem);
        const qualityLabel = quality ? ` (${quality})` : '';
        api.showInfo(`Equipped ${targetItem.name}${qualityLabel} to ${slotDisplayName(slot)}`);
    }

    /** Equip an alt into GS2 for comparison (enabling comparison mode first). */
    _equipCompareToSlot(name, uuid, quality, slot) {
        const targetItem = this._resolveCatalogItem(name, uuid);
        if (!targetItem) {
            api.showInfo(`${name} is not in your inventory. Check sources to find it.`);
            return;
        }
        const slotItem = this._buildSlotItem(targetItem, quality);
        if (!store.state.gearsets.comparisonMode) {
            $('#comparison-mode-checkbox').prop('checked', true).trigger('change');
        }
        store.state.gearsets.gearset2[slot] = slotItem;
        store.state.gearsets.gearset2Alternatives = null;
        store.state.gearsets.gearset2LockedAlternatives = null;
        store._notifySubscribers('gearsets.gearset2');
        try { store._saveGearset2(); } catch (_e) { /* best-effort persist */ }
        const qualityLabel = quality ? ` (${quality})` : '';
        api.showInfo(`Equipped ${targetItem.name}${qualityLabel} to ${slotDisplayName(slot)} in GS2 for comparison`);
    }

    /** Fetch + render item sources into a container. Mirrors the slot popup's
     *  .alt-sources-btn handler (grouped source list). */
    async _renderSourcesInto($container, itemName) {
        $container.html('<div class="source-loading">Loading sources...</div>');
        try {
            const data = await api.getItemSources();
            const lookupName = String(itemName).toLowerCase().trim();
            const sources = (data && data.sources && data.sources[lookupName]) || [];
            if (!sources.length) {
                $container.html('<div class="source-empty">No known sources</div>');
                return;
            }
            const by = (t) => sources.filter(s => s.type === t);
            const activityDrops = by('activity_drop');
            const itemFindingDrops = by('item_finding');
            const recipeDrops = by('recipe_drop');
            const recipeOutputs = by('recipe_output');
            const recipeInputs = by('recipe_input');
            const shopSources = by('shop');
            const chestSources = by('container_drop');
            const esc = (s) => this._escape(s);
            let html = '<div class="source-list">';
            const dropRow = (src, type, badgeCls, badge, extra) =>
                `<div class="source-item" data-source-type="${type}" data-source-id="${src.id}" title="Click to select"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge ${badgeCls}">${badge}</span></div><div class="source-item-details">${extra}</div></div>`;
            if (activityDrops.length) {
                html += '<div class="source-group-header">Dropped by activity</div>';
                for (const src of activityDrops) {
                    const dr = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                    const sec = src.secondary ? ' (secondary)' : '';
                    html += dropRow(src, 'activity_drop', 'source-badge-activity', 'Activity',
                        `<span>${esc(src.skill)} Lv.${src.level}</span><span>${src.base_steps || '?'} steps</span><span>Drop: ${dr}${sec}</span>`);
                }
            }
            if (itemFindingDrops.length) {
                html += '<div class="source-group-header">Item Finding</div>';
                for (const src of itemFindingDrops) {
                    const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                    html += `<div class="source-item source-item-no-click" title="Dropped via ${esc(src.category)} item finding gear"><div class="source-item-main"><span class="source-name">${esc(src.category)}</span><span class="source-badge source-badge-item-finding">Item Finding</span></div>${chance ? `<div class="source-item-details"><span>${chance}</span></div>` : ''}</div>`;
                }
            }
            if (recipeDrops.length) {
                html += '<div class="source-group-header">Dropped while crafting</div>';
                for (const src of recipeDrops) {
                    const dr = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                    html += dropRow(src, 'recipe_drop', 'source-badge-recipe-drop', 'Recipe Drop',
                        `<span>${esc(src.skill)} Lv.${src.level}</span><span>Drop: ${dr}</span>`);
                }
            }
            if (recipeOutputs.length) {
                html += '<div class="source-group-header">Crafted by</div>';
                for (const src of recipeOutputs) {
                    html += dropRow(src, 'recipe_output', 'source-badge-recipe', 'Recipe',
                        `<span>${esc(src.skill)} Lv.${src.level}</span><span>${src.base_steps || '?'} steps</span>`);
                }
            }
            if (recipeInputs.length) {
                html += '<div class="source-group-header">Used in</div>';
                for (const src of recipeInputs) {
                    html += dropRow(src, 'recipe_input', 'source-badge-recipe-input', 'Input',
                        `<span>${esc(src.skill)} Lv.${src.level}</span><span>${src.quantity || 1}x needed</span>`);
                }
            }
            if (shopSources.length) {
                html += '<div class="source-group-header">Sold at</div>';
                for (const src of shopSources) {
                    html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-shop">Shop</span></div><div class="source-item-details"><span>${esc(src.location || '')}</span><span>${esc(src.price_display || '')}</span></div></div>`;
                }
            }
            if (chestSources.length) {
                html += '<div class="source-group-header">Found in chests</div>';
                for (const src of chestSources) {
                    const rarityClass = src.rarity ? `rarity-${src.rarity}` : '';
                    const rarityLabel = src.rarity ? src.rarity.charAt(0).toUpperCase() + src.rarity.slice(1) : 'Main';
                    const rolls = src.rolls_per_chest || 4;
                    let chestPct = null;
                    if (src.drop_rate != null) chestPct = (1 - Math.pow(1 - src.drop_rate / 100, rolls)) * 100;
                    const dr = chestPct != null ? `${chestPct.toFixed(3)}%` : '?%';
                    const qty = src.quantity && src.quantity !== '1' ? `${src.quantity}x` : '';
                    html += `<div class="source-item source-item-no-click source-item-chest"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-chest ${rarityClass}">${rarityLabel}</span></div><div class="source-item-details"><span>Chance per chest: ${dr}</span>${qty ? `<span>${qty}</span>` : ''}</div></div>`;
                }
            }
            html += '</div>';
            $container.html(html);
        } catch (_e) {
            $container.html('<div class="source-empty">Failed to load sources</div>');
        }
    }

    // ---- events ------------------------------------------------------------

    attachEvents() {
        // Header toggle for the outer section (base behavior).
        super.attachEvents();

        this.$element.off('click', '.nou-group-header');
        this.$element.off('click', '.popup-alt-item-main');

        // Sub-group collapse/expand.
        this.$element.on('click', '.nou-group-header', (e) => {
            const $section = $(e.currentTarget).closest('.nou-group');
            const group = $section.data('group');
            const $list = $section.find('.nou-group-list');
            const $arrow = $section.find('.nou-group-toggle .expand-arrow');
            const nowCollapsed = !this._groupCollapsed[group];
            this._groupCollapsed[group] = nowCollapsed;
            if (nowCollapsed) {
                $arrow.removeClass('expanded');
                $list.slideUp(200);
            } else {
                $arrow.addClass('expanded');
                $list.slideDown(200);
            }
        });

        // Row expand/collapse — lazily render the detail into the placeholder.
        this.$element.on('click', '.popup-alt-item-main', (e) => {
            e.stopPropagation();
            if ($(e.target).closest('.popup-alt-item-details').length > 0) return;
            const $row = $(e.target).closest('.popup-alt-item');
            const rowKey = $row.data('row-key');
            const group = $row.data('group');
            const idx = parseInt($row.data('row-idx'), 10);
            const wasExpanded = this._expandedRowKey === rowKey;

            // Collapse any other open row.
            if (this._expandedRowKey && this._expandedRowKey !== rowKey) {
                const $prev = this.$element.find(`.popup-alt-item[data-row-key="${this._expandedRowKey}"]`);
                $prev.find('.popup-alt-item-details').slideUp(150);
                $prev.find('.alt-expand-btn-area .expand-arrow').removeClass('expanded');
            }

            if (wasExpanded) {
                this._expandedRowKey = null;
                $row.find('.popup-alt-item-details').slideUp(150);
                $row.find('.alt-expand-btn-area .expand-arrow').removeClass('expanded');
                return;
            }

            const entry = (this._rows[group] || [])[idx];
            if (!entry) return;
            this._expandedRowKey = rowKey;
            $row.find('.alt-expand-btn-area .expand-arrow').addClass('expanded');
            const $details = $row.find('.popup-alt-item-details');
            $details.html(this._renderDetails(entry, group, idx)).hide().slideDown(200);
        });

        // Sources button — fetch + render the grouped source list.
        this.$element.off('click', '.nou-sources-btn');
        this.$element.on('click', '.nou-sources-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const rowKey = $btn.data('row-key');
            const itemName = $btn.data('item-name');
            const $container = this.$element.find(`.nou-sources-container[data-row-key="${rowKey}"]`);
            const $arrow = $btn.find('.source-arrow');
            if ($container.is(':visible') && $container.children().length > 0) {
                $arrow.removeClass('expanded');
                $container.slideUp(150);
                return;
            }
            $arrow.addClass('expanded');
            $container.slideDown(150);
            this._renderSourcesInto($container, itemName);
        });

        // Source item click — navigate to the activity/recipe (same as popup).
        this.$element.off('click', '.nou-sources-container .source-item:not(.source-item-no-click)');
        this.$element.on('click', '.nou-sources-container .source-item:not(.source-item-no-click)', (e) => {
            e.stopPropagation();
            const sourceType = $(e.currentTarget).data('source-type');
            const sourceId = $(e.currentTarget).data('source-id');
            if (sourceType === 'activity_drop' && sourceId) {
                store.update('column3.selectedActivity', sourceId);
                store.update('column3.selectedRecipe', null);
            } else if ((sourceType === 'recipe_output' || sourceType === 'recipe_drop' || sourceType === 'recipe_input') && sourceId) {
                store.update('column3.selectedRecipe', sourceId);
                store.update('column3.selectedActivity', null);
            }
        });

        // Equip — set the alt item into its best slot on the live gearset.
        this.$element.off('click', '.nou-equip-btn');
        this.$element.on('click', '.nou-equip-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._equipToSlot($btn.data('item-name'), $btn.data('item-uuid'), $btn.data('item-quality'), $btn.data('slot'));
        });

        // Equip & Compare — write the alt into GS2 for comparison.
        this.$element.off('click', '.nou-equip-compare-btn');
        this.$element.on('click', '.nou-equip-compare-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            this._equipCompareToSlot($btn.data('item-name'), $btn.data('item-uuid'), $btn.data('item-quality'), $btn.data('slot'));
        });
    }
}

export default NonOwnedUpgradesSection;
