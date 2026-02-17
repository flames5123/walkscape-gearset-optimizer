/**
 * CalculatorSection Component
 * 
 * Provides XP and material calculators for activities and recipes.
 * 
 * Features:
 * - Activity mode: Steps, Actions inputs
 * - Recipe mode: Steps, Actions, Materials, Crafts inputs
 * - Per-skill XP fields (Start XP, Gained XP, Target XP, Start Level, End Level)
 * - Bidirectional calculations (any field can be edited)
 * - Input validation (integers for XP/Steps, 1 decimal for Actions/Materials/Crafts)
 * 
 * Requirements: 5.1-5.6, 6.1-6.6
 */

import Component from './base.js';
import store from '../state.js';

class CalculatorSection extends Component {
    /**
     * Create a calculator section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // State
        this.mode = null; // 'activity' or 'recipe'
        this.activity = null;
        this.recipe = null;
        this.isExpanded = true;  // Add expanded state
        this.values = {
            steps: 0,
            actions: 0,
            materials: 0,
            crafts: 0,
            // Per-skill XP values
            skills: {}
        };

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());
        this.subscribe('character.skills', () => this.onSkillsChange());
        this.subscribe('ui.user_overrides.skills', () => this.onSkillsChange());

        // Initial render
        this.onActivityChange();
        this.onRecipeChange();
    }

    /**
     * Handle activity selection change
     */
    async onActivityChange() {
        const selectedId = store.state.column3?.selectedActivity;

        if (!selectedId) {
            if (this.mode === 'activity') {
                this.mode = null;
                this.activity = null;
                this.resetValues();
                this.render();
            }
            return;
        }

        // Fetch activity details
        try {
            const response = await $.get('/api/activities');
            for (const activities of Object.values(response.by_skill)) {
                const activity = activities.find(a => a.id === selectedId);
                if (activity) {
                    this.activity = activity;
                    this.mode = 'activity';
                    this.recipe = null;
                    this.resetValues();
                    this.initializeSkillValues();
                    this.render();
                    return;
                }
            }
        } catch (error) {
            console.error('Failed to load activity for calculator:', error);
        }
    }

    /**
     * Handle recipe selection change
     */
    async onRecipeChange() {
        const selectedId = store.state.column3?.selectedRecipe;

        if (!selectedId) {
            if (this.mode === 'recipe') {
                this.mode = null;
                this.recipe = null;
                this.resetValues();
                this.render();
            }
            return;
        }

        // Fetch recipe details
        try {
            const response = await $.get('/api/recipes');
            for (const recipes of Object.values(response.by_skill)) {
                const recipe = recipes.find(r => r.id === selectedId);
                if (recipe) {
                    this.recipe = recipe;
                    this.mode = 'recipe';
                    this.activity = null;
                    this.resetValues();
                    this.initializeSkillValues();
                    this.render();
                    return;
                }
            }
        } catch (error) {
            console.error('Failed to load recipe for calculator:', error);
        }
    }

    /**
     * Handle gearset change (recalculate)
     */
    onGearsetChange() {
        if (this.mode) {
            this.recalculateAll();
        }
    }

    /**
     * Handle fine materials checkbox change (recalculate XP)
     */
    onFineChange() {
        if (this.mode === 'recipe') {
            this.recalculateAll();
        }
    }

    /**
     * Handle skill level changes from Column 1
     */
    onSkillsChange() {
        if (!this.mode) return;

        // Update start XP and level for each skill
        const character = store.state.character || {};
        const overrides = store.state.ui?.user_overrides || {};
        const skillXpOverrides = overrides.skills_xp || {};
        const characterXp = character.skills_xp || {};

        for (const skill of Object.keys(this.values.skills)) {
            const skillLower = skill.toLowerCase();
            const newXP = skillXpOverrides[skillLower] !== undefined
                ? skillXpOverrides[skillLower]
                : (characterXp[skillLower] || 0);

            // Update start XP and level
            const skillData = this.values.skills[skill];
            const oldStartXP = skillData.startXP;

            if (newXP !== oldStartXP) {
                skillData.startXP = newXP;
                skillData.startLevel = this.xpToLevel(newXP);
                skillData.targetXP = newXP + skillData.gainedXP;
                skillData.endLevel = this.xpToLevel(skillData.targetXP);
            }
        }

        this.render();
    }

