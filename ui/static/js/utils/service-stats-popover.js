/**
 * Shared service-stats popover renderer.
 *
 * This is the SAME renderer column 3's recipe service bubbles use
 * (recipe-info-section.js `_buildServiceStatsPopoverHtml` + helpers), lifted
 * verbatim into a standalone module so the stats-report page can render an
 * identical (i) popover for a recipe row's service (primary + alternative
 * service locations). Keeping the logic identical is intentional: the
 * stats-report (i) must match column 3's formatting exactly (stat icons via
 * the shared .stat-row / .stat-value-* / .stat-name / .stat-condition /
 * .stat-gate CSS), including reputation- and skill-gated tiers dimmed when
 * unmet.
 *
 * Consumes a service object shaped like the /api/services payload:
 *   { stats: {skill:{location:{stat:value}}}, gated_stats: {reputation:{...},
 *     skill_level:{...}} }
 * (the worker emits `service._stats` for `stats`, which is the same nested
 * shape column 3 receives from /api/services).
 *
 * Player reputation / skill levels for gating are read from the shared store
 * (user_overrides win, then character), same as column 3.
 */
import store from '../state.js';

/** Does this service carry any direct or gated stats worth an (i)? */
export function serviceHasStats(service) {
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
function formatFactionName(factionId) {
    return String(factionId || '')
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/** Get the player's reputation for a faction (user override wins). */
function getPlayerReputation(factionId) {
    const overrides = store.state.ui?.user_overrides || {};
    if (overrides.reputation && overrides.reputation[factionId] !== undefined) {
        return overrides.reputation[factionId];
    }
    return store.state.character?.reputation?.[factionId] || 0;
}

/** Format a stat name (snake_case -> "Snake Case", XP uppercase). */
function formatStatName(statName) {
    return String(statName || '')
        .split('_')
        .map(w => w.toLowerCase() === 'xp' ? 'XP' : (w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
}

/** Format a stat value (+5% / -10% / +2 for flat stats) with color class. */
function formatStatValue(statName, value) {
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
 */
function formatCondition(skill, location, recipeSkill, serviceLocation) {
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

    const skillPart = (s && s !== 'global' && s !== recipeS) ? cap(s) : null;
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
 */
function renderServiceStatBlock(statsObj, requirement = null, isMet = true, recipeSkill = null, serviceLocation = null) {
    if (!statsObj || Object.keys(statsObj).length === 0) return '';
    const rows = [];
    for (const [skill, locationStats] of Object.entries(statsObj)) {
        if (!locationStats || typeof locationStats !== 'object') continue;
        for (const [location, statsByLocation] of Object.entries(locationStats)) {
            if (!statsByLocation || typeof statsByLocation !== 'object') continue;
            for (const [statName, statValue] of Object.entries(statsByLocation)) {
                if (!statName || statName === 'undefined') continue;
                const valueHtml = formatStatValue(statName, statValue);
                const nameHtml = formatStatName(statName);
                const condition = formatCondition(skill, location, recipeSkill, serviceLocation);
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
 * Build the popover HTML body for a service's (i) icon:
 *   - direct stats first (always applied)
 *   - reputation tiers next (dimmed when the player hasn't reached the threshold)
 *   - skill-level tiers (edge-case for a few advanced services)
 *
 * @param {Object} service - service object with stats/gated_stats
 * @param {Object} [opts]
 * @param {string} [opts.recipeSkill] - recipe's skill, for condition suppression
 * @param {string} [opts.contextLocation] - location id the popover is shown for;
 *        stats whose location matches are treated as "global" for label purposes.
 * @returns {string} popover inner HTML (empty string when the service has no stats)
 */
export function buildServiceStatsPopoverHtml(service, opts = {}) {
    if (!service) return '';
    const parts = [];
    const recipeSkill = (opts.recipeSkill || '').toLowerCase();
    const ctxLoc = (opts.contextLocation || '').toLowerCase();

    const directHtml = renderServiceStatBlock(service.stats || {}, null, true, recipeSkill, ctxLoc);
    if (directHtml) parts.push(directHtml);

    const repGated = service.gated_stats?.reputation || {};
    for (const [faction, tiers] of Object.entries(repGated)) {
        if (!tiers || typeof tiers !== 'object') continue;
        const factionName = formatFactionName(faction);
        const playerRep = getPlayerReputation(faction);
        const thresholds = Object.keys(tiers)
            .map(k => [k, parseInt(k, 10)])
            .sort((a, b) => a[1] - b[1]);
        for (const [key, threshold] of thresholds) {
            const tieredStats = tiers[key];
            if (!tieredStats || typeof tieredStats !== 'object') continue;
            const requirement = `${factionName} reputation ${threshold}`;
            const isMet = playerRep >= threshold;
            const blockHtml = renderServiceStatBlock(tieredStats, requirement, isMet, recipeSkill, ctxLoc);
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
            const blockHtml = renderServiceStatBlock(levelStats, requirement, isMet, recipeSkill, ctxLoc);
            if (blockHtml) parts.push(blockHtml);
        }
    }

    return parts.join('');
}
