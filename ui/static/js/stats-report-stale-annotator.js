// stats-report-stale-annotator.js
//
// Annotates the stats report UI with red (!) badges for stale scopes and
// wires hover popovers showing what changed.
//
// Designed to run alongside the existing stats-report-page rendering — it
// queries DOM after render, doesn't replace any logic.
//
// See .kiro/specs/stats-report-stale-detection/ for design.

import { showInfoPopover, dismissPopover as dismissInfoPopover } from './info-popover.js';

// User-friendly labels for category/subcategory keys. Mirrors how the
// stats report page itself names each section so users see the same words.
const _CATEGORY_LABELS = {
    'xp': 'XP',
    'coins': 'Coins',
    'chests': 'Chest farming',
    'chests_recipes': 'Recipe chests',
    'new_items': 'New items',
};

const _NEW_ITEMS_KIND_LABELS = {
    'gear': 'Gear',
    'tools': 'Tools',
    'eggs': 'Pet eggs',
    'collectibles': 'Collectibles',
};

// Title-case a slug like 'red_coast' → 'Red Coast', 'agility_chest' → 'Agility chest'.
function _humanizeSlug(slug) {
    if (!slug) return '';
    return String(slug)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        // Lowercase common words after the first
        .replace(/\b(Chest|Recipe)\b/g, (m, _g, idx) => idx === 0 ? m : m.toLowerCase());
}

// Pretty section heading for one stale scope. Returns a short description
// like "Coins · Fishing" or "Chest farming · Agility chest".
function _humanizeScope(s) {
    const cat = _CATEGORY_LABELS[s.category] || s.category;
    let sub = '';
    if (s.category === 'chests' || s.category === 'chests_recipes') {
        sub = _humanizeSlug(s.subcategory);
    } else if (s.category === 'new_items') {
        sub = _NEW_ITEMS_KIND_LABELS[s.subcategory] || _humanizeSlug(s.subcategory);
    } else {
        // xp / coins use the (lowercased) skill name as subcategory —
        // title-case it for display ("mining" -> "Mining").
        sub = _humanizeSlug(s.subcategory);
    }
    return sub ? `${cat} · ${sub}` : cat;
}

function _humanizeScopeLine(s) {
    // 'global' is the craftable-anywhere sentinel for recipes (no real
    // location), so don't render a meaningless "in Global" suffix.
    const _loc = String(s.location || '').toLowerCase();
    const where = (s.location && _loc !== 'global') ? ` in ${_humanizeSlug(s.location)}` : '';
    return `${s.source_name}${where}`;
}

const ANNOTATOR_CLASS = 'stats-report-stale-annotator';
const BADGE_CLASS = 'stats-report-stale-badge';
const POPOVER_CLASS = 'stats-report-stale-popover';

let _lastStaleData = null;

/**
 * Fetch stale-check data and annotate the UI.
 *
 * Call this on page open and whenever 'stats-report-stale-refresh' event fires.
 */
export async function refreshStaleAnnotations() {
    try {
        const resp = await fetch('/api/stats-report/stale-check', {
            credentials: 'same-origin',
        });
        if (!resp.ok) return;
        const data = await resp.json();
        _lastStaleData = data;
        // Expose globally for other modules (Optimize button reads this to
        // decide whether to run in stale_only mode by default).
        if (typeof window !== 'undefined') {
            window._lastStaleStatsReportData = data;
        }
        _annotate(data);
    } catch (_) {}
}

