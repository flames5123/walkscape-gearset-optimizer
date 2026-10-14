/**
 * bank-editor.js — Tab/Category editor modal (Phase 1b).
 *
 * The modal is rendered ONCE on open; every interaction updates the DOM in place
 * (no full re-render — avoids the shake/wiggle). Collapsible sections use a
 * grid-template-rows height transition (matches the category collapse animation).
 *
 * open(node, kind, { onConfirm }) — edits a deep copy; onConfirm(copy) on CONFIRM.
 */
import { BG_SHAPES, ITEM_STATES } from './bank-engine.js';
import { SKILL_COLORS, SKILLS, getBankItems } from './bank-adapter.js';
import { BANK_GAME_ICONS, ICON_ONERROR, ICON_FALLBACK } from './bank-icons.js';
import { resolveNodeIcon } from './bank-icon-map.js';
import { NAMED_COLOR_ORDER, BG_ONLY_NAMES, resolveBankColor } from './bank-schema.js';
import RecipeSelectorDropdown from '../components/recipe-selector-dropdown.js';
import { resolveRecipeMaterialIds } from './bank-recipe.js';

const FILTER_ADD = [
    ['item_type', 'Item type'], ['gear_type', 'Gear type'], ['keyword', 'Keyword'],
    ['skill', 'Skill'], ['global', 'Global'], ['regional', 'Regional'],
    ['recipe', 'Recipe'], ['item_state', 'Advanced'],
];
const FILTER_LABEL = Object.fromEntries(FILTER_ADD);

// Selectable value pills (with hosted icons) for the item_type / gear_type filters.
const SLOT = (s) => `/assets/icons/slots/${s}.svg`;
const ITEM_TYPE_META = [
    { v: 'material', l: 'Material', icon: '/assets/icons/text/sprite_20_icons/tab_materials.svg' },
    { v: 'crafted', l: 'Crafted', icon: '/assets/icons/keywords/pliers.svg' },
    { v: 'loot', l: 'Loot', icon: '/assets/icons/text/sprite_20_icons/tab_gear.svg' },
    { v: 'consumable', l: 'Consumable', icon: '/assets/icons/slots/consumable.svg' },
    { v: 'egg', l: 'Pet egg', icon: '/assets/icons/keywords/pet_egg.svg' },
];
const GEAR_TYPE_META = ['head', 'cape', 'back', 'chest', 'primary', 'secondary', 'hands', 'legs', 'neck', 'feet', 'ring', 'tool']
    .map((s) => ({ v: s, l: s === 'tool' ? 'Tools' : (s[0].toUpperCase() + s.slice(1)), icon: SLOT(s) }));

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
function cap(s) { return s ? String(s)[0].toUpperCase() + String(s).slice(1) : s; }

