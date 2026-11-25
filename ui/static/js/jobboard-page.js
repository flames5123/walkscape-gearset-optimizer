/**
 * jobboard-page.js — main-site "Job Board" anchor page (opens on #jobboard,
 * mirrors the Trading page shell). Shows the running week's weekly jobs across
 * every board, with a search box + filter dropdowns and a jobs table.
 *
 * Data: GET /api/jobboard/data (enriched jobs + facets). Item icons: /api/catalog
 * (slug -> icon_path). Filters persist to ui_config at ui.jobboard.filters;
 * per-job status at ui.jobboard.status.{jobId}.
 *
 * Status: search / faction / location / tier / rewards / status filters are
 * fully wired, plus the "Can hand in now" → Trade listings mode. The remaining
 * "Can hand in now" modes (owned / safe owned / owned materials / partial
 * materials / can obtain) are present but disabled ("soon") — they need the
 * owned-items + crafting-tree + activity-access plumbing (next pass).
 */

import { wireInfoIcons } from './info-popover.js';
import { renderItemSources } from './drop-item-popover.js';

const QUALITY_WORD = {
    common: 'Normal', uncommon: 'Good', rare: 'Great', epic: 'Excellent',
    legendary: 'Perfect', ethereal: 'Eternal', fine: 'Fine', none: '',
};
const TIER_COLOR = { easy: '#66bb6a', mediocre: '#9ccc65', hard: '#ffa726', extreme: '#ef5350' };
// Item-name text color by quality (bright '-border' rarity vars; base vars are
// dark fills). Matches the rest of the site's rarity palette.
const QUALITY_COLOR = {
    // common/Normal intentionally omitted -> falls back to white (var(--text-primary)).
    uncommon: 'var(--rarity-uncommon-border)',
    rare: 'var(--rarity-rare-border)', epic: 'var(--rarity-epic-border)',
    legendary: 'var(--rarity-legendary-border)', ethereal: 'var(--rarity-ethereal-border)',
    fine: 'var(--fine-color)',
};
function qualColor(tok) { return QUALITY_COLOR[String(tok || '').toLowerCase()] || 'var(--text-primary)'; }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function qualWord(tok) { return QUALITY_WORD[String(tok || '').toLowerCase()] ?? ''; }

function relTime(iso) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const d = Math.round((t - Date.now()) / 86400000);
    if (d < 0) return 'expired';
    if (d === 0) return 'today';
    if (d === 1) return '1 day';
    return `${d} days`;
}

// ── "Can hand in now" filter modes ────────────────────────────────────────────
const HANDIN_MODES = [
    { key: 'owned', label: 'Owned items', soon: false,
      info: 'You own enough of each goal item (counting higher qualities you can hand in instead).' },
    { key: 'not_owned', label: 'Not owned items', soon: false,
      info: 'You do NOT own enough of at least one goal item (good for shopping the gaps).' },
    { key: 'safe_owned', label: 'Safe owned items', soon: false,
      info: 'Owned with one kept in reserve (duplicates only). Keeps a higher-quality copy in reserve when one is available.' },
    { key: 'owned_materials', label: 'Owned materials for crafts', soon: false,
      info: 'You own ALL raw materials (1:1, full crafting tree) to craft the needed quantity. Ignores NMC (no materials consumed) and DR (double rewards).' },
    { key: 'partial_materials', label: 'Partially owned materials', soon: false,
      info: 'You own some materials that appear in the goal item\u2019s crafting tree.' },
    { key: 'no_owned_materials', label: 'No owned materials for crafts', soon: false,
      info: 'A crafted goal item where you own NONE of its crafting materials.' },
    { key: 'trade_listings', label: 'Trade listings', soon: false,
      info: 'A goal item is currently listed for trade (not expired/closed/deleted).' },
    { key: 'can_obtain', label: 'Can obtain', soon: false,
      info: 'You can access the activity/source for every goal item (skill level + requirements met) AND you can access the job board itself.' },
];

const STATUS_OPTIONS = [
    { key: 'all', label: 'All' },
    { key: 'completed', label: 'Completed' },
    { key: 'planned', label: 'Planned' },
    { key: 'uncompleted', label: 'Uncompleted' },
];

const DEFAULT_FILTERS = { q: '', factions: [], locations: [], tiers: [], rewards: [], handIn: [], status: 'all' };

export class JobBoardPage {
    constructor(selector) {
        this.el = document.querySelector(selector);
        this.built = false;
        this.data = null;           // /api/jobboard/data payload
        this.iconBySlug = {};       // slug -> icon_path
        this.owned = {};            // slug -> { token: qty } (owned by quality)
        this.handin = {};           // jobId -> { can_obtain, owned_materials, partial_materials }
        this.matColors = {};        // item slug -> 'green' | 'yellow' (material-icon color)
        this.listingSlugs = new Set(); // slugs currently listed for trade
        this.filters = { ...DEFAULT_FILTERS };
        this._controls = {};        // filter-key -> multiselect api
        // When a goals-report run finishes (or progresses), it fires
        // 'stats-report-stale-refresh'. Re-pull our cached report state so
        // items we clicked "Find" on flip from "Find" to their number without
        // a page refresh — and nothing is wasted if the run was cancelled
        // partway (we show whatever completed).
        this._onStatsRefresh = () => {
            if (document.body.classList.contains('jobboard-open')) this._refreshReportState();
        };
        window.addEventListener('stats-report-stale-refresh', this._onStatsRefresh);
        // Trading's job-item badge calls this to jump to that item's job here.
        window._gotoJobBoardItem = (slug) => {
            if (!slug) return;
            window._jobboardPendingFocus = slug;
            if (window.location.hash !== '#jobboard') window.location.hash = '#jobboard';
            else { try { this.open(); } catch (_) {} }
        };
    }

    async open() {
        if (!this.built) { this._build(); this.built = true; }
        this.el.classList.add('jobboard-page');
        // .jobboard-page base is hidden (opacity:0, scale .95). .opening is what
        // supplies opacity:1 + transform:none + the enter animation — without it
        // the board lays out (rows render) but stays fully TRANSPARENT.
        this.el.classList.remove('closing');
        this.el.classList.add('opening');
        this.el.style.display = 'block';   // beats any stale inline display:none from close()
        document.body.classList.add('jobboard-open');
        document.getElementById('jobboard-nav-btn')?.classList.add('active');
        // Drop the cached report state so returning from a Find/optimize run
        // re-pulls the latest results (previously it stayed "Find").
        this._reportStatePromise = null;
        this._reportStateReady = false;
        this._loadFilters();
        // Trading's job-item badge → focus the job board on that item: set the
        // search and clear every other filter so the matching job is visible.
        const _focus = window._jobboardPendingFocus;
        window._jobboardPendingFocus = null;
        if (_focus) {
            this.filters.q = this._menuName(_focus);
            this.filters.status = 'all';
            this.filters.factions = []; this.filters.locations = []; this.filters.tiers = [];
            this.filters.rewards = []; this.filters.bonus = []; this.filters.handIn = [];
            this._saveFilters();
        }
        // Render the shell + filters UP FRONT so a slow, hung, or failed data
        // load can never leave the board totally blank (no filters, stuck on
        // "Loading…"). Facets fill in once the data arrives.
        try { this._renderFilters((this.data && this.data.facets) || {}); } catch (e) { /* non-fatal */ }
        const ok = await this._loadData();
        if (ok) { try { this._render(); } catch (e) { /* non-fatal */ } }
    }

    // Re-fetch the goals-report results + stale state and re-render, so
    // "Steps for you" cells reflect runs that completed since last load.
    _refreshReportState() {
        this._reportStatePromise = null;
        this._reportStateReady = false;
        this._ensureReportState();   // refetches; re-renders on resolve when open
    }

    close() {
        clearInterval(this._refreshTimer);
        this.el.classList.remove('jobboard-page');
        this.el.classList.remove('opening');
        // Hide the element outright — otherwise, without the positioning class,
        // it falls back to an in-flow block still full of content and renders
        // below the page ("shows below all the columns"). Mirrors how the other
        // anchor pages (#stats-report-page) stay display:none when closed.
        this.el.style.display = 'none';
        document.body.classList.remove('jobboard-open');
        document.getElementById('jobboard-nav-btn')?.classList.remove('active');
    }

