/**
 * Shared ability-detail lines rendered by every pet-ability display
 * (owned-item Abilities section, gear-slot popover, item-selection popups,
 * optimize-button instant-actions tooltip).
 *
 * These three fields are NOT part of the rich `ability_stats` block, so the
 * stat-row renderers skip them. Flambé (Living Flame) in particular carries
 * `fine_recipe_outcome` as a plain field (kept out of ability_stats so it does
 * not hijack get_ability_stats_pet). Render them as simple meta lines so the
 * effect-duration, +fine-recipe-outcome, and usage-requirements show up
 * consistently across all ability displays.
 *
 * @param {Object} ability  ability (or petInfo) dict
 * @param {string} metaClass CSS class each line should use (varies per view)
 * @returns {string} HTML (possibly empty)
 */
export function abilityExtraLines(ability, metaClass = 'pet-ability-meta') {
    if (!ability) return '';
    let html = '';
    if (ability.duration) {
        const unit = ability.duration_unit || 'actions';
        html += `<div class="${metaClass}">Effect lasts for: ${ability.duration} ${unit}</div>`;
    }
    if (ability.fine_recipe_outcome) {
        html += `<div class="${metaClass}">+${ability.fine_recipe_outcome}% Fine recipe outcome (While doing Cooking)</div>`;
    }
    if (ability.requirements && typeof ability.requirements === 'string') {
        html += `<div class="${metaClass}">Requirements: ${ability.requirements}</div>`;
    }
    return html;
}
