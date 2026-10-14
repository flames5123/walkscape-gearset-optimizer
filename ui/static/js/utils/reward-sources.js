/**
 * Shared renderer for achievement / AP-track / faction-reputation reward
 * sources, used by every "sources" surface (item popup, owned col-1 rows,
 * col-2 comparison + non-owned upgrades, slot-popup alts, crafting-tree
 * upgrades, col-3 materials).
 *
 * The backend (/api/item-sources via util/reward_sources.py) adds three source
 * types — achievement_reward / ap_reward / faction_reward — for reward items
 * that have no drop/recipe/shop source. This module turns those into the same
 * .source-item / .source-group-header markup the other groups use, so each
 * surface's existing CSS + click delegation apply unchanged.
 *
 * Only achievement rows are clickable: clicking one opens the Achievements
 * page to that difficulty and scrolls to (and briefly highlights) the
 * achievement. AP and faction rows are inert (.source-item-no-click) per spec.
 */

const DIFF_COLOR = { easy: '#8bd450', normal: '#5aa9e6', hard: '#e6c84f', extreme: '#e05aa9' };
const DIFF_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' };

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Build HTML for the achievement / AP / faction reward groups within a
 * `sources` array. Returns '' when none are present, so callers can append it
 * unconditionally. Does NOT include the wrapping `.source-dropdown-list`.
 *
 * @param {Array} sources - the raw item-sources array from /api/item-sources
 * @returns {string} HTML (possibly empty)
 */
export function rewardSourceGroupsHtml(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return '';

    const achievements = sources.filter(s => s.type === 'achievement_reward');
    const apRewards = sources.filter(s => s.type === 'ap_reward');
    const factionRewards = sources.filter(s => s.type === 'faction_reward');

    let html = '';

    if (achievements.length > 0) {
        html += '<div class="source-group-header">Achievement reward</div>';
        for (const src of achievements) {
            const diff = String(src.difficulty || 'normal').toLowerCase();
            const color = DIFF_COLOR[diff] || '#888';
            const label = DIFF_LABEL[diff] || (diff.charAt(0).toUpperCase() + diff.slice(1));
            const qty = (src.quantity && src.quantity > 1) ? `<span>${_esc(src.quantity)}x</span>` : '';
            const desc = src.description
                ? `<div class="source-item-details source-ach-desc"><span>${_esc(src.description)}</span></div>`
                : '';
            html += `
                <div class="source-item source-item-achievement" data-source-type="achievement_reward" data-source-id="${_esc(src.id)}" title="Open this achievement">
                    <div class="source-item-main">
                        <span class="source-name">${_esc(src.name)}</span>
                        <span class="source-badge source-badge-achievement source-badge-diff-${_esc(diff)}" style="background:${color}22;color:${color}">${_esc(label)}</span>
                    </div>
                    ${desc}
                    ${qty ? `<div class="source-item-details">${qty}</div>` : ''}
                </div>`;
        }
    }

    if (apRewards.length > 0) {
        html += '<div class="source-group-header">Achievement points</div>';
        for (const src of apRewards) {
            const pts = (src.points != null) ? `Reach ${_esc(src.points)} Achievement Points` : 'Achievement Points milestone';
            const qty = (src.quantity && src.quantity > 1) ? ` (${_esc(src.quantity)}x)` : '';
            html += `
                <div class="source-item source-item-no-click source-item-ap" title="Awarded from the Achievement Points reward track">
                    <div class="source-item-main">
                        <span class="source-name">${pts}${qty}</span>
                        <span class="source-badge source-badge-ap">AP</span>
                    </div>
                </div>`;
        }
    }

    if (factionRewards.length > 0) {
        html += '<div class="source-group-header">Faction reputation</div>';
        for (const src of factionRewards) {
            const rep = (src.reputation != null) ? `${_esc(src.reputation)} reputation` : 'reputation';
            const tier = src.tier_title ? ` — ${_esc(src.tier_title)}` : '';
            const qty = (src.quantity && src.quantity > 1) ? `<span>${_esc(src.quantity)}x</span>` : '';
            html += `
                <div class="source-item source-item-no-click source-item-faction" title="Awarded from a faction reputation reward tier">
                    <div class="source-item-main">
                        <span class="source-name">${_esc(src.faction)}${tier}</span>
                        <span class="source-badge source-badge-faction">${rep}</span>
                    </div>
                    ${qty ? `<div class="source-item-details">${qty}</div>` : ''}
                </div>`;
        }
    }

    return html;
}

/**
 * Navigate to the Achievements page and scroll to a specific achievement.
 * Safe no-op if the page/method isn't available. Callers should close their
 * own popover/popup first (routing also mutually-closes full-screen overlays).
 *
 * @param {string} achId - the achievement id (data-source-id on the row)
 */
export function openAchievementFromSource(achId) {
    if (!achId) return;
    const page = (typeof window !== 'undefined') ? window._achievementsPage : null;
    if (page && typeof page.openToAchievement === 'function') {
        page.openToAchievement(achId);
    }
}