    /**
     * Reset all calculator values
     */
    resetValues() {
        this.values = {
            steps: 0,
            actions: 0,
            materials: 0,
            crafts: 0,
            skills: {}
        };
    }

    /**
     * Initialize skill values from character data
     */
    initializeSkillValues() {
        const character = store.state.character || {};
        const overrides = store.state.ui?.user_overrides || {};

        // Use XP from character data (not levels)
        const skillXpOverrides = overrides.skills_xp || {};
        const characterXp = character.skills_xp || {};

        // Get relevant skills for this activity/recipe
        const relevantSkills = this.getRelevantSkills();

        for (const skill of relevantSkills) {
            const skillLower = skill.toLowerCase();

            // Get XP (with override support)
            const currentXP = skillXpOverrides[skillLower] !== undefined
                ? skillXpOverrides[skillLower]
                : (characterXp[skillLower] || 0);

            const currentLevel = this.xpToLevel(currentXP);

            this.values.skills[skill] = {
                startXP: currentXP,
                gainedXP: 0,
                targetXP: currentXP,
                startLevel: currentLevel,
                endLevel: currentLevel
            };
        }
    }

    /**
     * Get relevant skills for current activity/recipe
     * @returns {Array<string>} Array of skill names
     */
    getRelevantSkills() {
        if (this.mode === 'activity' && this.activity) {
            const skills = [this.activity.primary_skill];
            if (this.activity.secondary_xp) {
                for (const skill of Object.keys(this.activity.secondary_xp)) {
                    const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                    if (!skills.includes(skillName)) {
                        skills.push(skillName);
                    }
                }
            }
            return skills;
        } else if (this.mode === 'recipe' && this.recipe) {
            return [this.recipe.skill];
        }
        return [];
    }

    /**
     * XP to level conversion
     * Uses the same table as Python backend
     * @param {number} xp - Total XP
     * @returns {number} Level
     */
    xpToLevel(xp) {
        const LEVEL_XP = [
            0, 83, 174, 276, 388, 512, 650, 801, 969,
            1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
            4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
            13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
            37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
            101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
            273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
            737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
            1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
            5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431
        ];

        // LEVEL_XP[i] is the XP required to reach level i+1
        // So if you have XP >= LEVEL_XP[i] but < LEVEL_XP[i+1], you're at level i+1
        for (let i = LEVEL_XP.length - 1; i >= 0; i--) {
            if (xp >= LEVEL_XP[i]) {
                return i + 1; // Return level (1-indexed)
            }
        }
        return 1; // Minimum level
    }

    /**
     * Level to XP conversion
     * @param {number} level - Level
     * @returns {number} XP required for that level
     */
    levelToXP(level) {
        const LEVEL_XP = [
            0, 83, 174, 276, 388, 512, 650, 801, 969,
            1154, 1358, 1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,
            4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824, 12031,
            13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
            37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721,
            101333, 111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
            273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032, 668051,
            737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581, 1629200, 1798808,
            1986068, 2192818, 2421087, 2673114, 2951373, 3258594, 3597792, 3972294, 4385776, 4842295,
            5346332, 5902831, 6517253, 7195629, 7944614, 8771558, 9684577, 10692629, 11805606, 13034431
        ];

        if (level < 1) return 0;
        if (level > 99) return LEVEL_XP[LEVEL_XP.length - 1];
        // LEVEL_XP[i] is XP for level i+1, so level N starts at LEVEL_XP[N-1]
        return LEVEL_XP[level - 1];
    }

    /**
     * Validate integer input (XP, Steps)
     * Requirements: 5.2, 6.2
     * @param {string} value - Input value
     * @returns {number} Validated integer
     */
    validateInteger(value) {
        const num = parseInt(value);
        if (isNaN(num) || num < 0) {
            return 0;
        }
        return num;
    }

