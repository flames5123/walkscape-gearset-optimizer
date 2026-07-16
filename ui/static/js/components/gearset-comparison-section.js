/**
 * Gearset Comparison Section - Side-by-side comparison of two gearsets
 * 
 * Shows in Column 3 when comparison mode is enabled.
 * Displays Activity Info and Drops for both gearsets side by side.
 */

import Component from './base.js';
import store from '../state.js';
import LocationDropdown from './location-dropdown.js';
import { getInstantActionsPet, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';
import { getPetIconPath } from '../utils/pet-utils.js';
import { wireDropAnchor } from '../drop-item-popover.js';

import { formatFixed } from '../utils/number-format.js';

class GearsetComparisonSection extends Component {
    constructor(element, props = {}) {
        super(element, props);

        this.isExpanded = true;
        this.dropsExpanded = true;
        this.activity = null;
        this.recipe = null;
        this.dropTableData = null;
        this._activeMaterialIndex = -1;
        this._selectedMaterialGroup = 0;
        this._selectedInputItems = { 1: {}, 2: {} }; // Per-gearset input item selections

        // Subscribe to relevant state changes
        this.subscribe('gearsets.comparisonMode', () => this.onComparisonModeChange());
        this.subscribe('gearsets.current', () => this.onGearsetChange());
        this.subscribe('gearsets.gearset2', () => this.onGearsetChange());
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        // Re-render when gear sets finish loading (ensures correct stats after session restore)
        this.subscribe('gearsets.saved', () => {
            if (store.state.gearsets.comparisonMode) this.onComparisonModeChange();
        });
        // Re-render when instant-actions checkbox changes
        this.subscribe('ui.instant_actions_foraging', () => { if (store.state.gearsets.comparisonMode) this.render(); });
        this.subscribe('ui.instant_actions_smelting', () => { if (store.state.gearsets.comparisonMode) this.render(); });

        // If comparison mode is already on (restored from session), trigger initial load
        if (store.state.gearsets.comparisonMode) {
            // Delay to let other components finish initializing, then render.
            // A second render is triggered by _loadGearSets completing (via gearsets.comparisonMode notify).
            setTimeout(() => {
                console.log('[Comparison] Constructor timeout fired, activity=', this.activity?.name, 'selectedActivity=', store.state.column3?.selectedActivity);
                this.onComparisonModeChange();
            }, 500);
        } else {
            this.render();
        }
    }

    async onComparisonModeChange() {
        // When comparison mode is toggled on, load current activity/recipe from state
        if (store.state.gearsets.comparisonMode) {
            if (store.state.column3?.selectedActivity) {
                await this.onActivityChange();
                return; // onActivityChange calls render
            }
            if (store.state.column3?.selectedRecipe) {
                await this.onRecipeChange();
                return; // onRecipeChange calls render
            }
            // If no activity/recipe yet (still loading), wait and retry
            if (!this.activity && !this.recipe) {
                if (this._retryCount === undefined) this._retryCount = 0;
                if (this._retryCount < 10) {
                    this._retryCount++;
                    setTimeout(() => this.onComparisonModeChange(), 300);
                    return;
                }
            }
            this._retryCount = 0;
        }
        this.render();
    }

    async onActivityChange() {
        const activityId = store.state.column3?.selectedActivity;
        console.log('[Comparison] onActivityChange: activityId=', activityId);
        if (activityId && !activityId.startsWith('generic')) {
            try {
                const response = await $.get('/api/activities');
                for (const activities of Object.values(response.by_skill)) {
                    const activity = activities.find(a => a.id === activityId);
                    if (activity) {
                        this.activity = activity;
                        this.recipe = null;
                        this._itemFindingDropsCache = null;
                        this.dropTableData = [
                            ...(activity.drop_table || []),
                            ...(activity.secondary_drop_table || [])
                        ];

                        // Restore input items from gsXContext, or copy from single view on first load only
                        const ctx1Items = (store.state.gearsets.gs1Context || {}).selectedInputItems;
                        const ctx2Items = (store.state.gearsets.gs2Context || {}).selectedInputItems;
                        const singleViewItems = store.state.column3?.selectedInputItems;
                        // Only copy from single view if we don't already have per-gearset items
                        const hasGs1Items = ctx1Items && Object.keys(ctx1Items).length > 0;
                        const hasGs2Items = ctx2Items && Object.keys(ctx2Items).length > 0;
                        if (!hasGs1Items && !hasGs2Items && !this._inputItemsInitialized) {
                            this._selectedInputItems = {
                                1: singleViewItems ? { ...singleViewItems } : {},
                                2: singleViewItems ? { ...singleViewItems } : {}
                            };
                            this._inputItemsInitialized = true;
                        } else {
                            this._selectedInputItems = {
                                1: hasGs1Items ? { ...ctx1Items } : (this._selectedInputItems?.[1] || {}),
                                2: hasGs2Items ? { ...ctx2Items } : (this._selectedInputItems?.[2] || {})
                            };
                        }

                        // Auto-select first location for each gearset if not already set
                        if (activity.locations && activity.locations.length > 0) {
                            const firstLocId = activity.locations[0].id;
                            const ctx1 = store.state.gearsets.gs1Context || {};
                            const ctx2 = store.state.gearsets.gs2Context || {};
                            const validLocIds = activity.locations.map(l => l.id);
                            if (!ctx1.selectedLocation || !validLocIds.includes(ctx1.selectedLocation)) {
                                ctx1.selectedLocation = firstLocId;
                                store.update('gearsets.gs1Context', { ...ctx1 });
                                store._syncToBackend('ui.gearsets.gs1Context', ctx1);
                            }
                            if (!ctx2.selectedLocation || !validLocIds.includes(ctx2.selectedLocation)) {
                                ctx2.selectedLocation = firstLocId;
                                store.update('gearsets.gs2Context', { ...ctx2 });
                                store._syncToBackend('ui.gearsets.gs2Context', ctx2);
                            }
                        }

                        break;
                    }
                }
            } catch (e) {
                console.error('Failed to load activity for comparison:', e);
            }
        } else {
            this.activity = null;
            this.dropTableData = null;
        }
        this.render();
    }

    async onRecipeChange() {
        const recipeId = store.state.column3?.selectedRecipe;
        if (recipeId && !recipeId.startsWith('generic')) {
            try {
                const response = await $.get('/api/recipes');
                for (const recipes of Object.values(response.by_skill)) {
                    const recipe = recipes.find(r => r.id === recipeId);
                    if (recipe) {
                        this.recipe = recipe;
                        this.activity = null;
                        this.dropTableData = null;

                        // Load services for this recipe
                        await this._loadServicesForRecipe();
                        break;
                    }
                }
            } catch (e) {
                console.error('Failed to load recipe for comparison:', e);
            }
        } else {
            this.recipe = null;
            this.recipeServices = null;
        }
        this.render();
    }

    /**
     * Load services for the current recipe and auto-select defaults per gearset
     */
    async _loadServicesForRecipe() {
        if (!this.recipe) {
            this.recipeServices = null;
            this.recipeServiceType = null;
            return;
        }

        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            this.recipeServices = response.services || [];
            this.recipeServiceType = response.recipe_service_type || null;

            // Auto-select first service + location for each gearset if not already set
            for (const gsNum of [1, 2]) {
                const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
                const ctx = store.state.gearsets[ctxKey] || {};

                if (!ctx.selectedService || !this._findServiceById(ctx.selectedService)) {
                    if (this.recipeServiceType === 'None') {
                        // Recipe doesn't require a service — default to no service with kallaheim
                        store.state.gearsets[ctxKey] = {
                            ...ctx,
                            selectedService: '__none__',
                            selectedServiceSpecific: null,
                            selectedLocation: ctx.selectedLocation || 'kallaheim',
                        };
                    } else {
                        // Auto-select: prefer first unlocked basic, then first basic, then first
                        let pick = this.recipeServices.find(s => s.is_basic && s.is_unlocked)
                            || this.recipeServices.find(s => s.is_basic)
                            || this.recipeServices[0];
                        if (pick && pick.locations && pick.locations.length > 0) {
                            const loc = pick.locations[0];
                            store.state.gearsets[ctxKey] = {
                                ...ctx,
                                selectedService: pick.id,
                                selectedServiceSpecific: loc.service_id,
                                selectedLocation: loc.location.id,
                            };
                        } else if (pick) {
                            store.state.gearsets[ctxKey] = {
                                ...ctx,
                                selectedService: pick.id,
                                selectedServiceSpecific: pick.id,
                                selectedLocation: null,
                            };
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load services for comparison recipe:', e);
            this.recipeServices = null;
            this.recipeServiceType = null;
        }
    }

    /**
     * Find a service by its grouped ID or by a location-specific service_id
     */
    _findServiceById(serviceId) {
        if (!this.recipeServices || serviceId === '__none__') return null;
        return this.recipeServices.find(s => s.id === serviceId
            || (s.locations && s.locations.some(l => l.service_id === serviceId)));
    }

    /**
     * Resolve the regions for a location id from the currently loaded recipe-service
     * or activity data. Returns an array of region names (e.g. ['syrenthia', 'underwater'])
     * so that region-scoped gear bonuses match in the Combined Stats section. Falls back
     * to [locationId] when no region data is available.
     * @param {string} locationId
     * @returns {string[]|null}
     */
    _resolveLocationRegions(locationId) {
        if (!locationId) return null;
        // Recipe path — regions live on recipeServices[].locations[].location.regions
        if (this.recipe && this.recipeServices) {
            for (const svc of this.recipeServices) {
                if (!svc.locations) continue;
                const ld = svc.locations.find(l => l.location && l.location.id === locationId);
                if (ld && ld.location.regions && ld.location.regions.length > 0) {
                    return ld.location.regions;
                }
            }
        }
        // Activity path — regions live on activity.locations[].regions
        if (this.activity && this.activity.locations) {
            const loc = this.activity.locations.find(l => l.id === locationId);
            if (loc && loc.regions && loc.regions.length > 0) {
                return loc.regions;
            }
        }
        return [locationId];
    }

    /**
     * Bug f369f60f: in comparison view, changing the service/location in column 3
     * updated only the per-gearset context (gsXContext) and re-rendered the comparison
     * table — it never told the Combined Stats section (column 2) about the new
     * service/location, so location-scoped gear bonuses (e.g. Syrenthia/underwater)
     * were not recomputed. This pushes the edited slot's context into the Combined
     * Stats section, but ONLY when the edited gearset is the active slot (the slot
     * whose stats column 2 is showing) — mirroring the input-item handler's guard and
     * the slot-switch logic in main.js. Region resolution matches the single view so
     * region-scoped bonuses apply.
     * @param {number} gsNum - The gearset slot that was edited (1 or 2)
     */
    _notifyCombinedStatsForActiveSlot(gsNum) {
        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
        if (gsNum !== activeSlot) return; // column 2 only shows the active slot

        const css = window.combinedStatsSection;
        if (!css) return;

        const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
        const ctx = store.state.gearsets[ctxKey] || {};
        const regions = this._resolveLocationRegions(ctx.selectedLocation);

        // Keep store.state.column3 consistent with the active slot (no notify — that
        // would fire the lossy column3.selectedService subscription which only stores
        // the raw location id; we drive the section directly with resolved regions).
        store.state.column3 = store.state.column3 || {};
        store.state.column3.selectedService = ctx.selectedServiceSpecific || ctx.selectedService;
        store.state.column3.selectedLocation = ctx.selectedLocation;

        try {
            if (this.recipe && typeof css.setRecipeContext === 'function') {
                css.setRecipeContext(
                    this.recipe.id,
                    ctx.selectedServiceSpecific || ctx.selectedService || null,
                    regions
                );
            } else if (this.activity && typeof css.setLocation === 'function') {
                // Activities have no service — a location change only needs the new regions.
                css.setLocation(regions);
            }
        } catch (e) {
            console.error('Failed to notify Combined Stats of comparison context change:', e);
        }
    }

    /**
     * Fetch all game locations (cached). Used for "no service" recipe location selection.
     */
    async _getAllLocations() {
        if (this._allLocations) return this._allLocations;
        try {
            const response = await $.get('/api/locations');
            const locs = [];
            for (const region of (response.regions || [])) {
                for (const loc of (region.locations || [])) {
                    locs.push({ ...loc, region: region.name });
                }
            }
            this._allLocations = locs;
            return locs;
        } catch (e) {
            console.error('Failed to load locations:', e);
            return [];
        }
    }

    onGearsetChange() {
        if (store.state.gearsets.comparisonMode) {
            // Debounce render to avoid excessive API calls
            if (this._renderTimeout) clearTimeout(this._renderTimeout);
            this._renderTimeout = setTimeout(() => this.render(), 200);
        }
    }

    /**
     * Calculate stats for a given gearset via the backend API.
     * Returns a promise that resolves to {stats, metrics, skill, base_steps, base_xp, max_efficiency, activity_level}.
     */
    async calculateStatsForGearsetViaAPI(gearsetSlots, context = {}, gsNum = 1) {
        if (!this.activity && !this.recipe) return null;

        const source = this.activity || this.recipe;
        const activityId = this.activity ? store.state.column3?.selectedActivity : null;
        const recipeId = this.recipe ? store.state.column3?.selectedRecipe : null;
        const location = context.selectedLocation || source.location || '';
        // For recipes, use per-gearset service; for activities, use global service
        let serviceId = context.selectedServiceSpecific || context.selectedService
            || store.state.column3?.selectedService || null;
        // "__none__" means no service selected
        if (serviceId === '__none__') serviceId = null;

        // Build gearset payload from slots
        const gearset = {};
        for (const [slot, item] of Object.entries(gearsetSlots)) {
            if (!item) continue;
            gearset[slot] = {
                itemId: item.itemId,
                uuid: item.uuid || null,
                name: item.name || null,
                quality: item.quality || null,
                is_fine: item.is_fine || false,
                is_generic: item.is_generic || false,
                level: item.level || undefined,
                variant: item.variant || undefined,
                useAbility: item.useAbility || false,
            };
        }

        // Build input items payload from per-gearset selections
        const inputItemsForRequest = [];
        const gsInputItems = this._selectedInputItems?.[gsNum] || {};
        console.log(`[comparison-stats] GS${gsNum} input items:`, JSON.stringify(gsInputItems));
        for (const [idx, item] of Object.entries(gsInputItems)) {
            if (item) {
                console.log(`[comparison-stats] GS${gsNum} input[${idx}]:`, item.name, 'itemId:', item.itemId, 'id:', item.id, 'uuid:', item.uuid);
                inputItemsForRequest.push({
                    index: parseInt(idx),
                    item_id: item.itemId || item.id,
                    name: item.name,
                    uuid: item.uuid || null,
                    is_generic: item.is_generic || false,
                });
            }
        }
        console.log(`[comparison-stats] GS${gsNum} sending ${inputItemsForRequest.length} input items:`, inputItemsForRequest);

        try {
            const result = await $.ajax({
                url: '/api/comparison-stats',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    gearset: gearset,
                    activity_id: activityId || undefined,
                    recipe_id: recipeId || undefined,
                    service_id: serviceId || undefined,
                    location: location || undefined,
                    use_fine_inputs: context.useFine || false,
                    input_items: inputItemsForRequest.length > 0 ? inputItemsForRequest : undefined,
                }),
            });
            return result;
        } catch (e) {
            console.error('Failed to calculate comparison stats:', e);
            return null;
        }
    }

    _getSkillLevel(skill) {
        const skills = store.state.character.skills || {};
        const overrides = store.state.ui?.user_overrides?.skills || {};
        // Check override first
        if (overrides[skill] !== undefined) return overrides[skill];
        // Check character skills (case-insensitive)
        for (const [name, data] of Object.entries(skills)) {
            if (name.toLowerCase() === skill) {
                return data.level || 1;
            }
        }
        return 1;
    }

    /**
     * Calculate activity metrics from stats
     */
    calculateActivityMetrics(stats) {
        if (!this.activity) return null;

        const baseSteps = this.activity.base_steps;
        const maxEfficiency = this.activity.max_efficiency;
        const baseXP = this.activity.base_xp;

        const we = (stats.work_efficiency || 0) / 100;
        const da = (stats.double_action || 0) / 100;
        const dr = (stats.double_rewards || 0) / 100;
        const flat = stats.flat_steps || stats.steps_add || 0;
        const pct = (stats.steps_percent || stats.steps_pct || 0) / 100;

        // Match the game's formula (per KamiTzayig reference): single ceil at the
        // END of the chain. Applying ceil before the pct multiplier introduces
        // off-by-one errors (e.g. Flowing pocketwatch -5% on Lizard Hunting).
        const cappedWE = Math.min(we, maxEfficiency);
        const totalEfficiency = 1 + cappedWE;
        const baseOverEff = baseSteps / totalEfficiency;
        const stepsWithPct = baseOverEff * (1 + pct);
        const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));
        const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;
        const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

        // XP
        const bonusXPAdd = stats.bonus_xp_add || stats.bonus_experience_add || 0;
        const bonusXPPercent = (stats.bonus_xp_percent || stats.bonus_experience_percent || 0) / 100;
        const primaryXP = (baseXP + bonusXPAdd) * (1 + bonusXPPercent);
        const xpPerStep = primaryXP / expectedStepsPerAction;

        // WE display (offset by 100)
        const currentWEPercent = (stats.work_efficiency || 0);
        const currentWEDisplay = currentWEPercent + 100;
        const maxWEDisplay = maxEfficiency * 100 + 100;

        return {
            weDisplay: currentWEDisplay,
            maxWEDisplay: maxWEDisplay,
            weExceedsMax: currentWEPercent >= maxEfficiency * 100,
            stepsPerAction: stepsPerSingleAction,
            expectedStepsPerAction: expectedStepsPerAction,
            stepsPerRewardRoll: stepsPerRewardRoll,
            xpPerStep: xpPerStep,
            primarySkill: this.activity.skill || this.activity.primary_skill || '',
            location: this.activity.location || ''
        };
    }

    /**
     * Calculate recipe metrics from stats (matches RecipeInfoSection.calculateCurrentStats)
     */
    calculateRecipeMetrics(stats, useFine = false) {
        if (!this.recipe) return null;

        const baseSteps = this.recipe.base_steps;
        const maxEfficiency = this.recipe.max_efficiency;
        const baseXP = this.recipe.base_xp;

        const we = (stats.work_efficiency || 0) / 100;
        const da = (stats.double_action || 0) / 100;
        const dr = (stats.double_rewards || 0) / 100;
        const nmc = (stats.no_materials_consumed || 0) / 100;
        const flat = stats.flat_steps || stats.steps_add || 0;
        const pct = (stats.steps_percent || stats.steps_pct || 0) / 100;

        const cappedWE = Math.min(we, maxEfficiency);
        const totalEfficiency = 1 + cappedWE;
        // Match the game's formula (per KamiTzayig reference): single ceil at the
        // END of the chain. Applying ceil before the pct multiplier introduces
        // off-by-one errors (e.g. Flowing pocketwatch -5%).
        const baseOverEff = baseSteps / totalEfficiency;
        const withPct = baseOverEff * (1 + pct);
        const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);
        const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;

        // Steps per reward roll
        const rewardRollsPerCompletion = (1 + da) * (1 + dr);
        const stepsPerRewardRoll = stepsPerSingleAction / rewardRollsPerCompletion;

        // Crafts per material
        const craftsPerMaterial = (1 + dr) / (1 - Math.min(nmc, 0.999));

        // XP — apply fine materials bonus (75%) if enabled
        const fineBonus = useFine ? 0.75 : 0;
        const bonusXPAdd = stats.bonus_xp_add || stats.bonus_experience_add || 0;
        const bonusXPPercent = (stats.bonus_xp_percent || stats.bonus_experience_percent || 0) / 100;
        const calculatedXP = (baseXP + bonusXPAdd) * (1 + bonusXPPercent) * (1 + fineBonus);

        // XP per step
        const actionsPerCompletion = 1 + da;
        const xpPerStep = (calculatedXP * actionsPerCompletion) / stepsPerSingleAction;

        // XP per material
        const materialsConsumedPerAction = nmc < 1.0 ? (1 - nmc) : 0.001;
        const xpPerMaterial = calculatedXP / materialsConsumedPerAction;

        // Chest metrics (base rate 0.4% = 1/250, modified by CF and DR)
        const chestFinding = (stats.chest_finding || 0) / 100;
        const baseChestRate = 0.004;
        const chestRateWithBonus = baseChestRate * (1 + chestFinding);
        const stepsForChest = chestRateWithBonus > 0
            ? expectedStepsPerAction / (chestRateWithBonus * (1 + dr))
            : 999999;
        const materialsPerChest = chestRateWithBonus > 0
            ? (1 / craftsPerMaterial) / (chestRateWithBonus * (1 + dr))
            : 999999;

        // WE display
        const currentWEPercent = (stats.work_efficiency || 0);
        const currentWEDisplay = currentWEPercent + 100;
        const maxWEDisplay = maxEfficiency * 100 + 100;

        return {
            weDisplay: currentWEDisplay,
            maxWEDisplay: maxWEDisplay,
            weExceedsMax: currentWEPercent >= maxEfficiency * 100,
            stepsPerSingleAction: stepsPerSingleAction,
            baseSteps: baseSteps,
            stepsPerRewardRoll: stepsPerRewardRoll,
            expectedStepsPerAction: expectedStepsPerAction,
            xpPerStep: xpPerStep,
            baseXP: baseXP,
            calculatedXP: calculatedXP,
            xpPerMaterial: xpPerMaterial,
            craftsPerMaterial: craftsPerMaterial,
            stepsForChest: stepsForChest,
            materialsPerChest: materialsPerChest,
            dr: dr,
            da: da,
            nmc: nmc,
            qo: stats.quality_outcome || 0,
            primarySkill: this.recipe.skill || '',
            level: this.recipe.level || 0
        };
    }

    /**
     * Calculate drop rates for a gearset
     */
    calculateDropsForGearset(stats, extraDrops = []) {
        if (!this.activity || !this.dropTableData) return [];

        const we = (stats.work_efficiency || 0) / 100;
        const da = (stats.double_action || 0) / 100;
        const dr = (stats.double_rewards || 0) / 100;
        const flat = stats.flat_steps || stats.steps_add || 0;
        const pct = (stats.steps_percent || stats.steps_pct || 0) / 100;
        const chestFinding = (stats.chest_finding || 0) / 100;
        const fineMaterialFinding = (stats.fine_material_finding || 0) / 100;
        const findGems = (stats.find_gems || 0) / 100;
        const findCollectibles = (stats.find_collectibles || stats.collectible_finding || 0) / 100;
        const findBirdNests = (stats.find_bird_nests || 0) / 100;

        const baseSteps = this.activity.base_steps;
        const maxEfficiency = this.activity.max_efficiency;
        // Match the game's formula (per KamiTzayig reference): single ceil at the
        // END of the chain.
        const cappedWE = Math.min(we, maxEfficiency);
        const baseOverEff = baseSteps / (1 + cappedWE);
        const stepsWithPct = baseOverEff * (1 + pct);
        const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));
        const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

        // Combine base drops with per-gearset item finding drops
        const allDrops = [...this.dropTableData, ...extraDrops];

        const drops = [];
        for (const drop of allDrops) {
            if (drop.item_name === 'Nothing') continue;
            const dropPercent = drop.chance_percent;
            const avgQuantity = this._calcAvgQuantity(drop.quantity);

            let findBonus = 0;
            if (drop.item_ref) {
                if (drop.item_ref.startsWith('Collectible.')) findBonus = findCollectibles;
                else if (drop.item_ref.startsWith('Container.') && !drop.item_ref.includes('BIRD_NEST')) findBonus = chestFinding;
                else if (drop.item_name.toLowerCase().includes('bird nest') || drop.item_name.toLowerCase().includes('nest')) findBonus = findBirdNests;
                if (drop.item_keywords && drop.item_keywords.some(kw => ['gem', 'rough gem'].includes(kw.toLowerCase()))) findBonus = findGems;
            }
            // For equipment (item finding) drops, the chance_percent already includes the find bonus
            if (drop.source === 'equipment') {
                findBonus = 0;
            }

            // Handle multi-roll drops (e.g. Lizard hunting rolls 2x per reward roll)
            // Mirrors the formula in drops-section.js single view.
            let stepsPerItem;
            let effectivePercent;
            let fineDenomRollMultiplier;
            if (drop.multi_roll_count && drop.multi_roll_count > 1) {
                const perRollChance = dropPercent / 100;
                const boostedRollChance = perRollChance * (1 + findBonus);
                const denominator = drop.multi_roll_count * boostedRollChance * avgQuantity;
                stepsPerItem = denominator > 0 ? stepsPerRewardRoll / denominator : Infinity;
                // Compound chance: 1 - (1 - boosted_per_roll)^N
                effectivePercent = (1 - Math.pow(1 - boostedRollChance, drop.multi_roll_count)) * 100;
                fineDenomRollMultiplier = drop.multi_roll_count;
            } else {
                stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * (1 + findBonus) * avgQuantity);
                effectivePercent = dropPercent * (1 + findBonus);
                fineDenomRollMultiplier = 1;
            }

            let stepsPerFineItem = null;
            if (drop.has_fine_material && dropPercent) {
                const fineDropPercent = dropPercent * 0.01;
                const augmentedFine = fineDropPercent * (1 + fineMaterialFinding) * (1 + findBonus);
                stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFine * avgQuantity * fineDenomRollMultiplier);
            }

            drops.push({
                item_name: drop.item_name,
                item_ref: drop.item_ref,
                steps_per_item: stepsPerItem,
                steps_per_fine_item: stepsPerFineItem,
                coin_value: drop.coin_value || 0,
                fine_coin_value: drop.fine_coin_value || 0,
                fine_ag_token_value: drop.fine_ag_token_value || 0,
                shell_value: drop.shell_value || 0,
                fine_shell_value: drop.fine_shell_value || 0,
                has_fine_material: drop.has_fine_material,
                item_keywords: drop.item_keywords,
                source: drop.source || 'primary',
                special_sell: drop.special_sell || null,
                chance_percent: dropPercent,
                effective_percent: effectivePercent,
                multi_roll_count: drop.multi_roll_count || 1,
                quantity: drop.quantity
            });
        }

        drops.sort((a, b) => a.steps_per_item - b.steps_per_item);
        return drops;
    }

    /**
     * Calculate recipe drops for a single gearset — mirrors calculateDropsForGearset but for recipes.
     * Includes: recipe drop_table items, chest, and item-finding drops.
     */
    calculateRecipeDropsForGearset(stats, metrics, extraDrops = []) {
        if (!this.recipe) return [];

        const dr = (stats.double_rewards || 0) / 100;
        const nmc = (stats.no_materials_consumed || 0) / 100;
        const chestFinding = (stats.chest_finding || 0) / 100;
        const fineMaterialFinding = (stats.fine_material_finding || 0) / 100;
        const findGems = (stats.find_gems || 0) / 100;
        const findCollectibles = (stats.find_collectibles || stats.collectible_finding || 0) / 100;

        // materialsPerCraft = (1 - NMC) / (1 + DR)
        const materialsPerCraft = (1 - nmc) / (1 + dr);

        const stepsPerRewardRoll = metrics.stepsPerRewardRoll;
        const drops = [];

        // Recipe-specific drop_table items (e.g., Mummy Egg from Tatty Garb,
        // Silver nugget from bar smelting with multi_roll_count).
        // Containers (chests) are skipped — they are rendered by the chest
        // row in the comparison table and would duplicate here otherwise.
        for (const drop of (this.recipe.drop_table || [])) {
            const dropName = drop.item_name || drop.name || 'Unknown';
            const dropChance = drop.chance_percent || 0;
            if (!dropChance) continue;

            const _isContainerRef = drop.item_ref && drop.item_ref.startsWith('Container.');
            const _isContainerType = drop.item_type && drop.item_type.toLowerCase() === 'container';
            if (_isContainerRef || _isContainerType) continue;

            let findBonus = 0;
            if (drop.item_ref) {
                if (drop.item_ref.startsWith('Collectible.')) findBonus = findCollectibles;
                if (drop.item_keywords && drop.item_keywords.some(kw => ['gem', 'rough gem'].includes(kw.toLowerCase()))) findBonus = findGems;
            }

            const qty = drop.quantity || 1;
            let stepsPerItem;
            let effectivePercent;
            if (drop.multi_roll_count && drop.multi_roll_count > 1) {
                // chance_percent is per-roll; N independent rolls per action.
                const perRoll = dropChance / 100;
                const boostedRoll = perRoll * (1 + findBonus);
                const denom = drop.multi_roll_count * boostedRoll * qty;
                stepsPerItem = denom > 0 ? stepsPerRewardRoll / denom : Infinity;
                effectivePercent = (1 - Math.pow(1 - boostedRoll, drop.multi_roll_count)) * 100;
            } else {
                stepsPerItem = stepsPerRewardRoll / ((dropChance / 100) * (1 + findBonus) * qty);
                effectivePercent = dropChance * (1 + findBonus);
            }
            // materialsPerItem = materialsPerCraft / ((1+DR) * dropRate)
            // For multi-roll: use expected-drops-per-craft = N * perRoll * qty
            const expectedDropsPerCraft = (drop.multi_roll_count && drop.multi_roll_count > 1)
                ? drop.multi_roll_count * (dropChance / 100) * qty
                : (dropChance / 100) * qty;
            const materialsPerItem = expectedDropsPerCraft > 0
                ? materialsPerCraft / ((1 + dr) * expectedDropsPerCraft)
                : null;

            drops.push({
                item_name: dropName,
                item_ref: drop.item_ref || null,
                steps_per_item: stepsPerItem,
                materials_per_item: materialsPerItem,
                steps_per_fine_item: null,
                coin_value: drop.coin_value || 0,
                fine_coin_value: 0,
                shell_value: drop.shell_value || 0,
                fine_shell_value: drop.fine_shell_value || 0,
                has_fine_material: false,
                item_keywords: drop.item_keywords || [],
                multi_roll_count: drop.multi_roll_count || null,
                source: 'recipe_drop',
                special_sell: drop.special_sell || null,
                chance_percent: dropChance,
                effective_percent: effectivePercent,
                quantity: { min: qty, max: qty, is_static: true }
            });
        }

        // Item-finding drops (equipment drops from ItemFindingCategory stats)
        // Need stepsPerAction for materials_per_item calculation
        const da = (stats.double_action || 0) / 100;
        const we = (stats.work_efficiency || 0) / 100;
        const flat = stats.flat_steps || stats.steps_add || 0;
        const pct = (stats.steps_percent || stats.steps_pct || 0) / 100;
        const cappedWE = Math.min(we, this.recipe.max_efficiency);
        // Single ceil at the END (KamiTzayig reference) — prevents off-by-one
        // errors when a pct modifier is applied.
        const baseOverEff = this.recipe.base_steps / (1 + cappedWE);
        const withPct = baseOverEff * (1 + pct);
        const stepsPerAction = Math.max(Math.ceil(withPct + flat), 10);
        const calcMPI = (spi) => {
            if (!isFinite(spi) || spi <= 0) return null;
            return materialsPerCraft * spi * (1 + da) / stepsPerAction;
        };

        for (const drop of extraDrops) {
            const dropChance = drop.chance_percent || 0;
            if (!dropChance) continue;
            const avgQty = this._calcAvgQuantity(drop.quantity);
            const stepsPerItem = (stepsPerRewardRoll * 100) / (dropChance * avgQty);

            let stepsPerFineItem = null;
            if (drop.has_fine_material) {
                const fineRate = dropChance * 0.01 * (1 + fineMaterialFinding);
                stepsPerFineItem = fineRate > 0 ? (stepsPerRewardRoll * 100) / (fineRate * avgQty) : null;
            }

            drops.push({
                item_name: drop.item_name,
                item_ref: drop.item_ref || null,
                steps_per_item: stepsPerItem,
                steps_per_fine_item: stepsPerFineItem,
                materials_per_item: calcMPI(stepsPerItem),
                coin_value: drop.coin_value || 0,
                fine_coin_value: drop.fine_coin_value || 0,
                fine_ag_token_value: drop.fine_ag_token_value || 0,
                shell_value: drop.shell_value || 0,
                fine_shell_value: drop.fine_shell_value || 0,
                has_fine_material: drop.has_fine_material,
                item_keywords: [],
                source: 'equipment',
                special_sell: drop.special_sell || null,
                chance_percent: dropChance,
                effective_percent: dropChance,
                quantity: drop.quantity
            });
        }

        // Chest drop — DR is already factored into stepsPerRewardRoll,
        // so chest steps only need CF
        const baseChestRate = 0.4;
        const displayChestRate = baseChestRate * (1 + chestFinding);
        const chestSteps = displayChestRate > 0 ? (stepsPerRewardRoll * 100) / displayChestRate : Infinity;
        // materialsPerItem for chest: materialsPerCraft / ((1+DR) * chestRate/100)
        const chestMaterialsPerItem = materialsPerCraft / ((1 + dr) * (displayChestRate / 100));
        const skill = (this.recipe.skill || '').toLowerCase();

        drops.push({
            item_name: `${skill}_chest`,
            item_ref: `Container.${skill}_chest`,
            steps_per_item: chestSteps,
            materials_per_item: chestMaterialsPerItem,
            steps_per_fine_item: null,
            coin_value: 0,
            fine_coin_value: 0,
            has_fine_material: false,
            item_keywords: [],
            source: 'chest',
            special_sell: null,
            chance_percent: baseChestRate,
            effective_percent: displayChestRate,  // CF only — DR affects steps separately
            quantity: { min: 1, max: 1, is_static: true },
            _chestSkill: skill  // used by _getDropIcon override below
        });

        drops.sort((a, b) => a.steps_per_item - b.steps_per_item);
        return drops;
    }

    /**
     * Get item finding drops filtered by which stats this gearset actually has
     */
    async _getItemFindingDropsForStats(skill, stats) {
        try {
            // Extract ItemFindingCategory stats from this gearset's stats
            const itemFindingStats = {};
            for (const [key, value] of Object.entries(stats)) {
                if (key.startsWith('ItemFindingCategory.') && value > 0) {
                    itemFindingStats[key] = value;
                }
            }

            if (Object.keys(itemFindingStats).length === 0) {
                return []; // No item finding stats in this gearset
            }

            // Use the same API as the single view — expand based on actual gearset stats
            const response = await fetch('/api/expand-equipment-drops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stats: itemFindingStats })
            });
            if (!response.ok) return [];
            const data = await response.json();

            return (data.drops || []).map(drop => ({
                item_name: drop.item_name,
                item_ref: drop.item_ref,
                chance_percent: drop.chance_percent,
                quantity: { min: drop.min_qty, max: drop.max_qty },
                has_fine_material: drop.has_fine_material,
                coin_value: drop.coin_value || 0,
                special_sell: drop.special_sell || null,
                fine_ag_token_value: drop.fine_ag_token_value || 0,
                source: 'equipment'
            }));
        } catch (error) {
            console.error('Failed to get item finding drops:', error);
            return [];
        }
    }

    _calcAvgQuantity(quantity) {
        if (!quantity) return 1;
        if (quantity.is_static || quantity.min === quantity.max) return quantity.min;
        return (quantity.min + quantity.max) / 2;
    }

    _getDropIcon(drop) {
        if (!drop.item_ref) return '/assets/icons/items/containers/treasure_chest.svg';
        const [type] = drop.item_ref.split('.');
        const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');
        const typeMap = {
            'Currency': `/assets/icons/items/${iconName}.svg`,
            'Material': `/assets/icons/items/materials/${iconName}.svg`,
            'Item': `/assets/icons/items/equipment/${iconName}.svg`,
            'Collectible': `/assets/icons/items/collectibles/${iconName}.svg`,
            'Consumable': `/assets/icons/items/consumables/${iconName}.svg`,
            'Container': `/assets/icons/items/containers/${iconName}.svg`,
            'Egg': `/assets/icons/items/pet_eggs/${iconName}.svg`
        };
        return typeMap[type] || `/assets/icons/items/materials/${iconName}.svg`;
    }

    _formatSteps(steps) {
        if (!steps || !isFinite(steps)) return '—';
        if (steps < 100) return formatFixed(steps, 2, { trim: true });
        return Math.ceil(steps).toLocaleString();
    }

    _getLocationIcon(location) {
        if (!location) return '';
        const locName = location.toLowerCase().replace(/ /g, '_').replace(/'/g, "'");
        return `/assets/icons/locations/${locName}.svg`;
    }

    _getSkillColor(skill) {
        const colors = {
            'fishing': 'var(--skill-fishing-color)', 'foraging': 'var(--skill-foraging-color)',
            'mining': 'var(--skill-mining-color)', 'woodcutting': 'var(--skill-woodcutting-color)',
            'hunting': 'var(--skill-hunting-color)', 'carpentry': 'var(--skill-carpentry-color)',
            'cooking': 'var(--skill-cooking-color)', 'smithing': 'var(--skill-smithing-color)',
            'crafting': 'var(--skill-crafting-color)', 'trinketry': 'var(--skill-trinketry-color)',
            'tailoring': 'var(--skill-tailoring-color)', 'agility': 'var(--skill-agility-color)',
            'traveling': '#00BCD4'
        };
        return colors[(skill || '').toLowerCase()] || 'var(--border-color)';
    }

    async render() {
        // Clean up floating dropdowns before re-rendering
        this._destroyLocationDropdowns();

        // Stale render guard — discard results from older render calls
        if (!this._renderId) this._renderId = 0;
        const myRenderId = ++this._renderId;

        if (!store.state.gearsets.comparisonMode) {
            this.$element.html('');
            return;
        }

        const hasContext = this.activity || this.recipe;
        console.log('[Comparison] render: hasContext=', !!hasContext, 'activity=', this.activity?.name, 'recipe=', this.recipe?.name);
        if (!hasContext) {
            this.$element.html(`
                <div class="comparison-section">
                    <div class="comparison-empty">Select an activity or recipe to compare gearsets</div>
                </div>
            `);
            return;
        }

        const gs1 = store.state.gearsets.current;
        const gs2 = store.state.gearsets.gearset2;

        const ctx1 = store.state.gearsets.gs1Context || {};
        const ctx2 = store.state.gearsets.gs2Context || {};

        // Fetch stats from backend for both gearsets in parallel
        const [result1, result2] = await Promise.all([
            this.calculateStatsForGearsetViaAPI(gs1, ctx1, 1),
            this.calculateStatsForGearsetViaAPI(gs2, ctx2, 2),
        ]);

        // Discard if a newer render started while we were awaiting
        if (myRenderId !== this._renderId) return;

        if (!result1 || !result2) {
            this.$element.html(`
                <div class="comparison-section">
                    <div class="comparison-empty">Loading stats...</div>
                </div>
            `);
            return;
        }

        const stats1 = result1.stats;
        const stats2 = result2.stats;

        // Cache stats for calculator comparison access
        this._cachedStats1 = stats1;
        this._cachedStats2 = stats2;

        const gs1Name = 'Gear set 1';
        const gs2Name = 'Gear set 2';

        let activityInfoHtml = '';
        let dropsHtml = '';

        if (this.activity && stats1 && stats2) {
            const m1 = this.calculateActivityMetrics(stats1);
            const m2 = this.calculateActivityMetrics(stats2);

            if (m1 && m2) {
                // Pass location from each gearset's context
                m1.location = ctx1.selectedLocation || this.activity.location || '';
                m2.location = ctx2.selectedLocation || this.activity.location || '';
                activityInfoHtml = this._renderActivityComparison(m1, m2, gs1Name, gs2Name, stats1, stats2);

                // Drops comparison — with per-gearset item finding drops
                const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';
                let ifDrops1 = [], ifDrops2 = [];
                if (showItemFinding && this.activity) {
                    const skill = this.activity.primary_skill?.toLowerCase() || 'global';
                    ifDrops1 = await this._getItemFindingDropsForStats(skill, stats1);
                    ifDrops2 = await this._getItemFindingDropsForStats(skill, stats2);
                }

                const drops1 = this.calculateDropsForGearset(stats1, ifDrops1);
                const drops2 = this.calculateDropsForGearset(stats2, ifDrops2);
                // Cache for CalculatorSection
                this._lastDrops1 = drops1;
                this._lastDrops2 = drops2;
                dropsHtml = this._renderDropsComparison(drops1, drops2, m1, m2, gs1Name, gs2Name);
            }
        } else if (this.recipe && stats1 && stats2) {
            console.log(`[ComparisonDebug] Recipe stats1 QO=${stats1.quality_outcome}, stats2 QO=${stats2.quality_outcome}`);
            console.log(`[ComparisonDebug] Recipe stats1 WE=${stats1.work_efficiency}, stats2 WE=${stats2.work_efficiency}`);
            console.log(`[ComparisonDebug] Full stats1:`, JSON.stringify(stats1));
            console.log(`[ComparisonDebug] Full stats2:`, JSON.stringify(stats2));
            console.log(`[ComparisonDebug] ctx1:`, JSON.stringify(ctx1));
            console.log(`[ComparisonDebug] ctx2:`, JSON.stringify(ctx2));
            const m1 = this.calculateRecipeMetrics(stats1, ctx1.useFine || false);
            const m2 = this.calculateRecipeMetrics(stats2, ctx2.useFine || false);

            if (m1 && m2) {
                activityInfoHtml = this._renderRecipeComparison(m1, m2, gs1Name, gs2Name);

                // Quality comparison table — cache data for in-place metric switching
                this._lastQualityData = { m1, m2, ctx1, ctx2, name1: gs1Name, name2: gs2Name };
                const qualityHtml = this._renderQualityComparison(m1, m2, ctx1, ctx2, gs1Name, gs2Name);

                // Recipe drops comparison — include item-finding drops per gearset
                const skill = (this.recipe.skill || '').toLowerCase();
                const ifDrops1 = await this._getItemFindingDropsForStats(skill, stats1);
                const ifDrops2 = await this._getItemFindingDropsForStats(skill, stats2);
                const recipeDrops1 = this.calculateRecipeDropsForGearset(stats1, m1, ifDrops1);
                const recipeDrops2 = this.calculateRecipeDropsForGearset(stats2, m2, ifDrops2);
                // Cache for CalculatorSection
                this._lastDrops1 = recipeDrops1;
                this._lastDrops2 = recipeDrops2;
                dropsHtml = this._renderDropsComparison(recipeDrops1, recipeDrops2, m1, m2, gs1Name, gs2Name);

                // Combine: activity info + quality + drops
                activityInfoHtml += qualityHtml;
            }
        }

        const html = `
            <div class="comparison-section">
                ${activityInfoHtml}
                ${dropsHtml}
            </div>
        `;

        // Preserve horizontal scroll positions before replacing HTML
        const scrollPositions = {};
        this.$element.find('.comparison-activity-content, .comparison-drops-content, .comparison-quality-content').each(function (i) {
            if (this.scrollLeft > 0) {
                scrollPositions[i] = this.scrollLeft;
            }
        });

        this.$element.html(html);

        // Restore horizontal scroll positions
        if (Object.keys(scrollPositions).length > 0) {
            this.$element.find('.comparison-activity-content, .comparison-drops-content, .comparison-quality-content').each(function (i) {
                if (scrollPositions[i]) {
                    this.scrollLeft = scrollPositions[i];
                }
            });
        }

        this.attachEvents();

        // Notify CalculatorSection to re-render its drops table with updated comparison drops
        if (!this._notifyingCalculator && window.calculatorSection && typeof window.calculatorSection.render === 'function') {
            this._notifyingCalculator = true;
            window.calculatorSection.render();
            this._notifyingCalculator = false;
        }
    }

    /**
     * Get active instant-actions pet info if checkbox is checked and pet is eligible.
     * Returns null if not active.
     */
    _getActiveInstantActionsPet() {
        const ownedItems = store.state.items || {};
        const userOverrideItems = store.state.ui?.user_overrides?.items || {};
        const petCatalog = window.optimizeButton?._petCatalog || [];
        if (!petCatalog.length) return null;

        let skillType = null;
        if (this.activity) {
            skillType = (this.activity.primary_skill || this.activity.skill || '').toLowerCase();
        } else if (this.recipe) {
            skillType = (this.recipe.skill || '').toLowerCase();
            if (skillType === 'smithing') {
                const recipeName = this.recipe.name || '';
                if (!SMELTING_RECIPE_NAMES.has(recipeName)) return null;
            }
        }
        if (!skillType) return null;

        const petInfo = getInstantActionsPet(skillType, ownedItems, petCatalog, userOverrideItems);
        if (!petInfo) return null;

        const uiState = store.state.ui || {};
        const isChecked = skillType === 'foraging'
            ? !!(uiState.instant_actions_foraging)
            : (skillType === 'smithing' || skillType === 'smelting')
                ? !!(uiState.instant_actions_smelting)
                : false;
        if (!isChecked) return null;

        const petId = petInfo.petId;
        const itemState = ownedItems[petId] || null;
        const overrideState = userOverrideItems[petId] || null;
        const level = overrideState?.level ?? itemState?.level ?? petInfo.requiredLevel;
        const variant = overrideState?.variant ?? itemState?.variant ?? 'normal';
        const maxLevel = petCatalog.find(p => p.id === petId)?.max_level || 0;
        const iconPath = getPetIconPath(petInfo.species, level, variant, maxLevel);

        return { ...petInfo, iconPath, level };
    }

    _renderActivityComparison(m1, m2, name1, name2, stats1, stats2) {
        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;
        const skill = m1.primarySkill || '';
        const skillLower = skill.toLowerCase();
        const skillIcon = `/assets/icons/text/skill_icons/${skillLower}.svg`;
        const stepsIcon = '/assets/icons/attributes/steps_required.svg';
        const weIcon = '/assets/icons/attributes/work_efficiency.svg';
        const drIcon = '/assets/icons/attributes/double_rewards.svg';
        const xpIcon = '/assets/icons/attributes/bonus_experience.svg';
        const skillColor = this._getSkillColor(skill);
        const icon = (src) => `<img src="${src}" alt="" class="comparison-stat-icon" onerror="this.style.display='none'" />`;
        const activityName = (this.activity.name || '').toUpperCase();

        const fmtWE = (m) => {
            const v = m.weDisplay;
            return (v % 1 === 0) ? formatFixed(v, 0) : formatFixed(v, 2);
        };
        const maxWE = (m1.maxWEDisplay % 1 === 0) ? formatFixed(m1.maxWEDisplay, 0) : formatFixed(m1.maxWEDisplay, 1);

        const cls = (a, b, lowerBetter) => {
            if (a === b) return '';
            return (lowerBetter ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
        };

        // Secondary XP
        const secondaryXP = this.activity.secondary_xp || {};
        const hasSecondary = Object.keys(secondaryXP).length > 0;

        const calcXP = (stats, baseXP) => {
            const bonusAdd = stats.bonus_xp_add || stats.bonus_experience_add || 0;
            const bonusPct = (stats.bonus_xp_percent || stats.bonus_experience_percent || 0) / 100;
            return (baseXP + bonusAdd) * (1 + bonusPct);
        };

        // stats1 and stats2 are passed in from render()

        const pXP1 = calcXP(stats1, this.activity.base_xp);
        const pXP2 = calcXP(stats2, this.activity.base_xp);
        const sXP1 = {}, sXP2 = {};
        for (const [sk, baseXP] of Object.entries(secondaryXP)) {
            sXP1[sk] = calcXP(stats1, baseXP);
            sXP2[sk] = calcXP(stats2, baseXP);
        }
        const totalXP1 = pXP1 + Object.values(sXP1).reduce((s, v) => s + v, 0);
        const totalXP2 = pXP2 + Object.values(sXP2).reduce((s, v) => s + v, 0);
        const fmtXP = (v) => formatFixed(v, 2, { trim: true });

        // Requirements — render per gearset with green/red fulfillment
        const reqs = this.activity.requirements || {};
        const skillReqs = reqs.skill_requirements || {};
        const keywordCounts = reqs.keyword_counts || {};
        const itemReqs = reqs.item_requirements || [];
        const hasReqs = Object.keys(skillReqs).length > 0 ||
            Object.values(keywordCounts).some(v => v > 0) ||
            itemReqs.length > 0;

        // Count keywords in a gearset
        const countKeywords = (gs, keyword, gsNum) => {
            let count = 0;
            const kwLower = keyword.toLowerCase();
            for (const item of Object.values(gs)) {
                if (item && item.keywords) {
                    if (item.keywords.some(k => k.toLowerCase() === kwLower)) count++;
                }
            }
            // Also count selected input items for this gearset (e.g. arrows in the
            // input slot satisfying Lizard Hunting's 'arrows' requirement). Mirrors
            // the single view's checkRequirementsFulfilled() behaviour.
            if (gsNum !== undefined) {
                const inputItems = this._selectedInputItems?.[gsNum] || {};
                for (const item of Object.values(inputItems)) {
                    if (item && item.keywords) {
                        if (item.keywords.some(k => k.toLowerCase() === kwLower)) count++;
                    }
                }
            }
            // Equipped pet with a passive "provides_keyword" ability counts as +1
            // (e.g. Gecko L4 Clever Climber → climbing gear). Mirrors the
            // single view's behaviour in checkRequirementsFulfilled().
            const equippedPet = gs?.pet;
            if (equippedPet) {
                const petCatalog = window.optimizeButton?._petCatalog || [];
                const petId = (equippedPet.itemId || equippedPet.petId || equippedPet.id || equippedPet.name || '').toLowerCase();
                const petEntry = petCatalog.find(p =>
                    (p.id && p.id.toLowerCase() === petId) ||
                    (p.name && p.name.toLowerCase() === (equippedPet.name || '').toLowerCase())
                );
                const levelData = petEntry?.levels?.[String(equippedPet.level ?? 0)] || null;
                const abilities = levelData?.abilities || [];
                const ABILITY_NAME_TO_KEYWORD = { 'clever climber': 'climbing gear' };
                for (const ability of abilities) {
                    if (!ability) continue;
                    const provided = ability.provides_keyword;
                    const abilityName = (ability.name || '').toLowerCase();
                    const providesList = [];
                    if (typeof provided === 'string') providesList.push(provided.toLowerCase());
                    else if (Array.isArray(provided)) {
                        for (const p of provided) if (typeof p === 'string') providesList.push(p.toLowerCase());
                    }
                    const mapped = ABILITY_NAME_TO_KEYWORD[abilityName];
                    if (mapped) providesList.push(mapped);
                    if (providesList.includes(kwLower)) { count++; break; }
                }
            }
            return count;
        };

        // Check skill level
        const getCharSkillLevel = (sk) => {
            const skills = store.state.character?.skills || {};
            const overrides = store.state.ui?.user_overrides?.skills || {};
            if (overrides[sk] !== undefined) return overrides[sk];
            for (const [name, data] of Object.entries(skills)) {
                if (name.toLowerCase() === sk.toLowerCase()) return data.level || data || 1;
            }
            return 1;
        };

        const renderReqPills = (gs, gsNum) => {
            let html = '';
            for (const [sk, level] of Object.entries(skillReqs)) {
                const charLevel = getCharSkillLevel(sk);
                const fulfilled = charLevel >= level;
                const borderClass = fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                html += `<div class="requirement-item ${borderClass}">
                    <img src="/assets/icons/text/skill_icons/${sk.toLowerCase()}.svg" alt="${sk}" class="requirement-icon" onerror="this.style.display='none'" />
                    <span class="requirement-value">${level}</span>
                </div>`;
            }
            for (const [kw, count] of Object.entries(keywordCounts)) {
                if (count <= 0) continue;
                const kwId = kw.replace(/ /g, '_').replace(/'/g, '');
                const have = countKeywords(gs, kw, gsNum);
                const fulfilled = have >= count;
                const borderClass = fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                html += `<div class="requirement-item ${borderClass}">
                    <span class="requirement-value">${count}</span>
                    <img src="/assets/icons/keywords/${kwId}.svg" alt="${kw}" class="requirement-icon" onerror="this.style.display='none'" />
                    <span class="requirement-label">${kw}</span>
                </div>`;
            }
            for (const itemName of itemReqs) {
                const nameLower = itemName.toLowerCase();
                const equippedInGear = Object.values(gs).some(
                    it => it && it.name && it.name.toLowerCase() === nameLower
                );
                // Also check input slots — a required item may be satisfied by an input.
                const inputItems = gsNum !== undefined ? (this._selectedInputItems?.[gsNum] || {}) : {};
                const equippedInInput = Object.values(inputItems).some(
                    it => it && it.name && it.name.toLowerCase() === nameLower
                );
                const equipped = equippedInGear || equippedInInput;
                const borderClass = equipped ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                const itemId = nameLower.replace(/ /g, '_').replace(/'/g, '');
                html += `<div class="requirement-item ${borderClass}">
                    <img src="/assets/icons/items/equipment/${itemId}.svg" alt="${itemName}" class="requirement-icon" onerror="this.style.display='none'" />
                    <span class="requirement-label">${itemName}</span>
                </div>`;
            }
            return html;
        };

        // Locations — use same style as main view
        const locations = this.activity.locations || [];
        const loc1 = (store.state.gearsets.gs1Context || {}).selectedLocation || (locations[0] && locations[0].id) || '';
        const loc2 = (store.state.gearsets.gs2Context || {}).selectedLocation || (locations[0] && locations[0].id) || '';

        const renderLocGrid = (selectedLoc, gsNum) => {
            if (locations.length === 0) return '';
            return locations.map(loc => {
                const isSelected = loc.id === selectedLoc;
                const iconPath = loc.icon_name
                    ? `/assets/icons/locations/${loc.icon_name}`
                    : `/assets/icons/locations/${loc.id}.svg`;
                return `<div class="location-item ${isSelected ? 'location-selected' : ''}" data-location-id="${loc.id}" data-gs="${gsNum}">
                        <img src="${iconPath}" alt="${loc.name}" class="location-icon" onerror="this.style.display='none'" />
                        <span class="location-name">${loc.name}</span>
                    </div>`;
            }).join('');
        };

        // Build all rows in one table
        let rows = '';

        // Stats
        rows += `<tr><td><div class="comparison-label">${icon(stepsIcon)} Steps / Action</div></td>
                <td class="${cls(m1.stepsPerAction, m2.stepsPerAction, true)}">${m1.stepsPerAction} / ${this.activity.base_steps}</td>
                <td class="${cls(m2.stepsPerAction, m1.stepsPerAction, true)}">${m2.stepsPerAction} / ${this.activity.base_steps}</td></tr>`;
        rows += `<tr><td><div class="comparison-label">${icon(weIcon)} Work Efficiency</div></td>
                <td class="${m1.weExceedsMax ? 'comparison-we-maxed' : cls(m1.weDisplay, m2.weDisplay, false)}">${fmtWE(m1)} / ${maxWE}%</td>
                <td class="${m2.weExceedsMax ? 'comparison-we-maxed' : cls(m2.weDisplay, m1.weDisplay, false)}">${fmtWE(m2)} / ${maxWE}%</td></tr>`;
        rows += `<tr><td><div class="comparison-label">${icon(drIcon)} Steps / Reward</div></td>
                <td class="${cls(m1.stepsPerRewardRoll, m2.stepsPerRewardRoll, true)}">${formatFixed(m1.stepsPerRewardRoll, 2)}</td>
                <td class="${cls(m2.stepsPerRewardRoll, m1.stepsPerRewardRoll, true)}">${formatFixed(m2.stepsPerRewardRoll, 2)}</td></tr>`;

        // Instant-actions: reward rolls per activation
        const petInfo = this._getActiveInstantActionsPet();
        if (petInfo) {
            const da1 = (stats1.double_action || 0) / 100;
            const dr1 = (stats1.double_rewards || 0) / 100;
            const da2 = (stats2.double_action || 0) / 100;
            const dr2 = (stats2.double_rewards || 0) / 100;
            // Per activation: the pet runs `count` actions per activation, so
            // multiply by count (matches the single activity info section).
            const chargeCount = petInfo.count || 5;
            const rrpa1 = chargeCount * (1 + da1) * (1 + dr1);
            const rrpa2 = chargeCount * (1 + da2) * (1 + dr2);
            const fmt = (v) => formatFixed(v, 3, { trim: true });
            const rrTitle = `Reward rolls per activation (${chargeCount} actions × (1+DA) × (1+DR))`;
            const rollsIconHtml = `<img src="/assets/icons/attributes/double_rewards.svg" alt="Reward rolls" class="comparison-stat-icon" style="width:24px;height:24px;object-fit:contain" />`;
            const petIconHtml = `<img src="${petInfo.iconPath}" alt="${petInfo.petName}" class="comparison-stat-icon" style="width:24px;height:24px;object-fit:contain" onerror="this.src='/assets/icons/items/pet_eggs/${petInfo.species}_egg.svg'" />`;
            rows += `<tr title="${rrTitle}"><td><div class="comparison-label">${rollsIconHtml}<span style="font-size:0.85em;color:var(--text-secondary)">/</span>${petIconHtml}</div></td>
                    <td class="${cls(rrpa1, rrpa2, false)}">${fmt(rrpa1)}</td>
                    <td class="${cls(rrpa2, rrpa1, false)}">${fmt(rrpa2)}</td></tr>`;
        }

        // Requirements (per gearset with green/red, in table columns)
        if (hasReqs) {
            const gs1 = store.state.gearsets.current;
            const gs2 = store.state.gearsets.gearset2;
            rows += `<tr>
                <td><div class="comparison-label">Requirements</div></td>
                <td><div class="requirements-grid" style="justify-content:center">${renderReqPills(gs1, 1)}</div></td>
                <td><div class="requirements-grid" style="justify-content:center">${renderReqPills(gs2, 2)}</div></td>
            </tr>`;
        }

        // XP — skill icon rows, no section header (higher XP = better)
        rows += `<tr><td><div class="comparison-label">${icon(skillIcon)} ${skill} XP</div></td>
                <td class="${cls(pXP1, pXP2, false)}">${fmtXP(pXP1)} / ${this.activity.base_xp}</td>
                <td class="${cls(pXP2, pXP1, false)}">${fmtXP(pXP2)} / ${this.activity.base_xp}</td></tr>`;
        for (const [sk, baseXP] of Object.entries(secondaryXP)) {
            const skName = sk.charAt(0).toUpperCase() + sk.slice(1);
            const skIcon = `/assets/icons/text/skill_icons/${sk.toLowerCase()}.svg`;
            rows += `<tr><td><div class="comparison-label">${icon(skIcon)} ${skName} XP</div></td>
                    <td class="${cls(sXP1[sk], sXP2[sk], false)}">${fmtXP(sXP1[sk])} / ${baseXP}</td>
                    <td class="${cls(sXP2[sk], sXP1[sk], false)}">${fmtXP(sXP2[sk])} / ${baseXP}</td></tr>`;
        }
        if (hasSecondary) {
            rows += `<tr><td><div class="comparison-label">${icon(xpIcon)} Total XP</div></td>
                    <td class="${cls(totalXP1, totalXP2, false)}">${fmtXP(totalXP1)}</td><td class="${cls(totalXP2, totalXP1, false)}">${fmtXP(totalXP2)}</td></tr>`;
        }

        // XP Per Step — skill icon + "/ step" suffix
        const pPS1 = pXP1 / m1.expectedStepsPerAction;
        const pPS2 = pXP2 / m2.expectedStepsPerAction;
        rows += `<tr><td><div class="comparison-label">${icon(skillIcon)} ${skill} / step</div></td>
                <td class="${cls(pPS1, pPS2, false)}">${formatFixed(pPS1, 3)}</td>
                <td class="${cls(pPS2, pPS1, false)}">${formatFixed(pPS2, 3)}</td></tr>`;
        for (const [sk] of Object.entries(secondaryXP)) {
            const skName = sk.charAt(0).toUpperCase() + sk.slice(1);
            const skIcon = `/assets/icons/text/skill_icons/${sk.toLowerCase()}.svg`;
            const s1 = sXP1[sk] / m1.expectedStepsPerAction;
            const s2 = sXP2[sk] / m2.expectedStepsPerAction;
            rows += `<tr><td><div class="comparison-label">${icon(skIcon)} ${skName} / step</div></td>
                    <td class="${cls(s1, s2, false)}">${formatFixed(s1, 3)}</td>
                    <td class="${cls(s2, s1, false)}">${formatFixed(s2, 3)}</td></tr>`;
        }
        if (hasSecondary) {
            const tPS1 = totalXP1 / m1.expectedStepsPerAction;
            const tPS2 = totalXP2 / m2.expectedStepsPerAction;
            rows += `<tr><td><div class="comparison-label">${icon(xpIcon)} Total / step</div></td>
                    <td class="${cls(tPS1, tPS2, false)}">${formatFixed(tPS1, 3)}</td>
                    <td class="${cls(tPS2, tPS1, false)}">${formatFixed(tPS2, 3)}</td></tr>`;
        }

        // Input items (for activities that consume items per action) — as first table row
        const inputItems = this.activity.input_items || [];
        const validInputs = inputItems.filter(ii => ii && ii.name);

        // Input row — will be prepended before stats rows
        let inputRows = '';
        if (validInputs.length > 0) {
            const hasKeywordInput = validInputs.some(ii => ii.type === 'keyword');

            const renderInputSlot = (gsNum) => {
                const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
                const ctx = store.state.gearsets[ctxKey] || {};
                const useFine = ctx.useFine || false;

                let html = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px">';
                for (let idx = 0; idx < validInputs.length; idx++) {
                    const ii = validInputs[idx];
                    const itemId = ii.name.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
                    const isKeyword = ii.type === 'keyword';

                    if (isKeyword) {
                        const selectedItem = this._selectedInputItems?.[gsNum]?.[idx] || null;
                        let slotInner, slotClasses = 'input-item-slot';
                        if (selectedItem) {
                            slotClasses += ' equipped';
                            if (useFine) {
                                slotClasses += ' fine';
                            } else {
                                slotClasses += ` rarity-${selectedItem.rarity || 'common'}`;
                            }
                            const selItemId = (selectedItem.name || '').toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
                            const iconPath = selectedItem.icon_path || `/assets/icons/items/materials/${selItemId}.svg`;
                            slotInner = `<img src="${iconPath}" alt="${selectedItem.name}" class="input-slot-icon" onerror="this.style.display='none'" />`;
                        } else {
                            const label = ii.name.length > 6 ? ii.name.substring(0, 5) + '…' : ii.name;
                            slotInner = `<span class="input-slot-name">${label}</span>`;
                        }
                        const title = selectedItem ? selectedItem.name : `Select ${ii.name}`;
                        html += `<div class="${slotClasses}" data-input-idx="${idx}" data-input-keyword="${ii.reference || ii.name}" data-input-level="${ii.level || 0}" data-gs="${gsNum}" title="${title}">
                            ${slotInner}
                        </div>`;
                    } else {
                        const iconPath = `/assets/icons/items/materials/${itemId}.svg`;
                        const fineClass = useFine ? ' fine' : '';
                        html += `<div class="material-item${fineClass}" title="${ii.name}" style="display:inline-flex">
                            <img src="${iconPath}" alt="${ii.name}" class="material-icon"
                                onerror="this.onerror=null;this.style.display='none';this.parentNode.insertAdjacentHTML('afterbegin','<span style=\\'font-size:16px\\'>📥</span>')" />
                            <span class="material-quantity">${ii.quantity}</span>
                        </div>`;
                    }
                }
                // Fine checkbox under the slot
                if (hasKeywordInput) {
                    html += `<label class="fine-checkbox" style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;font-size:11px">
                        <input type="checkbox" class="comparison-fine-inputs-cb" data-gs="${gsNum}" ${useFine ? 'checked' : ''} />
                        <span class="fine-checkbox-label">Fine</span>
                    </label>`;
                }
                html += '</div>';
                return html;
            };

            // Build left column: "Inputs" label, then keyword info on new line
            let labelHtml = '<div class="comparison-label" style="text-align:right;flex-direction:column;align-items:flex-end;white-space:normal"><strong>Inputs</strong>';
            for (const ii of validInputs) {
                const itemId = ii.name.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
                labelHtml += `<div style="margin-top:4px;font-size:11px;display:flex;align-items:center;gap:3px">
                    <img src="/assets/icons/keywords/${itemId}.svg" style="width:14px;height:14px" onerror="this.outerHTML='<span style=\\'font-size:12px\\'>🏷️</span>'" />
                    <span>${ii.quantity}× ${ii.name}</span>
                    ${ii.level ? `<span class="input-level-req" style="font-size:10px">Lv.${ii.level}+</span>` : ''}
                </div>`;
            }
            labelHtml += '</div>';

            inputRows += `<tr>
                <td>${labelHtml}</td>
                <td style="text-align:center;vertical-align:middle">${renderInputSlot(1)}</td>
                <td style="text-align:center;vertical-align:middle">${renderInputSlot(2)}</td>
            </tr>`;
        }

        // Locations (as grid spanning both columns, side by side)
        if (locations.length > 0) {
            rows += `<tr><td colspan="3" class="comparison-inline-section">
                    <div class="comparison-inline-header">LOCATIONS</div>
                    <div class="comparison-locations-row">
                        <div class="comparison-locations-col">
                            <div class="locations-grid">${renderLocGrid(loc1, 1)}</div>
                        </div>
                        <div class="comparison-locations-col">
                            <div class="locations-grid">${renderLocGrid(loc2, 2)}</div>
                        </div>
                    </div>
                </td></tr>`;
        }

        return `
                <div class="comparison-activity-section" style="--comparison-skill-color: ${skillColor}">
                    <div class="activity-info-header" data-section="activity">
                        <span class="activity-info-title">${activityName}</span>
                        ${arrowIcon}
                    </div>
                    <div class="comparison-activity-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                        <table class="comparison-table">
                            <thead><tr><th></th><th>${name1}</th><th>${name2}</th></tr></thead>
                            <tbody>${inputRows}${rows}</tbody>
                        </table>
                    </div>
                </div>
            `;
    }

    _renderRecipeComparison(m1, m2, name1, name2) {
        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;
        const skill = m1.primarySkill || '';
        const skillLower = skill.toLowerCase();
        const skillIcon = `/assets/icons/text/skill_icons/${skillLower}.svg`;
        const stepsIcon = '/assets/icons/attributes/steps_required.svg';
        const weIcon = '/assets/icons/attributes/work_efficiency.svg';
        const drIcon = '/assets/icons/attributes/double_rewards.svg';

        const skillColor = this._getSkillColor(skill);
        const icon = (src) => `<img src="${src}" alt="" class="comparison-stat-icon" onerror="this.style.display='none'" />`;

        const fmtWE = (m) => {
            const v = m.weDisplay;
            return (v % 1 === 0) ? formatFixed(v, 0) : formatFixed(v, 2);
        };
        const fmtMaxWE = (m) => {
            const v = m.maxWEDisplay;
            return (v % 1 === 0) ? formatFixed(v, 0) : formatFixed(v, 1);
        };

        const cls = (a, b, lowerBetter) => {
            if (a === b) return '';
            return (lowerBetter ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
        };

        const recipeName = (this.recipe.name || '').toUpperCase();

        // Build services + locations HTML per gearset
        const services = this.recipeServices || [];
        const ctx1 = store.state.gearsets.gs1Context || {};
        const ctx2 = store.state.gearsets.gs2Context || {};

        const renderServiceGrid = (ctx, gsNum) => {
            if (services.length === 0 && this.recipeServiceType !== 'None') return '';
            let html = '';
            // Add "No service" option only when recipe doesn't require a service
            if (this.recipeServiceType === 'None') {
                const noSvcSelected = ctx.selectedService === '__none__';
                html += `<div class="service-item ${noSvcSelected ? 'service-selected' : ''}" data-service-id="__none__" data-gs="${gsNum}">
                    <span class="service-icon" style="font-size:16px">🚫</span>
                    <span class="service-name">No service</span>
                </div>`;
            }
            html += services.map(svc => {
                const isSelected = svc.id === ctx.selectedService
                    || (svc.locations && svc.locations.some(l => l.service_id === ctx.selectedService));
                const lockedClass = !svc.is_unlocked ? 'service-locked' : '';
                let displayName = svc.name;
                let iconName = svc.name.replace(/ /g, '_').toLowerCase();
                if (!svc.name.toLowerCase().startsWith('basic') && svc.is_basic) {
                    displayName += ' (Basic)';
                    iconName += '_(basic)';
                } else if (svc.is_advanced) {
                    displayName += ' (Advanced)';
                    iconName += '_(advanced)';
                }
                const svcIcon = `/assets/icons/services/${iconName}.svg`;
                return `<div class="service-item ${isSelected ? 'service-selected' : ''} ${lockedClass}" data-service-id="${svc.id}" data-gs="${gsNum}">
                    <img src="${svcIcon}" alt="${displayName}" class="service-icon" onerror="this.style.display='none'" />
                    <span class="service-name">${displayName}</span>
                </div>`;
            }).join('');
            return html;
        };

        const renderLocationGrid = (ctx, gsNum) => {
            if (ctx.selectedService === '__none__') {
                // "No service" — render a mount point for LocationDropdown component
                return `<div class="comparison-loc-dropdown-mount" data-gs="${gsNum}"></div>`;
            }
            const svc = this._findServiceById(ctx.selectedService);
            if (!svc || !svc.locations || svc.locations.length === 0) return '';
            return svc.locations.map(locData => {
                const loc = locData.location;
                const isSelected = loc.id === ctx.selectedLocation;
                const iconPath = loc.icon_name
                    ? `/assets/icons/locations/${loc.icon_name}`
                    : `/assets/icons/locations/${loc.id}.svg`;
                return `<div class="location-item ${isSelected ? 'location-selected' : ''}" data-location-id="${loc.id}" data-service-specific-id="${locData.service_id}" data-gs="${gsNum}">
                    <img src="${iconPath}" alt="${loc.name}" class="location-icon" onerror="this.style.display='none'" />
                    <span class="location-name">${loc.name}</span>
                </div>`;
            }).join('');
        };

        // Build stat rows
        let rows = '';

        // Fine Materials checkbox at top (as a table row)
        const fineChecked1 = ctx1.useFine ? 'checked' : '';
        const fineChecked2 = ctx2.useFine ? 'checked' : '';
        const fineClass1 = ctx1.useFine ? 'fine-checkbox fine-checked' : 'fine-checkbox';
        const fineClass2 = ctx2.useFine ? 'fine-checkbox fine-checked' : 'fine-checkbox';
        rows += `<tr>
            <td><div class="comparison-label">Fine</div></td>
            <td style="text-align:center"><label class="${fineClass1}"><input type="checkbox" class="comparison-fine-materials-cb" data-gs="1" ${fineChecked1} /></label></td>
            <td style="text-align:center"><label class="${fineClass2}"><input type="checkbox" class="comparison-fine-materials-cb" data-gs="2" ${fineChecked2} /></label></td>
        </tr>`;

        // Build materials section (above the table, not inside it)
        let materialsHtml = '';
        if (this.recipe.materials && this.recipe.materials.length > 0) {
            if (!this._selectedMaterialGroup) this._selectedMaterialGroup = 0;
            const selectedGroup = this.recipe.materials[this._selectedMaterialGroup] || this.recipe.materials[0];

            // Material group selector (when multiple groups exist)
            let groupSelectorHtml = '';
            if (this.recipe.materials.length > 1) {
                const groupLabels = this._getMaterialGroupLabels();
                let buttons = '';
                for (let i = 0; i < this.recipe.materials.length; i++) {
                    const selectedClass = i === this._selectedMaterialGroup ? 'selected' : '';
                    const label = groupLabels[i] || `Group ${i + 1}`;
                    buttons += `<button class="material-group-button ${selectedClass}" data-group-index="${i}" title="${label}">${label}</button>`;
                }
                groupSelectorHtml = `<div class="material-group-selector">${buttons}</div>`;
            }

            let matItems = '';
            const fineActive1 = (ctx1.useFine || false);
            const fineActive2 = (ctx2.useFine || false);
            const anyFine = fineActive1 || fineActive2;
            const ownedQuantities = (store.state.character && store.state.character.owned_quantities) || {};
            for (let i = 0; i < selectedGroup.length; i++) {
                const material = selectedGroup[i];
                const iconName = material.material_icon_name || material.material_id;
                let iconPath = '';
                if (material.type === 'material') {
                    iconPath = `/assets/icons/items/materials/${iconName}.svg`;
                } else if (material.type === 'consumable') {
                    iconPath = `/assets/icons/items/consumables/${iconName}.svg`;
                } else if (material.type === 'equipment') {
                    iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
                }
                // Apply fine CSS to non-equipment materials when either gearset has fine checked
                const fineClass = (anyFine && material.type !== 'equipment') ? ' material-fine' : '';

                // Have-enough / have-not-enough outline coloring (same logic as
                // single-recipe view in recipe-info-section.js). Empty
                // owned_quantities → neutral; otherwise missing keys are treated
                // as 0 owned and color red.
                //
                // When fine is on for non-equipment materials, the recipe
                // consumes the fine variant — look up "${materialId}_fine".
                // Comparison view applies fine if EITHER gearset has fine
                // checked (matches the existing fineClass behavior).
                const materialId = material.material_id;
                const lookupId = (anyFine && material.type !== 'equipment')
                    ? `${materialId}_fine`
                    : materialId;
                const ownedMapHasData = ownedQuantities && Object.keys(ownedQuantities).length > 0;
                let haveClass = '';
                let ownedAttr = '';
                if (lookupId && ownedMapHasData) {
                    const owned = ownedQuantities[lookupId] || 0;
                    haveClass = owned >= material.quantity
                        ? ' material-have-enough'
                        : ' material-have-not-enough';
                    ownedAttr = owned;
                }

                matItems += `<div class="material-item material-item-clickable${fineClass}${haveClass}" data-material-name="${material.material_name}" data-material-id="${materialId}" data-material-lookup-id="${lookupId}" data-material-index="${i}" data-material-required="${material.quantity}" data-material-owned="${ownedAttr}" title="${material.material_name}">
                    <img src="${iconPath}" alt="${material.material_name}" class="material-icon" />
                    <span class="material-quantity">${material.quantity}</span>
                </div>`;
            }
            materialsHtml = `
                <div style="padding: 0 var(--spacing-sm);">
                    <div class="comparison-inline-header" style="border-bottom: 1px solid var(--border-subtle); margin-bottom: var(--spacing-sm); padding-bottom: var(--spacing-xs);">MATERIALS</div>
                    ${groupSelectorHtml}
                    <div class="materials-list">
                        <div class="materials-grid">${matItems}</div>
                    <div class="material-source-dropdown" style="display: none;">
                        <div class="material-source-nav">
                            <button class="material-source-nav-btn material-source-prev" title="Previous material">◀</button>
                            <span class="material-source-nav-label"></span>
                            <button class="material-source-nav-btn material-source-next" title="Next material">▶</button>
                        </div>
                        <div class="material-source-viewport">
                            <div class="material-source-page"></div>
                        </div>
                    </div>
                </div>
                </div>`;
        }

        rows += `<tr>
            <td><div class="comparison-label">${icon(stepsIcon)} Craft</div></td>
            <td class="${cls(m1.stepsPerRewardRoll, m2.stepsPerRewardRoll, true)}">${formatFixed(m1.stepsPerRewardRoll, 2)}</td>
            <td class="${cls(m2.stepsPerRewardRoll, m1.stepsPerRewardRoll, true)}">${formatFixed(m2.stepsPerRewardRoll, 2)}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(stepsIcon)} Action</div></td>
            <td class="${cls(m1.stepsPerSingleAction, m2.stepsPerSingleAction, true)}">${m1.stepsPerSingleAction} / ${m1.baseSteps}</td>
            <td class="${cls(m2.stepsPerSingleAction, m1.stepsPerSingleAction, true)}">${m2.stepsPerSingleAction} / ${m2.baseSteps}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(weIcon)} Work Efficiency</div></td>
            <td class="${m1.weExceedsMax ? 'comparison-we-maxed' : cls(m1.weDisplay, m2.weDisplay, false)}">${fmtWE(m1)} / ${fmtMaxWE(m1)}%</td>
            <td class="${m2.weExceedsMax ? 'comparison-we-maxed' : cls(m2.weDisplay, m1.weDisplay, false)}">${fmtWE(m2)} / ${fmtMaxWE(m2)}%</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(skillIcon)} Level</div></td>
            <td>${m1.level}</td>
            <td>${m2.level}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(skillIcon)} XP</div></td>
            <td class="${cls(m1.calculatedXP, m2.calculatedXP, false)}">${formatFixed(m1.calculatedXP, 2, { trim: true })} / ${m1.baseXP}</td>
            <td class="${cls(m2.calculatedXP, m1.calculatedXP, false)}">${formatFixed(m2.calculatedXP, 2, { trim: true })} / ${m2.baseXP}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(skillIcon)} XP / Step</div></td>
            <td class="${cls(m1.xpPerStep, m2.xpPerStep, false)}">${formatFixed(m1.xpPerStep, 3)}</td>
            <td class="${cls(m2.xpPerStep, m1.xpPerStep, false)}">${formatFixed(m2.xpPerStep, 3)}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(skillIcon)} XP / Mat</div></td>
            <td class="${cls(m1.xpPerMaterial, m2.xpPerMaterial, false)}">${formatFixed(m1.xpPerMaterial, 2)}</td>
            <td class="${cls(m2.xpPerMaterial, m1.xpPerMaterial, false)}">${formatFixed(m2.xpPerMaterial, 2)}</td>
        </tr>`;
        rows += `<tr>
            <td><div class="comparison-label">${icon(drIcon)} Crafts / Mat</div></td>
            <td class="${cls(m1.craftsPerMaterial, m2.craftsPerMaterial, false)}">${formatFixed(m1.craftsPerMaterial, 3)}</td>
            <td class="${cls(m2.craftsPerMaterial, m1.craftsPerMaterial, false)}">${formatFixed(m2.craftsPerMaterial, 3)}</td>
        </tr>`;

        // Instant-actions charge stats (smelting recipes only)
        const petInfoRecipe = this._getActiveInstantActionsPet();
        if (petInfoRecipe) {
            const chargeCount = petInfoRecipe.count || 5;
            const selectedGroup = this.recipe.materials?.[this._selectedMaterialGroup || 0] || this.recipe.materials?.[0] || [];
            const totalBaseQty = selectedGroup.reduce((sum, m) => sum + (m.quantity || 1), 0);

            // Output quantity — multiply crafts by recipe's output-per-craft quantity
            // e.g. "Smelt into ectoplasm" outputs 2 ectoplasm per craft
            const outputQty = this.recipe.quantity || 1;
            const crafts1 = chargeCount * (1 + (m1.da || 0)) * (1 + (m1.dr || 0));
            const crafts2 = chargeCount * (1 + (m2.da || 0)) * (1 + (m2.dr || 0));
            const output1 = crafts1 * outputQty;
            const output2 = crafts2 * outputQty;
            // XP per charge = chargeCount × (1+DA) × XP_per_craft (DR does NOT affect XP)
            const xp1 = chargeCount * (1 + (m1.da || 0)) * (m1.calculatedXP || 0);
            const xp2 = chargeCount * (1 + (m2.da || 0)) * (m2.calculatedXP || 0);
            const mats1 = chargeCount * (1 + (m1.da || 0)) * (1 - (m1.nmc || 0)) * totalBaseQty;
            const mats2 = chargeCount * (1 + (m2.da || 0)) * (1 - (m2.nmc || 0)) * totalBaseQty;

            const fmtC = (v) => formatFixed(v, 2, { trim: true });

            const outputName = (this.recipe.output_item_name || this.recipe.name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
            const outputIconPath = `/assets/icons/items/materials/${outputName}.svg`;
            const firstMat = selectedGroup[0];
            const matName = (firstMat?.material_name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
            const matIconPath = firstMat ? `/assets/icons/items/materials/${matName}.svg` : '/assets/icons/attributes/double_rewards.svg';

            const petIconHtml = `<img src="${petInfoRecipe.iconPath}" alt="${petInfoRecipe.petName}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;margin-left:2px" onerror="this.src='/assets/icons/items/pet_eggs/${petInfoRecipe.species}_egg.svg'" />`;

            // CRAFTS/CHARGE or OUTPUT/CHARGE (if multi-output recipe, show actual output count)
            const outputRowTitle = outputQty > 1
                ? `Output per charge (${chargeCount} × (1+DA) × (1+DR) × ${outputQty} per craft)`
                : `Crafts per charge (${chargeCount} × (1+DA) × (1+DR))`;
            const outputDisplay1 = outputQty > 1 ? output1 : crafts1;
            const outputDisplay2 = outputQty > 1 ? output2 : crafts2;
            // Note: .comparison-label has flex-direction: row-reverse, so source order
            // must be reversed to get "secondary_icon / pet_icon" visually (SOMETHING per PET).
            rows += `<tr title="${outputRowTitle}">
                <td><div class="comparison-label">
                    <img src="${petInfoRecipe.iconPath}" alt="${petInfoRecipe.petName}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.src='/assets/icons/items/pet_eggs/${petInfoRecipe.species}_egg.svg'" />
                    <span style="font-size:0.85em;vertical-align:middle;margin:0 1px">/</span>
                    <img src="${outputIconPath}" alt="Output" style="width:32px;height:32px;object-fit:contain;vertical-align:middle;margin:-6px 0" onerror="this.src='/assets/icons/attributes/double_rewards.svg'" />
                </div></td>
                <td class="${cls(outputDisplay1, outputDisplay2, false)}">${fmtC(outputDisplay1)}</td>
                <td class="${cls(outputDisplay2, outputDisplay1, false)}">${fmtC(outputDisplay2)}</td>
            </tr>`;
            // XP / CHARGE row — source order reversed for row-reverse CSS
            rows += `<tr title="XP per charge (${chargeCount} × (1+DA) × XP per craft; DR does not affect XP)">
                <td><div class="comparison-label">
                    <img src="${petInfoRecipe.iconPath}" alt="${petInfoRecipe.petName}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.src='/assets/icons/items/pet_eggs/${petInfoRecipe.species}_egg.svg'" />
                    <span style="font-size:0.85em;vertical-align:middle;margin:0 1px">/</span>
                    <img src="/assets/icons/attributes/bonus_experience.svg" alt="XP" style="width:32px;height:32px;object-fit:contain;vertical-align:middle;margin:-6px 0" onerror="this.style.display='none'" />
                </div></td>
                <td class="${cls(xp1, xp2, false)}">${fmtC(xp1)}</td>
                <td class="${cls(xp2, xp1, false)}">${fmtC(xp2)}</td>
            </tr>`;
            // MAT / CHARGE row — source order reversed for row-reverse CSS
            rows += `<tr>
                <td><div class="comparison-label">
                    <img src="${petInfoRecipe.iconPath}" alt="${petInfoRecipe.petName}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.src='/assets/icons/items/pet_eggs/${petInfoRecipe.species}_egg.svg'" />
                    <span style="font-size:0.85em;vertical-align:middle;margin:0 1px">/</span>
                    <img src="${matIconPath}" alt="${firstMat?.material_name || 'Mat'}" style="width:32px;height:32px;object-fit:contain;vertical-align:middle;margin:-6px 0" onerror="this.src='/assets/icons/attributes/double_rewards.svg'" />
                </div></td>
                <td class="${cls(mats1, mats2, true)}">${fmtC(mats1)}</td>
                <td class="${cls(mats2, mats1, true)}">${fmtC(mats2)}</td>
            </tr>`;
        }

        // Services (side by side, like locations for activities)
        // Only render the SERVICES section when the recipe actually requires a service.
        // When recipeServiceType === 'None', mirror the single view and show only the
        // LOCATIONS section (location dropdown) — no "No service" button needed.
        if (services.length > 0 && this.recipeServiceType !== 'None') {
            rows += `<tr><td colspan="3" class="comparison-inline-section">
                <div class="comparison-inline-header">SERVICES</div>
                <div class="comparison-locations-row">
                    <div class="comparison-locations-col">
                        <div class="services-grid">${renderServiceGrid(ctx1, 1)}</div>
                    </div>
                    <div class="comparison-locations-col">
                        <div class="services-grid">${renderServiceGrid(ctx2, 2)}</div>
                    </div>
                </div>
            </td></tr>`;
        }

        // Locations — render for both service-backed recipes (selected service's locations)
        // and no-service recipes (location dropdown mount).
        if (services.length > 0 || this.recipeServiceType === 'None') {
            const locs1 = renderLocationGrid(ctx1, 1);
            const locs2 = renderLocationGrid(ctx2, 2);
            if (locs1 || locs2) {
                rows += `<tr><td colspan="3" class="comparison-inline-section">
                    <div class="comparison-inline-header">LOCATIONS</div>
                    <div class="comparison-locations-row">
                        <div class="comparison-locations-col">
                            <div class="locations-grid">${locs1}</div>
                        </div>
                        <div class="comparison-locations-col">
                            <div class="locations-grid">${locs2}</div>
                        </div>
                    </div>
                </td></tr>`;
            }
        }

        return `
                <div class="comparison-activity-section" style="--comparison-skill-color: ${skillColor}">
                    <div class="activity-info-header" data-section="activity">
                        <span class="activity-info-title">${recipeName}</span>
                        ${arrowIcon}
                    </div>
                    <div class="comparison-activity-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                        ${materialsHtml}
                        <table class="comparison-table">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>${name1}</th>
                                    <th>${name2}</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            `;
    }

    /**
     * Load and render material sources dropdown (comparison view)
     */
    async _loadComparisonMaterialSources($container, materialName) {
        const $page = $container.find('.material-source-page');
        $page.html('<div class="source-loading">Loading sources...</div>');
        this._updateComparisonMaterialNav($container, materialName);
        $container.slideDown(150);

        try {
            const data = await api.getItemSources();
            const lookupName = materialName.toLowerCase().trim();
            const sources = data.sources[lookupName] || [];
            $page.html(this._buildComparisonSourcesHtml(sources));
        } catch (err) {
            console.error('Failed to load material sources:', err);
            $page.html('<div class="source-empty">Failed to load sources</div>');
        }
    }

    /**
     * Slide to a different material's sources (comparison view)
     */
    async _slideComparisonSourcePage($container, materialName, direction) {
        this._updateComparisonMaterialNav($container, materialName);
        const $viewport = $container.find('.material-source-viewport');
        const $oldPage = $viewport.find('.material-source-page');
        const slideDistance = $viewport.width() || $container.width() || 300;
        const exitTo = direction === 'left' ? -slideDistance : slideDistance;
        const enterFrom = direction === 'left' ? slideDistance : -slideDistance;
        const duration = 180;

        const currentHeight = $viewport.outerHeight();
        $viewport.css({ height: currentHeight, position: 'relative', overflow: 'hidden' });
        $oldPage.css({ position: 'absolute', top: 0, left: 0, width: '100%' });

        const $newPage = $('<div class="material-source-page"></div>')
            .css({ position: 'absolute', top: 0, left: enterFrom, width: '100%' })
            .html('<div class="source-loading">Loading sources...</div>');
        $viewport.append($newPage);

        $oldPage.animate({ left: exitTo }, duration, 'swing');
        $newPage.animate({ left: 0 }, duration, 'swing', () => {
            $oldPage.remove();
            $newPage.css({ position: '', top: '', left: '', width: '' });
            $viewport.css({ height: '', position: '', overflow: '' });
        });

        try {
            const data = await api.getItemSources();
            const lookupName = materialName.toLowerCase().trim();
            const sources = data.sources[lookupName] || [];
            $newPage.html(this._buildComparisonSourcesHtml(sources));
            const newHeight = $newPage.outerHeight();
            if (Math.abs(newHeight - currentHeight) > 2) {
                $viewport.stop(true, false).animate({ height: newHeight }, duration, 'swing', () => {
                    $viewport.css('height', '');
                });
            }
        } catch (err) {
            console.error('Failed to load material sources:', err);
            $newPage.html('<div class="source-empty">Failed to load sources</div>');
        }
    }

    /**
     * Update material source nav label (comparison view)
     */
    _updateComparisonMaterialNav($container, materialName) {
        const $list = $container.closest('.materials-list');
        const $materials = $list.find('.material-item-clickable');
        const total = $materials.length;
        const idx = this._activeMaterialIndex ?? 0;
        // Append "(N owned)" using the count baked into the active tile, mirror
        // of recipe-info-section.js _updateMaterialSourceNav.
        const $active = $materials.eq(idx);
        const ownedRaw = $active.attr('data-material-owned');
        const ownedSuffix = (ownedRaw !== undefined && ownedRaw !== '')
            ? ` (${ownedRaw} owned)`
            : '';
        $container.find('.material-source-nav-label').text(`${materialName} (${idx + 1}/${total})${ownedSuffix}`);
        $container.find('.material-source-prev').prop('disabled', total <= 1);
        $container.find('.material-source-next').prop('disabled', total <= 1);
    }

    /**
     * Build sources HTML for material dropdown (comparison view)
     */
    _buildComparisonSourcesHtml(sources) {
        if (!sources || sources.length === 0) {
            return '<div class="source-empty">No sources found</div>';
        }

        const activityDrops = sources.filter(s => s.type === 'activity_drop');
        const itemFindingDrops = sources.filter(s => s.type === 'item_finding');
        const recipeDrops = sources.filter(s => s.type === 'recipe_drop');
        const recipeOutputs = sources.filter(s => s.type === 'recipe_output');
        const recipeInputs = sources.filter(s => s.type === 'recipe_input');
        const shopSources = sources.filter(s => s.type === 'shop');

        let html = '<div class="source-dropdown-list">';

        const renderGroup = (items, header, badge, badgeClass, showDrop = false) => {
            if (items.length === 0) return '';
            let g = `<div class="source-group-header">${header}</div>`;
            for (const src of items) {
                const dropRate = src.drop_rate != null ? `Drop: ${src.drop_rate}%` : '';
                const secondary = src.secondary ? ' (secondary)' : '';
                g += `<div class="source-item material-source-item" data-source-type="${src.type}" data-source-id="${src.id}" title="Click to select">
                    <div class="source-item-main">
                        <span class="source-name">${src.name}</span>
                        <span class="source-badge ${badgeClass}">${badge}</span>
                    </div>
                    <div class="source-item-details">
                        <span>${src.skill || ''} ${src.level ? 'Lv.' + src.level : ''}</span>
                        ${src.base_steps ? `<span>${src.base_steps} steps</span>` : ''}
                        ${showDrop && dropRate ? `<span>${dropRate}${secondary}</span>` : ''}
                        ${src.quantity ? `<span>${src.quantity}x needed</span>` : ''}
                    </div>
                </div>`;
            }
            return g;
        };

        html += renderGroup(activityDrops, 'Dropped by', 'Activity', 'source-badge-activity', true);

        if (itemFindingDrops.length > 0) {
            html += '<div class="source-group-header">Item Finding</div>';
            for (const src of itemFindingDrops) {
                const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                html += `<div class="source-item source-item-no-click" title="Dropped via ${src.category} item finding gear">
                    <div class="source-item-main">
                        <span class="source-name">${src.category}</span>
                        <span class="source-badge source-badge-item-finding">Item Finding</span>
                    </div>
                    ${chance ? `<div class="source-item-details"><span>${chance}</span></div>` : ''}
                </div>`;
            }
        }

        html += renderGroup(recipeDrops, 'Dropped while crafting', 'Recipe Drop', 'source-badge-recipe-drop', true);
        html += renderGroup(recipeOutputs, 'Crafted by', 'Recipe', 'source-badge-recipe');
        html += renderGroup(recipeInputs, 'Used in', 'Input', 'source-badge-recipe-input');

        if (shopSources.length > 0) {
            html += '<div class="source-group-header">Sold at</div>';
            for (const src of shopSources) {
                html += `<div class="source-item source-item-no-click" title="${src.name} in ${src.location}">
                    <div class="source-item-main">
                        <span class="source-name">${src.name}</span>
                        <span class="source-badge source-badge-shop">Shop</span>
                    </div>
                    <div class="source-item-details">
                        <span>${src.location}</span>
                        <span>${src.price_display}</span>
                    </div>
                </div>`;
            }
        }

        const chestSources = sources.filter(s => s.type === 'container_drop');
        if (chestSources.length > 0) {
            html += '<div class="source-group-header">Found in chests</div>';
            for (const src of chestSources) {
                const rarityClass = src.rarity ? `rarity-${src.rarity}` : '';
                const rarityLabel = src.rarity ? src.rarity.charAt(0).toUpperCase() + src.rarity.slice(1) : 'Main';
                const rolls = src.rolls_per_chest || 4;
                let chestPct = null;
                if (src.drop_rate != null) {
                    chestPct = (1 - Math.pow(1 - src.drop_rate / 100, rolls)) * 100;
                }
                const dropRate = chestPct != null ? `${formatFixed(chestPct, 3)}%` : '?%';
                const qty = src.quantity && src.quantity !== '1' ? `${src.quantity}x` : '';
                html += `<div class="source-item source-item-no-click source-item-chest">
                    <div class="source-item-main">
                        <span class="source-name">${src.name}</span>
                        <span class="source-badge source-badge-chest ${rarityClass}">${rarityLabel}</span>
                    </div>
                    <div class="source-item-details">
                        <span>Chance per chest: ${dropRate}</span>
                        ${qty ? `<span>${qty}</span>` : ''}
                    </div>
                </div>`;
            }
        }

        html += '</div>';
        return html;
    }

    /**
     * Calculate quality weights (ported from recipe-info-section.js)
     */
    calculateQualityWeights(recipeLevel, qualityOutcome, useFine = false, hasEquipmentInput = false) {
        const startingWeights = { 'Normal': 1000.0, 'Good': 200.0, 'Great': 50.0, 'Excellent': 10.0, 'Perfect': 2.5, 'Eternal': 0.05 };
        const minimumWeights = { 'Normal': 4.0, 'Good': 4.0, 'Great': 4.0, 'Excellent': 4.0, 'Perfect': 2.0, 'Eternal': 0.05 };
        const bandStarts = { 'Normal': 0, 'Good': 100, 'Great': 200, 'Excellent': 300, 'Perfect': 400, 'Eternal': 500 };
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
        const bandEnds = {};
        qualities.forEach((q, i) => { bandEnds[q] = (100 + recipeLevel) * (i + 1); });

        const calculatedWeights = {};
        const qualitiesReversed = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];
        for (const quality of qualitiesReversed) {
            const bandStart = bandStarts[quality];
            const bandEnd = bandEnds[quality];
            const sw = startingWeights[quality];
            const mw = minimumWeights[quality];
            let newWeight;
            if (qualityOutcome <= bandStart) {
                newWeight = sw;
            } else {
                const slope = (sw - mw) / (bandStart - bandEnd);
                newWeight = Math.max(mw, sw + (slope * (qualityOutcome - bandStart)));
            }
            if (quality !== 'Eternal') {
                const nextQ = qualitiesReversed[qualitiesReversed.indexOf(quality) - 1];
                if (calculatedWeights[nextQ] !== undefined) newWeight = Math.max(newWeight, calculatedWeights[nextQ]);
            }
            calculatedWeights[quality] = newWeight;
        }
        if (useFine) {
            const shifted = {
                'Good': calculatedWeights['Normal'], 'Great': calculatedWeights['Good'],
                'Excellent': calculatedWeights['Great'], 'Perfect': calculatedWeights['Excellent'],
                'Eternal': calculatedWeights['Perfect'] + calculatedWeights['Eternal'], 'Normal': 0.0
            };
            if (hasEquipmentInput) {
                for (const q of Object.keys(calculatedWeights)) {
                    calculatedWeights[q] = calculatedWeights[q] * 0.7 + shifted[q] * 0.3;
                }
            } else {
                Object.assign(calculatedWeights, shifted);
            }
        }
        const totalWeight = Object.values(calculatedWeights).reduce((s, w) => s + w, 0);
        const percentages = {};
        for (const [q, w] of Object.entries(calculatedWeights)) percentages[q] = (w / totalWeight) * 100.0;
        return { weights: calculatedWeights, percentages, total_weight: totalWeight };
    }

    /**
     * Render quality comparison rows (just the tbody content)
     */
    _renderQualityRows(m1, m2, ctx1, ctx2) {
        if (!this._qualityMetric) this._qualityMetric = 'chance';
        const qo1 = m1.qo || 0, qo2 = m2.qo || 0;
        const hasEquipmentInput = this.recipe.has_equipment_input || false;
        console.log(`[BUG1-COMPARISON] qo1=${qo1}, qo2=${qo2}, recipeLevel=${this.recipe.level}, useFine1=${ctx1.useFine}, useFine2=${ctx2.useFine}, hasEquipmentInput=${hasEquipmentInput}`);
        const result1 = this.calculateQualityWeights(this.recipe.level, qo1, ctx1.useFine || false, hasEquipmentInput);
        const result2 = this.calculateQualityWeights(this.recipe.level, qo2, ctx2.useFine || false, hasEquipmentInput);
        console.log(`[BUG1-COMPARISON] GS1 Normal%=${result1.percentages['Normal']?.toFixed(4)}, Perfect%=${result1.percentages['Perfect']?.toFixed(4)}`);
        console.log(`[BUG1-COMPARISON] GS2 Normal%=${result2.percentages['Normal']?.toFixed(4)}, Perfect%=${result2.percentages['Perfect']?.toFixed(4)}`);
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
        const qtr = { 'Normal': 'common', 'Good': 'uncommon', 'Great': 'rare', 'Excellent': 'epic', 'Perfect': 'legendary', 'Eternal': 'ethereal' };
        const cls = (a, b, lb) => (a === b || a === 0 || b === 0) ? '' : (lb ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
        const fmt = (v, m) => { if (v === 0 || v === Infinity || isNaN(v)) return '—'; if (m === 'chance') return formatFixed(v, 2) + '%'; if (m === 'avgSteps') return v >= 1000 ? Math.round(v).toLocaleString() : formatFixed(v, 1); return formatFixed(v, 1); };
        let rows = '';
        for (const q of qualities) {
            const r = qtr[q], p1 = result1.percentages[q] || 0, p2 = result2.percentages[q] || 0;
            const ac1 = p1 > 0 ? 100 / p1 : 0, ac2 = p2 > 0 ? 100 / p2 : 0;
            const am1 = p1 > 0 ? ac1 / m1.craftsPerMaterial : 0, am2 = p2 > 0 ? ac2 / m2.craftsPerMaterial : 0;
            const aa1 = p1 > 0 ? ac1 / (1 + (m1.dr || 0)) : 0, aa2 = p2 > 0 ? ac2 / (1 + (m2.dr || 0)) : 0;
            const as1 = aa1 * m1.expectedStepsPerAction, as2 = aa2 * m2.expectedStepsPerAction;
            const vals = { chance: [p1, p2, false], avgCrafts: [ac1, ac2, true], avgMats: [am1, am2, true], avgSteps: [as1, as2, true] };
            const [v1, v2, lb] = vals[this._qualityMetric];
            rows += `<tr class="quality-row-${r}"><td class="quality-cell-${r}">${q}</td><td class="number-cell ${cls(v1, v2, lb)}">${fmt(v1, this._qualityMetric)}</td><td class="number-cell ${cls(v2, v1, lb)}">${fmt(v2, this._qualityMetric)}</td></tr>`;
        }
        return rows;
    }

    /**
     * Render quality comparison table for recipes (collapsible section)
     */
    _renderQualityComparison(m1, m2, ctx1, ctx2, name1, name2) {
        if (!this.recipe || !this.recipe.output_item) return '';
        if (!this.recipe.output_item.startsWith('Item.')) return '';
        if (!this._qualityMetric) this._qualityMetric = 'chance';
        if (this._qualityExpanded === undefined) this._qualityExpanded = true;
        const metrics = ['chance', 'avgCrafts', 'avgMats', 'avgSteps'];
        const ml = { chance: 'Chance', avgCrafts: 'Avg. Items', avgMats: 'Avg. Mats', avgSteps: 'Avg. Steps' };
        const buttons = metrics.map(m => `<button class="quality-metric-btn ${this._qualityMetric === m ? 'active' : ''}" data-metric="${m}">${ml[m]}</button>`).join('');
        const rows = this._renderQualityRows(m1, m2, ctx1, ctx2);
        const sc = this._getSkillColor(this.recipe.skill);
        const arrow = `<span class="expand-arrow ${this._qualityExpanded ? 'expanded' : ''}">▼</span>`;
        return `
            <div class="comparison-quality-section" style="--comparison-skill-color: ${sc}">
                <div class="activity-info-header" data-section="quality">
                    <span class="activity-info-title">CRAFTING ODDS</span>
                    ${arrow}
                </div>
                <div class="comparison-quality-content" style="display: ${this._qualityExpanded ? 'block' : 'none'};">
                    <div class="quality-metric-buttons">${buttons}</div>
                    <div class="crafting-odds-scroll-wrapper">
                        <table class="crafting-odds-table">
                            <thead><tr><th>Quality</th><th>${name1}</th><th>${name2}</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
    _renderDropsComparison(drops1, drops2, m1, m2, name1, name2) {
        const arrowIcon = `<span class="expand-arrow ${this.dropsExpanded ? 'expanded' : ''}">▼</span>`;
        const skill = this.activity?.skill || this.activity?.primary_skill || this.recipe?.skill || '';
        const skillColor = this._getSkillColor(skill);

        // Build a merged list of all drop names (preserve order from drops1)
        const allDropNames = new Map();
        for (const d of drops1) allDropNames.set(d.item_name, d);
        for (const d of drops2) {
            if (!allDropNames.has(d.item_name)) allDropNames.set(d.item_name, d);
        }

        // Currency summary
        const cur1 = this._calcCurrencyPer1k(drops1);
        const cur2 = this._calcCurrencyPer1k(drops2);

        const cls = (a, b, lowerBetter) => {
            if (a === b) return '';
            return (lowerBetter ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
        };

        let currencyHtml = '';
        if (cur1.coinsPer1k > 0 || cur2.coinsPer1k > 0 || cur1.agTokensPer1k > 0 || cur2.agTokensPer1k > 0) {
            const buildCurrencyCell = (cur, otherCur) => {
                let pills = '';
                if (cur.coinsPer1k > 0 || otherCur.coinsPer1k > 0) {
                    const c = cur.coinsPer1k > 0 ? cls(cur.coinsPer1k, otherCur.coinsPer1k, false) : '';
                    pills += `<div class="comparison-currency-pill ${c}">
                        <img src="/assets/icons/items/coins.svg" alt="Coins" class="comparison-currency-icon" />
                        <span>${cur.coinsPer1k > 0 ? this._formatCurrency(cur.coinsPer1k) : '—'}</span>
                    </div>`;
                }
                if (cur.agTokensPer1k > 0 || otherCur.agTokensPer1k > 0) {
                    const c = cur.agTokensPer1k > 0 ? cls(cur.agTokensPer1k, otherCur.agTokensPer1k, false) : '';
                    pills += `<div class="comparison-currency-pill ${c}">
                        <img src="/assets/icons/items/adventurers'_guild_token.svg" alt="AG Tokens" class="comparison-currency-icon" />
                        <span>${cur.agTokensPer1k > 0 ? this._formatCurrency(cur.agTokensPer1k) : '—'}</span>
                    </div>`;
                }
                return pills;
            };

            currencyHtml = `
                <tr class="comparison-currency-row">
                    <td class="comparison-drop-label"><span>Totals /1k</span></td>
                    <td>${buildCurrencyCell(cur1, cur2)}</td>
                    <td>${buildCurrencyCell(cur2, cur1)}</td>
                </tr>
            `;
        }

        // Format quantity display
        const fmtQty = (qty) => {
            if (!qty) return '1';
            if (qty.is_static || qty.min === qty.max) return `${qty.min}`;
            return `${qty.min}-${qty.max}`;
        };

        // Drop rows — normal and fine stacked in same cell
        const dropRows = [];
        const petInfoDrops = this._getActiveInstantActionsPet();

        const calcChargeOutput = (d, petI, da, dr) => {
            if (!petI || !d) return null;
            const chargeCount = petI.count || 5;
            // Comparison drops use effective_percent; single-view drops use drop_percent
            const dropRate = ((d.effective_percent ?? d.drop_percent) || 0) / 100;
            // avg_quantity may not be stored — compute from quantity object
            let avgQty = d.avg_quantity || 1;
            if (!d.avg_quantity && d.quantity) {
                const q = d.quantity;
                if (q.is_static || q.min === q.max) avgQty = q.min || 1;
                else avgQty = ((q.min || 1) + (q.max || 1)) / 2;
            }
            return chargeCount * (1 + da) * (1 + dr) * dropRate * avgQty;
        };

        const calcFineChargeOutput = (d, petI, da, dr, fineMaterialFinding) => {
            if (!petI || !d) return null;
            // Use the base chance_percent (before find bonuses) for fine rate calculation
            // chance_percent is the raw rate; effective_percent includes find bonuses
            const baseRate = ((d.chance_percent) || 0) / 100;
            if (!baseRate) return null;
            const fineRate = baseRate * 0.01 * (1 + (fineMaterialFinding || 0));
            const chargeCount = petI.count || 5;
            let avgQty = d.avg_quantity || 1;
            if (!d.avg_quantity && d.quantity) {
                const q = d.quantity;
                if (q.is_static || q.min === q.max) avgQty = q.min || 1;
                else avgQty = ((q.min || 1) + (q.max || 1)) / 2;
            }
            return chargeCount * (1 + da) * (1 + dr) * fineRate * avgQty;
        };

        const fmtCharge = (v) => {
            // Render pet output as "activations PER item" (reciprocal of expected
            // output per activation) to match the steps-per-item / materials-per-item
            // convention. Returns null only when the pet/drop is not applicable so
            // the caller skips the row; a zero/non-finite output renders as ∞.
            if (v == null) return null;
            if (!isFinite(v) || v <= 0) return '∞';
            const perItem = 1 / v;
            return perItem < 10
                ? formatFixed(perItem, 2, { trim: true })
                : perItem < 100
                    ? formatFixed(perItem, 1, { trim: true })
                    : Math.ceil(perItem).toLocaleString();
        };
        // Reciprocal of an items-per-activation value for color comparison
        // (fewer activations per item is better). Infinity == unobtainable.
        const perItemValue = (v) => (v != null && isFinite(v) && v > 0) ? 1 / v : Infinity;

        for (const [itemName, refDrop] of allDropNames) {
            const d1 = drops1.find(d => d.item_name === itemName);
            const d2 = drops2.find(d => d.item_name === itemName);
            const iconPath = this._getDropIcon(refDrop);
            const qty = fmtQty(refDrop.quantity);

            // Type badge removed — collectible icon was cluttering the drop label
            let typeBadgeHtml = '';

            // Detect container drops (mirrors wireDropCards logic in drop-item-popover.js):
            //   - item_ref starts with 'Container.'
            //   - source === 'chest' (synthetic chest from backend)
            const isContainerRef = refDrop.item_ref && refDrop.item_ref.startsWith('Container.');
            const isSyntheticChest = refDrop.source === 'chest';
            const isContainer = isContainerRef || isSyntheticChest;
            // Build the popover lookup name. For synthetic chests we need
            // "<Skill> chest" (lowercase 'c') like the single view does.
            let popoverName = itemName;
            if (isSyntheticChest) {
                const skill = refDrop.primary_skill || '';
                if (skill) {
                    const skillCap = skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase();
                    popoverName = `${skillCap} chest`;
                } else {
                    popoverName = itemName.replace(/Chest$/i, 'chest');
                }
            }
            const isCoins = itemName === 'Coins';
            const isSynthetic = refDrop.source === 'synthetic_fine' || refDrop.source === 'synthetic_collectible';
            const dropInteractive = !isCoins && !isSynthetic;
            const dropDataAttrs = dropInteractive
                ? ` data-drop-name="${popoverName}"${isContainer ? ' data-drop-container="1"' : ''}`
                : '';
            const dropInteractiveCls = dropInteractive ? ' drop-card-interactive' : '';

            const steps1 = d1 ? d1.steps_per_item : Infinity;
            const steps2 = d2 ? d2.steps_per_item : Infinity;
            const s1Class = cls(steps1, steps2, true);
            const s2Class = cls(steps2, steps1, true);

            // Build cell content: effective pct + qty label, normal steps + fine steps stacked
            const buildCell = (d, stepsCls, otherD, da, dr, otherDa, otherDr, gsNum) => {
                if (!d) return '<div style="text-align:center;color:var(--text-secondary)">—</div>';
                const effPct = d.effective_percent;
                const pctStr = effPct ? formatFixed(effPct, 3).replace(/0+$/, '').replace(/\.$/, '') + '%' : '';
                let html = `<div class="comparison-drop-pct">${pctStr}</div>`;
                if (qty !== '1') {
                    html += `<div class="comparison-drop-qty" style="font-size:11px;color:var(--text-secondary)">${qty}</div>`;
                }
                html += `<div class="comparison-drop-steps comparison-steps-fill ${stepsCls}" data-gs="${gsNum}" data-steps-value="${d.steps_per_item}" role="button" tabindex="0" title="Click to fill the calculator (Gear set ${gsNum}) with this step count" style="cursor:pointer;">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="comparison-steps-icon" />
                    <span>${this._formatSteps(d.steps_per_item)}</span>
                </div>`;
                if (d && d.steps_per_fine_item) {
                    const fSteps = d.steps_per_fine_item;
                    const otherFine = otherD?.steps_per_fine_item || Infinity;
                    const fineCls = cls(fSteps, otherFine, true);
                    html += `<div class="comparison-drop-steps fine-steps comparison-steps-fill ${fineCls}" data-gs="${gsNum}" data-steps-value="${fSteps}" role="button" tabindex="0" title="Click to fill the calculator (Gear set ${gsNum}) with this step count" style="cursor:pointer;">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="comparison-steps-icon" />
                        <span>${this._formatSteps(fSteps)}</span>
                    </div>`;
                }
                if (d.materials_per_item != null && isFinite(d.materials_per_item)) {
                    const mpi = d.materials_per_item;
                    const otherMPI = otherD?.materials_per_item;
                    const mpiCls = (otherMPI != null && isFinite(otherMPI)) ? cls(mpi, otherMPI, true) : '';
                    const mpiStr = mpi < 10
                        ? formatFixed(mpi, 2, { trim: true })
                        : mpi < 100
                            ? formatFixed(mpi, 1, { trim: true })
                            : Math.ceil(mpi).toLocaleString();
                    html += `<div class="comparison-drop-steps drop-card-materials comparison-materials-fill ${mpiCls}" data-gs="${gsNum}" data-materials-value="${mpi}" role="button" tabindex="0" title="Click to fill the calculator Materials field (Gear set ${gsNum}) with this value" style="cursor:pointer;">
                        <img src="/assets/icons/attributes/double_rewards.svg" alt="Mats" class="comparison-steps-icon" title="Materials consumed per item" />
                        <span title="Materials consumed per item">${mpiStr}</span>
                    </div>`;
                }
                // Instant-actions: expected output per charge
                if (petInfoDrops && da != null && dr != null) {
                    const chargeVal = calcChargeOutput(d, petInfoDrops, da, dr);
                    // Use same drop (d) for other gearset — base rate is identical, only DA/DR differ
                    const otherChargeVal = calcChargeOutput(d, petInfoDrops, otherDa, otherDr);
                    const chargeStr = fmtCharge(chargeVal);
                    if (chargeStr) {
                        const piVal = perItemValue(chargeVal);
                        const otherPiVal = perItemValue(otherChargeVal);
                        const bothValid = isFinite(piVal) && isFinite(otherPiVal);
                        // Lower activations-per-item is better (mirrors steps/materials).
                        const chargeCls = bothValid ? cls(piVal, otherPiVal, true) : '';
                        html += `<div class="comparison-drop-steps drop-card-charge ${chargeCls}" title="Pet activations per item">
                            <img src="${petInfoDrops.iconPath}" alt="${petInfoDrops.petName}" class="comparison-steps-icon"
                                 onerror="this.src='/assets/icons/items/pet_eggs/${petInfoDrops.species}_egg.svg'" />
                            <span>${chargeStr}</span>
                        </div>`;
                    }
                    // Fine charge row — only for drops that have a fine version
                    const hasFine = d.has_fine_material || d.steps_per_fine_item;
                    if (hasFine) {
                        const fmf = gsNum === 1
                            ? (this._cachedStats1?.fine_material_finding || 0) / 100
                            : (this._cachedStats2?.fine_material_finding || 0) / 100;
                        const otherFmf = gsNum === 1
                            ? (this._cachedStats2?.fine_material_finding || 0) / 100
                            : (this._cachedStats1?.fine_material_finding || 0) / 100;
                        // Use the same base drop (d) for both cells — base rate is identical,
                        // only DA/DR/FMF differ between gearsets
                        const fineChargeVal = calcFineChargeOutput(d, petInfoDrops, da, dr, fmf);
                        const otherHasFine = otherD && (otherD.has_fine_material || otherD.steps_per_fine_item);
                        const otherFineChargeVal = otherHasFine
                            ? calcFineChargeOutput(d, petInfoDrops, otherDa, otherDr, otherFmf)
                            : null;
                        const fineChargeStr = fmtCharge(fineChargeVal);
                        if (fineChargeStr) {
                            const finePiVal = perItemValue(fineChargeVal);
                            const otherFinePiVal = perItemValue(otherFineChargeVal);
                            const bothValid = isFinite(finePiVal) && isFinite(otherFinePiVal);
                            const fineChargeCls = bothValid ? cls(finePiVal, otherFinePiVal, true) : '';
                            html += `<div class="comparison-drop-steps drop-card-charge fine-steps ${fineChargeCls}" title="Pet activations per fine item">
                                <img src="${petInfoDrops.iconPath}" alt="${petInfoDrops.petName}" class="comparison-steps-icon"
                                     onerror="this.src='/assets/icons/items/pet_eggs/${petInfoDrops.species}_egg.svg'" />
                                <span>${fineChargeStr}</span>
                            </div>`;
                        }
                    }
                }
                return html;
            };

            // Extract DA/DR per gearset from cached stats
            const da1 = ((this._cachedStats1?.double_action || 0)) / 100;
            const dr1 = ((this._cachedStats1?.double_rewards || 0)) / 100;
            const da2 = ((this._cachedStats2?.double_action || 0)) / 100;
            const dr2 = ((this._cachedStats2?.double_rewards || 0)) / 100;

            dropRows.push(`
                <tr class="comparison-drop-row">
                    <td class="comparison-drop-label">
                        <div class="comparison-drop-label-inner${dropInteractiveCls}"${dropDataAttrs}>
                            <img src="${iconPath}" alt="${itemName}" class="comparison-drop-icon" onerror="this.src='/assets/icons/items/containers/treasure_chest.svg'" title="${itemName}" />
                            ${typeBadgeHtml}
                        </div>
                    </td>
                    <td class="comparison-drop-cell">${buildCell(d1, s1Class, d2, da1, dr1, da2, dr2, 1)}</td>
                    <td class="comparison-drop-cell">${buildCell(d2, s2Class, d1, da2, dr2, da1, dr1, 2)}</td>
                </tr>
            `);
        }

        return `
            <div class="comparison-drops-section" style="--comparison-skill-color: ${skillColor}">
                <div class="activity-info-header" data-section="drops">
                    <span class="activity-info-title">DROPS</span>
                    ${arrowIcon}
                </div>
                <div class="comparison-drops-content" style="display: ${this.dropsExpanded ? 'block' : 'none'};">
                    <table class="comparison-table comparison-drops-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>${name1}</th>
                                <th>${name2}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${currencyHtml}
                            ${dropRows.join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    _calcCurrencyPer1k(drops) {
        let coinsPer1k = 0;
        let agTokensPer1k = 0;
        for (const drop of drops) {
            if (!drop.steps_per_item || drop.steps_per_item <= 0) continue;
            const itemsPer1k = 1000.0 / drop.steps_per_item;
            if (drop.coin_value && drop.coin_value > 0) {
                coinsPer1k += itemsPer1k * drop.coin_value;
            }
            if (drop.fine_coin_value && drop.fine_coin_value > 0 && drop.steps_per_fine_item && drop.steps_per_fine_item > 0) {
                coinsPer1k += (1000.0 / drop.steps_per_fine_item) * drop.fine_coin_value;
            }
            if (drop.special_sell && drop.special_sell.currency === 'ag_token') {
                agTokensPer1k += itemsPer1k * drop.special_sell.quantity;
            }
            // Fine-variant AGT contribution (bug 7ee43a0c) — mirrors the
            // fine_coin_value handling above; fine sell value was previously
            // dropped from the AGT comparison total.
            if (drop.fine_ag_token_value && drop.fine_ag_token_value > 0 && drop.steps_per_fine_item && drop.steps_per_fine_item > 0) {
                // A fine drop replaces a normal one, so net gain is (fine_qty - base_qty).
                const baseAgtQty = (drop.special_sell && drop.special_sell.currency === 'ag_token') ? drop.special_sell.quantity : 0;
                agTokensPer1k += (1000.0 / drop.steps_per_fine_item) * (drop.fine_ag_token_value - baseAgtQty);
            }
        }
        return { coinsPer1k, agTokensPer1k };
    }

    _formatCurrency(value) {
        if (value >= 1000) return formatFixed((value / 1000), 2) + 'k';
        return formatFixed(value, 2);
    }

    _renderRecipeDropsComparison(stats1, stats2, m1, m2, name1, name2) {
        const arrowIcon = `<span class="expand-arrow ${this.dropsExpanded ? 'expanded' : ''}">▼</span>`;
        const skill = (this.recipe.skill || '').toLowerCase();
        const skillColor = this._getSkillColor(this.recipe.skill);
        const chestIcon = `/assets/icons/items/containers/${skill}_chest.svg`;
        const stepsIcon = '/assets/icons/attributes/steps_required.svg';
        const icon = (src) => `<img src="${src}" alt="" class="comparison-steps-icon" onerror="this.style.display='none'" />`;

        const drIcon = '/assets/icons/attributes/double_rewards.svg';
        const iconDR = (src) => `<img src="${src}" alt="" class="comparison-steps-icon" onerror="this.style.display='none'" />`;

        // Chest drop rate calculation for each gearset
        const baseChestRate = 0.4; // 1/250
        const cf1 = (stats1.chest_finding || 0) / 100;
        const cf2 = (stats2.chest_finding || 0) / 100;
        const dr1 = (stats1.double_rewards || 0) / 100;
        const dr2 = (stats2.double_rewards || 0) / 100;
        const nmc1 = (stats1.no_materials_consumed || 0) / 100;
        const nmc2 = (stats2.no_materials_consumed || 0) / 100;

        // materialsPerCraft = 1 / craftsPerMaterial = (1 - NMC) / (1 + DR)
        const materialsPerCraft1 = (1 - nmc1) / (1 + dr1);
        const materialsPerCraft2 = (1 - nmc2) / (1 + dr2);

        // Helper: materials consumed per drop of an item
        // materialsPerItem = materialsPerCraft / ((1+DR) * dropRate/100)
        const calcMPI = (materialsPerCraft, dr, dropRatePct) => {
            if (!dropRatePct || dropRatePct <= 0) return null;
            return materialsPerCraft / ((1 + dr) * (dropRatePct / 100));
        };

        const fmtMPI = (v) => {
            if (v == null || !isFinite(v)) return null;
            return v < 10 ? formatFixed(v, 2, { trim: true }) : v < 100 ? formatFixed(v, 1, { trim: true }) : Math.ceil(v).toLocaleString();
        };

        // DR is already factored into stepsPerRewardRoll — chest steps only need CF
        const effectiveRate1 = baseChestRate * (1 + cf1);
        const effectiveRate2 = baseChestRate * (1 + cf2);
        const chestSteps1 = effectiveRate1 > 0 ? (m1.stepsPerRewardRoll * 100) / effectiveRate1 : Infinity;
        const chestSteps2 = effectiveRate2 > 0 ? (m2.stepsPerRewardRoll * 100) / effectiveRate2 : Infinity;

        const cls = (a, b, lowerBetter) => {
            if (a === b) return '';
            return (lowerBetter ? a < b : a > b) ? 'comparison-better' : 'comparison-worse';
        };

        const skillDisplay = skill.charAt(0).toUpperCase() + skill.slice(1);

        // Resolve icon path for a recipe drop item by name
        const resolveDropIcon = (itemName) => {
            const iconName = itemName.toLowerCase().replace(/ /g, '_');
            // Check known non-material types by name pattern
            if (iconName.includes('egg')) return `/assets/icons/items/pet_eggs/${iconName}.svg`;
            if (iconName.includes('chest')) return `/assets/icons/items/containers/${iconName}.svg`;
            return `/assets/icons/items/materials/${iconName}.svg`;
        };

        // Build drop rows — recipe drop_table items + chest
        let dropRows = '';

        // Recipe-specific drops (e.g., Mummy Egg from Tatty Garb,
        // Silver nugget from bar smelting with multi_roll_count).
        // Containers (chests) are skipped here — the chest row below
        // renders them once at the 0.4% base rate, and we don't want
        // the Smithing chest / Tailoring chest / etc. to double up.
        const recipeDrops = this.recipe.drop_table || [];
        for (const drop of recipeDrops) {
            const dropName = drop.item_name || drop.name || 'Unknown';
            const dropChance = drop.chance_percent || 0;
            const qty = drop.quantity || 1;

            // Skip containers — chest row below handles them.
            const _isContainerRef = drop.item_ref && drop.item_ref.startsWith('Container.');
            const _isContainerType = drop.item_type && drop.item_type.toLowerCase() === 'container';
            if (_isContainerRef || _isContainerType) continue;

            const dropIcon = resolveDropIcon(dropName);

            // Expected drops per craft (before DR): use multi-roll when present.
            // chance_percent is per-roll when multi_roll_count > 1.
            const rollCount = drop.multi_roll_count && drop.multi_roll_count > 1
                ? drop.multi_roll_count : 1;
            const expectedPerCraft = rollCount * (dropChance / 100) * qty;

            // Steps per drop = stepsPerRewardRoll / (expectedPerCraft * (1+DR_already_in_roll? no))
            // stepsPerRewardRoll already accounts for DR on the reward roll side;
            // apply DR here the same way the chest path does.
            const stepsPerDrop1 = expectedPerCraft > 0
                ? m1.stepsPerRewardRoll / (expectedPerCraft * (1 + dr1))
                : Infinity;
            const stepsPerDrop2 = expectedPerCraft > 0
                ? m2.stepsPerRewardRoll / (expectedPerCraft * (1 + dr2))
                : Infinity;

            // Materials per item uses the compound expected-drops rate too.
            // calcMPI expects a "drop percent" — pass the effective rate as a percent.
            const effectivePercent = expectedPerCraft * 100;
            const mpi1 = calcMPI(materialsPerCraft1, dr1, effectivePercent);
            const mpi2 = calcMPI(materialsPerCraft2, dr2, effectivePercent);
            const mpiStr1 = fmtMPI(mpi1);
            const mpiStr2 = fmtMPI(mpi2);
            const mpiCls1 = mpi1 != null && mpi2 != null ? cls(mpi1, mpi2, true) : '';
            const mpiCls2 = mpi1 != null && mpi2 != null ? cls(mpi2, mpi1, true) : '';

            dropRows += `<tr class="comparison-drop-row">
                <td class="comparison-drop-label">
                    <div class="comparison-drop-label-inner drop-card-interactive" data-drop-name="${dropName}">
                        <img src="${dropIcon}" alt="${dropName}" class="comparison-drop-icon" title="${dropName}" onerror="this.src='/assets/icons/items/containers/treasure_chest.svg'" />
                    </div>
                </td>
                <td class="comparison-drop-cell">
                    <div class="comparison-drop-steps comparison-steps-fill ${cls(stepsPerDrop1, stepsPerDrop2, true)}" data-gs="1" data-steps-value="${stepsPerDrop1}" role="button" tabindex="0" title="Click to fill the calculator (Gear set 1) with this step count" style="cursor:pointer;">
                        ${icon(stepsIcon)}
                        <span>${this._formatSteps(stepsPerDrop1)}</span>
                    </div>
                    ${mpiStr1 != null ? `<div class="comparison-drop-steps drop-card-materials comparison-materials-fill ${mpiCls1}" data-gs="1" data-materials-value="${mpi1}" role="button" tabindex="0" title="Click to fill the calculator Materials field (Gear set 1) with this value" style="cursor:pointer;">
                        ${iconDR(drIcon)}
                        <span>${mpiStr1}</span>
                    </div>` : ''}
                </td>
                <td class="comparison-drop-cell">
                    <div class="comparison-drop-steps comparison-steps-fill ${cls(stepsPerDrop2, stepsPerDrop1, true)}" data-gs="2" data-steps-value="${stepsPerDrop2}" role="button" tabindex="0" title="Click to fill the calculator (Gear set 2) with this step count" style="cursor:pointer;">
                        ${icon(stepsIcon)}
                        <span>${this._formatSteps(stepsPerDrop2)}</span>
                    </div>
                    ${mpiStr2 != null ? `<div class="comparison-drop-steps drop-card-materials comparison-materials-fill ${mpiCls2}" data-gs="2" data-materials-value="${mpi2}" role="button" tabindex="0" title="Click to fill the calculator Materials field (Gear set 2) with this value" style="cursor:pointer;">
                        ${iconDR(drIcon)}
                        <span>${mpiStr2}</span>
                    </div>` : ''}
                </td>
            </tr>`;
        }

        // Chest drop
        const chestMPI1 = calcMPI(materialsPerCraft1, dr1, effectiveRate1);
        const chestMPI2 = calcMPI(materialsPerCraft2, dr2, effectiveRate2);
        const chestMPIStr1 = fmtMPI(chestMPI1);
        const chestMPIStr2 = fmtMPI(chestMPI2);
        const chestMPICls1 = chestMPI1 != null && chestMPI2 != null ? cls(chestMPI1, chestMPI2, true) : '';
        const chestMPICls2 = chestMPI1 != null && chestMPI2 != null ? cls(chestMPI2, chestMPI1, true) : '';

        dropRows += `<tr class="comparison-drop-row">
            <td class="comparison-drop-label">
                <div class="comparison-drop-label-inner drop-card-interactive" data-drop-name="${skillDisplay} chest" data-drop-container="1">
                    <img src="${chestIcon}" alt="${skillDisplay} Chest" class="comparison-drop-icon" title="${skillDisplay} Chest" onerror="this.src='/assets/icons/items/containers/treasure_chest.svg'" />
                </div>
            </td>
            <td class="comparison-drop-cell">
                <div class="comparison-drop-steps comparison-steps-fill ${cls(chestSteps1, chestSteps2, true)}" data-gs="1" data-steps-value="${chestSteps1}" role="button" tabindex="0" title="Click to fill the calculator (Gear set 1) with this step count" style="cursor:pointer;">
                    ${icon(stepsIcon)}
                    <span>${this._formatSteps(chestSteps1)}</span>
                </div>
                ${chestMPIStr1 != null ? `<div class="comparison-drop-steps drop-card-materials comparison-materials-fill ${chestMPICls1}" data-gs="1" data-materials-value="${chestMPI1}" role="button" tabindex="0" title="Click to fill the calculator Materials field (Gear set 1) with this value" style="cursor:pointer;">
                    ${iconDR(drIcon)}
                    <span>${chestMPIStr1}</span>
                </div>` : ''}
            </td>
            <td class="comparison-drop-cell">
                <div class="comparison-drop-steps comparison-steps-fill ${cls(chestSteps2, chestSteps1, true)}" data-gs="2" data-steps-value="${chestSteps2}" role="button" tabindex="0" title="Click to fill the calculator (Gear set 2) with this step count" style="cursor:pointer;">
                    ${icon(stepsIcon)}
                    <span>${this._formatSteps(chestSteps2)}</span>
                </div>
                ${chestMPIStr2 != null ? `<div class="comparison-drop-steps drop-card-materials comparison-materials-fill ${chestMPICls2}" data-gs="2" data-materials-value="${chestMPI2}" role="button" tabindex="0" title="Click to fill the calculator Materials field (Gear set 2) with this value" style="cursor:pointer;">
                    ${iconDR(drIcon)}
                    <span>${chestMPIStr2}</span>
                </div>` : ''}
            </td>
        </tr>`;

        return `
            <div class="comparison-drops-section" style="--comparison-skill-color: ${skillColor}">
                <div class="activity-info-header" data-section="drops">
                    <span class="activity-info-title">DROPS</span>
                    ${arrowIcon}
                </div>
                <div class="comparison-drops-content" style="display: ${this.dropsExpanded ? 'block' : 'none'};">
                    <table class="comparison-table comparison-drops-table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>${name1}</th>
                                <th>${name2}</th>
                            </tr>
                        </thead>
                        <tbody>${dropRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    attachEvents() {
        this.$element.find('.activity-info-header[data-section]').on('click', (e) => {
            const section = $(e.currentTarget).data('section');
            if (section === 'activity') {
                this.isExpanded = !this.isExpanded;
                this.$element.find('.comparison-activity-content').slideToggle(200);
            } else if (section === 'drops') {
                this.dropsExpanded = !this.dropsExpanded;
                this.$element.find('.comparison-drops-content').slideToggle(200);
            } else if (section === 'quality') {
                this._qualityExpanded = !this._qualityExpanded;
                this.$element.find('.comparison-quality-content').slideToggle(200);
            }
            $(e.currentTarget).find('.expand-arrow').toggleClass('expanded');
        });

        // Wire drop icon popovers (hover + click for item/container stats) —
        // mirrors wireDropCards() in drop-item-popover.js used by the single view.
        this._wireComparisonDropPopovers();

        // Steps counter → fill the calculator's Steps field for that gearset
        // side. Each clickable steps div carries data-gs (1 or 2) + the raw
        // data-steps-value. Materials/charge rows are NOT marked
        // .comparison-steps-fill, so they stay non-clickable. The icon popover
        // lives on the label cell, so this never conflicts with it.
        this.$element.on('click', '.comparison-steps-fill', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const el = e.currentTarget;
            const raw = parseFloat(el.getAttribute('data-steps-value'));
            if (!isFinite(raw) || raw <= 0) return;
            const gs = parseInt(el.getAttribute('data-gs'), 10) === 2 ? 2 : 1;
            const steps = Math.round(raw);
            if (window.calculatorSection && typeof window.calculatorSection.setStepsFromExternal === 'function') {
                window.calculatorSection.setStepsFromExternal(steps, gs);
            }
        });
        this.$element.on('keydown', '.comparison-steps-fill', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                $(e.currentTarget).trigger('click');
            }
        });

        // Materials-per-item value → fill the calculator's Materials field for
        // that gearset side (recipes only). Mirrors the steps-fill handler.
        this.$element.on('click', '.comparison-materials-fill', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const el = e.currentTarget;
            const raw = parseFloat(el.getAttribute('data-materials-value'));
            if (!isFinite(raw) || raw <= 0) return;
            const gs = parseInt(el.getAttribute('data-gs'), 10) === 2 ? 2 : 1;
            if (window.calculatorSection && typeof window.calculatorSection.setMaterialsFromExternal === 'function') {
                window.calculatorSection.setMaterialsFromExternal(raw, gs);
            }
        });
        this.$element.on('keydown', '.comparison-materials-fill', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                e.stopPropagation();
                $(e.currentTarget).trigger('click');
            }
        });

        // Location button clicks (activities — reuses .location-item from main view)
        this.$element.find('.location-item[data-gs]:not([data-service-specific-id])').on('click', (e) => {
            const $btn = $(e.currentTarget);
            const locationId = $btn.data('location-id');
            const gsNum = $btn.data('gs');

            if (gsNum === 1) {
                const ctx = { ...(store.state.gearsets.gs1Context || {}), selectedLocation: locationId };
                store.update('gearsets.gs1Context', ctx);
                store._syncToBackend('ui.gearsets.gs1Context', ctx);
            } else {
                const ctx = { ...(store.state.gearsets.gs2Context || {}), selectedLocation: locationId };
                store.update('gearsets.gs2Context', ctx);
                store._syncToBackend('ui.gearsets.gs2Context', ctx);
            }
            this._notifyCombinedStatsForActiveSlot(gsNum);
            this.render();
        });

        // Service button clicks (recipes)
        this.$element.find('.service-item[data-gs]').on('click', (e) => {
            const $btn = $(e.currentTarget);
            const serviceId = $btn.data('service-id');
            const gsNum = $btn.data('gs');
            const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
            const ctx = { ...(store.state.gearsets[ctxKey] || {}) };

            // Find the service to get its first location
            const svc = this._findServiceById(serviceId);
            ctx.selectedService = serviceId;
            if (serviceId === '__none__') {
                // "No service" — keep current location or default to kallaheim
                ctx.selectedServiceSpecific = null;
                if (!ctx.selectedLocation) {
                    ctx.selectedLocation = 'kallaheim';
                }
            } else if (svc && svc.locations && svc.locations.length > 0) {
                ctx.selectedServiceSpecific = svc.locations[0].service_id;
                ctx.selectedLocation = svc.locations[0].location.id;
            } else {
                ctx.selectedServiceSpecific = serviceId;
                ctx.selectedLocation = null;
            }

            store.update(`gearsets.${ctxKey}`, ctx);
            store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
            this._notifyCombinedStatsForActiveSlot(gsNum);
            this.render();
        });

        // Location button clicks under services (recipes)
        this.$element.find('.location-item[data-service-specific-id]').on('click', (e) => {
            const $btn = $(e.currentTarget);
            const locationId = $btn.data('location-id');
            const serviceSpecificId = $btn.data('service-specific-id');
            const gsNum = $btn.data('gs');
            const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
            const ctx = { ...(store.state.gearsets[ctxKey] || {}) };

            ctx.selectedLocation = locationId;
            ctx.selectedServiceSpecific = serviceSpecificId;

            store.update(`gearsets.${ctxKey}`, ctx);
            store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
            this._notifyCombinedStatsForActiveSlot(gsNum);
            this.render();
        });

        // Fine inputs checkbox (per gearset — activities)
        this.$element.find('.comparison-fine-inputs-cb').on('change', (e) => {
            const gsNum = $(e.currentTarget).data('gs');
            const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
            const ctx = { ...(store.state.gearsets[ctxKey] || {}) };
            ctx.useFine = e.currentTarget.checked;
            store.update(`gearsets.${ctxKey}`, ctx);
            store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
            this.render();
        });

        // Input item slot click — open item selection popup filtered to keyword (per gearset)
        this.$element.find('.input-item-slot').on('click', (e) => {
            e.stopPropagation();
            const $slot = $(e.currentTarget);
            const idx = parseInt($slot.data('input-idx'));
            const keyword = $slot.data('input-keyword');
            const level = parseInt($slot.data('input-level')) || 0;
            const gsNum = parseInt($slot.data('gs'));

            if (window.itemSelectionPopup && typeof window.itemSelectionPopup.show === 'function') {
                // Temporarily set the store's selectedInputItems to this gearset's items so the popup shows the correct current item
                const gsItems = this._selectedInputItems?.[gsNum] || {};
                store.state.column3 = store.state.column3 || {};
                const savedSingleViewItems = store.state.column3.selectedInputItems;
                store.state.column3.selectedInputItems = { ...gsItems };

                window.itemSelectionPopup.show('input', {
                    filterKeyword: keyword,
                    filterLevel: level,
                    onSelect: (item) => {
                        // Restore single view items
                        store.state.column3.selectedInputItems = savedSingleViewItems;
                        if (!this._selectedInputItems[gsNum]) this._selectedInputItems[gsNum] = {};
                        this._selectedInputItems[gsNum][idx] = item;
                        this._selectedInputItems[gsNum][idx] = item;
                        // Persist to gsXContext for reload
                        const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
                        const ctx = { ...(store.state.gearsets[ctxKey] || {}) };
                        ctx.selectedInputItems = { ...this._selectedInputItems[gsNum] };
                        store.update(`gearsets.${ctxKey}`, ctx);
                        store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
                        this.render();
                        // Notify Column 2 if this is the active gearset
                        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
                        if (gsNum === activeSlot) {
                            const css = window.combinedStatsSection;
                            if (css && typeof css.setInputItem === 'function') {
                                css.setInputItem(idx, item);
                            }
                        }
                    },
                    onUnequip: () => {
                        // Restore single view items
                        store.state.column3.selectedInputItems = savedSingleViewItems;
                        if (this._selectedInputItems[gsNum]) {
                            delete this._selectedInputItems[gsNum][idx];
                        }
                        // Persist to gsXContext for reload
                        const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
                        const ctx = { ...(store.state.gearsets[ctxKey] || {}) };
                        ctx.selectedInputItems = { ...this._selectedInputItems[gsNum] };
                        store.update(`gearsets.${ctxKey}`, ctx);
                        store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
                        this.render();
                        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
                        if (gsNum === activeSlot) {
                            const css = window.combinedStatsSection;
                            if (css && typeof css.setInputItem === 'function') {
                                css.setInputItem(idx, null);
                            }
                        }
                    }
                });
            }
        });

        // Fine materials checkbox (per gearset — recipes)
        this.$element.find('.comparison-fine-materials-cb').on('change', (e) => {
            const gsNum = $(e.currentTarget).data('gs');
            const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
            const ctx = { ...(store.state.gearsets[ctxKey] || {}) };
            ctx.useFine = e.currentTarget.checked;
            store.update(`gearsets.${ctxKey}`, ctx);
            store._syncToBackend(`ui.gearsets.${ctxKey}`, ctx);
            this.render();
        });

        // Quality metric toggle buttons — only update table body, not the whole section
        this.$element.find('.quality-metric-btn').on('click', (e) => {
            this._qualityMetric = $(e.currentTarget).data('metric');
            this.$element.find('.quality-metric-btn').removeClass('active');
            $(e.currentTarget).addClass('active');
            // Re-render just the table rows
            if (this._lastQualityData) {
                const { m1, m2, ctx1, ctx2 } = this._lastQualityData;
                const newRows = this._renderQualityRows(m1, m2, ctx1, ctx2);
                this.$element.find('.comparison-quality-section .crafting-odds-table tbody').html(newRows);
            }
        });

        // Mount LocationDropdown components for "no service" recipe locations
        this._destroyLocationDropdowns();

        // Material group selector (multiple crafting paths)
        this.$element.find('.material-group-button').on('click', (e) => {
            e.stopPropagation();
            const index = parseInt($(e.currentTarget).data('group-index'));
            this._selectedMaterialGroup = index;
            this._activeMaterialIndex = -1;
            this.render();
        });

        // Material item click — toggle sources dropdown (same as recipe-info-section)
        this.$element.find('.material-item-clickable').on('click', (e) => {
            e.stopPropagation();
            const $item = $(e.currentTarget);
            const $list = $item.closest('.materials-list');
            const $dropdown = $list.find('.material-source-dropdown');
            const materialName = $item.data('material-name');
            const newIndex = parseInt($item.data('material-index'));
            const wasOpen = $dropdown.is(':visible');

            if ($item.hasClass('material-selected') && wasOpen) {
                $item.removeClass('material-selected');
                this._activeMaterialIndex = -1;
                $dropdown.slideUp(150);
                return;
            }

            const oldIndex = this._activeMaterialIndex ?? -1;
            const direction = newIndex > oldIndex ? 'left' : 'right';

            $list.find('.material-item-clickable').removeClass('material-selected');
            $item.addClass('material-selected');
            this._activeMaterialIndex = newIndex;

            if (wasOpen) {
                this._slideComparisonSourcePage($dropdown, materialName, direction);
            } else {
                this._loadComparisonMaterialSources($dropdown, materialName);
            }
        });

        // Material source nav prev/next
        this.$element.find('.material-source-prev, .material-source-next').on('click', (e) => {
            e.stopPropagation();
            const isPrev = $(e.currentTarget).hasClass('material-source-prev');
            const $list = $(e.currentTarget).closest('.materials-list');
            const $materials = $list.find('.material-item-clickable');
            const total = $materials.length;
            if (total <= 1) return;
            const currentIdx = this._activeMaterialIndex ?? 0;
            const nextIdx = isPrev ? (currentIdx - 1 + total) % total : (currentIdx + 1) % total;
            $materials.eq(nextIdx).trigger('click');
        });

        // Material source item click — navigate to activity or recipe
        this.$element.find('.comparison-activity-content').on('click', '.material-source-item', (e) => {
            e.stopPropagation();
            const sourceType = $(e.currentTarget).data('source-type');
            const sourceId = $(e.currentTarget).data('source-id');
            if (sourceType === 'activity_drop' && window.activitySelector) {
                window.activitySelector.selectActivity(sourceId);
            } else if ((sourceType === 'recipe_output' || sourceType === 'recipe_input' || sourceType === 'recipe_drop') && window.recipeSelector) {
                window.recipeSelector.selectRecipe(sourceId);
            }
        });

        this.$element.find('.comparison-loc-dropdown-mount').each((_, el) => {
            const gsNum = $(el).data('gs');
            const ctxKey = gsNum === 1 ? 'gs1Context' : 'gs2Context';
            const ctx = store.state.gearsets[ctxKey] || {};
            // Use the comparison section's activity header as the width reference
            const $section = this.$element.find('.comparison-activity-section');
            const dd = new LocationDropdown(el, {
                label: '',
                selectedLocation: ctx.selectedLocation || null,
                floatingWidthElement: $section.length ? $section[0] : null,
                onSelect: (loc) => {
                    const updatedCtx = { ...(store.state.gearsets[ctxKey] || {}) };
                    updatedCtx.selectedLocation = loc ? loc.id : null;
                    store.update(`gearsets.${ctxKey}`, updatedCtx);
                    store._syncToBackend(`ui.gearsets.${ctxKey}`, updatedCtx);
                    this.render();
                }
            });
            // Scroll dropdown into view when opened — wrap toggleDropdown since stopPropagation blocks delegated handlers
            const origToggle = dd.toggleDropdown.bind(dd);
            dd.toggleDropdown = function () {
                const wasOpen = dd.isOpen;
                origToggle();
                // After opening, scroll up if needed and animate the dropdown along with the scroll
                if (!wasOpen && dd.isOpen) {
                    const rect = el.getBoundingClientRect();
                    const viewportHeight = window.innerHeight;
                    if (rect.top > viewportHeight * 0.5) {
                        const isMobile = window.innerWidth < 769;
                        const $scroller = isMobile ? $('#column-3') : $('#column-3 .column-content');
                        if ($scroller.length && dd._$floating) {
                            const scrollAmount = rect.top - viewportHeight * 0.5;
                            const startTop = parseFloat(dd._$floating.css('top'));
                            // Animate scroll and move dropdown together
                            $({ progress: 0 }).animate({ progress: 1 }, {
                                duration: 200,
                                step: function (now) {
                                    $scroller[0].scrollTop = $scroller[0].scrollTop; // keep in sync
                                    dd._$floating.css('top', (startTop - scrollAmount * now) + 'px');
                                }
                            });
                            $scroller.animate({ scrollTop: $scroller[0].scrollTop + scrollAmount }, 200);
                        }
                    }
                }
            };
            if (!this._locationDropdowns) this._locationDropdowns = [];
            this._locationDropdowns.push(dd);
        });
    }

    /**
     * Clean up LocationDropdown instances before re-render
     */
    _destroyLocationDropdowns() {
        if (this._locationDropdowns) {
            for (const dd of this._locationDropdowns) {
                if (dd.destroy) dd.destroy();
            }
            this._locationDropdowns = [];
        }
    }

    /**
     * Compute descriptive labels for material groups by finding the differing materials.
     * @returns {string[]} Array of labels, one per group
     */
    _getMaterialGroupLabels() {
        const groups = this.recipe.materials;
        if (!groups || groups.length <= 1) return [];

        const groupKeys = groups.map(g =>
            new Set(g.map(m => `${m.material_name}:${m.quantity}`))
        );

        const commonKeys = new Set([...groupKeys[0]].filter(k =>
            groupKeys.every(gk => gk.has(k))
        ));

        return groups.map(g => {
            const differing = g.filter(m => !commonKeys.has(`${m.material_name}:${m.quantity}`));
            if (differing.length > 0) {
                return differing.map(m => m.material_name).join(' + ');
            }
            return g.map(m => m.material_name).join(' + ');
        });
    }

    /**
     * Wire hover + click popovers on comparison drop icons. Mirrors
     * wireDropCards() from drop-item-popover.js which is used by the single
     * view's DropsSection. Elements are marked with `data-drop-name` (item
     * or container name) and optionally `data-drop-container="1"` for chest /
     * container popovers.
     */
    _wireComparisonDropPopovers() {
        const anchors = this.$element[0]?.querySelectorAll('.comparison-drop-label-inner[data-drop-name]') || [];
        anchors.forEach((anchor) => {
            const dropName = anchor.dataset.dropName;
            const isContainer = anchor.dataset.dropContainer === '1';
            if (!dropName) return;
            wireDropAnchor(anchor, dropName, isContainer);
        });
    }
}

export default GearsetComparisonSection;
