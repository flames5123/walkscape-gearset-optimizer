/**
 * SellForChipsPage
 *
 * Overlay tool (mirrors StatsReportPage / crafting-tree overlay): sits below
 * the header so the nav bar, mobile bottom bar, and undo/redo stay visible;
 * fades in/out. Projects Mysterious Merchant chip earnings from selling loot
 * and what you could buy back (projection only -- spec G4).
 *
 * Data: POST /api/sell-for-chips { force_overrides } -> SellPlan.
 * Styling: .sell-for-chips-page / .sfc-* in styles.css + existing rarity vars.
 *
 * localStorage:
 *   sellForChips.collapsed   -> array of section ids currently collapsed
 *   sellForChips.overrides   -> { item_slug: "force_sell" | "force_keep" }
 */

import { resolveItemIcon } from './utils/resolve-item-icon.js';
import { wireDropAnchor } from './drop-item-popover.js';

const LS_COLLAPSED = 'sellForChips.collapsed';
const LS_OVERRIDES = 'sellForChips.overrides';

const REASON_LABEL = {
    last_copy: 'last copy',
    ring_pair: 'ring pair',
    upgradable: 'upgradable',
    force_keep: 'kept',
    force_sell: 'sold',
    not_loot: 'not sellable',
};

function _jq() { return window.jQuery || window.$ || null; }

function _lsGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_e) {
        return fallback;
    }
}
function _lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_e) { /* ignore */ }
}

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function _num(n) {
    try { return Number(n).toLocaleString(); } catch (_e) { return String(n); }
}
function _chipIcon(p) {
    if (!p) return '/assets/icons/chips/_unknown_chip.svg';
    return p.startsWith('/') ? p : '/' + p;
}
function _rarityColor(rarity) {
    if (!rarity) return 'inherit';
    const r = String(rarity).toLowerCase();
    // Common's rarity-border is gray and blends into everything else; use
    // near-white so common item names stay readable.
    if (r === 'common') return 'var(--text-primary, #fff)';
    return `var(--rarity-${r}-border, inherit)`;
}
function _itemIcon(slug, name) {
    if (!slug) return '';
    return resolveItemIcon({ itemRef: 'Item.' + String(slug).toUpperCase(), itemName: name, fallback: '' });
}
function _cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s);
}

