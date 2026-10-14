/**
 * upgrades-tracker-add-popup.js — the "Add gear sets" source picker for the
 * Item Upgrades Tracker (spec .kiro/specs/item-upgrades-tracker/, Phase 1).
 *
 * A modal popup with three collapsible sections, each with its own search box
 * and one checkbox per candidate:
 *   - Optimized Goals Report  → Fastest new item activities (gear)
 *   - Crafting Tree           → saved crafting trees
 *   - Gear Sets               → saved gear sets (optimized-once only, OQ-2)
 * X (close) at the top, Cancel / Select at the bottom. On Select, calls
 * onSelect(entries[]) with new entry objects (deduped against existingKeys).
 *
 * Self-contained: injects its own styles, no styles.css dependency.
 */

import { resolveItemIcon } from '../utils/resolve-item-icon.js';

const ICON = '/assets/icons/keywords/upgradeable.svg';

// New-item kind grouping (matches the goals report's Gear/Tools/Eggs/Collectibles).
const _KIND_ORDER = ['gear', 'tools', 'eggs', 'collectibles', 'other'];
const _KIND_LABEL = { gear: 'Gear', tools: 'Tools', eggs: 'Eggs', collectibles: 'Collectibles', other: 'Other' };
function _normKind(k) {
    k = String(k || '').toLowerCase();
    if (k.startsWith('gear')) return 'gear';
    if (k.startsWith('tool')) return 'tools';
    if (k.startsWith('egg')) return 'eggs';
    if (k.startsWith('collect')) return 'collectibles';
    return 'other';
}

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _sessionUuid() {
    try { return (window.store && window.store.state && window.store.state.session && window.store.state.session.uuid) || null; }
    catch (_) { return null; }
}
async function _json(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}

// Stable identity for an entry, used to dedup against what's already tracked.
export function entryKey(entry) {
    const ref = entry.source_ref || {};
    if (entry.type === 'crafting_tree') return 'tree:' + (ref.tree_id || '');
    if (entry.type === 'gear_set') return 'gs:' + (ref.gearset_id || '');
    // goals_report_target
    return 'grt:' + (ref.item_slug || ref.item_name || entry.display?.name || '');
}

// Walk the (loosely-typed) stats-report new_items results into flat candidates.
function _newItemCandidates(results) {
    const out = [];
    const seen = new Set();
    const ni = results && results.new_items;
    if (!ni) return out;
    const rows = Array.isArray(ni) ? ni : Object.values(ni);
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const mj = row.metrics_json || row.metricsJson || {};
        const name = row.item_name || mj.item_name || row.metric_name || (mj.best_drop && mj.best_drop.item_name);
        if (!name) continue;
        const slug = row.item_slug || mj.item_slug || String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (seen.has(slug)) continue;
        seen.add(slug);
        // Resolve the icon from the typed item_ref (Collectible./Egg./Consumable.
        // → correct folder) rather than assuming everything is equipment/.
        const ref = (mj.best_drop && mj.best_drop.item_ref) || row.item_ref || mj.item_ref || '';
        const icon = resolveItemIcon({ itemRef: ref, itemName: String(name), fallback: row.icon_path || mj.icon_path || '' });
        const kind = _normKind((mj.best_drop && mj.best_drop.kind) || (mj.new_items_combined && mj.new_items_combined.kind) || row.skill_name);
        out.push({
            name: String(name),
            slug,
            kind,
            icon_path: icon,
            optimization_target: row.metric_name && row.metric_name !== name ? row.metric_name : 'Fastest to obtain',
        });
    }
    return out;
}

