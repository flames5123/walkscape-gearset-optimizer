/**
 * RecipeInfoSection Component
 * 
 * Displays detailed recipe information when a recipe is selected.
 * 
 * Features:
 * - Collapsible section with skill-colored border
 * - ALL CAPS headers with horizontal overflow
 * - Fine materials checkbox
 * - Materials display with group selector
 * - Recipe stats display
 * - Services selector (grouped by name, shows locations)
 * - Locations selector
 * - Crafting odds table
 * - Level bonus calculations
 * 
 * Requirements: 3.1-3.24, 7.6
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';

class RecipeInfoSection extends Component {
    /**
     * Create a recipe info section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // State
        this.recipe = null;
        this.selectedService = null;  // Grouped service ID for UI highlighting
        this.selectedServiceSpecific = null;  // Location-specific service ID for optimization
        this.selectedLocation = null;
        this.selectedMaterialGroup = 0;
        this.useFine = false;
        this.isExpanded = true;

        // Subscribe to state changes
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.selectedService', () => this.onServiceChange());
        this.subscribe('column3.selectedLocation', () => this.onLocationChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());

        // Subscribe to Column 2 stats updates
        // When Column 2 finishes calculating, re-render to show updated stats
        if (window.combinedStatsSection) {
            window.combinedStatsSection.statsCalculatedCallbacks.push(() => {
                console.log('=== Column 2 callback fired ===');
                console.log('this.recipe:', this.recipe?.name);

                if (this.recipe) {
                    console.log('✓ Column 2 stats updated, re-rendering Recipe Column 3');
                    this.render();
                } else {
                    console.log('✗ No recipe, skipping render');
                }
            });
        }

        // Initial render
        this.onRecipeChange();
    }

    /**
     * Handle recipe selection change
     */
    async onRecipeChange() {
        const selectedId = store.state.column3?.selectedRecipe;

        if (!selectedId) {
            this.recipe = null;
            this.selectedService = null;
            this.selectedLocation = null;
            this.render();

            // Notify Column 2 that recipe was cleared
            // Requirements: 7.2
            this.notifyColumn2RecipeChange(null);
            return;
        }

        // Fetch recipe details from API
        try {
            const response = await $.get('/api/recipes');

            // Find recipe by ID
            for (const recipes of Object.values(response.by_skill)) {
                const recipe = recipes.find(r => r.id === selectedId);
                if (recipe) {
                    this.recipe = recipe;
                    this.selectedMaterialGroup = 0;
                    this.useFine = false;

                    // Fetch services for this recipe and auto-select
                    // This returns the selected service and location
                    const context = await this.loadServicesForRecipe();

                    // Notify Column 2 with all context at once (recipe + service + location)
                    // This prevents multiple renders and duplicate contributors
                    // Requirements: 7.2, 7.3, 7.4
                    const combinedStatsSection = window.combinedStatsSection;
                    if (combinedStatsSection && typeof combinedStatsSection.setRecipeContext === 'function') {
                        await combinedStatsSection.setRecipeContext(
                            recipe.id,
                            context?.serviceId || null,
                            context?.locationId || null
                        );
                    }

                    // Column 3 will re-render when Column 2 calls onStatsCalculated callback
                    return;
                }
            }

            // Recipe not found
            this.recipe = null;
            this.selectedService = null;
            this.selectedLocation = null;
            this.render();

            // Notify Column 2 that recipe was cleared
            this.notifyColumn2RecipeChange(null);

        } catch (error) {
            console.error('Failed to load recipe details:', error);
            api.showError('Failed to load recipe details');
        }
    }

    /**
     * Load services for the current recipe
     */
    async loadServicesForRecipe() {
        if (!this.recipe) {
            return;
        }

        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);

            // Auto-select first Basic service (grouped by name)
            let firstBasic = null;
            let firstUnlockedBasic = null;
            let firstService = null;

            for (const service of response.services) {
                if (!firstService) {
                    firstService = service;
                }

                if (service.is_basic) {
                    if (!firstBasic) {
                        firstBasic = service;
                    }
                    if (service.is_unlocked && !firstUnlockedBasic) {
                        firstUnlockedBasic = service;
                    }
                }
            }

            // Select in priority order
            const serviceToSelect = firstUnlockedBasic || firstBasic || firstService;

            if (serviceToSelect) {
                // Store the grouped service ID for UI highlighting
                this.selectedService = serviceToSelect.id;

                // Auto-select first location from this service
                if (serviceToSelect.locations && serviceToSelect.locations.length > 0) {
                    const firstLocation = serviceToSelect.locations[0];
                    this.selectedLocation = firstLocation.location.id;

                    // Store the location-specific service ID for optimization
                    this.selectedServiceSpecific = firstLocation.service_id;

                    // Update state with location-specific service ID (for optimization)
                    if (!store.state.column3) {
                        store.state.column3 = {};
                    }
                    store.state.column3.selectedService = this.selectedServiceSpecific;
                    store.state.column3.selectedLocation = this.selectedLocation;

                    // Get ALL regions for the first location (locations can have multiple regions)
                    const locationRegions = firstLocation.location.regions && firstLocation.location.regions.length > 0
                        ? firstLocation.location.regions
                        : [this.selectedLocation];

                    console.log('Auto-selected service (grouped):', this.selectedService, '(specific):', this.selectedServiceSpecific, 'location:', this.selectedLocation);

                    // Return the selected service and location regions for batched notification
                    return {
                        serviceId: this.selectedServiceSpecific,  // Use specific ID for optimization
                        locationId: locationRegions  // Pass array of regions
                    };
                }
            }

            return null;

        } catch (error) {
            console.error('Failed to load services for recipe:', error);
            api.showError('Failed to load services');
            return null;
        }
    }

    /**
     * Handle service selection change
     */
    async onServiceChange() {
        const selectedSvc = store.state.column3?.selectedService;
        if (selectedSvc !== this.selectedService) {
            this.selectedService = selectedSvc;

            // Auto-select first location when service changes
            if (this.selectedService) {
                try {
                    const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
                    const service = response.services.find(s => s.id === this.selectedService);
                    if (service && service.locations && service.locations.length > 0) {
                        const firstLocation = service.locations[0];
                        this.selectedLocation = firstLocation.location.id;
                        store.state.column3.selectedLocation = this.selectedLocation;
                        store._notifySubscribers('column3.selectedLocation');
                    }
                } catch (error) {
                    console.error('Failed to load service details:', error);
                }
            }

            this.render();
        }
    }

    /**
     * Handle location selection change
     */
    onLocationChange() {
        const selectedLoc = store.state.column3?.selectedLocation;
        if (selectedLoc !== this.selectedLocation) {
            this.selectedLocation = selectedLoc;
            this.render();
        }
    }

    /**
     * Handle fine materials checkbox change
     */
    onFineChange() {
        const useFine = store.state.column3?.useFine || false;
        if (useFine !== this.useFine) {
            this.useFine = useFine;
            this.render();
        }
    }

    /**
     * Handle gearset change (recalculate stats)
     */
    onGearsetChange() {
        if (this.recipe) {
            this.render();
        }
    }

    /**
     * Toggle section expanded/collapsed
     */
    toggleExpanded() {
        this.isExpanded = !this.isExpanded;

        const $content = this.$element.find('.recipe-info-content');
        const $arrow = this.$element.find('.recipe-info-header .expand-arrow');

        if (this.isExpanded) {
            $arrow.addClass('expanded');
            $content.slideDown(200);
        } else {
            $arrow.removeClass('expanded');
            $content.slideUp(200);
        }
    }

    /**
     * Select a service
     * Requirements: 3.19
     * @param {string} serviceId - Service ID (grouped)
     */
    async selectService(serviceId) {
        // Store grouped service ID for UI highlighting
        this.selectedService = serviceId;

        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }

        // Don't notify subscribers here - will cause premature renders

        // Auto-select first location and use its location-specific service ID
        let locationRegions = null;
        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            const service = response.services.find(s => s.id === serviceId);
            if (service && service.locations && service.locations.length > 0) {
                const firstLocation = service.locations[0];
                this.selectedLocation = firstLocation.location.id;

                // Store location-specific service ID for optimization
                this.selectedServiceSpecific = firstLocation.service_id;

                // Update state with location-specific ID (for optimization)
                store.state.column3.selectedService = this.selectedServiceSpecific;
                store.state.column3.selectedLocation = this.selectedLocation;

                console.log('Selected service (grouped):', this.selectedService, '(specific):', this.selectedServiceSpecific);

                // Get ALL regions for the first location (locations can have multiple regions)
                locationRegions = firstLocation.location.regions && firstLocation.location.regions.length > 0
                    ? firstLocation.location.regions
                    : [this.selectedLocation];

                console.log('Auto-selected first location:', this.selectedLocation, 'regions:', locationRegions);
            }
        } catch (error) {
            console.error('Failed to load service details:', error);
        }

        // Notify Column 2 with batched update (service + location)
        // This prevents multiple renders and duplicate contributors
        // Requirements: 7.3, 7.4
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setRecipeContext === 'function') {
            await combinedStatsSection.setRecipeContext(
                this.recipe.id,
                this.selectedServiceSpecific || serviceId,  // Use specific ID if available
                locationRegions  // Pass array of regions
            );
        }

        // Don't call render() here - Column 2 callback will handle it
    }

    /**
     * Select a location
     * Requirements: 3.21
     * @param {string} locationId - Location ID
     * @param {string} serviceId - Service ID for this location (location-specific, may differ from generic service ID)
     */
    async selectLocation(locationId, serviceId) {
        console.log('=== selectLocation() called ===');
        console.log('locationId:', locationId);
        console.log('serviceId (location-specific):', serviceId);

        this.selectedLocation = locationId;

        // Store location-specific service ID for optimization
        this.selectedServiceSpecific = serviceId;

        // Update state with location-specific service ID
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.selectedLocation = locationId;
        store.state.column3.selectedService = serviceId;  // Store location-specific ID for optimization
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.selectedLocation = locationId;
        store.state.column3.selectedService = serviceId;  // Store location-specific service ID

        // Don't notify subscribers here - Column 2's callback will trigger Column 3 render
        // Notifying here would cause a double render

        // Get the region for this location to pass to Column 2
        // We need to fetch the location data to get its regions
        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            let locationRegions = null;

            // Find the location in any service's locations
            for (const service of response.services) {
                if (service.locations) {
                    const locationData = service.locations.find(loc => loc.location.id === locationId);
                    if (locationData && locationData.location.regions && locationData.location.regions.length > 0) {
                        // Get ALL regions (locations can have multiple regions)
                        locationRegions = locationData.location.regions;
                        console.log('Found regions for location:', locationRegions);
                        break;
                    }
                }
            }

            // Notify Column 2 of location change with regions
            // Requirements: 7.4
            this.notifyColumn2LocationChange(locationRegions || [locationId]);
        } catch (error) {
            console.error('Failed to get location regions:', error);
            // Fall back to location ID
            this.notifyColumn2LocationChange([locationId]);
        }

        // Don't call render() here - Column 2 callback will handle it
        // This prevents race conditions between multiple renders
        console.log('Location selected, waiting for Column 2 callback to trigger render');
    }

    /**
     * Select a material group
     * Requirements: 3.9
     * @param {number} index - Material group index
     */
    selectMaterialGroup(index) {
        this.selectedMaterialGroup = index;
        this.render();
    }

    /**
     * Toggle fine materials checkbox
     * Requirements: 3.4
     * @param {boolean} useFine - Whether to use fine materials
     */
    toggleFine(useFine) {
        this.useFine = useFine;

        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.useFine = useFine;

        // Notify subscribers
        store._notifySubscribers('column3.useFine');

        this.render();
    }

    /**
     * Get skill color for borders
     * Uses the same colors as Column 1 skill section
     * @param {string} skill - Skill name
     * @returns {string} CSS color value
     */
    getSkillColor(skill) {
        const skillColors = {
            'Fishing': '#60DAEF',
            'Foraging': '#ABD3A1',
            'Mining': '#8CA4D4',
            'Woodcutting': '#5EF06B',
            'Carpentry': '#F18C62',
            'Cooking': '#F0AD5F',
            'Crafting': '#E9487C',
            'Smithing': '#E2A6A6',
            'Trinketry': '#FEE0AC',
            'Agility': '#F05FBE',
            'Traveling': '#00BCD4'
        };

        return skillColors[skill] || '#666';
    }

    /**
     * Check if recipe can use fine materials
     * Requirements: 3.3
     * @returns {boolean} True if recipe uses only materials/consumables
     */
    canUseFine() {
        if (!this.recipe) {
            return false;
        }

        return this.recipe.has_fine_option;
    }

    /**
     * Calculate current stats with gear bonuses
     * Requirements: 3.11
     * @returns {Object} Calculated stats
     */
    calculateCurrentStats() {
        if (!this.recipe) {
            return null;
        }

        // Get gear stats from current gearset
        const gearStats = this.getGearStats();

        // Calculate steps per action using corrected formula
        const baseSteps = this.recipe.base_steps;
        const maxEfficiency = this.recipe.max_efficiency;
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

        // Calculate materials per craft
        const dr = gearStats.double_rewards || 0;
        const nmc = gearStats.no_materials_consumed || 0;
        const craftsPerMaterial = (1 + dr) / (1 - nmc);
        const materialsPerCraft = 1 / craftsPerMaterial;

        // Calculate steps per reward roll
        const rewardRollsPerCompletion = (1 + da) * (1 + dr);
        const stepsPerRewardRoll = stepsPerSingleAction / rewardRollsPerCompletion;

        // Calculate XP with bonuses from gear
        // Get bonus XP from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};

        const baseXP = this.recipe.base_xp;

        // Apply fine materials bonus (75% more XP)
        const fineBonus = this.useFine ? 0.75 : 0;

        // Apply bonus XP modifiers
        const bonusXPAdd = column2Stats.bonus_xp_add || column2Stats.bonus_experience_add || 0;
        const bonusXPPercent = (column2Stats.bonus_xp_percent || column2Stats.bonus_experience_percent || 0) / 100;

        // Calculate XP per action: (base * (1 + fine_bonus) + add) * (1 + percent)
        const calculatedXP = (baseXP * (1 + fineBonus) + bonusXPAdd) * (1 + bonusXPPercent);

        // Calculate XP per step for display
        // xp_per_step = xp_per_action * (1 + da) / current_steps
        const actionsPerCompletion = 1 + da;
        const xpPerStep = (calculatedXP * actionsPerCompletion) / stepsPerSingleAction;

        return {
            baseSteps: baseSteps,
            currentSteps: stepsPerSingleAction,  // Steps per single action (without DA)
            expectedSteps: expectedStepsPerAction,  // Expected steps with DA (for calculations)
            stepsPerRewardRoll: stepsPerRewardRoll,  // For drop calculations and display
            currentWE: we,
            maxWE: maxEfficiency,
            baseXP: baseXP,
            calculatedXP: calculatedXP,
            xpPerStep: xpPerStep.toFixed(3),  // Always show 3 decimals
            craftsPerMaterial: craftsPerMaterial.toFixed(3).replace(/\.?0+$/, ''),
            materialsPerCraft: materialsPerCraft.toFixed(3).replace(/\.?0+$/, ''),
            gearStats: gearStats
        };
    }

    /**
     * Get gear stats for the selected recipe and location
     * Requirements: 3.11, 3.22, 3.23, 3.24
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
                quality_outcome: 0,
                flat_steps: 0,
                percent_steps: 0
            };
        }

        // Get the cached stats from Column 2
        const stats = combinedStatsSection.cachedStats || {};

        // Extract relevant stats for recipes
        return {
            work_efficiency: (stats.work_efficiency || 0) / 100,  // Convert from percentage to decimal
            double_action: (stats.double_action || 0) / 100,
            double_rewards: (stats.double_rewards || 0) / 100,
            no_materials_consumed: (stats.no_materials_consumed || 0) / 100,
            quality_outcome: stats.quality_outcome || 0,  // QO is not a percentage
            flat_steps: stats.flat_steps || stats.steps_add || 0,
            percent_steps: (stats.steps_percent || stats.steps_pct || 0) / 100
        };
    }

    /**
     * Calculate level bonus for work efficiency
     * Requirements: 7.6
     * @returns {number} WE bonus percentage
     */
    calculateLevelBonusWE() {
        if (!this.recipe) {
            return 0;
        }

        const character = store.state.character || {};
        const skill = this.recipe.skill.toLowerCase();
        const charLevel = character.skills?.[skill] || 0;
        const requiredLevel = this.recipe.level || 1;

        const levelsAbove = Math.max(0, charLevel - requiredLevel);
        const bonus = Math.min(levelsAbove * 1.25, 25);

        return bonus;
    }

    /**
     * Calculate level bonus for quality outcome
     * Requirements: 7.6
     * @returns {number} QO bonus (no cap)
     */
    calculateLevelBonusQO() {
        if (!this.recipe) {
            return 0;
        }

        const character = store.state.character || {};
        const skill = this.recipe.skill.toLowerCase();
        const charLevel = character.skills?.[skill] || 0;
        const requiredLevel = this.recipe.level || 1;

        const levelsAbove = Math.max(0, charLevel - requiredLevel);
        return levelsAbove;
    }

    /**
     * Calculate quality weights based on recipe level and quality outcome bonus
     * Ported from util/quality_outcome.py
     * @param {number} recipeLevel - Recipe level requirement
     * @param {number} qualityOutcome - Total quality outcome bonus
     * @param {boolean} useFine - Whether fine materials are being used (shifts quality up by 1 tier)
     * @returns {Object} Object with weights, percentages, and total_weight
     */
    calculateQualityWeights(recipeLevel, qualityOutcome, useFine = false) {
        // Starting weights
        const startingWeights = {
            'Normal': 1000.0,
            'Good': 200.0,
            'Great': 50.0,
            'Excellent': 10.0,
            'Perfect': 2.5,
            'Eternal': 0.05
        };

        // Minimum weights
        const minimumWeights = {
            'Normal': 4.0,
            'Good': 4.0,
            'Great': 4.0,
            'Excellent': 4.0,
            'Perfect': 2.0,
            'Eternal': 0.05
        };

        // Band starts (fixed)
        const bandStarts = {
            'Normal': 0,
            'Good': 100,
            'Great': 200,
            'Excellent': 300,
            'Perfect': 400,
            'Eternal': 500
        };

        // Calculate band ends
        const bandEnds = {};
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
        qualities.forEach((quality, i) => {
            bandEnds[quality] = (100 + recipeLevel) * (i + 1);
        });

        // Calculate new weights
        const calculatedWeights = {};

        // Process from highest to lowest quality to handle the "never rarer than higher quality" rule
        const qualitiesReversed = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];

        for (const quality of qualitiesReversed) {
            const bandStart = bandStarts[quality];
            const bandEnd = bandEnds[quality];
            const startingWeight = startingWeights[quality];
            const minimumWeight = minimumWeights[quality];

            let newWeight;
            if (qualityOutcome <= bandStart) {
                // QO is below band start, keep starting weight
                newWeight = startingWeight;
            } else {
                // Calculate slope
                const slope = (startingWeight - minimumWeight) / (bandStart - bandEnd);

                // Calculate new weight
                newWeight = startingWeight + (slope * (qualityOutcome - bandStart));

                // Take max of minimum weight and calculated weight
                newWeight = Math.max(minimumWeight, newWeight);
            }

            // Ensure this quality is never rarer than the next higher quality
            if (quality !== 'Eternal') {
                const nextQualityIndex = qualitiesReversed.indexOf(quality) - 1;
                const nextQuality = qualitiesReversed[nextQualityIndex];
                if (calculatedWeights[nextQuality] !== undefined) {
                    newWeight = Math.max(newWeight, calculatedWeights[nextQuality]);
                }
            }

            calculatedWeights[quality] = newWeight;
        }

        // Apply fine materials shift: everything moves up one tier
        if (useFine) {
            const shiftedWeights = {
                'Good': calculatedWeights['Normal'],      // Normal → Good
                'Great': calculatedWeights['Good'],       // Good → Great
                'Excellent': calculatedWeights['Great'],  // Great → Excellent
                'Perfect': calculatedWeights['Excellent'], // Excellent → Perfect
                'Eternal': calculatedWeights['Perfect'] + calculatedWeights['Eternal'], // Perfect + Eternal → Eternal
                'Normal': 0.0  // Normal becomes impossible
            };
            Object.assign(calculatedWeights, shiftedWeights);
        }

        // Calculate percentages
        const totalWeight = Object.values(calculatedWeights).reduce((sum, w) => sum + w, 0);
        const percentages = {};
        for (const [quality, weight] of Object.entries(calculatedWeights)) {
            percentages[quality] = (weight / totalWeight) * 100.0;
        }

        return {
            weights: calculatedWeights,
            percentages: percentages,
            total_weight: totalWeight
        };
    }

    /**
     * Calculate crafting odds
     * Requirements: 3.22, 3.23, 3.24
     * @returns {Array} Array of quality odds with percentages
     */
    calculateCraftingOdds() {
        if (!this.recipe) {
            return [];
        }

        // Get total QO from gear + level bonus (Column 2 already includes level bonus)
        const gearStats = this.getGearStats();
        const qo = gearStats.quality_outcome || 0;

        // Check if using fine materials
        const useFine = this.useFine && this.canUseFine();

        // Calculate quality weights using the actual formula
        const result = this.calculateQualityWeights(this.recipe.level, qo, useFine);

        // Get crafts per material from calculator section
        const stats = this.calculateCurrentStats();
        const craftsPerMaterial = stats ? stats.craftsPerMaterial : 1.0;

        // Build odds array
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
        const odds = [];

        for (const quality of qualities) {
            const percentage = result.percentages[quality];
            const avgCrafts = percentage > 0 ? 100.0 / percentage : 0;
            const avgMats = percentage > 0 ? avgCrafts / craftsPerMaterial : 0;

            odds.push({
                quality: quality,
                chance: percentage,
                avgCrafts: avgCrafts,
                avgMats: avgMats
            });
        }

        return odds;
    }

    /**
     * Render fine materials checkbox
     * Requirements: 3.3, 3.4, 3.6
     * @returns {string} HTML for fine checkbox
     */
    renderFineCheckbox() {
        if (!this.canUseFine()) {
            return '';
        }

        return `
            <div class="recipe-section">
                <label class="fine-checkbox">
                    <input type="checkbox" ${this.useFine ? 'checked' : ''} />
                    <span class="fine-checkbox-label">Fine Materials</span>
                </label>
            </div>
        `;
    }

    /**
     * Render material group selector
     * Requirements: 3.8
     * @returns {string} HTML for material group selector
     */
    renderMaterialGroupSelector() {
        if (!this.recipe || !this.recipe.materials || this.recipe.materials.length <= 1) {
            return '';
        }

        let html = `
            <div class="material-group-selector">
        `;

        for (let i = 0; i < this.recipe.materials.length; i++) {
            const selectedClass = i === this.selectedMaterialGroup ? 'selected' : '';
            html += `
                <button class="material-group-button ${selectedClass}" data-group-index="${i}">
                    Group ${i + 1}
                </button>
            `;
        }

        html += `
            </div>
        `;

        return html;
    }

    /**
     * Render materials section
     * Requirements: 3.7, 3.8, 3.9, 3.10, 3.11
     * @returns {string} HTML for materials section
     */
    renderMaterialsSection() {
        if (!this.recipe || !this.recipe.materials || this.recipe.materials.length === 0) {
            return '';
        }

        const selectedGroup = this.recipe.materials[this.selectedMaterialGroup] || this.recipe.materials[0];
        const fineClass = (this.useFine && this.canUseFine()) ? 'material-fine' : '';

        let html = `
            <div class="recipe-section">
                <div class="section-header">MATERIALS</div>
                ${this.renderMaterialGroupSelector()}
                <div class="materials-grid">
        `;

        for (const material of selectedGroup) {
            // Build icon path based on material type
            // Use material_icon_name which preserves apostrophes
            const iconName = material.material_icon_name || material.material_id;
            let iconPath = '';
            if (material.type === 'material') {
                iconPath = `/assets/icons/items/materials/${iconName}.svg`;
            } else if (material.type === 'consumable') {
                iconPath = `/assets/icons/items/consumables/${iconName}.svg`;
            } else if (material.type === 'equipment') {
                iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
            }

            html += `
                <div class="material-item ${fineClass}" title="${material.material_name}">
                    <img src="${iconPath}" alt="${material.material_name}" class="material-icon" />
                    <span class="material-quantity">${material.quantity}</span>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Render recipe stats section
     * Requirements: 3.11
     * @returns {string} HTML for stats section
     */
    renderStatsSection() {
        const stats = this.calculateCurrentStats();
        if (!stats) {
            return '';
        }

        // Get WE directly from Column 2 (already includes level bonus)
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};
        const currentWEPercent = column2Stats.work_efficiency || 0;  // Already in percentage format
        const maxWEPercent = this.recipe.max_efficiency * 100;

        // Format WE - show 2 decimals if needed, otherwise 1 or 0
        const currentWEFormatted = (currentWEPercent % 1 === 0)
            ? currentWEPercent.toFixed(0)
            : (currentWEPercent % 0.1 < 0.01)
                ? currentWEPercent.toFixed(1)
                : currentWEPercent.toFixed(2);
        const maxWEFormatted = (maxWEPercent % 1 === 0) ? maxWEPercent.toFixed(0) : maxWEPercent.toFixed(1);

        // Check if WE exceeds or equals max (for green highlighting)
        const weExceedsMax = currentWEPercent >= maxWEPercent;
        const weClass = weExceedsMax ? 'stat-value-positive' : 'stat-value';
        const weRowClass = weExceedsMax ? 'we-maxed' : '';

        // Get skill icon and color
        const skillId = this.recipe.skill.toLowerCase();
        const skillIcon = `/assets/icons/text/skill_icons/${skillId}.svg`;
        const skillColor = this.getSkillColor(this.recipe.skill);

        return `
            <div class="recipe-stats-container">
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">CRAFT</div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Steps per Craft" />
                        <span class="stat-value">${stats.stepsPerRewardRoll.toFixed(2)}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">ACTION</div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Steps per Action" />
                        <span class="stat-value">${stats.currentSteps} / ${stats.baseSteps}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">WORK EFFICIENCY</div>
                    <div class="info-stat-row ${weRowClass}">
                        <img src="/assets/icons/attributes/work_efficiency.svg" alt="WE" class="stat-icon" title="Work Efficiency" />
                        <span class="${weClass}">${currentWEFormatted} / ${maxWEFormatted}%</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">LEVEL</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${this.recipe.skill}" class="stat-icon" title="${this.recipe.skill} Level Required" />
                        <span class="stat-value">${this.recipe.level}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">XP</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${this.recipe.skill} XP" class="stat-icon" title="${this.recipe.skill} Experience" />
                        <span class="stat-value">${stats.calculatedXP.toFixed(2).replace(/\.?0+$/, '')} / ${stats.baseXP.toFixed(2).replace(/\.?0+$/, '')}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">XP / STEP</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${this.recipe.skill} XP/Step" class="stat-icon" title="${this.recipe.skill} XP per Step" />
                        <span class="stat-value">${stats.xpPerStep}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">CRAFTS / MAT</div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/double_rewards.svg" alt="DR" class="stat-icon" title="Crafts per Material" />
                        <span class="stat-value">${stats.craftsPerMaterial}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render services section
     * Requirements: 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19
     * @returns {string} HTML for services section
     */
    async renderServicesSection() {
        if (!this.recipe) {
            return '';
        }

        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);

            let html = `
                <div class="recipe-section">
                    <div class="section-header">SERVICES</div>
                    <div class="services-grid">
            `;

            for (const service of response.services) {
                const isSelected = service.id === this.selectedService;
                const selectedClass = isSelected ? 'service-selected' : '';
                const lockedClass = !service.is_unlocked ? 'service-locked' : '';

                // Build display name with tier suffix for named services
                let displayName = service.name;
                let iconName = service.name.replace(/ /g, '_').toLowerCase();  // Replace spaces and lowercase

                if (!service.name.toLowerCase().startsWith('basic') && service.is_basic) {
                    displayName += ' (Basic)';
                    iconName += '_(basic)';  // e.g., "alight_kitchen_(basic)"
                } else if (service.is_advanced) {
                    displayName += ' (Advanced)';
                    iconName += '_(advanced)';  // e.g., "cursed_sawmill_(advanced)"
                }

                // Build service icon path using the icon name (lowercase)
                const serviceIcon = `/assets/icons/services/${iconName}.svg`;

                html += `
                    <div class="service-item ${selectedClass} ${lockedClass}" data-service-id="${service.id}">
                        <img src="${serviceIcon}" alt="${service.name}" class="service-icon" />
                        <span class="service-name">${displayName}</span>
                `;

                // Show missing requirements if locked and selected
                if (!service.is_unlocked && isSelected && service.missing_requirements.length > 0) {
                    html += `
                        <div class="service-requirements">
                            ${service.missing_requirements.map(req => `<div class="requirement-missing">${req}</div>`).join('')}
                        </div>
                    `;
                }

                html += `
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;

            return html;

        } catch (error) {
            console.error('Failed to render services section:', error);
            return '';
        }
    }

    /**
     * Render locations section
     * Requirements: 3.20, 3.21
     * @returns {string} HTML for locations section
     */
    async renderLocationsSection() {
        console.log('=== renderLocationsSection() called ===');
        console.log('this.selectedService:', this.selectedService);
        console.log('this.selectedLocation:', this.selectedLocation);

        if (!this.selectedService) {
            console.log('No selected service, returning empty');
            return '';
        }

        try {
            // Get services to find the selected service's locations
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            console.log('Services response:', response);
            console.log('Services array:', response.services);
            console.log('Service IDs:', response.services.map(s => s.id));

            // The selectedService might be location-specific (e.g., "basic_workshop_halfling_campgrounds")
            // but the API returns generic service IDs (e.g., "basic_workshop")
            // We need to find the service that matches, either exactly or by checking if any location matches
            let service = response.services.find(s => s.id === this.selectedService);

            // If not found by exact match, try to find by checking if any location's service_id matches
            if (!service) {
                service = response.services.find(s =>
                    s.locations && s.locations.some(loc => loc.service_id === this.selectedService)
                );
            }

            console.log('Looking for service with ID:', this.selectedService);
            console.log('Found service:', service);

            if (!service || !service.locations || service.locations.length === 0) {
                console.log('Service has no locations, returning empty');
                return '';
            }

            console.log('Rendering', service.locations.length, 'locations');

            let html = `
                <div class="recipe-section">
                    <div class="section-header">LOCATIONS</div>
                    <div class="locations-grid">
            `;

            for (const locationData of service.locations) {
                const location = locationData.location;
                const isSelected = location.id === this.selectedLocation;
                const selectedClass = isSelected ? 'location-selected' : '';

                // Use icon_name from location data if available, otherwise fall back to location id
                const iconPath = location.icon_name
                    ? `/assets/icons/locations/${location.icon_name}`
                    : `/assets/icons/locations/${location.id}.svg`;

                html += `
                    <div class="location-item ${selectedClass}" data-location-id="${location.id}" data-service-id="${locationData.service_id}">
                        <img src="${iconPath}" alt="${location.name}" class="location-icon" />
                        <span class="location-name">${location.name}</span>
                    </div>
                `;
            }

            html += `
                    </div>
                </div>
            `;

            console.log('Locations HTML generated, length:', html.length);
            return html;

        } catch (error) {
            console.error('Failed to render locations section:', error);
            return '';
        }
    }

    /**
     * Render crafting odds table
     * Requirements: 3.22, 3.23, 3.24
     * @returns {string} HTML for crafting odds table
     */
    renderCraftingOddsTable() {
        if (!this.recipe) {
            return '';
        }

        // Only show crafting odds for items with qualities (crafted items)
        // Check if output_item is an Item (equipment) - materials and consumables don't have qualities
        const outputItem = this.recipe.output_item || '';

        // If output is Material.* or Consumable.*, don't show crafting odds
        if (outputItem.startsWith('Material.') || outputItem.startsWith('Consumable.')) {
            return '';
        }

        const odds = this.calculateCraftingOdds();
        if (odds.length === 0) {
            return '';
        }

        // Map quality names to rarity CSS variables
        const qualityToRarity = {
            'Normal': 'common',
            'Good': 'uncommon',
            'Great': 'rare',
            'Excellent': 'epic',
            'Perfect': 'legendary',
            'Eternal': 'ethereal'
        };

        let html = `
            <div class="recipe-section">
                <div class="section-header">CRAFTING ODDS</div>
                <table class="crafting-odds-table">
                    <thead>
                        <tr>
                            <th>Quality</th>
                            <th>Chance</th>
                            <th>Avg. Crafts</th>
                            <th>Avg. Mats</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const odd of odds) {
            const rarity = qualityToRarity[odd.quality] || 'common';
            // Format numbers, removing trailing zeros
            const chance = parseFloat(odd.chance.toFixed(2)).toString();
            const avgCrafts = parseFloat(odd.avgCrafts.toFixed(1)).toString();
            const avgMats = parseFloat(odd.avgMats.toFixed(1)).toString();

            html += `
                <tr class="quality-row-${rarity}">
                    <td class="quality-cell quality-cell-${rarity}">${odd.quality}</td>
                    <td class="number-cell">${chance}%</td>
                    <td class="number-cell">${avgCrafts}</td>
                    <td class="number-cell">${avgMats}</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;

        return html;
    }

    /**
     * Render the component
     * Requirements: 3.1, 3.2
     */
    async render() {
        // Use render queue to allow latest render to proceed
        if (!this._renderQueue) {
            this._renderQueue = [];
        }

        const renderTimestamp = Date.now();
        this._renderQueue.push(renderTimestamp);

        console.log('=== RecipeInfo render() called ===');
        console.log('recipe:', this.recipe?.name);
        console.log('selectedService:', this.selectedService);
        console.log('selectedLocation:', this.selectedLocation);
        console.log('render ID:', renderTimestamp);

        if (!this.recipe) {
            // Only apply if this is still the latest render
            if (this._renderQueue[this._renderQueue.length - 1] === renderTimestamp) {
                this.$element.html('');
            }
            // Remove this render from queue
            const index = this._renderQueue.indexOf(renderTimestamp);
            if (index > -1) {
                this._renderQueue.splice(index, 1);
            }
            return;
        }

        try {
            const skillColor = this.getSkillColor(this.recipe.skill);
            const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;

            // Check if WE exceeds max for green border
            const combinedStatsSection = window.combinedStatsSection;
            const column2Stats = combinedStatsSection?.cachedStats || {};
            const currentWEPercent = column2Stats.work_efficiency || 0;
            const maxWEPercent = this.recipe.max_efficiency * 100;
            const weExceedsMax = currentWEPercent >= maxWEPercent;

            // Render services section asynchronously
            const servicesHtml = await this.renderServicesSection();

            // Check if this render is still the latest before continuing
            if (this._renderQueue[this._renderQueue.length - 1] !== renderTimestamp) {
                console.log('RecipeInfo render() cancelled (newer render exists), render ID:', renderTimestamp);
                return;
            }

            const locationsHtml = await this.renderLocationsSection();

            // Check again after async operation
            if (this._renderQueue[this._renderQueue.length - 1] !== renderTimestamp) {
                console.log('RecipeInfo render() cancelled (newer render exists), render ID:', renderTimestamp);
                return;
            }

            const contentHtml = `
                ${this.renderFineCheckbox()}
                ${this.renderMaterialsSection()}
                ${this.renderStatsSection()}
                ${servicesHtml}
                ${locationsHtml}
                ${this.renderCraftingOddsTable()}
            `;

            const html = `
                <div class="recipe-info-section " style="border-color: ${skillColor};">
                    <div class="recipe-info-header">
                        <span class="recipe-info-title">${this.recipe.name.toUpperCase()}</span>
                        ${arrowIcon}
                    </div>
                    <div class="recipe-info-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                        ${contentHtml}
                    </div>
                </div>
            `;

            // Only apply if this is still the latest render
            if (this._renderQueue[this._renderQueue.length - 1] === renderTimestamp) {
                this.$element.html(html);
                this.attachEvents();
                console.log('RecipeInfo render() complete, render ID:', renderTimestamp);
            } else {
                console.log('RecipeInfo render() cancelled (newer render exists), render ID:', renderTimestamp);
            }
        } catch (error) {
            console.error('RecipeInfo render() error:', error);
        } finally {
            // Remove this render from queue
            const index = this._renderQueue.indexOf(renderTimestamp);
            if (index > -1) {
                this._renderQueue.splice(index, 1);
            }
        }
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers
        this.$element.off('click');
        this.$element.off('change');

        // Collapse toggle - make entire header clickable
        this.$element.on('click', '.recipe-info-header', (e) => {
            e.stopPropagation();
            this.toggleExpanded();
        });

        // Fine materials checkbox
        this.$element.on('change', '.fine-checkbox input', (e) => {
            e.stopPropagation();
            this.toggleFine(e.target.checked);
        });

        // Material group selector
        this.$element.on('click', '.material-group-button', (e) => {
            e.stopPropagation();
            const index = parseInt($(e.currentTarget).data('group-index'));
            this.selectMaterialGroup(index);
        });

        // Service selection
        this.$element.on('click', '.service-item', (e) => {
            e.stopPropagation();
            const serviceId = $(e.currentTarget).data('service-id');
            this.selectService(serviceId);
        });

        // Location selection
        this.$element.on('click', '.location-item', (e) => {
            e.stopPropagation();
            const locationId = $(e.currentTarget).data('location-id');
            const serviceId = $(e.currentTarget).data('service-id');
            this.selectLocation(locationId, serviceId);
        });
    }

    /**
     * Notify Column 2 of recipe change
     * Requirements: 7.2
     * @param {Object|null} recipe - Recipe object or null
     */
    notifyColumn2RecipeChange(recipe) {
        // Find Column 2 combined stats section
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setActivity === 'function') {
            // For recipes, we use setActivity with recipe ID
            combinedStatsSection.setActivity(recipe ? recipe.id : null);
        }
    }

    /**
     * Notify Column 2 of service change
     * Requirements: 7.3
     * @param {string|null} serviceId - Service ID or null
     */
    notifyColumn2ServiceChange(serviceId) {
        console.log('=== notifyColumn2ServiceChange() called ===');
        console.log('serviceId:', serviceId);

        // Find Column 2 combined stats section
        const combinedStatsSection = window.combinedStatsSection;
        console.log('window.combinedStatsSection:', combinedStatsSection);
        console.log('Has setService method?', typeof combinedStatsSection?.setService);

        if (combinedStatsSection && typeof combinedStatsSection.setService === 'function') {
            console.log('✓ Calling combinedStatsSection.setService()');
            combinedStatsSection.setService(serviceId);
        } else {
            console.warn('✗ combinedStatsSection or setService not available');
        }
    }

    /**
     * Notify Column 2 of location change
     * Requirements: 7.4
     * @param {string|null} locationId - Location ID or null
     */
    notifyColumn2LocationChange(locationId) {
        console.log('=== notifyColumn2LocationChange() called ===');
        console.log('locationId:', locationId);

        // Find Column 2 combined stats section
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setLocation === 'function') {
            console.log('✓ Calling combinedStatsSection.setLocation()');
            combinedStatsSection.setLocation(locationId);
        } else {
            console.warn('✗ combinedStatsSection or setLocation not available');
        }
    }
}

export default RecipeInfoSection;
