/**
 * goals-report-add-to-tracker.js — Phase 4 of the Item Upgrades Tracker.
 *
 * Injects an "Add all to upgrades tracker" control into the Optimized Goals
 * Report's `new_items` section header (category) and each kind sub-header
 * (gear / tools / eggs / collectibles). Clicking offers "Add to current" or
 * "Add to existing" (a saved tracker). FAC-gated: nothing renders unless
 * window._featureFlags.upgrades_tracker is true (R1 / R23).
 *
 * Entries are built from the page's in-memory `this._results.new_items` rows
 * (each row carries metric_value = fastest-to-obtain steps, skill_name = kind,
 * metric_name = item name, metrics_json.best_drop.item_ref). Collectibles are
 * farming-only per OQ-10 (no total-steps-saved / net) — that falls out
 * naturally since we only populate steps_to_obtain here.
 */

import api from '../api.js';
import { entryKey } from './upgrades-tracker-add-popup.js';
import { resolveItemIcon } from '../utils/resolve-item-icon.js';

function _sessionUuid() {
    try { return (window.store && window.store.state && window.store.state.session && window.store.state.session.uuid) || null; }
    catch (_) { return null; }
}
function _norm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Build a goals_report_target entry from a new_items result row.
function _entryFromRow(row) {
    const mj = row.metrics_json || row.metricsJson || {};
    const kind = (row.skill_name || (mj.best_drop && mj.best_drop.kind) || 'gear').toLowerCase();
    const name = row.metric_name || (mj.best_drop && mj.best_drop.item_name) || (mj.item_name);
    if (!name) return null;
    const ref = (mj.best_drop && mj.best_drop.item_ref) || '';
    const slug = _norm(ref || name);
    const steps = (row.metric_value != null) ? Number(row.metric_value)
        : (mj.combined && mj.combined.best_steps != null ? Number(mj.combined.best_steps) : null);
    const icon = row.icon_path || mj.icon_path || `/assets/icons/items/equipment/${slug}.svg`;
    return {
        entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
        type: 'goals_report_target',
        source_ref: { item_slug: slug, item_name: name, category: 'new_items', subtype: kind },
        display: { name, icon_path: icon, optimization_target: 'Fastest new item ▸ ' + _cap(kind) },
        upgrades: [{
            name, uuid: slug, quality: null, icon_path: icon,
            how_to_obtain: { kind: 'activity', label: 'Activity drop' },
            steps_to_obtain: steps, total_steps_saved: null,
        }],
    };
}

// Build one entry per item for a combined/grouped new_items row (e.g. "4 new
// collectibles" for one activity). Falls back to the single best-drop entry
// when the row isn't actually a multi-item group.
function _entriesFromRowAllItems(row) {
    let mj = row.metrics_json || row.metricsJson || {};
    if (typeof mj === 'string') { try { mj = JSON.parse(mj || '{}'); } catch (_) { mj = {}; } }
    const nc = mj.new_items_combined || {};
    const items = Array.isArray(nc.items) ? nc.items : [];
    if (items.length < 2) { const e = _entryFromRow(row); return e ? [e] : []; }
    const kind = (nc.kind || row.skill_name || 'collectibles').toLowerCase();
    const out = [];
    for (const it of items) {
        const name = it.item_name || '';
        if (!name) continue;
        const ref = it.item_ref || '';
        const slug = _norm(ref || name);
        const steps = (it.steps != null && Number(it.steps) > 0) ? Number(it.steps) : null;
        const icon = resolveItemIcon({ itemRef: ref, itemName: name }) || `/assets/icons/items/equipment/${slug}.svg`;
        out.push({
            entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
            type: 'goals_report_target',
            source_ref: { item_slug: slug, item_name: name, category: 'new_items', subtype: kind },
            display: { name, icon_path: icon, optimization_target: 'Fastest new item ▸ ' + _cap(kind) },
            upgrades: [{
                name, uuid: slug, quality: null, icon_path: icon,
                how_to_obtain: { kind: 'activity', label: 'Activity drop' },
                steps_to_obtain: steps, total_steps_saved: null,
            }],
        });
    }
    return out;
}

