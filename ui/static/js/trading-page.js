/**
 * trading-page.js — Trading marketplace overlay (FAC-gated: trading).
 *
 * Uses the app's shared conventions: .trading-page overlay (stats-report
 * open/close animation), .settings-tabs/.settings-tab underline tabs,
 * .btn/.btn-primary/.btn-secondary buttons, CSS color variables, and jQuery
 * slideUp/slideDown for reveal transitions. Hash-routed via main.js (#trading).
 * Ownership is server-side on the session cookie — this UI only ever shows
 * in_game_name + display_name. Backend: /api/trading/* .
 */

const $ = (typeof window !== 'undefined' && window.$) ? window.$ : null;
import { wireInfoIcons } from './info-popover.js';
import { wireDropAnchor } from './drop-item-popover.js';
import { attachTabScrollIndicators } from './utils/tab-scroll-indicators.js';
import { ownedBlockHtml } from './utils/owned-quality-breakdown.js';

const TYPE_OPTIONS = [
    { value: 'gear', label: 'Gear' },
    { value: 'tool', label: 'Tool' },
    { value: 'consumable', label: 'Consumable' },
    { value: 'pet_egg', label: 'Pet egg' },
    { value: 'material', label: 'Material' },
];
const SOURCE_OPTIONS = [
    { value: 'crafted', label: 'Crafted' },
    { value: 'chest_loot', label: 'Chest loot' },
    { value: 'activity_drop', label: 'Activity drop' },
    { value: 'shop', label: 'Shop' },
    { value: 'other', label: 'Other' },
];
const QUALITY_BY_TYPE = {
    crafted: ['normal', 'good', 'great', 'excellent', 'perfect', 'eternal'],
    consumable: ['normal', 'fine'],
    pet_egg: ['normal', 'rare'],
};
const qualityOptions = (type) => (QUALITY_BY_TYPE[type] || ['normal']).map((q) => ({ value: q, label: q }));

// Canonical quality-token ladder per quality-bearing type (base tier is the
// 'common' token — create-time normalization maps 'normal' -> 'common'). Drives
// the item-page quality selector; absent key = no quality dimension (no selector).
const QUALITY_TOKEN_LADDER = {
    crafted: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal'],
    consumable: ['common', 'fine'],
    pet_egg: ['common', 'rare'],
};
// Display word -> variant token (for normalizing an incoming selected quality).
const QUALITY_WORD_TO_TOKEN = {
    normal: 'common', good: 'uncommon', great: 'rare', excellent: 'epic',
    perfect: 'legendary', eternal: 'ethereal', fine: 'fine', rare: 'rare',
    common: 'common', uncommon: 'uncommon', epic: 'epic', legendary: 'legendary', ethereal: 'ethereal',
};

// other sites title-case. Falls back to "Partner" when the site is unknown.
const SITE_LABELS = {};
function siteLabel(site) {
    if (!site) return 'Partner';
    return SITE_LABELS[site] || (site.charAt(0).toUpperCase() + site.slice(1));
}

// Trading launch moment: Oct 7 2026 00:00 PDT (07:00 UTC). The pre-launch
// "TESTING" banner stops showing at/after this instant.
const TRADING_LAUNCH_TS = 1791356400;

// Minimal, safe inline markdown for chat bodies: escape first, then **bold**,
// *italic* / _italic_, `code`, ~~strike~~, autolinked URLs, and newlines.
function mdInline(text) {
    let s = esc(String(text == null ? '' : text));
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.25);padding:0 3px;border-radius:3px;">$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#cfe8ff;text-decoration:underline;">$1</a>');
    s = s.replace(/\n/g, '<br>');
    return s;
}

// Lightweight toast (bottom-center, auto-dismiss). Self-contained so it works
// regardless of which other page scripts are loaded.
function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);'
        + 'background:#2f8f4e;color:#fff;padding:10px 16px;border-radius:8px;font-size:14px;z-index:10060;'
        + 'box-shadow:0 6px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .2s ease, transform .2s ease;pointer-events:none;';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => el.remove(), 250);
    }, 2200);
}

// Small copy-icon button (overlapping-squares glyph) that copies `text` to the
// clipboard with a toast. Used next to a trader's in-game name so it can be
// pasted straight into the game. Returns a <button>.
function copyNameBtn(text, title = 'Copy name') {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;background:none;border:none;'
        + 'padding:2px;margin:0;cursor:pointer;color:var(--text-secondary);flex-shrink:0;';
    b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>'
        + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    b.onclick = async (e) => {
        e.stopPropagation();
        const val = String(text || '');
        if (!val) return;
        try { await navigator.clipboard.writeText(val); toast('Copied name'); }
        catch (_e) {
            // Fallback for insecure contexts / older browsers.
            try {
                const ta = document.createElement('textarea');
                ta.value = val; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy'); ta.remove(); toast('Copied name');
            } catch (_e2) { toast('Copy failed'); }
        }
    };
    return b;
}

// Friendly chat timestamp: Today/Yesterday/weekday within a week, else
// "Tue, Sep 29 at …". Time uses the user's locale (12h/24h auto).
function fmtChatTime(sec) {
    if (!sec) return '';
    const d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return '';
    const sod = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((sod(new Date()) - sod(d)) / 86400000);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days === 0) return `Today at ${time}`;
    if (days === 1) return `Yesterday at ${time}`;
    if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

// Shared inline style fragments built on the app's CSS variables.
const S_CARD = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:var(--spacing-md,16px);margin-bottom:var(--spacing-sm,8px);';
const S_INPUT = 'padding:7px 10px;border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);';
const S_LABEL = 'font-size:12px;color:var(--text-secondary);margin-bottom:3px;';

async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let resp;
    try {
        resp = await fetch(path, opts);
    } catch (e) {
        // fetch() rejects only on a network-level failure — the server is
        // unreachable (most often a fresh deploy recreating the container, but
        // also offline/connection-dropped). Surface a friendly, recognizable
        // error instead of the browser's raw "Failed to fetch".
        throw serverUnavailableError();
    }
    if (!resp.ok) {
        // Gateway/unavailable statuses mean the app process is down or coming
        // back up (deploy restart) — treat like a network failure.
        if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
            throw serverUnavailableError();
        }
        let detail = resp.statusText;
        try { detail = (await resp.json()).detail || detail; } catch (e) { /* non-JSON body (e.g. proxy error page) */ }
        throw new Error(detail);
    }
    return resp.status === 204 ? null : resp.json();
}

// A friendly, tagged error for "the backend is temporarily unreachable" — used
// across the trading UI so a deploy restart (container recreate, ~30s) shows a
// helpful "try again shortly" message rather than a raw network error or a
// misleading downstream validation popup.
const SERVER_UNAVAILABLE_MSG = 'The server is temporarily unavailable — this usually means a fresh update is deploying. Please try again in a few seconds.';
function serverUnavailableError() {
    const err = new Error(SERVER_UNAVAILABLE_MSG);
    err.serverUnavailable = true;
    return err;
}

// ── Decimal coin input ──────────────────────────────────────────────────────
// Per-item coin values MAY be fractional (e.g. 2.5 coins each), as long as the
// TOTAL (per-item × qty) is a whole number of coins — you can't trade a fraction
// of a coin. coinParse() reads a user value rounded to 2 dp (null=blank,
// NaN=invalid); coinTotalWhole() enforces the whole-total rule using integer
// centi-coins so there is no floating-point error.
function coinParse(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    const n = Number(s);
    if (!isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100) / 100;
}
function coinTotalWhole(each, qty) {
    if (each == null) return true;      // negotiable / no price set
    const q = parseInt(qty, 10);
    if (!(q > 0)) return true;          // qty is validated separately
    return (Math.round(each * 100) * q) % 100 === 0;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Pretty display name for an item slug (game export key). Prefers the catalog
// name map; falls back to title-casing the slug (wooden_shield -> Wooden Shield).
function prettyName(slug) {
    if (!slug) return '';
    const n = window._tradingNameBySlug && window._tradingNameBySlug[slug];
    if (n) return n;
    return String(slug).replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
if (typeof window !== 'undefined') window.prettyName = prettyName;

// ── Free-text search parsing (name + optional quality word) ─────────────────
// Lets Browse / list searches accept a raw string like "willow perfect": the
// recognized quality word is split out and matched against each row's quality;
// the remainder is matched against the item name/slug.
const QUALITY_WORDS = new Set([
    'normal', 'fine', 'good', 'great', 'excellent', 'perfect', 'eternal', 'rare',
    'common', 'uncommon', 'epic', 'legendary', 'ethereal',
]);
function parseQuery(raw) {
    const words = String(raw || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    let quality = null;
    const rest = [];
    for (const w of words) {
        if (!quality && QUALITY_WORDS.has(w)) quality = w;
        else rest.push(w);
    }
    return { text: rest.join(' '), quality };
}
function rowMatchesText(row, text) {
    if (!text) return true;
    const it = row.item || {};
    const name = prettyName(it.slug || '').toLowerCase();
    const slug = String(it.slug || '').toLowerCase();
    return name.includes(text) || slug.includes(text);
}
function rowMatchesQuality(row, quality) {
    if (!quality) return true;
    const it = row.item || {};
    const isWish = row.side === 'buying';
    const token = (isWish ? row.quality_floor : it.quality) || '';
    const disp = (qualityDisplay(it.type, token, it.slug) || '').toLowerCase();
    return token.toLowerCase() === quality || disp === quality;
}

// ── Unread badge (nav icon + Inbox tab) ─────────────────────────────────────
// Polls /api/trading/unread and reflects the count on the nav icon badge
// (#trading-unread-badge) and, if the Trading page is open, the Inbox tab label.
let _unreadTimer = null;
export async function refreshTradingUnread() {
    let unread = 0;
    try { unread = (await api('GET', '/api/trading/unread')).unread || 0; }
    catch (e) { return 0; }
    let matches = null;
    try { matches = await api('GET', '/api/trading/match-alerts'); } catch (e) { /* keep null */ }
    const wl = (matches && matches.wishlist && matches.wishlist.count) || 0;
    const li = (matches && matches.listing && matches.listing.count) || 0;
    const total = unread + wl + li;  // nav badge = messages + match alerts
    const el = document.getElementById('trading-unread-badge');
    if (el) {
        if (total > 0) { el.textContent = total > 99 ? '99+' : String(total); el.style.display = ''; }
        else { el.style.display = 'none'; }
    }
    try {
        const p = window._tradingPage;
        if (p) {
            if (matches) p._matchData = matches;
            p._setInboxBadge(unread);                 // Inbox badge = messages only
            p._setTabBadge(p._wishlistTabBtn, 'My Wishlist', wl);
            p._setTabBadge(p._listingsTabBtn, 'My Listings', li);
        }
    } catch (e) { /* page not built */ }
    return total;
}
export function startTradingUnreadPolling(intervalMs = 30000) {
    refreshTradingUnread();
    if (_unreadTimer) clearInterval(_unreadTimer);
    _unreadTimer = setInterval(refreshTradingUnread, intervalMs);
}

/** Custom dropdown — NOT a native <select>. Slides a checkbox/radio panel down;
 *  outside-click slides it up; control shows only the selected labels. */
function createDropdown({ placeholder = 'Any', options = [], multi = false, selected = [], onChange = null } = {}) {
    let opts = options.slice();
    const sel = new Set(selected);
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'relative', minWidth: '160px' });

    const control = document.createElement('button');
    control.type = 'button';
    control.style.cssText = 'width:100%;text-align:left;padding:7px 10px;border-radius:6px;'
        + 'background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);'
        + 'cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;';
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
    const caret = document.createElement('span'); caret.textContent = '▼';
    caret.style.cssText = 'display:inline-block;opacity:.7;font-size:0.75em;transition:transform .15s ease;transform:rotate(-90deg);';
    control.append(labelSpan, caret);

    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;right:auto;min-width:100%;width:max-content;max-width:340px;background:var(--bg-secondary);'
        + 'border:1px solid var(--border-color);border-radius:8px;z-index:30;overflow:hidden;display:none;'
        + 'box-shadow:0 8px 22px rgba(0,0,0,.55);';
    const list = document.createElement('div');
    list.style.cssText = 'padding:6px;max-height:240px;overflow-y:auto;';
    panel.appendChild(list);
    wrap.append(control, panel);

    let open = false;
    const updateSummary = () => {
        const chosen = opts.filter((o) => sel.has(o.value));
        if (!chosen.length) { labelSpan.textContent = placeholder; labelSpan.style.opacity = '.6'; }
        else { labelSpan.textContent = chosen.map((o) => o.label).join(', '); labelSpan.style.opacity = '1'; }
    };
    const renderList = () => {
        list.innerHTML = '';
        opts.forEach((o) => {
            const r = document.createElement('label');
            r.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;';
            const cb = document.createElement('input');
            cb.type = multi ? 'checkbox' : 'radio'; cb.checked = sel.has(o.value);
            cb.style.accentColor = 'var(--accent-primary)';
            cb.onchange = () => {
                if (multi) { if (cb.checked) sel.add(o.value); else sel.delete(o.value); }
                else { sel.clear(); if (cb.checked) sel.add(o.value); }
                updateSummary();
                if (onChange) onChange(Array.from(sel));
                if (!multi) closePanel();
            };
            const t = document.createElement('span'); t.textContent = o.label;
            r.append(cb, t); list.appendChild(r);
        });
    };
    const outside = (e) => { if (!wrap.contains(e.target)) closePanel(); };
    const openPanel = () => { open = true; renderList(); caret.style.transform = 'rotate(0deg)'; if (window.$) window.$(panel).stop(true, true).slideDown(200); else panel.style.display = 'block'; document.addEventListener('mousedown', outside, true); };
    function closePanel() { if (!open) return; open = false; caret.style.transform = 'rotate(-90deg)'; if (window.$) window.$(panel).stop(true, true).slideUp(200); else panel.style.display = 'none'; document.removeEventListener('mousedown', outside, true); }
    control.onclick = (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); };
    updateSummary();
    return {
        el: wrap,
        getValues: () => Array.from(sel),
        getValue: () => Array.from(sel)[0] || '',
        setOptions: (newOpts) => { opts = newOpts.slice(); for (const v of Array.from(sel)) if (!opts.find((o) => o.value === v)) sel.delete(v); updateSummary(); if (open) renderList(); },
    };
}

