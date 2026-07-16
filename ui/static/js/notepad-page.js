/**
 * Notepad — full-screen, FAC-gated, server-side multi-note rich-text editor.
 *
 * Mirrors the Walkdle / Sell-for-Chips overlay pattern: an open()/close() class
 * instantiated in main.js, hash-routed via #notepad through handleHashChange().
 * Uses Quill (vendored at /static/vendor/quill/) loaded lazily on first open.
 *
 * Notes are stored server-side (one row per note); see ui/app.py /api/notes*.
 * See .kiro/NOTEPAD_SPEC.md.
 */

import {
    registerNotepadBlots,
    dispatchNotepadEntity,
    normalizeEntityValue,
    NP_TYPE_ICON,
    NP_TYPE_LABEL,
} from './notepad-blots.js';
import { wireDropAnchor } from './drop-item-popover.js';

const QUILL_JS = '/static/vendor/quill/quill.js';
const QUILL_CSS = '/static/vendor/quill/quill.snow.css';
const AUTOSAVE_MS = 20000;

let _quillLoad = null;
function ensureQuill() {
    if (window.Quill) { registerNotepadBlots(window.Quill); return Promise.resolve(window.Quill); }
    if (_quillLoad) return _quillLoad;
    _quillLoad = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-notepad-quill]')) {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = QUILL_CSS; l.setAttribute('data-notepad-quill', '1');
            document.head.appendChild(l);
        }
        const s = document.createElement('script');
        s.src = QUILL_JS;
        s.onload = () => { try { registerNotepadBlots(window.Quill); } catch (_) {} resolve(window.Quill); };
        s.onerror = () => reject(new Error('Failed to load Quill'));
        document.body.appendChild(s);
    });
    return _quillLoad;
}

function sessionUuid() {
    try { return (window.store && window.store.state && window.store.state.session && window.store.state.session.uuid) || null; }
    catch (_) { return null; }
}