// Collect entries for a scope: the whole new_items category, or one kind.
function _collectEntries(page, kind) {
    const rows = (page && page._results && page._results.new_items) || [];
    const out = [];
    const seen = new Set();
    for (const row of rows) {
        if (kind && String(row.skill_name || '').toLowerCase() !== kind) continue;
        const e = _entryFromRow(row);
        if (!e) continue;
        const k = entryKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
    }
    return out;
}

// Dedup-append entries into an existing list (by entryKey). Returns added count.
function _mergeEntries(existing, incoming) {
    const keys = new Set(existing.map(entryKey));
    let added = 0;
    for (const e of incoming) {
        const k = entryKey(e);
        if (keys.has(k)) continue;
        keys.add(k); existing.push(e); added++;
    }
    return added;
}

async function _addToCurrent(entries) {
    const uuid = _sessionUuid();
    if (!uuid) return;
    // Prefer the live page instance so the add is undoable when the tracker is
    // open; otherwise append server-side without clobbering existing entries.
    const page = window._upgradesTrackerPage;
    if (page && typeof page.isOpen === 'function' && page.isOpen() && typeof page._addEntries === 'function') {
        page._addEntries(entries);
        api.showSuccess?.(`Added ${entries.length} to the current tracker.`);
        return;
    }
    try {
        const cur = await Promise.resolve(api.getUpgradesTrackerWorking(uuid));
        const list = (cur && cur.entries) || [];
        const added = _mergeEntries(list, entries);
        await Promise.resolve(api.saveUpgradesTrackerWorking(uuid, list));
        if (page && typeof page._loadWorking === 'function') page._loadWorking();
        api.showSuccess?.(added ? `Added ${added} to the current tracker.` : 'Already in the current tracker.');
    } catch (_) { api.showError?.('Failed to add to the current tracker.'); }
}

async function _addToExisting(entries, trackerId) {
    const uuid = _sessionUuid();
    if (!uuid) return;
    try {
        const loaded = await Promise.resolve(api.loadUpgradesTracker(trackerId, uuid));
        const list = (loaded && loaded.entries) || [];
        const added = _mergeEntries(list, entries);
        await Promise.resolve(api.saveUpgradesTracker(uuid, loaded.name, list, trackerId));
        api.showSuccess?.(added ? `Added ${added} to “${loaded.name}”.` : `Already in “${loaded.name}”.`);
    } catch (_) { api.showError?.('Failed to add to the selected tracker.'); }
}

// Small inline popup anchored to the clicked button.
function _openMiniPopup(btn, entries) {
    document.querySelectorAll('.iut-addall-pop').forEach(p => p.remove());
    if (!entries.length) { api.showInfo?.('No items to add in this section.'); return; }
    const pop = document.createElement('div');
    pop.className = 'iut-addall-pop';
    pop.innerHTML = `
        <div class="iut-addall-row" data-act="current">Add to current</div>
        <div class="iut-addall-row" data-act="existing">Add to existing…</div>
        <div class="iut-addall-existing">
            <input type="text" class="iut-addall-search" placeholder="Search saved trackers…">
            <div class="iut-addall-list"><div class="iut-addall-empty">Loading…</div></div>
        </div>`;
    _injectStyles();
    const r = btn.getBoundingClientRect();
    pop.style.top = Math.round(window.scrollY + r.bottom + 4) + 'px';
    pop.style.left = Math.round(window.scrollX + Math.min(r.left, window.innerWidth - 280)) + 'px';
    document.body.appendChild(pop);

    let savedTrackers = [];
    const listEl = pop.querySelector('.iut-addall-list');
    const renderList = (q) => {
        const f = savedTrackers.filter(t => !q || (t.name || '').toLowerCase().includes(q));
        if (!savedTrackers.length) { listEl.innerHTML = `<div class="iut-addall-empty">No saved trackers.</div>`; return; }
        listEl.innerHTML = f.length
            ? f.map(t => `<div class="iut-addall-titem" data-id="${_esc(t.id)}">${_esc(t.name)} <span class="iut-addall-count">${t.entry_count ?? ''}</span></div>`).join('')
            : `<div class="iut-addall-empty">No matches.</div>`;
    };

    pop.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-act]');
        if (row) {
            const act = row.getAttribute('data-act');
            if (act === 'current') { pop.remove(); _addToCurrent(entries); return; }
            if (act === 'existing') {
                pop.querySelector('.iut-addall-existing').classList.add('open');
                const uuid = _sessionUuid();
                try {
                    const d = await Promise.resolve(api.listUpgradesTrackers(uuid));
                    savedTrackers = (d && d.trackers) || [];
                } catch (_) { savedTrackers = []; }
                renderList('');
                return;
            }
        }
        const titem = e.target.closest('.iut-addall-titem');
        if (titem) { const id = titem.getAttribute('data-id'); pop.remove(); _addToExisting(entries, id); }
    });
    pop.addEventListener('input', (e) => {
        if (e.target.matches('.iut-addall-search')) renderList(e.target.value.toLowerCase());
    });
    // Dismiss on outside click.
    setTimeout(() => {
        const off = (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener('click', off); } };
        document.addEventListener('click', off);
    }, 0);
}

