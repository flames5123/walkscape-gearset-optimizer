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

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedLocation', () => this.onLocationChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());
        this.subscribe('ui.user_overrides.skills', () => this.onSkillOverridesChange());
        this.subscribe('character.skills', () => this.onSkillsChange());

        // Subscribe to Column 2 stats updates
        // When Column 2 finishes calculating, re-render to show updated stats
        if (window.combinedStatsSection) {
            window.combinedStatsSection.statsCalculatedCallbacks.push(() => {
                if (this.activity) {
                    console.log('Column 2 stats updated, re-rendering Column 3');
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
            this.activity = null;
            this.selectedLocation = null;
            this.render();

            // Notify Column 2 that activity was cleared
            // Requirements: 7.1
            await this.notifyColumn2ActivityChange(null);
            return;
        }

        // Fetch activity details from API
        try {
            const response = await $.get('/api/activities');

            // Find activity by ID
            for (const activities of Object.values(response.by_skill)) {
                const activity = activities.find(a => a.id === selectedId);
                if (activity) {
                    this.activity = activity;

                    // Initialize useFine from state
                    this.useFine = store.state.column3?.useFine || false;

                    // Auto-select first location
                    if (activity.locations && activity.locations.length > 0) {
                        const firstLocation = activity.locations[0];
                        this.selectedLocation = firstLocation.id;

                        // Update state
                        if (!store.state.column3) {
                            store.state.column3 = {};
                        }
                        store.state.column3.selectedLocation = this.selectedLocation;

                        // Notify Column 2 of both activity and location together (single render)
                        // This ensures location-aware stats work immediately without duplicate renders
                        const locationRegions = firstLocation.regions && firstLocation.regions.length > 0
                            ? firstLocation.regions
                            : [firstLocation.id];
                        console.log('Auto-selected first location with regions:', locationRegions);

                        // Use batched update if available, otherwise fall back to separate calls
                        const combinedStatsSection = window.combinedStatsSection;
                        if (combinedStatsSection && typeof combinedStatsSection.setActivityAndLocation === 'function') {
                            await combinedStatsSection.setActivityAndLocation(activity.id, locationRegions);
                        } else {
                            // Fallback to separate calls
                            await this.notifyColumn2ActivityChange(activity);
                            await this.notifyColumn2LocationChange(locationRegions);
                        }
                    } else {
                        // No locations, just notify activity change
                        await this.notifyColumn2ActivityChange(activity);
                    }

                    // Column 3 will re-render when Column 2 calls onStatsCalculated callback
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

        // Don't notify subscribers here - will cause double render
        // store._notifySubscribers('column3.selectedLocation');

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

        // Don't call render() here - Column 2 callback will handle it
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

        // Step 2: Calculate base steps with efficiency (no ceil yet)
        const stepsWithEfficiency = baseSteps / totalEfficiency;

        // Step 3: Calculate min_steps
        const minSteps = baseSteps * Math.pow(1 + maxEfficiency, -1);

        // Step 4: Take max of steps_with_efficiency and min_steps
        const stepsAfterMin = Math.max(stepsWithEfficiency, minSteps);

        // Step 5: Apply percentage reduction and ceil
        const stepsWithPct = Math.ceil(stepsAfterMin * (1 + pct));

        // Step 6: Apply flat modifier
        const stepsPerSingleAction = Math.max(10, stepsWithPct + flat);

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

        const xpPerStep = (totalXP / expectedStepsPerAction).toFixed(3);

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

            for (const [keyword, count] of Object.entries(requirements.keyword_counts)) {
                // Count items in current gear that have this keyword
                let keywordCount = 0;

                for (const [slot, slotItem] of Object.entries(currentGear)) {
                    if (!slotItem || !slotItem.keywords) continue;

                    // Check if any keyword matches (case-insensitive)
                    const hasKeyword = slotItem.keywords.some(kw =>
                        kw.toLowerCase().includes(keyword.toLowerCase())
                    );

                    if (hasKeyword) {
                        keywordCount++;
                    }
                }

                fulfilled.keywords[keyword] = {
                    required: count,
                    current: keywordCount,
                    fulfilled: keywordCount >= count
                };
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

        // Format WE - show 2 decimals if needed, otherwise 1 or 0
        const currentWEFormatted = (currentWEPercent % 1 === 0)
            ? currentWEPercent.toFixed(0)
            : (currentWEPercent % 0.1 < 0.01)
                ? currentWEPercent.toFixed(1)
                : currentWEPercent.toFixed(2);
        const maxWEFormatted = (maxWEPercent % 1 === 0) ? maxWEPercent.toFixed(0) : maxWEPercent.toFixed(1);

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
                        <span class="stat-value">${stats.stepsPerRewardRoll.toFixed(2)}</span>
                    </div>
                </div>
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
                const skillId = skill.toLowerCase();
                const skillIcon = `/assets/icons/text/skill_icons/${skillId}.svg`;

                html += `
                    <div class="requirement-item ${borderClass}" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${skill}" class="requirement-icon" title="${skill} Level ${req.required}" />
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
                    <span class="requirement-value">${req.required} AP</span>
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

        // Get skill icon path
        const primarySkillId = primarySkill.toLowerCase();
        const primarySkillIcon = `/assets/icons/text/skill_icons/${primarySkillId}.svg`;

        let html = `
            <div class="activity-section">
                <div class="section-header">XP REWARDS</div>
                <div class="xp-grid">
                    <div class="xp-row" style="border-color: ${primaryColor};">
                        <img src="${primarySkillIcon}" alt="${primarySkill}" class="xp-icon" title="${primarySkill} XP" />
                        <span class="xp-value">${stats.primaryXP.toFixed(2).replace(/\.?0+$/, '')} / ${stats.basePrimaryXP.toFixed(2).replace(/\.?0+$/, '')}</span>
                    </div>
        `;

        // Secondary XP
        if (stats.secondaryXP) {
            for (const [skill, xp] of Object.entries(stats.secondaryXP)) {
                const baseXP = stats.baseSecondaryXP[skill];
                const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                const skillColor = this.getSkillColor(skillName);
                const skillIcon = `/assets/icons/text/skill_icons/${skill.toLowerCase()}.svg`;

                html += `
                    <div class="xp-row" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${skillName}" class="xp-icon" title="${skillName} XP" />
                        <span class="xp-value">${xp.toFixed(2).replace(/\.?0+$/, '')} / ${baseXP.toFixed(2).replace(/\.?0+$/, '')}</span>
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
                        <span class="xp-value">${totalXP.toFixed(2).replace(/\.?0+$/, '')} / ${baseTotalXP.toFixed(2).replace(/\.?0+$/, '')}</span>
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
        const primaryXPPerStep = (stats.primaryXP / stats.expectedSteps).toFixed(3).replace(/\.?0+$/, '');
        html += `
                    <div class="xp-row" style="border-color: ${primaryColor};">
                        <img src="${primarySkillIcon}" alt="${primarySkill}" class="xp-icon" title="${primarySkill} XP per Step" />
                        <span class="xp-value">${primaryXPPerStep}</span>
                    </div>
        `;

        // Secondary skills XP/step
        if (stats.secondaryXP) {
            for (const [skill, xp] of Object.entries(stats.secondaryXP)) {
                const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                const skillColor = this.getSkillColor(skillName);
                const skillIcon = `/assets/icons/text/skill_icons/${skill.toLowerCase()}.svg`;
                const xpPerStep = (xp / stats.expectedSteps).toFixed(3).replace(/\.?0+$/, '');

                html += `
                    <div class="xp-row" style="border-color: ${skillColor};">
                        <img src="${skillIcon}" alt="${skillName}" class="xp-icon" title="${skillName} XP per Step" />
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
        console.log('[ActivityInfo] render() called, useFine:', this.useFine);

        if (!this.activity) {
            this.$element.html('');
            return;
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
            ${this.renderStatsSection()}
            ${this.renderRequirementsSection()}
            ${this.renderXPSection()}
            ${this.renderLocationsSection()}
        `;

        const html = `
            <div class="activity-info-section " style="border-color: ${skillColor};">
                <div class="activity-info-header">
                    <span class="activity-info-title">${this.activity.name.toUpperCase()}</span>
                    ${arrowIcon}
                </div>
                <div class="activity-info-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
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
