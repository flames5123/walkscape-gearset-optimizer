/**
 * bank-view.js — Bank Layout shell (Phase 1b): tab rail, categories, list & grid
 * views, unique counts, collapse/expand, uncategorized, and edit-mode affordances.
 * Rendering is driven by the pure engine (bank-engine.js).
 *
 * Callbacks (opts): onEditNode(node, kind, tabId), onAddCategory(tabId),
 * onAddTab(), onEditTab(tab).
 */
import { assign, layoutCounts, isVisible, sortItems, itemPassesDisplayFilter, filterSetMatches, RARITY_ORDER, ITEM_TYPES, SORT_KEYS, SORT_DEFAULT_DIR } from './bank-engine.js';
import { getBankItems } from './bank-adapter.js';
import { ICON_ONERROR } from './bank-icons.js';
import { resolveNodeIcon, nodeIconOnError } from './bank-icon-map.js';
import { resolveBankColor } from './bank-schema.js';

const BANK_SKILLS = ['agility', 'carpentry', 'cooking', 'crafting', 'fishing', 'foraging', 'hunting', 'mining', 'smithing', 'tailoring', 'trinketry', 'woodcutting'];
const cap = (s) => String(s || '').replace(/(^|_)([a-z])/g, (_, p, c) => (p ? ' ' : '') + c.toUpperCase());
const SORT_LABELS = { default: 'Default', alphabetical: 'Alphabetical', quantity: 'Quantity', rarity: 'Rarity' };
// Item tiles rendered per grid before lazy-appending the rest on scroll. Rebuilding the
// whole ~800-item Uncategorized grid on every interaction was the main drag/edit lag source.
const GRID_CHUNK = 60;
// Item-type → hosted sprite icon (top-left tile badge). Equipment maps to loot (tab_gear).
const ITEM_TYPE_ICON = {
    material: '/assets/icons/text/sprite_20_icons/tab_materials.svg',
    crafted: '/assets/icons/text/sprite_20_icons/tab_crafting.svg',
    loot: '/assets/icons/text/sprite_20_icons/tab_gear.svg',
    gear: '/assets/icons/text/sprite_20_icons/tab_gear.svg',
    consumable: '/assets/icons/text/sprite_20_icons/tab_consumables.svg',
    egg: '/assets/icons/text/sprite_20_icons/misc_pet_egg.svg',
    tool: '/assets/icons/text/sprite_20_icons/tools_pickaxe.svg',
};

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Quality/rarity → outline+bar color (CSS vars, theme-aware). 'normal' shares the
// common (neutral) border. Fine uses the dedicated --fine-color.
const Q_BORDER = {
    normal: 'var(--rarity-common-border, #929ba2)',
    common: 'var(--rarity-common-border, #929ba2)',
    uncommon: 'var(--rarity-uncommon-border, #b8fe9b)',
    rare: 'var(--rarity-rare-border, #a2b9ff)',
    epic: 'var(--rarity-epic-border, #daa1ff)',
    legendary: 'var(--rarity-legendary-border, #fec880)',
    ethereal: 'var(--rarity-ethereal-border, #fe6061)',
    fine: 'var(--fine-color, #B1F7ED)',
};
function qualityKey(q) {
    const k = String(q || 'normal').toLowerCase();
    return Q_BORDER[k] ? k : 'normal';
}

export class BankView {
    constructor(container, opts = {}) {
        this.container = typeof container === 'string' ? document.querySelector(container) : container;
        this.opts = opts;
        this.layout = opts.layout || { tabs: [], settings: {} };
        this.view = (this.layout.settings && this.layout.settings.view) || 'grid';
        this.editMode = false;
        this.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
        this.collapsed = new Set();
        this.itemHistory = opts.itemHistory || {};
        this.lastAssignment = null;
        this._settingsOpen = false;
        this._sortOpen = false;
        this._filterOpen = false;
        this._selectMode = false;
        this._selected = new Set();
        this._pd = null; // active pointer-drag state
        this._onPdMove = this._onPdMove.bind(this);
        this._onPdUp = this._onPdUp.bind(this);
        this._onPdTouchMove = (e) => { if (this._pd && this._pd.active && e.cancelable) e.preventDefault(); };
    }

    /** Merged display/behaviour settings with defaults (defaults preserve current look). */
    _settings() {
        const s = this.layout.settings || {};
        return {
            gridCols: Number(s.gridCols) || 5,
            showTabCounts: s.showTabCounts !== false,
            showCatCounts: s.showCatCounts !== false,
            showGradients: s.showGradients !== false,
            showTypeIcons: !!s.showTypeIcons,
            startCollapsed: !!s.startCollapsed,
            condensedList: !!s.condensedList,
        };
    }

    _seedCollapsed() {
        const s = this.layout.settings || {};
        // Only seed on a fresh load (nothing collapsed yet) so we don't re-fold
        // categories the user expanded during in-place edits.
        if (!s.startCollapsed || this.collapsed.size) return;
        for (const t of (this.layout.tabs || [])) for (const cat of (t.categories || [])) this.collapsed.add(cat.id);
    }

    _settingsPanelMarkup() {
        const s = this._settings();
        const row = (key, label, desc) => `<label class="bank-set-row">
            <span><span class="bank-set-label">${esc(label)}</span>${desc ? `<small>${esc(desc)}</small>` : ''}</span>
            <input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}>
        </label>`;
        const cols = [3, 4, 5].map((n) => `<button class="bank-col-opt ${n === s.gridCols ? 'sel' : ''}" data-cols="${n}">${n}</button>`).join('');
        return `<div class="bank-chooser-overlay bank-settings-overlay${this._settingsShown ? ' show' : ''}" data-settings-overlay>
            <div class="bank-chooser bank-settings">
                <h3>Bank settings</h3>
                <div class="bank-set-group">Display</div>
                ${row('showTypeIcons', 'Show item type icons', 'Small type badge in each tile corner')}
                ${row('showTabCounts', 'Show tab counts', 'Unique item count on each tab')}
                ${row('showCatCounts', 'Show category counts', 'Unique item count in each header')}
                ${row('showGradients', 'Show item quality gradients', 'Rarity glow behind grid tiles')}
                <label class="bank-set-row">
                    <span><span class="bank-set-label">Grid columns</span><small>Tiles per row in grid view</small></span>
                    <span class="bank-set-cols">${cols}</span>
                </label>
                <div class="bank-set-group">Behaviour</div>
                ${row('startCollapsed', 'Start categories collapsed', 'Open the bank with every category folded')}
                ${row('condensedList', 'Condensed list', 'Tighter rows in list view')}
                <button class="bank-chooser-cancel" data-settings-close>Done</button>
            </div>
        </div>`;
    }

    _sort() {
        const s = (this.layout.settings || {}).sort || {};
        const key = SORT_KEYS.includes(s.key) ? s.key : 'default';
        return { key, dir: s.dir || SORT_DEFAULT_DIR[key] || 'asc' };
    }

    _filter() {
        const f = (this.layout.settings || {}).filter || {};
        return {
            enabled: !!f.enabled, owned: !!f.owned,
            types: f.types || [], skills: f.skills || [], qualities: f.qualities || [],
        };
    }

    _sortPanelMarkup() {
        const { key, dir } = this._sortState;
        const opt = (k) => {
            const sel = k === key;
            const arrow = !sel ? '' : (k === 'default' ? '✓' : (dir === 'asc' ? '↑' : '↓'));
            return `<button class="bank-sort-opt ${sel ? 'sel' : ''}" data-sort="${k}">
                <span>${esc(SORT_LABELS[k])}</span><span class="bank-sort-arrow">${arrow}</span>
            </button>`;
        };
        return `<div class="bank-chooser-overlay${this._sortShown ? ' show' : ''}" data-sort-overlay>
            <div class="bank-chooser bank-sortp">
                <h3>Sort items</h3>
                ${SORT_KEYS.map(opt).join('')}
                <small class="bank-set-note">Tap the active option again to flip direction.</small>
                <button class="bank-chooser-cancel" data-sort-close>Done</button>
            </div>
        </div>`;
    }

    _filterPanelMarkup() {
        const f = this._filterState;
        const chip = (dim, val, label) => `<button class="bank-filter-chip ${(f[dim] || []).includes(val) ? 'on' : ''}" data-fdim="${dim}" data-fval="${esc(val)}">${esc(label)}</button>`;
        const group = (title, dim, vals) => `<div class="bank-set-group">${title}</div>
            <div class="bank-filter-chips">${vals.map((v) => chip(dim, v, cap(v))).join('')}</div>`;
        return `<div class="bank-chooser-overlay${this._filterShown ? ' show' : ''}" data-filter-overlay>
            <div class="bank-chooser bank-filterp">
                <h3>Filter items</h3>
                <label class="bank-set-row"><span><span class="bank-set-label">Enable filter</span><small>Hide items that don't match</small></span>
                    <input type="checkbox" data-filter-enable ${f.enabled ? 'checked' : ''}></label>
                <label class="bank-set-row"><span><span class="bank-set-label">Owned only</span></span>
                    <input type="checkbox" data-filter-owned ${f.owned ? 'checked' : ''}></label>
                ${group('Item type', 'types', ITEM_TYPES)}
                ${group('Skill', 'skills', BANK_SKILLS)}
                ${group('Quality', 'qualities', RARITY_ORDER)}
                <div class="bank-filter-actions">
                    <button class="bank-chooser-cancel" data-filter-clear>Clear</button>
                    <button class="bank-chooser-cancel" data-filter-close>Done</button>
                </div>
            </div>
        </div>`;
    }

    setItemHistory(h) { this.itemHistory = h || {}; this.render(); }

