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
import { getInstantActionsPet, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';
import { getPetIconPath } from '../utils/pet-utils.js';
import { wireInfoIcons } from '../info-popover.js';

import { formatFixed } from '../utils/number-format.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';

const SKILL_ICON_FALLBACK = {
    'traveling': '🧭',
};

function skillIconHtml(skillName, cssClass = 'stat-icon') {
    const skillId = skillName.toLowerCase().replace(' ', '_');
    const fallback = SKILL_ICON_FALLBACK[skillId];
    if (fallback) return `<span class="${cssClass}" style="font-size:18px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px" title="${skillName}">${fallback}</span>`;
    return `<img src="/assets/icons/text/skill_icons/${skillId}.svg" alt="${skillName}" class="${cssClass}" title="${skillName}" />`;
}

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
        this.showGenericServices = store.state.column3?.showGenericServices ?? false;
        this.showGenericServicesCommunity = store.state.column3?.showGenericCommunity ?? false;

        // Subscribe to state changes
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.selectedService', () => this.onServiceChange());
        this.subscribe('column3.selectedLocation', () => this.onLocationChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());
        // Re-render when instant-actions checkbox changes
        this.subscribe('ui.instant_actions_smelting', () => { if (this.recipe) this.render(); });

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

        // Handle generic recipes — fetch from generic endpoint
        if (selectedId === 'generic') {
            // "generic" without ID means the form is open but nothing saved yet
            this.recipe = null;
            this.render();
            return;
        }
        if (selectedId.startsWith('generic::')) {
            try {
                const defId = selectedId.replace('generic::', '');
                const data = await api.getGenericDefinitionView(defId);
                if (data && data.type === 'recipe') {
                    this.recipe = data;
                    this.selectedMaterialGroup = 0;
                    this.useFine = store.state.column3?.useFine || false;

                    // Load services for the skill and auto-select
                    const savedService = data.service_id || store.state.column3?.selectedService;
                    const savedLocation = store.state.column3?.selectedLocation;

                    try {
                        const svcResponse = await $.get('/api/services');
                        const skill = (data.skill || '').toLowerCase();
                        const skillServices = (svcResponse.services || []).filter(svc =>
                            (svc.category || '').toLowerCase() === skill
                        );

                        // Deduplicate by name+tier
                        const seen = new Map();
                        for (const svc of skillServices) {
                            const key = `${svc.name}::${svc.tier || ''}`;
                            if (!seen.has(key)) {
                                seen.set(key, { ...svc, locations: [] });
                            }
                            if (svc.location) {
                                seen.get(key).locations.push({ location: svc.location, service_id: svc.id });
                            }
                        }
                        const grouped = Array.from(seen.values());

                        // Try to restore saved service, otherwise auto-select first
                        let selectedSvc = null;
                        if (savedService) {
                            selectedSvc = grouped.find(s => s.id === savedService ||
                                s.locations?.some(l => l.service_id === savedService));
                        }
                        if (!selectedSvc && grouped.length > 0) {
                            selectedSvc = grouped[0];
                        }

                        if (selectedSvc) {
                            this.selectedService = selectedSvc.id;
                            // Auto-select first location
                            if (selectedSvc.locations && selectedSvc.locations.length > 0) {
                                const loc = savedLocation
                                    ? selectedSvc.locations.find(l => l.location.id === savedLocation) || selectedSvc.locations[0]
                                    : selectedSvc.locations[0];
                                this.selectedLocation = loc.location.id;
                                this.selectedServiceSpecific = loc.service_id;
                                store.state.column3.selectedService = this.selectedServiceSpecific;
                                store.state.column3.selectedLocation = this.selectedLocation;
                            }
                        }
                    } catch (e) {
                        console.error('Failed to load services for generic recipe:', e);
                    }

                    // Notify Column 2
                    const combinedStatsSection = window.combinedStatsSection;
                    if (combinedStatsSection && typeof combinedStatsSection.setRecipeContext === 'function') {
                        const locationRegions = this.selectedLocation ? [this.selectedLocation] : null;
                        await combinedStatsSection.setRecipeContext(
                            data.id,
                            this.selectedServiceSpecific || this.selectedService || null,
                            locationRegions
                        );
                    }

                    store._saveColumn3Selection();
                    return;
                }
            } catch (error) {
                console.error('Failed to load generic recipe:', error);
            }
            return;
        }

        // Fetch recipe details from cached data (already loaded by dropdown)
        try {
            // Use cached recipes data from the dropdown instead of re-fetching
            const recipeDropdown = window.recipeSelector;
            const cachedData = recipeDropdown?.recipesData;
            const response = cachedData || await $.get('/api/recipes');

            // Find recipe by ID
            for (const recipes of Object.values(response.by_skill)) {
                const recipe = recipes.find(r => r.id === selectedId);
                if (recipe) {
                    this.recipe = recipe;
                    this.selectedMaterialGroup = 0;

                    // Restore useFine from store state if available
                    this.useFine = store.state.column3?.useFine || false;

                    // Fetch services for this recipe
                    // Try to restore saved service/location, otherwise auto-select
                    const savedService = store.state.column3?.selectedService;
                    const savedLocation = store.state.column3?.selectedLocation;
                    const context = await this.loadServicesForRecipe(savedService, savedLocation);

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

                    // Save the auto-selected service/location to session
                    // (the dropdown's save fires before these async calls complete)
                    store._saveColumn3Selection();

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
     * Get regions for a location within a service
     * @param {Object} service - Service object with locations array
     * @param {string} locationId - Location ID to find regions for
     * @returns {Array} Array of region strings
     */
    getLocationRegions(service, locationId) {
        if (service.locations) {
            const loc = service.locations.find(l => l.location.id === locationId);
            if (loc && loc.location.regions && loc.location.regions.length > 0) {
                return loc.location.regions;
            }
        }
        return [locationId];
    }

    /**
     * Load services for the current recipe
     */
    async loadServicesForRecipe(savedServiceId = null, savedLocationId = null) {
        if (!this.recipe) {
            return;
        }

        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);

            // If recipe doesn't require a service, auto-select "__none__" and skip service entirely.
            // No service bonuses should be applied — only the location selector is shown.
            if (response.recipe_service_type === 'None') {
                if (!store.state.column3) {
                    store.state.column3 = {};
                }

                this.selectedService = '__none__';
                this.selectedServiceSpecific = null;
                store.state.column3.selectedService = '__none__';

                // Restore saved location or default to Kallaheim
                this.selectedLocation = savedLocationId || 'kallaheim';
                store.state.column3.selectedLocation = this.selectedLocation;

                console.log('Recipe has no service requirement, using __none__ with location:', this.selectedLocation);

                // Resolve the location's regions (e.g. Syrenthia → ['syrenthia', 'underwater'])
                // so region-scoped gear bonuses apply. Mirror the dropdown click path in
                // render(), which uses loc.regions || [loc.id].
                let locRegions = [this.selectedLocation];
                try {
                    const locResp = await $.get('/api/locations');
                    for (const region of locResp.regions || []) {
                        const loc = (region.locations || []).find(l => l.id === this.selectedLocation);
                        if (loc) {
                            locRegions = (loc.regions && loc.regions.length > 0)
                                ? loc.regions
                                : [this.selectedLocation];
                            break;
                        }
                    }
                } catch (e) {
                    console.error('Failed to resolve no-service location regions:', e);
                }

                return {
                    serviceId: null,  // No service for Column 2
                    locationId: locRegions
                };
            }

            // Try to restore saved service/location if provided
            if (savedServiceId) {
                for (const service of response.services) {
                    if (service.locations) {
                        const matchingLocation = service.locations.find(loc => loc.service_id === savedServiceId);
                        if (matchingLocation) {
                            this.selectedService = service.id;
                            this.selectedServiceSpecific = matchingLocation.service_id;

                            // Try to restore saved location within this service
                            if (savedLocationId) {
                                const savedLoc = service.locations.find(loc => loc.location.id === savedLocationId);
                                if (savedLoc) {
                                    this.selectedLocation = savedLoc.location.id;
                                    this.selectedServiceSpecific = savedLoc.service_id;
                                } else {
                                    this.selectedLocation = matchingLocation.location.id;
                                }
                            } else {
                                this.selectedLocation = matchingLocation.location.id;
                            }

                            if (!store.state.column3) {
                                store.state.column3 = {};
                            }
                            store.state.column3.selectedService = this.selectedServiceSpecific;
                            store.state.column3.selectedLocation = this.selectedLocation;

                            const locationRegions = this.getLocationRegions(service, this.selectedLocation);
                            console.log('Restored saved service:', this.selectedService, 'location:', this.selectedLocation);

                            return {
                                serviceId: this.selectedServiceSpecific,
                                locationId: locationRegions
                            };
                        }
                    }
                }
            }

            // Fallback: auto-select first Basic service
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

        // "No service" selected — clear service, default location to Kallaheim if none set
        if (serviceId === '__none__') {
            this.selectedServiceSpecific = null;
            store.state.column3.selectedService = '__none__';
            if (!this.selectedLocation) {
                this.selectedLocation = 'kallaheim';
            }
            store.state.column3.selectedLocation = this.selectedLocation;
            store._saveColumn3Selection();
            this.render();
            return;
        }

        // Don't notify subscribers here - will cause premature renders

        // Auto-select first location and use its location-specific service ID
        let locationRegions = null;

        // Handle generic service IDs
        if (serviceId && String(serviceId).startsWith('generic::')) {
            this.selectedServiceSpecific = serviceId;
            store.state.column3.selectedService = serviceId;
            // Generic services don't have location-specific IDs — use the service's location
            try {
                const defId = serviceId.replace('generic::', '');
                const svcData = await api.getGenericDefinitionView(defId);
                if (svcData && svcData.location) {
                    this.selectedLocation = svcData.location;
                    store.state.column3.selectedLocation = svcData.location;
                    locationRegions = [svcData.location];
                }
            } catch (e) {
                console.error('Failed to load generic service location:', e);
            }
        } else {
            try {
                // For generic recipes, use /api/services instead of /api/services/for-recipe/
                const isGenericRecipe = this.recipe.id && String(this.recipe.id).startsWith('generic::');
                let service = null;
                if (isGenericRecipe) {
                    const response = await $.get('/api/services');
                    const allServices = response.services || [];
                    // Find all location-specific services matching this grouped service name
                    const grouped = allServices.find(s => s.id === serviceId);
                    if (grouped && grouped.locations && grouped.locations.length > 0) {
                        service = grouped;
                    } else {
                        // Try finding by matching individual services
                        const match = allServices.filter(s => s.id === serviceId || s.name === serviceId);
                        if (match.length > 0) {
                            service = { locations: match.map(s => ({ service_id: s.id, location: s.location })) };
                        }
                    }
                } else {
                    const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
                    service = response.services.find(s => s.id === serviceId);
                }
                if (service && service.locations && service.locations.length > 0) {
                    const firstLocation = service.locations[0];
                    this.selectedLocation = firstLocation.location.id;

                    // Store location-specific service ID for optimization
                    this.selectedServiceSpecific = firstLocation.service_id;

                    // Update state with location-specific ID (for optimization)
                    store.state.column3.selectedService = this.selectedServiceSpecific;
                    store.state.column3.selectedLocation = this.selectedLocation;

                    console.log('Selected service (grouped):', this.selectedService, '(specific):', this.selectedServiceSpecific);

                    // Get ALL regions for the first location
                    locationRegions = firstLocation.location.regions && firstLocation.location.regions.length > 0
                        ? firstLocation.location.regions
                        : [this.selectedLocation];

                    console.log('Auto-selected first location:', this.selectedLocation, 'regions:', locationRegions);
                }
            } catch (error) {
                console.error('Failed to load service details:', error);
            }
        }

        // Notify Column 2 with batched update (service + location)
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setRecipeContext === 'function') {
            await combinedStatsSection.setRecipeContext(
                this.recipe.id,
                this.selectedServiceSpecific || serviceId,
                locationRegions
            );
        }

        // Auto-save selection to session
        store._saveColumn3Selection();
    }

    /**
     * Select a location
     * Requirements: 3.21
     * @param {string} locationId - Location ID
     * @param {string} serviceId - Location-specific service ID (used for optimization lookup)
     * @param {string} [ownerServiceId] - Grouped owner service ID this location belongs to.
     *        Feature 1: when the user clicks a location from a named-Basic variant while
     *        the generic "Basic X" service is selected, ownerServiceId will differ from
     *        the current selectedService — we re-select the owner so the UI + stats switch.
     */
    async selectLocation(locationId, serviceId, ownerServiceId) {
        console.log('=== selectLocation() called ===');
        console.log('locationId:', locationId);
        console.log('serviceId (location-specific):', serviceId);
        console.log('ownerServiceId (grouped):', ownerServiceId);

        const needsServiceHop = ownerServiceId && ownerServiceId !== this.selectedService;
        if (needsServiceHop) {
            // selectService updates state + notifies Column 2 + picks the first location
            // of the owner service. We then override that with the specific location the
            // user actually clicked, below.
            await this.selectService(ownerServiceId);
        }

        this.selectedLocation = locationId;

        // Store location-specific service ID for optimization
        this.selectedServiceSpecific = serviceId;

        // Update state with location-specific service ID
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.selectedLocation = locationId;
        store.state.column3.selectedService = serviceId;  // Store location-specific ID for optimization

        // Update location button styling without full re-render
        this.$element.find('.location-item').removeClass('location-selected');
        this.$element.find(`.location-item[data-location-id="${locationId}"]`).addClass('location-selected');

        // Get the region for this location to pass to Column 2
        try {
            const response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            let locationRegions = null;

            // Find the location in any service's locations
            for (const service of response.services) {
                if (service.locations) {
                    const locationData = service.locations.find(loc => loc.location.id === locationId);
                    if (locationData && locationData.location.regions && locationData.location.regions.length > 0) {
                        locationRegions = locationData.location.regions;
                        console.log('Found regions for location:', locationRegions);
                        break;
                    }
                }
            }

            // Notify Column 2 of location change with regions
            this.notifyColumn2LocationChange(locationRegions || [locationId]);
        } catch (error) {
            console.error('Failed to get location regions:', error);
            this.notifyColumn2LocationChange([locationId]);
        }

        // If we hopped services, trigger a re-render so the new service bubble is
        // highlighted and the (i) popover content reflects the new service.
        if (needsServiceHop) {
            this.render();
        }

        // Auto-save selection to session
        store._saveColumn3Selection();
    }

    /**
     * Select a material group
     * Requirements: 3.9
     * @param {number} index - Material group index
     */
    selectMaterialGroup(index) {
        this.selectedMaterialGroup = index;
        this.render();

        // Refresh the drops-section too — switching material groups changes
        // the consumed materials (and their coin cost), which flows through
        // to the coins/1k-steps pill breakdown.
        try {
            if (window.dropsSection && typeof window.dropsSection.render === 'function') {
                window.dropsSection.render();
            }
        } catch (_e) {
            // Non-fatal — drops section may not exist in some contexts.
        }
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

        // Auto-save selection to session
        store._saveColumn3Selection();

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
            'Hunting': '#FEA255',
            'Carpentry': '#F18C62',
            'Cooking': '#F0AD5F',
            'Crafting': '#E9487C',
            'Smithing': '#E2A6A6',
            'Trinketry': '#FEE0AC',
            'Tailoring': '#AAF2FE',
            'Agility': '#F05FBE',
            'Traveling': '#00BCD4'
        };

        return skillColors[skill] || '#666';
    }

    /**
     * Check if the current recipe has no service requirement.
     * @returns {boolean} True if recipe service is 'None' or absent
     */
    _recipeHasNoServiceRequirement() {
        if (!this.recipe) return false;
        // Wiki recipes: service_type field is 'None' string (from API)
        // Generic recipes: may have service_id field
        const svc = this.recipe.service_type || this.recipe.service || '';
        return !svc || svc === 'None';
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

        return this.recipe.has_fine_option || this.recipe.has_equipment_input;
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

        // Match the game's formula (per KamiTzayig reference): single ceil at the
        // END of the chain. Applying ceil before the pct multiplier introduces
        // off-by-one errors (e.g. Flowing pocketwatch -5%).
        const cappedWE = Math.min(we, maxEfficiency);
        const totalEfficiency = 1 + cappedWE;
        const baseOverEff = baseSteps / totalEfficiency;
        const withPct = baseOverEff * (1 + pct);
        const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);

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

        // Calculate XP per material consumed (ignores DR — only NMC and bonus XP matter)
        const materialsConsumedPerAction = nmc < 1.0 ? (1 - nmc) : 0.001;
        const xpPerMaterial = calculatedXP / materialsConsumedPerAction;

        return {
            baseSteps: baseSteps,
            currentSteps: stepsPerSingleAction,  // Steps per single action (without DA)
            expectedSteps: expectedStepsPerAction,  // Expected steps with DA (for calculations)
            stepsPerRewardRoll: stepsPerRewardRoll,  // For drop calculations and display
            currentWE: we,
            maxWE: maxEfficiency,
            baseXP: baseXP,
            calculatedXP: calculatedXP,
            xpPerStep: formatFixed(xpPerStep, 3),  // Always show 3 decimals
            xpPerMaterial: formatFixed(xpPerMaterial, 2, { trim: true }),
            craftsPerMaterial: formatFixed(craftsPerMaterial, 3, { trim: true }),
            materialsPerCraft: formatFixed(materialsPerCraft, 3, { trim: true }),
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
    calculateQualityWeights(recipeLevel, qualityOutcome, useFine = false, hasEquipmentInput = false) {
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

        // Apply fine materials effects
        if (useFine) {
            // Calculate fine-shifted weights (shift everything up one tier)
            const shiftedWeights = {
                'Good': calculatedWeights['Normal'],
                'Great': calculatedWeights['Good'],
                'Excellent': calculatedWeights['Great'],
                'Perfect': calculatedWeights['Excellent'],
                'Eternal': calculatedWeights['Perfect'] + calculatedWeights['Eternal'],
                'Normal': 0.0
            };
            if (hasEquipmentInput) {
                // Blend: 70% normal + 30% fine-shifted
                for (const quality of Object.keys(calculatedWeights)) {
                    calculatedWeights[quality] = calculatedWeights[quality] * 0.7 + shiftedWeights[quality] * 0.3;
                }
            } else {
                // Pure fine materials: full shift up one tier
                Object.assign(calculatedWeights, shiftedWeights);
            }
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
        const hasEquipmentInput = this.recipe.has_equipment_input || false;

        console.log(`[BUG1-SINGLE] QO=${qo}, recipeLevel=${this.recipe.level}, useFine=${useFine}, hasEquipmentInput=${hasEquipmentInput}`);

        // Calculate quality weights using the actual formula
        const result = this.calculateQualityWeights(this.recipe.level, qo, useFine, hasEquipmentInput);
        console.log(`[BUG1-SINGLE] Normal%=${result.percentages['Normal']?.toFixed(4)}, Perfect%=${result.percentages['Perfect']?.toFixed(4)}`);

        // Get crafts per material and steps from calculator section
        const stats = this.calculateCurrentStats();
        const craftsPerMaterial = stats ? stats.craftsPerMaterial : 1.0;
        const expectedSteps = stats ? stats.expectedSteps : 0;
        const dr = gearStats.double_rewards || 0;

        // Build odds array
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
        const odds = [];

        for (const quality of qualities) {
            const percentage = result.percentages[quality];
            const avgCrafts = percentage > 0 ? 100.0 / percentage : 0;
            const avgMats = percentage > 0 ? avgCrafts / craftsPerMaterial : 0;
            // DR gives bonus items per action, so fewer actions needed to reach avgCrafts
            const avgActions = percentage > 0 ? avgCrafts / (1 + dr) : 0;
            const avgSteps = avgActions * expectedSteps;

            odds.push({
                quality: quality,
                chance: percentage,
                avgCrafts: avgCrafts,
                avgMats: avgMats,
                avgSteps: avgSteps
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

        // Compute group labels from differing materials
        const groupLabels = this._getMaterialGroupLabels();

        let html = `
            <div class="material-group-selector">
        `;

        for (let i = 0; i < this.recipe.materials.length; i++) {
            const selectedClass = i === this.selectedMaterialGroup ? 'selected' : '';
            const label = groupLabels[i] || `Group ${i + 1}`;
            html += `
                <button class="material-group-button ${selectedClass}" data-group-index="${i}" title="${label}">
                    ${label}
                </button>
            `;
        }

        html += `
            </div>
        `;

        return html;
    }

    /**
     * Compute descriptive labels for material groups by finding the differing materials.
     * For each group, the label is the name(s) of materials that differ from other groups.
     * @returns {string[]} Array of labels, one per group
     */
    _getMaterialGroupLabels() {
        const groups = this.recipe.materials;
        if (!groups || groups.length <= 1) return [];

        // Build a set of "name:qty" keys per group
        const groupKeys = groups.map(g =>
            new Set(g.map(m => `${m.material_name}:${m.quantity}`))
        );

        // Find keys common to ALL groups
        const commonKeys = new Set([...groupKeys[0]].filter(k =>
            groupKeys.every(gk => gk.has(k))
        ));

        // For each group, the differing materials are those NOT in commonKeys
        return groups.map(g => {
            const differing = g.filter(m => !commonKeys.has(`${m.material_name}:${m.quantity}`));
            if (differing.length > 0) {
                return differing.map(m => m.material_name).join(' + ');
            }
            // Fallback: all materials differ, just list them all
            return g.map(m => m.material_name).join(' + ');
        });
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
        const fineActive = this.useFine && this.canUseFine();
        const ownedQuantities = (store.state.character && store.state.character.owned_quantities) || {};

        let html = `
            <div class="recipe-section">
                <div class="section-header">MATERIALS</div>
                ${this.renderMaterialGroupSelector()}
                <div class="materials-list">
                    <div class="materials-grid">
        `;

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

            // Don't apply fine CSS to equipment inputs
            const fineClass = (fineActive && material.type !== 'equipment') ? 'material-fine' : '';

            // Have-enough / have-not-enough outline coloring. We treat a non-empty
            // owned_quantities map as the signal that a character has been
            // imported — under that condition, a missing key means 0 owned and
            // colors the tile red. Sessions without an import (empty map) stay
            // neutral so unimported users don't see everything painted red.
            //
            // When the fine checkbox is on for non-equipment materials, the
            // recipe consumes the fine variant (1:1 substitution), so we look
            // up "${materialId}_fine" instead. Equipment inputs have no fine
            // variant, so they always use the base id.
            const materialId = material.material_id;
            const lookupId = (fineActive && material.type !== 'equipment')
                ? `${materialId}_fine`
                : materialId;
            const haveClass = this._materialHaveClass(lookupId, material.quantity, ownedQuantities);
            const ownedCount = this._materialOwnedCount(lookupId, ownedQuantities);

            html += `
                <div class="material-item material-item-clickable ${fineClass} ${haveClass}" data-material-name="${material.material_name}" data-material-id="${materialId}" data-material-lookup-id="${lookupId}" data-material-index="${i}" data-material-required="${material.quantity}" data-material-owned="${ownedCount ?? ''}" title="${material.material_name}">
                    <img src="${iconPath}" alt="${material.material_name}" class="material-icon" />
                    <span class="material-quantity">${material.quantity}</span>
                </div>
            `;
        }

        html += `
                    </div>
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
            </div>
        `;

        return html;
    }

    /**
     * Render recipe stats section
     * Requirements: 3.11
     * @returns {string} HTML for stats section
     */
    /**
     * Get active instant-actions pet info if checkbox is checked and recipe is a smelting recipe.
     * Returns null if not active.
     */
    _getActiveInstantActionsPet() {
        if (!this.recipe) return null;
        const skillType = (this.recipe.skill || '').toLowerCase();
        if (skillType !== 'smithing' && skillType !== 'smelting') return null;
        if (!SMELTING_RECIPE_NAMES.has(this.recipe.name || '')) return null;

        const ownedItems = store.state.items || {};
        const userOverrideItems = store.state.ui?.user_overrides?.items || {};
        const petCatalog = window.optimizeButton?._petCatalog || [];
        if (!petCatalog.length) return null;

        const petInfo = getInstantActionsPet(skillType, ownedItems, petCatalog, userOverrideItems);
        if (!petInfo) return null;

        const uiState = store.state.ui || {};
        if (!uiState.instant_actions_smelting) return null;

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
     * Render instant-actions charge stats for smelting recipes.
     * Shows crafts/output per charge, XP per charge, and materials per charge.
     */
    _renderInstantActionsChargeStats() {
        const petInfo = this._getActiveInstantActionsPet();
        if (!petInfo) return '';

        const gearStats = this.getGearStats();
        const da = gearStats.double_action || 0;
        const dr = gearStats.double_rewards || 0;
        const nmc = gearStats.no_materials_consumed || 0;
        const chargeCount = petInfo.count || 5;

        // Crafts per charge = charge_count × (1 + DA) × (1 + DR)
        const craftsPerCharge = chargeCount * (1 + da) * (1 + dr);

        // Output per charge = crafts × recipe.quantity (items produced per craft)
        const outputQty = this.recipe.quantity || 1;
        const outputPerCharge = craftsPerCharge * outputQty;
        // When qty > 1, show output count instead of craft count
        const displayValue = outputQty > 1 ? outputPerCharge : craftsPerCharge;
        const displayFormatted = formatFixed(displayValue, 2, { trim: true });
        const outputHeader = outputQty > 1 ? 'OUTPUT / CHARGE' : 'CRAFTS / CHARGE';
        const outputTitle = outputQty > 1
            ? `Output per charge (${chargeCount} actions × (1+DA) × (1+DR) × ${outputQty} per craft)`
            : `Crafts per charge (${chargeCount} actions × (1+DA) × (1+DR))`;

        // XP per charge = charge_count × (1 + DA) × XP_per_craft
        // DR does NOT affect XP (XP is per action, DR only multiplies reward drops)
        const stats = this.calculateCurrentStats();
        const xpPerCraft = stats ? stats.calculatedXP : (this.recipe.base_xp || 0);
        const xpPerCharge = chargeCount * (1 + da) * xpPerCraft;
        const xpFormatted = formatFixed(xpPerCharge, 2, { trim: true });
        const skillColor = this.getSkillColor(this.recipe.skill);

        // Materials per charge = charge_count × (1 + DA) × (1 - NMC) × base_qty
        // Get selected material group's total quantity
        const selectedGroup = this.recipe.materials?.[this.selectedMaterialGroup] || this.recipe.materials?.[0] || [];
        const totalBaseQty = selectedGroup.reduce((sum, m) => sum + (m.quantity || 1), 0);
        const matsPerCharge = chargeCount * (1 + da) * (1 - nmc) * totalBaseQty;
        const matsFormatted = formatFixed(matsPerCharge, 2, { trim: true });

        // Output item icon (the bar being crafted)
        const outputName = (this.recipe.output_item_name || this.recipe.name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
        const outputIconPath = `/assets/icons/items/materials/${outputName}.svg`;

        // Material icon — use first material in selected group
        const firstMat = selectedGroup[0];
        const matName = (firstMat?.material_name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
        const matIconPath = firstMat
            ? `/assets/icons/items/materials/${matName}.svg`
            : '/assets/icons/attributes/double_rewards.svg';

        const petIconHtml = `<img src="${petInfo.iconPath}" alt="${petInfo.petName}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.src='/assets/icons/items/pet_eggs/${petInfo.species}_egg.svg'" />`;

        return `
            <div class="recipe-stat-wrapper">
                <div class="recipe-stat-header">${outputHeader}</div>
                <div class="info-stat-row" title="${outputTitle}">
                    <img src="${outputIconPath}" alt="Output" class="stat-icon" style="width:24px;height:24px;object-fit:contain" onerror="this.src='/assets/icons/attributes/double_rewards.svg'" />
                    <span style="font-size:0.85em;color:var(--text-secondary)">/</span>
                    ${petIconHtml}
                    <span class="stat-value">${displayFormatted}</span>
                </div>
            </div>
            <div class="recipe-stat-wrapper">
                <div class="recipe-stat-header">XP / CHARGE</div>
                <div class="info-stat-row" style="border-color: ${skillColor};" title="XP per charge (${chargeCount} actions × (1+DA) × ${formatFixed(xpPerCraft, 2)} XP per craft; DR does not affect XP)">
                    <img src="/assets/icons/attributes/bonus_experience.svg" alt="XP" class="stat-icon" title="XP per charge" />
                    <span style="font-size:0.85em;color:var(--text-secondary)">/</span>
                    ${petIconHtml}
                    <span class="stat-value">${xpFormatted}</span>
                </div>
            </div>
            <div class="recipe-stat-wrapper">
                <div class="recipe-stat-header">MAT / CHARGE</div>
                <div class="info-stat-row" title="Total materials used per charge (${chargeCount} actions × (1+DA) × (1-NMC) × ${totalBaseQty} base qty)">
                    <img src="${matIconPath}" alt="${firstMat?.material_name || 'Mat'}" class="stat-icon" style="width:24px;height:24px;object-fit:contain" onerror="this.src='/assets/icons/attributes/double_rewards.svg'" />
                    <span style="font-size:0.85em;color:var(--text-secondary)">/</span>
                    ${petIconHtml}
                    <span class="stat-value">${matsFormatted}</span>
                </div>
            </div>
        `;
    }

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

        // Format WE for display - offset by 100 to match in-game display (100% = no bonus)
        const currentWEDisplay = currentWEPercent + 100;
        const maxWEDisplay = maxWEPercent + 100;
        const currentWEFormatted = (currentWEDisplay % 1 === 0)
            ? formatFixed(currentWEDisplay, 0)
            : (currentWEDisplay % 0.1 < 0.01)
                ? formatFixed(currentWEDisplay, 1)
                : formatFixed(currentWEDisplay, 2);
        const maxWEFormatted = (maxWEDisplay % 1 === 0) ? formatFixed(maxWEDisplay, 0) : formatFixed(maxWEDisplay, 1);

        // Check if WE exceeds or equals max (for green highlighting)
        const weExceedsMax = currentWEPercent >= maxWEPercent;
        const weClass = weExceedsMax ? 'stat-value-positive' : 'stat-value';
        const weRowClass = weExceedsMax ? 'we-maxed' : '';

        // Get skill icon and color
        const skillColor = this.getSkillColor(this.recipe.skill);

        return `
            <div class="recipe-stats-container">
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">CRAFT</div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Steps per Craft" />
                        <span class="stat-value">${formatFixed(stats.stepsPerRewardRoll, 2)}</span>
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
                        ${skillIconHtml(this.recipe.skill, 'stat-icon')}
                        <span class="stat-value">${this.recipe.level}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">XP</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        ${skillIconHtml(this.recipe.skill, 'stat-icon')}
                        <span class="stat-value">${formatFixed(stats.calculatedXP, 2, { trim: true })} / ${formatFixed(stats.baseXP, 2, { trim: true })}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">XP / STEP</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        ${skillIconHtml(this.recipe.skill, 'stat-icon')}
                        <span class="stat-value">${stats.xpPerStep}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">XP / MAT</div>
                    <div class="info-stat-row" style="border-color: ${skillColor};">
                        ${skillIconHtml(this.recipe.skill, 'stat-icon')}
                        <span class="stat-value">${stats.xpPerMaterial}</span>
                    </div>
                </div>
                
                <div class="recipe-stat-wrapper">
                    <div class="recipe-stat-header">CRAFTS / MAT</div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/double_rewards.svg" alt="DR" class="stat-icon" title="Crafts per Material" />
                        <span class="stat-value">${stats.craftsPerMaterial}</span>
                    </div>
                </div>
                ${this._renderInstantActionsChargeStats()}
            </div>
        `;
    }

    /**
     * Check if a service has any stats worth showing in the (i) popover.
     * Generic "Basic X" services have empty stats/gated_stats and return false
     * (no icon is rendered for them).
     */
    _serviceHasStats(service) {
        if (!service) return false;
        const direct = service.stats || {};
        const gated = service.gated_stats || {};
        const hasDirect = Object.keys(direct).some(skill =>
            Object.keys(direct[skill] || {}).some(loc =>
                Object.keys(direct[skill][loc] || {}).length > 0
            )
        );
        if (hasDirect) return true;
        return Object.values(gated).some(v => v && typeof v === 'object' && Object.keys(v).length > 0);
    }

    /** Format a faction id like 'halfling_rebels' as 'Halfling Rebels'. */
    _formatFactionName(factionId) {
        return String(factionId || '')
            .split('_')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    }

    /** Get the player's reputation for a faction (user override wins). */
    _getPlayerReputation(factionId) {
        const overrides = store.state.ui?.user_overrides || {};
        if (overrides.reputation && overrides.reputation[factionId] !== undefined) {
            return overrides.reputation[factionId];
        }
        return store.state.character?.reputation?.[factionId] || 0;
    }

    /** Format a stat name (snake_case -> "Snake Case", XP uppercase). */
    _svcFormatStatName(statName) {
        return String(statName || '')
            .split('_')
            .map(w => w.toLowerCase() === 'xp' ? 'XP' : (w.charAt(0).toUpperCase() + w.slice(1)))
            .join(' ');
    }

    /** Format a stat value (+5% / -10% / +2 for flat stats) with color class. */
    _svcFormatStatValue(statName, value) {
        // Flat stats render as raw number (no % suffix). DR/DA/QO flat here means
        // "not a percent" — but DR/DA ARE percents in the WalkScape UI ('+1%' not '+1'),
        // so they belong in the percent group.
        const flatStats = new Set([
            'quality_outcome', 'inventory_space', 'bonus_xp_base', 'bonus_xp_add',
            'steps_required', 'steps_add', 'flat_steps', 'bonus_experience_base',
            'bonus_experience_add', 'foraging_base_xp'
        ]);
        const isFlat = flatStats.has(statName);
        const negativeIsGood = new Set(['steps_add', 'steps_required', 'flat_steps', 'steps_pct', 'steps_percent']);
        if (typeof value !== 'number') return `<span class="stat-value">${value}</span>`;
        let cls = 'stat-value';
        if (value > 0) cls = negativeIsGood.has(statName) ? 'stat-value-negative' : 'stat-value-positive';
        else if (value < 0) cls = negativeIsGood.has(statName) ? 'stat-value-positive' : 'stat-value-negative';
        const sign = value > 0 ? '+' : '';
        const suffix = isFlat ? '' : '%';
        return `<span class="${cls}">${sign}${value}${suffix}</span>`;
    }

    /**
     * Format a skill/location condition with context-aware suppression:
     * - "Global / Global" -> "" (no condition label)
     * - skill matches recipe skill -> drop skill segment
     * - location matches service location -> drop location segment
     * - everything else -> "While <Skill> in <Location>" etc.
     *
     * This is narrower than the item-row version because services always apply
     * in their service's skill+location context — showing "While Carpentry in
     * Halfling Campgrounds" on a Saw-in-half mill stat is redundant.
     */
    _svcFormatCondition(skill, location, recipeSkill, serviceLocation) {
        const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        const fmtLoc = (loc) => {
            if (loc === 'underwater') return 'Underwater location';
            if (loc === 'gdte') return 'GDTE location';
            return `${cap(loc)} location`;
        };
        const s = (skill || '').toLowerCase();
        const l = (location || '').toLowerCase();
        const recipeS = (recipeSkill || '').toLowerCase();
        const svcL = (serviceLocation || '').toLowerCase();

        // Effective "skill constraint" — drop if it's global or matches recipe skill
        const skillPart = (s && s !== 'global' && s !== recipeS) ? cap(s) : null;
        // Effective "location constraint" — drop if it's global or matches service location
        const locPart = (l && l !== 'global' && l !== svcL) ? l : null;

        if (!skillPart && !locPart) return '';
        if (skillPart && locPart) return `While ${skillPart} in ${fmtLoc(locPart)}`;
        if (skillPart) return `While ${skillPart}`;
        return `While in ${fmtLoc(locPart)}`;
    }

    /**
     * Render one {skill:{location:{stat:value}}} block as rows.
     * When `requirement` is set, rows are gated; when `isMet=false`, they are dimmed
     * via stat-row-gated-unmet (same filter:brightness(0.5) as col 1 / col 2 items).
     * `recipeSkill` + `serviceLocation` enable redundancy suppression in conditions.
     */
    _renderServiceStatBlock(statsObj, requirement = null, isMet = true, recipeSkill = null, serviceLocation = null) {
        if (!statsObj || Object.keys(statsObj).length === 0) return '';
        const rows = [];
        for (const [skill, locationStats] of Object.entries(statsObj)) {
            if (!locationStats || typeof locationStats !== 'object') continue;
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                if (!statsByLocation || typeof statsByLocation !== 'object') continue;
                for (const [statName, statValue] of Object.entries(statsByLocation)) {
                    if (!statName || statName === 'undefined') continue;
                    const valueHtml = this._svcFormatStatValue(statName, statValue);
                    const nameHtml = this._svcFormatStatName(statName);
                    const condition = this._svcFormatCondition(skill, location, recipeSkill, serviceLocation);
                    let rowClass = 'stat-row';
                    if (requirement) {
                        rowClass += ' stat-row-gated' + (isMet ? '' : ' stat-row-gated-unmet');
                    }
                    const gateHtml = requirement
                        ? `<div class="stat-gate${isMet ? '' : ' stat-gate-unmet'}">${requirement}</div>`
                        : '';
                    const conditionHtml = condition
                        ? `<span class="stat-condition">${condition}</span>`
                        : '';
                    rows.push(`
                        <div class="${rowClass}">
                            ${valueHtml}
                            <span class="stat-name">${nameHtml}</span>
                            ${conditionHtml}
                            ${gateHtml}
                        </div>
                    `);
                }
            }
        }
        return rows.join('');
    }

    /**
     * Build the popover HTML body for a service bubble's (i) icon:
     *   - direct stats first (always applied)
     *   - reputation tiers next (dimmed when the player hasn't reached the threshold,
     *     matching the col 1 Omni-tool / treasure-hunting dim-locked pattern)
     *   - skill-level tiers (edge-case for a few advanced services)
     *
     * Condition labels ("While Carpentry", "Global") are suppressed when the stat's
     * skill matches the recipe's skill or the location matches `contextLocation`,
     * because the service is always used in exactly that context.
     *
     * @param {Object} service - Grouped service object with stats/gated_stats
     * @param {string} [contextLocation] - Location id the popover is being shown for
     *        (selected location for service bubble; specific location for variant button).
     *        Stats whose location matches this are treated as "global" for label purposes.
     */
    _buildServiceStatsPopoverHtml(service, contextLocation = null) {
        const parts = [];
        const recipeSkill = (this.recipe?.skill || '').toLowerCase();
        const ctxLoc = (contextLocation || '').toLowerCase();

        const directHtml = this._renderServiceStatBlock(service.stats || {}, null, true, recipeSkill, ctxLoc);
        if (directHtml) parts.push(directHtml);

        const repGated = service.gated_stats?.reputation || {};
        for (const [faction, tiers] of Object.entries(repGated)) {
            if (!tiers || typeof tiers !== 'object') continue;
            const factionName = this._formatFactionName(faction);
            const playerRep = this._getPlayerReputation(faction);
            const thresholds = Object.keys(tiers)
                .map(k => [k, parseInt(k, 10)])
                .sort((a, b) => a[1] - b[1]);
            for (const [key, threshold] of thresholds) {
                const tieredStats = tiers[key];
                if (!tieredStats || typeof tieredStats !== 'object') continue;
                const requirement = `${factionName} reputation ${threshold}`;
                const isMet = playerRep >= threshold;
                const blockHtml = this._renderServiceStatBlock(tieredStats, requirement, isMet, recipeSkill, ctxLoc);
                if (blockHtml) parts.push(blockHtml);
            }
        }

        const skillGated = service.gated_stats?.skill_level || {};
        for (const [skill, levels] of Object.entries(skillGated)) {
            for (const [level, levelStats] of Object.entries(levels || {})) {
                const requirement = `${skill.charAt(0).toUpperCase() + skill.slice(1)} Level ${level}`;
                const overrideLevel = store.state.ui?.user_overrides?.skills?.[skill.toLowerCase()];
                const charLevel = overrideLevel !== undefined
                    ? overrideLevel
                    : (store.state.character?.skills?.[skill.toLowerCase()] || 1);
                const isMet = charLevel >= parseInt(level, 10);
                const blockHtml = this._renderServiceStatBlock(levelStats, requirement, isMet, recipeSkill, ctxLoc);
                if (blockHtml) parts.push(blockHtml);
            }
        }

        return parts.join('');
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

        // If recipe doesn't require a service, hide the entire services section
        if (this.selectedService === '__none__' && this._recipeHasNoServiceRequirement()) {
            return '';
        }

        // For generic recipes, load all services for the skill category
        if (this.recipe.id && String(this.recipe.id).startsWith('generic::')) {
            try {
                const response = await $.get('/api/services');
                const skill = (this.recipe.skill || '').toLowerCase();
                const allServices = response.services || [];
                // Filter services by skill category
                const skillFiltered = allServices.filter(svc =>
                    (svc.category || '').toLowerCase() === skill
                );

                // Deduplicate by name + tier (group location-specific services)
                const seen = new Map();
                for (const svc of skillFiltered) {
                    const key = `${svc.name}::${svc.tier || ''}`;
                    if (!seen.has(key)) {
                        seen.set(key, { ...svc, locations: [] });
                    }
                    if (svc.location) {
                        seen.get(key).locations.push({ location: svc.location, service_id: svc.id });
                    }
                }
                const filtered = Array.from(seen.values());

                let html = `
                    <div class="recipe-section">
                        <div class="section-header">SERVICES</div>
                        <div class="services-grid">
                `;

                for (const service of filtered) {
                    const isSelected = service.id === this.selectedService ||
                        (service.locations && service.locations.some(l => l.service_id === this.selectedService));
                    const selectedClass = isSelected ? 'service-selected' : '';

                    let displayName = service.name;
                    let iconName = service.name.replace(/ /g, '_').toLowerCase();
                    if (!service.name.toLowerCase().startsWith('basic') && service.is_basic) {
                        displayName += ' (Basic)';
                        iconName += '_(basic)';
                    } else if (service.is_advanced) {
                        displayName += ' (Advanced)';
                        iconName += '_(advanced)';
                    }
                    const serviceIcon = `/assets/icons/services/${iconName}.svg`;

                    // (i) popover button — only for services with actual stats/gated_stats
                    let infoIconHtml = '';
                    if (this._serviceHasStats(service)) {
                        const popoverHtml = this._buildServiceStatsPopoverHtml(service, this.selectedLocation);
                        if (popoverHtml) {
                            const escaped = popoverHtml.replace(/"/g, '&quot;');
                            infoIconHtml = `<span class="travel-info-icon service-info-icon" data-info-title="${displayName}" data-info-html="${escaped}" role="button" aria-label="Show service stats" style="margin-left:auto">ⓘ</span>`;
                        }
                    }

                    html += `
                        <div class="service-item ${selectedClass}" data-service-id="${service.id}">
                            <img src="${serviceIcon}" alt="${service.name}" class="service-icon" />
                            <span class="service-name">${displayName}</span>
                            ${infoIconHtml}
                        </div>
                    `;
                }

                if (filtered.length === 0) {
                    html += `<div style="color:var(--text-secondary);font-style:italic;padding:var(--spacing-xs) 0">No services found for ${this.recipe.skill}</div>`;
                }

                html += `
                        </div>
                        ${window._featureFlags?.generic ? `
                        <label class="recipe-generic-svc-toggle" style="display:flex;align-items:center;gap:6px;margin-top:var(--spacing-xs);cursor:pointer;font-size:13px;color:var(--text-secondary)">
                            <input type="checkbox" class="show-generic-services-cb" ${this.showGenericServices ? 'checked' : ''} />
                            Show generic services
                        </label>
                        <div class="generic-services-area" style="${this.showGenericServices ? '' : 'display:none'}"></div>
                        ` : ''}
                    </div>
                `;
                return html;
            } catch (e) {
                console.error('Failed to load services for generic recipe:', e);
                return '';
            }
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

                // (i) popover button — only for services with actual stats/gated_stats.
                // Skips generic "Basic X" services (empty stats) per user request.
                let infoIconHtml = '';
                if (this._serviceHasStats(service)) {
                    const popoverHtml = this._buildServiceStatsPopoverHtml(service, this.selectedLocation);
                    if (popoverHtml) {
                        const escaped = popoverHtml.replace(/"/g, '&quot;');
                        infoIconHtml = `<span class="travel-info-icon service-info-icon" data-info-title="${displayName}" data-info-html="${escaped}" role="button" aria-label="Show service stats" style="margin-left:auto">ⓘ</span>`;
                    }
                }

                html += `
                    <div class="service-item ${selectedClass} ${lockedClass}" data-service-id="${service.id}">
                        <img src="${serviceIcon}" alt="${service.name}" class="service-icon" />
                        <span class="service-name">${displayName}</span>
                        ${infoIconHtml}
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
                    ${window._featureFlags?.generic ? `
                    <label class="recipe-generic-svc-toggle" style="display:flex;align-items:center;gap:6px;margin-top:var(--spacing-xs);cursor:pointer;font-size:13px;color:var(--text-secondary)">
                        <input type="checkbox" class="show-generic-services-cb" ${this.showGenericServices ? 'checked' : ''} />
                        Show generic services
                    </label>
                    <div class="generic-services-area" style="${this.showGenericServices ? '' : 'display:none'}"></div>
                    ` : ''}
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
        if (!this.selectedService) {
            return '';
        }

        // "No service" selected (either explicitly or because recipe has no service requirement)
        // — show a location dropdown for manual location selection
        if (this.selectedService === '__none__') {
            return `
                <div class="recipe-section">
                    <div class="section-header">LOCATION</div>
                    <div id="recipe-no-svc-location-dropdown"></div>
                </div>
            `;
        }

        // Generic services — show the service's location from the definition
        if (this.selectedService && String(this.selectedService).startsWith('generic::')) {
            try {
                const defId = this.selectedService.replace('generic::', '');
                const svcData = await api.getGenericDefinitionView(defId);
                if (svcData && svcData.location) {
                    // Resolve location from Location enum
                    const locStr = svcData.location;
                    let locName = locStr.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    let iconPath = `/assets/icons/locations/${locStr}.svg`;

                    // Try to get proper icon from locations API
                    try {
                        const locsResponse = await $.get('/api/locations');
                        if (locsResponse && locsResponse.regions) {
                            // Flatten all locations from all regions
                            const allLocs = locsResponse.regions.flatMap(r => r.locations || []);
                            const loc = allLocs.find(l => l.id === locStr || l.name === locName);
                            if (loc) {
                                locName = loc.name;
                                if (loc.icon_name) iconPath = `/assets/icons/locations/${loc.icon_name}`;
                            }
                        }
                    } catch (e) { /* use fallback */ }

                    this.selectedLocation = locStr;
                    return `
                        <div class="recipe-section">
                            <div class="section-header">LOCATIONS</div>
                            <div class="locations-grid">
                                <div class="location-item location-selected" data-location-id="${locStr}">
                                    <img src="${iconPath}" alt="${locName}" class="location-icon" />
                                    <span class="location-name">${locName}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } catch (e) {
                console.error('Failed to load generic service location:', e);
            }
            return '';
        }

        try {
            let response;
            if (this.recipe.id && String(this.recipe.id).startsWith('generic::')) {
                // For generic recipes, build grouped response from flat services
                const allSvcs = await $.get('/api/services');
                const flat = allSvcs.services || [];

                // Group by name+tier to build locations arrays
                const grouped = new Map();
                for (const svc of flat) {
                    const key = `${svc.name}::${svc.tier || ''}`;
                    if (!grouped.has(key)) {
                        grouped.set(key, { ...svc, locations: [] });
                    }
                    if (svc.location) {
                        grouped.get(key).locations.push({
                            service_id: svc.id,
                            location: svc.location,
                            is_unlocked: svc.is_unlocked !== false,
                            missing_requirements: svc.missing_requirements || [],
                            requirements: svc.requirements || {},
                            stats: svc.stats || {},
                            gated_stats: svc.gated_stats || {}
                        });
                    }
                }
                response = { services: Array.from(grouped.values()) };
            } else {
                response = await $.get(`/api/services/for-recipe/${this.recipe.id}`);
            }
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

            // Feature 1: when the GENERIC "Basic X" service is selected, also surface
            // locations from named Basic variants (e.g. Alight Kitchen @ Azurazera,
            // Underwater Kitchen @ Vastalume) in the same button row. Clicking one of
            // those locations auto-switches the selected service to the matching named
            // variant (see click handler + selectLocation for the owner-service hop).
            // Named variants and Advanced services don't get this merge.
            const isGenericBasic = !!service.is_basic
                && typeof service.name === 'string'
                && service.name.toLowerCase().startsWith('basic');

            // Items from the currently-selected service keep ownerServiceId = service.id
            // and variantName = null. Merged entries from named variants carry the
            // owner's grouped id, variant name, and a reference to the variant service
            // object so we can render a popover with its name + stats.
            const displayLocations = service.locations.map(ld => ({
                ...ld,
                ownerServiceId: service.id,
                variantName: null,
                variantService: null,
            }));
            if (isGenericBasic) {
                for (const other of response.services) {
                    if (other.id === service.id) continue;
                    if (!other.is_basic) continue;
                    if ((other.tier || '') !== (service.tier || '')) continue;
                    if (!other.locations || other.locations.length === 0) continue;
                    for (const ld of other.locations) {
                        displayLocations.push({
                            ...ld,
                            ownerServiceId: other.id,
                            variantName: other.name, // e.g. "Alight Kitchen"
                            variantService: other,   // for the (i) popover body
                        });
                    }
                }
                // Sort the combined list alphabetically by location name so merged
                // variants interleave with the generic Basic locations (Azurazera at
                // the top, Vastalume near the bottom, etc.). Fall back to location id
                // for robustness if name is missing.
                displayLocations.sort((a, b) => {
                    const an = (a.location?.name || a.location?.id || '').toLowerCase();
                    const bn = (b.location?.name || b.location?.id || '').toLowerCase();
                    return an.localeCompare(bn);
                });
            }

            console.log('Rendering', displayLocations.length, 'locations',
                isGenericBasic ? '(merged from basic variants)' : '');

            let html = `
                <div class="recipe-section">
                    <div class="section-header">LOCATIONS</div>
                    <div class="locations-grid">
            `;

            for (const locationData of displayLocations) {
                const location = locationData.location;
                const isSelected = location.id === this.selectedLocation;
                const selectedClass = isSelected ? 'location-selected' : '';

                // Use icon_name from location data if available, otherwise fall back to location id
                const iconPath = location.icon_name
                    ? `/assets/icons/locations/${location.icon_name}`
                    : `/assets/icons/locations/${location.id}.svg`;

                // If this location belongs to a named variant (not the selected generic),
                // show a small (i) icon whose popover shows the variant's name + stats,
                // so users can identify it without a verbose caption.
                let variantInfoHtml = '';
                if (locationData.variantName) {
                    // Build popover body: variant stats (may be empty for stat-less variants).
                    const popoverBody = locationData.variantService
                        ? this._buildServiceStatsPopoverHtml(locationData.variantService, locationData.location && locationData.location.id)
                        : '';
                    const escaped = popoverBody.replace(/"/g, '&quot;');
                    variantInfoHtml = `<span class="travel-info-icon location-info-icon" data-info-title="${locationData.variantName}" data-info-html="${escaped}" role="button" aria-label="Show ${locationData.variantName} stats" style="margin-left:auto">ⓘ</span>`;
                }

                html += `
                    <div class="location-item ${selectedClass}" data-location-id="${location.id}" data-service-id="${locationData.service_id}" data-owner-service-id="${locationData.ownerServiceId}">
                        <img src="${iconPath}" alt="${location.name}" class="location-icon" />
                        <span class="location-name">${location.name}</span>
                        ${variantInfoHtml}
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
        // Skip if output is explicitly a Material or Consumable (they don't have qualities)
        const outputItem = this.recipe.output_item || '';

        if (outputItem.startsWith('Material.') || outputItem.startsWith('Consumable.')) {
            return '';
        }

        // For generic recipes, only show if is_quality_item is true
        if (this.recipe.id && String(this.recipe.id).startsWith('generic::') && !this.recipe.is_quality_item) {
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
                <div class="crafting-odds-scroll-wrapper">
                <table class="crafting-odds-table">
                    <thead>
                        <tr>
                            <th>Quality</th>
                            <th>Chance</th>
                            <th>Avg. Items</th>
                            <th>Avg. Mats</th>
                            <th>Avg. Steps</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const odd of odds) {
            const rarity = qualityToRarity[odd.quality] || 'common';
            // Format numbers, removing trailing zeros.
            // NOTE: Do NOT wrap formatFixed() in parseFloat()/Number() —
            // formatFixed honors the user's locale (default thousand=','),
            // so e.g. formatFixed(15358.8, 1) returns "15,358.8".
            // parseFloat("15,358.8") stops at the comma and returns 15
            // (bug fd44e05b: Eternal showed "15"/"10" instead of
            // 15,358.8/10,051.5). Use the { trim: true } option instead.
            const chance = formatFixed(odd.chance, 2, { trim: true });
            const avgCrafts = formatFixed(odd.avgCrafts, 1, { trim: true });
            const avgMats = formatFixed(odd.avgMats, 1, { trim: true });
            const avgSteps = odd.avgSteps > 0 ? this.formatSteps(odd.avgSteps) : '0';

            html += `
                <tr class="quality-row-${rarity}">
                    <td class="quality-cell quality-cell-${rarity}">${odd.quality}</td>
                    <td class="number-cell">${chance}%</td>
                    <td class="number-cell">${avgCrafts}</td>
                    <td class="number-cell">${avgMats}</td>
                    <td class="number-cell">${avgSteps}</td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Format step count with locale-aware thousands separators.
     * @param {number} steps - Raw step count
     * @returns {string} Formatted string (e.g., "1,234" or "12,345")
     */
    formatSteps(steps) {
        return Math.ceil(steps).toLocaleString();
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
                <div class="recipe-info-section " data-pin-id="recipe-info" style="border-color: ${skillColor};">
                    <div class="recipe-info-header">
                        <span class="recipe-info-title">${this.recipe.name.toUpperCase()}</span>
                        ${arrowIcon}
                    </div>
                    <div class="recipe-info-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                        <div class="info-wiki-link-wrapper"><a href="https://wiki.walkscape.app/wiki/${encodeURIComponent((this.recipe.output_item_name || this.recipe.name).replace(/ /g, '_'))}${wikiDarkModeSuffix()}#recipeSection" target="_blank" rel="noopener noreferrer" class="wiki-link info-wiki-link">Wiki</a>${window._featureFlags?.crafting_tree ? ` <button class="crafting-tree-btn" data-output-item="${this.recipe.output_item || ''}" title="Open Crafting Tree Calculator" style="display:inline-flex">🌳 Crafting Tree</button>` : ''}</div>
                        ${contentHtml}
                    </div>
                </div>
            `;

            // Only apply if this is still the latest render
            if (this._renderQueue[this._renderQueue.length - 1] === renderTimestamp) {
                this.$element.html(html);
                this.attachEvents();
                // Wire hover/click behaviour for any (i) info icons inside service bubbles.
                // wireInfoIcons() is idempotent — it skips icons already wired.
                try { wireInfoIcons(this.$element[0]); } catch (e) { console.warn('wireInfoIcons failed:', e); }
                console.log('RecipeInfo render() complete, render ID:', renderTimestamp);

                // Create location dropdown for "No service" mode
                if (this.selectedService === '__none__') {
                    const $locContainer = this.$element.find('#recipe-no-svc-location-dropdown');
                    if ($locContainer.length) {
                        if (this._noSvcLocationDropdown) { this._noSvcLocationDropdown.destroy(); this._noSvcLocationDropdown = null; }
                        const LocationDropdown = (await import('./location-dropdown.js')).default;
                        this._noSvcLocationDropdown = new LocationDropdown($locContainer, {
                            label: '',
                            onSelect: (loc) => {
                                if (loc) {
                                    this.selectedLocation = loc.id;
                                    // Update store silently (no notifications — avoid re-render)
                                    if (!store.state.column3) store.state.column3 = {};
                                    store.state.column3.selectedLocation = loc.id;
                                    store.state.column3.selectedService = '__none__';
                                    // Notify Column 2 with the location's regions (includes 'underwater' for Syrenthia, etc.)
                                    const regions = (loc.regions && loc.regions.length > 0) ? loc.regions : [loc.id];
                                    this.notifyColumn2LocationChange(regions);
                                    store._saveColumn3Selection();
                                } else {
                                    this.selectedLocation = null;
                                    if (!store.state.column3) store.state.column3 = {};
                                    store.state.column3.selectedLocation = null;
                                    this.notifyColumn2LocationChange([]);
                                    store._saveColumn3Selection();
                                }
                            },
                            selectedLocation: this.selectedLocation || null
                        });
                    }
                }

                // Re-populate generic services area if it was open
                if (this.showGenericServices) {
                    const $area = this.$element.find('.generic-services-area');
                    if ($area.length) {
                        $area.show();
                        this._loadGenericServicesIntoArea($area);
                    }
                }
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
            // Ignore clicks that originate inside the (i) info icon so the popover
            // doesn't also trigger a service selection.
            if ($(e.target).closest('.service-info-icon').length) return;
            const serviceId = $(e.currentTarget).data('service-id');
            this.selectService(serviceId);
        });

        // Service search filter
        this.$element.on('input', '.svc-search', (e) => {
            const search = $(e.target).val().toLowerCase();
            this.$element.find('.services-grid .service-item').each(function () {
                const name = $(this).find('.service-name').text().toLowerCase();
                $(this).toggle(name.includes(search));
            });
        });

        // Service search arrow key navigation
        this.$element.on('keydown', '.svc-search', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const $grid = this.$element.find('.services-grid');
            const $items = $grid.find('.service-item:visible');
            if (!$items.length) return;
            const $active = $items.filter('.keyboard-active');
            let idx = $active.length ? $items.index($active) : -1;

            if (e.key === 'ArrowDown') {
                $items.removeClass('keyboard-active');
                idx = idx < $items.length - 1 ? idx + 1 : 0;
                const $next = $items.eq(idx);
                $next.addClass('keyboard-active');
                const container = $grid[0], el = $next[0];
                const elBottom = el.offsetTop + el.offsetHeight;
                const viewBottom = container.scrollTop + container.clientHeight;
                if (elBottom > viewBottom) {
                    container.scrollTop += elBottom - viewBottom;
                } else if (el.offsetTop < container.scrollTop) {
                    container.scrollTop = el.offsetTop;
                }
            } else if (e.key === 'ArrowUp') {
                $items.removeClass('keyboard-active');
                idx = idx > 0 ? idx - 1 : $items.length - 1;
                const $prev = $items.eq(idx);
                $prev.addClass('keyboard-active');
                const container = $grid[0], el = $prev[0];
                if (el.offsetTop < container.scrollTop) {
                    container.scrollTop = el.offsetTop;
                } else {
                    const elBottom = el.offsetTop + el.offsetHeight;
                    const viewBottom = container.scrollTop + container.clientHeight;
                    if (elBottom > viewBottom) {
                        container.scrollTop += elBottom - viewBottom;
                    }
                }
            } else if (e.key === 'Enter' && $active.length) {
                $active.trigger('click');
            }
        });

        // Location selection
        this.$element.on('click', '.location-item', (e) => {
            e.stopPropagation();
            // Ignore clicks that originate inside the variant (i) info icon — those
            // are popovers, not a location selection.
            if ($(e.target).closest('.location-info-icon').length) return;
            const locationId = $(e.currentTarget).data('location-id');
            const serviceId = $(e.currentTarget).data('service-id');
            // Feature 1: if this location came from a named Basic variant while the
            // generic Basic is selected, ownerServiceId differs and selectLocation()
            // will auto-switch the service.
            const ownerServiceId = $(e.currentTarget).data('owner-service-id');
            this.selectLocation(locationId, serviceId, ownerServiceId);
        });

        // Show generic services checkbox
        this.$element.on('change', '.show-generic-services-cb', async (e) => {
            e.stopPropagation();
            this.showGenericServices = e.target.checked;
            store.state.column3.showGenericServices = this.showGenericServices;
            store._saveColumn3Selection();
            const $area = this.$element.find('.generic-services-area');
            if (this.showGenericServices) {
                $area.slideDown(150);
                await this._loadGenericServicesIntoArea($area);
            } else {
                $area.slideUp(150);
            }
        });

        // Generic service selection in recipe info
        this.$element.on('click', '.generic-svc-item', async (e) => {
            e.stopPropagation();
            const svcId = $(e.currentTarget).data('id');
            if (!svcId) return;
            const fullId = svcId.startsWith('generic::') ? svcId : `generic::${svcId}`;
            await this.selectService(fullId);
        });

        // Community definitions checkbox inside generic services area
        this.$element.on('change', '.show-generic-svc-community-cb', async (e) => {
            e.stopPropagation();
            this.showGenericServicesCommunity = e.target.checked;
            store.state.column3.showGenericCommunity = this.showGenericServicesCommunity;
            store._saveColumn3Selection();
            const $area = this.$element.find('.generic-services-area');
            await this._loadGenericServicesIntoArea($area);
        });

        // Crafting Tree button — use global opener
        this.$element.on('click', '.crafting-tree-btn', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const outputItem = $(e.currentTarget).attr('data-output-item');
            if (outputItem && window._openCraftingTreeGlobal) {
                window._openCraftingTreeGlobal(outputItem);
            }
        });

        // Material item click - toggle sources dropdown with page-slide animation
        this.$element.on('click', '.material-item-clickable', (e) => {
            e.stopPropagation();
            const $item = $(e.currentTarget);
            const $list = $item.closest('.materials-list');
            const $dropdown = $list.find('.material-source-dropdown');
            const materialName = $item.data('material-name');
            const newIndex = parseInt($item.data('material-index'));
            const wasOpen = $dropdown.is(':visible');

            // If clicking the already-selected material, close it
            if ($item.hasClass('material-selected') && wasOpen) {
                $item.removeClass('material-selected');
                this._activeMaterialIndex = -1;
                $dropdown.slideUp(150);
                return;
            }

            // Determine slide direction based on index
            const oldIndex = this._activeMaterialIndex ?? -1;
            const direction = newIndex > oldIndex ? 'left' : 'right';

            // Deselect any previously selected material
            $list.find('.material-item-clickable').removeClass('material-selected');
            $item.addClass('material-selected');
            this._activeMaterialIndex = newIndex;

            if (wasOpen) {
                // Page-slide: old exits one way, new enters from opposite
                this._slideSourcePage($dropdown, materialName, direction);
            } else {
                // First open — slide down
                this._loadAndRenderMaterialSources($dropdown, materialName, false);
            }
        });

        // Swipe support on the source dropdown for mobile
        this.$element.on('touchstart', '.material-source-dropdown', (e) => {
            this._swipeStartX = e.originalEvent.touches[0].clientX;
            this._swipeStartY = e.originalEvent.touches[0].clientY;
            this._swipeLocked = false;
        });

        // Use native listener for touchmove so we can set { passive: false }
        // jQuery delegates touch events as passive, which blocks preventDefault()
        this.$element[0].addEventListener('touchmove', (e) => {
            if (this._swipeStartX == null) return;
            // Only handle if the touch is inside a material-source-dropdown
            if (!e.target.closest('.material-source-dropdown')) return;
            const dx = e.touches[0].clientX - this._swipeStartX;
            const dy = e.touches[0].clientY - this._swipeStartY;
            if (!this._swipeLocked && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                this._swipeLocked = true;
            }
            if (this._swipeLocked) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, { passive: false });

        this.$element.on('touchend', '.material-source-dropdown', (e) => {
            if (this._swipeStartX == null) return;
            const endX = e.originalEvent.changedTouches[0].clientX;
            const endY = e.originalEvent.changedTouches[0].clientY;
            const dx = endX - this._swipeStartX;
            const dy = endY - this._swipeStartY;
            this._swipeStartX = null;

            // Only trigger if horizontal swipe is dominant and long enough
            if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;

            const $list = $(e.currentTarget).closest('.materials-list');
            const $materials = $list.find('.material-item-clickable');
            const totalMaterials = $materials.length;
            if (totalMaterials <= 1) return;

            const currentIdx = this._activeMaterialIndex ?? 0;
            // Swipe left = next (slide left), swipe right = prev (slide right)
            const nextIdx = dx < 0
                ? (currentIdx + 1) % totalMaterials
                : (currentIdx - 1 + totalMaterials) % totalMaterials;

            const $nextItem = $materials.eq(nextIdx);
            $nextItem.trigger('click');
        });

        // Material source item click - navigate to activity or recipe
        this.$element.on('click', '.material-source-item', (e) => {
            e.stopPropagation();
            const $el = $(e.currentTarget);
            const sourceType = $el.data('source-type');
            const sourceId = $el.data('source-id');

            if (sourceType === 'activity_drop') {
                if (window.activitySelector) {
                    window.activitySelector.selectActivity(sourceId);
                }
            } else if (sourceType === 'recipe_output' || sourceType === 'recipe_input' || sourceType === 'recipe_drop') {
                if (window.recipeSelector) {
                    window.recipeSelector.selectRecipe(sourceId);
                }
            }
        });

        // Material source nav prev/next buttons
        this.$element.on('click', '.material-source-prev, .material-source-next', (e) => {
            e.stopPropagation();
            const isPrev = $(e.currentTarget).hasClass('material-source-prev');
            const $list = $(e.currentTarget).closest('.materials-list');
            const $materials = $list.find('.material-item-clickable');
            const total = $materials.length;
            if (total <= 1) return;

            const currentIdx = this._activeMaterialIndex ?? 0;
            const nextIdx = isPrev
                ? (currentIdx - 1 + total) % total
                : (currentIdx + 1) % total;

            $materials.eq(nextIdx).trigger('click');
        });
    }

    async _loadGenericServicesIntoArea($area) {
        const uuid = store.state.session?.uuid;
        if (!uuid) { $area.html('<div style="color:var(--text-secondary);padding:4px">No session</div>'); return; }

        // Filter by recipe skill
        const recipeSkill = (this.recipe?.skill || '').toLowerCase();

        try {
            const defs = await api.getGenericDefinitions(uuid);
            let services = (defs.services || []).filter(svc =>
                !recipeSkill || (svc.skill || '').toLowerCase() === recipeSkill
            );

            // Load community definitions if checkbox is checked
            let communityServices = [];
            if (this.showGenericServicesCommunity) {
                try {
                    const community = await api.getCommunityDefinitions();
                    communityServices = (community.services || []).filter(cs =>
                        !services.some(s => s.id === cs.id) &&
                        (!recipeSkill || (cs.skill || '').toLowerCase() === recipeSkill)
                    );
                } catch (e) { /* ignore */ }
            }

            let html = '';

            // User's saved services
            if (services.length > 0) {
                html += '<div class="services-grid" style="margin-top:var(--spacing-xs)">';
                for (const svc of services) {
                    const isSelected = this.selectedService === `generic::${svc.id}` || this.selectedServiceSpecific === `generic::${svc.id}`;
                    const iconStyle = svc.icon_color ? (window.emojiTintStyle ? window.emojiTintStyle(svc.icon_color) : '') : '';
                    html += `
                        <div class="service-item generic-svc-item ${isSelected ? 'service-selected' : ''}" data-id="${svc.id}">
                            <span class="service-icon" style="font-size:18px">${window.tintedEmoji(svc.icon || '🔧', svc.icon_color)}</span>
                            <span class="service-name">${svc.name}</span>
                        </div>
                    `;
                }
                html += '</div>';
            } else {
                html += '<div style="color:var(--text-secondary);font-style:italic;padding:4px 0">No generic services saved</div>';
            }

            // Community checkbox
            html += `
                <label style="display:flex;align-items:center;gap:6px;margin-top:var(--spacing-xs);cursor:pointer;font-size:12px;color:var(--text-secondary)">
                    <input type="checkbox" class="show-generic-svc-community-cb" ${this.showGenericServicesCommunity ? 'checked' : ''} />
                    Show community definitions
                </label>
            `;

            // Community services
            if (this.showGenericServicesCommunity && communityServices.length > 0) {
                html += '<div class="services-grid" style="margin-top:var(--spacing-xs)">';
                for (const svc of communityServices) {
                    const isSelected = this.selectedService === `generic::${svc.id}` || this.selectedServiceSpecific === `generic::${svc.id}`;
                    html += `
                        <div class="service-item generic-svc-item ${isSelected ? 'service-selected' : ''}" data-id="${svc.id}">
                            <span class="service-icon" style="font-size:18px">${window.tintedEmoji(svc.icon || '🔧', svc.icon_color)}</span>
                            <span class="service-name">${svc.name}</span>
                        </div>
                    `;
                }
                html += '</div>';
            }

            $area.html(html);
        } catch (e) {
            $area.html('<div style="color:var(--text-secondary);padding:4px">Failed to load generic services</div>');
        }
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

    /**
     * Build the HTML for a material's sources list.
     * @returns {string} HTML string
     */
    _buildSourcesHtml(sources) {
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

        if (activityDrops.length > 0) {
            html += '<div class="source-group-header">Dropped by</div>';
            for (const src of activityDrops) {
                const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                const secondary = src.secondary ? ' (secondary)' : '';
                html += `
                    <div class="source-item material-source-item" data-source-type="activity_drop" data-source-id="${src.id}" title="Click to select this activity">
                        <div class="source-item-main">
                            <span class="source-name">${src.name}</span>
                            <span class="source-badge source-badge-activity">Activity</span>
                        </div>
                        <div class="source-item-details">
                            <span>${src.skill} Lv.${src.level}</span>
                            <span>${src.base_steps || '?'} steps</span>
                            <span>Drop: ${dropRate}${secondary}</span>
                        </div>
                    </div>`;
            }
        }

        if (itemFindingDrops.length > 0) {
            html += '<div class="source-group-header">Item Finding</div>';
            for (const src of itemFindingDrops) {
                const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                html += `
                    <div class="source-item source-item-no-click" title="Dropped via ${src.category} item finding gear">
                        <div class="source-item-main">
                            <span class="source-name">${src.category}</span>
                            <span class="source-badge source-badge-item-finding">Item Finding</span>
                        </div>
                        ${chance ? `<div class="source-item-details"><span>${chance}</span></div>` : ''}
                    </div>`;
            }
        }

        if (recipeDrops.length > 0) {
            html += '<div class="source-group-header">Dropped while crafting</div>';
            for (const src of recipeDrops) {
                const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                html += `
                    <div class="source-item material-source-item" data-source-type="recipe_drop" data-source-id="${src.id}" title="Click to select this recipe">
                        <div class="source-item-main">
                            <span class="source-name">${src.name}</span>
                            <span class="source-badge source-badge-recipe-drop">Recipe Drop</span>
                        </div>
                        <div class="source-item-details">
                            <span>${src.skill} Lv.${src.level}</span>
                            <span>${src.base_steps || '?'} steps</span>
                            <span>Drop: ${dropRate}</span>
                        </div>
                    </div>`;
            }
        }

        if (recipeOutputs.length > 0) {
            html += '<div class="source-group-header">Crafted by</div>';
            for (const src of recipeOutputs) {
                html += `
                    <div class="source-item material-source-item" data-source-type="recipe_output" data-source-id="${src.id}" title="Click to select this recipe">
                        <div class="source-item-main">
                            <span class="source-name">${src.name}</span>
                            <span class="source-badge source-badge-recipe">Recipe</span>
                        </div>
                        <div class="source-item-details">
                            <span>${src.skill} Lv.${src.level}</span>
                            <span>${src.base_steps || '?'} steps</span>
                        </div>
                    </div>`;
            }
        }

        if (recipeInputs.length > 0) {
            html += '<div class="source-group-header">Used in</div>';
            for (const src of recipeInputs) {
                html += `
                    <div class="source-item material-source-item" data-source-type="recipe_input" data-source-id="${src.id}" title="Click to select this recipe">
                        <div class="source-item-main">
                            <span class="source-name">${src.name}</span>
                            <span class="source-badge source-badge-recipe-input">Input</span>
                        </div>
                        <div class="source-item-details">
                            <span>${src.skill} Lv.${src.level}</span>
                            <span>${src.base_steps || '?'} steps</span>
                            <span>${src.quantity || 1}x needed</span>
                        </div>
                    </div>`;
            }
        }

        if (shopSources.length > 0) {
            html += '<div class="source-group-header">Sold at</div>';
            for (const src of shopSources) {
                html += `
                    <div class="source-item source-item-no-click" title="${src.name} in ${src.location}">
                        <div class="source-item-main">
                            <span class="source-name">${src.name}</span>
                            <span class="source-badge source-badge-shop">Shop</span>
                        </div>
                        <div class="source-item-details">
                            <span>${src.location}</span>
                            <span>${src.price_display}</span>
                            ${src.stock > 1 ? `<span>Stock: ${src.stock}</span>` : ''}
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
                html += `
                    <div class="source-item source-item-no-click source-item-chest">
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
     * Update the material source nav bar label and button states.
     */
    _updateMaterialSourceNav($container, materialName) {
        const $list = $container.closest('.materials-list');
        const $materials = $list.find('.material-item-clickable');
        const total = $materials.length;
        const idx = this._activeMaterialIndex ?? 0;
        // Look up the active material's owned count to append "(N owned)" to the
        // nav label. Pull from data-material-owned (set in renderMaterialsSection)
        // so the source dropdown stays in sync with whatever we colored the tile.
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
     * Decide whether a recipe material tile should get the green
     * have-enough outline, the red have-not-enough outline, or no extra class.
     * Returns '' (neutral) when owned_quantities is empty (no character imported)
     * so unimported sessions don't see everything painted red. When the map is
     * non-empty, missing keys are treated as 0 owned and produce a red outline.
     *
     * @param {string} lookupId - lowercase item id to look up (may include _fine)
     * @param {number} required - recipe-required quantity for this material
     * @param {Object} ownedMap - owned_quantities map (item_id -> total qty)
     * @returns {string} CSS class to add to the material-item div
     */
    _materialHaveClass(lookupId, required, ownedMap) {
        if (!lookupId) return '';
        if (!ownedMap || Object.keys(ownedMap).length === 0) return '';
        const owned = ownedMap[lookupId] || 0;
        return owned >= required
            ? 'material-have-enough'
            : 'material-have-not-enough';
    }

    /**
     * Resolve the owned-count to display in data-material-owned. Returns
     * undefined when there's no character data (so the source-nav label
     * suppresses the "(N owned)" suffix), or 0+ when imported.
     */
    _materialOwnedCount(lookupId, ownedMap) {
        if (!lookupId) return undefined;
        if (!ownedMap || Object.keys(ownedMap).length === 0) return undefined;
        return ownedMap[lookupId] || 0;
    }

    /**
     * Load and render sources for a material (first open — slideDown).
     */
    async _loadAndRenderMaterialSources($container, materialName) {
        const $page = $container.find('.material-source-page');
        $page.html('<div class="source-loading">Loading sources...</div>');
        this._updateMaterialSourceNav($container, materialName);
        $container.slideDown(150);

        try {
            const data = await api.getItemSources();
            const lookupName = materialName.toLowerCase().trim();
            const sources = data.sources[lookupName] || [];
            $page.html(this._buildSourcesHtml(sources));
        } catch (err) {
            console.error('Failed to load material sources:', err);
            $page.html('<div class="source-empty">Failed to load sources</div>');
        }
    }

    /**
     * Slide the source page horizontally: old exits, new enters from opposite side.
     * @param {string} direction - 'left' or 'right'
     */
    async _slideSourcePage($container, materialName, direction) {
        this._updateMaterialSourceNav($container, materialName);
        const $viewport = $container.find('.material-source-viewport');
        const $oldPage = $viewport.find('.material-source-page');
        const slideDistance = $viewport.width() || $container.width() || 300;
        const exitTo = direction === 'left' ? -slideDistance : slideDistance;
        const enterFrom = direction === 'left' ? slideDistance : -slideDistance;
        const duration = 180;

        // Lock viewport height FIRST to prevent any collapse
        const currentHeight = $viewport.outerHeight();
        $viewport.css({ height: currentHeight, position: 'relative', overflow: 'hidden' });

        // Now safe to make old page absolute (viewport height is locked)
        $oldPage.css({ position: 'absolute', top: 0, left: 0, width: '100%' });

        // Create new page off-screen
        const $newPage = $('<div class="material-source-page"></div>')
            .css({ position: 'absolute', top: 0, left: enterFrom, width: '100%' })
            .html('<div class="source-loading">Loading sources...</div>');
        $viewport.append($newPage);

        // Animate both simultaneously
        $oldPage.animate({ left: exitTo }, duration, 'swing');
        $newPage.animate({ left: 0 }, duration, 'swing', () => {
            $oldPage.remove();
            $newPage.css({ position: '', top: '', left: '', width: '' });
            $viewport.css({ height: '', position: '', overflow: '' });
        });

        // Load actual content into the new page
        try {
            const data = await api.getItemSources();
            const lookupName = materialName.toLowerCase().trim();
            const sources = data.sources[lookupName] || [];
            $newPage.html(this._buildSourcesHtml(sources));
            // Smoothly adjust viewport height if new content differs
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
     * Open the Crafting Tree Calculator for the given output item.
     */
    _openCraftingTree(outputItem) {
        console.log('Opening crafting tree for:', outputItem);
        // Dynamically import and create the CraftingTreeView
        import('./crafting-tree-view.js').then(({ default: CraftingTreeView }) => {
            console.log('CraftingTreeView loaded successfully');
            // Create a container for the crafting tree view
            let $container = $('#crafting-tree-container');
            if (!$container.length) {
                $container = $('<div id="crafting-tree-container" class="crafting-tree-overlay"></div>');
                $('body').append($container);
            }
            $container.show();

            // Destroy any existing instance
            if (this._craftingTreeView) {
                this._craftingTreeView.destroy();
            }

            this._craftingTreeView = new CraftingTreeView($container[0], {
                itemId: outputItem,
                onClose: () => {
                    $container.addClass('closing');
                    setTimeout(() => {
                        $container.hide().removeClass('closing');
                        if (this._craftingTreeView) {
                            this._craftingTreeView.destroy();
                            this._craftingTreeView = null;
                        }
                    }, 250);
                },
            });
        }).catch(err => {
            console.error('Failed to load CraftingTreeView:', err);
            if (window.api) window.api.showError('Failed to open Crafting Tree');
        });
    }
}

export default RecipeInfoSection;