    /**
     * Validate decimal input (Actions, Materials, Crafts)
     * Requirements: 5.2, 6.2
     * @param {string} value - Input value
     * @returns {number} Validated number with 1 decimal precision
     */
    validateDecimal(value) {
        const num = parseFloat(value);
        if (isNaN(num) || num < 0) {
            return 0;
        }
        return Math.round(num * 10) / 10;
    }

    /**
     * Get current stats for calculations
     * Calculates actual stats with gear bonuses applied
     * @returns {Object} Stats object
     */
    getCurrentStats() {
        if (this.mode === 'activity' && this.activity) {
            // Get gear stats
            const gearStats = this.getGearStats();

            // Calculate steps per action with gear bonuses
            const baseSteps = this.activity.base_steps;
            const maxEfficiency = this.activity.max_efficiency;
            const we = gearStats.work_efficiency || 0;
            const da = gearStats.double_action || 0;
            const flat = gearStats.flat_steps || 0;
            const pct = gearStats.percent_steps || 0;

            // Apply WE (capped at max efficiency)
            const cappedWE = Math.min(we, maxEfficiency);
            const minSteps = Math.ceil(baseSteps / (1 + maxEfficiency));
            const stepsWithWE = Math.max(Math.ceil(baseSteps / (1 + cappedWE)), minSteps);

            // Apply percentage and flat modifiers
            const stepsWithPct = Math.ceil(stepsWithWE * (1 + pct));
            const stepsPerSingleAction = Math.max(10, stepsWithPct + flat);

            // Apply DA for expected steps per action
            const stepsPerAction = Math.ceil((1 / (1 + da)) * stepsPerSingleAction);

            // Calculate total XP (primary + secondary) with bonuses
            let baseXP = this.activity.base_xp;
            let totalXP = baseXP;
            if (this.activity.secondary_xp) {
                for (const xp of Object.values(this.activity.secondary_xp)) {
                    totalXP += xp;
                }
            }

            // Apply XP bonuses from gear (same as activity-info-section.js)
            const combinedStatsSection = window.combinedStatsSection;
            const column2Stats = combinedStatsSection?.cachedStats || {};
            const bonusXPAdd = column2Stats.bonus_xp_add || column2Stats.bonus_experience_add || 0;
            const bonusXPPercent = (column2Stats.bonus_xp_percent || column2Stats.bonus_experience_percent || 0) / 100;

            // Apply bonuses: (base + add) * (1 + percent)
            totalXP = (totalXP + bonusXPAdd) * (1 + bonusXPPercent);

            return {
                stepsPerAction: stepsPerAction,
                xpPerAction: totalXP,  // XP per action (with bonuses)
                materialsPerCraft: 1.0,
                stepsPerCraft: stepsPerAction
            };
        } else if (this.mode === 'recipe' && this.recipe) {
            // Get gear stats
            const gearStats = this.getGearStats();

            // Calculate steps per action with gear bonuses using corrected formula
            const baseSteps = this.recipe.base_steps;
            const maxEfficiency = this.recipe.max_efficiency;
            const we = gearStats.work_efficiency || 0;
            const da = gearStats.double_action || 0;
            const dr = gearStats.double_rewards || 0;
            const nmc = gearStats.no_materials_consumed || 0;
            const flat = gearStats.flat_steps || 0;
            const pct = gearStats.percent_steps || 0;

            // Use corrected formula (only ceil at the end)
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseWithEfficiency = baseSteps / totalEfficiency;
            const withPct = baseWithEfficiency * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct) + flat, 10);

            // Calculate steps per action (accounting for DA)
            const actionsPerCompletion = 1 + da;
            const stepsPerAction = stepsPerSingleAction / actionsPerCompletion;

            // Calculate steps per craft (steps per reward roll)
            const rewardRollsPerCompletion = (1 + da) * (1 + dr);
            const stepsPerCraft = stepsPerSingleAction / rewardRollsPerCompletion;

