/**
 * bank-page.js — Bank Layout Simulator page (Phase 1b).
 *
 * Hash-routed (#bank), wired into handleHashChange() in main.js. On open it loads
 * real inventory (catalog + owned store, via bank-adapter), mounts the shell view
 * (bank-view.js), the editor modal (bank-editor.js), and a preset bar that persists
 * layouts through /api/bank/* (save / load / delete / share / community copy).
 *
 * Spec: .kiro/BANK_LAYOUT_SPEC.md
 */
import { BankView } from './bank-view.js';
import { BankEditor } from './bank-editor.js';
import { bankApi } from './bank-api.js';
import { wireInfoIcons } from '../info-popover.js';
import { loadBankItems, getBankItems } from './bank-adapter.js';
import { decodeLayoutImport, encodeLayoutExport, importedPlacements, parseGameExport } from './bank-schema.js';
import { DEFAULT_LAYOUT_V2 } from './bank-default-layout.js';
import { filterSetMatches } from './bank-engine.js';

function uid() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8)
        : 'id' + Math.random().toString(36).slice(2, 10);
}

function defaultLayout() {
    // Everyone starts on the in-game DEFAULT layout (the "New layout" chooser offers
    // default / blank / copy-current / copy-existing).
    return parseGameExport(clone(DEFAULT_LAYOUT_V2));
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/** A truly empty layout: one bare tab, no filters/categories. */
function blankLayout() {
    return {
        name: 'New layout', schemaVersion: 1, settings: { view: 'grid' }, pins: {},
        tabs: [{ id: 'tab-' + Math.random().toString(36).slice(2, 8), name: 'Tab 1', color: '#888', bgShape: 'none', icon: '', filters: [], categories: [] }],
    };
}

// Client-side autosave of the in-progress (unsaved) working layout. Distinct
// from named server-saved presets — this just remembers what you were building
// so navigating away / reloading doesn't reset you to the default layout.
const WORKING_LAYOUT_KEY = 'bank_working_layout_v2';
function loadWorkingLayout() {
    try {
        const raw = localStorage.getItem(WORKING_LAYOUT_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (d && d.layout && Array.isArray(d.layout.tabs)) return d;
    } catch (_e) { /* corrupt / unavailable */ }
    return null;
}

export class BankPage {
    constructor(selector) {
        this.el = document.querySelector(selector);
        this.layout = defaultLayout();
        this.currentId = null;   // saved-layout id, null = unsaved
        this.dirty = false;
        // Restore the in-progress (unsaved) working layout so leaving/reloading the
        // page doesn't drop it back to the default. Kept in sync on every mutation
        // via _persistWorking() (called from _recordUndo + undo/redo apply).
        const _w = loadWorkingLayout();
        if (_w) { this.layout = _w.layout; this.currentId = _w.currentId || null; }
        // Flush any pending server save when the tab is backgrounded/closed (keepalive).
        window.addEventListener('pagehide', () => this._flushWorkingToServer(true));
        this.editor = new BankEditor();
        this._built = false;
        this.itemHistory = {};
        this._closeTimer = null;
    }

    _build() {
        if (this._built || !this.el) return;
        this.el.innerHTML = `
            <div class="bank-page-inner">
                <div class="bank-page-head" role="button" tabindex="0" aria-label="Collapse layout controls">
                    <img src="/assets/icons/ui/bank_icon.svg" alt="" width="28" height="28">
                    <h2>Bank Layouts</h2>
                    <span class="bank-chrome-chevron expand-arrow" aria-hidden="true">▼</span>
                    <span style="flex:1"></span>
                    <button class="bank-close-btn" aria-label="Close">×</button>
                </div>
                <div class="bank-chrome"><div class="bank-chrome-inner">
                <div class="bank-preset-bar gear-set-manager">
                    <div class="gear-set-header">
                        <button class="save-button bank-save-btn" disabled>Save</button>
                        <div class="bank-dd-anchor">
                            <div class="gear-set-dropdown-button">
                                <input type="text" class="gear-set-name-input bank-name-input" placeholder="New layout" maxlength="60">
                                <button class="dropdown-toggle bank-dropdown-toggle"><span class="expand-arrow">▼</span></button>
                            </div>
                            <div class="gear-set-dropdown bank-dropdown" style="display:none"></div>
                        </div>
                        <label class="bank-share-label"><input type="checkbox" class="bank-share"> Share</label>
                        <button class="button bank-community-btn">Community</button>
                        <button class="button bank-import-btn">Import</button>
                        <button class="button bank-export-btn">Export</button>
                        <span class="bank-status"></span>
                    </div>
                    <div class="bank-import-row" style="display:none">
                        <input type="text" class="bank-import-input" placeholder="Paste layout export string, press Enter…">
                    </div>
                </div>
                <div class="bank-community-panel" style="display:none"></div>
                </div></div>
                <div class="bank-ph-row">
                    <label class="bank-ph-label"><input type="checkbox" class="bank-ph-check"> Show non-owned items as placeholders</label>
                    <span class="travel-info-icon" data-info="Items you don't have and didn't have in their spot when they appear." role="button" tabindex="0" aria-label="About placeholders" style="font-style:normal;cursor:pointer;">ⓘ</span>
                </div>
                <div class="bank-view-root"></div>
            </div>`;
        this.el.querySelector('.bank-close-btn').addEventListener('click', (e) => { e.stopPropagation(); window.location.hash = ''; });

        // Collapse the top chrome (preset/save bar + coverage) into just the header.
        // Clicking anywhere on the header row toggles; the × still closes the page.
        const head = this.el.querySelector('.bank-page-head');
        const toggleChrome = () => {
            this._chromeCollapsed = !this._chromeCollapsed;
            this.el.querySelector('.bank-page-inner').classList.toggle('chrome-collapsed', this._chromeCollapsed);
            head.setAttribute('aria-label', this._chromeCollapsed ? 'Expand layout controls' : 'Collapse layout controls');
        };
        head.addEventListener('click', (e) => { if (!e.target.closest('.bank-close-btn')) toggleChrome(); });
        head.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.bank-close-btn')) { e.preventDefault(); toggleChrome(); }
        });

        this.view = new BankView(this.el.querySelector('.bank-view-root'), {
            layout: this.layout,
            onEditNode: (node, kind, tabId) => this._edit(node, kind, tabId),
            onAddCategory: (tabId) => this._addCategory(tabId),
            onAddTab: () => this._addTab(),
            onEditTab: (tab) => this._edit(tab, 'tab'),
            onDeleteTab: (tabId) => this._deleteTab(tabId),
            onDeleteCategory: (catId) => this._deleteCategory(catId),
            onLayoutChanged: () => { this.dirty = true; this._status('Unsaved changes'); this._recordUndo(); this._syncSaveEnabled(); },
            onPinned: (itemId, tabId, catId) => this._recordPlacement(itemId, tabId, catId),
        });

        const nameInput = this.el.querySelector('.bank-name-input');
        nameInput.addEventListener('input', () => { this.layout.name = nameInput.value; this._syncSaveEnabled(); });
        this.el.querySelector('.bank-save-btn').addEventListener('click', () => this._save());
        this.el.querySelector('.bank-dropdown-toggle').addEventListener('click', () => this._toggleDropdown());
        this.el.querySelector('.bank-share').addEventListener('change', (e) => this._toggleShare(e.target.checked));
        this.el.querySelector('.bank-ph-check').addEventListener('change', (e) => {
            this.layout.settings = this.layout.settings || {};
            this.layout.settings.showPlaceholders = e.target.checked;
            this.dirty = true; this._status('Unsaved changes'); this._recordUndo();
            this.view.setLayout(this.layout);
        });
        this.el.querySelector('.bank-community-btn').addEventListener('click', () => this._toggleCommunity());
        this.el.querySelector('.bank-import-btn').addEventListener('click', () => this._toggleImport());
        this.el.querySelector('.bank-export-btn').addEventListener('click', () => this._export());
        const importInput = this.el.querySelector('.bank-import-input');
        importInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._import(importInput.value); });
        // Close the preset dropdown on an outside click.
        this.el.addEventListener('click', (e) => {
            if (!e.target.closest('.gear-set-dropdown-button') && !e.target.closest('.bank-dropdown')) {
                const dd = this.el.querySelector('.bank-dropdown');
                if (dd && dd.style.display !== 'none') this._toggleDropdown(false);
            }
        });
        // Undo/redo delegates to the global manager (bottom-right buttons + Ctrl+Z).
        this._undoProvider = {
            capture: () => JSON.stringify({ layout: this.layout, currentId: this.currentId }),
            apply: (snap) => {
                const d = JSON.parse(snap);
                this.layout = d.layout; this.currentId = d.currentId; this.dirty = true;
                this.view.setLayout(this.layout);
                const ni = this.el.querySelector('.bank-name-input'); if (ni) ni.value = this.layout.name || '';
                this._syncSaveEnabled();
                this._persistWorking();
            },
        };
        wireInfoIcons(this.el);
        this._built = true;
    }

    // ---- undo / redo: delegate to the global manager via a provider ----
    _recordUndo() { if (window.undoRedoManager) window.undoRedoManager.pushState(); this._persistWorking(); }

    // Persist the working layout. localStorage is a fast-paint cache; the SERVER copy
    // (per session) is the source of truth so the same session resumes on any device.
    // Server writes are debounced to avoid hammering the endpoint during drags.
    _persistWorking() {
        try {
            localStorage.setItem(WORKING_LAYOUT_KEY, JSON.stringify({ layout: this.layout, currentId: this.currentId }));
        } catch (_e) { /* quota / unavailable — non-fatal */ }
        this._workingServerDirty = true;
        clearTimeout(this._workingSaveTimer);
        this._workingSaveTimer = setTimeout(() => this._flushWorkingToServer(), 800);
    }

    /** Push the working layout to the server (per session). `keepalive` for page-unload. */
    _flushWorkingToServer(keepalive) {
        clearTimeout(this._workingSaveTimer); this._workingSaveTimer = null;
        if (!this._workingServerDirty) return;
        this._workingServerDirty = false;
        const body = JSON.stringify({ layout: this.layout, currentId: this.currentId });
        try {
            fetch('/api/bank/working-layout', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body, keepalive: !!keepalive,
            }).catch(() => { this._workingServerDirty = true; /* retry on next mutation */ });
        } catch (_e) { this._workingServerDirty = true; }
    }

    _status(msg) {
        const s = this.el?.querySelector('.bank-status');
        if (s) s.textContent = msg || '';
    }

    // ---- editor callbacks ----
    _edit(node, kind) {
        this.editor.open(node, kind, {
            onConfirm: (upd) => { Object.assign(node, upd); this.dirty = true; this.view.setLayout(this.layout); this._status('Unsaved changes'); this._recordUndo(); },
        });
    }
    _addCategory(tabId) {
        const tab = this.layout.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        const node = { id: uid(), name: 'New category', color: '#888888', bgShape: 'circle', filters: [] };
        this.editor.open(node, 'category', {
            onConfirm: (upd) => { Object.assign(node, upd); (tab.categories = tab.categories || []).push(node); this.dirty = true; this.view.setLayout(this.layout); this._recordUndo(); },
        });
    }
    _addTab() {
        const node = { id: uid(), name: 'New tab', color: '#888888', bgShape: 'circle', filters: [], categories: [] };
        this.editor.open(node, 'tab', {
            onConfirm: (upd) => { Object.assign(node, upd); this.layout.tabs.push(node); this.view.activeTabId = node.id; this.dirty = true; this.view.setLayout(this.layout); this._recordUndo(); },
        });
    }
    _deleteTab(tabId) {
        const i = this.layout.tabs.findIndex((t) => t.id === tabId);
        if (i < 0) return;
        if (this.layout.tabs.length <= 1) { this._status('Can’t delete the last tab'); return; }
        this.layout.tabs.splice(i, 1);
        this.view.activeTabId = (this.layout.tabs[Math.max(0, i - 1)] || this.layout.tabs[0]).id;
        this.dirty = true; this.view.setLayout(this.layout); this._recordUndo(); this._status('Tab deleted');
    }
    _deleteCategory(catId) {
        const tab = this.layout.tabs.find((t) => t.id === this.view.activeTabId);
        if (!tab || !Array.isArray(tab.categories)) return;
        const i = tab.categories.findIndex((c) => c.id === catId);
        if (i < 0) return;
        tab.categories.splice(i, 1);
        this.dirty = true; this.view.setLayout(this.layout); this._recordUndo(); this._status('Category deleted');
    }

    // ---- persistence (gear-set-style preset manager) ----
    _syncSaveEnabled() {
        const btn = this.el && this.el.querySelector('.bank-save-btn');
        if (btn) btn.disabled = !(this.layout.name || '').trim();
        const ph = this.el && this.el.querySelector('.bank-ph-check');
        if (ph) ph.checked = (this.layout.settings ? this.layout.settings.showPlaceholders !== false : true);
    }
    _settingsForSave() { return { ...(this.layout.settings || {}), pins: this.layout.pins || {} }; }

    _applyLoaded(data) {
        const settings = data.settings || {};
        this.layout = {
            name: data.name, schemaVersion: data.schemaVersion || 1, icon: data.icon,
            settings, pins: settings.pins || {}, tabs: data.tabs || [],
        };
        this.currentId = data.id || null;
        this.dirty = false;
        this.view.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
        this.view.setLayout(this.layout);
        const ni = this.el.querySelector('.bank-name-input'); if (ni) ni.value = this.layout.name || '';
        this._syncSaveEnabled();
        this._recordUndo();
    }

    async _refreshPresets(currentId) {
        try {
            const { layouts } = await bankApi.list();
            this._presets = layouts || [];
            const cur = currentId != null ? currentId : this.currentId;
            const active = this._presets.find((l) => l.id === cur);
            const share = this.el.querySelector('.bank-share'); if (share) share.checked = !!(active && active.is_shared);
            this._syncSaveEnabled();
            if (this.el.querySelector('.bank-dropdown').style.display !== 'none') this._renderDropdown();
        } catch (e) { this._status('Could not load layouts'); }
    }

    _renderDropdown() {
        const dd = this.el.querySelector('.bank-dropdown');
        const rows = (this._presets || []).map((l) => `<div class="gear-set-item bank-preset-item" data-id="${esc(l.id)}">
            <span class="gear-set-name">${esc(l.name)}${l.is_shared ? ' 🔗' : ''}</span>
            <button class="delete-button bank-preset-del" data-id="${esc(l.id)}">×</button>
        </div>`).join('');
        dd.innerHTML = `<div class="gear-set-item bank-preset-new">+ New layout</div>${rows || '<div class="gear-set-item" style="opacity:0.6;font-style:italic">No saved layouts yet</div>'}`;
        dd.querySelector('.bank-preset-new').addEventListener('click', () => { this._newLayout(); this._toggleDropdown(false); });
        dd.querySelectorAll('.bank-preset-item').forEach((row) => row.addEventListener('click', (e) => {
            if (e.target.closest('.bank-preset-del')) return;
            this._loadPreset(row.dataset.id); this._toggleDropdown(false);
        }));
        dd.querySelectorAll('.bank-preset-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this._deletePreset(b.dataset.id); }));
    }

    _toggleDropdown(force) {
        const dd = this.el.querySelector('.bank-dropdown');
        if (!dd) return;
        const isOpen = dd.style.display !== 'none' && $(dd).is(':visible');
        const show = force != null ? force : !isOpen;
        const arrow = this.el.querySelector('.bank-dropdown-toggle .expand-arrow');
        // The chrome wrapper clips overflow (for the collapse slide); lift it while the
        // dropdown is open so the absolutely-positioned list isn't cut off / hidden behind
        // the coverage section below.
        const chromeInner = this.el.querySelector('.bank-chrome-inner');
        if (show) {
            if (chromeInner) chromeInner.style.overflow = 'visible';
            this._renderDropdown();
            $(dd).stop(true, true).slideDown(200);
            arrow?.classList.add('expanded');
        } else {
            $(dd).stop(true, true).slideUp(200, () => { if (chromeInner) chromeInner.style.overflow = ''; });
            arrow?.classList.remove('expanded');
        }
    }

    _newLayout() {
        this._toggleDropdown(false);
        this._openNewLayoutChooser();
    }

    /** Apply an arbitrary layout object as a fresh, unsaved layout. */
    _applyNewLayout(layout, name) {
        this.layout = {
            name: name != null ? name : (layout.name || 'New layout'),
            schemaVersion: layout.schemaVersion || 1,
            icon: layout.icon || '',
            settings: layout.settings || { view: 'grid' },
            pins: layout.pins || {},
            tabs: layout.tabs || [],
        };
        this.currentId = null; this.dirty = true;
        this.view.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
        this.view.setLayout(this.layout);
        const ni = this.el.querySelector('.bank-name-input'); if (ni) ni.value = this.layout.name;
        this._syncSaveEnabled(); this._status('New layout'); this._recordUndo();
    }

    _closeNewLayoutChooser(animate = true) {
        const ov = this.el.querySelector('.bank-chooser-overlay'); if (!ov) return;
        if (animate) { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); }
        else ov.remove();
    }

    _openNewLayoutChooser() {
        this._closeNewLayoutChooser(false);
        const presets = this._presets || [];
        const ov = document.createElement('div');
        ov.className = 'bank-chooser-overlay';
        ov.innerHTML = `
            <div class="bank-chooser" role="dialog" aria-label="New layout">
                <h3>New layout</h3>
                <button class="bank-chooser-opt" data-choice="default">Default layout<span>the in-game default</span></button>
                <button class="bank-chooser-opt" data-choice="blank">Blank layout<span>start empty</span></button>
                <button class="bank-chooser-opt" data-choice="current">Copy current layout<span>duplicate what's on screen</span></button>
                <button class="bank-chooser-opt" data-choice="existing"${presets.length ? '' : ' disabled'}>Copy a saved layout…<span>${presets.length ? 'pick one below' : 'no saved layouts yet'}</span></button>
                <div class="bank-chooser-presets" style="display:none"></div>
                <button class="bank-chooser-cancel">Cancel</button>
            </div>`;
        this.el.appendChild(ov);
        requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('show')));
        const close = () => this._closeNewLayoutChooser();
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        ov.querySelector('.bank-chooser-cancel').addEventListener('click', close);
        ov.querySelectorAll('.bank-chooser-opt').forEach((b) => b.addEventListener('click', () => {
            const c = b.dataset.choice;
            if (c === 'default') { this._applyNewLayout(parseGameExport(clone(DEFAULT_LAYOUT_V2)), 'Default layout'); close(); }
            else if (c === 'blank') { this._applyNewLayout(blankLayout(), 'New layout'); close(); }
            else if (c === 'current') { this._applyNewLayout(clone(this.layout), 'Copy of ' + (this.layout.name || 'layout')); close(); }
            else if (c === 'existing' && presets.length) { this._renderChooserPresets(ov); }
        }));
    }

    _renderChooserPresets(ov) {
        const box = ov.querySelector('.bank-chooser-presets');
        if (!box) return;
        box.style.display = 'block';
        box.innerHTML = (this._presets || []).map((l) => `<button class="bank-chooser-preset" data-id="${esc(l.id)}">${esc(l.name)}</button>`).join('')
            || '<div class="bank-f-empty">No saved layouts.</div>';
        box.querySelectorAll('.bank-chooser-preset').forEach((b) => b.addEventListener('click', async () => {
            try {
                const data = await bankApi.load(b.dataset.id);
                this._applyNewLayout(
                    { name: data.name, schemaVersion: data.schemaVersion, icon: data.icon, settings: data.settings || {}, pins: (data.settings && data.settings.pins) || {}, tabs: data.tabs || [] },
                    'Copy of ' + (data.name || 'layout'),
                );
            } catch (e) { this._status('Load failed'); }
            this._closeNewLayoutChooser();
        }));
    }

    async _loadPreset(id) {
        try { this._applyLoaded(await bankApi.load(id)); this._status('Loaded'); await this._refreshPresets(id); }
        catch (e) { this._status('Load failed'); }
    }

    async _save() {
        const name = (this.layout.name || '').trim();
        if (!name) { this._status('Enter a name first'); return; }
        try {
            if (this.currentId) {
                await bankApi.update(this.currentId, name, this.layout.tabs, this._settingsForSave());
            } else {
                const { id } = await bankApi.create(name, this.layout.tabs, this._settingsForSave());
                this.currentId = id;
            }
            this.dirty = false; this._status('Saved'); this._persistPlacements(); this._persistWorking();
            await this._refreshPresets(this.currentId);
        } catch (e) { this._status('Save failed'); }
    }

    async _deletePreset(id) {
        if (!window.confirm('Delete this layout?')) return;
        try {
            await bankApi.remove(id);
            if (id === this.currentId) this._applyNewLayout(blankLayout(), 'New layout');
            this._status('Deleted'); await this._refreshPresets();
        } catch (e) { this._status('Delete failed'); }
    }

    async _toggleShare(shared) {
        if (!this.currentId) { this._status('Save the layout before sharing'); this.el.querySelector('.bank-share').checked = false; return; }
        try { await bankApi.setShare(this.currentId, shared); this._status(shared ? 'Shared to community' : 'Unshared'); await this._refreshPresets(); }
        catch (e) { this._status('Share failed'); }
    }

    // ---- import / export (v2 game format; gzip base64) ----
    _toggleImport() {
        const row = this.el.querySelector('.bank-import-row');
        row.style.display = row.style.display === 'none' ? 'block' : 'none';
        if (row.style.display === 'block') row.querySelector('.bank-import-input').focus();
    }
    async _import(str) {
        if (!str || !str.trim()) return;
        this._status('Importing…');
        try {
            const layout = await decodeLayoutImport(str.trim());
            this.layout = { ...layout, settings: layout.settings || { view: 'grid', showPlaceholders: true }, pins: layout.pins || {} };
            this.currentId = null; this.dirty = true;
            this.view.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
            this.view.setLayout(this.layout);
            this.el.querySelector('.bank-import-row').style.display = 'none';
            const ni = this.el.querySelector('.bank-name-input'); if (ni) ni.value = this.layout.name || '';
            this._resolveImportedPlacements();
            this._syncSaveEnabled(); this._recordUndo();
            this._status(`Imported "${this.layout.name}"`);
        } catch (e) { this._status('Import failed — not a valid export'); }
    }

    /** Resolve the imported category `_i` / tab `_u` arrays into pins (for items that
     *  don't already land via filters) + placeholder-history homes (for ghosts). */
    _resolveImportedPlacements() {
        const items = getBankItems();
        const byId = new Map();
        const bySlug = new Map();
        for (const it of items) {
            byId.set(it.id, it);
            const s = this._slugKey(it.id);
            if (!bySlug.has(s)) bySlug.set(s, it);
        }
        const catFilters = {};
        for (const tab of this.layout.tabs) for (const cat of (tab.categories || [])) catFilters[cat.id] = cat.filters || [];
        const pins = {};
        const history = {};
        for (const p of importedPlacements(this.layout)) {
            const it = byId.get(p.key) || bySlug.get(p.key);
            if (!it) continue;
            history[it.id] = { tab_id: p.tabId, cat_id: p.catId, order: p.order || 0 };
            // Pin only manual placements (items that would NOT auto-land here via filters).
            if (p.catId && !filterSetMatches(it, catFilters[p.catId] || [])) pins[it.id] = { tabId: p.tabId, catId: p.catId };
        }
        this.layout.pins = { ...(this.layout.pins || {}), ...pins };
        this.itemHistory = { ...this.itemHistory, ...history };
        this.view.setItemHistory(this.itemHistory); // re-render with pins + ghosts
        const rows = Object.entries(history).map(([item_id, v]) => ({ item_id, tab_id: v.tab_id, cat_id: v.cat_id, order: v.order }));
        if (rows.length) bankApi.setItemHistory(rows).catch(() => { /* noop */ });
    }

    _slugKey(id) {
        const m = String(id || '').match(/^item-(.+)-[0-9a-fA-F-]{30,}$/);
        return m ? m[1] : String(id || '');
    }
    async _export() {
        this._status('Exporting…');
        try {
            const manual = this.view.exportManualEntries();
            const code = await encodeLayoutExport(this.layout, {
                catItemEntries: this.view.exportCatItemEntries(),
                manualCatEntries: manual.cats,
                manualUncat: manual.uncat,
            });
            if (navigator.clipboard) await navigator.clipboard.writeText(code);
            this._status('Export copied to clipboard');
        } catch (e) { this._status('Export failed'); }
    }

    async _toggleCommunity() {
        const panel = this.el.querySelector('.bank-community-panel');
        if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
        panel.style.display = 'block';
        panel.innerHTML = '<div class="bank-f-empty">Loading community layouts…</div>';
        try {
            const { layouts, search_enabled } = await bankApi.community('');
            if (search_enabled === false) { panel.innerHTML = '<div class="bank-f-empty">Community sharing is currently disabled.</div>'; return; }
            panel.innerHTML = `<div class="bank-community-list">${
                layouts.length ? layouts.map((l) => `<div class="bank-community-row">
                    <span class="bank-community-name">${esc(l.name)}</span>
                    <button class="bank-community-view" data-share="${esc(l.share_id)}">Preview</button>
                    <button class="bank-community-copy" data-share="${esc(l.share_id)}">Copy</button>
                </div>`).join('') : '<div class="bank-f-empty">No shared layouts yet.</div>'}</div>`;
            panel.querySelectorAll('.bank-community-view').forEach((b) => b.addEventListener('click', () => this._previewCommunity(b.dataset.share)));
            panel.querySelectorAll('.bank-community-copy').forEach((b) => b.addEventListener('click', () => this._copyCommunity(b.dataset.share)));
        } catch (e) { panel.innerHTML = '<div class="bank-f-empty">Could not load community layouts.</div>'; }
    }

    async _previewCommunity(shareId) {
        try {
            const data = await bankApi.communityLoad(shareId);
            // read-only preview: render without changing currentId (Save becomes Copy conceptually)
            this.layout = { name: data.name, schemaVersion: data.schemaVersion || 1, settings: data.settings || {}, pins: (data.settings || {}).pins || {}, tabs: data.tabs || [] };
            this.currentId = null; this.dirty = false;
            this.view.setLayout(this.layout);
            this._status(`Previewing "${data.name}" (read-only) — use Copy to keep it`);
        } catch (e) { this._status('Preview failed'); }
    }

    async _copyCommunity(shareId) {
        const name = (window.prompt('Save community layout as:', 'Copied layout') || '').trim();
        if (!name) return;
        try {
            const { id } = await bankApi.copy(shareId, name);
            this._applyLoaded(await bankApi.load(id));
            this.el.querySelector('.bank-community-panel').style.display = 'none';
            this._status('Copied to your layouts'); await this._refreshPresets(id);
        } catch (e) { this._status('Copy failed'); }
    }

    // ---- placeholder-history (self-tracking store) ----
    _recordPlacement(itemId, tabId, catId) {
        this.itemHistory[itemId] = { tab_id: tabId, cat_id: catId, order: 0 };
        bankApi.setItemHistory([{ item_id: itemId, tab_id: tabId, cat_id: catId, order: 0 }]).catch(() => {});
    }
    async _persistPlacements() {
        try {
            const placements = this.view.getPlacements();
            if (placements.length) await bankApi.setItemHistory(placements);
        } catch (_e) { /* noop */ }
    }

    async open() {
        this._build();
        if (!this.el) return;
        clearTimeout(this._closeTimer);
        this.el.classList.remove('closing');
        this.el.classList.add('opening');
        document.body.classList.add('bank-open');
        document.getElementById('bank-nav-btn')?.classList.add('active');
        await loadBankItems();      // live inventory (catalog + owned store); sample fallback
        try { const { history } = await bankApi.getItemHistory(); this.itemHistory = history || {}; } catch (_e) { /* noop */ }
        // Server-side working layout is the source of truth (per session, cross-device).
        // If present it wins over the localStorage fast-paint cache restored in the ctor.
        try {
            const { working } = await bankApi.getWorkingLayout();
            if (working && working.layout && Array.isArray(working.layout.tabs)) {
                this.layout = working.layout;
                this.currentId = working.current_id || null;
                if (this.view) {
                    this.view.activeTabId = this.layout.tabs[0] && this.layout.tabs[0].id;
                    this.view.setLayout(this.layout);
                }
                try { localStorage.setItem(WORKING_LAYOUT_KEY, JSON.stringify({ layout: this.layout, currentId: this.currentId })); } catch (_e) { /* noop */ }
            }
        } catch (_e) { /* offline / feature off → keep local cache */ }
        const ni = this.el.querySelector('.bank-name-input'); if (ni) ni.value = this.layout.name || '';
        this._syncSaveEnabled();
        this.view.setItemHistory(this.itemHistory);   // renders
        this._refreshPresets();
        if (window.undoRedoManager) window.undoRedoManager.registerProvider(this._undoProvider);
    }

    close() {
        if (!this.el) return;
        this._flushWorkingToServer();   // persist latest working layout before leaving
        this.editor?.close();
        if (window.undoRedoManager) window.undoRedoManager.unregisterProvider();
        document.body.classList.remove('bank-open');
        document.getElementById('bank-nav-btn')?.classList.remove('active');
        if (!this.el.classList.contains('opening')) { this.el.classList.remove('closing'); return; }
        this.el.classList.remove('opening');
        this.el.classList.add('closing');
        clearTimeout(this._closeTimer);
        this._closeTimer = setTimeout(() => { this.el.classList.remove('closing'); }, 280);
    }
}
