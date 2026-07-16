/**
 * CombinedStatsSection Component
 * 
 * Displays aggregated stats from all equipped items, collectibles, and services.
 * 
 * Features:
 * - Aggregate stats from all equipped items
 * - Include collectibles and service bonuses
 * - Include level bonuses for WE and QO
 * - Show applied vs unapplied stats based on context
 * - Expandable stat rows showing contributing items
 * - Set bonus display with unqualified tiers dimmed
 * - Hooks for Column 3 activity/location integration
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12
 */

import CollapsibleSection from './collapsible.js';
import store from '../state.js';
import api from '../api.js';
import { getPetIconPath, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';

/**
 * Format condition text for stat contributor display
 * @param {string} skill - Skill name (e.g., 'gathering', 'fishing')
 * @param {string} location - Location name (e.g., 'spectral', 'underwater')
 * @returns {string} Formatted condition text
 */
function formatStatCondition(skill, location) {
    const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

    const formatLocation = (loc) => {
        if (loc === 'gdte') return 'GDTE location';
        if (loc === 'underwater') return 'Underwater location';
        return `${capitalize(loc)} location`;
    };

    const skillGroupNames = {
        'artisan': 'doing Artisan skills',
        'gathering': 'doing Gathering skills',
        'utility': 'doing Utility skills',
        // Smelting is a sub-skill of Smithing; the bonus only applies to the
        // bar-smelting recipe subset (SMELTING_RECIPE_NAMES).
        'smelting': 'doing Smelting recipes',
    };

    const skillLower = skill ? skill.toLowerCase() : 'global';
    let formattedSkill = null;
    if (skillLower !== 'global') {
        formattedSkill = skillGroupNames[skillLower] || capitalize(skill);
    }

    if (formattedSkill && location !== 'global') {
        return `While ${formattedSkill} in ${formatLocation(location)}`;
    } else if (formattedSkill) {
        return `While ${formattedSkill}`;
    } else if (location !== 'global') {
        return `While in ${formatLocation(location)}`;
    }
    return 'Global';
}

class CombinedStatsSection extends CollapsibleSection {
    /**
     * Create the combined stats section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, {
            title: 'Combined Stats',
            icon: null,  // No icon for combined stats
            count: '',
            defaultExpanded: true,  // Expanded by default
            ...props
        });

        // Track expanded stats for showing contributors
        // Requirements: 6.3
        this.expandedStats = new Set();

        // Cache contributors by stat name
        this.contributorsByStat = {};

        // Cache calculated stats for Column 3 integration
        // Requirements: 7.1, 7.2, 7.3, 7.4
        this.cachedStats = {};

        // Callbacks for Column 3 integration (array to support multiple subscribers)
        this.statsCalculatedCallbacks = [];

        // Guard to prevent re-rendering while already rendering
        this.isRendering = false;

        // Comparison mode: cache rendered HTML per slot for instant switching
        this._slotContentCache = { 1: null, 2: null };
        this._slotContributorsCache = { 1: null, 2: null };
        this._slotExpandedStatsCache = { 1: null, 2: null };

        // Hooks for Column 3 integration
        // Requirements: 6.12
        this.currentActivity = null;  // Will be set by Column 3
        this.currentActivitySkill = null;  // Primary skill of current activity
        this.currentActivityComponentSkills = null;  // Component skills for travel (e.g., ['agility', 'traveling'])
        this.isTravel = false;  // Whether current activity is traveling
        this.currentRecipe = null;  // Will be set by Column 3
        this.currentRecipeSkill = null;  // Skill of current recipe
        this.currentRecipeName = null;  // Name of current recipe (for SMELTING_RECIPE_NAMES gating)
        this._inputItems = {};  // {idx: itemObject} — input items selected in Column 3
        this._useFineInputs = store.state.column3?.useFineInputs || false;
        this.currentLocation = null;  // Will be set by Column 3
        this.currentService = null;   // Will be set by Column 3 (for recipes)
        this.currentRequiredKeywords = [];  // Keywords required by current activity (e.g., ['Light source', 'Diving gear'])

        // Subscribe to gear changes
        this.subscribe('gearsets.current', () => {
            console.log('Gear changed subscription fired, recalculating stats');
            // Cancel any pending service change re-render (it was part of a slot switch)
            clearTimeout(this._serviceChangeTimer);
            // In comparison mode, check if this is just a slot switch (cached content available)
            if (store.state.gearsets.comparisonMode) {
                const slot = store.state.gearsets.activeGearsetSlot || 1;
                const cachedHtml = this._slotContentCache[slot];
                if (cachedHtml !== null) {
                    // Check if the actual gear has changed since cache was saved
                    const currentGear = slot === 1 ? store.state.gearsets.current : store.state.gearsets.gearset2;
                    const gearHash = JSON.stringify(Object.entries(currentGear || {}).map(([k, v]) => [k, v?.itemId, v?.useAbility]).sort());
                    if (this._slotGearHash && this._slotGearHash[slot] === gearHash) {
                        // Gear hasn't changed — this is a slot switch, use cache
                        this.$element.find('.collapsible-content').html(cachedHtml);
                        // Re-apply current expanded state to the restored HTML (no animation)
                        const $arrows = this.$element.find('.stat-row .expand-arrow');
                        $arrows.css('transition', 'none');
                        this.$element.find('.stat-row').each((_, row) => {
                            const statName = $(row).data('stat');
                            const isExpanded = this.expandedStats.has(statName);
                            $(row).toggleClass('expanded', isExpanded);
                            $(row).find('.stat-contributors').toggle(isExpanded);
                            $(row).find('.expand-arrow').toggleClass('expanded', isExpanded);
                        });
                        requestAnimationFrame(() => $arrows.css('transition', ''));
                        this.attachEvents();
                        return;
                    }
                    // Gear changed — invalidate cache
                    this._slotContentCache[slot] = null;
                }
            }
            this._renderPreservingScroll();
        });

        // Also re-render when gearset2 changes or active slot switches (comparison mode)
        this.subscribe('gearsets.gearset2', () => {
            if (store.state.gearsets.comparisonMode && store.state.gearsets.activeGearsetSlot === 2) {
                this._slotContentCache[2] = null; // Invalidate slot 2 cache
                this._renderPreservingScroll();
            }
        });

        // Re-render when service/location changes (e.g., gearset slot switch restores different context)
        this.subscribe('column3.selectedService', () => {
            if (store.state.gearsets.comparisonMode) {
                const svc = store.state.column3.selectedService;
                const loc = store.state.column3.selectedLocation;
                // Update service and location, then re-render
                this.currentService = svc;
                this.currentLocation = loc ? [loc] : null;
                // Don't invalidate cache here — slot switches fire this before gearsets.current.
                // The cache will be used by the gearsets.current handler.
                // Only re-render if NOT about to get a gearsets.current notification (i.e., user manually changed service).
                // We detect this by checking if the slot switch is in progress via a microtask delay.
                clearTimeout(this._serviceChangeTimer);
                this._serviceChangeTimer = setTimeout(() => {
                    // If we get here, no gearsets.current fired right after — this was a real service change
                    this._slotContentCache = { 1: null, 2: null };
                    this._renderPreservingScroll();
                }, 0);
            }
        });

        // Defensive location-sync for single view:
        // On session restore (and any other state-driven location change that didn't go
        // through setRecipeContext/setLocation), keep currentLocation in sync with the
        // store. Without this, drops + combined stats don't pick up location bonuses on
        // reload because onRecipeChange fires before the recipe loads and the subsequent
        // `column3.selectedLocation` notification doesn't propagate anywhere.
        this.subscribe('column3.selectedLocation', () => this._syncLocationFromStore());

        // Subscribe to character skill changes for level bonus recalculation

        // Subscribe to character skill changes for level bonus recalculation
        this.subscribe('character.skills', () => {
            console.log('Column 2: Character skills changed subscription fired');
            this._slotContentCache = { 1: null, 2: null };
            this._renderPreservingScroll();
        });

        this.subscribe('ui.user_overrides.skills', () => {
            console.log('Column 2: Skill overrides changed subscription fired');
            console.log('Current activity:', this.currentActivity);
            console.log('Current recipe skill:', this.currentRecipeSkill);
            this._slotContentCache = { 1: null, 2: null };
            this._renderPreservingScroll();
        });

        // Subscribe to achievement points changes for AP-gated stats
        this.subscribe('ui.user_overrides.achievement_points', () => {
            console.log('Column 2: Achievement points changed subscription fired');

            // Prevent re-rendering if already rendering
            if (this.isRendering) {
                console.log('  Skipping render - already rendering');
                return;
            }
            this._slotContentCache = { 1: null, 2: null };
            this._renderPreservingScroll();
        });

        // Don't subscribe to general character or items - only recalculate when gear or skills change
        // Item quality changes are less frequent and can be manually refreshed

        // UI setting: hide unapplicable stats
        this.hideUnapplicableStats = localStorage.getItem('hideUnapplicableStats') === 'true';
        this._hideUnapplicableHandler = (e) => {
            this.hideUnapplicableStats = e.detail.value;
            this._slotContentCache = { 1: null, 2: null };
            this._renderPreservingScroll();
        };
        window.addEventListener('hideUnapplicableStatsChanged', this._hideUnapplicableHandler);

        // Recompute when the travel route changes. Travel stats are matched
        // against the route's segments (see _travelLocationMatches), and the
        // route can arrive after the first render (it's fetched async by the
        // Travel info section), so we must re-render once it's available.
        this._travelRouteChangedHandler = () => {
            if (!this.isTravel) return;
            this._slotContentCache = { 1: null, 2: null };
            this._renderPreservingScroll();
        };
        window.addEventListener('travelRouteChanged', this._travelRouteChangedHandler);
    }

    /**
     * Render while preserving the scroll position of column 2's scroll container.
     * Column 2 scrolls via .column-content (desktop) or #column-2 (mobile).
     */
    _renderPreservingScroll() {
        const $col2Content = $('#column-2 .column-content');
        const $col2 = $('#column-2');
        const isMobile = window.innerWidth < 769;
        const $scroller = isMobile ? $col2 : $col2Content;
        const scrollTop = $scroller.length ? $scroller[0].scrollTop : 0;

        // Set a one-shot scroll restore that fires after loadContent completes
        this._pendingScrollRestore = scrollTop;
        this._pendingScrollTarget = $scroller;

        this.render();
        this.attachEvents();
    }

    /**
     * Get icon path for a stat
     * @param {string} statName - Stat name (snake_case)
     * @returns {string} Icon path
     */
    getStatIconPath(statName) {
        // Handle ItemFindingCategory stats
        if (statName.startsWith('ItemFindingCategory.')) {
            const categoryConst = statName.split('.')[1];
            // Use icon_name from category info if available
            if (window.itemFindingCategories && window.itemFindingCategories[categoryConst]) {
                const iconName = window.itemFindingCategories[categoryConst].icon_name;
                return `/assets/icons/attributes/${iconName}.svg`;
            }
            // Fallback: convert FISHING_BAIT to find_fishing_bait.svg
            const iconName = 'find_' + categoryConst.toLowerCase();
            return `/assets/icons/attributes/${iconName}.svg`;
        }

        // Map stat names to icon filenames
        const iconMap = {
            'work_efficiency': 'work_efficiency',
            'double_action': 'double_action',
            'double_rewards': 'double_rewards',
            'no_materials_consumed': 'no_materials_consumed',
            'quality_outcome': 'quality_outcome',
            'bonus_xp': 'bonus_experience',
            'bonus_xp_base': 'bonus_experience',
            'bonus_xp_add': 'bonus_experience',
            'bonus_xp_percent': 'bonus_experience',
            'bonus_experience': 'bonus_experience',
            'bonus_experience_base': 'bonus_experience',
            'bonus_experience_add': 'bonus_experience',
            'bonus_experience_percent': 'bonus_experience',
            'foraging_base_xp': 'bonus_experience',
            'steps_required': 'steps_required',
            'steps_add': 'steps_required',
            'flat_steps': 'steps_required',
            'steps_pct': 'steps_required',
            'steps_percent': 'steps_required',
            'inventory_space': 'inventory_space',
            'chest_finding': 'chest_finding',
            'item_finding': 'item_finding',
            'fine_material_finding': 'fine_material_finding',
            'find_collectibles': 'find_collectibles',
            'collectible_finding': 'find_collectibles',
            'find_linens': 'find_linens'
        };

        const iconName = iconMap[statName] || statName;
        return `/assets/icons/attributes/${iconName}.svg`;
    }

    /**
     * Set the current activity context (hook for Column 3)
     * Requirements: 6.12
     * 
     * @param {string|null} activityId - Activity ID or recipe ID or null
     */
    async setActivity(activityId) {
        // Check if this is the same as current state
        const isSameActivity = this.currentActivity === activityId && !this.currentRecipe;
        const isSameRecipe = this.currentRecipe === activityId && !this.currentActivity;

        if (isSameActivity || isSameRecipe) {
            return; // No change, don't re-render
        }

        // Invalidate slot content cache — activity context changed
        this._slotContentCache = { 1: null, 2: null };

        // Clear input items and fine inputs when switching activities
        this._inputItems = {};
        this._useFineInputs = false;
        store.state.column3.useFineInputs = false;

        // Fetch activity OR recipe to determine which type this is
        let isActivity = false;
        let isRecipe = false;

        if (activityId) {
            try {
                // Try activities first
                const actResponse = await $.get('/api/activities');
                for (const activities of Object.values(actResponse.by_skill)) {
                    const activity = activities.find(a => a.id === activityId);
                    if (activity) {
                        isActivity = true;
                        // Clear recipe state, set activity state
                        this.currentRecipe = null;
                        this.currentRecipeSkill = null;
                        this.currentActivity = activityId;
                        this.currentActivitySkill = activity.primary_skill;
                        this.currentActivityComponentSkills = activity.component_skills || [activity.primary_skill.toLowerCase()];
                        this.isTravel = !!activity.is_travel;
                        this.currentRequiredKeywords = Object.keys(activity.requirements?.keyword_counts || {});
                        console.log('Set activity skill:', this.currentActivitySkill, 'components:', this.currentActivityComponentSkills, 'isTravel:', this.isTravel);
                        break;
                    }
                }

                // If not found in activities, try recipes
                if (!isActivity) {
                    const recResponse = await $.get('/api/recipes');
                    for (const recipes of Object.values(recResponse.by_skill)) {
                        const recipe = recipes.find(r => r.id === activityId);
                        if (recipe) {
                            isRecipe = true;
                            // Clear activity state, set recipe state
                            this.currentActivity = null;
                            this.currentActivitySkill = null;
                            this.currentRequiredKeywords = [];
                            this.currentRecipe = activityId;
                            this.currentRecipeSkill = recipe.skill;
                            this.currentRecipeName = recipe.name || null;
                            console.log('Set recipe skill:', this.currentRecipeSkill);
                            break;
                        }
                    }
                }

                // If still not found, try generic activity/recipe via view endpoint
                if (!isActivity && !isRecipe && activityId.startsWith('generic::')) {
                    try {
                        const defId = activityId.replace('generic::', '');
                        const viewData = await api.getGenericDefinitionView(defId);
                        if (viewData) {
                            const skill = viewData.primary_skill || viewData.skill;
                            if (viewData.type === 'activity' || viewData.primary_skill) {
                                isActivity = true;
                                this.currentRecipe = null;
                                this.currentRecipeSkill = null;
                                this.currentActivity = activityId;
                                this.currentActivitySkill = skill;
                                this.currentActivityComponentSkills = viewData.component_skills || [skill.toLowerCase()];
                                this.isTravel = !!viewData.is_travel;
                                this.currentRequiredKeywords = Object.keys(viewData.requirements?.keyword_counts || {});
                                console.log('Set generic activity skill:', skill);
                            } else {
                                isRecipe = true;
                                this.currentActivity = null;
                                this.currentActivitySkill = null;
                                this.currentRequiredKeywords = [];
                                this.currentRecipe = activityId;
                                this.currentRecipeSkill = skill;
                                this.currentRecipeName = viewData.name || null;
                                console.log('Set generic recipe skill:', skill);
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to fetch generic definition view:', e);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch activity/recipe skill:', error);
            }
        } else {
            // activityId is null - need to determine which one to clear
            // Check which selector called this by looking at store state
            const selectedActivity = store.state.column3?.selectedActivity;
            const selectedRecipe = store.state.column3?.selectedRecipe;

            // If activity is null in store but recipe is set, clear only activity
            if (!selectedActivity && selectedRecipe) {
                this.currentActivity = null;
                this.currentActivitySkill = null;
                this.currentActivityComponentSkills = null;
                this.isTravel = false;
                this.currentRequiredKeywords = [];
                // Keep recipe state intact
            }
            // If recipe is null in store but activity is set, clear only recipe
            else if (selectedActivity && !selectedRecipe) {
                this.currentRecipe = null;
                this.currentRecipeSkill = null;
                // Keep activity state intact
            }
            // If both are null, clear everything
            else {
                this.currentActivity = null;
                this.currentActivitySkill = null;
                this.currentActivityComponentSkills = null;
                this.isTravel = false;
                this.currentRequiredKeywords = [];
                this.currentRecipe = null;
                this.currentRecipeSkill = null;
            }
        }

        // Clear any pending debounced renders from gear changes
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Render immediately with new activity/recipe context
        this.render();
        this.attachEvents();
    }

    /**
     * Set both activity and location context together (for batching)
     * Requirements: 6.12, 7.1, 7.4
     * 
     * @param {string|null} activityId - Activity ID or null
     * @param {string|string[]|null} location - Location name, array of region names, or null
     */
    async setActivityAndLocation(activityId, location, inputItems = null, useFineInputs = false) {
        console.log('=== setActivityAndLocation() called ===');
        console.log('Activity:', activityId);
        console.log('Location:', location);
        console.log('Input items provided:', inputItems ? Object.keys(inputItems).length : 0);

        // Set activity first (without rendering)
        if (activityId !== undefined) {
            // Manually update activity state without rendering
            const isSameActivity = this.currentActivity === activityId && !this.currentRecipe;
            const isSameRecipe = this.currentRecipe === activityId && !this.currentActivity;

            if (!isSameActivity && !isSameRecipe && activityId) {
                // Clear input items initially (will be re-applied after async work)
                this._inputItems = {};
                this._useFineInputs = false;

                try {
                    // Try activities first
                    const actResponse = await $.get('/api/activities');
                    let found = false;
                    for (const activities of Object.values(actResponse.by_skill)) {
                        const activity = activities.find(a => a.id === activityId);
                        if (activity) {
                            this.currentRecipe = null;
                            this.currentRecipeSkill = null;
                            this.currentActivity = activityId;
                            this.currentActivitySkill = activity.primary_skill;
                            this.currentActivityComponentSkills = activity.component_skills || [activity.primary_skill.toLowerCase()];
                            this.isTravel = !!activity.is_travel;
                            this.currentRequiredKeywords = Object.keys(activity.requirements?.keyword_counts || {});
                            found = true;
                            break;
                        }
                    }

                    // If not found in activities, try recipes
                    if (!found) {
                        this.isTravel = false;
                        this.currentActivityComponentSkills = null;
                        this.currentRequiredKeywords = [];
                        const recResponse = await $.get('/api/recipes');
                        for (const recipes of Object.values(recResponse.by_skill)) {
                            const recipe = recipes.find(r => r.id === activityId);
                            if (recipe) {
                                this.currentActivity = null;
                                this.currentActivitySkill = null;
                                this.currentRecipe = activityId;
                                this.currentRecipeSkill = recipe.skill;
                                this.currentRecipeName = recipe.name || null;
                                found = true;
                                break;
                            }
                        }
                    }

                    // If still not found, try generic activity/recipe via view endpoint
                    if (!found && activityId.startsWith('generic::')) {
                        try {
                            const defId = activityId.replace('generic::', '');
                            const viewData = await api.getGenericDefinitionView(defId);
                            if (viewData) {
                                const skill = viewData.primary_skill || viewData.skill;
                                if (viewData.type === 'activity' || viewData.primary_skill) {
                                    this.currentRecipe = null;
                                    this.currentRecipeSkill = null;
                                    this.currentActivity = activityId;
                                    this.currentActivitySkill = skill;
                                    this.currentActivityComponentSkills = viewData.component_skills || [skill.toLowerCase()];
                                    this.isTravel = !!viewData.is_travel;
                                    this.currentRequiredKeywords = Object.keys(viewData.requirements?.keyword_counts || {});
                                } else {
                                    this.currentActivity = null;
                                    this.currentActivitySkill = null;
                                    this.currentRequiredKeywords = [];
                                    this.currentRecipe = activityId;
                                    this.currentRecipeSkill = skill;
                                    this.currentRecipeName = viewData.name || null;
                                }
                                found = true;
                            }
                        } catch (e) {
                            console.warn('Failed to fetch generic definition view:', e);
                        }
                    }
                } catch (error) {
                    console.error('Failed to fetch activity/recipe skill:', error);
                }

                // Re-apply input items AFTER async work completes.
                // This prevents a race condition where setActivity(null) (fired
                // by the recipe-info-section clearing its recipe) clears
                // _inputItems during the await above.
                if (inputItems && Object.keys(inputItems).length > 0) {
                    this._inputItems = {};
                    for (const [idx, item] of Object.entries(inputItems)) {
                        if (item && item.stats) {
                            this._inputItems[parseInt(idx)] = item;
                        }
                    }
                    this._useFineInputs = useFineInputs;
                }
            }
        }

        // Always (re-)apply input items regardless of whether the activity
        // changed — covers the Equip flow from crafting tree where the same
        // activity is already selected but new input items need to take effect.
        if (inputItems && Object.keys(inputItems).length > 0) {
            this._inputItems = {};
            for (const [idx, item] of Object.entries(inputItems)) {
                if (item && item.stats) {
                    this._inputItems[parseInt(idx)] = item;
                }
            }
            this._useFineInputs = useFineInputs;
        }

        // Set location (without rendering)
        if (location !== undefined) {
            this.setLocation(location, true); // skipRender = true
        }

        // Clear any pending debounced renders
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Single render with both contexts
        this.render();
        this.attachEvents();
    }

    /**
     * Set the current location context (hook for Column 3)
     * Requirements: 6.12
     * 
     * @param {string|string[]|null} location - Location name, array of region names, or null
     * @param {boolean} skipRender - If true, don't trigger render (for batching updates)
     */
    setLocation(location, skipRender = false) {
        // First call after page load — captures the post-init synchronous
        // render gap (column3 + recipe/activity dropdown population) that
        // the [PERF] init phases couldn't attribute. One-shot guard.
        if (window.__walkscapePerf && !window.__walkscapePerf._first_set_location_seen) {
            window.__walkscapePerf._first_set_location_seen = true;
            window.__walkscapePerf.measure('first_setLocation_from_init', 'init_start');
        }
        console.log('=== setLocation() called ===');
        console.log('New location:', location);
        console.log('Current location:', this.currentLocation);
        console.log('Skip render:', skipRender);

        // Normalize to array for comparison
        const newLocationArray = Array.isArray(location) ? location : (location ? [location] : []);
        const currentLocationArray = Array.isArray(this.currentLocation) ? this.currentLocation : (this.currentLocation ? [this.currentLocation] : []);

        // Check if arrays are equal
        const arraysEqual = newLocationArray.length === currentLocationArray.length &&
            newLocationArray.every((val, idx) => val === currentLocationArray[idx]);

        if (arraysEqual && !skipRender) {
            console.log('Location unchanged, skipping render');
            return; // No change, don't re-render
        }

        this.currentLocation = location;
        console.log('Location updated to:', this.currentLocation);

        // Clear any pending debounced renders
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Render immediately with new location context (unless skipped)
        if (!skipRender) {
            this.render();
            this.attachEvents();
        }
    }

    /**
     * Sync currentLocation from store.state.column3.selectedLocation, resolving the
     * location's regions (e.g., Syrenthia → ['syrenthia', 'underwater']) so region-
     * scoped gear bonuses apply. Called from the column3.selectedLocation subscription.
     *
     * Skipped in comparison mode — that path uses selectedService + gsXContext for
     * per-slot location handling.
     *
     * Runs even when no recipe/activity is loaded yet so that on session restore the
     * location is ready for the pending setRecipeContext call to match.
     */
    async _syncLocationFromStore() {
        if (store.state.gearsets?.comparisonMode) return;

        const locId = store.state.column3?.selectedLocation;

        // Null location — clear if set
        if (!locId) {
            if (this.currentLocation !== null) {
                this.setLocation(null);
            }
            return;
        }

        // Resolve regions so e.g. underwater bonuses apply when selecting Syrenthia.
        // Prefer the recipe/service endpoint (matches single view's selectLocation path);
        // fall back to the global locations endpoint for no-service recipes or activities.
        let regions = null;
        try {
            if (this.currentRecipe && !String(this.currentRecipe).startsWith('generic::')) {
                const svcResp = await $.get(`/api/services/for-recipe/${this.currentRecipe}`);
                for (const service of svcResp.services || []) {
                    if (!service.locations) continue;
                    const locData = service.locations.find(l => l.location?.id === locId);
                    if (locData && locData.location.regions && locData.location.regions.length > 0) {
                        regions = locData.location.regions;
                        break;
                    }
                }
            }
            if (!regions) {
                const locResp = await $.get('/api/locations');
                for (const region of locResp.regions || []) {
                    const loc = (region.locations || []).find(l => l.id === locId);
                    if (loc) {
                        regions = (loc.regions && loc.regions.length > 0) ? loc.regions : [locId];
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('_syncLocationFromStore: failed to resolve regions, falling back to raw id:', e);
        }
        const newLoc = regions || [locId];

        // If no recipe/activity is loaded yet (e.g., during session restore before
        // onRecipeChange completes), just prime currentLocation without triggering a
        // render — the pending setRecipeContext call will do the render once the
        // recipe loads. Otherwise, setLocation handles the no-op + render logic.
        if (!this.currentRecipe && !this.currentActivity) {
            this.currentLocation = newLoc;
            return;
        }
        this.setLocation(newLoc);
    }

    /**
     * Set an input item for the activity (hook for Column 3 input slots)
     * Input items with stats contribute to the activity calculation.
     * @param {number} idx - Input item index
     * @param {Object|null} item - Item object with stats, or null to clear
     */
    setInputItem(idx, item) {
        if (item) {
            this._inputItems[idx] = item;
        } else {
            delete this._inputItems[idx];
        }
        this.render();
        this.attachEvents();
    }

    setFineInputs(useFine) {
        console.log('[FINE-DEBUG] setFineInputs called:', useFine);
        this._useFineInputs = !!useFine;
        this.render();
        // Do NOT call attachEvents() here — it re-triggers the checkbox handler
    }

    /**
     * Set the current service context (hook for Column 3)
     * Requirements: 6.12, 7.3
     * 
     * @param {string|null} service - Service ID or null
     */
    setService(service) {
        console.log('=== setService() called ===');
        console.log('Previous currentService:', this.currentService);
        console.log('New service:', service);

        if (this.currentService === service) {
            console.log('Service unchanged, skipping re-render');
            return; // No change, don't re-render
        }
        this.currentService = service;
        console.log('Updated currentService to:', this.currentService);

        // Update required keywords from new service
        this._getServiceRequiredKeywords(service).then(keywords => {
            this.currentRequiredKeywords = keywords;
        });

        // Clear any pending debounced renders
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Render immediately with new service context
        console.log('Triggering render() due to service change');
        this.render();
        this.attachEvents();
    }

    /**
     * Set recipe context with service and location in one call
     * This prevents multiple renders and duplicate contributors
     * Requirements: 7.2, 7.3, 7.4
     * 
     * @param {string|null} recipeId - Recipe ID or null
     * @param {string|null} serviceId - Service ID or null
     * @param {string|null} locationId - Location ID or null
     */
    async setRecipeContext(recipeId, serviceId, locationId) {
        console.log('=== setRecipeContext() called ===');
        console.log('Recipe:', recipeId);
        console.log('Service:', serviceId);
        console.log('Location:', locationId);

        // Invalidate slot content cache — recipe context changed
        this._slotContentCache = { 1: null, 2: null };

        // Clear input items and fine inputs when switching to recipe context
        this._inputItems = {};
        this._useFineInputs = false;

        // Check if context is unchanged
        const recipeUnchanged = this.currentRecipe === recipeId;
        const serviceUnchanged = this.currentService === serviceId;
        const locationUnchanged = JSON.stringify(this.currentLocation) === JSON.stringify(locationId);

        if (recipeUnchanged && serviceUnchanged && locationUnchanged) {
            console.log('Recipe context unchanged, skipping re-render');
            return;
        }

        // Set recipe using existing setActivity logic
        if (recipeId) {
            // Handle generic recipes
            if (recipeId.startsWith('generic::')) {
                try {
                    const defId = recipeId.replace('generic::', '');
                    const viewData = await api.getGenericDefinitionView(defId);
                    if (viewData) {
                        this.currentActivity = null;
                        this.currentActivitySkill = null;
                        this.currentRecipe = recipeId;
                        this.currentRecipeSkill = viewData.skill || viewData.primary_skill || null;
                        this.currentRecipeName = viewData.name || null;
                        console.log('Set generic recipe skill:', this.currentRecipeSkill);
                    }
                } catch (e) {
                    console.error('Failed to fetch generic recipe skill:', e);
                }
            } else {
                try {
                    const recResponse = await $.get('/api/recipes');
                    for (const recipes of Object.values(recResponse.by_skill)) {
                        const recipe = recipes.find(r => r.id === recipeId);
                        if (recipe) {
                            // Clear activity state, set recipe state
                            this.currentActivity = null;
                            this.currentActivitySkill = null;
                            this.currentRequiredKeywords = [];  // Will be set from service below
                            this.currentRecipe = recipeId;
                            this.currentRecipeSkill = recipe.skill;
                            this.currentRecipeName = recipe.name || null;
                            console.log('Set recipe skill:', this.currentRecipeSkill);
                            break;
                        }
                    }
                } catch (error) {
                    console.error('Failed to fetch recipe skill:', error);
                }
            }
        } else {
            this.currentRecipe = null;
            this.currentRecipeSkill = null;
        }

        // Set service and location without triggering renders
        this.currentService = serviceId;
        this.currentLocation = locationId;

        // Populate required keywords from service requirements (e.g., diving gear for underwater services)
        this.currentRequiredKeywords = await this._getServiceRequiredKeywords(serviceId);

        console.log('Updated context - Recipe:', this.currentRecipe, 'Service:', this.currentService, 'Location:', this.currentLocation, 'RequiredKeywords:', this.currentRequiredKeywords);

        // Clear any pending debounced renders
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Render once with all context set
        this.render();
        this.attachEvents();
    }

    /**
     * Fetch required keywords from a service's requirements (e.g., 'diving gear' for underwater services).
     * Returns an array of keyword strings, or [] if no service or no keyword requirements.
     */
    async _getServiceRequiredKeywords(serviceId) {
        if (!serviceId) return [];
        try {
            const serviceResponse = await $.get('/api/services');
            // Find service by ID or by location service_id
            let service = serviceResponse.services.find(s => s.id === serviceId);
            if (!service) {
                for (const svc of serviceResponse.services) {
                    if (svc.locations && svc.locations.some(loc => loc.service_id === serviceId)) {
                        service = svc;
                        break;
                    }
                }
            }
            if (service && service.requirements && service.requirements.keyword_counts) {
                return Object.keys(service.requirements.keyword_counts);
            }
        } catch (e) {
            console.warn('Failed to fetch service keywords:', e);
        }
        return [];
    }

    /**
     * Requirements: 6.1, 6.10
     * 
     * Aggregates stats from:
     * - All equipped gear and tools
     * - Collectibles (from character)
     * - Service bonuses (TODO: future)
     * - Level bonuses for WE and QO
     * 
     * @returns {Object} Combined stats object {stat_name: value}
     */
    async calculateStats() {
        const stats = {};
        const currentGear = store.getActiveGearset() || {};
        const character = store.state.character || {};

        // Guard: if gearset is not a valid object (e.g., during async restore), bail out
        if (!currentGear || typeof currentGear !== 'object') {
            return stats;
        }

        // Clear contributors cache at the start of calculation to prevent duplicates
        // This ensures each calculateStats() call starts fresh
        console.log('=== calculateStats() START ===');
        console.log('[FINE-DEBUG] _useFineInputs:', this._useFineInputs);
        console.log('[FINE-DEBUG] _inputItems count:', Object.keys(this._inputItems || {}).length);
        console.log('[FINE-DEBUG] stack:', new Error().stack.split('\n').slice(1, 5).join(' <- '));

        // Initialize contributorsByStat if it doesn't exist
        if (!this.contributorsByStat) {
            this.contributorsByStat = {};
        }

        console.log('contributorsByStat before clear:', Object.keys(this.contributorsByStat).length, 'stats');
        this.contributorsByStat = {};
        this._currentCalcId = (this._currentCalcId || 0) + 1;
        const myCalcId = this._currentCalcId;
        console.log('contributorsByStat after clear:', Object.keys(this.contributorsByStat).length, 'stats');

        // Travel activities have no location dropdown, so currentLocation is null
        // and every location-scoped travel bonus (e.g. Medieval sneakers
        // "!underwater", Lily pad rope "gdte", Map of Trellin "trellin") would be
        // wrongly flagged "doesn't apply". Resolve the active travel route's
        // per-segment START-location regions so we can mirror the backend
        // /api/travel/stats matcher (region membership + "!" negation, applied if
        // ANY segment matches). See _travelLocationMatches() below.
        this._travelSegmentRegions = null;
        if (this.isTravel) {
            this._travelSegmentRegions = await this._getTravelRouteSegmentRegions();
            // Bail out if a newer calculateStats started during the await
            if (myCalcId !== this._currentCalcId) {
                return stats;
            }
        }

        console.log('Calculating combined stats, equipped items:', Object.keys(currentGear).filter(k => currentGear[k]).length);

        // Get catalog to look up item details
        try {
            // Use cached catalog — item definitions don't change during a session.
            // Cache is already invalidated on character import (import-modal.js).
            const catalog = await api.getCatalog();

            // Bail out if a newer calculateStats has started while we were awaiting
            if (myCalcId !== this._currentCalcId) {
                console.log('[RENDER-DEBUG] calculateStats STALE (newer calc started), bailing out');
                return stats;
            }
            const catalogItems = catalog.items || [];
            const collectibles = catalog.collectibles || [];

            console.log('Catalog loaded with', catalogItems.length, 'items and', collectibles.length, 'collectibles');

            // Trigger one-time normalization of UUID-format itemId values in currentGear.
            // This fixes sessions where currentGear was saved with full UUIDs instead of short ids.
            if (store && !store._currentGearNormalized) {
                store._currentGearNormalized = true;
                let normalized = false;
                for (const [slot, slotItem] of Object.entries(store.state.gearsets.current || {})) {
                    if (!slotItem || !slotItem.itemId) continue;
                    // If the item is already enriched (has name/rarity), skip
                    if (slotItem.name && slotItem.rarity) continue;
                    // Find by short id first, then by UUID
                    let catalogItem = catalogItems.find(item => item.id === slotItem.itemId);
                    if (!catalogItem) {
                        catalogItem = catalogItems.find(item => item.uuid === slotItem.itemId);
                    }
                    if (catalogItem) {
                        // Enrich with full catalog data, preserving quality
                        const quality = slotItem.quality || null;
                        let enriched = { ...catalogItem, itemId: catalogItem.id };
                        if (quality && catalogItem.type === 'crafted_item') {
                            const qualityMap = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                            enriched.quality = qualityMap[quality] || quality;
                            enriched.rarity = quality;
                        }
                        store.state.gearsets.current[slot] = enriched;
                        normalized = true;
                    }
                }
                if (normalized) {
                    console.log('Normalized and enriched currentGear items from catalog');
                    store._notifySubscribers('gearsets.current');
                    store._saveCurrentGear();
                }
            }

            // Aggregate stats from all equipped items
            console.log('[RENDER-DEBUG] currentGear slots:', Object.keys(currentGear).join(', '));
            console.log('[RENDER-DEBUG] currentGear slot count:', Object.keys(currentGear).length);
            for (const [slot, slotItem] of Object.entries(currentGear)) {
                if (slotItem && slotItem.itemId) console.log(`[RENDER-DEBUG]   ${slot}: ${slotItem.itemId} (${slotItem.name || '?'})`);
                if (!slotItem || !slotItem.itemId) continue;

                // Find full item data in catalog
                // For fine consumables, the itemId has a '_fine' suffix (e.g., "fruit_cake_fine")
                // but the catalog only has the base item (e.g., "fruit_cake")
                let fullItem = catalogItems.find(item => item.id === slotItem.itemId);
                let isFineConsumable = false;

                // Fallback: some saved gearsets store the full UUID as itemId (e.g. "item-warm_beanie-26728220-...")
                // instead of the short id (e.g. "warm_beanie"). Try matching by uuid as well.
                if (!fullItem && slotItem.itemId) {
                    fullItem = catalogItems.find(item => item.uuid === slotItem.itemId);
                }

                if (!fullItem && (slotItem.is_fine || slotItem.itemId.endsWith('_fine'))) {
                    const baseId = slotItem.itemId.replace(/_fine$/, '');
                    fullItem = catalogItems.find(item => item.id === baseId);
                    if (fullItem) {
                        isFineConsumable = true;
                        console.log(`Fine consumable: found base item ${baseId} for ${slotItem.itemId}`);
                    }
                }

                // Bug b788d037 follow-up: tree-node Equip writes the BASE
                // itemId (e.g. "sweet_carrot_pie") for Fine consumables and
                // marks is_fine=true on the slot data. The catalog lookup
                // above SUCCEEDS (returns the base entry), so the Fine
                // fallback (`!fullItem` branch) never fires and
                // isFineConsumable stays false — the combined-stats
                // section then displays the regular stats (6% DA) instead
                // of the Fine stats (9% DA) even though the equipped icon
                // looks correctly Fine.
                //
                // Fix: also flip isFineConsumable when the slot is marked
                // is_fine and the catalog entry has a stats_fine sibling.
                // No-op for non-consumable slots (gear/tools/rings have
                // is_fine=false).
                if (!isFineConsumable
                        && slotItem.is_fine
                        && fullItem
                        && fullItem.stats_fine) {
                    isFineConsumable = true;
                }

                if (!fullItem) {
                    // Check if this is a generic item (including fine versions with _fine suffix)
                    let genericItemId = slotItem.itemId || '';
                    let isGenericFine = false;
                    if (genericItemId.endsWith('_fine')) {
                        genericItemId = genericItemId.replace(/_fine$/, '');
                        isGenericFine = true;
                    }
                    if (slotItem.is_generic || genericItemId.startsWith('generic::item::')) {
                        const genericId = genericItemId.replace('generic::item::', '');
                        const genericItems = store.state.genericItems || [];
                        const gi = genericItems.find(g => g.id === genericId);
                        if (gi) {
                            const isConsumable = gi.slot === 'consumable';
                            const isCollectible = gi.slot === 'collectible';
                            const isCrafted = isCollectible ? false : (gi.is_crafted || isConsumable);
                            // For fine generic consumables, use Fine quality stats
                            let stats = gi.stats || {};
                            let statsFine = null;
                            if (isConsumable && gi.quality_stats) {
                                stats = gi.quality_stats['Normal'] || gi.stats || {};
                                statsFine = gi.quality_stats['Fine'] || null;
                            }
                            if (isGenericFine && statsFine) {
                                isFineConsumable = true;
                                stats = statsFine;
                            }
                            fullItem = {
                                id: slotItem.itemId,
                                name: gi.name,
                                slot: gi.slot,
                                keywords: gi.keywords || [],
                                rarity: isCrafted ? 'common' : (gi.rarity || 'common'),
                                type: isCollectible ? 'collectible' : (isConsumable ? 'consumable' : (isCrafted ? 'crafted_item' : 'item')),
                                stats: stats,
                                stats_fine: statsFine,
                                stats_by_quality: (!isConsumable && gi.quality_stats) ? gi.quality_stats : null,
                                gated_stats: gi.gated_stats || {},
                                is_generic: true,
                                icon: gi.icon || '⚡',
                                icon_color: gi.icon_color || null,
                                icon_path: gi.icon_path || null,
                            };
                        }
                    }
                }

                if (!fullItem) {
                    console.warn(`Item not found in catalog: ${slotItem.itemId}`);
                    continue;
                }

                console.log(`Processing ${slot}: ${fullItem.name}${isFineConsumable ? ' (Fine)' : ''}`);

                // Debug: log catalog stats keys for Ghost trap pack
                if (fullItem.name && fullItem.name.toLowerCase().includes('ghost trap')) {
                    console.log(`  CATALOG LOOKUP for ${fullItem.name}: stats keys =`, Object.keys(fullItem.stats || {}));
                    console.log(`  CATALOG LOOKUP full stats:`, JSON.stringify(fullItem.stats));
                    console.log(`  slotItem stats keys:`, Object.keys(slotItem.stats || {}));
                    console.log(`  slotItem full stats:`, JSON.stringify(slotItem.stats));
                    console.log(`  fullItem === slotItem?`, fullItem === slotItem);
                    console.log(`  fullItem.id:`, fullItem.id, `slotItem.itemId:`, slotItem.itemId);
                }
                // Get item stats and rarity
                // For fine consumables, use stats_fine from the base catalog item
                let itemStats = isFineConsumable ? (fullItem.stats_fine || fullItem.stats || {}) : (fullItem.stats || {});
                let itemRarity = isFineConsumable ? 'fine' : (fullItem.rarity || 'common');

                // For pets, use level-specific stats from the equipped level
                if (fullItem.type === 'pet' && fullItem.levels) {
                    const overrides = store.state.ui?.user_overrides || {};
                    const petOverride = (overrides.items && overrides.items[fullItem.id]) || {};
                    const petBase = store.state.items[fullItem.id] || {};
                    const petLevel = petOverride.level !== undefined ? petOverride.level : (petBase.level !== undefined ? petBase.level : (slotItem.level || 0));
                    const levelData = fullItem.levels[String(petLevel)];
                    itemStats = levelData?.stats || {};

                    // If "use ability" is checked, aggregate ability stats as a SEPARATE contributor
                    // so it shows as its own line (e.g., "The Hunt Is On +6% WE") instead of merged
                    if (slotItem.useAbility && levelData?.abilities) {
                        const abilityWithStats = levelData.abilities.find(a => a.ability_stats && Object.keys(a.ability_stats).length > 0);
                        if (abilityWithStats) {
                            // Build a separate item data object for the ability contributor
                            const petOverrides2 = (store.state.ui?.user_overrides?.items || {})[fullItem.id] || {};
                            const petBase2 = store.state.items[fullItem.id] || {};
                            const petVariant2 = petOverrides2.variant !== undefined ? petOverrides2.variant : (petBase2.variant || 'normal');
                            const abilityItemData = {
                                ...fullItem,
                                name: abilityWithStats.name,
                                icon_path: abilityWithStats.icon
                                    ? `/assets/icons/abilities/${abilityWithStats.icon}.svg`
                                    : getPetIconPath(fullItem.name, petLevel, petVariant2, fullItem.max_level || 0),
                                rarity: itemRarity,
                                _isAbility: true,
                            };
                            this.aggregateStatsWithContributors(stats, abilityWithStats.ability_stats, slot, abilityItemData);
                            console.log(`  Pet ${fullItem.name} ability "${abilityWithStats.name}" aggregated separately`);
                        }
                    }

                    console.log(`  Pet ${fullItem.name} level ${petLevel}, stats:`, itemStats);
                }

                // For crafted items, use quality-specific stats and rarity
                if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
                    let quality = slotItem.quality || 'Normal';
                    // If quality is a rarity name, convert to quality name
                    const rarityToQuality = {
                        'common': 'Normal',
                        'uncommon': 'Good',
                        'rare': 'Great',
                        'epic': 'Excellent',
                        'legendary': 'Perfect',
                        'ethereal': 'Eternal'
                    };
                    if (rarityToQuality[quality.toLowerCase()]) {
                        quality = rarityToQuality[quality.toLowerCase()];
                    }
                    itemStats = fullItem.stats_by_quality[quality] || {};
                    console.log(`  Crafted item quality: ${quality}, stats keys:`, Object.keys(itemStats));
                    // Map quality to rarity for crafted items
                    const qualityToRarity = {
                        'Normal': 'common',
                        'Good': 'uncommon',
                        'Great': 'rare',
                        'Excellent': 'epic',
                        'Perfect': 'legendary',
                        'Eternal': 'ethereal'
                    };
                    itemRarity = qualityToRarity[quality] || 'common';
                }

                // Ensure itemStats is an object
                if (!itemStats || typeof itemStats !== 'object') {
                    console.warn(`Item ${fullItem.name} has invalid stats:`, itemStats);
                    itemStats = {};
                }

                // Create item data with correct rarity
                const itemData = {
                    ...fullItem,
                    name: isFineConsumable ? fullItem.name + ' (Fine)' : fullItem.name,
                    rarity: itemRarity
                };

                // For pets, override icon_path with level+variant-aware icon, and use custom name if set
                if (fullItem.type === 'pet') {
                    const petOverrides = (store.state.ui?.user_overrides?.items || {})[fullItem.id] || {};
                    const petBase = store.state.items[fullItem.id] || {};
                    const petLevel = petOverrides.level !== undefined ? petOverrides.level : (petBase.level !== undefined ? petBase.level : (slotItem.level || 0));
                    const petVariant = petOverrides.variant !== undefined ? petOverrides.variant : (petBase.variant || 'normal');
                    const petCustomName = petOverrides.petName !== undefined ? petOverrides.petName : (petBase.petName || '');
                    itemData.icon_path = getPetIconPath(fullItem.name, petLevel, petVariant, fullItem.max_level || 0);
                    if (petCustomName) {
                        itemData.name = `${petCustomName} (${fullItem.name})`;
                    }
                }

                // Aggregate stats and track contributors
                for (const [skill, locationStats] of Object.entries(itemStats)) {
                    if (!locationStats || typeof locationStats !== 'object') {
                        console.warn(`Item ${fullItem.name} has invalid locationStats for skill ${skill}:`, locationStats);
                        continue;
                    }
                    for (const [location, statsByLocation] of Object.entries(locationStats)) {
                        if (!statsByLocation || typeof statsByLocation !== 'object') {
                            console.warn(`Item ${fullItem.name} has invalid statsByLocation for ${skill}/${location}:`, statsByLocation);
                            continue;
                        }
                        console.log(`  Stats in ${skill}/${location}:`, Object.keys(statsByLocation));
                    }
                }

                this.aggregateStatsWithContributors(stats, itemStats, slot, itemData);

                // Handle set bonuses (gated_stats)
                if (fullItem.gated_stats && fullItem.gated_stats.set_pieces) {
                    console.log(`  Item has set bonuses:`, Object.keys(fullItem.gated_stats.set_pieces));

                    // For each set bonus tier
                    for (const [setName, counts] of Object.entries(fullItem.gated_stats.set_pieces)) {
                        for (const [count, setStats] of Object.entries(counts)) {
                            const requiredCount = parseInt(count, 10);

                            // Count how many items from this set are equipped
                            let setCount = 0;
                            for (const [checkSlot, checkItem] of Object.entries(currentGear)) {
                                if (checkItem && checkItem.keywords) {
                                    const hasSet = checkItem.keywords.some(kw =>
                                        kw.toLowerCase().includes(setName.toLowerCase())
                                    );
                                    if (hasSet) setCount++;
                                }
                            }

                            console.log(`  Set ${setName} requires ${requiredCount}, have ${setCount}`);

                            // Check if set bonus is met
                            const setMet = setCount >= requiredCount;

                            if (setMet) {
                                console.log(`  ✓ Including set bonus stats`);
                            } else {
                                console.log(`  ✗ Set bonus not met, showing as unapplied`);
                            }

                            // Add stats with applied flag based on whether requirement is met
                            this.aggregateStatsWithContributors(
                                stats,
                                setStats,
                                `${slot} (${count} ${setName})`,
                                fullItem,
                                setMet  // Pass whether requirement is met
                            );
                        }
                    }
                }

                // Handle achievement point gated stats
                if (fullItem.gated_stats && fullItem.gated_stats.achievement_points) {
                    console.log(`  Item has AP-gated stats`);
                    // Get character's current AP (check overrides first, then character)
                    const overrideAP = store.state.ui?.user_overrides?.achievement_points;
                    const characterAP = overrideAP !== undefined ? overrideAP : (character.achievement_points || 0);

                    for (const [threshold, apStats] of Object.entries(fullItem.gated_stats.achievement_points)) {
                        const apThreshold = parseInt(threshold, 10);

                        // Check if character meets the AP requirement
                        const apMet = characterAP >= apThreshold;

                        if (apMet) {
                            console.log(`  ✓ Including ${threshold} AP stats (have ${characterAP})`);
                        } else {
                            console.log(`  ✗ AP requirement not met: ${threshold} AP (have ${characterAP})`);
                        }

                        console.log(`  AP stats for ${threshold}:`, apStats);

                        // Add stats with applied flag based on whether requirement is met
                        this.aggregateStatsWithContributors(
                            stats,
                            apStats,
                            `${slot} (${threshold} AP)`,
                            itemData,
                            apMet  // Pass whether requirement is met
                        );
                    }
                }

                // Handle skill level gated stats
                if (fullItem.gated_stats && fullItem.gated_stats.skill_level) {
                    console.log(`  Item has skill level gated stats`);

                    for (const [gateSkill, thresholds] of Object.entries(fullItem.gated_stats.skill_level)) {
                        // 2026-06-16 (jwbail): honor the column-1 skill-level
                        // override (store.state.ui.user_overrides.skills) before
                        // falling back to the imported level — matching the
                        // total_skill_level / activity_completion gates below.
                        // Without this, a level-gated item stat (e.g. the
                        // screwdriver's +4% DR at Crafting 50) never activated
                        // when the user bumped the level in column 1, so col-3's
                        // steps/item ignored it.
                        const _gs = gateSkill.toLowerCase();
                        const _ovSkills = store.state.ui?.user_overrides?.skills || {};
                        const charLevel = (_ovSkills[_gs] !== undefined)
                            ? _ovSkills[_gs]
                            : (character.skills?.[_gs] || 0);

                        for (const [threshold, skillStats] of Object.entries(thresholds)) {
                            const requiredLevel = parseInt(threshold, 10);
                            const levelMet = charLevel >= requiredLevel;

                            if (levelMet) {
                                console.log(`  ✓ Skill level requirement met: ${gateSkill} ${threshold} (have ${charLevel})`);
                            } else {
                                console.log(`  ✗ Skill requirement not met: ${gateSkill} ${threshold} (have ${charLevel})`);
                            }

                            console.log(`  Skill level stats for ${gateSkill} ${threshold}:`, skillStats);

                            // If requirement is met, add stats and let normal skill/location matching determine if applied
                            // The stats themselves have skill/location context (e.g., "crafting" / "global")
                            // Don't use forceApplied - let the normal matching logic work
                            if (levelMet) {
                                this.aggregateStatsWithContributors(
                                    stats,
                                    skillStats,
                                    `${slot} (${gateSkill} ${threshold})`,
                                    itemData
                                    // No forceApplied parameter - let skill/location matching determine if applied
                                );
                            }
                        }
                    }
                }

                // Handle activity completion gated stats
                if (fullItem.gated_stats && fullItem.gated_stats.activity_completion) {
                    console.log(`  Item has activity completion gated stats`);

                    for (const [activityName, thresholds] of Object.entries(fullItem.gated_stats.activity_completion)) {
                        for (const [threshold, activityStats] of Object.entries(thresholds)) {
                            const requiredCount = parseInt(threshold, 10);

                            // Check custom stats for activity completion
                            // Custom stat format: screwdriver_{activity_name}
                            const customStatKey = `screwdriver_${activityName.toLowerCase().replace(/ /g, '_')}`;
                            const customStats = store.state.ui?.custom_stats || {};
                            const overrides = store.state.ui?.user_overrides || {};
                            const allCustomStats = { ...customStats, ...(overrides.custom_stats || {}) };

                            const countMet = allCustomStats[customStatKey] === true;

                            if (countMet) {
                                console.log(`  ✓ Activity completion requirement met: ${activityName} ${threshold} (unlocked)`);
                            } else {
                                console.log(`  ✗ Activity requirement not met: ${activityName} ${threshold} (locked)`);
                            }

                            console.log(`  Activity completion stats for ${activityName} ${threshold}:`, activityStats);

                            // If requirement is met, add stats and let normal skill/location matching determine if applied
                            // The stats themselves have skill/location context (e.g., "crafting" / "global")
                            // Don't use forceApplied - let the normal matching logic work
                            if (countMet) {
                                this.aggregateStatsWithContributors(
                                    stats,
                                    activityStats,
                                    `${slot} (${threshold}+ ${activityName})`,
                                    itemData
                                    // No forceApplied parameter - let skill/location matching determine if applied
                                );
                            }
                        }
                    }
                }

                // Handle total skill level gated stats
                if (fullItem.gated_stats && fullItem.gated_stats.total_skill_level) {
                    console.log(`  Item has total skill level gated stats`);

                    // Calculate total skill level
                    const overrides = store.state.ui?.user_overrides || {};
                    let totalLevel = 0;
                    if (overrides.skills && Object.keys(overrides.skills).length > 0) {
                        const baseSkills = character.skills || {};
                        const allSkills = new Set([...Object.keys(baseSkills), ...Object.keys(overrides.skills)]);
                        for (const skill of allSkills) {
                            totalLevel += (overrides.skills[skill] !== undefined ? overrides.skills[skill] : (baseSkills[skill] || 0));
                        }
                    } else {
                        totalLevel = character.total_skill_level || Object.values(character.skills || {}).reduce((a, b) => a + b, 0);
                    }

                    for (const [threshold, tslStats] of Object.entries(fullItem.gated_stats.total_skill_level)) {
                        const requiredLevel = parseInt(threshold, 10);
                        const levelMet = totalLevel >= requiredLevel;

                        if (levelMet) {
                            console.log(`  ✓ Total skill level requirement met: ${threshold} (have ${totalLevel})`);
                        } else {
                            console.log(`  ✗ Total skill level requirement not met: ${threshold} (have ${totalLevel})`);
                        }

                        // Add stats with applied flag based on whether requirement is met
                        this.aggregateStatsWithContributors(
                            stats,
                            tslStats,
                            `${slot} (${threshold} TSL)`,
                            itemData,
                            levelMet  // Pass whether requirement is met
                        );
                    }
                }

                // Handle obtained-collectibles gated stats (Collection ring:
                // cumulative tiers at 10/20/30/40/50/60 collectibles owned).
                if (fullItem.gated_stats && fullItem.gated_stats.total_collectibles) {
                    const overrideTC = store.state.ui?.user_overrides?.total_collectibles;
                    // character.collectibles is the ARRAY of owned collectible IDs; count via length.
                    const _coll = character.collectibles;
                    const collectiblesOwned = overrideTC !== undefined
                        ? overrideTC
                        : (Array.isArray(_coll) ? _coll.length : (_coll || 0));
                    for (const [threshold, tcStats] of Object.entries(fullItem.gated_stats.total_collectibles)) {
                        const tcMet = collectiblesOwned >= parseInt(threshold, 10);
                        this.aggregateStatsWithContributors(
                            stats,
                            tcStats,
                            `${slot} (${threshold} Collectibles)`,
                            itemData,
                            tcMet
                        );
                    }
                }

                // Handle travel steps gated stats
                if (fullItem.gated_stats && fullItem.gated_stats.travel_steps) {
                    console.log(`  Item has travel steps gated stats`);
                    const customStats = store.state.ui?.custom_stats || {};
                    const itemNameNormalized = fullItem.name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');

                    for (const [threshold, travelStats] of Object.entries(fullItem.gated_stats.travel_steps)) {
                        const customStatId = `${itemNameNormalized}_travel_steps_${threshold}`;
                        const requirementMet = customStats[customStatId] || false;

                        if (requirementMet) {
                            console.log(`  ✓ Travel steps requirement met: ${threshold}`);
                        } else {
                            console.log(`  ✗ Travel steps requirement not met: ${threshold}`);
                        }

                        this.aggregateStatsWithContributors(
                            stats,
                            travelStats,
                            `${slot} (${parseInt(threshold).toLocaleString()} travel steps)`,
                            itemData,
                            requirementMet
                        );
                    }
                }

                // Handle activity-gated stats (stats that only apply while
                // doing a specific activity, e.g. Zippy kicksled's -5 steps
                // on Sledding). 2026-06-18 (jwbail): previously not handled
                // here at all, so these bonuses never showed in Combined
                // Stats. They must apply ONLY when the current activity is
                // the gated one — never globally. Gate keys are the activity
                // name lowercased (with spaces); normalize to the id form
                // (`/api/activities` id = name.lower() with spaces→'_') to
                // compare against this.currentActivity.
                if (fullItem.gated_stats && fullItem.gated_stats.activity) {
                    for (const [activityName, activityStats] of Object.entries(fullItem.gated_stats.activity)) {
                        const gateId = activityName.toLowerCase()
                            .replace(/ /g, '_')
                            .replace(/\(/g, '')
                            .replace(/\)/g, '')
                            .replace(/-/g, '_')
                            .replace(/'/g, '');
                        const curAct = this.currentActivity;
                        const activityMatches = !!curAct &&
                            (curAct === gateId || curAct === `generic::${gateId}`);

                        if (activityMatches) {
                            console.log(`  ✓ Activity-gated stats apply (current activity: ${activityName})`);
                        } else {
                            console.log(`  ✗ Activity-gated stats inactive (only during ${activityName})`);
                        }

                        // forceApplied = activityMatches: applied (and added to
                        // totals) only while that activity is selected; otherwise
                        // shown as an unapplied/dimmed contributor so the user can
                        // see the conditional bonus exists.
                        this.aggregateStatsWithContributors(
                            stats,
                            activityStats,
                            `${slot} (during ${activityName})`,
                            itemData,
                            activityMatches
                        );
                    }
                }
            }

            // Add collectible stats
            console.log('Processing collectibles from state.items');
            console.log('Available collectibles in catalog:', collectibles.map(c => c.id));
            console.log('State items:', Object.keys(store.state.items || {}));

            // Get collectibles from state.items (items with has: true and type: collectible)
            const characterCollectibles = [];
            for (const [itemId, itemState] of Object.entries(store.state.items || {})) {
                console.log(`Checking item ${itemId}:`, itemState);
                if (itemState.has && !itemState.hide) {
                    // Check if this is a collectible by looking it up in catalog
                    const collectible = collectibles.find(c => c.id === itemId);
                    if (collectible) {
                        console.log(`  ✓ Found collectible: ${collectible.name}`);
                        characterCollectibles.push(itemId);
                    } else {
                        console.log(`  ✗ Not a collectible (not in catalog)`);
                    }
                }
            }

            console.log('Found collectibles:', characterCollectibles.length, characterCollectibles);

            for (const collectibleId of characterCollectibles) {
                // Find collectible in catalog
                const collectible = collectibles.find(c => c.id === collectibleId);

                if (!collectible) {
                    console.warn(`Collectible not found in catalog: ${collectibleId}`);
                    continue;
                }

                console.log(`Processing collectible: ${collectible.name}`, collectible.stats);

                // Get collectible stats
                const collectibleStats = collectible.stats || {};

                // Aggregate stats and track contributors
                this.aggregateStatsWithContributors(stats, collectibleStats, 'Collectible', collectible);
            }

            // Also aggregate generic collectibles (custom user-created collectibles)
            const genericItems = store.state.genericItems || [];
            for (const gi of genericItems) {
                if (gi.slot !== 'collectible') continue;
                const stateId = `generic::item::${gi.id}`;
                const overrides = store.state.ui?.user_overrides?.items?.[stateId] || {};
                const baseState = store.state.items?.[stateId] || {};
                const has = overrides.has !== undefined ? overrides.has : baseState.has;
                const hide = overrides.hide !== undefined ? overrides.hide : baseState.hide;
                if (!has || hide) continue;
                const giStats = gi.stats || {};
                const giItem = {
                    id: stateId,
                    name: gi.name,
                    icon: gi.icon || '⚡',
                    icon_color: gi.icon_color,
                    icon_path: gi.icon_path || null,
                    is_generic: true,
                };
                this.aggregateStatsWithContributors(stats, giStats, 'Collectible', giItem);
            }

            // Add input item stats (for activities with input items)
            if (this._inputItems) {
                for (const [idx, inputItem] of Object.entries(this._inputItems)) {
                    if (!inputItem || !inputItem.stats) continue;
                    const inputStats = typeof inputItem.stats === 'string' ? JSON.parse(inputItem.stats) : inputItem.stats;
                    if (!inputStats || typeof inputStats !== 'object') continue;
                    const inputItemData = {
                        name: inputItem.name || 'Input Item',
                        icon_path: inputItem.icon_path || null,
                        rarity: inputItem.rarity || 'common',
                        icon: inputItem.icon || '📥',
                        icon_color: inputItem.icon_color,
                        is_generic: !!inputItem.is_generic,
                    };
                    this.aggregateStatsWithContributors(stats, inputStats, 'Input', inputItemData);
                }
            }

            // Add global fine input bonus when "Fine Inputs" is checked AND there are input items
            if (this._useFineInputs && Object.keys(this._inputItems || {}).length > 0) {
                const fineBonus = {
                    global: {
                        global: {
                            work_efficiency: 40.0,
                            double_rewards: 10.0,
                            bonus_xp_percent: 100.0,
                            fine_material_finding: 200.0,
                        }
                    }
                };
                this.aggregateStatsWithContributors(stats, fineBonus, 'Input', {
                    name: 'Fine Input Bonus',
                    icon_path: '/assets/icons/attributes/fine_material_finding.svg',
                });
            }

            console.log('Combined stats:', stats);

            // Add service stats (for recipes)
            // Requirements: Service bonuses integration
            console.log('=== SERVICE STATS CHECK ===');
            console.log('currentService:', this.currentService);
            console.log('currentRecipe:', this.currentRecipe);
            console.log('currentActivity:', this.currentActivity);

            if (this.currentService && this.currentService !== '__none__' && this.currentRecipe) {
                console.log('✓ Processing service stats for service:', this.currentService, 'recipe:', this.currentRecipe);

                try {
                    // Handle generic service IDs
                    if (this.currentService.startsWith('generic::')) {
                        try {
                            const defId = this.currentService.replace('generic::', '');
                            const svcData = await api.getGenericDefinitionView(defId);
                            if (svcData && svcData.stats) {
                                const serviceItem = {
                                    name: `🔧 ${svcData.name || 'Generic Service'}`,
                                    icon_path: null,
                                    rarity: 'common'
                                };
                                // Parse stats — generic services store flat stats like {work_efficiency: 5.0}
                                let flatStats = svcData.stats;
                                if (typeof flatStats === 'string') flatStats = JSON.parse(flatStats);
                                this.aggregateStatsWithContributors(stats, flatStats, 'Service', serviceItem, true);
                                console.log('✓ Generic service stats aggregated:', flatStats);
                            }
                        } catch (e) {
                            console.error('Failed to load generic service stats:', e);
                        }
                    } else {
                        // Fetch wiki service details
                        let serviceResponse;
                        if (this.currentRecipe.startsWith('generic::')) {
                            const allSvcs = await $.get('/api/services');
                            serviceResponse = { services: allSvcs.services || [] };
                        } else {
                            serviceResponse = await $.get(`/api/services/for-recipe/${this.currentRecipe}`);
                        }
                        console.log('Service API response:', serviceResponse);

                        let service = null;
                        let locationData = null;

                        service = serviceResponse.services.find(s => s.id === this.currentService);

                        if (!service) {
                            console.log('Service not found by ID, searching through locations...');
                            console.log('Looking for service_id:', this.currentService);

                            for (const svc of serviceResponse.services) {
                                console.log('Checking service:', svc.name, 'id:', svc.id);
                                console.log('  Has locations?', !!svc.locations);

                                if (svc.locations) {
                                    console.log('  Locations:', svc.locations.map(l => ({
                                        service_id: l.service_id,
                                        location: l.location?.name
                                    })));

                                    const matchingLocation = svc.locations.find(loc => loc.service_id === this.currentService);
                                    if (matchingLocation) {
                                        service = svc;
                                        locationData = matchingLocation;
                                        console.log('✓ Found service via location match:', svc.name, 'at', matchingLocation.location.name);
                                        break;
                                    }
                                }
                            }
                        }

                        if (service) {
                            console.log(`✓ Found service: ${service.name}`, service);
                            console.log('locationData:', locationData);

                            const serviceStats = locationData ? (locationData.stats || {}) : (service.stats || {});
                            const gatedStats = locationData ? (locationData.gated_stats || {}) : (service.gated_stats || {});
                            const isUnlocked = locationData ? locationData.is_unlocked : service.is_unlocked;

                            console.log('locationData.stats:', locationData?.stats);
                            console.log('service.stats:', service.stats);
                            console.log('Selected serviceStats:', serviceStats);
                            console.log('Service gated_stats:', gatedStats);
                            console.log('Service is_unlocked:', isUnlocked);
                            console.log('About to aggregate service stats. Stats object:', JSON.stringify(serviceStats, null, 2));

                            let iconName = service.name.replace(/ /g, '_').toLowerCase();
                            if (!service.name.toLowerCase().startsWith('basic') && service.is_basic) {
                                iconName += '_(basic)';
                            } else if (service.is_advanced) {
                                iconName += '_(advanced)';
                            }
                            const serviceIconPath = `/assets/icons/services/${iconName}.svg`;

                            const serviceItem = {
                                name: service.name + (locationData ? ` (${locationData.location.name})` : ''),
                                icon_path: serviceIconPath,
                                rarity: 'common'
                            };

                            this.aggregateStatsWithContributors(
                                stats,
                                serviceStats,
                                'Service',
                                serviceItem,
                                isUnlocked
                            );

                            // Apply reputation-gated bonuses
                            const repGates = gatedStats.reputation || {};
                            const reputation = store.state.character?.reputation || {};
                            for (const [faction, thresholds] of Object.entries(repGates)) {
                                const charRep = reputation[faction] || 0;
                                // Sort threshold keys numerically and apply all that are met
                                // Keys are strings in JSON (e.g. "5", "10"), convert to numbers for comparison
                                const sortedKeys = Object.keys(thresholds).sort((a, b) => Number(a) - Number(b));
                                for (const key of sortedKeys) {
                                    if (charRep >= Number(key)) {
                                        const thresholdStats = thresholds[key];
                                        console.log(`✓ Applying rep gate: ${faction} >= ${key} (have ${charRep}):`, thresholdStats);
                                        this.aggregateStatsWithContributors(
                                            stats,
                                            thresholdStats,
                                            'Service',
                                            serviceItem,
                                            isUnlocked
                                        );
                                    }
                                }
                            }

                            console.log('✓ Service stats aggregated (incl. rep gates):', serviceStats);
                        } else {
                            console.warn(`✗ Service not found in response: ${this.currentService}`);
                            console.warn('Available services:', serviceResponse.services.map(s => s.id));
                        }
                    }
                } catch (error) {
                    console.error('✗ Failed to fetch service stats:', error);
                }
            } else {
                console.log('✗ Skipping service stats - missing currentService or currentRecipe');
            }

            console.log('Combined stats after service:', stats);
            console.log('=== END SERVICE STATS CHECK ===');

        } catch (error) {
            console.error('Failed to calculate stats:', error);
        }

        // Bail out if a newer calculateStats has started while we were awaiting (post-try guard)
        if (myCalcId !== this._currentCalcId) {
            console.log('[RENDER-DEBUG] calculateStats STALE after try block, bailing out');
            return stats;
        }

        // Add level bonuses for WE and QO
        // Requirements: 7.6
        if (this.currentActivity || this.currentRecipe) {
            const levelBonuses = await this.calculateLevelBonuses();

            // Bail out if a newer calculateStats has started while we were awaiting level bonuses
            if (myCalcId !== this._currentCalcId) {
                console.log('[RENDER-DEBUG] calculateStats STALE after calculateLevelBonuses, bailing out');
                return stats;
            }

            // Add WE level bonus
            if (levelBonuses.work_efficiency > 0) {
                if (!stats.work_efficiency) {
                    stats.work_efficiency = 0;
                }
                stats.work_efficiency += levelBonuses.work_efficiency;

                // Track level bonus as a contributor
                if (!this.contributorsByStat.work_efficiency) {
                    this.contributorsByStat.work_efficiency = [];
                }
                const levelBonusLabel = this.isTravel
                    ? 'From agility level (0.5% per level)'
                    : 'From levels above requirement';
                this.contributorsByStat.work_efficiency.push({
                    source: 'Level Bonus',
                    item: {
                        name: levelBonusLabel,
                        icon_path: '/assets/icons/attributes/work_efficiency.svg',
                        rarity: 'common'
                    },
                    value: levelBonuses.work_efficiency,
                    applied: true,
                    skill: 'global',
                    location: 'global'
                });
            }

            // Add QO level bonus (only for recipes)
            if (levelBonuses.quality_outcome > 0) {
                console.log(`Adding QO level bonus: ${levelBonuses.quality_outcome}`);

                if (!stats.quality_outcome) {
                    stats.quality_outcome = 0;
                }
                stats.quality_outcome += levelBonuses.quality_outcome;

                console.log(`Total QO in stats: ${stats.quality_outcome}`);

                // Track level bonus as a contributor
                if (!this.contributorsByStat.quality_outcome) {
                    this.contributorsByStat.quality_outcome = [];
                }
                this.contributorsByStat.quality_outcome.push({
                    source: 'Level Bonus',
                    item: {
                        name: 'From levels above requirement',
                        icon_path: '/assets/icons/attributes/quality_outcome.svg',
                        rarity: 'common'
                    },
                    value: levelBonuses.quality_outcome,
                    applied: true,
                    skill: 'global',
                    location: 'global'
                });

                console.log(`QO contributors:`, this.contributorsByStat.quality_outcome);
            }
        }

        // Cache stats for Column 3 integration
        // Requirements: 7.1, 7.2, 7.3, 7.4
        this.cachedStats = stats;

        console.log('Cached stats for Column 3:', this.cachedStats);
        console.log('Cached WE:', this.cachedStats.work_efficiency);
        console.log('=== calculateStats() END ===');
        console.log('contributorsByStat at end:', Object.keys(this.contributorsByStat).length, 'stats');
        if (this.contributorsByStat.bonus_xp_add) {
            console.log('bonus_xp_add contributors:', this.contributorsByStat.bonus_xp_add.length);
        }

        // Note: Callbacks are now fired from loadContent() after render completes
        // This prevents cancelled renders from triggering Column 3 updates

        return stats;
    }

    /**
     * Calculate level bonuses for WE and QO
     * Requirements: 7.6
     * 
     * @returns {Object} Level bonuses {work_efficiency, quality_outcome}
     */
    async calculateLevelBonuses() {
        console.log('calculateLevelBonuses() called');

        const bonuses = {
            work_efficiency: 0,
            quality_outcome: 0
        };

        const character = store.state.character || {};
        const overrides = store.state.ui?.user_overrides || {};

        console.log('Character skills:', character.skills);
        console.log('Override skills:', overrides.skills);

        // Use this.currentActivity/currentRecipe set by Column 3
        // NOT store.state.column3 (that's Column 3's internal state)
        const selectedActivity = this.currentActivity;
        const selectedRecipe = this.currentRecipe;
        const isRecipe = this.currentRecipeSkill !== null;

        console.log('Selected activity:', selectedActivity, 'Selected recipe:', selectedRecipe, 'isRecipe:', isRecipe);

        try {
            if (selectedActivity && !isRecipe) {
                // It's an activity
                let activity = null;

                if (selectedActivity.startsWith('generic::')) {
                    // Generic activity — fetch from view endpoint
                    try {
                        const defId = selectedActivity.replace('generic::', '');
                        activity = await $.get(`/api/generic-definition-view/${defId}`);
                    } catch (e) {
                        console.error('Failed to load generic activity for level bonus:', e);
                    }
                } else {
                    const response = await $.get('/api/activities');
                    for (const activities of Object.values(response.by_skill)) {
                        activity = activities.find(a => a.id === selectedActivity);
                        if (activity) break;
                    }
                }

                if (activity) {
                    const primarySkill = activity.primary_skill.toLowerCase();

                    // Get skill level - check override first, then character
                    const overrideLevel = overrides.skills?.[primarySkill];
                    const characterLevel = character.skills?.[primarySkill];
                    const charLevel = overrideLevel !== undefined ? overrideLevel : (characterLevel || 0);

                    if (activity.is_travel) {
                        // Travel: 0.5% per agility level (no cap)
                        // Formula matches Python: (skill_level - 1) * 0.005 → displayed as percentage
                        bonuses.work_efficiency = (charLevel - 1) * 0.5;

                        console.log(`Level bonus calculation for ${activity.name} (TRAVEL):`, {
                            primarySkill,
                            charLevel,
                            bonus: bonuses.work_efficiency,
                            formula: '(level - 1) * 0.5%'
                        });
                    } else {
                        // Regular activities: 1.25% per level above requirement, capped at 25% (20 levels)
                        const requirements = activity.requirements?.skill_requirements || {};
                        const requiredLevel = requirements[activity.primary_skill] || 1;

                        const levelsAbove = Math.max(0, charLevel - requiredLevel);
                        bonuses.work_efficiency = Math.min(levelsAbove * 1.25, 25);

                        console.log(`Level bonus calculation for ${activity.name}:`, {
                            primarySkill,
                            charLevel,
                            requiredLevel,
                            levelsAbove,
                            bonus: bonuses.work_efficiency
                        });
                    }
                }
            } else if (selectedRecipe && isRecipe) {
                // It's a recipe
                let recipe = null;

                if (selectedRecipe.startsWith('generic::')) {
                    // Generic recipe — fetch from view endpoint
                    try {
                        const defId = selectedRecipe.replace('generic::', '');
                        recipe = await $.get(`/api/generic-definition-view/${defId}`);
                    } catch (e) {
                        console.error('Failed to load generic recipe for level bonus:', e);
                    }
                } else {
                    const response = await $.get('/api/recipes');
                    for (const recipes of Object.values(response.by_skill)) {
                        recipe = recipes.find(r => r.id === selectedRecipe);
                        if (recipe) break;
                    }
                }

                if (recipe) {
                    const skill = recipe.skill.toLowerCase();

                    // Get skill level - check override first, then character
                    const overrideLevel = overrides.skills?.[skill];
                    const characterLevel = character.skills?.[skill];
                    const charLevel = overrideLevel !== undefined ? overrideLevel : (characterLevel || 1);

                    const requiredLevel = recipe.level || 1;

                    console.log(`Recipe ${recipe.name} level check:`, {
                        skill,
                        overrideLevel,
                        characterLevel,
                        charLevel,
                        requiredLevel
                    });

                    const levelsAbove = Math.max(0, charLevel - requiredLevel);
                    // WE bonus: 1.25% per level, capped at 25% (20 levels)
                    bonuses.work_efficiency = Math.min(levelsAbove * 1.25, 25);

                    // QO bonus: 1 per level, no cap
                    bonuses.quality_outcome = levelsAbove;

                    console.log(`Level bonus calculation for ${recipe.name}:`, {
                        skill,
                        charLevel,
                        requiredLevel,
                        levelsAbove,
                        weBonus: bonuses.work_efficiency,
                        qoBonus: bonuses.quality_outcome
                    });
                }
            }
        } catch (error) {
            console.error('Failed to calculate level bonuses:', error);
        }

        console.log('Final level bonuses:', bonuses);
        return bonuses;
    }

    /**
     * Aggregate stats from an item into the total
     * @param {Object} totalStats - Total stats object to update
     * @param {Object} itemStats - Item stats to add {skill: {location: {stat: value}}}
     */
    aggregateStats(totalStats, itemStats) {
        // Flatten nested stats structure and sum values
        for (const [skill, locationStats] of Object.entries(itemStats)) {
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                for (const [statName, statValue] of Object.entries(statsByLocation)) {
                    // Initialize stat if not present
                    if (!totalStats[statName]) {
                        totalStats[statName] = 0;
                    }

                    // Add value
                    totalStats[statName] += statValue;
                }
            }
        }
    }

    /**
     * Get stats that are currently applied based on context
     * Requirements: 6.4, 6.12, 7.5
     * 
     * @param {Object} allStats - All stats from calculateStats()
     * @returns {Object} Applied stats only
     */
    getAppliedStats(allStats) {
        // TODO: Filter stats based on currentActivity and currentLocation
        // Requirements: 6.4, 6.12, 7.5
        // 
        // Implementation notes:
        // - When an activity is selected, only show stats that apply to that activity
        // - When a location is selected, only show stats that apply to that location
        // - Stats with skill='global' and location='global' always apply
        // - Stats with skill matching the activity's primary skill apply
        // - Stats with location matching the selected location apply
        // 
        // For now, return all stats as applied
        return { ...allStats };
    }

    /**
     * Get stats that are not currently applied based on context
     * Requirements: 6.4, 6.12
     * 
     * @param {Object} allStats - All stats from calculateStats()
     * @param {Object} appliedStats - Applied stats from getAppliedStats()
     * @returns {Object} Unapplied stats only
     */
    getUnappliedStats(allStats, appliedStats) {
        // TODO: Return stats that exist in allStats but not in appliedStats
        // Requirements: 6.4, 6.12
        const unapplied = {};

        for (const [statName, totalValue] of Object.entries(allStats)) {
            const appliedValue = appliedStats[statName] || 0;
            const unappliedValue = totalValue - appliedValue;

            if (Math.abs(unappliedValue) > 0.001) {
                unapplied[statName] = unappliedValue;
            }
        }

        return unapplied;
    }

    /**
     * Get items contributing to a specific stat
     * Requirements: 6.5
     * 
     * @param {string} statName - Stat name to get contributors for
     * @returns {Array} Array of {source, item, value, applied}
     */
    async getContributingItems(statName) {
        const contributors = [];
        const currentGear = store.getActiveGearset() || {};

        try {
            const catalog = await api.getCatalog();
            const catalogItems = catalog.items || [];

            // Check each equipped item
            for (const [slot, slotItem] of Object.entries(currentGear)) {
                if (!slotItem || !slotItem.itemId) continue;

                // Find full item data
                let fullItem = catalogItems.find(item => item.id === slotItem.itemId);
                // Fallback: match by UUID for gearsets that store UUID as itemId
                if (!fullItem && slotItem.itemId) {
                    fullItem = catalogItems.find(item => item.uuid === slotItem.itemId);
                }
                if (!fullItem) continue;

                // Get item stats
                let itemStats = fullItem.stats || {};
                if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
                    const quality = slotItem.quality || 'Normal';
                    itemStats = fullItem.stats_by_quality[quality] || {};
                }

                // Check if this item has the stat
                let hasStatValue = 0;
                for (const [skill, locationStats] of Object.entries(itemStats)) {
                    for (const [location, statsByLocation] of Object.entries(locationStats)) {
                        if (statsByLocation[statName] !== undefined) {
                            hasStatValue += statsByLocation[statName];
                        }
                    }
                }

                if (Math.abs(hasStatValue) > 0.001) {
                    contributors.push({
                        source: slot,
                        item: {
                            name: fullItem.name,
                            icon_path: fullItem.icon_path
                        },
                        value: hasStatValue,
                        applied: true  // TODO: Check if applied based on context
                    });
                }
            }

        } catch (error) {
            console.error('Failed to get contributing items:', error);
        }

        return contributors;
    }

    /**
     * Sort stats alphabetically with special stats at the end
     * Requirements: 6.2
     * 
     * @param {Object} stats - Stats object to sort
     * @returns {Array} Array of [statName, value] sorted
     */
    sortStats(stats) {
        const entries = Object.entries(stats);

        // Special stats that should appear at the end (only "chance to find X" type stats)
        const specialStats = [
            'chance_to_find'
        ];

        // Separate regular and special stats
        const regular = entries.filter(([name]) =>
            !specialStats.some(special => name.includes(special))
        );
        const special = entries.filter(([name]) =>
            specialStats.some(special => name.includes(special))
        );

        // Sort each group alphabetically
        regular.sort((a, b) => a[0].localeCompare(b[0]));
        special.sort((a, b) => a[0].localeCompare(b[0]));

        // Combine: regular first, then special
        return [...regular, ...special];
    }

    /**
     * Format stat name for display
     * @param {string} statName - Stat name (snake_case)
     * @returns {string} Formatted name
     */
    formatStatName(statName) {
        // Handle ItemFindingCategory stats
        if (statName.startsWith('ItemFindingCategory.')) {
            const categoryConst = statName.split('.')[1];

            // Try to get category info from cache
            if (window.itemFindingCategories && window.itemFindingCategories[categoryConst]) {
                const category = window.itemFindingCategories[categoryConst];
                const qtyText = category.min_qty === category.max_qty
                    ? category.min_qty
                    : `${category.min_qty} to ${category.max_qty}`;
                return `Chance to find ${qtyText} ${category.display_name_singular}`;
            }

            // Fallback: format from constant name
            const categoryName = categoryConst
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            return `Chance to find ${categoryName.toLowerCase()}`;
        }

        return statName
            .split('_')
            .map(word => {
                if (word.toLowerCase() === 'xp') return 'XP';
                if (word.toLowerCase() === 'we') return 'WE';
                if (word.toLowerCase() === 'da') return 'DA';
                if (word.toLowerCase() === 'dr') return 'DR';
                if (word.toLowerCase() === 'nmc') return 'NMC';
                if (word.toLowerCase() === 'qo') return 'QO';
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(' ');
    }

    /**
     * Format stat value for display
     * @param {string} statName - Stat name
     * @param {number} value - Stat value
     * @returns {string} Formatted value
     */
    formatStatValue(statName, value) {
        // ItemFindingCategory stats are always percentages
        if (statName.startsWith('ItemFindingCategory.')) {
            if (value > 0) {
                return `+${value}%`;
            } else if (value < 0) {
                return `${value}%`;
            }
            return `${value}%`;
        }

        // Percentage stats (show %)
        const percentageStats = [
            'work_efficiency', 'double_action', 'double_rewards',
            'no_materials_consumed', 'bonus_xp', 'bonus_xp_percent',
            'bonus_experience_percent', 'steps_percent', 'steps_pct',
            'chest_finding', 'item_finding', 'fine_material_finding',
            'find_collectibles', 'collectible_finding', 'find_gems', 'find_bird_nests',
            'find_linens'
        ];

        // Flat stats (no %)
        const flatStats = [
            'quality_outcome',
            'bonus_xp_base', 'bonus_xp_add',
            'bonus_experience_base', 'bonus_experience_add',
            'foraging_base_xp',
            'steps_required', 'steps_add', 'flat_steps',
            'inventory_space'
        ];

        const isPercentage = percentageStats.includes(statName);

        if (value > 0) {
            return isPercentage ? `+${value}%` : `+${value}`;
        } else if (value < 0) {
            return isPercentage ? `${value}%` : `${value}`;
        }
        return isPercentage ? `${value}%` : `${value}`;
    }

    /**
     * Get CSS class for stat value color
     * Requirements: 6.9
     * 
     * @param {string} statName - Stat name
     * @param {number} value - Stat value
     * @returns {string} CSS class
     */
    getStatValueClass(statName, value) {
        // Stats where negative is good
        const negativeIsGood = ['steps_add', 'steps_required', 'flat_steps', 'steps_pct', 'steps_percent'];
        const negativeGood = negativeIsGood.includes(statName);

        if (value > 0) {
            return negativeGood ? 'stat-value-negative' : 'stat-value-positive';
        } else if (value < 0) {
            return negativeGood ? 'stat-value-positive' : 'stat-value-negative';
        }
        return 'stat-value-neutral';
    }

    /**
     * Render the component (override parent to handle async content)
     */
    render() {
        // Set rendering flag
        this.isRendering = true;

        console.log('[RENDER-DEBUG] render() called');
        console.trace('[RENDER-DEBUG] render stack');

        // Render shell first
        const iconHtml = this.props.icon ? `<img src="${this.props.icon}" alt="${this.props.title}" class="icon">` : '';

        const html = `
            <div class="collapsible ${this.expanded ? 'expanded' : ''}">
                <div class="collapsible-header">
                    ${iconHtml}
                    <span class="title">${this.props.title}</span>
                    <span class="count">${this.props.count}</span>
                    <span class="expand-arrow ${this.expanded ? 'expanded' : ''}">▼</span>
                </div>
                <div class="collapsible-content" style="display: ${this.expanded ? 'block' : 'none'}">
                    <div class="loading">Calculating...</div>
                </div>
            </div>
        `;

        this.$element.html(html);

        // Load content asynchronously
        this.loadContent();
    }

    /**
     * Load and render content asynchronously
     */
    async loadContent() {
        // Use render queue to allow latest render to proceed
        if (!this._renderQueue) {
            this._renderQueue = [];
        }

        const renderTimestamp = Date.now();
        this._renderQueue.push(renderTimestamp);
        console.log('[RENDER-DEBUG] loadContent() called, render ID:', renderTimestamp, '_inputItems:', Object.keys(this._inputItems || {}).length, '_useFineInputs:', this._useFineInputs);

        try {
            const contentHtml = await this.renderContent();

            // Only apply if this is still the latest render
            if (this._renderQueue[this._renderQueue.length - 1] === renderTimestamp) {
                console.log('[RENDER-DEBUG] loadContent APPLYING render ID:', renderTimestamp, 'contributorsByStat keys:', Object.keys(this.contributorsByStat || {}).length);
                const weContribs = this.contributorsByStat['work_efficiency'] || [];
                console.log('[RENDER-DEBUG] WE contributors:', weContribs.length, weContribs.map(c => `${c.item?.name}(${c.value})`).join(', '));
                this.$element.find('.collapsible-content').html(contentHtml);
                console.log('loadContent() complete, render ID:', renderTimestamp);

                // Cache rendered content for instant slot switching in comparison mode
                if (store.state.gearsets.comparisonMode) {
                    const slot = store.state.gearsets.activeGearsetSlot || 1;
                    this._slotContentCache[slot] = contentHtml;
                    this._slotContributorsCache[slot] = { ...this.contributorsByStat };
                    this._slotExpandedStatsCache[slot] = new Set(this.expandedStats);
                    // Save gear hash for cache invalidation on gear change
                    const currentGear = slot === 1 ? store.state.gearsets.current : store.state.gearsets.gearset2;
                    if (!this._slotGearHash) this._slotGearHash = {};
                    this._slotGearHash[slot] = JSON.stringify(Object.entries(currentGear || {}).map(([k, v]) => [k, v?.itemId, v?.useAbility]).sort());
                }

                // Restore scroll position if a _renderPreservingScroll is pending
                if (this._pendingScrollRestore !== undefined && this._pendingScrollTarget) {
                    const scrollTop = this._pendingScrollRestore;
                    const $scroller = this._pendingScrollTarget;
                    this._pendingScrollRestore = undefined;
                    this._pendingScrollTarget = undefined;
                    requestAnimationFrame(() => {
                        if ($scroller.length) $scroller[0].scrollTop = scrollTop;
                    });
                }

                // Only fire callbacks if this render actually completed
                // This prevents cancelled renders from triggering Column 3 updates
                for (const callback of this.statsCalculatedCallbacks) {
                    if (callback) {
                        callback();
                    }
                }
            } else {
                console.log('loadContent() cancelled (newer render exists), render ID:', renderTimestamp);
                // Don't modify contributorsByStat - let the successful render keep its data
            }
        } catch (error) {
            console.error('loadContent() error:', error);
            console.error('Error stack:', error.stack);

            // Show error in UI
            this.$element.find('.collapsible-content').html(`
                <div class="combined-stats-empty">
                    <p style="color: red;">Error loading stats: ${error.message}</p>
                </div>
            `);
        } finally {
            // Remove this render from queue
            const index = this._renderQueue.indexOf(renderTimestamp);
            if (index > -1) {
                this._renderQueue.splice(index, 1);
            }

            // Clear rendering flag
            this.isRendering = false;
        }
    }

    /**
     * Render the content inside the collapsible section
     * Requirements: 6.2, 6.3, 6.4
     * 
     * @returns {Promise<string>} HTML for stats display
     */
    async renderContent() {
        const allStats = await this.calculateStats();

        // Calculate total stats including unapplied
        const totalStats = {};
        for (const [statName, contributors] of Object.entries(this.contributorsByStat)) {
            totalStats[statName] = contributors.reduce((sum, c) => sum + c.value, 0);
        }

        console.log('renderContent - allStats (applied only):', allStats);
        console.log('renderContent - totalStats (all contributors):', totalStats);
        console.log('renderContent - contributorsByStat:', this.contributorsByStat);

        // Combine all stats (applied and unapplied)
        const combinedStats = { ...allStats };
        for (const [statName, totalValue] of Object.entries(totalStats)) {
            if (!combinedStats[statName]) {
                combinedStats[statName] = 0;
            }
        }

        // Filter out stats where both applied and total are 0
        const filteredStats = {};
        for (const [statName, appliedValue] of Object.entries(combinedStats)) {
            const totalValue = totalStats[statName] || 0;
            // Only include if at least one is non-zero
            if (Math.abs(appliedValue) > 0.001 || Math.abs(totalValue) > 0.001) {
                // If hiding unapplicable stats, skip rows with no applied value
                if (this.hideUnapplicableStats && Math.abs(appliedValue) < 0.001) {
                    continue;
                }
                filteredStats[statName] = appliedValue;
            }
        }

        // Sort stats alphabetically with special stats at end
        const sortedStats = this.sortStats(filteredStats);

        if (sortedStats.length === 0) {
            return `
                <div class="combined-stats-empty">
                    <p>No gear equipped</p>
                </div>
            `;
        }

        const statsHtml = sortedStats.map(([statName, appliedValue]) => {
            const totalValue = totalStats[statName] || appliedValue;
            const isExpanded = this.expandedStats.has(statName);

            console.log(`Rendering ${statName}: applied=${appliedValue}, total=${totalValue}`);

            return this.renderStatRow(statName, appliedValue, totalValue, isExpanded);
        }).join('');

        return `
            <div class="combined-stats-container" data-pin-id="combined-stats-container">
                ${statsHtml}
            </div>
        `;
    }

    /**
     * Render a single stat row
     * Requirements: 6.2, 6.3, 6.4
     * 
     * @param {string} statName - Stat name
     * @param {number} appliedValue - Currently applied value
     * @param {number} totalValue - Total value including unapplied
     * @param {boolean} isExpanded - Whether to show contributors
     * @returns {string} HTML for stat row
     */
    renderStatRow(statName, appliedValue, totalValue, isExpanded) {
        const formattedName = this.formatStatName(statName);
        const appliedStr = this.formatStatValue(statName, appliedValue);
        const totalStr = this.formatStatValue(statName, totalValue);
        const appliedClass = this.getStatValueClass(statName, appliedValue);
        const totalClass = this.getStatValueClass(statName, totalValue);

        // Get stat icon
        const iconPath = this.getStatIcon(statName);

        return `
            <div class="stat-row ${isExpanded ? 'expanded' : ''}" data-stat="${statName}">
                <div class="stat-header">
                    <span class="stat-applied ${appliedClass}">${appliedStr}</span>
                    <img src="${iconPath}" alt="${formattedName}" class="stat-icon">
                    <span class="stat-name">${formattedName}</span>
                    <span class="stat-total dimmed ${totalClass}">${totalStr}</span>
                    <button class="stat-expand-btn" data-stat="${statName}">
                        <span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>
                    </button>
                </div>
                <div class="stat-contributors" style="display: ${isExpanded ? 'block' : 'none'};">
                    ${this.renderContributors(statName)}
                </div>
            </div>
        `;
    }

    /**
     * Get icon path for a stat
     * @param {string} statName - Stat name
     * @returns {string} Icon path
     */
    getStatIcon(statName) {
        return this.getStatIconPath(statName);
    }

    /**
     * Render contributing items for a stat
     * Requirements: 6.5, 6.6, 6.7, 6.8, 6.9, 6.11
     * 
     * @param {string} statName - Stat name
     * @returns {string} HTML for contributors (inner content only)
     */
    renderContributors(statName) {
        // Use cached contributors from calculateStats
        const contributors = this.contributorsByStat[statName] || [];

        if (contributors.length === 0) {
            return '<div class="no-contributors">No contributors</div>';
        }

        // Separate applied and unapplied contributors
        const appliedContributors = contributors.filter(c => c.applied);
        const unappliedContributors = contributors.filter(c => !c.applied);

        // Render applied first, then unapplied (unless hidden)
        const appliedHtml = appliedContributors.map(contributor => {
            return this.renderContributor(statName, contributor);
        }).join('');

        let unappliedHtml = '';
        if (!this.hideUnapplicableStats) {
            unappliedHtml = unappliedContributors.map(contributor => {
                return this.renderContributor(statName, contributor);
            }).join('');
        }

        return appliedHtml + unappliedHtml;
    }

    /**
     * Render a single contributor
     * Requirements: 6.6, 6.7, 6.8, 6.9
     * 
     * @param {string} statName - Stat name
     * @param {Object} contributor - Contributor object
     * @returns {string} HTML for contributor
     */
    renderContributor(statName, contributor) {
        const { source, item, value, applied, skill, location } = contributor;
        const valueStr = this.formatStatValue(statName, value);
        const valueClass = this.getStatValueClass(statName, value);
        const appliedClass = applied ? 'applied' : 'unapplied';
        const iconPath = item?.icon_path || '/assets/icons/items/equipment/placeholder.svg';
        const itemName = item?.name || source;
        const rarity = item?.rarity || 'common';
        const rarityClass = `rarity-${rarity.toLowerCase()}`;

        // Build condition text (e.g., "While doing Gathering skills in Spectral location")
        let conditionHtml = '';
        if (skill !== 'global' || location !== 'global') {
            const condition = formatStatCondition(skill, location);
            if (condition && condition !== 'Global') {
                conditionHtml = `<span class="contributor-condition">${condition}</span>`;
            }
        }

        // Handle generic item emoji icon (unless icon_path is set)
        let contributorIconHtml;
        if (item?.is_generic && item?.icon_path) {
            contributorIconHtml = `<img src="${item.icon_path}" alt="${itemName}" class="contributor-icon ${rarityClass}" onerror="this.style.display='none'">`;
        } else if (item?.is_generic && item?.icon) {
            const iconStyle = item.icon_color ? `${window.emojiTintStyle(item.icon_color)}` : '';
            contributorIconHtml = `<span class="contributor-icon-emoji ${rarityClass}">${window.tintedEmoji(item.icon, item.icon_color)}</span>`;
        } else {
            const petScaled = iconPath.includes('/pets/') || iconPath.includes('/pet_eggs/') ? ' pet-icon-scaled' : '';
            contributorIconHtml = `<img src="${iconPath}" alt="${itemName}" class="contributor-icon ${rarityClass}${petScaled}">`;
        }

        return `
            <div class="stat-contributor ${appliedClass}">
                <span class="contributor-value ${valueClass}">${valueStr}</span>
                ${contributorIconHtml}
                <span class="contributor-name ${applied ? '' : 'unapplied-text'}">${itemName}${conditionHtml}</span>
            </div>
        `;
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Call parent to attach collapsible header events
        super.attachEvents();

        // Remove old handlers
        this.$element.off('click', '.stat-expand-btn');
        this.$element.off('click', '.stat-header');

        // Expand/collapse stat rows when clicking anywhere on the header
        this.$element.on('click', '.stat-header', (e) => {
            const $header = $(e.currentTarget);
            const statName = $header.closest('.stat-row').data('stat');
            const $statRow = $header.closest('.stat-row');
            const $contributors = $statRow.find('.stat-contributors');
            const $arrow = $statRow.find('.expand-arrow');

            if (this.expandedStats.has(statName)) {
                // Collapse
                this.expandedStats.delete(statName);
                $statRow.removeClass('expanded');
                $arrow.removeClass('expanded');
                $contributors.slideUp(200);
            } else {
                // Expand
                this.expandedStats.add(statName);
                $statRow.addClass('expanded');
                $arrow.addClass('expanded');
                $contributors.slideDown(200);
            }
        });
    }

    /**
     * Load item finding categories from API
     */
    async loadItemFindingCategories() {
        try {
            const response = await fetch('/api/item-finding-categories');
            if (response.ok) {
                this.itemFindingCategories = await response.json();
                window.itemFindingCategories = this.itemFindingCategories;  // Also set globally
                console.log('Loaded item finding categories:', Object.keys(this.itemFindingCategories).length);
            }
        } catch (error) {
            console.error('Failed to load item finding categories:', error);
        }
    }

    /**
     * Build (once, cached) a map of location id -> region tag list from
     * /api/locations. Used to resolve travel-route segment regions.
     * @returns {Promise<Object>} { locId: [region, ...] }
     */
    async _getLocationRegionsMap() {
        if (this._locationRegionsMap) return this._locationRegionsMap;
        const map = {};
        try {
            const resp = await $.get('/api/locations');
            for (const region of (resp.regions || [])) {
                for (const loc of (region.locations || [])) {
                    if (!loc || !loc.id) continue;
                    const regions = (loc.regions && loc.regions.length > 0) ? loc.regions : [loc.id];
                    map[String(loc.id).toLowerCase()] = regions.map(r => String(r).toLowerCase());
                }
            }
        } catch (e) {
            console.warn('combined-stats: failed to load /api/locations for travel region map:', e);
        }
        this._locationRegionsMap = map;
        return map;
    }

    /**
     * Resolve the active travel route's per-segment START-location region lists.
     * Mirrors the backend /api/travel/stats, which computes each segment's stats
     * from its start location. Returns an array of region-arrays (one per
     * segment), or null when no route is loaded.
     * @returns {Promise<string[][]|null>}
     */
    async _getTravelRouteSegmentRegions() {
        const route = window.currentTravelRoute;
        if (!route || !Array.isArray(route.segments) || route.segments.length === 0) {
            return null;
        }
        const locMap = await this._getLocationRegionsMap();
        const segRegions = [];
        for (const seg of route.segments) {
            const startId = String(seg.start || '').toLowerCase();
            if (!startId) continue;
            const regions = locMap[startId] || [startId];
            segRegions.push(regions.map(r => String(r).toLowerCase()));
        }
        return segRegions.length > 0 ? segRegions : null;
    }

    /**
     * Decide whether a location-scoped stat applies to the current travel route.
     * Mirrors the backend _location_matches (util/stats_mixin.py):
     *   - 'global'      -> always applies
     *   - '!region'     -> applies to a segment NOT in that region
     *   - 'region'      -> applies to a segment in that region (membership)
     * A travel bonus applies if it matches ANY segment's start location, since
     * each matching segment contributes to the route stats shown in Travel info.
     * @param {string} locationKey - e.g. 'global', 'gdte', 'trellin', '!underwater'
     * @returns {boolean}
     */
    _travelLocationMatches(locationKey) {
        const key = String(locationKey || '').toLowerCase();
        if (key === 'global') return true;
        const segs = this._travelSegmentRegions;
        if (!segs || segs.length === 0) return false;

        const isNegated = key.startsWith('!');
        const regionName = isNegated ? key.slice(1) : key;

        return segs.some(segRegions => {
            const inRegion = segRegions.includes(regionName);
            return isNegated ? !inRegion : inRegion;
        });
    }

    /**
     * Aggregate stats and track contributors
     * @param {Object} totalStats - Total stats object to update
     * @param {Object} itemStats - Item stats to add {skill: {location: {stat: value}}}
     * @param {string} slot - Slot name
     * @param {Object} item - Full item data
     * @param {boolean} forceApplied - Optional: force applied status (for gated stats)
     */
    aggregateStatsWithContributors(totalStats, itemStats, slot, item, forceApplied = null) {
        // Flatten nested stats structure and sum values
        for (const [skill, locationStats] of Object.entries(itemStats)) {
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                for (const [statName, statValue] of Object.entries(statsByLocation)) {
                    if (!statName || statName === 'undefined') continue;
                    // Debug: log Ghost trap pack stats to verify catalog data
                    if (item.name && item.name.toLowerCase().includes('ghost trap')) {
                        console.log(`=== GHOST TRAP PACK DEBUG ===`);
                        console.log(`  skill: ${skill}, location: ${location}, stat: ${statName}, value: ${statValue}`);
                        console.log(`  currentRecipeSkill: ${this.currentRecipeSkill}`);
                        console.log(`  currentLocation: ${JSON.stringify(this.currentLocation)}`);
                        console.log(`  Full itemStats:`, JSON.stringify(itemStats));
                    }

                    // Determine if this stat is applied based on context
                    let isApplied;

                    if (forceApplied !== null) {
                        // Use forced applied status (for gated stats)
                        isApplied = forceApplied;
                    } else {
                        // Check if skill matches current context
                        const skillLower = skill.toLowerCase();
                        const locationLower = location.toLowerCase();

                        // Skill matches if:
                        // - skill is 'global' (always applies)
                        // - OR skill matches the current activity/recipe's primary skill
                        // - OR skill matches one of the activity's component skills (e.g., traveling for travel)
                        // - OR skill is a skill group that contains the current skill
                        let skillMatches = skillLower === 'global';

                        // Skill group definitions
                        const SKILL_GROUPS = {
                            'gathering': ['fishing', 'foraging', 'hunting', 'mining', 'woodcutting'],
                            'artisan': ['carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'],
                            'utility': ['agility', 'traveling'],
                        };

                        if (!skillMatches && this.currentActivitySkill) {
                            const actSkillLower = this.currentActivitySkill.toLowerCase();
                            // Check if skill matches activity's primary skill
                            skillMatches = (skillLower === actSkillLower);

                            // Check if skill is a group that contains the activity skill
                            if (!skillMatches && SKILL_GROUPS[skillLower]) {
                                skillMatches = SKILL_GROUPS[skillLower].includes(actSkillLower);
                            }

                            // Also check component skills (e.g., for traveling: ['agility', 'traveling'])
                            if (!skillMatches && this.currentActivityComponentSkills) {
                                skillMatches = this.currentActivityComponentSkills.some(cs => {
                                    const csLower = cs.toLowerCase();
                                    if (skillLower === csLower) return true;
                                    // Check if skill group contains the component skill
                                    if (SKILL_GROUPS[skillLower]) return SKILL_GROUPS[skillLower].includes(csLower);
                                    return false;
                                });
                            }
                        } else if (!skillMatches && this.currentRecipeSkill) {
                            const recSkillLower = this.currentRecipeSkill.toLowerCase();
                            // Check if skill matches recipe's skill
                            skillMatches = (skillLower === recSkillLower);

                            // Check if skill is a group that contains the recipe skill
                            if (!skillMatches && SKILL_GROUPS[skillLower]) {
                                skillMatches = SKILL_GROUPS[skillLower].includes(recSkillLower);
                            }

                            // Smelting sub-skill: bar-smelting recipes are categorized
                            // as "smithing" but also pick up "smelting"-scoped stats
                            // (e.g. Tortoise L4 "+2 bonus XP while doing Smelting
                            // recipes"). Only applies to the recipe subset in
                            // SMELTING_RECIPE_NAMES — other smithing recipes are
                            // unaffected.
                            if (!skillMatches && skillLower === 'smelting' && recSkillLower === 'smithing'
                                    && this.currentRecipeName && SMELTING_RECIPE_NAMES.has(this.currentRecipeName)) {
                                skillMatches = true;
                            }
                        }

                        // Location matches if:
                        // - location is 'global' (always applies)
                        // - OR (travel) the scope matches the route's segments
                        // - OR location matches the current selected location
                        let locationMatches = locationLower === 'global';

                        if (!locationMatches && this.isTravel && this._travelSegmentRegions && this._travelSegmentRegions.length > 0) {
                            // Travel: mirror the backend /api/travel/stats matcher.
                            // A location-scoped travel bonus applies if it applies
                            // to ANY route segment's start location (region
                            // membership, with "!" negation). This fixes bonuses
                            // like Medieval sneakers (!underwater), Trusty tent,
                            // Lily pad rope (gdte), and Map of Trellin (trellin)
                            // showing as "doesn't apply" in Combined Stats even
                            // though the Travel info section counts them.
                            locationMatches = this._travelLocationMatches(location);
                        } else if (!locationMatches && this.currentLocation) {
                            // Normalize currentLocation to array
                            const currentLocations = Array.isArray(this.currentLocation)
                                ? this.currentLocation
                                : [this.currentLocation];

                            // Check if location matches any of the current locations
                            locationMatches = currentLocations.some(loc =>
                                locationLower === loc.toLowerCase()
                            );

                            // Debug logging for location matching
                            if (statName === 'double_rewards' && locationLower === 'underwater') {
                                console.log('=== Underwater DR stat check ===');
                                console.log('locationLower:', locationLower);
                                console.log('currentLocations:', currentLocations);
                                console.log('locationMatches:', locationMatches);
                                console.log('skillMatches:', skillMatches);
                                console.log('isApplied:', skillMatches && locationMatches);
                            }
                        }

                        // Stat is applied if both skill and location match
                        isApplied = skillMatches && locationMatches;
                    }

                    // Only add to total if applied
                    if (isApplied) {
                        // Initialize stat if not present
                        if (!totalStats[statName]) {
                            totalStats[statName] = 0;
                        }

                        // Add value
                        totalStats[statName] += statValue;
                    }

                    // Track contributor (both applied and unapplied)
                    if (!this.contributorsByStat[statName]) {
                        this.contributorsByStat[statName] = [];
                    }

                    this.contributorsByStat[statName].push({
                        source: slot,
                        item: {
                            name: item.name,
                            icon_path: item.icon_path,
                            rarity: item.rarity || 'common',
                            is_generic: item.is_generic || false,
                            icon: item.icon || null,
                            icon_color: item.icon_color || null,
                        },
                        value: statValue,
                        applied: isApplied,
                        skill: skill,
                        location: location
                    });
                }
            }
        }
    }
}

export default CombinedStatsSection;