            // Calculate XP (with fine materials bonus if applicable)
            const useFine = store.state.column3?.useFine || false;
            const canUseFine = this.recipe.has_fine_option;
            const fineBonus = (useFine && canUseFine) ? 0.75 : 0;

            // Get bonus XP from Column 2
            const combinedStatsSection = window.combinedStatsSection;
            const column2Stats = combinedStatsSection?.cachedStats || {};
            const bonusXPAdd = column2Stats.bonus_xp_add || column2Stats.bonus_experience_add || 0;
            const bonusXPPercent = (column2Stats.bonus_xp_percent || column2Stats.bonus_experience_percent || 0) / 100;

            // Calculate XP per action: (base + add) * (1 + pct) * (1 + fine)
            const xpPerAction = (this.recipe.base_xp + bonusXPAdd) * (1 + bonusXPPercent) * (1 + fineBonus);

            // Calculate crafts per material (from craft_compare.py formula)
            // crafts_per_material = (1 + DR) / (1 - NMC)
            const craftsPerMaterial = nmc < 1.0 ? (1 + dr) / (1 - nmc) : Infinity;

            // Materials per craft is the inverse
            const materialsPerCraft = craftsPerMaterial > 0 ? 1.0 / craftsPerMaterial : 1.0;

            console.log('Recipe calculator stats:', {
                dr, nmc, craftsPerMaterial, materialsPerCraft,
                stepsPerSingleAction, stepsPerCraft
            });

