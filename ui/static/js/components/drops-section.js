/**
 * DropsSection Component
 * 
 * Displays drop information for activities and recipes.
 * 
 * Features:
 * - Collapsible section
 * - Filter checkbox: "Hide owned collectibles" (checked by default)
 * - Drop item display with icon, drop percent, quantity, steps per item
 * - Fine materials show steps per fine item below regular steps
 * - Sorting by steps per item (ascending)
 * - Chest drop rate calculation with Chest Finding bonus (recipes only)
 * - Hide owned collectibles filter
 * 
 * Requirements: 4.1-4.10
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import { wireDropCards } from '../drop-item-popover.js';
import { getInstantActionsPet, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';
import { getPetIconPath } from '../utils/pet-utils.js';

import { formatFixed } from '../utils/number-format.js';
import { TRAVEL_TARGETS } from './travel-priority-list.js';

// Icon lookup for travel drops. Reuses the curated TRAVEL_TARGETS icons
// (chests + item-finding categories) so the travel DROPS card matches the
// Steps/Target Item optimization panel. Falls back to a treasure-chest icon
// for any backend item-finding category not present in TRAVEL_TARGETS.
const TRAVEL_DROP_ICONS = Object.fromEntries((TRAVEL_TARGETS || []).map(t => [t.value, t.icon]));
function travelDropIcon(target) {
    // The travel skilling chest is the Agility chest (traveling is agility-skilled).
    if (target === 'cat:chests') return '/assets/icons/items/containers/agility_chest.svg';
    return TRAVEL_DROP_ICONS[target] || '/assets/icons/items/containers/treasure_chest.svg';
}

// 2026-05-26 (jwbail): Auto-enable [COINS-DEBUG] on the testing site and
// localhost so we can diagnose the column-3 vs stats-report coins/1k
// discrepancy (228.24 vs 221.88) without asking the user to flip the
// flag in devtools each session. Disable manually via
// `window.DEBUG_COINS = false` in console. Has no effect on prod
// (walkscape.flamesandvoltiply.com).
if (typeof window !== 'undefined'
    && window.DEBUG_COINS === undefined
    && window.location
    && /walkscapetest|localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    window.DEBUG_COINS = true;
    console.log('[COINS-DEBUG] auto-enabled on testing/local. Set window.DEBUG_COINS = false to silence.');
}

class DropsSection extends Component {
    /**
     * Create a drops section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // State
        this.dropSource = null;  // Activity or recipe object
        this.sourceType = null;  // 'activity' or 'recipe'
        this.hideOwnedCollectibles = store.state.column3?.hideOwnedCollectibles ?? true;
        this.isExpanded = true;

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        // Travel drops: re-render when the travel stats (per-segment drops)
        // published by TravelInfoSection change.
        this.subscribe('column3.travelStats', () => { if (this.sourceType === 'travel') this.render(); });
        this.subscribe('column3.hideOwnedCollectibles', () => this.onHideOwnedChange());
        this.subscribe('gearset', () => this.onGearsetChange());

        // Re-render when target drop changes (for synthetic fine_item/collectible entries)
        this.subscribe('ui.column3.targetDrop', () => this.onGearsetChange());
        this.subscribe('ui.column3.targetDropRate', () => this.onGearsetChange());
        // Re-render when instant-actions checkbox changes
        this.subscribe('ui.instant_actions_foraging', () => { if (this.dropSource) this.render(); });
        this.subscribe('ui.instant_actions_smelting', () => { if (this.dropSource) this.render(); });
        // Re-render when a column-1 skill level is manually overridden so
        // level-based drop chances (and the "At <skill> <lvl>" gated card)
        // reflect the edited level, not just the imported character level.
        this.subscribe('ui.user_overrides.skills', () => { if (this.dropSource) this.render(); });

        // Subscribe to Column 2 stats updates
        // When Column 2 finishes calculating, re-render to show updated drop rates
        if (window.combinedStatsSection) {
            window.combinedStatsSection.statsCalculatedCallbacks.push(() => {
                if (this.dropSource) {
                    console.log('Column 2 stats updated, re-rendering Drops');
                    this.render();
                }
            });
        }

        // Initial render - check both activity and recipe (session may already be loaded)
        if (store.state.column3?.selectedRecipe) {
            this.onRecipeChange();
        } else {
            this.onActivityChange();
        }
    }

    /**
     * Handle activity selection change
     */
    async onActivityChange() {
        const selectedId = store.state.column3?.selectedActivity;

        if (!selectedId) {
            // Check if recipe is selected
            if (!store.state.column3?.selectedRecipe) {
                this.dropSource = null;
                this.sourceType = null;
                this.render();
            }
            return;
        }

        // Traveling: not a real activity/drop-table. Render per-segment travel
        // drops (published by TravelInfoSection) in the standard DROPS card.
        if (selectedId === 'traveling') {
            this.dropSource = null;
            this.sourceType = 'travel';
            this.render();
            return;
        }

        // Handle generic activities
        if (selectedId.startsWith('generic::') || selectedId === 'generic') {
            try {
                const defId = selectedId.replace('generic::', '');
                const activity = await $.get(`/api/generic-definition-view/${defId}`);
                if (activity) {
                    this.dropSource = { ...activity, id: selectedId };
                    this.sourceType = 'activity';
                    this.render();
                    return;
                }
            } catch (e) {
                // Fall through
            }
            this.dropSource = { id: selectedId, skill: '', base_steps: 0 };
            this.sourceType = 'activity';
            this.render();
            return;
        }

        // Fetch activity details from API
        try {
            const response = await $.get('/api/activities');

            // Find activity by ID
            for (const activities of Object.values(response.by_skill)) {
                const activity = activities.find(a => a.id === selectedId);
                if (activity) {
                    this.dropSource = activity;
                    this.sourceType = 'activity';
                    this.render();
                    return;
                }
            }

            // Activity not found
            this.dropSource = null;
            this.sourceType = null;
            this.render();

        } catch (error) {
            console.error('Failed to load activity details:', error);
            api.showError('Failed to load activity details');
        }
    }

    /**
     * Handle recipe selection change
     */
    async onRecipeChange() {
        const selectedId = store.state.column3?.selectedRecipe;

        if (!selectedId) {
            // Check if activity is selected
            if (!store.state.column3?.selectedActivity) {
                this.dropSource = null;
                this.sourceType = null;
                this.render();
            }
            return;
        }

        // Fetch recipe details from API
        try {
            const response = await $.get('/api/recipes');

            // Find recipe by ID
            for (const recipes of Object.values(response.by_skill)) {
                const recipe = recipes.find(r => r.id === selectedId);
                if (recipe) {
                    this.dropSource = recipe;
                    this.sourceType = 'recipe';
                    this.render();
                    return;
                }
            }

            // Recipe not found
            this.dropSource = null;
            this.sourceType = null;
            this.render();

        } catch (error) {
            console.error('Failed to load recipe details:', error);
            api.showError('Failed to load recipe details');
        }
    }

    /**
     * Handle hide owned collectibles checkbox change
     */
    onHideOwnedChange() {
        const hideOwned = store.state.column3?.hideOwnedCollectibles;
        if (hideOwned !== undefined && hideOwned !== this.hideOwnedCollectibles) {
            this.hideOwnedCollectibles = hideOwned;
            this.render();
        }
    }

    /**
     * Handle gearset change (recalculate stats)
     */
    onGearsetChange() {
        if (this.dropSource) {
            this.render();
        }
    }

    /**
     * Toggle section expanded/collapsed
     */
    toggleExpanded() {
        this.isExpanded = !this.isExpanded;

        const $content = this.$element.find('.drops-content');
        const $arrow = this.$element.find('.drops-header .expand-arrow');

        if (this.isExpanded) {
            $arrow.addClass('expanded');
            $content.slideDown(200);
        } else {
            $arrow.removeClass('expanded');
            $content.slideUp(200);
        }
    }

    /**
     * Toggle hide owned collectibles
     * Requirements: 4.7
     * @param {boolean} hide - Whether to hide owned collectibles
     */
    toggleHideOwned(hide) {
        this.hideOwnedCollectibles = hide;

        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.hideOwnedCollectibles = hide;

        // Notify subscribers
        store._notifySubscribers('column3.hideOwnedCollectibles');

        // Auto-save selection to session
        store._saveColumn3Selection();

        this.render();
    }

    /**
     * Calculate drop rates with steps per item
     * Requirements: 4.3, 4.5
     * @returns {Array} Array of drop objects with calculated steps
     */
    /**
     * Effective skill level for `skill`: the manual column-1 override
     * (ui.user_overrides.skills) when set, otherwise the imported character
     * level. Mirrors how calculator/combined-stats/activity-info resolve level.
     */
    _effectiveSkillLevel(skill) {
        if (!skill) return 1;
        const s = String(skill).toLowerCase();
        const overrides = store.state.ui?.user_overrides?.skills || {};
        for (const [k, v] of Object.entries(overrides)) {
            if (k.toLowerCase() === s && v !== undefined && v !== null) return v;
        }
        const skills = store.state.character?.skills || {};
        for (const [name, data] of Object.entries(skills)) {
            if (name.toLowerCase() === s) {
                return (data && typeof data === 'object') ? (data.level || 1) : (data || 1);
            }
        }
        return 1;
    }

    /**
     * Build a level-aware drop-chance resolver for the current activity.
     *
     * Level-based drops carry initial_level / max_chance_level / final_chance
     * from the gear API. The backend bakes chance_percent at the *imported*
     * character level, so a manual column-1 level edit was ignored. This
     * recomputes the displayed chance at the EFFECTIVE skill level, mirroring
     * the backend DropEntry.calculate_weight + get_chance_at_level:
     *   weight(level) = final_chance * (level - initial + 1) / (max - initial)
     *   chance        = weight / total_level_weight * (100 - nothing_pct)
     * Non-level drops keep their backend chance_percent unchanged.
     */
    _buildLevelContext() {
        const skill = ((this.dropSource && (this.dropSource.primary_skill || this.dropSource.skill)) || '');
        const level = this._effectiveSkillLevel(skill);
        const table = (this.dropSource && this.dropSource.drop_table) || [];
        const isLevelBased = (d) => d.initial_level != null && d.max_chance_level != null && d.final_chance != null;
        const weightOf = (d) => {
            if (level < d.initial_level) return 0;
            if (level >= d.max_chance_level) return d.final_chance;
            const span = d.max_chance_level - d.initial_level;
            let ratio = (level - d.initial_level + 1) / span;
            if (ratio > 1) ratio = 1;
            return d.final_chance * ratio;
        };
        const levelBased = table.filter(isLevelBased);
        let totalWeight = 0;
        let nothingPct = 10;
        if (levelBased.length) {
            for (const d of levelBased) totalWeight += weightOf(d);
            const totalFinal = levelBased.reduce((sum, d) => sum + (d.final_chance || 0), 0);
            nothingPct = 100 - totalFinal;
        }
        return {
            level,
            percent: (d) => {
                if (!isLevelBased(d)) return d.chance_percent;
                if (totalWeight === 0) return 0;
                return (weightOf(d) / totalWeight) * (100 - nothingPct);
            },
        };
    }

    async calculateDropRates() {
        if (!this.dropSource) {
            return [];
        }

        const drops = [];

        // Level-aware chance resolver: rescales level-based drops to the
        // effective (column-1 override) skill level. See _buildLevelContext.
        const levelCtx = this._buildLevelContext();

        // Get current stats for steps calculation
        const stats = this.getCurrentStats();
        const stepsPerRewardRoll = stats.stepsPerRewardRoll;

        // Get finding bonuses from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};
        const chestFinding = (column2Stats.chest_finding || 0) / 100;  // Convert to decimal
        const fineMaterialFinding = (column2Stats.fine_material_finding || 0) / 100;
        const findGems = (column2Stats.find_gems || 0) / 100;
        const findCollectibles = (column2Stats.find_collectibles || column2Stats.collectible_finding || 0) / 100;
        const findBirdNests = (column2Stats.find_bird_nests || 0) / 100;
        // find_linens: Mummy "That's A Wrap" passive — a global chance (per action)
        // to roll the linens table. Drives the injected linen drops below.
        const findLinens = (column2Stats.find_linens || 0) / 100;

        // [COINS-DEBUG] gated by window.DEBUG_COINS — set to true in browser
        // console to dump per-drop coin contributions so the worker's
        // stored coins/1k can be reconciled against column-3's display.
        const _COINS_DEBUG = !!window.DEBUG_COINS;
        if (_COINS_DEBUG) {
            const _srcId = (this.dropSource && (this.dropSource.id || this.dropSource.name)) || '?';
            console.log(`[COINS-DEBUG] calculateDropRates source=${_srcId} sourceType=${this.sourceType}`);
            console.log(`[COINS-DEBUG]   stepsPerRewardRoll=${stepsPerRewardRoll}`);
            console.log(`[COINS-DEBUG]   bonuses (decimal): chest_finding=${chestFinding} find_collectibles=${findCollectibles} find_bird_nests=${findBirdNests} find_gems=${findGems} fine_material_finding=${fineMaterialFinding}`);
            console.log(`[COINS-DEBUG]   raw column2Stats finding pcts:`, {
                chest_finding: column2Stats.chest_finding,
                find_collectibles: column2Stats.find_collectibles,
                collectible_finding: column2Stats.collectible_finding,
                find_bird_nests: column2Stats.find_bird_nests,
                find_gems: column2Stats.find_gems,
                fine_material_finding: column2Stats.fine_material_finding,
            });
        }

        // Add equipment drops from ItemFindingCategory stats
        // For recipes, build calcMaterialsPerItem so equipment drops also get materials_per_item
        let equipmentCalcMPI = null;
        if (this.sourceType === 'recipe' && this.dropSource) {
            const recipeGearStats = this.getGearStats();
            const _recipeDR = recipeGearStats.double_rewards || 0;
            const _recipeNMC = recipeGearStats.no_materials_consumed || 0;
            const _recipeMPC = 1 / ((1 + _recipeDR) / (1 - _recipeNMC));
            const _recipeDA = recipeGearStats.double_action || 0;
            const _recipeWE = recipeGearStats.work_efficiency || 0;
            const _recipeFlat = recipeGearStats.flat_steps || 0;
            const _recipePct = recipeGearStats.percent_steps || 0;
            const _recipeCappedWE = Math.min(_recipeWE, this.dropSource.max_efficiency);
            // Single ceil at the END (KamiTzayig reference) — prevents off-by-one
            // errors when a pct modifier is applied.
            const _recipeBaseOverEff = this.dropSource.base_steps / (1 + _recipeCappedWE);
            const _recipeWithPct = _recipeBaseOverEff * (1 + _recipePct);
            const _recipeStepsPerAction = Math.max(Math.ceil(_recipeWithPct + _recipeFlat), 10);
            equipmentCalcMPI = (stepsPerItem) => {
                if (!isFinite(stepsPerItem) || stepsPerItem <= 0) return null;
                return _recipeMPC * stepsPerItem * (1 + _recipeDA) / _recipeStepsPerAction;
            };
        }
        await this.addEquipmentDrops(drops, column2Stats, stepsPerRewardRoll, equipmentCalcMPI);

        // Process drop table (activities only)
        if (this.sourceType === 'activity' && this.dropSource.drop_table) {
            for (const drop of this.dropSource.drop_table) {
                const dropPercent = levelCtx.percent(drop);
                const avgQuantity = this.calculateAverageQuantity(drop.quantity);

                // Determine finding bonus based on item type
                let findBonus = 0;
                if (drop.item_ref) {
                    if (drop.item_ref.startsWith('Collectible.')) {
                        findBonus = findCollectibles;
                    } else if (drop.item_ref.startsWith('Container.') && !drop.item_ref.includes('BIRD_NEST')) {
                        findBonus = chestFinding;
                    } else if (drop.item_name.toLowerCase().includes('bird nest') || drop.item_name.toLowerCase().includes('nest')) {
                        findBonus = findBirdNests;
                    }
                    // Check for gems by keywords
                    if (drop.item_keywords && drop.item_keywords.some(kw => ['gem', 'rough gem'].includes(kw.toLowerCase()))) {
                        findBonus = findGems;
                    }
                }
                let stepsPerItem;
                let augmentedDropPercent;

                if (drop.multi_roll_count && drop.multi_roll_count > 1) {
                    // Multi-roll drop: each action does N independent rolls
                    // chance_percent is the per-roll chance (row_weight / table_weight * 100)
                    const perRollChance = dropPercent / 100;
                    const boostedRollChance = perRollChance * (1 + findBonus);
                    const denominator = drop.multi_roll_count * boostedRollChance * avgQuantity;
                    stepsPerItem = denominator > 0 ? stepsPerRewardRoll / denominator : Infinity;
                    // Compound chance for display: 1 - (1 - boosted_per_roll)^N
                    augmentedDropPercent = (1 - Math.pow(1 - boostedRollChance, drop.multi_roll_count)) * 100;
                } else {
                    stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * (1 + findBonus) * avgQuantity);
                    augmentedDropPercent = dropPercent * (1 + findBonus);
                }

                if (window.DEBUG_COINS) {
                    const _coin = Number(drop.coin_value) || 0;
                    const _ipk = stepsPerItem > 0 && isFinite(stepsPerItem) ? 1000 / stepsPerItem : 0;
                    const _contrib = _coin * _ipk;
                    console.log(`[COINS-DEBUG]   primary drop name="${drop.item_name}" ref=${drop.item_ref || '-'} base_pct=${dropPercent} find_bonus=${findBonus} multi_roll=${drop.multi_roll_count || 1} avgQty=${avgQuantity} aug_pct=${augmentedDropPercent} steps_per_item=${stepsPerItem.toFixed ? stepsPerItem.toFixed(2) : stepsPerItem} coin_value=${_coin} items_per_1k=${_ipk.toFixed(4)} coin_contrib_per_1k=${_contrib.toFixed(4)}`);
                }

                // Check if this material has a fine version (from API)
                const isFine = drop.item_name.includes('Fine') || drop.item_name.includes('(Fine)');
                const hasFineVersion = !isFine && drop.has_fine_material;

                // If this item has a fine version, calculate steps to fine
                // Fine materials drop at 1% of the base material's rate (1/100)
                // Fine Material Finding bonus applies, plus the item's find bonus (e.g., find_gems)
                let stepsPerFineItem = null;
                let augmentedFineDropPercent = null;
                if (hasFineVersion && dropPercent) {
                    const fineDropPercent = dropPercent * 0.01;  // 1% of base per-roll rate
                    augmentedFineDropPercent = fineDropPercent * (1 + fineMaterialFinding) * (1 + findBonus);
                    const rollMultiplier = (drop.multi_roll_count && drop.multi_roll_count > 1) ? drop.multi_roll_count : 1;
                    stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * avgQuantity * rollMultiplier);
                }

                drops.push({
                    item_name: drop.item_name,
                    item_ref: drop.item_ref,
                    drop_percent: augmentedDropPercent,  // Show augmented percent
                    quantity: drop.quantity,
                    avg_quantity: avgQuantity,
                    steps_per_item: stepsPerItem,
                    steps_per_fine_item: stepsPerFineItem,
                    fine_drop_percent: augmentedFineDropPercent,  // For fine materials
                    is_fine: isFine,
                    // Level gate: drop is unobtainable at the character's current
                    // level. Render as a grayed "At <skill> <level>" card instead
                    // of a 0% / infinite-steps row (bug 1a799e8d follow-up).
                    initial_level: drop.initial_level != null ? drop.initial_level : null,
                    level_gated: (drop.initial_level != null) && (dropPercent === 0),
                    is_collectible: drop.item_ref && drop.item_ref.startsWith('Collectible.'),
                    coin_value: drop.coin_value || 0,
                    fine_coin_value: drop.fine_coin_value || 0,
                    shell_value: drop.shell_value || 0,
                    fine_shell_value: drop.fine_shell_value || 0,
                    fine_ag_token_value: drop.fine_ag_token_value || 0,
                    special_sell: drop.special_sell || null,
                    source: 'primary'
                });
            }
        }

        // Inject Mummy "That's A Wrap" linen drops (global find_linens passive).
        // Per action there is a `findLinens` chance to roll the linens table,
        // rolled twice (rollAmount 2). Per-item drop% = findLinens * 2 *
        // (rowWeight / totalWeight). Fine linens drop at 1/100 of the base rate
        // and ARE boosted by Fine Material Finding, like other fine materials.
        // Table source of truth: util/autogenerated/loot_tables.py
        // LOOT_TABLES['find_linens'].
        if ((this.sourceType === 'activity' || this.sourceType === 'recipe') && findLinens > 0) {
            const LINEN_ROLL_AMOUNT = 2;
            const LINEN_TABLE = [
                { item_name: 'Linen cloth', item_ref: 'Material.LINEN_CLOTH', row_weight: 67, min_qty: 1, max_qty: 4 },
                { item_name: 'Tough linen cloth', item_ref: 'Material.TOUGH_LINEN_CLOTH', row_weight: 33, min_qty: 1, max_qty: 1 },
            ];
            const linenTotalWeight = LINEN_TABLE.reduce((s, r) => s + r.row_weight, 0);
            for (const row of LINEN_TABLE) {
                const weight = row.row_weight / linenTotalWeight;
                const dropPercent = findLinens * LINEN_ROLL_AMOUNT * weight * 100;  // display %
                const avgQuantity = (row.min_qty + row.max_qty) / 2;
                const stepsPerItem = dropPercent > 0
                    ? (stepsPerRewardRoll * 100) / (dropPercent * avgQuantity)
                    : Infinity;
                // Fine linens: 1/100 of base, boosted by Fine Material Finding.
                const fineDropPercent = dropPercent * 0.01 * (1 + fineMaterialFinding);
                const stepsPerFineItem = fineDropPercent > 0
                    ? (stepsPerRewardRoll * 100) / (fineDropPercent * avgQuantity)
                    : Infinity;
                drops.push({
                    item_name: row.item_name,
                    item_ref: row.item_ref,
                    drop_percent: dropPercent,
                    quantity: { min: row.min_qty, max: row.max_qty },
                    avg_quantity: avgQuantity,
                    steps_per_item: stepsPerItem,
                    steps_per_fine_item: stepsPerFineItem,
                    fine_drop_percent: fineDropPercent,
                    is_fine: false,
                    is_collectible: false,
                    coin_value: 0,
                    fine_coin_value: 0,
                    shell_value: 0,
                    fine_shell_value: 0,
                    fine_ag_token_value: 0,
                    special_sell: null,
                    source: 'pet_linens',
                });
            }
        }

        // Process secondary drop table (activities only) - always show all drops
        if (this.sourceType === 'activity' && this.dropSource.secondary_drop_table) {
            for (const drop of this.dropSource.secondary_drop_table) {
                const dropPercent = levelCtx.percent(drop);
                const avgQuantity = this.calculateAverageQuantity(drop.quantity);

                // Determine finding bonus based on item type
                let findBonus = 0;
                if (drop.item_ref) {
                    if (drop.item_ref.startsWith('Collectible.')) {
                        findBonus = findCollectibles;
                    } else if (drop.item_ref.startsWith('Container.') && !drop.item_ref.includes('BIRD_NEST')) {
                        findBonus = chestFinding;
                    } else if (drop.item_name.toLowerCase().includes('bird nest') || drop.item_name.toLowerCase().includes('nest')) {
                        findBonus = findBirdNests;
                    }
                    // Check for gems by keywords
                    if (drop.item_keywords && drop.item_keywords.some(kw => ['gem', 'rough gem'].includes(kw.toLowerCase()))) {
                        findBonus = findGems;
                    }
                }

                let stepsPerItem;
                let augmentedDropPercent;

                if (drop.multi_roll_count && drop.multi_roll_count > 1) {
                    // Multi-roll drop: each action does N independent rolls
                    // chance_percent is the per-roll chance (row_weight / table_weight * 100)
                    const perRollChance = dropPercent / 100;
                    const boostedRollChance = perRollChance * (1 + findBonus);
                    const denominator = drop.multi_roll_count * boostedRollChance * avgQuantity;
                    stepsPerItem = denominator > 0 ? stepsPerRewardRoll / denominator : Infinity;
                    // Compound chance for display: 1 - (1 - boosted_per_roll)^N
                    augmentedDropPercent = (1 - Math.pow(1 - boostedRollChance, drop.multi_roll_count)) * 100;
                } else {
                    // Normal drop
                    stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * (1 + findBonus) * avgQuantity);
                    augmentedDropPercent = dropPercent * (1 + findBonus);
                }

                if (window.DEBUG_COINS) {
                    const _coin = Number(drop.coin_value) || 0;
                    const _ipk = stepsPerItem > 0 && isFinite(stepsPerItem) ? 1000 / stepsPerItem : 0;
                    const _contrib = _coin * _ipk;
                    console.log(`[COINS-DEBUG]   secondary drop name="${drop.item_name}" ref=${drop.item_ref || '-'} base_pct=${dropPercent} find_bonus=${findBonus} multi_roll=${drop.multi_roll_count || 1} avgQty=${avgQuantity} aug_pct=${augmentedDropPercent} steps_per_item=${stepsPerItem.toFixed ? stepsPerItem.toFixed(2) : stepsPerItem} coin_value=${_coin} items_per_1k=${_ipk.toFixed(4)} coin_contrib_per_1k=${_contrib.toFixed(4)}`);
                }

                // Check if this material has a fine version (from API)
                const isFine = drop.item_name.includes('Fine') || drop.item_name.includes('(Fine)');
                const hasFineVersion = !isFine && drop.has_fine_material;

                // If this item has a fine version, calculate steps to fine
                // Fine materials drop at 1% of the base material's rate (1/100)
                // Fine Material Finding bonus applies, plus the item's find bonus (e.g., find_gems)
                let stepsPerFineItem = null;
                let augmentedFineDropPercent = null;
                if (hasFineVersion && dropPercent) {
                    const fineDropPercent = dropPercent * 0.01;  // 1% of base per-roll rate
                    augmentedFineDropPercent = fineDropPercent * (1 + fineMaterialFinding) * (1 + findBonus);
                    const rollMultiplier = (drop.multi_roll_count && drop.multi_roll_count > 1) ? drop.multi_roll_count : 1;
                    stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * avgQuantity * rollMultiplier);
                }

                drops.push({
                    item_name: drop.item_name,
                    item_ref: drop.item_ref,
                    drop_percent: augmentedDropPercent,  // Show augmented percent
                    quantity: drop.quantity,
                    avg_quantity: avgQuantity,
                    steps_per_item: stepsPerItem,
                    steps_per_fine_item: stepsPerFineItem,
                    fine_drop_percent: augmentedFineDropPercent,  // For fine materials
                    is_fine: isFine,
                    // Level gate: drop is unobtainable at the character's current
                    // level. Render as a grayed "At <skill> <level>" card instead
                    // of a 0% / infinite-steps row (bug 1a799e8d follow-up).
                    initial_level: drop.initial_level != null ? drop.initial_level : null,
                    level_gated: (drop.initial_level != null) && (dropPercent === 0),
                    is_collectible: drop.item_ref && drop.item_ref.startsWith('Collectible.'),
                    coin_value: drop.coin_value || 0,
                    fine_coin_value: drop.fine_coin_value || 0,
                    shell_value: drop.shell_value || 0,
                    fine_shell_value: drop.fine_shell_value || 0,
                    fine_ag_token_value: drop.fine_ag_token_value || 0,
                    special_sell: drop.special_sell || null,
                    source: 'secondary'
                });
            }
        }

        // Add chest drop (only for recipes - activities already have chests in drop table)
        // Requirements: 4.8, 4.9
        if (this.sourceType === 'recipe') {
            // Calculate materials per craft for this recipe (used to show materials per drop)
            const recipeGearStats = this.getGearStats();
            const recipeDR = recipeGearStats.double_rewards || 0;
            const recipeNMC = recipeGearStats.no_materials_consumed || 0;
            const recipeCraftsPerMaterial = (1 + recipeDR) / (1 - recipeNMC);
            const recipeMaterialsPerCraft = 1 / recipeCraftsPerMaterial;

            // Steps per single action (without DA) for materials-per-item calculation
            const recipeBaseSteps = this.dropSource.base_steps;
            const recipeMaxEff = this.dropSource.max_efficiency;
            const recipeWE = recipeGearStats.work_efficiency || 0;
            const recipeDA = recipeGearStats.double_action || 0;
            const recipeFlat = recipeGearStats.flat_steps || 0;
            const recipePct = recipeGearStats.percent_steps || 0;
            const recipeCappedWE = Math.min(recipeWE, recipeMaxEff);
            const recipeBaseWithEff = recipeBaseSteps / (1 + recipeCappedWE);
            const recipeWithPct = recipeBaseWithEff * (1 + recipePct);
            const recipeStepsPerAction = Math.max(Math.ceil(recipeWithPct) + recipeFlat, 10);

            // Helper: materials consumed per drop of an item
            // = materialsPerCraft * (stepsPerItem / stepsPerAction) * (1 + DA)
            // Because stepsPerItem already accounts for DA via stepsPerRewardRoll,
            // we need to convert back to per-action units:
            // stepsPerItem = stepsPerRewardRoll / dropRate = stepsPerAction / ((1+DA)*(1+DR)) / dropRate
            // materialsPerItem = materialsPerCraft * stepsPerItem / (stepsPerAction / (1+DA))
            //                  = materialsPerCraft * stepsPerItem * (1+DA) / stepsPerAction
            const calcMaterialsPerItem = (stepsPerItem) => {
                if (!isFinite(stepsPerItem) || stepsPerItem <= 0) return null;
                return recipeMaterialsPerCraft * stepsPerItem * (1 + recipeDA) / recipeStepsPerAction;
            };

            // Column 2 stats for the recipe path (recipe chest-finding, etc.)
            // Declared once here to avoid TDZ issues in the drop_table loop below.
            const recipeCombinedStatsSection = window.combinedStatsSection;
            const recipeColumn2Stats = recipeCombinedStatsSection?.cachedStats || {};
            const recipeChestFinding = (recipeColumn2Stats.chest_finding || 0) / 100;
            const recipeFineMaterialFinding = (recipeColumn2Stats.fine_material_finding || 0) / 100;

            // Process recipe drop table (e.g., mummy egg from tatty recipes,
            // Silver nugget from bar smelting with multi_roll_count support).
            // Container drops (chests) are intentionally skipped here — the
            // legacy chest-rendering block below emits a single "Chest" row
            // per recipe at the same 0.4% base rate, so letting the new loop
            // push its own Smithing chest / Tailoring chest / etc. entries
            // would duplicate them.
            if (this.dropSource.drop_table && this.dropSource.drop_table.length > 0) {
                for (const drop of this.dropSource.drop_table) {
                    const dropPercent = drop.chance_percent || 0;
                    const qty = drop.quantity || 1;
                    if (dropPercent <= 0) continue;

                    // Skip containers — legacy chest block below renders them.
                    const isContainerRef = drop.item_ref && drop.item_ref.startsWith('Container.');
                    const isContainerType = drop.item_type && drop.item_type.toLowerCase() === 'container';
                    if (isContainerRef || isContainerType) continue;

                    // Chest-finding bonus no longer applies here (containers skipped).
                    let findBonus = 0;

                    let stepsPerItem;
                    let augmentedDropPercent;
                    if (drop.multi_roll_count && drop.multi_roll_count > 1) {
                        // chance_percent is per-roll; each action does N independent rolls
                        const perRollChance = dropPercent / 100;
                        const boostedRollChance = perRollChance * (1 + findBonus);
                        const denom = drop.multi_roll_count * boostedRollChance * qty;
                        stepsPerItem = denom > 0 ? stepsPerRewardRoll / denom : Infinity;
                        augmentedDropPercent = (1 - Math.pow(1 - boostedRollChance, drop.multi_roll_count)) * 100;
                    } else {
                        const chance = dropPercent / 100;
                        const effectiveChance = chance * (1 + findBonus);
                        stepsPerItem = effectiveChance > 0 ? stepsPerRewardRoll / (effectiveChance * qty) : Infinity;
                        augmentedDropPercent = effectiveChance * 100;
                    }
                    const materialsPerItem = calcMaterialsPerItem(stepsPerItem);

                    // Fine material handling — mirrors the activity path.
                    // Fine materials drop at 1% of the base (per-roll) rate and are
                    // boosted by Fine Material Finding. Multi-roll drops take the
                    // full roll count into account via rollMultiplier.
                    let stepsPerFineItem = null;
                    let augmentedFineDropPercent = null;
                    const hasFineVersion = drop.has_fine_material && dropPercent > 0;
                    if (hasFineVersion) {
                        const fineDropPercent = dropPercent * 0.01;  // 1% of base per-roll rate
                        augmentedFineDropPercent = fineDropPercent * (1 + recipeFineMaterialFinding) * (1 + findBonus);
                        const rollMultiplier = (drop.multi_roll_count && drop.multi_roll_count > 1) ? drop.multi_roll_count : 1;
                        stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * qty * rollMultiplier);
                    }

                    // Coin value for the coins/1k-steps pill. Side drops
                    // (Silver nugget, Mummy egg, etc.) are Material/Item/
                    // Consumable refs with a .value resolved server-side
                    // in app.py _enrich_recipe_drop. Also pick up the fine
                    // variant value so the pill can add that contribution
                    // when FMF is active.
                    const sideCoinValue = Number(drop.coin_value) || 0;
                    const sideFineCoinValue = Number(drop.fine_coin_value) || 0;
                    const sideShellValue = Number(drop.shell_value) || 0;
                    const sideFineShellValue = Number(drop.fine_shell_value) || 0;

                    drops.push({
                        item_name: drop.item_name,
                        item_ref: drop.item_ref || null,
                        drop_percent: augmentedDropPercent,
                        quantity: { min: qty, max: qty, is_static: true },
                        avg_quantity: qty,
                        multi_roll_count: drop.multi_roll_count || null,
                        steps_per_item: stepsPerItem,
                        steps_per_fine_item: stepsPerFineItem,
                        fine_drop_percent: augmentedFineDropPercent,
                        has_fine_material: !!drop.has_fine_material,
                        materials_per_item: materialsPerItem,
                        coin_value: sideCoinValue,
                        fine_coin_value: sideFineCoinValue,
                        shell_value: sideShellValue,
                        fine_shell_value: sideFineShellValue,
                        is_fine: false,
                        is_collectible: false,
                        source: 'recipe_drop',
                    });
                }
            }

            const baseChestRate = 0.4;  // Always show base rate

            // Reuse the recipe-block CF values hoisted above (TDZ-safe).
            const combinedStatsSection = recipeCombinedStatsSection;
            const column2Stats = recipeColumn2Stats;
            const chestFinding = recipeChestFinding;

            // Display rate only includes Chest Finding
            const displayChestRate = baseChestRate * (1 + chestFinding);
            // Steps calculation: DR is already factored into stepsPerRewardRoll,
            // so chest steps only need CF. DR does not independently boost chest drops.
            const chestStepsPerItem = (stepsPerRewardRoll * 100) / displayChestRate;
            const chestMaterialsPerItem = calcMaterialsPerItem(chestStepsPerItem);

            console.log(`[BUG2-SINGLE] stepsPerRewardRoll=${formatFixed(stepsPerRewardRoll, 4)}, CF=${formatFixed(chestFinding, 4)}, displayRate=${formatFixed(displayChestRate, 4)}, chestSteps=${formatFixed(chestStepsPerItem, 1)}`);

            // Get primary skill for chest icon
            const primarySkill = this.dropSource.skill ? this.dropSource.skill.toLowerCase() : 'chest';

            // Coin value for chest: look up by the skill-specific chest ref.
            // Used by the coins/1k-steps pill. Wiki-sourced values kept in
            // sync server-side in util/coin_value.py CHEST_COIN_VALUES.
            const _CHEST_COIN_VALUES = {
                'agility': 65.68, 'carpentry': 100.92, 'cooking': 70.62,
                'crafting': 102.12, 'fishing': 72.39, 'foraging': 78.38,
                'hunting': 64.11, 'mining': 88.58, 'smithing': 96.34,
                'tailoring': 74.73, 'trinketry': 310.09, 'woodcutting': 82.74,
            };
            const chestCoinValue = _CHEST_COIN_VALUES[primarySkill] || 0;

            drops.push({
                item_name: 'Chest',
                item_ref: null,
                drop_percent: displayChestRate,  // Show rate with CF only (not DR)
                quantity: { min: 1, max: 1, is_static: true },
                avg_quantity: 1,
                steps_per_item: chestStepsPerItem,  // Steps account for both CF and DR
                materials_per_item: chestMaterialsPerItem,
                coin_value: chestCoinValue,
                is_fine: false,
                is_collectible: false,
                source: 'chest',
                primary_skill: primarySkill  // Pass skill for icon selection
            });

            // Synthetic "primary output" row — NOT rendered in the visible
            // drops list (source: 'output_synthetic' is filtered out during
            // render), but picked up by calculateCurrencyPer1kSteps so the
            // coins/1k-steps pill includes the crafted item's sell value
            // alongside side drops and chests.
            //
            // Coin value is quality-weighted for equipment outputs (per-
            // tier values from the API) and flat for materials/consumables.
            // Quality percentages come from the recipe-info-section's
            // cached weights if available; otherwise we fall back to a
            // raw base value to keep the pill non-zero.
            const outputQualityValues = this.dropSource.output_quality_values || null;
            const outputBaseValue = Number(this.dropSource.output_coin_value || 0);
            let outputCoinValue = outputBaseValue;
            if (outputQualityValues) {
                try {
                    const ris = window.recipeInfoSection;
                    const qo = (window.combinedStatsSection?.cachedStats?.quality_outcome) || 0;
                    if (ris && typeof ris.calculateQualityWeights === 'function') {
                        // Match the scorer: no-fine, no-equipment-input
                        // assumptions — the recipe-info display view uses
                        // useFine/hasEquipmentInput explicitly, but the
                        // optimizer's coin target ignores those so the
                        // pill needs to mirror the optimizer.
                        const qw = ris.calculateQualityWeights(this.dropSource.level || 0, qo);
                        outputCoinValue = 0;
                        for (const [q, pct] of Object.entries(qw.percentages || {})) {
                            const v = outputQualityValues[q] ?? outputBaseValue;
                            outputCoinValue += (pct / 100) * (Number(v) || 0);
                        }
                    }
                } catch (_e) {
                    outputCoinValue = outputBaseValue;
                }
            }
            const outputQuantity = Number(this.dropSource.quantity || 1);
            if (outputCoinValue > 0 && stepsPerRewardRoll > 0 && outputQuantity > 0) {
                // steps_per_item for the output = stepsPerRewardRoll /
                // output_quantity (one reward roll = one craft = N outputs).
                drops.push({
                    item_name: this.dropSource.output_item_name || 'Output',
                    item_ref: this.dropSource.output_item || null,
                    drop_percent: 100,
                    quantity: { min: outputQuantity, max: outputQuantity, is_static: true },
                    avg_quantity: outputQuantity,
                    steps_per_item: stepsPerRewardRoll / outputQuantity,
                    materials_per_item: null,
                    coin_value: outputCoinValue,
                    is_fine: false,
                    is_collectible: false,
                    source: 'output_synthetic',
                });
            }

            // Synthetic "materials cost" row — NOT rendered in the visible
            // drops list (source: 'materials_synthetic' filtered out during
            // render), but picked up by calculateCurrencyPer1kSteps so the
            // coins/1k-steps pill can subtract the coin cost of consumed
            // materials (NOT input items / equipment tools — see below).
            //
            // Pulls the currently-selected material group from recipe-info-
            // section so alternate groups (e.g. regular vs fine variants)
            // produce distinct cost figures. Equipment-typed entries are
            // skipped: tools are wielded during the craft, not consumed.
            //
            // Per-1k-steps cost math mirrors calcMaterialsPerItem:
            //   crafts_per_1k_steps = 1000 / stepsPerRewardRoll
            //   units_per_craft     = recipeMaterialsPerCraft * base_qty
            //   cost_per_craft      = sum(units_per_craft * value)
            //   cost_per_1k_steps   = crafts_per_1k_steps * cost_per_craft
            if (stepsPerRewardRoll > 0 && Array.isArray(this.dropSource.materials)) {
                const mgIndex = (window.recipeInfoSection?.selectedMaterialGroup ?? 0) | 0;
                const groups = this.dropSource.materials;
                const selectedGroup = groups[mgIndex] || groups[0] || [];

                // Per-craft base coin cost: sum over group members, skipping
                // equipment tools (not consumed) and any entry with zero value.
                let baseCoinCostPerCraft = 0;
                const materialsEntries = [];
                for (const mat of selectedGroup) {
                    if (!mat || mat.type === 'equipment') continue;
                    const matValue = Number(mat.value) || 0;
                    const matQty = Number(mat.quantity) || 0;
                    if (matValue <= 0 || matQty <= 0) continue;
                    baseCoinCostPerCraft += matValue * matQty;
                    materialsEntries.push({
                        material_id: mat.material_id,
                        material_name: mat.material_name,
                        material_icon_name: mat.material_icon_name,
                        quantity: matQty,
                        value: matValue,
                        type: mat.type,
                    });
                }

                if (baseCoinCostPerCraft > 0 && recipeMaterialsPerCraft > 0) {
                    const coinCostPerCraft = baseCoinCostPerCraft * recipeMaterialsPerCraft;
                    const craftsPer1k = 1000.0 / stepsPerRewardRoll;
                    const materialsCostPer1k = craftsPer1k * coinCostPerCraft;

                    drops.push({
                        item_name: 'Materials',
                        item_ref: null,
                        drop_percent: 0,
                        quantity: { min: 0, max: 0, is_static: true },
                        avg_quantity: 0,
                        steps_per_item: 0,
                        materials_per_item: null,
                        coin_value: 0,
                        is_fine: false,
                        is_collectible: false,
                        source: 'materials_synthetic',
                        // Breakdown-only fields (ignored by calculateCurrencyPer1kSteps
                        // for the drops loop — it handles this source specially):
                        materials_cost_per_1k: materialsCostPer1k,
                        materials_entries: materialsEntries,
                    });
                }
            }
        }

        // Add chest drop for generic activities (no wiki drop table, but chests always exist)
        const isGeneric = this.dropSource.id && String(this.dropSource.id).startsWith('generic::');
        if (this.sourceType === 'activity' && isGeneric) {
            const baseChestRate = 0.4;  // 1/250 = 0.4%

            const combinedStatsSection = window.combinedStatsSection;
            const column2Stats = combinedStatsSection?.cachedStats || {};
            const chestFinding = (column2Stats.chest_finding || 0) / 100;

            // DR is already factored into stepsPerRewardRoll — chest steps only need CF
            const effectiveChestRate = baseChestRate * (1 + chestFinding);
            const chestStepsPerItem = stepsPerRewardRoll > 0 ? (stepsPerRewardRoll * 100) / effectiveChestRate : 0;

            const primarySkill = (this.dropSource.primary_skill || this.dropSource.skill || '').toLowerCase() || 'treasure';
            const skillDisplay = primarySkill.charAt(0).toUpperCase() + primarySkill.slice(1);

            // Display rate only includes Chest Finding
            const displayChestRate = baseChestRate * (1 + chestFinding);

            drops.push({
                item_name: `${skillDisplay} Chest`,
                item_ref: null,
                drop_percent: displayChestRate,  // Show rate with CF only (not DR)
                quantity: { min: 1, max: 1, is_static: true },
                avg_quantity: 1,
                steps_per_item: chestStepsPerItem,
                is_fine: false,
                is_collectible: false,
                source: 'chest',
                primary_skill: primarySkill
            });

        }

        // Add synthetic fine_item / collectible entries if user has set a target drop rate
        // These work for ALL activities (generic and wiki) so users can see how gear affects expected steps
        if (this.sourceType === 'activity') {
            const targetDrop = store.state.ui?.column3?.targetDrop;
            const targetDropRate = store.state.ui?.column3?.targetDropRate || 0;

            if (targetDrop === 'fine_item' && targetDropRate > 0) {
                // Base item entry
                const baseSteps = stepsPerRewardRoll > 0 ? (stepsPerRewardRoll * 100) / targetDropRate : 0;
                // Fine item entry: fine rate = base_rate * 0.01 * (1 + FMF)
                const fineRate = targetDropRate * 0.01 * (1 + fineMaterialFinding);
                const fineSteps = fineRate > 0 ? (stepsPerRewardRoll * 100) / fineRate : 0;

                drops.push({
                    item_name: 'Fine Item Target',
                    item_ref: null,
                    drop_percent: targetDropRate,
                    quantity: { min: 1, max: 1, is_static: true },
                    avg_quantity: 1,
                    steps_per_item: baseSteps,
                    steps_per_fine_item: fineSteps,
                    fine_drop_percent: fineRate,
                    is_fine: false,
                    is_collectible: false,
                    source: 'synthetic_fine',
                    icon_override: '/assets/icons/attributes/fine_material_finding.svg'
                });
            }

            if (targetDrop === 'collectible' && targetDropRate > 0) {
                const effectiveRate = targetDropRate * (1 + findCollectibles);
                const collectibleSteps = effectiveRate > 0 ? (stepsPerRewardRoll * 100) / effectiveRate : 0;

                drops.push({
                    item_name: 'Collectible Target',
                    item_ref: null,
                    drop_percent: effectiveRate,
                    quantity: { min: 1, max: 1, is_static: true },
                    avg_quantity: 1,
                    steps_per_item: collectibleSteps,
                    is_fine: false,
                    is_collectible: true,
                    source: 'synthetic_collectible',
                    icon_override: '/assets/icons/slots/collectible.svg'
                });
            }
        }

        // Merge duplicate drops (same item from activity drops + equipment/item finding)
        // When an item appears in both the activity drop table and an item finding category
        // (e.g., Rough Opal from Mine Copper Ore + Gem Pouch), combine into a single entry
        const mergedDrops = this.mergeDrops(drops, stepsPerRewardRoll);

        if (_COINS_DEBUG) {
            console.log(`[COINS-DEBUG] post-merge drops (count=${mergedDrops.length}, only those with coin_value or fine_coin_value):`);
            let _runningTotal = 0;
            for (const d of mergedDrops) {
                const baseCoin = Number(d.coin_value) || 0;
                const fineCoin = Number(d.fine_coin_value) || 0;
                if (baseCoin <= 0 && fineCoin <= 0) continue;
                const baseIpk = (d.steps_per_item > 0 && isFinite(d.steps_per_item)) ? 1000 / d.steps_per_item : 0;
                const fineIpk = (d.steps_per_fine_item > 0 && isFinite(d.steps_per_fine_item)) ? 1000 / d.steps_per_fine_item : 0;
                const baseContrib = baseCoin * baseIpk;
                const fineContrib = fineCoin * fineIpk;
                const totalContrib = baseContrib + fineContrib;
                _runningTotal += totalContrib;
                console.log(`[COINS-DEBUG]   merged "${d.item_name}" ref=${d.item_ref || '-'} src=${d.source} aug_pct=${d.drop_percent} steps_per_item=${d.steps_per_item && d.steps_per_item.toFixed ? d.steps_per_item.toFixed(2) : d.steps_per_item} base_coin=${baseCoin} base_contrib=${baseContrib.toFixed(4)} fine_coin=${fineCoin} fine_contrib=${fineContrib.toFixed(4)} TOTAL=${totalContrib.toFixed(4)}`);
            }
            console.log(`[COINS-DEBUG]   running coin/1k from post-merge sum (gross, before output/materials adjustments): ${_runningTotal.toFixed(4)}`);
        }

        // Filter owned collectibles if checkbox is checked
        // Requirements: 4.7
        let filteredDrops = mergedDrops;
        if (this.hideOwnedCollectibles) {
            filteredDrops = this.filterOwnedCollectibles(mergedDrops);
        }

        // Sort by steps per item (ascending)
        // Requirements: 4.5, 4.10
        filteredDrops.sort((a, b) => a.steps_per_item - b.steps_per_item);

        return filteredDrops;
    }

    /**
     * Add equipment drops from ItemFindingCategory stats
     * @param {Array} drops - Existing drops array
     * @param {Object} column2Stats - Stats from Column 2
     * @param {number} stepsPerRewardRoll - Steps per reward roll
     * @param {Function|null} calcMaterialsPerItem - Optional function to compute materials per item (recipes only)
     * @returns {Promise<Array>} Drops array with equipment drops added
     */
    async addEquipmentDrops(drops, column2Stats, stepsPerRewardRoll, calcMaterialsPerItem = null) {
        // Collect ItemFindingCategory stats
        const itemFindingStats = {};
        for (const [statName, statValue] of Object.entries(column2Stats)) {
            if (statName.startsWith('ItemFindingCategory.')) {
                itemFindingStats[statName] = statValue;
            }
        }

        if (Object.keys(itemFindingStats).length === 0) {
            return drops;  // No equipment drops
        }

        // Call backend to expand categories
        try {
            const response = await fetch('/api/expand-equipment-drops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stats: itemFindingStats })
            });

            if (!response.ok) {
                console.error('Failed to expand equipment drops');
                return drops;
            }

            const data = await response.json();
            const equipmentDrops = data.drops || [];

            // Convert to drop format and add to drops array
            const fineMaterialFinding = (column2Stats.fine_material_finding || 0) / 100;
            // 2026-05-26 (jwbail): IF-eq drops do NOT get find_bonus applied to
            // their chance — their chance_percent already reflects the IF
            // stat value directly. This matches the worker's
            // util/autogenerated/activities.py:get_expected_drop_rate
            // semantics where `is_equipment_drop` skips the find_bonus
            // block entirely. The previous attempt (commit e5bbe34) applied
            // chest_finding/find_collectibles/find_bird_nests/find_gems to
            // IF-eq drops, which over-boosted Fishing chest (column-3 vs
            // worker: 15.74 vs 15.36) while still missing coin_value on the
            // 11 non-fishing skill chests. The correct fix is two-fold:
            //   (1) here: leave IF-eq chance untouched (this revert)
            //   (2) backend /api/expand-equipment-drops: populate
            //       coin_value for Container.* refs from CHEST_COIN_VALUES
            // With both, column-3 coins/1k matches the worker.

            for (const eqDrop of equipmentDrops) {
                const dropPercent = eqDrop.chance_percent;
                const avgQuantity = (eqDrop.min_qty + eqDrop.max_qty) / 2.0;

                // No find_bonus for IF-eq drops — see comment above.
                const boostedDropPercent = dropPercent;

                // Calculate steps per item using raw drop rate
                const stepsPerItem = (stepsPerRewardRoll * 100) / (boostedDropPercent * avgQuantity);

                if (window.DEBUG_COINS) {
                    const _coin = Number(eqDrop.coin_value) || 0;
                    const _ipk = stepsPerItem > 0 ? 1000 / stepsPerItem : 0;
                    const _contrib = _coin * _ipk;
                    console.log(`[COINS-DEBUG]   IF-eq drop name="${eqDrop.item_name}" ref=${eqDrop.item_ref || '-'} base_pct=${dropPercent} (no find_bonus on IF-eq) avgQty=${avgQuantity} steps_per_item=${stepsPerItem.toFixed(2)} coin_value=${_coin} items_per_1k=${_ipk.toFixed(4)} coin_contrib_per_1k=${_contrib.toFixed(4)}`);
                }

                // Check if has fine version
                const hasFineVersion = eqDrop.has_fine_material;
                let stepsPerFineItem = null;
                let augmentedFineDropPercent = null;

                if (hasFineVersion) {
                    const fineDropPercent = dropPercent * 0.01;
                    augmentedFineDropPercent = fineDropPercent * (1 + fineMaterialFinding);
                    stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * avgQuantity);
                }

                drops.push({
                    item_name: eqDrop.item_name,
                    item_ref: eqDrop.item_ref,
                    // Store BOOSTED drop_percent so mergeDrops's recompute
                    // (steps = stepsPerRewardRoll * 100 / (drop_percent *
                    // avgQuantity)) uses the find-bonus-aware value.
                    // Without this, mergeDrops would overwrite stepsPerItem
                    // back to the base rate when an IF chest also exists
                    // in the activity drop_table.
                    drop_percent: boostedDropPercent,
                    quantity: { min: eqDrop.min_qty, max: eqDrop.max_qty },
                    avg_quantity: avgQuantity,
                    steps_per_item: stepsPerItem,
                    steps_per_fine_item: stepsPerFineItem,
                    fine_drop_percent: augmentedFineDropPercent,
                    is_fine: false,
                    is_collectible: false,
                    coin_value: eqDrop.coin_value || 0,
                    shell_value: eqDrop.shell_value || 0,
                    fine_shell_value: eqDrop.fine_shell_value || 0,
                    fine_ag_token_value: eqDrop.fine_ag_token_value || 0,
                    special_sell: eqDrop.special_sell || null,
                    source: 'equipment',
                    materials_per_item: calcMaterialsPerItem ? calcMaterialsPerItem(stepsPerItem) : null,
                });
            }
        } catch (error) {
            console.error('Error expanding equipment drops:', error);
        }

        return drops;
    }

    /**
     * Merge duplicate drops that appear from multiple sources.
     * When an item appears in both the activity drop table and an item finding category
     * (e.g., Rough Opal from Mine Copper Ore activity + Gem Pouch equipment),
     * combine them into a single entry with summed drop percentages.
     * @param {Array} drops - All collected drops (may contain duplicates)
     * @param {number} stepsPerRewardRoll - Steps per reward roll for recalculating steps
     * @returns {Array} Deduplicated drops array
     */
    mergeDrops(drops, stepsPerRewardRoll) {
        const mergeMap = new Map();  // key -> merged drop object

        for (const drop of drops) {
            // Use item_ref as the primary key, fall back to item_name
            // Chests, synthetic entries, and recipe drops should never merge
            const skipMerge = drop.source === 'chest' ||
                drop.source === 'synthetic_fine' ||
                drop.source === 'synthetic_collectible' ||
                drop.source === 'recipe_drop';
            const key = skipMerge ? null : (drop.item_ref || drop.item_name);

            if (!key || !mergeMap.has(key)) {
                // First occurrence or non-mergeable — use a unique key for non-mergeables
                const mapKey = key || `__unique_${mergeMap.size}`;
                mergeMap.set(mapKey, { ...drop });
            } else {
                // Duplicate found — merge by combining contributions to
                // expected-items-per-reward-roll. The naive "sum the
                // percentages, reuse one qty" approach is wrong when the
                // merged sources drop the same item at different
                // quantities (e.g. Wreck diving's Sea shell: regular
                // drop_table is 44.94% × 10-15 qty, IF expansion via
                // Flatpack shark is 5% × 1-10 qty). Sea shells per
                // reward roll = 0.4494*12.5 + 0.05*5.5 = 5.892, NOT
                // 0.4994*12.5 = 6.243 (or 0.4994*5.5 = 2.747 depending
                // which qty the merge picked). Steps per item =
                // stepsPerRewardRoll / total_items_per_roll. Equivalent
                // to the worker's harmonic mean of two steps_per_item
                // values, generalized to N sources via
                // 1/combined_steps = Σ 1/steps_i.
                const existing = mergeMap.get(key);

                // Initialize the running items-per-roll total on the
                // first merge by seeding from the existing entry's
                // already-recorded contribution.
                const existingQty = existing.avg_quantity ||
                    this.calculateAverageQuantity(existing.quantity);
                const newQty = drop.avg_quantity ||
                    this.calculateAverageQuantity(drop.quantity);
                if (existing._merged_items_per_roll == null) {
                    existing._merged_items_per_roll =
                        ((existing.drop_percent || 0) / 100) * existingQty;
                    existing._merged_fine_items_per_roll =
                        ((existing.fine_drop_percent || 0) / 100) * existingQty;
                }
                existing._merged_items_per_roll +=
                    ((drop.drop_percent || 0) / 100) * newQty;
                if (drop.fine_drop_percent) {
                    existing._merged_fine_items_per_roll +=
                        (drop.fine_drop_percent / 100) * newQty;
                }

                // Sum drop percentages for the displayed combined chance.
                existing.drop_percent = (existing.drop_percent || 0) + (drop.drop_percent || 0);

                // Recalculate steps_per_item from total expected
                // items per reward roll. Independent of which single
                // qty the merge "picked".
                if (existing._merged_items_per_roll > 0) {
                    existing.steps_per_item = stepsPerRewardRoll / existing._merged_items_per_roll;
                    if (existing.item_ref && existing.item_ref.startsWith('Container.') && !existing.item_ref.includes('BIRD_NEST')) {
                        console.log(`[CHEST-DEBUG] mergeDrops ${existing.item_name}: combined_pct=${formatFixed(existing.drop_percent, 6)}, items_per_roll=${formatFixed(existing._merged_items_per_roll, 6)}, stepsPerRewardRoll=${formatFixed(stepsPerRewardRoll, 4)}, merged_steps=${formatFixed(existing.steps_per_item, 2)}`);
                    }
                }

                // Merge fine drop percentages.
                if (drop.fine_drop_percent) {
                    existing.fine_drop_percent = (existing.fine_drop_percent || 0) + drop.fine_drop_percent;
                    if (existing._merged_fine_items_per_roll > 0) {
                        existing.steps_per_fine_item = stepsPerRewardRoll / existing._merged_fine_items_per_roll;
                    }
                }

                // Update displayed qty range to the UNION of merged
                // sources so e.g. Sea shell shows "1-15" (1 from IF
                // expansion's min, 15 from regular drop's max) rather
                // than just whichever side was first/last.
                if (existing.quantity && drop.quantity) {
                    const eMin = existing.quantity.min ?? existingQty;
                    const eMax = existing.quantity.max ?? existingQty;
                    const dMin = drop.quantity.min ?? newQty;
                    const dMax = drop.quantity.max ?? newQty;
                    existing.quantity = {
                        min: Math.min(eMin, dMin),
                        max: Math.max(eMax, dMax),
                    };
                    existing.avg_quantity = (existing.quantity.min + existing.quantity.max) / 2;
                }

                // Keep the higher coin value
                if (drop.coin_value && (!existing.coin_value || drop.coin_value > existing.coin_value)) {
                    existing.coin_value = drop.coin_value;
                }
                if (drop.fine_coin_value && (!existing.fine_coin_value || drop.fine_coin_value > existing.fine_coin_value)) {
                    existing.fine_coin_value = drop.fine_coin_value;
                }

                // Keep special_sell if either has it
                if (drop.special_sell && !existing.special_sell) {
                    existing.special_sell = drop.special_sell;
                }

                // Recalculate materials_per_item if present
                if (existing.materials_per_item != null && drop.materials_per_item != null) {
                    // materials_per_item is proportional to steps_per_item, so recalculate
                    // from the ratio: new_mpi = old_mpi * (new_steps / old_steps)
                    // But simpler: if we have the calcMaterialsPerItem function context,
                    // we'd call it. Since we don't, leave the existing value — it will be
                    // close enough since the dominant source usually has the right ratio.
                }

                // Mark source as 'combined' so we know it was merged
                existing.source = 'combined';
            }
        }

        return Array.from(mergeMap.values());
    }

    /**
     * Calculate average quantity from quantity object
     * @param {Object} quantity - Quantity object with min, max, is_static
     * @returns {number} Average quantity
     */
    calculateAverageQuantity(quantity) {
        if (!quantity || quantity.min === null || quantity.max === null) {
            return 1;
        }

        if (quantity.is_static) {
            return quantity.min;
        }

        return (quantity.min + quantity.max) / 2;
    }

    /**
     * Calculate chest drop rate with Chest Finding bonus
     * Requirements: 4.8, 4.9
     * @returns {number} Chest drop rate percentage
     */
    calculateChestRate() {
        const baseRate = 0.4;  // 0.4% per reward roll

        // Get Chest Finding stat from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};
        const chestFinding = (column2Stats.chest_finding || 0) / 100;  // Convert to decimal

        // Display rate only includes Chest Finding — DR affects steps calculation separately
        const rate = baseRate * (1 + chestFinding);

        return rate;
    }

    /**
     * Filter out owned collectibles
     * Requirements: 4.7
     * @param {Array} drops - Array of drop objects
     * @returns {Array} Filtered drops
     */
    filterOwnedCollectibles(drops) {
        const character = store.state.character || {};
        const ownedCollectibles = character.collectibles || [];

        // Convert owned collectibles to lowercase for case-insensitive comparison
        const ownedCollectiblesLower = ownedCollectibles.map(c => c.toLowerCase());

        console.log('Filtering collectibles:', {
            ownedCollectibles,
            totalDrops: drops.length,
            collectibleDrops: drops.filter(d => d.is_collectible).length
        });

        return drops.filter(drop => {
            if (!drop.is_collectible) {
                return true;
            }

            // Check if collectible is owned
            // item_ref format: "Collectible.COLLECTIBLE_NAME"
            const collectibleName = drop.item_ref.replace('Collectible.', '');
            const collectibleNameLower = collectibleName.toLowerCase();
            const isOwned = ownedCollectiblesLower.includes(collectibleNameLower);

            console.log(`Collectible "${drop.item_name}" (${collectibleName}): owned=${isOwned}`);

            return !isOwned;
        });
    }

    /**
     * Get current stats for calculations
     * @returns {Object} Stats object
     */
    getCurrentStats() {
        if (!this.dropSource) {
            return {
                stepsPerRewardRoll: 0
            };
        }

        // Get gear stats
        const gearStats = this.getGearStats();

        // Calculate steps per reward roll based on source type
        if (this.sourceType === 'activity') {
            const baseSteps = this.dropSource.base_steps;
            const maxEfficiency = this.dropSource.max_efficiency;
            const we = gearStats.work_efficiency || 0;
            const da = gearStats.double_action || 0;
            const dr = gearStats.double_rewards || 0;
            const flat = gearStats.flat_steps || 0;
            const pct = gearStats.percent_steps || 0;

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain. Applying ceil before the pct multiplier introduces
            // off-by-one errors (e.g. Flowing pocketwatch -5%).
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseOverEff = baseSteps / totalEfficiency;
            const stepsWithPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));

            // Calculate steps per reward roll (keep as number for calculations)
            const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

            console.log(`[CHEST-DEBUG] getCurrentStats: we=${formatFixed(we, 4)}, da=${formatFixed(da, 4)}, dr=${formatFixed(dr, 4)}, flat=${flat}, pct=${formatFixed(pct, 4)}, cappedWE=${formatFixed(cappedWE, 4)}, stepsPerSingle=${stepsPerSingleAction}, stepsPerRewardRoll=${formatFixed(stepsPerRewardRoll, 4)}`);

            return {
                stepsPerRewardRoll: stepsPerRewardRoll
            };
        } else if (this.sourceType === 'recipe') {
            // For recipes, DR still applies to secondary drops (ectoplasm, etc.)
            const baseSteps = this.dropSource.base_steps;
            const maxEfficiency = this.dropSource.max_efficiency;
            const we = gearStats.work_efficiency || 0;
            const da = gearStats.double_action || 0;
            const dr = gearStats.double_rewards || 0;
            const flat = gearStats.flat_steps || 0;
            const pct = gearStats.percent_steps || 0;

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain.
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseOverEff = baseSteps / totalEfficiency;
            const withPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);

            // Apply DR and DA — reward rolls work the same for secondary drops
            const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

            console.log(`[BUG2-SINGLE-STATS] baseSteps=${baseSteps}, maxEff=${maxEfficiency}, we=${formatFixed(we, 4)}, da=${formatFixed(da, 4)}, dr=${formatFixed(dr, 4)}, flat=${flat}, pct=${formatFixed(pct, 4)}, stepsPerAction=${stepsPerSingleAction}, stepsPerReward=${formatFixed(stepsPerRewardRoll, 4)}`);

            return {
                stepsPerRewardRoll: stepsPerRewardRoll
            };
        }

        return {
            stepsPerRewardRoll: 0
        };
    }

    /**
     * Get instant-actions pet info if the checkbox is checked and pet is eligible.
     * Returns null if not active.
     */
    _getActiveInstantActionsPet() {
        const ownedItems = store.state.items || {};
        const userOverrideItems = store.state.ui?.user_overrides?.items || {};
        const petCatalog = window.optimizeButton?._petCatalog || [];
        if (!petCatalog.length) return null;

        let skillType = null;
        if (this.sourceType === 'activity') {
            skillType = (this.dropSource?.primary_skill || this.dropSource?.skill || '').toLowerCase();
        } else if (this.sourceType === 'recipe') {
            skillType = (this.dropSource?.skill || '').toLowerCase();
            // For smithing, only show for smelting recipes
            if (skillType === 'smithing') {
                const recipeName = this.dropSource?.name || '';
                if (!SMELTING_RECIPE_NAMES.has(recipeName)) return null;
            }
        }
        if (!skillType) return null;

        const petInfo = getInstantActionsPet(skillType, ownedItems, petCatalog, userOverrideItems);
        if (!petInfo) return null;

        // Check if checkbox is checked
        const uiState = store.state.ui || {};
        const isChecked = skillType === 'foraging'
            ? !!(uiState.instant_actions_foraging)
            : (skillType === 'smithing' || skillType === 'smelting')
                ? !!(uiState.instant_actions_smelting)
                : false;
        if (!isChecked) return null;

        // Get the pet's icon path using the user's current level/variant
        const petId = petInfo.petId;
        const itemState = ownedItems[petId] || null;
        const overrideState = userOverrideItems[petId] || null;
        const level = overrideState?.level ?? itemState?.level ?? petInfo.requiredLevel;
        const variant = overrideState?.variant ?? itemState?.variant ?? 'normal';
        const maxLevel = petCatalog.find(p => p.id === petId)?.max_level || 0;
        const iconPath = getPetIconPath(petInfo.species, level, variant, maxLevel);

        return { ...petInfo, iconPath, level };
    }

    /**
     * Calculate expected output on one charge for a drop.
     * charge_count × (1 + DA) × (1 + DR) × drop_rate × avg_quantity
     */
    _calcExpectedOutputPerCharge(drop, petInfo) {
        const gearStats = this.getGearStats();
        const da = gearStats.double_action || 0;
        const dr = gearStats.double_rewards || 0;
        const chargeCount = petInfo.count || 5;
        const dropRate = (drop.drop_percent || 0) / 100;
        const avgQty = drop.avg_quantity || 1;
        return chargeCount * (1 + da) * (1 + dr) * dropRate * avgQty;
    }

    /**
     * Format a pet's expected output-per-activation as "activations PER item"
     * (the reciprocal) so the instant-actions row matches the steps-per-item /
     * materials-per-item convention. Mirrors the materials-per-item number
     * formatting; unobtainable drops (expected output ≤ 0) render as ∞.
     * @param {number} expectedPerActivation - items produced per pet activation
     * @returns {string}
     */
    _formatPerActivation(expectedPerActivation) {
        if (!isFinite(expectedPerActivation) || expectedPerActivation <= 0) return '∞';
        const perItem = 1 / expectedPerActivation;
        return perItem < 10
            ? formatFixed(perItem, 2, { trim: true })
            : perItem < 100
                ? formatFixed(perItem, 1, { trim: true })
                : Math.ceil(perItem).toLocaleString();
    }

    /**
     * Get gear stats for the selected activity/recipe and location
     * Requirements: 4.3, 4.5, 4.8, 4.9
     * Reads from Column 2 combined stats
     * @returns {Object} Gear stats
     */
    getGearStats() {
        // Get combined stats from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        if (!combinedStatsSection) {
            // Column 2 not available, return empty stats
            return {
                work_efficiency: 0,
                double_action: 0,
                double_rewards: 0,
                no_materials_consumed: 0,
                flat_steps: 0,
                percent_steps: 0,
                chest_finding: 0
            };
        }

        // Get the cached stats from Column 2
        const stats = combinedStatsSection.cachedStats || {};

        // Extract relevant stats for drops
        return {
            work_efficiency: (stats.work_efficiency || 0) / 100,  // Convert from percentage to decimal
            double_action: (stats.double_action || 0) / 100,
            double_rewards: (stats.double_rewards || 0) / 100,
            no_materials_consumed: (stats.no_materials_consumed || 0) / 100,
            flat_steps: stats.flat_steps || stats.steps_add || 0,
            percent_steps: (stats.steps_percent || stats.steps_pct || 0) / 100,
            chest_finding: (stats.chest_finding || 0) / 100  // Convert from percentage to decimal
        };
    }

    /**
     * Render filter checkboxes
     * Requirements: 4.2
     * @returns {string} HTML for filter checkboxes
     */
    /**
     * Calculate currency earned per 1000 steps from all drops, and build a
     * per-component breakdown so the coins/1k-steps pill can render an
     * expandable dropdown with output / side drops / materials / chests.
     *
     * Coins (net): (output + side drops + chests) - materials cost.
     * AG tokens: sum of (items_per_1k_steps * ag_token_quantity) for drops
     * with AG token special_sell or direct AG token drops.
     * Sea shells: sum of (items_per_1k_steps * shell_value) for direct
     * sea shell drops, fine sea shells (shell_value=10 via special_sell),
     * and shell-bearing chests (Coral/Sunken/Chest of Syrenthia, value
     * from CHEST_SHELL_VALUES). Mirrors the optimizer's cat:sea_shells
     * synthetic — see util/shell_value.py for the math.
     *
     * Breakdown object:
     *   output:      coins/1k from output_synthetic (recipes only; 0 for activities)
     *   sideDrops:   coins/1k from non-chest, non-output, non-synthetic drops
     *   sideEntries: [{ drop, coinsPer1k }] for each non-chest drop contributing
     *                to sideDrops — used to pick an icon (single-drop vs DR-icon)
     *   chests:      coins/1k from chest drops (source === 'chest')
     *   materials:   POSITIVE coin cost to subtract (recipes only; 0 for activities)
     *   materialsEntries: materials_entries from the materials_synthetic row
     */
    calculateCurrencyPer1kSteps(drops) {
        let agTokensPer1k = 0;
        let shellsPer1k = 0;
        const breakdown = {
            output: 0,
            sideDrops: 0,
            sideEntries: [],
            chests: 0,
            // 2026-05-26 (jwbail): track per-chest entries so the breakdown
            // popover can pick the right icon — single chest uses that
            // chest's specific icon (e.g. fishing_chest.svg), multiple
            // chests use the generic keywords/chest.svg.
            chestEntries: [],
            materials: 0,
            materialsEntries: [],
        };

        for (const drop of drops) {
            // Materials synthetic row: cost to subtract (positive in breakdown,
            // rendered with a minus sign in the UI). Skip the rest of the loop
            // body for this row — it isn't a real drop.
            if (drop.source === 'materials_synthetic') {
                breakdown.materials += Number(drop.materials_cost_per_1k) || 0;
                if (Array.isArray(drop.materials_entries)) {
                    breakdown.materialsEntries = drop.materials_entries;
                }
                continue;
            }

            if (!drop.steps_per_item || drop.steps_per_item <= 0) continue;
            // Skip fine items to avoid double-counting
            if (drop.is_fine) continue;

            const itemsPer1kSteps = 1000.0 / drop.steps_per_item;

            let dropCoins = 0;

            // Coins from selling base item
            if (drop.coin_value && drop.coin_value > 0) {
                dropCoins += itemsPer1kSteps * drop.coin_value;
            }

            // Coins from selling fine version (if this drop has a fine variant)
            if (drop.fine_coin_value && drop.fine_coin_value > 0 && drop.steps_per_fine_item && drop.steps_per_fine_item > 0) {
                const fineItemsPer1kSteps = 1000.0 / drop.steps_per_fine_item;
                dropCoins += fineItemsPer1kSteps * drop.fine_coin_value;
            }

            if (dropCoins > 0) {
                // Route chest drops into the chests bucket regardless of
                // how the build path tagged them. Activity drop-table
                // entries carry source='primary'/'secondary' but may
                // still be Container.* refs (skill chests in an activity
                // wiki drop table), so an explicit item_ref check is
                // needed to keep activities' chest coins out of the
                // sideDrops row and onto the chests row.
                const isChestDrop = drop.source === 'chest' ||
                    (drop.item_ref && drop.item_ref.startsWith('Container.'));
                if (drop.source === 'output_synthetic') {
                    breakdown.output += dropCoins;
                } else if (isChestDrop) {
                    breakdown.chests += dropCoins;
                    breakdown.chestEntries.push({ drop, coinsPer1k: dropCoins });
                    if (window.DEBUG_COINS) {
                        console.log(`[COINS-DEBUG]   CHEST contrib name="${drop.item_name}" ref=${drop.item_ref || '-'} src=${drop.source} steps_per_item=${drop.steps_per_item && drop.steps_per_item.toFixed ? drop.steps_per_item.toFixed(2) : drop.steps_per_item} base_coin=${drop.coin_value || 0} fine_coin=${drop.fine_coin_value || 0} dropCoins=${dropCoins.toFixed(4)}`);
                    }
                } else {
                    breakdown.sideDrops += dropCoins;
                    breakdown.sideEntries.push({ drop, coinsPer1k: dropCoins });
                }
            }

            // AG tokens - either direct drop or special_sell
            if (drop.special_sell && drop.special_sell.currency === 'ag_token') {
                agTokensPer1k += itemsPer1kSteps * drop.special_sell.quantity;
            }
            // Fine-variant AGT (e.g. Adventurers' enamel pin: base 2 AGT,
            // fine 10 AGT). The separate fine drop row is skipped above via
            // `is_fine` to avoid double-counting, so its AGT contribution is
            // re-added here from the base row — same pattern as coins
            // (fine_coin_value) and shells (fine_shell_value). Bug 7ee43a0c.
            if (drop.fine_ag_token_value && drop.fine_ag_token_value > 0
                    && drop.steps_per_fine_item && drop.steps_per_fine_item > 0) {
                const fineItemsPer1kSteps = 1000.0 / drop.steps_per_fine_item;
                const baseAgtQty = (drop.special_sell && drop.special_sell.currency === 'ag_token')
                    ? drop.special_sell.quantity : 0;
                // A fine drop REPLACES a normal drop, so net gain is (fine_qty - base_qty).
                agTokensPer1k += fineItemsPer1kSteps * (drop.fine_ag_token_value - baseAgtQty);
            }

            // Sea shells - direct shell drops, fine shells (special_sell
            // qty=10 → shell_value=10), and shell-bearing chests
            // (Coral/Sunken/Chest of Syrenthia from CHEST_SHELL_VALUES).
            // Mirrors the optimizer's cat:sea_shells synthetic. The
            // backend (_get_drop_currency_info, _enrich_recipe_drop,
            // expand_equipment_drops) populates shell_value on every
            // shell-yielding drop and fine_shell_value on direct
            // Material.SEA_SHELL drops (used with steps_per_fine_item).
            if (drop.shell_value && drop.shell_value > 0) {
                shellsPer1k += itemsPer1kSteps * drop.shell_value;
            }
            if (drop.fine_shell_value && drop.fine_shell_value > 0
                    && drop.steps_per_fine_item && drop.steps_per_fine_item > 0) {
                const fineItemsPer1kSteps = 1000.0 / drop.steps_per_fine_item;
                shellsPer1k += fineItemsPer1kSteps * drop.fine_shell_value;
            }
        }

        const coinsPer1k =
            breakdown.output + breakdown.sideDrops + breakdown.chests - breakdown.materials;

        if (window.DEBUG_COINS) {
            console.log(`[COINS-DEBUG] calculateCurrencyPer1kSteps breakdown: output=${breakdown.output.toFixed(4)} sideDrops=${breakdown.sideDrops.toFixed(4)} chests=${breakdown.chests.toFixed(4)} materials=${breakdown.materials.toFixed(4)} => coinsPer1k=${coinsPer1k.toFixed(4)}`);
            if (breakdown.sideEntries && breakdown.sideEntries.length > 0) {
                console.log(`[COINS-DEBUG]   sideEntries (${breakdown.sideEntries.length}):`);
                for (const s of breakdown.sideEntries) {
                    console.log(`[COINS-DEBUG]     side "${s.drop && s.drop.item_name}" ref=${(s.drop && s.drop.item_ref) || '-'} coinsPer1k=${(Number(s.coinsPer1k) || 0).toFixed(4)}`);
                }
            }
        }

        return { coinsPer1k, agTokensPer1k, shellsPer1k, breakdown };
    }

    /**
     * Resolve an icon path for a given drop row (output / side drop / chest).
     * Mirrors the logic in renderDropItem so the breakdown popover can reuse
     * the same icon for each component. Kept narrow — it handles the synthetic
     * output row, chest rows, currency/material/item/consumable/container
     * refs, and icon_override fallbacks.
     */
    _iconPathForDrop(drop) {
        if (!drop) return '';
        if (drop.icon_override) return drop.icon_override;
        if (drop.source === 'chest') {
            const skill = (drop.primary_skill || 'chest').toLowerCase();
            return `/assets/icons/items/containers/${skill}_chest.svg`;
        }
        if (drop.item_name === 'Coins') {
            return '/assets/icons/items/coins.svg';
        }
        if (drop.item_ref) {
            const [type] = drop.item_ref.split('.');
            const iconName = (drop.item_name || '').toLowerCase().replace(/ /g, '_');
            switch (type) {
                case 'Currency':    return `/assets/icons/items/${iconName}.svg`;
                case 'Material':    return `/assets/icons/items/materials/${iconName}.svg`;
                case 'Item':        return `/assets/icons/items/equipment/${iconName}.svg`;
                case 'Collectible': return `/assets/icons/items/collectibles/${iconName}.svg`;
                case 'Consumable':  return `/assets/icons/items/consumables/${iconName}.svg`;
                case 'Container':   return `/assets/icons/items/containers/${iconName}.svg`;
                case 'Egg':         return `/assets/icons/items/pet_eggs/${iconName}.svg`;
                default: break;
            }
        }
        if (drop.item_name) {
            const n = drop.item_name.toLowerCase().replace(/ /g, '_');
            if (n.endsWith('_egg')) return `/assets/icons/items/pet_eggs/${n}.svg`;
            return `/assets/icons/items/materials/${n}.svg`;
        }
        return '';
    }

    /**
     * Resolve an icon path for a material entry (materials_entries[*]).
     * Materials are always under /assets/icons/items/materials/ with the
     * server-supplied lowercase `material_icon_name` (apostrophes retained).
     */
    _iconPathForMaterial(mat) {
        const n = mat?.material_icon_name || (mat?.material_name || '')
            .toLowerCase().replace(/ /g, '_');
        if (!n) return '';
        if (mat.type === 'consumable') return `/assets/icons/items/consumables/${n}.svg`;
        if (mat.type === 'equipment')  return `/assets/icons/items/equipment/${n}.svg`;
        return `/assets/icons/items/materials/${n}.svg`;
    }

    /**
     * Format a currency value: 2 decimal places, truncate trailing zeros and decimal
     */
    formatCurrencyValue(value) {
        return formatFixed(value, 2, { trim: true });
    }

    /**
     * Build one row of the breakdown dropdown.
     * sign: '+' or '-'; applied as a CSS class (is-positive / is-negative)
     * and as a prefix on the value text.
     * isAttributeIcon: when true, the icon is treated as a stat/attribute
     * glyph (like the DR double-rewards icon) and rendered at 30px with
     * 1px margin to match the 32px item/material/chest icons.
     */
    _breakdownRow({ iconPath, value, sign, alt, isAttributeIcon }) {
        const cls = sign === '-' ? 'is-negative' : 'is-positive';
        const prefix = sign === '-' ? '-' : '+';
        const iconClass = isAttributeIcon
            ? 'currency-breakdown-icon is-attribute'
            : 'currency-breakdown-icon';
        return `
            <div class="currency-breakdown-row ${cls}">
                <img src="${iconPath}" alt="${alt || ''}" class="${iconClass}" />
                <span class="currency-breakdown-value">${prefix}${this.formatCurrencyValue(Math.abs(value))}</span>
            </div>
        `;
    }

    /**
     * Render the currency summary row (coins and AG tokens per 1k steps)
     * plus a click-to-expand breakdown dropdown under the coins pill.
     *
     * Breakdown layout, per recipe/activity semantics:
     *   - Output row   (recipes only, if output_synthetic was emitted)
     *   - Side drops   (if any non-chest drops contribute)
     *   - Materials    (recipes only, NEGATIVE — consumed materials cost)
     *   - Chests       (if any chest drops contribute)
     *
     * Side drops icon: use the single drop's icon if exactly one side drop
     * contributes; otherwise use the DR stat icon (double_rewards).
     */
    renderCurrencySummary(drops) {
        const { coinsPer1k, agTokensPer1k, shellsPer1k, breakdown } = this.calculateCurrencyPer1kSteps(drops);

        // Only show if there's something to display
        if (coinsPer1k <= 0 && agTokensPer1k <= 0 && shellsPer1k <= 0) return '';

        let pills = '';

        if (coinsPer1k > 0) {
            const hasBreakdown = (breakdown.output > 0)
                || (breakdown.sideDrops > 0)
                || (breakdown.chests > 0)
                || (breakdown.materials > 0);

            // Build breakdown rows only if at least one meaningful component
            // exists. For activities without materials the pill still gets
            // a dropdown showing drops + chests.
            let rowsHtml = '';

            if (breakdown.output > 0) {
                // Output row uses the output_synthetic drop's icon — look it
                // up via the drops list, falling back to dropSource.icon_path.
                const outputDrop = drops.find(d => d.source === 'output_synthetic');
                const iconPath = outputDrop
                    ? this._iconPathForDrop(outputDrop)
                    : (this.dropSource.icon_path || '');
                rowsHtml += this._breakdownRow({
                    iconPath,
                    value: breakdown.output,
                    sign: '+',
                    alt: outputDrop?.item_name || 'Output',
                });
            }

            if (breakdown.sideDrops > 0) {
                let iconPath;
                let alt = 'Side drops';
                let isAttributeIcon = false;
                if (breakdown.sideEntries.length === 1) {
                    // Single side drop → use that drop's own icon.
                    const only = breakdown.sideEntries[0].drop;
                    iconPath = this._iconPathForDrop(only);
                    alt = only.item_name || 'Drop';
                } else {
                    // Multiple side drops → use the DR (double_rewards) icon.
                    // DR is a 20-native stat icon; render at 30px + 1px margin
                    // to visually align with the 32-native item icons.
                    iconPath = '/assets/icons/attributes/double_rewards.svg';
                    isAttributeIcon = true;
                }
                rowsHtml += this._breakdownRow({
                    iconPath,
                    value: breakdown.sideDrops,
                    sign: '+',
                    alt,
                    isAttributeIcon,
                });
            }

            if (breakdown.materials > 0) {
                // Materials row uses the icon of the specific consumed
                // material in the selected group. If there are multiple
                // materials in the group we pick the highest-cost entry —
                // that's what the user is most "paying" each craft.
                let matIcon = '';
                let matAlt = 'Materials';
                const mats = breakdown.materialsEntries || [];
                if (mats.length > 0) {
                    const top = mats
                        .slice()
                        .sort((a, b) => (b.value * b.quantity) - (a.value * a.quantity))[0];
                    matIcon = this._iconPathForMaterial(top);
                    matAlt = top.material_name || 'Materials';
                }
                rowsHtml += this._breakdownRow({
                    iconPath: matIcon,
                    value: breakdown.materials,
                    sign: '-',
                    alt: matAlt,
                });
            }

            if (breakdown.chests > 0) {
                // 2026-05-26 (jwbail): Pick the chest icon based on how many
                // distinct chests contribute. The earlier code only matched
                // recipe-path drops (source='chest') and fell back to a
                // non-existent /assets/icons/items/containers/chest.svg
                // (404). For activities, chest drops carry source='primary'
                // / 'secondary' / 'equipment' / 'combined' and are routed
                // into the chests bucket via item_ref.startsWith('Container.').
                //
                //   - 1 chest contributing → use that chest's specific icon
                //     (skill chest icon like fishing_chest.svg).
                //   - 2+ chests → use the generic keyword chest icon so the
                //     pill doesn't favor any one chest visually.
                let iconPath;
                let alt = 'Chests';
                const ce = breakdown.chestEntries || [];
                if (ce.length === 1) {
                    const only = ce[0].drop;
                    iconPath = this._iconPathForDrop(only);
                    alt = only.item_name || 'Chest';
                } else if (ce.length > 1) {
                    iconPath = '/assets/icons/keywords/chest.svg';
                } else {
                    // Recipe path: chest synthetic uses source='chest'.
                    const chestDrop = drops.find(d => d.source === 'chest');
                    iconPath = chestDrop
                        ? this._iconPathForDrop(chestDrop)
                        : '/assets/icons/keywords/chest.svg';
                }
                rowsHtml += this._breakdownRow({
                    iconPath,
                    value: breakdown.chests,
                    sign: '+',
                    alt,
                });
            }

            const pillClass = hasBreakdown
                ? 'currency-pill currency-pill-coins has-breakdown'
                : 'currency-pill currency-pill-coins';
            const caretHtml = hasBreakdown
                ? `<span class="expand-arrow">▼</span>`
                : '';

            pills += `
                <div class="currency-pill-wrap">
                    <div class="${pillClass}" role="${hasBreakdown ? 'button' : 'presentation'}" tabindex="${hasBreakdown ? '0' : '-1'}" aria-expanded="false" title="Coins per 1k steps (net — drops minus materials + chests)">
                        <img src="/assets/icons/items/coins.svg" alt="Coins" class="currency-pill-icon" />
                        <span class="currency-pill-value">${this.formatCurrencyValue(coinsPer1k)}</span>
                        ${caretHtml}
                    </div>
                </div>
            `;

            // Stash the row HTML so the click handler can build the
            // floating panel on demand — no inline panel mounted. The
            // panel is appended to <body> at open time so it can flip
            // up when there isn't room below the pill.
            this._coinsBreakdownRowsHtml = hasBreakdown ? rowsHtml : '';
        }

        if (agTokensPer1k > 0) {
            pills += `
                <div class="currency-pill">
                    <img src="/assets/icons/items/adventurers'_guild_token.svg" alt="AG Tokens" class="currency-pill-icon" title="Adventurers' Guild Tokens per 1k steps" />
                    <span class="currency-pill-value">${this.formatCurrencyValue(agTokensPer1k)}</span>
                </div>
            `;
        }

        // Sea shells pill — same shape as AGT (icon + value, no
        // breakdown popover). Rolls up direct sea shell drops, fine
        // shells (×10), and shell-bearing chests (Coral chest,
        // Sunken chest, Chest of Syrenthia). Renders after AGT when
        // both apply; the parent .currency-summary flex container
        // wraps so multiple pills line up neatly on narrow viewports.
        if (shellsPer1k > 0) {
            pills += `
                <div class="currency-pill">
                    <img src="/assets/icons/items/materials/sea_shell.svg" alt="Sea Shells" class="currency-pill-icon" title="Sea shells per 1k steps (incl. chests + fine shells folded as 10x)" />
                    <span class="currency-pill-value">${this.formatCurrencyValue(shellsPer1k)}</span>
                </div>
            `;
        }

        return `
            <div class="currency-summary">
                ${pills}
                <span class="currency-per-label">/1k</span>
                <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="currency-steps-icon" />
            </div>
        `;
    }

    renderFilterCheckboxes() {
        return `
            <div class="drops-filters">
                <label class="drops-filter-checkbox">
                    <input type="checkbox" ${this.hideOwnedCollectibles ? 'checked' : ''} data-filter="hide-owned" />
                    <span>Hide owned collectibles</span>
                </label>
            </div>
        `;
    }

    /**
     * Render per-segment travel drops in the standard DROPS card.
     */
    renderTravelDrops() {
        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;
        const statsData = store.state.column3?.travelStatsData;
        const segments = (statsData && statsData.segments) || [];
        const dropsTotal = (statsData && statsData.drops_total) || null;

        let bodyHtml;
        if (!segments.length) {
            bodyHtml = `<div class="drops-empty-hint" style="padding: var(--spacing-sm); color: var(--text-muted); font-size: 0.9em;">Select a start and end location to see travel drops.</div>`;
        } else {
            const multi = segments.length > 1;

            // Whole-route TOTAL section (always shown, labeled). Its drops carry
            // whole-route steps/item + a cumulative whole-route % (expected count
            // over the ENTIRE route, not per action).
            let totalHtml = '';
            if (dropsTotal && (dropsTotal.drops || []).length) {
                const totalCards = dropsTotal.drops.map(d => this.renderTravelDropCard(d)).join('');
                totalHtml = `
                    <div class="travel-drops-total">
                        <div class="travel-drops-segment-header" style="font-size: 0.82em; font-weight: 700; color: var(--text-primary); margin: var(--spacing-sm) 0 1px var(--spacing-sm);">TOTAL — whole route</div>
                        <div style="font-size: 0.72em; opacity: 0.65; margin: 0 0 2px var(--spacing-sm);">Expected drops, steps/item &amp; % over the ENTIRE route (not per action)</div>
                        ${this._renderTravelCurrency(dropsTotal.coins_per_1k, dropsTotal.agt_per_1k)}
                        <div class="drops-list" data-pin-id="drops-list">${totalCards}</div>
                    </div>`;
            }

            // Per-segment breakdown (per-action % + per-segment coins/AGT) — only
            // when the route has more than one segment (otherwise the single
            // segment IS the whole route and the Total section covers it).
            let segHtml = '';
            if (multi) {
                segHtml = segments.map(seg => {
                    const drops = (seg.drops || []);
                    const startName = seg.start_name || seg.start || '';
                    const endName = seg.end_name || seg.end || '';
                    const header = `<div class="travel-drops-segment-header" style="font-size: 0.82em; font-weight: 600; color: var(--text-secondary); margin: var(--spacing-sm) 0 2px var(--spacing-sm);">${startName} \u2192 ${endName}</div>`;
                    const pills = this._renderTravelCurrency(seg.coins_per_1k, seg.agt_per_1k);
                    const cards = drops.length
                        ? drops.map(d => this.renderTravelDropCard(d)).join('')
                        : `<div class="drops-empty-hint" style="padding: 0 var(--spacing-sm); color: var(--text-muted); font-size: 0.85em;">No drops apply on this segment.</div>`;
                    return `${header}${pills}<div class="drops-list" data-pin-id="drops-list">${cards}</div>`;
                }).join('');
                segHtml = `<hr class="segment-drops-divider" style="border:none;border-top:1px solid var(--border-color);margin:var(--spacing-sm) 0;" />
                    <div class="travel-drops-segment-header" style="font-size: 0.78em; opacity: 0.7; margin: 0 0 2px var(--spacing-sm);">PER SEGMENT (per action)</div>
                    ${segHtml}`;
            }

            bodyHtml = totalHtml + segHtml;
        }

        const html = `
            <div class="drops-section" data-pin-id="drops-table">
                <div class="drops-header">
                    <span class="drops-title">DROPS</span>
                    ${arrowIcon}
                </div>
                <div class="drops-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                    ${bodyHtml}
                </div>
            </div>
        `;
        this.$element.html(html);
        this.attachEvents();
    }

    /**
     * Render coins/AGT per-1k-steps pills for travel, matching the activity/
     * recipe currency-summary style. AGT pill only shows when AGT is dropping.
     * @param {number} coinsPer1k
     * @param {number} agtPer1k
     * @returns {string} HTML
     */
    _renderTravelCurrency(coinsPer1k, agtPer1k) {
        const coins = Number(coinsPer1k) || 0;
        const agt = Number(agtPer1k) || 0;
        if (coins <= 0 && agt <= 0) return '';
        let pills = `
            <div class="currency-pill currency-pill-coins">
                <img src="/assets/icons/items/coins.svg" alt="Coins" class="currency-pill-icon" title="Coins per 1k steps" />
                <span class="currency-pill-value">${this.formatCurrencyValue(coins)}</span>
            </div>`;
        if (agt > 0) {
            pills += `
                <div class="currency-pill">
                    <img src="/assets/icons/items/adventurers'_guild_token.svg" alt="AG Tokens" class="currency-pill-icon" title="Adventurers' Guild Tokens per 1k steps" />
                    <span class="currency-pill-value">${this.formatCurrencyValue(agt)}</span>
                </div>`;
        }
        return `
            <div class="currency-summary">
                ${pills}
                <span class="currency-per-label">/1k</span>
                <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="currency-steps-icon" />
            </div>
        `;
    }

    /**
     * Render a single travel drop as a standard .drop-card (icon + per-roll
     * chance % + expected steps/item), matching the activity/recipe cards.
     * @param {Object} d - { target, name, steps_per_item, chance_percent }
     * @returns {string} HTML
     */
    renderTravelDropCard(d) {
        const icon = travelDropIcon(d.target);
        const isFine = /_fine$/.test(d.target || '');
        const fineClass = isFine ? ' drop-card-fine' : '';
        const slug = (d.target || d.name || '').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

        const pct = (d.chance_percent === null || d.chance_percent === undefined)
            ? null
            : formatFixed(d.chance_percent, 3, { trim: true });
        const percentHtml = pct !== null
            ? `<div class="drop-card-percent" data-pin-id="drop-percent">${pct}%</div>`
            : '';

        const spi = d.steps_per_item || 0;
        const stepsFormatted = spi < 100
            ? formatFixed(spi, 1, { trim: true })
            : Math.ceil(spi).toLocaleString();

        return `
            <div class="drop-card${fineClass}" data-drop="${slug}" title="${d.name}">
                <div class="drop-card-icon-wrapper">
                    <img src="${icon}" alt="${d.name}" class="drop-card-icon" loading="lazy" onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}else{this.src='/assets/icons/items/containers/treasure_chest.svg'}" />
                </div>
                ${percentHtml}
                <div class="drop-card-steps" data-pin-id="drop-steps">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="steps-icon" />
                    <span>${stepsFormatted}</span>
                </div>
            </div>
        `;
    }

    /**
     * Render drop item
     * Requirements: 4.3, 4.4
     * @param {Object} drop - Drop object
     * @returns {string} HTML for drop item
     */
    renderDropItem(drop) {
        // Build icon path
        let iconPath = '';
        if (drop.source === 'chest') {
            // Use skill-specific chest icon with lowercase skill name
            const skill = drop.primary_skill || 'chest';
            const skillLowercase = skill.toLowerCase();
            iconPath = `/assets/icons/items/containers/${skillLowercase}_chest.svg`;
        } else if (drop.item_name === 'Coins') {
            // Special case for coins
            iconPath = '/assets/icons/items/coins.svg';
        } else if (drop.item_ref) {
            // Parse item reference to get icon path
            // Format: "Material.ITEM_NAME" or "Item.ITEM_NAME" or "Collectible.ITEM_NAME"
            const [type, itemName] = drop.item_ref.split('.');

            // Use the actual item name from drop.item_name for the icon filename (lowercase)
            // This preserves apostrophes and uses lowercase
            const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');

            if (type === 'Currency') {
                iconPath = `/assets/icons/items/${iconName}.svg`;
            } else if (type === 'Material') {
                iconPath = `/assets/icons/items/materials/${iconName}.svg`;
            } else if (type === 'Item') {
                iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
            } else if (type === 'Collectible') {
                iconPath = `/assets/icons/items/collectibles/${iconName}.svg`;
            } else if (type === 'Consumable') {
                iconPath = `/assets/icons/items/consumables/${iconName}.svg`;
            } else if (type === 'Container') {
                iconPath = `/assets/icons/items/containers/${iconName}.svg`;
            } else if (type === 'Egg') {
                iconPath = `/assets/icons/items/pet_eggs/${iconName}.svg`;
            }
        }

        // Fallback: if no icon path determined, try to infer from item name
        if (!iconPath && drop.item_name) {
            // Check for icon override (synthetic entries like fine_item/collectible)
            if (drop.icon_override) {
                iconPath = drop.icon_override;
            } else {
                // Convert to icon filename: lowercase, spaces to underscores, keep apostrophes
                const itemNameFormatted = drop.item_name.toLowerCase().replace(/ /g, '_');
                // Check if it's an egg
                if (itemNameFormatted.endsWith('_egg')) {
                    iconPath = `/assets/icons/items/pet_eggs/${itemNameFormatted}.svg`;
                } else {
                    // Try materials first, then consumables
                    iconPath = `/assets/icons/items/materials/${itemNameFormatted}.svg`;
                }
            }
        }

        // Type badge icon removed — no badge shown on drop cards
        let typeBadgeHtml = '';

        // Fine border class
        const fineClass = drop.is_fine ? 'drop-card-fine' : '';

        // Format quantity display
        let quantityText = '';
        if (drop.quantity.is_static || drop.quantity.min === drop.quantity.max) {
            quantityText = drop.quantity.min;
        } else {
            quantityText = `${drop.quantity.min}-${drop.quantity.max}`;
        }

        // Format drop percent - preserve precision, remove trailing zeros
        let dropPercentFormatted;
        if (drop.drop_percent === null || drop.drop_percent === undefined) {
            dropPercentFormatted = '0';
        } else {
            // Use toFixed(3) for all values to preserve precision
            // Then remove trailing zeros
            dropPercentFormatted = formatFixed(drop.drop_percent, 3, { trim: true });
        }

        // Format steps per item - show 1 decimal if under 100, otherwise whole number (ceil to match game)
        const stepsPerItem = drop.steps_per_item || 0;
        const stepsFormatted = stepsPerItem < 100
            ? formatFixed(stepsPerItem, 1, { trim: true })
            : Math.ceil(stepsPerItem).toLocaleString();

        // Level-gated drop: unobtainable at the character's current level. Show
        // a grayed card whose steps line reads "At <skill icon> <level>" (the
        // level the drop first appears) instead of a 0% / infinite-steps row.
        // Re-check drop_percent so a gear item-finding bonus that makes the
        // item obtainable un-gates it (bug 1a799e8d follow-up).
        const isGated = !!drop.level_gated && drop.initial_level != null && (drop.drop_percent || 0) === 0;
        let stepsLineHtml;
        if (isGated) {
            const gateSkill = ((this.dropSource && (this.dropSource.primary_skill || this.dropSource.skill)) || '')
                .toLowerCase().replace(/\s+/g, '_');
            const skillIcon = gateSkill
                ? `<img src="/assets/icons/text/skill_icons/${gateSkill}.svg" alt="${gateSkill}" class="drop-card-gate-skill-icon" onerror="this.style.display='none'" />`
                : '';
            stepsLineHtml = `<div class="drop-card-steps drop-card-gate" data-pin-id="drop-steps">At ${skillIcon}<span>${drop.initial_level}</span></div>`;
        } else {
            stepsLineHtml = `<div class="drop-card-steps drop-card-steps-clickable" data-pin-id="drop-steps" data-steps-value="${stepsPerItem}" role="button" tabindex="0" title="Click to fill the calculator with this step count" style="cursor:pointer;">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="steps-icon" />
                    <span>${stepsFormatted}</span>
                </div>`;
        }

        // For items with fine versions, show steps per fine item
        let fineStepsHtml = '';
        if (drop.steps_per_fine_item) {
            const fineSteps = drop.steps_per_fine_item;
            const fineStepsFormatted = fineSteps < 100
                ? formatFixed(fineSteps, 1, { trim: true })
                : Math.ceil(fineSteps).toLocaleString();

            fineStepsHtml = `
                <div class="drop-card-steps drop-card-steps-fine drop-card-steps-clickable" data-steps-value="${fineSteps}" role="button" tabindex="0" title="Click to fill the calculator with this step count" style="cursor:pointer;">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="steps-icon" />
                    <span>${fineStepsFormatted}</span>
                </div>
            `;
        }

        // Instant-actions: expected output per charge rows
        let chargeHtml = '';
        const petInfo = this._getActiveInstantActionsPet();
        if (petInfo) {
            // Show pet activations PER item (reciprocal of expected output per
            // activation) so this row mirrors the "steps per item" / "materials
            // per item" convention used by the other rows. Same formatting as
            // the materials-per-item row below.
            const expected = this._calcExpectedOutputPerCharge(drop, petInfo);
            const perItemFormatted = this._formatPerActivation(expected);
            chargeHtml += `
                <div class="drop-card-steps drop-card-charge" title="Pet activations per item (${petInfo.count} actions × reward rolls per activation)">
                    <img src="${petInfo.iconPath}" alt="${petInfo.petName}" class="steps-icon"
                         onerror="this.src='/assets/icons/items/pet_eggs/${petInfo.species}_egg.svg'" />
                    <span>${perItemFormatted}</span>
                </div>
            `;
            // Fine version charge row
            if (drop.steps_per_fine_item && drop.fine_drop_percent) {
                const fineExpected = this._calcExpectedOutputPerCharge(
                    { ...drop, drop_percent: drop.fine_drop_percent }, petInfo
                );
                const finePerItemFormatted = this._formatPerActivation(fineExpected);
                chargeHtml += `
                    <div class="drop-card-steps drop-card-charge drop-card-steps-fine" title="Pet activations per fine item">
                        <img src="${petInfo.iconPath}" alt="${petInfo.petName}" class="steps-icon"
                             onerror="this.src='/assets/icons/items/pet_eggs/${petInfo.species}_egg.svg'" />
                        <span>${finePerItemFormatted}</span>
                    </div>
                `;
            }
        }

        // Materials per item row (recipes only)
        let materialsHtml = '';
        if (drop.materials_per_item != null) {
            const mpi = drop.materials_per_item;
            const mpiFormatted = mpi < 10
                ? formatFixed(mpi, 2, { trim: true })
                : mpi < 100
                    ? formatFixed(mpi, 1, { trim: true })
                    : Math.ceil(mpi).toLocaleString();
            materialsHtml = `
                <div class="drop-card-steps drop-card-materials drop-card-materials-clickable" data-materials-value="${mpi}" role="button" tabindex="0" title="Click to fill the calculator Materials field with this value" style="cursor:pointer;">
                    <img src="/assets/icons/attributes/double_rewards.svg" alt="Mats" class="steps-icon" title="Materials consumed per item" />
                    <span title="Materials consumed per item">${mpiFormatted}</span>
                </div>
            `;
        }

        // Derive a stable drop slug for the `data-drop` Pin Path anchor. Prefer
        // the item's export name, fall back to the internal id, and sanitize to
        // the same slug shape used by scraped export names.
        const dropSlug = (drop.item_export_name || drop.item_id || drop.item_name || '')
            .toString().trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');

        return `
            <div class="drop-card ${fineClass}${isGated ? ' drop-card-gated' : ''}" data-drop="${dropSlug}">
                <div class="drop-card-icon-wrapper">
                    <img src="${iconPath}" alt="${drop.item_name}" class="drop-card-icon" loading="lazy" onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}else{this.src='/assets/icons/items/containers/treasure_chest.svg'}" />
                    ${typeBadgeHtml}
                </div>
                <div class="drop-card-percent" data-pin-id="drop-percent">${dropPercentFormatted}%</div>
                <div class="drop-card-quantity" data-pin-id="drop-count">${quantityText}</div>
                ${stepsLineHtml}
                ${isGated ? '' : fineStepsHtml}
                ${isGated ? '' : chargeHtml}
                ${isGated ? '' : materialsHtml}
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 4.1
     */
    async render() {
        // Travel mode: per-segment travel drops (published by TravelInfoSection)
        // rendered in the standard DROPS card — same look as activities/recipes.
        if (this.sourceType === 'travel') {
            this.renderTravelDrops();
            return;
        }
        if (!this.dropSource) {
            this.$element.html('');
            return;
        }

        // Generic items have no drop table
        const isGeneric = this.dropSource.id && String(this.dropSource.id).startsWith('generic::');
        const hasDrops = (this.dropSource.drop_table && this.dropSource.drop_table.length > 0) ||
            (this.dropSource.secondary_drop_table && this.dropSource.secondary_drop_table.length > 0);
        const hasSyntheticTarget = ['fine_item', 'collectible'].includes(store.state.ui?.column3?.targetDrop) &&
            (store.state.ui?.column3?.targetDropRate || 0) > 0;
        if (!hasDrops && this.sourceType === 'recipe' && !isGeneric) {
            // Regular recipes don't have drop tables — just show chest drops
            // (handled below in calculateDropRates)
        } else if (!hasDrops && isGeneric) {
            // Generic activities/recipes — no wiki drop table, but calculateDropRates
            // will add a synthetic chest entry below
        } else if (!hasDrops && hasSyntheticTarget) {
            // User has selected a fine_item/collectible target with a drop rate —
            // show the section so the synthetic entry appears
        } else if (!hasDrops) {
            this.$element.html('');
            return;
        }

        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;

        // Calculate drops
        const drops = await this.calculateDropRates();

        // Cache for other components (e.g. CalculatorSection)
        this._lastCalculatedDrops = drops;

        // Notify CalculatorSection to re-render its drops table (guard against loops)
        if (!this._notifyingCalculator && window.calculatorSection && typeof window.calculatorSection.render === 'function') {
            this._notifyingCalculator = true;
            window.calculatorSection.render();
            this._notifyingCalculator = false;
        }

        const contentHtml = `
            ${this.renderCurrencySummary(drops)}
            ${this.renderFilterCheckboxes()}
            <div class="drops-list" data-pin-id="drops-list">
                ${drops.filter(d => d.source !== 'output_synthetic' && d.source !== 'materials_synthetic').map(drop => this.renderDropItem(drop)).join('')}
            </div>
        `;

        const html = `
            <div class="drops-section" data-pin-id="drops-table">
                <div class="drops-header">
                    <span class="drops-title">DROPS</span>
                    ${arrowIcon}
                </div>
                <div class="drops-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                    ${contentHtml}
                </div>
            </div>
        `;

        this.$element.html(html);
        this.attachEvents();
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers
        this.$element.off('click');
        this.$element.off('change');

        // Collapse toggle - make entire header clickable
        this.$element.on('click', '.drops-header', (e) => {
            e.stopPropagation();
            this.toggleExpanded();
        });

        // Filter checkboxes
        this.$element.on('change', '.drops-filter-checkbox input', (e) => {
            e.stopPropagation();
            const filter = $(e.target).data('filter');
            const checked = e.target.checked;

            if (filter === 'hide-owned') {
                this.toggleHideOwned(checked);
            }
        });

        // Coins/1k pill breakdown — body-appended floating panel with
        // flip-up when the pill is near the bottom of the viewport.
        // Pattern copied from xy-recipe-priority-list.js openDropdownUnder
        // (the "newer" crafting-optimization-settings dropdown). Summary:
        //   1. Click builds a .currency-breakdown-floating panel from the
        //      stashed this._coinsBreakdownRowsHtml and appends to <body>.
        //   2. Measure natural height via a visibility:hidden + display:block
        //      flip (display:none elements always return offsetHeight 0,
        //      which was the root of the earlier "hiding and showing" glitch).
        //   3. Compute openAbove = naturalHeight > spaceBelow && spaceAbove >
        //      spaceBelow. If openAbove, animate top + height together so the
        //      panel grows upward out of the pill. If openBelow, slideDown.
        //   4. Close: reverse direction. openAbove path animates top + height
        //      back down into the pill; openBelow path uses slideUp.
        //
        // Only one breakdown can be open at a time — this.$coinsBreakdownEl
        // tracks it. Outside click, Escape, resize, and scroll all close.
        const SLIDE_MS = 180;
        const GAP = 4;

        const positionFloating = ($pill, $dd) => {
            const rect = $pill[0].getBoundingClientRect();
            let naturalHeight = $dd[0].offsetHeight;
            if (naturalHeight === 0) {
                const prevDisplay = $dd[0].style.display;
                const prevVisibility = $dd[0].style.visibility;
                $dd.css({ visibility: 'hidden', display: 'block' });
                naturalHeight = $dd[0].offsetHeight;
                $dd.css({ visibility: prevVisibility || '', display: prevDisplay || '' });
            }
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
                margin: 0,
            });
            return { openAbove, finalTop, finalHeight, triggerRect: rect };
        };

        const closeCoinsBreakdown = (immediate = false) => {
            const state = this._coinsBreakdownOpen;
            if (!state) return;
            this._coinsBreakdownOpen = null;
            const { $dd, $pill, $arrow, openAbove } = state;
            $arrow.removeClass('expanded');
            $pill.attr('aria-expanded', 'false');
            // Detach the outside-click + resize listeners bound at open.
            if (state.cleanup) state.cleanup();
            if (immediate) {
                $dd.remove();
                return;
            }
            // The outer .currency-breakdown-floating is a transparent
            // overflow:hidden clip-box with no border/padding of its
            // own — all visual chrome lives on .currency-breakdown-inner.
            // That means slideUp / top+height animation on the outer
            // can drive the close cleanly without leaving residual
            // borders or padding at height:0.
            if (openAbove) {
                // Collapse downward toward the pill — reverse of open.
                const curTop = parseInt($dd.css('top'), 10);
                const curHeight = $dd[0].offsetHeight;
                $dd.animate(
                    { top: (curTop + curHeight) + 'px', height: '0px' },
                    SLIDE_MS,
                    () => { $dd.remove(); }
                );
            } else {
                // Standard collapse — slideUp on an outer with no padding
                // is just a clean height animation. The inner stays at
                // natural size and gets clipped as the outer shrinks.
                $dd.slideUp(SLIDE_MS, () => { $dd.remove(); });
            }
        };

        const openCoinsBreakdown = ($pill) => {
            // Re-entry: clicking the SAME pill closes with animation
            // (this is the toggle path — user's intent is to dismiss).
            // Clicking a DIFFERENT pill immediately removes the old
            // panel and opens a fresh one — animating both at once
            // would leave two panels on screen briefly.
            if (this._coinsBreakdownOpen) {
                const wasSamePill = this._coinsBreakdownOpen.$pill.is($pill);
                if (wasSamePill) {
                    closeCoinsBreakdown(false);
                    return;
                }
                closeCoinsBreakdown(true);
            }
            const rowsHtml = this._coinsBreakdownRowsHtml;
            if (!rowsHtml) return;

            const $dd = $('<div class="currency-breakdown-floating" role="dialog" aria-label="Coins per 1k steps breakdown" style="display:none;"><div class="currency-breakdown-inner"></div></div>');
            $dd.find('.currency-breakdown-inner').html(rowsHtml);
            $('body').append($dd);

            const placement = positionFloating($pill, $dd);
            const { openAbove, finalTop, finalHeight, triggerRect } = placement;

            const $arrow = $pill.find('.expand-arrow');
            $arrow.addClass('expanded');
            $pill.attr('aria-expanded', 'true');

            let animatingOpen = true;

            if (openAbove) {
                // Start pinned at pill-top with height 0; animate top +
                // height together so the panel emerges upward. The
                // finalHeight was measured in positionFloating above —
                // don't re-read offsetHeight here ($dd is display:none
                // until the .css below, which would otherwise return 0).
                $dd.css({
                    display: 'block',
                    top: (triggerRect.top - GAP) + 'px',
                    height: '0px',
                    overflow: 'hidden',
                });
                $dd.animate(
                    { top: finalTop + 'px', height: finalHeight + 'px' },
                    SLIDE_MS,
                    function () {
                        $(this).css({ height: '', overflow: '' });
                        animatingOpen = false;
                    }
                );
            } else {
                // Standard downward slide — slideDown animates height
                // plus outer padding/margin, but since the floating
                // panel has horizontal row padding (not outer padding),
                // the effect reads as a clean height reveal.
                $dd.slideDown(SLIDE_MS, () => { animatingOpen = false; });
            }

            // Reposition on resize/scroll (unless mid-animation).
            const onReflow = () => {
                if (!this._coinsBreakdownOpen || animatingOpen) return;
                positionFloating($pill, $dd);
            };
            window.addEventListener('resize', onReflow);
            window.addEventListener('scroll', onReflow, true);

            // Outside click + Escape close.
            const onDocClick = (ev) => {
                if ($(ev.target).closest('.currency-breakdown-floating').length) return;
                if ($(ev.target).closest('.currency-pill-coins').length) return;
                closeCoinsBreakdown();
            };
            const onKey = (ev) => {
                if (ev.key === 'Escape') closeCoinsBreakdown();
            };
            // Defer the doc click listener by a tick so the click that
            // opened this panel doesn't immediately re-close it.
            setTimeout(() => {
                $(document).on('mousedown.coins-breakdown', onDocClick);
            }, 0);
            $(document).on('keydown.coins-breakdown', onKey);

            const cleanup = () => {
                window.removeEventListener('resize', onReflow);
                window.removeEventListener('scroll', onReflow, true);
                $(document).off('mousedown.coins-breakdown', onDocClick);
                $(document).off('keydown.coins-breakdown', onKey);
            };

            this._coinsBreakdownOpen = { $dd, $pill, $arrow, openAbove, cleanup };
        };

        this.$element.on('click', '.currency-pill-coins.has-breakdown', (e) => {
            e.stopPropagation();
            openCoinsBreakdown($(e.currentTarget));
        });
        this.$element.on('keydown', '.currency-pill-coins.has-breakdown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                openCoinsBreakdown($(e.currentTarget));
            }
        });
        // Store the close fn on `this` so the DropsSection can close the
        // breakdown if it re-renders or gets torn down mid-open.
        this._closeCoinsBreakdown = closeCoinsBreakdown;
        // If a breakdown was open before a re-render, close it immediately
        // (its DOM references are stale now).
        if (this._coinsBreakdownOpen) {
            closeCoinsBreakdown(true);
        }

        // Steps counter → fill the calculator's Steps field with this value.
        // Only actual step-count rows carry .drop-card-steps-clickable (the
        // primary steps row and the fine-steps row). The instant-actions
        // "charge" row and the materials-per-item row are NOT step counts, so
        // they are intentionally not clickable. In comparison mode the DROPS
        // section reflects the active gearset slot, so CalculatorSection fills
        // that side. During pin mode a capture-phase click listener suppresses
        // this bubble-phase handler, so pinning the steps element still works.
        this.$element.on('click', '.drop-card-steps-clickable', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const raw = parseFloat(e.currentTarget.getAttribute('data-steps-value'));
            if (!isFinite(raw) || raw <= 0) return;
            const steps = Math.round(raw);
            if (window.calculatorSection && typeof window.calculatorSection.setStepsFromExternal === 'function') {
                window.calculatorSection.setStepsFromExternal(steps);
            }
        });
        this.$element.on('keydown', '.drop-card-steps-clickable', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                $(e.currentTarget).trigger('click');
            }
        });

        // Materials-per-item value → fill the calculator's Materials field
        // (recipes only). Mirrors the steps-click behavior above. Value is a
        // decimal (materials consumed per item), so no rounding.
        this.$element.on('click', '.drop-card-materials-clickable', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const raw = parseFloat(e.currentTarget.getAttribute('data-materials-value'));
            if (!isFinite(raw) || raw <= 0) return;
            if (window.calculatorSection && typeof window.calculatorSection.setMaterialsFromExternal === 'function') {
                window.calculatorSection.setMaterialsFromExternal(raw);
            }
        });
        this.$element.on('keydown', '.drop-card-materials-clickable', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                $(e.currentTarget).trigger('click');
            }
        });

        // Wire drop card popovers (hover + click for item stats).
        // IMPORTANT: pass the SAME filtered list that was rendered above —
        // wireDropCards maps cards to drops by index, and the render step
        // strips `output_synthetic`. If we pass the unfiltered list, the
        // sort can put output_synthetic before the chest (output has low
        // steps/item, chest has high), which would wire the chest card
        // to the output entry — making the chest hover show the recipe's
        // output (e.g., "Aerofibril bracers") instead of the chest popover.
        console.log('[DROP-POPOVER] attachEvents called, _lastCalculatedDrops:', this._lastCalculatedDrops?.length);
        // Travel mode renders category cards (Agility Chest, item-finding
        // targets) that are NOT catalog items and are NOT in _lastCalculatedDrops
        // (a stale activity/recipe list). wireDropCards maps cards to drops by
        // INDEX, so wiring here would attach travel cards to random leftover
        // activity items (bug: AGT hover showed "raw perch"). Travel cards keep
        // their native title tooltip; skip the item popover entirely.
        if (this.sourceType !== 'travel' && this._lastCalculatedDrops) {
            const container = this.$element[0];
            console.log('[DROP-POPOVER] container element:', container);
            console.log('[DROP-POPOVER] drop-cards found:', container?.querySelectorAll('.drop-card')?.length);
            if (container) {
                const renderedDrops = this._lastCalculatedDrops.filter(d => d.source !== 'output_synthetic' && d.source !== 'materials_synthetic');
                wireDropCards(container, renderedDrops);
            }
        }
    }
}

export default DropsSection;
