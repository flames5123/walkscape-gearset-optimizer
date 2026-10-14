/**
 * UpgradesTrackerPage — FAC-gated Item Upgrades Tracker (Phase 1).
 *
 * Self-contained full-width overlay (mirrors AchievementsPage / WalkdlePage):
 * hash-routed at #upgrades-tracker, toggled by #upgrades-tracker-nav-btn.
 *
 * Phase 1 (this increment): working-draft persistence (GET/PUT
 * /api/upgrades-tracker/working), the "Add gear sets" source picker, the
 * "Tracked Upgrades" entry list (Type | Name | remove-X w/ confirm), the
 * single rolled-up "Item Upgrades" table across all entries (Total steps
 * saved; Steps-to-obtain/Net show "--" until Phase 2's calculate lands), and
 * add/remove integrated with the global undo/redo via a provider.
 *
 * Spec: .kiro/specs/item-upgrades-tracker/.
 */

import api from './api.js';
import { openUpgradesTrackerAddPopup, entryKey } from './components/upgrades-tracker-add-popup.js';
import { resolveItemIcon } from './utils/resolve-item-icon.js';
import { decodeGearsetSlots, renderMiniGearPreview } from './utils/gearset-decode.js';
import { wikiDarkModeSuffix } from './utils/wiki-link.js';
import { rewardSourceGroupsHtml } from './utils/reward-sources.js';
import { wireDropAnchor } from './drop-item-popover.js';

const ICON = '/assets/icons/keywords/upgradeable.svg';

function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _sessionUuid() {
    try { return (window.store && window.store.state && window.store.state.session && window.store.state.session.uuid) || null; }
    catch (_) { return null; }
}
function _num(n) { try { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }); } catch (_) { return String(n); } }

// The "Type" column label — for goals-report targets it must reflect the item's
// actual kind (Gear / Tools / Eggs / Collectibles), not a hardcoded "Gear".
function _typeLabel(e) {
    if (!e) return '';
    if (e.type === 'crafting_tree') return 'Crafting Tree';
    if (e.type === 'gear_set') return 'Gear Set';
    const sub = String((e.source_ref && e.source_ref.subtype) || 'gear');
    const cap = sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : sub;
    return 'Optimized goals report ▸ Fastest new item ▸ ' + cap;
}

// Map a goals-report kind (subtype) to a resolveItemIcon type prefix so the
// icon resolves from the correct folder (collectibles/, pet_eggs/, equipment/).
// Collectibles/eggs stored with an equipment-path fallback previously showed no
// icon; re-deriving from subtype + name fixes them (name preserves apostrophes).
const _KIND_ICON_TYPE = { collectibles: 'Collectible', collectible: 'Collectible', eggs: 'Egg', egg: 'Egg', gear: 'Item', tools: 'Item', tool: 'Item' };
function _iconFor(subtype, name, storedPath) {
    const type = _KIND_ICON_TYPE[String(subtype || '').toLowerCase()] || 'Item';
    return resolveItemIcon({ itemRef: type + '.', itemName: name || '', fallback: storedPath || '' });
}

