/**
 * Requirements display utility.
 * Formats item requirements as human-readable text with met/unmet status.
 */

import store from '../state.js';

/**
 * Format a single requirement into display text with met/unmet status.
 * @param {Object} req - Requirement object from item data
 * @returns {{ text: string, met: boolean }} Display text and whether requirement is met
 */
export function formatRequirement(req) {
    const character = store.state.character || {};
    const baseSkills = character.skills || {};
    const overrides = store.state.ui?.user_overrides || {};
    const overrideSkills = overrides.skills || {};
    // Merge: overrides take priority over base character skills
    const skills = { ...baseSkills, ...overrideSkills };
    const reputation = character.reputation || {};
    const ap = character.achievement_points || 0;
    const charLevel = (typeof window.calculateCharacterLevel === 'function')
        ? window.calculateCharacterLevel(character)
        : (character.level || 1);

    switch (req.type) {
        case 'skill': {
            const skillRaw = req.skill || 'Unknown';
            const skillName = skillRaw.charAt(0).toUpperCase() + skillRaw.slice(1).toLowerCase();
            const required = req.level || 1;
            const current = skills[skillName.toLowerCase()] || skills[skillName] || 0;
            const met = current >= required;
            const display = Math.min(current, required);
            return { text: `${skillName} ${display}/${required}`, met };
        }
        case 'achievement_points': {
            const required = req.amount || 0;
            const met = ap >= required;
            const display = Math.min(ap, required);
            return { text: `AP ${display}/${required}`, met };
        }
        case 'reputation': {
            const faction = req.faction || 'Unknown';
            const required = req.amount || 0;
            const current = reputation[faction.toLowerCase()] || reputation[faction] || 0;
            const met = current >= required;
            const display = Math.min(current, required);
            const factionName = faction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return { text: `${factionName} faction reputation ${display}/${required}`, met };
        }
        case 'character_level': {
            const required = req.level || 1;
            const met = charLevel >= required;
            const display = Math.min(charLevel, required);
            return { text: `Character level ${display}/${required}`, met };
        }
        case 'activity_completion': {
            const activity = (req.activity || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const activityKey = (req.activity || 'unknown').toLowerCase().replace(/ /g, '_');
            const required = req.completions || 1;
            // Check custom stats for activity completion
            const customStats = store.state.ui?.custom_stats || {};
            const overrides = store.state.ui?.user_overrides || {};
            const allCustomStats = { ...customStats, ...(overrides.custom_stats || {}) };
            // Try multiple key patterns: direct key, screwdriver_ prefix
            const met = allCustomStats[activityKey] === true
                || allCustomStats[`screwdriver_${activityKey}`] === true;
            return { text: `${activity} ×${required}`, met };
        }
        case 'category_level_percent': {
            const category = (req.category || 'unknown').replace(/\b\w/g, c => c.toUpperCase());
            const percent = req.percent || 0;
            // Dynamically build skill list from the skills API data if available
            const categorySkills = {
                'gathering': ['fishing', 'foraging', 'hunting', 'mining', 'woodcutting'],
                'artisan': ['carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'],
                'utility': ['agility'],
            };
            const skillList = categorySkills[category.toLowerCase()] || [];
            const maxLevelPerSkill = 99;
            const maxTotal = skillList.length * maxLevelPerSkill;
            const totalLevels = skillList.reduce((sum, s) => sum + (skills[s] || 0), 0);
            const requiredTotal = Math.ceil(maxTotal * (percent / 100));
            const met = totalLevels >= requiredTotal;
            const display = Math.min(totalLevels, requiredTotal);
            return { text: `${percent}% max ${category} level ${display}/${requiredTotal}`, met };
        }
        default:
            return { text: JSON.stringify(req), met: false };
    }
}

/**
 * Render requirements as HTML spans with met/unmet styling.
 * Requirements gated by custom stats (activity_completion, access) get a
 * clickable class that opens the Custom Stats popup when clicked.
 * @param {Array} requirements - Array of requirement objects
 * @returns {string} HTML string with requirement badges
 */
export function renderRequirements(requirements) {
    if (!requirements || requirements.length === 0) return '';
    return requirements.map(req => {
        const { text, met } = formatRequirement(req);
        const cls = met ? 'req-met' : 'req-unmet';
        // Custom-stat-gated requirements are clickable when unmet
        const isCustomStat = !met && (req.type === 'activity_completion' || req.type === 'access');
        const clickCls = isCustomStat ? ' req-clickable' : '';
        const clickAttr = isCustomStat ? ' data-open-custom-stats="true" title="Click to open Custom Stats"' : '';
        return `<span class="item-requirement ${cls}${clickCls}"${clickAttr}>${text}</span>`;
    }).join('');
}

/**
 * Render a requirements row (label + badges) for use in item displays.
 * @param {Array} requirements - Array of requirement objects
 * @returns {string} HTML string with full requirements row, or empty string if none
 */
export function renderRequirementsRow(requirements) {
    if (!requirements || requirements.length === 0) return '';
    return `<div class="item-requirements-row">${renderRequirements(requirements)}</div>`;
}