    /** Resolved placements of OWNED items (for the self-tracking history store). */
    getPlacements() {
        const out = [];
        if (!this.lastAssignment) return out;
        for (const [tabId, b] of Object.entries(this.lastAssignment.byTab)) {
            for (const [catId, arr] of Object.entries(b.byCategory)) {
                for (const it of arr) if (it.owned) out.push({ item_id: it.id, tab_id: tabId, cat_id: catId, order: 0 });
            }
            for (const it of b.uncategorized) if (it.owned) out.push({ item_id: it.id, tab_id: tabId, cat_id: null, order: 0 });
        }
        return out;
    }

    /** Game item entries for each category's filter-matched items, using the game's own
     *  entry id (bare uuid for materials, item-<slug>-<uuid> for gear). Used by export to bake
     *  explicit items into categories whose filters (recipe / item_id / advanced) don't exist
     *  in-game — otherwise those categories import EMPTY. */
    exportCatItemEntries() {
        const items = getBankItems();
        const pins = (this.layout && this.layout.pins) || {};
        const out = {};
        for (const tab of (this.layout.tabs || [])) {
            for (const cat of (tab.categories || [])) {
                if (!cat.filters || !cat.filters.length) continue;
                const entries = [];
                for (const it of items) {
                    if (!it.gameId) continue;                     // no game entry id → can't reference in-game
                    // Respect manual moves: a pin is a single-placement override (same as the
                    // engine's assign()). If the item was dragged to a DIFFERENT category or to
                    // tab-uncategorized (catId null), it no longer belongs to this filter category,
                    // so don't re-bake it here — otherwise a moved-out item reappears on import.
                    const pin = pins[it.id];
                    if (pin && pin.catId !== cat.id) continue;
                    if (filterSetMatches(it, cat.filters)) entries.push(it.gameId);
                }
                if (entries.length) out[cat.id] = entries;
            }
        }
        return out;
    }