function _annotate(data) {
    // Clear previous badges
    document.querySelectorAll('.' + BADGE_CLASS).forEach((el) => el.remove());

    if (!data || !data.any_stale) return;

    // Top-bar nav icon: add badge if any stale (no chip filter — shows all)
    const navIcon = document.querySelector(
        '#stats-report-nav-btn, [data-button="stats-report"], [data-nav="stats-report"], .stats-report-nav-btn'
    );
    if (navIcon) _addBadge(navIcon, {topbar: true});

    // WTO chips: existing render uses data-skill / data-chest with data-category
    // Subcategory normalization: skill names lowercased; chest names lowercased + spaces->underscores.
    const chips = data.stale_subcategory_chips || {};

    // For xp/coins: match data-skill chips
    for (const cat of ['xp', 'coins']) {
        for (const sub of (chips[cat] || [])) {
            const candidates = document.querySelectorAll(
                `[data-skill][data-category="${cat}"]`
            );
            for (const el of candidates) {
                const skill = (el.getAttribute('data-skill') || '').toLowerCase();
                if (skill === sub.toLowerCase()) {
                    _addBadge(el, {staleCat: cat, staleSub: sub});
                }
            }
        }
    }

    // For chests / chests_recipes: match data-chest chips
    for (const cat of ['chests', 'chests_recipes']) {
        for (const sub of (chips[cat] || [])) {
            // 2026-06-15 (jwbail): filter by data-category. The SAME chest
            // name (e.g. "Tailoring chest") renders as a chip in BOTH the
            // chests (activities) section AND the chests_recipes section.
            // Without the category filter this matched every [data-chest]
            // chip, so a stale chests_recipes chest also badged the
            // activities-section chip — and its popover then listed recipe
            // CRAFTS under "Chest farming for ACTIVITIES" (user-reported).
            const candidates = document.querySelectorAll(`[data-chest][data-category="${cat}"]`);
            for (const el of candidates) {
                const chest = (el.getAttribute('data-chest') || '').toLowerCase().replace(/\s+/g, '_');
                if (chest === sub.toLowerCase().replace(/\s+/g, '_')) {
                    _addBadge(el, {staleCat: cat, staleSub: sub});
                }
            }
        }
    }

    // 2026-05-26 (jwbail): For new_items, add a badge to EACH kind chip
    // (gear / tools / eggs / collectibles) when its specific subcategory
    // is stale. 2026-06-02: removed the category-level summary badge
    // per user direction — the section header doesn't need a (!) when
    // the sub-categories already carry per-kind badges.
    const newItemsSubs = chips['new_items'] || [];
    for (const sub of newItemsSubs) {
        const candidates = document.querySelectorAll(
            `[data-kind-name][data-category="new_items"]`
        );
        for (const el of candidates) {
            const kind = (el.getAttribute('data-kind-name') || '').toLowerCase();
            if (kind === sub.toLowerCase()) {
                _addBadge(el, {staleCat: 'new_items', staleSub: sub});
            }
        }
    }
}

function _addBadge(parent, options = {}) {
    if (!parent) return;
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS + (options.topbar ? ' topbar' : '');
    badge.textContent = '!';
    // 2026-05-26 (jwbail): bigger touch target for mobile (was 14x14, now
    // 22x22 with larger font). Mobile users couldn't reliably tap the
    // badge before. Topbar badge stays slightly smaller to fit within
    // the nav button without overflow.
    const sz = options.topbar ? 18 : 22;
    const fs = options.topbar ? 12 : 15;
    // 2026-06-02 (jwbail): topbar badge is purely visual — a status
    // indicator on the nav icon. Per-section badges are interactive
    // (hover + click for popover detail). Without pointer-events:none
    // on the topbar, hovering the badge would trigger a popover from
    // the wrong anchor (the badge itself), and on touch devices a tap
    // on the nav icon would land on the badge instead of opening the
    // goals report.
    if (options.topbar) {
        // 2026-06-02 (jwbail): no title tooltip on the topbar badge —
        // user feedback "I'm hovering to see the popup and the title
        // text 'stats report has stale scopes' overlays it". The
        // popup is the affordance; a redundant tooltip just gets in
        // the way.
        badge.style.cssText = `position:absolute;top:-2px;right:-2px;background:#d33;color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;font-size:${fs}px;line-height:${sz}px;text-align:center;font-weight:bold;z-index:1000;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,0.4);user-select:none`;
    } else {
        // 2026-06-02 (jwbail): same — drop the title tooltip on the
        // per-section badges. Hover/click both already show the popup
        // with full details; the title tooltip just stacks on top.
        badge.style.cssText = `position:absolute;top:-2px;right:-2px;background:#d33;color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;font-size:${fs}px;line-height:${sz}px;text-align:center;font-weight:bold;z-index:1000;pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.4);user-select:none`;
    }
    if (parent.style.position !== 'absolute' && parent.style.position !== 'fixed') {
        parent.style.position = parent.style.position || 'relative';
    }
    // 2026-05-26: store the chip's category/subcategory on the badge so
    // _showPopover can scope the displayed scopes to JUST that chip
    // (e.g. clicking the (!) on the Foraging XP chip should only list
    // Foraging XP scopes, not all stale scopes).
    if (options.staleCat) badge.dataset.staleCat = options.staleCat;
    if (options.staleSub) badge.dataset.staleSub = options.staleSub;
    if (options.topbar) badge.dataset.staleTopbar = '1';
    parent.appendChild(badge);

    // 2026-06-02 (jwbail): topbar is visual-only — no event handlers.
    // Stop here so the nav-icon click goes to the parent button.
    if (options.topbar) return;

    // 2026-06-02 (jwbail): mirror the (i) info-icon pattern from
    // info-popover.js wireInfoIcons — non-touch devices get hover-show
    // + mouseleave-dismiss + click-pin-toggle. Touch devices stay
    // click-only (mouseenter fires on touchstart, but mouseleave fires
    // the moment the finger lifts which previously dismissed the
    // popover instantly — pin via click avoids that).
    badge.addEventListener('mouseenter', () => {
        if (_isTouchDevice()) return;
        _showPopover(null, badge, options, /*pinned=*/false);
    });
    badge.addEventListener('mouseleave', () => {
        if (_isTouchDevice()) return;
        // Only auto-dismiss the unpinned popover anchored to this badge.
        // Pinned popovers (from a click) stick until clicked-out.
        try { dismissInfoPopover(); } catch (_) { /* no-op */ }
    });
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        _showPopover(e, badge, options, /*pinned=*/true);
    });
    // Keyboard: Enter/Space activate same as click for accessibility.
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            e.preventDefault();
            _showPopover(e, badge, options, /*pinned=*/true);
        }
    });
}

