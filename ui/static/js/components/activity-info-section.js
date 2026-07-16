/**
 * ActivityInfoSection Component
 * 
 * Displays detailed activity information when an activity is selected.
 * 
 * Features:
 * - Collapsible section with skill-colored border
 * - ALL CAPS headers
 * - Stats display (steps per activity, work efficiency, steps per reward roll)
 * - Requirements display with fulfillment status
 * - XP rewards display
 * - Locations selector
 * - Level bonus calculations
 * 
 * Requirements: 2.1-2.16, 7.6
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import TravelInfoSection from './travel-info-section.js';
import { getInstantActionsPet, SMELTING_RECIPE_NAMES } from '../utils/pet-utils.js';
import { getPetIconPath } from '../utils/pet-utils.js';

import { formatFixed } from '../utils/number-format.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';

const SKILL_ICON_FALLBACK = {
    'traveling': '🧭',
};

// Global fine input bonus — same for all fine input items, defined in game data
const FINE_INPUT_BONUS = {
    global: {
        global: {
            work_efficiency: 40.0,
            double_rewards: 10.0,
            bonus_xp_percent: 100.0,
            fine_material_finding: 200.0,
        }
    }
};

function skillIconHtml(skillName, cssClass = 'xp-icon') {
    const skillId = skillName.toLowerCase().replace(' ', '_');
    const fallback = SKILL_ICON_FALLBACK[skillId];
    if (fallback) return `<span class="${cssClass}" style="font-size:18px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px" title="${skillName}">${fallback}</span>`;
    return `<img src="/assets/icons/text/skill_icons/${skillId}.svg" alt="${skillName}" class="${cssClass}" title="${skillName}" />`;
}

class ActivityInfoSection extends Component {
    /**
     * Create an activity info section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // State
        this.activity = null;
        this.selectedLocation = null;
        this.isExpanded = true;
        this.useFine = store.state.column3?.useFine || false;
        this.useFineInputs = store.state.column3?.useFineInputs || false;
        // Selected input items: {idx: itemObject} — one per input_item slot
        this._selectedInputItems = {};
        this._customKeywords = []; // Custom keywords from DB
        this._loadCustomKeywords();

        // Travel info section (rendered when activity is Traveling)
        this.travelInfoSection = null;

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedLocation', () => this.onLocationChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());
        this.subscribe('ui.user_overrides.skills', () => this.onSkillOverridesChange());
        this.subscribe('character.skills', () => this.onSkillsChange());
        // Re-render when instant-actions checkbox changes
        this.subscribe('ui.instant_actions_foraging', () => { if (this.activity) this.render(); });
        this.subscribe('ui.instant_actions_smelting', () => { if (this.activity) this.render(); });

        // Subscribe to Column 2 stats updates
        // When Column 2 finishes calculating, re-render to show updated stats
        if (window.combinedStatsSection) {
            window.combinedStatsSection.statsCalculatedCallbacks.push(() => {
                if (this.activity) {
                    console.log('Column 2 stats updated, re-rendering Column 3');
                    this.render();
                }
            });
        } else {
            // bug fbb51cdb: if Column 2 isn't ready at construction the callback
            // was silently never registered, so the Activity page relied on a
            // handoff that could never happen. We now paint directly in
            // onActivityChange(), so this is no longer fatal — but log it so we
            // can see the ordering in any future bug report.
            console.warn('[ActivityInfo] combinedStatsSection not ready at construction — live-stats re-render callback NOT registered (direct render still applies)');
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
            this.activity = null;
            this.selectedLocation = null;
            this.render();

            // Notify Column 2 that activity was cleared
            // Requirements: 7.1
            await this.notifyColumn2ActivityChange(null);
            return;
        }

        // Handle generic activities — fetch from generic endpoint
        if (selectedId === 'generic') {
            // "generic" without ID means the form is open but nothing saved yet
            this.activity = null;
            this.render();
            return;
        }
        if (selectedId.startsWith('generic::')) {
            try {
                const defId = selectedId.replace('generic::', '');
                const data = await api.getGenericDefinitionView(defId);
                if (data && data.type === 'activity') {
                    this.activity = data;
                    this._selectedInputItems = {};  // Reset input selections on activity change
                    // Restore saved input items from store (only if valid for this activity's input slots)
                    if (data.input_items && data.input_items.length > 0) {
                        const savedInputItems = store.state.column3?.selectedInputItems;
                        if (savedInputItems && typeof savedInputItems === 'object') {
                            for (const [idx, item] of Object.entries(savedInputItems)) {
                                const slot = data.input_items[parseInt(idx)];
                                if (!slot || !item) continue;
                                const requiredKeyword = (slot.reference || slot.name || '').toLowerCase();
                                const itemKeywords = (item.keywords || []).map(k => k.toLowerCase());
                                if (itemKeywords.includes(requiredKeyword)) {
                                    this._selectedInputItems[idx] = item;
                                }
                            }
                        }
                    }
                    this.useFine = store.state.column3?.useFine || false;
                    this.useFineInputs = store.state.column3?.useFineInputs || false;
                    // Sync filtered inputs back to store so stale items don't persist
                    if (!store.state.column3) store.state.column3 = {};
                    store.state.column3.selectedInputItems = { ...this._selectedInputItems };
                    let selectedLoc = null;
                    const savedLocation = store.state.column3?.selectedLocation;
                    if (savedLocation && data.locations) {
                        selectedLoc = data.locations.find(loc => loc.id === savedLocation);
                    }
                    if (!selectedLoc && data.locations && data.locations.length > 0) {
                        selectedLoc = data.locations[0];
                    }
                    if (selectedLoc) {
                        this.selectedLocation = selectedLoc.id;
                        if (!store.state.column3) store.state.column3 = {};
                        store.state.column3.selectedLocation = this.selectedLocation;
                        const locationRegions = selectedLoc.regions && selectedLoc.regions.length > 0
                            ? selectedLoc.regions : [selectedLoc.id];
                        const combinedStatsSection = window.combinedStatsSection;
                        if (combinedStatsSection && typeof combinedStatsSection.setActivityAndLocation === 'function') {
                            await combinedStatsSection.setActivityAndLocation(data.id, locationRegions, this._selectedInputItems, this.useFineInputs);
                        } else {
                            await this.notifyColumn2ActivityChange(data);
                        }
                    } else {
                        await this.notifyColumn2ActivityChange(data);
                        // Restore input items after setActivity (which clears them) and re-render
                        const css2 = window.combinedStatsSection;
                        if (css2 && Object.keys(this._selectedInputItems).length > 0) {
                            for (const [idx, item] of Object.entries(this._selectedInputItems)) {
                                if (item && item.stats) {
                                    css2._inputItems[parseInt(idx)] = item;
                                }
                            }
                            if (this.useFineInputs) {
                                css2._useFineInputs = true;
                            }
                            css2.render();
                            css2.attachEvents();
                        }
                    }
                    store._saveColumn3Selection();
                    return;
                }
            } catch (error) {
                console.error('Failed to load generic activity:', error);
            }
            return;
        }

        // Fetch activity details from cached data (already loaded by dropdown)
        try {
            // Use cached activities data from the dropdown instead of re-fetching
            const activityDropdown = window.activitySelector;
            const cachedData = activityDropdown?.activitiesData;

            // Fall back to API only if cache is empty
            const response = cachedData || await $.get('/api/activities');

            // Find activity by ID
            for (const activities of Object.values(response.by_skill)) {
                const activity = activities.find(a => a.id === selectedId);
                if (activity) {
                    this.activity = activity;
                    this._selectedInputItems = {};  // Reset input selections on activity change
                    // Restore saved input items from store (only if valid for this activity's input slots)
                    if (activity.input_items && activity.input_items.length > 0) {
                        const savedInputItems2 = store.state.column3?.selectedInputItems;
                        if (savedInputItems2 && typeof savedInputItems2 === 'object') {
                            for (const [idx, item] of Object.entries(savedInputItems2)) {
                                const slot = activity.input_items[parseInt(idx)];
                                if (!slot || !item) continue;
                                const requiredKeyword = (slot.reference || slot.name || '').toLowerCase();
                                const itemKeywords = (item.keywords || []).map(k => k.toLowerCase());
                                if (itemKeywords.includes(requiredKeyword)) {
                                    this._selectedInputItems[idx] = item;
                                }
                            }
                        }
                    }

                    // Initialize useFine from state
                    this.useFine = store.state.column3?.useFine || false;
                    this.useFineInputs = store.state.column3?.useFineInputs || false;
                    // Sync filtered inputs back to store so stale items don't persist
                    if (!store.state.column3) store.state.column3 = {};
                    store.state.column3.selectedInputItems = { ...this._selectedInputItems };

                    // Try to restore saved location, otherwise auto-select first
                    const savedLocation = store.state.column3?.selectedLocation;
                    let selectedLoc = null;

                    if (savedLocation && activity.locations) {
                        selectedLoc = activity.locations.find(loc => loc.id === savedLocation);
                    }

                    if (!selectedLoc && activity.locations && activity.locations.length > 0) {
                        selectedLoc = activity.locations[0];
                    }

                    if (selectedLoc) {
                        this.selectedLocation = selectedLoc.id;

                        // Update state
                        if (!store.state.column3) {
                            store.state.column3 = {};
                        }
                        store.state.column3.selectedLocation = this.selectedLocation;

                        // Paint the activity page NOW from the data we already
                        // have (bug fbb51cdb). Previously we returned without
                        // rendering and relied solely on Column 2's async
                        // statsCalculatedCallbacks to trigger the first paint.
                        // In comparison mode that callback could fail to fire,
                        // leaving the Activity page permanently blank. render()
                        // reads Column 2 stats defensively (cachedStats || {}),
                        // so an early paint is safe; the callback below re-renders
                        // with live work-efficiency once Column 2 finishes.
                        this.render();

                        // Notify Column 2 of both activity and location together (single render)
                        const locationRegions = selectedLoc.regions && selectedLoc.regions.length > 0
                            ? selectedLoc.regions
                            : [selectedLoc.id];
                        console.log('Selected location:', this.selectedLocation, 'regions:', locationRegions,
                            savedLocation === selectedLoc.id ? '(restored)' : '(auto-selected)');

                        const combinedStatsSection = window.combinedStatsSection;
                        if (combinedStatsSection && typeof combinedStatsSection.setActivityAndLocation === 'function') {
                            await combinedStatsSection.setActivityAndLocation(activity.id, locationRegions, this._selectedInputItems, this.useFineInputs);
                        } else {
                            await this.notifyColumn2ActivityChange(activity);
                            await this.notifyColumn2LocationChange(locationRegions);
                        }
                    } else {
                        // No locations, just notify activity change
                        // Paint now (bug fbb51cdb) — don't wait on the async
                        // Column 2 stats callback which may never fire.
                        this.render();
                        await this.notifyColumn2ActivityChange(activity);
                        // Restore input items after setActivity clears them
                        const css3 = window.combinedStatsSection;
                        if (css3 && Object.keys(this._selectedInputItems).length > 0) {
                            for (const [idx, item] of Object.entries(this._selectedInputItems)) {
                                if (item && item.stats) {
                                    css3._inputItems[parseInt(idx)] = item;
                                }
                            }
                            if (this.useFineInputs) {
                                css3._useFineInputs = true;
                            }
                            css3.render();
                            css3.attachEvents();
                        }
                    }

                    // Save the auto-selected/restored location to session
                    // (the dropdown's save fires before these async calls complete)
                    store._saveColumn3Selection();

                    // Activity page is already painted above; Column 3 will
                    // re-render with live work-efficiency stats when Column 2
                    // fires its statsCalculatedCallbacks (bug fbb51cdb: this
                    // callback is best-effort, not the sole path to first paint).
                    console.log('[ActivityInfo] painted; awaiting Column 2 live stats for', selectedId);
                    return;
                }
            }

            // Activity not found
            this.activity = null;
            this.selectedLocation = null;
            this.render();

            // Notify Column 2 that activity was cleared
            this.notifyColumn2ActivityChange(null);

        } catch (error) {
            console.error('Failed to load activity details:', error);
            api.showError('Failed to load activity details');
        }
    }

    /**
     * Handle location selection change
     */
    async onLocationChange() {
        const selectedLoc = store.state.column3?.selectedLocation;
        if (selectedLoc !== this.selectedLocation) {
            this.selectedLocation = selectedLoc;

            // Get the regions for this location from the activity data
            let locationRegions = null;

            // Find the location in the activity's locations array
            if (this.activity && this.activity.locations) {
                const locationData = this.activity.locations.find(loc => loc.id === selectedLoc);
                if (locationData && locationData.regions && locationData.regions.length > 0) {
                    // Get ALL regions (locations can have multiple regions)
                    locationRegions = locationData.regions;
                    console.log('Found regions for location from activity data:', locationRegions);
                }
            }

            // Notify Column 2 of location change with regions
            // Requirements: 7.4
            this.notifyColumn2LocationChange(locationRegions || [selectedLoc]);

            // Don't call render() here - Column 2 callback will handle it
        }
    }

    /**
     * Handle gearset change (recalculate stats)
     */
    onGearsetChange() {
        if (this.activity) {
            this.render();
        }
    }

    /**
     * Handle skill overrides change (re-check requirements)
     */
    onSkillOverridesChange() {
        if (this.activity) {
            console.log('Skill overrides changed, re-rendering activity info');
            this.render();
        }
    }

    /**
     * Handle character skills change (re-check requirements)
     */
    onSkillsChange() {
        if (this.activity) {
            console.log('Character skills changed, re-rendering activity info');
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
     * Toggle section expanded/collapsed
     */
    toggleExpanded() {
        this.isExpanded = !this.isExpanded;

        const $content = this.$element.find('.activity-info-content');
        const $arrow = this.$element.find('.activity-info-header .expand-arrow');

        if (this.isExpanded) {
            $arrow.addClass('expanded');
            $content.slideDown(200);
        } else {
            $arrow.removeClass('expanded');
            $content.slideUp(200);
        }
    }

    /**
     * Select a location
     * Requirements: 2.15
     * @param {string} locationId - Location ID
     */
    async selectLocation(locationId) {
        this.selectedLocation = locationId;

        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.selectedLocation = locationId;

        // Update location button styling without full re-render
        this.$element.find('.location-item').removeClass('location-selected');
        this.$element.find(`.location-item[data-location-id="${locationId}"]`).addClass('location-selected');

        // Get the regions for this location from the activity data
        let locationRegions = null;

        // Find the location in the activity's locations array
        if (this.activity && this.activity.locations) {
            const locationData = this.activity.locations.find(loc => loc.id === locationId);
            if (locationData && locationData.regions && locationData.regions.length > 0) {
                // Get ALL regions (locations can have multiple regions)
                locationRegions = locationData.regions;
                console.log('Found regions for location from activity data:', locationRegions);
            }
        }

        // Notify Column 2 of location change with regions
        // Requirements: 7.4
        this.notifyColumn2LocationChange(locationRegions || [locationId]);

        // Auto-save selection to session
        store._saveColumn3Selection();
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
            'Traveling': '#00BCD4'  // Not in CSS, using a default
        };

        return skillColors[skill] || '#666';
    }

    /**
     * Calculate current stats with gear bonuses
     * Requirements: 2.3, 2.4, 2.5
     * @returns {Object} Calculated stats
     */
    calculateCurrentStats() {
        if (!this.activity) {
            return null;
        }

        // Get gear stats from current gearset
        const gearStats = this.getGearStats();

        // Calculate steps per action
        const baseSteps = this.activity.base_steps;
        const maxEfficiency = this.activity.max_efficiency;
        const we = gearStats.work_efficiency || 0;
        const da = gearStats.double_action || 0;
        const flat = gearStats.flat_steps || 0;
        const pct = gearStats.percent_steps || 0;

        // Apply WE (capped at max efficiency)
        const cappedWE = Math.min(we, maxEfficiency);
        const totalEfficiency = 1 + cappedWE;

        // Match the game's formula (per KamiTzayig reference): single ceil at the
        // END of the chain. Applying ceil before the pct multiplier introduces
        // off-by-one errors (e.g. Flowing pocketwatch -5% on Lizard Hunting).
        const baseOverEff = baseSteps / totalEfficiency;
        const stepsWithPct = baseOverEff * (1 + pct);
        const stepsWithFlat = stepsWithPct + flat;
        const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithFlat));

        // Apply DA for expected steps (no ceil - keep as float for accurate XP/step)
        const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;

        // Calculate steps per reward roll (keep as number, don't convert to string yet)
        const dr = gearStats.double_rewards || 0;
        const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

        // Calculate XP with bonuses from gear
        // Get bonus XP from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};

        // Base XP for all skills
        let primaryXP = this.activity.base_xp;
        const secondaryXP = { ...this.activity.secondary_xp };

        // Apply fine materials bonus (75% more XP)
        const fineBonus = this.useFine ? 0.75 : 0;
        console.log('[ActivityInfo] calculateCurrentStats - this.useFine:', this.useFine, 'fineBonus:', fineBonus);

        // Apply bonus XP modifiers
        const bonusXPAdd = column2Stats.bonus_xp_add || column2Stats.bonus_experience_add || 0;
        const bonusXPPercent = (column2Stats.bonus_xp_percent || column2Stats.bonus_experience_percent || 0) / 100;

        // Apply to primary XP: (base * (1 + fine_bonus) + add) * (1 + percent) - NO floor
        const basePrimaryXP = primaryXP;
        primaryXP = (primaryXP * (1 + fineBonus) + bonusXPAdd) * (1 + bonusXPPercent);
        console.log('[ActivityInfo] Primary XP calculation:', {
            base: basePrimaryXP,
            fineBonus: fineBonus,
            afterFine: basePrimaryXP * (1 + fineBonus),
            bonusXPAdd: bonusXPAdd,
            bonusXPPercent: bonusXPPercent,
            final: primaryXP
        });

        // Apply to secondary XP
        for (const skill in secondaryXP) {
            secondaryXP[skill] = (secondaryXP[skill] * (1 + fineBonus) + bonusXPAdd) * (1 + bonusXPPercent);
        }

        // Calculate total XP
        let totalXP = primaryXP;
        for (const xp of Object.values(secondaryXP)) {
            totalXP += xp;
        }

        const xpPerStep = formatFixed((totalXP / expectedStepsPerAction), 3);

        return {
            baseSteps: baseSteps,
            currentSteps: stepsPerSingleAction,  // Show steps per single action (without DA)
            expectedSteps: expectedStepsPerAction,  // Expected steps with DA (for calculations)
            currentWE: we,
            maxWE: maxEfficiency,
            stepsPerRewardRoll: stepsPerRewardRoll,
            xpPerStep: xpPerStep,
            primaryXP: primaryXP,
            basePrimaryXP: this.activity.base_xp,
            secondaryXP: secondaryXP,
            baseSecondaryXP: this.activity.secondary_xp,
            gearStats: gearStats
        };
    }

    /**
     * Get gear stats for the selected activity and location
     * Requirements: 2.3, 2.4, 2.5, 2.10, 2.11
     * Reads from Column 2 combined stats
     * @returns {Object} Gear stats
     */
    getGearStats() {
        // Get combined stats from Column 2
        const combinedStatsSection = window.combinedStatsSection;
        if (!combinedStatsSection) {
            // Column 2 not available, return empty stats
            console.warn('Column 2 not available');
            return {
                work_efficiency: 0,
                double_action: 0,
                double_rewards: 0,
                flat_steps: 0,
                percent_steps: 0
            };
        }

        // Get the cached stats from Column 2
        const stats = combinedStatsSection.cachedStats || {};

        console.log('Column 2 cachedStats:', stats);
        console.log('WE from Column 2:', stats.work_efficiency);

        // Extract relevant stats for activities
        const result = {
            work_efficiency: (stats.work_efficiency || 0) / 100,  // Convert from percentage to decimal
            double_action: (stats.double_action || 0) / 100,
            double_rewards: (stats.double_rewards || 0) / 100,
            flat_steps: stats.flat_steps || stats.steps_add || 0,
            percent_steps: (stats.steps_percent || stats.steps_pct || 0) / 100
        };

        console.log('Converted gear stats for activity:', result);

        return result;
    }

    /**
     * Check if requirements are fulfilled
     * Requirements: 2.8, 2.9
     * @returns {Object} Requirements with fulfillment status
     */
    checkRequirementsFulfilled() {
        if (!this.activity) {
            return {};
        }

        const character = store.state.character || {};
        const requirements = this.activity.requirements || {};
        const fulfilled = {};

        // Check skill requirements
        if (requirements.skill_requirements) {
            fulfilled.skills = {};
            for (const [skill, requiredLevel] of Object.entries(requirements.skill_requirements)) {
                // Check user overrides first, then character data
                const overrides = store.state.ui?.user_overrides?.skills || {};
                const charLevel = overrides[skill.toLowerCase()] || character.skills?.[skill.toLowerCase()] || 0;
                fulfilled.skills[skill] = {
                    required: requiredLevel,
                    current: charLevel,
                    fulfilled: charLevel >= requiredLevel
                };
            }
        }

        // Check keyword requirements (diving gear, tools, etc.)
        if (requirements.keyword_counts) {
            fulfilled.keywords = {};
            const currentGear = store.state.gearsets?.current || {};

            // Keywords that ALSO have a minimum-skill-level requirement are shown
            // by the keyword_level_requirements block below (with the level), so
            // skip them here to avoid showing the same keyword twice.
            const leveledKeywords = new Set(
                (requirements.keyword_level_requirements || [])
                    .map(r => (r.keyword || '').toLowerCase())
            );

            // Collect keywords provided by the equipped pet's passive abilities
            // (e.g. Gecko Level 4 "Clever Climber" → "climbing gear"). The pet on
            // currentGear doesn't carry its own abilities, so look up the pet
            // catalog entry and pull abilities from the equipped level.
            const petProvidedKeywords = new Set();
            const equippedPet = currentGear.pet;
            if (equippedPet) {
                const petCatalog = window.optimizeButton?._petCatalog || [];
                const petId = (equippedPet.itemId || equippedPet.petId || equippedPet.id || equippedPet.name || '').toLowerCase();
                const petEntry = petCatalog.find(p =>
                    (p.id && p.id.toLowerCase() === petId) ||
                    (p.name && p.name.toLowerCase() === (equippedPet.name || '').toLowerCase())
                );
                const petLevel = equippedPet.level != null ? equippedPet.level : 0;
                const levelData = petEntry?.levels?.[String(petLevel)] || null;
                const abilities = levelData?.abilities || [];
                // Ability-name fallback for catalogs/exports that don't serialize provides_keyword.
                const ABILITY_NAME_TO_KEYWORD = {
                    'clever climber': 'climbing gear',
                };
                for (const ability of abilities) {
                    if (!ability) continue;
                    const provided = ability.provides_keyword;
                    if (typeof provided === 'string') {
                        petProvidedKeywords.add(provided.toLowerCase());
                    } else if (Array.isArray(provided)) {
                        for (const p of provided) {
                            if (typeof p === 'string') petProvidedKeywords.add(p.toLowerCase());
                        }
                    }
                    const mapped = ABILITY_NAME_TO_KEYWORD[(ability.name || '').toLowerCase()];
                    if (mapped) petProvidedKeywords.add(mapped);
                }
            }

            for (const [keyword, count] of Object.entries(requirements.keyword_counts)) {
                // Skip keywords that have a stricter level requirement (shown below)
                if (leveledKeywords.has(keyword.toLowerCase())) continue;
                // Count items in current gear that have this keyword
                let keywordCount = 0;

                for (const [slot, slotItem] of Object.entries(currentGear)) {
                    if (!slotItem || !slotItem.keywords) continue;

                    // Check if any keyword matches (case-insensitive, EXACT match).
                    // EXACT match — substring match would incorrectly count
                    // "Fishing rod rest" / "Fishing cage" / "Fishing tool" as
                    // satisfying a "fishing rod" requirement. Must mirror
                    // util/walkscape_constants.py:item_has_keyword.
                    const hasKeyword = slotItem.keywords.some(kw =>
                        kw.toLowerCase() === keyword.toLowerCase()
                    );

                    if (hasKeyword) {
                        keywordCount++;
                    }
                }

                // Also check selected input items (e.g., arrows in input slots)
                if (this._selectedInputItems) {
                    for (const [idx, inputItem] of Object.entries(this._selectedInputItems)) {
                        if (!inputItem || !inputItem.keywords) continue;
                        const hasKeyword = inputItem.keywords.some(kw =>
                            kw.toLowerCase() === keyword.toLowerCase()
                        );
                        if (hasKeyword) {
                            keywordCount++;
                        }
                    }
                }

                // Equipped pet passive ability counts as +1 (e.g. Gecko L4 Clever Climber → climbing gear)
                if (petProvidedKeywords.has(keyword.toLowerCase())) {
                    keywordCount++;
                }

                fulfilled.keywords[keyword] = {
                    required: count,
                    current: keywordCount,
                    fulfilled: keywordCount >= count
                };
            }
        }

        // Check tool keyword minimum-skill-level requirements, e.g.
        // "Have a Pickaxe equipped that requires at least Mining level 60".
        if (requirements.keyword_level_requirements && requirements.keyword_level_requirements.length > 0) {
            fulfilled.keyword_levels = [];
            const currentGear = store.state.gearsets?.current || {};
            for (const req of requirements.keyword_level_requirements) {
                const reqKw = (req.keyword || '').toLowerCase();
                const reqSkill = (req.skill || '').toLowerCase();
                const reqLevel = req.level || 0;
                let hasKeyword = false;
                let levelOk = false;
                let levelKnown = false;
                for (const slotItem of Object.values(currentGear)) {
                    if (!slotItem || !slotItem.keywords) continue;
                    if (!slotItem.keywords.some(kw => kw.toLowerCase() === reqKw)) continue;
                    hasKeyword = true;
                    // Verify the equipped tool's own skill-level requirement when available.
                    const itemReqs = Array.isArray(slotItem.requirements) ? slotItem.requirements : null;
                    if (itemReqs) {
                        for (const r of itemReqs) {
                            if (r && r.type === 'skill' && (r.skill || '').toLowerCase() === reqSkill) {
                                levelKnown = true;
                                if ((r.level || 0) >= reqLevel) { levelOk = true; }
                            }
                        }
                    }
                }
                // If item tier data isn't available on the client, fall back to
                // keyword presence (mirrors the plain keyword check, which only
                // verifies presence). The optimizer still enforces the tier.
                const isFulfilled = hasKeyword && (levelKnown ? levelOk : true);
                fulfilled.keyword_levels.push({
                    keyword: req.keyword,
                    skill: req.skill,
                    level: reqLevel,
                    fulfilled: isFulfilled
                });
            }
        }

        // Check reputation requirements
        if (requirements.reputation && Object.keys(requirements.reputation).length > 0) {
            fulfilled.reputation = {};
            for (const [faction, amount] of Object.entries(requirements.reputation)) {
                // Try to find character reputation with case-insensitive matching
                let charRep = 0;
                if (character.reputation) {
                    // Try exact match first
                    if (character.reputation[faction] !== undefined) {
                        charRep = character.reputation[faction];
                    } else {
                        // Try case-insensitive match
                        const factionLower = faction.toLowerCase();
                        for (const [charFaction, rep] of Object.entries(character.reputation)) {
                            if (charFaction.toLowerCase() === factionLower) {
                                charRep = rep;
                                break;
                            }
                        }
                    }
                }

                console.log(`Reputation check: ${faction} - required: ${amount}, current: ${charRep}, fulfilled: ${charRep >= amount}`);

                fulfilled.reputation[faction] = {
                    required: amount,
                    current: charRep,
                    fulfilled: charRep >= amount
                };
            }
        }

        // Check achievement points
        if (requirements.achievement_points) {
            const charAP = character.achievement_points || 0;
            fulfilled.achievement_points = {
                required: requirements.achievement_points,
                current: charAP,
                fulfilled: charAP >= requirements.achievement_points
            };
        }

        // Check item requirements (e.g., "Have item Spectral saw equipped")
        if (requirements.item_requirements && requirements.item_requirements.length > 0) {
            fulfilled.item_requirements = {};
            const currentGear = store.state.gearsets?.current || {};
            const equippedNames = new Set();
            for (const slotItem of Object.values(currentGear)) {
                if (slotItem && slotItem.name) {
                    equippedNames.add(slotItem.name.toLowerCase());
                }
            }
            for (const requiredName of requirements.item_requirements) {
                fulfilled.item_requirements[requiredName] = {
                    fulfilled: equippedNames.has(requiredName.toLowerCase())
                };
            }
        }

        return fulfilled;
    }

    /**
     * Calculate level bonus for work efficiency
     * Requirements: 7.6
     * @returns {number} WE bonus percentage
     */
    calculateLevelBonusWE() {
        if (!this.activity) {
            return 0;
        }

        const character = store.state.character || {};
        const primarySkill = this.activity.primary_skill.toLowerCase();

        // Check user overrides first, then character data
        const overrides = store.state.ui?.user_overrides?.skills || {};
        const charLevel = overrides[primarySkill] || character.skills?.[primarySkill] || 0;

        // Get required level from skill requirements
        const requirements = this.activity.requirements?.skill_requirements || {};
        const requiredLevel = requirements[this.activity.primary_skill] || 1;

        const levelsAbove = Math.max(0, charLevel - requiredLevel);
        const bonus = Math.min(levelsAbove * 1.25, 25);

        return bonus;
    }

    /**
     * Render inputs section — shows items consumed per action
     * Only displayed if the activity has input_items
     */

    async _loadCustomKeywords() {
        try {
            const data = await api.getCustomKeywords();
            this._customKeywords = data.keywords || [];
        } catch (e) { this._customKeywords = []; }
    }

    /**
     * Render inputs section
     * @returns {string} HTML for inputs section
     */
    renderInputsSection() {
        if (!this.activity || !this.activity.input_items || this.activity.input_items.length === 0) {
            return '';
        }

        // Filter out invalid/empty input items
        const validInputItems = this.activity.input_items.filter(ii => ii && ii.name);
        if (validInputItems.length === 0) {
            return '';
        }

        // Check if any input item is a keyword type (selectable slot)
        let hasKeywordInput = false;

        const itemsHtml = validInputItems.map((ii, idx) => {
            const itemId = ii.name.toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
            const isKeyword = ii.type === 'keyword';
            const selectedItem = this._selectedInputItems?.[idx] || null;

            if (isKeyword || selectedItem) {
                hasKeywordInput = true;
                let slotInner, slotClasses = 'input-item-slot';
                if (selectedItem) {
                    slotClasses += ' equipped';
                    // Apply fine styling when checkbox is checked
                    if (this.useFineInputs) {
                        slotClasses += ' fine';
                    } else {
                        const rarity = selectedItem.rarity || 'common';
                        slotClasses += ` rarity-${rarity}`;
                    }
                    if (selectedItem.is_generic && selectedItem.icon && !selectedItem.icon_path) {
                        const iconStyle = selectedItem.icon_color ? `${window.emojiTintStyle(selectedItem.icon_color)}` : '';
                        slotInner = `<span class="input-slot-emoji" style="${iconStyle}">${selectedItem.icon}</span>`;
                    } else {
                        const selItemId = (selectedItem.name || '').toLowerCase().replace(/ /g, '_').replace(/[^a-z0-9_]/g, '');
                        const iconPath = selectedItem.icon_path || `/assets/icons/items/materials/${selItemId}.svg`;
                        slotInner = `<img src="${iconPath}" alt="${selectedItem.name}" class="input-slot-icon" onerror="this.style.display='none'" />`;
                    }
                } else {
                    const label = isKeyword ? (ii.name.length > 6 ? ii.name.substring(0, 5) + '…' : ii.name) : 'INPUT';
                    slotInner = `<span class="input-slot-name">${label}</span>`;
                }
                const title = selectedItem ? selectedItem.name : `Select ${ii.name}`;

                return `<div class="input-item-row">
                    <div class="${slotClasses}" data-input-idx="${idx}" data-input-keyword="${ii.reference || ii.name}" data-input-level="${ii.level || 0}" title="${title}">
                        ${slotInner}
                    </div>
                    <div>
                        <span class="input-item-label">
                            ${(() => {
                        const ck = this._customKeywords.find(k => k.name.toLowerCase() === ii.name.toLowerCase());
                        if (ck && ck.icon) {
                            const cs = ck.icon_color ? `${window.emojiTintStyle(ck.icon_color)};` : '';
                            return `<span style="font-size:14px;vertical-align:middle;margin-right:2px;${cs}">${ck.icon}</span>`;
                        }
                        return `<img src="/assets/icons/keywords/${itemId}.svg" style="width:16px;height:16px;vertical-align:middle;margin-right:2px" onerror="this.outerHTML='<span style=\\'font-size:14px;vertical-align:middle;margin-right:2px\\'>🏷️</span>'" />`;
                    })()}
                            <span class="input-qty">${ii.quantity}×</span> ${ii.name}${ii.level ? ` <span class="input-level-req" title="Requires level ${ii.level}+ items">Lv.${ii.level}+</span>` : ''}${ii.optional ? ' <span class="input-optional-badge" title="This input is optional">(optional)</span>' : ''}
                        </span>
                    </div>
                </div>`;
            } else {
                // Simple material — render as material box (no selection needed)
                const iconPath = `/assets/icons/items/materials/${itemId}.svg`;
                const fallback = `/assets/icons/items/${itemId}.svg`;
                return `<div class="material-item" title="${ii.name}">
                    <img src="${iconPath}" alt="${ii.name}" class="material-icon"
                        onerror="this.onerror=null;this.src='${fallback}';this.onerror=function(){this.style.display='none';this.parentNode.insertAdjacentHTML('afterbegin','<span style=\\'font-size:16px\\'>📥</span>')}" />
                    <span class="material-quantity">${ii.quantity}</span>
                </div>`;
            }
        }).join('');

        // Fine inputs checkbox — only show when there are keyword-type inputs (selectable slots)
        let fineCheckboxHtml = '';
        if (hasKeywordInput) {
            fineCheckboxHtml = `
                <div class="fine-inputs-toggle" style="margin-top:6px">
                    <label class="fine-checkbox" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:12px">
                        <input type="checkbox" class="fine-inputs-cb" ${this.useFineInputs ? 'checked' : ''} />
                        <span class="fine-checkbox-label">Fine Inputs</span>
                    </label>
                </div>`;
        }

        return `
            <div class="recipe-section">
                <div class="section-header">INPUTS</div>
                <div class="materials-grid" style="gap:8px">
                    ${itemsHtml}
                </div>
                ${fineCheckboxHtml}
            </div>
        `;
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

        const skillType = (this.activity?.primary_skill || '').toLowerCase();
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
     * Render stats section
     * Requirements: 2.3, 2.4, 2.5
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
        const maxWEPercent = this.activity.max_efficiency * 100;

        // Check if WE exceeds or equals max (green highlighting)
        const weExceedsMax = currentWEPercent >= maxWEPercent;
        const weClass = weExceedsMax ? 'stat-value-positive' : 'stat-value';
        const weRowClass = weExceedsMax ? 'we-maxed' : '';

        // Format WE for display - offset by 100 to match in-game display (100% = no bonus)
        const currentWEDisplay = currentWEPercent + 100;
        const maxWEDisplay = maxWEPercent + 100;
        const currentWEFormatted = (currentWEDisplay % 1 === 0)
            ? formatFixed(currentWEDisplay, 0)
            : (currentWEDisplay % 0.1 < 0.01)
                ? formatFixed(currentWEDisplay, 1)
                : formatFixed(currentWEDisplay, 2);
        const maxWEFormatted = (maxWEDisplay % 1 === 0) ? formatFixed(maxWEDisplay, 0) : formatFixed(maxWEDisplay, 1);

        return `
            <div class="activity-section">
                <div class="section-header">STATS</div>
                <div class="stats-grid">
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/steps_required.svg" alt="Steps" class="stat-icon" title="Steps per Activity" />
                        <span class="stat-value">${stats.currentSteps} / ${stats.baseSteps}</span>
                    </div>
                    <div class="info-stat-row ${weRowClass}">
                        <img src="/assets/icons/attributes/work_efficiency.svg" alt="WE" class="stat-icon" title="Work Efficiency" />
                        <span class="${weClass}">${currentWEFormatted} / ${maxWEFormatted}%</span>
                    </div>
                    <div class="info-stat-row">
                        <img src="/assets/icons/attributes/double_rewards.svg" alt="DR" class="stat-icon" title="Steps per Reward Roll" />
                        <span class="stat-value">${formatFixed(stats.stepsPerRewardRoll, 2)}</span>
                    </div>
                    ${this._renderInstantActionsStatRow()}
                </div>
            </div>
        `;
    }

    /**
     * Render the instant-actions "reward rolls per activation" stat row.
     * Only shown when the instant-actions checkbox is checked. The pet runs
     * `count` actions per activation, so reward rolls per activation is
     * count × (1+DA) × (1+DR) — matching the recipe info section's per-charge
     * stats. Rendered as the reward-rolls icon "/" pet icon (per activation).
     */
    _renderInstantActionsStatRow() {
        const petInfo = this._getActiveInstantActionsPet();
        if (!petInfo) return '';

        const gearStats = this.getGearStats();
        const da = gearStats.double_action || 0;
        const dr = gearStats.double_rewards || 0;
        const chargeCount = petInfo.count || 5;
        const rewardRollsPerActivation = chargeCount * (1 + da) * (1 + dr);
        const formatted = formatFixed(rewardRollsPerActivation, 3, { trim: true });
        const title = `Reward rolls per activation (${chargeCount} actions × (1+DA) × (1+DR))`;

        return `
            <div class="info-stat-row" title="${title}">
                <img src="/assets/icons/attributes/double_rewards.svg" alt="Reward rolls" class="stat-icon" title="${title}" />
                <span style="font-size:0.85em;color:var(--text-secondary)">/</span>
                <img src="${petInfo.iconPath}" alt="${petInfo.petName}" class="stat-icon"
                     style="width:24px;height:24px;object-fit:contain;margin:-2px 0"
                     title="${title}"
                     onerror="this.src='/assets/icons/items/pet_eggs/${petInfo.species}_egg.svg'" />
                <span class="stat-value" title="${title}">${formatted}</span>
            </div>
        `;
    }

    /**
     * Render requirements section
     * Requirements: 2.6, 2.7, 2.8, 2.9
     * @returns {string} HTML for requirements section
     */
    renderRequirementsSection() {
        const fulfilled = this.checkRequirementsFulfilled();
        if (Object.keys(fulfilled).length === 0) {
            return '';
        }

        let html = `
            <div class="activity-section">
                <div class="section-header">REQUIREMENTS</div>
                <div class="requirements-grid">
        `;

        // Skill requirements - show skill icon + required level
        if (fulfilled.skills) {
            for (const [skill, req] of Object.entries(fulfilled.skills)) {
                const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                const skillColor = this.getSkillColor(skill);

                html += `
                    <div class="requirement-item ${borderClass}" style="border-color: ${skillColor};">
                        ${skillIconHtml(skill, 'requirement-icon')}
                        <span class="requirement-value">${req.required}</span>
                    </div>
                `;
            }
        }

        // Keyword requirements (diving gear, tools, etc.) - show count + icon + keyword
        if (fulfilled.keywords) {
            for (const [keyword, req] of Object.entries(fulfilled.keywords)) {
                const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';

                // Convert keyword to icon filename (preserve casing, replace spaces with underscores)
                const keywordId = keyword.replace(/ /g, '_').replace(/'/g, '');
                const keywordIcon = `/assets/icons/keywords/${keywordId}.svg`;

                html += `
                    <div class="requirement-item ${borderClass}">
                        <span class="requirement-value">${req.required}</span>
                        <img src="${keywordIcon}" alt="${keyword}" class="requirement-icon" title="${keyword}" />
                        <span class="requirement-label">${keyword}</span>
                    </div>
                `;
            }
        }

        // Tool keyword minimum-skill-level requirements
        // (e.g. "Pickaxe requiring Mining 60"): keyword icon + skill icon + level
        if (fulfilled.keyword_levels) {
            for (const req of fulfilled.keyword_levels) {
                const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                const keywordId = (req.keyword || '').replace(/ /g, '_').replace(/'/g, '');
                const keywordIcon = `/assets/icons/keywords/${keywordId}.svg`;
                const title = `${req.keyword} that requires at least ${req.skill} level ${req.level}`;

                html += `
                    <div class="requirement-item ${borderClass}" title="${title}">
                        <img src="${keywordIcon}" alt="${req.keyword}" class="requirement-icon" />
                        <span class="requirement-label">${req.keyword}</span>
                        ${skillIconHtml(req.skill, 'requirement-icon')}
                        <span class="requirement-value">${req.level}</span>
                    </div>
                `;
            }
        }

        // Reputation requirements - show faction icon + required amount
        if (fulfilled.reputation) {
            for (const [faction, req] of Object.entries(fulfilled.reputation)) {
                const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';

                // Convert faction name to icon filename (lowercase with underscores)
                const factionId = faction.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                const factionIcon = `/assets/icons/factions/${factionId}.svg`;

                html += `
                    <div class="requirement-item ${borderClass}">
                        <img src="${factionIcon}" alt="${faction}" class="requirement-icon" title="${faction} Reputation ${req.required}" />
                        <span class="requirement-value">${req.required}</span>
                    </div>
                `;
            }
        }

        // Achievement points - show amount + AP
        if (fulfilled.achievement_points) {
            const req = fulfilled.achievement_points;
            const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';

            html += `
                <div class="requirement-item ${borderClass}">
                    <span class="requirement-value">${req.required}</span>
                    <img src="/assets/icons/text/general_icons/achievement_points.svg" alt="AP" class="requirement-icon" title="Achievement Points" />
                </div>
            `;
        }

        // Item requirements - show item icon + name (e.g., Spectral saw)
        if (fulfilled.item_requirements) {
            for (const [itemName, req] of Object.entries(fulfilled.item_requirements)) {
                const borderClass = req.fulfilled ? 'requirement-fulfilled' : 'requirement-not-fulfilled';
                const itemId = itemName.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                const itemIcon = `/assets/icons/items/equipment/${itemId}.svg`;

                html += `
                    <div class="requirement-item ${borderClass}">
                        <img src="${itemIcon}" alt="${itemName}" class="requirement-icon" title="${itemName}" onerror="this.style.display='none'" />
                        <span class="requirement-label">${itemName}</span>
                    </div>
                `;
            }
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }



    /**
     * Toggle fine materials checkbox
     * @param {boolean} useFine - Whether to use fine materials
     */
    toggleFine(useFine) {
        console.log('[ActivityInfo] toggleFine called with:', useFine);
        console.log('[ActivityInfo] Before update - this.useFine:', this.useFine);

        this.useFine = useFine;

        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }
        store.state.column3.useFine = useFine;

        console.log('[ActivityInfo] After update - this.useFine:', this.useFine);
        console.log('[ActivityInfo] Calling render()...');

        // Notify subscribers
        store._notifySubscribers('column3.useFine');

        // Auto-save selection to session
        store._saveColumn3Selection();

        this.render();
        console.log('[ActivityInfo] Render complete');
    }

    /**
     * Render XP rewards section
     * Requirements: 2.10, 2.11
     * @returns {string} HTML for XP section
     */
    renderXPSection() {
        if (!this.activity) {
            return '';
        }

        const stats = this.calculateCurrentStats();
        if (!stats) {
            return '';
        }

        const primarySkill = this.activity.primary_skill;
        const primaryColor = this.getSkillColor(primarySkill);

        let html = `
            <div class="activity-section">
                <div class="section-header">XP REWARDS</div>
                <div class="xp-grid">
                    <div class="xp-row" style="border-color: ${primaryColor};">
                        ${skillIconHtml(primarySkill, 'xp-icon')}
                        <span class="xp-value">${formatFixed(stats.primaryXP, 2, { trim: true })} / ${formatFixed(stats.basePrimaryXP, 2, { trim: true })}</span>
                    </div>
        `;

        // Secondary XP
        if (stats.secondaryXP) {
            for (const [skill, xp] of Object.entries(stats.secondaryXP)) {
                const baseXP = stats.baseSecondaryXP[skill];
                const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                const skillColor = this.getSkillColor(skillName);

                html += `
                    <div class="xp-row" style="border-color: ${skillColor};">
                        ${skillIconHtml(skillName, 'xp-icon')}
                        <span class="xp-value">${formatFixed(xp, 2, { trim: true })} / ${formatFixed(baseXP, 2, { trim: true })}</span>
                    </div>
                `;
            }

            // Add total XP row only if there are secondary skills
            if (Object.keys(stats.secondaryXP).length > 0) {
                const totalXP = stats.primaryXP + Object.values(stats.secondaryXP).reduce((sum, xp) => sum + xp, 0);
                const baseTotalXP = stats.basePrimaryXP + Object.values(stats.baseSecondaryXP).reduce((sum, xp) => sum + xp, 0);

                html += `
                    <div class="xp-row xp-total">
                        <img src="/assets/icons/attributes/bonus_experience.svg" alt="Total XP" class="xp-icon" title="Total XP" />
                        <span class="xp-value">${formatFixed(totalXP, 2, { trim: true })} / ${formatFixed(baseTotalXP, 2, { trim: true })}</span>
                    </div>
                `;
            }
        }

        html += `
                </div>
            </div>
        `;

        // XP per step section - separate section with per-skill breakdown
        html += `
            <div class="activity-section">
                <div class="section-header">XP PER STEP</div>
                <div class="xp-grid">
        `;

        // Primary skill XP/step (use expectedSteps for XP/step calculation)
        const primaryXPPerStep = formatFixed((stats.primaryXP / stats.expectedSteps), 3, { trim: true });
        html += `
                    <div class="xp-row" style="border-color: ${primaryColor};">
                        ${skillIconHtml(primarySkill, 'xp-icon')}
                        <span class="xp-value">${primaryXPPerStep}</span>
                    </div>
        `;

        // Secondary skills XP/step
        if (stats.secondaryXP) {
            for (const [skill, xp] of Object.entries(stats.secondaryXP)) {
                const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                const skillColor = this.getSkillColor(skillName);
                const xpPerStep = formatFixed((xp / stats.expectedSteps), 3, { trim: true });

                html += `
                    <div class="xp-row" style="border-color: ${skillColor};">
                        ${skillIconHtml(skillName, 'xp-icon')}
                        <span class="xp-value">${xpPerStep}</span>
                    </div>
                `;
            }
        }

        // Total XP per step - only show if there are secondary skills
        if (stats.secondaryXP && Object.keys(stats.secondaryXP).length > 0) {
            html += `
                    <div class="xp-row xp-total">
                        <img src="/assets/icons/attributes/bonus_experience.svg" alt="Total XP/Step" class="xp-icon" title="Total XP per Step" />
                        <span class="xp-value">${stats.xpPerStep}</span>
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
     * Render locations section
     * Requirements: 2.12, 2.13, 2.14, 2.15, 2.16
     * @returns {string} HTML for locations section
     */
    renderLocationsSection() {
        if (!this.activity || !this.activity.locations || this.activity.locations.length === 0) {
            return '';
        }

        let html = `
            <div class="activity-section">
                <div class="section-header">LOCATIONS</div>
                <div class="locations-grid">
        `;

        for (const location of this.activity.locations) {
            const isSelected = location.id === this.selectedLocation;
            const selectedClass = isSelected ? 'location-selected' : '';

            // Use icon_name from location data if available, otherwise fall back to location id
            const iconPath = location.icon_name
                ? `/assets/icons/locations/${location.icon_name}`
                : `/assets/icons/locations/${location.id}.svg`;

            html += `
                <div class="location-item ${selectedClass}" data-location-id="${location.id}">
                    <img src="${iconPath}" alt="${location.name}" class="location-icon" />
                    <span class="location-name">${location.name}</span>
                </div>
            `;
        }

        html += `
                </div>
            </div >
            `;

        return html;
    }

    /**
     * Render the component
     * Requirements: 2.1, 2.2
     */
    render() {
        // Resilient wrapper (bug fbb51cdb): a throw anywhere in the render
        // body used to leave Column 3 (the "Activity page") permanently blank
        // while Columns 1 & 2 rendered fine — an unrecoverable, silent failure
        // for the user. Now we catch, log the real error into the debug log
        // (so it ships with any future bug report), and paint a visible
        // fallback instead of nothing.
        try {
            this._renderImpl();
        } catch (err) {
            console.error('[ActivityInfo] render() failed:', err);
            if (typeof window !== 'undefined' && window.__walkscapeRecordError) {
                window.__walkscapeRecordError('activityinfo-render', err);
            }
            try {
                const name = (this.activity && this.activity.name) ? this.activity.name : 'this activity';
                this.$element.html(`
                    <div class="activity-info-section" data-pin-id="activity-info" style="padding:12px;">
                        <div class="activity-info-header">
                            <span class="activity-info-title">Couldn't display ${name}</span>
                        </div>
                        <div class="activity-info-content" style="display:block;">
                            <p>Something went wrong rendering this activity. Try reselecting it or reloading the page. The error has been logged for the developers.</p>
                        </div>
                    </div>
                `);
            } catch (_) { /* element detached — nothing more we can do */ }
        }
    }

    _renderImpl() {
        console.log('[ActivityInfo] render() called, useFine:', this.useFine);

        if (!this.activity) {
            // Destroy travel section if it exists
            if (this.travelInfoSection) {
                this.travelInfoSection.destroy();
                this.travelInfoSection = null;
            }
            this.$element.html('');
            return;
        }

        // If this is a travel activity, render TravelInfoSection instead
        if (this.activity.is_travel) {
            if (!this.travelInfoSection) {
                this.$element.html('<div id="travel-info-section-container"></div>');
                this.travelInfoSection = new TravelInfoSection(
                    this.$element.find('#travel-info-section-container'),
                    {
                        onRouteChange: (routeData) => {
                            // Store route data for optimize button access
                            window.currentTravelRoute = routeData;
                            // Notify Combined Stats so location-scoped travel
                            // bonuses are matched against the new route's segments.
                            window.dispatchEvent(new CustomEvent('travelRouteChanged'));
                        }
                    }
                );
            }
            return;
        }

        // Not a travel activity - destroy travel section if it exists
        if (this.travelInfoSection) {
            this.travelInfoSection.destroy();
            this.travelInfoSection = null;
            window.currentTravelRoute = null;
            window.dispatchEvent(new CustomEvent('travelRouteChanged'));
        }

        const skillColor = this.getSkillColor(this.activity.primary_skill);

        // Check if WE exceeds max for green border
        const combinedStatsSection = window.combinedStatsSection;
        const column2Stats = combinedStatsSection?.cachedStats || {};
        const currentWEPercent = column2Stats.work_efficiency || 0;
        const maxWEPercent = this.activity.max_efficiency * 100;
        const weExceedsMax = currentWEPercent >= maxWEPercent;

        console.log('[ActivityInfo] WE check:', {
            currentWEPercent,
            maxWEPercent,
            weExceedsMax
        });

        // Add class for green border if WE exceeds max
        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;

        const contentHtml = `
            ${this.renderInputsSection()}
            ${this.renderStatsSection()}
            ${this.renderRequirementsSection()}
            ${this.renderXPSection()}
            ${this.renderLocationsSection()}
        `;

        const html = `
            <div class="activity-info-section " data-pin-id="activity-info" style="border-color: ${skillColor};">
                <div class="activity-info-header">
                    <span class="activity-info-title">${this.activity.name.toUpperCase()}</span>
                    ${arrowIcon}
                </div>
                <div class="activity-info-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                    <div class="info-wiki-link-wrapper"><a href="https://wiki.walkscape.app/wiki/${encodeURIComponent(this.activity.name.replace(/ /g, '_'))}${wikiDarkModeSuffix()}" target="_blank" rel="noopener noreferrer" class="wiki-link info-wiki-link">Wiki</a></div>
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

        // Collapse toggle - make entire header clickable
        this.$element.on('click', '.activity-info-header', (e) => {
            e.stopPropagation();
            this.toggleExpanded();
        });

        // Location selection
        this.$element.on('click', '.location-item', (e) => {
            e.stopPropagation();
            const locationId = $(e.currentTarget).data('location-id');
            this.selectLocation(locationId);
        });

        // Fine inputs checkbox
        this.$element.off('change', '.fine-inputs-cb');
        this.$element.on('change', '.fine-inputs-cb', (e) => {
            e.stopPropagation();
            this.useFineInputs = e.target.checked;
            if (!store.state.column3) store.state.column3 = {};
            store.state.column3.useFineInputs = this.useFineInputs;
            store._saveColumn3Selection();
            // Notify combined stats to update fine input bonus
            const css = window.combinedStatsSection;
            if (css && typeof css.setFineInputs === 'function') {
                css.setFineInputs(this.useFineInputs);
            }
            // Update slot styling without full re-render
            this.$element.find('.input-item-slot.equipped').toggleClass('fine', this.useFineInputs);
            if (!this.useFineInputs) {
                this.$element.find('.input-item-slot.equipped').each(function () {
                    if (!$(this).hasClass('fine')) {
                        const rarity = $(this).data('rarity') || 'common';
                        $(this).addClass('rarity-' + rarity);
                    }
                });
            }
        });

        // Input item slot click — open item selection popup filtered to keyword
        this.$element.on('click', '.input-item-slot', (e) => {
            e.stopPropagation();
            const $slot = $(e.currentTarget);
            const idx = parseInt($slot.data('input-idx'));
            const keyword = $slot.data('input-keyword');
            const level = parseInt($slot.data('input-level')) || 0;

            // Store callback for when item is selected
            this._pendingInputSlotIdx = idx;
            this._pendingInputKeyword = keyword;

            // Open the item selection popup for the 'input' slot with keyword filter
            if (window.itemSelectionPopup && typeof window.itemSelectionPopup.show === 'function') {
                window.itemSelectionPopup.show('input', {
                    filterKeyword: keyword,
                    filterLevel: level,
                    onSelect: (item) => {
                        this._selectedInputItems[idx] = item;
                        // Persist to store for session save
                        if (!store.state.column3) store.state.column3 = {};
                        store.state.column3.selectedInputItems = { ...this._selectedInputItems };
                        store._saveColumn3Selection();
                        this.render();
                        const css = window.combinedStatsSection;
                        if (css && typeof css.setInputItem === 'function') {
                            css.setInputItem(idx, item);
                        }
                    },
                    onUnequip: () => {
                        delete this._selectedInputItems[idx];
                        if (!store.state.column3) store.state.column3 = {};
                        store.state.column3.selectedInputItems = { ...this._selectedInputItems };
                        store._saveColumn3Selection();
                        this.render();
                        const css = window.combinedStatsSection;
                        if (css && typeof css.setInputItem === 'function') {
                            css.setInputItem(idx, null);
                        }
                    }
                });
            }
        });
    }

    /**
     * Notify Column 2 of activity change
     * Requirements: 7.1
     * @param {Object|null} activity - Activity object or null
     */
    async notifyColumn2ActivityChange(activity) {
        // Find Column 2 combined stats section
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setActivity === 'function') {
            await combinedStatsSection.setActivity(activity ? activity.id : null);
        }
    }

    /**
     * Notify Column 2 of location change
     * Requirements: 7.4
     * @param {string|null} locationId - Location ID or null
     */
    async notifyColumn2LocationChange(locationId) {
        // Find Column 2 combined stats section
        const combinedStatsSection = window.combinedStatsSection;
        if (combinedStatsSection && typeof combinedStatsSection.setLocation === 'function') {
            await combinedStatsSection.setLocation(locationId);
        }
    }
}

export default ActivityInfoSection;
