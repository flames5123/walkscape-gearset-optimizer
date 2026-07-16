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

import { formatFixed } from '../utils/number-format.js';
import { resolveItemIcon } from '../utils/resolve-item-icon.js';
import { openDropdownUnder, closeGlobalDropdown } from './xy-activity-priority-list.js';
import { wireInfoIcons } from '../info-popover.js';

// ============================================================================
// DRY CHECK FLAVOUR TEXT
// ============================================================================
// Pasted verbatim from the user spec. Each bracket is half-open: matched when
// pct >= min AND pct < max. Last bracket has max=1000 to catch the >99.9% tail.
// "Dryness %" is P(at least 1 drop by now) × 100 — high % = walked many WEAR-
// equivalents with no drop (you're very dry / unlucky), low % = walked almost
// nothing yet (it's normal to not have a drop).
const DRY_FLAVOUR_TEXTS = [
    { min: -1,   max: 1,    lines: [
        "You're dancing with the Syrenthians.",
        "You are extremely not dry."
    ]},
    { min: 1,    max: 10,   lines: [
        "Your spoon is too big!",
        "🥄 🥄 🥄",
        "if you have a drop by now..."
    ]},
    { min: 10,   max: 20,   lines: [
        "Stay hydrated, you've a long way to go."
    ]},
    { min: 20,   max: 30,   lines: [
        "🥄 Spooned 🥄",
        "Just kidding. No drops."
    ]},
    { min: 30,   max: 40,   lines: [
        "Your friends would be jealous.",
        "...If you had any drops."
    ]},
    { min: 40,   max: 49,   lines: [
        "You're quite the lucker, aren't you?",
        "Or not, since you got no drops."
    ]},
    { min: 49,   max: 51,   lines: [
        "A perfect mix of dry and undry, as all things should be."
    ]},
    { min: 51,   max: 61,   lines: [
        "Nothing interesting happens.",
        "Over half of players would have had a drop by now."
    ]},
    { min: 61,   max: 65,   lines: [
        "An unenlightened being would say:",
        "\"1 in X means I should have it by now.\""
    ]},
    { min: 65,   max: 73,   lines: [
        "Nothing interesting happens.",
        "Still no drops."
    ]},
    { min: 73,   max: 74,   lines: [
        "😂😂😂"
    ]},
    { min: 74,   max: 85,   lines: [
        "Oof."
    ]},
    { min: 85,   max: 90,   lines: [
        "A national emergency has been declared about an ongoing drought."
    ]},
    { min: 90,   max: 95,   lines: [
        "Right. Time to post on Discord."
    ]},
    { min: 95,   max: 99,   lines: [
        "You after being this dry:",
        "💀 💀 💀"
    ]},
    { min: 99,   max: 99.5, lines: [
        "You rn: [[File:Unidentified remains.svg|32px]]"
    ]},
    { min: 99.5, max: 99.9, lines: [
        "Malik, foraging on the glacier.",
        "Agile, scrambling along the ridge.",
        "Ravaha, trying to get anything.",
        "You, doing whatever you're doing."
    ]},
    { min: 99.9, max: 1000, lines: [
        "Did you forget to start the activity?"
    ]}
];