// Cheap touch-device detection used to gate hover behavior. Mirrors the
// equivalent helper in info-popover.js so the (!) and (i) anchors agree.
function _isTouchDevice() {
    return ('ontouchstart' in window)
        || (navigator.maxTouchPoints > 0)
        || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

let _popoverEl = null;

function _showPopover(e, badge, options, pinned = true) {
    if (!_lastStaleData) return;

    const allScopes = _lastStaleData.stale_scopes || [];

    // 2026-05-26 (jwbail): scope the popover to the chip's
    // category+subcategory if the badge has those data attrs set. Topbar
    // badge has neither and shows everything. Per-chip badges (xp,
    // coins, chests, chests_recipes, new_items kinds) filter to just
    // the matching scopes — no more global list when clicking a chip.
    const filterCat = badge.dataset.staleCat || null;
    const filterSub = badge.dataset.staleSub || null;
    const isTopbar = badge.dataset.staleTopbar === '1';

    const matches = (s) => {
        if (isTopbar || (!filterCat && !filterSub)) return true;
        if (filterCat && s.category !== filterCat) return false;
        if (filterSub) {
            const a = String(s.subcategory || '').toLowerCase().replace(/\s+/g, '_');
            const b = String(filterSub).toLowerCase().replace(/\s+/g, '_');
            if (a !== b) return false;
        }
        return true;
    };
    const scopes = allScopes.filter(matches);

    // Aggregate
    const newlyApplicable = new Map();  // id -> item
    const noLongerApplicable = new Map();
    const newlyUnlocked = [];
    const otherChanges = [];
    let versionBumped = false;

    for (const s of scopes) {
        if (s.reason === 'item_change') {
            for (const it of (s.added_items || [])) newlyApplicable.set(it.id, it);
            for (const it of (s.removed_items || [])) noLongerApplicable.set(it.id, it);
        } else if (s.reason === 'newly_unlocked') {
            newlyUnlocked.push(s);
        } else if (s.reason === 'input_change') {
            otherChanges.push(_humanizeScopeLine(s));
        } else if (s.reason === 'version_bump') {
            versionBumped = true;
        }
    }

    const html = [];

    // Title: scoped vs global
    const totalScopes = scopes.length;
    if (isTopbar) {
        html.push(`<div class="info-popover-title">${totalScopes} scope${totalScopes === 1 ? '' : 's'} need re-optimizing</div>`);
    } else {
        // Show the chip's friendly name in the title so the user knows
        // what they're looking at without us repeating it on every row.
        const fakeScope = {category: filterCat, subcategory: filterSub};
        const heading = filterSub ? _humanizeScope(fakeScope) : (_CATEGORY_LABELS[filterCat] || filterCat);
        html.push(`<div class="info-popover-title">${_escapeHtml(heading)}</div>`);
    }
    html.push('<div style="font-size:0.92em;line-height:1.4">');

    // 2026-06-16 (jwbail): "What changed" summary — global state deltas (pet
    // levels, custom-stat toggles, skill levels) that drove the staleness but
    // don't show as added/removed items. e.g. "Tiger: level 1 -> 3".
    const stateChanges = (_lastStaleData && _lastStaleData.state_changes) || [];
    if (stateChanges.length) {
        html.push('<div style="margin-top:2px"><strong>What changed</strong></div>');
        html.push('<ul style="margin:2px 0 0 16px;padding:0">');
        for (const ch of stateChanges.slice(0, 10)) {
            html.push(`<li>${_escapeHtml(ch)}</li>`);
        }
        if (stateChanges.length > 10) {
            html.push(`<li style="opacity:0.7">+${stateChanges.length - 10} more</li>`);
        }
        html.push('</ul>');
    }

    // Newly applicable items (from item_change). For new_items category
    // the item slug IS the unlocked item that became droppable.
    if (newlyApplicable.size) {
        const headerLabel = filterCat === 'new_items'
            ? 'New items unlocked'
            : 'New items in your gear pool';
        html.push(`<div style="margin-top:6px"><strong>${headerLabel}</strong></div>`);
        html.push('<ul style="margin:2px 0 0 16px;padding:0">');
        for (const it of [...newlyApplicable.values()].slice(0, 10)) {
            const q = it.quality && it.quality !== 'normal' ? ` (${_humanizeSlug(it.quality)})` : '';
            html.push(`<li>${_escapeHtml(_humanizeSlug(it.slug))}${_escapeHtml(q)}</li>`);
        }
        if (newlyApplicable.size > 10) {
            html.push(`<li style="opacity:0.7">+${newlyApplicable.size - 10} more</li>`);
        }
        html.push('</ul>');
    }

    if (noLongerApplicable.size) {
        html.push('<div style="margin-top:6px"><strong>Items removed</strong></div>');
        html.push('<ul style="margin:2px 0 0 16px;padding:0">');
        for (const it of [...noLongerApplicable.values()].slice(0, 10)) {
            const q = it.quality && it.quality !== 'normal' ? ` (${_humanizeSlug(it.quality)})` : '';
            html.push(`<li>${_escapeHtml(_humanizeSlug(it.slug))}${_escapeHtml(q)}</li>`);
        }
        if (noLongerApplicable.size > 10) {
            html.push(`<li style="opacity:0.7">+${noLongerApplicable.size - 10} more</li>`);
        }
        html.push('</ul>');
    }

    // Newly-unlocked activities. When scoped (per-chip), there's no need
    // to repeat the category/subcategory header on every group — the
    // popover title already says it. Just list activity@location lines.
    if (newlyUnlocked.length) {
        if (isTopbar) {
            // Global view: group by section header so the user can scan.
            const grouped = new Map();
            for (const s of newlyUnlocked) {
                const heading = _humanizeScope(s);
                if (!grouped.has(heading)) grouped.set(heading, []);
                grouped.get(heading).push(_humanizeScopeLine(s));
            }
            html.push('<div style="margin-top:6px"><strong>Newly unlocked activities</strong></div>');
            for (const [heading, lines] of grouped) {
                html.push(`<div style="margin-top:3px;font-size:0.9em;color:var(--text-muted,#aaa)">${_escapeHtml(heading)}</div>`);
                html.push('<ul style="margin:1px 0 0 16px;padding:0">');
                for (const line of lines.slice(0, 6)) {
                    html.push(`<li>${_escapeHtml(line)}</li>`);
                }
                if (lines.length > 6) {
                    html.push(`<li style="opacity:0.7">+${lines.length - 6} more</li>`);
                }
                html.push('</ul>');
            }
        } else {
            // Scoped view: flat list, no redundant header per group.
            const lines = newlyUnlocked.map(_humanizeScopeLine);
            const label = filterCat === 'new_items' ? 'Activities with new drops' : 'Newly unlocked activities';
            html.push(`<div style="margin-top:6px"><strong>${label}</strong></div>`);
            html.push('<ul style="margin:2px 0 0 16px;padding:0">');
            for (const line of lines.slice(0, 10)) {
                html.push(`<li>${_escapeHtml(line)}</li>`);
            }
            if (lines.length > 10) {
                html.push(`<li style="opacity:0.7">+${lines.length - 10} more</li>`);
            }
            html.push('</ul>');
        }
    }

    if (otherChanges.length) {
        html.push('<div style="margin-top:6px"><strong>Inputs changed</strong></div>');
        html.push('<ul style="margin:2px 0 0 16px;padding:0">');
        for (const t of otherChanges.slice(0, 8)) {
            html.push(`<li>${_escapeHtml(t)}</li>`);
        }
        html.push('</ul>');
    }

    if (versionBumped) {
        html.push('<div style="margin-top:6px;opacity:0.9">Optimizer was updated — re-run for fresh scores.</div>');
    }

    if (!newlyApplicable.size && !noLongerApplicable.size && !newlyUnlocked.length && !otherChanges.length && !versionBumped) {
        html.push('<div style="margin-top:6px;opacity:0.7">No detail available — try re-running the optimizer.</div>');
    }

    html.push('<div style="margin-top:8px;padding-top:6px;border-top:1px solid #444;font-size:0.85em;opacity:0.85">Click <strong>Optimize</strong> to refresh.</div>');
    html.push('</div>');

    // Pinned mode: click pins (toggle by re-click or outside-click),
    // hover shows non-pinned (auto-dismisses on mouseleave). Mirrors
    // the (i) info-icon pattern in info-popover.js wireInfoIcons.
    showInfoPopover(badge, '', /*pinned=*/pinned, null, html.join(''));
    _popoverEl = badge;
}

function _hidePopover() {
    // info-popover.js manages its own dismiss; just call its dismiss
    // helper to ensure the popover anchored to our badge goes away.
    try { dismissInfoPopover(); } catch (_) { /* no-op */ }
    _popoverEl = null;
}

function _escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// Auto-refresh on broadcast event
if (typeof window !== 'undefined') {
    window.addEventListener('stats-report-stale-refresh', () => {
        refreshStaleAnnotations();
    });
    // Refresh whenever stats report page opens
    window.addEventListener('stats-report-opened', () => {
        refreshStaleAnnotations();
        annotateEmptyNewItems();
    });
    // Also refresh once on initial page load (in case user is on a page
    // that has a stats-report nav button or chip already visible).
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(() => refreshStaleAnnotations(), 500);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => refreshStaleAnnotations(), 500);
        });
    }
}


/**
 * For each new_items subcategory section that has zero rows after the
 * worker filters out activities with no qualifying drops, render a
 * congratulatory empty-state message.
 *
 * Looks for sections with `data-stats-section-category="new_items"` and
 * empty children. The kind label is extracted from `data-stats-section-sub`.
 */
export function annotateEmptyNewItems() {
    const sections = document.querySelectorAll('[data-stats-section-category="new_items"]');
    for (const section of sections) {
        const sub = section.dataset.statsSectionSub || 'items';
        // Check if section has any result rows
        const rows = section.querySelectorAll('.stats-report-result-row, [data-stats-result-row]');
        if (rows.length > 0) continue;
        // Avoid duplicating the message if already added
        if (section.querySelector('.stats-report-congrats')) continue;

        const msg = document.createElement('div');
        msg.className = 'stats-report-congrats';
        msg.style.cssText = 'padding:14px;text-align:center;color:#9c9;font-style:italic;background:linear-gradient(135deg,#1a3a1a,#2a4a2a);border-radius:6px;margin:8px 0;';
        msg.textContent = `You have all the accessible ${sub} items. Congrats!`;
        section.appendChild(msg);
    }
}