// Keyword vocabulary derived from the live catalog (union of every item's keywords) —
// the same searchable dropdown UX as generic items, sourced from what actually exists.
let _kwCache = null;
// Keywords that aren't item descriptors — skill categories/scopes, region/realm names, and
// size/biome scope terms the user flagged. Dropped from the keyword filter vocabulary.
// (The 12 bare skill names are dropped separately via SKILLS.) Descriptive biome words like
// "Snowy" are intentionally KEPT.
const NON_ITEM_KEYWORDS = new Set([
    'global', 'utility', 'gathering', 'artisan',                 // stat scopes / skill categories
    'medium', 'swamp',                                          // scope / size / biome-region
    'gdte', 'jarvonia', 'wrentmark', 'syrenthia', 'trellin', 'erdwise', 'halfling rebels', // realms
    'pet',                                                       // not an item descriptor
]);
function knownKeywords() {
    if (_kwCache) return _kwCache;
    const set = new Set();
    try { for (const it of getBankItems()) for (const k of (it.keywords || [])) if (k) set.add(String(k)); } catch (_) { /* noop */ }
    // Drop bare skill names (they duplicate the Skill filter) and the non-descriptor terms above.
    // Compound keywords like "Crafting tool" are kept.
    const skillSet = new Set(SKILLS.map((s) => s.toLowerCase()));
    _kwCache = [...set]
        .filter((k) => { const kl = String(k).trim().toLowerCase(); return !skillSet.has(kl) && !NON_ITEM_KEYWORDS.has(kl); })
        .sort((a, b) => a.localeCompare(b));
    return _kwCache;
}
function kwSlug(k) { return String(k).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
// Keywords whose icon lives outside assets/icons/keywords/<slug>.svg. Paths are the
// authoritative tools-API keyword icons. (Snowy/Upgradeable/Misc now have real SVGs in
// assets/icons/keywords/ copied from the wiki, so they resolve via the default path.)
const KW_ICON_OVERRIDE = {
    'curiosity': '/assets/icons/items/currencies/adventure_guild_token.png',
    'fishing bait': '/assets/icons/keywords/fishing_bait.png',
    'hunting product': '/assets/icons/text/sprite_20_icons/materials_hunting_products.png',
    // "Travelling" has no keyword icon in-game; use the Travelling activity icon.
    'travelling': '/assets/icons/activities/agility/traveling.svg',
};
function kwIcon(k) { return KW_ICON_OVERRIDE[String(k).trim().toLowerCase()] || `/assets/icons/keywords/${kwSlug(k)}.svg`; }
function kwTagHtml(k) {
    return `<span class="bank-f-kw-tag"><img src="${kwIcon(k)}" width="18" height="18" alt="" onerror="this.style.display='none'">${esc(k)}<button class="bank-f-kw-rm" data-kw="${esc(k)}" title="Remove">×</button></span>`;
}

export class BankEditor {
    constructor() {
        this.el = null;
        this._iconTimer = null;
        this._iconList = null;
        this._iconShown = 0;
    }

    open(node, kind, opts = {}) {
        this.node = clone(node);
        this.node.filters = this.node.filters || [];
        this.kind = kind || 'category';
        this.onConfirm = opts.onConfirm || (() => {});
        this._iconList = null;
        this._iconShown = 0;
        this._recipePickers = [];
        this._mount();
        this._render();
    }

    close() {
        const el = this.el;
        if (!el) return;
        // Close any embedded recipe pickers so an open dropdown doesn't linger
        // during fade-out. Deliberately NOT calling their destroy() — that runs
        // $(document).off('click.recipe-dropdown'), which would also remove the
        // main Column-3 recipe selector's outside-click handler (shared namespace).
        (this._recipePickers || []).forEach((p) => { try { p.closeDropdown(); } catch (_e) {} });
        this._recipePickers = [];
        this.el = null;
        el.classList.remove('show');       // fade out & size down, then unmount
        setTimeout(() => el.remove(), 200);
    }
    _destroy() { this.el?.remove(); this.el = null; }

    _mount() {
        this._destroy();
        this.el = document.createElement('div');
        this.el.className = 'bank-editor-overlay';
        document.body.appendChild(this.el);
        this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
        // Add .show on the next frame so the base (opacity 0 / scale .95) paints first → animates in.
        requestAnimationFrame(() => requestAnimationFrame(() => { this.el?.classList.add('show'); }));
    }

    // ---- one-time render ----
    _render() {
        const n = this.node;
        this.el.innerHTML = `
        <div class="bank-editor">
            <div class="bank-editor-preview">
                <span class="bank-preview-icon bank-node-icon bank-shape-${n.bgShape || 'circle'}" style="width:40px;height:40px;background:${esc(this._darkFill())};box-shadow:inset 0 0 0 2px ${esc(n.color || '#888')}">
                    ${resolveNodeIcon(n.icon) ? `<img src="${esc(resolveNodeIcon(n.icon))}" width="32" height="32" alt="" onerror="${ICON_ONERROR}">` : ''}
                </span>
                <span class="bank-editor-preview-name">${esc(n.name || (this.kind === 'tab' ? 'New tab' : 'New category'))}</span>
            </div>

            <label class="bank-field"><span>Name</span>
                <input type="text" class="bank-name" value="${esc(n.name || '')}" placeholder="Name"></label>

            ${this.kind === 'tab' ? '' : `<label class="bank-toggle-row bank-swe-row">
                <input type="checkbox" class="bank-swe" ${n.showWhenEmpty ? 'checked' : ''}>
                <span><strong>Show when empty</strong><small>Keep visible even with no items.</small></span>
            </label>`}

            ${this.kind === 'tab' ? '' : `<label class="bank-toggle-row bank-lock-row">
                <input type="checkbox" class="bank-lock" ${n.locked ? 'checked' : ''}>
                <span><strong>Lock items</strong><small>Keep this category's items in place when auto-organizing.</small></span>
            </label>`}

            ${this._collapse('icon', 'Icon', this._iconSumHtml(), `
                <input type="text" class="bank-icon-search" placeholder="Search icons…">
                <div class="bank-icon-results"></div>`)}

            ${this._collapse('color', 'Color', this._colorSumHtml(), `
                <div class="bank-color-swatches">
                    ${NAMED_COLOR_ORDER.map((tok) => `<button class="bank-swatch ${this.node._c === tok ? 'sel' : ''}" data-token="${tok}" title="${cap(tok)}" style="background:${resolveBankColor(tok)}"></button>`).join('')}
                    ${SKILLS.map((s) => `<button class="bank-swatch ${this.node._c === 'skill_' + s ? 'sel' : ''}" data-token="skill_${s}" title="${cap(s)}" style="background:${resolveBankColor('skill_' + s)}"></button>`).join('')}
                </div>`)}

            ${this.kind === 'tab' ? '' : this._collapse('bg', 'Background', this._bgSumHtml(), `
                <div class="bank-bg-label">Shape</div>
                <div class="bank-shapes">${BG_SHAPES.map((s) => this._shapeOptHtml(s)).join('')}</div>
                <div class="bank-bg-colors ${(this.node.bgShape || 'circle') === 'none' ? 'hidden' : ''}">
                    <div class="bank-bg-label">Background colour</div>
                    <div class="bank-color-swatches bank-bg-swatches">
                        ${NAMED_COLOR_ORDER.map((tok) => this._bgSwatchHtml('dark_' + tok, cap(tok))).join('')}
                        ${BG_ONLY_NAMES.map((tok) => this._bgSwatchHtml('dark_' + tok, cap(tok))).join('')}
                        ${SKILLS.map((s) => this._bgSwatchHtml('dark_skill_' + s, cap(s))).join('')}
                    </div>
                </div>`)}

            ${this._collapse('filters', 'Filters', '', `
                <div class="bank-filters"></div>
                <div class="bank-add-filter">${FILTER_ADD.map(([t, l]) => `<button data-addf="${t}">+ ${l}</button>`).join('')}</div>`, true)}

            <div class="bank-editor-actions">
                <button class="bank-cancel">Cancel</button>
                <button class="bank-confirm">✓ Confirm</button>
            </div>
        </div>`;
        // populate filter rows
        const fc = this.el.querySelector('.bank-filters');
        this._renderFiltersEmpty(fc);
        (n.filters || []).forEach((f) => fc.appendChild(this._filterRowEl(f)));
        this._bind();
    }

    _collapse(section, title, sumHtml, innerHtml, open) {
        return `<div class="bank-collapse ${open ? 'open' : ''}" data-section="${section}">
            <div class="bank-collapse-summary">${title} <span class="bank-sum bank-sum-${section}">${sumHtml}</span></div>
            <div class="bank-collapse-body"><div class="bank-collapse-inner">${innerHtml}</div></div>
        </div>`;
    }

    _iconSumHtml() { return resolveNodeIcon(this.node.icon) ? `<img src="${esc(resolveNodeIcon(this.node.icon))}" width="20" height="20" alt="" onerror="${ICON_ONERROR}">` : ''; }
    _colorName() {
        const c = this.node._c;
        if (!c) return 'None';
        return cap(c.startsWith('skill_') ? c.slice(6) : c);
    }
    _colorSumHtml() {
        const has = !!this.node._c;
        const name = this._colorName();
        return `${has ? `<span class="bank-sum-swatch" style="background:${esc(this.node.color || '#888')}"></span>` : ''}<span class="bank-sum-cname">${esc(name)}</span>`;
    }
    /** Background summary: the resolved fill swatch + the shape name. */
    _bgSumHtml() {
        return `<span class="bank-sum-swatch" style="background:${esc(this._darkFill())}"></span><span class="bank-sum-cname">${cap(this.node.bgShape || 'circle')}</span>`;
    }
    /** One background-colour swatch (token is a full `dark_…` token). */
    _bgSwatchHtml(token, label) {
        const sel = this.node._bc === token ? 'sel' : '';
        return `<button class="bank-bgswatch ${sel}" data-bgtoken="${token}" title="${label}" style="background:${resolveBankColor(token)}"></button>`;
    }
    /** The chip's dark fill. An explicitly chosen background (_bc / bgColor) wins; otherwise it
     *  falls back to the dark variant of the accent colour (the auto default). */
    _darkFill() {
        if (this.node._bc) { const d = resolveBankColor(this.node._bc); if (d) return d; }
        if (this.node.bgColor) return this.node.bgColor;
        if (this.node._c) { const d = resolveBankColor('dark_' + this.node._c); if (d) return d; }
        return this.node.color || '#888';
    }
    _shapeOptHtml(shape) {
        const sel = (this.node.bgShape || 'circle') === shape ? 'sel' : '';
        const label = shape === 'rounded-square' ? 'Rounded' : cap(shape);
        const inner = shape === 'none'
            ? '<span class="bank-shape-none-glyph">⊘</span>'
            : `<span class="bank-node-icon bank-shape-${shape}" style="width:26px;height:26px;background:${esc(this._darkFill())};box-shadow:inset 0 0 0 2px rgba(255,255,255,0.35)"></span>`;
        return `<button class="bank-shape-opt ${sel}" data-shape="${shape}" title="${shape}">${inner}<small>${esc(label)}</small></button>`;
    }

    _renderFiltersEmpty(fc) {
        if (!this.node.filters.length && !fc.querySelector('.bank-f-empty')) {
            fc.innerHTML = '<div class="bank-f-empty">No filters — nothing auto-assigns here.</div>';
        }
    }

    // ---- filter rows (built + bound individually; no full re-render) ----
    _filterRowEl(f) {
        const i = Math.random().toString(36).slice(2, 8);
        let control = '';
        if (f.type === 'global' || f.type === 'regional') {
            control = `<small class="bank-f-note">${f.type === 'global' ? 'items with global stats' : 'regional items'}</small>`;
        } else if (f.type === 'item_state') {
            control = `<select>${ITEM_STATES.map((s) => `<option ${f.value === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
        } else if (f.type === 'skill') {
            control = `<span class="bank-f-skills">${SKILLS.map((s) => {
                const on = (f.value || []).includes(s);
                return `<label class="bank-f-skill ${on ? 'on' : ''}" style="--sk:${SKILL_COLORS[s]}"><input type="checkbox" value="${s}" ${on ? 'checked' : ''}><img src="/assets/icons/text/skill_icons/${s}.svg" width="18" height="18" alt="">${cap(s)}</label>`;
            }).join('')}</span>`;
        } else if (f.type === 'item_type' || f.type === 'gear_type') {
            const meta = f.type === 'item_type' ? ITEM_TYPE_META : GEAR_TYPE_META;
            control = `<span class="bank-f-pills">${meta.map((m) => {
                const on = (f.value || []).includes(m.v);
                const ic = m.icon ? `<img src="${m.icon}" width="16" height="16" alt="" onerror="this.style.display='none'">` : '';
                return `<label class="bank-f-pill ${on ? 'on' : ''}"><input type="checkbox" value="${esc(m.v)}" ${on ? 'checked' : ''}>${ic}${esc(m.l)}</label>`;
            }).join('')}</span>`;
        } else if (f.type === 'keyword') {
            control = `<span class="bank-f-kw">
                <span class="bank-f-kw-tags">${(f.value || []).map(kwTagHtml).join('')}</span>
                <input type="text" class="bank-f-kw-search" placeholder="Search keyword…">
                <div class="bank-f-kw-list"></div>
            </span>`;
        } else if (f.type === 'recipe') {
            control = `<span class="bank-f-recipe">
                <div class="bank-f-recipe-picker"></div>
                <small class="bank-f-recipe-status">${f.recipeName ? `${esc(f.recipeName)} — ${(f.value || []).length} material${(f.value || []).length === 1 ? '' : 's'}` : 'Pick a recipe — collects all its crafting-tree materials.'}</small>
            </span>`;
        } else {
            const val = Array.isArray(f.value) ? f.value.join(', ') : (f.value || '');
            control = `<input type="text" class="bank-f-text" placeholder="comma,separated" value="${esc(val)}">`;
        }
        const row = document.createElement('div');
        row.className = 'bank-filter-row';
        row.dataset.fk = i;
        row.innerHTML = `<span class="bank-f-type">${esc(FILTER_LABEL[f.type] || f.type)}</span>${control}<button class="bank-f-del" title="Remove">×</button>`;
        // bind in place (mutates f directly via closure)
        if (f.type === 'global' || f.type === 'regional') {
            // single valueless filter — nothing to bind
        } else if (f.type === 'item_state') {
            row.querySelector('select').addEventListener('change', (e) => { f.value = e.target.value; });
        } else if (f.type === 'skill') {
            row.querySelectorAll('.bank-f-skill input').forEach((inp) => inp.addEventListener('change', () => {
                const set = new Set(Array.isArray(f.value) ? f.value : []);
                if (inp.checked) set.add(inp.value); else set.delete(inp.value);
                f.value = [...set];
                inp.closest('.bank-f-skill').classList.toggle('on', inp.checked); // in-place, no re-render
            }));
        } else if (f.type === 'item_type' || f.type === 'gear_type') {
            row.querySelectorAll('.bank-f-pill input').forEach((inp) => inp.addEventListener('change', () => {
                const set = new Set(Array.isArray(f.value) ? f.value : []);
                if (inp.checked) set.add(inp.value); else set.delete(inp.value);
                f.value = [...set];
                inp.closest('.bank-f-pill').classList.toggle('on', inp.checked);
            }));
        } else if (f.type === 'keyword') {
            const wrap = row.querySelector('.bank-f-kw');
            const search = wrap.querySelector('.bank-f-kw-search');
            const list = wrap.querySelector('.bank-f-kw-list');
            const tags = wrap.querySelector('.bank-f-kw-tags');
            const renderTags = () => {
                tags.innerHTML = (f.value || []).map(kwTagHtml).join('');
                tags.querySelectorAll('.bank-f-kw-rm').forEach((b) => b.addEventListener('click', () => {
                    f.value = (f.value || []).filter((x) => x !== b.dataset.kw); renderTags();
                }));
            };
            let _kwMatches = [];
            let _kwShown = 0;
            const KW_CHUNK = 30;
            const kwItemHtml = (k) => `<div class="bank-f-kw-item" data-kw="${esc(k)}"><img src="${kwIcon(k)}" width="18" height="18" alt="" onerror="this.style.display='none'">${esc(k)}</div>`;
            const bindKwItems = () => {
                list.querySelectorAll('.bank-f-kw-item[data-kw]:not([data-bound])').forEach((el) => {
                    el.setAttribute('data-bound', '1');
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        const kw = el.dataset.kw;
                        if (!(f.value || []).includes(kw)) f.value = [...(f.value || []), kw];
                        search.value = ''; renderTags(); renderList();
                    });
                });
            };
            const appendKwChunk = () => {
                const next = _kwMatches.slice(_kwShown, _kwShown + KW_CHUNK);
                _kwShown += next.length;
                list.insertAdjacentHTML('beforeend', next.map(kwItemHtml).join(''));
                bindKwItems();
            };
            const renderList = () => {
                const query = search.value.trim();
                const q = query.toLowerCase();
                const sel = new Set((f.value || []).map((x) => x.toLowerCase()));
                // Full filtered set (no cap) — rendered in chunks and lazily extended on scroll.
                _kwMatches = knownKeywords().filter((k) => !sel.has(k.toLowerCase()) && (!q || k.toLowerCase().includes(q)));
                _kwShown = 0;
                list.innerHTML = '';
                appendKwChunk();
                if (!list.children.length) list.innerHTML = '<div class="bank-f-kw-item" style="color:var(--text-muted,#888)">No matches</div>';
            };
            // Lazy-load: append the next chunk as the user nears the bottom of the list.
            list.addEventListener('scroll', () => {
                if (_kwShown < _kwMatches.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 28) appendKwChunk();
            });
            const showList = () => {
                renderList();
                list.style.display = 'block';
                // In-flow dropdown: bring its bottom into view so it isn't cut off (desktop).
                requestAnimationFrame(() => list.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
            };
            search.addEventListener('focus', showList);
            search.addEventListener('input', showList);
            search.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
            renderTags();
        } else if (f.type === 'recipe') {
            const picker = row.querySelector('.bank-f-recipe-picker');
            const status = row.querySelector('.bank-f-recipe-status');
            // Reuse the exact Column-3 recipe selector in pick-mode: decoupleColumn3
            // keeps it from subscribing to / restoring the optimizer's recipe, and
            // onPick reports the choice without touching column-3 state.
            const applyPick = async (recipeId) => {
                if (!recipeId) {
                    f.value = []; delete f.recipeId; delete f.recipeName;
                    status.textContent = 'Pick a recipe — collects all its crafting-tree materials.';
                    return;
                }
                // Map the picked recipe id → its output item ref (the crafting-tree
                // `item_id`) and display name, from the selector's loaded recipes.
                let outputItem = null, name = recipeId;
                const bySkill = rsd.recipesData && rsd.recipesData.by_skill;
                if (bySkill) {
                    for (const arr of Object.values(bySkill)) {
                        const rec = arr.find((x) => x.id === recipeId);
                        if (rec) { outputItem = rec.output_item; name = rec.name; break; }
                    }
                }
                f.recipeId = recipeId; f.recipeName = name;
                status.textContent = `${name} — resolving materials…`;
                try {
                    const ids = await resolveRecipeMaterialIds(outputItem || recipeId);
                    f.value = ids;
                    status.textContent = `${name} — ${ids.length} material${ids.length === 1 ? '' : 's'}`;
                } catch (_e) {
                    f.value = [];
                    status.textContent = `${name} — couldn't build recipe tree`;
                }
            };
            const rsd = new RecipeSelectorDropdown(picker, { decoupleColumn3: true, onPick: applyPick });
            // The stock "None" option mutates column-3 state; in pick-mode we only
            // want it to clear THIS filter, so route it through applyPick(null).
            rsd.clearSelection = () => { rsd.selectedRecipe = null; rsd.isOpen = false; rsd.render(); applyPick(null); };
            if (f.recipeId) rsd.selectedRecipe = f.recipeId;   // reflect an existing selection on reopen
            rsd.render();
            (this._recipePickers = this._recipePickers || []).push(rsd);
        } else {
            row.querySelector('.bank-f-text').addEventListener('input', (e) => { f.value = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); });
        }
        row.querySelector('.bank-f-del').addEventListener('click', () => {
            const idx = this.node.filters.indexOf(f);
            if (idx >= 0) this.node.filters.splice(idx, 1);
            row.remove();
            this._renderFiltersEmpty(this.el.querySelector('.bank-filters'));
        });
        return row;
    }

    _defaultValueFor(type) {
        if (type === 'global') return true;
        if (type === 'item_state') return ITEM_STATES[0];
        return [];
    }

    // ---- icon picker (populate on open + lazy render) ----
    _renderIconChunk() {
        const results = this.el.querySelector('.bank-icon-results');
        if (!results || !this._iconList) return;
        const next = this._iconList.slice(this._iconShown, this._iconShown + 80);
        this._iconShown += next.length;
        results.insertAdjacentHTML('beforeend', next.map((ic) =>
            `<button class="bank-icon-opt" data-icon="${esc(ic.path)}" title="${esc(ic.name)}"><img src="${esc(resolveNodeIcon(ic.path) || ICON_FALLBACK)}" width="28" height="28" alt="" loading="lazy" onerror="${ICON_ONERROR}"></button>`).join(''));
        results.querySelectorAll('.bank-icon-opt:not([data-bound])').forEach((b) => {
            b.setAttribute('data-bound', '1');
            b.addEventListener('click', () => this._setIcon(b.dataset.icon));
        });
    }
    _loadIcons(query) {
        const results = this.el.querySelector('.bank-icon-results');
        if (!results) return;
        const q = String(query || '').toLowerCase();
        this._iconList = q
            ? BANK_GAME_ICONS.filter((ic) => ic.name.includes(q) || ic.group.includes(q))
            : BANK_GAME_ICONS.slice();
        this._iconShown = 0;
        results.innerHTML = '';
        if (!this._iconList.length) { results.innerHTML = '<div class="bank-f-empty">No icons.</div>'; return; }
        this._renderIconChunk();
    }

    // ---- in-place setters (no re-render) ----
    _setIcon(path) {
        this.node.icon = path;
        const prev = this.el.querySelector('.bank-preview-icon');
        prev.innerHTML = resolveNodeIcon(path) ? `<img src="${esc(resolveNodeIcon(path))}" width="32" height="32" alt="" onerror="${ICON_ONERROR}">` : '';
        this.el.querySelector('.bank-sum-icon').innerHTML = this._iconSumHtml();
    }
    _setColor(display, token) {
        if (token) { this.node._c = token; this.node.color = display; }
        else { delete this.node._c; this.node.color = '#888'; }   // deselected → neutral default, no token
        const accent = this.node.color || '#888';
        const dark = this._darkFill();
        const prev = this.el.querySelector('.bank-preview-icon');
        prev.style.background = dark; prev.style.boxShadow = `inset 0 0 0 2px ${accent}`;
        this.el.querySelector('.bank-sum-color').innerHTML = this._colorSumHtml();
        const _sb = this.el.querySelector('.bank-sum-bg'); if (_sb) _sb.innerHTML = this._bgSumHtml();
        this.el.querySelectorAll('.bank-shape-opt .bank-node-icon').forEach((s) => { s.style.background = dark; });
        this.el.querySelectorAll('.bank-swatch').forEach((b) => b.classList.toggle('sel', !!this.node._c && b.dataset.token === this.node._c));
    }
    /** Choose an independent background fill (token = full `dark_…`), leaving the accent colour intact. */
    _setBg(token) {
        this.node._bc = token;
        this.node.bgColor = resolveBankColor(token);
        const dark = this._darkFill();
        const prev = this.el.querySelector('.bank-preview-icon');
        prev.style.background = dark;
        this.el.querySelector('.bank-sum-bg').innerHTML = this._bgSumHtml();
        this.el.querySelectorAll('.bank-shape-opt .bank-node-icon').forEach((s) => { s.style.background = dark; });
        this.el.querySelectorAll('.bank-bgswatch').forEach((b) => b.classList.toggle('sel', b.dataset.bgtoken === token));
    }
    _setShape(shape) {
        this.node.bgShape = shape;
        const prev = this.el.querySelector('.bank-preview-icon');
        prev.className = `bank-preview-icon bank-node-icon bank-shape-${shape}`;
        this.el.querySelector('.bank-sum-bg').innerHTML = this._bgSumHtml();
        this.el.querySelectorAll('.bank-shape-opt').forEach((b) => b.classList.toggle('sel', b.dataset.shape === shape));
        // Background colour is meaningless with no shape → hide it when 'none' is selected.
        this.el.querySelector('.bank-bg-colors')?.classList.toggle('hidden', shape === 'none');
    }

    _toggleSection(section) {
        const det = this.el.querySelector(`.bank-collapse[data-section="${section}"]`);
        const open = !det.classList.contains('open');
        if (['icon', 'color', 'bg'].includes(section)) {
            this.el.querySelectorAll('.bank-collapse[data-section="icon"],.bank-collapse[data-section="color"],.bank-collapse[data-section="bg"]').forEach((o) => o.classList.remove('open'));
        }
        det.classList.toggle('open', open);
        if (open && section === 'icon' && !this._iconList) this._loadIcons('');
    }

    _bind() {
        const q = (s) => this.el.querySelector(s);
        q('.bank-name').addEventListener('input', (e) => {
            this.node.name = e.target.value;
            this.el.querySelector('.bank-editor-preview-name').textContent = e.target.value || (this.kind === 'tab' ? 'New tab' : 'New category');
        });
        q('.bank-swe')?.addEventListener('change', (e) => { this.node.showWhenEmpty = e.target.checked; });
        q('.bank-lock')?.addEventListener('change', (e) => { this.node.locked = e.target.checked; });

        this.el.querySelectorAll('.bank-collapse-summary').forEach((s) => s.addEventListener('click', () => this._toggleSection(s.parentElement.dataset.section)));

        const search = q('.bank-icon-search');
        search.addEventListener('input', () => { clearTimeout(this._iconTimer); this._iconTimer = setTimeout(() => { this._iconList = null; this._loadIcons(search.value.trim()); }, 200); });
        q('.bank-icon-results').addEventListener('scroll', (e) => {
            const el = e.target;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) this._renderIconChunk();
        });

        this.el.querySelectorAll('.bank-swatch').forEach((b) => b.addEventListener('click', () => {
            const tok = b.dataset.token;
            if (this.node._c === tok) this._setColor(null, null);              // click selected → deselect
            else this._setColor(resolveBankColor(tok), tok);
        }));
        this.el.querySelectorAll('.bank-bgswatch').forEach((b) => b.addEventListener('click', () => this._setBg(b.dataset.bgtoken)));
        this.el.querySelectorAll('.bank-shape-opt').forEach((b) => b.addEventListener('click', () => this._setShape(b.dataset.shape)));

        this.el.querySelectorAll('[data-addf]').forEach((b) => b.addEventListener('click', () => {
            const type = b.dataset.addf;
            if ((type === 'global' || type === 'regional') && this.node.filters.some((x) => x.type === type)) return; // single only
            const f = { type, value: this._defaultValueFor(type) };
            this.node.filters.push(f);
            const fc = this.el.querySelector('.bank-filters');
            const empty = fc.querySelector('.bank-f-empty'); if (empty) empty.remove();
            fc.appendChild(this._filterRowEl(f));
        }));

        q('.bank-cancel').addEventListener('click', () => this.close());
        q('.bank-confirm').addEventListener('click', () => { this.onConfirm(clone(this.node)); this.close(); });
    }
}