let _wired = false;
let _currentKeys = new Set();

// Settings → UI → Upgrades Tracker toggle.
function _alwaysAddOn() {
    try { return localStorage.getItem('alwaysAddToCurrentTracker') === 'true'; } catch (_) { return false; }
}

// Fetch the current (working) tracker's entry keys so per-item add buttons can
// hide for items already tracked. Only meaningful in always-add mode.
async function _refreshCurrentKeys() {
    const uuid = _sessionUuid();
    if (!uuid) return;
    try {
        const cur = await Promise.resolve(api.getUpgradesTrackerWorking(uuid));
        const list = (cur && cur.entries) || [];
        _currentKeys = new Set(list.map(entryKey));
        _applyMembershipHiding();
    } catch (_) { /* non-fatal */ }
}

// Hide the single-item "+ Upgrades Tracker" button when its item is already in
// the current tracker; show everything otherwise. Only hides in always-add mode.
function _applyMembershipHiding() {
    const on = _alwaysAddOn();
    document.querySelectorAll('.iut-row-additem-btn[data-iut-all="0"]').forEach(btn => {
        if (!on) { btn.style.display = ''; return; }
        const k = btn.getAttribute('data-iut-key') || '';
        btn.style.display = (k && _currentKeys.has(k)) ? 'none' : '';
    });
}

// Add straight to the current tracker (no popup), then refresh membership.
async function _directAdd(entries) {
    await _addToCurrent(entries);
    for (const e of entries) { try { _currentKeys.add(entryKey(e)); } catch (_) {} }
    _applyMembershipHiding();
}

