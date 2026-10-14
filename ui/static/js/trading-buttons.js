/**
 * trading-buttons.js — reusable "Wishlist" + "Search market" buttons for item
 * popups (Req 12/13). Call makeTradingButtons(item, {owned}) and append the
 * returned element into a popup's action area. Returns null (renders nothing)
 * unless the trading flag is on, the item is tradable, and it's not owned.
 *
 * Surfaces to wire into (follow-up): drops-section item popups, the Column-2
 * non-owned upgrades section, the per-slot upgrade popups, and the crafting
 * tree aggregate. Kept standalone so each surface wires with one call.
 */

// Mirror ui/crafting_tree.py _slug_item_name: lower, spaces->_, drop parens,
// hyphens->_, drop apostrophes.
function slugify(name) {
    return String(name || '').toLowerCase().replace(/ /g, '_')
        .replace(/[()]/g, '').replace(/-/g, '_').replace(/'/g, '');
}

// Map a catalog `type` to the canonical trading type.
const CANON = {
    material: 'material', crafted_item: 'crafted', consumable: 'consumable',
    egg: 'pet_egg', item: 'item', coins: 'coins',
};

// Normalize an incoming quality (which may be a DISPLAY word like "Perfect" or
// already a token) to the canonical variant TOKEN used by the trading model.
// Base/unknown -> '' (not 'normal', which isn't a token and renders as "any").
const _QUAL_TOKENS = new Set(['', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'ethereal', 'fine']);
const _WORD_TO_TOKEN = {
    normal: 'common', good: 'uncommon', great: 'rare', excellent: 'epic',
    perfect: 'legendary', eternal: 'ethereal', fine: 'fine', none: '',
};
function toQualityToken(q) {
    const s = String(q == null ? '' : q).toLowerCase().trim();
    if (_QUAL_TOKENS.has(s)) return s;
    return Object.prototype.hasOwnProperty.call(_WORD_TO_TOKEN, s) ? _WORD_TO_TOKEN[s] : '';
}

// The trading accent (green) — buttons read as "trading" actions, not danger.
const TRADE_ACCENT = '#3fa65a';

function toast(msg, actionLabel, onAction) {
    const t = document.createElement('div');
    Object.assign(t.style, {
        position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
        background: '#241a24', color: '#e8dcc8', border: '1px solid #c0392b',
        borderRadius: '8px', padding: '10px 14px', zIndex: '2000', boxShadow: '0 4px 16px rgba(0,0,0,.5)',
        display: 'flex', gap: '10px', alignItems: 'center', cursor: onAction ? 'pointer' : 'default',
    });
    t.textContent = msg;
    if (actionLabel && onAction) {
        const a = document.createElement('button');
        a.textContent = actionLabel;
        Object.assign(a.style, { border: 'none', background: '#c0392b', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' });
        a.onclick = (e) => { e.stopPropagation(); onAction(); t.remove(); };
        t.appendChild(a);
    }
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
}

export function makeTradingButtons(item, opts = {}) {
    // Trading is released to all users (nav + page are ungated) — no FAC gate here.
    if (!item || item.tradable === false) return null;
    if (opts.owned) return null;
    const slug = item.slug || slugify(item.name);
    const type = CANON[item.type] || item.type || 'item';
    if (!slug) return null;

    const wrap = document.createElement('div');
    wrap.className = 'trading-item-actions';
    Object.assign(wrap.style, { display: 'flex', gap: '6px', marginTop: '6px', marginBottom: '8px', justifyContent: 'center' });

    const btnStyle = (b) => Object.assign(b.style, {
        padding: '4px 10px', borderRadius: '6px', border: `1px solid ${TRADE_ACCENT}`,
        background: TRADE_ACCENT, color: '#fff', cursor: 'pointer', fontSize: '12px',
    });

    const qualityToken = toQualityToken(item.quality);

    const wl = document.createElement('button');
    wl.textContent = '+ Wishlist'; btnStyle(wl);
    wl.onclick = async (e) => {
        e.stopPropagation();
        try {
            const body = { item: { slug, type }, quality_rule: 'exact', quality_floor: qualityToken };
            const resp = await fetch('/api/trading/wishlist', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
            toast(`Wishlisted ${(window.prettyName ? window.prettyName(slug) : slug)}.`, 'Tune', () => {
                window.location.hash = '#trading';
                setTimeout(() => window._tradingPage?._switchTab('wishlist'), 60);
            });
        } catch (err) { toast('Wishlist failed: ' + err.message); }
    };

    const sm = document.createElement('button');
    sm.textContent = 'Search market'; btnStyle(sm);
    sm.onclick = (e) => {
        e.stopPropagation();
        window._tradingPendingSearch = { slug, quality: qualityToken };
        window.location.hash = '#trading';
    };

    wrap.append(wl, sm);
    return wrap;
}

window.makeTradingButtons = makeTradingButtons;

const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * HTML-string variant for the HTML-built item popups (non-owned upgrade rows,
 * slot popup alts, crafting-tree aggregate). Returns '' when it shouldn't show.
 * Clicks are handled by the one-time delegated listener below (read the data-*).
 */
export function tradingButtonsHTML(item, opts = {}) {
    // Trading is GA (released to all) — no FAC gate here.
    if (!item || item.tradable === false) return '';
    if (opts.owned) return '';
    const slug = item.slug || slugify(item.name);
    const type = CANON[item.type] || item.type || 'item';
    if (!slug) return '';
    const q = toQualityToken(item.quality);
    const bs = `padding:3px 9px;border-radius:6px;border:1px solid ${TRADE_ACCENT};background:${TRADE_ACCENT};color:#fff;cursor:pointer;font-size:12px;`;
    return `<div class="trading-item-actions" data-trade-slug="${_esc(slug)}" data-trade-type="${_esc(type)}" data-trade-quality="${_esc(q)}" style="display:flex;gap:6px;margin-top:6px;margin-bottom:8px;justify-content:center;">`
        + `<button type="button" class="trade-wishlist-btn" style="${bs}">+ Wishlist</button>`
        + `<button type="button" class="trade-search-btn" style="${bs}">Search market</button></div>`;
}

let _delegated = false;
export function initTradingButtonDelegation() {
    if (_delegated) return;
    _delegated = true;
    // Capture phase so a button click doesn't also trigger the row's expand/collapse.
    document.addEventListener('click', async (e) => {
        const t = e.target;
        if (!t || !t.closest) return;
        const wl = t.closest('.trade-wishlist-btn');
        const sm = t.closest('.trade-search-btn');
        if (!wl && !sm) return;
        const box = (wl || sm).closest('.trading-item-actions');
        if (!box) return;
        e.preventDefault();
        e.stopPropagation();
        const slug = box.dataset.tradeSlug;
        const type = box.dataset.tradeType;
        const quality = toQualityToken(box.dataset.tradeQuality);
        if (sm) {
            window._tradingPendingSearch = { slug, quality };
            window.location.hash = '#trading';
            return;
        }
        try {
            const resp = await fetch('/api/trading/wishlist', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item: { slug, type }, quality_rule: 'exact', quality_floor: quality }),
            });
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
            toast(`Wishlisted ${(window.prettyName ? window.prettyName(slug) : slug)}.`, 'Tune', () => {
                window.location.hash = '#trading';
                setTimeout(() => window._tradingPage?._switchTab('wishlist'), 60);
            });
        } catch (err) { toast('Wishlist failed: ' + err.message); }
    }, true);
}

window.tradingButtonsHTML = tradingButtonsHTML;
window.initTradingButtonDelegation = initTradingButtonDelegation;
