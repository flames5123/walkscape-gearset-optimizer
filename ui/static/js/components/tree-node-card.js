/**
 * TreeNodeCard — Renders a single node in the crafting tree.
 * 
 * Shows source type icon, item name, quantity, metrics, gear config,
 * source selector, alternatives, bank input, and children.
 * 
 * Uses custom slide-down dropdowns (matching activity/recipe selector pattern)
 * instead of native <select> elements.
 */

import Component from './base.js';
import store from '../state.js';
import { getPetIconPath } from '../utils/pet-utils.js';

import { formatFixed } from '../utils/number-format.js';

const SOURCE_ICON_PATHS = {
    recipe: '/assets/icons/attributes/work_efficiency.svg',
    activity: '/assets/icons/text/skill_icons/agility.svg',
    chest: '/assets/icons/items/containers/treasure_chest.svg',
    bank: '/assets/icons/items/coins.svg',
    shop: '/assets/icons/items/coins.svg',
};

class TreeNodeCard extends Component {
    constructor(element, props = {}) {
        super(element, props);
        this.childComponents = [];
        this.sourceDropdownOpen = false;
        this.matDropdownOpen = false;
        this.render();
        this.attachEvents();
    }

    _getSelectedSource() {
        const { node } = this.props;
        if (!node) return null;
        const nodeLoc = node.selected_location_id || node.metrics?.stats_used?.location || '';
        const nodeMgi = (node.selected_material_group_index != null
            && node.selected_material_group_index >= 0)
            ? node.selected_material_group_index : null;
        return (node.available_sources || []).find(s => {
            if (s.type !== node.source_type) return false;
            if ((s.source_id || '') !== (node.source_id || '')) return false;
            if (s.type === 'chest') {
                if ((s.chest_source || '') !== (node.chest_source || '')) return false;
                // Disambiguate chest entries by parent. For
                // chest_source='recipe' the disambiguator is
                // parent_recipe_id; for chest_source='activity' it's
                // parent_activity_id; for chest_source='best' there
                // is no parent. Without checking parent_activity_id
                // (which the previous code missed), every chest entry
                // for the same container with chest_source='activity'
                // shared the same null parent_recipe_id and ALL of
                // them rendered as selected at once — user reported
                // bug 2026-05-15 ("makes all the text of the other
                // chests in that dropdown green").
                if (s.chest_source === 'recipe') {
                    if ((s.parent_recipe_id || '') !== (node.parent_recipe_id || '')) return false;
                } else if (s.chest_source === 'activity') {
                    if ((s.parent_activity_id || '') !== (node.parent_activity_id || '')) return false;
                }
            }
            // Multi-material-group source dropdown entries (Boxtrap
            // pattern) carry material_group_index inline. -1 means
            // "Best (auto)" — picks group at calc time. Match
            // exactly so the Birch / Pine / Best entries don't all
            // appear selected at once. nodeMgi=null (never set) is
            // treated as "Best (auto)" so only the -1 entry matches.
            if (s.type === 'recipe' && s.material_group_index != null) {
                const expected = (nodeMgi == null) ? -1 : nodeMgi;
                if (s.material_group_index !== expected) return false;
            }
            // For activities with locations, match on location
            if (s.type === 'activity' && s.location && nodeLoc) {
                if (s.location !== nodeLoc) return false;
            }
            return true;
        });
    }

    _getSourceIcon(source) {
        if (!source) return SOURCE_ICON_PATHS.bank;
        if (source.icon) return source.icon;
        return SOURCE_ICON_PATHS[source.type] || SOURCE_ICON_PATHS.bank;
    }

    /**
     * Render the LP insight strip for a node based on its metrics.lp_data.
     * - When lpData.actions > 0.001: green "Holistic Solver Insight" block
     *   with a contributions list (item name + amount + % of tree demand).
     * - When lpData.actions < 0.001: grey "Skipped by Solver" block with
     *   a click-to-jump link to the node whose byproducts covered the
     *   demand.
     * - When lpData is absent: empty string (LP mode is off).
     *
     * Visibility of BOTH variants is gated on
     * `window._craftingTreeShowHolisticDetails` (persisted toggle at the
     * top of the tree, default OFF). The LP math is still applied to
     * the summary totals regardless of this flag; only the UI affordance
     * is hidden. Everything gets logged to `[CT-LP-NODE]` on the console
     * (gated by the existing `window._craftingTreeDebug` flag) so the
     * tree is still fully debuggable from DevTools when the strips are
     * hidden.
     */
    _renderLpInsight(lpData) {
        if (!lpData) return '';
        const actions = Number(lpData.actions || 0);
        const steps = Number(lpData.steps || 0);
        const sourceName = lpData.source_name || '';
        const contribs = Array.isArray(lpData.contributions) ? lpData.contributions : [];
        const escape = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // Prettify a raw ref like "Material.IRON_ORE" into "Iron ore" as a
        // last-resort fallback when the backend didn't attach item_name
        // (e.g. older cached tree data). Leaves unknown refs alone.
        const prettify = (ref) => {
            if (!ref) return '';
            const s = String(ref);
            const idx = s.indexOf('.');
            const raw = idx >= 0 ? s.slice(idx + 1) : s;
            if (!/^[A-Z0-9_]+$/.test(raw)) return s;
            const words = raw.toLowerCase().split('_').filter(Boolean);
            if (!words.length) return s;
            words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
            return words.join(' ');
        };

        // Always log so LP state is inspectable without flipping the UI
        // toggle. Gated by the same debug flag as [CT-MATH]/[CT-SUMMARY]
        // so users can silence everything with
        // window._craftingTreeDebug = false.
        if (window._craftingTreeDebug !== false) {
            const { node } = this.props;
            // eslint-disable-next-line no-console
            console.log('[CT-LP-NODE]', {
                node_id: node && node.node_id,
                item_id: node && node.item_id,
                item_name: node && node.item_name,
                actions,
                steps,
                source_name: sourceName,
                skipped: actions < 0.001,
                contributions: contribs.map(c => ({
                    item_id: c.item_id,
                    item_name: c.item_name || prettify(c.item_id),
                    amount: Number(c.amount || 0),
                    percent: Number(c.percent || 0),
                })),
            });
        }

        // User-facing UI is hidden by default. The "Show Holistic Mode
        // details" toggle at the top of the tree slides it into view.
        // We still RENDER the block — just apply inline display:none when
        // the toggle is off — so the toggle handler can slideDown/slideUp
        // the existing DOM without re-rendering the whole tree. Debug
        // logs above fire regardless.
        const initialHiddenStyle = window._craftingTreeShowHolisticDetails
            ? ''
            : ' style="display:none"';

        if (actions < 0.001) {
            // Find which other tree node's byproduct fulfilled this demand
            // so the user can jump to it. First match by item_id wins.
            const { node } = this.props;
            const fulfilling = this._findFulfillingNode(node && node.item_id);
            const clickableAttr = fulfilling
                ? ` data-lp-jump-node-id="${escape(fulfilling.node_id)}" role="button" tabindex="0" title="Jump to ${escape(fulfilling.item_name || fulfilling.item_id || '')}"`
                : '';
            const clickableCls = fulfilling ? ' tree-node-lp-insight-clickable' : '';
            const jumpHint = fulfilling
                ? ` <span class="tree-node-lp-insight-jump">→ go to ${escape(fulfilling.item_name || fulfilling.item_id || '')}</span>`
                : '';
            return `
                <div class="tree-node-lp-insight skipped${clickableCls}"${clickableAttr}${initialHiddenStyle}>
                    <div class="tree-node-lp-insight-title">Skipped by Solver</div>
                    <div class="tree-node-lp-insight-body">Demand fulfilled by byproducts from other nodes in the tree.${jumpHint}</div>
                </div>`;
        }

        // Active (solver ran this node). Show ONLY the contributions list
        // with resolved item names — drop the old "Ran X actions of Y
        // (Z steps)" sentence, which leaked solver mechanics at the user
        // and never resolved item enum names. Debug data is available in
        // the console log above.
        const contribRows = contribs.map(c => {
            const displayName = c.item_name || prettify(c.item_id);
            const amt = Number(c.amount || 0);
            const pct = Number(c.percent || 0);
            return `<li>${escape(displayName)} — ${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}${pct > 0 ? ` (${formatFixed(pct, 1)}% of tree demand)` : ''}</li>`;
        }).join('');

        if (!contribRows) {
            // Nothing meaningful to show; avoid a bare title with no body.
            return '';
        }

        // Quality breakdown for a craft node — e.g. "Perfect Iron sickle"
        // target also produces N Normal + M Good + K Great + J Excellent
        // as byproducts. metrics.craft_quality_counts is populated at
        // summary-build time for the root recipe node (only when the
        // target is equipment AND target_quality != 'Normal'). Ordered
        // by QUALITY_TIERS (Normal → Eternal) so the user reads the
        // distribution top-down matching the target selector.
        //
        // Sub-target tiers also appear in summary.side_drops (with
        // item names like "Iron sickle (Normal)") so coin-value math
        // includes them — this list is the per-node counts-only view.
        const { node } = this.props;
        const rawCounts = (node && node.metrics && node.metrics.craft_quality_counts) || null;
        let qualityRows = '';
        if (rawCounts && typeof rawCounts === 'object') {
            const TIER_ORDER = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
            const items = TIER_ORDER
                .map(t => [t, Number(rawCounts[t] || 0)])
                .filter(([, n]) => n > 1e-9);
            if (items.length) {
                qualityRows = items
                    .map(([t, n]) => `<li>${escape(t)} — ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}</li>`)
                    .join('');
            }
        }
        const qualityBlock = qualityRows
            ? `<div class="tree-node-lp-insight-subtitle">Quality breakdown</div>
               <ul class="tree-node-lp-insight-list">${qualityRows}</ul>`
            : '';

        return `
            <div class="tree-node-lp-insight active"${initialHiddenStyle}>
                <div class="tree-node-lp-insight-title">✨ Holistic Solver Insight</div>
                <div class="tree-node-lp-insight-body">
                    <ul class="tree-node-lp-insight-list">${contribRows}</ul>
                    ${qualityBlock}
                </div>
            </div>`;
    }

    /**
     * Walk the tree's allNodes and return the first node whose LP
     * contributions include this item_id (and which actually ran — actions
     * > 0.001). Used by the "Skipped by Solver" insight to link back to
     * the node whose byproducts satisfied this node's demand.
     */
    _findFulfillingNode(itemId) {
        if (!itemId) return null;
        const all = this.props.allNodes || [];
        for (const n of all) {
            const lp = n.metrics && n.metrics.lp_data;
            if (!lp) continue;
            if (Number(lp.actions || 0) < 0.001) continue;
            const contribs = Array.isArray(lp.contributions) ? lp.contributions : [];
            for (const c of contribs) {
                if (c && c.item_id === itemId) return n;
            }
        }
        return null;
    }