            return {
                stepsPerAction: stepsPerAction,  // Steps per paid action (with DA)
                stepsPerCraft: stepsPerCraft,  // Steps per craft (with DA and DR)
                xpPerAction: xpPerAction,
                materialsPerCraft: materialsPerCraft
            };
        }

        // Fallback
        return {
            stepsPerAction: 100,
            xpPerAction: 50,
            materialsPerCraft: 1.0,
            stepsPerCraft: 100
        };
    }

    /**
     * Get gear stats for calculations
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
                percent_steps: 0
            };
        }

        // Get the cached stats from Column 2 (only applied stats)
        const stats = combinedStatsSection.cachedStats || {};

        // Extract relevant stats (convert percentages to decimals)
        return {
            work_efficiency: (stats.work_efficiency || 0) / 100,
            double_action: (stats.double_action || 0) / 100,
            double_rewards: (stats.double_rewards || 0) / 100,
            no_materials_consumed: (stats.no_materials_consumed || 0) / 100,
            flat_steps: stats.flat_steps || stats.steps_add || 0,
            percent_steps: (stats.steps_percent || stats.steps_pct || 0) / 100
        };
    }

    /**
     * Calculate from steps
     * Requirements: 5.4, 6.4
     * @param {number} steps - Number of steps
 */
    calculateFromSteps(steps) {
        const stats = this.getCurrentStats();

        // Keep steps as entered
        this.values.steps = steps;

        // For recipes, calculate actions and crafts separately
        if (this.mode === 'recipe') {
            // Crafts = ceil(steps / stepsPerCraft)
            this.values.crafts = Math.ceil(steps / stats.stepsPerCraft);
            // Materials = ceil(crafts * materialsPerCraft)
            this.values.materials = Math.ceil(this.values.crafts * stats.materialsPerCraft);
            // Actions = round(crafts / (1 + DR))
            const gearStats = this.getGearStats();
            const dr = gearStats.double_rewards || 0;
            this.values.actions = Math.round(this.values.crafts / (1 + dr));
        } else {
            // For activities, actions = ceil(steps / stepsPerAction)
            this.values.actions = Math.ceil(steps / stats.stepsPerAction);
        }

        // Calculate XP for each skill
        this.calculateXPFromActions(this.values.actions);

        this.render();
    }

    /**
     * Calculate from actions
     * Requirements: 5.4, 6.4
     * @param {number} actions - Number of actions
     */
    calculateFromActions(actions) {
        const stats = this.getCurrentStats();

        // Keep actions as entered
        this.values.actions = actions;

        // Calculate steps from actions (actions are paid actions)
        this.values.steps = Math.round(actions * stats.stepsPerAction);

        // For recipes, calculate crafts and materials
        if (this.mode === 'recipe') {
            this.values.crafts = Math.round(this.values.steps / stats.stepsPerCraft);
            this.values.materials = Math.round(this.values.crafts * stats.materialsPerCraft);
        }

        // Calculate XP for each skill
        this.calculateXPFromActions(actions);

        this.render();
    }

    /**
     * Calculate from materials (recipe only)
     * Requirements: 6.4, 6.5
     * @param {number} materials - Number of materials
     */
    calculateFromMaterials(materials) {
        if (this.mode !== 'recipe') return;

        const stats = this.getCurrentStats();

        // Convert materials to crafts (rounded)
        const crafts = Math.round(materials / stats.materialsPerCraft);

        // Convert crafts to actions (rounded)
        const actions = Math.round(crafts * stats.stepsPerCraft / stats.stepsPerAction);

        // Recalculate everything from rounded actions
        this.calculateFromActions(actions);
    }

    /**
     * Calculate from crafts (recipe only)
     * Requirements: 6.4, 6.5
     * @param {number} crafts - Number of crafts
     */
    calculateFromCrafts(crafts) {
        if (this.mode !== 'recipe') return;

        const stats = this.getCurrentStats();

        // Convert crafts to actions (rounded)
        const actions = Math.round(crafts * stats.stepsPerCraft / stats.stepsPerAction);

        // Recalculate everything from rounded actions
        this.calculateFromActions(actions);
    }

    /**
     * Calculate XP from actions for all skills
     * @param {number} actions - Number of actions
     */
    calculateXPFromActions(actions) {
        const stats = this.getCurrentStats();

        for (const skill of Object.keys(this.values.skills)) {
            const skillData = this.values.skills[skill];

            // For recipes, calculate XP from steps (more accurate)
            // For activities, calculate from actions
            let gainedXP;
            if (this.mode === 'recipe') {
                // Get XP per step from recipe stats
                const recipeStats = this.recipe ? this.getRecipeStats() : null;
                const xpPerStep = recipeStats ? parseFloat(recipeStats.xpPerStep) : 0;
                gainedXP = this.validateInteger(this.values.steps * xpPerStep);
            } else {
                gainedXP = this.validateInteger(actions * stats.xpPerAction);
            }

            skillData.gainedXP = gainedXP;
            skillData.targetXP = skillData.startXP + gainedXP;
            skillData.endLevel = this.xpToLevel(skillData.targetXP);
        }
    }

    /**
     * Get recipe stats from RecipeInfoSection
     * @returns {Object|null} Recipe stats
     */
    getRecipeStats() {
        // Find RecipeInfoSection component
        const recipeInfoSection = window.recipeInfoSection;
        if (recipeInfoSection && typeof recipeInfoSection.calculateCurrentStats === 'function') {
            return recipeInfoSection.calculateCurrentStats();
        }
        return null;
    }

    /**
     * Calculate from gained XP
     * Requirements: 5.5, 6.5
     * @param {string} skill - Skill name
     * @param {number} gainedXP - XP gained
     */
    calculateFromGainedXP(skill, gainedXP) {
        const stats = this.getCurrentStats();
        const skillData = this.values.skills[skill];

        if (!skillData) return;

        // Update skill data
        skillData.gainedXP = gainedXP;
        skillData.targetXP = skillData.startXP + gainedXP;
        skillData.endLevel = this.xpToLevel(skillData.targetXP);

        // Calculate actions needed
        this.values.actions = this.validateDecimal(gainedXP / stats.xpPerAction);

        // Calculate steps
        this.values.steps = this.validateInteger(this.values.actions * stats.stepsPerAction);

        // For recipes, calculate materials and crafts
        if (this.mode === 'recipe') {
            this.values.crafts = this.values.actions;
            this.values.materials = this.validateDecimal(this.values.crafts * stats.materialsPerCraft);
        }

        this.render();
    }

    /**
     * Calculate from target XP
     * Requirements: 5.5, 6.5
     * @param {string} skill - Skill name
     * @param {number} targetXP - Target XP
     */
    calculateFromTargetXP(skill, targetXP) {
        const skillData = this.values.skills[skill];

        if (!skillData) return;

        // Calculate gained XP
        const gainedXP = Math.max(0, targetXP - skillData.startXP);

        // Use calculateFromGainedXP
        this.calculateFromGainedXP(skill, gainedXP);
    }

    /**
     * Calculate from start level
     * Requirements: 5.6, 6.6
     * @param {string} skill - Skill name
     * @param {number} startLevel - Start level
     */
    calculateFromStartLevel(skill, startLevel) {
        const skillData = this.values.skills[skill];

        if (!skillData) return;

        // Convert level to XP
        skillData.startXP = this.levelToXP(startLevel);
        skillData.startLevel = startLevel;

        // Recalculate target XP and end level
        skillData.targetXP = skillData.startXP + skillData.gainedXP;
        skillData.endLevel = this.xpToLevel(skillData.targetXP);

        this.render();
    }

    /**
     * Calculate from end level
     * Requirements: 5.6, 6.6
     * @param {string} skill - Skill name
     * @param {number} endLevel - End level
     */
    calculateFromEndLevel(skill, endLevel) {
        const skillData = this.values.skills[skill];

        if (!skillData) return;

        // Convert level to XP
        skillData.targetXP = this.levelToXP(endLevel);
        skillData.endLevel = endLevel;

        // Calculate gained XP
        const gainedXP = Math.max(0, skillData.targetXP - skillData.startXP);

        // Use calculateFromGainedXP
        this.calculateFromGainedXP(skill, gainedXP);
    }

    /**
     * Toggle section expanded/collapsed
     */
    toggleExpanded() {
        this.isExpanded = !this.isExpanded;

        const $content = this.$element.find('.calculator-content');
        const $arrow = this.$element.find('.calculator-header .expand-arrow');

        if (this.isExpanded) {
            $arrow.addClass('expanded');
            $content.slideDown(200);
        } else {
            $arrow.removeClass('expanded');
            $content.slideUp(200);
        }
    }

    /**
     * Recalculate all values (when gear changes)
     */
    recalculateAll() {
        // Recalculate from current steps value
        if (this.values.steps > 0) {
            this.calculateFromSteps(this.values.steps);
        }
    }

    /**
     * Render the component
     * Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3
     */
    render() {
        if (!this.mode) {
            this.$element.html('');
            return;
        }

        const arrowIcon = `<span class="expand-arrow ${this.isExpanded ? 'expanded' : ''}">▼</span>`;

        const html = `
            <div class="calculator-section">
                <div class="calculator-header">
                    <span class="calculator-title">CALCULATOR</span>
                    <button class="collapse-toggle">${arrowIcon}</button>
                </div>
                <div class="calculator-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                    ${this.renderMainInputs()}
                    ${this.renderSkillFields()}
                </div>
            </div>
        `;

        this.$element.html(html);
        this.attachEvents();
    }

    /**
     * Render main input fields (Steps, Actions, Materials, Crafts)
     * @returns {string} HTML for main inputs
     */
    renderMainInputs() {
        let html = `
            <div class="calculator-main-inputs">
                <div class="calculator-input-group">
                    <label class="calculator-label">Steps</label>
                    <input type="number" class="calculator-input" data-field="steps" value="${this.values.steps}" min="0" step="1" />
                </div>
                <div class="calculator-input-group">
                    <label class="calculator-label">Actions</label>
                    <input type="number" class="calculator-input" data-field="actions" value="${this.values.actions}" min="0" step="0.1" />
                </div>
        `;

        // Recipe mode: add Materials and Crafts
        if (this.mode === 'recipe') {
            html += `
                <div class="calculator-input-group">
                    <label class="calculator-label">Materials</label>
                    <input type="number" class="calculator-input" data-field="materials" value="${this.values.materials}" min="0" step="0.1" />
                </div>
                <div class="calculator-input-group">
                    <label class="calculator-label">Crafts</label>
                    <input type="number" class="calculator-input" data-field="crafts" value="${this.values.crafts}" min="0" step="0.1" />
                </div>
            `;
        }

        html += `
            </div>
        `;

        return html;
    }

    /**
     * Render per-skill XP fields
     * @returns {string} HTML for skill fields
     */
    renderSkillFields() {
        const skills = Object.keys(this.values.skills);

        if (skills.length === 0) {
            return '';
        }

        let html = `
            <div class="calculator-skill-fields">
        `;

        for (const skill of skills) {
            const skillData = this.values.skills[skill];
            const skillColor = this.getSkillColor(skill);
            const skillId = skill.toLowerCase();
            const skillIcon = `/assets/icons/text/skill_icons/${skillId}.svg`;

            html += `
                <div class="calculator-skill-section" style="border-color: ${skillColor};">
                    <div class="calculator-skill-header">
                        <img src="${skillIcon}" alt="${skill}" class="calculator-skill-icon" />
                        <span class="calculator-skill-name">${skill}</span>
                    </div>
                    <div class="calculator-skill-inputs">
                        <div class="calculator-input-group">
                            <label class="calculator-label">Start XP</label>
                            <input type="number" class="calculator-input" data-field="startXP" data-skill="${skill}" value="${skillData.startXP}" min="0" step="1" />
                        </div>
                        <div class="calculator-input-group">
                            <label class="calculator-label">Gained XP</label>
                            <input type="number" class="calculator-input" data-field="gainedXP" data-skill="${skill}" value="${skillData.gainedXP}" min="0" step="1" />
                        </div>
                        <div class="calculator-input-group">
                            <label class="calculator-label">Target XP</label>
                            <input type="number" class="calculator-input" data-field="targetXP" data-skill="${skill}" value="${skillData.targetXP}" min="0" step="1" />
                        </div>
                        <div class="calculator-input-group">
                            <label class="calculator-label">Start Level</label>
                            <input type="number" class="calculator-input" data-field="startLevel" data-skill="${skill}" value="${skillData.startLevel}" min="1" max="99" step="1" />
                        </div>
                        <div class="calculator-input-group">
                            <label class="calculator-label">End Level</label>
                            <input type="number" class="calculator-input" data-field="endLevel" data-skill="${skill}" value="${skillData.endLevel}" min="1" max="99" step="1" />
                        </div>
                    </div>
                </div>
            `;
        }

        html += `
            </div>
        `;

        return html;
    }

    /**
     * Get skill color for borders
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
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers
        this.$element.off('click');
        this.$element.off('blur');
        this.$element.off('keypress');

        // Collapse toggle - make entire header clickable
        this.$element.on('click', '.calculator-header', (e) => {
            e.stopPropagation();
            this.toggleExpanded();
        });

        // Main input fields - update on blur or Enter key
        this.$element.on('blur', '.calculator-input[data-field="steps"]', (e) => {
            const value = this.validateInteger(e.target.value);
            this.values.steps = value;
            this.calculateFromSteps(value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="steps"]', (e) => {
            if (e.which === 13) { // Enter key
                const value = this.validateInteger(e.target.value);
                this.values.steps = value;
                this.calculateFromSteps(value);
                e.target.blur(); // Remove focus
            }
        });

        this.$element.on('blur', '.calculator-input[data-field="actions"]', (e) => {
            const value = this.validateDecimal(e.target.value);
            this.values.actions = value;
            this.calculateFromActions(value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="actions"]', (e) => {
            if (e.which === 13) { // Enter key
                const value = this.validateDecimal(e.target.value);
                this.values.actions = value;
                this.calculateFromActions(value);
                e.target.blur();
            }
        });

        if (this.mode === 'recipe') {
            this.$element.on('blur', '.calculator-input[data-field="materials"]', (e) => {
                const value = this.validateDecimal(e.target.value);
                this.values.materials = value;
                this.calculateFromMaterials(value);
            });

            this.$element.on('keypress', '.calculator-input[data-field="materials"]', (e) => {
                if (e.which === 13) {
                    const value = this.validateDecimal(e.target.value);
                    this.values.materials = value;
                    this.calculateFromMaterials(value);
                    e.target.blur();
                }
            });

            this.$element.on('blur', '.calculator-input[data-field="crafts"]', (e) => {
                const value = this.validateDecimal(e.target.value);
                this.values.crafts = value;
                this.calculateFromCrafts(value);
            });

            this.$element.on('keypress', '.calculator-input[data-field="crafts"]', (e) => {
                if (e.which === 13) {
                    const value = this.validateDecimal(e.target.value);
                    this.values.crafts = value;
                    this.calculateFromCrafts(value);
                    e.target.blur();
                }
            });
        }

        // Skill XP fields - update on blur or Enter key
        this.$element.on('blur', '.calculator-input[data-field="startXP"]', (e) => {
            const skill = $(e.target).data('skill');
            const value = this.validateInteger(e.target.value);
            const skillData = this.values.skills[skill];

            skillData.startXP = value;
            skillData.startLevel = this.xpToLevel(value);
            skillData.targetXP = skillData.startXP + skillData.gainedXP;
            skillData.endLevel = this.xpToLevel(skillData.targetXP);

            this.render();
        });

        this.$element.on('keypress', '.calculator-input[data-field="startXP"]', (e) => {
            if (e.which === 13) {
                const skill = $(e.target).data('skill');
                const value = this.validateInteger(e.target.value);
                const skillData = this.values.skills[skill];

                skillData.startXP = value;
                skillData.startLevel = this.xpToLevel(value);
                skillData.targetXP = skillData.startXP + skillData.gainedXP;
                skillData.endLevel = this.xpToLevel(skillData.targetXP);

                this.render();
                e.target.blur();
            }
        });

        this.$element.on('blur', '.calculator-input[data-field="gainedXP"]', (e) => {
            const skill = $(e.target).data('skill');
            const value = this.validateInteger(e.target.value);
            this.calculateFromGainedXP(skill, value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="gainedXP"]', (e) => {
            if (e.which === 13) {
                const skill = $(e.target).data('skill');
                const value = this.validateInteger(e.target.value);
                this.calculateFromGainedXP(skill, value);
                e.target.blur();
            }
        });

        this.$element.on('blur', '.calculator-input[data-field="targetXP"]', (e) => {
            const skill = $(e.target).data('skill');
            const value = this.validateInteger(e.target.value);
            this.calculateFromTargetXP(skill, value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="targetXP"]', (e) => {
            if (e.which === 13) {
                const skill = $(e.target).data('skill');
                const value = this.validateInteger(e.target.value);
                this.calculateFromTargetXP(skill, value);
                e.target.blur();
            }
        });

        this.$element.on('blur', '.calculator-input[data-field="startLevel"]', (e) => {
            const skill = $(e.target).data('skill');
            const value = this.validateInteger(e.target.value);
            this.calculateFromStartLevel(skill, value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="startLevel"]', (e) => {
            if (e.which === 13) {
                const skill = $(e.target).data('skill');
                const value = this.validateInteger(e.target.value);
                this.calculateFromStartLevel(skill, value);
                e.target.blur();
            }
        });

        this.$element.on('blur', '.calculator-input[data-field="endLevel"]', (e) => {
            const skill = $(e.target).data('skill');
            const value = this.validateInteger(e.target.value);
            this.calculateFromEndLevel(skill, value);
        });

        this.$element.on('keypress', '.calculator-input[data-field="endLevel"]', (e) => {
            if (e.which === 13) {
                const skill = $(e.target).data('skill');
                const value = this.validateInteger(e.target.value);
                this.calculateFromEndLevel(skill, value);
                e.target.blur();
            }
        });
    }
}

export default CalculatorSection;