// Browse/search filter persistence (per-browser UI settings, reused across sessions).
const BROWSE_FILTERS_KEY = 'tradingBrowseFilters';
function loadBrowseFilters() { try { return JSON.parse(localStorage.getItem(BROWSE_FILTERS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function saveBrowseFilters(obj) { try { localStorage.setItem(BROWSE_FILTERS_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ } }

// Prices-tab filter persistence (per-browser, mirrors the Browse-filter store).
const PRICES_FILTERS_KEY = 'tradingPricesFilters';
function loadPricesFilters() { try { return JSON.parse(localStorage.getItem(PRICES_FILTERS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function savePricesFilters(obj) { try { localStorage.setItem(PRICES_FILTERS_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ } }

// Trader filter: a searchable checkbox list of EVERY trader seen in the market
// EXCLUDE a trader from Browse. We persist only the excluded set, so newly-seen
// traders are automatically included. Check-all / Uncheck-all at the top.
function createTraderFilter({ onChange = null } = {}) {
    const excluded = new Set();      // trader names the user has unchecked (excluded)
    let traders = [];                // [{name, label}] sorted alphabetically by label
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position: 'relative', minWidth: '170px' });
    const control = document.createElement('button');
    control.type = 'button';
    control.style.cssText = 'width:100%;text-align:left;padding:7px 10px;border-radius:6px;'
        + 'background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);'
        + 'cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;';
    const labelSpan = document.createElement('span');
    labelSpan.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
    const caret = document.createElement('span'); caret.textContent = '▼';
    caret.style.cssText = 'display:inline-block;opacity:.7;font-size:0.75em;transition:transform .15s ease;transform:rotate(-90deg);';
    control.append(labelSpan, caret);
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:300px;'
        + 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;z-index:30;display:none;'
        + 'box-shadow:0 8px 22px rgba(0,0,0,.55);';
    const search = document.createElement('input');
    search.placeholder = 'Search traders…';
    search.style.cssText = S_INPUT + 'width:calc(100% - 12px);margin:6px 6px 4px;box-sizing:border-box;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;padding:0 6px 6px;';
    const allBtn = btn('Check all', 'secondary'); const noneBtn = btn('Uncheck all', 'secondary');
    [allBtn, noneBtn].forEach((b) => { b.style.fontSize = '11px'; b.style.padding = '2px 8px'; });
    actions.append(allBtn, noneBtn);
    const list = document.createElement('div');
    list.style.cssText = 'padding:2px 6px 6px;max-height:240px;overflow-y:auto;';
    panel.append(search, actions, list);
    wrap.append(control, panel);

    const updateSummary = () => {
        if (!traders.length || !excluded.size) { labelSpan.textContent = 'All traders'; labelSpan.style.opacity = '.6'; return; }
        labelSpan.textContent = `${traders.length - excluded.size} of ${traders.length} traders`;
        labelSpan.style.opacity = '1';
    };
    const renderList = () => {
        const q = (search.value || '').trim().toLowerCase();
        list.innerHTML = '';
        const shown = traders.filter((t) => !q || t.label.toLowerCase().includes(q));
        if (!shown.length) {
            const e = document.createElement('div');
            e.textContent = traders.length ? 'No matches' : 'No traders yet';
            e.style.cssText = 'color:var(--text-secondary);padding:6px;font-size:0.85em;';
            list.appendChild(e); return;
        }
        shown.forEach((t) => {
            const r = document.createElement('label');
            r.style.cssText = 'display:flex;gap:8px;align-items:center;padding:5px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;';
            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !excluded.has(t.name);
            cb.style.accentColor = 'var(--accent-primary)';
            cb.onchange = () => { if (cb.checked) excluded.delete(t.name); else excluded.add(t.name); updateSummary(); if (onChange) onChange(); };
            const s = document.createElement('span'); s.textContent = t.label;
            r.append(cb, s); list.appendChild(r);
        });
    };
    search.addEventListener('input', renderList);
    search.addEventListener('mousedown', (e) => e.stopPropagation());
    allBtn.onclick = () => { excluded.clear(); renderList(); updateSummary(); if (onChange) onChange(); };
    noneBtn.onclick = () => { traders.forEach((t) => excluded.add(t.name)); renderList(); updateSummary(); if (onChange) onChange(); };
    let open = false;
    const outside = (e) => { if (!wrap.contains(e.target)) closePanel(); };
    const openPanel = () => { open = true; renderList(); caret.style.transform = 'rotate(0deg)'; if (window.$) window.$(panel).stop(true, true).slideDown(200); else panel.style.display = 'block'; document.addEventListener('mousedown', outside, true); };
    function closePanel() { if (!open) return; open = false; caret.style.transform = 'rotate(-90deg)'; if (window.$) window.$(panel).stop(true, true).slideUp(200); else panel.style.display = 'none'; document.removeEventListener('mousedown', outside, true); }
    control.onclick = (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); };
    updateSummary();
    return {
        el: wrap,
        getExcluded: () => new Set(excluded),
        setExcluded: (names) => { excluded.clear(); (names || []).forEach((n) => excluded.add(String(n))); updateSummary(); if (open) renderList(); },
        // Merge newly-seen traders (preserving the excluded set). Returns true if the roster grew.
        setTraders: (pairs) => {
            const seen = new Set(traders.map((t) => t.name));
            let grew = false;
            (pairs || []).forEach((p) => {
                if (p && p.name && !seen.has(p.name)) { seen.add(p.name); traders.push({ name: p.name, label: p.label || p.name }); grew = true; }
            });
            if (grew) { traders.sort((a, b) => a.label.localeCompare(b.label)); updateSummary(); if (open) renderList(); }
            return grew;
        },
    };
}

const field = (labelText, controlEl) => {
    const w = document.createElement('div');
    const lab = document.createElement('div'); lab.textContent = labelText; lab.style.cssText = S_LABEL;
    w.append(lab, controlEl);
    return w;
};
const textInput = (placeholder, opts = {}) => {
    const i = document.createElement('input');
    i.placeholder = placeholder;
    if (opts.type) i.type = opts.type;
    if (opts.value != null) i.value = opts.value;
    i.style.cssText = S_INPUT + (opts.width ? `width:${opts.width};` : '');
    return i;
};
const btn = (text, variant = 'primary') => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.className = `btn btn-${variant}`;
    return b;
};
const rowOf = (...els) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;';
    els.forEach((e) => d.appendChild(e));
    return d;
};
const slideShow = (el) => { if ($ && el) $(el).hide().slideDown(220); };
const slideHide = (el, done) => { if ($ && el) $(el).slideUp(220, done); else { if (el) el.style.display = 'none'; if (done) done(); } };

const checkbox = (labelText, checked = false) => {
    const w = document.createElement('label');
    w.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;white-space:nowrap;';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked; c.style.accentColor = 'var(--accent-primary)';
    const s = document.createElement('span'); s.textContent = labelText;
    w.append(c, s); w._cb = c; return w;
};

const slugifyName = (name) => String(name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '').replace(/-/g, '_').replace(/'/g, '');

// Build the tradable-item autocomplete pool from /api/catalog (once). Each
// quality variant is its own entry ("Name (Quality)"), carrying icon + owned
// Quality is the game's variant TOKEN exactly as the profile export writes it:
//   '' (base/no-variant) | common..ethereal (the six rarity tiers) | fine.
// Colours come straight from the token (--rarity-<token>); '' falls back to the
// item's catalog rarity so a fixed-rarity gear still shows its tier colour.
const RARITY_TOKENS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal'];
const RARITY_SET = new Set([...RARITY_TOKENS, 'fine']);
// Crafted/gear rarity token -> the game's quality word.
const CRAFTED_TOKEN_NAME = { common: 'Normal', uncommon: 'Good', rare: 'Great', epic: 'Excellent', legendary: 'Perfect', ethereal: 'Eternal' };
// game_key -> catalog rarity token (for colouring '' base rows by intrinsic rarity).
window._tradingRarityByKey = window._tradingRarityByKey || {};

function rarityForToken(token, key) {
    const t = token || (key && window._tradingRarityByKey[key]) || '';
    return RARITY_SET.has(t) ? t : 'common';
}

// Human quality label for a (canonical type, token, key). '' = no suffix shown.
// Only crafted gear (multi-tier), material 'fine', and pet-egg 'rare' get a
// suffix. Loot/gear/tools have a SINGLE fixed quality, so they show no suffix
// (their tier is conveyed by the row colour, not a label).
function qualityDisplay(canonType, token, key) {
    token = token || '';
    if (canonType === 'crafted') return CRAFTED_TOKEN_NAME[token] || '';
    if (canonType === 'pet_egg') return token === 'rare' ? 'Rare' : '';
    if (token === 'fine') return 'Fine';
    return '';
}

// Owned map {game_key: {variant_token: qty}} fetched live from /api/trading/owned
// (parsed server-side from stored all_items_raw). Loaded once; no re-import.
let _ownedQ = {};
let _ownedQLoaded = null;
function loadOwnedQualities() {
    if (_ownedQLoaded) return _ownedQLoaded;
    _ownedQLoaded = (async () => {
        try { _ownedQ = (await (await fetch('/api/trading/owned')).json()).owned || {}; }
        catch (e) { _ownedQ = {}; }
        return _ownedQ;
    })();
    return _ownedQLoaded;
}

// Owned count for a specific (game_key, variant token).
function ownedCountFor(key, token) {
    const m = _ownedQ[key];
    return (m && typeof m === 'object' && m[token || ''] != null) ? m[token || ''] : 0;
}

let _catalogEntries = null;
async function loadCatalogEntries() {
    if (_catalogEntries) return _catalogEntries;
    await loadOwnedQualities();
    let items = [];
    try { items = (await (await fetch('/api/catalog')).json()).items || []; } catch (e) { items = []; }
    const CANON = { material: 'material', crafted_item: 'crafted', consumable: 'consumable', egg: 'pet_egg', coins: 'coins' };
    const iconByKey = {};
    const nameByKey = {};
    const entries = [];
    for (const it of items) {
        if (it.tradable === false) continue;
        if (it.type === 'coins' || it.category === 'coins') continue;  // coins removed as a trade option
        const type = (it.type === 'item') ? (it.subtype || 'loot') : (CANON[it.type] || it.type);
        // Orthogonal filter dims from the catalog (fall back if absent).
        const category = it.category || ((it.type === 'item') ? (it.subtype || 'material') : (CANON[it.type] || it.type));
        const sources = Array.isArray(it.sources) ? it.sources : ['other'];
        const key = it.game_key || it.id;              // authoritative game export key
        const icon = it.icon_path || '';
        iconByKey[key] = icon;
        if (it.name) nameByKey[key] = it.name;         // game_key -> display name (pretty rows)
        // Reverse index (display name -> game key) for auto-detecting item
        // mentions in free chat text (message thread auto-link).
        if (it.name) { window._tradingNameToKey = window._tradingNameToKey || {}; window._tradingNameToKey[String(it.name).toLowerCase()] = key; }
        // Intrinsic rarity for colour/label fallback. Fixed-rarity items (loot/
        // gear/tools) carry their single tier under `quality` (e.g. Bogwood
        // bandana → 'legendary'), NOT `rarity` — fall back to it so a no-quality
        // wishlist/listing still shows the item's true rarity instead of a dash.
        const catalogRarity = String(it.rarity || it.quality || '').toLowerCase();
        window._tradingRarityByKey[key] = catalogRarity;
        // Stash data the icon stats-popover needs (stats, value, type, slot).
        window._tradingStatsByKey = window._tradingStatsByKey || {};
        window._tradingValueByKey = window._tradingValueByKey || {};
        window._tradingTypeByKey = window._tradingTypeByKey || {};
        window._tradingCategoryBySlug = window._tradingCategoryBySlug || {};
        window._tradingSourceBySlug = window._tradingSourceBySlug || {};
        window._tradingCategoryBySlug[key] = category;
        window._tradingSourceBySlug[key] = sources;
        window._tradingStatsByKey[key] = it.stats_by_quality || it.stats || null;
        window._tradingValueByKey[key] = (typeof it.value === 'number') ? it.value : null;
        window._tradingTypeByKey[key] = (it.type === 'item') ? (it.subtype || 'loot') : (CANON[it.type] || it.type);
        const kw = Array.isArray(it.keywords) ? it.keywords.join(' ') : '';
        const statKeys = (it.stats && typeof it.stats === 'object') ? Object.keys(it.stats).join(' ') : '';
        const haystack = `${it.name} ${kw} ${statKeys}`.toLowerCase();
        const baseVal = typeof it.value === 'number' ? it.value : 0;
        const qVals = (it.quality_values && typeof it.quality_values === 'object') ? it.quality_values : null;
        const fineVal = typeof it.value_fine === 'number' ? it.value_fine : baseVal;
        const coinFor = (token) => {
            if (qVals && CRAFTED_TOKEN_NAME[token] && qVals[CRAFTED_TOKEN_NAME[token]] != null) return qVals[CRAFTED_TOKEN_NAME[token]];
            if (token === 'fine') return fineVal;
            return baseVal;
        };
        const mk = (token) => {
            const q = qualityDisplay(type, token, key);
            return {
                name: it.name, slug: key, key, id: key, type, icon, quality: token || '',
                slot: it.slot || null,
                category, sources,
                rarity: rarityForToken(token, key),
                label: q ? `${it.name} (${q})` : it.name,
                owned: ownedCountFor(key, token || ''), coin: coinFor(token || ''), haystack,
            };
        };
        const isCrafted = it.type === 'crafted_item' || (Array.isArray(it.qualities) && it.qualities.length);
        const ownedTokens = (_ownedQ[key] && typeof _ownedQ[key] === 'object') ? Object.keys(_ownedQ[key]) : [];
        if (it.type === 'egg') {
            ['', 'rare'].forEach((t) => entries.push(mk(t)));
        } else if (it.has_fine) {
            ['', 'fine'].forEach((t) => entries.push(mk(t)));
        } else if (isCrafted) {
            const toks = RARITY_TOKENS.slice();
            ownedTokens.forEach((t) => { if (t && !toks.includes(t)) toks.push(t); });
            toks.forEach((t) => entries.push(mk(t)));
        } else {
            // Fixed gear/tool/loot/material/coins: a single base ('') variant. Colour
            // + label come from the catalog rarity (via qualityDisplay/rarityForToken).
            entries.push(mk(''));
        }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name) || String(a.quality).localeCompare(String(b.quality)));
    window._tradingIconBySlug = iconByKey;   // now keyed by game_key
    window._tradingNameBySlug = nameByKey;   // game_key -> pretty display name
    _catalogEntries = entries;
    return entries;
}

// ── Item stats popover (reuses the app's info-popover chrome) ───────────────
// Humanize a stat key: "woodcutting_cutting_speed" -> "Woodcutting Cutting Speed".
function _humanizeStat(k) {
    return String(k).replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
// Flatten a nested stats object into [["Skill · Stat", value], ...] lines.
function _flattenStats(obj, prefix, out) {
    if (!obj || typeof obj !== 'object') return out;
    for (const [k, v] of Object.entries(obj)) {
        const label = prefix ? `${prefix} · ${_humanizeStat(k)}` : _humanizeStat(k);
        if (v && typeof v === 'object') _flattenStats(v, label, out);
        else out.push([label, v]);
    }
    return out;
}
function _fmtStatVal(v) {
    if (typeof v !== 'number') return esc(String(v));
    const s = (v > 0 ? '+' : '') + (Number.isInteger(v) ? v : v.toFixed(2));
    return s;
}
// Build the stats-card HTML for an item (game_key + quality token). Shows icon,
// name, type, quality, value, owned (total + per-quality), and a stats list.
function itemStatsCardHtml(slug, token) {
    token = token || '';
    const name = prettyName(slug);
    const type = (window._tradingTypeByKey && window._tradingTypeByKey[slug]) || '';
    const icon = (window._tradingIconBySlug && window._tradingIconBySlug[slug]) || '';
    const rar = rarityForToken(token, slug);
    const qDisp = qualityDisplay(type, token, slug);
    // Stats: crafted items carry stats_by_quality keyed by quality name.
    let statsObj = (window._tradingStatsByKey && window._tradingStatsByKey[slug]) || null;
    if (statsObj && CRAFTED_TOKEN_NAME[token] && statsObj[CRAFTED_TOKEN_NAME[token]]) {
        statsObj = statsObj[CRAFTED_TOKEN_NAME[token]];
    } else if (statsObj && (statsObj.Normal || statsObj.Good)) {
        // stats_by_quality but no token match -> show the base (Normal) tier.
        statsObj = statsObj.Normal || Object.values(statsObj)[0];
    }
    const lines = _flattenStats(statsObj, '', []);
    const val = (window._tradingValueByKey && window._tradingValueByKey[slug]);
    // Owned: live per-quality map for this item (keyed by variant token).
    const ownedMap = (_ownedQ && _ownedQ[slug]) || null;
    let ownedTotal = 0;
    if (ownedMap && typeof ownedMap === 'object') {
        for (const n of Object.values(ownedMap)) ownedTotal += (n || 0);
    }
    let h = `<div style="min-width:180px;max-width:260px;">`;
    h += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">`
        + `<img src="${esc(icon)}" width="28" height="28" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'">`
        + `<div><strong>${esc(name)}</strong>${qDisp ? ` <span style="color:var(--rarity-${rar}-border,var(--text-secondary));">(${esc(qDisp)})</span>` : ''}`
        + `<div style="font-size:0.8em;color:var(--text-secondary);">${esc(_humanizeStat(type))}</div></div></div>`;
    if (val != null) h += `<div style="font-size:0.85em;color:var(--text-secondary);margin-bottom:4px;">Value: ${val} coins</div>`;
    // Owned block (always show — the user asked for owned info explicitly).
    // Per-quality breakdown (line 1 = hovered quality's count, line 2 = the
    // colour-coded owned-quality list); plain total when there's no variety.
    const ownedBlock = ownedBlockHtml({
        ownedMap, activeQuality: token,
        line1Style: 'font-size:0.85em;margin-bottom:2px;',
        breakdownStyle: 'font-size:0.8em;color:var(--text-secondary);margin-bottom:4px;',
    });
    h += ownedBlock || `<div style="font-size:0.85em;margin-bottom:4px;"><strong>Owned:</strong> ${ownedTotal}</div>`;
    if (lines.length) {
        h += `<div style="border-top:1px solid var(--border-color);margin-top:4px;padding-top:4px;font-size:0.82em;">`;
        h += lines.slice(0, 40).map(([k, v]) =>
            `<div style="display:flex;justify-content:space-between;gap:10px;"><span style="color:var(--text-secondary);">${esc(k)}</span><span>${_fmtStatVal(v)}</span></div>`).join('');
        h += `</div>`;
    }
    h += `</div>`;
    return h;
}

// Walkdle-style item picker: a search box + a type checkbox filter, dropping a
// slide-down list of icon + "Name (Quality)" + owned qty. onPick(entry) fires
// Rarity drop-shadow outline (module-level twin of TradingPage._iconOutline) so
// the item-search picker rows get the same per-quality edge as the tables.
function iconOutline(rar) {
    const b = `var(--rarity-${rar}-border)`;
    return `drop-shadow(1px 0 0 ${b}) drop-shadow(-1px 0 0 ${b}) drop-shadow(0 1px 0 ${b}) drop-shadow(0 -1px 0 ${b})`;
}

// on selection. Returns { el }.
function createItemPicker(onPick, opts = {}) {
    const ownedOnly = !!opts.ownedOnly;
    const box = document.createElement('div'); box.style.cssText = 'position:relative;width:340px;max-width:100%;';
    const input = textInput('Search name, keyword, or stat…', { width: '100%' });
    input.style.boxSizing = 'border-box';
    box.appendChild(input);
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;width:100%;max-height:0;overflow-y:auto;visibility:hidden;'
        + 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;z-index:40;'
        + 'transition:max-height .2s ease;box-shadow:0 8px 22px rgba(0,0,0,.55);';
    box.appendChild(panel);
    const typeFilter = createDropdown({ placeholder: 'All types', multi: true, options: TYPE_OPTIONS, onChange: () => { if (open) render(); } });
    const sourceFilter = createDropdown({ placeholder: 'All sources', multi: true, options: SOURCE_OPTIONS, onChange: () => { if (open) render(); } });
    // Sort control (single-select). Extensible — add rows here + a matching
    // comparator in SORT_CMP to introduce new sort modes later.
    const SORT_CMP = {
        name: (a, b) => a.name.localeCompare(b.name) || a.quality.localeCompare(b.quality),
        coin_desc: (a, b) => (b.coin || 0) - (a.coin || 0) || a.name.localeCompare(b.name),
        coin_asc: (a, b) => (a.coin || 0) - (b.coin || 0) || a.name.localeCompare(b.name),
        owned_desc: (a, b) => (b.owned || 0) - (a.owned || 0) || a.name.localeCompare(b.name),
        owned_asc: (a, b) => (a.owned || 0) - (b.owned || 0) || a.name.localeCompare(b.name),
    };
    const sortDD = createDropdown({ placeholder: 'Sort', multi: false, selected: ['name'], options: [
        { value: 'name', label: 'Name (A–Z)' },
        { value: 'coin_desc', label: 'Coin value (high→low)' },
        { value: 'coin_asc', label: 'Coin value (low→high)' },
        { value: 'owned_desc', label: 'Owned (high→low)' },
        { value: 'owned_asc', label: 'Owned (low→high)' },
    ], onChange: () => { if (open) render(); } });
    let entries = [];
    let open = false, filtered = [], shown = 0;
    const CHUNK = 40;
    let _hideTimer = null;
    const outside = (e) => { if (!box.contains(e.target)) closePanel(); };
    function closePanel() { open = false; panel.style.maxHeight = '0'; if (_hideTimer) clearTimeout(_hideTimer); _hideTimer = setTimeout(() => { panel.style.visibility = 'hidden'; }, 220); document.removeEventListener('mousedown', outside, true); }
    const COL = 'width:64px;text-align:right;flex-shrink:0;';
    const headerHtml = '<div style="position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 8px;'
        + 'background:var(--bg-tertiary);border-bottom:1px solid var(--border-color);font-size:0.78em;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.03em;">'
        + '<span style="width:32px;flex-shrink:0;"></span><span style="flex:1;">Item</span>'
        + `<span style="${COL}">Owned</span><span style="${COL}">Value</span></div>`;
    const rowHtml = (m, i) => {
        const rar = m.rarity || rarityForToken(m.quality, m.key);
        return `<div data-pick="${i}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;`
            + `background:var(--rarity-${rar});border-left:3px solid var(--rarity-${rar}-border);">`
            + `<img src="${esc(m.icon)}" width="32" height="32" style="image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
            + `<span style="flex:1;">${esc(m.label)}</span>`
            + `<span style="${COL}">${m.owned != null ? m.owned : ''}</span>`
            + `<span style="${COL}color:var(--text-secondary);">${m.coin != null ? m.coin : ''}</span></div>`;
    };
    const appendChunk = () => {
        const next = filtered.slice(shown, shown + CHUNK);
        const frag = document.createElement('div');
        frag.innerHTML = next.map((m, j) => rowHtml(m, shown + j)).join('');
        Array.from(frag.children).forEach((rowEl) => {
            rowEl.onmouseenter = () => { rowEl.style.filter = 'brightness(1.25)'; };
            rowEl.onmouseleave = () => { rowEl.style.filter = ''; };
            rowEl.onclick = () => { const m = filtered[parseInt(rowEl.dataset.pick, 10)]; input.value = m.label; closePanel(); onPick(m); };
            panel.appendChild(rowEl);
        });
        shown += next.length;
    };
    const render = () => {
        const q = input.value.trim().toLowerCase();
        const types = new Set(typeFilter.getValues());
        const srcs = new Set(sourceFilter.getValues());
        filtered = entries;
        if (ownedOnly) filtered = filtered.filter((x) => x.owned > 0);
        if (types.size) filtered = filtered.filter((x) => types.has(x.category));
        if (srcs.size) filtered = filtered.filter((x) => (x.sources || []).some((s) => srcs.has(s)));
        if (q) filtered = filtered.filter((x) => x.haystack.includes(q) || x.label.toLowerCase().includes(q));
        const sortKey = sortDD.getValue() || 'name';
        filtered = filtered.slice().sort(SORT_CMP[sortKey] || SORT_CMP.name);
        panel.innerHTML = ''; shown = 0;
        if (!filtered.length) panel.innerHTML = `<div style="padding:8px;color:var(--text-secondary);">${ownedOnly ? 'You own no matching tradable items.' : 'No matches.'}</div>`;
        else { panel.innerHTML = headerHtml; appendChunk(); }
        if (!open) { open = true; if (_hideTimer) clearTimeout(_hideTimer); panel.style.visibility = 'visible'; panel.style.maxHeight = '340px'; document.addEventListener('mousedown', outside, true); }
    };
    panel.addEventListener('scroll', () => {
        if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 48 && shown < filtered.length) appendChunk();
    });
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    // Free-text search: Enter runs the caller's onEnter with the raw string
    // (so Browse / list searches can match a name + quality, not only a picked item).
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); closePanel(); if (opts.onEnter) opts.onEnter(input.value); }
    });
    loadCatalogEntries().then((e) => { entries = e; if (open) render(); });
    // Search contexts (Browse / list search bars) already have their own result
    // Type dropdown, so hide the picker's internal one to avoid two Type filters.
    const wrap = opts.hideTypeFilter
        ? rowOf(field('Item', box), field('Sort', sortDD.el))
        : rowOf(field('Item', box), field('Type filter', typeFilter.el), field('Source', sourceFilter.el), field('Sort', sortDD.el));
    return { el: wrap, input, clear: () => { input.value = ''; } };
}

export class TradingPage {
    constructor(selector) {
        this.el = document.querySelector(selector);
        this.built = false;
        this.activeTab = 'browse';
        this.me = null;
        this._editingProfile = false;
        // Back-navigation stack: thunks that re-render the view we came FROM, so
        // Back follows the actual trail (e.g. trader -> item -> back = trader).
        this._navStack = [];
        this._currentViewThunk = null;
    }

    async open() {
        if (!this.built) { this._build(); this.built = true; }
        this.el.classList.add('trading-page');
        this.el.classList.remove('closing');
        this.el.classList.add('opening');
        document.body.classList.add('trading-open');
        document.getElementById('trading-nav-btn')?.classList.add('active');
        try { this.me = await api('GET', '/api/trading/me'); } catch (e) { this.me = null; }
        // Ensure the item-icon catalog is loaded before the first render. On a
        // fresh page load (hash route straight to #trading) it wasn't cached yet,
        // so icons stayed blank until a tab switch. loadCatalogEntries caches.
        try { await loadCatalogEntries(); } catch (e) { /* icons will fill lazily */ }
        // Auto-renew on site open (opt-in): renews own entries with < 4 days left.
        // Guarded so it runs at most once per page load, not on every overlay open.
        if (this.me && this.me.auto_renew && !window._tradingAutoRenewed) {
            window._tradingAutoRenewed = true;
            api('POST', '/api/trading/auto-renew', {}).catch(() => { /* best-effort */ });
        }
        const pending = window._tradingPendingSearch;
        if (pending) {
            // Leave it set; _renderBrowse consumes + clears it (applies item + label).
            this.activeTab = 'browse';
            this._switchTab('browse');
        } else if (!window._tradingPendingThreadKey && !window._tradingPendingCompare && !this._isTradingVisited()) {
            // First-ever visit → open Settings already in edit mode so the user
            // reviews their trading settings before browsing (no "Edit" click).
            this._markTradingVisited();
            this.activeTab = 'settings';
            this._editingProfile = true;
            this._settingsDirty = false;
            this._switchTab('settings');
        } else {
            this._switchTab(this.activeTab);
        }
        // Deep link from a message notification → open that thread directly.
        if (window._tradingPendingThreadKey) {
            const tk = window._tradingPendingThreadKey;
            window._tradingPendingThreadKey = null;
            this.activeTab = 'inbox';
            this._openThread({ thread_key: tk, counterpart: '' });
        }
        // Deep link to a trader comparison (?trading_compare=NAME…#trading).
        if (window._tradingPendingCompare) {
            const pc = window._tradingPendingCompare;
            window._tradingPendingCompare = null;
            this._openCompare(pc.name, null, { site: pc.site, remote: pc.remote });
        }
        // Deep link to a trader's public profile (/u/<handle>).
        if (window._tradingPendingTrader) {
            const pt = window._tradingPendingTrader;
            window._tradingPendingTrader = null;
            this._openTraderDetail(pt.name, null, {});
        }
    }

    // Open a thread by key alone (used by notification deep-links): derive the
    // counterpart from the fetched messages if we weren't given one.
    _openPendingThread(threadKey) {
        if (!threadKey) return;
        window._tradingPendingThreadKey = null;
        this.activeTab = 'inbox';
        this._navigate('forward', () => this._openThread({ thread_key: threadKey, counterpart: '' }));
    }

    // First-visit tracking (per browser) — drives the one-time "review your
    // settings" redirect on the very first #trading open.
    _isTradingVisited() {
        try { return localStorage.getItem('tradingVisited') === '1'; } catch (e) { return false; }
    }
    _markTradingVisited() {
        try { localStorage.setItem('tradingVisited', '1'); } catch (e) { /* ignore */ }
    }

    close() {
        if (!this.built) return;
        this.el.classList.remove('opening');
        this.el.classList.add('closing');
        clearTimeout(this._closeTimer);
        this._closeTimer = setTimeout(() => { this.el.classList.remove('closing'); }, 300);
        document.body.classList.remove('trading-open');
        document.getElementById('trading-nav-btn')?.classList.remove('active');
    }

    _build() {
        this.el.innerHTML = `
            <div style="max-width:980px;margin:0 auto;padding:var(--spacing-md,16px);">
              <div class="trading-head" style="position:sticky;top:0;z-index:5;background:var(--bg-primary);margin:calc(-1 * var(--spacing-md,16px)) calc(-1 * var(--spacing-md,16px)) 10px;padding:var(--spacing-md,16px) var(--spacing-md,16px) 8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--spacing-md,16px);">
                  <h2 style="margin:0;color:var(--text-primary);">Trading</h2>
                  <button data-act="close" class="btn btn-secondary" aria-label="Close" style="line-height:1;">&times;</button>
                </div>
                <div data-testing-banner></div>
                <div class="settings-tabs" data-tabs></div>
              </div>
              <div data-content></div>
            </div>`;
        this.el.querySelector('[data-act="close"]').onclick = () => { window.location.hash = ''; };
        // Delegated: a clickable item name in any Sale-history panel opens that
        // item's detail (forward nav, so Back returns to the current view).
        this.el.addEventListener('click', (e) => {
            const h = e.target.closest && e.target.closest('.trade-hist-name');
            if (h) {
                e.stopPropagation();
                const slug = h.getAttribute('data-hist-slug');
                if (slug) this._navigate('forward', () => this._openItemDetail(slug, h.getAttribute('data-hist-quality') || ''));
            }
        });
        this._renderTestingBanner();
        const tabs = [['browse', 'Browse / Search'], ['prices', 'Prices'], ['listings', 'My Listings'], ['wishlist', 'My Wishlist'], ['inbox', 'Inbox'], ['settings', 'Settings']];
        const bar = this.el.querySelector('[data-tabs]');
        tabs.forEach(([key, label]) => {
            const b = document.createElement('button');
            b.textContent = label; b.dataset.tab = key; b.type = 'button';
            b.className = 'settings-tab';
            b.onclick = () => this._switchTab(key);
            if (key === 'inbox') this._inboxTabBtn = b;
            if (key === 'wishlist') this._wishlistTabBtn = b;
            if (key === 'listings') this._listingsTabBtn = b;
            bar.appendChild(b);
        });
        // Overflow affordance: on narrow/mobile widths the tab row scrolls
        // horizontally with its scrollbar hidden — overlay ‹ / › chevrons so
        // users know (and can reach) off-screen tabs. Surface is --bg-primary.
        attachTabScrollIndicators(bar);
        // Reflect any already-known unread count on the Inbox tab + nav badge.
        refreshTradingUnread();
    }

    // Dismissable "this is testing-only" banner (mirrors the crafting-tree beta
    // note). Dismissal persists per-browser in localStorage.
    _renderTestingBanner() {
        const host = this.el.querySelector('[data-testing-banner]');
        if (!host) return;
        // At/after launch (Oct 7 2026 00:00 PDT) the pre-launch notice is gone.
        if (Date.now() / 1000 >= TRADING_LAUNCH_TS) { host.innerHTML = ''; return; }
        let dismissed = false;
        try { dismissed = localStorage.getItem('tradingTestingNoticeDismissed') === 'true'; } catch (e) { /* ignore */ }
        if (dismissed) { host.innerHTML = ''; return; }
        host.innerHTML = `
            <div class="crafting-tree-beta-banner" role="status">
              <div class="crafting-tree-beta-banner-body">
                <span class="crafting-tree-beta-tag">TESTING</span>
                <span class="crafting-tree-beta-text">
                  Trading is in testing ahead of the official in-game release. Listings, wishlists,
                  prices, and cross-site trades may be reset or change before launch, and the market
                  stall icon will become the real scale icon once the game ships it. Found a bug or
                  have feedback? Use the bug button — thanks for helping us test!
                </span>
              </div>
              <button type="button" data-act="dismiss-testing" class="crafting-tree-beta-dismiss" title="Dismiss this notice">✕</button>
            </div>`;
        const dz = host.querySelector('[data-act="dismiss-testing"]');
        if (dz) dz.onclick = () => {
            try { localStorage.setItem('tradingTestingNoticeDismissed', 'true'); } catch (e) { /* ignore */ }
            host.innerHTML = '';
        };
    }
    _setInboxBadge(n) {
        if (!this._inboxTabBtn) return;
        this._inboxTabBtn.textContent = n > 0 ? `Inbox (${n > 99 ? '99+' : n})` : 'Inbox';
    }

    // Set a "(N)" suffix on a tab button (used for My Wishlist / My Listings
    // match-alert counts). `base` is the plain label.
    _setTabBadge(btn, base, n) {
        if (!btn) return;
        btn.textContent = n > 0 ? `${base} (${n > 99 ? '99+' : n})` : base;
    }

    // Render a "✨ New matches" banner (match alerts for this tab) at the top of
    // `host`, then mark them read — visiting the tab clears the badge.
    async _renderMatchBanner(host, kind) {
        let data = this._matchData;
        if (!data) { try { data = await api('GET', '/api/trading/match-alerts'); this._matchData = data; } catch (e) { data = null; } }
        const kd = data && data[kind];
        if (kd && kd.count && (kd.items || []).length) {
            const banner = document.createElement('div');
            banner.style.cssText = 'background:var(--bg-tertiary);border:1px solid var(--accent-primary);border-radius:8px;padding:8px 10px;margin-bottom:10px;';
            const head = kind === 'wishlist' ? 'New wishlist matches' : 'New listing matches';
            const verb = kind === 'wishlist' ? 'a matching listing is available' : 'a buyer wants this';
            let rows = '';
            (kd.items || []).forEach((a) => {
                const it = a.item || {}; if (!it.slug) return;
                const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
                rows += `<div class="trade-match-row" data-slug="${esc(it.slug)}" style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;">`
                    + '<span style="background:var(--accent-primary);color:#fff;border-radius:9px;padding:0 6px;font-size:10px;font-weight:700;flex-shrink:0;">NEW</span>'
                    + `<img src="${esc(icon)}" width="22" height="22" style="image-rendering:pixelated;flex-shrink:0;" onerror="this.style.visibility='hidden'">`
                    + `<strong style="text-decoration:underline dotted;text-underline-offset:2px;">${esc(prettyName(it.slug))}</strong> `
                    + `<span style="color:var(--text-secondary);font-size:12px;">— ${verb}</span></div>`;
            });
            banner.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:var(--text-primary);">✨ ${head}</div>${rows}`;
            banner.addEventListener('click', (e) => {
                const r = e.target.closest('.trade-match-row');
                if (r && r.dataset.slug) this._navigate('forward', () => this._openItemDetail(r.dataset.slug));
            });
            host.appendChild(banner);
        }
        // Visiting the tab clears the alerts (not on click) — mark read + refresh.
        try {
            await api('POST', '/api/trading/match-alerts/read', { kind });
            if (this._matchData && this._matchData[kind]) this._matchData[kind] = { count: 0, ids: [], items: [] };
            refreshTradingUnread();
        } catch (e) { /* best-effort */ }
    }

    _content() { return this._contentOverride || this.el.querySelector('[data-content]'); }

    _switchTab(name) {
        // Guard: leaving Settings mid-edit with unsaved changes -> confirm.
        if (this.activeTab === 'settings' && name !== 'settings'
            && this._editingProfile && this._settingsDirty && !this._leaveConfirmOpen) {
            this._confirmLeaveSettings(name);
            // Re-mark the Settings tab active (the clicked tab already toggled).
            this.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'settings'));
            return;
        }
        this.activeTab = name;
        // A top-tab switch is a fresh navigation root: clear the back trail and
        // record this tab as the view to return to.
        this._navStack = [];
        this._currentViewThunk = () => this._switchTab(name);
        this.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
        const c = this._content();
        c.innerHTML = '';
        return this._renderTab(name, c);
    }

    // Dispatch a tab render into `c`, returning the renderer's promise (if any)
    // so navigation can await the new view before animating.
    _renderTab(name, c) {
        if (name === 'browse') return this._renderBrowse(c);
        if (name === 'prices') return this._renderPrices(c);
        if (name === 'listings') return this._renderListings(c);
        if (name === 'wishlist') return this._renderWishlist(c);
        if (name === 'inbox') return this._renderInbox(c);
        if (name === 'settings') return this._renderSettings(c);
        return undefined;
    }

    // Full-width push/pop transition. Keeps the current view mounted, renders the
    // new view off-screen into a second layer, slides both (fade too), then
    // flattens the new view back into the content host. `dir`: 'forward' (new
    // enters from the right) or 'back' (new enters from the left).
    async _navigate(dir, renderFn) {
        // Forward navigation records the view we're leaving so Back can return
        // to it (the renderFn below installs the NEW current-view thunk).
        if (dir === 'forward' && this._currentViewThunk) {
            (this._navStack = this._navStack || []).push(this._currentViewThunk);
        }
        const host = this.el.querySelector('[data-content]');
        if (!host || this._navigating) { // re-entrancy / no host → just render
            if (renderFn) await renderFn();
            this._runPendingScroll();
            return;
        }
        this._navigating = true;
        const inStart = dir === 'back' ? '-100%' : '100%';
        const outEnd = dir === 'back' ? '100%' : '-100%';
        const oldH = host.offsetHeight; // measure BEFORE detaching (while in normal flow)
        const oldLayer = document.createElement('div');
        oldLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;';
        while (host.firstChild) oldLayer.appendChild(host.firstChild);
        // New layer starts OFF-SCREEN (not translateX(0)) so it never overlaps the
        // old view during the async render — that overlap was the pre-animation flicker.
        const newLayer = document.createElement('div');
        newLayer.style.cssText = `position:absolute;top:0;left:0;width:100%;transform:translateX(${inStart});opacity:0;`;
        host.style.position = 'relative';
        host.style.overflow = 'hidden';
        host.style.height = oldH + 'px'; // pin now so the host can't collapse during the (async) render
        host.append(oldLayer, newLayer);
        // Render the new view into newLayer via the content override.
        this._contentOverride = newLayer;
        try { if (renderFn) await renderFn(); } finally { this._contentOverride = null; }
        host.style.height = Math.max(oldH, newLayer.offsetHeight) + 'px';
        void host.offsetWidth; // commit the off-screen start state before transitioning
        const t = 'transform .3s ease, opacity .3s ease';
        oldLayer.style.transition = newLayer.style.transition = t;
        oldLayer.style.transform = `translateX(${outEnd})`; oldLayer.style.opacity = '0';
        newLayer.style.transform = 'translateX(0)'; newLayer.style.opacity = '1';
        await new Promise((r) => setTimeout(r, 320));
        // Flatten: discard old, move new content back into the host as normal flow.
        oldLayer.remove();
        newLayer.style.transition = 'none'; newLayer.style.transform = 'none';
        while (newLayer.firstChild) host.insertBefore(newLayer.firstChild, newLayer);
        newLayer.remove();
        host.style.position = ''; host.style.overflow = ''; host.style.height = '';
        this._navigating = false;
        // A view (e.g. a message thread) may need to set a scroll position only
        // AFTER its content is re-parented into the host — re-parenting a
        // scrollable element resets scrollTop to 0, which is why an in-render
        // scroll never stuck. Run it here, post-flatten.
        this._runPendingScroll();
    }

    // Invoke (once) a scroll positioner a view registered via this._pendingScroll.
    // rAF so layout is settled after the re-parent before we read offsets.
    _runPendingScroll() {
        const f = this._pendingScroll;
        if (!f) return;
        this._pendingScroll = null;
        requestAnimationFrame(f);
    }

    // Back = return to the view we came from (pop the trail); if the trail is
    // empty, fall back to the active tab.
    _goBack() {
        const prev = (this._navStack && this._navStack.length) ? this._navStack.pop() : null;
        if (prev) this._navigate('back', prev);
        else this._navigate('back', () => this._switchTab(this.activeTab || 'browse'));
    }

    // "Unsaved changes" prompt when navigating away from Settings while editing.
    _confirmLeaveSettings(targetTab) {
        this._leaveConfirmOpen = true;
        const m = this._modal('Unsaved changes');
        const p = document.createElement('div');
        p.style.cssText = 'color:var(--text-primary);margin-bottom:12px;';
        p.textContent = 'You have unsaved contact-preference changes. Save them before leaving?';
        m.panel.appendChild(p);
        const save = btn('Save & leave');
        const discard = btn('Discard'); discard.className = 'btn btn-trade-danger';
        const stay = btn('Stay'); stay.style.cssText = 'background:var(--bg-tertiary);color:var(--text-primary);';
        const row = rowOf(save, discard, stay); row.style.marginTop = '8px';
        const errd = document.createElement('div'); errd.style.marginTop = '8px';
        m.panel.append(row, errd);
        const leave = () => {
            this._leaveConfirmOpen = false; this._editingProfile = false; this._settingsDirty = false;
            m.close(); this._switchTab(targetTab);
        };
        save.onclick = async () => {
            save.disabled = true;
            try { if (this._settingsSave) await this._settingsSave(); leave(); }
            catch (e) { save.disabled = false; errd.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        discard.onclick = leave;
        stay.onclick = () => { this._leaveConfirmOpen = false; m.close(); };
    }

    _card(inner) {
        const d = document.createElement('div');
        d.style.cssText = S_CARD;
        if (typeof inner === 'string') d.innerHTML = inner; else d.appendChild(inner);
        return d;
    }

    // ── Inbox / messaging ─────────────────────────────────────────────────
    async _renderInbox(c) {
        c.innerHTML = '<div style="color:var(--text-secondary);">Loading inbox…</div>';
        let data;
        try { data = await api('GET', '/api/trading/inbox'); }
        catch (e) { c.innerHTML = `<div style="color:var(--danger,#e06b6b);">${esc(e.message)}</div>`; return; }
        c.innerHTML = '';
        refreshTradingUnread(); // opening the inbox view may change read state

        if (!data.threads || !data.threads.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:var(--text-secondary);padding:12px 0;';
            empty.textContent = 'No conversations yet. Use “Message” on a listing in Browse / Search to start one.';
            c.appendChild(empty);
            return;
        }
        data.threads.forEach((t) => {
            const card = this._card('');
            card.style.cursor = 'pointer';
            const pill = t.unread > 0 ? ` <span style="background:#ffdd00;color:#1c121c;border-radius:9px;padding:0 6px;font-size:11px;font-weight:700;">${t.unread}</span>` : '';
            const aboutName = (t.about_item && t.about_item.slug) ? prettyName(t.about_item.slug) : t.about_object_id;
            const about = aboutName ? ` <span style="color:var(--text-secondary);font-size:12px;">· re: ${esc(aboutName)}</span>` : '';
            const _ctid = t.counterpart_trader_id || '';
            const _csite = _ctid.includes(':') ? _ctid.split(':', 1)[0] : '';
            const viaCard = (_csite && _csite !== 'flames')
                ? ` <span style="color:var(--text-secondary);font-size:0.8em;font-weight:400;">via ${esc(siteLabel(_csite))}</span>` : '';
            const when = t.last_at ? fmtChatTime(t.last_at) : '';
            card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div style="min-width:0;">
                  <div style="color:var(--text-primary);font-weight:600;">${esc(t.counterpart || '?')}${viaCard}${pill}${about}</div>
                  <div style="color:var(--text-secondary);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.last_body || '')}</div>
                </div>
                <div style="color:var(--text-secondary);font-size:11px;white-space:nowrap;text-align:right;">${esc(when)}<br>${t.messages} msg${t.messages === 1 ? '' : 's'}</div>
              </div>`;
            card.onclick = () => this._navigate('forward', () => this._openThread(t));
            c.appendChild(card);
        });
    }

    // Send animation: a "ghost" outgoing bubble fades in over the composer at
    // (roughly) the textbox width, then flies up into the log and resizes to the
    // REAL appended bubble's exact size + position, which is revealed on arrival.
    // No full thread reload happens, so there's no screen flash. Self-contained
    // (creates + animates + removes its own fixed node). No-op if rects can't be
    // measured or prefers-reduced-motion.
    _animateMessageSend(inputEl, text, targetBubble, logEl) {
        const reveal = () => { if (targetBubble) targetBubble.style.opacity = '1'; };
        if (!inputEl || !text || !targetBubble) { reveal(); return; }
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                reveal();
                if (logEl) requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
                return;
            }
        } catch (e) { /* ignore */ }
        const startRect = inputEl.getBoundingClientRect();
        // Scroll the new (hidden) bubble into view first so its final rect is
        // where it will actually sit, then measure it.
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
        const endRect = targetBubble.getBoundingClientRect();
        if (!startRect || !startRect.width || !endRect || !endRect.width) { reveal(); return; }

        const ghost = document.createElement('div');
        ghost.innerHTML = targetBubble.innerHTML;
        // Match the outgoing-bubble look; start as wide as the composer, over it.
        ghost.style.cssText = 'position:fixed;z-index:10070;box-sizing:border-box;'
            + 'background:#3fa65a;color:#fff;border-radius:10px;padding:7px 10px;font-size:14px;'
            + 'white-space:pre-wrap;word-break:break-word;overflow:hidden;pointer-events:none;'
            + 'box-shadow:0 8px 24px rgba(0,0,0,.45);opacity:0;'
            + `left:${startRect.left}px;top:${startRect.top}px;width:${startRect.width}px;height:${startRect.height}px;`
            + 'transition:opacity .14s ease-out, left .42s cubic-bezier(.22,1,.36,1), '
            + 'top .42s cubic-bezier(.22,1,.36,1), width .42s cubic-bezier(.22,1,.36,1), height .42s ease;';
        document.body.appendChild(ghost);

        requestAnimationFrame(() => {
            ghost.style.opacity = '1';                 // fade in at the box
            requestAnimationFrame(() => {              // next frame: fly to the real bubble rect
                ghost.style.left = `${endRect.left}px`;
                ghost.style.top = `${endRect.top}px`;
                ghost.style.width = `${endRect.width}px`;
                ghost.style.height = `${endRect.height}px`;
            });
        });
        // On arrival: reveal the real bubble underneath, fade the ghost, remove it.
        setTimeout(() => { reveal(); ghost.style.opacity = '0'; }, 430);
        setTimeout(() => { ghost.remove(); }, 600);
    }

    async _openThread(t) {
        this._currentViewThunk = () => this._openThread({ ...t, _noanim: true });
        // Stop any prior thread poller before (re)rendering this view.
        if (this._threadPoller) { clearInterval(this._threadPoller); this._threadPoller = null; }
        const c = this._content();
        c.innerHTML = '<div style="color:var(--text-secondary);">Loading…</div>';
        let data;
        try { data = await api('GET', '/api/trading/messages?thread=' + encodeURIComponent(t.thread_key)); }
        catch (e) {
            // 404 = brand-new/empty thread → just show the composer. A server
            // outage (deploy restart) also lands here — flag it so the user
            // knows the empty view is transient, not a lost conversation.
            if (e && e.serverUnavailable) toast(SERVER_UNAVAILABLE_MSG);
            data = { messages: [] };
        }
        c.innerHTML = '';
        refreshTradingUnread(); // reading the thread marked it read server-side

        const back = btn('← Back'); back.onclick = () => this._goBack();
        const title = document.createElement('div');
        title.style.cssText = 'color:var(--text-primary);font-weight:600;';
        // Clickable counterpart name -> their trader page (forward nav, animated).
        // The counterpart_trader_id is site-keyed ("<site>:<uuid>"); a non-local
        const cpName = t.counterpart || '?';
        const cpTid = t.counterpart_trader_id || '';
        if (t.counterpart) {
            const link = document.createElement('span');
            link.textContent = cpName;
            link.style.cssText = 'cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;';
            link.title = `View ${cpName}'s trader page`;
            link.onclick = () => {
                const site = cpTid.includes(':') ? cpTid.split(':', 1)[0] : '';
                const remote = !!site && site !== 'flames';
                this._navigate('forward', () => this._openTraderDetail(
                    cpName, cpTid || null, remote ? { remote: true, site } : {}));
            };
            title.appendChild(link);
        } else {
            title.innerHTML = esc(cpName);
        }
        // Copy the counterpart's in-game name so it can be pasted into the game.
        if (t.counterpart) {
            const cb = copyNameBtn(cpName, `Copy “${cpName}”`);
            cb.style.marginLeft = '6px';
            cb.style.verticalAlign = 'middle';
            title.appendChild(cb);
        }
        const _cpSite = cpTid.includes(':') ? cpTid.split(':', 1)[0] : '';
        if (_cpSite && _cpSite !== 'flames') {
            const via = document.createElement('span');
            via.style.cssText = 'margin-left:8px;color:var(--text-secondary);font-size:0.8em;font-weight:400;';
            via.textContent = `via ${siteLabel(_cpSite)}`;
            title.appendChild(via);
        }
        const head = rowOf(back, title); head.style.marginBottom = '10px';
        c.appendChild(head);

        // Order context banner + prefill text, built from the Browse row meta.
        const fmtCoins = (n) => (n == null ? null : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
        let aboutBanner = '';
        let prefillBody = '';
        if (t.about_slug) {
            const qDisp = qualityDisplay(t.about_type, t.about_quality, t.about_slug);
            const nm = prettyName(t.about_slug) + (qDisp ? ` (${qDisp})` : '');
            const qty = t.about_qty != null ? t.about_qty : 1;
            const single = qty === 1;
            const priceStr = fmtCoins(t.about_price);
            if (t.about_side === 'buying') {
                aboutBanner = `About their buy order: <strong>${esc(t.counterpart || '')}</strong> wants <strong>${single ? 'a' : qty}</strong> ${esc(nm)} at ${priceStr ? `up to ${priceStr}` : 'a negotiable price'}${single ? '' : ' each'}.`;
                prefillBody = `Hi ${t.counterpart || ''}! I can sell you ${single ? 'a' : qty} ${nm}`
                    + (priceStr ? ` — would ${priceStr} coins${single ? '' : ' each'} work?` : '. What are you offering?');
            } else {
                aboutBanner = `About their sell order: <strong>${esc(t.counterpart || '')}</strong>: <strong>${single ? 'a' : qty}</strong> ${esc(nm)} at ${priceStr ? priceStr : 'a negotiable price'}${single ? '' : ' each'}.`;
                if (single) {
                    prefillBody = priceStr
                        ? `Hi ${t.counterpart || ''}! I'd like to buy a ${nm} at ${priceStr} coins.`
                        : `Hi ${t.counterpart || ''}! I'd like to buy a ${nm}. What price are you looking for?`;
                } else {
                    prefillBody = priceStr
                        ? `Hi ${t.counterpart || ''}! I'd like to buy your ${qty} ${nm} at ${priceStr} coins each.`
                        : `Hi ${t.counterpart || ''}! I'd like to buy your ${qty} ${nm}. What price are you looking for?`;
                }
            }
        } else if (data && data.about_item && data.about_item.slug) {
            const ai = data.about_item;
            const qd = qualityDisplay(ai.type, ai.quality, ai.slug);
            aboutBanner = `Re: <strong>${esc(prettyName(ai.slug) + (qd ? ` (${qd})` : ''))}</strong>`;
            t.about_slug = ai.slug; // lets the icon block below show the item icon
        } else if (t.about_object_id) {
            aboutBanner = `Re: ${esc(t.about_object_id)}`;
        }
        if (aboutBanner && !(data && data.about_detail) && !t.about_slug) {
            // Last-ditch fallback (no resolvable detail): plain text banner.
            const banner = document.createElement('div');
            banner.style.cssText = 'background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;color:var(--text-secondary);';
            banner.innerHTML = aboutBanner;
            c.appendChild(banner);
        }
        // Rich "about" card: full detail of the listing/wishlist this thread is
        // about (item, side, who, price, qty, listed time, note) in a rarity-tinted
        // card — the same info we show for an entry in the tables.
        const d = (data && data.about_detail) || (t.about_slug ? {
            kind: t.about_side === 'buying' ? 'wishlist' : 'listing',
            side: t.about_side || 'selling',
            item: { slug: t.about_slug, type: t.about_type, quality: t.about_quality },
            qty: t.about_qty,
            price_coins: t.about_side !== 'buying' ? t.about_price : null,
            max_coins: t.about_side === 'buying' ? t.about_price : null,
            owner: t.counterpart || null,
        } : null);
        if (d && d.item) {
            const di = d.item;
            const isWish = d.kind === 'wishlist' || d.side === 'buying';
            const qtok = isWish ? d.quality_floor : di.quality;
            const qd = qualityDisplay(di.type, qtok, di.slug);
            const rar = rarityForToken(qtok, di.slug);
            const icon = (window._tradingIconBySlug && window._tradingIconBySlug[di.slug]) || '';
            const qty = d.qty != null ? d.qty : 1;
            const priceStr = isWish
                ? (d.max_coins != null && d.max_coins > 0 ? `≤ ${Number(d.max_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins each` : 'Negotiable')
                : (d.price_coins != null && d.price_coins > 0 ? `${Number(d.price_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins each` : 'Negotiable');
            const badge = isWish
                ? '<span style="color:var(--accent-primary);font-weight:700;">WISHLIST</span>'
                : '<span style="color:#5fb55f;font-weight:700;">SELLING</span>';
            const whoLabel = isWish ? 'Buyer' : 'Seller';
            const card = document.createElement('div');
            card.style.cssText = `border-radius:8px;padding:10px;margin-bottom:10px;font-size:13px;color:var(--text-primary);background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);`;
            const header = document.createElement('div');
            header.className = 'trade-about-toggle';
            header.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:pointer;';
            header.innerHTML = `<img src="${esc(icon)}" width="32" height="32" style="image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
                + `<div style="flex:1;min-width:0;"><div style="font-weight:600;"><span class="trade-about-item" data-about-slug="${esc(di.slug)}" data-about-quality="${esc(qtok || '')}" title="View item details" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;">${esc(prettyName(di.slug))}</span>${qd ? ` <span style="color:var(--text-secondary);">(${esc(qd)})</span>` : ''}</div>`
                + `<div style="color:var(--text-secondary);">${badge}${d.owner ? ` · ${whoLabel}: ${esc(d.owner)}` : ''}</div></div>`
                + `<span class="expand-arrow" style="flex-shrink:0;">▼</span>`;
            const body = document.createElement('div');
            body.style.cssText = 'display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color);';
            const bodyLines = [`${priceStr} · Qty ${qty}`];
            if (d.listed) bodyLines.push(`Listed ${esc(fmtChatTime(d.listed))}`);
            if (d.note) bodyLines.push(`<span style="font-style:italic;">“${esc(d.note)}”</span>`);
            body.innerHTML = bodyLines.map((l) => `<div style="color:var(--text-secondary);margin-top:2px;">${l}</div>`).join('');
            const arrow = header.querySelector('.expand-arrow');
            // Item name -> item detail (forward nav). stopPropagation so it does
            // not also toggle the card open/closed.
            const aboutItem = header.querySelector('.trade-about-item');
            if (aboutItem) {
                aboutItem.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const slug = aboutItem.getAttribute('data-about-slug');
                    if (slug) this._navigate('forward', () => this._openItemDetail(slug, aboutItem.getAttribute('data-about-quality') || ''));
                });
            }
            header.onclick = () => {
                const show = body.style.display === 'none';
                if (arrow) arrow.classList.toggle('expanded', show);
                if ($) { $(body).stop(true, true).slideToggle(160); } else { body.style.display = show ? 'block' : 'none'; }
            };
            card.append(header, body);
            // If this thread is about MY OWN open listing, offer a one-click
            // "Close out" that jumps to the listing's detail / close-out page.
            if (data && data.about_mine && data.about_listing_id != null) {
                const closeRow = document.createElement('div');
                closeRow.style.cssText = 'margin-top:8px;';
                const closeOut = btn('Close out this sale');
                closeOut.style.cssText = 'background:#3fa65a;border-color:#3fa65a;color:#fff;font-size:12px;padding:4px 12px;';
                closeOut.onclick = async (ev) => {
                    ev.stopPropagation();
                    closeOut.disabled = true;
                    let mine = [];
                    try { mine = (await api('GET', '/api/trading/listings')).listings || []; } catch (e) { /* */ }
                    const l = mine.find((x) => x.id === data.about_listing_id)
                        || { id: data.about_listing_id, item: d.item, qty: d.qty || 1,
                             price_coins: d.price_coins, note: d.note,
                             object_id: data.about_object_id, status: 'open' };
                    this._navigate('forward', () => this._openListingDetail(l));
                };
                closeRow.appendChild(closeOut);
                card.appendChild(closeRow);
            }
            c.appendChild(card);
        }

        // Counterpart contact methods (Discord / other) — surfaced so you can reach
        // them off-app, especially when they haven't enabled in-app messaging.
        let cprefs = [];
        try {
            const _cpTid = t.counterpart_trader_id || '';
            const _cpSite = _cpTid.includes(':') ? _cpTid.split(':')[0] : '';
            const _myOrigin = (((this.me && this.me.trader_id) || '').split(':')[0]) || '';
            const _cpRemote = !!_cpSite && _cpSite !== _myOrigin;
            const _url = `/api/trading/traders/${encodeURIComponent(t.counterpart || '')}`
                + (_cpRemote ? `?site=${encodeURIComponent(_cpSite)}&remote=1` : '');
            const td = await api('GET', _url);
            cprefs = (td && td.contact_prefs) || [];
        } catch (e) { /* unknown / remote trader → no prefs */ }
        const hereEntry = cprefs.find((p) => p.channel === 'here');
        const hereOn = hereEntry ? (hereEntry.enabled !== false) : true;
        const externals = cprefs.filter((p) => p.channel !== 'here' && p.value);
        if (externals.length) {
            const cpName = t.counterpart || '';
            const collapseKey = 'wsTradeOtherPlatforms:' + cpName;
            let startCollapsed = false;
            try { startCollapsed = localStorage.getItem(collapseKey) === '1'; } catch (e) { /* ignore */ }

            const cb = document.createElement('div');
            cb.style.cssText = 'position:relative;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;padding:8px 28px 8px 10px;margin-bottom:10px;font-size:13px;color:var(--text-secondary);';

            // X — collapses the banner into the "Other platforms ▾" chip beside
            // the username (reopenable anytime). Persisted per-counterpart.
            const xBtn = document.createElement('span');
            xBtn.textContent = '✕';
            xBtn.title = 'Hide (reopen via “Other platforms” next to their name)';
            xBtn.style.cssText = 'position:absolute;top:6px;right:8px;cursor:pointer;color:var(--text-secondary);font-size:13px;line-height:1;padding:2px;';

            const leadEl = document.createElement('div'); leadEl.style.marginBottom = '6px';
            leadEl.textContent = hereOn
                ? 'This user uses other platforms.'
                : 'This user uses other platforms (not in-app messaging).';
            cb.append(xBtn, leadEl);
            externals.forEach((p) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:4px;';
                const label = p.channel === 'discord' ? 'Discord' : (p.label || 'Other');
                const nameEl = document.createElement('span');
                nameEl.style.color = 'var(--text-primary)'; nameEl.style.flex = '1'; nameEl.style.wordBreak = 'break-word';
                nameEl.innerHTML = `<strong>${esc(label)}:</strong> ${esc(p.value)}`;
                const copyBtn = btn('Copy', 'secondary'); copyBtn.style.cssText = 'font-size:12px;padding:3px 8px;flex-shrink:0;';
                copyBtn.onclick = async () => {
                    try { await navigator.clipboard.writeText(p.value); toast('Copied'); }
                    catch (e) { toast('Copy failed'); }
                };
                row.append(nameEl, copyBtn);
                cb.appendChild(row);
            });
            c.appendChild(cb);

            // "Other platforms ▾" toggle chip next to the username — slides the
            // banner up/down so the user can see it anytime after closing it.
            const chip = document.createElement('span');
            chip.style.cssText = 'margin-left:8px;font-size:12px;color:var(--accent-primary);cursor:pointer;font-weight:600;white-space:nowrap;user-select:none;';
            chip.innerHTML = 'Other platforms <span class="expand-arrow" style="display:inline-block;">▼</span>';
            const syncChip = (shown) => {
                const ar = chip.querySelector('.expand-arrow');
                if (ar) ar.classList.toggle('expanded', shown);
            };
            const setShown = (show, persist) => {
                if ($) { show ? $(cb).stop(true, true).slideDown(160) : $(cb).stop(true, true).slideUp(160); }
                else { cb.style.display = show ? 'block' : 'none'; }
                if (persist) { try { localStorage.setItem(collapseKey, show ? '0' : '1'); } catch (e) { /* ignore */ } }
                syncChip(show);
            };
            chip.onclick = () => setShown(cb.style.display === 'none', true);
            xBtn.onclick = () => setShown(false, true);
            title.appendChild(chip);

            if (startCollapsed) cb.style.display = 'none';
            syncChip(!startCollapsed);
        }

        const log = document.createElement('div');
        // On DESKTOP the log is its own capped inner scroller. On MOBILE that
        // created a second scrollbar inside the already-scrolling .trading-page
        // overlay and shoved the composer below the fold behind the fixed tab
        // bar (and the inner scroll trapped touch gestures). So on mobile we drop
        // the cap/overflow entirely — the single outer overlay scroller handles
        // the whole thread, the composer is always reachable, and boundary
        // "scroll chaining" is inherent because there's only one scroller.
        const isMobile = !!(window.matchMedia && window.matchMedia('(max-width:768px)').matches);
        log.style.cssText = 'position:relative;display:flex;flex-direction:column;gap:2px;margin-bottom:12px;padding:4px;'
            + (isMobile ? '' : 'min-height:120px;max-height:min(42vh,360px);overflow-y:auto;');
        const msgs = data.messages || [];
        let firstUnreadEl = null;
        msgs.forEach((m, i) => {
            const ts = document.createElement('div');
            ts.style.cssText = 'align-self:center;font-size:10px;color:var(--text-secondary);margin-top:8px;';
            ts.textContent = fmtChatTime(m.created_at);
            if (i === data.first_unread_idx) firstUnreadEl = ts;
            const bubble = document.createElement('div');
            bubble.style.cssText = 'max-width:78%;padding:7px 10px;border-radius:10px;font-size:14px;white-space:pre-wrap;word-break:break-word;margin-top:3px;'
                + (m.mine ? 'align-self:flex-end;background:#3fa65a;color:#fff;' : 'align-self:flex-start;background:#2f6fb0;color:#fff;');
            bubble.innerHTML = mdInline(m.body);
            bubble.dataset.msgBubble = '1';
            log.append(ts, bubble);
            // Sender label only below the LAST message of a consecutive same-sender run.
            const sameNext = (i + 1 < msgs.length) && (!!msgs[i + 1].mine === !!m.mine);
            if (!sameNext) {
                const meta = document.createElement('div');
                meta.style.cssText = 'font-size:10px;color:var(--text-secondary);' + (m.mine ? 'align-self:flex-end;' : 'align-self:flex-start;');
                meta.textContent = m.mine ? 'You' : esc(m.from_name || t.counterpart || '');
                log.append(meta);
            }
        });

        // Append a message bubble IN PLACE (no full thread reload — reloading
        // flashed the whole view). Handles mine (green, right) and theirs (blue,
        // left), collapses the prior trailing same-side sender label into one
        // run, auto-links item names, and returns the bubble element. `hidden`
        // starts it invisible so the send animation can fly a ghost to its exact
        // final rect and reveal it on arrival.
        const appendMessage = (m, hidden) => {
            const sideEnd = !!m.mine;
            // Drop a prior trailing same-side meta so labels don't stack per send.
            const last = log.lastElementChild;
            if (last && (last.textContent === 'You' || last.textContent === esc(m.from_name || t.counterpart || ''))
                && last.style.alignSelf === (sideEnd ? 'flex-end' : 'flex-start')) {
                last.remove();
            }
            const ts = document.createElement('div');
            ts.style.cssText = 'align-self:center;font-size:10px;color:var(--text-secondary);margin-top:8px;';
            ts.textContent = fmtChatTime(m.created_at != null ? m.created_at : Date.now() / 1000);
            const bubble = document.createElement('div');
            bubble.style.cssText = 'max-width:78%;padding:7px 10px;border-radius:10px;font-size:14px;'
                + 'white-space:pre-wrap;word-break:break-word;margin-top:3px;'
                + (sideEnd ? 'align-self:flex-end;background:#3fa65a;color:#fff;'
                           : 'align-self:flex-start;background:#2f6fb0;color:#fff;')
                + (hidden ? 'opacity:0;' : '');
            bubble.innerHTML = mdInline(m.body);
            bubble.dataset.msgBubble = '1';
            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:10px;color:var(--text-secondary);'
                + (sideEnd ? 'align-self:flex-end;' : 'align-self:flex-start;');
            meta.textContent = sideEnd ? 'You' : esc(m.from_name || t.counterpart || '');
            log.append(ts, bubble, meta);
            try { this._autolinkNode(bubble, this._buildItemNameRegex && this._buildItemNameRegex()); } catch (e) { /* ignore */ }
            return bubble;
        };
        const appendMine = (bodyText) => appendMessage({ mine: true, body: bodyText, created_at: Date.now() / 1000 }, true);

        // Track rendered message ids so the 10s poller only appends genuinely new
        // ones (and never double-appends an optimistically-sent bubble, whose id
        // we add on send). Seed from the initial render.
        const seenMsgIds = new Set((data.messages || []).map((m) => m.id).filter((x) => x != null));
        c.appendChild(log);

        // Select any text in a message (yours or theirs) → a floating "Search
        // items" button appears; clicking it opens an item search for the
        // selection (plurals stripped) with owned qty + market prices.
        const selBtn = document.createElement('button');
        selBtn.type = 'button'; selBtn.textContent = '🔎 Search items';
        selBtn.style.cssText = 'position:fixed;z-index:10060;display:none;background:#FF4500;border:1px solid #FF4500;'
            + 'color:#fff;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);';
        c.appendChild(selBtn);  // lives in the content container, cleared on next render
        let selText = '';
        const refreshSelBtn = () => {
            const s = window.getSelection && window.getSelection();
            if (!s || s.isCollapsed) { selBtn.style.display = 'none'; return; }
            const txt = (s.toString() || '').trim();
            let node = s.anchorNode;
            if (node && node.nodeType === 3) node = node.parentNode;
            if (!txt || txt.length < 2 || !node || !log.contains(node)) { selBtn.style.display = 'none'; return; }
            selText = txt;
            try {
                const rect = s.getRangeAt(0).getBoundingClientRect();
                selBtn.style.top = `${Math.round(rect.bottom + 6)}px`;
                selBtn.style.left = `${Math.round(Math.max(6, Math.min(rect.left, window.innerWidth - 150)))}px`;
                selBtn.style.display = 'block';
            } catch (e) { selBtn.style.display = 'none'; }
        };
        log.addEventListener('mouseup', () => setTimeout(refreshSelBtn, 0));
        log.addEventListener('touchend', () => setTimeout(refreshSelBtn, 0));
        log.addEventListener('scroll', () => { selBtn.style.display = 'none'; });
        // Auto-detected item mentions (underlined) open the SAME per-quality item
        // search popup that the selection button opens.
        log.addEventListener('click', (e) => {
            const itEl = e.target.closest && e.target.closest('.trade-msg-item');
            if (itEl) { e.stopPropagation(); this._openSelectionItemSearch(itEl.getAttribute('data-item-term') || itEl.textContent || ''); }
        });
        // Scan rendered messages and underline recognized item names (best effort).
        this._autolinkItemsInLog(log);
        // On mobile the thread scrolls via the outer overlay (no inner log
        // scroll), so hide the floating button on that scroller too. this.el
        // persists across thread opens, so swap (not stack) the handler.
        if (this._selBtnScrollHandler) this.el.removeEventListener('scroll', this._selBtnScrollHandler);
        this._selBtnScrollHandler = () => { selBtn.style.display = 'none'; };
        this.el.addEventListener('scroll', this._selBtnScrollHandler, { passive: true });
        selBtn.onclick = (e) => { e.stopPropagation(); selBtn.style.display = 'none'; this._openSelectionItemSearch(selText); };

        const input = document.createElement('textarea');
        input.placeholder = 'Write a message…'; input.rows = 2;
        input.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        // Per-thread DRAFT: keep what you typed as you navigate away and back, so
        // a back-and-forth negotiation doesn't lose the half-written reply.
        const draftKey = 'wsTradeDraft:' + (t.thread_key || t.counterpart || '');
        let savedDraft = '';
        try { savedDraft = localStorage.getItem(draftKey) || ''; } catch (e) { /* ignore */ }
        if (savedDraft) input.value = savedDraft;
        // Prefill a friendly opener on a brand-new thread opened from "Message"
        // (only when there's no saved draft already).
        else if (prefillBody && !(data.messages && data.messages.length)) input.value = prefillBody;
        input.addEventListener('input', () => { try { localStorage.setItem(draftKey, input.value); } catch (e) { /* ignore */ } });
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:0.8em;color:var(--text-secondary);margin-top:6px;';
        hint.textContent = "They'll get a notification. Enter sends, Shift+Enter adds a line. Drafts are saved.";
        const send = btn('Send');
        send.style.marginTop = '10px';
        const sendIt = async () => {
            const body = input.value.trim();
            if (!body) return;
            if (!this._hereEnabled()) { alert('Enable “Here (in app messages)” in your trading settings to send messages.'); return; }
            // If the conversation never finished loading (e.g. the open raced a
            // deploy restart), we have no recipient — sending would hit the
            // backend's "to_name or to_trader_id required" 400 and surface it as
            // a confusing popup. Bail early with a clear, actionable message.
            if (!t.counterpart && !t.counterpart_trader_id) {
                alert(SERVER_UNAVAILABLE_MSG + '\n\nThis conversation hasn’t finished loading — reopen it and try again.');
                return;
            }
            send.disabled = true;
            try {
                const sres = await api('POST', '/api/trading/messages', {
                    to_name: t.counterpart,
                    to_trader_id: t.counterpart_trader_id || null,
                    body,
                    about_object_id: t.about_object_id || null,
                });
                try { localStorage.removeItem(draftKey); } catch (e) { /* ignore */ }
                // Mark the just-sent message as seen so the poller doesn't
                // re-append it on top of the optimistic bubble.
                const sentId = sres && sres.message && sres.message.id;
                if (sentId != null) seenMsgIds.add(sentId);
                // Append the sent bubble IN PLACE (no full reload -> no flash),
                // then fly a ghost from the composer to the bubble's exact size
                // and reveal it. Clear the composer + scroll to the new bubble.
                const bubble = appendMine(body);
                input.value = '';
                try { this._animateMessageSend(input, body, bubble, log); }
                catch (e) { if (bubble) bubble.style.opacity = '1'; }
                refreshTradingUnread();
                send.disabled = false;
                input.focus({ preventScroll: true });
            } catch (e) { alert(e.message); send.disabled = false; }
        };
        send.onclick = sendIt;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendIt(); } });
        if (!this._hereEnabled()) {
            input.disabled = true; input.placeholder = 'In-app messaging is off.'; send.disabled = true;
            hint.innerHTML = '<span style="color:var(--danger,#e06b6b);">In-app messaging is off — enable “Here (in app messages)” in Settings to send messages.</span>';
        }
        c.append(field('Message', input), hint, send);
        // Position the log at the bottom (newest), or — if there are unread
        // messages — pin the first unread to the top of the view. This MUST run
        // after the log is in its final DOM home: when opened via _navigate the
        // log is rendered off-screen and later re-parented into the host, and
        // re-parenting resets scrollTop to 0, so an in-render scroll is wiped.
        // We register it as a pending hook that _navigate runs post-flatten; on
        // the direct (non-animated) reload path we run it ourselves.
        const scrollLog = () => {
            if (isMobile) {
                // Mobile: the overlay (this.el) is the only scroller. Default to
                // the bottom so the composer/Send sits just above the fixed tab
                // bar (the overlay already reserves padding for it). If there are
                // unread messages, bring the first unread to just below the
                // sticky Trading header instead.
                const sc = this.el;
                if (firstUnreadEl) {
                    const hdrEl = this.el.querySelector('.trading-head');
                    const hdrH = (hdrEl ? hdrEl.offsetHeight : 0) + 8;
                    firstUnreadEl.style.scrollMarginTop = hdrH + 'px';
                    firstUnreadEl.scrollIntoView({ block: 'start' });
                } else {
                    sc.scrollTop = sc.scrollHeight;
                }
                return;
            }
            log.scrollTop = log.scrollHeight;
            if (firstUnreadEl) log.scrollTop = Math.max(0, firstUnreadEl.offsetTop - 4);
        };
        this._pendingScroll = scrollLog;
        requestAnimationFrame(() => {
            // Only self-scroll when NOT inside a navigation — otherwise _navigate
            // owns the scroll (post-flatten) and running here would scroll the
            // still-off-screen layer and then get reset.
            if (!this._navigating && this._pendingScroll === scrollLog) {
                this._pendingScroll = null;
                scrollLog();
            }
            // Auto-focus the composer (caret at end) WITHOUT scrolling the view.
            if (!input.disabled) {
                try { input.focus({ preventScroll: true }); const n = input.value.length; input.setSelectionRange(n, n); } catch (e) { /* ignore */ }
            }
        });

        // Poll this conversation every 10s for new messages and append them in
        // place (no reload). Self-stops once the log leaves the DOM (navigated
        // away). Guarded so overlapping ticks don't double-fetch. Only appends
        // messages whose id we haven't rendered (seenMsgIds), so it never
        // duplicates our own optimistic sends or already-shown messages.
        let _polling = false;
        this._threadPoller = setInterval(async () => {
            if (!document.body.contains(log)) {   // navigated away / view replaced
                clearInterval(this._threadPoller); this._threadPoller = null; return;
            }
            if (_polling) return;
            _polling = true;
            try {
                const fresh = await api('GET', '/api/trading/messages?thread=' + encodeURIComponent(t.thread_key));
                if (!document.body.contains(log)) return;   // raced with navigation
                const incoming = (fresh && fresh.messages) || [];
                const nw = incoming.filter((m) => m.id != null && !seenMsgIds.has(m.id));
                if (nw.length) {
                    const nearBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 60;
                    let gotTheirs = false;
                    for (const m of nw) {
                        seenMsgIds.add(m.id);
                        appendMessage(m, false);
                        if (!m.mine) gotTheirs = true;
                    }
                    // Keep view pinned to the newest if the user was already at the
                    // bottom; otherwise don't yank their scroll position.
                    if (nearBottom) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
                    if (gotTheirs) refreshTradingUnread();   // their reply arrived
                }
            } catch (e) { /* transient; retry next tick */ }
            finally { _polling = false; }
        }, 10000);
    }

    // Build (and cache) a case-insensitive regex matching any known item display
    // name on word boundaries, longest-first so multi-word names win. Names
    // shorter than 4 chars are skipped to avoid false positives in chat.
    _buildItemNameRegex() {
        if (this._itemNameRegex !== undefined) return this._itemNameRegex;
        const idx = window._tradingNameToKey || {};
        const names = Object.keys(idx).filter((n) => n && n.length >= 4);
        if (!names.length) { this._itemNameRegex = null; return null; }
        names.sort((a, b) => b.length - a.length);
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
            this._itemNameRegex = new RegExp('\\b(' + names.map(esc).join('|') + ')\\b', 'gi');
        } catch (e) { this._itemNameRegex = null; }
        return this._itemNameRegex;
    }

    // Scan rendered message bubbles and wrap recognized item names in an
    // underlined, clickable span (opens the same per-quality item search popup).
    _autolinkItemsInLog(log) {
        loadCatalogEntries().then(() => {
            const re = this._buildItemNameRegex();
            if (!re || !log) return;
            log.querySelectorAll('[data-msg-bubble]').forEach((b) => this._autolinkNode(b, re));
        }).catch(() => { /* best effort */ });
    }

    _autolinkNode(root, re) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                const p = n.parentNode;
                if (!p || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const tag = p.nodeName;
                if (tag === 'A' || tag === 'BUTTON') return NodeFilter.FILTER_REJECT;
                if (p.classList && p.classList.contains('trade-msg-item')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        const targets = [];
        let node;
        while ((node = walker.nextNode())) {
            re.lastIndex = 0;
            if (re.test(node.nodeValue)) targets.push(node);
        }
        targets.forEach((textNode) => {
            const text = textNode.nodeValue;
            const frag = document.createDocumentFragment();
            let last = 0; let mt;
            re.lastIndex = 0;
            while ((mt = re.exec(text)) !== null) {
                const start = mt.index; const end = start + mt[0].length;
                if (end === start) { re.lastIndex++; continue; }
                if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
                const span = document.createElement('span');
                span.className = 'trade-msg-item';
                span.textContent = mt[0];
                span.setAttribute('data-item-term', mt[0]);
                span.style.cssText = 'text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer;';
                frag.appendChild(span);
                last = end;
            }
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            if (last > 0 && textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
        });
    }

    // Item search from a selected message snippet. Normalizes the text (strips
    // simple plurals), finds matching catalog items, and shows each with your
    // owned qty + market estimate / lowest ask. Clicking a row opens item detail.
    async _openSelectionItemSearch(rawTerm) {
        const term = (rawTerm || '').trim();
        if (!term) return;
        const singular = (w) => {
            w = w.toLowerCase();
            if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
            if (w.length > 4 && /(ches|shes|xes|zes|sses)$/.test(w)) return w.slice(0, -2);
            if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
            return w;
        };
        const norm = term.toLowerCase();
        const words = norm.split(/\s+/).filter(Boolean);
        const terms = new Set([norm]);
        words.forEach((w) => terms.add(singular(w)));
        terms.add(words.map(singular).join(' '));
        const termList = [...terms].filter((x) => x && x.length >= 3);

        const label = term.length > 42 ? `${term.slice(0, 42)}…` : term;
        const m = this._modal(`Search items: “${esc(label)}”`, 580);
        const body = document.createElement('div');
        body.innerHTML = '<div style="color:var(--text-secondary);padding:8px;">Searching…</div>';
        m.panel.appendChild(body);

        let entries = [];
        try { entries = await loadCatalogEntries(); } catch (e) { /* empty */ }
        // Parse an optional quality word out of the term (e.g. "perfect spectral
        // sickle" → text "spectral sickle" + quality "perfect"), so a quality in
        // the selection filters the results to that tier.
        const pq = parseQuery(term);
        const qText = (pq.text || norm).toLowerCase();
        const qWords = qText.split(/\s+/).filter(Boolean);
        // Tight match: EVERY search word must appear in the item NAME (AND, not
        // OR), and we match the name ONLY — never the keyword/stat haystack. That
        // keeps "mangrove basket" to Mangrove baskets (not Big basket / Log
        // basket / Mangrove logs) and "eel trinket" from pulling in unrelated
        // items that merely share the 'trinket' keyword. Each word is singularized
        // so a plural selection ("baskets") still matches the singular name.
        const nameWords = qWords.map(singular).filter((w) => w && w.length >= 2);
        const wantTok = pq.quality ? (QUALITY_WORD_TO_TOKEN[pq.quality] || '') : null;

        // Prices keyed by "slug|quality-token" from the by-rarity price board.
        const priceByQ = {};
        try {
            const pr = await api('GET', '/api/trading/prices');
            (pr.prices || []).forEach((p) => { priceByQ[`${p.slug}|${p.quality || ''}`] = { estimate: p.estimate, lowest_ask: p.lowest_ask }; });
        } catch (e) { /* no prices */ }

        // Match PER-QUALITY catalog entries: require every search word in the
        // NAME (AND). When a quality was typed, keep only that tier (by variant
        // token or the item's intrinsic rarity for fixed-rarity gear).
        const matches = entries.filter((en) => {
            const slug = en.slug || en.key; if (!slug) return false;
            const nm = String(en.name || prettyName(slug)).toLowerCase();
            if (!nameWords.length || !nameWords.every((w) => nm.includes(w))) return false;
            if (wantTok != null) {
                const tok = en.quality || '';
                if (tok !== wantTok && rarityForToken(tok, slug) !== wantTok) return false;
            }
            return true;
        }).sort((a, b) => String(a.name).localeCompare(String(b.name))
            || String(a.quality).localeCompare(String(b.quality)));

        body.innerHTML = '';
        if (!matches.length) {
            body.innerHTML = `<div style="color:var(--text-secondary);padding:8px;">No tradable items match “${esc(label)}”.</div>`;
            return;
        }
        const CAP = 100;
        const shown = matches.slice(0, CAP);
        const list = document.createElement('div');
        list.style.cssText = 'max-height:60vh;overflow-y:auto;';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:0.75em;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.03em;';
        hdr.innerHTML = '<span style="width:32px;flex-shrink:0;"></span><span style="flex:1;">Item</span>'
            + '<span style="width:64px;text-align:right;">Owned</span>'
            + '<span style="width:90px;text-align:right;">Estimate</span>'
            + '<span style="width:90px;text-align:right;">Lowest ask</span>';
        list.appendChild(hdr);
        shown.forEach((en) => {
            const slug = en.slug || en.key;
            const tok = en.quality || '';
            const rar = rarityForToken(tok, slug);
            const qd = qualityDisplay(en.type, tok, slug);
            const price = priceByQ[`${slug}|${tok}`] || {};
            const row = document.createElement('div');
            row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;margin-bottom:3px;cursor:pointer;background:var(--rarity-${rar});border-left:3px solid var(--rarity-${rar}-border);`;
            row.innerHTML = `<img src="${esc(en.icon || '')}" width="32" height="32" class="trade-item-icon" data-icon-slug="${esc(slug)}" data-icon-token="${esc(tok)}" style="image-rendering:pixelated;flex-shrink:0;cursor:pointer;filter:${iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
                + `<span style="flex:1;min-width:0;"><strong>${esc(prettyName(slug))}</strong>${qd ? ` <span style="color:var(--rarity-${rar}-border,var(--text-secondary));font-size:.85em;">(${esc(qd)})</span>` : ''}</span>`
                + `<span style="width:64px;text-align:right;">${en.owned ? Number(en.owned).toLocaleString() : '<span style="color:var(--text-secondary);">0</span>'}</span>`
                + `<span style="width:90px;text-align:right;">${price.estimate != null ? this._coinInline(price.estimate, 16) : '<span style="color:var(--text-secondary);">—</span>'}</span>`
                + `<span style="width:90px;text-align:right;">${price.lowest_ask != null ? this._coinInline(price.lowest_ask, 16) : '<span style="color:var(--text-secondary);">—</span>'}</span>`;
            // Clicking the row opens item detail (for that quality); clicking the
            // icon is reserved for its stats popover (wired below).
            row.addEventListener('click', (e) => {
                if (e.target.closest('.trade-item-icon')) return;
                m.close(); this._navigate('forward', () => this._openItemDetail(slug, tok));
            });
            list.appendChild(row);
        });
        if (matches.length > CAP) {
            const more = document.createElement('div');
            more.style.cssText = 'padding:6px 8px;color:var(--text-secondary);font-size:0.85em;';
            more.textContent = `Showing the first ${CAP} of ${matches.length} — refine your selection.`;
            list.appendChild(more);
        }
        body.appendChild(list);
        // Icon hover → the shared item stats popover (same as the tables).
        list.querySelectorAll('.trade-item-icon').forEach((ic) => {
            const s = ic.getAttribute('data-icon-slug'); if (!s) return;
            const token = ic.getAttribute('data-icon-token');
            const type = (window._tradingTypeByKey && window._tradingTypeByKey[s]) || '';
            const qn = qualityDisplay(type, token, s) || null;
            wireDropAnchor(ic, prettyName(s), false, qn);
        });
    }

    /** Open a brand-new (or existing) thread with a trader about an object. Used
     *  by the "Message" button on Browse/Search listing cards. */
    startConversation(counterpart, aboutObjectId, toTraderId, meta) {
        const originTab = this.activeTab || 'browse'; // return here on Back
        this.activeTab = 'inbox';
        this.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'inbox'));
        const it = (meta && meta.item) || {};
        this._navigate('forward', () => this._openThread({ counterpart, about_object_id: aboutObjectId || null,
            counterpart_trader_id: toTraderId || null,
            return_tab: originTab,
            // Context for the composer header + prefill (sell/buy order details).
            about_side: meta && meta.side,
            about_slug: it.slug,
            about_type: it.type,
            about_quality: meta && (meta.side === 'buying' ? meta.quality_floor : it.quality),
            about_qty: meta && (meta.qty != null ? meta.qty : 1),
            about_price: meta && (meta.side === 'buying' ? meta.max_coins : meta.price_coins),
            prefill: true,
            thread_key: [counterpart, (this.me && this.me.in_game_name) || ''].sort().join('|') + (aboutObjectId ? ':' + aboutObjectId : '') }));
    }

    // ── Browse / Search ──────────────────────────────────────────────────
    _renderBrowse(c) {
        const _sf = loadBrowseFilters();   // persisted Browse/search filter state (per-browser)
        this._searchItemSlug = null;
        this._searchText = '';
        // Same interactive item picker (with header) as My Listings / Wishlist.
        // The picker already carries its own "Item" label + type-filter + sort, so
        // it is appended directly (no outer field, which caused a double "Item").
        const picked = document.createElement('span');
        picked.style.cssText = 'color:var(--text-secondary);margin-left:8px;';
        const setPickedLabel = (html) => {
            picked.innerHTML = html;
            const cl = picked.querySelector('[data-clear-item]');
            if (cl) cl.onclick = () => { this._searchItemSlug = null; this._searchText = ''; picked.innerHTML = ''; if (picker && picker.clear) picker.clear(); this._runSearch(); };
        };
        const picker = createItemPicker((m) => {
            this._searchItemSlug = m.slug;
            this._searchText = '';
            setPickedLabel(`<strong>${esc(prettyName(m.slug))}</strong> <button type="button" data-clear-item class="btn btn-secondary" style="font-size:11px;padding:1px 6px;margin-left:6px;">clear</button>`);
            this._runSearch();
        }, {
            // Free-text: typing a string (optionally with a quality word like
            // "willow perfect") and pressing Enter searches by text instead of
            // forcing a specific item pick.
            onEnter: (text) => {
                const t = (text || '').trim();
                this._searchItemSlug = null;
                this._searchText = t;
                setPickedLabel(t ? `Searching “<strong>${esc(t)}</strong>” <button type="button" data-clear-item class="btn btn-secondary" style="font-size:11px;padding:1px 6px;margin-left:6px;">clear</button>` : '');
                this._runSearch();
            },
            hideTypeFilter: true,
        });
        this._searchSide = createDropdown({ placeholder: 'All', options: [{ value: 'both', label: 'All' }, { value: 'selling', label: 'Selling' }, { value: 'buying', label: 'Buying' }], selected: [_sf.side || 'both'], onChange: () => this._runSearch() });
        this._searchOwned = createDropdown({ placeholder: 'Any', options: [{ value: '', label: 'Any' }, { value: 'true', label: 'Owned' }, { value: 'false', label: 'Not owned' }], selected: _sf.owned ? [_sf.owned] : [], onChange: () => this._runSearch() });
        // Result-level type filter kept (works even when no specific item is picked).
        this._searchType = createDropdown({ placeholder: 'Any type', options: TYPE_OPTIONS, multi: true, selected: _sf.types || [], onChange: () => this._runSearch() });
        this._searchSource = createDropdown({ placeholder: 'Any source', options: SOURCE_OPTIONS, multi: true, selected: _sf.sources || [], onChange: () => this._runSearch() });
        this._searchExpired = checkbox('Show expired', !!_sf.showExpired);
        this._searchExpired._cb.onchange = () => this._runSearch();
        this._searchExcludeMine = checkbox('Exclude my own', _sf.excludeMine !== false);
        this._searchExcludeMine._cb.onchange = () => this._runSearch();
        // Trader filter: searchable checkbox list of ALL traders (all checked by
        // default; uncheck to exclude). Roster is populated from search results.
        this._searchTrader = createTraderFilter({ onChange: () => this._runSearch() });
        this._searchTrader.setExcluded(_sf.traderExcluded || []);
        // Price range (coins) + hide-negotiable (rows with no listed price).
        this._searchMinPrice = textInput('min', { type: 'number', width: '85px', value: _sf.minPrice || '' });
        this._searchMaxPrice = textInput('max', { type: 'number', width: '85px', value: _sf.maxPrice || '' });
        this._searchMinPrice.addEventListener('input', () => this._runSearch());
        this._searchMaxPrice.addEventListener('input', () => this._runSearch());
        this._searchHideNegotiable = checkbox('Hide negotiable', !!_sf.hideNegotiable);
        this._searchHideNegotiable._cb.onchange = () => this._runSearch();
        // "Upgrades for me" (FAC-gated: trading_upgrades_filter) — show only sell
        // listings whose item is explicitly better than something you own
        // (simple static dominance, server-side).
        this._searchUpgrades = null;
        if (window._featureFlags && window._featureFlags.trading_upgrades_filter) {
            this._searchUpgrades = checkbox('Upgrades for me', !!_sf.upgradesForMe);
            this._searchUpgrades._cb.onchange = () => this._runSearch();
            this._searchUpgrades.title = 'Show only sell listings that are a strict stat upgrade over gear you already own.';
        }
        const go = btn('Search');
        go.onclick = () => {
            const t = (picker.input && picker.input.value || '').trim();
            // If the typed text isn't the label of a picked item, treat it as free text.
            if (t && !this._searchItemSlug) { this._searchText = t; }
            this._runSearch();
        };
        // Picker on its own row (it is wide + has its own labels); filters below.
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:0.78em;color:var(--text-secondary);margin:2px 0 0 2px;';
        hint.textContent = 'Tip: pick an item, or type a name (e.g. “willow perfect”) and press Enter.';
        c.appendChild(picker.el);
        c.appendChild(hint);
        c.appendChild(picked);
        const fType = field('Type', this._searchType.el);
        const fSource = field('Source', this._searchSource.el);
        const fSide = field('Side', this._searchSide.el);
        const fOwned = field('Owned', this._searchOwned.el);
        const fTrader = field('Trader', this._searchTrader.el);
        [fType, fSource, fSide, fOwned, fTrader].forEach((f) => { f.style.flex = '0 0 auto'; f.style.width = '170px'; });
        const priceWrap = document.createElement('div'); priceWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
        const _dash = document.createElement('span'); _dash.textContent = '–'; _dash.style.color = 'var(--text-secondary)';
        priceWrap.append(this._searchMinPrice, _dash, this._searchMaxPrice);
        const fPrice = field('Price (coins)', priceWrap); fPrice.style.flex = '0 0 auto';
        const controls = rowOf(fType, fSource, fSide, fOwned, fTrader, fPrice, this._searchExcludeMine, this._searchHideNegotiable, this._searchExpired, go);
        if (this._searchUpgrades) controls.insertBefore(this._searchUpgrades, go);
        // Keep rowOf's flex-wrap layout; only set the margin (do NOT overwrite
        // cssText — that wiped display:flex and stacked the filters vertically).
        controls.style.margin = 'var(--spacing-md,16px) 0';
        c.appendChild(controls);
        this._browseEmpty = document.createElement('div'); this._browseEmpty.style.cssText = 'color:var(--text-secondary);margin-top:10px;';
        this._browseTable = this._makeTradeTable('browse', {
            onMessage: (to, tid, about, row) => this.startConversation(to, about || null, tid || null, row),
            onBlock: (name, bb) => {
                if (bb._confirm) {
                    api('POST', '/api/trading/blocks', { name }).then(() => { refreshTradingUnread(); this._runSearch(); })
                        .catch((err) => { bb.textContent = 'Block'; alert(err.message); });
                } else {
                    bb._confirm = true; bb.textContent = `Block ${name}?`;
                    setTimeout(() => { if (bb) { bb._confirm = false; bb.textContent = 'Block'; } }, 3000);
                }
            },
        });
        this._browseTable.el.style.marginTop = '10px';
        c.append(this._browseEmpty, this._browseTable.el);
        // Deep-link from a popup "Search market" button: {slug, quality} (or a bare
        // slug). Pre-fill the item filter + label, then search.
        const pending = window._tradingPendingSearch;
        if (pending) {
            window._tradingPendingSearch = null;
            const pslug = (typeof pending === 'string') ? pending : pending.slug;
            if (pslug) {
                this._searchItemSlug = pslug;
                picked.innerHTML = `<strong>${esc(prettyName(pslug))}</strong> <button type="button" data-clear-item class="btn btn-secondary" style="font-size:11px;padding:1px 6px;margin-left:6px;">clear</button>`;
                picked.querySelector('[data-clear-item]').onclick = () => { this._searchItemSlug = null; picked.innerHTML = ''; this._runSearch(); };
            }
        }
        this._runSearch();
    }

    _saveBrowseFilters() {
        if (!this._searchSide) return;   // controls not built yet
        try {
            saveBrowseFilters({
                side: this._searchSide.getValue(),
                owned: this._searchOwned.getValue(),
                types: this._searchType.getValues(),
                sources: this._searchSource.getValues(),
                excludeMine: !!(this._searchExcludeMine && this._searchExcludeMine._cb.checked),
                hideNegotiable: !!(this._searchHideNegotiable && this._searchHideNegotiable._cb.checked),
                showExpired: !!(this._searchExpired && this._searchExpired._cb.checked),
                minPrice: (this._searchMinPrice && this._searchMinPrice.value) || '',
                maxPrice: (this._searchMaxPrice && this._searchMaxPrice.value) || '',
                traderExcluded: this._searchTrader && this._searchTrader.getExcluded ? Array.from(this._searchTrader.getExcluded()) : [],
                upgradesForMe: !!(this._searchUpgrades && this._searchUpgrades._cb.checked),
            });
        } catch (e) { /* ignore */ }
    }

    async _runSearch() {
        const tbl = this._browseTable;
        if (!tbl) return;
        this._saveBrowseFilters();   // persist current filter state (per-browser UI settings)
        const params = new URLSearchParams();
        // Server does side/owned/expired; type (category) + source are matched
        // client-side via the catalog maps so a crafted sword filters as both
        // category=gear AND source=crafted.
        const side = this._searchSide.getValue(); if (side) params.set('side', side);
        const owned = this._searchOwned.getValue(); if (owned) params.set('owned', owned);
        if (this._searchExpired && this._searchExpired._cb.checked) params.set('include_expired', 'true');
        if (this._searchUpgrades && this._searchUpgrades._cb.checked) params.set('upgrades', 'true');
        if (this._browseEmpty) this._browseEmpty.textContent = 'Searching…';
        try {
            const res = await api('GET', '/api/trading/search?' + params.toString());
            let rows = (res.results || []).slice();
            // Category + source filters (via slug maps).
            const cats = this._searchType ? this._searchType.getValues() : [];
            const srcs = this._searchSource ? this._searchSource.getValues() : [];
            if (cats.length || srcs.length) {
                rows = rows.filter((r) => {
                    const slug = (r.item || {}).slug;
                    if (cats.length) {
                        const cat = (window._tradingCategoryBySlug && window._tradingCategoryBySlug[slug]) || (r.item || {}).type;
                        if (!cats.includes(cat)) return false;
                    }
                    if (srcs.length) {
                        const ss = (window._tradingSourceBySlug && window._tradingSourceBySlug[slug]) || [];
                        if (!ss.some((s) => srcs.includes(s))) return false;
                    }
                    return true;
                });
            }
            // Specific picked item wins; otherwise apply free-text + quality.
            if (this._searchItemSlug) {
                rows = rows.filter((r) => (r.item || {}).slug === this._searchItemSlug);
            } else if (this._searchText) {
                const { text, quality } = parseQuery(this._searchText);
                rows = rows.filter((r) => rowMatchesText(r, text) && rowMatchesQuality(r, quality));
            }
            // Default-on "Exclude my own": drop rows that are mine (by trader_id,
            // or by in_game_name for local rows that predate trader_id).
            if (this._searchExcludeMine && this._searchExcludeMine._cb.checked) {
                const myId = this.me && this.me.trader_id;
                const myName = this.me && this.me.in_game_name;
                rows = rows.filter((r) => !((myId && r.trader_id === myId) || (!r.remote && myName && r.trader === myName)));
            }
            // Trader filter: populate the roster from the full result set (local +
            if (this._searchTrader && this._searchTrader.setTraders) {
                this._searchTrader.setTraders((res.results || [])
                    .filter((r) => r.trader)
                    .map((r) => ({
                        name: String(r.trader),
                        label: (r.display_name && r.display_name !== r.trader) ? `${r.display_name} (${r.trader})` : String(r.trader),
                    })));
                const excl = this._searchTrader.getExcluded();
                if (excl.size) rows = rows.filter((r) => !excl.has(String(r.trader || '')));
            }
            // Effective price per row: selling→price_coins, buying→max_coins.
            // null = "negotiable" (no price listed).
            const _effPrice = (r) => {
                const v = (r.side === 'buying') ? r.max_coins : r.price_coins;
                return (v != null && v > 0) ? v : null;
            };
            if (this._searchHideNegotiable && this._searchHideNegotiable._cb.checked) {
                rows = rows.filter((r) => _effPrice(r) != null);
            }
            const _minP = parseInt((this._searchMinPrice && this._searchMinPrice.value), 10);
            const _maxP = parseInt((this._searchMaxPrice && this._searchMaxPrice.value), 10);
            if (!isNaN(_minP) || !isNaN(_maxP)) {
                rows = rows.filter((r) => {
                    const p = _effPrice(r);
                    if (p == null) return false;  // a price bound can't apply to a negotiable row
                    if (!isNaN(_minP) && p < _minP) return false;
                    if (!isNaN(_maxP) && p > _maxP) return false;
                    return true;
                });
            }
            if (!rows.length) { tbl.el.style.display = 'none'; if (this._browseEmpty) this._browseEmpty.textContent = 'No matches.'; return; }
            if (this._browseEmpty) this._browseEmpty.textContent = '';
            tbl.el.style.display = '';
            tbl.setRows(rows);  // sorting handled by the table's clickable headers
        } catch (e) { tbl.el.style.display = 'none'; if (this._browseEmpty) this._browseEmpty.textContent = `Error: ${e.message}`; }
    }

    _resultCardHtml(r) {
        const it = r.item || {};
        const who = `${esc(r.display_name || r.trader)} <span style="color:var(--text-secondary);">(${esc(r.trader)})</span>`;
        const via = r.remote ? `<br><span style="color:var(--text-secondary);font-size:0.8em;">via ${esc(siteLabel(r.source_site))}</span>` : '';
        const badge = r.side === 'selling' ? '<span style="color:#5fb55f;">SELLING</span>' : '<span style="color:var(--accent-primary);">WANTS</span>';
        const price = r.price_coins != null ? `${Number(r.price_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins` : '';
        const maxc = r.max_coins != null ? `max ${Number(r.max_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins` : '';
        const q = (() => { const d = qualityDisplay(it.type, it.quality, it.slug); return d ? ` (${esc(d)})` : ''; })();
        const expired = r.is_expired ? ` <span style="color:var(--danger,#e06b6b);">· expired ${esc(this._daysAgo(r.expires_at))}</span>` : '';
        const noteHtml = r.note ? `<br><span style="color:var(--text-secondary);">“${esc(r.note)}”</span>` : '';
        const myName = (this.me && this.me.in_game_name) || null;
        const canMsg = !!r.trader && (r.remote || r.trader !== myName);
        const msgBtn = canMsg
            ? `<button type="button" class="btn btn-secondary" data-msg-to="${esc(r.trader)}" data-msg-tid="${esc(r.trader_id || '')}" data-msg-about="${esc(r.object_id || '')}" style="margin-top:6px;font-size:12px;padding:3px 8px;">Message</button>`
            : '';
        const canBlock = !!r.trader && r.trader !== myName;
        const blockBtn = canBlock
            ? `<button type="button" class="btn btn-secondary" data-block-to="${esc(r.trader)}" style="margin-top:6px;margin-left:6px;font-size:12px;padding:3px 8px;opacity:.8;">Block</button>`
            : '';
        // Match the My Listings row look: icon + rarity-tinted card + pretty name.
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const rarToken = (r.side === 'buying') ? r.quality_floor : it.quality;
        const rar = rarityForToken(rarToken, it.slug);
        return `<div style="${S_CARD}${r.is_expired ? 'opacity:.6;' : ''}background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);">`
            + `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
              <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <img src="${esc(icon)}" width="32" height="32" style="image-rendering:pixelated;margin:-6px;flex-shrink:0;" onerror="this.style.visibility='hidden'">
                <div><strong>${esc(prettyName(it.slug))}</strong>${q} <span style="color:var(--text-secondary);">${esc(it.type)}</span>${expired}<br>${badge} ${esc(price || maxc)}${noteHtml}</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">${who}${via}<br>${msgBtn}${blockBtn}</div></div></div>`;
    }

    // Lightweight centered modal overlay (gear-set-slot-popup style). Returns the
    // backdrop element; call close() to dismiss. `panel` is the content host.
    _modal(title, maxWidth = 420) {
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);'
            + 'display:flex;align-items:center;justify-content:center;padding:16px;';
        const panel = document.createElement('div');
        panel.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);'
            + `border-radius:10px;max-width:${maxWidth}px;width:100%;max-height:85vh;overflow-y:auto;`
            + 'box-shadow:0 12px 40px rgba(0,0,0,.6);padding:var(--spacing-md,16px);';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
        const h = document.createElement('strong'); h.textContent = title; h.style.color = 'var(--text-primary)';
        const x = btn('✕', 'secondary'); x.style.lineHeight = '1';
        head.append(h, x);
        panel.appendChild(head);
        backdrop.appendChild(panel);
        const close = () => {
            if (backdrop._closing) return;
            backdrop._closing = true;
            panel.style.animation = 'trade-pop-out 0.15s ease forwards';
            backdrop.style.transition = 'opacity 0.15s ease';
            backdrop.style.opacity = '0';
            setTimeout(() => backdrop.remove(), 160);
        };
        x.onclick = close;
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
        document.body.appendChild(backdrop);
        // Entrance animation — fade + scale in (CSS keyframe, plays reliably).
        panel.style.animation = 'trade-pop-in 0.18s ease';
        return { backdrop, panel, close };
    }

    // Promise-based confirm dialog built on _modal (resolves true/false).
    _confirm({ title, message, confirmLabel = 'Confirm', danger = true }) {
        return new Promise((resolve) => {
            const m = this._modal(title);
            const warn = document.createElement('div');
            warn.style.cssText = 'color:var(--text-secondary);margin-bottom:12px;';
            warn.textContent = message;
            const ok = btn(confirmLabel);
            if (danger) ok.className = 'btn btn-trade-danger';
            const cancel = btn('Cancel', 'secondary');
            m.panel.append(warn, rowOf(ok, cancel));
            let done = false;
            const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
            ok.onclick = () => finish(true);
            cancel.onclick = () => finish(false);
        });
    }

    async _bulkListDuplicates(bulkBtn, bulkMsg, refresh) {
        // Scan first so we can tell the user the count before the options popup.
        bulkBtn.disabled = true;
        bulkMsg.textContent = '';
        let entries = [];
        try { entries = await loadCatalogEntries(); } catch (e) { bulkMsg.textContent = 'Could not load catalog.'; bulkBtn.disabled = false; return; }
        let existing = new Set();
        try {
            const mine = (await api('GET', '/api/trading/listings')).listings || [];
            existing = new Set(mine.filter((l) => l.status === 'open' || !l.status)
                .map((l) => `${(l.item || {}).slug}|${(l.item || {}).quality || ''}`));
        } catch (e) { /* best effort */ }
        const candidates = entries.filter((e) => (e.owned || 0) >= 2
            && !existing.has(`${e.slug}|${e.quality || ''}`));
        bulkBtn.disabled = false;
        bulkMsg.textContent = '';
        if (!candidates.length) {
            bulkMsg.textContent = 'No un-listed duplicate items found (you need to own 2+ of a tradable item).';
            return;
        }

        // ── Config popup: filter which duplicates to list, then list them ───
        const m = this._modal('List duplicate items by filter', 560);
        const sub = document.createElement('div');
        sub.style.cssText = 'color:var(--text-secondary);font-size:0.85em;margin-bottom:12px;';
        sub.textContent = 'Lists one copy fewer than you own (keeps one) of each. Filters default to “any”; uncheck any row you don’t want. Changing a filter re-checks everything.';
        m.panel.appendChild(sub);

        // Filters list the FULL option sets (not just what you currently own) so
        // the controls are stable. Quality options are the tier/rarity pairs
        // (e.g. "Perfect/Legendary"); no selection in a dimension = any.
        const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
        const qualPairLabel = (t) => (t === 'fine' ? 'Fine' : `${CRAFTED_TOKEN_NAME[t] || cap(t)}/${cap(t)}`);
        const RARITY_FILTER_OPTS = [...RARITY_TOKENS, 'fine'].map((t) => ({ value: t, label: qualPairLabel(t) }));
        const fRarity = createDropdown({ placeholder: 'Any quality', options: RARITY_FILTER_OPTS, multi: true, onChange: () => renderList() });
        const fSource = createDropdown({ placeholder: 'Any source', options: SOURCE_OPTIONS, multi: true, onChange: () => renderList() });
        const fType = createDropdown({ placeholder: 'Any type', options: TYPE_OPTIONS, multi: true, onChange: () => renderList() });
        // Minimum owned filter: e.g. only items where you own >= N of that quality
        // ("show items I have >=2 legendary", ">=5 fine"). Floor is 2 (need a dupe).
        const fMinOwned = textInput('2', { type: 'number', width: '70px', value: '2' });
        fMinOwned.min = '2';
        fMinOwned.addEventListener('input', () => renderList());
        const filtersRow = rowOf(field('Quality / rarity', fRarity.el), field('Source', fSource.el), field('Type', fType.el), field('Min owned', fMinOwned));
        filtersRow.style.marginBottom = '6px';
        m.panel.appendChild(filtersRow);

        // Live preview of exactly what will be listed, each row with a checkbox.
        const countLine = document.createElement('div');
        countLine.style.cssText = 'color:var(--text-secondary);font-size:0.85em;margin:6px 0 4px;';
        // Check/uncheck-all toolbar above the list — easy bulk toggle either way.
        const selAllBtn = btn('Check all', 'secondary');
        const selNoneBtn = btn('Uncheck all', 'secondary');
        [selAllBtn, selNoneBtn].forEach((b) => { b.style.fontSize = '12px'; b.style.padding = '3px 10px'; });
        const selToolbar = rowOf(selAllBtn, selNoneBtn); selToolbar.style.margin = '0 0 6px';
        const listBox = document.createElement('div');
        // Capped short (~3-4 rows) so the List/Cancel buttons stay visible on a
        // fresh popup; the list scrolls when there are more matches.
        listBox.style.cssText = 'max-height:150px;overflow-y:auto;border:1px solid var(--border-color);border-radius:6px;padding:6px;margin-bottom:12px;';
        m.panel.append(countLine, selToolbar, listBox);
        const ridOf = (e) => `${e.slug}|${e.quality || ''}`;
        let checked = new Set();
        // Dim + italicize an unchecked row (animated via the row's CSS transition);
        // restore to full brightness/upright on re-check.
        const applyRowStyle = (label, on) => {
            if (!label) return;
            label.style.opacity = on ? '1' : '0.5';
            label.style.filter = on ? 'none' : 'grayscale(0.5) brightness(0.82)';
            label.style.fontStyle = on ? 'normal' : 'italic';
        };

        // List price: radio group.
        const priceWrap = document.createElement('div'); priceWrap.style.marginBottom = '12px';
        priceWrap.innerHTML = '<div style="' + S_LABEL + '">List price (applied to all)</div>';
        const priceModes = [
            ['none', 'No price (set later)'],
            ['value', 'Item value (what it\u2019s worth)'],
            ['historical', 'Historical average (from past sales)'],
        ];
        let priceMode = 'none';
        priceModes.forEach(([val, label]) => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;margin:4px 0;color:var(--text-primary);';
            const r = document.createElement('input'); r.type = 'radio'; r.name = 'bulkprice'; r.value = val; if (val === 'none') r.checked = true;
            r.onchange = () => { if (r.checked) priceMode = val; };
            const span = document.createElement('span'); span.textContent = label;
            row.append(r, span); priceWrap.appendChild(row);
        });
        m.panel.appendChild(priceWrap);

        // Note (applies to all).
        const noteEl = document.createElement('textarea');
        noteEl.rows = 2; noteEl.placeholder = 'Note applied to all (optional)';
        noteEl.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        m.panel.appendChild(field('Note (optional)', noteEl));

        const go = btn('List them'); const cancel = btn('Cancel', 'secondary');
        const actions = rowOf(go, cancel); actions.style.marginTop = '12px';
        const bulkPublicNote = document.createElement('div');
        bulkPublicNote.style.cssText = 'margin-top:10px;color:var(--text-secondary);font-size:0.72em;';
        bulkPublicNote.innerHTML = 'Listings are public within this instance.';
        m.panel.appendChild(bulkPublicNote);
        const pMsg = document.createElement('div'); pMsg.style.cssText = 'margin-top:8px;';
        m.panel.append(actions, pMsg);
        cancel.onclick = m.close;

        // Apply filters (empty dimension = any), re-check everything, and re-render.
        let _filtered = candidates.slice();
        const selected = () => _filtered.filter((e) => checked.has(ridOf(e)));
        const updateCount = () => {
            const n = selected().length;
            countLine.textContent = `${n} of ${_filtered.length} item${_filtered.length === 1 ? '' : 's'} selected (lists one fewer than you own, each).`;
            go.disabled = !n;
        };
        const renderList = () => {
            const rs = new Set(fRarity.getValues());
            const ss = new Set(fSource.getValues());
            const ts = new Set(fType.getValues());
            const minOwned = Math.max(2, parseInt(fMinOwned.value, 10) || 2);
            _filtered = candidates.filter((e) =>
                (e.owned || 0) >= minOwned
                && (!rs.size || rs.has(e.rarity))
                && (!ss.size || (e.sources || []).some((s) => ss.has(s)))
                && (!ts.size || ts.has(e.category || e.type)));
            checked = new Set(_filtered.map(ridOf)); // default: all checked per filter
            listBox.innerHTML = _filtered.map((e) => {
                const ic = (window._tradingIconBySlug && window._tradingIconBySlug[e.slug]) || '';
                const rar = e.rarity || rarityForToken(e.quality, e.slug);
                const q = qualityDisplay(e.type, e.quality, e.slug);
                const rid = ridOf(e);
                return `<label data-rid="${esc(rid)}" style="display:flex;align-items:center;gap:8px;padding:4px 6px;margin-bottom:3px;border-radius:4px;cursor:pointer;background:var(--rarity-${rar});border-left:3px solid var(--rarity-${rar}-border);transition:opacity .18s ease,filter .18s ease;">`
                    + `<input type="checkbox" data-rid="${esc(rid)}" checked style="accent-color:var(--accent-primary);flex-shrink:0;">`
                    + `<img src="${esc(ic)}" width="32" height="32" style="image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
                    + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(prettyName(e.slug))}${q ? ` <span style="color:var(--text-secondary);">(${esc(q)})</span>` : ''}</span>`
                    + `<span style="color:var(--text-secondary);flex-shrink:0;">×${e.owned - 1}</span></label>`;
            }).join('') || '<div style="color:var(--text-secondary);padding:4px;">No items match these filters.</div>';
            updateCount();
        };
        listBox.addEventListener('change', (ev) => {
            const cb = ev.target.closest('input[type="checkbox"]');
            if (!cb) return;
            const rid = cb.getAttribute('data-rid');
            if (cb.checked) checked.add(rid); else checked.delete(rid);
            applyRowStyle(cb.closest('label[data-rid]'), cb.checked);
            updateCount();
        });
        renderList();

        // Check/uncheck all currently-filtered rows (updates boxes, dim state, count).
        const setAll = (on) => {
            _filtered.forEach((e) => { const rid = ridOf(e); if (on) checked.add(rid); else checked.delete(rid); });
            listBox.querySelectorAll('input[type="checkbox"][data-rid]').forEach((cb) => {
                cb.checked = on;
                applyRowStyle(cb.closest('label[data-rid]'), on);
            });
            updateCount();
        };
        selAllBtn.onclick = () => setAll(true);
        selNoneBtn.onclick = () => setAll(false);

        go.onclick = async () => {
            const chosen = selected();
            if (!chosen.length) return;
            go.disabled = true; cancel.disabled = true;
            let averages = {};
            if (priceMode === 'historical') {
                try { averages = (await api('GET', '/api/trading/history/averages')).averages || {}; } catch (e) { /* */ }
            }
            const note = noteEl.value.trim();
            let listed = 0, failed = 0;
            // One batch call instead of N sequential POSTs (fast bulk add).
            const bodies = chosen.map((e) => {
                const body = { item: { slug: e.slug, type: e.type, quality: e.quality || '' }, qty: (e.owned - 1) };
                if (priceMode === 'value' && typeof e.coin === 'number' && e.coin > 0) body.price_coins = e.coin;
                else if (priceMode === 'historical' && averages[e.slug] != null) body.price_coins = averages[e.slug];
                if (note) body.note = note;
                return body;
            });
            try {
                const res = await api('POST', '/api/trading/listings/batch', { listings: bodies });
                listed = (res && typeof res.count === 'number') ? res.count : bodies.length;
                failed = bodies.length - listed;
            } catch (err) {
                failed = bodies.length;
            }
            m.close();
            bulkMsg.innerHTML = `<span style="color:#5fb55f;">Listed ${listed} duplicate gear/tool item${listed === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.</span>`;
            if (refresh) refresh();
        };
    }

    _daysAgo(epochSec) {
        if (!epochSec) return '';
        const days = Math.floor((Date.now() / 1000 - epochSec) / 86400);
        if (days <= 0) return 'today';
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    // Hours-aware relative time for the Prices columns ("just now" / "5m ago" /
    // "2h ago" / "3d ago"). (_daysAgo only resolves to whole days.)
    _agoShort(epochSec) {
        if (!epochSec) return '';
        const s = Math.floor(Date.now() / 1000 - Number(epochSec));
        if (s < 60) return 'just now';
        const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
        const d = Math.floor(h / 24); return `${d}d ago`;
    }

    // Coin value with the real coins icon (replaces the old 🪙 glyph), or an
    // em-dash when null. Default 20px inline; callers pass a larger size where it
    // stands alone (item-detail cards) or smaller in dense sublines.
    _coinInline(v, size = 20) {
        if (v == null) return '<span style="color:var(--text-secondary);">—</span>';
        return `<img src="/assets/icons/items/coins.svg" width="${size}" height="${size}" `
            + `style="vertical-align:middle;margin-right:4px;image-rendering:pixelated;" alt="coins">${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }

    // True when the current user has in-app ('here') messaging enabled — mirrors
    // the server's _has_here_pref: an explicit {enabled:false} 'here' entry is OFF;
    // no 'here' entry is ON only when the whole prefs list is empty (brand-new).
    _hereEnabled() {
        const prefs = (this.me && this.me.contact_prefs) || [];
        if (!Array.isArray(prefs)) return true;
        for (const p of prefs) {
            if (typeof p === 'string') { if (p.trim().toLowerCase() === 'here') return true; continue; }
            if (p && typeof p === 'object') {
                const v = (p.type || p.method || p.channel || '');
                const isHere = (typeof v === 'string' && v.trim().toLowerCase() === 'here') || p.here === true;
                if (isHere) return p.enabled !== false;
            }
        }
        return prefs.length === 0;
    }

    // ── Prices tab: market aggregates per item ─────────────────────────────
    async _renderPrices(c) {
        c.innerHTML = '<div style="color:var(--text-secondary);">Loading prices…</div>';
        let data = { prices: [] };
        try { data = await api('GET', '/api/trading/prices'); } catch (e) { /* empty state */ }
        c.innerHTML = '';
        const intro = document.createElement('div');
        intro.style.cssText = 'color:var(--text-secondary);font-size:0.82em;margin:0 2px 8px;';
        intro.textContent = 'Market estimate across all sites. Estimate & range appear once an item has at least one confirmed trade (signals: asks, bids, and sold prices).';
        c.appendChild(intro);
        const rows = data.prices || [];
        if (!rows.length) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:10px;color:var(--text-secondary);';
            d.textContent = 'No market activity yet.';
            c.appendChild(d);
            return;
        }

        // ── Filters (same applicable set as Browse) — Type, Source, Owned, Item
        // name, Price range. Side/Trader/Exclude-mine/Hide-negotiable/Expired
        // don't map to a per-item aggregate, so they're intentionally omitted.
        const pf = loadPricesFilters();
        const apply = () => this._applyPricesFilters();
        this._pfType = createDropdown({ placeholder: 'Any type', options: TYPE_OPTIONS, multi: true, selected: pf.types || [], onChange: apply });
        this._pfSource = createDropdown({ placeholder: 'Any source', options: SOURCE_OPTIONS, multi: true, selected: pf.sources || [], onChange: apply });
        this._pfOwned = createDropdown({ placeholder: 'Any', options: [{ value: '', label: 'Any' }, { value: 'true', label: 'Owned' }, { value: 'false', label: 'Not owned' }], selected: pf.owned ? [pf.owned] : [], onChange: apply });
        // Item search: the SAME rich picker used in Browse / My Listings (icon +
        // owned/value columns, type+source+sort). Picking an item filters to that
        // exact slug; free-text (typing / Enter) filters by name substring.
        this._pfSlug = pf.slug || null;
        this._pfNameText = pf.name || '';
        const pfPicker = createItemPicker((m) => {
            this._pfSlug = m.slug; this._pfNameText = '';
            apply();
        }, {
            hideTypeFilter: true,
            onEnter: (text) => { this._pfSlug = null; this._pfNameText = (text || '').trim(); apply(); },
        });
        this._pfPicker = pfPicker;
        // Typing filters live by name and clears any picked exact-item.
        pfPicker.input.addEventListener('input', () => {
            this._pfSlug = null; this._pfNameText = pfPicker.input.value.trim(); apply();
        });
        if (this._pfNameText) pfPicker.input.value = this._pfNameText;
        this._pfMinPrice = textInput('min', { type: 'number', width: '85px', value: pf.minPrice || '' });
        this._pfMaxPrice = textInput('max', { type: 'number', width: '85px', value: pf.maxPrice || '' });
        this._pfMinPrice.addEventListener('input', apply);
        this._pfMaxPrice.addEventListener('input', apply);

        const fType = field('Type', this._pfType.el);
        const fSource = field('Source', this._pfSource.el);
        const fOwned = field('Owned', this._pfOwned.el);
        [fType, fSource, fOwned].forEach((f) => { f.style.flex = '0 0 auto'; f.style.width = '170px'; });
        const priceWrap = document.createElement('div'); priceWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';
        const _dash = document.createElement('span'); _dash.textContent = '–'; _dash.style.color = 'var(--text-secondary)';
        priceWrap.append(this._pfMinPrice, _dash, this._pfMaxPrice);
        const fPrice = field('Est. price', priceWrap); fPrice.style.flex = '0 0 auto';
        const controls = rowOf(fType, fSource, fOwned, fPrice);
        controls.style.margin = 'var(--spacing-sm,8px) 0';
        c.appendChild(pfPicker.el);
        c.appendChild(controls);

        this._pricesAll = rows;
        this._pricesEmpty = document.createElement('div');
        this._pricesEmpty.style.cssText = 'padding:10px;color:var(--text-secondary);';
        this._pricesHost = document.createElement('div');
        c.append(this._pricesEmpty, this._pricesHost);
        this._applyPricesFilters();
    }

    // Re-filter the fetched price rows (client-side, same category/source/owned
    // logic as Browse) and rebuild the table.
    _applyPricesFilters() {
        if (!this._pricesHost) return;
        const cats = this._pfType ? this._pfType.getValues() : [];
        const srcs = this._pfSource ? this._pfSource.getValues() : [];
        const ownedF = this._pfOwned ? this._pfOwned.getValue() : '';
        const pickSlug = this._pfSlug || null;             // exact item picked
        const nameQ = (this._pfNameText || '').trim().toLowerCase(); // free-text name
        const minP = parseInt((this._pfMinPrice && this._pfMinPrice.value), 10);
        const maxP = parseInt((this._pfMaxPrice && this._pfMaxPrice.value), 10);
        try {
            savePricesFilters({
                types: cats, sources: srcs, owned: ownedF,
                slug: pickSlug || '', name: this._pfNameText || '',
                minPrice: (this._pfMinPrice && this._pfMinPrice.value) || '',
                maxPrice: (this._pfMaxPrice && this._pfMaxPrice.value) || '',
            });
        } catch (e) { /* ignore */ }
        const rows = (this._pricesAll || []).filter((r) => {
            const slug = r.slug;
            if (pickSlug && slug !== pickSlug) return false;
            if (cats.length) {
                const cat = (window._tradingCategoryBySlug && window._tradingCategoryBySlug[slug]) || r.type;
                if (!cats.includes(cat)) return false;
            }
            if (srcs.length) {
                const ss = (window._tradingSourceBySlug && window._tradingSourceBySlug[slug]) || [];
                if (!ss.some((s) => srcs.includes(s))) return false;
            }
            if (ownedF === 'true' || ownedF === 'false') {
                const owned = ownedCountFor(slug, r.quality || '') > 0;
                if ((ownedF === 'true') !== owned) return false;
            }
            if (!pickSlug && nameQ && !prettyName(slug).toLowerCase().includes(nameQ)
                && !String(slug).toLowerCase().includes(nameQ)) return false;
            // Price range applies to the effective market price (estimate, else lowest ask).
            if (!isNaN(minP) || !isNaN(maxP)) {
                const p = (r.estimate != null) ? r.estimate : r.lowest_ask;
                if (p == null) return false;
                if (!isNaN(minP) && p < minP) return false;
                if (!isNaN(maxP) && p > maxP) return false;
            }
            return true;
        });
        this._pricesHost.innerHTML = '';
        if (!rows.length) { this._pricesEmpty.textContent = 'No items match these filters.'; return; }
        this._pricesEmpty.textContent = '';
        this._pricesHost.appendChild(this._makePricesTable(rows));
    }

    _makePricesTable(rows) {
        const dash = '<span style="color:var(--text-secondary);">—</span>';
        const estCell = (r) => {
            if (r.estimate == null) return dash;
            const sub = `${r.n_prices} price${r.n_prices === 1 ? '' : 's'} · ${r.n_traded} traded`;
            return `<div><strong>${this._coinInline(r.estimate)}</strong></div>`
                + `<div style="color:var(--text-secondary);font-size:.78em;">${sub}</div>`;
        };
        const rangeCell = (r) => (r.range_min == null) ? dash
            : `${Number(r.range_min).toLocaleString(undefined, { maximumFractionDigits: 2 })}–${Number(r.range_max).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        const lastCell = (r) => {
            if (r.last_traded == null) return dash;
            return `<div>${this._coinInline(r.last_traded)}</div>`
                + (r.last_traded_at ? `<div style="color:var(--text-secondary);font-size:.78em;">${esc(this._agoShort(r.last_traded_at))}</div>` : '');
        };
        // Browse-style item cell: clickable icon (stats popover via wireDropAnchor)
        // + clickable name (opens item detail), coloured by this row's rarity. A
        // crafted item shows its quality suffix so each rarity row is distinct.
        const itemCell = (r) => {
            const icon = (window._tradingIconBySlug && window._tradingIconBySlug[r.slug]) || '';
            const rar = rarityForToken(r.quality, r.slug);
            const qDisp = qualityDisplay(r.type, r.quality, r.slug);
            const qSuffix = qDisp ? ` <span style="color:var(--rarity-${rar}-border,var(--text-secondary));font-size:.85em;">(${esc(qDisp)})</span>` : '';
            return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">`
                + `<img src="${esc(icon)}" width="32" height="32" class="trade-item-icon" data-icon-slug="${esc(r.slug)}" data-icon-token="${esc(r.quality || '')}" style="image-rendering:pixelated;flex-shrink:0;cursor:pointer;filter:${this._iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
                + `<strong class="trade-item-name" data-name-slug="${esc(r.slug)}" data-name-quality="${esc(r.quality || '')}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;color:var(--text-primary);">${esc(prettyName(r.slug))}</strong>${qSuffix}</div>`;
        };
        const NEG = -1;  // nulls sort below any real value
        const cols = [
            { key: 'name', label: 'Item', align: 'left', val: (r) => prettyName(r.slug).toLowerCase(), cell: itemCell },
            { key: 'estimate', label: 'Estimate', align: 'right', val: (r) => (r.estimate == null ? NEG : r.estimate), cell: estCell },
            { key: 'range', label: 'Range', align: 'right', val: (r) => (r.range_min == null ? NEG : r.range_min), cell: rangeCell },
            { key: 'lowest_ask', label: 'Lowest ask', align: 'right', val: (r) => (r.lowest_ask == null ? NEG : r.lowest_ask), cell: (r) => this._coinInline(r.lowest_ask) },
            { key: 'highest_bid', label: 'Highest bid', align: 'right', val: (r) => (r.highest_bid == null ? NEG : r.highest_bid), cell: (r) => this._coinInline(r.highest_bid) },
            { key: 'listings', label: 'Listings', align: 'right', val: (r) => (r.listings || 0), cell: (r) => String(r.listings || 0) },
            { key: 'last_traded', label: 'Last traded', align: 'right', val: (r) => (r.last_traded_at == null ? NEG : r.last_traded_at), cell: lastCell },
        ];
        const state = { key: 'listings', dir: 'desc' };
        const wrap = document.createElement('div'); wrap.style.cssText = 'overflow-x:auto;';
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0 4px;min-width:720px;';
        const thBase = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;'
            + 'letter-spacing:.04em;padding:4px 10px;cursor:pointer;user-select:none;white-space:nowrap;';
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        const hidden = this._loadHiddenCols('prices');
        cols.forEach((col) => {
            const th = document.createElement('th');
            th.setAttribute('data-col', col.key);
            th.style.cssText = thBase + `text-align:${col.align};`;
            th.onclick = () => {
                if (state.key === col.key) state.dir = (state.dir === 'asc' ? 'desc' : 'asc');
                else { state.key = col.key; state.dir = (col.key === 'name' ? 'asc' : 'desc'); }
                render();
            };
            htr.appendChild(th);
        });
        // Gear (far right) for column show/hide — item name is never hideable.
        const thGear = document.createElement('th'); thGear.setAttribute('data-col', 'gear');
        thGear.style.cssText = thBase + 'cursor:default;text-align:right;';
        thGear.appendChild(this._colGearButton('prices',
            cols.filter((cc) => cc.key !== 'name').map((cc) => ({ key: cc.key, label: cc.label })),
            hidden, () => this._applyColHiding(wrap, hidden)));
        htr.appendChild(thGear);
        thead.appendChild(htr);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody); wrap.appendChild(table);
        this._applyColHiding(wrap, hidden);

        const render = () => {
            Array.from(htr.children).forEach((th, i) => {
                const col = cols[i];
                if (!col) return;  // the trailing gear th has no cols entry
                const caret = state.key === col.key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
                th.textContent = col.label + caret;
            });
            const col = cols.find((cc) => cc.key === state.key) || cols[5];
            const sorted = rows.slice().sort((a, b) => {
                const av = col.val(a), bv = col.val(b);
                let cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : String(av).localeCompare(String(bv));
                return (state.dir === 'asc' ? 1 : -1) * cmp;
            });
            // Each row is tinted by its rarity (first cell carries the left accent
            // border + rounding, last cell rounds the right) — same as Browse rows.
            tbody.innerHTML = sorted.map((r) => {
                const rar = rarityForToken(r.quality, r.slug);
                const bg = `var(--rarity-${rar})`, border = `var(--rarity-${rar}-border)`;
                return '<tr>' + cols.map((cc, i) => {
                    const base = `padding:6px 10px;vertical-align:middle;text-align:${cc.align};background:${bg};`;
                    const style = i === 0
                        ? base + `border-left:4px solid ${border};border-top-left-radius:6px;border-bottom-left-radius:6px;`
                        : base;
                    return `<td data-col="${cc.key}" style="${style}">${cc.cell(r)}</td>`;
                }).join('') + `<td data-col="gear" style="padding:6px 10px;background:${bg};border-top-right-radius:6px;border-bottom-right-radius:6px;"></td></tr>`;
            }).join('');
            this._applyColHiding(wrap, hidden);
            // Wire the item-icon stats popover exactly like the Browse table.
            tbody.querySelectorAll('.trade-item-icon').forEach((ic) => {
                const slug = ic.getAttribute('data-icon-slug');
                if (!slug) return;
                const token = ic.getAttribute('data-icon-token');
                const type = (window._tradingTypeByKey && window._tradingTypeByKey[slug]) || '';
                const qname = qualityDisplay(type, token, slug) || null;
                wireDropAnchor(ic, prettyName(slug), false, qname);
            });
        };
        tbody.addEventListener('click', (e) => {
            // Item name → item detail (same affordance as the Browse table).
            const el = e.target.closest('.trade-item-name');
            if (el && el.dataset.nameSlug) this._navigate('forward', () => this._openItemDetail(el.dataset.nameSlug, el.dataset.nameQuality || ''));
        });
        render();
        return wrap;
    }

    // Market-summary cards pinned to the top of an item detail page — one card
    // each for Estimate, Lowest selling price, Highest buying price, Last traded,
    // and Traded (last 30 days). Matches the trading price-header mockup.
    _priceHeaderCard(price) {
        if (!price) return null;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;';
        const card = (label, valueHtml, sub) => {
            const d = document.createElement('div');
            d.style.cssText = 'flex:1 1 150px;min-width:150px;background:var(--bg-secondary);'
                + 'border:1px solid var(--border-color);border-radius:10px;padding:10px 14px;';
            d.innerHTML = `<div style="color:var(--text-secondary);font-size:.8em;">${esc(label)}</div>`
                + `<div style="font-size:1.3em;font-weight:700;margin-top:2px;">${valueHtml}</div>`
                + (sub ? `<div style="color:var(--text-secondary);font-size:.78em;margin-top:4px;">${sub}</div>` : '');
            return d;
        };
        // Estimate — median of all signals; subline names the sample size.
        const estSub = price.estimate != null
            ? `Median of ${price.n_prices} price${price.n_prices === 1 ? '' : 's'} from ${price.n_traders} trader${price.n_traders === 1 ? '' : 's'} · ${price.n_traded} traded`
            : 'Not enough data yet';
        wrap.appendChild(card('Estimate', this._coinInline(price.estimate), estSub));
        // Lowest selling price (lowest open ask) + how many sell listings exist.
        wrap.appendChild(card('Lowest selling price', this._coinInline(price.lowest_ask),
            `${price.listings || 0} listing${(price.listings === 1) ? '' : 's'}`));
        // Highest buying price (highest open bid) + how many buy listings exist.
        wrap.appendChild(card('Highest buying price', this._coinInline(price.highest_bid),
            `${price.buy_listings || 0} listing${(price.buy_listings === 1) ? '' : 's'}`));
        // Last traded coins + when.
        const lastSub = price.last_traded != null
            ? `each${price.last_traded_at ? ` · ${esc(this._agoShort(price.last_traded_at))}` : ''}`
            : '';
        wrap.appendChild(card('Last traded', this._coinInline(price.last_traded), lastSub));
        // Traded, last 30 days: count + avg coin price over the window.
        const t30 = price.trades_30d || 0;
        const t30Sub = t30 > 0
            ? `in ${t30} trade${t30 === 1 ? '' : 's'}${price.avg_30d != null ? ` · avg ${this._coinInline(price.avg_30d)}` : ''}`
            : 'no trades in 30 days';
        wrap.appendChild(card('Traded, last 30 days', String(t30), t30Sub));
        return wrap;
    }

    // ── Shared sortable table (Browse / My Listings / My Wishlist) ─────────
    // All three tabs render the SAME columns via a real <table> so columns line
    // up and headers are clickable to sort. Filtering comes later.
    _traderLabel(r, mode) {
        if (mode === 'listing' || mode === 'wishlist') return 'You';
        const disp = r.display_name || r.trader || '';
        const char = r.trader || '';
        const nameHtml = (char && char !== disp) ? `${esc(disp)} <span style="color:var(--text-secondary);">(${esc(char)})</span>` : esc(disp);
        // Clickable → trader page (sale history / listings / wishlist + Block).
        const base = char
            ? `<span class="trade-trader-name" data-trader="${esc(char)}" data-trader-id="${esc(r.trader_id || '')}" data-site="${esc(r.source_site || '')}" data-remote="${r.remote ? '1' : '0'}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;">${nameHtml}</span>`
            : nameHtml;
        const via = r.remote ? `<br><span style="color:var(--text-secondary);font-size:0.8em;">via ${esc(siteLabel(r.source_site))}</span>` : '';
        return base + via;
    }

    _expiresCell(r) {
        if (r.is_expired) return `<span style="color:var(--danger,#e06b6b);">expired ${esc(this._daysAgo(r.expires_at))}</span>`;
        if (!r.expires_at) return '—';
        const days = Math.ceil((r.expires_at - Date.now() / 1000) / 86400);
        return days <= 0 ? 'today' : `${days}d`;
    }

    // Relative "ago" string: "just now" / "5m ago" / "3h ago" / "2d ago".
    _agoShort(epochSec) {
        if (!epochSec) return '';
        const s = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        return `${Math.floor(s / 86400)}d ago`;
    }

    // First-listed time (created_at, epoch seconds). Shows relative "x hr/days
    _dateCell(r) {
        const ts = r.created_at;
        if (!ts) return '—';
        const d = new Date(ts * 1000);
        if (isNaN(d.getTime())) return '—';
        const abs = d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        return `<span title="${esc(abs)}">${esc(this._agoShort(ts).replace(/ ago$/, ''))}</span>`;
    }

    // Rarity drop-shadow outline (the "box-shadow for all qualities") inline, so
    // table icons get the same per-quality edge as the .item-row .item-icon CSS.
    _iconOutline(rar) {
        const b = `var(--rarity-${rar}-border)`;
        return `drop-shadow(1px 0 0 ${b}) drop-shadow(-1px 0 0 ${b}) drop-shadow(0 1px 0 ${b}) drop-shadow(0 -1px 0 ${b})`;
    }

    _qualityRank(r, isWishlist) {
        const it = r.item || {};
        const qToken = (isWishlist ? r.quality_floor : it.quality) || '';
        // Rank by what the Quality column actually shows: a quality TIER for
        // crafted/consumable/pet-egg items, otherwise the item's intrinsic rarity
        // (so ethereal gear sorts above rare gear instead of collapsing to "—").
        const token = QUALITY_BY_TYPE[it.type] ? qToken : rarityForToken(qToken, it.slug);
        // Unified ascending order: empty/Any first, then the rarity scale, then
        // the crafted tiers, then fine.
        const order = ['', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal',
                       'normal', 'good', 'great', 'excellent', 'perfect', 'eternal', 'fine'];
        const i = order.indexOf(token);
        return i < 0 ? 0 : i;
    }

    _isWishlistRow(r, mode) {
        return (mode === 'wishlist') || (mode === 'browse' && r.side === 'buying');
    }

    // Column definitions: label + sort value getter. 'actions' has no sort.
    // ── Column visibility (gear menu) ──────────────────────────────────────
    // Per-view show/hide of columns, persisted in localStorage. `viewKey` buckets
    // the preference (browse / listings / wishlist / prices / item-listings /
    // trader-listings). The item name + Browse Message + the actions column are
    // never hideable.
    _loadHiddenCols(viewKey) {
        try { return new Set(JSON.parse(localStorage.getItem(`tradingColsHidden:${viewKey}`) || '[]')); }
        catch (e) { return new Set(); }
    }
    _saveHiddenCols(viewKey, set) {
        try { localStorage.setItem(`tradingColsHidden:${viewKey}`, JSON.stringify([...set])); } catch (e) { /* ignore */ }
    }
    _applyColHiding(scopeEl, hidden) {
        if (!scopeEl) return;
        scopeEl.querySelectorAll('[data-col]').forEach((el) => {
            el.style.display = hidden.has(el.getAttribute('data-col')) ? 'none' : '';
        });
    }
    // Gear button + checkbox popover for toggling columns. `toggleable` is
    // [{key,label}]; `hidden` is the live Set; `onChange()` re-applies + persists.
    _colGearButton(viewKey, toggleable, hidden, onChange) {
        const holder = document.createElement('span');
        holder.style.cssText = 'position:relative;display:inline-block;';
        const gear = document.createElement('button');
        gear.type = 'button'; gear.title = 'Show / hide columns'; gear.setAttribute('aria-label', 'Show / hide columns');
        // Same gear SVG as the top-bar Settings button (index.html #settings-btn),
        // sized up so it's an easy tap target in the table header.
        gear.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="display:block;">'
            + '<path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>';
        gear.style.cssText = 'background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:2px;line-height:0;display:inline-flex;align-items:center;';
        const pop = document.createElement('div');
        pop.style.cssText = 'position:fixed;z-index:10060;background:var(--bg-secondary);'
            + 'border:1px solid var(--border-color);border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.55);'
            + 'padding:8px 10px;min-width:150px;display:none;text-transform:none;letter-spacing:normal;';
        toggleable.forEach(({ key, label }) => {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;gap:8px;align-items:center;padding:3px 0;cursor:pointer;font-size:12px;font-weight:400;color:var(--text-primary);white-space:nowrap;';
            const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !hidden.has(key);
            cb.style.accentColor = 'var(--accent-primary)';
            cb.onclick = (e) => e.stopPropagation();
            cb.onchange = () => {
                if (cb.checked) hidden.delete(key); else hidden.add(key);
                this._saveHiddenCols(viewKey, hidden);
                onChange();
            };
            const span = document.createElement('span'); span.textContent = label;
            lbl.append(cb, span); pop.appendChild(lbl);
        });
        gear.onclick = (e) => {
            e.stopPropagation();
            const show = pop.style.display === 'none';
            if (!show) { pop.style.display = 'none'; return; }
            // Fixed positioning off the gear's rect so the menu isn't clipped by
            // the table's overflow-x container.
            const rect = gear.getBoundingClientRect();
            pop.style.top = `${Math.round(rect.bottom + 4)}px`;
            pop.style.left = 'auto';
            pop.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
            pop.style.display = 'block';
            const close = (ev) => {
                if (!holder.contains(ev.target) && !pop.contains(ev.target)) {
                    pop.style.display = 'none';
                    document.removeEventListener('mousedown', close, true);
                }
            };
            document.addEventListener('mousedown', close, true);
        };
        holder.append(gear, pop);
        return holder;
    }
    // The hideable columns for a trade-table mode (everything except item /
    // Browse Message / actions). Labels mirror the header (minus the sort caret).
    _tradeToggleableCols(mode, opts = {}) {
        const out = [
            { key: 'quality', label: 'Quality' }, { key: 'type', label: 'Type' },
            { key: 'side', label: 'Side' }, { key: 'qty', label: 'Qty' },
            { key: 'price', label: 'Price each' }, { key: 'expires', label: 'Expires' },
            { key: 'listed', label: 'Listed' },
        ];
        if (mode === 'browse' && !opts.noTraderCol) out.push({ key: 'trader', label: 'Trader' });
        return out;
    }

    _tradeCols(mode, opts = {}) {
        const self = this;
        const cols = [
            { key: 'item', label: 'Item', val: (r) => prettyName((r.item || {}).slug || '').toLowerCase() },
            { key: 'quality', label: 'Quality', val: (r) => self._qualityRank(r, self._isWishlistRow(r, mode)) },
            { key: 'type', label: 'Type', val: (r) => ((r.item || {}).type || '') },
            { key: 'side', label: 'Side', val: (r) => (self._isWishlistRow(r, mode) ? 1 : 0) },
            { key: 'qty', label: 'Qty', val: (r) => (r.qty != null ? r.qty : 1) },
            { key: 'price', label: 'Price<br>each', val: (r) => (self._isWishlistRow(r, mode) ? (r.max_coins != null ? r.max_coins : -1) : (r.price_coins != null ? r.price_coins : -1)) },
            { key: 'expires', label: 'Expires', val: (r) => (r.expires_at || 0) },
            { key: 'listed', label: 'Listed', val: (r) => (r.created_at || 0) },
        ];
        // Browse gets a dedicated Message column (not sortable in a useful way).
        if (mode === 'browse') cols.push({ key: 'message', label: 'Message', val: () => 0, nosort: true });
        // Trader column only on Browse — My Listings / My Wishlist are all "You",
        // and the trader page suppresses it (opts.noTraderCol) since it's one trader.
        if (mode === 'browse' && !opts.noTraderCol) cols.push({ key: 'trader', label: 'Trader', val: (r) => String(r.display_name || r.trader || '').toLowerCase() });
        return cols;
    }

    _tradeRowTr(r, mode, idx, opts = {}) {
        const it = r.item || {};
        const isWishlist = this._isWishlistRow(r, mode);
        const qToken = isWishlist ? r.quality_floor : it.quality;
        const qDisp = qualityDisplay(it.type, qToken, it.slug);
        const rar = rarityForToken(qToken, it.slug);
        // Only quality-bearing item types (crafted / consumable / pet egg) have a
        // quality TIER. For everything else (gear / tools / loot) the meaningful
        // descriptor is the item's intrinsic rarity (Ethereal, Legendary, …) —
        // show that in the Quality column; plain "common"/unknown shows a dash.
        const hasQualityDim = !!QUALITY_BY_TYPE[it.type];
        const rarityName = (rar && rar !== 'common') ? (rar.charAt(0).toUpperCase() + rar.slice(1)) : '—';
        const qualityCell = isWishlist
            ? (hasQualityDim
                ? (r.quality_rule === 'this_or_better' ? `${esc(qDisp || 'Any')}+` : (qDisp ? esc(qDisp) : 'Any'))
                : rarityName)
            : (qDisp ? esc(qDisp) : rarityName);
        const sideCell = isWishlist
            ? '<span style="color:var(--accent-primary);">Wishlist</span>'
            : '<span style="color:#5fb55f;">Selling</span>';
        const qty = r.qty != null ? r.qty : 1;
        const _negotiable = '<em style="color:var(--text-secondary);">Negotiable</em>';
        // A max/price of 0 (or missing) means "no cap set" — show Negotiable, not
        const priceCell = isWishlist
            ? (r.max_coins != null && r.max_coins > 0 ? `≤ ${Number(r.max_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : _negotiable)
            : (r.price_coins != null && r.price_coins > 0 ? Number(r.price_coins).toLocaleString(undefined, { maximumFractionDigits: 2 }) : _negotiable);
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const noteHtml = r.note
            ? `<div class="sfc-disclosure trade-note" style="margin-top:3px;">`
              + `<div class="sfc-disclosure-header trade-note-toggle" style="margin-top:0;opacity:1;color:var(--text-secondary);font-size:0.82em;gap:4px;">`
              + `<span class="sfc-caret">▶</span><span>Note</span></div>`
              + `<div class="trade-note-body" style="display:none;color:var(--text-secondary);font-size:0.82em;margin-top:2px;white-space:pre-wrap;">“${esc(r.note)}”</div>`
              + `</div>`
            : '';

        let actions = '';
        let msgCell = '';
        if (mode === 'wishlist') {
            const mkMatch = r.match_count != null ? r.match_count : 0;
            const mkListed = r.listed_count != null ? r.listed_count : 0;
            const mkBtn = `<button data-market="${esc(it.slug || '')}" class="btn btn-secondary" title="Search the market for this item" style="font-size:12px;padding:3px 8px;line-height:1.3;text-align:left;flex-shrink:0;">🔎 ${mkMatch} match<br>${mkListed} listed</button>`;
            actions = `${mkBtn}<span style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">`
                + `<button data-wedit="${r.id}" class="btn btn-primary" style="font-size:12px;padding:3px 8px;">Edit</button>`
                + `<button data-renew="${r.id}" class="btn btn-primary" style="font-size:12px;padding:3px 8px;">Renew</button>`
                + `<button data-close="${r.id}" class="btn btn-trade-danger" style="font-size:12px;padding:3px 8px;">Close</button></span>`;
        } else if (mode === 'browse') {
            const myName = (this.me && this.me.in_game_name) || null;
            const canMsg = !!r.trader && (r.remote || r.trader !== myName);
            // Message lives in its own column; blocking now lives on the trader page
            // (click the trader name). No inline Block button here.
            msgCell = canMsg
                ? `<button type="button" class="btn btn-primary" data-msg-to="${esc(r.trader)}" data-msg-tid="${esc(r.trader_id || '')}" data-msg-about="${esc(r.object_id || '')}" style="font-size:12px;padding:3px 8px;">Message</button>`
                : '<span style="color:var(--text-secondary);">—</span>';
        } else {
            const mkMatch = r.match_count != null ? r.match_count : 0;
            const mkWished = r.wishlisted_count != null ? r.wishlisted_count : 0;
            const mkBtn = `<button data-market="${esc(it.slug || '')}" class="btn btn-secondary" title="See buyers wishlisting this item" style="font-size:12px;padding:3px 8px;line-height:1.3;text-align:left;flex-shrink:0;">🔎 ${mkMatch} match<br>${mkWished} wishlisted</button>`;
            actions = `${mkBtn}<span style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">`
                + `<button type="button" data-renew="${r.id}" class="btn btn-primary" style="font-size:12px;padding:3px 8px;">Renew</button>`
                + `<button type="button" data-close="${r.id}" class="btn btn-trade-danger" style="font-size:12px;padding:3px 8px;">Close</button>`
                + `<span style="color:var(--text-secondary);white-space:nowrap;">Details ›</span></span>`;
        }

        const bg = `var(--rarity-${rar})`;
        const border = `var(--rarity-${rar}-border)`;
        const trStyle = `${mode === 'listing' ? 'cursor:pointer;' : ''}${r.is_expired ? 'opacity:.6;' : ''}`;
        const cell = 'padding:6px 8px;vertical-align:middle;background:' + bg + ';';
        const first = `padding:6px 8px;vertical-align:middle;background:${bg};border-left:4px solid ${border};border-top-left-radius:6px;border-bottom-left-radius:6px;`;
        const last = `padding:6px 8px;vertical-align:middle;background:${bg};border-top-right-radius:6px;border-bottom-right-radius:6px;text-align:center;white-space:nowrap;`;
        return `<tr data-idx="${idx}" style="${trStyle}">`
            + `<td data-col="item" style="${first}"><div style="display:flex;align-items:center;gap:8px;min-width:0;">`
            + `<img src="${esc(icon)}" width="32" height="32" class="trade-item-icon" data-icon-slug="${esc(it.slug || '')}" data-icon-token="${esc(qToken || '')}" style="image-rendering:pixelated;flex-shrink:0;cursor:pointer;filter:${this._iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
            + `<div style="min-width:0;"><strong class="trade-item-name" data-name-slug="${esc(it.slug || '')}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;">${esc(prettyName(it.slug))}</strong></div></div>${noteHtml}</td>`
            + `<td data-col="quality" style="${cell}">${qualityCell}</td>`
            + `<td data-col="type" style="${cell}color:var(--text-secondary);">${(() => {
                const cat = (window._tradingCategoryBySlug && window._tradingCategoryBySlug[it.slug]) || it.type || '';
                const srcs = (window._tradingSourceBySlug && window._tradingSourceBySlug[it.slug]) || [];
                const srcLbl = srcs.length && srcs[0] !== 'other' ? ` <span style="font-size:0.85em;opacity:.8;">· ${esc(prettyName(srcs[0]))}</span>` : '';
                return esc(prettyName(cat)) + srcLbl;
            })()}</td>`
            + `<td data-col="side" style="${cell}">${sideCell}</td>`
            + `<td data-col="qty" style="${cell}">${qty}</td>`
            + `<td data-col="price" style="${cell}">${priceCell}</td>`
            + `<td data-col="expires" style="${cell}">${this._expiresCell(r)}</td>`
            + `<td data-col="listed" style="${cell}color:var(--text-secondary);">${this._dateCell(r)}</td>`
            + (mode === 'browse' ? `<td data-col="message" style="${cell}">${msgCell}</td>` : '')
            + (mode === 'browse' && !opts.noTraderCol ? `<td data-col="trader" style="${cell}">${this._traderLabel(r, mode)}</td>` : '')
            + `<td data-col="actions" style="${last}"><div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:nowrap;">${actions}</div></td></tr>`;
    }

    /**
     * Build a sortable table. handlers: { onRow(row), onRenew(id), onDelete(id),
     * onMessage(trader,tid,obj), onBlock(name,btnEl) }. Returns { el, setRows }.
     */
    _makeTradeTable(mode, handlers = {}, opts = {}) {
        this._sortState = this._sortState || {};
        const state = this._sortState[mode] || (this._sortState[mode] = { key: 'txn', dir: 'desc' });
        const cols = this._tradeCols(mode, opts);
        const viewKey = opts.viewKey || mode;
        const hidden = this._loadHiddenCols(viewKey);
        const wrap = document.createElement('div'); wrap.style.cssText = 'overflow-x:auto;';
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0 4px;min-width:900px;table-layout:fixed;';
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        const thBase = 'text-align:left;font-size:11px;font-weight:600;color:var(--text-secondary);'
            + 'text-transform:uppercase;letter-spacing:.04em;padding:4px 8px;cursor:pointer;user-select:none;white-space:nowrap;';
        // Fixed-layout column widths (percent). Content no longer resizes columns,
        // so expanding one row's note / confirm button never reflows the others.
        // Browse has extra Message + Trader columns and an (empty) actions cell;
        // My Listings / My Wishlist put the buttons in a wide actions cell.
        const _wBrowse = { item: 16, quality: 8, type: 10, side: 7, qty: 5, price: 9, expires: 7, listed: 7, message: 9, trader: 14, actions: 8 };
        const _wOwned = { item: 20, quality: 9, type: 11, side: 7, qty: 5, price: 10, expires: 7, listed: 7, actions: 24 };
        const colW = (mode === 'browse') ? _wBrowse : _wOwned;
        cols.forEach((col) => {
            const th = document.createElement('th');
            th.setAttribute('data-col', col.key);
            const w = colW[col.key];
            const wStyle = w ? `width:${w}%;` : '';
            if (col.nosort) {
                th.style.cssText = thBase + 'cursor:default;' + wStyle;
                th.innerHTML = col.label;
                htr.appendChild(th);
                return;
            }
            th.style.cssText = thBase + wStyle;
            const caret = state.key === col.key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
            th.innerHTML = col.label + caret;
            th.onclick = () => {
                if (state.key === col.key) state.dir = (state.dir === 'asc' ? 'desc' : 'asc');
                else { state.key = col.key; state.dir = 'asc'; }
                render();
            };
            htr.appendChild(th);
        });
        // Actions column header holds the gear (far right) for column show/hide.
        const thAct = document.createElement('th'); thAct.setAttribute('data-col', 'actions');
        thAct.style.cssText = thBase + 'cursor:default;text-align:right;' + (colW.actions ? `width:${colW.actions}%;` : '');
        const applyHiding = () => this._applyColHiding(wrap, hidden);
        thAct.appendChild(this._colGearButton(viewKey, this._tradeToggleableCols(mode, opts), hidden, applyHiding));
        htr.appendChild(thAct);
        thead.appendChild(htr);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody);
        wrap.appendChild(table);
        this._applyColHiding(wrap, hidden);  // header starts with the saved hidden cols applied

        let currentRows = [];
        // Table-local copy of the sorted rows so multiple tables of the same mode
        // (e.g. the two Browse-style tables in the item-detail view) don't clobber
        // each other's row index via the shared instance field.
        let tableRows = [];
        const render = () => {
            // Refresh header carets.
            Array.from(htr.children).forEach((th, i) => {
                if (i >= cols.length) return;
                const col = cols[i];
                const caret = state.key === col.key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
                th.innerHTML = col.label + caret;
            });
            const sorted = currentRows.slice();
            if (state.key === 'txn') {
                sorted.sort((a, b) => (state.dir === 'asc' ? 1 : -1) * ((a.txn_id || 0) - (b.txn_id || 0)));
            } else {
                const col = cols.find((c) => c.key === state.key);
                if (col) sorted.sort((a, b) => {
                    const av = col.val(a), bv = col.val(b);
                    let cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : String(av).localeCompare(String(bv));
                    return (state.dir === 'asc' ? 1 : -1) * cmp;
                });
            }
            this._tableRows = sorted;
            tableRows = sorted;
            tbody.innerHTML = sorted.map((r, i) => this._tradeRowTr(r, mode, i, opts)).join('');
            // Wire each item icon to the shared drop-item popover.
            tbody.querySelectorAll('.trade-item-icon').forEach((ic) => {
                const slug = ic.getAttribute('data-icon-slug');
                if (!slug) return;
                const token = ic.getAttribute('data-icon-token');
                const type = (window._tradingTypeByKey && window._tradingTypeByKey[slug]) || '';
                const qname = qualityDisplay(type, token, slug) || null;
                wireDropAnchor(ic, prettyName(slug), false, qname);
            });
            this._applyColHiding(wrap, hidden);
        };

        tbody.addEventListener('click', (e) => {
            // Expandable note — uses the app's standard .sfc-disclosure caret
            // (CSS rotates ▶→▼ via the .open class) so it matches every other
            // collapsible. stop(true,true) prevents animation-queue jiggle.
            const nt = e.target.closest('.trade-note-toggle');
            if (nt) {
                e.stopPropagation();
                const wrap = nt.closest('.sfc-disclosure');
                const body = (wrap || nt.parentElement).querySelector('.trade-note-body');
                const openNow = wrap ? wrap.classList.toggle('open') : true;
                if (body) { if ($) { $(body).stop(true, true).slideToggle(160); } else { body.style.display = openNow ? 'block' : 'none'; } }
                return;
            }
            // Item icon -> stats popover handled by wireDropAnchor (see render()).
            // Item name -> item history / sales / wishlists detail.
            const nameEl = e.target.closest('.trade-item-name');
            if (nameEl) {
                e.stopPropagation();
                this._navigate('forward', () => this._openItemDetail(nameEl.getAttribute('data-name-slug')));
                return;
            }
            // Trader name -> trader page (sale history / listings / wishlist + Block).
            const traderEl = e.target.closest('.trade-trader-name');
            if (traderEl) {
                e.stopPropagation();
                const tName = traderEl.getAttribute('data-trader');
                const tId = traderEl.getAttribute('data-trader-id');
                const tSite = traderEl.getAttribute('data-site') || '';
                const tRemote = traderEl.getAttribute('data-remote') === '1';
                this._navigate('forward', () => this._openTraderDetail(tName, tId, { site: tSite, remote: tRemote }));
                return;
            }
            const tr = e.target.closest('tr[data-idx]'); if (!tr) return;
            const row = tableRows[parseInt(tr.dataset.idx, 10)];
            if (!row) return;
            const renew = e.target.closest('[data-renew]');
            const del = e.target.closest('[data-del]');
            const closeB = e.target.closest('[data-close]');
            const wedit = e.target.closest('[data-wedit]');
            const market = e.target.closest('[data-market]');
            const mb = e.target.closest('[data-msg-to]');
            const bb = e.target.closest('[data-block-to]');
            if (market) { e.stopPropagation(); handlers.onMarket && handlers.onMarket(market.getAttribute('data-market')); return; }
            if (wedit) { e.stopPropagation(); handlers.onEdit && handlers.onEdit(row); return; }
            if (renew) { e.stopPropagation(); handlers.onRenew && handlers.onRenew(renew.getAttribute('data-renew')); return; }
            if (del) { e.stopPropagation(); handlers.onDelete && handlers.onDelete(del.getAttribute('data-del'), del); return; }
            if (closeB) { e.stopPropagation(); handlers.onClose && handlers.onClose(closeB.getAttribute('data-close'), closeB, row); return; }
            if (mb) { e.stopPropagation(); handlers.onMessage && handlers.onMessage(mb.getAttribute('data-msg-to'), mb.getAttribute('data-msg-tid'), mb.getAttribute('data-msg-about'), row); return; }
            if (bb) { e.stopPropagation(); handlers.onBlock && handlers.onBlock(bb.getAttribute('data-block-to'), bb); return; }
            if (mode === 'listing' && handlers.onRow) handlers.onRow(row);
        });

        return { el: wrap, setRows: (rows) => { currentRows = rows || []; render(); } };
    }

    // Compact search bar for the owned tabs (My Listings / My Wishlist): an item
    // picker + type filter (like Browse, minus Side). Returns { el, match(row) }.
    _listSearchBar(onChange) {
        let slug = null;
        let freeText = '';
        const wrap = document.createElement('div'); wrap.style.marginBottom = '8px';
        const picked = document.createElement('span'); picked.style.cssText = 'color:var(--text-secondary);margin-left:8px;';
        const picker = createItemPicker((m) => {
            slug = m.slug; freeText = '';
            picked.innerHTML = `<strong>${esc(prettyName(m.slug))}</strong> <button type="button" data-clear class="btn btn-secondary" style="font-size:11px;padding:1px 6px;margin-left:6px;">clear</button>`;
            picked.querySelector('[data-clear]').onclick = () => { slug = null; freeText = ''; picked.innerHTML = ''; picker.clear && picker.clear(); onChange && onChange(); };
            onChange && onChange();
        }, {
            // Free text (optionally with a quality word, e.g. "willow perfect").
            onEnter: (text) => {
                const t = (text || '').trim();
                slug = null; freeText = t;
                picked.innerHTML = t ? `Filter “<strong>${esc(t)}</strong>” <button type="button" data-clear class="btn btn-secondary" style="font-size:11px;padding:1px 6px;margin-left:6px;">clear</button>` : '';
                const cl = picked.querySelector('[data-clear]');
                if (cl) cl.onclick = () => { slug = null; freeText = ''; picked.innerHTML = ''; picker.clear && picker.clear(); onChange && onChange(); };
                onChange && onChange();
            },
            hideTypeFilter: true,
        });
        const typeDD = createDropdown({ placeholder: 'Any type', options: TYPE_OPTIONS, multi: true, onChange: () => onChange && onChange() });
        const sourceDD = createDropdown({ placeholder: 'Any source', options: SOURCE_OPTIONS, multi: true, onChange: () => onChange && onChange() });
        wrap.append(picker.el, picked);
        const row = rowOf(field('Type', typeDD.el), field('Source', sourceDD.el)); row.style.marginTop = '6px';
        wrap.appendChild(row);
        return {
            el: wrap,
            match: (r) => {
                const it = r.item || {};
                if (slug && it.slug !== slug) return false;
                if (freeText) {
                    const { text, quality } = parseQuery(freeText);
                    if (!rowMatchesText(r, text) || !rowMatchesQuality(r, quality)) return false;
                }
                const ts = typeDD.getValues();
                if (ts.length) {
                    const cat = (window._tradingCategoryBySlug && window._tradingCategoryBySlug[it.slug]) || it.type;
                    if (!ts.includes(cat)) return false;
                }
                const ss = sourceDD.getValues();
                if (ss.length) {
                    const srcs = (window._tradingSourceBySlug && window._tradingSourceBySlug[it.slug]) || [];
                    if (!srcs.some((s) => ss.includes(s))) return false;
                }
                return true;
            },
        };
    }

    // ── My Listings ──────────────────────────────────────────────────────
    async _renderListings(c) {
        // Top-of-page "new matches" banner (clears the My Listings badge on visit).
        const _matchHost = document.createElement('div'); c.appendChild(_matchHost);
        this._renderMatchBanner(_matchHost, 'listing');
        let selected = null;
        const picked = document.createElement('div');
        picked.style.cssText = 'margin:8px 0;color:var(--text-secondary);';
        picked.textContent = 'No item selected.';
        const picker = createItemPicker((m) => {
            selected = m;
            const ownN = (m && typeof m.owned === 'number') ? m.owned : null;
            picked.innerHTML = `<img src="${esc(m.icon)}" width="32" height="32" style="vertical-align:middle;image-rendering:pixelated;" onerror="this.style.display='none'"> Selected: <strong>${esc(m.label)}</strong> <span style="color:var(--text-secondary);">${esc(prettyName(m.type))}</span>`
                + (ownN != null ? ` <span style="color:var(--text-secondary);">· you own ${ownN}</span>` : '');
            // Auto-fill the listing price to the item's coin value (per item).
            if (m && typeof m.coin === 'number' && m.coin > 0) price.value = String(m.coin);
            updateMaxLink();
            updateTotal();
        }, { ownedOnly: true });
        const qty = textInput('1', { type: 'number', width: '80px', value: '1' });
        qty.min = '1';
        const price = textInput('coins', { type: 'number', width: '120px' });
        price.min = '0';
        price.step = '0.01';   // allow decimal per-item prices (total must be whole)
        // "Max NN" link above the qty box — fills qty with the owned count.
        const maxLink = document.createElement('button');
        maxLink.type = 'button';
        maxLink.style.cssText = 'display:none;background:none;border:none;color:var(--accent-primary);cursor:pointer;font-size:0.8em;padding:0;margin:0 0 2px;text-decoration:underline;align-self:flex-start;';
        const updateMaxLink = () => {
            const n = (selected && typeof selected.owned === 'number') ? selected.owned : null;
            if (n && n > 0) { maxLink.textContent = `Max ${n}`; maxLink.style.display = ''; }
            else { maxLink.style.display = 'none'; }
        };
        maxLink.onclick = () => {
            const n = (selected && typeof selected.owned === 'number') ? selected.owned : null;
            if (n && n > 0) { qty.value = String(n); updateTotal(); }
        };
        const note = document.createElement('textarea');
        note.placeholder = 'Note (optional) — e.g. "will trade for ore, or best offer"';
        note.rows = 2;
        note.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        const add = btn('List it');
        const notifyCtl = this._notifyControl(false, '🔔 Notify me when someone wishlists a matching item');
        const msg = document.createElement('div'); msg.style.marginTop = '8px';
        const expiryNote = document.createElement('div');
        expiryNote.style.cssText = 'margin-top:8px;color:var(--text-secondary);font-size:0.85em;';
        expiryNote.textContent = 'Orders expire after 7 days unless renewed.';
        const publicNote = document.createElement('div');
        publicNote.style.cssText = 'margin-top:4px;color:var(--text-secondary);font-size:0.72em;';
        publicNote.innerHTML = 'Listings are public within this instance.';

        // ── Top action bar: Create New Listing (toggles the form) + bulk button ──
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;';
        const createToggle = btn('+ Create New Listing');
        createToggle.className = 'btn btn-trade-green';
        const bulkBtn = btn('List duplicate items by…', 'secondary');
        // Colour it like a listing action (green) rather than the default dark button.
        bulkBtn.className = 'btn btn-trade-green';
        const delAllBtn = btn('Delete all', 'secondary');
        delAllBtn.className = 'btn btn-trade-danger';
        const renewAllBtn = btn('Renew all', 'secondary');
        renewAllBtn.className = 'btn btn-trade-blue';
        actionBar.append(createToggle, bulkBtn, renewAllBtn, delAllBtn);
        c.appendChild(actionBar);
        const bulkMsg = document.createElement('div'); bulkMsg.style.cssText = 'margin:0 0 8px;color:var(--text-secondary);font-size:0.85em;';
        c.appendChild(bulkMsg);

        // ── Collapsible "New listing" form (hidden until Create is clicked) ──
        const form = document.createElement('div');
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong'); title.textContent = 'New listing';
        const closeX = btn('✕', 'secondary'); closeX.setAttribute('aria-label', 'Close'); closeX.style.lineHeight = '1';
        header.append(title, closeX);
        form.appendChild(header);
        form.appendChild(picker.el);
        form.appendChild(picked);
        // Qty cell with the Max link above the input.
        const qtyCell = document.createElement('div');
        const qtyLabel = document.createElement('div'); qtyLabel.textContent = 'Qty'; qtyLabel.style.cssText = S_LABEL;
        const qtyStack = document.createElement('div'); qtyStack.style.cssText = 'display:flex;flex-direction:column;';
        qtyStack.append(maxLink, qty);
        qtyCell.append(qtyLabel, qtyStack);
        // Running total on the side.
        const priceTotal = document.createElement('div');
        priceTotal.style.cssText = 'font-weight:600;color:var(--text-primary);padding:7px 0;white-space:nowrap;';
        const totalCell = document.createElement('div');
        const totalLabel = document.createElement('div'); totalLabel.textContent = 'Total'; totalLabel.style.cssText = S_LABEL;
        totalCell.append(totalLabel, priceTotal);
        const updateTotal = () => {
            const q = parseInt(qty.value, 10); const p = coinParse(price.value);
            if (q > 0 && p != null && !isNaN(p)) {
                const whole = coinTotalWhole(p, q);
                const total = (Math.round(p * 100) * q) / 100;
                priceTotal.textContent = `${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`
                    + (whole ? '' : ' — total must be whole');
                priceTotal.style.color = whole ? 'var(--text-primary)' : 'var(--danger,#e06b6b)';
            } else {
                priceTotal.textContent = '—';
                priceTotal.style.color = 'var(--text-primary)';
            }
        };
        qty.addEventListener('input', updateTotal);
        price.addEventListener('input', updateTotal);
        const qtyPriceRow = rowOf(qtyCell, field('Listing price (coins, each)', price), totalCell);
        qtyPriceRow.style.marginTop = '8px';
        updateTotal();
        const noteField = field('Note (optional)', note); noteField.style.marginTop = '10px';
        notifyCtl.el.style.marginTop = '10px';
        const addRow = rowOf(add); addRow.style.marginTop = '10px';
        form.append(qtyPriceRow, noteField, notifyCtl.el, expiryNote, publicNote,
                    addRow, msg);  // List it at the bottom-left, below note + expiry
        const formCard = this._card(form);
        formCard.style.marginTop = '0'; formCard.style.marginBottom = '0';
        // Slide a zero-padding wrapper (not the padded card) so there's no top
        // "bump" during the animation.
        const slideWrap = document.createElement('div');
        slideWrap.style.cssText = 'display:none;overflow:hidden;';
        slideWrap.appendChild(formCard);
        c.appendChild(slideWrap);

        let _formOpen = false;
        const openForm = () => { _formOpen = true; createToggle.disabled = true; slideWrap.style.display = ''; slideShow(slideWrap); };
        const closeForm = () => { _formOpen = false; createToggle.disabled = false; slideHide(slideWrap, () => { slideWrap.style.display = 'none'; }); };
        createToggle.onclick = () => { if (_formOpen) closeForm(); else openForm(); };
        closeX.onclick = closeForm;

        const searchBar = this._listSearchBar(() => refresh());
        searchBar.el.style.marginTop = '10px';
        c.appendChild(searchBar.el);
        const showExpired = checkbox('Show expired');
        showExpired.style.margin = '10px 0 4px';
        c.appendChild(showExpired);
        const emptyMsg = document.createElement('div'); emptyMsg.style.cssText = 'color:var(--text-secondary);';
        const tbl = this._makeTradeTable('listing', {
            onRow: (l) => this._navigate('forward', () => this._openListingDetail(l)),
            onMarket: (slug) => { if (slug) { window._tradingPendingSearch = { slug }; this._switchTab('browse'); } },
            onRenew: async (id) => {
                try {
                    await api('POST', `/api/trading/listings/${id}/renew`, {});
                    toast('Renewed');
                    refresh();
                } catch (e) {
                    emptyMsg.textContent = 'Could not renew listing: ' + e.message;
                }
            },
            onClose: (id, btnEl, l) => {
                // "Close" asks whether the item sold. Yes -> open the detail page
                // to record the sale (coins/qty/buyer). No -> delete the listing
                // (two-click confirm inside the popup). No "cancel" state — a
                // listing is either sold (history) or removed.
                const m = this._modal('Did this item sell?');
                const q = document.createElement('div');
                q.style.cssText = 'color:var(--text-secondary);margin-bottom:12px;';
                const nm = l && l.item ? prettyName(l.item.slug) : 'this item';
                q.textContent = `Did “${nm}” sell? Choose Yes to record the sale, or No to just remove the listing.`;
                const yes = btn('Yes — record sale'); yes.style.cssText = 'background:#3fa65a;border-color:#3fa65a;color:#fff;';
                const no = btn('No — delete'); no.className = 'btn btn-trade-danger';
                const errLine = document.createElement('div');
                errLine.style.cssText = 'color:var(--danger,#e06b6b);margin-top:8px;font-size:0.85em;';
                m.panel.append(q, rowOf(yes, no), errLine);
                yes.onclick = () => { m.close(); if (l) this._navigate('forward', () => this._openListingDetail(l)); };
                no.onclick = async () => {
                    if (!no._confirm) {
                        no._confirm = true; no.textContent = 'Click again to delete';
                        setTimeout(() => { if (no.isConnected) { no._confirm = false; no.textContent = 'No — delete'; } }, 3000);
                        return;
                    }
                    no.disabled = true;
                    try {
                        await api('DELETE', `/api/trading/listings/${id}`);
                        m.close();
                        refresh();
                    } catch (e) { no.disabled = false; errLine.textContent = 'Could not delete: ' + e.message; }
                };
            },
        });
        c.append(emptyMsg, tbl.el);
        const refresh = async () => {
            let listings = [];
            try { listings = (await api('GET', '/api/trading/listings')).listings; } catch (e) { /* */ }
            const show = showExpired._cb.checked;
            // Only active (open) listings belong in My Listings. Closed listings
            // trade history, but should not clutter the active list.
            const visible = listings.filter((l) => (l.status === 'open' || !l.status)
                && (show || !l.is_expired) && searchBar.match(l));
            if (!visible.length) {
                tbl.el.style.display = 'none';
                const hiddenExpired = listings.length && !show;
                emptyMsg.textContent = hiddenExpired ? 'No matches — toggle “Show expired”, or clear the search.' : 'No listings match.';
            } else {
                emptyMsg.textContent = '';
                tbl.el.style.display = '';
                tbl.setRows(visible);
            }
        };
        showExpired._cb.onchange = refresh;
        bulkBtn.onclick = () => this._bulkListDuplicates(bulkBtn, bulkMsg, refresh);
        renewAllBtn.onclick = async () => {
            try {
                const res = await api('POST', '/api/trading/listings/renew-all', {});
                toast(`Renewed ${res.renewed != null ? res.renewed : ''}`.trim());
                refresh();
            } catch (e) { emptyMsg.textContent = 'Renew all failed: ' + e.message; }
        };
        delAllBtn.onclick = async () => {
            let mine = [];
            try { mine = (await api('GET', '/api/trading/listings')).listings || []; }
            catch (e) { emptyMsg.textContent = 'Could not load listings: ' + e.message; return; }
            const openOnes = mine.filter((l) => l.status === 'open' || !l.status);
            if (!openOnes.length) { emptyMsg.textContent = 'No active listings to delete.'; return; }
            if (!(await this._confirm({ title: 'Delete all listings?', message: `This permanently removes all ${openOnes.length} of your active listing${openOnes.length === 1 ? '' : 's'}. This cannot be undone.`, confirmLabel: 'Delete all' }))) return;
            try {
                const res = await api('POST', '/api/trading/listings/delete-all', {});
                emptyMsg.textContent = `Deleted ${res.deleted != null ? res.deleted : openOnes.length} listing${(res.deleted === 1) ? '' : 's'}.`;
            } catch (e) { emptyMsg.textContent = 'Delete all failed: ' + e.message; }
            refresh();
        };
        add.onclick = async () => {
            if (!selected) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Pick an item first.</span>'; return; }
            const item = { slug: selected.slug, type: selected.type, quality: selected.quality };
            const _p = coinParse(price.value);
            if (_p != null && isNaN(_p)) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Enter a valid price (a number ≥ 0).</span>'; return; }
            const _q = parseInt(qty.value, 10) || 1;
            if (!coinTotalWhole(_p, _q)) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Total (price × qty) must be a whole number of coins — adjust the price or quantity.</span>'; return; }
            const body = { item, qty: _q };
            if (note.value.trim()) body.note = note.value.trim();
            if (_p != null) body.price_coins = _p;
            if (notifyCtl.getNotify()) body.notify = true;
            try {
                const res = await api('POST', '/api/trading/listings', body);
                if (res.bank_warning) {
                    msg.innerHTML = `<span style="color:var(--warning,#e0b24a);">Listed — but this item isn't in your bank right now (it's in your ${esc(res.location)}). It isn't accessible to sell until you move it to the bank.</span> <button data-ignore class="btn btn-secondary" style="margin-left:8px;">Ignore</button>`;
                    msg.querySelector('[data-ignore]').onclick = async () => { try { await api('POST', '/api/trading/bank-ignore', { item_slug: item.slug }); msg.innerHTML = '<span style="color:var(--text-secondary);">Warning dismissed for this item.</span>'; } catch (e) { /* */ } };
                } else { msg.innerHTML = '<span style="color:#5fb55f;">Listed.</span>'; }
                refresh();
                if (!res.bank_warning) {
                    // Reset + collapse the form after a clean listing.
                    selected = null; picked.textContent = 'No item selected.';
                    qty.value = '1'; price.value = ''; note.value = '';
                    updateMaxLink(); updateTotal();
                    setTimeout(() => { if (_formOpen) closeForm(); msg.innerHTML = ''; }, 600);
                }
            } catch (e) { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        refresh();
    }

    _listingRowHtml(l) {
        const it = l.item || {};
        const price = l.price_coins != null ? `${Number(l.price_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins` : 'no price';
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const rar = rarityForToken(it.quality, it.slug);
        const qd = qualityDisplay(it.type, it.quality, it.slug);
        const expired = l.is_expired ? ` <span style="color:var(--danger,#e06b6b);">· expired ${esc(this._daysAgo(l.expires_at))}</span>` : '';
        const noteHtml = l.note ? `<br><span style="color:var(--text-secondary);">“${esc(l.note)}”</span>` : '';
        return `<div style="${S_CARD}cursor:pointer;${l.is_expired ? 'opacity:.6;' : ''}background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <img src="${esc(icon)}" width="28" height="28" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'">
                <div><strong>${esc(prettyName(it.slug))}</strong> ${qd ? '(' + esc(qd) + ') ' : ''}×${l.qty} — ${esc(price)}${expired}${noteHtml}<br>
                  <span style="color:var(--text-secondary);">${esc(it.type)} · ${esc(l.status)}</span></div>
              </div>
              <span style="color:var(--text-secondary);">Details ›</span></div></div>`;
    }

    async _openListingDetail(l) {
        const it = l.item || {};
        this._currentViewThunk = () => this._openListingDetail(l);
        const c = this._content();
        c.innerHTML = '';
        const back = btn('← Back'); back.onclick = () => this._goBack();
        c.appendChild(back);

        const card = document.createElement('div'); card.style.cssText = S_CARD; card.style.marginTop = '10px';
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;';
        head.innerHTML = `<img src="${esc(icon)}" width="36" height="36" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'">
            <h3 style="margin:0;">${esc(prettyName(it.slug))} <span style="color:var(--text-secondary);font-weight:normal;">${(() => { const d = qualityDisplay(it.type, it.quality, it.slug); return d ? '(' + esc(d) + ') · ' : ''; })()}${esc(prettyName(it.type))}</span></h3>`;
        card.appendChild(head);

        const qty = textInput('1', { type: 'number', width: '70px', value: String(l.qty) });
        const price = textInput('coins', { type: 'number', width: '120px', value: l.price_coins != null ? String(l.price_coins) : '' });
        price.min = '0'; price.step = '0.01';
        const noteEl = document.createElement('textarea');
        noteEl.rows = 2; noteEl.value = l.note || '';
        noteEl.placeholder = 'Note (optional)';
        noteEl.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        const save = btn('Save changes'); const renew = btn('Renew (7 days)'); const del = btn('Delete');
        del.className = 'btn btn-trade-danger';
        const msg = document.createElement('div'); msg.style.marginTop = '8px';
        const expiryLine = document.createElement('div');
        expiryLine.style.cssText = 'margin:4px 0;color:var(--text-secondary);font-size:0.85em;';
        expiryLine.textContent = l.is_expired
            ? `This listing expired ${this._daysAgo(l.expires_at)}. Renew to make it active again.`
            : 'Orders expire after 7 days unless renewed.';
        const editRow = rowOf(field('Qty', qty), field('Listing price (coins)', price));
        const editBtnRow = rowOf(save, renew, del); editBtnRow.style.marginTop = '10px';
        card.append(editRow, field('Note (optional)', noteEl), expiryLine, editBtnRow, msg);

        // ── Close out / mark sold -> trade history ──────────────────────────
        const closeWrap = document.createElement('div');
        closeWrap.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--border-color);';
        const soldCoins = textInput('coins', { type: 'number', width: '120px' });
        soldCoins.min = '0'; soldCoins.step = '0.01';
        // Inline total shown right next to the per-item coins field.
        const soldTotalInline = document.createElement('span');
        soldTotalInline.style.cssText = 'margin-left:8px;color:var(--text-secondary);font-size:0.9em;white-space:nowrap;';
        const soldForControl = document.createElement('div');
        soldForControl.style.cssText = 'display:flex;align-items:center;';
        soldForControl.append(soldCoins, soldTotalInline);
        // Quantity sold (defaults to the whole stack). Selling fewer than the
        // listed qty is a PARTIAL sale: the listing stays up at the reduced qty.
        const soldQty = textInput('1', { type: 'number', width: '90px', value: String(l.qty) });
        soldQty.min = '1'; soldQty.max = String(l.qty);
        // Secondary line: the per-item breakdown / partial-sale explanation (the
        // headline total also renders inline next to the coins field above).
        const totalLine = document.createElement('div');
        totalLine.style.cssText = 'margin:2px 0 6px;color:var(--text-secondary);font-size:0.85em;min-height:1em;';
        const recalcTotal = () => {
            const each = coinParse(soldCoins.value);
            let q = parseInt(soldQty.value, 10);
            if (isNaN(q) || q < 1) q = 0;
            if (q > l.qty) { q = l.qty; soldQty.value = String(l.qty); }
            if (each != null && !isNaN(each) && each > 0 && q > 0) {
                const whole = coinTotalWhole(each, q);
                const total = (Math.round(each * 100) * q) / 100;
                const totalStr = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
                const eachStr = each.toLocaleString(undefined, { maximumFractionDigits: 2 });
                soldTotalInline.innerHTML = `= <strong>${totalStr}</strong> total`;
                soldTotalInline.style.color = whole ? 'var(--text-secondary)' : 'var(--danger,#e06b6b)';
                totalLine.innerHTML = `${eachStr} each × ${q} = <strong>${totalStr}</strong> coins`
                    + (whole ? '' : ' <span style="color:var(--danger,#e06b6b);">— total must be a whole number</span>');
            } else {
                soldTotalInline.textContent = '';
                totalLine.textContent = l.qty > 1
                    ? `Price is per item. You have ${l.qty} listed; selling fewer keeps the listing open at the remaining qty.`
                    : 'Price is per item.';
            }
        };
        soldCoins.addEventListener('input', recalcTotal);
        soldQty.addEventListener('input', recalcTotal);

        // Traded-for: a searchable item picker (owned + not owned) -> row list.
        // Each selected item is a rarity-tinted row: a remove "×" on the LEFT of
        // the icon, the item icon (quality outline), the name, and a qty box.
        const tradedItems = [];
        const tradedList = document.createElement('div');
        tradedList.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:6px 0;';
        const renderTradedRows = () => {
            tradedList.innerHTML = '';
            tradedItems.forEach((ti, i) => {
                const rar = rarityForToken(ti.quality, ti.slug);
                const icon = (window._tradingIconBySlug && window._tradingIconBySlug[ti.slug]) || '';
                const qd = qualityDisplay(ti.type, ti.quality, ti.slug);
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;`
                    + `background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);`;
                const rm = document.createElement('button');
                rm.type = 'button'; rm.textContent = '×'; rm.title = 'Remove';
                rm.style.cssText = 'background:var(--danger,#e06b6b);border:none;color:#fff;border-radius:50%;'
                    + 'width:18px;height:18px;line-height:1;padding:0;font-size:12px;flex-shrink:0;cursor:pointer;';
                rm.onclick = () => { tradedItems.splice(i, 1); renderTradedRows(); };
                const img = document.createElement('img');
                img.src = icon; img.width = 24; img.height = 24;
                img.style.cssText = `image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rar)};`;
                img.onerror = function () { this.style.visibility = 'hidden'; };
                const nm = document.createElement('span');
                nm.style.cssText = 'flex:1;min-width:0;';
                nm.innerHTML = `<strong>${esc(prettyName(ti.slug))}</strong>`
                    + (qd ? ` <span style="color:var(--text-secondary);">(${esc(qd)})</span>` : '');
                const qtyIn = textInput('1', { type: 'number', width: '64px', value: String(ti.qty) });
                qtyIn.min = '1';
                qtyIn.title = 'Quantity';
                qtyIn.addEventListener('input', () => {
                    const v = parseInt(qtyIn.value, 10);
                    ti.qty = (isNaN(v) || v < 1) ? 1 : v;
                });
                row.append(rm, img, nm, qtyIn);
                tradedList.appendChild(row);
            });
        };
        const tradedPicker = createItemPicker((m) => {
            const existing = tradedItems.find((t) => t.slug === m.slug && (t.quality || '') === (m.quality || ''));
            if (existing) existing.qty += 1;
            else tradedItems.push({ slug: m.slug, type: m.type, quality: m.quality || '', qty: 1 });
            renderTradedRows();
        });

        // Sold-to: a typeable/searchable field. Suggests EVERYONE visible in
        // Browse/Search (all traders with an open listing or wishlist, local +
        // the in-app messaging. Any name can still be typed freely.
        const soldToInput = textInput('Buyer (type to search)', { width: '200px' });
        const soldToDL = document.createElement('datalist');
        soldToDL.id = 'trade-soldto-dl-' + (l.id || 'x');
        soldToInput.setAttribute('list', soldToDL.id);
        const myName = (this.me && this.me.in_game_name) || null;
        Promise.allSettled([
            api('GET', '/api/trading/inbox'),
            api('GET', '/api/trading/search?side=both'),
        ]).then(([inboxR, searchR]) => {
            const names = new Set();
            if (inboxR.status === 'fulfilled') {
                (inboxR.value.threads || []).forEach((t) => { if (t.counterpart) names.add(t.counterpart); });
            }
            if (searchR.status === 'fulfilled') {
                (searchR.value.results || []).forEach((r) => {
                    const n = r.display_name || r.trader;
                    if (n) names.add(n);
                });
            }
            if (myName) names.delete(myName); // don't suggest yourself
            soldToDL.innerHTML = Array.from(names).sort((a, b) => a.localeCompare(b))
                .map((n) => `<option value="${esc(n)}"></option>`).join('');
        }).catch(() => { /* no suggestions available */ });

        const closeBtn = btn('Mark sold'); closeBtn.style.cssText = 'background:#3fa65a;border-color:#3fa65a;color:#fff;';
        const closeMsg = document.createElement('div'); closeMsg.style.marginTop = '8px';
        const closeTitle = document.createElement('strong'); closeTitle.textContent = 'Close out';
        const closeHint = document.createElement('div');
        closeHint.style.cssText = 'color:var(--text-secondary);font-size:0.85em;margin:4px 0 8px;';
        closeHint.textContent = 'Record what it sold for — coins are PER ITEM (the total is shown next to it). '
            + 'To sell only part of a stack, set “Quantity sold” below the listed amount: the listing stays '
            + 'up at the remaining qty (no re-listing, so watchers aren’t re-alerted). Logs to trade history.';
        // Quantity sold sits on its own at the TOP of the panel (closest to the
        // item), with the money / trade / buyer fields in the row beneath — all
        // still column-aligned.
        const qtySoldField = field('Quantity sold', soldQty);
        qtySoldField.style.marginBottom = '8px';
        closeWrap.append(closeTitle, closeHint, qtySoldField,
            rowOf(field('Sold for (coins each)', soldForControl),
                  field('Traded for (search items)', tradedPicker.el), field('Sold to', soldToInput)),
            totalLine, soldToDL, tradedList,
            rowOf(closeBtn), closeMsg);
        card.appendChild(closeWrap);
        recalcTotal();

        closeBtn.onclick = async () => {
            let qSold = parseInt(soldQty.value, 10);
            if (isNaN(qSold) || qSold < 1) qSold = l.qty;
            if (qSold > l.qty) qSold = l.qty;
            const sold_for = {};
            // The coins field is per item; store the TOTAL on the history row.
            if (soldCoins.value.trim()) {
                const each = coinParse(soldCoins.value);
                if (each != null && isNaN(each)) {
                    closeMsg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Enter a valid coins value (a number ≥ 0).</span>';
                    return;
                }
                if (each != null && !coinTotalWhole(each, qSold)) {
                    closeMsg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Total (coins each × qty sold) must be a whole number of coins.</span>';
                    return;
                }
                if (each != null) sold_for.coins = (Math.round(each * 100) * qSold) / 100;
            }
            if (tradedItems.length) sold_for.items = tradedItems.map((t) => ({ slug: t.slug, type: t.type, quality: t.quality, qty: t.qty }));
            if (sold_for.coins == null && !sold_for.items) {
                closeMsg.innerHTML = '<span style="color:var(--warning,#e0b24a);">Enter coins and/or traded items first.</span>';
                return;
            }
            closeBtn.disabled = true;
            try {
                const res = await api('POST', `/api/trading/listings/${l.id}/close`,
                    { sold_for, sold_to: soldToInput.value.trim() || null, status: 'sold', qty_sold: qSold });
                if (res && res.partial) toast(`Sold ${res.qty_sold} — ${res.qty_remaining} still listed`);
                else toast('Marked sold');
                this._navigate('back', () => this._switchTab('listings'));
            } catch (e) { closeBtn.disabled = false; closeMsg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        save.onclick = async () => {
            try {
                const _p = price.value.trim() ? coinParse(price.value) : null;
                if (_p != null && isNaN(_p)) throw new Error('Enter a valid price (a number ≥ 0).');
                const _q = parseInt(qty.value, 10) || 1;
                if (!coinTotalWhole(_p, _q)) throw new Error('Total (price × qty) must be a whole number of coins.');
                await api('PUT', `/api/trading/listings/${l.id}`, {
                    qty: _q,
                    price_coins: _p,
                    note: noteEl.value.trim() || null,
                });
                msg.innerHTML = '<span style="color:#5fb55f;">Saved.</span>';
            } catch (e) { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        renew.onclick = async () => {
            try {
                await api('POST', `/api/trading/listings/${l.id}/renew`, {});
                l.is_expired = false;
                expiryLine.textContent = 'Orders expire after 7 days unless renewed.';
                toast('Renewed');
                msg.innerHTML = '<span style="color:#5fb55f;">Renewed — active for another 7 days.</span>';
            } catch (e) { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        del.onclick = () => {
            if (del._confirm) {
                api('DELETE', `/api/trading/listings/${l.id}`).then(() => this._navigate('back', () => this._switchTab('listings')))
                    .catch((e) => { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; });
            } else {
                del._confirm = true; del.textContent = 'Click again to confirm';
                setTimeout(() => { del._confirm = false; del.textContent = 'Delete'; }, 3000);
            }
        };
        c.appendChild(card);

        // Reveal panels — fetched lazily, slide open/closed.
        let detail = { listings: [], wishlists: [], history: [] };
        let recent = { history: [] };
        try { detail = await api('GET', `/api/trading/item?slug=${encodeURIComponent(it.slug)}`); } catch (e) { /* */ }
        try { recent = await api('GET', '/api/trading/history/recent'); } catch (e) { /* */ }
        c.appendChild(this._revealPanel('Sale history for this item', this._historyHtml(detail.history)));
        c.appendChild(this._revealPanel('Recent confirmed sales', this._historyHtml(recent.history)));
        // Wishlists panel with Link/Unlink controls for THIS listing.
        let links = { links: [] };
        try { links = await api('GET', `/api/trading/links?object_id=${encodeURIComponent(l.object_id)}`); } catch (e) { /* */ }
        const linkedSet = new Set((links.links || []).map((lk) => lk.wishlist_object_id));
        const wlPanel = this._revealPanel("Other players' wishlists for this item",
            this._wishlistsHtml(detail.wishlists, l.object_id, linkedSet));
        wlPanel.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-link-wishlist]');
            if (!b) return;
            e.stopPropagation();
            const woid = b.getAttribute('data-link-wishlist');
            const isLinked = b.getAttribute('data-linked') === '1';
            b.disabled = true;
            try {
                if (isLinked) {
                    await api('DELETE', `/api/trading/links?listing_object_id=${encodeURIComponent(l.object_id)}&wishlist_object_id=${encodeURIComponent(woid)}`);
                    b.textContent = 'Link'; b.setAttribute('data-linked', '0');
                } else {
                    await api('POST', '/api/trading/links', { listing_object_id: l.object_id, wishlist_object_id: woid });
                    b.textContent = 'Unlink'; b.setAttribute('data-linked', '1');
                }
                b.disabled = false;
            } catch (err) { b.disabled = false; alert(err.message); }
        });
        c.appendChild(wlPanel);
    }

    // Record-a-purchase page for a wishlist entry (opened from the "Did you buy
    // it?" modal). Mirrors the listing close-out form but in the BUYER
    // direction: "Bought for (coins each)" / "Bought from", posting to the
    // wishlist close endpoint which logs the trade with me as the buyer.
    async _openWishlistBuyDetail(w) {
        const it = w.item || {};
        this._currentViewThunk = () => this._openWishlistBuyDetail(w);
        const c = this._content();
        c.innerHTML = '';
        const back = btn('← Back'); back.onclick = () => this._goBack();
        c.appendChild(back);

        const card = document.createElement('div'); card.style.cssText = S_CARD; card.style.marginTop = '10px';
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;';
        const qTok = w.quality_floor || it.quality || '';
        head.innerHTML = `<img src="${esc(icon)}" width="36" height="36" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'">
            <h3 style="margin:0;">${esc(prettyName(it.slug))} <span style="color:var(--text-secondary);font-weight:normal;">${(() => { const d = qualityDisplay(it.type, qTok, it.slug); return d ? '(' + esc(d) + ') · ' : ''; })()}${esc(prettyName(it.type))}</span></h3>`;
        card.appendChild(head);

        const wantQty = (w.qty != null && w.qty > 0) ? w.qty : 1;
        const title = document.createElement('strong'); title.textContent = 'Record purchase';
        const hint = document.createElement('div');
        hint.style.cssText = 'color:var(--text-secondary);font-size:0.85em;margin:4px 0 8px;';
        hint.textContent = 'Record what you paid — coins are PER ITEM (the total is shown next to it). '
            + 'Buying fewer than you wanted keeps the wishlist entry open at the remaining qty. '
            + 'Logs to trade history with you as the buyer.';

        // Coins paid (per item) + inline total.
        const paidCoins = textInput('coins', { type: 'number', width: '120px' });
        paidCoins.min = '0'; paidCoins.step = '0.01';
        const paidTotalInline = document.createElement('span');
        paidTotalInline.style.cssText = 'margin-left:8px;color:var(--text-secondary);font-size:0.9em;white-space:nowrap;';
        const paidControl = document.createElement('div');
        paidControl.style.cssText = 'display:flex;align-items:center;';
        paidControl.append(paidCoins, paidTotalInline);

        const boughtQty = textInput('1', { type: 'number', width: '90px', value: String(wantQty) });
        boughtQty.min = '1'; boughtQty.max = String(wantQty);
        const totalLine = document.createElement('div');
        totalLine.style.cssText = 'margin:2px 0 6px;color:var(--text-secondary);font-size:0.85em;min-height:1em;';
        const recalc = () => {
            const each = coinParse(paidCoins.value);
            let q = parseInt(boughtQty.value, 10);
            if (isNaN(q) || q < 1) q = 0;
            if (q > wantQty) { q = wantQty; boughtQty.value = String(wantQty); }
            if (each != null && !isNaN(each) && each > 0 && q > 0) {
                const whole = coinTotalWhole(each, q);
                const total = (Math.round(each * 100) * q) / 100;
                const totalStr = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
                const eachStr = each.toLocaleString(undefined, { maximumFractionDigits: 2 });
                paidTotalInline.innerHTML = `= <strong>${totalStr}</strong> total`;
                paidTotalInline.style.color = whole ? 'var(--text-secondary)' : 'var(--danger,#e06b6b)';
                totalLine.innerHTML = `${eachStr} each × ${q} = <strong>${totalStr}</strong> coins`
                    + (whole ? '' : ' <span style="color:var(--danger,#e06b6b);">— total must be a whole number</span>');
            } else {
                paidTotalInline.textContent = '';
                totalLine.textContent = wantQty > 1
                    ? `Price is per item. You wanted ${wantQty}; buying fewer keeps the entry open at the remaining qty.`
                    : 'Price is per item.';
            }
        };
        paidCoins.addEventListener('input', recalc);
        boughtQty.addEventListener('input', recalc);

        // Traded-for: items YOU gave up (same picker/rows as the listing form).
        const tradedItems = [];
        const tradedList = document.createElement('div');
        tradedList.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:6px 0;';
        const renderTradedRows = () => {
            tradedList.innerHTML = '';
            tradedItems.forEach((ti, i) => {
                const rar = rarityForToken(ti.quality, ti.slug);
                const ic = (window._tradingIconBySlug && window._tradingIconBySlug[ti.slug]) || '';
                const qd = qualityDisplay(ti.type, ti.quality, ti.slug);
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;`
                    + `background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);`;
                const rm = document.createElement('button');
                rm.type = 'button'; rm.textContent = '×'; rm.title = 'Remove';
                rm.style.cssText = 'background:var(--danger,#e06b6b);border:none;color:#fff;border-radius:50%;'
                    + 'width:18px;height:18px;line-height:1;padding:0;font-size:12px;flex-shrink:0;cursor:pointer;';
                rm.onclick = () => { tradedItems.splice(i, 1); renderTradedRows(); };
                const img = document.createElement('img');
                img.src = ic; img.width = 24; img.height = 24;
                img.style.cssText = `image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rar)};`;
                img.onerror = function () { this.style.visibility = 'hidden'; };
                const nm = document.createElement('span');
                nm.style.cssText = 'flex:1;min-width:0;';
                nm.innerHTML = `<strong>${esc(prettyName(ti.slug))}</strong>`
                    + (qd ? ` <span style="color:var(--text-secondary);">(${esc(qd)})</span>` : '');
                const qtyIn = textInput('1', { type: 'number', width: '64px', value: String(ti.qty) });
                qtyIn.min = '1'; qtyIn.title = 'Quantity';
                qtyIn.addEventListener('input', () => { const v = parseInt(qtyIn.value, 10); ti.qty = (isNaN(v) || v < 1) ? 1 : v; });
                row.append(rm, img, nm, qtyIn);
                tradedList.appendChild(row);
            });
        };
        const tradedPicker = createItemPicker((m) => {
            const existing = tradedItems.find((t) => t.slug === m.slug && (t.quality || '') === (m.quality || ''));
            if (existing) existing.qty += 1;
            else tradedItems.push({ slug: m.slug, type: m.type, quality: m.quality || '', qty: 1 });
            renderTradedRows();
        });

        // Bought-from: typeable/searchable (same roster as the listing "Sold to").
        const fromInput = textInput('Seller (type to search)', { width: '200px' });
        const fromDL = document.createElement('datalist');
        fromDL.id = 'trade-boughtfrom-dl-' + (w.id || 'x');
        fromInput.setAttribute('list', fromDL.id);
        const myName = (this.me && this.me.in_game_name) || null;
        Promise.allSettled([
            api('GET', '/api/trading/inbox'),
            api('GET', '/api/trading/search?side=both'),
        ]).then(([inboxR, searchR]) => {
            const names = new Set();
            if (inboxR.status === 'fulfilled') (inboxR.value.threads || []).forEach((t) => { if (t.counterpart) names.add(t.counterpart); });
            if (searchR.status === 'fulfilled') (searchR.value.results || []).forEach((r) => { const n = r.display_name || r.trader; if (n) names.add(n); });
            if (myName) names.delete(myName);
            fromDL.innerHTML = Array.from(names).sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${esc(n)}"></option>`).join('');
        }).catch(() => { /* no suggestions */ });

        const buyBtn = btn('Mark bought'); buyBtn.style.cssText = 'background:#3fa65a;border-color:#3fa65a;color:#fff;';
        const msg = document.createElement('div'); msg.style.marginTop = '8px';
        const qtyField = field('Quantity bought', boughtQty); qtyField.style.marginBottom = '8px';
        card.append(title, hint, qtyField,
            rowOf(field('Bought for (coins each)', paidControl),
                  field('Traded for (search items)', tradedPicker.el), field('Bought from', fromInput)),
            totalLine, fromDL, tradedList, rowOf(buyBtn), msg);
        c.appendChild(card);
        recalc();

        buyBtn.onclick = async () => {
            let qBought = parseInt(boughtQty.value, 10);
            if (isNaN(qBought) || qBought < 1) qBought = wantQty;
            if (qBought > wantQty) qBought = wantQty;
            const bought_for = {};
            if (paidCoins.value.trim()) {
                const each = coinParse(paidCoins.value);
                if (each != null && isNaN(each)) {
                    msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Enter a valid coins value (a number ≥ 0).</span>';
                    return;
                }
                if (each != null && !coinTotalWhole(each, qBought)) {
                    msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Total (coins each × qty bought) must be a whole number of coins.</span>';
                    return;
                }
                if (each != null) bought_for.coins = (Math.round(each * 100) * qBought) / 100;
            }
            if (tradedItems.length) bought_for.items = tradedItems.map((t) => ({ slug: t.slug, type: t.type, quality: t.quality, qty: t.qty }));
            if (bought_for.coins == null && !bought_for.items) {
                msg.innerHTML = '<span style="color:var(--warning,#e0b24a);">Enter coins and/or traded items first.</span>';
                return;
            }
            buyBtn.disabled = true;
            try {
                const res = await api('POST', `/api/trading/wishlist/${w.id}/close`,
                    { bought_for, bought_from: fromInput.value.trim() || null, status: 'bought', qty_bought: qBought });
                if (res && res.partial) toast(`Bought ${res.qty_bought} — ${res.qty_remaining} still wanted`);
                else toast('Marked bought');
                this._navigate('back', () => this._switchTab('wishlist'));
            } catch (e) { buyBtn.disabled = false; msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
    }
    async _openTraderDetail(name, traderId, opts = {}) {
        const remote = !!(opts && opts.remote);
        const site = (opts && opts.site) || '';
        this._currentViewThunk = () => this._openTraderDetail(name, traderId, opts);
        const c = this._content();
        c.innerHTML = '<div style="color:var(--text-secondary);">Loading…</div>';
        let data = null;
        const url = `/api/trading/traders/${encodeURIComponent(name || '')}`
            + (remote && site ? `?site=${encodeURIComponent(site)}&remote=1`
               : (traderId ? `?tid=${encodeURIComponent(traderId)}` : ''));
        try { data = await api('GET', url); }
        catch (e) { /* 404 / remote-only trader → fall through to empty state */ }
        c.innerHTML = '';
        const back = btn('← Back'); back.onclick = () => this._goBack();
        c.appendChild(back);
        const myName = (this.me && this.me.in_game_name) || null;
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;';
        const title = document.createElement('strong');
        title.style.cssText = 'font-size:1.15em;color:var(--text-primary);';
        title.textContent = (data && data.display_name) || name || 'Trader';
        head.appendChild(title);
        // Copy the trader's IN-GAME name (what you type in the game), not the
        // display handle, so it pastes straight into the game.
        const copyName = (data && data.in_game_name) || name || '';
        if (copyName) head.appendChild(copyNameBtn(copyName, `Copy “${copyName}”`));
        if (remote && site) {
            const via = document.createElement('span');
            via.style.cssText = 'color:var(--text-secondary);font-size:0.85em;';
            via.textContent = `via ${siteLabel(site)}`;
            head.appendChild(via);
        }
        // Compare: viewer vs this trader (their wishlist vs my bank, cross-matches,
        // and — if they share inventory & are local — their owned items I lack).
        if (name && name !== myName) {
            const cmp = btn('Compare');
            cmp.className = 'btn btn-trade-blue';
            cmp.onclick = () => this._navigate('forward', () => this._openCompare(name, traderId, { site, remote }));
            head.appendChild(cmp);
        }
        if (name && name !== myName && !remote) {
            const blockBtn = btn('Block');
            blockBtn.className = 'btn btn-trade-danger';
            blockBtn.onclick = async () => {
                if (!(await this._confirm({ title: `Block ${name}?`, message: `You won't see ${name}'s listings or wishlists in Browse anymore. You can unblock later in Settings.`, confirmLabel: 'Block' }))) return;
                try { await api('POST', '/api/trading/blocks', { name }); refreshTradingUnread(); this._navigate('back', () => this._switchTab(this.activeTab || 'browse')); }
                catch (e) { alert('Block failed: ' + e.message); }
            };
            head.appendChild(blockBtn);
        }
        c.appendChild(head);

        if (!data) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:8px;color:var(--text-secondary);';
            d.textContent = "Couldn't load this trader's details.";
            c.appendChild(d);
            return;
        }

        const listings = data.listings || [];
        const wishlist = data.wishlist || [];
        const history = data.history || [];
        c.appendChild(this._revealPanel('Sale history', this._historyHtml(history), true));
        c.appendChild(this._revealPanel('Current sell listings',
            this._traderTradeTable(listings, 'No open sell listings.', name), true));
        c.appendChild(this._revealPanel('Wishlist',
            this._traderTradeTable(wishlist, 'No wishlist entries.', name)));
    }

    // Compare view: the viewer vs a trader. Shows how many of their wishlist the
    // viewer can fill from their bank, listing/wishlist cross-matches both ways,
    // and (only for a LOCAL trader who opted into inventory sharing) their owned
    // items the viewer lacks. Opened by the Compare button or the deep-link
    // #trading?compare=<name>[&site=&remote=1].
    async _openCompare(name, traderId, opts = {}) {
        const remote = !!(opts && opts.remote);
        const site = (opts && opts.site) || '';
        this._currentViewThunk = () => this._openCompare(name, traderId, opts);
        const c = this._content();
        c.innerHTML = '<div style="color:var(--text-secondary);">Comparing…</div>';
        let data = null;
        const url = `/api/trading/traders/${encodeURIComponent(name || '')}/compare`
            + (remote && site ? `?site=${encodeURIComponent(site)}&remote=1`
               : (traderId ? `?tid=${encodeURIComponent(traderId)}` : ''));
        try { data = await api('GET', url); } catch (e) { /* fall through to error state */ }
        c.innerHTML = '';
        const back = btn('← Back'); back.onclick = () => this._goBack();
        c.appendChild(back);
        if (!data) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:8px;color:var(--text-secondary);margin-top:12px;';
            d.textContent = "Couldn't load the comparison for this trader.";
            c.appendChild(d);
            return;
        }
        const disp = (data.target && (data.target.display_name || data.target.name)) || name || 'Trader';
        const s = data.summary || {};
        const buckets = data.buckets || {};
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;';
        const title = document.createElement('strong');
        title.style.cssText = 'font-size:1.15em;color:var(--text-primary);';
        title.textContent = `Compare with ${disp}`;
        head.appendChild(title);
        if (remote && site) {
            const via = document.createElement('span');
            via.style.cssText = 'color:var(--text-secondary);font-size:0.85em;';
            via.textContent = `via ${siteLabel(site)}`;
            head.appendChild(via);
        }
        // Copy a shareable link that opens THIS comparison for whoever clicks it.
        // keep the query-param form (the pretty path only resolves local handles).
        const cmpHandle = (data.target && (data.target.display_name || data.target.name)) || name || '';
        const cmpLink = (remote && site)
            ? `${location.origin}/?trading_compare=${encodeURIComponent(name || '')}`
                + `&trading_compare_site=${encodeURIComponent(site)}&trading_compare_remote=1#trading`
            : `${location.origin}/u/${encodeURIComponent(cmpHandle)}/compare`;
        const copyLink = btn('Copy link', 'secondary');
        copyLink.style.cssText = 'margin-left:auto;font-size:12px;padding:4px 10px;';
        copyLink.title = 'Copy a link that opens this comparison';
        copyLink.onclick = async () => {
            try { await navigator.clipboard.writeText(cmpLink); toast('Compare link copied'); }
            catch (e) { toast('Copy failed'); }
        };
        // Message the compared trader (available regardless of which compare
        // bucket has items). Skip when it's the viewer themself.
        const tgtName = (data.target && data.target.name) || name || '';
        const tgtTid = (data.target && data.target.trader_id) || traderId
            || (remote && site ? `${site}:${(data.target && data.target.uuid) || ''}` : null);
        const myName = (this.me && this.me.in_game_name) || null;
        if (tgtName && !(myName && tgtName === myName && !remote)) {
            const msgBtn = btn('Message');
            msgBtn.style.cssText = 'font-size:12px;padding:4px 10px;';
            msgBtn.title = `Message ${disp}`;
            msgBtn.onclick = () => this.startConversation(tgtName, null, tgtTid || null, null);
            head.appendChild(msgBtn);
        }
        head.appendChild(copyLink);
        c.appendChild(head);
        const headline = document.createElement('div');
        headline.style.cssText = S_CARD;
        headline.innerHTML = `<strong>You can fill ${s.fillable_from_bank || 0} of the ${s.their_wishlist_total || 0} item${(s.their_wishlist_total === 1) ? '' : 's'} they want from your bank.</strong>`;
        c.appendChild(headline);

        const _coinCell = (r) => (r.price_coins != null && r.price_coins > 0
            ? this._coinInline(r.price_coins) : '<em style="color:var(--text-secondary);">Negotiable</em>');
        const _num = (v) => String(v != null ? v : 0);
        c.appendChild(this._revealPanel(
            `Their wishlist you can fill from your bank (${s.fillable_from_bank || 0})`,
            this._compareTable(buckets.fillable || [], [
                { key: 'want', label: 'They want', align: 'right', val: (r) => (r.want_qty || 0), cell: (r) => _num(r.want_qty) },
                { key: 'have', label: 'You have', align: 'right', val: (r) => (r.my_bank_qty || 0), cell: (r) => _num(r.my_bank_qty) },
            ]), true));
        c.appendChild(this._revealPanel(
            `Items they're selling that you want (${s.they_sell_you_want || 0})`,
            this._compareTable(buckets.they_sell_you_want || [], [
                { key: 'price', label: 'Price (each)', align: 'right', val: (r) => (r.price_coins != null ? r.price_coins : -1), cell: _coinCell },
                { key: 'qty', label: 'They have', align: 'right', val: (r) => (r.qty || 0), cell: (r) => _num(r.qty) },
            ])));
        c.appendChild(this._revealPanel(
            `Items you're selling that they want (${s.you_sell_they_want || 0})`,
            this._compareTable(buckets.you_sell_they_want || [], [
                { key: 'price', label: 'Price (each)', align: 'right', val: (r) => (r.price_coins != null ? r.price_coins : -1), cell: _coinCell },
                { key: 'qty', label: 'You have', align: 'right', val: (r) => (r.qty || 0), cell: (r) => _num(r.qty) },
            ])));

        // "Their owned items you don't own" — only when they share inventory and
        // are local; otherwise explain why it's unavailable.
        let ownedBody;
        let ownedCount = '–';
        if (data.inventory_available) {
            ownedCount = s.their_owned_you_lack_count || 0;
            ownedBody = this._compareTable(buckets.their_owned_you_lack || [], [
                { key: 'qty', label: 'They have', align: 'right', val: (r) => (r.qty || 0), cell: (r) => _num(r.qty) },
            ]);
        } else {
            const reason = data.inventory_reason === 'remote'
                ? 'Full inventory comparison isn’t available for cross-site (federated) traders — only their listings and wishlist are shared.'
                : (data.inventory_reason === 'not_shared'
                    ? 'This trader hasn’t enabled inventory sharing, so their full bank is private.'
                    : 'No inventory data available for this trader.');
            ownedBody = document.createElement('div');
            ownedBody.style.cssText = 'padding:8px;color:var(--text-secondary);';
            ownedBody.textContent = reason;
        }
        c.appendChild(this._revealPanel(`Their owned items you don't own (${ownedCount})`, ownedBody));
    }

    // Simple icon + clickable-name list for the compare panels. extraFn(row)
    // Shared sortable table for the Compare panels — same look as the Browse /
    // Prices tables (rarity-tinted rows, clickable item icon + name). The Item
    // column is always first; `extraCols` are caller-supplied {key,label,align,
    // val(r),cell(r)} (e.g. "They want" / "You have"). Default sort is the first
    // extra column, descending.
    _compareTable(rows, extraCols = []) {
        if (!rows || !rows.length) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:8px;color:var(--text-secondary);';
            d.textContent = 'None.';
            return d;
        }
        const itemCell = (r) => {
            const icon = (window._tradingIconBySlug && window._tradingIconBySlug[r.slug]) || '';
            const rar = rarityForToken(r.quality, r.slug);
            const qDisp = qualityDisplay(r.type, r.quality, r.slug);
            const qSuffix = qDisp ? ` <span style="color:var(--rarity-${rar}-border,var(--text-secondary));font-size:.85em;">(${esc(qDisp)})</span>` : '';
            return `<div style="display:flex;align-items:center;gap:8px;min-width:0;">`
                + `<img src="${esc(icon)}" width="32" height="32" class="trade-item-icon" data-icon-slug="${esc(r.slug)}" data-icon-token="${esc(r.quality || '')}" style="image-rendering:pixelated;flex-shrink:0;cursor:pointer;filter:${this._iconOutline(rar)};" onerror="this.style.visibility='hidden'">`
                + `<strong class="trade-item-name" data-name-slug="${esc(r.slug)}" data-name-quality="${esc(r.quality || '')}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;color:var(--text-primary);">${esc(prettyName(r.slug))}</strong>${qSuffix}</div>`;
        };
        const cols = [{ key: 'name', label: 'Item', align: 'left', val: (r) => prettyName(r.slug).toLowerCase(), cell: itemCell }, ...extraCols];
        const state = { key: (extraCols[0] && extraCols[0].key) || 'name', dir: extraCols.length ? 'desc' : 'asc' };
        const wrap = document.createElement('div'); wrap.style.cssText = 'overflow-x:auto;';
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0 4px;min-width:420px;';
        const thBase = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;'
            + 'letter-spacing:.04em;padding:4px 10px;cursor:pointer;user-select:none;white-space:nowrap;';
        const thead = document.createElement('thead');
        const htr = document.createElement('tr');
        cols.forEach((col) => {
            const th = document.createElement('th');
            th.style.cssText = thBase + `text-align:${col.align};`;
            th.onclick = () => {
                if (state.key === col.key) state.dir = (state.dir === 'asc' ? 'desc' : 'asc');
                else { state.key = col.key; state.dir = (col.key === 'name' ? 'asc' : 'desc'); }
                render();
            };
            htr.appendChild(th);
        });
        thead.appendChild(htr);
        const tbody = document.createElement('tbody');
        table.append(thead, tbody); wrap.appendChild(table);
        const render = () => {
            Array.from(htr.children).forEach((th, i) => {
                const col = cols[i];
                const caret = state.key === col.key ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '';
                th.textContent = col.label + caret;
            });
            const col = cols.find((cc) => cc.key === state.key) || cols[0];
            const sorted = rows.slice().sort((a, b) => {
                const av = col.val(a), bv = col.val(b);
                const cmp = (typeof av === 'number' && typeof bv === 'number') ? (av - bv) : String(av).localeCompare(String(bv));
                return (state.dir === 'asc' ? 1 : -1) * cmp;
            });
            tbody.innerHTML = sorted.map((r) => {
                const rar = rarityForToken(r.quality, r.slug);
                const bg = `var(--rarity-${rar})`, border = `var(--rarity-${rar}-border)`;
                return '<tr>' + cols.map((cc, i) => {
                    const base = `padding:6px 10px;vertical-align:middle;text-align:${cc.align};background:${bg};`;
                    const style = i === 0
                        ? base + `border-left:4px solid ${border};border-top-left-radius:6px;border-bottom-left-radius:6px;`
                        : (i === cols.length - 1 ? base + 'border-top-right-radius:6px;border-bottom-right-radius:6px;' : base);
                    return `<td style="${style}">${cc.cell(r)}</td>`;
                }).join('') + '</tr>';
            }).join('');
            tbody.querySelectorAll('.trade-item-icon').forEach((ic) => {
                const slug = ic.getAttribute('data-icon-slug');
                if (!slug) return;
                const token = ic.getAttribute('data-icon-token');
                const type = (window._tradingTypeByKey && window._tradingTypeByKey[slug]) || '';
                const qname = qualityDisplay(type, token, slug) || null;
                wireDropAnchor(ic, prettyName(slug), false, qname);
            });
        };
        tbody.addEventListener('click', (e) => {
            const el = e.target.closest('.trade-item-name');
            if (el && el.dataset.nameSlug) this._navigate('forward', () => this._openItemDetail(el.dataset.nameSlug, el.dataset.nameQuality || ''));
        });
        render();
        return wrap;
    }

    // Browse-style table for a trader's listings/wishlist on their detail page.
    // Reuses the Browse table so Message/Block work; Block refreshes this page.
    _traderTradeTable(rows, emptyMsg, traderName) {
        if (!rows || !rows.length) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:8px;color:var(--text-secondary);';
            d.textContent = emptyMsg;
            return d;
        }
        const tbl = this._makeTradeTable('browse', {
            onMessage: (to, tid, about, row) => this.startConversation(to, about || null, tid || null, row),
            onBlock: (nm, bb) => {
                if (bb._confirm) {
                    api('POST', '/api/trading/blocks', { name: nm })
                        .then(() => { refreshTradingUnread(); this._navigate('back', () => this._switchTab(this.activeTab || 'browse')); })
                        .catch((err) => { bb.textContent = 'Block'; alert(err.message); });
                } else {
                    bb._confirm = true; bb.textContent = `Block ${nm}?`;
                    setTimeout(() => { if (bb) { bb._confirm = false; bb.textContent = 'Block'; } }, 3000);
                }
            },
        }, { viewKey: 'trader-listings', noTraderCol: true });
        tbl.setRows(rows);
        return tbl.el;
    }

    // Item detail (opened by clicking an item NAME in any table): the item's
    // sale history, recent confirmed sales, current sell listings, and other
    // players' wishlists for it.
    async _openItemDetail(slug, selQuality) {
        if (!slug) return;
        this._currentViewThunk = () => this._openItemDetail(slug, selQuality);
        const c = this._content();
        c.innerHTML = '<div style="color:var(--text-secondary);">Loading…</div>';
        let detail = { listings: [], wishlists: [], history: [] };
        try { detail = await api('GET', `/api/trading/item?slug=${encodeURIComponent(slug)}`); } catch (e) { /* */ }
        c.innerHTML = '';
        const back = btn('← Back'); back.onclick = () => this._goBack();
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[slug]) || '';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:600;';
        header.innerHTML = `<img src="${esc(icon)}" width="28" height="28" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'"><span>${esc(prettyName(slug))}</span>`;
        const head = rowOf(back, header); head.style.marginBottom = '10px';
        c.appendChild(head);

        // Quality-bearing items get a rarity-coloured selector that re-prices the
        // header card per quality. Fixed-rarity items (loot/gear/tools) keep the
        // single collapsed price card.
        const itype = detail.item_type || (window._tradingTypeByKey && window._tradingTypeByKey[slug]) || '';
        const ladder = QUALITY_TOKEN_LADDER[itype];
        const byQ = detail.prices_by_quality || [];
        if (ladder && ladder.length) {
            const priceForToken = (tok) => byQ.find((p) => (p.quality || '') === tok) || null;
            // Default selection: the quality we arrived with (clicked row), else
            // the first ladder tier that actually has market data, else base.
            const incoming = QUALITY_WORD_TO_TOKEN[String(selQuality || '').toLowerCase()];
            const withData = ladder.find((t) => priceForToken(t));
            let sel = (incoming && ladder.includes(incoming)) ? incoming : (withData || ladder[0]);
            const priceHost = document.createElement('div');
            const emptyCard = (tok) => {
                const d = document.createElement('div');
                d.style.cssText = 'margin-bottom:12px;padding:10px 14px;border:1px dashed var(--border-color);'
                    + 'border-radius:10px;color:var(--text-secondary);';
                d.textContent = `No market data yet for ${qualityDisplay(itype, tok, slug) || 'Normal'}.`;
                return d;
            };
            const selWrap = document.createElement('div');
            selWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center;';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'color:var(--text-secondary);font-size:0.85em;margin-right:2px;';
            lbl.textContent = 'Quality:';
            selWrap.appendChild(lbl);
            const btns = {};
            const paint = () => {
                ladder.forEach((tok) => {
                    const rar = rarityForToken(tok, slug);
                    const active = tok === sel;
                    btns[tok].style.cssText = 'font-size:12px;padding:4px 12px;border-radius:14px;cursor:pointer;'
                        + 'transition:background .2s ease, box-shadow .2s ease, border-color .2s ease, transform .2s ease, opacity .2s ease;'
                        + `background:var(--rarity-${rar});color:var(--text-primary);`
                        + `border:2px solid var(--rarity-${rar}-border);`
                        + (active
                            ? `box-shadow:0 0 0 3px var(--rarity-${rar}-border);font-weight:700;opacity:1;transform:scale(1.07);`
                            : 'box-shadow:0 0 0 0 transparent;opacity:.6;font-weight:400;transform:scale(1);');
                });
            };
            const renderPrice = () => {
                priceHost.innerHTML = '';
                const pc = this._priceHeaderCard(priceForToken(sel));
                priceHost.appendChild(pc || emptyCard(sel));
            };
            ladder.forEach((tok) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = qualityDisplay(itype, tok, slug) || 'Normal';
                b.onclick = () => { sel = tok; paint(); renderPrice(); };
                btns[tok] = b;
                selWrap.appendChild(b);
            });
            paint(); renderPrice();
            c.appendChild(selWrap);
            c.appendChild(priceHost);
        } else {
            const priceCard = this._priceHeaderCard(detail.price);
            if (priceCard) c.appendChild(priceCard);
        }

        c.appendChild(this._revealPanel('Sale history for this item', this._historyHtml(detail.history), true));
        c.appendChild(this._revealPanel('Current sell listings for this item',
            this._itemTradeTable(detail.listings, slug, 'No open sell listings.'), true));
        c.appendChild(this._revealPanel("Other players' wishlists for this item",
            this._itemTradeTable(detail.wishlists, slug, 'None.')));
    }

    // Build a Browse-style trade table (same columns/behavior as the Browse tab)
    // for the item-detail listings / wishlists panels. Returns a DOM node: either
    // the populated table or an empty-state message. `emptyMsg` is shown when there
    // are no rows.
    _itemTradeTable(rows, slug, emptyMsg) {
        if (!rows || !rows.length) {
            const d = document.createElement('div');
            d.style.cssText = 'padding:8px;color:var(--text-secondary);';
            d.textContent = emptyMsg;
            return d;
        }
        const tbl = this._makeTradeTable('browse', {
            onMessage: (to, tid, about, row) => this.startConversation(to, about || null, tid || null, row),
            onBlock: (name, bb) => {
                if (bb._confirm) {
                    api('POST', '/api/trading/blocks', { name })
                        .then(() => { refreshTradingUnread(); this._openItemDetail(slug); })
                        .catch((err) => { bb.textContent = 'Block'; alert(err.message); });
                } else {
                    bb._confirm = true; bb.textContent = `Block ${name}?`;
                    setTimeout(() => { if (bb) { bb._confirm = false; bb.textContent = 'Block'; } }, 3000);
                }
            },
        }, { viewKey: 'item-listings' });
        tbl.setRows(rows);
        return tbl.el;
    }

    _listingsHtml(listings) {
        if (!listings || !listings.length) return '<div style="padding:8px;color:var(--text-secondary);">No open sell listings.</div>';
        return listings.map((l) => {
            const li = l.item || {};
            const q = qualityDisplay(li.type, li.quality, li.slug);
            const qty = l.qty != null ? l.qty : 1;
            const price = l.price_coins != null ? `${Number(l.price_coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins each` : 'Negotiable';
            const who = esc(l.display_name || l.trader || '');
            const via = l.remote ? ` <span style="color:var(--text-secondary);font-size:0.85em;">via ${esc(siteLabel(l.source_site))}</span>` : '';
            return `<div style="${S_CARD}"><strong>${who}</strong>${via}: ${qty} ${esc(prettyName(li.slug))}${q ? ` (${esc(q)})` : ''} — ${esc(price)}</div>`;
        }).join('');
    }

    _revealPanel(title, innerHtml, open = false) {
        const w = document.createElement('div'); w.style.marginBottom = '8px';
        const b = btn('', 'secondary'); b.style.width = '100%'; b.style.textAlign = 'left';
        // Use the app's standard disclosure arrow (span.expand-arrow): ► collapsed,
        // ▼ when .expanded — same affordance as everywhere else.
        b.innerHTML = `<span class="expand-arrow${open ? ' expanded' : ''}" style="margin-right:6px;">▼</span>${esc(title)}`;
        const arrow = b.querySelector('.expand-arrow');
        const p = document.createElement('div'); p.style.display = open ? 'block' : 'none';
        if (innerHtml instanceof Node) p.appendChild(innerHtml); else p.innerHTML = innerHtml;
        b.onclick = () => {
            const show = p.style.display === 'none';
            if ($) { if (show) $(p).slideDown(200); else $(p).slideUp(200); } else { p.style.display = show ? 'block' : 'none'; }
            if (arrow) arrow.classList.toggle('expanded', show);
        };
        w.append(b, p); return w;
    }

    _historyHtml(hist) {
        if (!hist || !hist.length) return '<div style="padding:8px;color:var(--text-secondary);">None yet.</div>';
        return hist.map((h) => {
            const items = h.items || [];
            const first = items[0] || {};
            const rar = rarityForToken(first.quality, first.slug);
            const itemsHtml = items.map((i) => {
                const icon = (window._tradingIconBySlug && window._tradingIconBySlug[i.slug]) || '';
                const qd = qualityDisplay(i.type, i.quality, i.slug);
                const qSpan = qd ? ` <span style="color:var(--text-secondary);">(${esc(qd)})</span>` : '';
                const qty = i.qty ? ` <span style="color:var(--text-secondary);">×${i.qty}</span>` : '';
                return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;">`
                    + `<img src="${esc(icon)}" width="24" height="24" style="image-rendering:pixelated;flex-shrink:0;filter:${iconOutline(rarityForToken(i.quality, i.slug))};" onerror="this.style.visibility='hidden'">`
                    + `<span class="trade-hist-name" data-hist-slug="${esc(i.slug)}" data-hist-quality="${esc(i.quality || '')}" title="View item details" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;"><strong>${esc(prettyName(i.slug))}</strong></span>${qSpan}${qty}</span>`;
            }).join('');
            const sold = (h.sold_for && h.sold_for.coins != null) ? `${Number(h.sold_for.coins).toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`
                : (h.sold_for && h.sold_for.items ? h.sold_for.items.map((i) => esc(prettyName(i.slug))).join(', ') : '—');
            const when = h.created_at ? fmtChatTime(h.created_at) : '';
            return `<div style="${S_CARD}background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);">`
                + `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;">${itemsHtml}`
                + `<span style="color:var(--text-secondary);">→</span> <strong>${esc(sold)}</strong></div>`
                + `<div style="color:var(--text-secondary);font-size:0.85em;margin-top:4px;">${esc(h.party_a || '')} ↔ ${esc(h.party_b || '')}${when ? ` · ${esc(when)}` : ''}</div>`
                + `</div>`;
        }).join('');
    }

    _wishlistsHtml(wl, linkListingOid, linkedSet) {
        if (!wl || !wl.length) return '<div style="padding:8px;color:var(--text-secondary);">None.</div>';
        return wl.map((w) => {
            const wi = w.item || {};
            const fl = qualityDisplay(wi.type, w.quality_floor, wi.slug);
            const rule = w.quality_rule === 'this_or_better' ? (fl ? `${esc(fl)}+` : 'any+') : (fl ? esc(fl) : 'any');
            const maxc = w.max_coins != null ? `max ${w.max_coins} coins` : 'no max';
            // When viewing one of our own listings, offer to link/unlink each wishlist.
            let linkBtn = '';
            if (linkListingOid && w.object_id) {
                const linked = linkedSet && linkedSet.has(w.object_id);
                linkBtn = `<button type="button" class="btn btn-secondary" data-link-wishlist="${esc(w.object_id)}" data-linked="${linked ? '1' : '0'}" style="float:right;font-size:12px;padding:2px 8px;">${linked ? 'Unlink' : 'Link'}</button>`;
            }
            return `<div style="${S_CARD}">${linkBtn}<strong>${esc(w.display_name || w.trader)}</strong> wants [${rule}] — ${esc(maxc)}</div>`;
        }).join('');
    }

    // ── My Wishlist ──────────────────────────────────────────────────────
    async _renderWishlist(c) {
        // Top-of-page "new matches" banner (clears the My Wishlist badge on visit).
        const _matchHost = document.createElement('div'); c.appendChild(_matchHost);
        this._renderMatchBanner(_matchHost, 'wishlist');
        let selected = null;
        const picked = document.createElement('div');
        picked.style.cssText = 'margin:8px 0;color:var(--text-secondary);';
        picked.textContent = 'No item selected.';
        const picker = createItemPicker((m) => {
            selected = m;
            picked.innerHTML = `<img src="${esc(m.icon)}" width="32" height="32" style="vertical-align:middle;image-rendering:pixelated;" onerror="this.style.display='none'"> Selected: <strong>${esc(m.label)}</strong> <span style="color:var(--text-secondary);">${esc(prettyName(m.type))}</span>`;
        });
        const ruleDD = createDropdown({ placeholder: 'Quality rule', options: [{ value: 'exact', label: 'Exact' }, { value: 'this_or_better', label: 'This or better' }], selected: ['exact'] });
        const wqty = textInput('1', { type: 'number', width: '70px', value: '1' });
        const maxc = textInput('coins', { type: 'number', width: '120px' });
        maxc.min = '0'; maxc.step = '0.01';
        const noteW = document.createElement('textarea');
        noteW.placeholder = 'Note (optional)'; noteW.rows = 2;
        noteW.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        const add = btn('Add');
        const msg = document.createElement('div'); msg.style.marginTop = '8px';
        const totalMax = document.createElement('div');
        totalMax.style.cssText = 'margin-top:6px;color:var(--text-secondary);font-size:0.9em;';
        const updTotal = () => {
            const q = parseInt(wqty.value, 10) || 1;
            const mc = coinParse(maxc.value);
            if (mc == null || isNaN(mc)) { totalMax.textContent = ''; totalMax.style.color = 'var(--text-secondary)'; return; }
            const whole = coinTotalWhole(mc, q);
            const total = (Math.round(mc * 100) * q) / 100;
            const totalStr = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
            const mcStr = mc.toLocaleString(undefined, { maximumFractionDigits: 2 });
            totalMax.textContent = `Total max: ${totalStr} coins  (${q} × ${mcStr})` + (whole ? '' : ' — total must be whole');
            totalMax.style.color = whole ? 'var(--text-secondary)' : 'var(--danger,#e06b6b)';
        };
        wqty.addEventListener('input', updTotal); maxc.addEventListener('input', updTotal);

        // ── Top action bar: "+ Create New Wishlist Entry" toggles the form ──
        const createToggle = btn('+ Create New Wishlist Entry');
        createToggle.className = 'btn btn-trade-green';
        const wDelAllBtn = btn('Delete all', 'secondary');
        wDelAllBtn.className = 'btn btn-trade-danger';
        const wRenewAllBtn = btn('Renew all', 'secondary');
        wRenewAllBtn.className = 'btn btn-trade-blue';
        const createBar = document.createElement('div');
        createBar.style.cssText = 'margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
        createBar.append(createToggle, wRenewAllBtn, wDelAllBtn);
        c.appendChild(createBar);

        const form = document.createElement('div');
        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong'); title.textContent = 'New wishlist entry';
        const closeX = btn('✕', 'secondary'); closeX.setAttribute('aria-label', 'Close'); closeX.style.lineHeight = '1';
        headerRow.append(title, closeX);
        form.appendChild(headerRow);
        form.appendChild(picker.el);
        form.appendChild(picked);
        const r2 = rowOf(field('Qty', wqty), field('Quality rule', ruleDD.el), field('Max coins (each)', maxc));
        r2.style.marginTop = '8px';
        const expiryNote = document.createElement('div');
        expiryNote.style.cssText = 'margin-top:8px;color:var(--text-secondary);font-size:0.85em;';
        expiryNote.textContent = 'Wishlist entries expire after 7 days unless renewed.';
        const noteWField = field('Note (optional)', noteW); noteWField.style.marginTop = '10px';
        const notifyCtl = this._notifyControl(false); notifyCtl.el.style.marginTop = '10px';
        const addWRow = rowOf(add); addWRow.style.marginTop = '10px';
        form.append(r2, totalMax, noteWField, notifyCtl.el, expiryNote, addWRow, msg);
        const formCard = this._card(form);
        formCard.style.marginTop = '0'; formCard.style.marginBottom = '0';
        const slideWrap = document.createElement('div');
        slideWrap.style.cssText = 'display:none;overflow:hidden;';
        slideWrap.appendChild(formCard);
        c.appendChild(slideWrap);

        let _formOpen = false;
        const openForm = () => { _formOpen = true; createToggle.disabled = true; slideWrap.style.display = ''; slideShow(slideWrap); };
        const closeForm = () => { _formOpen = false; createToggle.disabled = false; slideHide(slideWrap, () => { slideWrap.style.display = 'none'; }); };
        createToggle.onclick = () => { if (_formOpen) closeForm(); else openForm(); };
        closeX.onclick = closeForm;
        const searchBar = this._listSearchBar(() => refresh());
        searchBar.el.style.marginTop = '10px';
        c.appendChild(searchBar.el);
        const showExpired = checkbox('Show expired'); showExpired.style.margin = '10px 0 4px';
        c.appendChild(showExpired);
        const emptyMsg = document.createElement('div'); emptyMsg.style.cssText = 'color:var(--text-secondary);';
        const tbl = this._makeTradeTable('wishlist', {
            onRenew: async (id) => { try { await api('POST', `/api/trading/wishlist/${id}/renew`, {}); toast('Renewed'); refresh(); } catch (e) { alert('Renew failed: ' + e.message); } },
            onClose: (id, btnEl, w) => {
                // Mirror of the My Listings "Did this item sell?" flow, in the
                // BUYER direction: "Did you buy it?" Yes -> record the purchase
                // (coins/qty/traded + bought-from) in the opposite trade
                // direction; No -> just delete the wishlist entry.
                const m = this._modal('Did you buy it?');
                const q = document.createElement('div');
                q.style.cssText = 'color:var(--text-secondary);margin-bottom:12px;';
                const nm = w && w.item ? prettyName(w.item.slug) : 'this item';
                q.textContent = `Did you buy “${nm}”? Choose Yes to record the purchase, or No to just remove the wishlist entry.`;
                const yes = btn('Yes — record purchase'); yes.style.cssText = 'background:#3fa65a;border-color:#3fa65a;color:#fff;';
                const no = btn('No — delete'); no.className = 'btn btn-trade-danger';
                const errLine = document.createElement('div');
                errLine.style.cssText = 'color:var(--danger,#e06b6b);margin-top:8px;font-size:0.85em;';
                m.panel.append(q, rowOf(yes, no), errLine);
                yes.onclick = () => { m.close(); if (w) this._navigate('forward', () => this._openWishlistBuyDetail(w)); };
                no.onclick = async () => {
                    if (!no._confirm) {
                        no._confirm = true; no.textContent = 'Click again to delete';
                        setTimeout(() => { if (no.isConnected) { no._confirm = false; no.textContent = 'No — delete'; } }, 3000);
                        return;
                    }
                    no.disabled = true;
                    try { await api('DELETE', `/api/trading/wishlist/${id}`); m.close(); refresh(); }
                    catch (e) { no.disabled = false; errLine.textContent = 'Could not delete: ' + e.message; }
                };
            },
            onEdit: (w) => this._editWishlistEntry(w, refresh),
            onMarket: (slug) => { if (slug) { window._tradingPendingSearch = { slug }; this._switchTab('browse'); } },
        });
        c.append(emptyMsg, tbl.el);
        const refresh = async () => {
            let wl = [];
            try { wl = (await api('GET', '/api/trading/wishlist')).wishlist; } catch (e) { /* */ }
            const show = showExpired._cb.checked;
            const visible = wl.filter((w) => w.status !== 'deleted' && w.status !== 'bought' && (show || !w.is_expired) && searchBar.match(w));
            if (!visible.length) {
                tbl.el.style.display = 'none';
                emptyMsg.textContent = (wl.length && !show) ? 'No matches — toggle “Show expired”, or clear the search.' : 'No wishlist entries match.';
            } else {
                emptyMsg.textContent = '';
                tbl.el.style.display = '';
                tbl.setRows(visible);
            }
        };
        showExpired._cb.onchange = refresh;
        wRenewAllBtn.onclick = async () => {
            try {
                const res = await api('POST', '/api/trading/wishlist/renew-all', {});
                toast(`Renewed ${res.renewed != null ? res.renewed : ''}`.trim());
                refresh();
            } catch (e) { emptyMsg.textContent = 'Renew all failed: ' + e.message; }
        };
        wDelAllBtn.onclick = async () => {
            let wl = [];
            try { wl = (await api('GET', '/api/trading/wishlist')).wishlist || []; }
            catch (e) { emptyMsg.textContent = 'Could not load wishlist: ' + e.message; return; }
            const openOnes = wl.filter((w) => w.status === 'open' || !w.status);
            if (!openOnes.length) { emptyMsg.textContent = 'No wishlist entries to delete.'; return; }
            if (!(await this._confirm({ title: 'Delete all wishlist entries?', message: `This permanently removes all ${openOnes.length} of your wishlist entr${openOnes.length === 1 ? 'y' : 'ies'}. This cannot be undone.`, confirmLabel: 'Delete all' }))) return;
            try {
                const res = await api('POST', '/api/trading/wishlist/delete-all', {});
                const n = res.deleted != null ? res.deleted : openOnes.length;
                emptyMsg.textContent = `Deleted ${n} wishlist entr${n === 1 ? 'y' : 'ies'}.`;
            } catch (e) { emptyMsg.textContent = 'Delete all failed: ' + e.message; }
            refresh();
        };
        add.onclick = async () => {
            if (!selected) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Pick an item first.</span>'; return; }
            const _wq = parseInt(wqty.value, 10) || 1;
            const _mc = coinParse(maxc.value);
            if (_mc != null && isNaN(_mc)) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Enter a valid max coins value (a number ≥ 0).</span>'; return; }
            if (!coinTotalWhole(_mc, _wq)) { msg.innerHTML = '<span style="color:var(--danger,#e06b6b);">Total max (max coins × qty) must be a whole number of coins.</span>'; return; }
            const body = { item: { slug: selected.slug, type: selected.type }, quality_rule: ruleDD.getValue() || 'exact', quality_floor: selected.quality || '', qty: _wq };
            if (_mc != null) body.max_coins = _mc;
            if (noteW.value.trim()) body.note = noteW.value.trim();
            if (notifyCtl.getNotify()) body.notify_match = true;
            try {
                await api('POST', '/api/trading/wishlist', body);
                msg.innerHTML = '<span style="color:#5fb55f;">Added.</span>'; refresh();
                selected = null; picked.textContent = 'No item selected.';
                wqty.value = '1'; maxc.value = ''; noteW.value = ''; totalMax.textContent = '';
                setTimeout(() => { if (_formOpen) closeForm(); msg.innerHTML = ''; }, 600);
            }
            catch (e) { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
        refresh();
    }

    _wishRowHtml(w) {
        const it = w.item || {};
        const fl = qualityDisplay(it.type, w.quality_floor, it.slug);
        const rule = w.quality_rule === 'this_or_better' ? (fl ? `${esc(fl)}+` : 'any+') : (fl ? esc(fl) : 'any');
        const qty = w.qty != null ? w.qty : 1;
        let maxc;
        if (w.max_coins != null) {
            maxc = `max ${w.max_coins} coins`;
            if (qty > 1) maxc += ` (total max ${w.max_coins * qty})`;
        } else { maxc = 'no max'; }
        const icon = (window._tradingIconBySlug && window._tradingIconBySlug[it.slug]) || '';
        const rar = rarityForToken(w.quality_floor, it.slug);
        const expired = w.is_expired ? ` <span style="color:var(--danger,#e06b6b);">· expired ${esc(this._daysAgo(w.expires_at))}</span>` : '';
        const noteHtml = w.note ? `<br><span style="color:var(--text-secondary);">“${esc(w.note)}”</span>` : '';
        return `<div style="${S_CARD}${w.is_expired ? 'opacity:.6;' : ''}background:var(--rarity-${rar});border-left:4px solid var(--rarity-${rar}-border);"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <img src="${esc(icon)}" width="32" height="32" style="image-rendering:pixelated;margin:-6px;" onerror="this.style.visibility='hidden'">
                <div><strong>${esc(prettyName(it.slug))}</strong> [${rule}] ×${qty} — ${esc(maxc)}${expired} <span style="color:var(--text-secondary);">${esc(it.type)}</span>${noteHtml}</div>
              </div>
              <div style="display:flex;gap:6px;"><button data-renew="${w.id}" class="btn btn-secondary">Renew</button><button data-del="${w.id}" class="btn btn-secondary">Delete</button></div></div></div>`;
    }

    _slugify(name) {
        return String(name || '').toLowerCase().replace(/ /g, '_').replace(/[()]/g, '').replace(/-/g, '_').replace(/'/g, '');
    }

    // Edit a wishlist entry (quality rule/floor, max coins, note) via a modal.
    // Shared "notify me on matching new listings" control for the wishlist forms.
    // If browser notifications are granted → a checkbox bound to notify_match.
    // Otherwise → the same enable-notifications prompt the goals report uses,
    // permanently dismissible (localStorage). Returns { el, getNotify() }.
    _notifyControl(initialOn, labelText) {
        const wrap = document.createElement('div');
        let notify = !!initialOn;
        const hasNotif = () => (typeof Notification !== 'undefined' && Notification.permission === 'granted');
        let dismissed = false;
        try { dismissed = localStorage.getItem('tradingWishlistNotifyPromptDismissed') === 'true'; } catch (e) { /* ignore */ }
        const render = () => {
            wrap.innerHTML = '';
            if (hasNotif()) {
                const lbl = document.createElement('label');
                lbl.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-primary);font-size:0.9em;';
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = notify; cb.style.accentColor = 'var(--accent-primary)';
                cb.onchange = () => { notify = cb.checked; };
                const span = document.createElement('span'); span.textContent = labelText || '🔔 Notify me when a matching new listing is posted';
                lbl.append(cb, span); wrap.appendChild(lbl);
            } else if (!dismissed) {
                const banner = document.createElement('div');
                banner.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:8px;padding:8px 10px;font-size:0.85em;color:var(--text-secondary);';
                const txt = document.createElement('span'); txt.style.flex = '1'; txt.textContent = 'Want a heads-up when a matching listing is posted? Enable browser notifications.';
                const en = btn('🔔 Enable notifications', 'secondary'); en.style.cssText = 'font-size:12px;padding:4px 10px;';
                const x = btn('✕', 'secondary'); x.style.cssText = 'font-size:12px;padding:4px 8px;line-height:1;'; x.title = 'Dismiss';
                en.onclick = async () => {
                    en.disabled = true;
                    try {
                        if (window.settingsModal && typeof window.settingsModal._initPushNotifications === 'function') {
                            window.settingsModal._pushPermission = 'granted';
                            await window.settingsModal._initPushNotifications();
                        } else if (typeof Notification !== 'undefined') {
                            await Notification.requestPermission();
                        }
                    } catch (e) { /* ignore */ }
                    if (hasNotif()) notify = true;
                    render();
                };
                x.onclick = () => { dismissed = true; try { localStorage.setItem('tradingWishlistNotifyPromptDismissed', 'true'); } catch (e) { /* ignore */ } render(); };
                banner.append(txt, en, x);
                wrap.appendChild(banner);
            }
            // dismissed && no permission → render nothing.
        };
        render();
        return { el: wrap, getNotify: () => (hasNotif() ? notify : false) };
    }

    _editWishlistEntry(w, refresh) {
        const it = w.item || {};
        const m = this._modal(`Edit wishlist: ${prettyName(it.slug)}`);
        const ruleDD = createDropdown({ placeholder: 'Quality rule', multi: false,
            selected: [w.quality_rule === 'this_or_better' ? 'this_or_better' : 'exact'],
            options: [{ value: 'exact', label: 'Exact quality' }, { value: 'this_or_better', label: 'This quality or better' }] });
        // Quality-floor options as the item's variant TOKENS (labelled for display).
        const tokSet = (t) => {
            if (t === 'crafted') return ['common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal'];
            if (t === 'consumable' || t === 'material') return ['', 'fine'];
            if (t === 'pet_egg') return ['', 'rare'];
            return [''];
        };
        const floorOpts = tokSet(it.type).map((tok) => ({ value: tok, label: qualityDisplay(it.type, tok, it.slug) || 'Base' }));
        const floorDD = createDropdown({ placeholder: 'Quality', multi: false,
            selected: [w.quality_floor || (floorOpts[0] && floorOpts[0].value) || ''], options: floorOpts });
        const maxc = textInput('coins', { type: 'number', width: '120px', value: w.max_coins != null ? String(w.max_coins) : '' });
        maxc.min = '0'; maxc.step = '0.01';
        const qty = textInput('1', { type: 'number', width: '70px', value: String(w.qty != null ? w.qty : 1) });
        const noteEl = document.createElement('textarea'); noteEl.rows = 2; noteEl.value = w.note || '';
        noteEl.style.cssText = S_INPUT + 'width:100%;resize:vertical;';
        const save = btn('Save'); const cancel = btn('Cancel', 'secondary');
        const notifyCtl = this._notifyControl(w.notify_match);
        const emsg = document.createElement('div'); emsg.style.marginTop = '8px';
        const fRule = field('Quality rule', ruleDD.el);
        const fFloor = field('Quality', floorDD.el);
        const fQty = field('Qty', qty);
        const fMax = field('Max coins (each)', maxc);
        const fNote = field('Note (optional)', noteEl);
        // A little breathing room between each row so the buttons don't crowd the note.
        [fFloor, fQty, fMax, fNote].forEach((f) => { f.style.marginTop = '12px'; });
        notifyCtl.el.style.marginTop = '12px';
        const btnRow = rowOf(save, cancel); btnRow.style.marginTop = '16px';
        m.panel.append(fRule, fFloor, fQty, fMax, fNote, notifyCtl.el, btnRow, emsg);
        cancel.onclick = m.close;
        save.onclick = async () => {
            save.disabled = true;
            try {
                const _mc = maxc.value.trim() ? coinParse(maxc.value) : null;
                if (_mc != null && isNaN(_mc)) throw new Error('Enter a valid max coins value (a number ≥ 0).');
                const _q = parseInt(qty.value, 10) || 1;
                if (!coinTotalWhole(_mc, _q)) throw new Error('Total max (max coins × qty) must be a whole number of coins.');
                await api('PUT', `/api/trading/wishlist/${w.id}`, {
                    quality_rule: ruleDD.getValue() || 'exact',
                    quality_floor: floorDD.getValue() || '',
                    max_coins: _mc,
                    qty: _q,
                    note: noteEl.value.trim() || null,
                    notify_match: notifyCtl.getNotify(),
                });
                m.close(); refresh && refresh();
            } catch (e) { save.disabled = false; emsg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
        };
    }

    // ── Settings (Edit on top; slide reveal) ─────────────────────────────
    _renderSettings(c) {
        const me = this.me || { in_game_name: '', display_name: '', contact_prefs: [] };
        const editing = this._editingProfile;
        const card = document.createElement('div'); card.style.cssText = S_CARD;

        // Top action bar — Edit (view) or Save/Cancel (edit) at the TOP.
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;justify-content:flex-start;gap:8px;margin-bottom:var(--spacing-md,16px);';
        card.appendChild(bar);

        const info = document.createElement('div');
        info.innerHTML = `<div style="margin-bottom:8px;"><span style="color:var(--text-secondary);">In-game name:</span> <strong>${esc(me.in_game_name)}</strong>
            <span style="color:var(--text-secondary);">(shown to others; add each other in-game with this)</span></div>`;
        card.appendChild(info);

        // Shareable "compare with me" link — opens Compare(viewer, me) for whoever
        // clicks it. Uses the pretty /u/<handle>/compare URL (handle = your unique
        // display name, else your character name).
        if (me.in_game_name) {
            const myHandle = me.handle || me.display_name || me.in_game_name;
            const compareUrl = `${location.origin}/u/${encodeURIComponent(myHandle)}/compare`;
            const clWrap = document.createElement('div'); clWrap.style.cssText = 'margin-bottom:var(--spacing-md,16px);';
            const clLabel = document.createElement('div'); clLabel.textContent = 'Your “compare with me” link'; clLabel.style.cssText = S_LABEL;
            const clRow = document.createElement('div'); clRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
            const clInput = textInput('', { value: compareUrl, width: '320px' });
            clInput.readOnly = true; clInput.onclick = () => clInput.select();
            const clCopy = btn('Copy link', 'secondary'); clCopy.style.cssText = 'font-size:12px;padding:4px 10px;';
            clCopy.onclick = async () => {
                try { await navigator.clipboard.writeText(compareUrl); toast('Compare link copied'); }
                catch (e) { clInput.select(); try { document.execCommand('copy'); toast('Compare link copied'); } catch (_) { toast('Copy failed — select & copy manually'); } }
            };
            const clHint = document.createElement('div'); clHint.style.cssText = 'color:var(--text-secondary);font-size:0.8em;margin-top:4px;';
            clHint.textContent = 'Share this — whoever opens it sees how their items compare with yours.';
            clRow.append(clInput, clCopy);
            clWrap.append(clLabel, clRow, clHint); card.appendChild(clWrap);
        }

        // Display name (also the public /u/<handle> slug — must be unique).
        const dnWrap = document.createElement('div'); dnWrap.style.marginBottom = 'var(--spacing-md,16px)';
        const dnLabel = document.createElement('div'); dnLabel.textContent = 'Display name'; dnLabel.style.cssText = S_LABEL;
        const dnInput = textInput('', { value: me.display_name, width: '240px' }); dnInput.disabled = !editing;
        const dnStatus = document.createElement('div');
        dnStatus.style.cssText = 'font-size:0.8em;margin-top:4px;color:var(--text-secondary);';
        let _dnTimer = null;
        const updateDnStatus = async () => {
            const v = dnInput.value.trim();
            const charName = me.in_game_name || '';
            if (!v) {
                dnStatus.style.color = 'var(--text-secondary)';
                dnStatus.innerHTML = `Leave blank to use your character name. Public link: <code>/u/${esc(encodeURIComponent(charName))}/compare</code>`;
                return;
            }
            if (v.toLowerCase() === charName.toLowerCase()) {
                dnStatus.style.color = '#5fb55f';
                dnStatus.innerHTML = `✓ Public link: <code>/u/${esc(encodeURIComponent(v))}/compare</code>`;
                return;
            }
            try {
                const r = await api('GET', `/api/trading/handle-check?display_name=${encodeURIComponent(v)}`);
                if (r.available) {
                    dnStatus.style.color = '#5fb55f';
                    dnStatus.innerHTML = `✓ Available — your link will be <code>/u/${esc(encodeURIComponent(v))}/compare</code>`;
                } else {
                    dnStatus.style.color = 'var(--warning,#e0b24a)';
                    dnStatus.innerHTML = `✗ “${esc(v)}” isn’t available — your public profile will use your character name (<strong>${esc(charName)}</strong>) instead.`;
                }
            } catch (e) { dnStatus.textContent = ''; }
        };
        if (editing) {
            dnInput.addEventListener('input', () => {
                if (_dnTimer) clearTimeout(_dnTimer);
                _dnTimer = setTimeout(updateDnStatus, 300);
            });
        }
        updateDnStatus();
        dnWrap.append(dnLabel, dnInput, dnStatus); card.appendChild(dnWrap);

        // Contact preferences
        const prefsTitle = document.createElement('div'); prefsTitle.innerHTML = '<strong>Contact preferences</strong>';
        card.appendChild(prefsTitle);
        const prefsBox = document.createElement('div'); card.appendChild(prefsBox);

        // "Here (in-app)" is now a toggle the user can uncheck. Everything else
        // (Discord / Other) stays in the editable `work` list. New traders
        // (empty stored prefs) default to here-ON; an explicit off is persisted
        // as a sentinel so it survives a reload even with no other channels.
        const stored = me.contact_prefs;
        const hereEntry = Array.isArray(stored) ? stored.find((p) => p.channel === 'here') : null;
        let hereOn = hereEntry ? (hereEntry.enabled !== false) : (!Array.isArray(stored) || stored.length === 0);
        const work = JSON.parse(JSON.stringify((Array.isArray(stored) ? stored : []).filter((p) => p.channel !== 'here')));

        // The "Here (in-app)" checkbox row (always shown; editable only in edit mode).
        const hereRow = document.createElement('label');
        hereRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer;';
        const hereCb = document.createElement('input');
        hereCb.type = 'checkbox'; hereCb.checked = hereOn; hereCb.disabled = !editing;
        hereCb.style.accentColor = 'var(--accent-primary)';
        hereCb.onchange = () => { hereOn = hereCb.checked; this._settingsDirty = true; };
        const hereLbl = document.createElement('span'); hereLbl.textContent = 'Here (in app messages)'; hereLbl.style.minWidth = '160px';
        const hereInfo = document.createElement('span'); hereInfo.textContent = 'ⓘ';
        hereInfo.className = 'travel-info-icon';
        hereInfo.setAttribute('role', 'button'); hereInfo.setAttribute('tabindex', '0');
        hereInfo.setAttribute('aria-label', 'About in-app messaging');
        hereInfo.style.cssText = 'font-style:normal;cursor:pointer;';
        hereInfo.dataset.info = 'Lets other traders message you here on the site. Disabling this turns off in-app messaging entirely — you won’t be able to send or receive messages, and others can’t message you.';
        hereRow.append(hereCb, hereLbl, hereInfo);

        const prefRow = (p) => {
            const label = p.channel === 'other' ? (p.label || 'Other') : 'Discord';
            const r = document.createElement('div');
            r.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0;';
            r.innerHTML = `<span style="min-width:120px;">${esc(label)}</span>`
                + `<input data-v value="${esc(p.value || '')}" placeholder="handle" ${editing ? '' : 'disabled'} style="${S_INPUT}">`;
            if (editing) {
                const del = document.createElement('button'); del.className = 'btn'; del.textContent = '🗑';
                del.className = 'btn btn-trade-danger';
                del.onclick = () => { this._settingsDirty = true; const idx = work.indexOf(p); if (idx >= 0) { if ($) { $(r).slideUp(200, () => r.remove()); } else r.remove(); work.splice(idx, 1); } };
                r.appendChild(del);
            }
            r._pref = p;
            return r;
        };
        const renderPrefs = () => { prefsBox.innerHTML = ''; prefsBox.appendChild(hereRow); work.forEach((p) => prefsBox.appendChild(prefRow(p))); };
        renderPrefs();

        // Add buttons (edit mode) — slide the new row in. Blue (primary).
        let addBar = null;
        if (editing) {
            addBar = document.createElement('div'); addBar.style.cssText = 'margin-top:8px;display:flex;gap:8px;';
            const addDiscord = btn('+ Add Discord');
            const addOther = btn('+ Add Other');
            addDiscord.onclick = () => { this._settingsDirty = true; const p = { channel: 'discord', value: '' }; work.push(p); const r = prefRow(p); prefsBox.appendChild(r); slideShow(r); };
            addOther.onclick = () => { this._settingsDirty = true; const p = { channel: 'other', label: 'Other', value: '' }; work.push(p); const r = prefRow(p); prefsBox.appendChild(r); slideShow(r); };
            addBar.append(addDiscord, addOther);
            card.appendChild(addBar);
        }

        // Auto-renew preference — opt-in; applied on site open to entries with
        // < 4 days left. Editable only in edit mode (matches the other fields).
        let autoRenewOn = !!me.auto_renew;
        const arSection = document.createElement('div'); arSection.style.cssText = 'margin-top:var(--spacing-md,16px);padding-top:var(--spacing-sm,8px);border-top:1px solid var(--border-color);';
        const arRow = document.createElement('label'); arRow.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;';
        const arCb = document.createElement('input'); arCb.type = 'checkbox'; arCb.checked = autoRenewOn; arCb.disabled = !editing; arCb.style.accentColor = 'var(--accent-primary)';
        arCb.onchange = () => { autoRenewOn = arCb.checked; };
        const arText = document.createElement('span'); arText.textContent = 'Auto-renew my sales/wishlist when opening the site';
        const arInfo = document.createElement('span'); arInfo.textContent = 'ⓘ';
        arInfo.className = 'travel-info-icon';
        arInfo.setAttribute('role', 'button'); arInfo.setAttribute('tabindex', '0');
        arInfo.setAttribute('aria-label', 'About auto-renew');
        arInfo.style.cssText = 'font-style:normal;cursor:pointer;';
        arInfo.dataset.info = 'When you open the site, any of your listings or wishlist entries with less than 4 days left are automatically renewed to 7 days from now. Entries with more than 4 days left are left alone.';
        arRow.append(arCb, arText, arInfo);
        arSection.appendChild(arRow);
        card.appendChild(arSection);

        // Inventory-sharing preference — opt-in. When on, other traders can see
        // (on your page's Compare) which of your owned items they don't have.
        // Off by default; your bank stays private otherwise.
        let shareOn = !!me.share_inventory;
        const shSection = document.createElement('div'); shSection.style.cssText = 'margin-top:var(--spacing-sm,8px);';
        const shRow = document.createElement('label'); shRow.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;';
        const shCb = document.createElement('input'); shCb.type = 'checkbox'; shCb.checked = shareOn; shCb.disabled = !editing; shCb.style.accentColor = 'var(--accent-primary)';
        shCb.onchange = () => { shareOn = shCb.checked; this._settingsDirty = true; };
        const shText = document.createElement('span'); shText.textContent = 'Share my inventory for trade comparisons';
        const shInfo = document.createElement('span'); shInfo.textContent = 'ⓘ';
        shInfo.className = 'travel-info-icon';
        shInfo.setAttribute('role', 'button'); shInfo.setAttribute('tabindex', '0');
        shInfo.setAttribute('aria-label', 'About inventory sharing');
        shInfo.style.cssText = 'font-style:normal;cursor:pointer;';
        shInfo.dataset.info = 'When on, other traders using the Compare button on your page can see which of your owned items they don\'t have (in addition to your public listings and wishlist). Your exact quantities and non-tradeable details are not shown. Off by default — your bank stays private.';
        shRow.append(shCb, shText, shInfo);
        shSection.appendChild(shRow);
        card.appendChild(shSection);

        const msg = document.createElement('div'); msg.style.marginTop = '8px'; card.appendChild(msg);

        const collectValues = () => { prefsBox.querySelectorAll('[data-v]').forEach((inp) => { const parent = inp.closest('div'); if (parent && parent._pref) parent._pref.value = inp.value.trim(); }); };

        if (!editing) {
            const edit = btn('Edit'); edit.onclick = () => { this._editingProfile = true; this._settingsDirty = false; this._switchTab('settings'); };
            bar.appendChild(edit);
            this._settingsSave = null;
        } else {
            dnInput.addEventListener('input', () => { this._settingsDirty = true; });
            arCb.addEventListener('change', () => { this._settingsDirty = true; });
            const save = btn('Save'); const cancel = btn('Cancel');
            cancel.className = 'btn btn-trade-danger';
            // Slide only the "+ Add Discord / + Add Other" row up, then re-render.
            const closeEdit = () => {
                this._settingsDirty = false;
                if ($ && addBar) { $(addBar).slideUp(200, () => { this._editingProfile = false; this._switchTab('settings'); }); }
                else { this._editingProfile = false; this._switchTab('settings'); }
            };
            const doSave = async () => {
                collectValues();
                const others = work.slice();
                let finalPrefs;
                if (hereOn) finalPrefs = [{ channel: 'here' }, ...others];
                else if (others.length) finalPrefs = others;
                else finalPrefs = [{ channel: 'here', enabled: false }]; // explicit off, no other channels
                this.me = await api('PUT', '/api/trading/me', { display_name: dnInput.value.trim(), contact_prefs: finalPrefs, auto_renew: autoRenewOn, share_inventory: shareOn });
            };
            // Exposed so the leave-confirm (switching tabs mid-edit) can save.
            this._settingsSave = async () => { await doSave(); this._settingsDirty = false; };
            save.onclick = async () => {
                try {
                    await doSave();
                    if (this.me && this.me.display_name_taken) {
                        toast(`“${dnInput.value.trim()}” is taken — your public profile uses your character name instead.`);
                    }
                    closeEdit();
                }
                catch (e) { msg.innerHTML = `<span style="color:var(--danger,#e06b6b);">${esc(e.message)}</span>`; }
            };
            cancel.onclick = closeEdit;
            bar.append(save, cancel);
        }

        c.appendChild(card);
        try { wireInfoIcons(card); } catch (e) { /* info-popover optional */ }
        // Only the "+ Add Discord / + Add Other" row slides in on entering edit —
        // the display-name + contact fields just appear in place.
        if (editing && addBar) slideShow(addBar);

        // ── Blocked traders ────────────────────────────────────────────────
        const blockCard = document.createElement('div'); blockCard.style.cssText = S_CARD; blockCard.style.marginTop = '12px';
        blockCard.innerHTML = '<strong>Blocked traders</strong>'
            + '<div style="color:var(--text-secondary);font-size:0.85em;margin:4px 0 8px;">'
            + 'Blocked traders are hidden from your Browse/Search and item views, their inbox threads are hidden, '
            + 'they don\'t count toward your unread badge, and you can\'t message them.</div>';
        const blockList = document.createElement('div'); blockList.textContent = 'Loading…';
        const addRow = document.createElement('div');
        const addName = textInput('in-game name to block', { width: '220px' });
        const addBtn = btn('Block');
        // Separation: input on its own line, Block button below with a gap.
        addRow.style.cssText = 'margin-top:12px;';
        const addBtnRow = rowOf(addBtn); addBtnRow.style.marginTop = '8px';
        addRow.append(field('Block a trader', addName), addBtnRow);
        blockCard.append(blockList, addRow);
        c.appendChild(blockCard);

        const renderBlocks = (names) => {
            if (!names || !names.length) {
                blockList.innerHTML = '<div style="color:var(--text-secondary);">No blocked traders.</div>';
                return;
            }
            blockList.innerHTML = '';
            names.forEach((n) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-color);';
                const unblock = btn('Unblock', 'secondary');
                // Reddish, matching the app's danger accent.
                unblock.className = 'btn btn-trade-danger';
                unblock.onclick = async () => {
                    try { const r = await api('DELETE', `/api/trading/blocks/${encodeURIComponent(n)}`); renderBlocks(r.blocks); refreshTradingUnread(); }
                    catch (e) { alert(e.message); }
                };
                const label = document.createElement('span'); label.textContent = n; label.style.color = 'var(--text-primary)';
                row.append(label, unblock);
                blockList.appendChild(row);
            });
        };
        addBtn.onclick = async () => {
            const n = addName.value.trim();
            if (!n) return;
            try { const r = await api('POST', '/api/trading/blocks', { name: n }); addName.value = ''; renderBlocks(r.blocks); refreshTradingUnread(); }
            catch (e) { alert(e.message); }
        };
        api('GET', '/api/trading/blocks').then((r) => renderBlocks(r.blocks)).catch(() => { blockList.textContent = ''; });
    }
}
