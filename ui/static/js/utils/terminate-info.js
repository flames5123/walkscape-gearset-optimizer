/**
 * Termite "Terminate" ability — shared display helpers.
 *
 * Terminate has a 15% chance to turn a non-Fine log you find while Woodcutting
 * into Carpentry experience instead. The per-log XP values come from the
 * WalkScape wiki (each log's Carpentry conversion XP). Only non-Fine materials
 * are converted. This data is static, so it lives here as the single source of
 * truth for every surface that renders the ability (owned-item Abilities card
 * and the shared ability (i) popover).
 */

// Fallback log→Carpentry-XP table, used only if the backend omits the
// data-driven table (ability.item_swap.conversion_table, derived from the
// materials catalog). The live values come from the backend; this static copy
// just keeps the popover populated offline / pre-catalog-load.
// [display name, Carpentry XP granted when that log is converted]
export const TERMINATE_LOG_XP = [
    ['Birch logs', 14],
    ['Pine logs', 19.5],
    ['Spruce logs', 26.5],
    ['Oak logs', 32],
    ['Maple logs', 38.5],
    ['Willow logs', 40.5],
    ['Teak logs', 45],
    ['Bamboo logs', 47.5],
    ['Coral', 56],
    ['Mangrove logs', 57],
    ['Ectoplasm logs', 58],
    ['Yew logs', 63],
    ['Mahogany logs', 73],
];

function cap(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Resolve the stat-line pieces from an ability's `item_swap` block.
 * @param {Object} itemSwap - ability.item_swap
 * @returns {{chance:number, toSkill:string, fromSkill:string}}
 */
export function terminateStat(itemSwap) {
    const sw = itemSwap || {};
    return {
        chance: sw.chance != null ? sw.chance : 15,
        toSkill: cap(sw.to_skill || 'carpentry'),
        fromSkill: cap(sw.skill || 'woodcutting'),
    };
}

/**
 * The bold stat line shown for the Terminate ability, e.g.
 * "+15% Log you find turns into Carpentry experience While doing Woodcutting."
 * @param {Object} itemSwap - ability.item_swap
 * @returns {string} HTML
 */
export function terminateStatLineHtml(itemSwap) {
    const { chance, toSkill, fromSkill } = terminateStat(itemSwap);
    return `<strong>+${chance}% Log you find turns into ${toSkill} experience</strong> `
        + `While doing ${fromSkill}.`;
}

/**
 * The (i) popover body: a per-log Carpentry-XP table plus the Fine-material
 * note. Uses inline styles so it needs no extra stylesheet rules and renders
 * consistently inside info-popover / ability-popover surfaces.
 *
 * @param {Array} [table] - data-driven rows from the backend
 *   (ability.item_swap.conversion_table): either [{name,xp}, …] or [[name,xp], …].
 *   Falls back to the static TERMINATE_LOG_XP list when absent.
 * @returns {string} HTML
 */
export function buildTerminateTableHtml(table) {
    const list = (Array.isArray(table) && table.length)
        ? table.map(r => Array.isArray(r) ? r : [r.name, r.xp])
        : TERMINATE_LOG_XP;
    const rows = list.map(([name, xp]) =>
        `<div style="display:flex;justify-content:space-between;gap:18px;padding:1px 0">`
        + `<span>${name}</span><span style="font-weight:600">${xp} XP</span></div>`
    ).join('');
    return `<div class="info-popover-title">Carpentry XP per converted log</div>`
        + `<div style="margin-top:4px">${rows}</div>`
        + `<div style="margin-top:6px;opacity:0.7;font-size:0.9em">`
        + `Only non-Fine materials are converted.</div>`;
}