export function openUpgradesTrackerAddPopup(opts) {
    const existingKeys = new Set(opts.existingKeys || []);
    const onSelect = opts.onSelect || (() => {});
    _injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'iut-picker-overlay';
    overlay.innerHTML = `
        <div class="iut-picker" role="dialog" aria-label="Add to Item Upgrades Tracker">
            <div class="iut-picker-head">
                <img src="${ICON}" width="22" height="22" alt="">
                <h3>Add to Tracked Upgrades</h3>
                <button class="iut-picker-x" data-act="cancel" aria-label="Close">✕</button>
            </div>
            <div class="iut-picker-body">
                ${_sectionHtml('goals', 'Optimized Goals Report')}
                ${_sectionHtml('tree', 'Crafting Tree')}
                ${_sectionHtml('gearset', 'Gear Sets')}
            </div>
            <div class="iut-picker-foot">
                <span class="iut-picker-count">0 selected</span>
                <div class="iut-picker-actions">
                    <button class="iut-btn" data-act="cancel">Cancel</button>
                    <button class="iut-btn iut-btn-primary" data-act="select">Select</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const state = { goals: [], tree: [], gearset: [], checked: new Set() };

    let _closing = false;
    function close() {
        if (_closing) return;
        _closing = true;
        overlay.classList.add('closing');
        setTimeout(() => overlay.remove(), 180);
    }
    function updateCount() {
        overlay.querySelector('.iut-picker-count').textContent = `${state.checked.size} selected`;
    }

    function renderSection(kind, candidates, emptyMsg) {
        const listEl = overlay.querySelector(`.iut-picker-list[data-kind="${kind}"]`);
        const search = (overlay.querySelector(`.iut-picker-search[data-kind="${kind}"]`)?.value || '').toLowerCase();
        const filtered = candidates.filter(c => !search || c.name.toLowerCase().includes(search));
        if (!candidates.length) { listEl.innerHTML = `<div class="iut-picker-empty">${_esc(emptyMsg)}</div>`; return; }
        if (!filtered.length) { listEl.innerHTML = `<div class="iut-picker-empty">No matches.</div>`; return; }
        listEl.innerHTML = filtered.map(c => {
            const key = c._key;
            const already = existingKeys.has(key);
            const checked = state.checked.has(key) || already;
            const sub = c.subtitle ? `<span class="iut-cand-sub">${_esc(c.subtitle)}</span>` : '';
            return `<label class="iut-cand ${already ? 'iut-cand-already' : ''}">
                <input type="checkbox" data-key="${_esc(key)}" ${checked ? 'checked' : ''} ${already ? 'disabled' : ''}>
                ${c.icon_path ? `<img src="${_esc(c.icon_path)}" width="20" height="20" alt="" onerror="this.style.display='none'">` : ''}
                <span class="iut-cand-name">${_esc(c.name)}</span>${sub}
                ${already ? '<span class="iut-cand-tag">already tracked</span>' : ''}
            </label>`;
        }).join('');
    }

    // Render the Optimized Goals Report section as collapsible kind sub-groups
    // (Gear / Tools / Eggs / Collectibles), each with an "add all" checkbox.
    function renderGoalsGrouped() {
        const listEl = overlay.querySelector('.iut-picker-list[data-kind="goals"]');
        if (!listEl) return;
        const search = (overlay.querySelector('.iut-picker-search[data-kind="goals"]')?.value || '').toLowerCase();
        if (!state.goals.length) { listEl.innerHTML = `<div class="iut-picker-empty">No results yet — run the Optimized Goals Report first.</div>`; return; }
        const cands = state.goals.filter(c => !search || c.name.toLowerCase().includes(search));
        if (!cands.length) { listEl.innerHTML = `<div class="iut-picker-empty">No matches.</div>`; return; }
        const groups = new Map();
        for (const c of cands) { const k = c.kind || 'other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
        const order = _KIND_ORDER.filter(k => groups.has(k));
        const groupsHtml = order.map(k => {
            const items = groups.get(k);
            const rows = items.map(c => {
                const key = c._key;
                const already = existingKeys.has(key);
                const checked = state.checked.has(key) || already;
                const sub = c.subtitle ? `<span class="iut-cand-sub">${_esc(c.subtitle)}</span>` : '';
                return `<label class="iut-cand ${already ? 'iut-cand-already' : ''}">
                    <input type="checkbox" data-key="${_esc(key)}" ${checked ? 'checked' : ''} ${already ? 'disabled' : ''}>
                    ${c.icon_path ? `<img src="${_esc(c.icon_path)}" width="20" height="20" alt="" onerror="this.style.display='none'">` : ''}
                    <span class="iut-cand-name">${_esc(c.name)}</span>${sub}
                    ${already ? '<span class="iut-cand-tag">already tracked</span>' : ''}
                </label>`;
            }).join('');
            return `<div class="iut-picker-subgroup" data-group="${k}">
                <div class="iut-picker-subhead">
                    <label class="iut-picker-addall" title="Select all in this group"><input type="checkbox" class="iut-picker-addall-cb" data-group="${k}"></label>
                    <span class="iut-picker-subarrow">▼</span>
                    <span class="iut-picker-subtitle">${_esc(_KIND_LABEL[k] || 'Other')} <span class="iut-picker-subcount">(${items.length})</span></span>
                </div>
                <div class="iut-picker-subbody">${rows}</div>
            </div>`;
        }).join('');
        listEl.innerHTML = `<div class="iut-picker-subsection-label">Fastest New Item Activities</div>${groupsHtml}`;
        _syncAddAll();
    }

    // Reflect each group's "add all" checkbox from its item checkboxes.
    function _syncAddAll() {
        overlay.querySelectorAll('.iut-picker-subgroup').forEach(sg => {
            const cbs = [...sg.querySelectorAll('.iut-cand input[type=checkbox]:not(:disabled)')];
            const addcb = sg.querySelector('.iut-picker-addall-cb');
            if (addcb) addcb.checked = cbs.length > 0 && cbs.every(cb => cb.checked);
        });
    }

    // Build entry objects for the currently-checked candidates.
    function selectedEntries() {
        const all = [...state.goals, ...state.tree, ...state.gearset];
        const byKey = new Map(all.map(c => [c._key, c]));
        const out = [];
        for (const key of state.checked) {
            const c = byKey.get(key);
            if (!c || existingKeys.has(key)) continue;
            out.push(c._entry());
        }
        return out;
    }

    overlay.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.getAttribute('data-act');
        if (act === 'cancel') { close(); return; }
        if (act === 'select') { const entries = selectedEntries(); close(); onSelect(entries); return; }
        if (e.target === overlay) { close(); return; }
        // Sub-group collapse (slide) — ignore clicks on the add-all checkbox/label.
        const subhead = e.target.closest('.iut-picker-subhead');
        if (subhead && !e.target.closest('.iut-picker-addall')) {
            const sg = subhead.closest('.iut-picker-subgroup');
            const body = sg && sg.querySelector('.iut-picker-subbody');
            if (body) {
                const $ = window.$ || window.jQuery;
                if ($) $(body).stop(true, true).slideToggle(150); else body.style.display = (body.style.display === 'none' ? 'block' : 'none');
                sg.classList.toggle('collapsed');
            }
            return;
        }
        const hdr = e.target.closest('.iut-picker-section-head');
        if (hdr) {
            const sec = hdr.closest('.iut-picker-section');
            sec.classList.toggle('collapsed');
        }
    });
    overlay.addEventListener('input', (e) => {
        if (e.target.matches('.iut-picker-search')) {
            const kind = e.target.getAttribute('data-kind');
            if (kind === 'goals') renderGoalsGrouped();
            else renderSection(kind, state[kind], '');
        }
    });
    overlay.addEventListener('change', (e) => {
        if (e.target.matches('.iut-picker-addall-cb')) {
            const g = e.target.getAttribute('data-group');
            const on = e.target.checked;
            const search = (overlay.querySelector('.iut-picker-search[data-kind="goals"]')?.value || '').toLowerCase();
            for (const c of state.goals) {
                if ((c.kind || 'other') !== g) continue;
                if (existingKeys.has(c._key)) continue;
                if (search && !c.name.toLowerCase().includes(search)) continue;
                if (on) state.checked.add(c._key); else state.checked.delete(c._key);
            }
            const sg = e.target.closest('.iut-picker-subgroup');
            sg?.querySelectorAll('.iut-cand input[type=checkbox]:not(:disabled)').forEach(cb => { cb.checked = on; });
            updateCount();
            return;
        }
        if (e.target.matches('.iut-cand input[type=checkbox]')) {
            const key = e.target.getAttribute('data-key');
            if (e.target.checked) state.checked.add(key); else state.checked.delete(key);
            updateCount();
            _syncAddAll();
        }
    });
    document.addEventListener('keydown', function esc(ev) {
        if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    // ---- load the three sources ------------------------------------------
    const uuid = _sessionUuid();

    // Goals report — Fastest new item (gear).
    _json('/api/stats-report/results').then(d => {
        const cands = _newItemCandidates((d && d.results) || {});
        state.goals = cands.map(c => {
            const key = 'grt:' + c.slug;
            const kindLabel = _KIND_LABEL[c.kind] || 'Gear';
            return {
                ...c, _key: key, subtitle: c.optimization_target,
                _entry: () => ({
                    entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
                    type: 'goals_report_target',
                    source_ref: { item_slug: c.slug, item_name: c.name, category: 'new_items', subtype: c.kind || 'gear' },
                    display: { name: c.name, icon_path: c.icon_path, optimization_target: 'Fastest new item ▸ ' + kindLabel },
                    upgrades: [],
                }),
            };
        });
        renderGoalsGrouped();
    }).catch(() => renderSection('goals', [], 'Could not load goals-report results.'));

    // Crafting trees.
    _json('/api/crafting-tree/saved?session_uuid=' + encodeURIComponent(uuid)).then(list => {
        const arr = Array.isArray(list) ? list : (list.trees || []);
        state.tree = arr.map(t => {
            const key = 'tree:' + t.id;
            return {
                name: t.name || '(unnamed tree)', icon_path: '', _key: key,
                subtitle: t.target_item_id || '',
                _entry: () => ({
                    entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
                    type: 'crafting_tree',
                    source_ref: { tree_id: t.id, target_item_id: t.target_item_id },
                    display: { name: t.name || '(unnamed tree)', icon_path: '', optimization_target: 'Crafting Tree' },
                    upgrades: [],
                }),
            };
        });
        renderSection('tree', state.tree, 'No saved crafting trees.');
    }).catch(() => renderSection('tree', [], 'Could not load crafting trees.'));

    // Gear sets (optimized-once only — OQ-2).
    _json(`/api/session/${encodeURIComponent(uuid)}/gearsets?summary=true`).then(list => {
        const arr = Array.isArray(list) ? list : (list.gearsets || []);
        state.gearset = arr.filter(g => g.is_optimized).map(g => {
            const key = 'gs:' + g.id;
            return {
                name: g.name || '(unnamed gear set)', icon_path: '', _key: key,
                _entry: () => ({
                    entry_id: 'e-' + Math.random().toString(36).slice(2, 10),
                    type: 'gear_set',
                    source_ref: { gearset_id: g.id },
                    display: { name: g.name || '(unnamed gear set)', icon_path: '', optimization_target: 'Gear Set' },
                    upgrades: [],
                }),
            };
        });
        const emptyMsg = arr.length ? 'No gear sets have been optimized yet (optimize one first).' : 'No saved gear sets.';
        renderSection('gearset', state.gearset, emptyMsg);
    }).catch(() => renderSection('gearset', [], 'Could not load gear sets.'));

    updateCount();
}

function _sectionHtml(kind, title) {
    return `
        <div class="iut-picker-section" data-kind="${kind}">
            <div class="iut-picker-section-head">
                <span class="iut-picker-arrow">▼</span><span class="iut-picker-section-title">${_esc(title)}</span>
            </div>
            <div class="iut-picker-section-body">
                <input type="text" class="iut-picker-search" data-kind="${kind}" placeholder="Search…">
                <div class="iut-picker-list" data-kind="${kind}"><div class="iut-picker-empty">Loading…</div></div>
            </div>
        </div>`;
}

function _injectStyles() {
    if (document.getElementById('iut-picker-styles')) return;
    const css = `
    .iut-picker-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center; padding: 16px;
        animation: iutPickerOverlayIn 0.2s ease-out; }
    .iut-picker { background: var(--bg-primary,#14161c); border: 1px solid var(--border-color,#2a2e39);
        border-radius: 10px; width: min(560px, 96vw); max-height: 88vh; display: flex; flex-direction: column;
        transform-origin: top center; animation: iutPickerIn 0.2s ease-out; }
    /* Open/close animation (mirrors the app's other popups). */
    @keyframes iutPickerOverlayIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes iutPickerIn { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
    @keyframes iutPickerOverlayOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes iutPickerOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-8px) scale(0.98); } }
    .iut-picker-overlay.closing { animation: iutPickerOverlayOut 0.18s ease-in forwards; }
    .iut-picker-overlay.closing .iut-picker { animation: iutPickerOut 0.18s ease-in forwards; }
    .iut-picker-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px;
        border-bottom: 1px solid var(--border-color,#2a2e39); }
    .iut-picker-head h3 { margin: 0; flex: 1; color: var(--text-primary,#fff);
        font-size: max(var(--min-text,5px), calc(16px * var(--text-scale,1))); }
    .iut-picker-x { background: transparent; border: none; color: var(--text-secondary,#9aa0ac);
        font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
    .iut-picker-x:hover { color: var(--text-primary,#fff); background: var(--bg-secondary,#1d2028); }
    .iut-picker-body { overflow-y: auto; padding: 8px 14px; }
    .iut-picker-section { border-bottom: 1px solid var(--border-color,#23262f); padding: 8px 0; }
    .iut-picker-section-head { display: flex; align-items: center; gap: 8px; cursor: pointer;
        color: var(--text-primary,#fff); font-size: max(var(--min-text,5px), calc(14px * var(--text-scale,1))); }
    .iut-picker-arrow { transition: transform 0.15s; display: inline-block; }
    .iut-picker-section.collapsed .iut-picker-arrow { transform: rotate(-90deg); }
    .iut-picker-section.collapsed .iut-picker-section-body { display: none; }
    .iut-picker-search { width: 100%; margin: 8px 0; padding: 6px 8px; border-radius: 6px;
        border: 1px solid var(--border-color,#2a2e39); background: var(--bg-secondary,#1d2028); color: var(--text-primary,#fff); }
    .iut-picker-list { max-height: 220px; overflow-y: auto; }
    .iut-cand { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 6px; cursor: pointer;
        color: var(--text-primary,#fff); font-size: max(var(--min-text,5px), calc(13px * var(--text-scale,1))); }
    .iut-cand:hover { background: var(--bg-secondary,#1d2028); }
    .iut-cand-already { opacity: 0.55; }
    .iut-cand-name { flex: 1; }
    .iut-cand-sub { color: var(--text-secondary,#9aa0ac); font-size: 0.85em; }
    .iut-cand-tag { color: #7cc00a; font-size: 0.8em; }
    .iut-picker-empty { color: var(--text-secondary,#9aa0ac); padding: 8px 6px; font-size: 0.9em; }
    .iut-picker-subsection-label { color: var(--text-secondary,#9aa0ac); font-size: 0.9em; font-weight: 600; margin: 4px 2px 6px; }
    .iut-picker-subgroup { margin: 0 0 6px; border: 1px solid var(--border-color,#23262f); border-radius: 6px; overflow: hidden; }
    .iut-picker-subhead { display: flex; align-items: center; gap: 8px; padding: 5px 8px; cursor: pointer; background: var(--bg-secondary,#1d2028); }
    .iut-picker-addall { display: inline-flex; align-items: center; margin: 0; cursor: pointer; }
    .iut-picker-subarrow { display: inline-block; transition: transform 0.15s; color: var(--text-secondary,#9aa0ac); }
    .iut-picker-subgroup.collapsed .iut-picker-subarrow { transform: rotate(-90deg); }
    .iut-picker-subtitle { color: var(--text-primary,#fff); font-size: max(var(--min-text,5px), calc(13px * var(--text-scale,1))); }
    .iut-picker-subcount { color: var(--text-secondary,#9aa0ac); }
    .iut-picker-subbody { padding: 2px 6px 4px; }
    .iut-picker-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 12px 14px; border-top: 1px solid var(--border-color,#2a2e39); }
    .iut-picker-count { color: var(--text-secondary,#9aa0ac); }
    .iut-picker-actions { display: flex; gap: 8px; }
    .iut-picker .iut-btn { cursor: pointer; border: 1px solid var(--border-color,#2a2e39);
        background: var(--bg-secondary,#1d2028); color: var(--text-primary,#fff); border-radius: 8px; padding: 7px 14px; }
    .iut-picker .iut-btn-primary { border-color: #7cc00a; background: #223016; }
    `;
    const style = document.createElement('style');
    style.id = 'iut-picker-styles';
    style.textContent = css;
    document.head.appendChild(style);
}
