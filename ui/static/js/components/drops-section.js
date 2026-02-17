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
        this.hideOwnedCollectibles = true;  // Default to true
        this.isExpanded = true;

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.hideOwnedCollectibles', () => this.onHideOwnedChange());
        this.subscribe('gearset', () => this.onGearsetChange());

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

        // Initial render
        this.onActivityChange();
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

        this.render();
    }

    /**
     * Calculate drop rates with steps per item
     * Requirements: 4.3, 4.5
     * @returns {Array} Array of drop objects with calculated steps
     */
    async calculateDropRates() {
        if (!this.dropSource) {
            return [];
        }

        const drops = [];

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

        // Add equipment drops from ItemFindingCategory stats
        await this.addEquipmentDrops(drops, column2Stats, stepsPerRewardRoll);

        // Process drop table (activities only)
        if (this.sourceType === 'activity' && this.dropSource.drop_table) {
            for (const drop of this.dropSource.drop_table) {
                const dropPercent = drop.chance_percent;
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
                    // TODO: Check for gems by keywords
                }

                // Calculate steps per item with finding bonus
                // Formula: (100 / dropPercent) * stepsPerSingleAction / ((1 + findBonus) * rewardsPerCompletion * avgQuantity)
                // Since stepsPerRewardRoll = stepsPerSingleAction / rewardsPerCompletion:
                // stepsPerItem = (100 / dropPercent) * stepsPerRewardRoll / ((1 + findBonus) * avgQuantity)
                const stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * (1 + findBonus) * avgQuantity);

                // Calculate augmented drop percent (includes finding bonus)
                const augmentedDropPercent = dropPercent * (1 + findBonus);

                // Check if this material has a fine version (from API)
                const isFine = drop.item_name.includes('Fine') || drop.item_name.includes('(Fine)');
                const hasFineVersion = !isFine && drop.has_fine_material;

                // If this item has a fine version, calculate steps to fine
                // Fine materials drop at 1% of the base material's rate (1/100)
                // Fine Material Finding bonus applies
                let stepsPerFineItem = null;
                let augmentedFineDropPercent = null;
                if (hasFineVersion && dropPercent) {
                    const fineDropPercent = dropPercent * 0.01;  // 1% of base rate
                    augmentedFineDropPercent = fineDropPercent * (1 + fineMaterialFinding);
                    stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * avgQuantity);
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
                    is_collectible: drop.item_ref && drop.item_ref.startsWith('Collectible.'),
                    source: 'primary'
                });
            }
        }

        // Process secondary drop table (activities only) - always show all drops
        if (this.sourceType === 'activity' && this.dropSource.secondary_drop_table) {
            for (const drop of this.dropSource.secondary_drop_table) {
                const dropPercent = drop.chance_percent;
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
                    // TODO: Check for gems by keywords
                }

                // Calculate steps per item with finding bonus
                const stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * (1 + findBonus) * avgQuantity);

                // Calculate augmented drop percent (includes finding bonus)
                const augmentedDropPercent = dropPercent * (1 + findBonus);

                // Check if this material has a fine version (from API)
                const isFine = drop.item_name.includes('Fine') || drop.item_name.includes('(Fine)');
                const hasFineVersion = !isFine && drop.has_fine_material;

                // If this item has a fine version, calculate steps to fine
                // Fine materials drop at 1% of the base material's rate (1/100)
                // Fine Material Finding bonus applies
                let stepsPerFineItem = null;
                let augmentedFineDropPercent = null;
                if (hasFineVersion && dropPercent) {
                    const fineDropPercent = dropPercent * 0.01;  // 1% of base rate
                    augmentedFineDropPercent = fineDropPercent * (1 + fineMaterialFinding);
                    stepsPerFineItem = (stepsPerRewardRoll * 100) / (augmentedFineDropPercent * avgQuantity);
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
                    is_collectible: drop.item_ref && drop.item_ref.startsWith('Collectible.'),
                    source: 'secondary'
                });
            }
        }

        // Add chest drop (only for recipes - activities already have chests in drop table)
        // Requirements: 4.8, 4.9
        if (this.sourceType === 'recipe') {
            const baseChestRate = 0.4;  // Always show base rate

            // Get bonuses from Column 2
            const combinedStatsSection = window.combinedStatsSection;
            const column2Stats = combinedStatsSection?.cachedStats || {};
            const chestFinding = (column2Stats.chest_finding || 0) / 100;
            const dr = (column2Stats.double_rewards || 0) / 100;

            // Calculate effective rate for steps calculation (includes DR)
            const effectiveChestRate = baseChestRate * (1 + chestFinding) * (1 + dr);
            const chestStepsPerItem = (stepsPerRewardRoll * 100) / effectiveChestRate;

            // Get primary skill for chest icon
            const primarySkill = this.dropSource.skill ? this.dropSource.skill.toLowerCase() : 'chest';

            drops.push({
                item_name: 'Chest',
                item_ref: null,
                drop_percent: baseChestRate,  // Show base rate (0.4%)
                quantity: { min: 1, max: 1, is_static: true },
                avg_quantity: 1,
                steps_per_item: chestStepsPerItem,  // Steps account for bonuses
                is_fine: false,
                is_collectible: false,
                source: 'chest',
                primary_skill: primarySkill  // Pass skill for icon selection
            });
        }

        // Filter owned collectibles if checkbox is checked
        // Requirements: 4.7
        let filteredDrops = drops;
        if (this.hideOwnedCollectibles) {
            filteredDrops = this.filterOwnedCollectibles(drops);
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
     * @returns {Promise<Array>} Drops array with equipment drops added
     */
    async addEquipmentDrops(drops, column2Stats, stepsPerRewardRoll) {
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

            for (const eqDrop of equipmentDrops) {
                const dropPercent = eqDrop.chance_percent;
                const avgQuantity = (eqDrop.min_qty + eqDrop.max_qty) / 2.0;

                // Calculate steps per item (no finding bonus for equipment drops)
                const stepsPerItem = (stepsPerRewardRoll * 100) / (dropPercent * avgQuantity);

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
                    drop_percent: dropPercent,
                    quantity: { min: eqDrop.min_qty, max: eqDrop.max_qty },
                    avg_quantity: avgQuantity,
                    steps_per_item: stepsPerItem,
                    steps_per_fine_item: stepsPerFineItem,
                    fine_drop_percent: augmentedFineDropPercent,
                    is_fine: false,
                    is_collectible: false,
                    source: 'equipment'
                });
            }
        } catch (error) {
            console.error('Error expanding equipment drops:', error);
        }

        return drops;
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

        // Get Chest Finding and DR stats from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};
        const chestFinding = (column2Stats.chest_finding || 0) / 100;  // Convert to decimal
        const dr = (column2Stats.double_rewards || 0) / 100;  // Convert to decimal

        // Apply bonuses: rate = baseRate * (1 + chestFinding) * (1 + DR)
        const rate = baseRate * (1 + chestFinding) * (1 + dr);

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

            // Use corrected formula (only ceil at the end)
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const stepsWithEfficiency = baseSteps / totalEfficiency;
            const minSteps = baseSteps * Math.pow(1 + maxEfficiency, -1);
            const stepsAfterMin = Math.max(stepsWithEfficiency, minSteps);
            const stepsWithPct = Math.ceil(stepsAfterMin * (1 + pct));
            const stepsPerSingleAction = Math.max(10, stepsWithPct + flat);

            // Calculate steps per reward roll (keep as number for calculations)
            const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

            return {
                stepsPerRewardRoll: stepsPerRewardRoll
            };
        } else if (this.sourceType === 'recipe') {
            // For recipes, use steps per action (no reward rolls in crafting)
            const baseSteps = this.dropSource.base_steps;
            const maxEfficiency = this.dropSource.max_efficiency;
            const we = gearStats.work_efficiency || 0;
            const da = gearStats.double_action || 0;
            const flat = gearStats.flat_steps || 0;
            const pct = gearStats.percent_steps || 0;

            // Use corrected formula (only ceil at the end)
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseWithEfficiency = baseSteps / totalEfficiency;
            const withPct = baseWithEfficiency * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct) + flat, 10);

            // Apply DA (keep as number for calculations)
            const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;

            return {
                stepsPerRewardRoll: expectedStepsPerAction
            };
        }

        return {
            stepsPerRewardRoll: 0
        };
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
            // Convert to icon filename: lowercase, spaces to underscores, keep apostrophes
            const itemNameFormatted = drop.item_name.toLowerCase().replace(/ /g, '_');
            // Try materials first, then consumables
            iconPath = `/assets/icons/items/materials/${itemNameFormatted}.svg`;
        }

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
            dropPercentFormatted = drop.drop_percent.toFixed(3).replace(/\.?0+$/, '');
        }

        // Format steps per item - show 1 decimal if under 100, otherwise whole number
        const stepsPerItem = drop.steps_per_item || 0;
        const stepsFormatted = stepsPerItem < 100
            ? stepsPerItem.toFixed(1).replace(/\.0$/, '')
            : Math.floor(stepsPerItem).toLocaleString();

        // For items with fine versions, show steps per fine item
        let fineStepsHtml = '';
        if (drop.steps_per_fine_item) {
            const fineSteps = drop.steps_per_fine_item;
            const fineStepsFormatted = fineSteps < 100
                ? fineSteps.toFixed(1).replace(/\.0$/, '')
                : Math.floor(fineSteps).toLocaleString();

            fineStepsHtml = `
                <div class="drop-card-steps drop-card-steps-fine">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="steps-icon" />
                    <span>${fineStepsFormatted}</span>
                </div>
            `;
        }

        return `
            <div class="drop-card ${fineClass}">
                <img src="${iconPath}" alt="${drop.item_name}" class="drop-card-icon" title="${drop.item_name}" loading="lazy" />
                <div class="drop-card-percent">${dropPercentFormatted}%</div>
                <div class="drop-card-quantity">${quantityText}</div>
                <div class="drop-card-steps">
                    <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="steps-icon" />
                    <span>${stepsFormatted}</span>
                </div>
                ${fineStepsHtml}
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 4.1
     */
    async render() {
        if (!this.dropSource) {
            this.$element.html('');
            return;
        }

        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;

        // Calculate drops
        const drops = await this.calculateDropRates();

        const contentHtml = `
            ${this.renderFilterCheckboxes()}
            <div class="drops-list">
                ${drops.map(drop => this.renderDropItem(drop)).join('')}
            </div>
        `;

        const html = `
            <div class="drops-section">
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
    }
}

export default DropsSection;
