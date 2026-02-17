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

        // Hooks for Column 3 integration
        // Requirements: 6.12
        this.currentActivity = null;  // Will be set by Column 3
        this.currentActivitySkill = null;  // Primary skill of current activity
        this.currentRecipe = null;  // Will be set by Column 3
        this.currentRecipeSkill = null;  // Skill of current recipe
        this.currentLocation = null;  // Will be set by Column 3
        this.currentService = null;   // Will be set by Column 3 (for recipes)

        // Subscribe to gear changes
        this.subscribe('gearsets.current', () => {
            console.log('Gear changed subscription fired, recalculating stats');

            // Save scroll position before render
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            this.render();
            this.attachEvents();

            // Restore scroll position after render
            // Use requestAnimationFrame to ensure DOM has updated
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        });

        // Subscribe to character skill changes for level bonus recalculation

        // Subscribe to character skill changes for level bonus recalculation
        this.subscribe('character.skills', () => {
            console.log('Column 2: Character skills changed subscription fired');

            // Save scroll position before render
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            // Render immediately with new level bonuses
            this.render();
            this.attachEvents();

            // Restore scroll position after render
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        });

        this.subscribe('ui.user_overrides.skills', () => {
            console.log('Column 2: Skill overrides changed subscription fired');
            console.log('Current activity:', this.currentActivity);
            console.log('Current recipe skill:', this.currentRecipeSkill);

            // Save scroll position before render
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            // Render immediately with new level bonuses
            this.render();
            this.attachEvents();

            // Restore scroll position after render
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        });

        // Subscribe to achievement points changes for AP-gated stats
        this.subscribe('ui.user_overrides.achievement_points', () => {
            console.log('Column 2: Achievement points changed subscription fired');

            // Prevent re-rendering if already rendering
            if (this.isRendering) {
                console.log('  Skipping render - already rendering');
                return;
            }

            // Save scroll position before render
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

            // Render immediately with new AP-gated stats
            this.render();
            this.attachEvents();

            // Restore scroll position after render
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollTop);
            });
        });

        // Don't subscribe to general character or items - only recalculate when gear or skills change
        // Item quality changes are less frequent and can be manually refreshed
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
            'collectible_finding': 'find_collectibles'
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
                        console.log('Set activity skill:', this.currentActivitySkill);
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
                            this.currentRecipe = activityId;
                            this.currentRecipeSkill = recipe.skill;
                            console.log('Set recipe skill:', this.currentRecipeSkill);
                            break;
                        }
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
    async setActivityAndLocation(activityId, location) {
        console.log('=== setActivityAndLocation() called ===');
        console.log('Activity:', activityId);
        console.log('Location:', location);

        // Set activity first (without rendering)
        if (activityId !== undefined) {
            // Manually update activity state without rendering
            const isSameActivity = this.currentActivity === activityId && !this.currentRecipe;
            const isSameRecipe = this.currentRecipe === activityId && !this.currentActivity;

            if (!isSameActivity && !isSameRecipe && activityId) {
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
                            found = true;
                            break;
                        }
                    }

                    // If not found in activities, try recipes
                    if (!found) {
                        const recResponse = await $.get('/api/recipes');
                        for (const recipes of Object.values(recResponse.by_skill)) {
                            const recipe = recipes.find(r => r.id === activityId);
                            if (recipe) {
                                this.currentActivity = null;
                                this.currentActivitySkill = null;
                                this.currentRecipe = activityId;
                                this.currentRecipeSkill = recipe.skill;
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.error('Failed to fetch activity/recipe skill:', error);
                }
            }
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
            try {
                const recResponse = await $.get('/api/recipes');
                for (const recipes of Object.values(recResponse.by_skill)) {
                    const recipe = recipes.find(r => r.id === recipeId);
                    if (recipe) {
                        // Clear activity state, set recipe state
                        this.currentActivity = null;
                        this.currentActivitySkill = null;
                        this.currentRecipe = recipeId;
                        this.currentRecipeSkill = recipe.skill;
                        console.log('Set recipe skill:', this.currentRecipeSkill);
                        break;
                    }
                }
            } catch (error) {
                console.error('Failed to fetch recipe skill:', error);
            }
        } else {
            this.currentRecipe = null;
            this.currentRecipeSkill = null;
        }

        // Set service and location without triggering renders
        this.currentService = serviceId;
        this.currentLocation = locationId;

        console.log('Updated context - Recipe:', this.currentRecipe, 'Service:', this.currentService, 'Location:', this.currentLocation);

        // Clear any pending debounced renders
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }

        // Render once with all context set
        this.render();
        this.attachEvents();
    }

    /**
     * Calculate combined stats from all equipped items
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
        const currentGear = store.state.gearsets?.current || {};
        const character = store.state.character || {};

        // Clear contributors cache at the start of calculation to prevent duplicates
        // This ensures each calculateStats() call starts fresh
        console.log('=== calculateStats() START ===');

        // Initialize contributorsByStat if it doesn't exist
        if (!this.contributorsByStat) {
            this.contributorsByStat = {};
        }

        console.log('contributorsByStat before clear:', Object.keys(this.contributorsByStat).length, 'stats');
        this.contributorsByStat = {};
        console.log('contributorsByStat after clear:', Object.keys(this.contributorsByStat).length, 'stats');

        console.log('Calculating combined stats, equipped items:', Object.keys(currentGear).filter(k => currentGear[k]).length);

        // Get catalog to look up item details
        try {
            const catalog = await api.getCatalog();
            const catalogItems = catalog.items || [];
            const collectibles = catalog.collectibles || [];

            console.log('Catalog loaded with', catalogItems.length, 'items and', collectibles.length, 'collectibles');

            // Aggregate stats from all equipped items
            for (const [slot, slotItem] of Object.entries(currentGear)) {
                if (!slotItem || !slotItem.itemId) continue;

                // Find full item data in catalog
                // For fine consumables, the itemId has a '_fine' suffix (e.g., "fruit_cake_fine")
                // but the catalog only has the base item (e.g., "fruit_cake")
                let fullItem = catalogItems.find(item => item.id === slotItem.itemId);
                let isFineConsumable = false;

                if (!fullItem && (slotItem.is_fine || slotItem.itemId.endsWith('_fine'))) {
                    const baseId = slotItem.itemId.replace(/_fine$/, '');
                    fullItem = catalogItems.find(item => item.id === baseId);
                    if (fullItem) {
                        isFineConsumable = true;
                        console.log(`Fine consumable: found base item ${baseId} for ${slotItem.itemId}`);
                    }
                }

                if (!fullItem) {
                    console.warn(`Item not found in catalog: ${slotItem.itemId}`);
                    continue;
                }

                console.log(`Processing ${slot}: ${fullItem.name}${isFineConsumable ? ' (Fine)' : ''}`);

                // Get item stats and rarity
                // For fine consumables, use stats_fine from the base catalog item
                let itemStats = isFineConsumable ? (fullItem.stats_fine || fullItem.stats || {}) : (fullItem.stats || {});
                let itemRarity = isFineConsumable ? 'fine' : (fullItem.rarity || 'common');

                // For crafted items, use quality-specific stats and rarity
                if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
                    const quality = slotItem.quality || 'Normal';
                    itemStats = fullItem.stats_by_quality[quality] || {};
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
                        const charLevel = character.skills?.[gateSkill.toLowerCase()] || 0;

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

            console.log('Combined stats:', stats);

            // Add service stats (for recipes)
            // Requirements: Service bonuses integration
            console.log('=== SERVICE STATS CHECK ===');
            console.log('currentService:', this.currentService);
            console.log('currentRecipe:', this.currentRecipe);
            console.log('currentActivity:', this.currentActivity);

            if (this.currentService && this.currentRecipe) {
                console.log('✓ Processing service stats for service:', this.currentService, 'recipe:', this.currentRecipe);

                try {
                    // Fetch service details
                    const serviceResponse = await $.get(`/api/services/for-recipe/${this.currentRecipe}`);
                    console.log('Service API response:', serviceResponse);

                    // The currentService might be a full ID like "basic_workshop_halfling_campgrounds"
                    // but the API returns grouped services with IDs like "basic_workshop"
                    // Search through locations for matching service_id

                    let service = null;
                    let locationData = null;

                    // First, try exact match on grouped service ID
                    service = serviceResponse.services.find(s => s.id === this.currentService);

                    // If not found, search through locations for matching service_id
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

                        // Use location-specific stats if we found a matching location
                        const serviceStats = locationData ? (locationData.stats || {}) : (service.stats || {});
                        const isUnlocked = locationData ? locationData.is_unlocked : service.is_unlocked;

                        console.log('locationData.stats:', locationData?.stats);
                        console.log('service.stats:', service.stats);
                        console.log('Selected serviceStats:', serviceStats);
                        console.log('Service is_unlocked:', isUnlocked);
                        console.log('About to aggregate service stats. Stats object:', JSON.stringify(serviceStats, null, 2));

                        // Build service icon path from name (lowercase)
                        let iconName = service.name.replace(/ /g, '_').toLowerCase();  // Replace spaces and lowercase
                        if (!service.name.toLowerCase().startsWith('basic') && service.is_basic) {
                            iconName += '_(basic)';  // e.g., "alight_kitchen_(basic)"
                        } else if (service.is_advanced) {
                            iconName += '_(advanced)';  // e.g., "cursed_sawmill_(advanced)"
                        }
                        const serviceIconPath = `/assets/icons/services/${iconName}.svg`;

                        // Create a pseudo-item for the service to track as contributor
                        const serviceItem = {
                            name: service.name + (locationData ? ` (${locationData.location.name})` : ''),
                            icon_path: serviceIconPath,
                            rarity: 'common'
                        };

                        // Aggregate stats and track contributors
                        this.aggregateStatsWithContributors(
                            stats,
                            serviceStats,
                            'Service',
                            serviceItem,
                            isUnlocked  // Only apply if service is unlocked
                        );

                        console.log('✓ Service stats aggregated:', serviceStats);
                    } else {
                        console.warn(`✗ Service not found in response: ${this.currentService}`);
                        console.warn('Available services:', serviceResponse.services.map(s => s.id));
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

        // Add level bonuses for WE and QO
        // Requirements: 7.6
        if (this.currentActivity || this.currentRecipe) {
            const levelBonuses = await this.calculateLevelBonuses();

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
                this.contributorsByStat.work_efficiency.push({
                    source: 'Level Bonus',
                    item: {
                        name: 'From levels above requirement',
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
                const response = await $.get('/api/activities');
                let activity = null;

                for (const activities of Object.values(response.by_skill)) {
                    activity = activities.find(a => a.id === selectedActivity);
                    if (activity) break;
                }

                if (activity) {
                    const primarySkill = activity.primary_skill.toLowerCase();
                    const charLevel = character.skills?.[primarySkill] || 0;
                    const requirements = activity.requirements?.skill_requirements || {};
                    const requiredLevel = requirements[activity.primary_skill] || 1;

                    const levelsAbove = Math.max(0, charLevel - requiredLevel);
                    // WE bonus: 1.25% per level, capped at 25% (20 levels)
                    bonuses.work_efficiency = Math.min(levelsAbove * 1.25, 25);

                    console.log(`Level bonus calculation for ${activity.name}:`, {
                        primarySkill,
                        charLevel,
                        requiredLevel,
                        levelsAbove,
                        bonus: bonuses.work_efficiency
                    });
                }
            } else if (selectedRecipe && isRecipe) {
                // It's a recipe
                const response = await $.get('/api/recipes');
                let recipe = null;

                for (const recipes of Object.values(response.by_skill)) {
                    recipe = recipes.find(r => r.id === selectedRecipe);
                    if (recipe) break;
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
        const currentGear = store.state.gearsets?.current || {};

        try {
            const catalog = await api.getCatalog();
            const catalogItems = catalog.items || [];

            // Check each equipped item
            for (const [slot, slotItem] of Object.entries(currentGear)) {
                if (!slotItem || !slotItem.itemId) continue;

                // Find full item data
                const fullItem = catalogItems.find(item => item.id === slotItem.itemId);
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
            'find_collectibles', 'collectible_finding', 'find_gems', 'find_bird_nests'
        ];

        // Flat stats (no %)
        const flatStats = [
            'quality_outcome',
            'bonus_xp_base', 'bonus_xp_add',
            'bonus_experience_base', 'bonus_experience_add',
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

        console.log('Column 2 render() called');
        console.trace('render() call stack');

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
        console.log('loadContent() called, render ID:', renderTimestamp);

        try {
            const contentHtml = await this.renderContent();

            // Only apply if this is still the latest render
            if (this._renderQueue[this._renderQueue.length - 1] === renderTimestamp) {
                this.$element.find('.collapsible-content').html(contentHtml);
                console.log('loadContent() complete, render ID:', renderTimestamp);

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
            <div class="combined-stats-container">
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

        // Render applied first, then unapplied
        const appliedHtml = appliedContributors.map(contributor => {
            return this.renderContributor(statName, contributor);
        }).join('');

        const unappliedHtml = unappliedContributors.map(contributor => {
            return this.renderContributor(statName, contributor);
        }).join('');

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
        const { source, item, value, applied } = contributor;
        const valueStr = this.formatStatValue(statName, value);
        const valueClass = this.getStatValueClass(statName, value);
        const appliedClass = applied ? 'applied' : 'unapplied';
        const iconPath = item?.icon_path || '/assets/icons/items/equipment/placeholder.svg';
        const itemName = item?.name || source;
        const rarity = item?.rarity || 'common';
        const rarityClass = `rarity-${rarity.toLowerCase()}`;

        return `
            <div class="stat-contributor ${appliedClass}">
                <span class="contributor-value ${valueClass}">${valueStr}</span>
                <img src="${iconPath}" alt="${itemName}" class="contributor-icon ${rarityClass}">
                <span class="contributor-name ${applied ? '' : 'unapplied-text'}">${itemName}</span>
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
                        let skillMatches = skillLower === 'global';

                        if (!skillMatches && this.currentActivitySkill) {
                            // Check if skill matches activity's primary skill
                            skillMatches = (skillLower === this.currentActivitySkill.toLowerCase());
                        } else if (!skillMatches && this.currentRecipeSkill) {
                            // Check if skill matches recipe's skill
                            skillMatches = (skillLower === this.currentRecipeSkill.toLowerCase());
                        }

                        // Location matches if:
                        // - location is 'global' (always applies)
                        // - OR location matches the current selected location
                        let locationMatches = locationLower === 'global';

                        if (!locationMatches && this.currentLocation) {
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
                            rarity: item.rarity || 'common'
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