    _build() {
        this.el.innerHTML = `
            <div style="max-width:1100px;margin:0 auto;padding:var(--spacing-md,16px);">
              <div class="jobboard-head" style="position:sticky;top:0;z-index:5;background:var(--bg-primary);margin:calc(-1 * var(--spacing-md,16px)) calc(-1 * var(--spacing-md,16px)) 10px;padding:var(--spacing-md,16px) var(--spacing-md,16px) 8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                  <h2 style="margin:0;color:var(--text-primary);display:flex;align-items:center;gap:10px;font-size:max(var(--min-text, 5px), calc(22px * var(--text-scale, 1)));line-height:1.2;">
                    <img src="/assets/icons/ui/job_boards_icon.svg" width="28" height="28" style="image-rendering:pixelated;" alt="">
                    Job Board <span data-week style="font-size:.6em;color:var(--text-secondary);font-weight:400;"></span>
                  </h2>
                  <button data-act="close" class="btn btn-secondary" aria-label="Close" style="line-height:1;">&times;</button>
                </div>
                <div data-filters></div>
              </div>
              <div data-content></div>
            </div>`;
        this.el.querySelector('[data-act="close"]').onclick = () => { window.location.hash = ''; };
        this.el.addEventListener('click', (e) => {
            const th = e.target.closest && e.target.closest('[data-sort-key]');
            if (!th) return;
            e.preventDefault(); e.stopPropagation();
            const key = th.getAttribute('data-sort-key');
            if (this._sort && this._sort.key === key) this._sort.dir = (this._sort.dir === 'asc' ? 'desc' : 'asc');
            else this._sort = { key, dir: 'asc' };
            this._renderTable();
        });
        // Delegated: per-row status buttons (plan / unplan / complete / uncomplete).
        this.el.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-jb-status]');
            if (!b) return;
            e.preventDefault(); e.stopPropagation();
            const id = b.getAttribute('data-id');
            const action = b.getAttribute('data-jb-status');
            const next = { plan: 'planned', unplan: 'uncompleted', complete: 'completed', uncomplete: 'uncompleted' }[action];
            if (next == null) return;
            this._setStatus(id, next);
            this._onStatusChanged(id);
        });
        this.el.addEventListener('click', (e) => {
            const r = e.target.closest && e.target.closest('[data-jb-restore]');
            if (!r) return;
            e.preventDefault(); e.stopPropagation();
            this._showAllOverride = false;
            this._renderTable();
        });
        // "Steps for you" cell: number / Find / Rerun -> open that item/chest in
        // the goals report (its #1 activity); top button reruns all stale/missing.
        this.el.addEventListener('click', (e) => {
            const all = e.target.closest && e.target.closest('[data-jb-steps-all]');
            if (all) {
                e.preventDefault(); e.stopPropagation();
                const sp = window._statsReportPage;
                if (sp && typeof sp.runAllStale === 'function') sp.runAllStale();
                return;
            }
            const cell = e.target.closest && e.target.closest('.jb-steps-link, .jb-steps-find, .jb-steps-rerun');
            if (!cell) return;
            e.preventDefault(); e.stopPropagation();
            const name = cell.getAttribute('data-jb-steps') || '';
            const isChest = cell.getAttribute('data-jb-steps-chest') === '1';
            const sp = window._statsReportPage;
            if (!sp || !name) return;
            // Fresh number -> just navigate/scroll (do NOT reoptimize). Find /
            // Rerun -> run the single-item/chest optimization.
            if (cell.classList.contains('jb-steps-link') && typeof sp.revealReportItem === 'function') {
                sp.revealReportItem(name, isChest);
            } else if (isChest && typeof sp.runForChest === 'function') {
                sp.runForChest(name);
            } else if (typeof sp.runForTargetItem === 'function') {
                sp.runForTargetItem(name);
            }
        });

        // Item-name click → the per-item action menu (crafting tree, trade,
        // sources, find source). Document-level so it also catches links that
        // render inside the "Alt" info-popover (mounted outside this.el).
        if (!this._itemMenuWired) {
            this._itemMenuWired = true;
            document.addEventListener('click', (e) => {
                const mat = e.target.closest && e.target.closest('.jb-mat-btn[data-jb-mat]');
                if (mat) {
                    e.preventDefault(); e.stopPropagation();
                    // Toggle: clicking the same material icon again closes it.
                    if (this._matEl && this._matAnchor === mat) { this._closeMatPopup(); return; }
                    this._openMaterialPopup(mat, mat.getAttribute('data-jb-mat'));
                    return;
                }
                const warn = e.target.closest && e.target.closest('.jb-ineff[data-jb-better]');
                if (warn) {
                    e.preventDefault(); e.stopPropagation();
                    this._openBetterJobTip(warn, warn.getAttribute('data-jb-better'));
                    return;
                }
                const link = e.target.closest && e.target.closest('.jb-item-link[data-jb]');
                if (!link) return;
                e.preventDefault(); e.stopPropagation();
                if (this._itemMenuEl && this._itemMenuAnchor === link) { this._closeItemMenu(); return; }
                this._openItemMenu(link, link.getAttribute('data-jb'));
            }, true);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('jb-item-link')) {
                    e.preventDefault(); this._openItemMenu(e.target, e.target.getAttribute('data-jb'));
                }
            });
        }
    }

    // ── Data ──────────────────────────────────────────────────────────────────
    // Fetch JSON with a hard timeout (+ optional retries) so a hung request
    // can NEVER stall the board open. Throws on timeout / non-OK / parse error.
    async _fetchJSON(url, { timeout = 15000, retries = 0 } = {}) {
        for (let attempt = 0; ; attempt++) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeout);
            try {
                const r = await fetch(url, { signal: ctrl.signal });
                if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
                return await r.json();
            } catch (e) {
                if (attempt >= retries) throw e;
            } finally {
                clearTimeout(timer);
            }
        }
    }

    async _loadData() {
        const content = this.el.querySelector('[data-content]');
        if (content) content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary);">Loading job boards…</div>';
        // The board jobs are REQUIRED. Fetch them with a timeout + one retry so
        // a hung or failed request can't leave the board stuck on "Loading…"
        // with no filters. On total failure show a Retry state, not a blank.
        let data;
        try {
            data = await this._fetchJSON('/api/jobboard/data', { timeout: 15000, retries: 1 });
        } catch (e) {
            this.data = this.data || { jobs: [], facets: { factions: [], locations: [], tiers: [], rewards: [] } };
            this.owned = this.owned || {};
            if (content) {
                content.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary);">'
                    + 'Couldn\u2019t load the job boards. '
                    + '<button data-jb-retry class="btn btn-secondary" style="margin-left:8px;">Retry</button>'
                    + '</div>';
                const rb = content.querySelector('[data-jb-retry]');
                if (rb) rb.onclick = async () => { const ok = await this._loadData(); if (ok) { try { this._render(); } catch (_) {} } };
            }
            return false;
        }
        this.data = data;
        // Catalog + owned-by-quality only ENRICH (icons, owned counts); a
        // failure or timeout must not blank the board, so fall back to empty.
        let catalog = { items: [] };
        let owned = null;
        try { catalog = await this._fetchJSON('/api/catalog', { timeout: 15000 }); } catch (e) { catalog = { items: [] }; }
        try { owned = await this._fetchJSON('/api/owned-by-quality', { timeout: 15000 }); } catch (e) { owned = null; }
        try {
            this.owned = (owned && owned.owned) || {};   // { slug: { token: qty } }
            // /api/owned-by-quality is built from all_items_raw (inventory +
            // bank + gear) only. Chest-collection items (Gold pan, Wintry pan,
            // …) are tracked in the character's owned_quantities map but NOT in
            // all_items_raw, so those goals wrongly showed 0/N. Fill the gaps
            // from store.state.character.owned_quantities — the same complete
            // source the "N owned" labels use. Keys: `${id}` (base) and
            // `${id}_fine` (fine variant). Only ADD ids the per-quality map is
            // missing, so we never clobber a real rarity breakdown.
            try {
                const oq = (window.store && window.store.state && window.store.state.character
                    && window.store.state.character.owned_quantities) || null;
                if (oq && typeof oq === 'object') {
                    const hadQ = new Set(Object.keys(this.owned));
                    for (const k in oq) {
                        const qty = Number(oq[k]) || 0;
                        if (qty <= 0) continue;
                        const isFine = k.endsWith('_fine');
                        const id = isFine ? k.slice(0, -5) : k;
                        if (hadQ.has(id)) continue;   // real inventory data wins
                        const bucket = (this.owned[id] = this.owned[id] || {});
                        const tok = isFine ? 'fine' : '';
                        bucket[tok] = (bucket[tok] || 0) + qty;
                    }
                }
            } catch (e) { /* non-fatal */ }
            this.iconBySlug = {};
            this.nameBySlug = {};
            this.craftIdBySlug = {};
            for (const it of (catalog.items || [])) {
                const key = it.game_key || it.id;
                if (!key) continue;
                if (it.icon_path) this.iconBySlug[key] = it.icon_path;
                if (it.name) this.nameBySlug[key] = it.name;
                if (it.id) this.craftIdBySlug[key] = it.id;
            }
        } catch (e) { /* enrich (icons/owned) failed — board still renders */ }
        // Trade listings (for the "Trade listings" hand-in mode) — the user's
        // own open listings. Best-effort; market-wide can be added later.
        try {
            let resp = null;
            try { resp = await this._fetchJSON('/api/trading/listings', { timeout: 10000 }); } catch (e) { resp = null; }
            this.listingSlugs = new Set();
            const rows = (resp && (resp.listings || resp.items)) || (Array.isArray(resp) ? resp : []);
            rows.forEach((l) => {
                const s = (l.item && l.item.slug) || l.item_slug;
                if (s) this.listingSlugs.add(s);
            });
        } catch (e) { this.listingSlugs = new Set(); }

        // Engine-backed hand-in flags (owned_materials / partial_materials /
        // can_obtain) are session-scoped and heavier to compute — fetch them
        // without blocking first paint, then re-render the table when they land.
        this.handin = {};
        this.matColors = {};
        fetch('/api/jobboard/handin')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { this.handin = (d && d.handin) || {}; this.matColors = (d && d.mat_colors) || {}; if (document.body.classList.contains('jobboard-open')) this._renderTable(); })
            .catch(() => { /* leave empty */ });
        return true;
    }

    _icon(slug) { return slug ? (this.iconBySlug[slug] || '') : ''; }

    // ── Filter + status persistence (ui_config, with localStorage fallback) ────
    _loadFilters() {
        let saved = null;
        try { saved = window.store && window.store.get ? window.store.get('ui.jobboard.filters') : null; } catch (e) { saved = null; }
        if (!saved) { try { saved = JSON.parse(localStorage.getItem('jobboard.filters') || 'null'); } catch (e) { saved = null; } }
        this.filters = { ...DEFAULT_FILTERS, ...(saved || {}) };
        // Per-job status map { jobId: 'planned'|'completed' }; absent = uncompleted.
        let st = null;
        try { st = window.store && window.store.get ? window.store.get('ui.jobboard.status') : null; } catch (e) { st = null; }
        if (!st) { try { st = JSON.parse(localStorage.getItem('jobboard.status') || 'null'); } catch (e) { st = null; } }
        this._status = st && typeof st === 'object' ? { ...st } : {};
    }
    _saveFilters() {
        try { window.store && window.store.update && window.store.update('ui.jobboard.filters', this.filters); } catch (e) { /* ignore */ }
        try { localStorage.setItem('jobboard.filters', JSON.stringify(this.filters)); } catch (e) { /* ignore */ }
    }
    _jobStatus(id) { return this._status[id] || 'uncompleted'; }
    _setStatus(id, value) {
        if (value === 'uncompleted') delete this._status[id];
        else this._status[id] = value;
        try { window.store && window.store.update && window.store.update('ui.jobboard.status', this._status); } catch (e) { /* ignore */ }
        try { localStorage.setItem('jobboard.status', JSON.stringify(this._status)); } catch (e) { /* ignore */ }
    }

    // ── Render ──────────────────────────────────────────────────────────────────
    _render() {
        const d = this.data || {};
        const wk = this.el.querySelector('[data-week]');
        if (wk) wk.innerHTML = this._weekLabel(d);
        this._renderFilters(d.facets || {});
        this._renderTable();
        this._updateRefresh();
        clearInterval(this._refreshTimer);
        this._refreshTimer = setInterval(() => this._updateRefresh(), 60000);
    }

    _weekLabel(d) {
        if (!d.starts_at || !d.ends_at) return '';
        const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const s = new Date(d.starts_at);
        const last = new Date(Date.parse(d.ends_at) - 86400000); // inclusive final day
        const sM = MON[s.getUTCMonth()], eM = MON[last.getUTCMonth()];
        const range = sM === eM
            ? `${sM} ${s.getUTCDate()} - ${last.getUTCDate()}`
            : `${sM} ${s.getUTCDate()} - ${eM} ${last.getUTCDate()}`;
        return `· ${range} · <span data-refresh></span>`;
    }

    _updateRefresh() {
        const d = this.data;
        const el = this.el && this.el.querySelector('[data-refresh]');
        if (!d || !d.ends_at || !el) return;
        let ms = Date.parse(d.ends_at) - Date.now();
        if (ms < 0) ms = 0;
        const totalH = Math.floor(ms / 3600000);
        el.textContent = `refresh in ${Math.floor(totalH / 24)}d ${totalH % 24}h`;
    }

    _renderFilters(facets) {
        const host = this.el.querySelector('[data-filters]');
        host.innerHTML = '';
        this._controls = {};

        // Search box (always visible, full width).
        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'margin-bottom:8px;';
        const search = document.createElement('input');
        search.type = 'search';
        search.placeholder = 'Search items, keywords, boards, factions, rewards…';
        search.value = this.filters.q || '';
        search.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border-radius:7px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);';
        let t = null;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { this.filters.q = search.value; this._saveFilters(); this._renderTable(); }, 180);
        });
        searchWrap.appendChild(search);
        host.appendChild(searchWrap);

        // Top row (always visible): Status + Owned/Can-hand-in.
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;';
        host.appendChild(topRow);

        topRow.appendChild(this._radioSelect({
            label: 'Status', options: STATUS_OPTIONS, selected: this.filters.status || 'all',
            onChange: (v) => { this.filters.status = v; this._saveFilters(); this._renderTable(); },
        }));

        this._controls.handIn = this._multiSelect({
            label: 'Owned items', allLabel: 'Any', anyMeansNoFilter: true,
            options: HANDIN_MODES.map((m) => ({ key: m.key, label: m.label, info: m.info, disabled: m.soon })),
            selected: this.filters.handIn,
            onChange: (sel) => { this.filters.handIn = sel; this._saveFilters(); this._renderTable(); },
        });
        topRow.appendChild(this._controls.handIn.el);

        // "More filters" toggle + collapsible row (Faction / Location / Tier / Rewards).
        const toggle = document.createElement('button');
        toggle.type = 'button';
        const tcaret = '<span data-mcaret style="display:inline-block;transition:transform .15s;transform:rotate(-90deg);">▼</span>';
        toggle.innerHTML = `${tcaret} More filters`;
        toggle.style.cssText = 'margin-top:8px;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:.9em;display:flex;align-items:center;gap:6px;padding:2px 0;';
        host.appendChild(toggle);

        const more = document.createElement('div');
        more.style.cssText = 'display:none;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:6px;';
        host.appendChild(more);

        this._controls.factions = this._multiSelect({
            label: 'Faction', allLabel: 'All factions',
            options: (facets.factions || []).map((f) => ({ key: f.slug, label: f.name, icon: f.icon })),
            selected: this.filters.factions,
            onChange: (sel) => { this.filters.factions = sel; this._saveFilters(); this._renderTable(); },
        });
        more.appendChild(this._controls.factions.el);

        this._controls.locations = this._multiSelect({
            label: 'Location', allLabel: 'All locations',
            options: (facets.locations || []).map((l) => {
                const base = String(l.board_name || '').replace(/ (combined )?job board$/i, '');
                const showBoard = base.toLowerCase() !== String(l.location || '').toLowerCase();
                return {
                    key: l.board_id,
                    label: showBoard ? `${l.location} (${l.board_name})` : l.location,
                    icons: (l.factions || []).map((f) => f.icon),
                };
            }),
            selected: this.filters.locations,
            onChange: (sel) => { this.filters.locations = sel; this._saveFilters(); this._renderTable(); },
        });
        more.appendChild(this._controls.locations.el);

        this._controls.tiers = this._multiSelect({
            label: 'Tier', allLabel: 'All tiers',
            options: (facets.tiers || []).map((t2) => ({ key: t2.key, label: t2.label })),
            selected: this.filters.tiers,
            onChange: (sel) => { this.filters.tiers = sel; this._saveFilters(); this._renderTable(); },
        });
        more.appendChild(this._controls.tiers.el);

        this._controls.rewards = this._multiSelect({
            label: 'Rewards', allLabel: 'All rewards',
            options: (facets.rewards || []).map((r) => ({
                key: r.key,
                label: r.label || (r.slug ? r.slug.replace(/_/g, ' ') : r.key),
                icon: r.icon || this._icon(r.slug),
            })),
            groupButtons: [
                { name: 'chests', has: (k) => (facets.rewards || []).some((r) => r.key === k && r.kind === 'chest') },
                { name: 'rep', has: (k) => (facets.rewards || []).some((r) => r.key === k && r.kind === 'reputation') },
            ],
            selected: this.filters.rewards,
            onChange: (sel) => { this.filters.rewards = sel; this._saveFilters(); this._renderTable(); },
        });
        more.appendChild(this._controls.rewards.el);

        this._controls.bonus = this._multiSelect({
            label: 'Bonus', allLabel: 'Any bonus',
            options: [{ key: 'bonus', label: 'Bonus job' }, { key: 'not_bonus', label: 'Not bonus job' }],
            selected: this.filters.bonus || [],
            onChange: (sel) => { this.filters.bonus = sel; this._saveFilters(); this._renderTable(); },
        });
        more.appendChild(this._controls.bonus.el);

        let moreOpen = !!this.filters.moreOpen;
        const applyMore = (animate) => {
            const car = toggle.querySelector('[data-mcaret]');
            if (car) car.style.transform = moreOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
            if (window.$ && animate) { window.$(more).stop(true, true)[moreOpen ? 'slideDown' : 'slideUp'](180).css('display', moreOpen ? 'flex' : 'none'); }
            else { more.style.display = moreOpen ? 'flex' : 'none'; }
        };
        toggle.onclick = () => {
            moreOpen = !moreOpen;
            this.filters.moreOpen = moreOpen; this._saveFilters();
            if (window.$) { if (moreOpen) { more.style.display = 'flex'; window.$(more).hide().slideDown(180); } else { window.$(more).slideUp(180); } const car = toggle.querySelector('[data-mcaret]'); if (car) car.style.transform = moreOpen ? 'rotate(0deg)' : 'rotate(-90deg)'; }
            else { applyMore(false); }
        };
        applyMore(false);
    }

    // Generic searchable multi-select dropdown (check/uncheck all + search),
    // mirroring the Trading trader filter. Persists the SELECTED keys; an empty
    // selection means "all" (no filter), except when anyMeansNoFilter is set
    // (same effect, clearer label).
    _multiSelect({ label, allLabel, options, selected, onChange, anyMeansNoFilter, groupButtons }) {
        // Default to ALL enabled options checked (empty saved state = all). The
        // button still reads "All XXX" when all (or none) are checked; it only
        // shows "N selected" once the user narrows to a partial subset. All-or-
        // none fires an empty filter (no narrowing).
        const _allKeys = (options || []).filter((o) => !o.disabled).map((o) => o.key);
        const selSet = new Set((selected && selected.length) ? selected : _allKeys);
        const _fire = () => {
            const eff = (selSet.size === 0 || selSet.size >= _allKeys.length) ? [] : Array.from(selSet);
            onChange(eff);
        };
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;min-width:170px;';
        const control = document.createElement('button');
        control.type = 'button';
        control.style.cssText = 'width:100%;text-align:left;padding:7px 10px;border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;';
        const lab = document.createElement('span');
        lab.style.cssText = 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
        const caret = document.createElement('span'); caret.textContent = '▼';
        caret.style.cssText = 'opacity:.7;font-size:.75em;transition:transform .15s;transform:rotate(-90deg);';
        control.append(lab, caret);
        const panel = document.createElement('div');
        panel.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;min-width:100%;width:max-content;max-width:320px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;z-index:30;display:none;box-shadow:0 8px 22px rgba(0,0,0,.55);';
        const srch = document.createElement('input');
        srch.placeholder = 'Search…';
        srch.style.cssText = 'width:calc(100% - 12px);margin:6px 6px 4px;box-sizing:border-box;padding:6px 8px;border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;padding:0 6px 6px;flex-wrap:wrap;';
        // Toggle buttons: a main "Check all / Uncheck all" that flips with state,
        // plus optional group toggles (e.g. "Check all chests", "Check all rep").
        const _toggleUpdaters = [];
        const _enabledKeys = () => options.filter((o) => !o.disabled).map((o) => o.key);
        const refreshToggles = () => _toggleUpdaters.forEach((u) => u());
        const makeToggle = (name, keysFn) => {
            const btn = this._smallBtn('');
            btn.onclick = () => {
                const keys = keysFn();
                const allOn = keys.length && keys.every((k) => selSet.has(k));
                keys.forEach((k) => { if (allOn) selSet.delete(k); else selSet.add(k); });
                renderList(); summary(); _fire();
            };
            _toggleUpdaters.push(() => {
                const keys = keysFn();
                const allOn = keys.length && keys.every((k) => selSet.has(k));
                btn.textContent = (allOn ? 'Uncheck all' : 'Check all') + (name ? ` ${name}` : '');
            });
            actions.appendChild(btn);
        };
        makeToggle('', _enabledKeys);
        (groupButtons || []).forEach((g) => makeToggle(g.name, () => _enabledKeys().filter((k) => g.has(k))));
        const list = document.createElement('div');
        list.style.cssText = 'padding:2px 6px 8px;max-height:260px;overflow-y:auto;';
        panel.append(srch, actions, list);
        wrap.append(control, panel);

        const summary = () => {
            const full = _allKeys.length && selSet.size >= _allKeys.length;
            if (!selSet.size || full) { lab.textContent = allLabel; lab.style.opacity = '.6'; return; }
            lab.textContent = `${selSet.size} selected`; lab.style.opacity = '1';
        };
        const renderList = () => {
            const q = (srch.value || '').trim().toLowerCase();
            list.innerHTML = '';
            const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q));
            if (!shown.length) {
                const e = document.createElement('div');
                e.textContent = 'No matches';
                e.style.cssText = 'color:var(--text-secondary);padding:6px;font-size:.85em;';
                list.appendChild(e); return;
            }
            shown.forEach((o) => {
                const r = document.createElement('label');
                r.style.cssText = `display:flex;gap:8px;align-items:center;padding:5px 6px;border-radius:6px;white-space:nowrap;${o.disabled ? 'opacity:.5;cursor:not-allowed;' : 'cursor:pointer;'}`;
                const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selSet.has(o.key);
                cb.disabled = !!o.disabled; cb.style.accentColor = 'var(--accent-primary)';
                cb.onchange = () => { if (cb.checked) selSet.add(o.key); else selSet.delete(o.key); summary(); _fire(); refreshToggles(); };
                r.appendChild(cb);
                if (o.icon) {
                    const im = document.createElement('img'); im.src = o.icon; im.width = 18; im.height = 18;
                    im.style.cssText = 'image-rendering:pixelated;flex-shrink:0;';
                    im.onerror = () => { im.style.visibility = 'hidden'; };
                    r.appendChild(im);
                }
                if (o.icons) {
                    o.icons.forEach((ic) => { const im = document.createElement('img'); im.src = ic; im.width = 16; im.height = 16; im.style.cssText = 'image-rendering:pixelated;flex-shrink:0;'; im.onerror = () => { im.style.visibility = 'hidden'; }; r.appendChild(im); });
                }
                const s = document.createElement('span'); s.textContent = o.label; r.appendChild(s);
                if (o.disabled) { const soon = document.createElement('span'); soon.textContent = 'soon'; soon.style.cssText = 'font-size:.7em;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:4px;padding:0 4px;margin-left:2px;'; r.appendChild(soon); }
                if (o.info) { const i = document.createElement('span'); i.className = 'travel-info-icon'; i.dataset.info = o.info; i.textContent = 'ⓘ'; i.style.cssText = 'margin-left:auto;'; i.addEventListener('mousedown', (e) => e.stopPropagation()); r.appendChild(i); }
                list.appendChild(r);
            });
            wireInfoIcons(list);
            refreshToggles();
        };
        srch.addEventListener('input', renderList);
        srch.addEventListener('mousedown', (e) => e.stopPropagation());
        let open = false;
        const outside = (e) => { if (!wrap.contains(e.target)) closePanel(); };
        const openPanel = () => { open = true; renderList(); caret.style.transform = 'rotate(0deg)'; if (window.$) { window.$(panel).stop(true, true).slideDown(180); } else { panel.style.display = 'block'; } this._fitPanel(panel); document.addEventListener('mousedown', outside, true); };
        const closePanel = () => { if (!open) return; open = false; caret.style.transform = 'rotate(-90deg)'; if (window.$) { window.$(panel).stop(true, true).slideUp(180); } else { panel.style.display = 'none'; } document.removeEventListener('mousedown', outside, true); };
        control.onclick = (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); };
        summary();
        return { el: wrap, getSelected: () => Array.from(selSet) };
    }

    _radioSelect({ label, options, selected, onChange }) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;min-width:150px;';
        const control = document.createElement('button');
        control.type = 'button';
        control.style.cssText = 'width:100%;text-align:left;padding:7px 10px;border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;';
        const lab = document.createElement('span');
        const caret = document.createElement('span'); caret.textContent = '▼'; caret.style.cssText = 'opacity:.7;font-size:.75em;transition:transform .15s;transform:rotate(-90deg);';
        control.append(lab, caret);
        const panel = document.createElement('div');
        panel.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;min-width:100%;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;z-index:30;display:none;box-shadow:0 8px 22px rgba(0,0,0,.55);padding:4px;';
        let cur = selected;
        let open = false;
        const setLabel = () => { lab.textContent = `${label}: ${(options.find((o) => o.key === cur) || options[0]).label}`; };
        const closePanel = () => { if (!open) return; open = false; caret.style.transform = 'rotate(-90deg)'; if (window.$) window.$(panel).stop(true, true).slideUp(180); else panel.style.display = 'none'; document.removeEventListener('mousedown', outside, true); };
        options.forEach((o) => {
            const r = document.createElement('label');
            r.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;cursor:pointer;';
            const rb = document.createElement('input'); rb.type = 'radio'; rb.name = `jb-${label}`; rb.checked = o.key === cur;
            rb.onchange = () => { cur = o.key; setLabel(); closePanel(); onChange(cur); };
            const s = document.createElement('span'); s.textContent = o.label;
            r.append(rb, s); panel.appendChild(r);
        });
        wrap.append(control, panel);
        const outside = (e) => { if (!wrap.contains(e.target)) closePanel(); };
        const openPanel = () => { open = true; caret.style.transform = 'rotate(0deg)'; if (window.$) window.$(panel).stop(true, true).slideDown(180); else panel.style.display = 'block'; this._fitPanel(panel); document.addEventListener('mousedown', outside, true); };
        control.onclick = (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); };
        setLabel();
        return wrap;
    }

    _smallBtn(text) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        b.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:5px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);cursor:pointer;';
        return b;
    }

    // Keep an open dropdown panel inside the viewport: anchor left by default,
    // flip to right-anchored if it would overflow the right edge.
    _fitPanel(panel) {
        panel.style.left = '0'; panel.style.right = 'auto';
        requestAnimationFrame(() => {
            const rect = panel.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth;
            if (rect.right > vw - 8) { panel.style.left = 'auto'; panel.style.right = '0'; }
        });
    }

    // ── Filtering ────────────────────────────────────────────────────────────
    // Fail-safe wrapper: a single malformed job must never throw out of the
    // filter pipeline and blank the entire board. On error, drop that one job
    // (treat as non-matching) and log once for diagnosis.
    _jobMatches(job) {
        try { return this._jobMatchesInner(job); }
        catch (e) { if (!this._warnedMatch) { this._warnedMatch = true; console.warn('[jobboard] filter threw on a job; dropping it', (job && job.id), e); } return false; }
    }

    _jobMatchesInner(job) {
        if (this._showAllOverride) return true;
        const f = this.filters;
        if (f.factions.length && !job.factions.some((x) => f.factions.includes(x.slug))) return false;
        if (f.locations.length && !f.locations.includes(job.board_id)) return false;
        if (f.tiers.length && !f.tiers.includes(job.tier.key)) return false;
        if (f.rewards.length && !this._rewardKeys(job).some((k) => f.rewards.includes(k))) return false;
        if (f.bonus && f.bonus.length) { const bs = job.bonus ? 'bonus' : 'not_bonus'; if (!f.bonus.includes(bs)) return false; }
        if (f.status && f.status !== 'all' && this._jobStatus(job.id) !== f.status) return false;
        if (f.handIn.length && !this._handInMatch(job, f.handIn)) return false;
        if (f.q && f.q.trim()) { if (!this._textMatch(job, f.q.trim().toLowerCase())) return false; }
        return true;
    }

    _rewardKeys(job) {
        const out = [];
        for (const r of job.rewards) {
            if (r.kind === 'faction_reputation' && r.faction) out.push(`rep:${r.faction.slug}`);
            else if (r.kind === 'item' && r.item) out.push(`item:${r.item.slug || r.item.id}`);
            else if (r.kind === 'coins') out.push('coins');
            else if (r.kind === 'skill_experience') out.push(`xp:${r.skill}`);
        }
        return out;
    }

    // Quality GROUP for owned-vs-required EXACT matching. Crafted Normal copies
    // ('', none, common) share the 'normal' group; every other rarity is its own
    // group. A job-board tier is handed in only with the EXACT quality of that
    // tier — a Fine copy does NOT fill a Normal goal, and a higher rarity does
    // NOT downgrade — so matching is '===', never '>='.
    _qGroup(tok) {
        const t = String(tok || '').toLowerCase();
        return (t === '' || t === 'none' || t === 'common') ? 'normal' : t;
    }

    // Total owned of `slug` that can satisfy a requirement of (quality, tag).
    // A 'fine' requirement is satisfied ONLY by fine-tagged copies. Every other
    // requirement counts copies at the EXACT quality group of the tier (Fine
    // copies do NOT count toward a Normal goal).
    _ownedCount(slug, quality, tag) {
        if (!slug) return 0;
        const bucket = this.owned && this.owned[slug];
        if (!bucket) return 0;
        if (String(tag || '').toLowerCase() === 'fine') return bucket['fine'] || 0;
        const need = this._qGroup(quality);
        let n = 0;
        for (const tok in bucket) {
            const t = String(tok || '').toLowerCase();
            // The base '' / 'none' token is a NON-crafted item (loot / drop /
            // material) held at its OWN fixed rarity — crafted copies always
            // carry an explicit rarity suffix (_common.._ethereal), so '' never
            // denotes a crafted Normal. A job-board goal's `quality` for such an
            // item IS that item's native rarity (e.g. Gold pan is uncommon), so a
            // base copy must satisfy ANY rarity requirement; otherwise an owned
            // uncommon+ loot item wrongly shows 0 owned (the "7 gold pans → 0/4"
            // bug).
            if (t === '' || t === 'none') { n += (bucket[tok] || 0); continue; }
            if (this._qGroup(t) === need) n += (bucket[tok] || 0);
        }
        return n;
    }

    // Can this goal be handed in from inventory, keeping `reserve` in reserve?
    // Satisfied if ANY accept-option (base or a higher-quality alternative) is
    // covered by owned-at-or-above that quality.
    _goalSatisfiable(g, reserve) {
        const slug = g.item && g.item.slug;
        if (!slug) return false;
        const opts = [{ q: g.item.quality, n: g.quantity, tag: g.item.tag }];
        (g.alternatives || []).forEach((a) => { if (a) opts.push({ q: a.quality, n: a.quantity, tag: a.tag }); });
        return opts.some((o) => o.n != null && this._ownedCount(slug, o.q, o.tag) >= (o.n + reserve));
    }

    _handInMatch(job, modes) {
        // OR across the selected modes.
        const h = this.handin[job.id] || {};
        // Guard: some jobs can arrive without a goals array; every other
        // call site uses (job.goals || []). Without this guard a persisted
        // hand-in filter throws here and blanks the whole board.
        const goals = job.goals || [];
        for (const m of modes) {
            if (m === 'owned') {
                if (goals.length && goals.every((g) => this._goalSatisfiable(g, 0))) return true;
            } else if (m === 'not_owned') {
                if (goals.length && goals.some((g) => !this._goalSatisfiable(g, 0))) return true;
            } else if (m === 'safe_owned') {
                if (goals.length && goals.every((g) => this._goalSatisfiable(g, 1))) return true;
            } else if (m === 'owned_materials') {
                // "Owned materials for crafts" is a shopping list of things you
                // still need to MAKE. A goal whose main item (or any alt) is
                // already fulfilled from inventory is noise. Only match when at
                // least one goal has neither its main nor any alt fulfilled.
                if (h.owned_materials && goals.length
                    && goals.some((g) => !this._goalSatisfiable(g, 0))) return true;
            } else if (m === 'partial_materials') {
                // Same "still need to make it" rule as owned_materials.
                if (h.partial_materials && goals.length
                    && goals.some((g) => !this._goalSatisfiable(g, 0))) return true;
            } else if (m === 'no_owned_materials') {
                if (h.has_crafts && !h.partial_materials) return true;
            } else if (m === 'can_obtain') {
                if (h.can_obtain) return true;
            } else if (m === 'trade_listings') {
                const items = [];
                job.goals.forEach((g) => { if (g.item) items.push(g.item); (g.alternatives || []).forEach((a) => items.push(a)); });
                if (items.some((it) => it.slug && this.listingSlugs.has(it.slug))) return true;
            }
        }
        return false;
    }

    _textMatch(job, q) {
        const hay = [];
        hay.push(job.board_name, job.location, job.tier.label);
        job.factions.forEach((f) => hay.push(f.name));
        job.goals.forEach((g) => {
            [g.item, ...(g.alternatives || [])].forEach((it) => { if (it) { hay.push(it.name, it.slug); (it.keywords || []).forEach((k) => hay.push(k)); } });
        });
        job.rewards.forEach((r) => {
            if (r.faction) hay.push(r.faction.name);
            if (r.item) hay.push(r.item.name, r.item.slug);
            if (r.skill) hay.push(r.skill);
        });
        return hay.filter(Boolean).some((s) => String(s).toLowerCase().replace(/_/g, ' ').includes(q.replace(/_/g, ' ')));
    }

    // ── Table ────────────────────────────────────────────────────────────────
    _renderTable() {
        const content = this.el.querySelector('[data-content]');
        try { this._renderTableInner(content); }
        catch (e) {
            console.error('[jobboard] render failed', e);
            if (content) content.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-secondary);">Something went wrong drawing the job board. Please reload. If it keeps happening, file a bug report.</div>';
        }
    }

    _renderTableInner(content) {
        // Preserve the table's horizontal scroll across the full innerHTML
        // rebuild — otherwise a sort click (or any re-render) resets scrollLeft
        // to 0 and the table visibly jumps left on mobile where it overflows.
        const _prevScroll = (() => { const s = content && content.querySelector('.jb-table-scroll'); return s ? s.scrollLeft : 0; })();
        this._ensureReportState(); this._ensureCraftable();   // fill "Steps for you"
        const all = (this.data && this.data.jobs) || [];
        this._ineffMap = this._computeIneff(all);
        const jobs = all.filter((j) => this._jobMatches(j));
        const needRun = this._reportStateReady && jobs.some((j) => { const st = this._stepsState(j).state; return st === 'find' || st === 'stale'; });
        const stepsAllBtn = needRun
            ? ` <button data-jb-steps-all style="margin-left:8px;padding:1px 8px;border-radius:5px;border:1px solid var(--accent-primary,#4a9eff);background:var(--accent-primary,#4a9eff);color:#fff;cursor:pointer;font-size:11px;">Find &amp; rerun steps for you</button>`
            : '';
        const countBar = this._showAllOverride
            ? `<div style="color:var(--text-secondary);font-size:.85em;margin:4px 0 8px;">Showing all ${jobs.length} of ${all.length} jobs <button data-jb-restore style="margin-left:8px;padding:1px 8px;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;font-size:11px;">Use current filter</button>${stepsAllBtn}</div>`
            : `<div style="color:var(--text-secondary);font-size:.85em;margin:4px 0 8px;">Showing ${jobs.length} of ${all.length} jobs${stepsAllBtn}</div>`;
        if (!jobs.length) {
            content.innerHTML = countBar + '<div style="padding:30px;text-align:center;color:var(--text-secondary);">No jobs match these filters.</div>';
            return;
        }
        const sortedJobs = this._sortJobs(jobs);
        const rows = sortedJobs.map((j) => this._rowHtml(j)).join('');
        const sortCols = [['board', 'Board'], ['tier', 'Tier'], ['goals', 'Goals'], ['rewards', 'Rewards'], ['steps', 'Steps for you'], ['status', 'Status']];
        const sk = this._sort && this._sort.key;
        const sd = this._sort && this._sort.dir;
        const headCells = sortCols.map(([key, label]) => {
            // Active column shows a text-presentation direction caret (\uFE0E
            // keeps ▲/▼ as a plain glyph, never a color emoji on mobile).
            // Inactive columns show NO icon — clicking is enough, and the old
            // ↕ hint rendered as a jarring emoji on mobile.
            const caret = sk === key ? (sd === 'asc' ? ' \u25B2\uFE0E' : ' \u25BC\uFE0E') : '';
            return `<th data-sort-key="${key}" style="padding:6px 8px;cursor:pointer;user-select:none;white-space:nowrap;">${esc(label)}${caret}</th>`;
        }).join('');
        content.innerHTML = countBar + `
            <div class="jb-table-scroll" style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
              <thead><tr style="text-align:left;color:var(--text-secondary);border-bottom:1px solid var(--border-color);">
                ${headCells}
              </tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`;
        const _sc = content.querySelector('.jb-table-scroll');
        if (_sc && _prevScroll) _sc.scrollLeft = _prevScroll;
        // Apply status row styling (planned blue outline on cells, completed
        // tint) after the rows exist, so it renders on mobile too.
        content.querySelectorAll('tbody tr[data-job-id]').forEach((tr) => {
            this._applyRowTint(tr, this._jobStatus(tr.getAttribute('data-job-id')));
        });
        wireInfoIcons(content);
    }

    // Sort the filtered jobs by the active header (null = natural order).
    _sortJobs(jobs) {
        if (!this._sort) return jobs;
        const { key, dir } = this._sort;
        const mul = dir === 'asc' ? 1 : -1;
        return jobs.slice().sort((a, b) => {
            const av = this._sortValue(a, key);
            const bv = this._sortValue(b, key);
            let cmp;
            if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
            else cmp = String(av).localeCompare(String(bv));
            return mul * cmp;
        });
    }

    _sortValue(job, key) {
        switch (key) {
            case 'board': return String(job.location || '').toLowerCase();
            case 'tier': return (job.tier && job.tier.rank) || 0;
            case 'goals': return (job.goals || []).reduce((s, g) => s + (g.quantity || 0), 0);
            case 'rewards': return this._mergedRewards(job).reduce((s, r) => s + (r.amount || 1), 0);
            case 'steps': {
                const s = this._stepsState(job);
                // Finite tier ranks (NOT Infinity — Infinity-Infinity is NaN,
                // which makes the comparator inconsistent and scrambles the
                // "—"/Find rows into a random order). numbers < Find < "—".
                if (s.state === 'fresh' || s.state === 'stale') return s.total;
                if (s.state === 'find') return 1e15;   // Find: below numbers, above "—"
                return 2e15;   // crafted / none / pending ("—") last
            }
            case 'status': return { uncompleted: 0, planned: 1, completed: 2 }[this._jobStatus(job.id)] || 0;
            default: return 0;
        }
    }

    // Re-render after a status toggle. If a status filter is active the row may
    // now be filtered out, so re-render the whole table; otherwise update just
    // that row's status cell in place (no scroll jump).
    _onStatusChanged(id) {
        if (this.filters.status && this.filters.status !== 'all') { this._renderTable(); return; }
        const job = ((this.data && this.data.jobs) || []).find((j) => String(j.id) === String(id));
        const tr = this.el.querySelector(`tr[data-job-id="${CSS.escape(String(id))}"]`);
        if (!job || !tr) { this._renderTable(); return; }
        const cell = tr.querySelector('[data-status-cell]');
        if (cell) this._styleStatusBtns(cell, this._jobStatus(id));
        this._applyRowTint(tr, this._jobStatus(id));
    }

    // Full-row styling by status: planned = blue outline; completed = green
    // background + italic + dimmed. Kept in sync with the inline tint in _rowHtml.
    _applyRowTint(tr, st) {
        tr.style.boxShadow = ''; tr.style.background = ''; tr.style.fontStyle = ''; tr.style.opacity = '';
        const tds = tr.querySelectorAll('td');
        tds.forEach((td) => { td.style.boxShadow = ''; });
        if (st === 'completed') {
            tr.style.background = 'rgba(46,125,79,0.22)';
            tr.style.fontStyle = 'italic';
            tr.style.opacity = '0.7';
        } else if (st === 'planned') {
            // box-shadow on a <tr> does NOT render on mobile Safari, so the
            // planned blue outline was invisible on phones. Draw it on the
            // CELLS instead: top+bottom on every cell, left on the first, right
            // on the last — reconstructing a full outline that renders anywhere.
            const n = tds.length;
            tds.forEach((td, i) => {
                const p = ['inset 0 2px 0 #4fc3f7', 'inset 0 -2px 0 #4fc3f7'];
                if (i === 0) p.push('inset 2px 0 0 #4fc3f7');
                if (i === n - 1) p.push('inset -2px 0 0 #4fc3f7');
                td.style.boxShadow = p.join(',');
            });
        }
    }

    // Stacked Plan/Complete buttons; the one matching the current status flips
    // to its undo form (Unplan / Uncomplete).
    _statusCellInner(job) {
        const st = this._jobStatus(job.id);
        const base = 'display:block;width:100%;margin:2px 0;padding:4px 8px;border-radius:5px;font-size:12px;cursor:pointer;border:1px solid transparent;color:#fff;transition:background-color .2s ease, filter .15s ease;';
        const hov = ` onmouseover="this.style.filter='brightness(1.15)'" onmouseout="this.style.filter=''"`;
        const p = this._statusBtnSpec(st, 'plan');
        const d = this._statusBtnSpec(st, 'done');
        const planBtn = `<button data-role="plan" data-jb-status="${p.action}" data-id="${job.id}"${hov} style="${base}background-color:${p.bg};">${p.text}</button>`;
        const doneBtn = `<button data-role="done" data-jb-status="${d.action}" data-id="${job.id}"${hov} style="${base}background-color:${d.bg};">${d.text}</button>`;
        return planBtn + doneBtn;
    }

    // One button's label / action / color for a given status + role.
    _statusBtnSpec(st, role) {
        const BLUE = '#2f6fed', RED = '#b23b3b', GREEN = '#2e7d4f';
        if (role === 'plan') {
            return st === 'planned' ? { text: 'Unplan', action: 'unplan', bg: RED }
                                    : { text: 'Plan', action: 'plan', bg: BLUE };
        }
        return st === 'completed' ? { text: 'Uncomplete', action: 'uncomplete', bg: RED }
                                  : { text: 'Complete', action: 'complete', bg: GREEN };
    }

    // Update the two status buttons in place so their background COLOR animates
    // (transition) on a status change, instead of swapping the DOM node.
    _styleStatusBtns(cell, st) {
        ['plan', 'done'].forEach((role) => {
            const b = cell.querySelector(`button[data-role="${role}"]`);
            if (!b) return;
            const s = this._statusBtnSpec(st, role);
            b.textContent = s.text;
            b.setAttribute('data-jb-status', s.action);
            b.style.backgroundColor = s.bg;
        });
    }

    // Display name consistent with the rest of the site: catalog name by slug,
    // else the backend-resolved name, else window.prettyName, else prettified
    // slug. Never "Unknown item".
    _displayName(it) {
        if (!it) return '';
        const s = it.slug;
        if (s && this.nameBySlug && this.nameBySlug[s]) return this.nameBySlug[s];
        if (it.name) return it.name;
        if (s && window.prettyName) { try { return window.prettyName(s); } catch (e) { /* ignore */ } }
        if (s) return s.replace(/_/g, ' ');
        return '';
    }

    // Rarity outline SVG filter (matches .item-row/.gear-slot rarity icons).
    _rarityFilter(it) {
        const VALID = { common: 1, uncommon: 1, rare: 1, epic: 1, legendary: 1, ethereal: 1 };
        let t = String((it && it.quality) || '').toLowerCase();
        if (it && it.tag === 'fine') t = 'fine';
        if (!VALID[t] && t !== 'fine') t = 'common';
        return `url(#outline-${t}-1)`;
    }

    // Display color: fine-tagged items use the fine color; otherwise the
    // item's rarity color.
    _itemColor(it) {
        return this._isFine(it) ? 'var(--fine-color)' : qualColor(it && it.quality);
    }

    // Fine-ness is encoded inconsistently by the job API: some goals carry
    // tag==='fine', others quality==='fine'. Treat either as fine so steps,
    // colors, and material lookups all agree.
    _isFine(it) {
        return !!(it && (it.tag === 'fine' || String(it.quality || '').toLowerCase() === 'fine'));
    }

    // Yellow material-breakdown button. Shows only for a CRAFTED goal item you
    // don't fully own yet (own some finals but < quantity). Clicking opens the
    // netted material popup. Craftability comes from _ensureCraftable's map.
    _matButton(it, qty, jobId) {
        if (!it || !it.slug || !this._craftableByName) return '';
        const name = this._displayName(it);
        const ref = this._craftableByName[name.toLowerCase()];
        if (!ref) return '';   // not a crafted item
        const owned = this._ownedCount(it.slug, it.quality, it.tag);
        if (owned >= (qty || 0)) return '';   // already have all the finals
        const qWord = QUALITY_WORD[String(it.quality || '').toLowerCase()] || 'Normal';
        const payload = [ref, name, qWord, (qty || 0), this._isFine(it) ? '1' : '0', it.quality || '', it.tag || ''].join('|');
        // Green = you own (or can craft from what you own) ALL materials for the
        // WHOLE job quantity; yellow = you're still short. Computed server-side
        // per (job,item) because it depends on the job's required quantity.
        const green = (this.matColors && this.matColors[`${jobId}|${it.slug}`]) === 'green';
        const bg = green ? '#2e9e5b' : '#d7b500';
        const bd = green ? '#1f7a44' : '#a88a00';
        const ttl = green
            ? 'You have all the materials for these — click for the breakdown'
            : 'Materials you still need to craft these — click';
        return ` <span class="jb-mat-btn" role="button" tabindex="0" data-jb-mat="${esc(payload)}" title="${ttl}" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:0 4px;background:${bg};border:1px solid ${bd};border-radius:4px;cursor:pointer;vertical-align:middle;"><img src="/assets/icons/attributes/materials.svg" width="20" height="20" style="image-rendering:pixelated;display:block;" alt="mats" onerror="this.replaceWith(document.createTextNode('▦'))"></span>`;
    }

    _itemChip(it, qty) {
        if (!it) return '';
        const icon = this._icon(it.slug);
        const name = this._displayName(it);
        const color = this._itemColor(it);
        const img = icon ? `<img src="${esc(icon)}" width="16" height="16" style="image-rendering:pixelated;vertical-align:middle;filter:${this._rarityFilter(it)};" onerror="this.style.visibility='hidden'">` : '';
        return `${img} <span class="jb-item-link" role="button" tabindex="0" data-jb="${esc(this._menuPayload(it, qty))}" style="color:${color};text-decoration:underline dotted;text-underline-offset:2px;cursor:pointer;">${esc(name)}</span>`;
    }

    // Pipe-delimited item context carried on the clickable name (safe inside the
    // Alt info-popover's attribute-embedded HTML — no quotes/JSON). Order:
    // slug|quality|tag|type|qty|craftId.
    _menuPayload(it, qty) {
        const craftId = (it.slug && this.craftIdBySlug && this.craftIdBySlug[it.slug]) || '';
        return [it.slug || '', it.quality || '', it.tag || '', it.type || '',
                (qty != null ? qty : ''), craftId, it.is_chest ? '1' : ''].join('|');
    }

    _goalHtml(g, betterJobId, jobId) {
        const alts = (g.alternatives || []).filter((a) => a && a.quality);
        const slug = g.item && g.item.slug;
        const need = g.quantity || 0;
        const have = slug ? this._ownedCount(slug, g.item && g.item.quality, g.item && g.item.tag) : 0;
        const met = need > 0 && have >= need;
        const count = ` <span style="font-size:.85em;color:${met ? '#66bb6a' : 'var(--text-secondary)'};">(${have}/${need})</span>`;
        const warn = betterJobId
            ? `<span class="jb-ineff" role="button" tabindex="0" data-jb-better="${esc(String(betterJobId))}" title="There is a better job for equal or better rewards that is not complete." style="color:#f2c744;cursor:pointer;margin-right:3px;">⚠</span>`
            : '';
        return `<div style="margin:2px 0;">${warn}<strong>${need}×</strong> ${this._itemChip(g.item, need)}${count}${this._matButton(g.item, need, jobId)}${alts.length ? this._altButton(alts, betterJobId, jobId) : ''}</div>`;
    }

    // Blue "alt" chip (info-popover style). Popup lists the hand-in-instead
    // qualities in ascending quality order: "x<qty> <QualityName>" with the
    // name in its rarity color.
    _altButton(alts, betterJobId, jobId) {
        const ORDER = { fine: 0, common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, ethereal: 6 };
        const sorted = alts.slice().sort((a, b) => (ORDER[String(a.quality).toLowerCase()] ?? 99) - (ORDER[String(b.quality).toLowerCase()] ?? 99));
        const warn = betterJobId
            ? `<span class="jb-ineff" role="button" tabindex="0" data-jb-better="${esc(String(betterJobId))}" title="There is a better job for equal or better rewards that is not complete." style="color:#f2c744;cursor:pointer;margin-right:3px;">⚠</span>`
            : '';
        const lines = sorted.map((a) => {
            const have = this._ownedCount(a.slug, a.quality, a.tag);
            const need = a.quantity ?? 0;
            const met = need > 0 && have >= need;
            return `<div style="white-space:nowrap;">${warn}x${a.quantity ?? ''} <span class="jb-item-link" role="button" tabindex="0" data-jb="${esc(this._menuPayload(a, a.quantity))}" style="color:${qualColor(a.quality)};font-weight:600;text-decoration:underline dotted;cursor:pointer;">${esc(qualWord(a.quality))}</span> <span style="color:${met ? '#66bb6a' : 'var(--text-secondary)'};">(${have}/${need})</span>${this._matButton(a, a.quantity, jobId)}</div>`;
        }).join('');
        const html = `<div style="display:flex;flex-direction:column;gap:2px;">${lines}</div>`;
        return ` <span class="travel-info-icon jb-alt" role="button" tabindex="0" aria-label="Alternative hand-ins" data-info-title="Hand in instead" data-info-html="${esc(html)}" style="font-style:normal;font-size:.8em;border:1px solid var(--accent-primary,#4a9eff);border-radius:4px;padding:0 5px;min-width:0;min-height:0;">Alt</span>`;
    }

    _rewardHtml(r) {
        if (r.kind === 'faction_reputation' && r.faction) {
            return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><img src="${esc(r.faction.icon)}" width="16" height="16" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'"><span style="color:#66bb6a;">+${r.amount ?? ''}</span> ${esc(r.faction.name)} rep</span>`;
        }
        if (r.kind === 'item' && r.item) {
            const icon = this._icon(r.item.slug);
            const name = this._displayName(r.item);
            const img = icon ? `<img src="${esc(icon)}" width="16" height="16" style="image-rendering:pixelated;vertical-align:middle;" onerror="this.style.visibility='hidden'">` : '';
            return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;" title="${esc(name)}">${img} ${r.amount > 1 ? `${r.amount}× ` : ''}${esc(name)}</span>`;
        }
        if (r.kind === 'coins') return `<span style="margin-right:10px;">${r.amount ?? ''} coins</span>`;
        if (r.kind === 'skill_experience') return `<span style="margin-right:10px;">${esc(String(r.skill || '').replace(/_/g, ' '))} XP +${r.amount ?? ''}</span>`;
        return '';
    }

    // Combine multiple faction_reputation rewards for the SAME faction into one
    // (sum amounts) — one job can grant a faction rep several times. Different
    // factions (e.g. Everhaven's Erdwise + Trellin) stay separate. Other reward
    // kinds pass through unchanged, in order.
    _mergedRewards(job) {
        const out = [];
        const repBySlug = {};
        const itemByKey = {};
        for (const r of job.rewards) {
            if (r.kind === 'faction_reputation' && r.faction) {
                const slug = r.faction.slug;
                if (repBySlug[slug]) { repBySlug[slug].amount = (repBySlug[slug].amount || 0) + (r.amount || 0); continue; }
                const copy = { ...r, amount: r.amount || 0 };
                repBySlug[slug] = copy;
                out.push(copy);
            } else if (r.kind === 'item' && r.item) {
                const k = `item:${r.item.slug || r.item.id}`;
                if (itemByKey[k]) { itemByKey[k].amount = (itemByKey[k].amount || 0) + (r.amount || 1); continue; }
                const copy = { ...r, amount: r.amount || 1 };
                itemByKey[k] = copy;
                out.push(copy);
            } else {
                out.push(r);
            }
        }
        return out;
    }

    // Rewards cell, grouped onto its own line per kind so the column stays
    // narrow: (1) item rewards, (2) chests, (3) faction reputation A->Z.
    // Coins / skill XP ride along on the item line. Reputation is merged first
    // (sum repeats of the same faction) then sorted alphabetically by name.
    _rewardsHtml(job) {
        const merged = this._mergedRewards(job);
        const items = [], chests = [], reps = [], other = [];
        for (const r of merged) {
            if (r.kind === 'item' && r.item) (r.item.is_chest ? chests : items).push(r);
            else if (r.kind === 'faction_reputation' && r.faction) reps.push(r);
            else other.push(r); // coins, skill_experience
        }
        reps.sort((a, b) => String(a.faction.name).localeCompare(String(b.faction.name)));
        const lines = [
            [...items, ...other],
            chests,
            reps,
        ];
        return lines
            .filter((grp) => grp.length)
            .map((grp) => `<div style="margin:2px 0;">${grp.map((r) => this._rewardHtml(r)).join('')}</div>`)
            .join('');
    }

    // ── Inefficiency detection ──────────────────────────────────────────────
    // Flags a job whose goals cost MORE than another not-completed job that
    // grants the same rewards for the same item shape (e.g. needs 3× where a
    // sibling needs 1×). Returns {jobId: betterJobId}.
    // Item-shape key: sorted goal (slug:quality/fine), ignoring quantity.
    _reqShape(job) {
        const keys = (job.goals || []).map((g) => {
            const it = g.item || {};
            const q = (it.tag === 'fine') ? 'fine' : (it.quality || '');
            return `${it.slug || ''}:${q}`;
        });
        return keys.sort().join('|');
    }

    _rewardVec(job) {
        const v = {};
        for (const r of this._mergedRewards(job)) {
            let k = null;
            if (r.kind === 'faction_reputation' && r.faction) k = `rep:${r.faction.slug}`;
            else if (r.kind === 'item' && r.item) k = `item:${r.item.slug || r.item.id}`;
            else if (r.kind === 'coins') k = 'coins';
            else if (r.kind === 'skill_experience') k = `xp:${r.skill}`;
            if (k) v[k] = (v[k] || 0) + (r.amount || 0);
        }
        return v;
    }

    // true if b's rewards are >= a's on every reward a grants (b may add more).
    _rewardGE(b, a) {
        for (const k in a) { if ((b[k] || 0) < a[k]) return false; }
        return true;
    }

    _jobCost(job) {
        return (job.goals || []).reduce((s, g) => s + (g.quantity || 0), 0);
    }

    // A job is inefficient if another NOT-complete job with the same item shape
    // grants EQUAL-OR-BETTER rewards for EQUAL-OR-LOWER cost, strictly better in
    // at least one of the two. Returns {jobId: betterJobId} (best = lowest cost).
    _computeIneff(jobs) {
        const groups = {};
        for (const j of jobs) {
            const key = this._reqShape(j);
            (groups[key] = groups[key] || []).push(j);
        }
        const vec = new Map();
        const cost = new Map();
        for (const j of jobs) { vec.set(j.id, this._rewardVec(j)); cost.set(j.id, this._jobCost(j)); }
        const map = {};
        for (const key in groups) {
            const arr = groups[key];
            if (arr.length < 2) continue;
            for (const a of arr) {
                if (this._jobStatus(a.id) === 'completed') continue;
                let best = null, bestCost = Infinity;
                for (const b of arr) {
                    if (b.id === a.id || this._jobStatus(b.id) === 'completed') continue;
                    const cb = cost.get(b.id), ca = cost.get(a.id);
                    if (cb > ca) continue;                              // b not cheaper-or-equal
                    if (!this._rewardGE(vec.get(b.id), vec.get(a.id))) continue;  // b not >= rewards
                    const strictlyBetter = cb < ca || !this._rewardGE(vec.get(a.id), vec.get(b.id));
                    if (!strictlyBetter) continue;                     // identical -> not a win
                    if (cb < bestCost) { bestCost = cb; best = b; }
                }
                if (best) map[a.id] = best.id;
            }
        }
        return map;
    }

    // Jump to a job: reveal it (dropping filters with a restore banner if it's
    // filtered out), scroll to it, and flash a highlight.
    _goToJob(id) {
        this._closeTip();
        const find = () => this.el.querySelector(`tr[data-job-id="${CSS.escape(String(id))}"]`);
        let row = find();
        if (!row) { this._showAllOverride = true; this._renderTable(); row = find(); }
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = row.style.outline;
        row.style.outline = '3px solid #f2c744';
        row.style.outlineOffset = '-3px';
        setTimeout(() => { row.style.outline = prev || ''; }, 2600);
    }

    _closeTip() {
        if (this._tipCleanup) { this._tipCleanup(); this._tipCleanup = null; }
        if (this._tipEl) { this._tipEl.remove(); this._tipEl = null; }
    }

    _openBetterJobTip(anchorEl, targetId) {
        this._closeTip();
        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;z-index:100001;max-width:260px;background:var(--bg-secondary,#1c2128);'
            + 'border:1px solid var(--border-color,#333);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);'
            + 'padding:10px;font-size:13px;color:var(--text-primary,#e8e8e8);';
        const msg = document.createElement('div');
        msg.style.cssText = 'margin-bottom:8px;';
        msg.textContent = 'There is a better job for equal or better rewards that is not complete.';
        const go = document.createElement('button');
        go.type = 'button'; go.textContent = 'Go to job';
        go.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid #2f6fed;background:#2f6fed;color:#fff;cursor:pointer;font-size:12px;';
        go.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._goToJob(targetId); };
        tip.append(msg, go);
        document.body.appendChild(tip);
        this._tipEl = tip;
        const r = anchorEl.getBoundingClientRect();
        let left = r.left; let top = r.bottom + 4;
        const tw = tip.offsetWidth || 260; const th = tip.offsetHeight || 80;
        if (left + tw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - tw - 8);
        if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 4);
        tip.style.left = `${Math.round(left)}px`; tip.style.top = `${Math.round(top)}px`;
        const onDown = (e) => { if (!tip.contains(e.target) && e.target !== anchorEl) this._closeTip(); };
        const onKey = (e) => { if (e.key === 'Escape') this._closeTip(); };
        setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
        document.addEventListener('keydown', onKey, true);
        this._tipCleanup = () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
    }

    _closeMatPopup() {
        if (this._matCleanup) { this._matCleanup(); this._matCleanup = null; }
        const el = this._matEl; this._matEl = null; this._matAnchor = null;
        if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 150); }
    }

    _reposMat(box, anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        const w = box.offsetWidth || 260, h = box.offsetHeight || 140;
        let left = r.left, top = r.bottom + 4;
        if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
        box.style.left = `${Math.round(left)}px`; box.style.top = `${Math.round(top)}px`;
    }

    // Netted material-breakdown popup for a partially-owned crafted goal item.
    // Fetches /api/jobboard/material-breakdown (crafting-tree shopping list,
    // owned-aware, shared-material aggregated), lists (owned/needed) per
    // material, a gear-not-accounted note, and an Open-in-crafting-tree button.
    _openMaterialPopup(anchorEl, payload) {
        this._closeMatPopup();
        const parts = String(payload || '').split('|');
        const ref = parts[0] || '', name = parts[1] || '', qWord = parts[2] || 'Normal';
        const qty = parseInt(parts[3], 10) || 0, useFine = parts[4] === '1';
        const qToken = parts[5] || '', qTag = parts[6] || '';
        if (!ref) return;
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;z-index:100001;min-width:240px;max-width:340px;max-height:60vh;overflow:auto;'
            + 'background:var(--bg-secondary,#1c2128);border:1px solid var(--border-color,#333);border-radius:10px;'
            + 'box-shadow:0 10px 30px rgba(0,0,0,.55);padding:10px;font-size:13px;color:var(--text-primary,#e8e8e8);'
            + 'opacity:0;transition:opacity .15s ease;';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;margin-bottom:6px;';
        title.innerHTML = `Materials for ${qty}× <span style="color:${this._itemColor({ quality: qToken, tag: qTag })};">${esc(name)}</span>`;
        const ctBtn = document.createElement('button');
        ctBtn.type = 'button'; ctBtn.textContent = 'Open in crafting tree';
        ctBtn.style.cssText = 'width:100%;padding:5px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;font-size:12px;margin-bottom:8px;';
        ctBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this._closeMatPopup(); this.close(); if (typeof window._openCraftingTreeGlobal === 'function') window._openCraftingTreeGlobal(ref, { quality: qWord, quantity: qty, useFine }); };
        const note = document.createElement('div');
        note.style.cssText = 'color:var(--text-secondary);font-size:.8em;margin-bottom:6px;';
        note.textContent = 'Not accounting for gear, fines, or quality chance (but coming soon).';
        const list = document.createElement('div');
        list.textContent = 'Loading…';
        box.append(title, ctBtn, note, list);
        document.body.appendChild(box);
        this._matEl = box;
        this._matAnchor = anchorEl;
        this._reposMat(box, anchorEl);
        requestAnimationFrame(() => { box.style.opacity = '1'; });
        const onDown = (e) => { if (!box.contains(e.target) && e.target !== anchorEl) this._closeMatPopup(); };
        const onKey = (e) => { if (e.key === 'Escape') this._closeMatPopup(); };
        setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
        document.addEventListener('keydown', onKey, true);
        this._matCleanup = () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
        fetch('/api/jobboard/material-breakdown', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: ref, quantity: qty, quality: qWord, use_fine: useFine }),
        }).then((rp) => (rp.ok ? rp.json() : null)).catch(() => null).then((d) => {
            if (this._matEl !== box) return;
            const tree = (d && d.tree) || [];
            const mats = (d && d.materials) || [];
            const line = (m, depth) => {
                const img = m.icon_path ? `<img src="${esc(m.icon_path)}" width="16" height="16" style="image-rendering:pixelated;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none'">` : '';
                const hasCount = m.needed != null;
                const met = (m.owned || 0) >= (m.needed || 0);
                const count = hasCount ? ` <span style="color:${met ? '#66bb6a' : 'var(--text-secondary)'};">(${m.owned || 0}/${m.needed})</span>` : '';
                return `<div style="margin:2px 0;white-space:nowrap;padding-left:${depth * 14}px;">${img}${esc(m.name)}${count}</div>`;
            };
            const walk = (nodes, depth) => nodes.map((n) => line(n, depth) + walk(n.children || [], depth + 1)).join('');
            if (tree.length) {
                list.innerHTML = walk(tree, 0);
            } else if (mats.length) {
                list.innerHTML = mats.map((m) => line(m, 0)).join('');
            } else {
                list.textContent = (d ? 'You have all the materials you need.' : 'Could not load materials.');
            }
            this._reposMat(box, anchorEl);
        });
    }

    _menuName(slug) {
        return (this.nameBySlug && this.nameBySlug[slug])
            || String(slug || '').replace(/[_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    }

    // Load the recipe-output (craftable) list once, mapped by lowercase display
    // name → recipe ref id (e.g. "Material.PINE_PLANK"). Used to (a) decide if an
    // item is craftable and (b) pass the CORRECT id to the crafting tree.
    _ensureCraftable() {
        if (this._craftablePromise) return this._craftablePromise;
        this._craftableByName = {};
        this._craftablePromise = fetch('/api/crafting-tree/items')
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)
            .then((d) => {
                ((d && d.items) || []).forEach((it) => {
                    if (it && it.name && it.item_id) this._craftableByName[String(it.name).toLowerCase()] = it.item_id;
                });
                if (document.body.classList.contains('jobboard-open')) { try { this._renderTable(); } catch (_) {} }
            });
        return this._craftablePromise;
    }

    // JS mirror of util/stats_report/normalize.normalize_item_id (same transform
    // the goals report scopes target-item jobs on) — used to match a job item
    // against the report's fresh/stale target-item rows.
    _normItemId(name) {
        if (!name) return '';
        let s = String(name).toLowerCase().replace(/['\u2019]/g, '').replace(/[ \-/]/g, '_');
        while (s.indexOf('__') !== -1) s = s.split('__').join('_');
        return s.replace(/^_+|_+$/g, '');
    }

    // Lazily load the optimized-goals-report state once: which target items have
    // a result row (present) and which are stale. Drives "Find source" visibility
    // — it only shows when an item is UNRUN or STALE. Fails open (empty sets →
    // button always shows, i.e. today's behaviour) if the report feature is off
    // or the fetch fails.
    _ensureReportState() {
        if (this._reportStatePromise) return this._reportStatePromise;
        this._reportPresent = new Set();
        this._reportStale = new Set();
        this._reportSteps = {};   // normId -> best (min) steps/item or steps/chest
        this._reportStateReady = false;
        const norm = (s) => this._normItemId(s);
        const addSteps = (id, mv) => {
            const n = Number(mv);
            if (!id || !isFinite(n) || n <= 0) return;
            if (this._reportSteps[id] == null || n < this._reportSteps[id]) this._reportSteps[id] = n;
        };
        const flatten = (v, out) => {
            if (!v) return;
            if (Array.isArray(v)) out.push(...v);
            else if (typeof v === 'object') Object.values(v).forEach((x) => flatten(x, out));
        };
        this._reportStatePromise = Promise.all([
            fetch('/api/stats-report/results').then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch('/api/stats-report/stale-check').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]).then(([res, stale]) => {
            try {
                const results = (res && res.results) || {};
                ['target_items', 'chests'].forEach((cat) => {
                    const rows = [];
                    flatten(results[cat], rows);
                    rows.forEach((row) => {
                        if (!row) return;
                        // target_items + chests store the item/chest leaf in the
                        // (overloaded) chest_name column; fall back to older keys.
                        const raw = row.chest_name || row.item_slug || row.slug || row.metric_name || row.name;
                        const id = norm(raw);
                        if (!id) return;
                        this._reportPresent.add(id);
                        addSteps(id, row.metric_value);
                    });
                });
            } catch (_) { /* fail open */ }
            try {
                ((stale && stale.stale_scopes) || []).forEach((sc) => {
                    if (!sc || (sc.category !== 'target_items' && sc.category !== 'chests')) return;
                    [].concat(sc.added_items || [], sc.removed_items || [], sc.item_name || [])
                        .forEach((n) => { const id = norm(n); if (id) this._reportStale.add(id); });
                });
            } catch (_) { /* fail open */ }
            this._reportStateReady = true;
            // Fill the "Steps for you" column now that data is in.
            if (document.body.classList.contains('jobboard-open')) { try { this._renderTable(); } catch (_) {} }
        }).catch(() => { this._reportStateReady = true; });
        return this._reportStatePromise;
    }

    _closeItemMenu() {
        if (this._itemMenuCleanup) { this._itemMenuCleanup(); this._itemMenuCleanup = null; }
        const el = this._itemMenuEl;
        this._itemMenuEl = null;
        this._itemMenuAnchor = null;
        if (el) {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-4px) scale(0.98)';
            setTimeout(() => el.remove(), 150);
        }
    }

    // Per-item action menu opened by clicking an underlined item name. Reuses the
    // app's global hooks: crafting tree (_openCraftingTreeGlobal), trading deep
    // links (_tradingPendingSearch / _tradingPendingCompose), Sources
    // (renderItemSources) and Find source (_statsReportPage.runForTargetItem).
    _openItemMenu(anchorEl, payload) {
        this._closeItemMenu();
        const parts = String(payload || '').split('|');
        const slug = parts[0] || '';
        const quality = parts[1] || '';
        const tag = parts[2] || '';
        const type = parts[3] || '';
        const qty = parseInt(parts[4], 10) || 0;
        const craftId = parts[5] || '';
        const isChest = parts[6] === '1';
        if (!slug) return;
        const name = this._menuName(slug);
        const tradeQuality = (tag === 'fine') ? 'fine' : quality;
        const goTrading = () => { window.location.hash = '#trading'; };

        const menu = document.createElement('div');
        menu.className = 'jb-item-menu';
        menu.style.cssText = 'position:fixed;z-index:100001;min-width:210px;max-width:280px;'
            + 'background:var(--bg-secondary,#1c2128);border:1px solid var(--border-color,#333);'
            + 'border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.55);padding:8px;'
            + 'display:flex;flex-direction:column;gap:4px;transform-origin:top left;'
            + 'opacity:0;transform:translateY(-4px) scale(0.98);transition:opacity .15s ease, transform .15s ease;';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:600;padding:2px 4px 6px;color:' + this._itemColor({ quality, tag })
            + ';border-bottom:1px solid var(--border-color,#333);margin-bottom:4px;';
        title.textContent = qty ? `${name} ×${qty}` : name;
        menu.appendChild(title);

        const mkBtn = (label, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.style.cssText = 'text-align:left;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color,#444);'
                + 'background:var(--bg-tertiary,#2a2f37);color:var(--text-primary,#e8e8e8);cursor:pointer;font-size:13px;transition:background-color .15s ease, filter .15s ease;';
            b.onmouseenter = () => { b.style.filter = 'brightness(1.18)'; };
            b.onmouseleave = () => { b.style.filter = ''; };
            b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
            menu.appendChild(b);
            return b;
        };

        mkBtn('See trade listings', () => {
            this._closeItemMenu();
            window._tradingPendingSearch = { slug, quality: tradeQuality, side: 'selling', minQty: qty };
            goTrading();
        });
        mkBtn('See trade wishlists', () => {
            this._closeItemMenu();
            window._tradingPendingSearch = { slug, quality: tradeQuality, side: 'buying', minQty: qty };
            goTrading();
        });
        mkBtn('Create trade listing', () => {
            this._closeItemMenu();
            window._tradingPendingCompose = { kind: 'listing', slug, quality: tradeQuality, qty };
            goTrading();
        });
        mkBtn('Add to wishlist', () => {
            this._closeItemMenu();
            window._tradingPendingCompose = { kind: 'wishlist', slug, quality: tradeQuality, qty };
            goTrading();
        });

        // Sources — inline slide-down (reuses the shared popover's renderer).
        const srcBox = document.createElement('div');
        srcBox.style.cssText = 'display:none;margin-top:4px;max-height:260px;overflow:auto;';
        let srcLoaded = false;
        mkBtn('Sources', () => {
            const showing = srcBox.style.display !== 'none';
            srcBox.style.display = showing ? 'none' : 'block';
            if (!showing && !srcLoaded) {
                srcLoaded = true;
                try { renderItemSources({ name, slug, quality: tradeQuality }, srcBox); }
                catch (e) { srcBox.textContent = 'Sources unavailable.'; }
            }
            this._positionItemMenu(menu, anchorEl);
        });

        const fs = mkBtn('Find source', () => {
            this._closeItemMenu();
            const sp = window._statsReportPage;
            if (!sp) return;
            if (isChest && typeof sp.runForChest === 'function') sp.runForChest(name);
            else if (typeof sp.runForTargetItem === 'function') sp.runForTargetItem(name);
        });
        // Show "Find source" ONLY when the goals report is unrun or stale AND the
        // item isn't craftable. Chests always show it (separate chest report).
        let _isCraftable = false;
        const applyFs = () => {
            if (_isCraftable) { fs.style.display = 'none'; return; }
            if (isChest) { fs.style.display = ''; return; }
            if (!this._reportStateReady) { fs.style.display = ''; return; }
            const id = this._normItemId(slug);
            const fresh = this._reportPresent.has(id) && !this._reportStale.has(id);
            fs.style.display = fresh ? 'none' : '';
        };
        applyFs();
        this._ensureReportState().then(() => {
            if (this._itemMenuEl === menu) { applyFs(); this._positionItemMenu(menu, anchorEl); }
        });
        // Resolve craftability authoritatively (recipe-output list). If craftable,
        // add "Open in crafting tree" at the top with the correct recipe ref id
        // and hide Find source. Fixes the crafting-tree build error (wrong id).
        this._ensureCraftable().then(() => {
            if (this._itemMenuEl !== menu) return;
            const cid = this._craftableByName && this._craftableByName[name.toLowerCase()];
            if (!cid) return;
            _isCraftable = true;
            applyFs();
            const b = mkBtn('Open in crafting tree', () => {
                this._closeItemMenu();
                this.close();   // dismiss the job board so only the crafting tree is active
                if (typeof window._openCraftingTreeGlobal === 'function') {
                    // Crafting tree expects the DISPLAY word (Normal/Excellent/…),
                    // not the raw token (common/epic/…). Carry quantity + fine too.
                    const qWord = QUALITY_WORD[String(quality || '').toLowerCase()] || undefined;
                    window._openCraftingTreeGlobal(cid, { quality: qWord, quantity: qty || undefined, useFine: tag === 'fine' });
                }
            });
            menu.insertBefore(b, menu.children[1]);   // right after the title
            this._positionItemMenu(menu, anchorEl);
        });
        menu.appendChild(srcBox);

        document.body.appendChild(menu);
        this._itemMenuEl = menu;
        this._itemMenuAnchor = anchorEl;
        this._positionItemMenu(menu, anchorEl);
        requestAnimationFrame(() => { menu.style.opacity = '1'; menu.style.transform = 'none'; });

        const onDocDown = (e) => { if (!menu.contains(e.target) && e.target !== anchorEl) this._closeItemMenu(); };
        const onKey = (e) => { if (e.key === 'Escape') this._closeItemMenu(); };
        setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
        document.addEventListener('keydown', onKey, true);
        this._itemMenuCleanup = () => {
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }

    _positionItemMenu(menu, anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        const mw = menu.offsetWidth || 220;
        const mh = menu.offsetHeight || 200;
        let left = r.left;
        let top = r.bottom + 4;
        if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
        if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    // Per-job "Steps for you": reads the optimized goals report's best-activity
    // steps/item (or steps/chest — metric_value already encodes drop rate + the
    // 4 loot-table rolls) × quantity, summed over goals. States: pending (data
    // not loaded), crafted (any goal craftable → not yet supported), find (no
    // report row), stale (row stale), fresh.
    _stepsState(job) {
        if (!this._reportStateReady) return { state: 'pending' };
        const goals = job.goals || [];
        if (!goals.length) return { state: 'none' };
        let total = 0, anyCraft = false, anyMissing = false, anyStale = false, first = null;
        for (const g of goals) {
            const it = g.item || {};
            const slug = it.slug || '';
            const name = this._menuName(slug);
            const isFine = this._isFine(it);
            const displayName = isFine ? `${name} (Fine)` : name;
            const qty = g.quantity || 0;
            if (this._craftableByName && this._craftableByName[name.toLowerCase()]) {
                if (!first) first = { name: displayName, isChest: !!it.is_chest };
                anyCraft = true; break;
            }
            // Direct row: material/finding/currency farmed from an activity.
            // Fine goals resolve to the "<item> (Fine)" row (base slug + "_(fine)").
            let id = this._normItemId(slug);
            if (isFine) id += '_(fine)';
            const direct = (this._reportPresent && this._reportPresent.has(id)) ? this._reportSteps[id] : undefined;
            if (direct != null) {
                if (!first) first = { name: displayName, isChest: !!it.is_chest };
                if (this._reportStale && this._reportStale.has(id)) anyStale = true;
                total += Math.ceil(direct) * qty;   // ceil per item to match the report display
                continue;
            }
            // No direct row — the item only drops from a CHEST. Steps/item =
            // steps-per-chest (Best Chest Farming for Activities) × expected
            // chests to get one (server resolves chest + expected_chests).
            const sources = it.chest_sources || [];
            let bestChest = Infinity, bestChestName = null;
            for (const cs of sources) {
                const cid = this._normItemId(cs.chest);
                if (this._reportPresent && this._reportPresent.has(cid) && this._reportSteps[cid] != null) {
                    const v = this._reportSteps[cid] * (cs.expected_chests || 0);
                    if (v < bestChest) { bestChest = v; bestChestName = cs.chest; }
                }
            }
            if (isFinite(bestChest)) {
                if (!first) first = { name: bestChestName, isChest: true };
                total += Math.ceil(bestChest) * qty;
                continue;
            }
            // Missing. Chest-sourced items need the CHEST activities report run,
            // so Find targets the chest (isChest → runForChest).
            if (!first) first = sources.length
                ? { name: sources[0].chest, isChest: true }
                : { name: displayName, isChest: !!it.is_chest };
            anyMissing = true;
        }
        if (anyCraft) return { state: 'crafted', first };
        if (anyMissing) return { state: 'find', first };
        if (anyStale) return { state: 'stale', total, first };
        return { state: 'fresh', total, first };
    }

    _stepsCell(job) {
        const s = this._stepsState(job);
        const f = s.first || { name: '', isChest: false };
        const dataAttr = `data-jb-steps="${esc(f.name)}" data-jb-steps-chest="${f.isChest ? '1' : '0'}"`;
        const numHtml = (n) => `<span class="jb-steps-link" role="button" tabindex="0" ${dataAttr} title="Open the #1 activity for this in the goals report" style="text-decoration:underline;cursor:pointer;color:var(--accent-primary,#4a9eff);font-weight:600;">${Math.round(n).toLocaleString()}</span>`;
        const btn = (cls, label) => `<button class="${cls}" ${dataAttr} style="padding:3px 8px;border-radius:5px;border:1px solid var(--border-color);background:var(--bg-tertiary);color:var(--text-primary);cursor:pointer;font-size:11px;">${label}</button>`;
        switch (s.state) {
            case 'pending': return '<span style="color:var(--text-secondary);">…</span>';
            case 'crafted': return '<span title="Crafted item — coming soon" style="color:var(--text-secondary);cursor:help;">—</span>';
            case 'find': return btn('jb-steps-find', 'Find');
            case 'stale': return `${numHtml(s.total)} <span class="travel-info-icon" data-info="This figure is stale — your character changed since it was computed. Rerun to refresh." style="font-style:normal;">ⓘ</span> ${btn('jb-steps-rerun', 'Rerun')}`;
            case 'fresh': return numHtml(s.total);
            default: return '<span style="color:var(--text-secondary);">—</span>';
        }
    }

    // Fail-safe wrapper: one bad row must degrade to a single placeholder row,
    // never abort the whole table build (which blanks the board).
    _rowHtml(j) {
        try { return this._rowHtmlInner(j); }
        catch (e) {
            if (!this._warnedRow) { this._warnedRow = true; console.warn('[jobboard] row render threw; placeholder shown', (j && j.id), e); }
            return '<tr data-job-id="' + esc(String((j && j.id) || '')) + '"><td colspan="6" style="padding:6px 8px;color:var(--text-secondary);">(could not render this job)</td></tr>';
        }
    }

    _rowHtmlInner(j) {
        const facIcons = j.factions.map((f) => `<img src="${esc(f.icon)}" title="${esc(f.name)}" width="16" height="16" style="image-rendering:pixelated;" onerror="this.style.visibility='hidden'">`).join('');
        const tierColor = TIER_COLOR[j.tier.key] || 'var(--text-secondary)';
        const bonus = j.bonus ? ' <span title="Bonus job (asks and pays more)" style="color:#ffc825;">★</span>' : '';
        // Only show the board name when it names a genuinely different place than
        // the location (e.g. Herbert's / Disenchanted Forest). "<Location> combined
        // job board" is the same place — don't show a subtitle.
        const boardBase = String(j.board_name).replace(/ (combined )?job board$/i, '');
        const boardSub = boardBase.toLowerCase() === String(j.location).toLowerCase()
            ? '' : `<div style="color:var(--text-secondary);font-size:.8em;">${esc(j.board_name)}</div>`;
        const st = this._jobStatus(j.id);
        // Row status styling is applied after render by _applyRowTint (the
        // planned blue outline must be drawn on the CELLS, not the <tr>, to
        // render on mobile Safari). Keep only completed's background inline so
        // it paints on first render without a flash.
        const tint = st === 'completed'
            ? 'background:rgba(46,125,79,0.22);font-style:italic;opacity:0.7;'
            : '';
        return `
            <tr data-job-id="${esc(String(j.id))}" style="border-bottom:1px solid var(--border-color);vertical-align:top;transition:background-color .25s ease, box-shadow .25s ease, opacity .25s ease;${tint}">
              <td style="padding:6px 8px;"><div style="display:flex;align-items:center;gap:5px;">${facIcons}<strong>${esc(j.location)}</strong></div>${boardSub}</td>
              <td style="padding:6px 8px;"><span style="color:${tierColor};font-weight:600;">${esc(j.tier.label)}</span>${bonus}</td>
              <td style="padding:6px 8px;">${j.goals.map((g) => this._goalHtml(g, (this._ineffMap || {})[j.id], j.id)).join('')}</td>
              <td style="padding:6px 8px;">${this._rewardsHtml(j)}</td>
              <td style="padding:6px 8px;white-space:nowrap;">${this._stepsCell(j)}</td>
              <td data-status-cell style="padding:6px 8px;min-width:112px;">${this._statusCellInner(j)}</td>
            </tr>`;
    }
}

window.JobBoardPage = JobBoardPage;