export class SellForChipsPage {
    constructor(elementSelector) {
        this._selector = elementSelector;
        this._el = document.querySelector(elementSelector);
        this._plan = null;
        this._overrides = _lsGet(LS_OVERRIDES, {}) || {};
        this._collapsed = new Set(_lsGet(LS_COLLAPSED, []) || []);
        this._openDisclosures = new Set();  // in-card disclosures open across re-renders
        this._cart = {};                    // slug -> count "bought" (live buy simulator)
        this._buyIndex = {};                // slug -> buy-row context (built each render)
        this._slideIn = null;               // CSS selector to slideDown after the next render
        this._loading = false;
        this._wired = false;
        this._open = false;
        this._closeTimer = null;
        // Escape closes the overlay (like the crafting tree).
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) {
                e.preventDefault();
                this.close();
            }
        });
    }

    // ---- open / close (fade, mirrors stats report) ------------------------

    open() {
        if (!this._el) this._el = document.querySelector(this._selector);
        if (!this._el) return;
        if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
        this._open = true;
        this._el.classList.remove('closing');
        this._el.classList.add('opening');
        document.body.classList.add('sell-for-chips-open');
        document.getElementById('sell-for-chips-nav-btn')?.classList.add('active');
        this._wireDelegation();
        this._render();
        this._fetchAndRender();
    }

    close() {
        this._open = false;
        document.getElementById('sell-for-chips-nav-btn')?.classList.remove('active');
        // Keep the URL hash in sync with the other report overlays. When the
        // user closes via the X / Escape (close() called directly), clear our
        // anchor so the nav-button toggle state stays correct. Use
        // replaceState so we don't re-enter handleHashChange. Guarded on the
        // current hash so close() calls coming FROM the router (navigating to
        // another view) never clobber that view's hash.
        if (typeof window !== 'undefined' && window.location.hash === '#sell-for-chips') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        if (!this._el) {
            document.body.classList.remove('sell-for-chips-open');
            return;
        }
        // Check visibility BEFORE removing 'opening' (removing it first reverts
        // the element to the base display:none, which would skip the animation).
        const wasVisible = getComputedStyle(this._el).display !== 'none';
        this._el.classList.remove('opening');
        if (wasVisible) {
            this._el.classList.add('closing');
            this._closeTimer = setTimeout(() => {
                this._el.classList.remove('closing');
                document.body.classList.remove('sell-for-chips-open');
                this._closeTimer = null;
            }, 260);
        } else {
            this._el.classList.remove('closing');
            document.body.classList.remove('sell-for-chips-open');
        }
    }

    isOpen() {
        return this._open;
    }

    // ---- data -------------------------------------------------------------

    async _fetchAndRender() {
        this._loading = true;
        try {
            const resp = await fetch('/api/sell-for-chips', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force_overrides: this._overrides }),
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            this._plan = await resp.json();
        } catch (err) {
            console.error('[sell-for-chips] fetch failed', err);
            this._plan = { error: String(err) };
        } finally {
            this._loading = false;
            this._render();
        }
    }

    _setOverride(slug, value) {
        if (!slug) return;
        if (value == null) delete this._overrides[slug];
        else this._overrides[slug] = value;
        _lsSet(LS_OVERRIDES, this._overrides);
        this._fetchAndRender();
    }

    // ---- rendering --------------------------------------------------------

    _render() {
        if (!this._el) return;
        const plan = this._plan;
        let inner;
        if (this._loading && !plan) {
            inner = `<div style="padding:40px;text-align:center;opacity:.7">Loading…</div>`;
        } else if (plan && plan.error) {
            inner = `<div style="padding:40px;text-align:center;color:var(--error-color,#e57373)">
                        Could not load Sell for Chips.<br><span style="opacity:.7">${_esc(plan.error)}</span>
                     </div>`;
        } else if (!plan || plan.needs_import || !plan.sections || plan.sections.length === 0) {
            inner = this._renderEmpty(plan);
        } else {
            inner = this._renderPlan(plan);
        }

        this._el.innerHTML = `
            <div class="sfc-wrap" style="max-width:1100px;margin:0 auto;padding:16px 16px 150px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
                    <div style="display:flex;align-items:center;gap:10px">
                        <img src="/assets/icons/items/chest_chips.svg" width="28" height="28" alt="">
                        <h2 style="margin:0">Sell for Chips</h2>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <button class="button button-secondary" data-sfc-action="reset" title="Reset Keep/Sell overrides and buy cart">Reset</button>
                        <button class="button button-secondary" data-sfc-action="close" title="Close (Esc)">✕</button>
                    </div>
                </div>
                <div style="opacity:.7;font-size:13px;margin-bottom:16px">
                    Projects chips earned by selling loot to the Mysterious Merchant, and what you could buy back.
                    Held back by default: your last copy (2 for rings) and anything Upgradeable.
                </div>
                ${inner}
            </div>`;
        this._wirePopovers();
        // Slide a just-changed row/section in (set by the action handlers).
        if (this._slideIn) {
            const sel = this._slideIn;
            this._slideIn = null;
            const $ = _jq();
            const node = this._el.querySelector(sel);
            if ($ && node) $(node).hide().slideDown(180);
        }
    }

    _wirePopovers() {
        if (!this._el) return;
        this._el.querySelectorAll('.sfc-item-anchor').forEach((el) => {
            const name = el.getAttribute('data-item-name');
            if (name) wireDropAnchor(el, name, false);
        });
    }

    _renderEmpty(plan) {
        const needsImport = !plan || plan.needs_import;
        const msg = needsImport
            ? 'Import your character to see what you could sell to the Mysterious Merchant.'
            : 'You have no loot items the Mysterious Merchant will buy.';
        const cta = needsImport
            ? `<button class="button button-primary" data-sfc-action="import" style="margin-top:12px">Import character</button>`
            : '';
        return `<div style="padding:48px 16px;text-align:center;border:1px dashed var(--border-color,#444);border-radius:10px">
                    <div style="opacity:.85">${_esc(msg)}</div>${cta}
                </div>`;
    }

    _renderPlan(plan) {
        this._buyIndex = this._buildBuyIndex(plan);
        const sections = plan.sections.map(s => this._renderSection(s)).join('');
        const summary = this._renderSummary(plan);
        return sections + summary;
    }

    _buildBuyIndex(plan) {
        const idx = {};
        for (const s of plan.sections || []) {
            for (const card of s.chip_types) {
                for (const r of card.buy_preview || []) {
                    idx[r.item_id] = {
                        item_id: r.item_id, name: r.name, rarity: r.rarity,
                        buy_price: r.buy_price, chip_type: card.chip_type,
                        chip_name: card.display_name, chip_icon: card.icon_path,
                    };
                }
            }
        }
        return idx;
    }

    _cardAvailable(card) {
        return (card.current_owned || 0) + (card.pool_total || 0);
    }
    _cardSpent(card) {
        let spent = 0;
        for (const r of card.buy_preview || []) {
            spent += (this._cart[r.item_id] || 0) * r.buy_price;
        }
        return spent;
    }
    _cardLeft(card) {
        return this._cardAvailable(card) - this._cardSpent(card);
    }

    _renderSection(section) {
        const collapsed = this._collapsed.has(section.id);
        const sectionTotal = section.chip_types.reduce((a, c) => a + (c.pool_total || 0), 0);
        const cards = section.chip_types.map(c => this._renderCard(c)).join('');
        return `
            <div class="sfc-section${collapsed ? ' collapsed' : ''}" data-section="${_esc(section.id)}"
                 style="margin-bottom:18px">
                <div class="sfc-section-header" data-sfc-action="toggle-section" data-section="${_esc(section.id)}"
                     style="display:flex;align-items:center;gap:8px;cursor:pointer;
                            border-bottom:1px solid var(--border-color,#444);padding-bottom:6px">
                    <span class="sfc-caret">▶</span>
                    <h3 style="margin:0;flex:1">${_esc(section.display_name)}</h3>
                    <span style="opacity:.7;font-size:13px">${section.chip_types.length} chip types · ${_num(sectionTotal)} chips</span>
                </div>
                <div class="sfc-section-body"${collapsed ? ' style="display:none"' : ''}>
                    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px">${cards}</div>
                </div>
            </div>`;
    }

    _disclosure(id, label, contentHtml) {
        const open = this._openDisclosures.has(id);
        return `<div class="sfc-disclosure${open ? ' open' : ''}">
                    <div class="sfc-disclosure-header" data-sfc-action="toggle-disclosure" data-target="${_esc(id)}">
                        <span class="sfc-caret">▶</span><span>${label}</span>
                    </div>
                    <div class="sfc-disclosure-body" data-disclosure="${_esc(id)}" style="margin-top:6px${open ? '' : ';display:none'}">
                        ${contentHtml}
                    </div>
                </div>`;
    }

    _renderCard(card) {
        const icon = _chipIcon(card.icon_path);
        const sellingRows = (card.selling || []).map(r => this._renderSellingRow(r)).join('')
            || `<div style="opacity:.6;font-size:13px">Nothing to sell</div>`;
        const sellingBlock = `<div style="opacity:.7;font-size:12px;font-weight:600;margin:4px 0 2px">Selling</div>${sellingRows}`;

        const held = card.held_back || [];
        const heldBlock = held.length
            ? this._disclosure(`${card.chip_type}-held`, `Held back (${held.length})`,
                held.map(r => this._renderHeldRow(r)).join(''))
            : '';

        const buy = card.buy_preview || [];
        const left = this._cardLeft(card);
        const buyBlock = buy.length
            ? this._disclosure(`${card.chip_type}-buy`,
                `With ${_num(left)} ${_esc(card.display_name)}s you can buy:`,
                buy.map(r => this._renderBuyRow(r, left)).join(''))
            : '';

        // Per-card "Buying" cart: items added via the + button, each with a
        // red "−" to remove one.
        const cartRows = buy.filter(r => (this._cart[r.item_id] || 0) > 0);
        const buyingBlock = cartRows.length ? `
            <div class="sfc-buying-block" data-chip="${_esc(card.chip_type)}"
                 style="margin-top:8px;border-top:1px dashed var(--border-color,#444);padding-top:6px">
                <div style="opacity:.7;font-size:12px;font-weight:600;margin-bottom:2px">Buying</div>
                ${cartRows.map(r => this._renderCartRow(r)).join('')}
            </div>` : '';

        const have = card.current_owned
            ? `<span style="opacity:.8">Have ${_num(card.current_owned)}</span> · `
            : '';

        return `
            <div class="sfc-card" style="flex:1 1 320px;min-width:300px;border:1px solid var(--border-color,#444);
                        border-radius:10px;padding:12px;background:var(--card-bg,rgba(255,255,255,.03))">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <img src="${icon}" width="24" height="24" alt=""
                         onerror="this.src='/assets/icons/chips/_unknown_chip.svg'">
                    <strong style="flex:1">${_esc(card.display_name)}</strong>
                    <span style="white-space:nowrap" title="Current balance · chips earned by selling">
                        ${have}+${_num(card.pool_total)}</span>
                </div>
                ${sellingBlock}
                ${heldBlock}
                ${buyBlock}
                ${buyingBlock}
            </div>`;
    }

    _renderCartRow(r) {
        const count = this._cart[r.item_id] || 0;
        const minusBtn = `<button class="button sfc-action-btn sfc-btn-unbuy" data-sfc-action="unbuy" data-slug="${_esc(r.item_id)}"
                title="Remove one"
                style="padding:1px 9px;font-weight:700;border:1px solid var(--error-color,#e57373);
                       color:var(--error-color,#e57373);background:transparent;border-radius:4px;flex-shrink:0;cursor:pointer">−</button>`;
        return `<div class="sfc-cart-row" data-slug="${_esc(r.item_id)}" style="display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:13px">
                    <span style="flex:1">${count}× ${this._nameHtml(r)}</span>
                    <span style="opacity:.8" title="Chips spent">-${_num(count * r.buy_price)}</span>
                    ${minusBtn}
                </div>`;
    }

    _nameHtml(r) {
        const icon = _itemIcon(r.item_id, r.name);
        let img = '';
        if (icon) {
            // Rarity-colored 4-direction drop-shadow outline (matches the
            // canonical quality/fine glow pattern elsewhere in the app).
            let style = 'vertical-align:middle;margin-right:5px';
            if (r.rarity) {
                const c = `var(--rarity-${String(r.rarity).toLowerCase()}-border)`;
                style += `;filter:drop-shadow(1px 0 0 ${c}) drop-shadow(-1px 0 0 ${c})`
                    + ` drop-shadow(0 1px 0 ${c}) drop-shadow(0 -1px 0 ${c})`;
            }
            img = `<img src="${icon}" width="16" height="16" alt="" loading="lazy"
                        style="${style}" onerror="this.style.display='none'">`;
        }
        // Wrap icon + name in an interactive anchor so the item stats popover
        // (drop-item-popover) shows on hover/click. Wired in _wirePopovers().
        return `<span class="sfc-item-anchor" data-item-name="${_esc(r.name)}" style="cursor:pointer">`
            + `${img}<span style="color:${_rarityColor(r.rarity)}">${_esc(r.name)}</span></span>`;
    }

    _ownedBadge(owned) {
        return owned > 0
            ? `<span style="color:var(--success-color,#81c784);font-weight:700;margin-right:5px"
                     title="Owned count">(${_num(owned)})</span>`
            : '';
    }

    _renderSellingRow(r) {
        // Always "Keep" -- clicking moves it to Held back.
        const btn = `<button class="button button-secondary sfc-action-btn sfc-btn-keep" data-sfc-action="keep" data-slug="${_esc(r.item_id)}"
                       style="padding:2px 8px;font-size:12px;flex-shrink:0">Keep</button>`;
        return `<div class="sfc-row" data-slug="${_esc(r.item_id)}" style="display:flex;align-items:center;gap:8px;padding:2px 4px">
                    <span style="flex:1">${r.qty}× ${this._ownedBadge(r.owned)}${this._nameHtml(r)}
                        <span style="opacity:.6">→ ${_num(r.subtotal)}</span></span>
                    ${btn}
                </div>`;
    }

    _renderHeldRow(r) {
        const reason = REASON_LABEL[r.reason] || r.reason || '';
        // Always "Sell" -- clicking moves it to Selling. No owned (#) badge here
        // (the qty already shows how many are held).
        const btn = `<button class="button button-secondary sfc-action-btn sfc-btn-sell" data-sfc-action="sell" data-slug="${_esc(r.item_id)}"
                       style="padding:2px 8px;font-size:12px;flex-shrink:0">Sell</button>`;
        return `<div class="sfc-row" data-slug="${_esc(r.item_id)}" style="display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:13px">
                    <span style="flex:1">${r.qty}× ${this._nameHtml(r)}
                        <span style="opacity:.6">— ${_esc(reason)}</span></span>
                    ${btn}
                </div>`;
    }

    _renderBuyRow(r, left) {
        const owned = r.owned || 0;
        // Dim the items you already have covered (owned enough -- 2 for rings,
        // 1 otherwise -- or upgradeable), so the ones you DON'T have stand out.
        const reserve = r.is_ring ? 2 : 1;
        const covered = r.upgradable || owned >= reserve;
        const inCart = this._cart[r.item_id] || 0;
        const canAfford = left >= r.buy_price;
        const plusBtn = `<button class="button sfc-action-btn sfc-btn-buy" data-sfc-action="buy" data-slug="${_esc(r.item_id)}"
                ${canAfford ? '' : 'disabled'} title="Buy one (${_num(r.buy_price)} chips)"
                style="padding:1px 9px;font-weight:700;border:1px solid var(--success-color,#81c784);
                       color:var(--success-color,#81c784);background:transparent;border-radius:4px;flex-shrink:0;
                       ${canAfford ? 'cursor:pointer' : 'opacity:.35;cursor:not-allowed'}">+</button>`;
        const cartBadge = inCart
            ? `<span style="color:var(--success-color,#81c784);font-size:12px" title="In your buy cart">×${inCart}</span>`
            : '';
        const nameStyle = covered ? 'opacity:.55;font-style:italic' : '';
        return `<div class="sfc-row" data-slug="${_esc(r.item_id)}" style="display:flex;align-items:center;gap:8px;padding:2px 4px;font-size:13px">
                    <span style="flex:1">${this._ownedBadge(owned)}<span style="${nameStyle}">${this._nameHtml(r)}</span>
                        <span style="opacity:.7">(${_num(r.buy_price)})</span></span>
                    ${cartBadge}
                    ${plusBtn}
                </div>`;
    }

    _renderSummary(plan) {
        // Per-chip rollup: earned (sold), spent (bought from cart), net balance.
        // Only list a chip if something was sold or bought.
        const cards = [];
        for (const s of plan.sections || []) for (const c of s.chip_types) cards.push(c);

        const rows = cards.map((card) => {
            const earned = card.pool_total || 0;
            const held = card.current_owned || 0;
            const spent = this._cardSpent(card);
            if (!earned && !spent) return '';
            const net = held + earned - spent;
            const icon = _chipIcon(card.icon_path);
            const spentHtml = spent
                ? ` · <span style="color:var(--error-color,#e57373)">-${_num(spent)} bought</span>` : '';
            return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:13px">
                        <img src="${icon}" width="18" height="18" alt=""
                             onerror="this.src='/assets/icons/chips/_unknown_chip.svg'">
                        <span style="flex:1">${_esc(card.display_name)}</span>
                        <span style="color:var(--success-color,#81c784)">+${_num(earned)} sold</span>
                        ${spentHtml}
                        <span style="opacity:.85">= ${_num(net)} left</span>
                    </div>`;
        }).join('');

        if (!rows) return '';
        return `<div style="margin-top:18px;border-top:1px solid var(--border-color,#444);padding-top:12px">
                    <h3 style="margin:0 0 8px">Summary</h3>
                    ${rows}
                </div>`;
    }

    _findCard(chipId) {
        if (!this._plan || !this._plan.sections) return null;
        for (const s of this._plan.sections) {
            for (const c of s.chip_types) {
                if (c.chip_type === chipId) return c;
            }
        }
        return null;
    }

    // ---- events -----------------------------------------------------------

    _wireDelegation() {
        if (this._wired || !this._el) return;
        this._wired = true;
        this._el.addEventListener('click', (e) => {
            const target = e.target.closest('[data-sfc-action]');
            if (!target) return;
            const action = target.getAttribute('data-sfc-action');
            const slug = target.getAttribute('data-slug');
            if (action === 'close') {
                this.close();
            } else if (action === 'import') {
                this.close();
                document.getElementById('import-btn')?.click();
            } else if (action === 'toggle-section') {
                this._toggleSection(target.getAttribute('data-section'));
            } else if (action === 'toggle-disclosure') {
                this._toggleDisclosure(target);
            } else if (action === 'keep') {
                this._moveOverride(target, slug, 'force_keep');
            } else if (action === 'sell') {
                this._moveOverride(target, slug, 'force_sell');
            } else if (action === 'clear') {
                this._setOverride(slug, null);
            } else if (action === 'buy') {
                this._buy(slug);
            } else if (action === 'unbuy') {
                this._unbuy(target, slug);
            } else if (action === 'reset') {
                this._reset();
            }
        });
    }

    _reset() {
        this._overrides = {};
        _lsSet(LS_OVERRIDES, this._overrides);
        this._cart = {};
        this._fetchAndRender();
    }

    _moveOverride(target, slug, value) {
        // Slide the clicked row up, then re-render and slide the item's new row
        // (Selling or Held back) down -- so it moves instead of popping.
        const $ = _jq();
        const row = target ? target.closest('.sfc-row') : null;
        this._slideIn = `.sfc-row[data-slug="${_cssEsc(slug)}"]`;
        if ($ && row) {
            $(row).stop(true, true).slideUp(180, () => this._setOverride(slug, value));
        } else {
            this._setOverride(slug, value);
        }
    }

    _buy(slug) {
        const ctx = this._buyIndex[slug];
        if (!ctx) return;
        const card = this._findCard(ctx.chip_type);
        if (!card || this._cardLeft(card) < ctx.buy_price) return;
        const alreadyInCart = (this._cart[slug] || 0) > 0;
        const hadCart = (card.buy_preview || []).some(r => (this._cart[r.item_id] || 0) > 0);
        this._cart[slug] = (this._cart[slug] || 0) + 1;
        // First item in this card -> slide the whole Buying block (header +
        // dashed separator). New cart row -> slide that row. Increment -> no slide.
        if (alreadyInCart) this._slideIn = null;
        else if (hadCart) this._slideIn = `.sfc-cart-row[data-slug="${_cssEsc(slug)}"]`;
        else this._slideIn = `.sfc-buying-block[data-chip="${_cssEsc(ctx.chip_type)}"]`;
        this._render();
    }

    _unbuy(target, slug) {
        if (!this._cart[slug]) return;
        const $ = _jq();
        const ctx = this._buyIndex[slug];
        const card = ctx ? this._findCard(ctx.chip_type) : null;
        const removingRow = this._cart[slug] === 1;
        const otherInCart = !!card && (card.buy_preview || [])
            .some(r => r.item_id !== slug && (this._cart[r.item_id] || 0) > 0);
        const willEmptyCard = removingRow && !otherInCart;
        const doDec = () => {
            this._cart[slug] -= 1;
            if (this._cart[slug] <= 0) delete this._cart[slug];
            this._render();
        };
        let node = null;
        if (removingRow) {
            node = (willEmptyCard && ctx)
                ? this._el.querySelector(`.sfc-buying-block[data-chip="${_cssEsc(ctx.chip_type)}"]`)
                : (target ? target.closest('.sfc-cart-row') : null);
        }
        if ($ && removingRow && node) {
            $(node).stop(true, true).slideUp(180, doDec);
        } else {
            doDec();
        }
    }

    _toggleSection(id) {
        if (!id || !this._el) return;
        const sectionEl = this._el.querySelector(`.sfc-section[data-section="${id}"]`);
        if (!sectionEl) return;
        const collapsedNow = sectionEl.classList.toggle('collapsed');
        if (collapsedNow) this._collapsed.add(id);
        else this._collapsed.delete(id);
        _lsSet(LS_COLLAPSED, Array.from(this._collapsed));

        const body = sectionEl.querySelector('.sfc-section-body');
        const $ = _jq();
        if ($ && body) {
            $(body).stop(true, true).slideToggle(200);
        } else if (body) {
            body.style.display = collapsedNow ? 'none' : '';
        }
    }

    _toggleDisclosure(headerEl) {
        if (!headerEl || !this._el) return;
        const id = headerEl.getAttribute('data-target');
        const wrap = headerEl.closest('.sfc-disclosure');
        const body = this._el.querySelector(`.sfc-disclosure-body[data-disclosure="${id}"]`);
        const openNow = wrap ? wrap.classList.toggle('open') : true;
        if (id) {
            if (openNow) this._openDisclosures.add(id);
            else this._openDisclosures.delete(id);
        }
        const $ = _jq();
        if ($ && body) {
            $(body).stop(true, true).slideToggle(180);
        } else if (body) {
            body.style.display = openNow ? '' : 'none';
        }
    }
}

export default SellForChipsPage;