async function jsonFetch(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    if (!r.ok) {
        const err = new Error('HTTP ' + r.status);
        err.status = r.status;
        throw err;
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
}

export class NotepadPage {
    constructor(selector) {
        let el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) {
            el = document.createElement('div');
            el.id = (typeof selector === 'string' && selector.startsWith('#')) ? selector.slice(1) : 'notepad-page';
            document.body.appendChild(el);
        }
        this.el = el;
        this.el.classList.add('notepad-page');  // mirrors walkdle/stats overlay: below header, animated
        this.quill = null;
        this.notes = [];
        this.currentId = null;
        this._dirty = false;
        this._saveTimer = null;
        this._built = false;
        this._isOpen = false;
        this._injectStyles();
        // Flush on tab hide / unload (keepalive fetch survives navigation).
        const flush = () => { if (this._dirty) this._saveNow(true); };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    }

    // ---- lifecycle -------------------------------------------------------

    async open() {
        // .opening sets display:block + the shared stats-report-open fade/scale-in.
        this.el.classList.remove('closing');
        this.el.classList.add('opening');
        this._isOpen = true;
        document.body.classList.add('notepad-open');
        // Pin selection mode targets page elements; exit it if active so it
        // doesn't linger behind the notepad overlay.
        try { window.pinnedContainerController?.exitSelectionMode?.(); } catch (_) { /* ignore */ }
        const navBtn = document.getElementById('notepad-nav-btn');
        if (navBtn) navBtn.classList.add('active');
        try {
            await ensureQuill();
            this._build();
            await this._loadNotes(true);
        } catch (e) {
            console.error('[notepad] open failed', e);
            this._built = false;
            this.el.innerHTML = '<div class="np-error">Could not load the notepad. Please refresh and try again.</div>';
        }
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        if (this._dirty) this._saveNow(false);
        clearTimeout(this._saveTimer);
        // Animate out (stats-report-close), then revert to base display:none.
        this.el.classList.remove('opening');
        this.el.classList.add('closing');
        const el = this.el;
        clearTimeout(this._closeTimer);
        this._closeTimer = setTimeout(() => { el.classList.remove('closing'); }, 280);
        document.body.classList.remove('notepad-open');
        const navBtn = document.getElementById('notepad-nav-btn');
        if (navBtn) navBtn.classList.remove('active');
    }

    // ---- DOM scaffold ----------------------------------------------------

    _build() {
        if (this._built) return;
        this.el.innerHTML = `
            <div class="np-frame">
              <aside class="np-sidebar">
                <div class="np-sidebar-head">
                  <span class="np-title-text">Notes</span>
                  <button class="np-btn np-new" title="New note">+ New</button>
                </div>
                <ul class="np-list"></ul>
              </aside>
              <section class="np-main">
                <div class="np-topbar">
                  <button class="np-icon-btn np-collapse-toggle" title="Show/hide notes list" aria-label="Show/hide notes list">\u2630</button>
                  <div class="np-toolbar" id="np-toolbar">
                    <span class="ql-formats">
                      <button class="ql-bold"></button>
                      <button class="ql-italic"></button>
                      <button class="ql-underline"></button>
                      <button class="ql-strike"></button>
                    </span>
                    <span class="ql-formats">
                      <select class="ql-size"></select>
                      <select class="ql-font">
                        <option selected></option>
                        <option value="monospace"></option>
                      </select>
                    </span>
                    <span class="ql-formats">
                      <select class="ql-color"></select>
                      <select class="ql-background"></select>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-list" value="ordered"></button>
                      <button class="ql-list" value="bullet"></button>
                      <button class="ql-list" value="check"></button>
                      <button class="ql-indent" value="-1"></button>
                      <button class="ql-indent" value="+1"></button>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-undo" title="Undo">\u21BA</button>
                      <button class="ql-redo" title="Redo">\u21BB</button>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-table-menu" title="Table (insert / add / delete)">\u25A6</button>
                      <button class="ql-entity" title="Insert WalkScape link">\uD83D\uDD17</button>
                    </span>
                  </div>
                  <div class="np-actions">
                    <span class="np-save-state" aria-live="polite"></span>
                    <button class="np-btn np-delete" title="Delete this note">Delete</button>
                    <button class="np-btn np-close" title="Close">\u2715</button>
                  </div>
                </div>
                <div class="np-editor" id="np-editor"></div>
              </section>
            </div>`;

        this.el.querySelector('.np-new').addEventListener('click', () => this._newNote());
        this.el.querySelector('.np-delete').addEventListener('click', () => this._deleteCurrent());
        this.el.querySelector('.np-close').addEventListener('click', () => { window.location.hash = ''; });
        this.el.querySelector('.np-collapse-toggle').addEventListener('click', () => {
            const frame = this.el.querySelector('.np-frame');
            if (frame) frame.classList.toggle('np-collapsed');
        });

        const Quill = window.Quill;
        // Register a 'monospace' font option (the snow theme already styles it).
        try {
            const Font = Quill.import('formats/font');
            if (Font && (!Font.whitelist || !Font.whitelist.includes('monospace'))) {
                Font.whitelist = ['monospace'];
                Quill.register(Font, true);
            }
        } catch (_) { /* ignore */ }
        this.quill = new Quill(this.el.querySelector('#np-editor'), {
            theme: 'snow',
            placeholder: 'Write a note\u2026 the first line becomes its title.',
            modules: {
                table: true,
                toolbar: {
                    container: this.el.querySelector('#np-toolbar'),
                    handlers: {
                        entity: () => { try { this.quill.blur(); } catch (_) {} this._openInsertMenu(); },
                        'table-menu': () => this._openTableMenu(),
                        undo: () => { try { this.quill.history.undo(); } catch (_) {} },
                        redo: () => { try { this.quill.history.redo(); } catch (_) {} },
                    },
                },
            },
        });
        this.quill.on('text-change', (delta, old, source) => {
            if (source === 'user') { this._dirty = true; this._setSaveState('Editing\u2026'); this._scheduleSave(); }
        });
        // Entity-link clicks (delegated; chips are contenteditable=false).
        this.quill.root.addEventListener('click', (e) => {
            const chip = e.target.closest && e.target.closest('.np-entity');
            if (chip && this.el.contains(chip)) {
                // Item chips are wired to the shared drop-item-popover in the
                // blot itself; let that handle the click. Drop chips navigate to
                // their activity (dispatchNotepadEntity), so don't skip them.
                const ct = chip.getAttribute('data-type');
                if (ct === 'item') return;
                e.preventDefault();
                dispatchNotepadEntity({
                    type: chip.getAttribute('data-type'),
                    refId: chip.getAttribute('data-ref-id'),
                    label: chip.getAttribute('data-label'),
                    targetItemId: chip.getAttribute('data-target-item-id'),
                    quality: chip.getAttribute('data-quality'),
                });
            }
        });
        // Single-tap checklist toggle. Quill's native toggle needs a double-tap
        // on mobile; a capture-phase handler + stopPropagation pre-empts it so a
        // single tap on the checkbox (or the left gutter) flips the line.
        this.quill.root.addEventListener('click', (e) => {
            const li = e.target.closest && e.target.closest('li[data-list="checked"], li[data-list="unchecked"]');
            if (!li || !this.el.contains(li)) return;
            const onBox = (e.target.closest && e.target.closest('.ql-ui')) ||
                (e.clientX - li.getBoundingClientRect().left) <= 30;
            if (!onBox) return;
            e.preventDefault();
            e.stopPropagation();
            try {
                const blot = Quill.find(li);
                if (!blot) return;
                const idx = this.quill.getIndex(blot);
                const cur = li.getAttribute('data-list');
                this.quill.formatLine(idx, 1, 'list', cur === 'checked' ? 'unchecked' : 'checked', 'user');
                this._dirty = true; this._scheduleSave();
            } catch (_) { /* ignore */ }
        }, true);
        // Track the last real selection so the custom color pickers can apply
        // to it even after the native <input type=color> steals focus.
        this.quill.on('selection-change', (range) => { if (range) this._lastRange = range; });
        const applyColor = (fmt, val) => {
            const r = this._lastRange || this.quill.getSelection();
            if (r && r.length) this.quill.formatText(r.index, r.length, fmt, val, 'user');
            else if (r) this.quill.format(fmt, val, 'user');
            this._dirty = true; this._scheduleSave();
        };
        // Append a custom-color swatch into Quill's existing text-color and
        // highlight pickers so custom colors live inside the normal pickers.
        const addCustomSwatch = (sel, fmt) => {
            const opts = this.el.querySelector(sel + ' .ql-picker-options');
            if (!opts) return;
            const label = document.createElement('label');
            label.className = 'np-custom-swatch';
            label.title = 'Custom color';
            const inp = document.createElement('input');
            inp.type = 'color';
            label.appendChild(inp);
            inp.addEventListener('input', () => applyColor(fmt, inp.value));
            opts.appendChild(label);
        };
        addCustomSwatch('.ql-color', 'color');
        addCustomSwatch('.ql-background', 'background');
        this._built = true;
    }

    // ---- notes list ------------------------------------------------------

    async _loadNotes(selectRemembered) {
        const data = await jsonFetch('/api/notes');
        this.notes = (data && data.notes) || [];
        let target = null;
        if (selectRemembered) target = (data && data.selected_note_id) || null;
        if (!target && this.currentId && this.notes.some(n => n.id === this.currentId)) target = this.currentId;
        if (!target && this.notes.length) target = this.notes[0].id;
        this._renderList();
        if (target) await this._selectNote(target, false);
        else { this.currentId = null; if (this.quill) this.quill.setContents([]); this._renderList(); }
    }

    _renderList() {
        const ul = this.el.querySelector('.np-list');
        if (!ul) return;
        if (!this.notes.length) {
            ul.innerHTML = '<li class="np-empty">No notes yet. Click + New.</li>';
            return;
        }
        ul.innerHTML = '';
        for (const n of this.notes) {
            const li = document.createElement('li');
            li.className = 'np-list-item' + (n.id === this.currentId ? ' active' : '');
            li.dataset.id = n.id;
            const t = document.createElement('span');
            t.className = 'np-list-title';
            t.textContent = n.title || 'Untitled';
            li.appendChild(t);
            li.addEventListener('click', () => this._selectNote(n.id, true));
            ul.appendChild(li);
        }
    }

    async _selectNote(id, flushFirst) {
        if (id === this.currentId) return;
        if (flushFirst && this._dirty) await this._saveNow(false);
        try {
            const data = await jsonFetch('/api/notes/' + encodeURIComponent(id));
            const note = data && data.note;
            if (!note) { await this._loadNotes(false); return; }
            this.currentId = id;
            this._dirty = false;
            let delta;
            try { delta = JSON.parse(note.content_json || '{}'); } catch (_) { delta = { ops: [] }; }
            this.quill.setContents(delta && delta.ops ? delta : { ops: [] }, 'silent');
            this._wireEntityPopovers();
            this._setSaveState('');
            this._renderList();
            // Remember selection server-side (best-effort).
            jsonFetch('/api/notes-selection', { method: 'PUT', body: JSON.stringify({ note_id: id }) }).catch(() => {});
        } catch (e) {
            console.warn('[notepad] select note failed', e);
        }
    }

    async _newNote() {
        if (this._dirty) await this._saveNow(false);
        try {
            const res = await jsonFetch('/api/notes', { method: 'POST', body: JSON.stringify({}) });
            this.currentId = res.id;
            await this._loadNotes(false);
            await this._selectNote(res.id, false);
            this.quill.focus();
        } catch (e) {
            console.warn('[notepad] create failed', e);
        }
    }

    async _deleteCurrent() {
        if (!this.currentId) return;
        if (!window.confirm('Delete this note? This cannot be undone.')) return;
        const id = this.currentId;
        this._dirty = false;
        try { await jsonFetch('/api/notes/' + encodeURIComponent(id), { method: 'DELETE' }); }
        catch (e) { console.warn('[notepad] delete failed', e); }
        this.currentId = null;
        await this._loadNotes(false);
    }

    // ---- autosave --------------------------------------------------------

    _scheduleSave() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._saveNow(false), AUTOSAVE_MS);
    }

    async _saveNow(keepalive) {
        if (!this.currentId || !this.quill) return;
        const id = this.currentId;
        const content = JSON.stringify(this.quill.getContents());
        this._dirty = false;
        clearTimeout(this._saveTimer);
        try {
            const opts = { method: 'PUT', body: JSON.stringify({ content_json: content }) };
            if (keepalive) opts.keepalive = true;
            const res = await jsonFetch('/api/notes/' + encodeURIComponent(id), opts);
            this._setSaveState('Saved');
            // Reflect the new title in the list without a full reload.
            const item = this.notes.find(n => n.id === id);
            if (item && res && res.title) {
                item.title = res.title;
                const li = this.el.querySelector('.np-list-item[data-id="' + CSS.escape(id) + '"] .np-list-title');
                if (li) li.textContent = res.title;
            }
        } catch (e) {
            this._dirty = true; // let a later flush retry
            this._setSaveState('Save failed');
            console.warn('[notepad] save failed', e);
        }
    }

    _setSaveState(txt) {
        const el = this.el.querySelector('.np-save-state');
        if (el) el.textContent = txt;
    }

    // ---- insert entity link ---------------------------------------------

    _insertEntity(value) {
        const v = normalizeEntityValue(value);
        const range = this.quill.getSelection(true) || { index: this.quill.getLength(), length: 0 };
        this.quill.insertEmbed(range.index, 'entity-link', v, 'user');
        this.quill.insertText(range.index + 1, ' ', 'user');
        this.quill.setSelection(range.index + 2, 0, 'silent');
        this._wireEntityPopovers();
        this._dirty = true; this._scheduleSave();
    }

    // Wire item/drop chips to the shared drop-item-popover (the same hover/click
    // popover used by the drops section, crafting tree, and goals report).
    // Idempotent: wireDropAnchor guards on a data flag, so re-running is cheap.
    _wireEntityPopovers() {
        if (!this.quill) return;
        const QSET = new Set(['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal', 'Fine']);
        const chips = this.quill.root.querySelectorAll(
            '.np-entity[data-type="item"]');
        chips.forEach((chip) => {
            const rawLabel = chip.getAttribute('data-label') || '';
            const refId = chip.getAttribute('data-ref-id') || '';
            let quality = chip.getAttribute('data-quality') || null;
            // The popover looks the item up by its base catalog name, but the
            // chip label may carry a " (Good)" / "(Fine)" suffix. Strip a known
            // quality/Fine qualifier so the lookup resolves (and pass it as the
            // popover quality). Only strip recognized qualifiers so names with
            // legitimate parens like "Omni-tool (300)" are left intact.
            let name = rawLabel;
            const m = rawLabel.match(/^(.*) \(([^)]+)\)$/);
            if (m && QSET.has(m[2])) { name = m[1]; if (!quality) quality = m[2]; }
            if (quality) chip.dataset.dropQuality = quality;
            // Show "N owned" in the popover (notepad context only), keyed by the
            // item id like the column-3 recipe-info material tiles.
            chip.dataset.npShowOwned = '1';
            if (refId) chip.dataset.npOwnedItemId = refId;
            const isContainer = refId.startsWith('Container.');  // mirrors wireDropCards
            try { wireDropAnchor(chip, name, isContainer, quality); } catch (_) { /* best-effort */ }
        });
    }

    _openTableMenu() {
        const tbl = this.quill.getModule('table');
        if (!tbl) { this._infoModal('Tables are not available.'); return; }
        const ops = [
            ['Insert 2\u00d72 table', () => tbl.insertTable(2, 2)],
            ['+ Row above', () => tbl.insertRowAbove()],
            ['+ Row below', () => tbl.insertRowBelow()],
            ['+ Column left', () => tbl.insertColumnLeft()],
            ['+ Column right', () => tbl.insertColumnRight()],
            ['\u2212 Delete row', () => tbl.deleteRow()],
            ['\u2212 Delete column', () => tbl.deleteColumn()],
            ['\u2715 Delete table', () => tbl.deleteTable()],
        ];
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Table</div>');
            const grid = document.createElement('div');
            grid.className = 'np-type-grid';
            for (const [label, fn] of ops) {
                const b = document.createElement('button');
                b.className = 'np-type-btn';
                b.textContent = label;
                b.addEventListener('click', () => {
                    close();
                    try { this.quill.focus(); fn(); this._dirty = true; this._scheduleSave(); }
                    catch (e) { console.warn('[notepad] table op failed', e); this._infoModal('Put the cursor inside a table cell first.'); }
                });
                grid.appendChild(b);
            }
            body.appendChild(grid);
        });
    }

    /** Build {iconById, iconByName} from the item catalog (lazy, cached). */
    async _ensureIconMaps() {
        if (this._iconById) return;
        this._iconById = {}; this._iconByName = {};
        try {
            const cats = this._itemsCatalog || (this._itemsCatalog = (await jsonFetch('/api/items')).categories);
            const walk = (node) => {
                if (Array.isArray(node)) {
                    for (const it of node) {
                        if (it && it.icon_path) {
                            if (it.id) this._iconById[it.id] = it.icon_path;
                            if (it.name) this._iconByName[it.name] = it.icon_path;
                        }
                    }
                } else if (node && typeof node === 'object') {
                    for (const k of Object.keys(node)) walk(node[k]);
                }
            };
            walk(cats);
        } catch (_) { /* ignore */ }
    }

    _openInsertMenu() {
        const types = ['item', 'drop', 'recipe', 'activity', 'location', 'crafting_tree', 'gearset'];
        this._modal((body, closeModal) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Insert link</div>');
            const grid = document.createElement('div');
            grid.className = 'np-type-grid';
            for (const t of types) {
                const b = document.createElement('button');
                b.className = 'np-type-btn';
                b.innerHTML = '<span class="np-entity-icon">' + NP_TYPE_ICON[t] + '</span>' + NP_TYPE_LABEL[t];
                b.addEventListener('click', () => { closeModal(); this._pickForType(t); });
                grid.appendChild(b);
            }
            body.appendChild(grid);
        });
    }

    _pickForType(type) {
        if (type === 'item') { this._pickItem(); return; }
        if (type === 'drop') { this._pickDrop(); return; }
        if (type === 'recipe' || type === 'activity') {
            this._pickFromSelector(type);
            return;
        }
        if (type === 'location') {
            this._pickLocation();
            return;
        }
        if (type === 'crafting_tree') {
            this._pickCraftingTree();
            return;
        }
        if (type === 'gearset') {
            this._pickGearset();
            return;
        }
    }

    _selectorList(type) {
        // Flatten the real recipe/activity list the column-3 selector already
        // loaded (recipesData/activitiesData -> by_skill -> [{id,name}]). The
        // earlier property guesses were wrong, so search came up empty.
        const sel = type === 'recipe' ? window.recipeSelector : window.activitySelector;
        const data = sel && (type === 'recipe' ? sel.recipesData : sel.activitiesData);
        const bySkill = data && data.by_skill;
        const out = [];
        const seen = new Set();
        if (bySkill) {
            for (const skill of Object.keys(bySkill)) {
                for (const o of (bySkill[skill] || [])) {
                    const id = o.id || o.value;
                    if (id && !seen.has(id)) { seen.add(id); out.push({ id, name: o.name || o.label || o.title || id, icon: o.icon_path || o.icon }); }
                }
            }
        }
        return out;
    }

    // ---- item / drop pickers --------------------------------------------

    // Canonical quality -> rarity mapping (matches state.js / item-row), so
    // crafted quality rows use the same solid --rarity-* backgrounds as the
    // rest of the app instead of a washed-out alpha overlay.
    _qualityToRarity(q) {
        return ({
            Normal: 'common', Good: 'uncommon', Great: 'rare',
            Excellent: 'epic', Perfect: 'legendary', Eternal: 'ethereal',
        })[q] || 'common';
    }

    _cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '); }

    _itemRows(item) {
        if (!item || !item.name) return [];
        const id = item.id || item.uuid;
        if (!id) return [];
        const icon = item.icon_path;
        // Crafted items: one row per quality (Walkdle-style), quality -> rarity bg.
        if (item.type === 'crafted_item' && Array.isArray(item.qualities) && item.qualities.length) {
            return item.qualities.map(q => ({
                name: item.name + ' ' + q,
                label: item.name + ' (' + q + ')',
                refId: id, quality: q, rarity: this._qualityToRarity(q), icon,
            }));
        }
        // Everything else carries its own rarity (loot/gear get real colors).
        const rows = [{ name: item.name, label: item.name, refId: id, icon, rarity: (item.rarity || 'common') }];
        // Items with a fine variant (materials/consumables) get a "(Fine)" row.
        if (item.has_fine) {
            rows.push({ name: item.name + ' Fine', label: item.name + ' (Fine)', refId: id, icon, rarity: 'fine' });
        }
        return rows;
    }

    // Build a nested category/subcategory tree of picker nodes.
    // Node shape: { label, children:[node], rows:[row] }.
    _itemTree(node) {
        if (Array.isArray(node)) {
            const rows = [];
            for (const it of node) rows.push(...this._itemRows(it));
            return { children: [], rows };
        }
        const children = [];
        if (node && typeof node === 'object') {
            for (const k of Object.keys(node)) {
                const child = this._itemTree(node[k]);
                child.label = this._cap(k);
                if (child.children.length || child.rows.length) children.push(child);
            }
        }
        return { children, rows: [] };
    }

    async _pickItem() {
        let cats;
        try { cats = this._itemsCatalog || (this._itemsCatalog = (await jsonFetch('/api/items')).categories); }
        catch (e) { console.warn('[notepad] items catalog failed', e); this._infoModal('Item catalog is not available.'); return; }
        const nodes = [];
        const SKIP = new Set(['all_equipment', 'crafted_unique_count']);  // flat duplicate / non-item count
        for (const cat of Object.keys(cats || {})) {
            if (SKIP.has(cat)) continue;
            const t = this._itemTree(cats[cat]);
            t.label = this._cap(cat);
            if (t.children.length || t.rows.length) nodes.push(t);
        }
        this._listPickerModal('Link an item', nodes, (r) =>
            this._insertEntity({ type: 'item', refId: r.refId, label: r.label, quality: r.quality, icon: r.icon, rarity: r.rarity }));
    }

    async _pickDrop() {
        let data;
        try { data = this._activitiesData || (this._activitiesData = await jsonFetch('/api/activities')); }
        catch (e) { console.warn('[notepad] activities failed', e); this._infoModal('Activities are not available.'); return; }
        const bySkill = (data && data.by_skill) || {};
        const skillNodes = [];
        for (const skill of Object.keys(bySkill).sort()) {
            const actNodes = [];
            for (const act of (bySkill[skill] || [])) {
                const seen = new Set();
                const rows = [];
                for (const d of [...(act.drop_table || []), ...(act.secondary_drop_table || [])]) {
                    const nm = d && d.item_name;
                    if (!nm || nm === 'Nothing' || seen.has(nm)) continue;
                    seen.add(nm);
                    rows.push({
                        name: nm, label: nm,
                        refId: act.id,               // a drop links to its activity
                        dropName: nm,
                        activityName: act.name || 'Activity',
                        activityIcon: act.icon_path,
                        icon: this._dropIconPath(d),
                    });
                }
                if (rows.length) actNodes.push({ label: act.name || 'Activity', icon: act.icon_path, rows, children: [] });
            }
            if (actNodes.length) skillNodes.push({ label: this._cap(skill), icon: this._skillIconPath(skill), children: actNodes, rows: [] });
        }
        this._listPickerModal('Link a drop (by skill \u203A activity)', skillNodes, (r) =>
            this._insertEntity({
                type: 'drop',
                refId: r.refId,
                label: `${r.activityName} \u203A ${r.dropName}`,
                icon: r.icon,
                activityIcon: r.activityIcon,
            }));
    }

    // Skill icon path (mirrors activity-selector-dropdown).
    _skillIconPath(skill) {
        const id = String(skill || '').toLowerCase().replace(/ /g, '_');
        return `/assets/icons/text/skill_icons/${id}.svg`;
    }

    // Canonical drop -> icon path (mirrors drops-section _iconPathForDrop):
    // handles coins, containers (chests/pouches/nests), pet eggs, currency,
    // materials, equipment, collectibles, consumables.
    _dropIconPath(d) {
        if (!d) return '';
        if (d.item_name === 'Coins') return '/assets/icons/items/coins.svg';
        if (d.item_ref) {
            const type = d.item_ref.split('.')[0];
            const iconName = (d.item_name || '').toLowerCase().replace(/ /g, '_');
            switch (type) {
                case 'Currency': return `/assets/icons/items/${iconName}.svg`;
                case 'Material': return `/assets/icons/items/materials/${iconName}.svg`;
                case 'Item': return `/assets/icons/items/equipment/${iconName}.svg`;
                case 'Collectible': return `/assets/icons/items/collectibles/${iconName}.svg`;
                case 'Consumable': return `/assets/icons/items/consumables/${iconName}.svg`;
                case 'Container': return `/assets/icons/items/containers/${iconName}.svg`;
                case 'Egg': return `/assets/icons/items/pet_eggs/${iconName}.svg`;
                default: break;
            }
        }
        if (d.item_name) {
            const n = d.item_name.toLowerCase().replace(/ /g, '_');
            if (n.endsWith('_egg')) return `/assets/icons/items/pet_eggs/${n}.svg`;
            return `/assets/icons/items/materials/${n}.svg`;
        }
        return '';
    }

    _listPickerModal(title, sections, onChoose) {
        if (!sections.length) { this._infoModal('Nothing to pick.'); return; }
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">' + title + '</div>');
            const search = document.createElement('input');
            search.type = 'text'; search.className = 'np-search'; search.placeholder = 'Search\u2026';
            body.appendChild(search);
            const listEl = document.createElement('div');
            listEl.className = 'np-pick2';
            body.appendChild(listEl);
            const choose = (r) => { close(); onChoose(r); };
            const rerender = () => this._renderPickerSections(listEl, sections, search.value, choose);
            search.addEventListener('input', rerender);
            rerender();
            setTimeout(() => search.focus(), 30);
        });
    }

    _renderPickerSections(listEl, nodes, query, onChoose) {
        const ql = (query || '').trim().toLowerCase();
        listEl.innerHTML = '';
        let shown = 0;
        for (const n of nodes) if (this._renderPickNode(listEl, n, ql, onChoose, 0)) shown++;
        if (!shown) listEl.innerHTML = '<div class="np-empty">No matches.</div>';
    }

    // True if the node (or any descendant) matches the query.
    _nodeMatches(node, ql) {
        if (!ql) return true;
        if ((node.label || '').toLowerCase().includes(ql)) return true;
        if ((node.rows || []).some(r => (r.name || '').toLowerCase().includes(ql))) return true;
        return (node.children || []).some(c => this._nodeMatches(c, ql));
    }

    // Render one tree node (collapsible header + nested children + leaf rows).
    // The body (child nodes + rows, including their icon <img>s) is built
    // lazily on first expand so opening the picker doesn't create thousands of
    // images up front. Returns false when filtered out by the active query.
    _renderPickNode(container, node, ql, onChoose, depth) {
        if (ql && !this._nodeMatches(node, ql)) return false;
        const hdr = document.createElement('div');
        hdr.className = 'np-pick-h np-pick-coll' + (depth === 0 ? ' np-pick-top' : '');
        if (node.icon) {
            const hi = document.createElement('img');
            hi.className = 'np-pick-hicon'; hi.src = node.icon; hi.alt = ''; hi.loading = 'lazy';
            hdr.appendChild(hi);
            const ht = document.createElement('span');
            ht.className = 'np-pick-htext'; ht.textContent = node.label || '';
            hdr.appendChild(ht);
        } else {
            hdr.textContent = node.label || '';
        }
        const wrap = document.createElement('div');
        wrap.className = 'np-pick-rows';
        const $ = window.$ || window.jQuery;
        let open = !!ql;  // collapsed by default; auto-open while searching
        let built = false;
        const build = () => {
            if (built) return;
            built = true;
            this._buildNodeBody(wrap, node, ql, onChoose, depth);
        };
        if (open) build();
        wrap.style.display = open ? '' : 'none';
        hdr.classList.toggle('np-closed', !open);
        hdr.addEventListener('click', () => {
            open = !open;
            hdr.classList.toggle('np-closed', !open);
            if (open) build();
            if ($) $(wrap).slideToggle(150); else wrap.style.display = open ? '' : 'none';
        });
        container.appendChild(hdr);
        container.appendChild(wrap);
        return true;
    }

    // Build a node's body (nested children + matching leaf rows) into `wrap`.
    _buildNodeBody(wrap, node, ql, onChoose, depth) {
        const labelMatch = ql && (node.label || '').toLowerCase().includes(ql);
        const rows = (!ql || labelMatch)
            ? (node.rows || [])
            : (node.rows || []).filter(r => (r.name || '').toLowerCase().includes(ql));
        for (const c of (node.children || [])) this._renderPickNode(wrap, c, ql, onChoose, depth + 1);
        for (const r of rows) wrap.appendChild(this._pickRow(r, onChoose));
    }

    _pickRow(r, onChoose) {
        const row = document.createElement('div');
        row.className = 'np-pick-r' + (r.rarity ? ' rarity-' + r.rarity : '');
        if (r.icon) {
            const img = document.createElement('img');
            img.className = 'np-pick-icon'; img.src = r.icon; img.alt = ''; img.loading = 'lazy';
            row.appendChild(img);
        }
        const span = document.createElement('span');
        span.className = 'np-pick-name';
        span.textContent = r.label || r.name;
        row.appendChild(span);
        row.addEventListener('click', () => onChoose(r));
        return row;
    }

    async _pickFromSelector(type) {
        const path = type === 'recipe'
            ? './components/recipe-selector-dropdown.js'
            : './components/activity-selector-dropdown.js';
        let Cls;
        try { Cls = (await import(path)).default; }
        catch (e) { console.warn('[notepad] selector unavailable', e); this._infoModal(NP_TYPE_LABEL[type] + ' picker is not available.'); return; }
        // id -> {name, icon} map so we can label + icon the inserted chip.
        const byId = {};
        for (const it of this._selectorList(type)) byId[it.id] = it;
        const $ = window.$ || window.jQuery;
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Link ' + (type === 'recipe' ? 'a recipe' : 'an activity') + '</div>');
            const host = document.createElement('div');
            host.className = 'np-dd-host';
            body.appendChild(host);
            // eslint-disable-next-line no-new
            new Cls($ ? $(host) : host, {
                onPick: (id) => {
                    if (id) { const it = byId[id] || {}; this._insertEntity({ type, refId: id, label: it.name || id, icon: it.icon }); }
                    close();
                },
            });
        }, 'np-modal-float');
    }

    async _pickLocation() {
        let LocationDropdown;
        try {
            LocationDropdown = (await import('./components/location-dropdown.js')).default;
        } catch (e) {
            console.warn('[notepad] location picker unavailable', e);
            this._infoModal('Location picker is not available.');
            return;
        }
        const $ = window.$ || window.jQuery;
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Link a location</div>');
            const host = document.createElement('div');
            host.className = 'np-loc-host';
            body.appendChild(host);
            // eslint-disable-next-line no-new
            new LocationDropdown($ ? $(host) : host, {
                label: '',
                onSelect: (loc) => {
                    if (loc && loc.id) {
                        this._insertEntity({ type: 'location', refId: loc.id, label: loc.name || loc.label || loc.id, icon: loc.icon_path || loc.icon });
                    }
                    close();
                },
                selectedLocation: null,
            });
        });
    }

    async _pickGearset() {
        const uuid = sessionUuid();
        let list = [];
        if (uuid) {
            try {
                const data = await jsonFetch('/api/session/' + encodeURIComponent(uuid) + '/gearsets?summary=true');
                const arr = Array.isArray(data) ? data : (data && (data.gearsets || data.gear_sets) || []);
                list = arr.map(g => ({ id: g.id, name: g.name || 'Gear set' })).filter(g => g.id);
            } catch (e) { console.warn('[notepad] gearset list failed', e); }
        }
        if (!list.length) { this._infoModal('No saved gear sets found.'); return; }
        this._searchModal('Gear set', list, null, (chosen) => {
            this._insertEntity({ type: 'gearset', refId: chosen.id, label: chosen.name });
        });
    }

    async _pickCraftingTree() {
        const uuid = sessionUuid();
        await this._ensureIconMaps();
        const treeIcon = (id) => (this._iconById || {})[id];
        let list = [];
        if (uuid) {
            try {
                const data = await jsonFetch('/api/crafting-tree/saved?session_uuid=' + encodeURIComponent(uuid));
                const arr = Array.isArray(data) ? data : (data && data.trees) || [];
                list = arr.map(t => ({ id: t.id, name: t.name || 'Crafting tree', targetItemId: t.target_item_id }))
                          .filter(t => t.id);
            } catch (e) { console.warn('[notepad] saved trees failed', e); }
        }
        const onSaveCurrent = async () => {
            // "Attach current": save the live tree (default name) then link it.
            try {
                const targetItemId = (window.store && window.store.get && window.store.get('ui.crafting_tree.target_item_id')) || '';
                let treeData = {};
                try {
                    if (window._craftingTreeViewGlobal && typeof window._craftingTreeViewGlobal.getSavePayload === 'function') {
                        treeData = window._craftingTreeViewGlobal.getSavePayload() || {};
                    } else if (window.store && typeof window.store.get === 'function') {
                        treeData = {
                            nodes: window.store.get('ui.crafting_tree.nodes') || [],
                            global_settings: window.store.get('ui.crafting_tree.global_settings') || {},
                        };
                    }
                } catch (_) { /* ignore */ }
                if (!targetItemId) { this._infoModal('Open a crafting tree first, then link it.'); return; }
                const name = 'Note tree ' + new Date().toLocaleString();
                const res = await jsonFetch('/api/crafting-tree/saved', {
                    method: 'POST',
                    body: JSON.stringify({ session_uuid: uuid, name, target_item_id: targetItemId, tree_data: treeData }),
                });
                this._insertEntity({ type: 'crafting_tree', refId: res.id, label: name, targetItemId, icon: treeIcon(targetItemId) });
            } catch (e) {
                console.warn('[notepad] save current tree failed', e);
                this._infoModal('Could not save the current tree.');
            }
        };
        this._searchModal('Crafting tree', list, null, (chosen) => {
            this._insertEntity({ type: 'crafting_tree', refId: chosen.id, label: chosen.name, targetItemId: chosen.targetItemId, icon: treeIcon(chosen.targetItemId) });
        }, { extraLabel: 'Save current tree & link', onExtra: onSaveCurrent });
    }

    // ---- small modal helpers --------------------------------------------

    _modal(builder, modalClass) {
        const overlay = document.createElement('div');
        overlay.className = 'np-modal-overlay';
        const box = document.createElement('div');
        box.className = 'np-modal' + (modalClass ? ' ' + modalClass : '');
        overlay.appendChild(box);
        let closing = false;
        const close = () => {
            if (closing) return;
            closing = true;
            overlay.classList.add('np-closing');
            setTimeout(() => overlay.remove(), 170);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        builder(box, close);
        this.el.appendChild(overlay);
        return close;
    }

    _infoModal(msg) {
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-msg"></div>');
            body.querySelector('.np-modal-msg').textContent = msg;
            const ok = document.createElement('button');
            ok.className = 'np-btn'; ok.textContent = 'OK';
            ok.addEventListener('click', close);
            body.appendChild(ok);
        });
    }

    _searchModal(label, items, current, onChoose, opts) {
        opts = opts || {};
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Link a ' + label.toLowerCase() + '</div>');
            if (current && current.id) {
                const cur = document.createElement('button');
                cur.className = 'np-btn np-current';
                cur.textContent = 'Use current: ' + (current.name || current.id);
                cur.addEventListener('click', () => { close(); onChoose(current); });
                body.appendChild(cur);
            }
            if (opts.extraLabel) {
                const ex = document.createElement('button');
                ex.className = 'np-btn np-current';
                ex.textContent = opts.extraLabel;
                ex.addEventListener('click', () => { close(); opts.onExtra(); });
                body.appendChild(ex);
            }
            const search = document.createElement('input');
            search.type = 'text'; search.className = 'np-search'; search.placeholder = 'Search ' + label.toLowerCase() + '\u2026';
            body.appendChild(search);
            const list = document.createElement('ul');
            list.className = 'np-pick-list';
            body.appendChild(list);
            const render = (q) => {
                const ql = (q || '').toLowerCase();
                list.innerHTML = '';
                const matches = items.filter(it => (it.name || '').toLowerCase().includes(ql)).slice(0, 80);
                if (!matches.length) { list.innerHTML = '<li class="np-empty">No matches.</li>'; return; }
                for (const it of matches) {
                    const li = document.createElement('li');
                    li.textContent = it.name || it.id;
                    li.addEventListener('click', () => { close(); onChoose(it); });
                    list.appendChild(li);
                }
            };
            search.addEventListener('input', () => render(search.value));
            render('');
            setTimeout(() => search.focus(), 30);
        });
    }

    // ---- styles ----------------------------------------------------------

    _injectStyles() {
        if (document.getElementById('np-styles')) return;
        const s = document.createElement('style');
        s.id = 'np-styles';
        s.textContent = `
.notepad-page{position:fixed;top:var(--header-height,60px);left:0;right:0;bottom:0;background:var(--bg-primary,#15161a);z-index:4000;overflow:hidden;display:none;opacity:0;transform:scale(0.95);overscroll-behavior:contain}
.notepad-page.opening{display:block;animation:stats-report-open 0.3s ease-out forwards}
.notepad-page.closing{display:block;animation:stats-report-close 0.25s ease-in forwards}
@media(max-width:768px){.notepad-page{bottom:calc(68px + env(safe-area-inset-bottom))}}
.notepad-page .np-frame{display:flex;height:100%;min-height:0}
.notepad-page .np-sidebar{--np-sb-w:240px;width:var(--np-sb-w);flex:none;background:var(--bg-secondary,#1d1f24);border-right:1px solid #33363d;display:flex;flex-direction:column;overflow:hidden;transition:width .22s ease,border-color .22s ease}
.notepad-page .np-frame.np-collapsed .np-sidebar{width:0;border-right-color:transparent}
.notepad-page .np-sidebar-head{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #33363d;width:var(--np-sb-w);box-sizing:border-box;flex:none}
.notepad-page .np-title-text{font-weight:600;color:#f1c40f}
.notepad-page .np-list{list-style:none;margin:0;padding:0;overflow:auto;flex:1;width:var(--np-sb-w);box-sizing:border-box}
.notepad-page .np-list-item{padding:10px 12px;cursor:pointer;border-bottom:1px solid #26282e;color:#dfe2e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notepad-page .np-list-item:hover{background:#262931}
.notepad-page .np-list-item.active{background:#2f3340;color:#fff;border-left:3px solid #f1c40f;padding-left:9px}
.notepad-page .np-empty{padding:12px;color:#888;font-size:13px}
.notepad-page .np-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.notepad-page .np-topbar{display:flex;align-items:flex-start;gap:8px;background:var(--bg-secondary,#1d1f24);border-bottom:1px solid #33363d;flex-wrap:wrap;position:relative;padding-right:210px}
.notepad-page .np-toolbar.ql-toolbar.ql-snow{border:none;flex:1}
.notepad-page .np-actions{position:absolute;top:6px;right:10px;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;justify-content:flex-end}
.notepad-page .np-save-state{font-size:12px;color:#8a8f99;text-align:right;white-space:nowrap}
@media (max-width:900px){.notepad-page .np-topbar{padding-right:104px}.notepad-page .np-actions{max-width:84px;flex-wrap:wrap}.notepad-page .np-save-state{flex-basis:100%}}
@media (max-width:768px){.notepad-page .np-topbar{padding-right:92px}.notepad-page .np-actions{right:8px;max-width:80px;flex-wrap:wrap}.notepad-page .np-save-state{flex-basis:100%}}
.notepad-page .np-btn{background:#2f3340;color:#e8eaef;border:1px solid #41454f;border-radius:6px;padding:8px 14px;cursor:pointer;font-size:15px}
.notepad-page .np-btn:hover{background:#3a3f4d}
.notepad-page .np-new{color:#f1c40f}
.notepad-page .np-custom-swatch{float:left;box-sizing:border-box;width:16px;height:16px;margin:2px;border:1px solid #fff;border-radius:2px;overflow:hidden;cursor:pointer;padding:0;position:relative;vertical-align:top}
.notepad-page .np-custom-swatch input[type=color]{width:200%;height:200%;margin:-25% 0 0 -25%;border:none;padding:0;cursor:pointer;background:none}
.notepad-page .np-dd-host{min-height:44px}
.notepad-page .np-icon-btn{background:transparent;color:#cfd3da;border:none;font-size:18px;cursor:pointer;padding:6px 10px;line-height:1}
.notepad-page .np-icon-btn:hover{color:#f1c40f}
.notepad-page .np-editor{flex:1;min-height:0;background:var(--bg-primary,#15161a)}
.notepad-page #np-editor.ql-container.ql-snow{border:none;display:flex;flex-direction:column;min-height:0;font-family:inherit}
.notepad-page #np-editor .ql-editor{flex:1;overflow-y:auto;color:var(--text-primary,#e8eaef);font-size:16px}
.notepad-page .ql-editor li[data-list=checked]{text-decoration:line-through;opacity:.55}
.notepad-page .ql-editor table{border-collapse:collapse;margin:6px 0}
.notepad-page .ql-editor td{border:1px solid #4a4f5a;padding:5px 9px;min-width:46px}
.notepad-page .ql-font-monospace{font-family:ui-monospace,Menlo,Consolas,monospace}
.notepad-page #np-editor .ql-editor.ql-blank::before{color:#7e828c;font-style:normal;left:15px}
.notepad-page .ql-snow .ql-stroke{stroke:#cfd3da}
.notepad-page .ql-snow .ql-fill,.notepad-page .ql-snow .ql-stroke.ql-fill{fill:#cfd3da}
.notepad-page .ql-snow .ql-picker{color:#cfd3da}
.notepad-page .ql-snow .ql-picker-options{background:#1d1f24;border-color:#41454f}
.notepad-page .ql-snow.ql-toolbar button:hover .ql-stroke,.notepad-page .ql-snow .ql-toolbar button.ql-active .ql-stroke{stroke:#f1c40f}
.notepad-page .ql-snow.ql-toolbar button.ql-active .ql-fill{fill:#f1c40f}
.notepad-page .ql-snow .ql-picker-label:hover,.notepad-page .ql-snow .ql-picker-item:hover{color:#f1c40f}
.notepad-page .ql-toolbar.ql-snow .ql-picker-label{color:#cfd3da}
.notepad-page .ql-toolbar .ql-entity{font-size:19px;width:34px}
.notepad-page .ql-toolbar.ql-snow button{width:34px;height:32px;padding:4px}
.notepad-page .ql-toolbar.ql-snow button svg{width:22px;height:22px}
.notepad-page .ql-toolbar.ql-snow .ql-picker.ql-color-picker,.notepad-page .ql-toolbar.ql-snow .ql-picker.ql-icon-picker{width:34px}
.notepad-page .ql-toolbar.ql-snow .ql-picker-label{font-size:16px}
.np-entity{display:inline-flex;align-items:center;gap:4px;background:#3a3320;border:1px solid #6b5b1e;border-radius:10px;padding:0 7px;margin:0 1px;cursor:pointer;font-size:13px;line-height:1.6;color:#ffe79a;white-space:nowrap;vertical-align:baseline}
.np-entity:hover{background:#4a4026}
.np-entity .np-entity-icon{font-size:12px}
.np-entity-recipe{background:#1f2c44;border-color:#3a5a8c;color:#bcd4ff}
.np-entity-activity{background:#3a2a1f;border-color:#8c5a3a;color:#ffcaa3}
.np-entity-crafting_tree{background:#1f3322;border-color:#3a7a45;color:#aef0bd}
.np-entity-gearset{background:#2c2244;border-color:#5a3a8c;color:#d8c2ff}
.np-entity-location{background:#3a1f2c;border-color:#8c3a5a;color:#ffc2d8}
.np-modal-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:20;animation:npOverlayIn .18s ease}
.np-modal{background:#1f2228;border:1px solid #3a3e47;border-radius:10px;padding:16px;width:min(420px,92vw);max-height:80vh;overflow:auto;color:#e8eaef;display:flex;flex-direction:column;gap:8px;animation:npBoxIn .18s ease}
.np-modal-overlay.np-closing{animation:npOverlayOut .17s ease forwards}
.np-modal-overlay.np-closing .np-modal{animation:npBoxOut .17s ease forwards}
@keyframes npOverlayIn{from{opacity:0}to{opacity:1}}
@keyframes npOverlayOut{from{opacity:1}to{opacity:0}}
@keyframes npBoxIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}
@keyframes npBoxOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.95)}}
.np-entity.rarity-common{background-color:var(--rarity-common);border-color:var(--rarity-common-border);color:#eef1f4}
.np-entity.rarity-uncommon{background-color:var(--rarity-uncommon);border-color:var(--rarity-uncommon-border);color:#eef1f4}
.np-entity.rarity-rare{background-color:var(--rarity-rare);border-color:var(--rarity-rare-border);color:#eef1f4}
.np-entity.rarity-epic{background-color:var(--rarity-epic);border-color:var(--rarity-epic-border);color:#eef1f4}
.np-entity.rarity-legendary{background-color:var(--rarity-legendary);border-color:var(--rarity-legendary-border);color:#eef1f4}
.np-entity.rarity-ethereal{background-color:var(--rarity-ethereal);border-color:var(--rarity-ethereal-border);color:#eef1f4}
.np-entity.rarity-fine{background-color:var(--rarity-fine);border-color:var(--fine-color);color:#eef1f4}
.notepad-page .np-modal.np-modal-float{overflow:visible}
.notepad-page .np-modal-overlay:has(.np-modal-float){align-items:flex-start;padding-top:10vh}
.np-modal-title{font-weight:600;color:#f1c40f;margin-bottom:4px}
.np-modal-msg{color:#dfe2e8}
.np-type-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.np-type-btn{display:flex;align-items:center;gap:8px;background:#2a2e37;border:1px solid #41454f;border-radius:8px;padding:10px;cursor:pointer;color:#e8eaef;font-size:14px}
.np-type-btn:hover{background:#343a45}
.np-search{width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #41454f;background:#15161a;color:#fff;font-size:16px}
.np-pick-list{list-style:none;margin:0;padding:0;max-height:46vh;overflow:auto}
.np-pick-list li{padding:8px 10px;border-bottom:1px solid #2a2c33;cursor:pointer}
.np-pick-list li:hover{background:#2a2e37}
.np-pick2{max-height:58vh;overflow:auto;border:1px solid #2a2c33;border-radius:6px}
.np-pick-h{padding:8px 10px;font-weight:600;color:#f1c40f;background:#23262e;border-bottom:1px solid #2a2c33}
.np-pick-coll{cursor:pointer}
.np-pick-coll::before{content:'\u25BE  ';color:#8a8f99}
.np-pick-h.np-closed::before{content:'\u25B8  '}
.np-pick-r{display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-bottom:1px solid #24262c;color:#e8eaef}
.np-pick-icon{width:30px;height:30px;flex:none;object-fit:contain}
.np-pick-hicon{width:22px;height:22px;flex:none;object-fit:contain;vertical-align:middle;margin-right:6px}
.np-pick-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-entity-img{width:16px;height:16px;border-radius:3px;object-fit:contain;vertical-align:middle}
.notepad-page .ql-toolbar button.ql-table-menu{font-size:19px;line-height:1}
.notepad-page .ql-toolbar button.ql-undo,.notepad-page .ql-toolbar button.ql-redo{width:34px;height:34px;padding:0;font-size:20px;line-height:32px;text-align:center;border:1px solid #41454f;border-radius:50%;background:transparent;color:#cfd3da;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.notepad-page .ql-toolbar button.ql-undo:hover,.notepad-page .ql-toolbar button.ql-redo:hover{color:#f1c40f;border-color:#f1c40f;background:transparent}
.notepad-page .ql-toolbar button.ql-undo:focus,.notepad-page .ql-toolbar button.ql-redo:focus,.notepad-page .ql-toolbar button.ql-undo:active,.notepad-page .ql-toolbar button.ql-redo:active{outline:none;color:#f1c40f;background:transparent}
.notepad-page .np-pick-rows{padding-left:14px}
.notepad-page .np-pick-h.np-pick-top{background:#2b2f39;color:#ffd84d}
.np-pick-r:hover{filter:brightness(1.3)}
.np-pick-r.rarity-common{background-color:var(--rarity-common)}
.np-pick-r.rarity-uncommon{background-color:var(--rarity-uncommon)}
.np-pick-r.rarity-rare{background-color:var(--rarity-rare)}
.np-pick-r.rarity-epic{background-color:var(--rarity-epic)}
.np-pick-r.rarity-legendary{background-color:var(--rarity-legendary)}
.np-pick-r.rarity-ethereal{background-color:var(--rarity-ethereal)}
.np-pick-r.rarity-fine{background-color:var(--rarity-fine)}
.np-current{align-self:flex-start}
.np-error{padding:40px;color:#e88;text-align:center;font-size:16px}
.np-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#2a2e37;color:#fff;border:1px solid #41454f;padding:10px 16px;border-radius:8px;opacity:0;transition:all .2s;z-index:2000;pointer-events:none}
.np-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:768px){.notepad-page .np-sidebar{--np-sb-w:160px}}
`;
        document.head.appendChild(s);
    }
}