export function injectGoalsReportAddToTracker($bodyEl, page) {
    try {
        if (!window._featureFlags || !window._featureFlags.upgrades_tracker) return;
        const body = $bodyEl && $bodyEl[0] ? $bodyEl[0] : $bodyEl;
        if (!body) return;
        const section = body.querySelector('.stats-report-section[data-section="new_items"]');
        if (!section) return;
        _injectStyles();

        // Category-level control — at the TOP of the collapsible body, before the
        // kind groups (not in the header, per UX).
        const secBody = section.querySelector('.stats-report-section-body');
        if (secBody && !secBody.querySelector(':scope > .iut-addall-wrap')) {
            secBody.insertAdjacentHTML('afterbegin', _btnRowHtml('category', ''));
        }
        // Per-kind controls — at the top of each kind's body, before its targets.
        section.querySelectorAll('.stats-report-skill-group[data-section="new_items"]').forEach(grp => {
            const kind = (grp.getAttribute('data-skill-group') || '').toLowerCase();
            const kbody = grp.querySelector('.stats-report-skill-body');
            if (kbody && kind && !kbody.querySelector(':scope > .iut-addall-wrap')) {
                kbody.insertAdjacentHTML('afterbegin', _btnRowHtml('kind', kind));
            }
        });
        // Per-row control — inline with each new-item row's buttons. Single-item
        // rows carry a Hide button (anchor before it); combined/grouped rows
        // ("N new collectibles" for one activity) have no Hide button, so we
        // anchor off the button row and add an "all items" variant instead.
        const p0 = window._statsReportPage || page;
        const niRows = (p0 && p0._results && p0._results.new_items) || [];
        section.querySelectorAll('.stats-report-metric-row').forEach(mrow => {
            if (mrow.querySelector('.iut-row-additem-btn')) return;
            const hideBtn = mrow.querySelector('.stats-report-hide-new-item-btn');
            if (hideBtn) {
                const ref = hideBtn.getAttribute('data-item-ref') || '';
                const name = hideBtn.getAttribute('data-item-name') || '';
                const rid = hideBtn.getAttribute('data-result-id') || '';
                let key = '';
                const srow = niRows.find(r => String(r.id) === String(rid));
                if (srow) { const en = _entryFromRow(srow); if (en) key = entryKey(en); }
                hideBtn.insertAdjacentHTML('beforebegin', _rowBtnHtml(ref, name, rid, false, key));
                return;
            }
            // No Hide button: only inject on genuine multi-item combined rows.
            const idEl = mrow.querySelector('[data-result-id]');
            if (!idEl) return;
            const rid = idEl.getAttribute('data-result-id');
            const row = niRows.find(r => String(r.id) === String(rid));
            if (!row) return;
            let mj = row.metrics_json || row.metricsJson || {};
            if (typeof mj === 'string') { try { mj = JSON.parse(mj || '{}'); } catch (_) { mj = {}; } }
            const nc = mj.new_items_combined;
            if (!(nc && Number(nc.count) > 1 && Array.isArray(nc.items) && nc.items.length > 1)) return;
            mrow.insertAdjacentHTML('beforeend', _rowBtnHtml('', '', rid, true));
        });

        // Always-add mode: hide per-item buttons for already-tracked items, and
        // refresh membership from the current tracker (async).
        if (_alwaysAddOn()) { _applyMembershipHiding(); _refreshCurrentKeys(); }

        if (!_wired) {
            _wired = true;
            document.addEventListener('click', (e) => {
                // Per-item / per-group add.
                const rowBtn = e.target.closest('.iut-row-additem-btn');
                if (rowBtn) {
                    e.preventDefault(); e.stopPropagation();
                    const p = window._statsReportPage || page;
                    const resultId = rowBtn.getAttribute('data-result-id');
                    const isAll = rowBtn.getAttribute('data-iut-all') === '1';
                    const rows = (p && p._results && p._results.new_items) || [];
                    const row = rows.find(r => String(r.id) === String(resultId));
                    let entries = [];
                    if (row) {
                        entries = isAll ? _entriesFromRowAllItems(row)
                                        : (() => { const e1 = _entryFromRow(row); return e1 ? [e1] : []; })();
                    }
                    if (!entries.length) {
                        const name = rowBtn.getAttribute('data-item-name') || '';
                        const ref = rowBtn.getAttribute('data-item-ref') || '';
                        const slug = _norm(ref || name);
                        if (slug) entries = [{
                            entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
                            type: 'goals_report_target',
                            source_ref: { item_slug: slug, item_name: name, category: 'new_items', subtype: 'gear' },
                            display: { name, icon_path: `/assets/icons/items/equipment/${slug}.svg`, optimization_target: 'Fastest new item ▸ Gear' },
                            upgrades: [],
                        }];
                    }
                    if (_alwaysAddOn()) { _directAdd(entries); }
                    else { _openMiniPopup(rowBtn, entries); }
                    return;
                }
                // Category / kind add (many rows).
                const btn = e.target.closest('.iut-addall-btn');
                if (!btn) return;
                e.preventDefault(); e.stopPropagation();  // don't toggle the header collapse
                const scope = btn.getAttribute('data-iut-scope');
                const kind = scope === 'kind' ? btn.getAttribute('data-iut-kind') : null;
                const entries = _collectEntries(window._statsReportPage || page, kind);
                if (_alwaysAddOn()) { _directAdd(entries); }
                else { _openMiniPopup(btn, entries); }
            }, true);

            // React live when the setting is toggled in Settings → UI.
            window.addEventListener('alwaysAddToCurrentTrackerChanged', () => {
                if (_alwaysAddOn()) { _refreshCurrentKeys(); }
                else { document.querySelectorAll('.iut-row-additem-btn').forEach(b => { b.style.display = ''; }); }
            });
        }
    } catch (err) { console.warn('[iut] add-to-tracker inject failed:', err); }
}