// Strip a trailing quality suffix like " (Great)" from an item name — the
// slot-alternative `name` carries it, but icon filenames + obtain slugs don't.
function _cleanItemName(name) {
    return String(name || '').replace(/\s*\((?:Normal|Good|Great|Excellent|Perfect|Eternal)\)\s*$/i, '').trim();
}
function _nameSlug(name) {
    return _cleanItemName(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Slot id -> display name (mirrors GearSlotGrid / nonowned-upgrades-section).
const _SLOT_NAMES = {
    head: 'Head', cape: 'Cape', back: 'Back', chest: 'Chest', primary: 'Primary', secondary: 'Secondary',
    hands: 'Hands', legs: 'Legs', neck: 'Neck', feet: 'Feet', ring1: 'Ring 1', ring2: 'Ring 2',
    tool0: 'Tool 1', tool1: 'Tool 2', tool2: 'Tool 3', tool3: 'Tool 4', tool4: 'Tool 5', tool5: 'Tool 6',
    pet: 'Pet', consumable: 'Consumable',
};
function _slotName(s) { return _SLOT_NAMES[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1) : ''); }
// Sanitize a rolled-up item key for use in a data attribute / querySelector.
function _detailKey(r) {
    return (String(r.uuid || r.name || '').replace(/[^a-z0-9_-]/gi, '') + '_' + String(r.quality || '').replace(/[^a-z0-9]/gi, '')) || 'k';
}

export class UpgradesTrackerPage {
    constructor(selector) {
        this._selector = selector;
        this._el = document.querySelector(selector);
        this._open = false;
        this._closeTimer = null;
        this._delegated = false;
        this._entries = [];
        this._applyingUndo = false;
        this._currentTrackerId = null;    // set when a named tracker is loaded/saved
        this._currentTrackerName = null;
        // Undo/redo provider (delegates to the global manager, like the Bank page).
        this._undoProvider = {
            capture: () => JSON.stringify(this._entries),
            // Human-readable label for the undo/redo tooltip (overrides the
            // generic "Bank layout change" for external providers).
            describe: (fromSnap, toSnap) => {
                let a = [], b = [];
                try { a = JSON.parse(fromSnap || '[]') || []; } catch (_) {}
                try { b = JSON.parse(toSnap || '[]') || []; } catch (_) {}
                const dn = b.length - a.length;
                if (dn > 0) return `Add ${dn} to item upgrades tracker`;
                if (dn < 0) {
                    const bkeys = new Set(b.map(e => e && e.entry_id));
                    const removed = a.find(e => e && !bkeys.has(e.entry_id));
                    const nm = removed && removed.display && removed.display.name;
                    return nm ? `Remove ${nm} from item upgrades tracker` : `Remove ${-dn} from item upgrades tracker`;
                }
                return 'Item upgrades tracker change';
            },
            apply: (snap) => {
                try { this._entries = JSON.parse(snap) || []; } catch (_) { this._entries = []; }
                this._applyingUndo = true;
                this._persist();
                this._render();
                this._applyingUndo = false;
                this._calculateAll(false);  // recompute upgrades for the restored set
            },
        };
        this._injectStyles();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen()) { e.preventDefault(); this.close(); }
        });
    }

    // ---- open / close -----------------------------------------------------

    open() {
        if (!this._el) this._el = document.querySelector(this._selector);
        if (!this._el) return;
        this._ensureDelegation();
        if (this._closeTimer) { clearTimeout(this._closeTimer); this._closeTimer = null; }
        this._open = true;
        const header = document.querySelector('header');
        const top = header ? Math.round(header.getBoundingClientRect().bottom) : 56;
        this._el.style.setProperty('--iut-top', top + 'px');
        this._el.classList.remove('closing');
        this._el.classList.add('opening');
        document.body.classList.add('upgrades-tracker-open');
        if (window.innerWidth <= 768) window.scrollTo(0, 0);
        document.getElementById('upgrades-tracker-nav-btn')?.classList.add('active');
        this._render();
        this._loadWorking();
        if (window.undoRedoManager) window.undoRedoManager.registerProvider(this._undoProvider);
    }

    close() {
        this._open = false;
        document.getElementById('upgrades-tracker-nav-btn')?.classList.remove('active');
        if (window.undoRedoManager) window.undoRedoManager.unregisterProvider();
        this._persist();
        if (typeof window !== 'undefined' && window.location.hash === '#upgrades-tracker') {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        if (!this._el) { document.body.classList.remove('upgrades-tracker-open'); return; }
        const wasVisible = getComputedStyle(this._el).display !== 'none';
        this._el.classList.remove('opening');
        if (wasVisible) {
            this._el.classList.add('closing');
            this._closeTimer = setTimeout(() => {
                this._el.classList.remove('closing');
                document.body.classList.remove('upgrades-tracker-open');
                this._closeTimer = null;
            }, 260);
        } else {
            this._el.classList.remove('closing');
            document.body.classList.remove('upgrades-tracker-open');
        }
    }

    isOpen() { return this._open; }

    // ---- data -------------------------------------------------------------

    _loadWorking() {
        const uuid = _sessionUuid();
        if (!uuid) return;
        Promise.resolve(api.getUpgradesTrackerWorking(uuid)).then((d) => {
            this._entries = (d && d.entries) || [];
            this._render();
            // OQ-9: auto-recompute steps-to-obtain on visit (silent).
            this._calculateAll(false);
        }).catch(() => { /* keep empty */ });
    }

    _persist() {
        const uuid = _sessionUuid();
        if (!uuid) return;
        try { Promise.resolve(api.saveUpgradesTrackerWorking(uuid, this._entries)).catch(() => {}); } catch (_) {}
    }

    _recordUndo() {
        // Persist first, then push a snapshot (mirrors the Bank page's _recordUndo).
        this._persist();
        if (!this._applyingUndo && window.undoRedoManager) window.undoRedoManager.pushState();
    }

    _addEntries(entries) {
        if (!entries || !entries.length) return;
        const existing = new Set(this._entries.map(entryKey));
        let added = 0;
        for (const e of entries) {
            const k = entryKey(e);
            if (existing.has(k)) continue;
            existing.add(k);
            this._entries.push(e);
            added++;
        }
        if (added) { this._recordUndo(); this._render(); this._calculateAll(false); }
    }

    _removeEntry(entryId) {
        const idx = this._entries.findIndex(e => e.entry_id === entryId);
        if (idx < 0) return;
        this._entries.splice(idx, 1);
        try { this._recordUndo(); } catch (_) { /* still refresh the view below */ }
        this._render();
    }

    // Merge every entry's cached upgrade rows into one rolled-up list (OQ-11):
    // an item that upgrades multiple entries appears once, total_steps_saved summed.
    _rolledUpRows() {
        // Collect each upgrade item's contributions, grouped per source ACTIVITY.
        // Multiple tracked targets from the SAME activity share one farm, so the
        // saving must NOT be summed per-target. Instead we distribute it
        // marginally across targets sorted by steps-to-obtain: the shortest
        // target gets the saving on its full farm, each longer target only on
        // the marginal extra steps (union, not sum). Total per activity =
        // fraction × longest target's steps.
        const byItem = new Map();
        for (const entry of this._entries) {
            const targetSteps = (entry.source_ref && entry.source_ref.target_steps != null)
                ? Number(entry.source_ref.target_steps) : null;
            const targetName = (entry.display && entry.display.name) || (entry.source_ref && entry.source_ref.item_name) || '?';
            const activityName = (entry.source_ref && entry.source_ref.activity_name) || null;
            const activityKey = (entry.source_ref && (entry.source_ref.result_id != null
                ? 'rid:' + entry.source_ref.result_id : (activityName ? 'act:' + activityName : null))) || ('ent:' + entry.entry_id);
            for (const u of (entry.upgrades || [])) {
                const key = (u.uuid || u.name || '') + '\u0000' + (u.quality || '');
                let row = byItem.get(key);
                if (!row) {
                    row = {
                        name: u.name, uuid: u.uuid, quality: u.quality, icon_path: u.icon_path,
                        subtype: u.subtype || (entry.source_ref && entry.source_ref.subtype) || null,
                        rarity: u.rarity || null,
                        how_to_obtain: u.how_to_obtain || null,
                        steps_to_obtain: (u.steps_to_obtain != null ? u.steps_to_obtain : null),
                        total_steps_saved: null, _hasSaved: false, contributes: [], _acts: new Map(),
                    };
                    byItem.set(key, row);
                }
                if (row.steps_to_obtain == null && u.steps_to_obtain != null) row.steps_to_obtain = u.steps_to_obtain;
                if (!row.how_to_obtain && u.how_to_obtain) row.how_to_obtain = u.how_to_obtain;
                const mag = (u.total_steps_saved != null ? u.total_steps_saved
                    : (u.steps_saved != null ? u.steps_saved : null));
                // Per-step efficiency gain at this activity (relative reduction).
                const frac = (u.old_value != null && Math.abs(u.old_value) > 1e-9 && mag != null)
                    ? (Math.abs(mag) / Math.abs(u.old_value)) : null;
                let g = row._acts.get(activityKey);
                if (!g) { g = { activity: activityName, mag, frac, slot: u.slot || null, targets: [] }; row._acts.set(activityKey, g); }
                g.targets.push({ source: targetName, target_steps: targetSteps, slot: u.slot || null });
            }
        }
        const rows = Array.from(byItem.values());
        rows.forEach(r => {
            let total = 0, any = false;
            const contribs = [];
            for (const g of r._acts.values()) {
                const canMarginal = g.frac != null && g.targets.length > 0
                    && g.targets.every(t => t.target_steps != null && t.target_steps > 0);
                if (canMarginal) {
                    const sorted = g.targets.slice().sort((a, b) => a.target_steps - b.target_steps);
                    let prev = 0;
                    for (const t of sorted) {
                        const marginal = Math.max(0, t.target_steps - prev);
                        const saved = g.frac * marginal;
                        prev = t.target_steps;
                        total += saved; any = true;
                        contribs.push({ source: t.source, activity: g.activity, slot: t.slot || g.slot,
                            steps_saved: saved, marginal_steps: marginal });
                    }
                } else if (g.mag != null) {
                    // No per-target steps/fraction — count the activity's saving
                    // ONCE (never N×), listing the target(s) it applies to.
                    total += Math.abs(g.mag); any = true;
                    const names = g.targets.map(t => t.source);
                    contribs.push({ source: names.join(', ') || (g.activity || '?'), activity: g.activity,
                        slot: g.slot, steps_saved: Math.abs(g.mag), marginal_steps: null });
                }
            }
            r.total_steps_saved = any ? total : null;
            r._hasSaved = any;
            r.contributes = contribs;
            r.net_steps_saved = (r._hasSaved && r.steps_to_obtain != null) ? (r.total_steps_saved - r.steps_to_obtain) : null;
            delete r._acts;
        });
        // Sort by savings when known, else by (lowest) steps-to-obtain so the
        // cheapest-to-get items surface before any savings are computed.
        rows.sort((a, b) => {
            if (a._hasSaved && b._hasSaved) return b.total_steps_saved - a.total_steps_saved;
            if (a._hasSaved !== b._hasSaved) return a._hasSaved ? -1 : 1;
            return (a.steps_to_obtain ?? Infinity) - (b.steps_to_obtain ?? Infinity);
        });
        return rows;
    }

    // ---- render -----------------------------------------------------------

    _render() {
        if (!this._el || !this._open) return;  // never repaint a closed overlay (stray async renders → blank page)
        this._el.innerHTML = `
            <div class="iut-inner">
                <div class="iut-header">
                    <img class="iut-header-icon" src="${ICON}" alt="" width="26" height="26">
                    <h2 class="iut-title">Item Upgrades Tracker</h2>
                    <div class="crafting-tree-preset-manager iut-preset-manager">
                        <button class="button crafting-tree-preset-save" data-iut-action="save" title="Save the current tracker under a name">Save</button>
                        <div class="crafting-tree-preset-dropdown-btn">
                            <input type="text" class="crafting-tree-preset-name iut-name-input" placeholder="New tracker" maxlength="100" value="${_esc(this._currentTrackerName || '')}" />
                            <button class="crafting-tree-preset-toggle" data-iut-action="load" title="Load a saved tracker"><span class="expand-arrow">▼</span></button>
                        </div>
                        <div class="crafting-tree-preset-dropdown iut-preset-dropdown" style="display:none"></div>
                    </div>
                    <button class="button crafting-tree-close-btn iut-close" data-iut-action="close" aria-label="Close">✕</button>
                </div>
                <div class="iut-body">
                    ${this._renderEntries()}
                    ${this._renderTable()}
                </div>
            </div>`;
        this._wireDropAnchors();
    }

    // Wire the per-upgrade "Stats" buttons to the shared drop-item popover
    // (same hover/click stat sheet used across the site). Idempotent.
    _wireDropAnchors() {
        if (!this._el) return;
        try {
            this._el.querySelectorAll('.tree-summary-drop-anchor[data-drop-name]').forEach(a => {
                wireDropAnchor(a, a.dataset.dropName, false, a.dataset.dropQuality || null);
            });
        } catch (_) { /* non-fatal */ }
    }

    _renderEntries() {
        const rows = this._entries.map(e => {
            const ic = _iconFor(e.source_ref?.subtype, e.display?.name, e.display?.icon_path);
            const hasGear = e.type === 'goals_report_target' && e.display && e.display.gearset_export;
            return `
            <div class="iut-entry-wrap" data-entry-id="${_esc(e.entry_id)}">
              <div class="iut-entry" data-entry-id="${_esc(e.entry_id)}">
                <div class="iut-entry-type">${_esc(_typeLabel(e))}</div>
                <div class="iut-entry-name">
                    ${ic ? `<img src="${_esc(ic)}" width="20" height="20" alt="" onerror="this.style.display='none'">` : ''}
                    <span>${_esc(e.display?.name || '(unnamed)')}</span>
                    ${e.display?.optimization_target ? `<span class="iut-entry-target">${_esc(e.display.optimization_target)}</span>` : ''}
                    ${hasGear ? `<button class="button button-secondary iut-gear-btn" data-iut-action="gear" data-entry-id="${_esc(e.entry_id)}" title="Show the optimized gearset for this activity">Gear <span class="iut-gear-arrow">▸</span></button>` : ''}
                </div>
                <button class="iut-entry-remove" data-iut-action="remove" data-entry-id="${_esc(e.entry_id)}" title="Remove from tracker">✕</button>
              </div>
              <div class="iut-entry-gear" data-entry-id="${_esc(e.entry_id)}" data-open="0" style="display:none"></div>
            </div>`;
        }).join('');
        const body = this._entries.length
            ? rows
            : `<div class="iut-empty-inline">No sources yet. Use “Add gear sets” to track upgrades from the Optimized Goals Report, crafting trees, or gear sets.</div>`;
        const spinner = this._calculating ? `<span class="iut-spinner" title="Calculating upgrades…"></span>` : '';
        return `
            <div class="iut-section">
                <div class="iut-section-head"><span class="iut-section-title">Tracked Upgrades</span>${spinner}</div>
                <div class="iut-section-actions"><button class="button button-secondary iut-add-btn" data-iut-action="add-gear-sets">+ Add gear sets</button></div>
                <div class="iut-entries">${body}</div>
            </div>`;
    }

    _renderTable() {
        const rows = this._rolledUpRows();
        const head = `
            <tr>
                <th>Item</th><th>How to obtain</th><th>Steps to obtain</th>
                <th>Total steps saved</th><th>Net steps saved</th>
            </tr>`;
        let bodyRows;
        if (!this._entries.length) {
            bodyRows = `<tr><td colspan="5" class="iut-table-empty">Add sources above to see rolled-up item upgrades.</td></tr>`;
        } else if (!rows.length) {
            bodyRows = `<tr><td colspan="5" class="iut-table-empty">No upgrade data yet — use “Calculate all items” to fill in how-to-obtain and steps-to-obtain.</td></tr>`;
        } else {
            bodyRows = rows.map(r => {
                const obtain = (r.steps_to_obtain === 0) ? 'buyable'
                    : (r.steps_to_obtain != null) ? _num(r.steps_to_obtain)
                    : `-- <button class="iut-calc-btn" data-iut-action="calc" data-item="${_esc(r.uuid || r.name)}">Calculate</button>`;
                const net = (r.net_steps_saved != null) ? _num(r.net_steps_saved) : '--';
                const total = (r.total_steps_saved != null) ? _num(r.total_steps_saved) : '--';
                const how = r.how_to_obtain?.label || r.how_to_obtain?.kind || '—';
                const key = _detailKey(r);
                const rarityCls = r.rarity ? ` rarity-${_esc(r.rarity)}` : '';
                const icon = r.icon_path ? `<img src="${_esc(r.icon_path)}" width="16" height="16" alt="" class="iut-item-icon${rarityCls}" onerror="this.style.display='none'">` : '';
                return `<tr class="iut-upg-row" data-iut-action="upg-row" data-key="${_esc(key)}" role="button" tabindex="0">
                    <td class="iut-td-item"><span class="expand-arrow iut-upg-arrow">▼</span>${icon}<span>${_esc(r.name || '?')}</span></td>
                    <td>${_esc(how)}</td>
                    <td>${obtain}</td>
                    <td>${total}</td>
                    <td>${net}</td>
                </tr>
                <tr class="iut-upg-detail" data-key="${_esc(key)}"><td colspan="5"><div class="iut-upg-detail-inner" style="display:none">${this._renderUpgradeDetail(r)}</div></td></tr>`;
            }).join('');
        }
        return `
            <div class="iut-section">
                <div class="iut-section-head"><span class="iut-section-title">Item Upgrades (rolled up across all entries)</span></div>
                <div class="iut-section-actions"><button class="button button-secondary iut-add-btn" data-iut-action="calc-all">Calculate all items</button></div>
                <table class="iut-table"><thead>${head}</thead><tbody>${bodyRows}</tbody></table>
            </div>`;
    }

    // Expandable per-upgrade detail — mirrors the crafting tree's tree-upgrade
    // detail (reuses its CSS classes): Sources/Stats buttons + a standard Wiki
    // link, then a "Source Node | Slot | Saved" table. Source Node = the tracked
    // TARGET this gear speeds up (so multi-target activities list each target).
    _renderUpgradeDetail(r) {
        const contribs = Array.isArray(r.contributes) ? r.contributes : [];
        const clean = _cleanItemName(r.name || '');
        const wikiName = clean.replace(/ /g, '_');
        const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;
        const dq = r.quality ? ` data-drop-quality="${_esc(r.quality)}"` : '';
        const nodeRows = contribs.map(c => {
            const target = _esc(c.source || c.activity || '?');
            const via = c.activity ? ` <span class="tree-upgrade-node-replaces">(via ${_esc(c.activity)})</span>` : '';
            const slot = _esc(_slotName(c.slot));
            const marginal = (c.marginal_steps != null) ? ` <span class="tree-upgrade-node-replaces">(on ${_num(c.marginal_steps)} steps)</span>` : '';
            const saved = (c.steps_saved != null) ? `−${_num(Math.abs(c.steps_saved))} steps` : '—';
            return `<tr><td>${target}${via}</td><td>${slot}</td><td class="tree-upgrade-savings">${saved}${marginal}</td></tr>`;
        }).join('') || `<tr><td colspan="3">No source detail yet — run Calculate.</td></tr>`;
        return `
            <div class="tree-upgrade-actions-row iut-upg-actions">
                <button class="btn-source-dropdown iut-sources-btn" data-iut-action="upg-sources" data-item-name="${_esc(clean)}" title="Show where this item comes from">Sources <span class="source-arrow">▼</span></button>
                <button class="btn-source-dropdown tree-summary-drop-anchor iut-stats-btn" data-drop-name="${_esc(clean)}"${dq} title="Show this item's stats" type="button">Stats</button>
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link" onclick="event.stopPropagation()">Wiki</a>
            </div>
            <div class="tree-upgrade-sources-container iut-sources-container" style="display:none"></div>
            <table class="tree-summary-table tree-upgrade-nodes-table">
                <thead><tr><th>Source Node</th><th>Slot</th><th>Saved</th></tr></thead>
                <tbody>${nodeRows}</tbody>
            </table>`;
    }

    // Render an item's obtain-sources list (activity drops, recipes, shop,
    // chest, reward sources) — mirrors crafting-tree-summary._renderSourcesList
    // so the shared .source-item / .source-group-header CSS applies unchanged.
    _renderItemSourcesHtml(sources) {
        if (!Array.isArray(sources) || sources.length === 0) return '<div class="source-empty">No sources found</div>';
        const esc = _esc;
        const by = (t) => sources.filter(s => s.type === t);
        const recipeOutputs = by('recipe_output'), activityDrops = by('activity_drop'), recipeDrops = by('recipe_drop');
        const recipeInputs = by('recipe_input'), itemFindingDrops = by('item_finding'), shopSources = by('shop'), chestSources = by('chest');
        let html = '<div class="source-dropdown-list">';
        if (recipeOutputs.length) {
            html += '<div class="source-group-header">Crafted by</div>';
            for (const src of recipeOutputs) html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe">Recipe</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span></div></div>`;
        }
        if (activityDrops.length) {
            html += '<div class="source-group-header">Dropped by</div>';
            for (const src of activityDrops) {
                const dr = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                const sec = src.secondary ? ' (secondary)' : '';
                html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-activity">Activity</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span><span>${esc(src.base_steps || '?')} steps</span><span>Drop: ${esc(dr)}${esc(sec)}</span></div></div>`;
            }
        }
        if (recipeDrops.length) {
            html += '<div class="source-group-header">Dropped while crafting</div>';
            for (const src of recipeDrops) {
                const dr = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe-drop">Recipe Drop</span></div><div class="source-item-details"><span>${esc(src.skill || '')} Lv.${esc(src.level || '?')}</span><span>Drop: ${esc(dr)}</span></div></div>`;
            }
        }
        if (recipeInputs.length) {
            html += '<div class="source-group-header">Used as input by</div>';
            for (const src of recipeInputs) html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name)}</span><span class="source-badge source-badge-recipe-input">Recipe Input</span></div></div>`;
        }
        if (itemFindingDrops.length) {
            html += '<div class="source-group-header">Item Finding</div>';
            for (const src of itemFindingDrops) {
                const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.category || src.name || '?')}</span><span class="source-badge source-badge-item-finding">Item Finding</span></div>${chance ? `<div class="source-item-details"><span>${esc(chance)}</span></div>` : ''}</div>`;
            }
        }
        if (shopSources.length) {
            html += '<div class="source-group-header">Sold by</div>';
            for (const src of shopSources) html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${esc(src.name || '?')}</span><span class="source-badge source-badge-shop">Shop</span></div><div class="source-item-details"><span>${esc(src.location || '')}</span><span>${esc(src.price_display || '')}</span></div></div>`;
        }
        if (chestSources.length) {
            html += '<div class="source-group-header">Found in chests</div>';
            for (const src of chestSources) {
                const dr = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                const qty = src.quantity_display || '';
                html += `<div class="source-item source-item-no-click source-item-chest"><div class="source-item-main"><span class="source-name">${esc(src.name || '?')}</span><span class="source-badge source-badge-chest">Chest</span></div><div class="source-item-details"><span>Chance per chest: ${esc(dr)}</span>${qty ? `<span>${esc(qty)}</span>` : ''}</div></div>`;
            }
        }
        html += rewardSourceGroupsHtml(sources);
        html += '</div>';
        return html;
    }

    // ---- events -----------------------------------------------------------

    _ensureDelegation() {
        if (this._delegated || !this._el) return;
        this._delegated = true;
        this._el.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-iut-action]');
            if (!btn || !this._el.contains(btn)) return;
            const act = btn.getAttribute('data-iut-action');
            if (act === 'close') { this.close(); return; }
            if (act === 'add-gear-sets') { this._openPicker(); return; }
            if (act === 'remove') { this._handleRemoveClick(btn); return; }
            if (act === 'save') { this._saveTracker(); return; }
            if (act === 'load') { this._toggleLoadDropdown(btn); return; }
            if (act === 'load-item') { this._closeLoadDropdown(); this._loadTracker(btn.getAttribute('data-tracker-id')); return; }
            if (act === 'del-item') { this._deleteTrackerById(btn.getAttribute('data-tracker-id'), () => this._populateLoadDropdown()); return; }
            if (act === 'new') { this._closeLoadDropdown(); this._newTracker(); return; }
            if (act === 'calc-all') { this._calculateAll(true); return; }
            if (act === 'calc') { this._calculateAll(true); return; }
            if (act === 'gear') { this._toggleEntryGear(btn.getAttribute('data-entry-id')); return; }
            if (act === 'upg-row') {
                const key = btn.getAttribute('data-key');
                const inner = this._el.querySelector(`.iut-upg-detail[data-key="${key}"] .iut-upg-detail-inner`);
                const arrow = btn.querySelector('.iut-upg-arrow');
                if (!inner) return;
                const $ = window.$ || window.jQuery;
                if ($) {
                    const willOpen = !$(inner).is(':visible');
                    $(inner).stop(true, true).slideToggle(180);
                    if (arrow) arrow.classList.toggle('expanded', willOpen);
                } else {
                    const open = inner.style.display !== 'none';
                    inner.style.display = open ? 'none' : 'block';
                    if (arrow) arrow.classList.toggle('expanded', !open);
                }
                return;
            }
            if (act === 'upg-sources') {
                e.preventDefault(); e.stopPropagation();
                const inner = btn.closest('.iut-upg-detail-inner');
                const container = inner && inner.querySelector('.iut-sources-container');
                const arrow = btn.querySelector('.source-arrow');
                if (!container) return;
                const $ = window.$ || window.jQuery;
                const visible = $ ? $(container).is(':visible') : container.style.display !== 'none';
                if (visible && container.children.length > 0) {
                    if (arrow) arrow.classList.remove('open');
                    if ($) $(container).slideUp(150); else container.style.display = 'none';
                    return;
                }
                if (arrow) arrow.classList.add('open');
                container.innerHTML = '<div class="source-loading">Loading sources…</div>';
                if ($) $(container).stop(true, true).slideDown(150); else container.style.display = 'block';
                const name = btn.getAttribute('data-item-name');
                Promise.resolve(api.getItemSources()).then(data => {
                    const lookup = String(name || '').toLowerCase().trim();
                    const sources = (data && data.sources && data.sources[lookup]) || [];
                    container.innerHTML = this._renderItemSourcesHtml(sources);
                }).catch(() => { container.innerHTML = '<div class="source-empty">Failed to load sources</div>'; });
                return;
            }
        });
    }

    // ---- saved trackers (Phase 3) -----------------------------------------

    _saveTracker() {
        const uuid = _sessionUuid();
        if (!uuid) return;
        const input = this._el && this._el.querySelector('.iut-name-input');
        const name = ((input && input.value) || this._currentTrackerName || '').trim();
        if (!name) { api.showInfo?.('Enter a name in the field, then Save.'); input && input.focus(); return; }
        // If renaming keeps the same name as the loaded one, overwrite it; else create new.
        const id = (this._currentTrackerName === name) ? this._currentTrackerId : null;
        Promise.resolve(api.saveUpgradesTracker(uuid, name, this._entries, id)).then((res) => {
            this._currentTrackerId = (res && res.id) || id;
            this._currentTrackerName = name;
            this._render();
            api.showSuccess?.(`Saved tracker “${name}”.`);
        }).catch(() => api.showError?.('Failed to save tracker.'));
    }

    _dropdownEl() { return this._el && this._el.querySelector('.iut-preset-dropdown'); }
    _dropdownArrow() { return this._el && this._el.querySelector('.crafting-tree-preset-toggle .expand-arrow'); }

    _toggleLoadDropdown() {
        const dd = this._dropdownEl();
        if (!dd) return;
        const $ = window.$ || window.jQuery;
        if (dd.style.display !== 'none') { this._closeLoadDropdown(); return; }
        this._dropdownArrow()?.classList.add('expanded');
        this._populateLoadDropdown();
        // Animate open like the crafting tree's preset dropdown (jQuery slide).
        if ($) { $(dd).stop(true, true).hide().slideDown(200); }
        else { dd.style.display = 'block'; }
        setTimeout(() => {
            const off = (ev) => {
                if (!this._el) { document.removeEventListener('click', off); return; }
                if (!ev.target.closest('.iut-preset-manager')) { this._closeLoadDropdown(); document.removeEventListener('click', off); }
            };
            document.addEventListener('click', off);
        }, 0);
    }

    _closeLoadDropdown() {
        const dd = this._dropdownEl();
        const $ = window.$ || window.jQuery;
        if (dd) {
            if ($) { $(dd).stop(true, true).slideUp(150); }
            else { dd.style.display = 'none'; }
        }
        this._dropdownArrow()?.classList.remove('expanded');
    }

    async _populateLoadDropdown() {
        const dd = this._dropdownEl();
        if (!dd) return;
        dd.innerHTML = `<div class="crafting-tree-preset-item crafting-tree-preset-new" data-iut-action="new">+ New tracker</div>
            <div class="iut-preset-loading">Loading…</div>`;
        const uuid = _sessionUuid();
        let trackers = [];
        try { const d = await Promise.resolve(api.listUpgradesTrackers(uuid)); trackers = (d && d.trackers) || []; }
        catch (_) { trackers = []; }
        const items = trackers.map(t => `
            <div class="crafting-tree-preset-item" data-iut-action="load-item" data-tracker-id="${_esc(t.id)}">
                <span class="crafting-tree-preset-item-name">${_esc(t.name)}</span>
                <span class="iut-preset-count">${t.entry_count ?? ''}</span>
                <button class="crafting-tree-preset-delete iut-preset-del" data-iut-action="del-item" data-tracker-id="${_esc(t.id)}" title="Delete">✕</button>
            </div>`).join('');
        dd.innerHTML = `<div class="crafting-tree-preset-item crafting-tree-preset-new" data-iut-action="new">+ New tracker</div>`
            + (items || `<div class="iut-preset-empty">No saved trackers yet.</div>`);
    }

    _loadTracker(id) {
        const uuid = _sessionUuid();
        if (!uuid) return;
        Promise.resolve(api.loadUpgradesTracker(id, uuid)).then((d) => {
            this._entries = (d && d.entries) || [];
            this._currentTrackerId = d && d.id;
            this._currentTrackerName = d && d.name;
            this._recordUndo();          // loading is an undoable working-state change
            this._render();
            this._calculateAll(false);   // refresh steps-to-obtain for the loaded set
            api.showSuccess?.(`Loaded “${this._currentTrackerName}”.`);
        }).catch(() => api.showError?.('Failed to load tracker.'));
    }

    _deleteTracker() {
        if (!this._currentTrackerId) return;
        const name = this._currentTrackerName || 'this tracker';
        if (!window.confirm(`Delete saved tracker “${name}”? (Your current working list stays as-is.)`)) return;
        this._deleteTrackerById(this._currentTrackerId, () => {
            this._currentTrackerId = null; this._currentTrackerName = null; this._render();
        });
    }

    _deleteTrackerById(id, done) {
        const uuid = _sessionUuid();
        if (!uuid) return;
        Promise.resolve(api.deleteUpgradesTracker(id, uuid)).then(() => {
            api.showSuccess?.('Tracker deleted.');
            if (typeof done === 'function') done();
        }).catch(() => api.showError?.('Failed to delete tracker.'));
    }

    _newTracker() {
        // No window.confirm (browsers can suppress it); starting fresh is undoable.
        this._entries = [];
        this._currentTrackerId = null; this._currentTrackerName = null;
        try { this._recordUndo(); } catch (_) { /* still refresh below */ }
        this._render();
    }

    // ---- calculate (Phase 2): steps-to-obtain from the goals report -------
    //
    // For goals_report_target entries the fastest-to-obtain steps are already
    // computed by the Optimized Goals Report (new_items rows carry per-item
    // `steps` in metrics_json.combined.items + best_drop.kind). We read those
    // and fill each entry's upgrade row — no optimizer run needed. "Total steps
    // saved" (the upgrade value) is populated for gear-set / crafting-tree
    // entries in Phase 5 (cached alternatives) + the on-demand optimizer pass.
    async _calculateAll(showToast) {
        const goalsEntries = this._entries.filter(e => e.type === 'goals_report_target');
        if (!goalsEntries.length) { if (showToast) this._toast('Nothing to calculate yet.'); return; }
        this._calculating = true; this._render();  // spinner on the Tracked Upgrades section
        let results;
        try {
            const r = await fetch('/api/stats-report/results', { credentials: 'same-origin' });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            results = (d && d.results) || {};
        } catch (_) {
            this._calculating = false; this._render();
            if (showToast) this._toast('Could not load goals-report results to calculate.');
            return;
        }
        let filled = 0;
        try {
            const rowBySlug = this._indexNewItemRows(results);
            const obtain = this._buildObtainIndex(results);
            const needCalc = [];
            for (const e of goalsEntries) {
                const slug = e.source_ref && e.source_ref.item_slug;
                const row = slug ? rowBySlug.get(slug) : null;
                if (!row) continue;
                // Remember the farming activity + its optimized gearset (Gear button).
                e.source_ref.result_id = row.id != null ? row.id : e.source_ref.result_id;
                e.source_ref.activity_name = row.activity_name || row.activity || e.source_ref.activity_name || null;
                e.source_ref.skill_name = row.skill_name || e.source_ref.skill_name || null;
                e.source_ref.category = 'new_items';
                // This target's own steps-to-obtain (its individual farm length),
                // used by the rolled-up marginal-savings math.
                const th = slug ? obtain.get(slug) : null;
                e.source_ref.target_steps = th && th.steps != null ? th.steps : (e.source_ref.target_steps || null);
                e.display = e.display || {};
                if (row.gearset_export) e.display.gearset_export = row.gearset_export;
                const alts = this._rowAlts(row);
                if (alts) { e.upgrades = this._altsToUpgrades(alts, obtain); filled++; }
                else { needCalc.push({ e, row }); }
            }
            // On-demand: rows without worker-cached alternatives (best effort — the
            // endpoint may not support new_items; failures leave the entry as-is).
            for (const { e, row } of needCalc) {
                try {
                    const alts = await this._computeAltsOnDemand(row);
                    if (alts) { e.upgrades = this._altsToUpgrades(alts, obtain); filled++; }
                } catch (_) { /* leave uncomputed — shows Calculate/-- */ }
            }
            this._persist();
        } catch (err) {
            console.warn('[iut] calculate upgrades failed:', err);
        } finally {
            this._calculating = false;
            this._render();
        }
        if (showToast) this._toast(filled ? `Computed upgrades for ${filled} target(s).`
            : 'No upgrade data yet — run the Optimized Goals Report first.');
    }

    // Map every new-item slug -> its goals-report row (the activity where that
    // item is the fastest new item). That row carries the optimized gearset and
    // its non-owned/locked/hidden alternatives — the actual "item upgrades".
    _indexNewItemRows(results) {
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const bySlug = new Map();
        const ni = results && results.new_items;
        const rows = Array.isArray(ni) ? ni : Object.values(ni || {});
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            let mj = row.metrics_json || row.metricsJson || {};
            if (typeof mj === 'string') { try { mj = JSON.parse(mj); } catch (_) { mj = {}; } }
            const slugs = new Set();
            const items = (mj.new_items_combined && Array.isArray(mj.new_items_combined.items)) ? mj.new_items_combined.items
                : (mj.combined && Array.isArray(mj.combined.items)) ? mj.combined.items : [];
            for (const it of items) { const s = norm(it.item_ref || it.item_name); if (s) slugs.add(s); }
            if (mj.best_drop) { const s = norm(mj.best_drop.item_ref || mj.best_drop.item_name); if (s) slugs.add(s); }
            const s2 = norm(row.item_slug || row.item_name || row.metric_name); if (s2) slugs.add(s2);
            for (const s of slugs) { if (!bySlug.has(s)) bySlug.set(s, row); }
        }
        return bySlug;
    }

    // Pull the merged non-owned + locked + hidden slot alternatives off a row.
    _rowAlts(row) {
        let mj = row.metrics_json || row.metricsJson || {};
        if (typeof mj === 'string') { try { mj = JSON.parse(mj); } catch (_) { mj = {}; } }
        const a = mj._slot_alternatives, l = mj._slot_locked_alternatives, h = mj._slot_hidden_alternatives;
        if (!a && !l && !h) return null;
        const merged = {};
        for (const src of [a, l, h]) {
            if (!src || typeof src !== 'object') continue;
            for (const slot of Object.keys(src)) {
                merged[slot] = (merged[slot] || []).concat(Array.isArray(src[slot]) ? src[slot] : []);
            }
        }
        return Object.keys(merged).length ? merged : null;
    }

    // Turn a slot->alts map into upgrade rows: one per distinct alt item (best
    // slot / max magnitude), carrying steps-saved for THIS activity + the alt's
    // own how-to-obtain / steps-to-obtain (so the rolled-up table can Net them).
    _altsToUpgrades(alts, obtain) {
        const byItem = new Map();
        for (const slot of Object.keys(alts || {})) {
            const list = Array.isArray(alts[slot]) ? alts[slot] : [];
            for (const alt of list) {
                if (!alt || !(alt.name || alt.uuid)) continue;
                // Alts are equippable gear; icon + obtain slug derive from the
                // CLEAN name (quality suffix stripped), matching how the crafting
                // tree's non-owned section and the obtain index key items.
                const rawName = alt.name || '';
                const qMatch = rawName.match(/\((Normal|Good|Great|Excellent|Perfect|Eternal)\)\s*$/i);
                const qual = alt.quality || (qMatch ? qMatch[1] : null);
                const qualCap = qual ? qual.charAt(0).toUpperCase() + qual.slice(1).toLowerCase() : null;
                const clean = _cleanItemName(rawName);
                const display = qualCap ? `${clean} (${qualCap})` : (clean || rawName);
                const slug = _nameSlug(rawName) || String(alt.uuid || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
                if (!slug) continue;
                const mag = this._improvementMag(alt);
                if (!(mag > 0)) continue;
                const key = slug + '\u0000' + (qual || '');
                const prev = byItem.get(key);
                if (prev && prev.total_steps_saved >= mag) continue;  // keep best slot
                const hit = obtain && obtain.get ? obtain.get(slug) : null;
                // Crafted gear carries a quality tier and isn't an activity drop.
                // If it's not in the drop obtain index, label it "Craft".
                const label = hit ? (hit.label || 'Activity drop') : (qual ? 'Craft' : 'Activity drop');
                byItem.set(key, {
                    name: display,
                    uuid: slug,
                    quality: qual || null,
                    rarity: alt.rarity || null,
                    subtype: 'gear',
                    slot,
                    old_value: (alt.old_value != null ? alt.old_value : null),
                    new_value: (alt.new_value != null ? alt.new_value : null),
                    icon_path: slug ? `/assets/icons/items/equipment/${slug}.svg` : '',
                    how_to_obtain: { kind: (qual && !hit) ? 'craft' : 'activity', label },
                    steps_to_obtain: hit ? hit.steps : null,
                    total_steps_saved: mag,
                });
            }
        }
        return Array.from(byItem.values());
    }

    // Best-effort on-demand alternatives when a row wasn't computed by the
    // worker. Decodes the row's gearset and calls the slot-alternatives endpoint.
    async _computeAltsOnDemand(row) {
        const exp = row.gearset_export;
        if (!exp) return null;
        let slots;
        try { slots = decodeGearsetSlots(exp) || {}; } catch (_) { return null; }
        const resp = await Promise.resolve(api.getStatsReportSlotAlternatives({
            activity_name: row.activity_name || row.activity || '',
            skill_name: row.skill_name || '',
            category: 'new_items',
            chest_name: row.chest_name || null,
            gearset_slots: slots,
            result_id: row.id,
        }));
        if (!resp || !resp.success) return null;
        const merged = {};
        for (const src of [resp.alternatives, resp.locked_alternatives, resp.hidden_alternatives]) {
            if (!src || typeof src !== 'object') continue;
            for (const slot of Object.keys(src)) {
                merged[slot] = (merged[slot] || []).concat(Array.isArray(src[slot]) ? src[slot] : []);
            }
        }
        return Object.keys(merged).length ? merged : null;
    }

    // Toggle the per-entry optimized-gearset preview (Gear ▸ button).
    _toggleEntryGear(entryId) {
        const wrap = this._el && this._el.querySelector(`.iut-entry-gear[data-entry-id="${entryId}"]`);
        const btn = this._el && this._el.querySelector(`.iut-gear-btn[data-entry-id="${entryId}"]`);
        if (!wrap) return;
        const open = wrap.getAttribute('data-open') === '1';
        if (open) {
            const $ = window.$ || window.jQuery;
            if ($) $(wrap).stop(true, true).slideUp(150); else wrap.style.display = 'none';
            wrap.setAttribute('data-open', '0');
            if (btn) btn.querySelector('.iut-gear-arrow')?.classList.remove('expanded');
            return;
        }
        const e = this._entries.find(x => x.entry_id === entryId);
        const exp = e && e.display && e.display.gearset_export;
        if (!exp) { wrap.innerHTML = `<div class="iut-gear-empty">No gearset available — run the Optimized Goals Report for this activity.</div>`; }
        else {
            let html = '';
            try { html = renderMiniGearPreview(decodeGearsetSlots(exp) || {}); } catch (_) { html = ''; }
            wrap.innerHTML = html || `<div class="iut-gear-empty">Could not render this gearset.</div>`;
        }
        wrap.setAttribute('data-open', '1');
        if (btn) btn.querySelector('.iut-gear-arrow')?.classList.add('expanded');
        const $ = window.$ || window.jQuery;
        if ($) $(wrap).stop(true, true).hide().slideDown(180); else wrap.style.display = 'block';
    }

    // Improvement magnitude for a stored alternative (steps saved). Mirrors
    // nonowned-upgrades-section.improvementMagnitude.
    _improvementMag(alt) {
        if (!alt) return 0;
        if (alt.delta != null && isFinite(alt.delta)) return Math.abs(alt.delta);
        if (alt.delta_pct != null && isFinite(alt.delta_pct) && alt.old_value != null) {
            return Math.abs(alt.old_value) * Math.abs(alt.delta_pct) / 100;
        }
        if (alt.old_value != null && alt.new_value != null) return Math.abs(alt.new_value - alt.old_value);
        return 0;
    }

    // Build item_slug -> { steps, label } from the new_items result rows.
    _buildObtainIndex(results) {
        const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        const bySlug = new Map();
        const ni = results && results.new_items;
        const rows = Array.isArray(ni) ? ni : Object.values(ni || {});
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const mj = row.metrics_json || row.metricsJson || {};
            const kind = (mj.best_drop && mj.best_drop.kind) || 'gear';
            const label = 'Activity drop';
            const items = (mj.combined && Array.isArray(mj.combined.items)) ? mj.combined.items : [];
            for (const it of items) {
                if (!it || it.steps == null) continue;
                const rec = { steps: it.steps, label };
                // Key by BOTH the ref-norm and the clean name-slug so lookups by
                // either an item_ref-derived slug OR a slot-alternative's name hit.
                for (const slug of [norm(it.item_ref || it.item_name), _nameSlug(it.item_name)]) {
                    if (!slug) continue;
                    const prev = bySlug.get(slug);
                    if (!prev || it.steps < prev.steps) bySlug.set(slug, rec);
                }
            }
            // Fall back to the best_drop headline steps when there's no per-item list.
            if (mj.best_drop && mj.combined && mj.combined.best_steps != null) {
                const slug = norm(mj.best_drop.item_ref || mj.best_drop.item_name);
                if (slug && !bySlug.has(slug)) bySlug.set(slug, { steps: mj.combined.best_steps, label });
            }
        }
        return bySlug;
    }

    _openPicker() {
        openUpgradesTrackerAddPopup({
            existingKeys: this._entries.map(entryKey),
            onSelect: (entries) => this._addEntries(entries),
        });
    }

    // Inline two-click confirm on the ✕ (replaces window.confirm, which some
    // browsers suppress after repeated dialogs — the reported "no dialog" bug).
    _handleRemoveClick(btn) {
        const entryId = btn.getAttribute('data-entry-id');
        if (btn.getAttribute('data-armed') === '1') { this._removeEntry(entryId); return; }
        // Disarm any other armed remove button first.
        this._el.querySelectorAll('.iut-entry-remove[data-armed="1"]').forEach(b => {
            b.setAttribute('data-armed', '0'); b.textContent = '✕'; b.classList.remove('iut-entry-remove-armed');
            b.title = 'Remove from tracker';
        });
        btn.setAttribute('data-armed', '1');
        btn.textContent = '✓ Remove?';
        btn.title = 'Click again to remove';
        btn.classList.add('iut-entry-remove-armed');
        clearTimeout(this._removeArmTimer);
        this._removeArmTimer = setTimeout(() => {
            if (!btn.isConnected) return;
            btn.setAttribute('data-armed', '0'); btn.textContent = '✕';
            btn.classList.remove('iut-entry-remove-armed'); btn.title = 'Remove from tracker';
        }, 3000);
    }

    _confirmRemove(entryId) { this._removeEntry(entryId); }

    _toast(msg) {
        try { if (api && typeof api.showInfo === 'function') { api.showInfo(msg); return; } } catch (_) {}
        // Fallback: transient inline banner.
        let b = this._el.querySelector('.iut-toast');
        if (!b) { b = document.createElement('div'); b.className = 'iut-toast'; this._el.querySelector('.iut-inner')?.appendChild(b); }
        b.textContent = msg; b.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => b.classList.remove('visible'), 3000);
    }

    // ---- styles -----------------------------------------------------------

    _injectStyles() {
        if (document.getElementById('iut-styles')) return;
        const css = `
        .upgrades-tracker-page { display: none; }
        .upgrades-tracker-page.opening, .upgrades-tracker-page.closing {
            display: block; position: fixed; left: 0; right: 0; bottom: 0; top: var(--iut-top, 56px);
            z-index: 900; background: var(--bg-primary, #14161c); overflow-y: auto; -webkit-overflow-scrolling: touch;
            overscroll-behavior: none; }
        /* Mirror the goals-report / bank overlay fade. NO 'forwards' on open +
           transform:none at rest — the iOS touch-desync fix used by .stats-report-page. */
        .upgrades-tracker-page.opening { opacity: 1; transform: none; animation: iutOpen 0.3s ease-out; }
        .upgrades-tracker-page.closing { animation: iutClose 0.25s ease-in forwards; }
        @keyframes iutOpen { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes iutClose { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.97); } }
        .upgrades-tracker-page .iut-inner { max-width: 1100px; margin: 0 auto; padding: 16px 18px 60px; position: relative; }
        .upgrades-tracker-page .iut-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
            border-bottom: 1px solid var(--border-color, #2a2e39); padding-bottom: 12px; }
        .upgrades-tracker-page .iut-title { margin: 0; flex: 0 0 auto; color: var(--text-primary, #fff);
            font-size: max(var(--min-text, 5px), calc(20px * var(--text-scale, 1))); }
        .upgrades-tracker-page .iut-close { flex: 0 0 auto; background: transparent; border: none; cursor: pointer;
            color: var(--text-secondary, #9aa0ac); font-size: 20px; line-height: 1; padding: 6px 8px; border-radius: 6px; }
        .upgrades-tracker-page .iut-close:hover { color: var(--text-primary, #fff); background: var(--bg-secondary, #1d2028); }
        .upgrades-tracker-page .iut-section { margin-bottom: 22px; }
        .upgrades-tracker-page .iut-section-head { display: flex; align-items: center; justify-content: space-between;
            gap: 10px; margin-bottom: 8px; }
        .upgrades-tracker-page .iut-section-title { color: var(--text-primary, #fff);
            font-size: max(var(--min-text, 5px), calc(15px * var(--text-scale, 1))); font-weight: 600; }
        .upgrades-tracker-page .iut-btn { cursor: pointer; border: 1px solid var(--border-color, #2a2e39);
            background: var(--bg-secondary, #1d2028); color: var(--text-primary, #fff); border-radius: 8px; padding: 7px 14px;
            font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1))); }
        .upgrades-tracker-page .iut-add-btn { background: #2fa347 !important; border-color: #2fa347 !important; color: #fff !important; }
        .upgrades-tracker-page .iut-add-btn:hover { background: #41c25e !important; border-color: #41c25e !important; }
        .upgrades-tracker-page .iut-section-actions { display: flex; justify-content: center; margin: 10px 0 14px; }
        /* Center the preset (Save + name + ▼) group in the header and make the
           search field longer, matching the crafting-tree bar's feel. */
        .upgrades-tracker-page .iut-preset-manager { flex: 0 1 auto; margin-left: auto; margin-right: auto; justify-content: center; }
        .upgrades-tracker-page .crafting-tree-preset-dropdown-btn { flex: 0 0 auto; width: clamp(220px, 38vw, 440px); }
        .iut-preset-dropdown .iut-preset-count { color: var(--text-secondary,#9aa0ac); font-size: 0.85em; margin-left: auto; padding: 0 8px; }
        .iut-preset-dropdown .iut-preset-empty, .iut-preset-dropdown .iut-preset-loading { color: var(--text-secondary,#9aa0ac); padding: 8px 10px; font-size: 0.9em; }
        .upgrades-tracker-page .iut-entry { display: grid; grid-template-columns: minmax(180px,1fr) 2fr auto; gap: 10px;
            align-items: center; padding: 8px 10px; border: 1px solid var(--border-color, #23262f); border-radius: 8px; margin-bottom: 6px; }
        .upgrades-tracker-page .iut-entry-wrap { margin-bottom: 6px; }
        .upgrades-tracker-page .iut-entry-wrap .iut-entry { margin-bottom: 0; }
        .upgrades-tracker-page .iut-gear-btn { font-size: 0.82em; padding: 3px 10px; margin-left: 6px; }
        .upgrades-tracker-page .iut-gear-arrow { display: inline-block; transition: transform 0.18s ease; }
        .upgrades-tracker-page .iut-gear-arrow.expanded { transform: rotate(90deg); }
        .upgrades-tracker-page .iut-entry-gear { padding: 8px 10px; border: 1px solid var(--border-color, #23262f); border-top: none;
            border-radius: 0 0 8px 8px; background: var(--bg-secondary, #1d2028); }
        .upgrades-tracker-page .iut-gear-empty { color: var(--text-secondary, #9aa0ac); font-size: 0.9em; padding: 4px 2px; }
        .upgrades-tracker-page .iut-spinner { display: inline-block; width: 14px; height: 14px; margin-left: 8px; vertical-align: middle;
            border: 2px solid var(--border-color, #2a2e39); border-top-color: #2fa347; border-radius: 50%; animation: iutSpin 0.7s linear infinite; }
        @keyframes iutSpin { to { transform: rotate(360deg); } }
        .upgrades-tracker-page .iut-entry-type { color: var(--text-secondary, #9aa0ac); font-size: 0.85em; }
        .upgrades-tracker-page .iut-entry-name { display: flex; align-items: center; gap: 8px; color: var(--text-primary, #fff); }
        .upgrades-tracker-page .iut-entry-target { color: var(--text-secondary, #9aa0ac); font-size: 0.85em; }
        .upgrades-tracker-page .iut-entry-remove { background: transparent; border: none; color: var(--text-secondary, #9aa0ac);
            cursor: pointer; font-size: 15px; padding: 4px 8px; border-radius: 6px; }
        .upgrades-tracker-page .iut-entry-remove:hover { color: #ff6b6b; background: var(--bg-secondary, #1d2028); }
        .upgrades-tracker-page .iut-entry-remove-armed { color: #fff !important; background: #c0392b !important; font-size: 0.8em; padding: 3px 8px; white-space: nowrap; }
        .upgrades-tracker-page .iut-empty-inline, .upgrades-tracker-page .iut-table-empty {
            color: var(--text-secondary, #9aa0ac); padding: 14px; text-align: center; line-height: 1.5; }
        .upgrades-tracker-page .iut-table { width: 100%; border-collapse: collapse; }
        .upgrades-tracker-page .iut-table th, .upgrades-tracker-page .iut-table td {
            text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color, #23262f);
            font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1))); color: var(--text-primary, #fff); }
        .upgrades-tracker-page .iut-table th { color: var(--text-secondary, #9aa0ac); font-weight: 600; cursor: pointer; }
        .upgrades-tracker-page .iut-td-item { display: flex; align-items: center; gap: 8px; }
        /* Item-upgrade icons: 16x16 with a per-rarity drop-shadow outline (mirrors .item-row .item-icon). */
        .upgrades-tracker-page .iut-item-icon { width: 16px; height: 16px; flex-shrink: 0; object-fit: contain; image-rendering: pixelated;
            filter: drop-shadow(1px 0 0 var(--rarity-common-border)) drop-shadow(-1px 0 0 var(--rarity-common-border)) drop-shadow(0 1px 0 var(--rarity-common-border)) drop-shadow(0 -1px 0 var(--rarity-common-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-uncommon { filter: drop-shadow(1px 0 0 var(--rarity-uncommon-border)) drop-shadow(-1px 0 0 var(--rarity-uncommon-border)) drop-shadow(0 1px 0 var(--rarity-uncommon-border)) drop-shadow(0 -1px 0 var(--rarity-uncommon-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-rare { filter: drop-shadow(1px 0 0 var(--rarity-rare-border)) drop-shadow(-1px 0 0 var(--rarity-rare-border)) drop-shadow(0 1px 0 var(--rarity-rare-border)) drop-shadow(0 -1px 0 var(--rarity-rare-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-epic { filter: drop-shadow(1px 0 0 var(--rarity-epic-border)) drop-shadow(-1px 0 0 var(--rarity-epic-border)) drop-shadow(0 1px 0 var(--rarity-epic-border)) drop-shadow(0 -1px 0 var(--rarity-epic-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-legendary { filter: drop-shadow(1px 0 0 var(--rarity-legendary-border)) drop-shadow(-1px 0 0 var(--rarity-legendary-border)) drop-shadow(0 1px 0 var(--rarity-legendary-border)) drop-shadow(0 -1px 0 var(--rarity-legendary-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-ethereal { filter: drop-shadow(1px 0 0 var(--rarity-ethereal-border)) drop-shadow(-1px 0 0 var(--rarity-ethereal-border)) drop-shadow(0 1px 0 var(--rarity-ethereal-border)) drop-shadow(0 -1px 0 var(--rarity-ethereal-border)); }
        .upgrades-tracker-page .iut-item-icon.rarity-fine, .upgrades-tracker-page .iut-item-icon.fine { filter: drop-shadow(1px 0 0 var(--fine-color)) drop-shadow(-1px 0 0 var(--fine-color)) drop-shadow(0 1px 0 var(--fine-color)) drop-shadow(0 -1px 0 var(--fine-color)); }
        .upgrades-tracker-page .iut-upg-row { cursor: pointer; }
        .upgrades-tracker-page .iut-upg-row:hover { background: var(--bg-secondary, #1d2028); }
        .upgrades-tracker-page .iut-upg-arrow { margin-right: 4px; }
        .upgrades-tracker-page .iut-upg-detail > td { background: var(--bg-secondary, #1d2028); padding: 0; }
        .upgrades-tracker-page .iut-upg-detail-inner { padding: 8px 14px; font-size: max(var(--min-text, 5px), calc(13.5px * var(--text-scale, 1))); }
        .upgrades-tracker-page .iut-upg-actions { margin-bottom: 8px; align-items: center; gap: 8px; }
        .upgrades-tracker-page .iut-upg-actions .wiki-link { margin-left: 4px; }
        .upgrades-tracker-page .iut-sources-container { margin-bottom: 8px; }
        .upgrades-tracker-page .iut-calc-btn { margin-left: 6px; cursor: pointer; border: 1px solid var(--accent-primary, #3b82f6);
            background: transparent; color: var(--accent-primary, #3b82f6); border-radius: 6px; padding: 2px 8px; font-size: 0.85em; }
        .upgrades-tracker-page .iut-calc-btn:hover { background: rgba(59,130,246,0.12); }
        .upgrades-tracker-page .iut-toast { position: sticky; bottom: 10px; margin: 10px auto 0; max-width: 480px; text-align: center;
            background: var(--bg-secondary,#1d2028); border: 1px solid var(--border-color,#2a2e39); border-radius: 8px;
            padding: 8px 12px; color: var(--text-primary,#fff); display: none; }
        .upgrades-tracker-page .iut-toast.visible { display: block; }
        .upgrades-tracker-page .iut-toolbar { display: flex; gap: 6px; margin-right: 8px; flex: 0 0 auto; }
        .upgrades-tracker-page .iut-cur-name { color: #7cc00a; font-weight: 600; }
        .iut-load-pop { position: absolute; z-index: 1300; min-width: 260px; max-width: 340px;
            background: var(--bg-primary,#14161c); border: 1px solid var(--border-color,#2a2e39);
            border-radius: 8px; padding: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.4); }
        .iut-load-search { width: 100%; box-sizing: border-box; padding: 6px 8px; margin-bottom: 6px; border-radius: 6px;
            border: 1px solid var(--border-color,#2a2e39); background: var(--bg-secondary,#1d2028); color: var(--text-primary,#fff); }
        .iut-load-list { max-height: 240px; overflow-y: auto; }
        .iut-load-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer;
            color: var(--text-primary,#fff); }
        .iut-load-item:hover { background: var(--bg-secondary,#1d2028); }
        .iut-load-name { flex: 1; }
        .iut-load-count { color: var(--text-secondary,#9aa0ac); font-size: 0.85em; }
        .iut-load-del { background: transparent; border: none; color: var(--text-secondary,#9aa0ac); cursor: pointer; padding: 2px 6px; border-radius: 5px; }
        .iut-load-del:hover { color: #ff6b6b; background: rgba(255,107,107,0.12); }
        .iut-load-empty { color: var(--text-secondary,#9aa0ac); padding: 8px; font-size: 0.9em; }
        `;
        const style = document.createElement('style');
        style.id = 'iut-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
}

export default UpgradesTrackerPage;