    _renderSourceDropdownButton() {
        const { node } = this.props;
        const selected = this._getSelectedSource();
        // Material Options preview override: when this node has an
        // active chip preview (_mo_preview_chip), the source dropdown
        // UI should keep showing "Best (auto)" — the actual backend
        // source is the previewed recipe, but we hide that until the
        // user explicitly commits via the recipe-name link on the
        // child. User spec (2026-05-15): "DON'T want it to change
        // the source of the parent node."
        const previewActiveOnParent = !!node._mo_preview_chip;
        // Fallback label: synthesize from the node's source_type/source_id when
        // _getSelectedSource can't match an available_sources entry. Better than
        // showing a misleading "Select source" prompt when a source is already set.
        let label;
        if (previewActiveOnParent) {
            label = 'Best (auto)';
        } else if (selected) {
            label = selected.label;
        } else if (node.source_type === 'bank') {
            label = 'Bank (already owned)';
        } else if (node.source_type === 'shop') {
            label = `Shop: ${node.source_id || 'Unknown'}`;
        } else if (node.source_type === 'chest') {
            label = `Chest: ${node.source_id || 'Unknown'}`;
        } else if (node.source_id) {
            label = node.source_id;
        } else {
            label = 'Select source';
        }
        const bestLabel = node.metrics?.stats_used?.best_source_label;
        const bestIcon = node.metrics?.stats_used?.best_source_icon;
        if (!previewActiveOnParent && node.source_type === 'best' && bestLabel) {
            label = `Best → ${bestLabel}`;
        }
        // Diagnostic: log the inputs to the label decision so we can see
        // why a card still shows "Best (auto)" (i.e. the raw source_type
        // label without the "→ <resolved>" arrow) instead of the
        // auto-resolved source. Disable with
        // window._craftingTreeDebug = false. Filter console with
        // [CT-SRC-LABEL] to isolate.
        if (window._craftingTreeDebug !== false) {
            // eslint-disable-next-line no-console
            console.log('[CT-SRC-LABEL]', {
                node_id: node.node_id,
                item_id: node.item_id,
                item_name: node.item_name,
                source_type: node.source_type,
                source_id: node.source_id,
                selected_label: selected && selected.label,
                best_source_label: bestLabel,
                last_auto_resolved_source_type: node.last_auto_resolved_source_type,
                last_auto_resolved_source_id: node.last_auto_resolved_source_id,
                last_auto_resolved_location: node.last_auto_resolved_location,
                rendered_label: label,
            });
        }
        // Source icon: when preview is active on the parent, force
        // the "Best (auto)" appearance — the best icon from metrics
        // if we have it, otherwise the work-efficiency fallback.
        let icon;
        if (previewActiveOnParent) {
            icon = bestIcon || SOURCE_ICON_PATHS.recipe;
        } else if (node.source_type === 'best' && bestIcon) {
            icon = bestIcon;
        } else {
            icon = this._getSourceIcon(selected);
        }
        const spoiler = selected?.is_spoiler ? '🔒 ' : '';
        // Selected-source tooltip: when the active source is a spoiler, surface
        // its reason via title= on the button + its children so the user can
        // hover the lock icon, the label text, or the whole row.
        const selectedTitleAttr = selected?.is_spoiler && selected?.spoiler_reason
            ? ` title="${String(selected.spoiler_reason).replace(/"/g, '&quot;')}"`
            : '';

        return `
            <div class="tree-dropdown" data-dropdown="source" data-node-id="${node.node_id}">
                <div class="tree-dropdown-button"${selectedTitleAttr}>
                    <div class="tree-dropdown-value"${selectedTitleAttr}>
                        <img src="${icon}" class="tree-dropdown-icon${node.source_type === 'best' && !bestLabel && !bestIcon ? ' is-best-auto' : ''}" alt=""${selectedTitleAttr} onerror="this.style.display='none'">
                        <span${selectedTitleAttr}>${spoiler}${label}</span>
                    </div>
                    <div class="tree-dropdown-toggle">
                        <span class="expand-arrow">▼</span>
                    </div>
                </div>
                <div class="tree-dropdown-panel" style="display:none">
                    <input type="text" class="tree-dropdown-search activity-search" placeholder="Search sources..." aria-label="Search sources">
                    ${(node.available_sources || []).map((s, idx) => {
            const sIcon = this._getSourceIcon(s);
            // Use the same matcher as _getSelectedSource so the
            // green-text "selected" class is set on exactly one
            // entry, not every chest with the same container_id.
            // Includes parent_activity_id disambiguation (was missing
            // here) + multi-mgi recipe disambiguation.
            const nodeMgiForSel = (node.selected_material_group_index != null
                && node.selected_material_group_index >= 0)
                ? node.selected_material_group_index : null;
            let isSelected = s.type === node.source_type
                && (s.source_id || '') === (node.source_id || '');
            if (isSelected && s.type === 'chest') {
                if ((s.chest_source || '') !== (node.chest_source || '')) {
                    isSelected = false;
                } else if (s.chest_source === 'recipe') {
                    if ((s.parent_recipe_id || '') !== (node.parent_recipe_id || '')) isSelected = false;
                } else if (s.chest_source === 'activity') {
                    if ((s.parent_activity_id || '') !== (node.parent_activity_id || '')) isSelected = false;
                }
            }
            if (isSelected && s.type === 'activity' && s.location) {
                const nodeLoc = (node.selected_location_id || node.metrics?.stats_used?.location || '');
                if ((s.location || '') !== nodeLoc) isSelected = false;
            }
            if (isSelected && s.type === 'recipe' && s.material_group_index != null) {
                // -1 means "Best (auto)"; only matches when node
                // is also at -1 (or unset, which we treat as -1).
                const expected = (nodeMgiForSel == null) ? -1 : nodeMgiForSel;
                if (s.material_group_index !== expected) {
                    isSelected = false;
                }
            }
            const spoilerCls = s.is_spoiler ? 'tree-dropdown-item-spoiler' : '';
            const selectedCls = isSelected ? 'tree-dropdown-item-selected' : '';
            // Surface the reason the source is locked as a tooltip so the
            // user can see exactly why it's flagged (region unlock req or
            // per-location req) instead of just a red 🔒. Duplicate the title
            // on child img/span so native hover works anywhere on the row.
            const titleAttr = s.is_spoiler && s.spoiler_reason
                ? ` title="${String(s.spoiler_reason).replace(/"/g, '&quot;')}"`
                : '';
            return `
                            <div class="tree-dropdown-item ${spoilerCls} ${selectedCls}"
                                 data-source-index="${idx}"${titleAttr}>
                                <img src="${sIcon}" class="tree-dropdown-icon${s.type === 'best' ? ' is-best-auto' : ''}" alt=""${titleAttr} onerror="this.style.display='none'">
                                <span${titleAttr}>${s.is_spoiler ? '🔒 ' : ''}${s.label}</span>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    _decodeGearsetSlots(exportString) {
        if (!exportString || typeof window.pako === 'undefined') return null;
        const catalog = window.api?._catalogCache;
        if (!catalog) return null;
        try {
            let padded = exportString;
            const padding = exportString.length % 4;
            if (padding) padded += '='.repeat(4 - padding);
            const decoded = atob(padded);
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
            const decompressed = window.pako.inflate(bytes, { to: 'string' });
            const gearsetData = JSON.parse(decompressed);
            const slots = {};
            const catalogItems = catalog.items || [];
            // Pet level/variant metadata lives in generic_slots._pet_meta
            // (state.js + action-buttons.js use this same channel for live
            // character gearsets). Without reading it, a level-3 dog
            // appears as a level-0 egg — wrong icon and wrong stats. Pull
            // it out once so we can overlay onto the pet slot after the
            // per-item loop resolves it from the items array.
            const petMeta = gearsetData.generic_slots && gearsetData.generic_slots._pet_meta;
            for (const itemData of gearsetData.items || []) {
                if (!itemData.item || itemData.item === 'null') continue;
                const itemJson = JSON.parse(itemData.item);
                const uuid = itemJson.id;
                const quality = itemJson.quality || 'common';
                const slotType = itemData.type;
                const index = itemData.index || 0;
                let slotName;
                if (slotType === 'ring') slotName = `ring${index + 1}`;
                else if (slotType === 'tool') slotName = `tool${index}`;
                else if (slotType === 'pet') slotName = 'pet';
                else if (slotType === 'consumable') slotName = 'consumable';
                else if (slotType === 'activityInput') continue;
                else slotName = slotType;
                if (uuid && uuid.startsWith('generic::')) continue;
                const fullItem = catalogItems.find(item => item.uuid === uuid);
                if (!fullItem) continue;
                let rarity = fullItem.rarity;
                // Crafted items store quality (Normal/Good/Great/...) but
                // popup downstream needs the game quality NAME for stats
                // lookup (stats_by_quality is keyed by Perfect/Eternal/etc),
                // not the lowercase rarity string. Detect whichever the
                // export carries and emit the canonical quality name.
                const RARITY_TO_QUALITY = {
                    common: 'Normal', uncommon: 'Good', rare: 'Great',
                    epic: 'Excellent', legendary: 'Perfect', ethereal: 'Eternal',
                };
                const QUALITY_NAMES = new Set(['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']);
                let qualityName = quality;
                if (!QUALITY_NAMES.has(qualityName)) {
                    qualityName = RARITY_TO_QUALITY[String(quality).toLowerCase()] || 'Normal';
                }
                if (fullItem.type === 'crafted_item') {
                    const qMap = {
                        normal: 'common', common: 'common', good: 'uncommon', uncommon: 'uncommon',
                        great: 'rare', rare: 'rare', excellent: 'epic', epic: 'epic',
                        perfect: 'legendary', legendary: 'legendary', eternal: 'ethereal', ethereal: 'ethereal'
                    };
                    rarity = qMap[String(quality).toLowerCase()] || 'common';
                }
                slots[slotName] = {
                    // Preserve the catalog UUID + display quality so callers
                    // (notably the slot popup's "currently equipped" panel)
                    // can re-resolve the full catalog entry for stats/lock
                    // metadata. Without these, renderCurrentItem in the
                    // popup falls back to an unstyled placeholder.
                    itemId: fullItem.id || uuid,
                    uuid,
                    name: fullItem.name,
                    icon_path: fullItem.icon_path,
                    rarity,
                    // Send the canonical game quality name (Perfect/Eternal/
                    // ...) so popup downstream can hit stats_by_quality
                    // directly. Without this fix the popup tried 'legendary'
                    // as a key and showed 'No stats' on every crafted item.
                    quality: qualityName,
                    is_generic: !!fullItem.is_generic,
                    is_fine: !!fullItem.is_fine,
                };
            }
            // Overlay pet level/variant onto the pet slot if the export
            // carried _pet_meta. Without this, a pet exported with
            // level=3 shows up here as level=0 (egg) and the popup's
            // "currently equipped" panel renders the wrong icon /
            // wrong stats.
            if (petMeta && slots['pet']) {
                slots['pet'] = {
                    ...slots['pet'],
                    level: petMeta.level,
                    variant: petMeta.variant,
                    useAbility: !!petMeta.useAbility,
                };
            }
            // Bring through the consumable slot if the export carried
            // it via generic_slots.consumable (state.js round-trips
            // wiki consumables this way; the items array doesn't
            // catalog them).
            if (gearsetData.generic_slots && gearsetData.generic_slots.consumable && !slots['consumable']) {
                slots['consumable'] = gearsetData.generic_slots.consumable;
            }
            return slots;
        } catch (e) {
            return null;
        }
    }

    _renderGearPreview(exportString, node) {
        // exportString may be null when this node hasn't been optimized yet —
        // we still render the empty-slot grid so the user can click an empty
        // slot to open the slot popup and see what would go there. The grid
        // has a uniform layout regardless of whether items are present.
        const slots = exportString ? (this._decodeGearsetSlots(exportString) || {}) : {};
        const nodeId = node?.node_id || '';

        const QUALITY_TO_RARITY = {
            common: 'rarity-common', uncommon: 'rarity-uncommon', rare: 'rarity-rare',
            epic: 'rarity-epic', legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
            // Fine consumables/materials use a separate cyan tier that's
            // orthogonal to the gear quality ladder. Bug b788d037
            // follow-up: tree-node mini slot tile had no fine background
            // or border because this map only had the gear-quality keys.
            fine: 'rarity-fine',
        };

        const gearSlotNames = ['head', 'cape', 'back', 'chest', 'primary', 'secondary', 'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2'];
        const toolSlotNames = ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'];

        // Slot label formatter for hover tooltips. Tool slots are
        // stored 0-indexed (tool0..tool5) but rendered 1-indexed
        // everywhere the user sees them (slot popup, gear-slot-grid).
        // User feedback 2026-05-19: "don't say Tool 0 (hover over the
        // slot and in upgrade items) as it's tool 1."
        const formatSlotLabel = (slotName) => {
            if (!slotName) return '';
            if (slotName.startsWith('tool')) {
                const n = parseInt(slotName.slice(4), 10);
                return Number.isFinite(n) ? `Tool ${n + 1}` : `Tool ${slotName.slice(4)}`;
            }
            if (slotName === 'ring1' || slotName === 'ring2') {
                return `Ring ${slotName.slice(4)}`;
            }
            return slotName.charAt(0).toUpperCase() + slotName.slice(1);
        };
        // Pet + consumable share the tools row visually (after tool5,
        // before the activity input slot) — keeps the gear preview to
        // two rows total. Per user spec they're displayed everywhere
        // and pass through to the optimizer. The popup's own slot
        // dispatcher uses 'pet' (singular) — match that naming so the
        // ItemSelectionPopup item filter can find the right items.
        const extraSlotNames = ['pet', 'consumable'];

        // Empty-slot SVG outline icons (scraped from wiki via
        // util/scrapers/scrape_slot_icons.py). Indexed slots collapse to
        // their family file: ring1/ring2 → ring.svg, tool0..5 → tool.svg.
        // Rendered at 30x30 centered on empty-slot tiles so the user has
        // a visual cue to click — matches col 2's affordance.
        const slotIconFamily = (slotName) => {
            if (slotName === 'ring1' || slotName === 'ring2') return 'ring';
            if (slotName.startsWith('tool')) return 'tool';
            return slotName;
        };

        // Tool-slot level gating — same rules as col-2's GearSlotGrid:
        // tool0..2 always unlocked, tool3 at level 20, tool4 at level 50,
        // tool5 at level 80. A locked slot is rendered red, non-clickable,
        // with a tooltip explaining the requirement so the user doesn't
        // have to guess which level they need.
        let _characterLevel = 1;
        try {
            const characterStore = (window.store && window.store.state && window.store.state.character) || {};
            if (typeof window.calculateCharacterLevel === 'function') {
                _characterLevel = window.calculateCharacterLevel(characterStore) || 1;
            }
        } catch (_) { /* non-fatal — default to 1 (everything locked beyond tool2) */ }
        const _toolUnlockTable = [
            { idx: 3, level: 20 },
            { idx: 4, level: 50 },
            { idx: 5, level: 80 },
        ];
        const isToolSlotLockedByLevel = (slotName) => {
            if (!slotName.startsWith('tool')) return null;
            const idx = parseInt(slotName.replace('tool', ''), 10);
            const row = _toolUnlockTable.find(r => r.idx === idx);
            if (!row) return null;
            return _characterLevel < row.level
                ? { required: row.level, current: _characterLevel }
                : null;
        };

        // Per-slot lock state — when this slot has been pinned via the popup,
        // overlay a small lock icon so the user can see what's pinned without
        // opening the popup.
        const lockedSlots = node?.locked_slots || {};

        // Build the effective overlay: locked slots WIN, but slots the
        // user hasn't touched can be filled from the optimizer's
        // persisted pet/consumable picks. encode_gearset() can't
        // serialize pet/consumable (Gearset has no _pet/_consumable
        // attribute), so without this overlay the optimizer's chosen
        // pet/consumable was invisible in the gear-preview tiles even
        // when stats reflected it. User-reported bug d3ce19e5: "no pets
        // and consumables. Please fix." Mirror of the same merge in
        // Python's _get_gear_stats so the visual + numerical stays in
        // sync.
        const effectiveOverlay = { ...lockedSlots };
        const optPet = node?.gear_config?.optimized_pet;
        const optCons = node?.gear_config?.optimized_consumable;
        if (optPet && !('pet' in effectiveOverlay)) {
            effectiveOverlay.pet = {
                ...optPet,
                type: 'pet',
            };
        }
        if (optCons && !('consumable' in effectiveOverlay)) {
            effectiveOverlay.consumable = {
                ...optCons,
                type: 'consumable',
            };
        }

        // Apply locked_slots as an overlay onto the decoded gearset so
        // the displayed mini-slot tiles reflect the user's pins (icons +
        // rarity coloring) WITHOUT going through the backend optimizer.
        // The popup writes locked_slots[slot] = {itemId, quality} when
        // the user picks an item or toggles the lock; here we look the
        // catalog entry up so the tile shows the picked item right
        // away. The shape matches what _decodeGearsetSlots emits.
        const RARITY_TO_QUALITY_OVERLAY = {
            common: 'Normal', uncommon: 'Good', rare: 'Great',
            epic: 'Excellent', legendary: 'Perfect', ethereal: 'Eternal',
        };
        const QUALITY_TO_RARITY_OVERLAY = {
            Normal: 'common', Good: 'uncommon', Great: 'rare',
            Excellent: 'epic', Perfect: 'legendary', Eternal: 'ethereal',
        };
        try {
            const catalog = window.api?._catalogCache;
            const catalogItems = (catalog && catalog.items) || [];
            for (const [slotName, info] of Object.entries(effectiveOverlay)) {
                // Null sentinel = user clicked "Unequip" on this slot
                // via the popup. Force the slot to render empty even
                // if the optimizer's export packed an item there.
                if (info === null) {
                    delete slots[slotName];
                    continue;
                }
                if (!info) continue;
                const isObj = typeof info === 'object';
                const itemId = (isObj && info.itemId) || (typeof info === 'string' ? info : null);
                if (!itemId || itemId.startsWith('generic::')) continue;
                const fullItem = catalogItems.find(it => it.id === itemId || it.uuid === itemId);
                // Catalog miss is OK if the lockedSlots payload has the
                // metadata we need (popup pick + lock toggle handlers
                // both stash name/icon_path/rarity/etc on the lock
                // entry). This makes the overlay robust to catalog
                // cache misses and also covers slots like 'pet' where
                // the catalog icon is the egg (we want the level-
                // appropriate icon, not the catalog default).
                if (!fullItem && !isObj) continue;
                const qualityName = (isObj && info.quality)
                    || (fullItem && RARITY_TO_QUALITY_OVERLAY[fullItem.rarity])
                    || 'Normal';
                let rarity = (fullItem && fullItem.rarity)
                    || (isObj && info.rarity)
                    || 'common';
                if (fullItem && fullItem.type === 'crafted_item') {
                    rarity = QUALITY_TO_RARITY_OVERLAY[qualityName] || 'common';
                }
                // Resolve display icon. For pets, the catalog's
                // icon_path is the egg — derive the level/variant-
                // specific icon via getPetIconPath. The lockedSlots
                // payload carries level + variant + max_level for
                // pets (popup pick handler stashes them); fall back
                // to the egg icon if anything's missing.
                const isPet = (fullItem && fullItem.type === 'pet')
                    || (isObj && info.type === 'pet');
                let iconPath = (fullItem && fullItem.icon_path)
                    || (isObj && info.icon_path)
                    || '';
                if (isPet && isObj && info.level !== undefined && info.level !== null) {
                    const petName = (fullItem && fullItem.name) || info.name || '';
                    const petVariant = info.variant || 'normal';
                    const petMax = info.max_level !== undefined
                        ? info.max_level
                        : (fullItem && fullItem.max_level) || 0;
                    if (petName) {
                        iconPath = getPetIconPath(petName, info.level, petVariant, petMax);
                    }
                }
                slots[slotName] = {
                    itemId: (fullItem && fullItem.id) || itemId,
                    uuid: (fullItem && fullItem.uuid) || itemId,
                    name: (fullItem && fullItem.name) || (isObj && info.name) || slotName,
                    icon_path: iconPath,
                    rarity,
                    quality: qualityName,
                    is_generic: !!(fullItem && fullItem.is_generic) || !!(isObj && info.is_generic),
                    is_fine: !!(fullItem && fullItem.is_fine) || !!(isObj && info.is_fine),
                    level: isObj ? info.level : undefined,
                    variant: isObj ? info.variant : undefined,
                    max_level: isObj ? info.max_level : undefined,
                    type: (fullItem && fullItem.type) || (isObj && info.type) || undefined,
                };
            }
        } catch (_) { /* non-fatal — overlay is best-effort */ }

        const renderSlot = (slotName) => {
            const item = slots[slotName];
            const isLocked = !!lockedSlots[slotName];
            const lockOverlay = isLocked ? `<span class="tree-gear-mini-lock" role="button" tabindex="0" aria-label="Click to unlock" title="Click to unlock — optimizer can pick its own item">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
                    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#e8820c" stroke-width="2.5" stroke-linecap="round"/>
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="#e8820c"/>
                    <circle cx="12" cy="16" r="1.5" fill="#3d2503"/>
                </svg>
            </span>` : '';
            // Level-locked tool slots: red, no click handler, tooltip
            // explains the level requirement. Mirrors col-2 behavior.
            const levelLock = isToolSlotLockedByLevel(slotName);
            if (levelLock) {
                return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--level-locked" data-slot="${slotName}" data-tree-node-id="${nodeId}" data-disabled="1" title="${formatSlotLabel(slotName)} requires character level ${levelLock.required} (you are level ${levelLock.current})">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                        <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
                    </svg>
                </div>`;
            }
            // data-slot + data-tree-node-id make the tile a click target for
            // the slot popup. Always emit them, even on empty slots — that's
            // how the user can pick an item for an unfilled slot.
            const dataAttrs = `data-slot="${slotName}" data-tree-node-id="${nodeId}"`;
            if (!item) {
                const slotIcon = `/assets/icons/slots/${slotIconFamily(slotName)}.svg`;
                return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--empty" ${dataAttrs} title="Empty ${formatSlotLabel(slotName)} slot — click to pick">
                    <img src="${slotIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">
                    ${lockOverlay}
                </div>`;
            }
            // rarity drives the slot's background + border (separate from
            // the icon's drop-shadow). is_fine forces rarity-fine even
            // when item.rarity wasn't set to 'fine' (e.g. older payloads
            // or catalog items where rarity is the base 'common' but
            // the equipped slot is a Fine variant). Bug b788d037 follow-up.
            let rarityClass = item.rarity ? QUALITY_TO_RARITY[item.rarity] || '' : '';
            if (item.is_fine && rarityClass !== 'rarity-fine') {
                rarityClass = 'rarity-fine';
            }
            const iconPath = item.icon_path || '';
            // Fine outline: consumables/materials marked is_fine get the
            // cyan drop-shadow same as col-2 .item-icon.fine. The CSS
            // rule lives at `.travel-gear-mini-icon.fine` (added for
            // bug 3bb938f4 follow-up — without it Fine consumables had
            // no visual indicator that they were the Fine variant).
            // Detection mirrors gear-slot-grid.renderSlot — checks the
            // is_fine flag plus a name-based fallback for older
            // payloads that didn't carry the flag.
            const isFine = !!item.is_fine
                || (typeof item.name === 'string' && item.name.includes('(Fine)'));
            const iconClass = `travel-gear-mini-icon${isFine ? ' fine' : ''}`;
            return `<div class="travel-gear-mini-slot tree-gear-mini-slot ${rarityClass}" ${dataAttrs} title="${item.name || formatSlotLabel(slotName)}">
                ${iconPath ? `<img src="${iconPath}" alt="${item.name || ''}" class="${iconClass}" loading="lazy" />` : ''}
                ${lockOverlay}
            </div>`;
        };

        const gearHtml = gearSlotNames.map(renderSlot).join('');
        const toolHtml = toolSlotNames.map(renderSlot).join('');
        const extraHtml = extraSlotNames.map(renderSlot).join('');

        // Render the input-item slot(s) (if the node's activity declares
        // input_items) inline with the tool row, right after tool5. Each
        // declared input slot renders as its own tile so activities with
        // multiple input requirements (rare, but supported by the
        // schema) get one slot per requirement. The keyword icon shows
        // when the slot is empty so the user knows what to feed in.
        let inputHtml = '';
        const activityInputs = node?.activity_input_items || [];
        const inputItemsMap = node?.gear_config?.selected_input_items || {};
        const userInputsMap = node?.gear_config?.user_input_items || {};
        if (activityInputs.length > 0) {
            inputHtml = activityInputs.map((ii, idx) => {
                if (!ii || !ii.name) return '';
                // Keyword icon path: snake-cased keyword name. Mirrors the
                // activity-info-section column-3 path.
                const slotIconKey = (ii.name || '').toLowerCase()
                    .replace(/ /g, '_')
                    .replace(/[^a-z0-9_]/g, '');
                const slotFamilyIcon = `/assets/icons/keywords/${slotIconKey}.svg`;
                // Resolve the currently-equipped input item: user pin
                // overrides auto-pick. Both maps keyed by index (string
                // after JSON round-trip, so try both forms).
                const userPick = userInputsMap[idx] || userInputsMap[String(idx)];
                const autoPick = inputItemsMap[idx] || inputItemsMap[String(idx)];
                const equipped = userPick || autoPick;
                const isLocked = !!userPick;
                const lockOverlay = isLocked ? `<span class="tree-gear-mini-lock" role="button" tabindex="0" aria-label="Click to unlock" title="Click to unlock — optimizer can pick its own item">
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
                        <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#e8820c" stroke-width="2.5" stroke-linecap="round"/>
                        <rect x="5" y="11" width="14" height="10" rx="2" fill="#e8820c"/>
                        <circle cx="12" cy="16" r="1.5" fill="#3d2503"/>
                    </svg>
                </span>` : '';
                // Common data attrs so the click handler can dispatch
                // to the popup with the right keyword + level filter.
                const dataAttrs = `data-input-idx="${idx}" data-input-keyword="${ii.reference || ii.name || ''}" data-input-level="${ii.level || 0}" data-input-name="${(ii.name || '').replace(/"/g, '&quot;')}" data-tree-node-id="${nodeId}"`;
                if (!equipped) {
                    // Empty-state: show the keyword family icon (e.g.
                    // arrows.svg) so the user knows what kind of item
                    // goes here. Click opens the popup.
                    return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--empty tree-gear-mini-slot--input" ${dataAttrs} title="Click to pick ${ii.name}${ii.level ? ` (Lv.${ii.level}+)` : ''}">
                        <img src="${slotFamilyIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">
                        ${lockOverlay}
                    </div>`;
                }
                const rarityClass = equipped.rarity ? (QUALITY_TO_RARITY[equipped.rarity] || '') : '';
                const iconPath = equipped.icon_path || '';
                const title = equipped.name || ii.name || 'Input item';
                return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--input ${rarityClass}" ${dataAttrs} title="${title}">
                    ${iconPath ? `<img src="${iconPath}" alt="${title}" class="travel-gear-mini-icon" loading="lazy" />` : ''}
                    ${lockOverlay}
                </div>`;
            }).join('');
        }

        return `
            <div class="travel-gear-preview-row">${gearHtml}</div>
            <div class="travel-gear-preview-row tools-row">${toolHtml}${extraHtml}${inputHtml}</div>
        `;
    }

    _renderServiceDropdown(node) {
        const services = node.available_services || [];
        const stats = node.metrics?.stats_used || {};
        const selectedId = node.selected_service_id || '__best__';
        const isBest = selectedId === '__best__';
        let currentLabel = stats.service_name || 'Best (auto)';
        if (isBest && stats.service_name) {
            currentLabel = `Best → ${stats.service_name}`;
        }
        // Find the matching service for its icon
        let selectedIcon = '';
        if (isBest && stats.service_name) {
            // Find the service whose label matches the winning name
            const match = services.find(s => s.label && stats.service_name && s.label.includes(stats.service_name.split(' (')[0]));
            selectedIcon = match?.icon || services[0]?.icon || '';
        } else {
            const selectedSvc = services.find(s => s.id === selectedId) || services[0];
            selectedIcon = selectedSvc?.icon || '';
        }

        if (services.length <= 1) {
            return `<span class="tree-node-service-label">
                ${selectedIcon ? `<img src="${selectedIcon}" class="tree-dropdown-icon" alt="" onerror="this.style.display='none'">` : '⚒'}
                Service: ${currentLabel}
            </span>`;
        }

        // Selected-service tooltip: when the active service is a spoiler,
        // find its spoiler_reason so we can surface it on the button.
        const selectedService = services.find(s => s.id === selectedId);
        const selectedTitleAttr = selectedService?.is_spoiler && selectedService?.spoiler_reason
            ? ` title="${String(selectedService.spoiler_reason).replace(/"/g, '&quot;')}"`
            : '';

        return `
            <div class="tree-dropdown tree-service-dropdown" data-dropdown="service" data-node-id="${node.node_id}">
                <div class="tree-dropdown-button"${selectedTitleAttr}>
                    <div class="tree-dropdown-value"${selectedTitleAttr}>
                        ${selectedIcon ? `<img src="${selectedIcon}" class="tree-dropdown-icon${isBest && !stats.service_name ? ' is-best-auto' : ''}" alt=""${selectedTitleAttr} onerror="this.style.display='none'">` : ''}
                        <span${selectedTitleAttr}>Service: ${currentLabel}</span>
                    </div>
                    <div class="tree-dropdown-toggle">
                        <span class="expand-arrow">▼</span>
                    </div>
                </div>
                <div class="tree-dropdown-panel" style="display:none">
                    <input type="text" class="tree-dropdown-search activity-search" placeholder="Search services..." aria-label="Search services">
                    ${services.map(s => {
            const sel = s.id === selectedId ? 'tree-dropdown-item-selected' : '';
            const spoilerCls = s.is_spoiler ? 'tree-dropdown-item-spoiler' : '';
            const icon = s.icon || '';
            const titleAttr = s.is_spoiler && s.spoiler_reason
                ? ` title="${String(s.spoiler_reason).replace(/"/g, '&quot;')}"`
                : '';
            return `<div class="tree-dropdown-item ${sel} ${spoilerCls}" data-service-id="${s.id}"${titleAttr}>
                            ${icon ? `<img src="${icon}" class="tree-dropdown-icon${s.id === '__best__' ? ' is-best-auto' : ''}" alt=""${titleAttr} onerror="this.style.display='none'">` : ''}
                            <span${titleAttr}>${s.is_spoiler ? '🔒 ' : ''}${s.label}</span>
                        </div>`;
        }).join('')}
                </div>
            </div>
        `;
    }

    _renderLocationDropdown(node) {
        const locations = node.available_locations || [];
        const stats = node.metrics?.stats_used || {};
        const selectedId = node.selected_location_id || '__best__';
        const isBest = selectedId === '__best__' || !node.selected_location_id;

        // Build display label, following the same pattern as the service dropdown:
        // "📍 Best → Frusenholm" when auto-selected post-optimization, "📍 Best (auto)"
        // pre-optimization, "📍 Jarvonia" when user picked a specific location.
        let currentLabel;
        if (isBest) {
            currentLabel = stats.location ? `Best → ${stats.location}` : 'Best (auto)';
        } else {
            currentLabel = selectedId;
        }

        // Require at least one real (non-best) location entry.
        const realLocations = locations.filter(l => l.id !== '__best__');
        if (realLocations.length < 1) {
            return `<span class="tree-node-service-label">📍 ${currentLabel}</span>`;
        }

        // Use the full LocationDropdown component for every multi-location case
        // (recipe-no-service nodes that span 30+ regions, AND activity nodes
        // with 2-10 valid locations). Activity nodes pass `flat: true` and
        // `allowedLocationNames` to skip region grouping and limit the list
        // to the activity's valid locations — same Auto/Best, arrow, search,
        // and location icons as the service-location dropdown.
        const isFullDropdown = realLocations.length > 10;
        const allowedNames = isFullDropdown
            ? null
            : realLocations.map(l => l.id);
        // Container for the LocationDropdown component. Instantiated after
        // render. The component renders its own 'Location' label header
        // (via label: 'Location' in the wiring code) and its own icon, so
        // we don't need a separate inline pin emoji here.
        return `
            <div class="tree-node-full-location-dropdown"
                 data-node-id="${node.node_id}"
                 data-selected-location="${isBest ? '' : selectedId}"
                 data-display-label="${currentLabel.replace(/"/g, '&quot;')}"
                 data-flat="${allowedNames ? '1' : '0'}"
                 data-allowed-names="${allowedNames ? allowedNames.join('|').replace(/"/g, '&quot;') : ''}">
            </div>
        `;
    }

    _getDisplayedLeafMaterials() {
        // Material Options row visibility:
        //   - Show pre-Calculate Best(auto) so the user can preview
        //     alternatives before locking the optimizer pick.
        //   - Show when _mo_preview_chip is set so the user can revert
        //     a preview by clicking the active chip again.
        //   - HIDE post-Calculate (source dropdown does the picking job)
        //     unless preview is active.
        //   - HIDE for non-craftable items (no recipe options) — the
        //     row is just empty and the if-< 2 guard hides it anyway.
        //
        // Backend `_build_leaf_materials` already filters out
        // activity-type sources, so leafMats[*].kind is always
        // 'recipe_group'. We don't filter by kind here — backend is
        // the source of truth and any future kinds will pass through.
        const { node } = this.props;
        const leafMats = (node.leaf_materials || []);
        if (leafMats.length < 2) return [];

        const isBest = node.source_type === 'best';
        const bestComputed = !!node.best_pick_computed;
        const previewActive = !!node._mo_preview_chip;

        const showForBest = isBest && !bestComputed;
        if (!showForBest && !previewActive) return [];

        // Render in declared order — user spec (2026-05-15): "I don't
        // want them to move to the first slot when I click it. Keep
        // it on the same position." Previously the winner was hoisted
        // to the front; that reorder is intentionally dropped.
        return leafMats;
    }
    _renderMaterialGroupDropdown() {
        const { node } = this.props;
        // Material Options selector: shows recipe alternatives for
        // craftable Best(auto) targets. New click semantics
        // (2026-05-15 redesign):
        //   - Click chip = pure frontend preview. NO backend
        //     onSourceChange call. Sets node._mo_preview_chip = the
        //     chip key so re-renders keep showing it as active.
        //   - Click ACTIVE chip again = revert preview (clear flag).
        //   - Click DIFFERENT chip while one is active = swap preview.
        //   - Click the "Preview: <recipe name>" link below the chips
        //     = THIS is the commit; calls onSourceChange and the tree
        //     rebuilds. Material Options row slides up away.
        let leafMats = this._getDisplayedLeafMaterials();
        if (leafMats.length < 2) return '';

        // bestComputed gates dim-non-winners styling. Both filter and
        // ordering already happen in _getDisplayedLeafMaterials.
        const bestComputed = !!node.best_pick_computed;
        const previewChip = node._mo_preview_chip || null;
        const previewActive = !!previewChip;

        // Which chip should be highlighted (blue border)? Match the
        // chip's (source_id, mgi) against the active preview key.
        // Format: "<source_id>::<mgi>" — built identically in the
        // chip click handler so frontend and renderer agree.
        const buttons = leafMats.map((opt, i) => {
            const optSid = String(opt.source_id || '');
            const optMgi = opt.material_group_index == null ? 0 : opt.material_group_index;
            const chipKey = `${optSid}::${optMgi}`;
            const isActive = previewActive && previewChip === chipKey;
            const isBestWinner = bestComputed && opt.is_best_pick;
            let cls = '';
            if (isActive) {
                cls = 'selected';
            } else if (isBestWinner) {
                cls = 'is-best-pick';
            } else if (bestComputed) {
                cls = 'dimmed';
            }
            const sid = optSid.replace(/"/g, '&quot;');
            const mgi = opt.material_group_index == null ? '' : String(opt.material_group_index);
            const label = opt.label;
            return `
                <button class="material-group-button tree-material-group-button ${cls}"
                        data-kind="${opt.kind}"
                        data-source-type="${opt.source_type}"
                        data-source-id="${sid}"
                        data-material-group-index="${mgi}"
                        data-option-index="${i}"
                        title="${label}">
                    ${opt.icon ? `<img src="${opt.icon}" class="tree-leaf-material-icon" alt="" onerror="this.style.display='none'"> ` : ''}
                    <span>${label}</span>
                </button>
            `;
        }).join('');

        // No "Preview: <link>" line on the parent card — the (preview)
        // tag + recipe-name commit link now render on the resulting
        // CHILD node(s) instead (set up by backend on chip click via
        // _mo_preview_chip + parent_recipe_label fields on the child).

        return `
            <div class="tree-node-material-alts">
                <label class="tree-dropdown-label">Material Options:</label>
                <div class="material-group-selector">
                    ${buttons}
                </div>
            </div>
        `;
    }

    render() {
        const { node, depth = 0, allNodes = [] } = this.props;
        if (!node) return '';
        console.log('[LOC-FLICKER] TreeNodeCard.render', { nodeId: node.node_id, item: node.item_id, depth });
        if (typeof window !== 'undefined' && window._craftingTreeDebugRender) {
            // Per-card render log so engineers can correlate
            // mutations from MutationObserver to specific component
            // re-renders. Stamps a monotonic counter + the node id +
            // current preview state so we see exactly when a card is
            // rebuilt vs untouched. Same toggle as
            // _craftingTreeDebugRender on the parent view — disabled
            // by default to avoid console spam.
            window._ctRenderSeq = (window._ctRenderSeq || 0) + 1;
            console.log('[CT-RENDER] TreeNodeCard.render', {
                seq: window._ctRenderSeq,
                nodeId: node.node_id,
                item: node.item_id,
                depth,
                source_type: node.source_type,
                source_id: node.source_id,
                _mo_preview_chip: node._mo_preview_chip || null,
                _mo_parent_recipe_label: node._mo_parent_recipe_label || null,
                ts: formatFixed(performance.now(), 1),
            });
        }

        const children = allNodes.filter(n => n.parent_id === node.node_id);
        const hasChildren = children.length > 0;
        // Collapse logic:
        //  - leaf nodes at depth 2+ start collapsed (existing behavior)
        //  - Best(auto) nodes start collapsed when candidates diverge
        //    (node.auto_collapsed_best from backend)
        //  - user preference wins: node.collapsed === true/false overrides
        const leafAutoCollapse = !hasChildren && depth >= 2;
        const bestAutoCollapse = !!node.auto_collapsed_best;
        const defaultCollapsed = leafAutoCollapse || bestAutoCollapse;
        const collapsed = node.collapsed === undefined
            ? defaultCollapsed
            : !!node.collapsed;
        // Independent state: hides the children subtree (and material
        // options) while keeping the node body visible. User toggles this
        // via the "Hide children" button. Persisted as node.children_hidden.
        const childrenHidden = !!node.children_hidden;
        // Pre-Calculate Best(auto) ghost-child hide (user spec
        // 2026-05-15): when source=best AND Calculate hasn't run AND
        // the Material Options chips are showing (2+ leaf_materials),
        // suppress the resolved ghost child cards entirely. The chips
        // are the picker UI; rendering the optimizer's pre-Calculate
        // best-guess child below them is misleading because nothing
        // has actually been picked. Once the user commits via the
        // Preview link OR runs Calculate, this branch falls through
        // and children render normally.
        // NOTE: when a chip IS clicked (preview active), source_type
        // becomes 'recipe' (backend rebuild), so this hide rule
        // naturally falls through and the preview children render.
        const hideGhostChild = (
            node.source_type === 'best'
            && !node.best_pick_computed
            && (node.leaf_materials || []).length >= 2
        );
        const metrics = node.metrics || {};

        // Derive the per-node totals once, up front, so the header and
        // the body render rows both use the same numbers. Two historical
        // display bugs led here:
        //   1. Header showed raw metrics.steps_per_item (idealized per
        //      single unit) while the body showed derived-from-ceil
        //      (totalSteps / ceil(effective_qty)). For a leaf at x2 the
        //      header would say "113.4 steps/item" while the body said
        //      "82.5" — wildly inconsistent.
        //   2. total_steps / total_actions on the backend include the
        //      cumulative tree-sum (this node + child contributions
        //      scaled by input ratios). For a twine recipe at x1 that
        //      showed "6 actions / 206 steps" which bundled in flax
        //      gathering. The user wants per-node work shown, not the
        //      whole chain.
        //
        // Fix: read self_steps/self_actions from the backend (per-node
        // pre-rollup snapshot, falls back to total_* if the backend is
        // older), derive the ceiled totals once, and use the same
        // perItem value in both header and body.
        const selfStepsPerItem = (metrics.self_steps != null)
            ? metrics.self_steps
            : metrics.total_steps;
        const selfActionsPerItem = (metrics.self_actions != null)
            ? metrics.self_actions
            : metrics.total_actions;
        const effRaw = (node.effective_quantity != null)
            ? node.effective_quantity
            : (node.base_requirement_amount || 1);
        // Bug 15110e01 — root row stays fractional. The backend now
        // cascades children at target_quantity (integer), so ceil() is
        // a no-op for them; the only node where rawActions is fractional
        // is the ROOT (eff = target × (1+buffer)). Per user spec
        // "Root row should be fractional. Always." For non-root nodes
        // we keep the existing ceil-to-craftable-quantity behavior.
        const isRootCard = depth === 0;
        const effCeilForTotals = (effRaw === Infinity || effRaw == null)
            ? effRaw
            : (isRootCard ? effRaw : Math.max(1, Math.ceil(effRaw)));
        const rawTotalStepsHoist = (selfStepsPerItem === Infinity || selfStepsPerItem == null)
            ? selfStepsPerItem
            : selfStepsPerItem * effRaw;
        const rawTotalActionsHoist = (selfActionsPerItem || 0) * effRaw;
        const stepsPerActionDerived = rawTotalActionsHoist > 0
            ? rawTotalStepsHoist / rawTotalActionsHoist
            : 0;
        const totalActionsHoist = (rawTotalActionsHoist === Infinity || rawTotalActionsHoist == null)
            ? rawTotalActionsHoist
            : (isRootCard ? rawTotalActionsHoist : Math.ceil(rawTotalActionsHoist));
        const totalStepsHoist = (rawTotalStepsHoist === Infinity || rawTotalStepsHoist == null)
            ? rawTotalStepsHoist
            : totalActionsHoist * stepsPerActionDerived;
        const perItemHoist = (totalStepsHoist === Infinity || totalStepsHoist == null)
            ? totalStepsHoist
            : (effCeilForTotals && effCeilForTotals !== Infinity
                ? totalStepsHoist / effCeilForTotals
                : selfStepsPerItem);

        // Header 'steps/item' (the right-aligned green label) shows the
        // backend's canonical steps-per-item rate directly (metrics.self_steps,
        // e.g. 49.2 for flax) rather than the ceil-adjusted division
        // totalSteps/ceilEffQty (which would give 51.6 = 413 ceiled-steps ÷
        // 8 ceiled-items). The drops section in activity-info-section uses
        // the same canonical rate, so this keeps both displays consistent.
        //
        // Label suffix: when the ROOT targets a quality above Normal AND
        // the target item is equipment (i.e. quality_prob filtering is
        // actually applied by the backend), show 'steps/Perfect+' or
        // 'steps/Eternal+' to make explicit that the steps count the
        // whole at-or-above-target bucket. Tier threshold nuance:
        // 'Eternal+' is just 'Eternal' since there's no higher tier, so
        // we drop the '+' in that one case. Non-root nodes always read
        // the plain 'steps/item' — quality_prob doesn't factor into
        // their math (they're intermediate materials, not the gated
        // output). Users asked for this after confirming the tree's
        // Perfect-or-above semantics were intentional (8110 vs info
        // section's Perfect-only 8273 — the gap is the Eternal tier).
        const targetQuality = (this.props.globalSettings || {}).target_quality || 'Normal';
        const itemIsEquipment = typeof node.item_id === 'string' && node.item_id.startsWith('Item.');
        // Use the quality-aware "Steps/Normal+" / "Steps/Perfect+" / etc.
        // label whenever the root is a quality-aware equipment recipe --
        // including target_quality=='Normal'. Normal-target means "any
        // quality counts", so every craft (Normal -> Eternal) goes into
        // the at-or-above bucket: the "+" suffix is correct and the
        // tooltip's "all at-or-above-target tiers count" still applies.
        // Without the Normal+ label, the root card showed "Steps/item"
        // for Normal-target equipment recipes -- which under-sold the
        // fact that the tree IS quality-aware (the per-tier breakdown
        // is in the Target Yield section of the summary). Bug 04a95d91
        // follow-up (2026-05-20).
        const useQualityLabel = depth === 0 && itemIsEquipment;
        const stepsItemNoun = useQualityLabel
            ? (targetQuality === 'Eternal' ? 'Eternal' : `${targetQuality}+`)
            : 'item';
        const stepsItemTooltip = useQualityLabel
            ? `Steps per ${targetQuality}-or-above output (all at-or-above-target quality tiers count — sub-target crafts appear under Side Drops)`
            : '';
        //
        // NOTE: The left-header "steps/item" is PER-NODE ONLY (this node's
        // own work per output item). The cumulative tree-sum is shown
        // separately in the body row "total steps per item". Keeping the
        // left header scoped to this node lets the user read each card
        // without mental subtraction — e.g. for a twine root at x1, the
        // left shows 42 (just the spin cost) and the body shows 207
        // (42 spin + 82.5×2 flax). For leaves (no children) self == cum
        // and both rows agree. Users confused the old behavior because
        // every card's left label read the same cumulative number.
        const cumulativeSteps = (typeof node._displayed_cumulative_steps === 'number')
            ? node._displayed_cumulative_steps
            : null;
        const perItemCumulative = (cumulativeSteps != null
                && cumulativeSteps !== Infinity
                && effCeilForTotals && effCeilForTotals !== Infinity)
            ? cumulativeSteps / effCeilForTotals
            : null;
        const stepsPerItem = (selfStepsPerItem != null
                && isFinite(selfStepsPerItem) && selfStepsPerItem > 0)
            ? selfStepsPerItem
            : metrics.steps_per_item;
        const stepsDisplay = stepsPerItem === Infinity ? '∞' :
            stepsPerItem === 0 ? 'Bank' :
                stepsPerItem != null ? formatFixed(stepsPerItem, 1) : '—';
        const stats = metrics.stats_used || {};
        const alts = node.alternatives || [];

        // Header is clickable when the node has a collapsible body — i.e. any
        // node past depth 0 that has children OR a stats/gear/optimize body.
        // Always show the arrow when there's anything to collapse (children
        // OR body content). Root always has content, leaves at depth>=2
        // without children still have their stats row.
        const headerClickable = hasChildren || depth >= 0;

        const html = `
            <div class="tree-node-card" data-node-id="${node.node_id}" data-depth="${depth}">
                <div class="tree-node-side-collapse" title="Collapse / expand"></div>
                <div class="tree-node-header ${headerClickable ? 'tree-node-header-clickable' : ''} ${collapsed ? 'collapsed' : ''}"${headerClickable ? ' role="button" tabindex="0"' : ''}>
                    ${headerClickable ? `<span class="expand-arrow tree-node-header-arrow ${collapsed ? '' : 'expanded'}">▼</span>` : ''}
                    ${node.icon_path ? `<img src="${node.icon_path}" class="tree-node-item-icon" alt="">` : ''}
                    <span class="tree-node-name">${node.item_name}</span>
                    ${(() => {
                        // Effective quantity (total items the user actually needs
                        // at this node, propagated from the root target). Falls
                        // back to base_requirement_amount pre-calc. Shown as
                        // the primary quantity chip — matches user's ask that
                        // each card reflects the TOTAL quantity needed, not the
                        // per-craft requirement.
                        //
                        // Display as a whole number: fractional effective
                        // quantity (e.g. 1.36 flax needed to yield one twine
                        // after drop/yield math) is mathematically correct but
                        // visually confusing. Ceil so the chip always says
                        // "x2" rather than "x1.36" — the user can't gather a
                        // fractional item, and the floor of the requirement
                        // could leave them short.
                        //
                        // Exception: ROOT node with a fractional effective
                        // quantity (e.g. target=1, buffer=5% → eff=1.05)
                        // should display the raw value "×1.05" instead of
                        // ceiling to "×2". On the root, eff represents the
                        // expected number of attempts to satisfy a target
                        // qty of 1 (RNG/quality probability), not a discrete
                        // gather count — and the body row + summary already
                        // reflect this fractional value (cumulative ×
                        // target_qty / ceil(eff), see 948d02f1 fix). The
                        // user pointed out the mismatch: "It still says x2
                        // but the numbers are now right. Make it say 1.05
                        // and then everything will be right." Bug 948d02f1
                        // follow-up.
                        const eff = (node.effective_quantity != null)
                            ? node.effective_quantity
                            : node.base_requirement_amount;
                        const isRootChip = depth === 0;
                        const _isFiniteEff = (eff != null && eff !== Infinity);
                        const _hasFractional = _isFiniteEff
                            && Math.abs(eff - Math.round(eff)) > 1e-9;
                        let effStr;
                        if (eff === Infinity || eff == null) {
                            effStr = '∞';
                        } else if (isRootChip && _hasFractional) {
                            // Show fractional with two decimals (matches
                            // the precision of buffer_percentage which is
                            // stored as e.g. 0.05). Trim trailing zeros so
                            // 1.50 displays as 1.5 (still > the integer
                            // ceiling visually) and 1.05 stays 1.05.
                            effStr = formatFixed(eff, 2, { trim: true });
                        } else {
                            const effInt = Math.ceil(eff);
                            effStr = Math.round(effInt).toLocaleString();
                        }
                        return `<span class="tree-node-qty">×${effStr}</span>`;
                    })()}
                    ${
                        // (preview) tag + recipe-name commit link.
                        // Renders ONLY on the previewed children — the
                        // parent card (which has _mo_preview_chip set
                        // for chip-selection state) deliberately does
                        // NOT render the tag because the parent's UI
                        // shouldn't change during preview. We gate
                        // strictly on _mo_parent_recipe_label, which
                        // crafting-tree-view sets only on the
                        // immediate children. Placed AFTER the
                        // ×qty chip per user spec 2026-05-15.
                        node._mo_parent_recipe_label
                            ? ` <span class="tree-node-preview-tag">(preview)</span> <a class="tree-mo-commit-link" href="javascript:void(0)" data-node-id="${node.node_id}" title="Click to commit this as the parent's source">${String(node._mo_parent_recipe_label).replace(/</g, '&lt;')}</a> `
                            : ''
                    }
                    <span class="tree-node-steps ${stepsPerItem === Infinity ? 'tree-node-impossible' : ''}"${stepsItemTooltip ? ` title="${stepsItemTooltip}"` : ''}>${stepsDisplay} steps/${stepsItemNoun}</span>
                </div>

                <div class="tree-node-body" style="${collapsed ? 'display:none' : ''}">
                ${node.gear_config?.lock_warning ? (() => {
                    // Strip the helper's "Locked gear missing keyword: "
                    // prefix — the new warning card has its own
                    // "Requirements not met" header, so we only show
                    // the per-keyword detail (e.g. "Hunting Bow
                    // (need 1, have 0)").
                    const raw = String(node.gear_config.lock_warning);
                    const detail = raw.replace(/^Locked gear missing keyword:\s*/i, '');
                    return `<div class="tree-node-lock-warning-box" role="alert">
                        <span class="lock-warning-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M 13.5 3.2 L 21.5 19.3 Q 23 22 20 22 L 4 22 Q 1 22 2.5 19.3 L 10.5 3.2 Q 12 0.5 13.5 3.2 Z" fill="#4a3a08" stroke="#facc15" stroke-width="2" stroke-linejoin="round"/>
                                <rect x="10.5" y="8" width="3" height="7" rx="1.5" fill="#facc15"/>
                                <rect x="10.5" y="16" width="3" height="3" rx="1.5" fill="#facc15"/>
                            </svg>
                        </span>
                        <div class="lock-warning-text">
                            <span class="lock-warning-header">Requirements not met</span>
                            <span class="lock-warning-detail">${detail.replace(/</g, '&lt;')}</span>
                        </div>
                    </div>`;
                })() : ''}

                ${metrics.total_steps != null ? (() => {
                    // Per-node totals. Rows:
                    //   - total steps    = ceil(self_actions × eff) × steps_per_action
                    //                      (this node's own work only)
                    //   - total actions  = ceil(self_actions × eff)
                    //                      (this node's own action count)
                    //   - total per item = full-chain cost per 1 output item
                    //                      (ceiled self + Σ ceiled descendants,
                    //                      divided by ceil(eff)). For a leaf
                    //                      this equals the self/perItem value.
                    //                      For a root recipe this sums in
                    //                      child work — e.g. twine at x1:
                    //                      82.5(flax per)×2 + 42(spin) = 207
                    //                      per 1 twine. Bug 3cead1f0.
                    // Header steps/item uses SELF-ONLY (perItemHoist) now —
                    // the body "total steps per item" keeps the cumulative
                    // tree-sum so the user can see both numbers on each card.
                    const eff = effRaw;
                    // "Total actions" should count EFFECTIVE actions (paid +
                    // free DA rolls), matching how the activity calculator
                    // in activity-info-section displays its action count.
                    // totalActionsHoist (= ceil(self_actions × effRaw)) is
                    // paid-only — multiply by (1 + DA) to add the expected
                    // free actions from double_action before ceiling, so
                    // e.g. 7 paid at DA=14% shows as 8 total (7 + 1 free).
                    // User-reported 'should say 8 actions, not 7' on the
                    // flax node with butterfly-catching gear. total_steps
                    // stays as paid-only × steps_per_paid_action (413 in
                    // that report) since free DA actions don't cost steps.
                    const daBonus = (typeof stats.DA === 'number' && isFinite(stats.DA))
                        ? Math.max(0, stats.DA)
                        : 0;
                    const effectiveActionsRaw = (rawTotalActionsHoist === Infinity
                        || rawTotalActionsHoist == null)
                        ? rawTotalActionsHoist
                        : rawTotalActionsHoist * (1 + daBonus);
                    // Bug 15110e01 — root row stays fractional. Don't
                    // ceil for the root card so "1.05 actions" reads as
                    // 1.05 (or "Total actions: 1") not as 2.
                    const totalActions = (effectiveActionsRaw === Infinity
                        || effectiveActionsRaw == null)
                        ? effectiveActionsRaw
                        : (isRootCard ? effectiveActionsRaw : Math.ceil(effectiveActionsRaw));
                    const totalSteps = totalStepsHoist;
                    const effCeil = effCeilForTotals;
                    const perItem = (perItemCumulative != null && perItemCumulative > 0)
                        ? perItemCumulative
                        : perItemHoist;
                    const fmt = v => v === Infinity ? '∞' : formatFixed(v, 1);
                    const fmtInt = v => v === Infinity ? '∞' : Math.round(v).toLocaleString();
                    // Debug log for flax→twine and similar recipes. Filter in
                    // console with [CT-MATH] to isolate.
                    if (window._craftingTreeDebug !== false) {
                        console.log('[CT-MATH]', {
                            node: node.item_name,
                            source_type: node.source_type,
                            eff,
                            self_steps_per_item: selfStepsPerItem,
                            self_actions_per_item: selfActionsPerItem,
                            cumulative_steps_per_item: metrics.total_steps,
                            cumulative_actions_per_item: metrics.total_actions,
                            raw_total_steps_self: rawTotalStepsHoist,
                            raw_total_actions_self: rawTotalActionsHoist,
                            derived_steps_per_action: stepsPerActionDerived,
                            ceiled_actions: totalActions,
                            ceiled_total_steps: totalSteps,
                            ceiled_qty: effCeil,
                            displayed_self_steps: node._displayed_self_steps,
                            displayed_self_actions: node._displayed_self_actions,
                            displayed_cumulative_steps: node._displayed_cumulative_steps,
                            displayed_cumulative_actions: node._displayed_cumulative_actions,
                            per_item_displayed: perItem,
                        });
                    }
                    return `
                <div class="tree-node-totals">
                    <span>${fmtInt(totalSteps)} total steps</span>
                    <span>${isRootCard ? fmt(totalActions) : fmtInt(totalActions)} total actions</span>
                </div>
                <div class="tree-node-totals">
                    <span${stepsItemTooltip ? ` title="${stepsItemTooltip}"` : ''}>${fmt(perItem)} total steps per ${stepsItemNoun}</span>
                </div>`;
                })() : ''}

                <div class="tree-node-source">
                    <label class="tree-dropdown-label"><strong>Source:</strong></label>
                    ${this._renderSourceDropdownButton()}
                </div>

                ${node.source_type === 'bank' ? (() => {
                const isRoot = depth === 0;
                const bufferPct = (this.props.globalSettings?.buffer_percentage ?? 0.05);
                const maxSlider = isRoot ? 100 : Math.ceil(node.base_requirement_amount * (1 + bufferPct));
                const maxInput = isRoot ? 999999 : maxSlider;
                const val = node.banked_quantity || 0;
                return `
                <div class="tree-node-bank-qty">
                    <label class="tree-dropdown-label">In bank:</label>
                    <div class="tree-node-bank-slider-row">
                        <input type="range" class="tree-node-bank-slider"
                               data-node-id="${node.node_id}"
                               min="0" max="${maxSlider}" value="${Math.min(val, maxSlider)}">
                        <input type="number" class="tree-node-bank-input"
                               data-node-id="${node.node_id}"
                               min="0" max="${maxInput}" value="${val}">
                    </div>
                </div>`;
            })() : ''}

                ${(node.available_services && node.available_services.length > 1) || (stats.service_name && stats.service_name !== 'No service') ? `<div class="tree-node-service-info">
                    ${this._renderServiceDropdown(node)}
                </div>` : ''}
                ${node.available_locations && node.available_locations.filter(l => l.id !== '__best__').length >= 1 ? `<div class="tree-node-service-info">
                    ${this._renderLocationDropdown(node)}
                </div>` : ''}

                ${node.source_type !== 'bank' && node.source_type !== 'shop' && metrics.steps_per_item != null ? (() => {
                const isActivity = node.source_type === 'activity' || (node.source_type === 'best' && node.underlying_source_type === 'activity');
                const isRecipe = node.source_type === 'recipe' || (node.source_type === 'best' && node.underlying_source_type === 'recipe');
                const isEquipmentOutput = (node.item_id || '').startsWith('Item.');
                return `
                <div class="tree-node-stats">
                    <span class="tree-node-stat"><img src="/assets/icons/attributes/work_efficiency.svg" class="tree-stat-icon" alt=""> WE: ${formatFixed(((stats.WE || 0) * 100), 2, { trim: true })}%</span>
                    <span class="tree-node-stat"><img src="/assets/icons/attributes/double_action.svg" class="tree-stat-icon" alt=""> DA: ${formatFixed(((stats.DA || 0) * 100), 2, { trim: true })}%</span>
                    <span class="tree-node-stat"><img src="/assets/icons/attributes/double_rewards.svg" class="tree-stat-icon" alt=""> DR: ${formatFixed(((stats.DR || 0) * 100), 2, { trim: true })}%</span>
                    ${isRecipe ? `<span class="tree-node-stat"><img src="/assets/icons/attributes/no_materials_consumed.svg" class="tree-stat-icon" alt=""> NMC: ${formatFixed(((stats.NMC || 0) * 100), 2, { trim: true })}%</span>` : ''}
                    ${(isRecipe && isEquipmentOutput) ? `<span class="tree-node-stat"><img src="/assets/icons/attributes/quality_outcome.svg" class="tree-stat-icon" alt=""> QO: +${formatFixed((stats.quality_outcome || 0), 0)}</span>` : ''}
                    ${isActivity ? `<span class="tree-node-stat"><img src="/assets/icons/attributes/fine_material_finding.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> FMF: ${formatFixed(((stats.fine_material_finding || 0) * 100), 2, { trim: true })}%</span>` : ''}
                    ${stats.flat ? `<span class="tree-node-stat"><img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> Steps: ${stats.flat > 0 ? '+' : ''}${stats.flat}</span>` : ''}
                    ${stats.pct ? `<span class="tree-node-stat"><img src="/assets/icons/attributes/steps_required.svg" class="tree-stat-icon" alt="" onerror="this.style.display='none'"> Steps: ${formatFixed(((stats.pct) * 100), 2, { trim: true })}%</span>` : ''}
                </div>`;
            })() : ''}

                ${this._renderLpInsight(metrics.lp_data)}

                ${node.gear_config?.optimized_export || node.source_type !== 'bank' && node.source_type !== 'shop' ? `
                <div class="travel-gearset-stats travel-gearset-stats--row2">
                    <button class="travel-gear-preview-toggle tree-gear-toggle${node.gear_preview_open ? ' open' : ''}" data-node-id="${node.node_id}" title="Show equipped gear">Gear <span class="expand-arrow">▼</span></button>
                    <button class="tree-btn-reset" data-node-id="${node.node_id}" title="Unequip all gear and clear all locks for this node">Reset</button>
                </div>
                <div class="travel-gear-preview tree-gear-preview${node.gear_preview_open ? ' open' : ''}" data-node-id="${node.node_id}" style="display: ${node.gear_preview_open ? 'block' : 'none'}">
                    ${this._renderGearPreview(node.gear_config?.optimized_export || null, node)}
                </div>` : ''}

                ${node.source_type !== 'bank' && node.source_type !== 'shop' ? `
                <div class="tree-node-gearset-actions">
                    <button class="button button-primary tree-btn-optimize" data-node-id="${node.node_id}">Optimize</button>
                    <button class="button tree-btn-select" data-node-id="${node.node_id}" title="Select a saved gearset">Select Existing</button>
                    <button class="button tree-btn-import" data-node-id="${node.node_id}" title="Import gearset from clipboard">Import</button>
                    <button class="button tree-btn-equip" data-node-id="${node.node_id}" title="${node.gear_config?.optimized_export ? 'Load gearset into Column 2' : 'Run Optimize first'}"${node.gear_config?.optimized_export ? '' : ' disabled'}>Equip</button>
                    <button class="button tree-btn-export" data-node-id="${node.node_id}" title="${node.gear_config?.optimized_export ? 'Copy export string to clipboard' : 'Run Optimize first'}"${node.gear_config?.optimized_export ? '' : ' disabled'}>Export</button>
                </div>` : ''}

                ${alts.length > 0 ? `
                <div class="tree-node-alternatives">
                    <details>
                        <summary>${alts.length} alternatives tested</summary>
                        <ul>
                            ${alts.map((alt, i) => `
                                <li class="${i === 0 ? 'selected' : ''}" data-alt-index="${i}" data-node-id="${node.node_id}">
                                    ${alt.label} — ${formatFixed(alt.steps_per_item, 1)} steps/item ${i === 0 ? '✓' : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </details>
                </div>` : ''}

                ${(hasChildren || (this._getDisplayedLeafMaterials().length >= 2)) ? `
                <button class="tree-node-toggle tree-node-children-toggle ${!(collapsed || childrenHidden || hideGhostChild) ? 'expanded' : ''}" data-node-id="${node.node_id}" title="${(collapsed || childrenHidden) ? 'Show children' : 'Hide children'}" ${hideGhostChild ? 'style="display:none;"' : ''}>
                    <span class="expand-arrow ${!(collapsed || childrenHidden) ? 'expanded' : ''}">▼</span>
                    <span class="tree-node-toggle-text">${(collapsed || childrenHidden) ? 'Show children' : 'Hide children'}</span>
                </button>` : ''}

                </div><!-- /tree-node-body -->

                <div class="tree-node-material-options" style="overflow:hidden;${(collapsed || childrenHidden) ? 'display:none;' : ''}">
                    ${this._renderMaterialGroupDropdown()}
                </div>

                ${hasChildren ? `
                <div class="tree-node-children" style="${(collapsed || childrenHidden || hideGhostChild) ? 'display:none;' : ''}">
                    ${children.map(child => `<div class="tree-node-child-container" data-child-id="${child.node_id}"></div>`).join('')}
                </div>
                ` : ''}
            </div>
        `;
        this.$element.html(html);

        // Defensive post-render: reconcile the header-arrow's '.expanded'
        // state with the same `collapsed` variable we used to render the
        // header/body/arrow in the first place. Reading the `.collapsed`
        // class on the header is more reliable than $body.css('display'),
        // which can transiently report 'block' during a slideUp animation
        // in flight and cause the arrow to point the wrong way on first
        // render. Scoped to the card we JUST rendered (direct child) so
        // we don't stomp on descendant cards mid-animation.
        try {
            const $card = this.$element.children('.tree-node-card').first();
            if ($card.length) {
                const $header = $card.children('.tree-node-header');
                const $arrow = $header.children('.tree-node-header-arrow');
                if ($arrow.length) {
                    const isCollapsed = $header.hasClass('collapsed');
                    $arrow.toggleClass('expanded', !isCollapsed);
                }
            }
        } catch (err) { /* non-fatal */ }

        // Render child components
        this.childComponents.forEach(c => c.destroy());
        this.childComponents = [];
        children.forEach(child => {
            const container = this.$element.find(`[data-child-id="${child.node_id}"]`);
            if (container.length) {
                const childCard = new TreeNodeCard(container[0], {
                    ...this.props,
                    node: child,
                    depth: depth + 1,
                });
                this.childComponents.push(childCard);
            }
        });

        // Instantiate full LocationDropdown for no-service recipe nodes.
        // Uses the same component as recipe-info-section for consistency.
        // The data-node-id selector already scopes to this node's container;
        // we used to also filter by closest('.tree-node-card') === this.$element
        // but that filter was wrong — this.$element is the outer wrapper and
        // the rendered .tree-node-card is a child of it, so the filter always
        // excluded the real container and the dropdown never got instantiated
        // (visible in the UI as a bare 📍 pin with no dropdown).
        const thisNodeId = node.node_id;
        const $directContainer = this.$element
            .find(`.tree-node-full-location-dropdown[data-node-id="${thisNodeId}"]`)
            .first();
        if ($directContainer.length) {
            this._wireFullLocationDropdown($directContainer.get(0), node);
        }

        return html;
    }

    /**
     * Instantiate the full LocationDropdown component (with search + region grouping)
     * into the given container. Used for no-service recipe nodes that can use any
     * region for gear optimization.
     */
    async _wireFullLocationDropdown(container, node) {
        try {
            const LocationDropdown = (await import('./location-dropdown.js')).default;
            // Destroy previous instance if present
            if (this._locationDropdown) {
                this._locationDropdown.destroy();
                this._locationDropdown = null;
            }
            // Read flat-mode + allowlist from the container's data-* attrs
            // (set by _renderLocationDropdown). Activity nodes with 2-10
            // valid locations get a flat list scoped to those locations;
            // no-service recipe nodes get the full region-grouped list.
            const flat = container.getAttribute('data-flat') === '1';
            const allowedAttr = container.getAttribute('data-allowed-names') || '';
            const allowedLocationNames = (flat && allowedAttr)
                ? allowedAttr.split('|').filter(Boolean)
                : null;
            // Read selected from the node (source of truth), not from data attr.
            // Normalize to lowercase_underscore format for LocationDropdown's id.
            //
            // Distinguish user-picked vs worker-auto-resolved: the worker saves
            // its "best location" into node.selected_location_id AND into
            // node.last_auto_resolved_location. If the two match, the current
            // state came from auto-optimization and we display it as "Best → X"
            // (selectedLocation: null + bestResolvedName: X). If they differ
            // (user has since picked a specific location), show the user's pick.
            const sel = node.selected_location_id || null;
            const autoResolved = node.last_auto_resolved_location || null;
            const isAutoResolved = !!(sel && autoResolved && sel === autoResolved);
            const stats = node.metrics?.stats_used || {};
            const selectedForDropdown = (sel && !isAutoResolved)
                ? String(sel).toLowerCase().replace(/\s+/g, '_').replace(/'/g, '')
                : null;
            // `bestResolvedName` drives the "Best → X" label that shows when
            // the user has NOT explicitly picked a location — i.e. the
            // auto-resolved case, or the pre-pick case where the optimizer
            // has no computed location yet. When the user has an explicit
            // pick (selectedForDropdown set), we must NOT set this — otherwise
            // a brief lookup miss in getSelectedLocation() (locations not
            // loaded yet, id normalization mismatch, etc.) silently falls
            // back to showing "Best → <user's pick>" which is wrong. The
            // user's pick should render with no "Best" prefix.
            let bestLocationName = null;
            if (isAutoResolved) {
                bestLocationName = sel;
            } else if (!selectedForDropdown) {
                bestLocationName = stats.location || null;
            }
            console.log('[CT-LOC] wire start', {
                nodeId: node.node_id,
                itemId: node.item_id,
                source_type: node.source_type,
                sel,
                autoResolved,
                isAutoResolved,
                'stats.location': stats.location,
                bestLocationName,
                selectedForDropdown,
                locations_cache_warm: !!(window._LOCATIONS_CACHE_HAS_DATA),
            });
            const self = this;
            this._locationDropdown = new LocationDropdown(container, {
                label: 'Location',  // Shows a small 'Location' header above
                                    // the dropdown (matches the pattern used
                                    // by the service row in recipe-info).
                noneLabel: 'Best (auto)',
                bestResolvedName: bestLocationName,
                selectedLocation: selectedForDropdown,
                flat: flat,
                allowedLocationNames: allowedLocationNames,
                onSelect: (loc) => {
                    console.log('[LOC-FLICKER] tree-node-card onSelect fired', { nodeId: node.node_id, newLocName: loc ? loc.name : null });
                    // loc is the full location object (with id, name, regions) or null.
                    // Store the pretty name on the node (what the backend expects).
                    // Read live node via self.props.node — same closure-staleness
                    // fix that bca463cd applied to the simple service/location
                    // dropdowns. Without this, location picks made after a
                    // partial render mutate an orphan node that's not in
                    // self.treeNodes, so the next recalc fires with the OLD
                    // location and the user's pick is silently dropped.
                    const liveNode = (self.props && self.props.node) || node;
                    const newId = loc ? loc.name : null;
                    liveNode.selected_location_id = newId;
                    // User explicitly picked something (or picked Best/cleared),
                    // so drop the auto-resolved marker — the next render should
                    // treat this as a user pick (or no selection) rather than an
                    // auto-resolved one. The next optimization will re-populate
                    // last_auto_resolved_location if they hit Optimize again.
                    liveNode.last_auto_resolved_location = null;
                    // User spec 2026-05-15/16: KEEP the optimized gearset
                    // across location changes. Same logic as on_source_change
                    // (Python, fixed in bca463cd) — clearing optimized_export
                    // here was the root cause of "(changing location for
                    // crafting non-service) deletes the gear (on reload) and
                    // shows 0% stats + 25% WE (level bonus only)". The next
                    // calculate pass re-decodes the export and re-applies
                    // the gear stats against the new location context.
                    // Drop optimized_stats so the cached pre-location values
                    // don't leak through; force a fresh re-decode.
                    if (liveNode.gear_config) {
                        liveNode.gear_config.optimized_stats = null;
                    }
                    if (self.props.onRecalculate) {
                        console.log('[LOC-FLICKER] tree-node-card calling onRecalculate({ preserveUI: true })');
                        // preserveUI: true keeps the LocationDropdown instance
                        // alive across the recalc so the card doesn't flicker
                        // ("disappear and reappear") when the user picks a
                        // location. The view updates only the summary
                        // dashboard; per-node metrics are mutated in place
                        // on the existing node objects.
                        self.props.onRecalculate({ preserveUI: true });
                    } else {
                        console.warn('[LOC-FLICKER] tree-node-card: no onRecalculate prop — cannot request preserveUI');
                    }
                },
            });
        } catch (err) {
            console.error('Failed to load LocationDropdown for tree node:', err);
        }
    }

    attachEvents() {
        const self = this;
        const { node } = this.props;
        if (!node) return;

        // Custom dropdown toggle (source and material)
        this.$element.on('click', '.tree-dropdown-button', function (e) {
            e.stopPropagation();
            const $dropdown = $(this).closest('.tree-dropdown');
            const $panel = $dropdown.find('.tree-dropdown-panel');
            const $arrow = $dropdown.find('.expand-arrow');
            const type = $dropdown.data('dropdown');

            // Close other dropdowns in this card first. Scope to dropdown
            // toggle arrows only — otherwise we'd strip .expanded from the
            // header arrow, children toggle, and gear toggle, which have
            // nothing to do with dropdown state.
            self.$element.find('.tree-dropdown-panel:visible').not($panel).slideUp(150);
            self.$element.find('.tree-dropdown-toggle .expand-arrow.expanded').not($arrow).removeClass('expanded');

            if ($panel.is(':visible')) {
                $arrow.removeClass('expanded');
                $panel.slideUp(150, function () {
                    $dropdown.removeClass('tree-dropdown--up');
                });
            } else {
                $arrow.addClass('expanded');
                // Check if there's enough space below to open downward
                // Use the overlay scroll container, not window
                const btnRect = $dropdown[0].getBoundingClientRect();
                const overlay = $dropdown[0].closest('.crafting-tree-overlay');
                const viewportBottom = overlay ? overlay.getBoundingClientRect().bottom : window.innerHeight;
                const spaceBelow = viewportBottom - btnRect.bottom;
                const panelHeight = Math.min(250, 200); // max-height of panel
                if (spaceBelow < panelHeight && btnRect.top > panelHeight + 50) {
                    $dropdown.addClass('tree-dropdown--up');
                } else {
                    $dropdown.removeClass('tree-dropdown--up');
                }
                $panel.slideDown(200, function () {
                    // Auto-focus the search input (if present) so the user
                    // can type immediately on open. Only the active panel
                    // gets focused — sibling panels were slid up above.
                    const $search = $panel.find('.tree-dropdown-search');
                    if ($search.length) {
                        $search.val('').trigger('input').focus();
                    }
                });
            }
        });

        // Search input within a tree-dropdown panel: filter items by
        // case-insensitive substring match on visible item text. Scoped
        // to the panel containing the input so source/service/location
        // dropdowns each filter independently. Stops propagation so
        // typing in the box doesn't bubble to row-level handlers.
        this.$element.on('input', '.tree-dropdown-search', function (e) {
            e.stopPropagation();
            const q = String($(this).val() || '').trim().toLowerCase();
            const $panel = $(this).closest('.tree-dropdown-panel');
            $panel.find('.tree-dropdown-item').each(function () {
                if (!q) {
                    $(this).show();
                    return;
                }
                const text = $(this).text().toLowerCase();
                $(this).toggle(text.indexOf(q) !== -1);
            });
        });

        // Clicks/keystrokes on the search input must NOT close the panel
        // or trigger row selection. The dropdown-button toggle relies on
        // bubbling, so explicitly stopPropagation on the input itself.
        this.$element.on('click keydown', '.tree-dropdown-search', function (e) {
            e.stopPropagation();
        });

        // Source dropdown item click
        this.$element.on('click', '[data-dropdown="source"] .tree-dropdown-item', function (e) {
            e.stopPropagation();
            const idx = parseInt($(this).data('source-index'));
            const source = (node.available_sources || [])[idx];

            // Close dropdown
            $(this).closest('.tree-dropdown').find('.tree-dropdown-panel').slideUp(150);
            $(this).closest('.tree-dropdown').find('.expand-arrow').removeClass('expanded');

            if (source && self.props.onSourceChange) {
                self.props.onSourceChange(node.node_id, source);
            }
        });

        // Material Options chip click — calls onSourceChange with
        // preview_mode=true so backend rebuilds the parent's subtree
        // with the chosen recipe + material group. Backend marks the
        // resulting CHILD nodes with _mo_preview_chip + parent_recipe_label
        // so each preview child renders "(preview) <commit-link>" in
        // its title. The PARENT card itself stays visually unchanged
        // (chips remain visible, source dropdown unchanged in spirit
        // even though source data is the new recipe — frontend hides
        // that until commit). Click ACTIVE chip = revert to Best
        // (clears the children). Click DIFFERENT chip = swap to that
        // recipe+group, children re-render with new preview.
        this.$element.on('click', '.tree-material-group-button', function (e) {
            e.stopPropagation();
            const $btn = $(this);
            const $card = $btn.closest('.tree-node-card');
            const nodeId = $card.data('node-id');
            // Pull the LATEST node from props so we see post-rebuild
            // state. Closure-captured `node` would be stale after a
            // partial re-render (parentCard.props.node reassigned
            // mid-flight) and chip-active detection would fail —
            // making click-active-to-revert a no-op. Issue surfaced
            // during testing 2026-05-15.
            const liveNode = (self.props && self.props.node) || node;
            if (!nodeId || nodeId !== liveNode.node_id) return;

            const srcId = String($btn.data('source-id') || '');
            const srcType = $btn.data('source-type');
            const mgiRaw = $btn.data('material-group-index');
            const mgi = (mgiRaw === '' || mgiRaw == null) ? null : parseInt(mgiRaw, 10);
            const chipKey = `${srcId}::${mgi == null ? 0 : mgi}`;

            // Click on already-active chip = revert to Best(auto)
            if (liveNode._mo_preview_chip === chipKey) {
                const bestSource = (liveNode.available_sources || []).find(
                    s => s && s.type === 'best'
                );
                if (bestSource && self.props.onSourceChange) {
                    self.props.onSourceChange(nodeId, bestSource, { preview_mode: false, _from_chip_revert: true });
                }
                return;
            }

            // Click new chip — pick the right available_sources entry
            // (matching source_id + material_group_index for multi-mgi
            // expanded entries; falling back to any matching source_id
            // when expansion is single).
            const source = (liveNode.available_sources || []).find(s => {
                if (!s || s.type !== srcType) return false;
                if (String(s.source_id || '') !== srcId) return false;
                if (s.material_group_index != null && mgi != null) {
                    if (s.material_group_index !== mgi) return false;
                }
                return true;
            });
            if (!source || !self.props.onSourceChange) {
                console.warn('Material Options click: no matching source', { srcType, srcId, mgi });
                return;
            }
            const opts = { preview_mode: true, _chip_key: chipKey };
            if (mgi != null) opts.material_group_index = mgi;
            self.props.onSourceChange(nodeId, source, opts);
        });

        // Preview commit link click — fired from the CHILD node's title
        // (where `(preview)` + recipe-name link render). Clears the
        // _mo_preview_chip flag on the child(ren) so the (preview)
        // tag goes away — source already reflects the chosen recipe,
        // so no further backend call is needed. The parent's chips
        // are no longer shown after commit because the parent's
        // source is now a concrete recipe (not Best).
        this.$element.on('click', '.tree-mo-commit-link', function (e) {
            e.stopPropagation();
            e.preventDefault();
            const $link = $(this);
            const liveNode = (self.props && self.props.node) || node;
            const targetNodeId = $link.data('node-id') || liveNode.node_id;
            if (self.props.onMaterialPreviewCommit) {
                self.props.onMaterialPreviewCommit(targetNodeId);
            }
        });

        // Service dropdown item click — override selected service
        this.$element.on('click', '[data-dropdown="service"] .tree-dropdown-item', function (e) {
            e.stopPropagation();
            const svcId = $(this).data('service-id');

            $(this).closest('.tree-dropdown').find('.tree-dropdown-panel').slideUp(150);
            $(this).closest('.tree-dropdown').find('.expand-arrow').removeClass('expanded');

            // Update node and trigger recalculate. Read node from
            // self.props.node (LIVE) instead of the closure-captured
            // `node` reference — the latter goes stale after a
            // partial re-render (parentCard.props.node reassigned
            // mid-flight), so mutating it would update an orphan
            // object that's no longer in this.treeNodes. User-reported
            // 2026-05-15: "if I change service, nothing updates for
            // steps or stats" — root cause was the stale closure.
            const liveNode = (self.props && self.props.node) || node;
            liveNode.selected_service_id = svcId === '__best__' ? null : svcId;
            // Drop the cached optimized_stats so the new service's location
            // context is honored on recalc. Mirrors the location-dropdown
            // handler (and the source-change path in crafting_tree.py).
            // Without this, _get_gear_stats short-circuits to the stale
            // optimized_stats that were computed at the PREVIOUS service's
            // location — bug 613a1e83: switching between the Cursed Loom
            // (Wraithwater, ghostly) and Marked Textiles (Myriadian Arc,
            // non-ghostly) never changed the displayed DR, because the
            // Spectral needle's +2.5% ghostly double_rewards stayed baked
            // into the cached stats regardless of the selected loom.
            if (liveNode.gear_config) {
                liveNode.gear_config.optimized_stats = null;
            }
            if (self.props.onRecalculate) {
                self.props.onRecalculate();
            }
        });

        // Location dropdown item click — override selected location
        this.$element.on('click', '[data-dropdown="location"] .tree-dropdown-item', function (e) {
            e.stopPropagation();
            const locId = $(this).data('location-id');

            $(this).closest('.tree-dropdown').find('.tree-dropdown-panel').slideUp(150);
            $(this).closest('.tree-dropdown').find('.expand-arrow').removeClass('expanded');

            // Same closure-staleness fix as the service dropdown
            // above — write to self.props.node so the change lands
            // on the live tree state.
            const liveNode = (self.props && self.props.node) || node;
            liveNode.selected_location_id = locId === '__best__' ? null : locId;
            if (self.props.onRecalculate) {
                self.props.onRecalculate();
            }
        });

        // Close dropdowns when clicking outside. Scope the arrow reset to
        // dropdown toggle arrows only — the previous selector
        // ('.expand-arrow.expanded') also matched the header arrow, children
        // toggle arrow, and gear toggle arrow, which caused the header arrow
        // to get stripped of .expanded on unrelated document clicks (e.g.
        // after scrollToNode from the overview click).
        $(document).on('click.treenode-' + node.node_id, function () {
            self.$element.find('.tree-dropdown-panel:visible').slideUp(150);
            self.$element.find('.tree-dropdown-toggle .expand-arrow.expanded').removeClass('expanded');
            self.$element.find('.tree-dropdown--up').removeClass('tree-dropdown--up');
        });

        // Gear preview toggle — collapsible like travel gearset.
        // Uses jQuery slideToggle (matches the working slide pattern in
        // location-dropdown.js / craftingpoll.js): height + padding +
        // margin animate together natively, so collapsing no longer
        // jumps the padding to 0 before the slide. Open state is
        // persisted on node.gear_preview_open so subsequent re-renders
        // (e.g. after Optimize completes via rerenderAll) keep the
        // preview open instead of resetting to closed — user-asked:
        // "When I optimize when my gear preview is pulled up, don't
        //  close it. Keep it open."
        // Reset button — wipes the node's optimizer pick AND every
        // user pin (locked_slots + user_input_items + lock_warning).
        // The view layer handles persistence + surgical DOM updates
        // so we don't full-re-render the card (which would tear down
        // the open slot popup).
        this.$element.on('click', '.tree-btn-reset', function (e) {
            e.stopPropagation();
            const nodeId = $(this).data('node-id');
            if (!nodeId) return;
            if (typeof self.props.onTreeNodeReset === 'function') {
                self.props.onTreeNodeReset(nodeId);
            }
        });
        this.$element.on('click', '.tree-gear-toggle', function (e) {
            e.stopPropagation();
            const $btn = $(this);
            const nodeId = $btn.data('node-id');
            const $preview = self.$element.find(`.tree-gear-preview[data-node-id="${nodeId}"]`);
            // Resolve the live node so we mutate the actual tree state
            // (props.allNodes) — the closure-captured `node` may be
            // stale after in-place metric updates.
            const targetNode = self.props.allNodes?.find(n => n.node_id === nodeId) || node;
            const willOpen = !$btn.hasClass('open');
            $btn.toggleClass('open', willOpen);
            $preview.toggleClass('open', willOpen);
            if (willOpen) {
                $preview.stop(true, true).slideDown(220);
            } else {
                $preview.stop(true, true).slideUp(220);
            }
            if (targetNode) {
                targetNode.gear_preview_open = willOpen;
                if (typeof self.props.onTreePreviewToggle === 'function') {
                    self.props.onTreePreviewToggle(nodeId, willOpen);
                }
            }
        });

        // Bank quantity change — sync slider and input
        this.$element.on('input', '.tree-node-bank-slider', function () {
            const val = parseInt($(this).val()) || 0;
            $(this).siblings('.tree-node-bank-input').val(val);
            if (self.props.onBankQtyChange) {
                self.props.onBankQtyChange(node.node_id, val);
            }
        });

        this.$element.on('change', '.tree-node-bank-input', function () {
            const max = parseInt($(this).attr('max')) || 999999;
            let val = parseInt($(this).val()) || 0;
            val = Math.max(0, Math.min(val, max));
            $(this).val(val);
            const $slider = $(this).siblings('.tree-node-bank-slider');
            const sliderMax = parseInt($slider.attr('max')) || 100;
            $slider.val(Math.min(val, sliderMax));
            if (self.props.onBankQtyChange) {
                self.props.onBankQtyChange(node.node_id, val);
            }
        });

        // Optimize button — use event delegation from document level
        // Only attach once (from root card, depth 0) to avoid duplicate handlers
        if (!this.props.depth || this.props.depth === 0) {
            $(document).off('click.tree-optimize');
            $(document).on('click.tree-optimize', '.tree-btn-optimize', function (e) {
                e.stopPropagation();
                const nodeId = $(this).data('node-id');
                console.log('Optimize button clicked for node:', nodeId);
                if (self.props.onOptimize) {
                    self.props.onOptimize(nodeId);
                }
            });
        }

        // Toggle expand/collapse by clicking the header. Arrow on the left
        // rotates, the body div (gear/stats/etc.) and the children block both
        // hide/show together. Ignore clicks on interactive descendants of the
        // header (dropdowns, buttons) so they keep working independently.
        this.$element.on('click', '.tree-node-header-clickable', function (e) {
            // If the click originated on a dropdown / input / button inside
            // the header, don't toggle.
            if ($(e.target).closest('a, button, input, .tree-dropdown, .tree-node-header-arrow').length
                && !$(e.target).hasClass('tree-node-header-arrow')) {
                return;
            }
            e.stopPropagation();
            self._toggleCollapse($(this).closest('.tree-node-card'));
        });

        // Side-edge clickable strip (the colored left border) — acts as a
        // second affordance for whole-card collapse, handy when the header
        // is far away on tall cards. Uses the same _toggleCollapse path,
        // which handles scroll-into-view when collapsing a card that
        // extends above the viewport.
        this.$element.on('click', '.tree-node-side-collapse', function (e) {
            e.stopPropagation();
            self._toggleCollapse($(this).closest('.tree-node-card'));
        });

        // Skipped-by-Solver insight → click jumps to the node whose byproducts
        // fulfilled this demand (first match by item_id).
        this.$element.on('click', '.tree-node-lp-insight-clickable', function (e) {
            e.stopPropagation();
            const targetId = $(this).data('lp-jump-node-id');
            if (targetId && self.props.onNavigateToNode) {
                self.props.onNavigateToNode(targetId);
            }
        });
        this.$element.on('keydown', '.tree-node-lp-insight-clickable', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });

        // 'Hide children' / 'Show children' button — hides children subtree
        // AND the material-options button row (since those describe the
        // subtree too), but keeps the node body visible. Clicking the header
        // still collapses everything via _toggleCollapse above.
        this.$element.on('click', '.tree-node-children-toggle', function (e) {
            e.stopPropagation();
            self._toggleChildrenHidden($(this).closest('.tree-node-card'));
        });

        // Keyboard support: Enter/Space on focused header toggles too.
        this.$element.on('keydown', '.tree-node-header-clickable', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });

        // Alternative selection
        this.$element.on('click', '.tree-node-alternatives li', function () {
            const altIndex = $(this).data('alt-index');
            const nodeId = $(this).data('node-id');
            if (self.props.onAlternativeSelect) {
                self.props.onAlternativeSelect(nodeId, altIndex);
            }
        });

        // Equip button — load gearset into Column 2
        this.$element.on('click', '.tree-btn-equip', function (e) {
            e.stopPropagation();
            // Disabled state: render with the disabled attribute, but the
            // browser still bubbles click events. Bail when no gearset.
            if ($(this).is('[disabled]')) return;
            const nodeId = $(this).data('node-id');
            if (self.props.onEquip) {
                self.props.onEquip(nodeId);
            }
        });

        // Tree-node slot click — open the existing slot popup with a
        // tree-node context. The popup reads ItemSelectionPopup.show(slot,
        // options); when options.treeNodeContext is present the popup uses
        // the node's gearset/alternatives instead of the live character.
        // Falls back to opening with no context if the popup component
        // hasn't loaded (e.g. during page boot).
        this.$element.on('click', '.tree-gear-mini-slot', function (e) {
            e.stopPropagation();
            const $tileTop = $(this);
            const isInputSlot = $tileTop.hasClass('tree-gear-mini-slot--input');
            // Click on the orange lock badge inside the slot = unlock,
            // NOT open-popup. Check this before any other slot logic so
            // the badge acts as a quick-unlock affordance — matches the
            // user expectation: "click the lock, lock disappears." The
            // tile icon stays as the previously-locked item (the
            // optimizer's pick won't change until the next Optimize
            // run); the badge disappearing is the visible signal that
            // the constraint is gone, and the recalc below refreshes
            // step counts.
            if ($(e.target).closest('.tree-gear-mini-lock').length) {
                const $tile = $tileTop;
                const treeNodeId = $tile.data('tree-node-id');
                if (!treeNodeId) return;
                if (isInputSlot) {
                    // Input slots don't live in locked_slots — they're
                    // pinned via gear_config.user_input_items[idx].
                    // Unlock = drop the user pin so the next optimize
                    // falls back to the auto-pick.
                    const idx = $tile.data('input-idx');
                    if (typeof self.props.onTreeNodeInputChange === 'function' && idx !== undefined) {
                        self.props.onTreeNodeInputChange(treeNodeId, parseInt(idx), {
                            type: 'unlock',
                        });
                    }
                    return;
                }
                const slot = $tile.data('slot');
                if (!slot) return;
                const targetNode = self.props.allNodes?.find(n => n.node_id === treeNodeId) || node;
                const newLocks = { ...(targetNode?.locked_slots || {}) };
                delete newLocks[slot];
                if (typeof self.props.onTreeNodeSlotChange === 'function') {
                    // Same channel the popup uses for lock toggles —
                    // the view-layer handler commits node.locked_slots,
                    // surgically removes the badge, and triggers
                    // _calculateOnly(preserveUI) to refresh step counts.
                    self.props.onTreeNodeSlotChange(treeNodeId, slot, {
                        type: 'lock',
                        slot,
                        itemId: null,
                        locked: false,
                        lockedSlots: newLocks,
                    });
                }
                return;
            }
            // Defensive: level-locked tool slots are rendered with no
            // pointer cursor and a different class, but stop the click
            // here too so the popup never opens for them.
            if ($(this).attr('data-disabled') === '1') return;
            // Input slot click → open popup with keyword filter so the
            // user can pick e.g. an arrow type. Matches column-3's
            // activity-info-section behavior (see
            // ui/static/js/components/activity-info-section.js
            // around the .input-item-slot click handler).
            if (isInputSlot) {
                const treeNodeId = $tileTop.data('tree-node-id');
                const idx = $tileTop.data('input-idx');
                const keyword = $tileTop.data('input-keyword');
                const level = parseInt($tileTop.data('input-level')) || 0;
                const inputName = $tileTop.data('input-name') || keyword || 'input';
                if (!treeNodeId || idx === undefined) return;
                if (window.itemSelectionPopup && typeof window.itemSelectionPopup.show === 'function') {
                    window.itemSelectionPopup.show('input', {
                        filterKeyword: keyword,
                        filterLevel: level,
                        onSelect: (item) => {
                            if (typeof self.props.onTreeNodeInputChange === 'function') {
                                // Pack just the fields the backend
                                // resolver needs (matches the shape
                                // _auto_pick_input_items_for_activity
                                // emits in app.py — see
                                // ui/app.py::_auto_pick_input_items_for_activity).
                                self.props.onTreeNodeInputChange(treeNodeId, parseInt(idx), {
                                    type: 'pick',
                                    item: {
                                        itemId: item.itemId || item.id || null,
                                        uuid: item.uuid || null,
                                        name: item.name,
                                        icon_path: item.icon_path,
                                        rarity: item.rarity,
                                        quality: item.quality,
                                        is_fine: !!item.is_fine,
                                        is_generic: !!item.is_generic,
                                        export_name: item.export_name || null,
                                        keywords: item.keywords || [],
                                        input_type: 'keyword',
                                        input_reference: keyword,
                                    },
                                });
                            }
                        },
                        onUnequip: () => {
                            if (typeof self.props.onTreeNodeInputChange === 'function') {
                                self.props.onTreeNodeInputChange(treeNodeId, parseInt(idx), {
                                    type: 'unlock',
                                });
                            }
                        },
                    });
                }
                return;
            }
            const slot = $(this).data('slot');
            const treeNodeId = $(this).data('tree-node-id');
            if (!slot || !treeNodeId) return;
            // Resolve the live node object — props.allNodes is the
            // up-to-date tree state owned by the view; node from the
            // closure is captured at render time and may be stale after
            // an in-place metric update.
            const targetNode = self.props.allNodes?.find(n => n.node_id === treeNodeId) || node;
            const gearConfig = targetNode?.gear_config || {};
            const alts = gearConfig.slot_alternatives || {};
            // Decode the equipped gearset once for the popup so it can
            // surface the currently-equipped item without re-decoding.
            const equippedSlots = gearConfig.optimized_export
                ? (self._decodeGearsetSlots(gearConfig.optimized_export) || {})
                : {};
            // Pet + consumable aren't carried by the gearset export string
            // (encode_gearset only serializes gear/tools/rings; the Gearset
            // class has no _pet/_consumable attrs). The optimizer's pick
            // lives on gear_config.optimized_pet / .optimized_consumable.
            // Without merging those here, the popup's "currently equipped"
            // panel falls through to "No item equipped" even though the
            // tile shows the optimizer's pick — bug 3bb938f4 second
            // follow-up: "clicking on them has the popup saying 'no item
            // equipped'". Mirrors the effectiveOverlay merge in
            // _renderGearPreview.
            if (gearConfig.optimized_pet && !equippedSlots.pet) {
                equippedSlots.pet = {
                    ...gearConfig.optimized_pet,
                    type: 'pet',
                };
            }
            if (gearConfig.optimized_consumable && !equippedSlots.consumable) {
                equippedSlots.consumable = {
                    ...gearConfig.optimized_consumable,
                    type: 'consumable',
                };
            }
            // Derive the skill of this node so the popup can filter
            // pets/consumables by relevance. For recipes the underlying
            // source's icon path is "/assets/icons/text/skill_icons/<skill>.svg";
            // for activities it's "/assets/icons/activities/<skill>/...".
            // Both formats reliably contain the skill as a path segment.
            // Fallback: take the first key of node.metrics.xp (each node
            // primarily earns one skill's XP from its own work). Without
            // this, the popup loaded ALL 140 consumables / all owned pets
            // unfiltered, making it hard for the user to find a relevant
            // pick. Bug 9ce474f8 (darkbow): "Pets and consumables in tree
            // opt don't seem to match the skill when I press to manually
            // equip them?"
            let _treeNodeSkill = null;
            try {
                const _underlyingType = targetNode?.underlying_source_type
                    || targetNode?.source_type;
                const _underlyingId = targetNode?.underlying_source_id
                    || targetNode?.source_id;
                const _src = (targetNode?.available_sources || []).find(s =>
                    s.type === _underlyingType && (s.source_id || '') === (_underlyingId || '')
                );
                const _icon = _src?.icon || '';
                const _recipeMatch = _icon.match(/skill_icons\/([^/.]+)\.svg/);
                const _activityMatch = _icon.match(/activities\/([^/]+)\//);
                if (_recipeMatch) _treeNodeSkill = _recipeMatch[1].toLowerCase();
                else if (_activityMatch) _treeNodeSkill = _activityMatch[1].toLowerCase();
                else {
                    // Fallback: primary XP-earning skill of the node itself
                    // (excludes XP from sub-recipes / parent contributions).
                    const _xp = targetNode?.metrics?.xp || {};
                    const _xpKeys = Object.keys(_xp);
                    if (_xpKeys.length > 0) _treeNodeSkill = _xpKeys[0].toLowerCase();
                }
            } catch (_e) { /* leave _treeNodeSkill = null on any error */ }
            const _treeNodeSourceType = targetNode?.underlying_source_type
                || targetNode?.source_type
                || null;
            if (window.itemSelectionPopup && typeof window.itemSelectionPopup.show === 'function') {
                window.itemSelectionPopup.show(slot, {
                    treeNodeContext: {
                        nodeId: treeNodeId,
                        equippedSlots,
                        alternatives: alts.alternatives || {},
                        lockedAlternatives: alts.locked_alternatives || {},
                        lockedSlots: targetNode?.locked_slots || {},
                        // Skill of the underlying recipe/activity. Lets the
                        // applicable-stat filter scope to skill-relevant items
                        // (instead of falling back to the unrelated CSS context
                        // or showing every owned pet/consumable). Bug 9ce474f8.
                        skill: _treeNodeSkill,
                        sourceType: _treeNodeSourceType,
                        // The tree node's effective location (worker-resolved
                        // or user-pinned) so location-scoped stats also match
                        // when relevant. Falls back to null if the node has
                        // no resolved location yet — global-only stats still
                        // match in that case.
                        location: targetNode?.selected_location_id
                            || targetNode?.last_auto_resolved_location
                            || (targetNode?.metrics?.stats_used?.location)
                            || null,
                        // Step-count metric to display next to non-owned
                        // items: 'total steps for this node if I locked
                        // this item' (precomputed by the optimizer in
                        // alternatives[slot][...]).
                        metric: 'total_steps',
                        // Callback when the user picks an item or toggles
                        // a lock — view layer handles the recalc + tree
                        // propagation. preserveUI keeps the card in place.
                        onSelect: (payload) => {
                            if (self.props.onTreeNodeSlotChange) {
                                self.props.onTreeNodeSlotChange(treeNodeId, slot, payload);
                            }
                        },
                    },
                });
            } else {
                console.warn('[tree-node] itemSelectionPopup not available — slot click did nothing');
            }
        });

        // Select button — pick a saved gearset using the travel gearset picker
        this.$element.on('click', '.tree-btn-select', function (e) {
            e.stopPropagation();
            const nodeId = $(this).data('node-id');
            const targetNode = self.props.allNodes?.find(n => n.node_id === nodeId) || node;
            import('../travel-gearset-picker.js').then(({ showGearsetPicker }) => {
                showGearsetPicker(this, (gs) => {
                    if (!gs) return;
                    // Two saved-gearset shapes coexist in store.state.gearsets.saved:
                    //   - optimized gearsets carry { name, slots, export_string, is_optimized }
                    //   - regular saved gearsets carry { name, slots } only (no export_string)
                    // Bonez565 bug 424b34f7 (2026-05-17): "'Select existing' shows
                    // list of gear sets but picking one does nothing." Root cause
                    // was the old callback gated all behavior on `gs.export_string`
                    // — so picking a regular saved gearset was a silent no-op.
                    // Now we handle both shapes: optimized → set optimized_export
                    // AND auto-lock decoded slots; regular → just auto-lock the
                    // slots directly. Auto-lock mirrors the import flow's intent
                    // ("the user explicitly picked THIS gear, respect it").
                    let pinnedSlots = null;
                    if (gs.export_string) {
                        targetNode.gear_config.optimized_export = gs.export_string;
                        targetNode.gear_config.optimized_stats = null;
                        pinnedSlots = self._decodeGearsetSlots(gs.export_string) || {};
                    } else if (gs.slots) {
                        // Strip metadata keys (those starting with '_' like
                        // _alternatives / _locked_alternatives) and any
                        // empty/invalid slot entries — the same shape rules
                        // loadGearSet uses for non-optimized gearsets in
                        // state.js. Don't wipe optimized_export here; the
                        // optimizer will respect the new locks and produce
                        // a fresh export on the next recalc.
                        pinnedSlots = {};
                        for (const [slotName, item] of Object.entries(gs.slots)) {
                            if (slotName.startsWith('_')) continue;
                            if (!item || !item.itemId) continue;
                            pinnedSlots[slotName] = item;
                        }
                        targetNode.gear_config.optimized_stats = null;
                    }
                    // Fail-safe: with the picker now lazy-fetching the full
                    // payload, export_string/slots should be populated. If BOTH
                    // are still empty (lazy-fetch failed, or a corrupt saved
                    // gearset), surface an error instead of silently doing
                    // nothing — the user reported "Select Existing has stopped
                    // working", which was exactly this silent no-op path.
                    if (!pinnedSlots || Object.keys(pinnedSlots).length === 0) {
                        if (window.api) window.api.showError(`Couldn't load gear set "${gs.name || 'Unnamed'}" — please try again.`);
                        return;
                    }
                    // Auto-lock every populated slot, same as import. Empty
                    // slots stay unlocked so the optimizer can fill them.
                    const locks = {};
                    for (const [slotName, item] of Object.entries(pinnedSlots)) {
                        if (!item || !item.itemId) continue;
                        locks[slotName] = item;
                    }
                    targetNode.locked_slots = locks;
                    if (self.props.onRecalculate) self.props.onRecalculate();
                    if (window.api) window.api.showSuccess(`Applied "${gs.name || 'Unnamed'}"`);
                });
            });
        });

        // Import button — import gearset from clipboard
        this.$element.on('click', '.tree-btn-import', async function (e) {
            e.stopPropagation();
            const nodeId = $(this).data('node-id');
            const targetNode = self.props.allNodes?.find(n => n.node_id === nodeId) || node;
            // Apply the imported gearset string and clear stale stats so the
            // recalc path re-aggregates from the new gear. Then hand off to
            // the parent view so it can run _calculateOnly(preserveUI:true)
            // — the same surgical recalc the gear-lock change uses. Calling
            // self.render() + self.attachEvents() here was wrong: it
            // rebuilds the card's HTML but doesn't re-instantiate the
            // LocationDropdown / ServiceDropdown / RecipeSourceDropdown
            // subcomponents, so the new dropdown DOM has no event handlers
            // — clicking it opens then immediately collapses (the
            // document-level outside-click handler fires on the un-wired
            // new element). It also leaves node.metrics stale, so the
            // stats panel at the bottom kept showing pre-import numbers.
            // Bug 233c9cd0 (darkbow): "the dropdowns (gear and service for
            // example) don't work any more. They open and collapse instantly.
            // Additionally, the stats at the bottom did not update."
            const _commitImport = (text) => {
                const trimmed = text.trim();
                targetNode.gear_config.optimized_export = trimmed;
                targetNode.gear_config.optimized_stats = null;
                // Auto-lock every slot that the imported gearset has an
                // item in. Importing a gearset is an explicit "use exactly
                // this" act — pinning each populated slot makes the next
                // Optimize respect the user's intent instead of swapping
                // items out under them. Decoded slot shape from
                // _decodeGearsetSlots already matches the lock format
                // the slot popup writes ({itemId, name, icon_path,
                // rarity, quality, is_generic, is_fine, [level],
                // [variant]} for pet/consumable). Empty slots stay
                // unlocked so the optimizer can fill them. User can
                // still un-pin individual slots by clicking the orange
                // lock badge if they want optimization to consider
                // alternatives. Bug 233c9cd0 follow-up: "if you import
                // a GS it should lock every slot that imports."
                const decoded = self._decodeGearsetSlots(trimmed) || {};
                const locks = {};
                for (const [slotName, item] of Object.entries(decoded)) {
                    if (!item || !item.itemId) continue;
                    locks[slotName] = item;
                }
                targetNode.locked_slots = locks;
                if (self.props.onImport) {
                    self.props.onImport(nodeId);
                } else {
                    // Defensive fallback: if the parent didn't wire onImport
                    // (older callers), still trigger a recalc by calling
                    // render+attachEvents — accepts the dropdown breakage
                    // rather than leaving the user with no feedback at all.
                    self.render();
                    self.attachEvents();
                }
            };
            try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) {
                    _commitImport(text);
                    if (window.api) window.api.showSuccess('Gearset imported from clipboard');
                }
            } catch {
                // Fallback to prompt if clipboard API fails
                const exportStr = prompt('Paste a gearset export string:');
                if (exportStr && exportStr.trim()) {
                    _commitImport(exportStr);
                    if (window.api) window.api.showSuccess('Gearset applied to node');
                }
            }
        });

        // Export — directly copy export string to clipboard, show toast.
        // (Previously this toggled a submenu with "Copy Gearset" / "Export
        //  String" buttons that both did exactly the same thing.)
        this.$element.on('click', '.tree-btn-export', function (e) {
            e.stopPropagation();
            const exportStr = node.gear_config?.optimized_export;
            if (!exportStr) return;
            navigator.clipboard.writeText(exportStr).then(() => {
                if (window.api) window.api.showSuccess('Gearset copied to clipboard');
            }).catch(() => {
                if (window.api) window.api.showError('Failed to copy');
            });
        });
    }

    /**
     * Push the current node's state to the already-wired LocationDropdown
     * without destroying/recreating the component. Called by
     * CraftingTreeView._calculateOnly's preserveUI path after metrics have
     * been mutated on existing node objects, so the dropdown's
     * `bestResolvedName` stays in sync with the freshly-computed
     * `stats.location`.
     *
     * Without this, a user who picks "Best (auto)" via clearSelection() sees
     * the button stay at "Best (auto)" forever — because clearSelection
     * locally nulls `bestResolvedName`, the preserveUI path skips
     * `_renderTree`, and nothing else pushes the newly-resolved location
     * back into the dropdown.
     */
    syncLocationDropdownFromNode() {
        if (!this._locationDropdown) return;
        const { node } = this.props;
        if (!node) return;
        const stats = node.metrics?.stats_used || {};
        const sel = node.selected_location_id || null;
        const autoResolved = node.last_auto_resolved_location || null;
        const isAutoResolved = !!(sel && autoResolved && sel === autoResolved);
        const bestLocationName = isAutoResolved ? sel : (stats.location || null);
        // setBestResolvedName is a no-op on the button label when the user
        // has an explicit selection (`this.selectedLocation != null`) — it
        // still updates the component's internal bestResolvedName field so
        // if the dropdown re-renders later (e.g. open/close), the fallback
        // "Best → X" display shows the up-to-date location.
        console.log('[LOC-FLICKER] syncLocationDropdownFromNode', {
            nodeId: node.node_id, bestLocationName, sel, autoResolved, isAutoResolved,
        });
        this._locationDropdown.setBestResolvedName(bestLocationName);
    }

    /**
     * Recursively call syncLocationDropdownFromNode on this card and all
     * descendant TreeNodeCards. Used by CraftingTreeView._calculateOnly
     * preserveUI path to refresh every visible LocationDropdown after the
     * per-node metrics have been updated in place.
     */
    syncAllLocationDropdowns() {
        this.syncLocationDropdownFromNode();
        for (const child of this.childComponents) {
            if (child && typeof child.syncAllLocationDropdowns === 'function') {
                child.syncAllLocationDropdowns();
            }
        }
    }

    /**
     * Toggle the WHOLE-CARD collapse state — hides body, material options,
     * and children together. Triggered by clicking the node header.
     * Persists on node.collapsed.
     */
    _toggleCollapse($card) {
        const self = this;
        const $header = $card.children('.tree-node-header');
        const $arrow = $header.find('.tree-node-header-arrow');
        const $body = $card.children('.tree-node-body');
        const $children = $card.children('.tree-node-children');
        const $previewChildren = $card.children('.tree-node-children-preview');
        const $options = $card.children('.tree-node-material-options');
        const $childrenBtn = $card.find('> .tree-node-body > .tree-node-children-toggle');
        const $childrenBtnArrow = $childrenBtn.find('.expand-arrow');
        const $childrenBtnText = $childrenBtn.find('.tree-node-toggle-text');
        const isCollapsed = $header.hasClass('collapsed');
        const nodeId = $card.data('node-id');
        const allNodes = self.props.allNodes || [];
        const n = allNodes.find(nn => nn.node_id === nodeId);
        if (isCollapsed) {
            $header.removeClass('collapsed');
            $arrow.addClass('expanded');
            $body.stop(true, false).slideDown(200);
            $options.stop(true, false).slideDown(200);
            // Slide BOTH child containers. Only one is meaningful at a
            // time (material-options mode uses $previewChildren, otherwise
            // $children), and the other is empty so its slide is a
            // no-op visually — but calling both avoids branching on the
            // current mode and keeps the expand/collapse symmetric.
            $previewChildren.stop(true, false).slideDown(200);
            $children.stop(true, false).slideDown(200);
            $childrenBtn.addClass('expanded');
            $childrenBtnArrow.addClass('expanded');
            $childrenBtnText.text('Hide children');
            $childrenBtn.attr('title', 'Hide children');
            if (n) { n.collapsed = false; n.children_hidden = false; }
        } else {
            $header.addClass('collapsed');
            $arrow.removeClass('expanded');
            $body.stop(true, false).slideUp(200);
            $options.stop(true, false).slideUp(200);
            $previewChildren.stop(true, false).slideUp(200);
            $children.stop(true, false).slideUp(200);
            $childrenBtn.removeClass('expanded');
            $childrenBtnArrow.removeClass('expanded');
            $childrenBtnText.text('Show children');
            $childrenBtn.attr('title', 'Show children');
            if (n) n.collapsed = true;
            // Scroll-into-view: if the header is currently above the
            // visible area of the scroll container, animate the container
            // up so the header lands at the top. The tree lives inside
            // .column-content which has its own overflow-y:auto — window
            // scroll has no effect here, so we walk up to find the actual
            // scrollable ancestor. Falls back to the window if none found.
            try {
                const findScrollParent = (el) => {
                    let node = el.parentNode;
                    while (node && node !== document) {
                        if (node.nodeType === 1) {
                            const cs = window.getComputedStyle(node);
                            const oy = cs.overflowY;
                            if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
                                return node;
                            }
                        }
                        node = node.parentNode;
                    }
                    return null;
                };
                const headerEl = $header[0];
                const scrollEl = findScrollParent(headerEl);
                if (scrollEl) {
                    // Relative position of the header top within the scroll
                    // container: child.getBoundingClientRect().top minus
                    // container.getBoundingClientRect().top gives the pixel
                    // distance; add scrollEl.scrollTop to get the absolute
                    // scroll position of the header within the container.
                    const headerTopInContainer = headerEl.getBoundingClientRect().top
                        - scrollEl.getBoundingClientRect().top
                        + scrollEl.scrollTop;
                    const visibleTop = scrollEl.scrollTop;
                    if (headerTopInContainer < visibleTop) {
                        console.log('[tree-card] scroll-up: header above view (container scroll)', {
                            nodeId,
                            headerTopInContainer,
                            scrollElScrollTop: scrollEl.scrollTop,
                        });
                        $(scrollEl).animate(
                            { scrollTop: Math.max(0, headerTopInContainer - 8) },
                            200
                        );
                    }
                } else {
                    // Fallback: window-level scroll (legacy behavior).
                    const headerTop = $header.offset().top;
                    const scrollTop = $(window).scrollTop();
                    if (headerTop < scrollTop) {
                        console.log('[tree-card] scroll-up: header above view (window scroll)', {
                            nodeId, headerTop, scrollTop,
                        });
                        $('html, body').animate(
                            { scrollTop: Math.max(0, headerTop - 8) }, 200);
                    }
                }
            } catch (err) {
                console.warn('[tree-card] scroll-into-view failed', err);
            }
        }
        if (self.props.onCollapseToggle) {
            self.props.onCollapseToggle(nodeId, !isCollapsed);
        }
    }

    /**
     * Toggle children-only visibility — hides the children subtree AND the
     * material-options button row, but keeps the body (stats/gear/optimize
     * buttons) visible. Triggered by the 'Hide children' button.
     * Persists on node.children_hidden.
     */
    _toggleChildrenHidden($card) {
        const self = this;
        const $children = $card.children('.tree-node-children');
        const $previewChildren = $card.children('.tree-node-children-preview');
        const $options = $card.children('.tree-node-material-options');
        const $childrenBtn = $card.find('> .tree-node-body > .tree-node-children-toggle');
        const $childrenBtnArrow = $childrenBtn.find('.expand-arrow');
        const $childrenBtnText = $childrenBtn.find('.tree-node-toggle-text');
        const nodeId = $card.data('node-id');
        const allNodes = self.props.allNodes || [];
        const n = allNodes.find(nn => nn.node_id === nodeId);
        // Source-of-truth: node.children_hidden. Reading $children:hidden
        // no longer works because in Best(auto)+MaterialOptions mode the
        // real $children is intentionally CSS-hidden from the initial
        // render — the preview container is the visible child slot. Fall
        // back to the button class for first-time clicks on nodes that
        // don't have a persisted children_hidden flag yet.
        const isHidden = !!(n && n.children_hidden) || $childrenBtn.hasClass('collapsed');
        // In Best(auto)+MaterialOptions mode, the preview container is the
        // visible child slot. Otherwise real children are visible. Slide
        // BOTH containers either way — the one that's not in use is empty
        // so its slide is a no-op visually, and we stay mode-agnostic.
        if (isHidden) {
            $options.stop(true, false).slideDown(200);
            $previewChildren.stop(true, false).slideDown(200);
            $children.stop(true, false).slideDown(200);
            $childrenBtn.removeClass('collapsed').addClass('expanded');
            $childrenBtnArrow.addClass('expanded');
            $childrenBtnText.text('Hide children');
            $childrenBtn.attr('title', 'Hide children');
            if (n) n.children_hidden = false;
        } else {
            $options.stop(true, false).slideUp(200);
            $previewChildren.stop(true, false).slideUp(200);
            $children.stop(true, false).slideUp(200);
            $childrenBtn.addClass('collapsed').removeClass('expanded');
            $childrenBtnArrow.removeClass('expanded');
            $childrenBtnText.text('Show children');
            $childrenBtn.attr('title', 'Show children');
            if (n) n.children_hidden = true;
        }
        if (self.props.onCollapseToggle) {
            self.props.onCollapseToggle(nodeId, !!(n && (n.collapsed || n.children_hidden)));
        }
    }

    destroy() {
        const { node } = this.props;
        if (node) {
            $(document).off('click.treenode-' + node.node_id);
        }
        // Only the root card (depth 0) owns the document-level
        // .tree-optimize delegation — see render() above where the
        // off→on dance is gated on `!this.props.depth`. Stripping it
        // unconditionally on EVERY card's destroy was breaking the
        // Optimize button after the first optimize: when root
        // re-renders, it rebinds the handler at the top of render(),
        // then destroys+recreates all child cards in the same call;
        // each child destroy() ripped the freshly-bound handler back
        // off. Subsequent Optimize clicks then matched no listener.
        if (!this.props.depth || this.props.depth === 0) {
            $(document).off('click.tree-optimize');
        }
        if (this._locationDropdown) {
            this._locationDropdown.destroy();
            this._locationDropdown = null;
        }
        this.childComponents.forEach(c => c.destroy());
        this.childComponents = [];
        this.$element.off('change click input');
        super.destroy();
    }
}

export default TreeNodeCard;