function _btnRowHtml(scope, kind) {
    return `<div class="iut-addall-wrap"><button class="button button-secondary iut-addall-btn" data-iut-scope="${scope}" data-iut-kind="${_esc(kind)}"
        title="Add ${scope === 'kind' ? _esc(kind) + ' items' : 'all new items'} to the Item Upgrades Tracker">+ Add to upgrades tracker</button></div>`;
}

function _rowBtnHtml(ref, name, rid, all, key) {
    const label = all ? '+ Add all to upgrades tracker' : '+ Upgrades Tracker';
    const title = all
        ? 'Add all items from this activity to the Item Upgrades Tracker'
        : 'Add this item to the Item Upgrades Tracker';
    return `<button class="button button-secondary iut-row-additem-btn"
        data-item-ref="${_esc(ref)}" data-item-name="${_esc(name)}" data-result-id="${_esc(rid)}" data-iut-all="${all ? '1' : '0'}" data-iut-key="${_esc(key || '')}"
        title="${title}"
        style="font-size:0.9em;padding:6px 12px;display:inline-flex;align-items:center;gap:5px">${label}</button>`;
}

function _injectStyles() {
    if (document.getElementById('iut-addall-styles')) return;
    const css = `
    /* Shared green for all tracker add buttons (single var, easy to retune). */
    .iut-addall-btn, .iut-row-additem-btn { --iut-add-green:#2fa347; --iut-add-green-hover:#41c25e; }
    .iut-addall-wrap { display:flex; justify-content:center; padding:6px 4px 10px; }
    .iut-addall-btn { background:var(--iut-add-green) !important; border-color:var(--iut-add-green) !important; color:#fff !important;
        font-size:0.82em; padding:5px 12px; line-height:1.2; }
    .iut-addall-btn:hover { background:var(--iut-add-green-hover) !important; border-color:var(--iut-add-green-hover) !important; }
    .iut-row-additem-btn { background:var(--iut-add-green) !important; border-color:var(--iut-add-green) !important; color:#fff !important; }
    .iut-row-additem-btn:hover { background:var(--iut-add-green-hover) !important; border-color:var(--iut-add-green-hover) !important; }
    .iut-addall-pop { position:absolute; z-index:1300; min-width:220px; background:var(--bg-primary,#14161c);
        border:1px solid var(--border-color,#2a2e39); border-radius:8px; padding:6px; box-shadow:0 6px 20px rgba(0,0,0,0.4);
        transform-origin: top left; animation: iutAddallSlide 0.16s ease-out; }
    @keyframes iutAddallSlide { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
    .iut-addall-row { padding:7px 10px; border-radius:6px; cursor:pointer; color:var(--text-primary,#fff);
        font-size:max(var(--min-text,5px), calc(13px * var(--text-scale,1))); }
    .iut-addall-row:hover { background:var(--bg-secondary,#1d2028); }
    /* Collapsed by default; slides open when .open is added. */
    .iut-addall-existing { max-height:0; opacity:0; overflow:hidden; margin-top:0; border-top:0 solid var(--border-color,#23262f);
        transition: max-height 0.2s ease, opacity 0.2s ease, margin-top 0.2s ease, padding-top 0.2s ease; padding-top:0; }
    .iut-addall-existing.open { max-height:260px; opacity:1; margin-top:6px; border-top-width:1px; padding-top:6px; }
    .iut-addall-search { width:100%; box-sizing:border-box; padding:6px 8px; border-radius:6px;
        border:1px solid var(--border-color,#2a2e39); background:var(--bg-secondary,#1d2028); color:var(--text-primary,#fff); margin-bottom:6px; }
    .iut-addall-list { max-height:180px; overflow-y:auto; }
    .iut-addall-titem { padding:6px 8px; border-radius:6px; cursor:pointer; color:var(--text-primary,#fff); display:flex; justify-content:space-between; gap:8px; }
    .iut-addall-titem:hover { background:var(--bg-secondary,#1d2028); }
    .iut-addall-count { color:var(--text-secondary,#9aa0ac); }
    .iut-addall-empty { color:var(--text-secondary,#9aa0ac); padding:6px 8px; font-size:0.9em; }
    `;
    const s = document.createElement('style'); s.id = 'iut-addall-styles'; s.textContent = css; document.head.appendChild(s);
}
