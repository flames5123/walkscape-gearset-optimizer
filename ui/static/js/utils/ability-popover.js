// Shared pet-ability info popover builder.
//
// Single source of truth for the ability (i) popover markup so every surface
// (column-2 gear grid, crafting-tree node preview, …) renders the IDENTICAL
// format: icon + name header, duration, per-skill condition lines, colored
// stat rows with icons, fine-recipe-outcome, requirements, and the charge /
// "Charges: N" footer. Extracted verbatim from gear-slot-grid so the two can
// never drift. Pure function — no `this`, reads only the global
// window.itemFindingCategories cache.
import { terminateStat, buildTerminateTableHtml } from './terminate-info.js';
import { formatInt } from './number-format.js';

export function buildAbilityPopoverHtml(ability) {
    if (!ability) return '';
    // Stat icon map (same as combined-stats-section.js getStatIconPath)
    const iconMap = {
        'work_efficiency': 'work_efficiency',
        'double_action': 'double_action',
        'double_rewards': 'double_rewards',
        'steps_add': 'steps_required',
        'steps_required': 'steps_required',
        'flat_steps': 'steps_required',
        'steps_pct': 'steps_required',
        'steps_percent': 'steps_required',
        'no_materials_consumed': 'no_materials_consumed',
        'quality_outcome': 'quality_outcome',
        'bonus_xp': 'bonus_experience',
        'bonus_xp_percent': 'bonus_experience',
        'bonus_experience': 'bonus_experience',
        'chest_finding': 'chest_finding',
        'item_finding': 'item_finding',
        'fine_material_finding': 'fine_material_finding',
        'find_collectibles': 'find_collectibles',
        'inventory_space': 'inventory_space',
    };

    // Percentage stats (show %)
    const percentageStats = [
        'work_efficiency', 'double_action', 'double_rewards',
        'no_materials_consumed', 'bonus_xp', 'bonus_xp_percent',
        'chest_finding', 'item_finding', 'fine_material_finding',
        'find_collectibles',
    ];

    // Format stat name (same as combined-stats-section.js formatStatName)
    const formatName = (stat) => stat.split('_').map(w => {
        if (w === 'xp') return 'XP';
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');

    // Format skill label — groups read "Artisan skills" / "Smelting recipes"
    // to match the drop-popover wording ("While doing Artisan skills").
    const SKILL_GROUP_LABELS = {
        artisan: 'Artisan skills',
        gathering: 'Gathering skills',
        utility: 'Utility skills',
        smelting: 'Smelting recipes',
    };
    const formatSkill = (skill) => {
        if (skill === 'global') return '';
        return SKILL_GROUP_LABELS[skill] || (skill.charAt(0).toUpperCase() + skill.slice(1));
    };

    const _abIcon = ability.icon
        ? `<img src="/assets/icons/abilities/${ability.icon}.svg" width="32" height="32" style="vertical-align:middle;margin-right:6px" alt="" onerror="this.style.display='none'">`
        : '';
    let html = `<div class="info-popover-title">${_abIcon}${ability.name}</div>`;

    if (ability.duration) {
        html += `<div class="pet-popover-duration">Lasts ${formatInt(ability.duration)} ${ability.duration_unit || 'actions'}</div>`;
    }

    // Terminate (Termite): no ability_stats — render the item-swap stat line
    // plus the per-log Carpentry-XP table inline (this popover IS the info
    // surface, so no nested (i) is needed here).
    if (ability.item_swap) {
        const { chance, toSkill, fromSkill } = terminateStat(ability.item_swap);
        html += `<div class="pet-popover-stats">`;
        html += `<div class="pet-popover-condition">While doing ${fromSkill}</div>`;
        html += `<div class="pet-popover-stat-row"><span class="stat-positive">+${chance}%</span>`
            + `<span>Log you find turns into ${toSkill} experience</span></div>`;
        html += `</div>`;
        html += buildTerminateTableHtml(ability.item_swap.conversion_table);
    }

    const _dispStats = ability.ability_stats || ability.passive_stats;
    if (_dispStats) {
        html += `<div class="pet-popover-stats">`;
        for (const [skill, locations] of Object.entries(_dispStats)) {
            for (const [location, stats] of Object.entries(locations)) {
                // Skill/location condition line
                const skillName = formatSkill(skill);
                const locName = location === 'global' ? '' : location;
                let conditionText = '';
                if (skillName) conditionText += `While doing ${skillName}`;
                if (locName) conditionText += `${conditionText ? ' ' : 'While '}in ${locName}`;
                if (conditionText) {
                    html += `<div class="pet-popover-condition">${conditionText}</div>`;
                }

                for (const [stat, value] of Object.entries(stats)) {
                    // ItemFindingCategory stats (e.g. Pet Rock's Rockslide ->
                    // RANDOM_GEM) use the shared category cache, so this
                    // popover reads "Chance to find 1 Rough gem" with the
                    // matching find_ icon — not the raw enum / a broken icon.
                    if (stat.startsWith('ItemFindingCategory.')) {
                        const cc = stat.split('.')[1] || '';
                        const cat = window.itemFindingCategories && window.itemFindingCategories[cc];
                        let name, iconFile = `find_${cc.toLowerCase()}`;
                        if (cat) {
                            const qty = cat.min_qty === cat.max_qty ? cat.min_qty : `${cat.min_qty} to ${cat.max_qty}`;
                            name = `Chance to find ${qty} ${cat.display_name_singular}`;
                            if (cat.icon_name) iconFile = cat.icon_name;
                        } else {
                            name = `Chance to find ${cc.split('_').join(' ').toLowerCase()}`;
                        }
                        const sign = value > 0 ? '+' : '';
                        html += `
                            <div class="pet-popover-stat-row">
                                <span class="stat-positive">${sign}${value}%</span>
                                <img src="/assets/icons/attributes/${iconFile}.svg" class="pet-popover-stat-icon" alt="${name}" onerror="this.style.display='none'">
                                <span>${name}</span>
                            </div>
                        `;
                        continue;
                    }
                    const iconFile = iconMap[stat] || stat;
                    const iconPath = `/assets/icons/attributes/${iconFile}.svg`;
                    const name = (stat === 'steps_percent' || stat === 'steps_pct') ? 'Steps' : formatName(stat);
                    const isPercent = percentageStats.includes(stat);
                    const sign = value > 0 ? '+' : '';
                    const suffix = isPercent ? '%' : '';
                    // Steps stats: negative = good (green), positive = bad (red)
                    // Everything else: positive = good (green), negative = bad (red)
                    const isStepsStat = stat.includes('steps');
                    const isGood = isStepsStat ? value < 0 : value > 0;
                    const colorClass = isGood ? 'stat-positive' : 'stat-negative';

                    html += `
                        <div class="pet-popover-stat-row">
                            <span class="${colorClass}">${sign}${value}${suffix}</span>
                            <img src="${iconPath}" class="pet-popover-stat-icon" alt="${name}">
                            <span>${name}</span>
                        </div>
                    `;
                }
            }
        }
        html += `</div>`;
    }

    // Passive stat buff carried as a plain field rather than ability_stats
    // (so the ability does not register as an "ability-stats" optimizer pet).
    // Living Flame's Flambé: "+3% Fine recipe outcome While doing Cooking".
    if (ability.fine_recipe_outcome) {
        const v = ability.fine_recipe_outcome;
        html += `<div class="pet-popover-stats">`;
        html += `<div class="pet-popover-condition">While doing Cooking</div>`;
        html += `
            <div class="pet-popover-stat-row">
                <span class="stat-positive">+${v}%</span>
                <img src="/assets/icons/attributes/fine_recipe_outcome.svg" class="pet-popover-stat-icon" alt="Fine recipe outcome" onerror="this.style.display='none'">
                <span>Fine recipe outcome</span>
            </div>`;
        html += `</div>`;
    }

    // Ability usage requirements (e.g. Flambé: "While doing a Cooking
    // recipe. Not in an Underwater location.").
    if (ability.requirements && typeof ability.requirements === 'string') {
        html += `<div class="pet-popover-requirements">Requirements: ${ability.requirements}</div>`;
    }

    // Add input requirements (items needed to charge the ability)
    if (ability.cooldown && ability.cooldown.includes('charged by using items')) {
        const cooldown = ability.cooldown;
        const chargeMatch = cooldown.match(/requires.*?(\d+)/);
        const chargeNeeded = chargeMatch ? chargeMatch[1] : '?';
        const items = [];
        const itemRegex = /(\d+)\s+gained from\s+([A-Z][a-z][\w\s]*?)(?=\s+\d+\s+gained|\s*$)/g;
        let m;
        while ((m = itemRegex.exec(cooldown)) !== null) {
            items.push({ qty: m[1], name: m[2].trim() });
        }
        const drIcon = '/assets/icons/attributes/double_rewards.svg';
        html += `<div class="pet-popover-inputs">`;
        html += `<div class="pet-popover-inputs-header">Charged by items. One full charge requires <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge"> <strong>${chargeNeeded}</strong></div>`;
        for (const item of items) {
            const iconName = item.name.toLowerCase().replace(/ /g, '_');
            html += `
                <div class="pet-popover-input-row">
                    <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge">
                    <strong>${item.qty}</strong> gained from
                    <img src="/assets/icons/items/materials/${iconName}.svg" class="pet-popover-stat-icon" alt="${item.name}"
                         onerror="this.src='/assets/icons/items/consumables/${iconName}.svg'; this.onerror=null;">
                    ${item.name}
                </div>
            `;
        }
        html += `</div>`;
    } else if (ability.cooldown && ability.cooldown.includes('charged by spending coins')) {
        // Coin-charged abilities (e.g. Golden Frog's Lucky Day) render
        // identically to item-charged ones (Tiger): header + per-input rows.
        const cooldown = ability.cooldown;
        const chargeMatch = cooldown.match(/requires.*?(\d+)/);
        const chargeNeeded = chargeMatch ? chargeMatch[1] : '?';
        const coinInputs = [];
        const coinRegex = /(\d+)\s+gained from\s+([\d,]+\s+coins)/gi;
        let m;
        while ((m = coinRegex.exec(cooldown)) !== null) {
            coinInputs.push({ qty: m[1], src: m[2] });
        }
        const drIcon = '/assets/icons/attributes/double_rewards.svg';
        const coinIcon = '/assets/icons/items/coins.svg';
        html += `<div class="pet-popover-inputs">`;
        html += `<div class="pet-popover-inputs-header">Charged by coins. One full charge requires <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge"> <strong>${chargeNeeded}</strong></div>`;
        for (const ci of coinInputs) {
            html += `
                <div class="pet-popover-input-row">
                    <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge">
                    <strong>${ci.qty}</strong> gained from
                    <img src="${coinIcon}" class="pet-popover-stat-icon" alt="coins" onerror="this.style.display='none'">
                    ${ci.src}
                </div>
            `;
        }
        html += `</div>`;
    } else if (ability.charges && !ability.passive) {
        html += `<div class="pet-popover-inputs">`;
        html += `<div class="pet-popover-inputs-header">Charges: ${formatInt(ability.charges)}</div>`;
        html += `</div>`;
    }

    return html;
}