// ============================================================================
// DRY CHECK QUALITY / FINE VARIANTS
// ============================================================================
// Recipe quality outputs can be expanded into "≥ tier" variants in the dry
// dropdown (Normal+ … Eternal); any drop with a fine rate gets a "(fine)"
// variant. Each variant carries a quality/fine glow color (mirrors the
// rarity-border CSS vars used for quality everywhere else).
const DRY_QUALITY_ORDER = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
const DRY_QUALITY_COLORS = {
    'Normal': 'var(--rarity-common-border)',
    'Good': 'var(--rarity-uncommon-border)',
    'Great': 'var(--rarity-rare-border)',
    'Excellent': 'var(--rarity-epic-border)',
    'Perfect': 'var(--rarity-legendary-border)',
    'Eternal': 'var(--rarity-ethereal-border)'
};
const DRY_FINE_COLOR = 'var(--fine-color,#4fc3f7)';

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
        // Second gearset values for comparison mode
        this.values2 = {
            steps: 0,
            actions: 0,
            materials: 0,
            crafts: 0,
            skills: {}
        };

        // DRY CHECK state — survives re-renders, cleared on activity/recipe change.
        // selectedKey is shared between single and comparison modes (one drop selector).
        // steps / steps1 / steps2 are the dry-calc-local "steps walked" overrides.
        // Null means "follow main calculator's Steps field"; a positive number sticks until
        // the activity/recipe changes or the user clears the field back to 0/empty.
        this.dryCheck = {
            selectedKey: null,
            steps: null,
            steps1: null,
            steps2: null,
            crafts: null,
            crafts1: null,
            crafts2: null
        };

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.useFine', () => this.onFineChange());
        this.subscribe('gearset', () => this.onGearsetChange());
        this.subscribe('character.skills', () => this.onSkillsChange());
        this.subscribe('ui.user_overrides.skills', () => this.onSkillsChange());
        this.subscribe('gearsets.comparisonMode', () => this.render());
        this.subscribe('gearsets.gearset2', () => {
            if (store.state.gearsets.comparisonMode) this.render();
        });

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
            if (selectedId.startsWith('generic::')) {
                const defId = selectedId.replace('generic::', '');
                const activity = await $.get(`/api/generic-definition-view/${defId}`);
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
            if (selectedId === 'generic') {
                // "New Generic Activity" — no data yet, hide calculator
                this.mode = null;
                this.activity = null;
                this.resetValues();
                this.render();
                return;
            }
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
            if (selectedId.startsWith('generic::')) {
                const defId = selectedId.replace('generic::', '');
                const recipe = await $.get(`/api/generic-definition-view/${defId}`);
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
            if (selectedId === 'generic') {
                this.mode = null;
                this.recipe = null;
                this.resetValues();
                this.render();
                return;
            }
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
        this.values2 = {
            steps: 0,
            actions: 0,
            materials: 0,
            crafts: 0,
            skills: {}
        };
        // Reset DRY check selection — drop list changes with activity/recipe.
        this.dryCheck = {
            selectedKey: null,
            steps: null,
            steps1: null,
            steps2: null,
            crafts: null,
            crafts1: null,
            crafts2: null
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
            // Mirror for comparison mode
            this.values2.skills[skill] = {
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

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain. Applying ceil before the pct multiplier introduces
            // off-by-one errors (e.g. Flowing pocketwatch -5%).
            const cappedWE = Math.min(we, maxEfficiency);
            const baseOverEff = baseSteps / (1 + cappedWE);
            const minSteps = baseSteps / (1 + maxEfficiency);
            const stepsWithWE = Math.max(baseOverEff, minSteps);
            const stepsWithPct = stepsWithWE * (1 + pct);
            const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));

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

            // Build per-skill XP map so we can correctly calculate actions from a single skill's XP.
            // XP bonuses (add/percent) are applied proportionally to each skill's base XP share.
            const primarySkill = this.activity.primary_skill;
            const xpPerActionBySkill = {};
            const rawTotalXP = this.activity.base_xp + (this.activity.secondary_xp
                ? Object.values(this.activity.secondary_xp).reduce((s, v) => s + v, 0) : 0);
            // Primary skill gets base_xp share
            xpPerActionBySkill[primarySkill] = rawTotalXP > 0
                ? totalXP * (this.activity.base_xp / rawTotalXP) : totalXP;
            if (this.activity.secondary_xp) {
                for (const [skill, xp] of Object.entries(this.activity.secondary_xp)) {
                    const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
                    xpPerActionBySkill[skillName] = rawTotalXP > 0 ? totalXP * (xp / rawTotalXP) : 0;
                }
            }

            return {
                stepsPerAction: stepsPerAction,
                xpPerAction: totalXP,  // XP per action (with bonuses)
                xpPerActionBySkill,    // Per-skill XP per action
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

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain. Applying ceil before the pct multiplier introduces
            // off-by-one errors (e.g. Flowing pocketwatch -5%).
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseOverEff = baseSteps / totalEfficiency;
            const withPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);

            // Calculate steps per action (accounting for DA)
            const actionsPerCompletion = 1 + da;
            const stepsPerAction = stepsPerSingleAction / actionsPerCompletion;

            // Calculate steps per craft (steps per reward roll)
            const rewardRollsPerCompletion = (1 + da) * (1 + dr);
            const stepsPerCraft = stepsPerSingleAction / rewardRollsPerCompletion;

            // Calculate XP (with fine materials bonus if applicable)
            const useFine = store.state.column3?.useFine || false;
            const canUseFine = this.recipe.has_fine_option || this.recipe.has_equipment_input;
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

            // Targeted logging for tree-vs-info-section steps/item
            // divergence investigations (e.g. Iron sickle showing 8110
            // in the tree node header but 8273 here after equip). Emits
            // the same named inputs as the tree's [CT-STEPS-TREE] log
            // so the user can diff them side-by-side in the browser
            // console (filter on [CT-STEPS-]). Does NOT include
            // quality_prob or output_qty — those aren't factored into
            // calculator-section's stepsPerCraft, which is one of the
            // likely divergence sources we're looking for.
            try {
                const rname = this.recipe?.name || this.recipe?.id || '?';
                console.log(
                    `[CT-STEPS-INFO] recipe=${rname} output_qty=${this.recipe?.quantity ?? 1} ` +
                    `stepsPerSingleAction=${formatFixed(stepsPerSingleAction, 4)} ` +
                    `DA=${formatFixed(da, 4)} DR=${formatFixed(dr, 4)} NMC=${formatFixed(nmc, 4)} ` +
                    `WE=${formatFixed(we, 4)} capped_we=${formatFixed(cappedWE, 4)} ` +
                    `base_steps=${baseSteps} max_eff=${formatFixed(maxEfficiency, 4)} ` +
                    `flat=${flat} pct=${formatFixed(pct, 4)} ` +
                    `=> stepsPerCraft=${formatFixed(stepsPerCraft, 4)}`
                );
            } catch (err) {
                console.warn('[CT-STEPS-INFO] log failed', err);
            }

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
     *
     * Whatever the user typed is preserved exactly. The other three fields
     * are derived as estimates via direct conversion (no integer round-trip
     * through actions, which previously caused user-entered values like
     * materials=1 to flip to 2 — see bug report 0b270ce0).
     *
     * @param {number} steps - Number of steps (kept as entered)
     */
    calculateFromSteps(steps) {
        const stats = this.getCurrentStats();

        // Keep steps as entered (source of truth)
        this.values.steps = steps;

        if (this.mode === 'recipe') {
            const gearStats = this.getGearStats();
            const dr = gearStats.double_rewards || 0;
            const spc = stats.stepsPerCraft || 1;
            // Crafts (estimate) = steps / stepsPerCraft
            const crafts = spc > 0 ? steps / spc : 0;
            this.values.crafts = this.validateDecimal(crafts);
            // Materials (estimate) = crafts * materialsPerCraft
            this.values.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
            // Actions (estimate) = crafts / (1 + DR)
            this.values.actions = this.validateDecimal(crafts / (1 + dr));
        } else {
            // Activity: actions (estimate) = steps / stepsPerAction
            const spa = stats.stepsPerAction || 1;
            this.values.actions = this.validateDecimal(spa > 0 ? steps / spa : 0);
        }

        // Calculate XP for each skill
        this.calculateXPFromActions(this.values.actions);

        this.render();
    }

    /**
     * Calculate from actions
     * Requirements: 5.4, 6.4
     *
     * Preserves the user-entered actions exactly. Other fields are
     * decimal estimates (steps is rounded to an integer because the
     * game treats steps as integer-valued).
     *
     * @param {number} actions - Number of actions (kept as entered)
     */
    calculateFromActions(actions) {
        const stats = this.getCurrentStats();

        // Keep actions as entered (source of truth)
        this.values.actions = actions;

        // Steps (estimate) = actions * stepsPerAction — rounded to integer
        this.values.steps = Math.round(actions * stats.stepsPerAction);

        if (this.mode === 'recipe') {
            const gearStats = this.getGearStats();
            const dr = gearStats.double_rewards || 0;
            // Crafts (estimate) = actions * (1 + DR)
            const crafts = actions * (1 + dr);
            this.values.crafts = this.validateDecimal(crafts);
            // Materials (estimate) = crafts * materialsPerCraft
            this.values.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
        }

        // Calculate XP for each skill
        this.calculateXPFromActions(actions);

        this.render();
    }

    /**
     * Calculate from materials (recipe only)
     * Requirements: 6.4, 6.5
     *
     * Preserves the user-entered materials value exactly. Other fields
     * are derived as decimal estimates from materials directly, without
     * the integer round-trip through actions that previously caused
     * materials=1 to silently flip to 2 (bug report 0b270ce0).
     *
     * @param {number} materials - Number of materials (kept as entered)
     */
    calculateFromMaterials(materials) {
        if (this.mode !== 'recipe') return;

        const stats = this.getCurrentStats();
        const gearStats = this.getGearStats();
        const dr = gearStats.double_rewards || 0;
        const mpc = stats.materialsPerCraft || 1.0;

        // Keep materials as entered (source of truth)
        this.values.materials = materials;

        // Crafts (estimate) = materials / materialsPerCraft
        const crafts = mpc > 0 ? materials / mpc : 0;
        this.values.crafts = this.validateDecimal(crafts);
        // Actions (estimate) = crafts / (1 + DR)
        this.values.actions = this.validateDecimal(crafts / (1 + dr));
        // Steps (estimate) = crafts * stepsPerCraft — rounded to integer
        this.values.steps = Math.round(crafts * stats.stepsPerCraft);

        // Calculate XP for each skill
        this.calculateXPFromActions(this.values.actions);

        this.render();
    }

    /**
     * Calculate from crafts (recipe only)
     * Requirements: 6.4, 6.5
     *
     * Preserves the user-entered crafts value exactly. Other fields
     * are derived as decimal estimates from crafts directly.
     *
     * @param {number} crafts - Number of crafts (kept as entered)
     */
    calculateFromCrafts(crafts) {
        if (this.mode !== 'recipe') return;

        const stats = this.getCurrentStats();
        const gearStats = this.getGearStats();
        const dr = gearStats.double_rewards || 0;

        // Keep crafts as entered (source of truth)
        this.values.crafts = crafts;

        // Materials (estimate) = crafts * materialsPerCraft
        this.values.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
        // Actions (estimate) = crafts / (1 + DR)
        this.values.actions = this.validateDecimal(crafts / (1 + dr));
        // Steps (estimate) = crafts * stepsPerCraft — rounded to integer
        this.values.steps = Math.round(crafts * stats.stepsPerCraft);

        // Calculate XP for each skill
        this.calculateXPFromActions(this.values.actions);

        this.render();
    }

    /**
     * Calculate XP from actions for all skills
     * @param {number} actions - Number of actions
     */
    calculateXPFromActions(actions) {
        const stats = this.getCurrentStats();

        for (const skill of Object.keys(this.values.skills)) {
            const skillData = this.values.skills[skill];

            let gainedXP;
            if (this.mode === 'recipe') {
                // Get XP per step from recipe stats
                const recipeStats = this.recipe ? this.getRecipeStats() : null;
                const xpPerStep = recipeStats ? parseFloat(recipeStats.xpPerStep) : 0;
                gainedXP = this.validateInteger(this.values.steps * xpPerStep);
            } else {
                // Use per-skill XP rate so multi-skill activities (e.g. Ice Sculpture) assign
                // the correct XP to each skill rather than the combined total to all skills.
                const skillXpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[skill])
                    ? stats.xpPerActionBySkill[skill]
                    : stats.xpPerAction;
                gainedXP = this.validateInteger(actions * skillXpPerAction);
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

        // Calculate actions needed — use per-skill XP rate so activities with secondary XP
        // (e.g. Ice Sculpture giving both Carpentry and Crafting XP) compute correctly.
        const skillXpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[skill])
            ? stats.xpPerActionBySkill[skill]
            : stats.xpPerAction;
        this.values.actions = this.validateDecimal(gainedXP / skillXpPerAction);

        // Calculate steps
        this.values.steps = this.validateInteger(this.values.actions * stats.stepsPerAction);

        // For recipes, calculate materials and crafts
        if (this.mode === 'recipe') {
            this.values.crafts = this.values.actions;
            this.values.materials = this.validateDecimal(this.values.crafts * stats.materialsPerCraft);
        }

        // Propagate the new action count to all other skills so their XP/level updates too.
        // Skip the skill we just set — it's already correct and we don't want to overwrite it.
        for (const [otherSkill, otherData] of Object.entries(this.values.skills)) {
            if (otherSkill === skill) continue;
            const otherXpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[otherSkill])
                ? stats.xpPerActionBySkill[otherSkill]
                : stats.xpPerAction;
            otherData.gainedXP = this.validateInteger(this.values.actions * otherXpPerAction);
            otherData.targetXP = otherData.startXP + otherData.gainedXP;
            otherData.endLevel = this.xpToLevel(otherData.targetXP);
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
     * Fill the Steps field from an external click (e.g. a drop card's steps
     * counter in the DROPS section) and recalculate everything from it.
     *
     * In comparison mode the DROPS section reflects the active gearset slot
     * (combined stats follow activeGearsetSlot), so the value is written to
     * THAT side's Steps field. In single mode it fills the one Steps field.
     * Expands the section if collapsed and scrolls it into view so the user
     * sees the filled value.
     *
     * @param {number} steps - Step count to load into the calculator.
     * @param {number|null} slotOverride - In comparison mode, explicitly fill
     *   this gearset side (1 or 2). When null, falls back to the active
     *   gearset slot. Ignored in single mode.
     */
    setStepsFromExternal(steps, slotOverride = null) {
        const val = this.validateInteger(steps);
        if (!this.mode) return;

        // Expand first so the (re-)render shows the content immediately.
        this.isExpanded = true;

        if (store.state.gearsets?.comparisonMode) {
            // Fill the side the caller asked for (comparison drop cells know
            // their gearset); otherwise fall back to the active gearset slot
            // (the DROPS section reflects that side in comparison mode).
            const slot = (slotOverride === 1 || slotOverride === 2)
                ? slotOverride
                : (store.state.gearsets?.activeGearsetSlot === 2 ? 2 : 1);
            const vals = slot === 1 ? this.values : this.values2;
            vals.steps = val;
            this._recalcMainField(vals, 'steps', slot);
            this.render();
        } else {
            this.values.steps = val;
            this.calculateFromSteps(val);  // recalculates + renders
        }

        this._scrollCalculatorIntoView();
    }

    /**
     * Smoothly scroll the calculator section into view so an externally
     * triggered fill (e.g. clicking a drop's steps counter) is visible.
     * Uses block:'nearest' so it only scrolls as far as needed.
     */
    _scrollCalculatorIntoView() {
        try {
            const el = this.$element[0]?.querySelector('.calculator-section') || this.$element[0];
            if (el && typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } catch (e) { /* scroll is best-effort */ }
    }

    /**
     * Fill the Materials field from an external click (a drop card's
     * materials-per-item value in the DROPS section) and recalculate. Recipes
     * only — the Materials field doesn't exist in activity mode. Comparison
     * mode fills the caller's gearset side (or the active slot as fallback).
     *
     * @param {number} materials - Materials value to load into the calculator.
     * @param {number|null} slotOverride - Comparison-mode gearset side (1 or 2).
     */
    setMaterialsFromExternal(materials, slotOverride = null) {
        if (this.mode !== 'recipe') return;
        const val = this.validateDecimal(materials);

        this.isExpanded = true;

        if (store.state.gearsets?.comparisonMode) {
            const slot = (slotOverride === 1 || slotOverride === 2)
                ? slotOverride
                : (store.state.gearsets?.activeGearsetSlot === 2 ? 2 : 1);
            const vals = slot === 1 ? this.values : this.values2;
            vals.materials = val;
            this._recalcMainField(vals, 'materials', slot);
            this.render();
        } else {
            this.values.materials = val;
            this.calculateFromMaterials(val);  // recalculates + renders
        }

        this._scrollCalculatorIntoView();
    }

    /**
     * Get the drop table data from the active DropsSection or activity/recipe.
     * Returns an array of drop objects (same format as DropsSection.calculateDropRates).
     */
    _getDropTableData() {
        // Reuse the DropsSection's already-calculated drops if available
        const dropsSection = window.dropsSection;
        if (dropsSection && dropsSection.dropSource) {
            return dropsSection._lastCalculatedDrops || [];
        }
        return [];
    }

    /**
     * Get drop table data for a specific gearset in comparison mode.
     * Uses the comparison section's cached drops.
     */
    _getComparisonDrops(gsNum) {
        const compSection = window.gearsetComparisonSection;
        if (!compSection) return [];
        return gsNum === 1
            ? (compSection._lastDrops1 || [])
            : (compSection._lastDrops2 || []);
    }

    // ============================================================================
    // DRY CHECK
    // ============================================================================
    // Computes dry-multiplier (= expected drops / actual drops received) for a
    // user-selected drop. WEAR comes from the drop itself (steps_per_item for
    // activity/IF drops, materials_per_item for recipe drops). Steps walked is
    // taken from the existing Steps input above. Drops received is a separate
    // user input that defaults to 0.
    //
    // Inspired by https://wiki.walkscape.app/wiki/Dry_Calculator but tailored to
    // pre-fill from the activity/recipe the user already has selected.

    /** Stable identifier for a drop entry — survives re-renders / drop list refresh. */
    _dropKey(drop) {
        if (!drop) return '';
        let base;
        if (drop.source === 'chest') {
            base = `chest::${drop._chestSkill || drop.primary_skill || 'chest'}`;
        } else {
            base = `${drop.item_name}::${drop.source || ''}`;
        }
        if (drop._dryQualityTier) base += `::q:${drop._dryQualityTier}`;
        if (drop._dryFine) base += `::fine`;
        return base;
    }

    /** Display name for the drop selector dropdown. */
    _dryDropDisplayName(drop) {
        if (!drop) return '—';
        let name;
        if (drop.source === 'chest') {
            const skill = drop._chestSkill || drop.primary_skill || 'chest';
            name = `${skill.charAt(0).toUpperCase() + skill.slice(1)} Chest`;
        } else {
            name = drop.item_name || '—';
        }
        if (drop._dryQualityTier) {
            // Default shows the bare tier ("Excellent"). When "Include better
            // qualities' odds" is on, the tier means P(>=tier), so keep the "+"
            // ("Excellent+"). Eternal is the top tier — never gets a "+".
            const plus = drop._dryCumulative && drop._dryQualityTier !== 'Eternal';
            name += ` (${drop._dryQualityTier}${plus ? '+' : ''})`;
        }
        if (drop._dryFine) name += ' (fine)';
        return name;
    }

    /**
     * Icon path for a drop entry — same logic as the comparison-drop-table's
     * getIconAndName helper, extracted so the dry-check trigger and dropdown
     * items can render the same icons users see elsewhere.
     */
    _dryDropIconPath(drop) {
        if (!drop) return '/assets/icons/items/containers/treasure_chest.svg';
        if (drop.source === 'chest') {
            const skill = (drop._chestSkill || drop.primary_skill || 'chest').toLowerCase();
            return `/assets/icons/items/containers/${skill}_chest.svg`;
        }
        if (drop.icon_override) return drop.icon_override;
        if (drop.item_ref) {
            // resolveItemIcon understands every item-type prefix (Currency,
            // Material, Item, Collectible, Consumable, Container, Egg).
            return resolveItemIcon({ itemRef: drop.item_ref, itemName: drop.item_name });
        }
        const iconName = (drop.item_name || '').toLowerCase().replace(/ /g, '_');
        return `/assets/icons/items/materials/${iconName}.svg`;
    }

    /**
     * Base (suffix-free) name for a drop, used to group variants together.
     */
    _dryBaseName(drop) {
        if (drop?.source === 'chest') {
            const skill = drop._chestSkill || drop.primary_skill || 'chest';
            return `${skill.charAt(0).toUpperCase() + skill.slice(1)} Chest`.toLowerCase();
        }
        return (drop?.item_name || '').toLowerCase();
    }

    /**
     * Variant ordering within a single base item: base entry first, then
     * quality tiers in Normal→Eternal order, then the fine variant last.
     */
    _dryVariantRank(drop) {
        if (drop?._dryQualityTier) return DRY_QUALITY_ORDER.indexOf(drop._dryQualityTier);
        if (drop?._dryFine) return 100;
        return -1;
    }

    /**
     * Sort drops for the dropdown: alphabetical by base item name, then by
     * variant rank so quality tiers appear in Normal+→Eternal order (NOT
     * alphabetical) and "(fine)" sits last. Returns a new array.
     */
    _drySortedDrops(drops) {
        return drops.slice().sort((a, b) => {
            const an = this._dryBaseName(a);
            const bn = this._dryBaseName(b);
            if (an < bn) return -1;
            if (an > bn) return 1;
            return this._dryVariantRank(a) - this._dryVariantRank(b);
        });
    }

    /**
     * Is this drop the recipe's crafted quality output (the only drop we
     * expand into per-quality variants)? Quality items only; never activities.
     */
    _isDryQualityOutput(drop) {
        return this.mode === 'recipe'
            && this._recipeIsQualityItem()
            && drop?.source === 'output_synthetic';
    }

    /**
     * Whether the current recipe crafts a quality item. Mirrors the canonical
     * gate in recipe-info-section.renderCraftingOddsTable: built-in recipes are
     * quality items unless their output is a Material./Consumable.; generic
     * (user-defined) recipes require the explicit is_quality_item flag.
     */
    _recipeIsQualityItem() {
        if (this.mode !== 'recipe' || !this.recipe) return false;
        const out = this.recipe.output_item || '';
        if (out.startsWith('Material.') || out.startsWith('Consumable.')) return false;
        if (String(this.recipe.id || '').startsWith('generic::') && !this.recipe.is_quality_item) return false;
        return true;
    }

    /**
     * Cumulative "at least quality X" probabilities (0..1) for the current
     * recipe at a given Quality Outcome. Uses recipe-info-section's
     * calculateQualityWeights (the canonical quality_outcome.py port) so the
     * dry calc matches the Crafting Odds shown elsewhere. Returns a map keyed
     * by quality tier, or null if unavailable / not a recipe.
     */
    _dryQualityCumulative(qo) {
        const ris = window.recipeInfoSection;
        if (this.mode !== 'recipe' || !this.recipe || !ris
            || typeof ris.calculateQualityWeights !== 'function') return null;
        const useFine = !!(store.state.column3?.useFine)
            && (this.recipe.has_fine_option || this.recipe.has_equipment_input);
        const hasEqInput = this.recipe.has_equipment_input || false;
        const res = ris.calculateQualityWeights(this.recipe.level || 1, qo || 0, useFine, hasEqInput);
        const pct = res?.percentages;
        if (!pct) return null;
        const includeBetter = this._dryIncludeBetter();
        // Per-tier probability used to scale WEAR / Expected crafts:
        //  - "Include better qualities' odds" ON  → cumulative P(>=tier) = this
        //    tier's % plus every rarer tier's % (the original "+" behavior).
        //  - OFF (default) → exact P(=tier), which makes Expected crafts equal
        //    the Crafting Odds "Avg. Items" (100 / tier%) exactly.
        const map = {};
        let running = 0;
        for (let i = DRY_QUALITY_ORDER.length - 1; i >= 0; i--) {
            const q = DRY_QUALITY_ORDER[i];
            const exact = (pct[q] || 0) / 100;
            running += exact;
            map[q] = includeBetter ? running : exact;
        }
        return map;
    }

    /**
     * Expand a filtered drop list for the dry-calc dropdown:
     *  - Recipe quality output → 6 quality-tier variants (Normal+ … Eternal),
     *    with WEAR scaled by 1/P(≥tier) so rarer tiers read as drier. Quality
     *    items only — activities are never expanded.
     *  - Any drop with a fine rate → a "(fine)" variant (steps basis).
     * Variants are shallow clones tagged with _dryQualityTier / _dryFine and a
     * _dryGlowColor for the box-shadow glow.
     * @param {Array} drops - already _dryValidDrops-filtered
     * @param {number} qo - Quality Outcome used for quality-probability scaling
     */
    _dryExpandDrops(drops, qo) {
        const probMap = this._dryQualityCumulative(qo);
        const includeBetter = this._dryIncludeBetter();
        const out = [];
        for (const d of drops) {
            if (probMap && this._isDryQualityOutput(d)) {
                for (const q of DRY_QUALITY_ORDER) {
                    const p = probMap[q];
                    if (!p || p <= 0) continue;
                    const v = { ...d, _dryQualityTier: q, _dryQualityProb: p, _dryCumulative: includeBetter, _dryGlowColor: DRY_QUALITY_COLORS[q] };
                    if (v.steps_per_item) v.steps_per_item = d.steps_per_item / p;
                    if (v.materials_per_item) v.materials_per_item = d.materials_per_item / p;
                    out.push(v);
                }
                continue;  // the single output entry is replaced by its tiers
            }
            out.push(d);
            if (d.steps_per_fine_item && isFinite(d.steps_per_fine_item) && d.steps_per_fine_item > 0) {
                out.push({
                    ...d,
                    _dryFine: true,
                    _dryGlowColor: DRY_FINE_COLOR,
                    steps_per_item: d.steps_per_fine_item,
                    materials_per_item: null  // fine drops use the steps basis
                });
            }
        }
        return out;
    }

    /** True when "Include better qualities' odds" is enabled (cumulative P(>=tier)). */
    _dryIncludeBetter() {
        return !!(store.state?.ui?.dryCheck?.includeBetterQualities);
    }

    /** True when the recipe dry-check is in "Total crafts" mode (recipe only). */
    _dryCraftsMode() {
        return this.mode === 'recipe' && !!(store.state?.ui?.dryCheck?.craftsMode);
    }

    /**
     * Persist a dry-check UI flag (craftsMode / includeBetterQualities) to the
     * live store + session config so it survives reloads. Global (not per
     * activity/recipe) — these are display preferences.
     */
    _setDryUiFlag(key, val) {
        if (!store.state.ui) store.state.ui = {};
        if (!store.state.ui.dryCheck) store.state.ui.dryCheck = {};
        store.state.ui.dryCheck[key] = val;
        const uuid = store.state.session?.uuid;
        if (uuid && window.api && typeof window.api.updateConfig === 'function') {
            window.api.updateConfig(uuid, 'ui.dryCheck.' + key, val);
        }
    }

    /** Steps per craft (reward roll) for the current recipe, or 0 if unavailable. */
    _dryStepsPerCraft() {
        try {
            const ris = window.recipeInfoSection;
            if (this.mode === 'recipe' && ris && typeof ris.calculateCurrentStats === 'function') {
                const s = ris.calculateCurrentStats();
                if (s && isFinite(s.stepsPerRewardRoll) && s.stepsPerRewardRoll > 0) return s.stepsPerRewardRoll;
            }
        } catch (e) { /* fall through to 0 */ }
        return 0;
    }

    /**
     * Crafts needed per drop for a given drop (the "Expected crafts" value).
     * For a quality-tier variant this is 1 / P(tier), which equals the Crafting
     * Odds "Avg. Items" (100 / tier%) exactly. For any other recipe drop it's
     * steps_per_item / stepsPerCraft. Returns NaN when not computable.
     */
    _dryCraftsPerDrop(drop) {
        if (!drop) return NaN;
        if (drop._dryQualityProb && drop._dryQualityProb > 0) return 1 / drop._dryQualityProb;
        const spc = this._dryStepsPerCraft();
        if (spc > 0 && drop.steps_per_item && isFinite(drop.steps_per_item) && drop.steps_per_item > 0) {
            return drop.steps_per_item / spc;
        }
        return NaN;
    }

    /** Format a crafts-per-drop value the same way the Crafting Odds table does. */
    _fmtDryCrafts(v) {
        if (v == null || !isFinite(v)) return '—';
        return formatFixed(v, 1, { trim: true });
    }

    /**
     * Swap button next to the Steps/Total-crafts header (recipe mode only).
     * Toggles between the steps basis and the "Total crafts" basis. The label
     * names the mode it switches TO.
     */
    _renderDryCraftToggle(craftsMode) {
        if (this.mode !== 'recipe') return '';
        const label = craftsMode ? 'Steps' : 'Total crafts';
        const title = craftsMode ? 'Switch back to steps' : 'Switch to total crafts';
        const btnStyle = `display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:12px; border:1px solid var(--border-color); background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-size:0.8em; line-height:1.4;`;
        return `<button type="button" class="dry-check-craft-toggle" title="${title}" style="${btnStyle}">⟷ ${label}</button>`;
    }

    /**
     * "Include better qualities' odds" checkbox — only shown when the current
     * drop list has quality-tier variants (i.e. a quality-item recipe).
     */
    _renderDryQualityCheckbox(hasQualityVariants) {
        if (!hasQualityVariants) return '';
        const checked = this._dryIncludeBetter() ? 'checked' : '';
        return `
            <label class="calculator-input-group" style="display:flex; flex-direction:row; align-items:center; gap:var(--spacing-sm); cursor:pointer; width:100%;">
                <input type="checkbox" class="dry-check-include-better" ${checked} />
                <span class="calculator-label" style="margin-bottom:0;">Include better qualities' odds</span>
            </label>`;
    }

    /** Inline box-shadow glow style for a variant's icon (quality/fine color). */
    _dryGlowStyle(drop) {
        const c = drop && drop._dryGlowColor;
        if (!c) return '';
        // Canonical 4-direction outline used on every other quality/fine icon
        // (optimize-button, xy-*-priority-list, .rarity-* CSS) — NOT box-shadow.
        return ` style="filter:drop-shadow(1px 0 0 ${c}) drop-shadow(-1px 0 0 ${c}) drop-shadow(0 1px 0 ${c}) drop-shadow(0 -1px 0 ${c});"`;
    }

    /**
     * Render the trigger button for the floating drop selector. Mirrors the
     * .target-dropdown-button.xy-dropdown-btn pattern used by xy-activity-
     * priority-list so we get the same look + behavior (icon, name,
     * expand-arrow, hover styling) without duplicating the popup engine.
     */
    _renderDryItemTrigger(selected) {
        const iconHtml = selected
            ? `<img src="${this._dryDropIconPath(selected)}" alt="" class="target-dropdown-icon"${this._dryGlowStyle(selected)} onerror="this.style.display='none'" />`
            : '';
        const name = selected ? this._dryDropDisplayName(selected) : 'Select…';
        return `
            <div class="target-dropdown-button xy-dropdown-btn dry-check-item-trigger">
                <div class="target-dropdown-value">
                    ${iconHtml}<span>${name}</span>
                </div>
                <button class="target-dropdown-toggle" tabindex="-1">
                    <span class="expand-arrow">▼</span>
                </button>
            </div>
        `;
    }

    /** Build items HTML for the floating dropdown — alphabetical, with icons. */
    _renderDryDropdownItems(sortedDrops) {
        return sortedDrops.map(d => {
            const key = this._dropKey(d);
            const name = this._dryDropDisplayName(d);
            const icon = this._dryDropIconPath(d);
            return `<div class="target-item" data-value="${key}">
                <img src="${icon}" alt="" class="target-icon"${this._dryGlowStyle(d)} onerror="this.style.display='none'" />
                <span>${name}</span>
            </div>`;
        }).join('');
    }

    /**
     * Stable per-context key for persisting the dry-check drop selection.
     * Activity and recipe IDs share an ID space (both are short strings) but
     * the same id can collide across modes, so we mode-prefix.
     * Returns null when there's no current activity/recipe yet.
     */
    _dryContextKey() {
        if (this.mode === 'activity' && this.activity?.id) return `act:${this.activity.id}`;
        if (this.mode === 'recipe' && this.recipe?.id) return `rec:${this.recipe.id}`;
        return null;
    }

    /**
     * Get the persisted drop selection for the current activity/recipe, if any.
     * Reads from the live store so it auto-picks up restored ui_config from
     * the last session load.
     */
    _getSavedDrySelection() {
        const ctxKey = this._dryContextKey();
        if (!ctxKey) return null;
        const map = store.state?.ui?.dryCheck?.itemByContext || {};
        return map[ctxKey] || null;
    }

    /**
     * Persist the current drop selection for the current activity/recipe to
     * the session config (PATCH /api/session/{uuid}/config). Updates the
     * in-memory store first so re-renders see the new value, then fires the
     * PATCH best-effort (no await — failure is non-fatal, just won't survive
     * a reload). Skips when there's no session UUID yet.
     */
    _persistDrySelection(key) {
        const ctxKey = this._dryContextKey();
        if (!ctxKey) return;
        if (!store.state.ui.dryCheck) store.state.ui.dryCheck = {};
        const prevMap = store.state.ui.dryCheck.itemByContext || {};
        const newMap = { ...prevMap, [ctxKey]: key };
        store.state.ui.dryCheck.itemByContext = newMap;

        const uuid = store.state.session?.uuid;
        if (uuid && window.api && typeof window.api.updateConfig === 'function') {
            window.api.updateConfig(uuid, 'ui.dryCheck.itemByContext', newMap);
        }
    }

    /**
     * Filter a drop list down to entries that have a usable WEAR for the
     * current mode. Activities use steps_per_item; recipes prefer
     * materials_per_item but fall back to steps_per_item.
     */
    _dryValidDrops(drops) {
        if (!drops || drops.length === 0) return [];
        return drops.filter(d => {
            if (d.steps_per_item && isFinite(d.steps_per_item) && d.steps_per_item > 0) return true;
            if (this.mode === 'recipe' && d.materials_per_item && isFinite(d.materials_per_item) && d.materials_per_item > 0) return true;
            return false;
        });
    }

    /**
     * Compute dry-check stats for a drop given the current step/material
     * count and how many drops the user actually received.
     *
     * Returns { wear, expected, dryMult, basis } or null if no usable rate.
     * - basis: 'materials' for recipe drops with materials_per_item, else 'steps'
     * - expected: how many drops the user "should" have at this point
     * - dryMult: expected / max(1, dropsReceived)
     *     - >1 means dry (you've walked further than your drops would suggest)
     *     - <1 means lucky
     *     - When dropsReceived = 0, this equals expected (i.e. "you're N expected drops worth dry")
     */
    _computeDryStats(drop, steps, materials, dropsReceived, craftsMode = false, crafts = 0) {
        if (!drop) return null;

        // Crafts basis (recipe "Total crafts" toggle): Expected crafts is the
        // Crafting Odds "Avg. Items" (1 / P(tier) for quality tiers), and
        // Expected drops = crafts / craftsPerDrop. Steps are not consulted.
        if (craftsMode) {
            const craftsPerDrop = this._dryCraftsPerDrop(drop);
            // Expected drops is ALWAYS steps-based (steps / steps_per_item),
            // identical to the Steps view — the crafts axis only changes the
            // unit shown for "Expected crafts/drop" (wear), never the drop
            // count. The caller passes canonical steps (derived from the walked
            // steps, or from an explicit crafts entry × stepsPerCraft), so the
            // two toggle states agree to the decimal. (bug 9fd38436)
            let expectedC = NaN;
            if (drop.steps_per_item && isFinite(drop.steps_per_item) && drop.steps_per_item > 0 && steps > 0) {
                expectedC = steps / drop.steps_per_item;
            }
            const okC = isFinite(expectedC) && expectedC > 0;
            return {
                wear: craftsPerDrop,
                materialsPerItem: drop.materials_per_item,
                expected: okC ? expectedC : NaN,
                dryMult: okC ? expectedC / Math.max(1, dropsReceived) : NaN,
                basis: 'crafts'
            };
        }

        let expected = NaN;
        const basis = 'steps';
        // The dry calc is purely steps-based. Recipe/chest drops also carry a
        // materials_per_item, but the calc never tracks materials, so scoring
        // them on materials left everything blank — always use walked steps.
        // (Use the Total-crafts toggle for an explicit crafts basis.)
        if (drop.steps_per_item && isFinite(drop.steps_per_item) && drop.steps_per_item > 0 && steps > 0) {
            expected = steps / drop.steps_per_item;
        }

        if (!isFinite(expected) || expected <= 0) {
            return {
                wear: drop.steps_per_item,
                materialsPerItem: drop.materials_per_item,
                expected: NaN,
                dryMult: NaN,
                basis
            };
        }

        const dryMult = expected / Math.max(1, dropsReceived);
        return {
            wear: drop.steps_per_item,
            materialsPerItem: drop.materials_per_item,
            expected,
            dryMult,
            basis
        };
    }

    /** Format a number for the dry-check output rows (compact, trims trailing zeros). */
    _fmtDryNumber(v, kind) {
        if (v == null || !isFinite(v)) return '—';
        if (kind === 'integer') {
            return Math.round(v).toLocaleString();
        }
        if (v >= 1000) return Math.round(v).toLocaleString();
        if (v >= 10) return formatFixed(v, 1, { trim: true });
        return formatFixed(v, 2, { trim: true });
    }

    /**
     * Color class for a DRY ratio:
     *   <0.8 = lucky (green), 0.8..1.5 = neutral, >=1.5 = dry (red).
     * Reuses the comparison-better/comparison-worse color tokens already
     * defined for the calculator comparison cells.
     */
    _dryRatioClass(dryMult) {
        if (!isFinite(dryMult)) return '';
        if (dryMult < 0.8) return 'comparison-better';
        if (dryMult >= 1.5) return 'comparison-worse';
        return '';
    }

    /** Format a probability (0..1) as a percentage string. */
    _fmtDryPct(p) {
        if (p == null || !isFinite(p)) return '—';
        if (p >= 0.999) return '>99.9%';
        if (p > 0 && p < 0.001) return '<0.1%';
        if (p <= 0) return '0%';
        return `${(p * 100).toFixed(1)}%`;
    }

    /**
     * Compute drop-luck probabilities for a given dry-check stats object.
     * Uses the Poisson approximation P(≥1) = 1 - exp(-λ) where λ is the
     * expected drop count. For any realistic WEAR this matches the exact
     * binomial 1 - (1 - 1/wear)^steps to >=4 decimal places, and the Poisson
     * form generalizes cleanly to the materials-basis case (recipes).
     *
     * Milestone N for target probability T: solve 1 - exp(-N/unitsPerDrop) = T
     *   => N = unitsPerDrop * (-ln(1 - T))
     *
     * Returns { pAtLeastOne, pDry, milestones, unitsPerDrop, unitLabel,
     *          userUnits } or null if stats has no usable rate.
     */
    _computeDryProbabilities(stats, effectiveSteps, materials, crafts = 0) {
        if (!stats) return null;
        const expected = stats.expected;
        const isCrafts = stats.basis === 'crafts';
        const isMaterials = stats.basis === 'materials';
        const unitsPerDrop = isCrafts ? stats.wear : (isMaterials ? stats.materialsPerItem : stats.wear);
        const unitLabel = isCrafts ? 'crafts' : (isMaterials ? 'materials' : 'steps');
        const userUnits = isCrafts ? crafts : (isMaterials ? materials : effectiveSteps);

        const pAtLeastOne = (isFinite(expected) && expected > 0) ? (1 - Math.exp(-expected)) : NaN;
        const pDry = isFinite(pAtLeastOne) ? (1 - pAtLeastOne) : NaN;

        const milestoneTargets = [0.5, 0.9, 0.95, 0.99];
        const milestones = milestoneTargets.map(p => {
            if (!isFinite(unitsPerDrop) || unitsPerDrop <= 0) return { p, n: NaN };
            return { p, n: unitsPerDrop * (-Math.log(1 - p)) };
        });

        return { pAtLeastOne, pDry, milestones, unitsPerDrop, unitLabel, userUnits };
    }

    /**
     * Render the milestone pills row. Each pill: "50% · 245".
     * Pills the user has already passed (userUnits >= n) are rendered with
     * comparison-better styling so they read as "achieved" at a glance.
     */
    _renderMilestonePills(probs) {
        if (!probs || !probs.milestones) return '—';
        const userUnits = probs.userUnits || 0;
        const pillStyle = 'display:inline-block; padding:2px 10px; border-radius:12px; background:var(--bg-tertiary); border:1px solid var(--border-color); font-size:0.85em; margin-right:6px; margin-bottom:4px; font-variant-numeric:tabular-nums;';
        const parts = probs.milestones.map(({ p, n }) => {
            const passedCls = (isFinite(n) && userUnits >= n) ? 'comparison-better' : '';
            const nStr = isFinite(n) ? this._fmtDryNumber(n, 'integer') : '—';
            return `<span class="${passedCls}" style="${pillStyle}">${Math.round(p * 100)}%:&nbsp;${nStr}</span>`;
        });
        return parts.join('');
    }

    /**
     * Pick the matching flavour-text bracket for a given P(at least 1 drop).
     * Returns { pct, lines } where pct is the P(>=1) probability as a 0..100
     * number, or null if pAtLeastOne is NaN (no usable rate yet — e.g. zero
     * steps).
     *
     * The brackets in DRY_FLAVOUR_TEXTS are indexed by "you should have a
     * drop by now %": low % = early in the grind (normal to be empty-handed),
     * high % = walked many expected drops worth (very unlucky if still empty).
     */
    _pickDryFlavour(pAtLeastOne) {
        if (pAtLeastOne == null || !isFinite(pAtLeastOne)) return null;
        const pct = pAtLeastOne * 100;
        for (const bracket of DRY_FLAVOUR_TEXTS) {
            if (pct >= bracket.min && pct < bracket.max) {
                return { pct, lines: bracket.lines };
            }
        }
        return null;
    }

    /**
     * Substitute MediaWiki-style file tokens in a flavour line. Only the
     * Unidentified remains.svg token from the spec is supported — any
     * future tokens can be added here. The size in the token is honored.
     * Returns HTML-safe content with the <img> inlined where the token was.
     */
    _renderDryFlavourLine(line) {
        // [[File:Unidentified remains.svg|32px]]  →  inline img at 32x32
        // The asset is served from /assets/icons/items/materials/ (not
        // /assets/icons/items/equipment/ where the local file lives — the
        // container's static serving path differs from the repo layout).
        const re = /\[\[File:Unidentified remains\.svg\|(\d+)px\]\]/g;
        return line.replace(re, (_m, sizeStr) => {
            const size = parseInt(sizeStr, 10) || 32;
            return `<img src="/assets/icons/items/materials/unidentified_remains.svg" alt="Unidentified remains" width="${size}" height="${size}" style="vertical-align:middle; margin:0 2px;" />`;
        });
    }

    /**
     * Render the flavour-text pill block. Matches the styling of the rest of
     * the dry-check section — bordered card, slightly lighter background
     * (var(--bg-tertiary) vs the section's --bg-secondary) — and uses a
     * monospace font + comment-style header so it reads like a code block.
     */
    _renderDryFlavourBlock(probs) {
        const flavour = this._pickDryFlavour(probs?.pAtLeastOne);
        if (!flavour) return '';

        const wrapStyle = 'margin-top:var(--spacing-md); border:2px solid var(--border-color); border-radius:8px; padding:var(--spacing-md); background-color:var(--bg-tertiary); font-family:Consolas, "SF Mono", Menlo, Monaco, "Courier New", monospace; font-size:0.9em; line-height:1.5;';
        const lineStyle = 'color:var(--text-primary);';

        const linesHtml = flavour.lines
            .map(line => `<div style="${lineStyle}">${this._renderDryFlavourLine(line)}</div>`)
            .join('');

        return `
            <div class="dry-check-flavour" style="${wrapStyle}">
                ${linesHtml}
            </div>
        `;
    }

    /**
     * Render the DRY CHECK header's share button.
     *
     * On mobile the click opens the native share sheet (Web Share API) and
     * only falls back to a direct download on desktop/Android, so the glyph
     * is the classic iOS-style "share" mark (a box with an upward arrow)
     * rather than a download tray — a download glyph misled users into
     * thinking it only saved a file (bug 983cb46b). fill:none /
     * stroke:currentColor matches the app's other inline icons so it
     * inherits the header text color. Clicking it screenshots the
     * .dry-check-section box (see _downloadDryCheckScreenshot).
     */
    _dryCheckDownloadBtnHtml() {
        const btnStyle = 'display:inline-flex; align-items:center; justify-content:center; padding:4px; margin:0; background:none; border:none; color:var(--text-primary); cursor:pointer; border-radius:4px; line-height:0; opacity:0.85;';
        const icon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2h-2"></path><polyline points="8 7 12 3 16 7"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
        return `<button type="button" class="dry-check-download" title="Share dry check" aria-label="Share dry check screenshot" style="${btnStyle}">${icon}</button>`;
    }

    /**
     * Screenshot just the DRY CHECK box and trigger a PNG download so users
     * can share their dry-check results easily.
     *
     * Reuses the html2canvas-pro options from the bug-report capture path
     * (bug_report.js): same backgroundColor, devicePixelRatio scale, and the
     * timeout race that prevents Safari from hanging indefinitely.
     *
     * The capture is customized via html2canvas-pro's `onclone` hook, which
     * mutates ONLY the cloned DOM that gets rendered — never the live UI: the
     * download button is hidden, and the site URL is stamped across the top
     * so the shared image is self-branding.
     *
     * @param {HTMLElement} btnEl - The clicked .dry-check-download button.
     */
    async _downloadDryCheckScreenshot(btnEl) {
        const html2canvas = window.html2canvas;
        if (!html2canvas) {
            window.api?.showError?.('Screenshot tool not loaded — try refreshing the page.');
            return;
        }

        // Capture the dry-check box that contains the clicked button — works
        // for both single and comparison modes (both use .dry-check-section).
        const section = btnEl.closest('.dry-check-section');
        if (!section) return;

        try {
            const CAPTURE_TIMEOUT_MS = 5000;
            const canvas = await Promise.race([
                html2canvas(section, {
                    backgroundColor: '#1a1a1a',
                    scale: window.devicePixelRatio || 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                    // Mutate ONLY the cloned DOM html2canvas renders, so these
                    // changes land in the downloaded image but never touch the
                    // live UI (no flicker): hide the download button, and stamp
                    // the site URL across the top for shareability.
                    onclone: (clonedDoc, clonedEl) => {
                        const target = clonedEl || clonedDoc.querySelector('.dry-check-section');
                        if (!target) return;
                        const cloneBtn = target.querySelector('.dry-check-download');
                        if (cloneBtn) cloneBtn.style.visibility = 'hidden';

                        const banner = clonedDoc.createElement('div');
                        banner.textContent = 'walkscape.flamesandvoltiply.com';
                        banner.style.cssText = 'text-align:center; font-weight:700; font-size:0.9em; letter-spacing:0.03em; color:var(--text-primary); padding-bottom:var(--spacing-sm); margin-bottom:var(--spacing-sm); border-bottom:1px solid var(--border-color);';
                        target.insertBefore(banner, target.firstChild);

                        // html2canvas(-pro) renders into an isolated context that
                        // does NOT resolve `var(--x)` references in inline styles
                        // and does NOT inherit the body's Yorkten web font — so
                        // the capture came out as dark, low-contrast text in a
                        // serif fallback font (bug 983cb46b). Bake the theme's
                        // concrete colors + font onto the clone so the shared
                        // image matches the live UI. Runs on the clone only.
                        this._bakeCapturedStyles(target);
                    }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Screenshot capture timed out')), CAPTURE_TIMEOUT_MS)
                )
            ]);

            const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const filename = `walkscape-dry-check-${ts}.png`;

            // Get a PNG blob from the canvas (used by both the share + download paths).
            const blob = await new Promise((resolve) => {
                if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
                else resolve(null);
            });

            // iOS (and every WebKit browser, including Firefox on iOS) ignores
            // the <a download> attribute for script-triggered data/blob URLs, so
            // the file silently never saves to Downloads or Photos. Prefer the
            // Web Share API there — it opens the native share sheet with a
            // "Save Image" option. Desktop + Android keep the direct download.
            if (blob && navigator.canShare && navigator.share) {
                const file = new File([blob], filename, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    try {
                        // Share ONLY the image file — no `title`/`text`. The
                        // share sheet's "Copy" action would otherwise copy the
                        // title string ("WalkScape dry check") alongside the
                        // image; users want just the image (bug 983cb46b).
                        await navigator.share({ files: [file] });
                        return;  // shared or user-dismissed — don't also fire a download
                    } catch (shareErr) {
                        // User dismissed the sheet → done. Any other error → fall through.
                        if (shareErr && shareErr.name === 'AbortError') return;
                    }
                }
            }

            const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
            window.api?.showSuccess?.('Dry check screenshot downloaded.');
        } catch (error) {
            console.warn(`[DryCheck] screenshot failed: ${error.message}`);
            window.api?.showError?.('Could not capture the dry check screenshot.');
        }
    }

    /**
     * Resolve `var(--name[, fallback])` tokens in a CSS string to concrete
     * values, looking each variable up via `lookup(name)`.
     *
     * Pulled out as a pure helper so it can be unit-tested without a DOM
     * (see test_dry_check_capture_styles_983cb46b.mjs). Unknown variables
     * with no fallback are left untouched.
     *
     * @param {string} css - A CSS declaration string (e.g. an inline style).
     * @param {(name: string) => string} lookup - Resolves a var name to a value.
     * @returns {string} The CSS string with var() references substituted.
     */
    static resolveCssVars(css, lookup) {
        if (!css || css.indexOf('var(') === -1) return css;
        return css.replace(
            /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
            (match, name, fallback) => {
                const value = (lookup(name) || '').trim();
                if (value) return value;
                return fallback != null ? fallback.trim() : match;
            }
        );
    }

    /**
     * Bake concrete computed values onto a cloned capture subtree so an
     * html2canvas(-pro) screenshot renders identically to the live UI.
     *
     * The render runs in an isolated context where (a) `var(--x)` references
     * in inline styles don't resolve and (b) the inherited body font
     * (Yorkten) is lost, falling back to a serif default — producing dark,
     * low-contrast text in the wrong font (bug 983cb46b). This resolves every
     * var() in the subtree's inline styles against the live :root and stamps
     * the theme text color + font-family onto the root so inherited text
     * can't fall back. Mutates the passed (cloned) node only.
     *
     * @param {HTMLElement} target - The cloned .dry-check-section root.
     */
    _bakeCapturedStyles(target) {
        if (!target) return;
        const rootStyle = getComputedStyle(document.documentElement);
        const lookup = (name) => rootStyle.getPropertyValue(name);

        // Stamp inherited basics on the root so nothing — even class-styled
        // descendants — falls back to serif/black during capture.
        target.style.fontFamily = getComputedStyle(document.body).fontFamily;
        const textColor = (lookup('--text-primary') || '').trim();
        if (textColor) target.style.color = textColor;

        // Rewrite any inline style still referencing a CSS variable.
        const walk = (el) => {
            if (el.nodeType === 1) {
                const inline = el.getAttribute && el.getAttribute('style');
                if (inline && inline.indexOf('var(') !== -1) {
                    el.setAttribute('style', CalculatorSection.resolveCssVars(inline, lookup));
                }
                let child = el.firstElementChild;
                while (child) {
                    walk(child);
                    child = child.nextElementSibling;
                }
            }
        };
        walk(target);
    }

    /**
     * Render the single-mode DRY check sub-section.
     * Layout: dropdown + drops-received input on one row; output rows below.
     */
    _renderDryCheckSingle() {
        const qo = window.combinedStatsSection?.cachedStats?.quality_outcome || 0;
        const drops = this._dryExpandDrops(this._dryValidDrops(this._getDropTableData()), qo);
        if (drops.length === 0) return '';

        // Repair selection if drop list changed under us.
        // Priority: in-memory selectedKey -> persisted selection from this
        // activity/recipe (ui.dryCheck.itemByContext) -> drops[0] fallback.
        const validKey = (k) => !!drops.find(d => this._dropKey(d) === k);
        if (!this.dryCheck.selectedKey || !validKey(this.dryCheck.selectedKey)) {
            const saved = this._getSavedDrySelection();
            if (saved && validKey(saved)) {
                this.dryCheck.selectedKey = saved;
            } else {
                this.dryCheck.selectedKey = this._dropKey(drops[0]);
            }
        }

        const sortedDrops = this._drySortedDrops(drops);
        const hasQualityVariants = drops.some(d => d._dryQualityTier);
        const craftsMode = this._dryCraftsMode();
        const selected = drops.find(d => this._dropKey(d) === this.dryCheck.selectedKey);
        // Steps source: dry-calc local override wins over main calculator's Steps.
        // null/0 in the override means "follow main".
        const mainSteps = this.values.steps || 0;
        const overrideSteps = this.dryCheck.steps;
        const effectiveSteps = (overrideSteps != null && overrideSteps > 0) ? overrideSteps : mainSteps;
        const stepsInputValue = (overrideSteps != null && overrideSteps > 0) ? overrideSteps : mainSteps;
        const materials = this.values.materials || 0;
        // Total crafts: local override wins; otherwise derive from effective
        // steps via stepsPerCraft so toggling shows a meaningful number.
        const stepsPerCraft = this._dryStepsPerCraft();
        const derivedCrafts = (stepsPerCraft > 0) ? Math.round(effectiveSteps / stepsPerCraft) : 0;
        const overrideCrafts = this.dryCheck.crafts;
        const effectiveCrafts = (overrideCrafts != null && overrideCrafts > 0) ? overrideCrafts : derivedCrafts;
        const craftsInputValue = effectiveCrafts;
        // Expected drops + probabilities are ALWAYS computed from exact walked
        // steps so the Steps and Total-crafts views agree to the decimal. When
        // the user typed an explicit crafts count we convert it back to steps
        // (crafts × stepsPerCraft); otherwise the crafts shown is just the
        // walked steps re-expressed, so canonical steps stay unchanged. Only
        // the input box / "Expected crafts" label are in crafts. (bug 9fd38436)
        const canonicalSteps = (craftsMode && overrideCrafts != null && overrideCrafts > 0 && stepsPerCraft > 0)
            ? overrideCrafts * stepsPerCraft
            : effectiveSteps;
        // Drops received was removed from the UI — most users run the dry
        // calc with 0 drops in hand, so the field added clutter for the
        // common case. Pass 0 to keep the dryMult formula well-defined
        // (when received=0, dryMult collapses to expected).
        const stats = this._computeDryStats(selected, canonicalSteps, materials, 0, craftsMode, effectiveCrafts);

        const ratioClass = this._dryRatioClass(stats?.expected);

        const probs = this._computeDryProbabilities(stats, canonicalSteps, materials, effectiveCrafts);
        const milestonesHtml = this._renderMilestonePills(probs);

        // margin-top adds visible separation between the drops table and the dry-check
        // section beyond the calculator-content's flex gap.
        const sectionStyle = 'margin-top:var(--spacing-md); border:2px solid var(--border-color); border-radius:8px; padding:var(--spacing-md); background-color:var(--bg-secondary);';
        const headerStyle = 'font-weight:700; font-size:var(--font-size-md); color:var(--text-primary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--spacing-md);';
        // Header-on-top block layout: each metric is a vertical pair (small
        // uppercase header above, larger value below). Blocks flow vertically
        // with consistent spacing — no left/right pairing of label/value.
        const blocksStyle = 'display:flex; flex-direction:column; gap:var(--spacing-md);';
        const blockHeaderStyle = 'font-size:0.85em; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--spacing-xs);';
        const blockValueStyle = 'font-size:1.1em; color:var(--text-primary); font-variant-numeric:tabular-nums;';
        // Controls layout: dropdown on its own full-width row, then Steps and
        // Drops received each on their own full-width row below.
        const controlsStackStyle = 'display:flex; flex-direction:column; gap:var(--spacing-md); margin-bottom:var(--spacing-md);';
        const fullWidthGroupStyle = 'width:100%;';

        const wearSuffix = craftsMode ? 'crafts/drop' : 'steps/drop';

        return `
            <div class="dry-check-section" style="${sectionStyle}">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:var(--spacing-sm); margin-bottom:var(--spacing-md);">
                    <span style="${headerStyle} margin-bottom:0;">DRY CHECK</span>
                    ${this._dryCheckDownloadBtnHtml()}
                </div>
                <div style="${controlsStackStyle}">
                    <div class="calculator-input-group" style="${fullWidthGroupStyle}">
                        <label class="calculator-label">Item</label>
                        ${this._renderDryItemTrigger(selected)}
                    </div>
                    ${this._renderDryQualityCheckbox(hasQualityVariants)}
                    <div class="calculator-input-group" style="${fullWidthGroupStyle}">
                        <div style="display:flex; align-items:center; gap:var(--spacing-sm); margin-bottom:var(--spacing-xs);">
                            <label class="calculator-label" style="margin-bottom:0;">${craftsMode ? 'Total crafts' : 'Steps'}</label>
                            ${this._renderDryCraftToggle(craftsMode)}
                        </div>
                        ${craftsMode
                            ? `<input type="number" class="calculator-input dry-check-crafts" value="${craftsInputValue}" min="0" step="1" />`
                            : `<input type="number" class="calculator-input dry-check-steps" value="${stepsInputValue}" min="0" step="1" />`}
                    </div>
                </div>
                <div style="${blocksStyle}">
                    <div>
                        <div style="${blockHeaderStyle}">${craftsMode ? 'Expected crafts' : 'Expected steps'}</div>
                        <div style="${blockValueStyle}">${craftsMode ? this._fmtDryCrafts(stats?.wear) : this._fmtDryNumber(stats?.wear, 'integer')} ${wearSuffix}</div>
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Expected drops</div>
                        <div style="${blockValueStyle}" class="${ratioClass}">${this._fmtDryNumber(stats?.expected)}</div>
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Chance of at least 1 drop by now</div>
                        <div style="${blockValueStyle}">${this._fmtDryPct(probs?.pAtLeastOne)}</div>
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Chance you would be dry (0 drops)</div>
                        <div style="${blockValueStyle}">${this._fmtDryPct(probs?.pDry)}</div>
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Milestones (chance of ≥1 drop)</div>
                        <div style="${blockValueStyle}">${milestonesHtml}</div>
                    </div>
                </div>
                ${this._renderDryFlavourBlock(probs)}
            </div>
        `;
    }

    /**
     * Render the comparison-mode DRY check sub-section.
     * One drop selector at the top (shared between both gearsets); each gearset
     * has its own drops-received input and its own WEAR/Expected/DRY column.
     */
    _renderDryCheckComparison() {
        const drops1 = this._getComparisonDrops(1);
        const drops2 = this._getComparisonDrops(2);

        // Expand each gearset's drops with its OWN Quality Outcome so quality
        // tiers scale per gearset (QO can differ between the two sets).
        const compSection = window.gearsetComparisonSection;
        const qo1 = compSection?._cachedStats1?.quality_outcome || 0;
        const qo2 = compSection?._cachedStats2?.quality_outcome || 0;
        const exp1 = this._dryExpandDrops(this._dryValidDrops(drops1), qo1);
        const exp2 = this._dryExpandDrops(this._dryValidDrops(drops2), qo2);

        // Merge by drop key, preserving order — same approach as comparison drops table.
        const allByKey = new Map();
        for (const d of exp1) allByKey.set(this._dropKey(d), d);
        for (const d of exp2) {
            const k = this._dropKey(d);
            if (!allByKey.has(k)) allByKey.set(k, d);
        }
        const merged = [...allByKey.values()];
        if (merged.length === 0) return '';

        // Same selection-repair priority as single-mode: in-memory ->
        // persisted (ui.dryCheck.itemByContext) -> first valid drop.
        const validKeyComp = (k) => !!merged.find(d => this._dropKey(d) === k);
        if (!this.dryCheck.selectedKey || !validKeyComp(this.dryCheck.selectedKey)) {
            const saved = this._getSavedDrySelection();
            if (saved && validKeyComp(saved)) {
                this.dryCheck.selectedKey = saved;
            } else {
                this.dryCheck.selectedKey = this._dropKey(merged[0]);
            }
        }

        const sel1 = exp1.find(d => this._dropKey(d) === this.dryCheck.selectedKey);
        const sel2 = exp2.find(d => this._dropKey(d) === this.dryCheck.selectedKey);
        // Per-gearset Steps with override-or-fallback (same rule as single mode).
        const mainSteps1 = this.values.steps || 0;
        const mainSteps2 = this.values2.steps || 0;
        const ovr1 = this.dryCheck.steps1;
        const ovr2 = this.dryCheck.steps2;
        const steps1 = (ovr1 != null && ovr1 > 0) ? ovr1 : mainSteps1;
        const steps2 = (ovr2 != null && ovr2 > 0) ? ovr2 : mainSteps2;
        const stepsInput1 = (ovr1 != null && ovr1 > 0) ? ovr1 : mainSteps1;
        const stepsInput2 = (ovr2 != null && ovr2 > 0) ? ovr2 : mainSteps2;
        const mat1 = this.values.materials || 0;
        const mat2 = this.values2.materials || 0;
        // Total-crafts mode + per-gearset crafts (override or derived from steps).
        const craftsMode = this._dryCraftsMode();
        const stepsPerCraft = this._dryStepsPerCraft();
        const dCrafts = (s) => (stepsPerCraft > 0 ? Math.round(s / stepsPerCraft) : 0);
        const ovrC1 = this.dryCheck.crafts1;
        const ovrC2 = this.dryCheck.crafts2;
        const crafts1 = (ovrC1 != null && ovrC1 > 0) ? ovrC1 : dCrafts(steps1);
        const crafts2 = (ovrC2 != null && ovrC2 > 0) ? ovrC2 : dCrafts(steps2);
        const craftsInput1 = crafts1;
        const craftsInput2 = crafts2;
        // Canonical steps for Expected drops / probabilities — always steps-based
        // so the Steps and Total-crafts views agree. An explicit crafts entry is
        // converted back to steps (× stepsPerCraft); otherwise walked steps are
        // used unchanged. (bug 9fd38436)
        const canon1 = (craftsMode && ovrC1 != null && ovrC1 > 0 && stepsPerCraft > 0) ? ovrC1 * stepsPerCraft : steps1;
        const canon2 = (craftsMode && ovrC2 != null && ovrC2 > 0 && stepsPerCraft > 0) ? ovrC2 * stepsPerCraft : steps2;
        // Drops received was removed from the UI — pass 0 (see single-mode rationale).
        const stats1 = this._computeDryStats(sel1, canon1, mat1, 0, craftsMode, crafts1);
        const stats2 = this._computeDryStats(sel2, canon2, mat2, 0, craftsMode, crafts2);
        const probs1 = this._computeDryProbabilities(stats1, canon1, mat1, crafts1);
        const probs2 = this._computeDryProbabilities(stats2, canon2, mat2, crafts2);

        const sortedMerged = this._drySortedDrops(merged);
        const hasQualityVariants = merged.some(d => d._dryQualityTier);
        // Stash the sorted comparison drop list on the instance so the
        // dropdown click handler can rebuild items HTML at open time
        // without re-doing the GS1+GS2 merge.
        this._dryDropdownDropsForOpen = sortedMerged;

        const fmtCell = (stats, probs, kind) => {
            if (kind === 'wear') return stats ? (craftsMode ? this._fmtDryCrafts(stats.wear) : this._fmtDryNumber(stats.wear, 'integer')) : '—';
            if (kind === 'expected') {
                if (!stats) return '—';
                // Color thresholds (was on DRY ratio): <0.8 lucky-green, >=1.5 dry-red.
                // Numerically identical to dryMult since dropsReceived=0 collapses
                // expected/max(1,0) -> expected.
                const cls = this._dryRatioClass(stats.expected);
                return `<span class="${cls}">${this._fmtDryNumber(stats.expected)}</span>`;
            }
            if (kind === 'pAtLeastOne') return this._fmtDryPct(probs?.pAtLeastOne);
            if (kind === 'pDry') return this._fmtDryPct(probs?.pDry);
            if (kind === 'milestones') return this._renderMilestonePills(probs);
            return '—';
        };

        // margin-top adds visible separation between the comparison drops table and
        // the dry-check section beyond the calculator-content's flex gap.
        const sectionStyle = 'margin-top:var(--spacing-md); border:2px solid var(--border-color); border-radius:8px; padding:var(--spacing-md); background-color:var(--bg-secondary);';
        const headerStyle = 'font-weight:700; font-size:var(--font-size-md); color:var(--text-primary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--spacing-md);';
        const selectorStyle = 'margin-bottom:var(--spacing-md); width:100%;';
        // Header-on-top block layout for comparison: each metric is a vertical
        // pair (uppercase header above, value row below). The value row is a
        // 2-column grid showing Gear set 1 and Gear set 2 side by side.
        const blocksStyle = 'display:flex; flex-direction:column; gap:var(--spacing-md);';
        const blockHeaderStyle = 'font-size:0.85em; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:var(--spacing-xs);';
        const blockValueRowStyle = 'display:grid; grid-template-columns:1fr 1fr; gap:var(--spacing-sm);';
        const blockCellStyle = 'background-color:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:6px; padding:var(--spacing-sm); display:flex; flex-direction:column; gap:var(--spacing-xs);';
        const blockSubLabelStyle = 'font-size:0.75em; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.05em;';
        const blockValueStyle = 'font-size:1.1em; color:var(--text-primary); font-variant-numeric:tabular-nums;';
        const blockInputCellStyle = 'background-color:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:6px; padding:var(--spacing-sm); display:flex; flex-direction:column; gap:var(--spacing-xs);';

        const valuePair = (v1, v2) => `
            <div style="${blockValueRowStyle}">
                <div style="${blockCellStyle}">
                    <div style="${blockSubLabelStyle}">Gear set 1</div>
                    <div style="${blockValueStyle}">${v1}</div>
                </div>
                <div style="${blockCellStyle}">
                    <div style="${blockSubLabelStyle}">Gear set 2</div>
                    <div style="${blockValueStyle}">${v2}</div>
                </div>
            </div>
        `;

        const inputPair = (cls, gsAttr1, val1, gsAttr2, val2) => `
            <div style="${blockValueRowStyle}">
                <div style="${blockInputCellStyle}">
                    <div style="${blockSubLabelStyle}">Gear set 1</div>
                    <input type="number" class="calculator-input ${cls}" data-gs="1" value="${val1}" min="0" step="1" />
                </div>
                <div style="${blockInputCellStyle}">
                    <div style="${blockSubLabelStyle}">Gear set 2</div>
                    <input type="number" class="calculator-input ${cls}" data-gs="2" value="${val2}" min="0" step="1" />
                </div>
            </div>
        `;

        return `
            <div class="dry-check-section dry-check-comparison" style="${sectionStyle}">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:var(--spacing-sm); margin-bottom:var(--spacing-md);">
                    <span style="${headerStyle} margin-bottom:0;">DRY CHECK</span>
                    ${this._dryCheckDownloadBtnHtml()}
                </div>
                <div class="calculator-input-group" style="${selectorStyle}">
                    <label class="calculator-label">Item</label>
                    ${this._renderDryItemTrigger(sel1 || sel2)}
                </div>
                ${this._renderDryQualityCheckbox(hasQualityVariants)}
                <div style="${blocksStyle}">
                    <div>
                        <div style="display:flex; align-items:center; gap:var(--spacing-sm); margin-bottom:var(--spacing-xs);">
                            <span style="${blockHeaderStyle} margin-bottom:0;">${craftsMode ? 'Total crafts' : 'Steps'}</span>
                            ${this._renderDryCraftToggle(craftsMode)}
                        </div>
                        ${craftsMode
                            ? inputPair('dry-check-crafts-comp', '1', craftsInput1, '2', craftsInput2)
                            : inputPair('dry-check-steps-comp', '1', stepsInput1, '2', stepsInput2)}
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">${craftsMode ? 'Expected crafts' : 'Expected steps'}</div>
                        ${valuePair(fmtCell(stats1, probs1, 'wear'), fmtCell(stats2, probs2, 'wear'))}
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Expected drops</div>
                        ${valuePair(fmtCell(stats1, probs1, 'expected'), fmtCell(stats2, probs2, 'expected'))}
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Chance of at least 1 drop by now</div>
                        ${valuePair(fmtCell(stats1, probs1, 'pAtLeastOne'), fmtCell(stats2, probs2, 'pAtLeastOne'))}
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Chance you would be dry (0 drops)</div>
                        ${valuePair(fmtCell(stats1, probs1, 'pDry'), fmtCell(stats2, probs2, 'pDry'))}
                    </div>
                    <div>
                        <div style="${blockHeaderStyle}">Milestones (chance of ≥1 drop)</div>
                        ${valuePair(fmtCell(stats1, probs1, 'milestones'), fmtCell(stats2, probs2, 'milestones'))}
                    </div>
                </div>
                ${(this._renderDryFlavourBlock(probs1) || this._renderDryFlavourBlock(probs2))
                    ? `<div style="display:grid; grid-template-columns:1fr 1fr; gap:var(--spacing-sm);">
                        <div>${this._renderDryFlavourBlock(probs1)}</div>
                        <div>${this._renderDryFlavourBlock(probs2)}</div>
                       </div>`
                    : ''}
            </div>
        `;
    }

    /**
     * Render the expected drops table for a given steps count and drop list.
     * Styled like the comparison view drops table — large icons, pill badges.
     * @param {number} steps - Number of steps
     * @param {Array} drops - Drop objects with steps_per_item
     * @param {boolean} showFine - Whether to show fine item rows
     * @returns {string} HTML
     */
    renderDropsTable(steps, drops, showFine = false) {
        if (!drops || drops.length === 0) return '';
        if (this.mode === 'recipe') {
            // For recipes, need either steps or materials to be non-zero
            const materials = this.values.materials || 0;
            if (steps <= 0 && materials <= 0) return '';
        } else if (steps <= 0) {
            return '';
        }

        const validDrops = drops.filter(d => d.steps_per_item && isFinite(d.steps_per_item) && d.steps_per_item > 0);
        if (validDrops.length === 0) return '';

        const fmtExpected = (s, stepsPerItem) => {
            if (!s || s <= 0 || !stepsPerItem || !isFinite(stepsPerItem)) return '—';
            const v = s / stepsPerItem;
            if (v >= 1000) return Math.round(v).toLocaleString();
            if (v >= 10) return formatFixed(v, 1, { trim: true });
            return formatFixed(v, 2, { trim: true });
        };

        // For recipe drops, use materials/materials_per_item when available (more accurate).
        // steps/steps_per_item is wrong for recipes because steps_per_item uses stepsPerRewardRoll
        // which is in different units than the raw walked steps the calculator tracks.
        const calcExpected = (drop) => {
            if (this.mode === 'recipe' && drop.materials_per_item != null && isFinite(drop.materials_per_item) && drop.materials_per_item > 0) {
                const materials = this.values.materials || 0;
                if (materials <= 0) return '—';
                const v = materials / drop.materials_per_item;
                if (v >= 1000) return Math.round(v).toLocaleString();
                if (v >= 10) return formatFixed(v, 1, { trim: true });
                return formatFixed(v, 2, { trim: true });
            }
            // Activity mode (or recipe drop without materials_per_item): steps / steps_per_item
            return fmtExpected(steps, drop.steps_per_item);
        };

        const getIconAndName = (drop) => {
            // Chest: use _chestSkill or primary_skill for proper name/icon
            if (drop.source === 'chest') {
                const skill = drop._chestSkill || drop.primary_skill || 'chest';
                const skillDisplay = skill.charAt(0).toUpperCase() + skill.slice(1);
                return {
                    icon: `/assets/icons/items/containers/${skill.toLowerCase()}_chest.svg`,
                    name: `${skillDisplay} Chest`
                };
            }
            if (drop.icon_override) return { icon: drop.icon_override, name: drop.item_name };
            if (drop.item_ref) {
                const [type] = drop.item_ref.split('.');
                const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');
                const typeMap = {
                    'Currency': `/assets/icons/items/${iconName}.svg`,
                    'Material': `/assets/icons/items/materials/${iconName}.svg`,
                    'Item': `/assets/icons/items/equipment/${iconName}.svg`,
                    'Collectible': `/assets/icons/items/collectibles/${iconName}.svg`,
                    'Consumable': `/assets/icons/items/consumables/${iconName}.svg`,
                    'Container': `/assets/icons/items/containers/${iconName}.svg`,
                    'Egg': `/assets/icons/items/pet_eggs/${iconName}.svg`,
                };
                return { icon: typeMap[type] || `/assets/icons/items/materials/${iconName}.svg`, name: drop.item_name };
            }
            const iconName = (drop.item_name || '').toLowerCase().replace(/ /g, '_');
            return { icon: `/assets/icons/items/materials/${iconName}.svg`, name: drop.item_name };
        };

        const rows = validDrops.map(drop => {
            const { icon: iconPath, name: displayName } = getIconAndName(drop);
            const expected = calcExpected(drop);

            let finePill = '';
            if (showFine && drop.steps_per_fine_item && isFinite(drop.steps_per_fine_item)) {
                const fineExpected = fmtExpected(steps, drop.steps_per_fine_item);
                finePill = `<div class="comparison-drop-steps fine-steps calc-drops-pill">${fineExpected}</div>`;
            }

            return `
                <tr class="comparison-drop-row">
                    <td class="comparison-drop-label">
                        <div class="comparison-drop-label-inner">
                            <img src="${iconPath}" alt="${displayName}" class="comparison-drop-icon"
                                onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}else{this.src='/assets/icons/items/containers/treasure_chest.svg'}"
                                title="${displayName}" loading="lazy" />
                        </div>
                    </td>
                    <td class="comparison-drop-cell calc-drops-cell-left">
                        <div class="comparison-drop-steps calc-drops-pill">${expected}</div>
                        ${finePill}
                    </td>
                </tr>`;
        }).join('');

        return `
            <div class="calc-drops-table-wrapper">
                <table class="comparison-table comparison-drops-table calc-drops-single">
                    <thead>
                        <tr>
                            <th class="calc-drops-header-item">ITEM</th>
                            <th class="calc-drops-header-count">EXPECTED</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
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
        const isComparison = store.state.gearsets?.comparisonMode || false;

        // Show drops for activities and recipes
        const showDrops = this.mode === 'activity' || this.mode === 'recipe';
        let dropsHtml = '';
        let dryCheckHtml = '';
        if (showDrops) {
            if (isComparison) {
                const drops1 = this._getComparisonDrops(1);
                const drops2 = this._getComparisonDrops(2);
                const steps1 = this.values.steps || 0;
                const steps2 = this.values2.steps || 0;
                const hasFine = drops1.some(d => d.steps_per_fine_item) || drops2.some(d => d.steps_per_fine_item);
                if ((drops1.length > 0 || drops2.length > 0) && (steps1 > 0 || steps2 > 0)) {
                    dropsHtml = this._renderComparisonDropsTable(steps1, drops1, steps2, drops2, hasFine);
                }
                dryCheckHtml = this._renderDryCheckComparison();
            } else {
                const drops = this._getDropTableData();
                const steps = this.values.steps || 0;
                const materials = this.values.materials || 0;
                const hasFine = drops.some(d => d.steps_per_fine_item);
                if (steps > 0 || (this.mode === 'recipe' && materials > 0)) {
                    dropsHtml = this.renderDropsTable(steps, drops, hasFine);
                }
                dryCheckHtml = this._renderDryCheckSingle();
            }
        }

        const html = `
            <div class="calculator-section" data-pin-id="calculator-section">
                <div class="calculator-header">
                    <span class="calculator-title">CALCULATOR</span>
                    <button class="collapse-toggle">${arrowIcon}</button>
                </div>
                <div class="calculator-content" style="display: ${this.isExpanded ? 'block' : 'none'};">
                    ${isComparison ? this.renderComparisonInputs() : this.renderMainInputs()}
                    ${isComparison ? this.renderComparisonSkillFields() : this.renderSkillFields()}
                    ${dropsHtml}
                    ${dryCheckHtml}
                </div>
            </div>
        `;

        this.$element.html(html);
        this.attachEvents();
        try { wireInfoIcons(this.$element[0]); } catch (e) { /* info icons optional */ }
    }

    /**
     * Render side-by-side drops table for comparison mode.
     * Styled like the comparison view drops table — large icons, pill badges.
     */
    _renderComparisonDropsTable(steps1, drops1, steps2, drops2, hasFine) {
        if ((steps1 <= 0 && steps2 <= 0) || (drops1.length === 0 && drops2.length === 0)) return '';

        // Merge all item names preserving order
        const allNames = new Map();
        for (const d of drops1) allNames.set(d.item_name, d);
        for (const d of drops2) { if (!allNames.has(d.item_name)) allNames.set(d.item_name, d); }

        const fmtExpected = (steps, stepsPerItem) => {
            if (!steps || steps <= 0 || !stepsPerItem || !isFinite(stepsPerItem)) return '—';
            const v = steps / stepsPerItem;
            if (v >= 1000) return Math.round(v).toLocaleString();
            if (v >= 10) return formatFixed(v, 1, { trim: true });
            return formatFixed(v, 2, { trim: true });
        };

        const getIconAndName = (drop) => {
            if (!drop) return { icon: '/assets/icons/items/containers/treasure_chest.svg', name: 'Chest' };
            // Chest: use _chestSkill or primary_skill for proper name/icon
            if (drop.source === 'chest') {
                const skill = drop._chestSkill || drop.primary_skill || 'chest';
                const skillDisplay = skill.charAt(0).toUpperCase() + skill.slice(1);
                return {
                    icon: `/assets/icons/items/containers/${skill.toLowerCase()}_chest.svg`,
                    name: `${skillDisplay} Chest`
                };
            }
            if (drop.icon_override) return { icon: drop.icon_override, name: drop.item_name };
            if (drop.item_ref) {
                const [type] = drop.item_ref.split('.');
                const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');
                const typeMap = {
                    'Currency': `/assets/icons/items/${iconName}.svg`,
                    'Material': `/assets/icons/items/materials/${iconName}.svg`,
                    'Item': `/assets/icons/items/equipment/${iconName}.svg`,
                    'Collectible': `/assets/icons/items/collectibles/${iconName}.svg`,
                    'Consumable': `/assets/icons/items/consumables/${iconName}.svg`,
                    'Container': `/assets/icons/items/containers/${iconName}.svg`,
                    'Egg': `/assets/icons/items/pet_eggs/${iconName}.svg`,
                };
                return { icon: typeMap[type] || `/assets/icons/items/materials/${iconName}.svg`, name: drop.item_name };
            }
            const iconName = (drop.item_name || '').toLowerCase().replace(/ /g, '_');
            return { icon: `/assets/icons/items/materials/${iconName}.svg`, name: drop.item_name };
        };

        // Higher expected count = better (green)
        const cls = (myExp, otherExp) => {
            if (!isFinite(myExp) || !isFinite(otherExp) || myExp === otherExp) return '';
            return myExp > otherExp ? 'comparison-better' : 'comparison-worse';
        };

        const buildCell = (drop, steps, materials, otherDrop, otherSteps, otherMaterials) => {
            if (!drop) return '<div style="text-align:center;color:var(--text-secondary)">—</div>';

            // For recipe drops with materials_per_item, use materials as the basis
            let exp, expStr;
            if (this.mode === 'recipe' && drop.materials_per_item != null && isFinite(drop.materials_per_item) && drop.materials_per_item > 0 && materials > 0) {
                exp = materials / drop.materials_per_item;
                const otherMPI = otherDrop?.materials_per_item;
                const otherExpVal = (otherMPI != null && isFinite(otherMPI) && otherMPI > 0 && otherMaterials > 0) ? otherMaterials / otherMPI : null;
                const stepsCls = otherExpVal !== null ? cls(exp, otherExpVal) : '';
                expStr = exp >= 1000 ? Math.round(exp).toLocaleString() : exp >= 10 ? formatFixed(exp, 1, { trim: true }) : formatFixed(exp, 2, { trim: true });
                return `<div class="comparison-drop-steps calc-drops-pill ${stepsCls}">${expStr}</div>`;
            }

            if (steps <= 0) return '<div style="text-align:center;color:var(--text-secondary)">—</div>';
            exp = steps / drop.steps_per_item;
            const otherExp = (otherDrop && otherSteps > 0) ? otherSteps / otherDrop.steps_per_item : null;
            const stepsCls = otherExp !== null ? cls(exp, otherExp) : '';

            let html = `<div class="comparison-drop-steps calc-drops-pill ${stepsCls}">${fmtExpected(steps, drop.steps_per_item)}</div>`;

            if (hasFine && drop.steps_per_fine_item && isFinite(drop.steps_per_fine_item)) {
                const fineExp = steps / drop.steps_per_fine_item;
                const otherFineExp = (otherDrop?.steps_per_fine_item && otherSteps > 0) ? otherSteps / otherDrop.steps_per_fine_item : null;
                const fineCls = otherFineExp !== null ? cls(fineExp, otherFineExp) : '';
                html += `<div class="comparison-drop-steps fine-steps calc-drops-pill ${fineCls}">${fmtExpected(steps, drop.steps_per_fine_item)}</div>`;
            }

            return html;
        };

        const rows = [];
        for (const [itemName, refDrop] of allNames) {
            const d1 = drops1.find(d => d.item_name === itemName);
            const d2 = drops2.find(d => d.item_name === itemName);
            const { icon: iconPath, name: displayName } = getIconAndName(refDrop);
            const mat1 = this.values.materials || 0;
            const mat2 = this.values2.materials || 0;

            rows.push(`
                <tr class="comparison-drop-row">
                    <td class="comparison-drop-label">
                        <div class="comparison-drop-label-inner">
                            <img src="${iconPath}" alt="${displayName}" class="comparison-drop-icon"
                                onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}else{this.src='/assets/icons/items/containers/treasure_chest.svg'}"
                                title="${displayName}" loading="lazy" />
                        </div>
                    </td>
                    <td class="comparison-drop-cell">${buildCell(d1, steps1, mat1, d2, steps2, mat2)}</td>
                    <td class="comparison-drop-cell">${buildCell(d2, steps2, mat2, d1, steps1, mat1)}</td>
                </tr>`);
        }

        if (rows.length === 0) return '';

        return `
            <div class="calc-drops-table-wrapper">
                <table class="comparison-table comparison-drops-table">
                    <thead>
                        <tr>
                            <th></th>
                            <th>GEAR SET 1</th>
                            <th>GEAR SET 2</th>
                        </tr>
                    </thead>
                    <tbody>${rows.join('')}</tbody>
                </table>
            </div>
        `;
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
                    <label class="calculator-label" style="display:inline-flex; align-items:center; gap:4px;">Materials <span class="travel-info-icon" data-info-html="${this._buildMaterialsCountPopupHtml()}" role="button" tabindex="0" aria-label="Material counts" style="font-style:normal; text-transform:lowercase;">ⓘ</span></label>
                    <div class="calc-materials-input-wrap" style="position:relative; width:100%;">
                        <span class="calc-materials-x-prefix" aria-hidden="true" style="position:absolute; left:10px; top:0; bottom:0; display:flex; align-items:center; line-height:1; pointer-events:none; opacity:0.6; font-weight:600;">x</span>
                        <input type="number" class="calculator-input" data-field="materials" value="${this.values.materials}" min="0" step="0.1" style="padding-left:22px;" />
                    </div>
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
     * Build the icon path for a recipe material/consumable/equipment input.
     * Mirrors recipe-info-section's icon resolution.
     */
    _materialIconPath(material) {
        const iconName = material.material_icon_name || material.material_id || '';
        const type = material.type;
        if (type === 'consumable') return `/assets/icons/items/consumables/${iconName}.svg`;
        if (type === 'equipment') return `/assets/icons/items/equipment/${iconName}.svg`;
        return `/assets/icons/items/materials/${iconName}.svg`;
    }

    /**
     * Format a material count (matches the drops-section materials-per-item format).
     */
    _formatMaterialCount(v) {
        if (!isFinite(v)) return '0';
        return v < 10
            ? formatFixed(v, 2, { trim: true })
            : v < 100
                ? formatFixed(v, 1, { trim: true })
                : Math.ceil(v).toLocaleString();
    }

    /**
     * Build the (i) popover HTML for the Materials field — a table listing the
     * real consumed count of each material in the recipe: the editable
     * "Materials" value × each material's per-craft quantity (e.g. 74.3 with a
     * 2x-logs recipe → 148.6 logs). Returns an attribute-escaped HTML string
     * for use in `data-info-html` (consumed by info-popover.js wireInfoIcons).
     *
     * Uses the recipe's primary material group (group 0). Counts are rebuilt on
     * every render, and the calculator re-renders on each committed field edit,
     * so the popup always reflects the current Materials value.
     */
    _buildMaterialsCountPopupHtml() {
        const esc = (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const matValue = this.values.materials || 0;
        const groups = (this.recipe && Array.isArray(this.recipe.materials)) ? this.recipe.materials : [];
        // Use the material group the user picked in the recipe info section
        // (multi-material recipes like Box trap can use any plank). Falls back
        // to the primary group. drops-section re-renders the calculator on
        // group change (selectMaterialGroup -> dropsSection.render ->
        // calculatorSection.render), so this stays in sync.
        const mgIndex = ((window.recipeInfoSection?.selectedMaterialGroup) ?? 0) | 0;
        const group = Array.isArray(groups[mgIndex]) ? groups[mgIndex]
            : (Array.isArray(groups[0]) ? groups[0] : []);

        let cells = '';
        if (group.length === 0) {
            cells = `<div style="opacity:0.7; grid-column:1 / -1;">No material data</div>`;
        } else {
            for (const m of group) {
                const count = matValue * (m.quantity || 0);
                const iconPath = this._materialIconPath(m);
                const name = esc(m.material_name || m.material_id || '');
                cells += `<span style="text-align:left; font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap;">${this._formatMaterialCount(count)}</span>` +
                    `<img src="${iconPath}" alt="${name}" title="${name}" style="width:32px; height:32px;" onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}" />`;
            }
        }

        // inline-grid so the popup is only as wide as it needs: the number
        // column is max-content (grows right only when a count is longer) and
        // every row's number/icon line up in their columns.
        const html = `<div class="calc-materials-count-popup" style="display:inline-grid; grid-template-columns:max-content 32px; column-gap:8px; row-gap:6px; align-items:center;">${cells}</div>`;
        return html.replace(/"/g, '&quot;');
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
     * Render comparison mode main inputs (side-by-side with copy buttons)
     */
    renderComparisonInputs() {
        const fields = [
            { key: 'steps', label: 'Steps', step: '1' },
            { key: 'actions', label: 'Actions', step: '0.1' },
        ];
        if (this.mode === 'recipe') {
            fields.push({ key: 'materials', label: 'Materials', step: '0.1' });
            fields.push({ key: 'crafts', label: 'Crafts', step: '0.1' });
        }

        const arrowRight = `<svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2,10 Q12,-1 22,5" fill="none"/><polyline points="20,1 22,5 19,7"/></svg>`;
        const arrowLeft = `<svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22,2 Q12,13 2,7" fill="none"/><polyline points="4,11 2,7 5,5"/></svg>`;

        let rows = '';
        for (const f of fields) {
            const v1 = this.values[f.key] || 0;
            const v2 = this.values2[f.key] || 0;
            const colorClass = this._compColor(v1, v2, f.key);
            rows += `<tr>
                <td class="calc-comp-label">${f.label}</td>
                <td class="calc-comp-input-cell"><input type="number" class="calculator-input calc-comp-input" data-gs="1" data-field="${f.key}" value="${v1}" min="0" step="${f.step}" /></td>
                <td class="calc-comp-center"><div class="calc-comp-copy-btns">
                    <button class="calc-copy-btn" data-from="1" data-to="2" data-field="${f.key}" title="Copy to GS2">${arrowRight}</button>
                    <button class="calc-copy-btn" data-from="2" data-to="1" data-field="${f.key}" title="Copy to GS1">${arrowLeft}</button>
                </div></td>
                <td class="calc-comp-input-cell"><input type="number" class="calculator-input calc-comp-input ${colorClass}" data-gs="2" data-field="${f.key}" value="${v2}" min="0" step="${f.step}" /></td>
            </tr>`;
        }

        return `<table class="calc-comp-table">
            <colgroup>
                <col class="calc-col-label" />
                <col class="calc-col-input" />
                <col class="calc-col-btns" />
                <col class="calc-col-input" />
            </colgroup>
            <thead><tr>
                <th></th>
                <th class="calc-comp-header">Gear set 1</th>
                <th></th>
                <th class="calc-comp-header">Gear set 2</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    /**
     * Render comparison mode skill fields (side-by-side, 4-column layout)
     */
    renderComparisonSkillFields() {
        const skills = Object.keys(this.values.skills);
        if (skills.length === 0) return '';

        const arrowRight = `<svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2,10 Q12,-1 22,5" fill="none"/><polyline points="20,1 22,5 19,7"/></svg>`;
        const arrowLeft = `<svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22,2 Q12,13 2,7" fill="none"/><polyline points="4,11 2,7 5,5"/></svg>`;

        let html = '';
        for (const skill of skills) {
            const s1 = this.values.skills[skill] || {};
            const s2 = this.values2.skills[skill] || {};
            const skillColor = this.getSkillColor(skill);
            const skillId = skill.toLowerCase();
            const skillIcon = `/assets/icons/text/skill_icons/${skillId}.svg`;

            const skillFields = [
                { key: 'startXP', label: 'Start XP', step: '1' },
                { key: 'gainedXP', label: 'Gained XP', step: '1' },
                { key: 'targetXP', label: 'Target XP', step: '1' },
                { key: 'startLevel', label: 'Start Lv', step: '1' },
                { key: 'endLevel', label: 'End Lv', step: '1' },
            ];

            let rows = '';
            for (const f of skillFields) {
                const v1 = s1[f.key] || 0;
                const v2 = s2[f.key] || 0;
                const colorClass = this._compColor(v1, v2, f.key);
                rows += `<tr>
                    <td class="calc-comp-label">${f.label}</td>
                    <td class="calc-comp-input-cell"><input type="number" class="calculator-input calc-comp-input" data-gs="1" data-field="${f.key}" data-skill="${skill}" value="${v1}" min="0" step="${f.step}" /></td>
                    <td class="calc-comp-center"><div class="calc-comp-copy-btns">
                        <button class="calc-copy-btn" data-from="1" data-to="2" data-field="${f.key}" data-skill="${skill}" title="Copy to GS2">${arrowRight}</button>
                        <button class="calc-copy-btn" data-from="2" data-to="1" data-field="${f.key}" data-skill="${skill}" title="Copy to GS1">${arrowLeft}</button>
                    </div></td>
                    <td class="calc-comp-input-cell"><input type="number" class="calculator-input calc-comp-input ${colorClass}" data-gs="2" data-field="${f.key}" data-skill="${skill}" value="${v2}" min="0" step="${f.step}" /></td>
                </tr>`;
            }

            html += `
                <div class="calculator-skill-section" style="border-color: ${skillColor};">
                    <div class="calculator-skill-header">
                        <img src="${skillIcon}" alt="${skill}" class="calculator-skill-icon" />
                        <span class="calculator-skill-name">${skill}</span>
                    </div>
                    <table class="calc-comp-table">
                    <colgroup>
                        <col class="calc-col-label" />
                        <col class="calc-col-input" />
                        <col class="calc-col-btns" />
                        <col class="calc-col-input" />
                    </colgroup>
                    ${rows}</table>
                </div>`;
        }

        return `<div class="calc-comp-skills">${html}</div>`;
    }

    /**
     * Get comparison color class for a value pair.
     * White = same, green = GS2 better, red = GS2 worse.
     * "Better" depends on the field. Costs (lower = better): steps, materials.
     * Outputs (higher = better): actions, crafts, XP, levels. At a fixed number
     * of steps a stronger set (e.g. one with DA food) performs MORE actions, so
     * a higher action count is a positive result and must read green.
     */
    _compColor(v1, v2, field) {
        if (v1 === v2 || (v1 === 0 && v2 === 0)) return '';
        const lowerBetter = ['steps', 'materials'].includes(field);
        const isBetter = lowerBetter ? v2 < v1 : v2 > v1;
        return isBetter ? 'comparison-better' : 'comparison-worse';
    }

    /**
     * Get stats for a specific gearset in comparison mode.
     * Uses the comparison section's cached API stats (same format as getCurrentStats).
     */
    _getComparisonStats(gsNum) {
        const compSection = window.gearsetComparisonSection;
        const apiStats = gsNum === 1 ? compSection?._cachedStats1 : compSection?._cachedStats2;
        if (!apiStats) return this.getCurrentStats();

        // Convert API stats (percentage format) to the same format as getCurrentStats
        const we = (apiStats.work_efficiency || 0) / 100;
        const da = (apiStats.double_action || 0) / 100;
        const dr = (apiStats.double_rewards || 0) / 100;
        const nmc = (apiStats.no_materials_consumed || 0) / 100;
        const flat = apiStats.flat_steps || apiStats.steps_add || 0;
        const pct = (apiStats.steps_percent || apiStats.steps_pct || 0) / 100;
        const bonusXPAdd = apiStats.bonus_xp_add || apiStats.bonus_experience_add || 0;
        const bonusXPPercent = (apiStats.bonus_xp_percent || apiStats.bonus_experience_percent || 0) / 100;

        if (this.mode === 'activity' && this.activity) {
            const baseSteps = this.activity.base_steps;
            const maxEfficiency = this.activity.max_efficiency;
            // Single ceil at the END (KamiTzayig reference).
            const cappedWE = Math.min(we, maxEfficiency);
            const baseOverEff = baseSteps / (1 + cappedWE);
            const minSteps = baseSteps / (1 + maxEfficiency);
            const stepsWithWE = Math.max(baseOverEff, minSteps);
            const stepsWithPct = stepsWithWE * (1 + pct);
            const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));
            const stepsPerAction = Math.ceil((1 / (1 + da)) * stepsPerSingleAction);

            let totalXP = this.activity.base_xp;
            if (this.activity.secondary_xp) {
                for (const xp of Object.values(this.activity.secondary_xp)) totalXP += xp;
            }
            totalXP = (totalXP + bonusXPAdd) * (1 + bonusXPPercent);

            return { stepsPerAction, xpPerAction: totalXP, materialsPerCraft: 1.0, stepsPerCraft: stepsPerAction };
        } else if (this.mode === 'recipe' && this.recipe) {
            const baseSteps = this.recipe.base_steps;
            const maxEfficiency = this.recipe.max_efficiency;
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            // Single ceil at the END (KamiTzayig reference) — prevents off-by-one
            // errors when a pct modifier is applied.
            const baseOverEff = baseSteps / totalEfficiency;
            const withPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);
            const actionsPerCompletion = 1 + da;
            const stepsPerAction = stepsPerSingleAction / actionsPerCompletion;
            const rewardRollsPerCompletion = (1 + da) * (1 + dr);
            const stepsPerCraft = stepsPerSingleAction / rewardRollsPerCompletion;
            const craftsPerMaterial = nmc < 1.0 ? (1 + dr) / (1 - nmc) : Infinity;
            const materialsPerCraft = craftsPerMaterial > 0 ? 1.0 / craftsPerMaterial : 1.0;
            // Fine materials grant +75% XP. Mirror the single-view
            // getCalculatorStats formula so each comparison column carries
            // its own gear-correct XP/action (bug 28fb3e5b: recipe XP was
            // previously taken from the single equipped-gear rate for BOTH
            // columns, so GAINED XP no longer equalled steps × xp/step).
            const useFine = store.state.column3?.useFine || false;
            const canUseFine = this.recipe.has_fine_option || this.recipe.has_equipment_input;
            const fineBonus = (useFine && canUseFine) ? 0.75 : 0;
            const xpPerAction = (this.recipe.base_xp + bonusXPAdd) * (1 + bonusXPPercent) * (1 + fineBonus);

            return { stepsPerAction, xpPerAction, materialsPerCraft, stepsPerCraft, craftsPerMaterial, dr };
        }
        return this.getCurrentStats();
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
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers
        this.$element.off('click');
        this.$element.off('blur');
        this.$element.off('keypress');
        this.$element.off('change');

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

        // === Comparison mode handlers ===
        if (store.state.gearsets?.comparisonMode) {
            // Input change on comparison fields
            this.$element.on('blur', '.calc-comp-input[data-gs]', (e) => {
                this._handleCompInput(e.target);
            });
            this.$element.on('keypress', '.calc-comp-input[data-gs]', (e) => {
                if (e.which === 13) {
                    this._handleCompInput(e.target);
                    e.target.blur();
                }
            });

            // Copy buttons — read current input value from DOM first (user may not have blurred)
            this.$element.on('click', '.calc-copy-btn', (e) => {
                const $btn = $(e.currentTarget);
                const from = parseInt($btn.data('from'));
                const to = parseInt($btn.data('to'));
                const field = $btn.data('field');
                const skill = $btn.data('skill') || null;

                // Sync the source input's current DOM value to state first
                const selector = skill
                    ? `.calc-comp-input[data-gs="${from}"][data-field="${field}"][data-skill="${skill}"]`
                    : `.calc-comp-input[data-gs="${from}"][data-field="${field}"]:not([data-skill])`;
                const $srcInput = this.$element.find(selector);
                if ($srcInput.length) {
                    const isInt = ['steps', 'startXP', 'gainedXP', 'targetXP', 'startLevel', 'endLevel'].includes(field);
                    const val = isInt ? this.validateInteger($srcInput.val()) : this.validateDecimal($srcInput.val());
                    const srcVals = from === 1 ? this.values : this.values2;
                    if (skill && srcVals.skills[skill]) srcVals.skills[skill][field] = val;
                    else srcVals[field] = val;
                }

                const srcVals = from === 1 ? this.values : this.values2;
                const dstVals = to === 1 ? this.values : this.values2;
                const toGs = to;

                if (skill) {
                    if (srcVals.skills[skill] && dstVals.skills[skill]) {
                        dstVals.skills[skill][field] = srcVals.skills[skill][field];
                        this._recalcSkillField(dstVals, skill, field, toGs);
                    }
                } else {
                    dstVals[field] = srcVals[field];
                    this._recalcMainField(dstVals, field, toGs);
                }
                this.render();
            });
        }

        // === DRY check handlers (work in both single and comparison mode) ===
        // Open/toggle the floating dropdown when the user clicks the trigger.
        // The popup engine (openDropdownUnder) sets `.expanded` on our
        // arrow when open, so we can detect "already open" via DOM and
        // toggle close on the second click — same UX pattern xy uses
        // (it checks _openDropdown.for which we don't have access to).
        this.$element.on('click', '.dry-check-item-trigger', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const $trigger = $(e.currentTarget);
            const $arrow = $trigger.find('.expand-arrow');

            // Already-open: close instead of reopening.
            if ($arrow.hasClass('expanded')) {
                closeGlobalDropdown();
                return;
            }

            // Get the right sorted drop list for the current mode.
            let sortedDrops;
            if (store.state.gearsets?.comparisonMode) {
                sortedDrops = this._dryDropdownDropsForOpen || [];
            } else {
                const qo = window.combinedStatsSection?.cachedStats?.quality_outcome || 0;
                sortedDrops = this._drySortedDrops(
                    this._dryExpandDrops(this._dryValidDrops(this._getDropTableData()), qo)
                );
            }
            if (sortedDrops.length === 0) return;

            const itemsHtml = this._renderDryDropdownItems(sortedDrops);
            openDropdownUnder($trigger, itemsHtml, (selectedKey) => {
                this.dryCheck.selectedKey = selectedKey;
                // Persist to ui.dryCheck.itemByContext keyed by current
                // activity/recipe so the choice survives reloads + activity
                // switches.
                this._persistDrySelection(selectedKey);
                this.render();
            }, 'dry-check-item');
        });

        // Outside-click closes the dropdown. The popup is appended to
        // document.body (outside this.$element), so we attach to document.
        // Idempotent: namespaced + off+on so re-render's attachEvents()
        // doesn't accumulate listeners. Bails fast when no dry-check
        // dropdown is currently open (checked via the `.expanded` arrow
        // class on our trigger), so it costs ~one DOM query per click.
        $(document).off('mousedown.dryCheckOutside');
        $(document).on('mousedown.dryCheckOutside', (event) => {
            const $expanded = this.$element.find('.dry-check-item-trigger .expand-arrow.expanded');
            if ($expanded.length === 0) return;
            const $tgt = $(event.target);
            // Click inside the popup itself: leave it; the popup's own
            // click handler will dispatch selection / close.
            if ($tgt.closest('.target-dropdown.xy-floating').length > 0) return;
            // Click on our trigger: leave it; the trigger's click handler
            // toggles via the `.expanded` check above.
            if ($tgt.closest('.dry-check-item-trigger').length > 0) return;
            closeGlobalDropdown();
        });

        this.$element.on('blur', '.dry-check-steps', (e) => {
            // 0/empty -> null (follow main calculator's Steps); positive -> sticky override.
            const v = this.validateInteger(e.target.value);
            this.dryCheck.steps = v > 0 ? v : null;
            this.render();
        });
        this.$element.on('keypress', '.dry-check-steps', (e) => {
            if (e.which === 13) { e.target.blur(); }
        });

        this.$element.on('blur', '.dry-check-steps-comp', (e) => {
            const gs = parseInt($(e.target).data('gs'));
            const v = this.validateInteger(e.target.value);
            const overrideValue = v > 0 ? v : null;
            if (gs === 1) this.dryCheck.steps1 = overrideValue;
            else if (gs === 2) this.dryCheck.steps2 = overrideValue;
            this.render();
        });
        this.$element.on('keypress', '.dry-check-steps-comp', (e) => {
            if (e.which === 13) { e.target.blur(); }
        });

        // Total-crafts input (single mode): 0/empty -> follow derived; positive -> override.
        this.$element.on('blur', '.dry-check-crafts', (e) => {
            const v = this.validateInteger(e.target.value);
            this.dryCheck.crafts = v > 0 ? v : null;
            this.render();
        });
        this.$element.on('keypress', '.dry-check-crafts', (e) => {
            if (e.which === 13) { e.target.blur(); }
        });

        // Total-crafts inputs (comparison mode), per gearset.
        this.$element.on('blur', '.dry-check-crafts-comp', (e) => {
            const gs = parseInt($(e.target).data('gs'));
            const v = this.validateInteger(e.target.value);
            const overrideValue = v > 0 ? v : null;
            if (gs === 1) this.dryCheck.crafts1 = overrideValue;
            else if (gs === 2) this.dryCheck.crafts2 = overrideValue;
            this.render();
        });
        this.$element.on('keypress', '.dry-check-crafts-comp', (e) => {
            if (e.which === 13) { e.target.blur(); }
        });

        // Swap between Steps and Total-crafts basis (recipe mode). Persisted globally.
        this.$element.on('click', '.dry-check-craft-toggle', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._setDryUiFlag('craftsMode', !this._dryCraftsMode());
            this.render();
        });

        // "Include better qualities' odds" checkbox — exact vs cumulative tier odds.
        this.$element.on('change', '.dry-check-include-better', (e) => {
            this._setDryUiFlag('includeBetterQualities', !!e.target.checked);
            this.render();
        });

        // DRY CHECK screenshot download — capture just the .dry-check-section
        // box that contains the clicked button and trigger a PNG download.
        this.$element.on('click', '.dry-check-download', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._downloadDryCheckScreenshot(e.currentTarget);
        });
    }

    /**
     * Handle comparison input change — update the correct values object and recalculate
     */
    _handleCompInput(el) {
        const $el = $(el);
        const gs = parseInt($el.data('gs'));
        const field = $el.data('field');
        const skill = $el.data('skill') || null;
        const vals = gs === 1 ? this.values : this.values2;

        const isInt = ['steps', 'startXP', 'gainedXP', 'targetXP', 'startLevel', 'endLevel'].includes(field);
        const value = isInt ? this.validateInteger(el.value) : this.validateDecimal(el.value);

        if (skill) {
            if (!vals.skills[skill]) return;
            vals.skills[skill][field] = value;
            this._recalcSkillField(vals, skill, field, gs);
        } else {
            vals[field] = value;
            this._recalcMainField(vals, field, gs);
        }
        this.render();
    }

    /**
     * Recalculate main fields using the same formulas as the single-view calculator.
     *
     * The user-entered field is preserved exactly; the other three fields
     * are decimal estimates derived directly from it (no integer round-trip
     * through actions). See calculateFromMaterials() for the rationale —
     * fixes bug report 0b270ce0 (entering '1' material flipped to '2').
     */
    _recalcMainField(vals, changedField, gsNum) {
        const stats = this._getComparisonStats(gsNum);
        if (!stats) return;
        const dr = stats.dr || 0;

        if (changedField === 'steps') {
            if (this.mode === 'recipe') {
                const spc = stats.stepsPerCraft || 1;
                const crafts = spc > 0 ? vals.steps / spc : 0;
                vals.crafts = this.validateDecimal(crafts);
                vals.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
                vals.actions = this.validateDecimal(crafts / (1 + dr));
            } else {
                const spa = stats.stepsPerAction || 1;
                vals.actions = this.validateDecimal(spa > 0 ? vals.steps / spa : 0);
            }
        } else if (changedField === 'actions') {
            vals.steps = Math.round(vals.actions * stats.stepsPerAction);
            if (this.mode === 'recipe') {
                const crafts = vals.actions * (1 + dr);
                vals.crafts = this.validateDecimal(crafts);
                vals.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
            }
        } else if (changedField === 'materials' && this.mode === 'recipe') {
            const mpc = stats.materialsPerCraft || 1.0;
            const crafts = mpc > 0 ? vals.materials / mpc : 0;
            vals.crafts = this.validateDecimal(crafts);
            vals.actions = this.validateDecimal(crafts / (1 + dr));
            vals.steps = Math.round(crafts * stats.stepsPerCraft);
        } else if (changedField === 'crafts' && this.mode === 'recipe') {
            vals.materials = this.validateDecimal(vals.crafts * stats.materialsPerCraft);
            vals.actions = this.validateDecimal(vals.crafts / (1 + dr));
            vals.steps = Math.round(vals.crafts * stats.stepsPerCraft);
        }

        // Recalculate XP for all skills
        this._recalcXPFromActions(vals, stats);
    }

    /**
     * Recalculate skill fields for a given values object
     */
    _recalcSkillField(vals, skill, changedField, gsNum) {
        const sd = vals.skills[skill];
        if (!sd) return;

        if (changedField === 'startXP') {
            sd.startLevel = this.xpToLevel(sd.startXP);
            sd.targetXP = sd.startXP + sd.gainedXP;
            sd.endLevel = this.xpToLevel(sd.targetXP);
        } else if (changedField === 'gainedXP') {
            sd.targetXP = sd.startXP + sd.gainedXP;
            sd.endLevel = this.xpToLevel(sd.targetXP);
            this._recalcMainFromGainedXP(vals, skill, gsNum);
        } else if (changedField === 'targetXP') {
            sd.gainedXP = Math.max(0, sd.targetXP - sd.startXP);
            sd.endLevel = this.xpToLevel(sd.targetXP);
            this._recalcMainFromGainedXP(vals, skill, gsNum);
        } else if (changedField === 'startLevel') {
            sd.startXP = this.levelToXP(sd.startLevel);
            sd.targetXP = sd.startXP + sd.gainedXP;
            sd.endLevel = this.xpToLevel(sd.targetXP);
        } else if (changedField === 'endLevel') {
            sd.targetXP = this.levelToXP(sd.endLevel);
            sd.gainedXP = Math.max(0, sd.targetXP - sd.startXP);
            this._recalcMainFromGainedXP(vals, skill, gsNum);
        }
    }

    /**
     * Recalculate XP from actions for all skills
     */
    _recalcXPFromActions(vals, stats) {
        for (const [skill, sd] of Object.entries(vals.skills)) {
            let gainedXP;
            if (this.mode === 'recipe') {
                // Recipe XP is gear-specific (bonus XP %, fine materials) and
                // is earned per paid action. Use THIS column's per-gearset
                // xpPerAction (from _getComparisonStats), not the single
                // equipped-gear rate — otherwise a slower gearset's larger
                // step count inflated its GAINED XP (bug 28fb3e5b). This is
                // equivalent to (this column's steps × this column's xp/step).
                const xpPerAction = stats.xpPerAction || 0;
                gainedXP = this.validateInteger(vals.actions * xpPerAction);
            } else {
                const skillXpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[skill])
                    ? stats.xpPerActionBySkill[skill]
                    : stats.xpPerAction;
                gainedXP = this.validateInteger(vals.actions * skillXpPerAction);
            }
            sd.gainedXP = gainedXP;
            sd.targetXP = sd.startXP + gainedXP;
            sd.endLevel = this.xpToLevel(sd.targetXP);
        }
    }

    /**
     * Recalculate main fields from gained XP
     */
    _recalcMainFromGainedXP(vals, skill, gsNum) {
        const sd = vals.skills[skill];
        if (!sd) return;
        const stats = this._getComparisonStats(gsNum);
        if (!stats) return;

        if (this.mode === 'recipe') {
            // Inverse of _recalcXPFromActions: derive actions/steps/crafts/
            // materials from this column's per-gearset xpPerAction so the
            // round-trip stays self-consistent (bug 28fb3e5b). Mirrors the
            // 'actions' path in _recalcMainField.
            const xpPerAction = stats.xpPerAction || 0;
            if (xpPerAction > 0) {
                vals.actions = Math.ceil(sd.gainedXP / xpPerAction);
                vals.steps = Math.round(vals.actions * stats.stepsPerAction);
                const crafts = vals.actions * (1 + (stats.dr || 0));
                vals.crafts = this.validateDecimal(crafts);
                vals.materials = this.validateDecimal(crafts * stats.materialsPerCraft);
            }
        } else {
            const xpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[skill])
                ? stats.xpPerActionBySkill[skill]
                : (stats.xpPerAction || 0);
            if (xpPerAction > 0) {
                vals.actions = Math.ceil(sd.gainedXP / xpPerAction);
                vals.steps = Math.round(vals.actions * stats.stepsPerAction);
                // Propagate to other skills
                for (const [otherSkill, otherData] of Object.entries(vals.skills)) {
                    if (otherSkill === skill) continue;
                    const otherXpPerAction = (stats.xpPerActionBySkill && stats.xpPerActionBySkill[otherSkill])
                        ? stats.xpPerActionBySkill[otherSkill]
                        : stats.xpPerAction;
                    otherData.gainedXP = Math.round(vals.actions * otherXpPerAction);
                    otherData.targetXP = otherData.startXP + otherData.gainedXP;
                    otherData.endLevel = this.xpToLevel(otherData.targetXP);
                }
            }
        }
    }
}

export default CalculatorSection;