    /** Explicit MANUAL placements (drag / pin) per category and per tab-uncategorized,
     *  resolved to the game's entry id and ordered by settings.itemOrder. These live in
     *  layout.pins (membership: itemId -> {tabId, catId|null}) + settings.itemOrder (order),
     *  and the game's own filters CANNOT reproduce them — so the exporter must bake them into
     *  the category `i` / tab `u` arrays or a drag-built category imports EMPTY.
     *  Returns { cats: { [catId]: [gameId,...] }, uncat: { [tabId]: [gameId,...] } }. */
    exportManualEntries() {
        const gameIdById = new Map();
        for (const it of getBankItems()) if (it.gameId) gameIdById.set(it.id, it.gameId);
        const pins = (this.layout && this.layout.pins) || {};
        const order = (this.layout && this.layout.settings && this.layout.settings.itemOrder) || {};
        const catMembers = {};   // catId -> Set(itemId)
        const uncatMembers = {}; // tabId -> Set(itemId)
        for (const [itemId, p] of Object.entries(pins)) {
            if (!p) continue;
            if (p.catId) (catMembers[p.catId] = catMembers[p.catId] || new Set()).add(itemId);
            else if (p.tabId) (uncatMembers[p.tabId] = uncatMembers[p.tabId] || new Set()).add(itemId);
        }
        // Order a member set by settings.itemOrder[key] (unlisted items keep last), then map to
        // game entry ids, dropping any item with no game entry id (can't be referenced in-game).
        const resolve = (members, orderKey) => {
            if (!members || !members.size) return [];
            const ord = Array.isArray(order[orderKey]) ? order[orderKey] : [];
            const seen = new Set();
            const ids = [];
            for (const id of ord) if (members.has(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
            for (const id of members) if (!seen.has(id)) { seen.add(id); ids.push(id); }
            return ids.map((id) => gameIdById.get(id)).filter(Boolean);
        };
        const cats = {};
        for (const catId of Object.keys(catMembers)) {
            const arr = resolve(catMembers[catId], catId);
            if (arr.length) cats[catId] = arr;
        }
        const uncat = {};
        for (const tabId of Object.keys(uncatMembers)) {
            const arr = resolve(uncatMembers[tabId], '__uncat');
            if (arr.length) uncat[tabId] = arr;
        }
        return { cats, uncat };
    }

    setLayout(layout) {
        this.layout = layout || { tabs: [], settings: {} };
        if (!this.layout.tabs.some((t) => t.id === this.activeTabId)) {
            this.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
        }
        this._seedCollapsed();
        this.render();
    }

    toggleEdit() {
        if (!this.container) { this.editMode = !this.editMode; return; }
        clearTimeout(this._editAnimTimer);
        const jq = window.$;
        const sel = '.bank-tabedit, .bank-add-cat, .bank-add-tab';
        if (this.editMode) {
            // Turning OFF: jQuery-slide the edit sections up as whole blocks (matches the app's
            // slideUp used elsewhere), then re-render to remove them.
            this.editMode = false;
            this.container.querySelector('.bank-edit-toggle')?.classList.remove('on');
            // Fade the per-category ✎/🗑 buttons out in sync with the slideUp before re-render drops them.
            this.container.querySelectorAll('.bank-cat-menu-btn').forEach((b) => b.classList.add('bank-fade-out'));
            const $secs = jq ? jq(this.container).find(sel) : null;
            if ($secs && $secs.length) {
                let done = false;
                $secs.slideUp(180, () => { if (done) return; done = true; this.render(); });
            } else {
                this.render();
            }
        } else {
            // Turning ON: render the edit sections, then slideDown the whole block so the
            // categories are pushed down smoothly (not popped, then filled).
            this.editMode = true;
            this.render();
            const $secs = jq ? jq(this.container).find(sel) : null;
            if ($secs && $secs.length) $secs.hide().slideDown(180);
        }
    }
    setView(v) { this.view = v; this.render(); }

    /** The dark backdrop for a node's icon chip: category bc, else dark_<token>, else neutral. */
    _nodeBg(node) {
        if (node.bgColor) return node.bgColor;
        if (node._c) { const d = resolveBankColor('dark_' + node._c); if (d) return d; }
        return '#2a2e38';
    }

    _selectIcon() {
        return '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h6M4 10h6M4 14h4"/><path d="M12.5 7.5l2 2 4-4"/></svg>';
    }

    /** Sort: left-aligned bars decreasing in width (matches the game toolbar). */
    /** Sidebar collapse/expand chevron: ‹ when expanded (collapse), › when collapsed (expand). */
    _sortIcon() {
        return '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 10h8M4 14h4"/></svg>';
    }

    /** Filter: solid funnel (matches the game toolbar). */
    _filterIcon() {
        return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46"/></svg>';
    }

    /** Two stacked chevrons: outward = "expand all" (when all collapsed), inward = "collapse all". */
    _collapseAllIcon(allCollapsed) {
        const p = allCollapsed
            ? '<polyline points="5 8 9 4 13 8"/><polyline points="5 12 9 16 13 12"/>'
            : '<polyline points="5 4 9 8 13 4"/><polyline points="5 16 9 12 13 16"/>';
        return `<svg class="bank-ca-svg" width="18" height="20" viewBox="0 0 18 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    }

    /** Category-menu icons. */
    _iconCopy() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'; }
    _iconSelectAll() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l3 3 6-6"/><path d="M9 15l3 3 8-8"/></svg>'; }
    _iconTrash() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'; }
    /** Simple diagonal pencil (nib bottom-left) — used for all bank "edit" affordances. */
    _iconPencil(size = 16) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.2 3.2 20.8 7.8 18.6 10 14 5.4Z"/><path d="M12.9 6.5 17.5 11.1 7.4 21.2 2 23 3.8 17.6Z"/></svg>`; }
    /** Padlock (closed) — shown on a locked category header in edit mode. */
    _iconLock(size = 15) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`; }
    /** Default tab icon (bank/institution building) for tabs with no chosen icon. */
    _defaultTabIcon(size, cls = '') { return `<svg class="bank-default-tab-icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3 4 7.5V9h16V7.5L12 3z"/><rect x="6.6" y="10.2" width="1.6" height="6.4" rx="0.3"/><rect x="11.2" y="10.2" width="1.6" height="6.4" rx="0.3"/><rect x="15.8" y="10.2" width="1.6" height="6.4" rx="0.3"/><rect x="4" y="17.6" width="16" height="2.2" rx="0.5"/></svg>`; }
    /** A tab's icon with NO chip background — its sprite img, or the default bank SVG if none. */
    _tabIconBare(tab, size, cls = '') {
        const src = resolveNodeIcon(tab.icon);
        return src
            ? `<img class="${cls}" src="${esc(src)}" width="${size}" height="${size}" alt="" onerror="${nodeIconOnError(tab.icon)}">`
            : this._defaultTabIcon(size, cls);
    }

    /** Three-dots category action menu. Slides down from the ⋮ button, flipping UP when there
     *  isn't room below (respects the bottom of the viewport). */
    _openCatMenu(anchor, catId) {
        // Clicking the same ⋮ again collapses the open menu (toggle).
        if (this._catMenuEl && this._catMenuAnchor === anchor) { this._closeCatMenu(); return; }
        this._closeCatMenu();
        const menu = document.createElement('div');
        menu.className = 'bank-cat-menu';
        menu.innerHTML = `
            <button class="bank-cm-item" data-act="edit"><span class="bank-cm-ic">${this._iconPencil()}</span>Edit</button>
            <button class="bank-cm-item" data-act="copy"><span class="bank-cm-ic">${this._iconCopy()}</span>Copy</button>
            <button class="bank-cm-item" data-act="selectall"><span class="bank-cm-ic">${this._iconSelectAll()}</span>Select all</button>
            <button class="bank-cm-item danger" data-act="delete"><span class="bank-cm-ic">${this._iconTrash()}</span>Delete</button>`;
        document.body.appendChild(menu);
        menu.style.display = 'block';   // measurable for the flip-up math (CSS defaults it to none)
        const r = anchor.getBoundingClientRect();
        const mh = menu.offsetHeight, mw = menu.offsetWidth, GAP = 6;
        const spaceBelow = window.innerHeight - r.bottom - GAP;
        const openUp = spaceBelow < mh && (r.top - GAP) > spaceBelow;
        const top = openUp ? Math.max(8, r.top - GAP - mh) : r.bottom + GAP;
        const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        // Slide down/up like the column-3 activity/recipe selectors (jQuery slide).
        const jq = window.$;
        if (jq) jq(menu).hide().slideDown(200); else menu.style.display = 'block';
        menu.querySelectorAll('.bank-cm-item').forEach((it) => it.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = it.dataset.act;
            this._closeCatMenu();
            if (act === 'edit') {
                const tab = this.layout.tabs.find((t) => t.id === this.activeTabId);
                const cat = (tab?.categories || []).find((x) => x.id === catId);
                if (cat) this.opts.onEditNode?.(cat, 'category', tab.id);
            } else if (act === 'copy') { this._copyCategory(catId); }
            else if (act === 'selectall') { this._selectAllInCategory(catId); }
            else if (act === 'delete') { this._confirmDeleteCategory(catId); }
        }));
        this._catMenuEl = menu;
        this._catMenuAnchor = anchor;
        this._catMenuOutside = (ev) => { if (!menu.contains(ev.target) && !anchor.contains(ev.target)) this._closeCatMenu(); };
        setTimeout(() => {
            document.addEventListener('mousedown', this._catMenuOutside, true);
            window.addEventListener('scroll', this._catMenuOutside, true);
        }, 0);
    }

    _closeCatMenu() {
        if (this._catMenuOutside) {
            document.removeEventListener('mousedown', this._catMenuOutside, true);
            window.removeEventListener('scroll', this._catMenuOutside, true);
            this._catMenuOutside = null;
        }
        const menu = this._catMenuEl;
        this._catMenuEl = null;
        this._catMenuAnchor = null;
        if (!menu) return;
        const jq = window.$;
        if (jq) jq(menu).slideUp(160, () => menu.remove()); else menu.remove();
    }

    /** Duplicate a category (definition) right after it in the same tab. */
    _copyCategory(catId) {
        const tab = this.layout.tabs.find((t) => t.id === this.activeTabId);
        if (!tab) return;
        const cats = tab.categories || (tab.categories = []);
        const idx = cats.findIndex((c) => c.id === catId);
        if (idx < 0) return;
        // Deep-copy the category CONFIG (name/color/background/shape/filters/icon). Items are not
        // part of the node (they're filter/pin-derived), so the copy starts empty. New id + pins
        // are NOT carried over, so no items follow.
        const copy = JSON.parse(JSON.stringify(cats[idx]));
        copy.id = 'cat-copy-' + Math.random().toString(36).slice(2, 10);
        // Name: strip an existing "#N" suffix to get the base, then pick the next number (>=2)
        // above the highest #N already used by this base family in the tab (base alone counts as #1).
        const rawName = String(cats[idx].name || 'Category');
        const m = rawName.match(/^(.*?)\s*#(\d+)\s*$/);
        const base = ((m ? m[1] : rawName).trim()) || 'Category';
        const famRe = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*#(\\d+))?\\s*$', 'i');
        let maxN = 1;
        for (const c of cats) {
            const mm = String(c.name || '').match(famRe);
            if (mm) { const n = mm[1] ? parseInt(mm[1], 10) : 1; if (n > maxN) maxN = n; }
        }
        copy.name = `${base} #${Math.max(2, maxN + 1)}`;
        cats.splice(idx + 1, 0, copy);
        this._markChanged();
        this.render();
    }

    /** Enter select mode and select every item currently shown in the category. */
    _selectAllInCategory(catId) {
        const sec = [...this.container.querySelectorAll('.bank-cat[data-cat]')].find((el) => el.dataset.cat === catId);
        if (!sec) return;
        this._selectMode = true;
        // Use the full cached grid list (lazy-render may not have all tiles in the DOM yet),
        // falling back to the currently-rendered tiles.
        const full = this._gridLists && this._gridLists[catId];
        if (Array.isArray(full)) full.forEach((it) => { if (!it._placeholder) this._selected.add(it.id); });
        else sec.querySelectorAll('.bank-item[data-drag="true"][data-item]').forEach((el) => this._selected.add(el.dataset.item));
        this._syncSelectionDom();
    }

    _confirmDeleteCategory(catId) {
        const ov = document.createElement('div');
        ov.className = 'bank-chooser-overlay bank-confirm-overlay';
        ov.innerHTML = `
            <div class="bank-chooser bank-confirm" role="dialog" aria-label="Delete category">
                <h3>Delete category?</h3>
                <p class="bank-confirm-msg">Items in this category will be moved to Uncategorized.</p>
                <div class="bank-confirm-actions">
                    <button class="bank-chooser-cancel" data-cc>Cancel</button>
                    <button class="bank-confirm-del" data-cd>Delete</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('show'));
        const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); };
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        ov.querySelector('[data-cc]').addEventListener('click', close);
        ov.querySelector('[data-cd]').addEventListener('click', () => { close(); this.opts.onDeleteCategory?.(catId); });
    }

    _iconMarkup(node, size) {
        const shape = `bank-shape-${node.bgShape || 'circle'}`;
        const bg = this._nodeBg(node);
        const src = resolveNodeIcon(node.icon);
        // Sprites are path-based SVGs, so they scale cleanly. For larger chips (category
        // headers) keep the icon at 24 and let the circle be roomier so the full sprite fits
        // without corner clipping; small chips (edit-tab, 20px) stay at native 20.
        const px = size >= 24 ? size - 8 : Math.min(20, size);
        const inner = src
            ? `<img src="${esc(src)}" alt="" width="${px}" height="${px}" onerror="${nodeIconOnError(node.icon)}">`
            : '';
        return `<span class="bank-node-icon ${shape}" style="width:${size}px;height:${size}px;background:${esc(bg)}">${inner}</span>`;
    }

    render() {
        if (!this.container) return;
        this._closeCatMenu();
        const allItems = getBankItems();
        // When placeholders are OFF we hide non-owned items from the view, so the
        // tab/category counts must be computed from the SAME (owned-only) set —
        // otherwise the numbers stay inflated by items that aren't shown. Assigning
        // owned-only is safe: first-match placement is per-item, so owned items land
        // in exactly the same categories either way.
        const showPh = this.layout.settings ? this.layout.settings.showPlaceholders !== false : true;
        this._showPh = showPh;
        const items = showPh ? allItems : allItems.filter((i) => i.owned);
        const assignment = assign(items, this.layout, { pins: this.layout.pins || {} });
        const counts = layoutCounts(assignment);
        this.lastAssignment = assignment;
        const st = this._settings();
        this._st = st;
        this._sortState = this._sort();
        this._filterState = this._filter();

        // Placeholder ghosts: for items in history that we do NOT currently own
        // (and aren't already shown), render a dimmed marker in their remembered spot.
        this._ph = {};
        if (showPh) {
            const itemsById = new Map(items.map((i) => [i.id, i]));
            const placed = new Set();
            for (const b of Object.values(assignment.byTab)) {
                for (const arr of Object.values(b.byCategory)) for (const it of arr) placed.add(it.id);
                for (const it of b.uncategorized) placed.add(it.id);
            }
            for (const [itemId, loc] of Object.entries(this.itemHistory || {})) {
                const it = itemsById.get(itemId);
                if (!it || it.owned || placed.has(itemId)) continue;
                const tb = assignment.byTab[loc.tab_id];
                if (!tb) continue;
                if (loc.cat_id && !tb.byCategory[loc.cat_id]) continue;
                const key = loc.cat_id || '__uncat';
                if (!this._ph[loc.tab_id]) this._ph[loc.tab_id] = {};
                if (!this._ph[loc.tab_id][key]) this._ph[loc.tab_id][key] = [];
                this._ph[loc.tab_id][key].push({ ...it, _placeholder: true });
            }
        }
        const tabs = this.layout.tabs || [];
        const activeTab = tabs.find((t) => t.id === this.activeTabId) || tabs[0];
        const activeCats = (activeTab && activeTab.categories) || [];
        const allCollapsed = activeCats.length > 0 && activeCats.every((cat) => this.collapsed.has(cat.id));

        // Tab rail
        const rail = tabs.map((tab) => {
            const n = counts.tabs[tab.id] || 0;
            const active = tab.id === (activeTab && activeTab.id);
            const bright = tab.color || '#8a8f99';
            const dark = this._nodeBg(tab);
            const src = resolveNodeIcon(tab.icon);
            const iconImg = src
                ? `<img class="bank-tab-icon" src="${esc(src)}" alt="" width="40" height="40" onerror="${nodeIconOnError(tab.icon)}">`
                : this._defaultTabIcon(28, 'bank-tab-icon');
            return `<button class="bank-tab ${active ? 'active' : ''}" data-tab="${esc(tab.id)}"
                title="${esc(tab.name)}" style="--tab-c:${esc(bright)};--tab-dark:${esc(dark)}">
                ${iconImg}
                ${st.showTabCounts ? `<span class="bank-tab-count">${n}</span>` : ''}
            </button>`;
        }).join('');
        const addTab = this.editMode
            ? `<button class="bank-add-tab" title="New tab">＋</button>` : '';

        // Main area for the active tab
        let main = '';
        if (activeTab) {
            const bucket = assignment.byTab[activeTab.id] || { byCategory: {}, uncategorized: [] };
            const catHtml = (activeTab.categories || []).map((cat) => {
                const n = counts.categories[activeTab.id]?.[cat.id] || 0;
                const ph = (this._ph[activeTab.id] && this._ph[activeTab.id][cat.id]) || [];
                // In edit mode show EVERY category (even empty ones without "Show when empty")
                // so they can be reordered/edited; only the normal view hides empty categories.
                if (!this.editMode && !isVisible(cat, n) && !ph.length) return '';
                const isCollapsed = this.collapsed.has(cat.id);
                const rows = this._itemsMarkup([...(bucket.byCategory[cat.id] || []), ...ph], cat.id);
                // Filter indicator: when a filter is active, show "shown / total" for this category.
                const _catItems = bucket.byCategory[cat.id] || [];
                const _flt = this._filterState;
                const filterInd = (_flt && _flt.enabled)
                    ? `<span class="bank-cat-filter" title="Shown / total in this category">${this._filterIcon()}<span class="bank-cat-filter-num">${_catItems.filter((it) => itemPassesDisplayFilter(it, _flt)).length}/${_catItems.length}</span></span>`
                    : '';
                return `<section class="bank-cat ${isCollapsed ? 'collapsed' : ''}" data-cat="${esc(cat.id)}"
                    style="--cat-accent:${esc(cat.color || '#888')};--cat-bg:${esc(this._nodeBg(cat))}">
                    <header class="bank-cat-head" data-collapse="${esc(cat.id)}" data-cathead="${esc(cat.id)}" ${this.editMode ? 'data-catdrag="1"' : ''}>
                        ${resolveNodeIcon(cat.icon) ? this._iconMarkup(cat, 24) : ''}
                        <span class="bank-cat-name">${esc(cat.name)}</span>
                        ${this.editMode && cat.locked ? `<span class="bank-cat-lock" title="Items locked in place when auto-organizing">${this._iconLock(15)}</span>` : ''}
                        ${st.showCatCounts ? `<span class="bank-cat-count">${n}</span>` : ''}
                        ${filterInd}
                        ${this.editMode ? `<button class="bank-cat-menu-btn" data-catmenu="${esc(cat.id)}" title="Category actions" aria-label="Category actions">⋮</button>` : ''}
                        <span class="bank-chevron expand-arrow">▼</span>
                    </header>
                    <div class="bank-cat-body"><div class="bank-items bank-items-${this.view}">${rows}</div></div>
                </section>`;
            }).join('');
            const addCat = ''; // bottom "+ Add Category" removed; use the ＋ in the edit tab bar
            // Uncategorized: items in THIS tab that matched no category, plus the globally
            // unmatched items shown ONLY under the catch-all tab (first filterless tab, else
            // the first tab) so they don't get dumped under every tab.
            const catchAllTabId = ((tabs.find((t) => !(t.filters && t.filters.length))) || tabs[0] || {}).id;
            const globalUncat = (activeTab.id === catchAllTabId) ? (assignment.globalUncategorized || []) : [];
            const uncat = [...(bucket.uncategorized || []), ...globalUncat];
            const uncatPh = (this._ph[activeTab.id] && this._ph[activeTab.id].__uncat) || [];
            const uncCollapsed = this.collapsed.has('__uncat');
            const uncatHtml = (uncat.length || uncatPh.length) ? `<section class="bank-cat bank-uncat ${uncCollapsed ? 'collapsed' : ''}" data-cat="__uncat">
                <header class="bank-cat-head" data-collapse="__uncat">
                    <span class="bank-cat-name">Uncategorized</span>
                    ${st.showCatCounts ? `<span class="bank-cat-count">${new Set(uncat.map((i) => i.id)).size}</span>` : ''}
                    <span class="bank-chevron expand-arrow">▼</span>
                </header>
                <div class="bank-cat-body"><div class="bank-items bank-items-${this.view}">${this._itemsMarkup([...uncat, ...uncatPh], '__uncat')}</div></div>
            </section>` : '';
            // Edit-mode tab bar: add category / edit this tab / delete this tab (matches the game).
            const editBar = this.editMode ? `<div class="bank-tabedit">
                <button class="bank-add-cat-top" data-addcat="${esc(activeTab.id)}" title="Add category">＋</button>
                <button class="bank-edit-tab" title="Edit tab">Edit ${this._tabIconBare(activeTab, 20, 'bank-et-icon')}<span class="bank-edit-tab-name">${esc(activeTab.name)}</span></button>
                <button class="bank-del-tab" title="Delete tab">🗑</button>
            </div>` : '';
            main = editBar + catHtml + addCat + uncatHtml;
        }

        const _prevMainScroll = this.container.querySelector('.bank-main')?.scrollTop || 0;
        this.container.innerHTML = `
            <div class="bank-coverage-slot"></div>
            <div class="bank-toolbar">
                <div class="bank-toolbar-top">
                    ${activeTab && resolveNodeIcon(activeTab.icon) ? `<img class="bank-tt-icon" src="${esc(resolveNodeIcon(activeTab.icon))}" width="26" height="26" alt="" onerror="${nodeIconOnError(activeTab.icon)}">` : (activeTab ? this._defaultTabIcon(24, 'bank-tt-icon') : '')}
                    <span class="bank-tt-name" style="color:${esc((activeTab && activeTab.color) || '#8a8f99')}">${esc((activeTab && activeTab.name) || '')}</span>
                    <span style="flex:1"></span>
                    <button class="bank-edit-toggle ${this.editMode ? 'on' : ''}" title="Edit layout">${this._iconPencil(20)}</button>
                    <span class="bank-tt-div"></span>
                    <button class="bank-settings-btn" title="Bank settings">⚙\uFE0E</button>
                </div>
                <div class="bank-toolbar-sep" style="--sep-c:${esc((activeTab && activeTab.color) || '#8a8f99')}"></div>
                <div class="bank-toolbar-row">
                    <div class="bank-view-toggle">
                        <button class="bank-vt" data-view="${this.view === 'grid' ? 'list' : 'grid'}" title="${this.view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}">${this.view === 'grid' ? '☰' : '▦'}</button>
                    </div>
                    <span class="bank-tt-div"></span>
                    <button class="bank-collapse-all" title="${allCollapsed ? 'Expand all' : 'Collapse all'}">${this._collapseAllIcon(allCollapsed)}</button>
                    <span class="bank-tt-div"></span>
                    <button class="bank-sort-btn ${this._sortState.key !== 'default' ? 'on' : ''}" title="Sort items">${this._sortIcon()}</button>
                    <span class="bank-tt-div"></span>
                    <button class="bank-filter-btn ${this._filterState.enabled ? 'on' : ''}" title="Filter items">${this._filterIcon()}</button>
                    <span class="bank-tt-div"></span>
                    <button class="bank-select-btn ${this._selectMode ? 'on' : ''}" title="Select multiple">${this._selectIcon()}</button>
                </div>
            </div>
            <div class="bank-body ${this._railCollapsed ? 'rail-collapsed' : ''}">
                <nav class="bank-rail">
                    <div class="bank-rail-tabs">${rail}${addTab}</div>
                </nav>
                <button class="bank-rail-toggle" title="${this._railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}" aria-label="${this._railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}"></button>
                <div class="bank-main">${main || '<div class="bank-empty">No tabs yet.</div>'}</div>
            </div>
            ${this._settingsOpen ? this._settingsPanelMarkup() : ''}
            ${this._sortOpen ? this._sortPanelMarkup() : ''}
            ${this._filterOpen ? this._filterPanelMarkup() : ''}`;

        this._coverage = this.container.querySelector('.bank-coverage-slot');
        this.container.style.setProperty('--bank-grid-cols', st.gridCols);
        this.container.classList.toggle('bank-no-gradients', !st.showGradients);
        this.container.classList.toggle('bank-condensed', !!st.condensedList);
        this._renderCoverage(assignment, counts);
        this._bind();
        this._syncSelectionDom();
        const _m = this.container.querySelector('.bank-main');
        if (_m && _prevMainScroll) _m.scrollTop = _prevMainScroll;
    }

    _renderCoverage(assignment, counts) {
        const slot = this.container.querySelector('.bank-coverage-slot');
        if (!slot) return;
        const uncat = new Set((assignment.globalUncategorized || []).map((i) => i.id)).size;
        const ambiguous = (assignment.multiMatched || []).length;
        const empties = [];
        for (const tab of (this.layout.tabs || [])) {
            for (const cat of (tab.categories || [])) {
                if ((counts.categories[tab.id]?.[cat.id] || 0) === 0) empties.push(`${tab.name} › ${cat.name}`);
            }
        }
        const ok = !uncat && !ambiguous && !empties.length;
        const open = this._coverageOpen != null ? this._coverageOpen : !ok;
        slot.innerHTML = `<div class="bank-coverage ${open ? 'open' : ''}">
            <div class="bank-coverage-summary" role="button" tabindex="0" aria-expanded="${open}">
                <span class="bank-chevron expand-arrow" aria-hidden="true">▼</span>
                <span>Coverage ${ok ? '✓' : `— ${uncat} uncategorized, ${ambiguous} ambiguous, ${empties.length} empty`}</span>
            </div>
            <div class="bank-coverage-anim"><div class="bank-coverage-body">
                <div><strong>${uncat}</strong> item(s) match no category (Uncategorized).</div>
                <div><strong>${ambiguous}</strong> item(s) match multiple categories${ambiguous ? ': ' + esc((assignment.multiMatched.slice(0, 8).map((m) => m.item.name || m.item.id).join(', '))) : ''}.</div>
                <div><strong>${empties.length}</strong> empty categor(ies)${empties.length ? ': ' + esc(empties.slice(0, 10).join(', ')) : ''}.</div>
            </div></div>
        </div>`;
        const box = slot.querySelector('.bank-coverage');
        slot.querySelector('.bank-coverage-summary')?.addEventListener('click', () => {
            const nowOpen = !box.classList.contains('open');
            box.classList.toggle('open', nowOpen);
            box.querySelector('.bank-coverage-summary')?.setAttribute('aria-expanded', String(nowOpen));
            this._coverageOpen = nowOpen;
        });
    }

    _itemsMarkup(items, catKey) {
        // #8 — "Show placeholders" off hides items you don't currently own
        // (grayscale not-owned items + history ghosts). Owned items always show.
        let list = items;
        const f = this._filterState;
        if (f && f.enabled) list = list.filter((it) => itemPassesDisplayFilter(it, f));
        if (!this._showPh) list = list.filter((it) => it.owned && !it._placeholder);
        list = sortItems(list, this._sortState);
        // Manual drag order (edit-mode reordering) applies ONLY in default sort.
        if (this._sortState.key === 'default' && catKey) {
            const order = (this.layout.settings && this.layout.settings.itemOrder && this.layout.settings.itemOrder[catKey]) || null;
            if (order && order.length) {
                const pos = new Map(order.map((id, i) => [id, i]));
                list = list.map((it, i) => [it, i])
                    .sort((a, b) => (pos.has(a[0].id) ? pos.get(a[0].id) : order.length + a[1]) - (pos.has(b[0].id) ? pos.get(b[0].id) : order.length + b[1]))
                    .map((x) => x[0]);
            }
        }
        // Lazy-render: only build the first GRID_CHUNK tiles now; the rest are appended on
        // scroll (see _setupGridLazyLoad). A huge Uncategorized grid (~800 items) rebuilt on
        // every interaction was the main source of drag/edit lag. Counts/filters use the
        // engine assignment (not the DOM), so they stay accurate regardless of the cap.
        const ck = catKey || '__nokey';
        (this._gridLists || (this._gridLists = {}))[ck] = list;
        (this._gridShown || (this._gridShown = {}))[ck] = Math.min(GRID_CHUNK, list.length);
        const first = list.slice(0, GRID_CHUNK).map((it) => this._tileHtml(it)).join('');
        const sentinel = list.length > GRID_CHUNK ? `<div class="bank-grid-sentinel" data-more="${esc(ck)}"></div>` : '';
        return first + sentinel;
    }

    /** Build one item tile's HTML. Shared by the initial render and lazy chunk append. */
    _tileHtml(it) {
            const ph = !!it._placeholder;
            const notOwned = !ph && !it.owned;
            const qk = qualityKey(it.quality);
            const cls = ` rarity-${qk}` + (ph ? ' placeholder' : '') + (notOwned ? ' not-owned' : '') + ((this._selectMode && this._selected.has(it.id)) ? ' selected' : '');
            const drag = ph ? 'false' : 'true';
            const qty = (!ph && it.qty != null) ? `<span class="bank-item-qty">${esc(it.qty)}</span>` : '';
            const icon = it.icon ? `<img src="${esc(it.icon)}" alt="" width="32" height="32" draggable="false" onerror="${ICON_ONERROR}">` : '<span class="bank-item-noicon"></span>';
            // A tool is stored as type "gear" with gearType "tool" — surface it as its own
            // "tool" type (pickaxe badge) instead of the generic gear badge.
            const isTool = String(it.gearType || '').toLowerCase() === 'tool' || String(it.type || '').toLowerCase() === 'tool';
            const badgeType = isTool ? 'tool' : String(it.type || '').toLowerCase().replace(/_item$/, '');
            const tIcon = ITEM_TYPE_ICON[badgeType];
            const typeBadge = (this._st && this._st.showTypeIcons && tIcon)
                ? `<span class="bank-item-type-badge" title="${esc(badgeType)}"><img src="${tIcon}" width="14" height="14" alt="" draggable="false" onerror="this.style.display='none'"></span>` : '';
            const title = ph ? `${esc(it.name || it.id)} (placeholder — not currently owned)` : esc(it.name || it.id);
            const qstyle = `--q-border:${Q_BORDER[qk]}`;
            if (this.view === 'list') {
                return `<div class="bank-item${cls}" draggable="false" data-drag="${drag}" data-item="${esc(it.id)}" title="${title}" style="${qstyle}">
                    <span class="bank-item-icon">${icon}${qty}</span>
                    <span class="bank-item-type">${esc((isTool ? 'tool' : (it.type || '')).toUpperCase())}</span>
                    <span class="bank-item-name">${esc(it.name || it.id)}</span>
                </div>`;
            }
            return `<div class="bank-item grid${cls}" draggable="false" data-drag="${drag}" data-item="${esc(it.id)}" title="${title}" style="${qstyle}">
                ${typeBadge}
                <span class="bank-item-icon">${icon}</span>
                ${qty}
            </div>`;
    }

    /** After a render, watch each grid's sentinel and append the next chunk as it nears view. */
    _setupGridLazyLoad() {
        if (this._gridObserver) { this._gridObserver.disconnect(); this._gridObserver = null; }
        const sentinels = this.container.querySelectorAll('.bank-grid-sentinel');
        if (!sentinels.length) return;
        this._gridObserver = new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (e.isIntersecting) this._appendGridChunk(e.target);
            }
        }, { root: null, rootMargin: '800px 0px' });   // viewport root works for window- or inner-scroll
        sentinels.forEach((s) => this._gridObserver.observe(s));
    }

    /** Append the next GRID_CHUNK tiles into the sentinel's grid and bind drag on them. */
    _appendGridChunk(sentinel) {
        const ck = sentinel.dataset.more;
        const list = this._gridLists && this._gridLists[ck];
        if (!list) { sentinel.remove(); return; }
        const shown = (this._gridShown && this._gridShown[ck]) || 0;
        const next = list.slice(shown, shown + GRID_CHUNK);
        if (!next.length) { this._gridObserver?.unobserve(sentinel); sentinel.remove(); return; }
        const grid = sentinel.parentNode;
        const frag = document.createElement('div');
        frag.innerHTML = next.map((it) => this._tileHtml(it)).join('');
        const added = [...frag.children];
        for (const el of added) grid.insertBefore(el, sentinel);
        this._gridShown[ck] = shown + next.length;
        // Bind pointer-drag on the freshly-added tiles only.
        added.forEach((el) => { if (el.dataset && el.dataset.drag === 'true') this._attachPointerDrag(el, 'item'); });
        if (this._gridShown[ck] >= list.length) { this._gridObserver?.unobserve(sentinel); sentinel.remove(); }
    }

    _bind() {
        const c = this.container;
        c.querySelectorAll('.bank-tab').forEach((b) => b.addEventListener('click', () => {
            this.activeTabId = b.dataset.tab; this.render();
        }));
        c.querySelectorAll('.bank-vt').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
        c.querySelector('.bank-collapse-all')?.addEventListener('click', () => {
            const tab = this.layout.tabs.find((t) => t.id === this.activeTabId);
            const cats = (tab?.categories || []);
            const allCollapsed = cats.every((cat) => this.collapsed.has(cat.id));
            cats.forEach((cat) => { if (allCollapsed) this.collapsed.delete(cat.id); else this.collapsed.add(cat.id); });
            c.querySelectorAll('.bank-cat[data-cat]').forEach((sec) => sec.classList.toggle('collapsed', !allCollapsed));
            const btn = c.querySelector('.bank-collapse-all');
            if (btn) { btn.innerHTML = this._collapseAllIcon(!allCollapsed); btn.title = !allCollapsed ? 'Expand all' : 'Collapse all'; }
        });
        c.querySelector('.bank-edit-toggle')?.addEventListener('click', () => this.toggleEdit());
        c.querySelector('.bank-settings-btn')?.addEventListener('click', () => { this._settingsOpen = true; this.render(); });
        c.querySelector('.bank-select-btn')?.addEventListener('click', () => {
            this._selectMode = !this._selectMode;
            if (!this._selectMode) this._selected.clear();
            this._syncSelectionDom();
        });
        c.querySelector('.bank-sort-btn')?.addEventListener('click', () => { this._sortOpen = true; this.render(); });
        c.querySelector('.bank-filter-btn')?.addEventListener('click', () => { this._filterOpen = true; this.render(); });
        c.querySelector('[data-sort-close]')?.addEventListener('click', () => this._closeOverlay('sort', '[data-sort-overlay]'));
        c.querySelector('[data-sort-overlay]')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) this._closeOverlay('sort', '[data-sort-overlay]'); });
        c.querySelector('[data-filter-close]')?.addEventListener('click', () => this._closeOverlay('filter', '[data-filter-overlay]'));
        c.querySelector('[data-filter-overlay]')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) this._closeOverlay('filter', '[data-filter-overlay]'); });
        c.querySelectorAll('.bank-sort-opt').forEach((b) => b.addEventListener('click', () => {
            const k = b.dataset.sort;
            const cur = this._sort();
            const dir = k === 'default' ? 'asc' : (cur.key === k ? (cur.dir === 'asc' ? 'desc' : 'asc') : (SORT_DEFAULT_DIR[k] || 'asc'));
            this.layout.settings = this.layout.settings || {};
            this.layout.settings.sort = { key: k, dir };
            this.opts.onLayoutChanged?.();
            this.render();
        }));
        const filterObj = () => {
            const s = this.layout.settings = this.layout.settings || {};
            s.filter = s.filter || { enabled: false, owned: false, types: [], skills: [], qualities: [] };
            return s.filter;
        };
        c.querySelector('[data-filter-enable]')?.addEventListener('change', (e) => {
            filterObj().enabled = e.target.checked; this.opts.onLayoutChanged?.(); this.render();
        });
        c.querySelector('[data-filter-owned]')?.addEventListener('change', (e) => {
            const f = filterObj(); f.owned = e.target.checked; if (f.owned) f.enabled = true; this.opts.onLayoutChanged?.(); this.render();
        });
        c.querySelector('[data-filter-clear]')?.addEventListener('click', () => {
            this.layout.settings = this.layout.settings || {};
            this.layout.settings.filter = { enabled: false, owned: false, types: [], skills: [], qualities: [] };
            this.opts.onLayoutChanged?.(); this.render();
        });
        c.querySelectorAll('.bank-filter-chip').forEach((b) => b.addEventListener('click', () => {
            const dim = b.dataset.fdim, val = b.dataset.fval;
            const f = filterObj();
            f[dim] = f[dim] || [];
            const i = f[dim].indexOf(val);
            if (i >= 0) f[dim].splice(i, 1); else { f[dim].push(val); f.enabled = true; }
            this.opts.onLayoutChanged?.();
            this.render();
        }));
        const closeSettings = () => this._closeOverlay('settings', '[data-settings-overlay]');
        c.querySelector('[data-settings-close]')?.addEventListener('click', closeSettings);
        c.querySelector('[data-settings-overlay]')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeSettings(); });
        c.querySelectorAll('.bank-settings [data-set]').forEach((cb) => cb.addEventListener('change', () => {
            this.layout.settings = this.layout.settings || {};
            this.layout.settings[cb.dataset.set] = cb.checked;
            if (cb.dataset.set === 'startCollapsed' && cb.checked) {
                for (const t of (this.layout.tabs || [])) for (const cat of (t.categories || [])) this.collapsed.add(cat.id);
            }
            this.opts.onLayoutChanged?.();
            this.render();
        }));
        c.querySelectorAll('.bank-col-opt').forEach((b) => b.addEventListener('click', () => {
            this.layout.settings = this.layout.settings || {};
            this.layout.settings.gridCols = Number(b.dataset.cols);
            this.opts.onLayoutChanged?.();
            this.render();
        }));
        c.querySelectorAll('.bank-cat-head[data-collapse]').forEach((h) => h.addEventListener('click', (e) => {
            if (e.target.closest('.bank-cat-menu-btn')) return;
            if (Date.now() - (this._pdJustDragged || 0) < 300) return; // ignore the click after a drag
            const id = h.dataset.collapse;
            const sec = h.closest('.bank-cat');
            if (this.collapsed.has(id)) { this.collapsed.delete(id); sec.classList.remove('collapsed'); }
            else { this.collapsed.add(id); sec.classList.add('collapsed'); }
        }));
        c.querySelectorAll('.bank-cat-menu-btn').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            this._openCatMenu(b, b.dataset.catmenu);
        }));
        c.querySelector('.bank-add-cat')?.addEventListener('click', (e) => this.opts.onAddCategory?.(e.currentTarget.dataset.addcat));
        c.querySelector('.bank-add-tab')?.addEventListener('click', () => this.opts.onAddTab?.());
        c.querySelector('.bank-rail-toggle')?.addEventListener('click', (e) => {
            this._railCollapsed = !this._railCollapsed;
            // Toggle the class on the live DOM (no full re-render) so the CSS width/gap
            // transition actually animates the slide. Keep the flag in sync for future renders.
            c.querySelector('.bank-body')?.classList.toggle('rail-collapsed', this._railCollapsed);
            const btn = e.currentTarget;
            btn.title = this._railCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
            btn.setAttribute('aria-label', btn.title);
        });
        c.querySelector('.bank-add-cat-top')?.addEventListener('click', (e) => this.opts.onAddCategory?.(e.currentTarget.dataset.addcat));
        c.querySelector('.bank-edit-tab')?.addEventListener('click', () => {
            const t = this.layout.tabs.find((x) => x.id === this.activeTabId);
            if (t) this.opts.onEditTab?.(t);
        });
        c.querySelector('.bank-del-tab')?.addEventListener('click', () => this.opts.onDeleteTab?.(this.activeTabId));

        // ---- Pointer-based drag & drop (touch + desktop; fully-controlled opaque proxy,
        // no native HTML5 setDragImage which is unreliable/transparent on iOS) ----
        c.querySelectorAll('.bank-item[data-drag="true"]').forEach((el) => this._attachPointerDrag(el, 'item'));
        if (this.editMode) {
            c.querySelectorAll('.bank-cat-head[data-catdrag]').forEach((el) => this._attachPointerDrag(el, 'cat'));
        }
        this._setupGridLazyLoad();
        this._revealOverlays();
    }

    /** Fade/scale the render-driven overlays (settings/sort/filter) in on first open only.
     *  When already shown, the markup carries `.show` so internal re-renders don't re-animate. */
    _revealOverlays() {
        for (const [kind, sel] of [['settings', '[data-settings-overlay]'], ['sort', '[data-sort-overlay]'], ['filter', '[data-filter-overlay]']]) {
            if (!this[`_${kind}Open`]) { this[`_${kind}Shown`] = false; continue; }
            if (this[`_${kind}Shown`]) continue; // already visible → markup already has .show
            const ov = this.container.querySelector(sel);
            if (!ov) continue;
            this[`_${kind}Shown`] = true;
            requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('show')));
        }
    }

    /** Close a render-driven overlay with the fade-out/size-down, then re-render to unmount it. */
    _closeOverlay(kind, sel) {
        const ov = this.container.querySelector(sel);
        this[`_${kind}Open`] = false;
        this[`_${kind}Shown`] = false;
        if (ov) { ov.classList.remove('show'); setTimeout(() => this.render(), 200); }
        else this.render();
    }

    _attachPointerDrag(el, kind) {
        el.addEventListener('pointerdown', (e) => {
            if (this._pd) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.target.closest('button')) return; // let edit/delete/chevron buttons work
            const id = kind === 'item' ? el.dataset.item : el.dataset.cathead;
            const fromCatKey = kind === 'item' ? (el.closest('.bank-cat[data-cat]')?.dataset.cat || null) : null;
            this._pd = { el, kind, id, fromCatKey, x0: e.clientX, y0: e.clientY, ptype: e.pointerType, active: false, moved: false, timer: null };
            window.addEventListener('pointermove', this._onPdMove, { passive: false });
            window.addEventListener('pointerup', this._onPdUp);
            window.addEventListener('pointercancel', this._onPdUp);
            window.addEventListener('touchmove', this._onPdTouchMove, { passive: false });
            if (e.pointerType !== 'mouse') {
                this._pd.timer = setTimeout(() => { if (this._pd && !this._pd.active) this._beginPointerDrag(this._pd.x0, this._pd.y0); }, 220);
            }
        });
    }

    _onPdMove(e) {
        const pd = this._pd; if (!pd) return;
        const dx = e.clientX - pd.x0, dy = e.clientY - pd.y0;
        const dist = Math.hypot(dx, dy);
        if (!pd.active) {
            if (pd.ptype === 'mouse') { if (dist > 4) this._beginPointerDrag(e.clientX, e.clientY); }
            else if (dist > 12) { this._endPointerDrag(); return; } // moved before long-press → treat as scroll
            if (!pd.active) return;
        }
        if (e.cancelable) e.preventDefault();
        // Coalesce rapid pointermove events into ONE animation frame. The heavy work
        // (proxy move, elementFromPoint hit-test, insertion-gap FLIP) all force layout,
        // so running it on every raw pointermove janks badly on mobile where events
        // fire far faster than frames. Keep only the latest coords.
        pd.lastX = e.clientX; pd.lastY = e.clientY;
        if (this._pdRAF) return;
        this._pdRAF = requestAnimationFrame(() => {
            this._pdRAF = 0;
            const p = this._pd;
            if (p && p.active) this._processPdMove(p.lastX, p.lastY);
        });
    }

    /** The layout-touching drag work, run at most once per frame (see _onPdMove). */
    _processPdMove(x, y) {
        this._movePointerProxy(x, y);
        // Same-category reorder → show a live gap so neighbouring items shift to make room.
        if (this._updateInsertionGap(x, y)) this._clearDropTargets();
        else this._updatePointerDropTarget(x, y);
    }

    _onPdUp(e) {
        const pd = this._pd; if (!pd) return;
        if (pd.active) {
            if (e.cancelable) e.preventDefault();
            this._dropPointer(e.clientX, e.clientY);
            this._pdJustDragged = Date.now();
        } else if (pd.kind === 'item' && this._selectMode) {
            // tap in select mode → toggle selection
            if (this._selected.has(pd.id)) this._selected.delete(pd.id); else this._selected.add(pd.id);
            this._syncSelectionDom();
        }
        this._endPointerDrag();
    }

    _dragIds(pd) {
        if (pd.kind !== 'item') return [pd.id];
        return (this._selectMode && this._selected.has(pd.id) && this._selected.size > 1) ? [...this._selected] : [pd.id];
    }

    _beginPointerDrag(x, y) {
        const pd = this._pd; if (!pd) return;
        pd.active = true;
        pd.lastX = x; pd.lastY = y;   // seed for edge auto-scroll before the first move
        const ids = this._dragIds(pd);
        pd.ids = ids;
        // Build the opaque proxy (stacked + count for a multi-selection).
        pd.proxy = this._buildDragProxy(pd.el, pd.kind === 'item' && ids.length > 1 ? ids.length : 0);
        document.body.appendChild(pd.proxy);
        document.body.classList.add('bank-pd-dragging');
        // Fade the source(s).
        if (pd.kind === 'item') {
            ids.forEach((x2) => this.container.querySelector(`.bank-item[data-item="${x2}"]`)?.classList.add('bank-dragging'));
            if (this._sortState.key === 'default' && ids.length === 1) {
                const srcCat = this.container.querySelector(`.bank-item[data-item="${pd.id}"]`)?.closest('.bank-cat[data-cat]');
                if (srcCat) this._buildReorderSnapFor(srcCat);
            }
        } else {
            document.body.classList.add('bank-dragging-cat');
        }
        this._movePointerProxy(x, y);
        this._startAutoScroll();
    }

    /** While dragging, scroll a container when the pointer nears its top/bottom edge.
     *  Covers the left tab rail (.bank-rail-tabs) and the main category area (.bank-main). */
    _startAutoScroll() {
        if (this._autoScrollRAF) return;
        const EDGE = 64, MAX = 18;
        const tick = () => {
            this._autoScrollRAF = 0;
            const pd = this._pd;
            if (!pd || !pd.active) return;
            const x = pd.lastX, y = pd.lastY;
            let scrolled = false;
            const containers = [this.container.querySelector('.bank-main'), this.container.querySelector('.bank-rail-tabs')];
            for (const el of containers) {
                if (!el) continue;
                const r = el.getBoundingClientRect();
                if (x < r.left - 24 || x > r.right + 24) continue;          // pointer not over this column
                const maxScroll = el.scrollHeight - el.clientHeight;
                if (maxScroll <= 0) continue;
                let dy = 0;
                if (y < r.top + EDGE && el.scrollTop > 0) {
                    dy = -Math.ceil(MAX * Math.min(1, (r.top + EDGE - y) / EDGE));
                } else if (y > r.bottom - EDGE && el.scrollTop < maxScroll) {
                    dy = Math.ceil(MAX * Math.min(1, (y - (r.bottom - EDGE)) / EDGE));
                }
                if (dy) {
                    const before = el.scrollTop;
                    el.scrollTop = Math.max(0, Math.min(maxScroll, before + dy));
                    if (el.scrollTop !== before) scrolled = true;
                }
            }
            // Content moved under a stationary pointer → refresh gap/drop-target against the new
            // positions. Invalidate the reorder snapshot so it rebuilds with current rects.
            if (scrolled) { this._reorderSnap = null; this._processPdMove(x, y); }
            this._autoScrollRAF = requestAnimationFrame(tick);
        };
        this._autoScrollRAF = requestAnimationFrame(tick);
    }

    _stopAutoScroll() {
        if (this._autoScrollRAF) { cancelAnimationFrame(this._autoScrollRAF); this._autoScrollRAF = 0; }
    }

    _buildDragProxy(el, count) {
        const rect = el.getBoundingClientRect();
        const w = rect.width, h = rect.height;
        const proxy = document.createElement('div');
        proxy.className = 'bank-drag-proxy';
        proxy.style.width = (count ? w + 8 : w) + 'px';
        proxy.style.height = (count ? h + 8 : h) + 'px';
        if (count) {
            for (const off of [8, 4]) {
                const card = document.createElement('div');
                card.className = 'bank-drag-stack-card';
                Object.assign(card.style, { position: 'absolute', left: off + 'px', top: off + 'px', width: w + 'px', height: h + 'px' });
                proxy.appendChild(card);
            }
        }
        const base = el.cloneNode(true);
        base.classList.remove('bank-dragging', 'not-owned', 'placeholder', 'selected');
        Object.assign(base.style, { position: 'absolute', left: '0', top: '0', margin: '0', width: w + 'px', height: h + 'px', opacity: '1', filter: 'none' });
        // A category header's tint (--cat-bg) and icon ring (--cat-accent) are defined on
        // the parent .bank-cat section and inherited by the header. Once cloned onto <body>
        // that inheritance is gone, so the proxy would render bare (the "old drag" look).
        // Copy the resolved custom props onto the clone so it stays fully stylized.
        if (this._pd && this._pd.kind === 'cat') {
            const cs = getComputedStyle(el);
            base.style.setProperty('--cat-accent', (cs.getPropertyValue('--cat-accent') || '').trim() || '#888');
            base.style.setProperty('--cat-bg', (cs.getPropertyValue('--cat-bg') || '').trim() || 'transparent');
            base.style.borderRadius = '6px';  // standalone chip: round all corners
            base.style.overflow = 'hidden';
        }
        proxy.appendChild(base);
        if (count) {
            const badge = document.createElement('span');
            badge.className = 'bank-drag-count'; badge.textContent = String(count);
            proxy.appendChild(badge);
        }
        this._pd._pw = count ? w + 8 : w;
        this._pd._ph = count ? h + 8 : h;
        return proxy;
    }

    _movePointerProxy(x, y) {
        const pd = this._pd; if (!pd || !pd.proxy) return;
        // Use a compositor-only transform (not left/top) so following the pointer
        // doesn't trigger layout each frame — a big win on mobile. The proxy is
        // pinned at left:0/top:0 (CSS) so translate is measured from the viewport.
        pd.proxy.style.transform = `translate3d(${x - pd._pw / 2}px, ${y - pd._ph / 2}px, 0)`;
    }

    _dropTargetAt(x, y) {
        // Proxy is pointer-events:none, so elementFromPoint already skips it.
        const under = document.elementFromPoint(x, y);
        if (!under) return null;
        return under.closest('.bank-tab') || under.closest('.bank-cat[data-cat]');
    }

    _updatePointerDropTarget(x, y) {
        this._clearDropTargets();
        const t = this._dropTargetAt(x, y);
        if (t) t.classList.add('bank-drop-target');
    }

    _dropPointer(x, y) {
        const pd = this._pd; if (!pd) return;
        // Reorder within the SAME category — default sort + single item (edit mode not required).
        if (pd.kind === 'item' && this._sortState.key === 'default' && (pd.ids ? pd.ids.length === 1 : true)) {
            const t = this._reorderTargetAny(x, y);
            if (t) {
                this._clearDropTargets();
                if (t.catKey === pd.fromCatKey) this._reorderWithinCat(pd.id, t.catKey, t.targetId, t.after);
                else this._moveItemToCategory(pd.id, t.catKey, t.targetId, t.after);
                return;
            }
        }
        const t = this._dropTargetAt(x, y);
        this._clearDropTargets();
        if (!t) return;
        const ids = pd.ids || [pd.id];
        if (t.classList.contains('bank-tab')) {
            const toTab = t.dataset.tab;
            if (pd.kind === 'item') this._pinItems(ids, toTab, null);
            else this._moveCategory(pd.id, this.activeTabId, toTab, null);
        } else {
            const toCat = t.dataset.cat;
            if (pd.kind === 'item') this._pinItems(ids, this.activeTabId, toCat);
            else if (pd.id !== toCat) this._moveCategory(pd.id, this.activeTabId, this.activeTabId, toCat);
        }
    }

    /** Snapshot the source category's sibling tiles (excluding the dragged one) with their
     *  positions at drag start. The insertion index is computed against these FIXED rects, so
     *  pointer→index is monotonic and can't oscillate even as the live gap shifts tiles. */
    _buildReorderSnapFor(catEl) {
        const cont = catEl && catEl.querySelector('.bank-items');
        if (!cont) { this._reorderSnap = null; return; }
        const items = [...cont.querySelectorAll('.bank-item[data-item]')]
            .filter((el) => el.dataset.item !== this._pd.id)
            .map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.item, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 }; });
        this._reorderSnap = { catKey: catEl.dataset.cat, catEl, items };
    }

    /** Insertion target ({catKey, targetId, after}) from the fixed snapshot, or null if the
     *  pointer is outside the source category (→ falls through to pin / cross-category move). */
    _reorderTargetFromSnap(x, y) {
        const snap = this._reorderSnap;
        if (!snap) return null;
        const cr = snap.catEl.getBoundingClientRect();
        if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) return null;
        const items = snap.items;
        if (!items.length) return { catKey: snap.catKey, targetId: null, after: true };
        for (const it of items) {
            if (this.view === 'list') {
                if (y < it.cy) return { catKey: snap.catKey, targetId: it.id, after: false };
            } else {
                if (y < it.top) return { catKey: snap.catKey, targetId: it.id, after: false };
                if (y <= it.bottom && x < it.cx) return { catKey: snap.catKey, targetId: it.id, after: false };
            }
        }
        return { catKey: snap.catKey, targetId: items[items.length - 1].id, after: true };
    }

    /** Insertion target over ANY category (not just the source). Rebuilds the stable snapshot
     *  when the pointer enters a different category; hovering the header → append (last spot). */
    _reorderTargetAny(x, y) {
        const pd = this._pd; if (!pd) return null;
        const under = document.elementFromPoint(x, y);   // proxy is pointer-events:none
        if (!under) return null;
        const catEl = under.closest('.bank-cat[data-cat]');
        if (!catEl) return null;
        const catKey = catEl.dataset.cat;
        if (!this._reorderSnap || this._reorderSnap.catEl !== catEl) {
            this._buildReorderSnapFor(catEl);
        }
        if (under.closest('.bank-cat-head')) return { catKey, targetId: null, after: true };
        return this._reorderTargetFromSnap(x, y);
    }

    /** The item + insert side under the pointer, plus its category key (for reorder). */
    _itemUnderPoint(x, y) {
        const under = document.elementFromPoint(x, y);   // proxy is pointer-events:none
        if (!under) return null;
        const catEl = under.closest('.bank-cat[data-cat]');
        if (!catEl) return null;
        const catKey = catEl.dataset.cat;
        const itemEl = under.closest('.bank-item[data-item]');
        if (!itemEl) return { catKey, targetId: null, after: true, el: null };
        const r = itemEl.getBoundingClientRect();
        const after = this.view === 'list' ? (y > r.top + r.height / 2) : (x > r.left + r.width / 2);
        return { catKey, targetId: itemEl.dataset.item, after, el: itemEl };
    }

    /** Persist a manual within-category order to settings.itemOrder (default-sort only). */
    /** Move an item into a DIFFERENT category at a chosen position: pin it there and write the
     *  category's item order (built from the target-category snapshot + the inserted id). */
    _moveItemToCategory(id, catKey, targetId, after) {
        const snap = this._reorderSnap;
        let ids = (snap && snap.catKey === catKey) ? snap.items.map((it) => it.id) : [];
        ids = ids.filter((x) => x !== id);
        let idx = targetId ? ids.indexOf(targetId) : ids.length;
        if (idx < 0) idx = ids.length;
        if (after && targetId) idx += 1;
        ids.splice(idx, 0, id);
        this.layout.settings = this.layout.settings || {};
        this.layout.settings.itemOrder = this.layout.settings.itemOrder || {};
        this.layout.settings.itemOrder[catKey] = ids;
        this.layout.pins = this.layout.pins || {};
        const catId = catKey === '__uncat' ? null : catKey;
        this.layout.pins[id] = { tabId: this.activeTabId, catId };
        this.opts.onPinned?.(id, this.activeTabId, catId);
        this._markChanged();
        this.render();
    }

    _reorderWithinCat(draggedId, catKey, targetId, after) {
        const catEl = [...this.container.querySelectorAll('.bank-cat[data-cat]')].find((el) => el.dataset.cat === catKey);
        const container = catEl && catEl.querySelector('.bank-items');
        if (!container) return;
        let ids = [...container.querySelectorAll('.bank-item[data-item]')].map((el) => el.dataset.item).filter((id) => id !== draggedId);
        let idx = targetId ? ids.indexOf(targetId) : ids.length;
        if (idx < 0) idx = ids.length;
        if (after && targetId) idx += 1;
        ids.splice(idx, 0, draggedId);
        this.layout.settings = this.layout.settings || {};
        this.layout.settings.itemOrder = this.layout.settings.itemOrder || {};
        this.layout.settings.itemOrder[catKey] = ids;
        this._markChanged();
        this.render();
    }

    _endPointerDrag() {
        const pd = this._pd;
        if (this._pdRAF) { cancelAnimationFrame(this._pdRAF); this._pdRAF = 0; }
        this._stopAutoScroll();
        window.removeEventListener('pointermove', this._onPdMove, { passive: false });
        window.removeEventListener('pointerup', this._onPdUp);
        window.removeEventListener('pointercancel', this._onPdUp);
        window.removeEventListener('touchmove', this._onPdTouchMove, { passive: false });
        if (pd) {
            clearTimeout(pd.timer);
            if (pd.proxy) pd.proxy.remove();
        }
        document.body.classList.remove('bank-pd-dragging', 'bank-dragging-cat');
        this.container.querySelectorAll('.bank-item.bank-dragging').forEach((x) => x.classList.remove('bank-dragging'));
        this._clearInsertionGap();
        this._clearDropTargets();
        this._reorderSnap = null;
        this._pd = null;
    }

    _clearDropTargets() {
        this.container.querySelectorAll('.bank-drop-target').forEach((el) => el.classList.remove('bank-drop-target'));
    }

    /** Live insertion gap for same-category reorder: inserts a spacer at the drop spot so the
     *  other items visibly shift to make room. Returns true when a gap is shown. */
    _updateInsertionGap(x, y) {
        const pd = this._pd;
        if (!pd || pd.kind !== 'item' || this._sortState.key !== 'default' || (pd.ids && pd.ids.length > 1)) { this._clearInsertionGap(); return false; }
        const t = this._reorderTargetAny(x, y);
        if (!t) { this._clearInsertionGap(); return false; }
        const key = `${t.catKey}|${t.targetId}|${t.after}`;
        if (this._gapKey === key && this._gapEl && this._gapEl.parentNode) return true;
        const cont = this._reorderSnap && this._reorderSnap.catEl.querySelector('.bank-items');
        if (!cont) { this._clearInsertionGap(); return false; }
        if (this._gapContainer && this._gapContainer !== cont) {
            this._gapContainer.querySelectorAll('.bank-item[data-item]').forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
        }
        if (!this._gapEl) { this._gapEl = document.createElement('div'); this._gapEl.className = 'bank-drag-gap'; }
        this._gapKey = key;
        // FLIP: measure siblings (excluding the dragged source), move the dashed gap to the new
        // spot, then animate them old→new. Reads and writes are batched into distinct phases
        // with a SINGLE forced reflow, so we don't thrash layout once per sibling.
        const sibs = [...cont.querySelectorAll('.bank-item[data-item]')].filter((el) => el.dataset.item !== pd.id);
        // Phase 1 (read): old rects (+ row height) before any DOM change.
        const first = new Map(sibs.map((el) => [el, el.getBoundingClientRect()]));
        if (sibs[0]) this._gapEl.style.height = first.get(sibs[0]).height + 'px';
        // Move the gap to its new slot.
        const tEl = t.targetId ? cont.querySelector(`.bank-item[data-item="${t.targetId}"]`) : null;
        if (tEl) { if (t.after) tEl.after(this._gapEl); else tEl.before(this._gapEl); } else cont.appendChild(this._gapEl);
        this._gapContainer = cont;
        // Phase 2 (read): new rects for all siblings in one layout flush.
        const last = new Map(sibs.map((el) => [el, el.getBoundingClientRect()]));
        // Phase 3 (write): apply the inverse transform with transitions off (no interleaved reads).
        const moved = [];
        for (const el of sibs) {
            const f = first.get(el), l = last.get(el);
            const ddx = f.left - l.left, ddy = f.top - l.top;
            if (!ddx && !ddy) continue;
            el.style.transition = 'none';
            el.style.transform = `translate(${ddx}px, ${ddy}px)`;
            moved.push(el);
        }
        // Phase 4: ONE reflow to commit the pre-transition transforms, then play them out.
        if (moved.length) {
            void cont.offsetWidth;
            for (const el of moved) { el.style.transition = 'transform 0.18s ease'; el.style.transform = ''; }
        }
        return true;
    }

    _clearInsertionGap() {
        this._gapKey = null;
        if (this._gapContainer) {
            this._gapContainer.querySelectorAll('.bank-item[data-item]').forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
            this._gapContainer = null;
        }
        if (this._gapEl && this._gapEl.parentNode) this._gapEl.parentNode.removeChild(this._gapEl);
    }

    _markChanged() { this.opts.onLayoutChanged?.(this.layout); }

    /** Reconcile selection UI in place (tile rings, toolbar badge, action bar) — no full re-render. */
    _syncSelectionDom() {
        const c = this.container;
        if (!c) return;
        c.querySelectorAll('.bank-item[data-drag="true"]').forEach((el) =>
            el.classList.toggle('selected', this._selectMode && this._selected.has(el.dataset.item)));
        const btn = c.querySelector('.bank-select-btn');
        if (btn) {
            btn.classList.toggle('on', this._selectMode);
            let badge = btn.querySelector('.bank-select-count');
            if (this._selected.size) {
                if (!badge) { badge = document.createElement('span'); badge.className = 'bank-select-count'; btn.appendChild(badge); }
                badge.textContent = String(this._selected.size);
            } else if (badge) { badge.remove(); }
        }
        let bar = c.querySelector('.bank-select-bar');
        if (this._selectMode) {
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'bank-select-bar';
                bar.innerHTML = '<span class="bank-select-label"></span>'
                    + '<button class="bank-select-all" title="Select all shown">✓ All</button>'
                    + '<button class="bank-select-clear" title="Exit selection">✕</button>';
                c.appendChild(bar);
                bar.querySelector('.bank-select-all').addEventListener('click', () => {
                    c.querySelectorAll('.bank-item[data-drag="true"]').forEach((el) => this._selected.add(el.dataset.item));
                    this._syncSelectionDom();
                });
                bar.querySelector('.bank-select-clear').addEventListener('click', () => {
                    this._selected.clear(); this._selectMode = false; this._syncSelectionDom();
                });
            }
            bar.querySelector('.bank-select-label').textContent = `${this._selected.size} selected`;
        } else if (bar) {
            bar.remove();
        }
    }

    _pinItem(itemId, tabId, catId) {
        this.layout.pins = this.layout.pins || {};
        this.layout.pins[itemId] = { tabId, catId: catId || null };
        this.opts.onPinned?.(itemId, tabId, catId || null);
        this._markChanged();
        this.render();
    }

    _pinItems(ids, tabId, catId) {
        this.layout.pins = this.layout.pins || {};
        for (const id of (ids || [])) {
            this.layout.pins[id] = { tabId, catId: catId || null };
            this.opts.onPinned?.(id, tabId, catId || null);
        }
        this._markChanged();
        this.render();
    }

    _moveCategory(catId, fromTabId, toTabId, beforeCatId) {
        const from = this.layout.tabs.find((t) => t.id === fromTabId);
        const to = this.layout.tabs.find((t) => t.id === toTabId);
        if (!from || !to) return;
        const idx = (from.categories || []).findIndex((x) => x.id === catId);
        if (idx < 0) return;
        const [cat] = from.categories.splice(idx, 1);
        to.categories = to.categories || [];
        if (beforeCatId) {
            const bidx = to.categories.findIndex((x) => x.id === beforeCatId);
            to.categories.splice(bidx < 0 ? to.categories.length : bidx, 0, cat);
        } else {
            to.categories.push(cat);
        }
        this._markChanged();
        this.render();
    }
}
