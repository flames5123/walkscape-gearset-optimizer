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
import { wireDropAnchor, wireAchievementAnchor } from './drop-item-popover.js';

const QUILL_JS = '/static/vendor/quill/quill.js';
const QUILL_CSS = '/static/vendor/quill/quill.snow.css';
// 1x1 transparent GIF — used to mask-tint a monochrome icon to an arbitrary
// color (mirrors the top-bar customization technique).
const NP_TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
// Debounced-autosave delay. Kept short so a close/refresh/navigation never
// strands more than a second or two of typing on the client (a prior 20s
// value meant anything typed in the last 20s before leaving was lost).
const AUTOSAVE_MS = 1500;

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
            await this._loadWithRetry(() => ensureQuill());
            this._build();
            await this._loadWithRetry(() => this._loadNotes(true));
            this._maybeShowBetaNotice();
            this._bindViewport();
        } catch (e) {
            console.error('[notepad] open failed', e);
            this._built = false;
            this.el.innerHTML = '<div class="np-error">Could not load the notepad. Please refresh and try again.</div>';
        }
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        // keepalive=true so this save survives the page unload that often
        // immediately follows a "close" (clicking a link, closing the tab, or
        // a hash navigation). A non-keepalive fetch would be aborted on unload,
        // and because _saveNow clears _dirty the pagehide fallback would not
        // retry — silently losing the note.
        if (this._dirty) this._saveNow(true);
        clearTimeout(this._saveTimer);
        // Animate out (stats-report-close), then revert to base display:none.
        this.el.classList.remove('opening');
        this.el.classList.add('closing');
        const el = this.el;
        clearTimeout(this._closeTimer);
        this._closeTimer = setTimeout(() => { el.classList.remove('closing'); }, 280);
        document.body.classList.remove('notepad-open');
        this._unbindViewport();
        const navBtn = document.getElementById('notepad-nav-btn');
        if (navBtn) navBtn.classList.remove('active');
    }

    /**
     * Run an async load step, retrying on TRANSIENT failures (502/503/504/429
     * or a network TypeError) with a short backoff. This rides through the
     * brief window when the server is restarting mid-deploy, which otherwise
     * surfaced as "Could not load the notepad" (bug 0ef6fc51). Non-transient
     * errors (e.g. real code bugs) are re-thrown immediately.
     */
    async _loadWithRetry(fn, attempts = 3) {
        let lastErr;
        for (let i = 0; i < attempts; i++) {
            try { return await fn(); }
            catch (e) {
                lastErr = e;
                const st = e && e.status;
                const transient = st === 502 || st === 503 || st === 504 || st === 429 || (e && e.name === 'TypeError');
                if (!transient || i === attempts - 1) throw e;
                await new Promise(res => setTimeout(res, 500 * (i + 1)));
            }
        }
        throw lastErr;
    }

    /**
     * Mobile keyboard fix: the notepad is a position:fixed panel. When the soft
     * keyboard opens, the browser can pan the page so the panel's top (and the
     * toolbar) scroll off-screen. We pin the panel's TOP to the visible viewport
     * top (visualViewport.offsetTop) so the toolbar stays on-screen. We do NOT
     * shrink the height/bottom — the panel keeps extending behind the keyboard,
     * so there's no gap where the page behind would show through.
     */
    _bindViewport() {
        const vv = window.visualViewport;
        if (!vv || this._vvFit) return;
        this._vvFit = () => {
            if (!this._isOpen) return;
            const kbUp = (document.documentElement.clientHeight - vv.height) > 120; // keyboard open
            this.el.style.top = kbUp ? (Math.max(0, vv.offsetTop) + 'px') : '';
        };
        vv.addEventListener('resize', this._vvFit);
        vv.addEventListener('scroll', this._vvFit);
        this._vvFit();
    }

    _unbindViewport() {
        const vv = window.visualViewport;
        if (vv && this._vvFit) {
            vv.removeEventListener('resize', this._vvFit);
            vv.removeEventListener('scroll', this._vvFit);
        }
        this._vvFit = null;
        this.el.style.top = '';
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
                  <button class="np-icon-btn np-collapse-toggle" title="Show/hide notes list" aria-label="Show/hide notes list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"></polyline></svg></button>
                  <div class="np-toolbar" id="np-toolbar">
                    <span class="ql-formats">
                      <select class="ql-header" title="Text style">
                        <option selected></option>
                        <option value="1"></option>
                        <option value="2"></option>
                        <option value="3"></option>
                        <option value="4"></option>
                      </select>
                      <select class="ql-font" title="Font">
                        <option selected></option>
                        <option value="monospace"></option>
                      </select>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-bold" title="Bold"></button>
                      <button class="ql-italic" title="Italic"></button>
                      <button class="ql-underline" title="Underline"></button>
                      <button class="ql-strike" title="Strikethrough"></button>
                    </span>
                    <span class="ql-formats">
                      <select class="ql-color" title="Text color"></select>
                      <select class="ql-background" title="Highlight color"></select>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-list" value="ordered" title="Numbered list"></button>
                      <button class="ql-list" value="bullet" title="Bulleted list"></button>
                      <button class="ql-list" value="check" title="Checklist"></button>
                      <button class="ql-indent" value="-1" title="Decrease indent"></button>
                      <button class="ql-indent" value="+1" title="Increase indent"></button>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-undo" title="Undo">\u21BA</button>
                      <button class="ql-redo" title="Redo">\u21BB</button>
                    </span>
                    <span class="ql-formats">
                      <button class="ql-spellcheck" title="Spellcheck on (click to disable)"><svg viewBox="0 0 24 24"><path class="ql-fill" d="M12.45 16h2.09L9.43 3H7.57L2.46 16h2.09l1.12-3h5.64l1.14 3zm-6.02-5L8.5 5.48 10.57 11H6.43zm15.16.94l-4.24 4.24-2.12-2.12-1.41 1.41L17.15 20 24 12.35l-1.41-1.41z"></path><path class="np-sc-wave" d="M2 19.6q1.4 -1.8 2.75 0t2.75 0t2.75 0t2.75 0"></path></svg></button>
                      <button class="ql-table-menu" title="Table (insert / add / delete)"><svg viewBox="0 0 24 24"><rect class="ql-stroke" x="3.5" y="5" width="17" height="14" rx="2"></rect><rect class="ql-fill" x="3.5" y="5" width="17" height="4.3" rx="2"></rect><line class="ql-stroke" x1="12" y1="9.3" x2="12" y2="19"></line><line class="ql-stroke" x1="3.5" y1="14" x2="20.5" y2="14"></line></svg></button>
                      <button class="ql-entity" title="Insert WalkScape link"><span class="np-linkicon"><img class="np-li-base" src="/assets/icons/items.svg" alt=""><span class="np-li-over">\uD83D\uDD17</span></span></button>
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
                        spellcheck: () => this._toggleSpellcheck(),
                    },
                },
            },
        });
        // Quill replaces each <select> with a .ql-picker widget (the original
        // select is hidden), so the select's title never shows. Set hover titles
        // on the generated pickers instead.
        try {
            const tb = this.el.querySelector('#np-toolbar');
            const pickerTitles = { 'ql-header': 'Text style', 'ql-font': 'Font', 'ql-color': 'Text color', 'ql-background': 'Highlight color' };
            Object.entries(pickerTitles).forEach(([cls, label]) => {
                const p = tb && tb.querySelector('.ql-picker.' + cls);
                if (p) p.setAttribute('title', label);
            });
        } catch (_) { /* ignore */ }
        // Restore the persisted spellcheck preference (global, all notes).
        try { this._applySpellcheck(false); } catch (_) { /* ignore */ }
        // Append keyboard shortcuts to toolbar tooltips. Quill binds Cmd/Ctrl+B/I/U
        // and history undo/redo by default; show the platform-correct modifier
        // (Cmd on Mac, Ctrl on Windows/Linux).
        try {
            const tbShort = this.el.querySelector('#np-toolbar');
            const isMac = /Mac|iPhone|iPad|iPod/i.test((navigator.platform || navigator.userAgent || ''));
            const mod = isMac ? '\u2318' : 'Ctrl+';
            const shift = isMac ? '\u21E7' : 'Shift+';
            const shortcuts = {
                'ql-bold': mod + 'B',
                'ql-italic': mod + 'I',
                'ql-underline': mod + 'U',
                'ql-undo': mod + 'Z',
                'ql-redo': mod + shift + 'Z',
            };
            for (const cls in shortcuts) {
                const b = tbShort && tbShort.querySelector('.' + cls);
                if (!b) continue;
                const base = (b.getAttribute('title') || '').replace(/\s*\([^)]*\)\s*$/, '');
                b.setAttribute('title', base + ' (' + shortcuts[cls] + ')');
            }
        } catch (_) { /* ignore */ }
        // Keep the current inline font (e.g. monospace) across Enter — Quill
        // otherwise drops it on the new line. Re-apply it right after the break.
        try {
            this.quill.keyboard.addBinding({ key: 'Enter' }, (range) => {
                const font = (this.quill.getFormat(range.index, 0) || {}).font;
                if (font) setTimeout(() => {
                    const s = this.quill.getSelection();
                    if (s) this.quill.format('font', font, 'user');
                }, 0);
                return true; // let Quill insert the newline as normal
            });
        } catch (_) { /* ignore */ }
        // Tab / Shift+Tab inside a list should indent / outdent the item from
        // ANY cursor position. Quill's built-in binding only indents at offset
        // 0; anywhere else it falls through to the literal-tab binding, which
        // inserted whitespace after the checkbox instead of nesting the item.
        // Prepend our bindings so they win over the default '\t' insert.
        try {
            const kb = this.quill.keyboard;
            const tabList = kb.bindings.Tab || (kb.bindings.Tab = []);
            const outdent = {
                key: 'Tab', shiftKey: true, format: ['list'],
                handler: () => { this.quill.format('indent', '-1', 'user'); return false; },
            };
            const indent = {
                key: 'Tab', shiftKey: false, format: ['list'],
                handler: () => { this.quill.format('indent', '+1', 'user'); return false; },
            };
            tabList.unshift(indent);
            tabList.unshift(outdent);
        } catch (_) { /* ignore */ }
        this.quill.on('text-change', (delta, old, source) => {
            if (source === 'user') { this._dirty = true; this._setSaveState('Editing\u2026'); this._scheduleSave(); }
        });
        // Collapsible headers: an arrow in the header's left gutter folds every
        // block under it until the next same-or-higher header. Persists per note.
        this.quill.root.addEventListener('click', (e) => {
            // The fold arrow now lives in the editor's left padding (to the left
            // of the flush header text), so a click on it targets the editor,
            // not the header. Treat any click in that left gutter as an arrow
            // click and fold whichever header occupies that vertical band.
            const root = this.quill.root;
            const contentLeft = root.getBoundingClientRect().left + 15; // editor left padding
            if (e.clientX > contentLeft) return; // not in the arrow gutter
            let target = null;
            for (const hh of root.querySelectorAll('h1,h2,h3,h4')) {
                const r = hh.getBoundingClientRect();
                if (e.clientY >= r.top && e.clientY <= r.bottom) { target = hh; break; }
            }
            if (!target) return;
            e.preventDefault();
            target.classList.toggle('np-hcol');
            this._applyHeaderCollapse();
            this._saveCollapseState();
        });
        this.quill.on('text-change', () => { this._applyHeaderCollapse(); });
        // Entity-link clicks (delegated; chips are contenteditable=false).
        this.quill.root.addEventListener('click', (e) => {
            const chip = e.target.closest && e.target.closest('.np-entity');
            if (chip && this.el.contains(chip)) {
                // Item chips are wired to the shared drop-item-popover in the
                // blot itself; let that handle the click. Drop chips navigate to
                // their activity (dispatchNotepadEntity), so don't skip them.
                const ct = chip.getAttribute('data-type');
                // Item + achievement chips are wired to the shared anchored
                // popover (drop-item-popover) which handles their own click;
                // let that run. Drop chips navigate to their activity.
                if (ct === 'item' || ct === 'achievement') return;
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
        // Checklist items toggle natively on a single click of Quill's checkbox
        // (.ql-ui has cursor:pointer + Quill's own click handler). A prior custom
        // handler double-toggled (revert) or swallowed the click (no toggle), so
        // it was removed — native single-click is the reliable path.
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
            this._restoreCollapseState();
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
            // Don't pre-set currentId here: _selectNote() early-returns when
            // id === this.currentId, so setting it first left the editor showing
            // the OLD note. Refresh the list, then select the new note for real.
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
            const body = JSON.stringify({ content_json: content });
            const opts = { method: 'PUT', body };
            // Browsers cap the total in-flight keepalive body at ~64KB, so only
            // use keepalive for notes small enough to fit. Larger notes will have
            // been persisted by the debounced autosave during editing.
            if (keepalive && body.length < 60000) opts.keepalive = true;
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

    // ---- spellcheck toggle ----------------------------------------------
    // Toggles the browser's native spellcheck (the red squiggles) on the
    // editor's contenteditable root. Preference is global across all notes.

    _applySpellcheck(refocus) {
        const on = (localStorage.getItem('np_spellcheck') !== 'off');
        const root = this.quill && this.quill.root;
        if (!root) return;
        root.setAttribute('spellcheck', on ? 'true' : 'false');
        const btn = this.el.querySelector('.ql-spellcheck');
        if (btn) {
            btn.classList.toggle('np-sc-off', !on);
            btn.setAttribute('title', on ? 'Spellcheck on (click to disable)' : 'Spellcheck off (click to enable)');
        }
        // Chrome/Firefox only re-evaluate squiggles on focus, so blur+refocus
        // to clear (or re-add) them on already-typed text immediately.
        if (refocus) {
            let sel = null;
            try { sel = this.quill.getSelection(); } catch (_) {}
            try { root.blur(); } catch (_) {}
            setTimeout(() => {
                try { this.quill.focus(); if (sel) this.quill.setSelection(sel, 'silent'); } catch (_) {}
            }, 0);
        }
    }

    _toggleSpellcheck() {
        const on = (localStorage.getItem('np_spellcheck') !== 'off');
        localStorage.setItem('np_spellcheck', on ? 'off' : 'on');
        this._applySpellcheck(true);
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
    // ---- collapsible headers -------------------------------------------

    _headerLevel(el) { const m = /^H([1-4])$/.exec(el.tagName || ''); return m ? +m[1] : 0; }

    // Walk the editor's blocks; a collapsed header hides following blocks until
    // the next header of the same-or-higher level. Nesting-aware via a stack.
    _applyHeaderCollapse() {
        if (!this.quill) return;
        let stack = []; // levels of currently-active collapses
        for (const el of Array.from(this.quill.root.children)) {
            const lvl = this._headerLevel(el);
            if (lvl > 0) {
                stack = stack.filter((l) => l < lvl); // this header ends >= collapses
                const hidden = stack.length > 0;
                el.classList.toggle('np-hidden', hidden);
                if (!hidden && el.classList.contains('np-hcol')) stack.push(lvl);
            } else {
                el.classList.toggle('np-hidden', stack.length > 0);
            }
        }
    }

    _collapseKey() { return 'np_collapsed_' + (this.currentId || 'none'); }

    _saveCollapseState() {
        try {
            const hs = Array.from(this.quill.root.querySelectorAll('h1,h2,h3,h4'));
            const idx = hs.map((h, i) => (h.classList.contains('np-hcol') ? i : -1)).filter((i) => i >= 0);
            localStorage.setItem(this._collapseKey(), JSON.stringify(idx));
        } catch (_) { /* ignore */ }
    }

    _restoreCollapseState() {
        try {
            const hs = Array.from(this.quill.root.querySelectorAll('h1,h2,h3,h4'));
            hs.forEach((h) => h.classList.remove('np-hcol'));
            const raw = localStorage.getItem(this._collapseKey());
            if (raw) {
                const idx = new Set(JSON.parse(raw));
                hs.forEach((h, i) => { if (idx.has(i)) h.classList.add('np-hcol'); });
            }
        } catch (_) { /* ignore */ }
        this._applyHeaderCollapse();
    }

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
        this._wireAchievementChips();
    }

    // Wire achievement chips to the shared anchored popover (icon + name, a
    // Wiki button, and the requirement text). Requirement text isn't stored on
    // the chip, so we resolve it from /api/achievements (loaded once). Guarded
    // per-chip so re-render is cheap.
    _wireAchievementChips() {
        if (!this.quill) return;
        const chips = this.quill.root.querySelectorAll(
            '.np-entity[data-type="achievement"]:not([data-ach-wired])');
        if (!chips.length) return;
        this._loadAchievements().then(() => {
            chips.forEach((chip) => {
                if (chip.getAttribute('data-ach-wired')) return;
                const id = chip.getAttribute('data-ref-id') || '';
                const a = (this._achievementsById && this._achievementsById[id]) || null;
                const ach = {
                    id,
                    name: (a && a.name) || chip.getAttribute('data-label') || 'Achievement',
                    icon: (a && a.icon) || chip.getAttribute('data-icon') || '',
                    requirements: (a && a.requirements) || [],
                };
                try { wireAchievementAnchor(chip, ach); } catch (_) { /* best-effort */ }
            });
        }).catch((e) => { console.warn('[notepad] achievement wiring failed', e); });
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

    // Read the effective colors off a live header nav button (default styling
    // OR the user's top-bar customization) and mirror them onto a popup type
    // button's icon chip, so linking a crafting tree / achievement matches the
    // color the user sees in the header. getComputedStyle resolves color values
    // even while the nav button is display:none.
    _mirrorNavColors(btn, navId, opts) {
        opts = opts || {};
        try {
            const ticon = btn.querySelector('.np-ticon');
            const img = ticon && ticon.querySelector('img');
            const nav = document.getElementById(navId);
            const firstColor = (str) => {
                const m = str && String(str).match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/);
                return m ? m[0] : '';
            };
            const isBlank = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
            let bg = '';
            let iconCol = '';
            if (nav) {
                const cs = getComputedStyle(nav);
                bg = isBlank(cs.backgroundColor) ? firstColor(cs.backgroundImage) : cs.backgroundColor;
                if (opts.mono) {
                    const glyph = nav.querySelector('svg [fill]:not([fill="none"]), svg [stroke]:not([stroke="none"]), svg');
                    if (glyph) {
                        const gs = getComputedStyle(glyph);
                        iconCol = (!isBlank(gs.fill) && gs.fill) || (!isBlank(gs.stroke) && gs.stroke) || gs.color || '';
                    }
                }
            }
            if (isBlank(bg) && opts.fallbackBg) bg = opts.fallbackBg;
            if (opts.mono && isBlank(iconCol)) iconCol = opts.fallbackIcon || '#ffffff';
            if (ticon && !isBlank(bg)) ticon.style.background = bg;
            // Monochrome icon: mask-tint the <img> to the glyph color so an
            // arbitrary custom color works (a CSS filter could only make white).
            if (opts.mono && img && !isBlank(iconCol)) {
                const src = img.getAttribute('src');
                img.src = NP_TRANSPARENT_PX;
                img.style.filter = 'none';  // drop the fallback white-invert filter
                img.style.backgroundColor = iconCol;
                img.style.webkitMask = "url('" + src + "') center/contain no-repeat";
                img.style.mask = "url('" + src + "') center/contain no-repeat";
            }
        } catch (_) { /* best-effort — leave the default styling */ }
    }

    _openInsertMenu() {
        const types = ['item', 'drop', 'recipe', 'activity', 'location', 'crafting_tree', 'gearset', 'achievement'];
        const TYPE_IMG = {
            item: '/assets/icons/items.svg',
            drop: '/assets/icons/attributes/materials.svg',
            recipe: '/assets/icons/recipes.svg',
            activity: '/assets/icons/activities.svg',
            location: '/assets/icons/locations.svg',
            crafting_tree: '/assets/icons/crafting_tree.svg',
            gearset: '/assets/icons/gear_icon.svg',
            achievement: '/assets/icons/achievements.svg',
        };
        this._modal((body, closeModal) => {
            body.insertAdjacentHTML('beforeend', '<div class="np-modal-title">Insert link</div>');
            const grid = document.createElement('div');
            grid.className = 'np-type-grid';
            for (const t of types) {
                const b = document.createElement('button');
                b.className = 'np-type-btn np-type-' + t;
                const src = TYPE_IMG[t];
                const iconHtml = src
                    ? '<span class="np-ticon"><img src="' + src + '" alt="" loading="lazy"></span>'
                    : '<span class="np-entity-icon">' + NP_TYPE_ICON[t] + '</span>';
                b.innerHTML = iconHtml + NP_TYPE_LABEL[t];
                // Crafting-tree and achievement icons mirror their nav-button
                // colors (the top-bar customization the user may have set — or
                // the defaults if untouched), read live off the header buttons.
                if (t === 'crafting_tree') {
                    this._mirrorNavColors(b, 'crafting-tree-nav-btn', { mono: true, fallbackBg: '#0d6d18', fallbackIcon: '#ffffff' });
                } else if (t === 'achievement') {
                    this._mirrorNavColors(b, 'achievements-nav-btn', { mono: false });
                }
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
        if (type === 'achievement') {
            this._pickAchievement();
            return;
        }
    }

    // ---- achievements ----------------------------------------------------

    // Difficulty display labels (game tiers: easy/normal/hard/extreme).
    _achDifficultyLabel(d) {
        return ({ easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' })[d]
            || (d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Other');
    }

    // Fetch /api/achievements once; build a flat id -> entry map for popups.
    async _loadAchievements() {
        if (this._achievementsData) return this._achievementsData;
        const data = await jsonFetch('/api/achievements');
        this._achievementsData = data || { order: [], groups: {} };
        this._achievementsById = {};
        for (const list of Object.values(this._achievementsData.groups || {})) {
            for (const a of (list || [])) this._achievementsById[a.id] = a;
        }
        return this._achievementsData;
    }

    async _pickAchievement() {
        let data;
        try { data = await this._loadAchievements(); }
        catch (e) { console.warn('[notepad] achievements failed', e); this._infoModal('Achievements are not available.'); return; }
        const order = (data.order && data.order.length) ? data.order : ['easy', 'normal', 'hard', 'extreme'];
        const sections = [];
        for (const diff of order) {
            const list = (data.groups && data.groups[diff]) || [];
            if (!list.length) continue;
            const rows = list.map(a => ({
                name: a.name, label: a.name, refId: a.id, icon: a.icon,
                // Second-line description so users can see what each achievement
                // asks for while picking (the requirement text).
                desc: (a.requirements || []).join('; '),
                // Include the requirement text so the picker search matches it
                // too (e.g. searching "ring" finds "Only Two Fingers?" whose
                // requirement is "Have both Ring slots equipped").
                search: ((a.name || '') + ' ' + ((a.requirements || []).join(' '))).toLowerCase(),
            }));
            sections.push({ label: this._achDifficultyLabel(diff), children: [], rows });
        }
        this._listPickerModal('Link an achievement', sections, (r) =>
            this._insertEntity({ type: 'achievement', refId: r.refId, label: r.label, icon: r.icon }));
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
        if ((node.rows || []).some(r => (r.name || '').toLowerCase().includes(ql) || (r.search || '').includes(ql))) return true;
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
            : (node.rows || []).filter(r => (r.name || '').toLowerCase().includes(ql) || (r.search || '').includes(ql));
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
        if (r.desc) {
            // Two-line row: name on top, requirement description below in
            // smaller, greyer text. Wrap both in a column so the icon stays
            // vertically centered against the pair.
            row.classList.add('np-pick-r2');
            const text = document.createElement('span');
            text.className = 'np-pick-text';
            text.appendChild(span);
            const d = document.createElement('span');
            d.className = 'np-pick-desc';
            d.textContent = r.desc;
            text.appendChild(d);
            row.appendChild(text);
        } else {
            row.appendChild(span);
        }
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
                        const locIcon = loc.icon_name ? ('/assets/icons/locations/' + loc.icon_name) : (loc.icon_path || loc.icon);
                        this._insertEntity({ type: 'location', refId: loc.id, label: loc.name || loc.label || loc.id, icon: locIcon });
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

    /** One-time-per-device beta notice shown when the notepad is first opened. */
    _maybeShowBetaNotice() {
        try {
            if (localStorage.getItem('np_beta_notice_v1')) return;
        } catch (_) { return; }
        // Mark as shown immediately so it only ever appears once per device,
        // regardless of how the user dismisses it (button or outside click).
        try { localStorage.setItem('np_beta_notice_v1', '1'); } catch (_) { /* ignore */ }
        this._modal((body, close) => {
            body.insertAdjacentHTML('beforeend',
                '<div class="np-modal-title">\uD83D\uDCDD Notepad is in beta</div>' +
                '<div class="np-modal-msg">The Notepad is brand new and still in <b>beta</b>, so you may hit some rough edges.<br><br>' +
                'If anything looks broken or acts weird, please <b>report it</b> using the site\u2019s Bug Report tool (the <b>B</b> hotkey on the main page) \u2014 every report helps us fix things fast.<br><br>' +
                'Your notes are saved to your session UUID.</div>');
            const ok = document.createElement('button');
            ok.className = 'np-btn';
            ok.textContent = 'Got it';
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
.notepad-page .np-empty{padding:12px;color:#888;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)))}
.notepad-page .np-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0}
.notepad-page .np-topbar{display:flex;align-items:flex-start;gap:8px;background:var(--bg-secondary,#1d1f24);border-bottom:1px solid #33363d;flex-wrap:wrap;position:relative;padding-right:210px}
.notepad-page .np-toolbar.ql-toolbar.ql-snow{border:none;flex:1}
.notepad-page .np-actions{position:absolute;top:6px;right:10px;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;justify-content:flex-end}
.notepad-page .np-save-state{font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));color:#8a8f99;text-align:right;white-space:nowrap}
@media (max-width:900px){.notepad-page .np-topbar{padding-right:104px}.notepad-page .np-actions{max-width:84px;flex-wrap:wrap}.notepad-page .np-save-state{flex-basis:100%}}
@media (max-width:768px){.notepad-page .np-topbar{padding-right:92px}.notepad-page .np-actions{right:8px;max-width:80px;flex-wrap:wrap}.notepad-page .np-save-state{flex-basis:100%}}
.notepad-page .np-btn{background:#2f3340;color:#e8eaef;border:1px solid #41454f;border-radius:6px;padding:8px 14px;cursor:pointer;font-size: max(var(--min-text, 5px), calc(15px * var(--text-scale, 1)))}
.notepad-page .np-btn:hover{background:#3a3f4d}
.notepad-page .np-new{color:#f1c40f}
.notepad-page .np-custom-swatch{float:left;box-sizing:border-box;width:16px;height:16px;margin:2px;border:1px solid #fff;border-radius:2px;overflow:hidden;cursor:pointer;padding:0;position:relative;vertical-align:top}
.notepad-page .np-custom-swatch input[type=color]{width:200%;height:200%;margin:-25% 0 0 -25%;border:none;padding:0;cursor:pointer;background:none}
.notepad-page .np-dd-host{min-height:44px}
.notepad-page .np-icon-btn{background:transparent;color:#cfd3da;border:none;font-size: max(var(--min-text, 5px), calc(18px * var(--text-scale, 1)));cursor:pointer;padding:6px 10px;line-height:1}
.notepad-page .np-icon-btn:hover{color:#f1c40f}
.notepad-page .np-collapse-toggle{display:flex;align-items:center;justify-content:center;align-self:stretch;padding:6px 10px}
.notepad-page .np-collapse-toggle svg{width:18px;height:18px;transition:transform .2s ease}
.notepad-page .np-frame.np-collapsed .np-collapse-toggle svg{transform:rotate(180deg)}
.notepad-page .np-editor{flex:1;min-height:0;background:var(--bg-primary,#15161a)}
.notepad-page #np-editor.ql-container.ql-snow{border:none;display:flex;flex-direction:column;min-height:0;font-family:inherit}
.notepad-page #np-editor .ql-editor{flex:1;overflow-y:auto;color:var(--text-primary,#e8eaef);font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)))}
.notepad-page .ql-editor li[data-list=checked]{text-decoration:line-through;opacity:.55}
/* Checklist checkbox: style the .ql-ui element ITSELF as the box. Quill's native
   per-checkbox toggle listener is on .ql-ui, so making the element the box keeps
   the click hit-area identical to the visible box (a prior attempt styled the
   ::before child with negative margins, moving the visual off the hit-area and
   breaking toggling). The glyph is neutralized; ✓ shows only when checked. */
.notepad-page .ql-editor li[data-list=unchecked] > .ql-ui,
.notepad-page .ql-editor li[data-list=checked] > .ql-ui{
  box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  left:0;top:.18em;width:1.05em;height:1.05em;margin:0;
  border:2px solid #9198a3;border-radius:4px;background:transparent;
  color:#15161a;font-size:1.05em;font-weight:700;line-height:1;cursor:pointer}
.notepad-page .ql-editor li[data-list=unchecked] > .ql-ui::before,
.notepad-page .ql-editor li[data-list=checked] > .ql-ui::before{
  content:'';margin:0;padding:0;width:auto;text-align:center;line-height:1}
.notepad-page .ql-editor li[data-list=checked] > .ql-ui{background:#f1c40f;border-color:#f1c40f}
.notepad-page .ql-editor li[data-list=checked] > .ql-ui::before{content:'\u2713'}
/* Checklist items sit too far from the left margin (Quill nests them in ol+li
   padding). Pull the whole item left uniformly so box + text keep their gap. */
.notepad-page .ql-editor li[data-list=checked],.notepad-page .ql-editor li[data-list=unchecked]{margin-left:-1.15em}
/* Indented checklist items: the checkbox is position:absolute at left:0, so
   Quill's per-level padding-left (3em/level) shifted only the text and left the
   box pinned at the margin (looked like a tab after the box). Move the box right
   by the same 3em/level so it stays beside its now-nested text. */
.notepad-page .ql-editor li[data-list=checked].ql-indent-1 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-1 > .ql-ui{left:3em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-2 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-2 > .ql-ui{left:6em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-3 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-3 > .ql-ui{left:9em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-4 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-4 > .ql-ui{left:12em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-5 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-5 > .ql-ui{left:15em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-6 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-6 > .ql-ui{left:18em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-7 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-7 > .ql-ui{left:21em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-8 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-8 > .ql-ui{left:24em}
.notepad-page .ql-editor li[data-list=checked].ql-indent-9 > .ql-ui,.notepad-page .ql-editor li[data-list=unchecked].ql-indent-9 > .ql-ui{left:27em}
/* undo/redo: a touch of breathing room between them */
.notepad-page .ql-toolbar button.ql-undo{margin-right:5px}
.notepad-page .ql-editor table{border-collapse:collapse;margin:6px 0}
.notepad-page .ql-editor td{border:1px solid #4a4f5a;padding:5px 9px;min-width:46px}
.notepad-page .ql-font-monospace{font-family:ui-monospace,Menlo,Consolas,monospace}
/* Font/header pickers: widen so 'Monospace'/'Heading N' labels aren't clipped */
.notepad-page .ql-toolbar .ql-picker.ql-font{width:120px}
.notepad-page .ql-toolbar .ql-picker.ql-header{width:104px}
.notepad-page .ql-toolbar .ql-picker.ql-font .ql-picker-label,
.notepad-page .ql-toolbar .ql-picker.ql-header .ql-picker-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:18px}
.notepad-page .ql-toolbar .ql-picker.ql-font .ql-picker-options,
.notepad-page .ql-toolbar .ql-picker.ql-header .ql-picker-options{white-space:nowrap}
/* Collapsible headers: left-gutter arrow + slide fold */
.notepad-page .ql-editor h1,.notepad-page .ql-editor h2,.notepad-page .ql-editor h3,.notepad-page .ql-editor h4{position:relative;padding-left:0}
.notepad-page .ql-editor h1::before,.notepad-page .ql-editor h2::before,.notepad-page .ql-editor h3::before,.notepad-page .ql-editor h4::before{content:'\u25BE';position:absolute;left:-15px;top:0;bottom:0;width:15px;display:flex;align-items:center;justify-content:center;color:#8a8f99;cursor:pointer;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)))}
.notepad-page .ql-editor h1.np-hcol::before,.notepad-page .ql-editor h2.np-hcol::before,.notepad-page .ql-editor h3.np-hcol::before,.notepad-page .ql-editor h4.np-hcol::before{content:'\u25B8'}
.notepad-page .ql-editor > *{max-height:1500px;transition:max-height .22s ease,opacity .18s ease}
.notepad-page .ql-editor > .np-hidden{max-height:0!important;opacity:0!important;overflow:hidden!important;margin-top:0!important;margin-bottom:0!important;padding-top:0!important;padding-bottom:0!important;pointer-events:none}
.notepad-page #np-editor .ql-editor.ql-blank::before{color:#7e828c;font-style:normal;left:15px}
.notepad-page .ql-snow .ql-stroke{stroke:#cfd3da}
.notepad-page .ql-snow .ql-fill,.notepad-page .ql-snow .ql-stroke.ql-fill{fill:#cfd3da}
.notepad-page .ql-snow .ql-picker{color:#cfd3da}
.notepad-page .ql-snow .ql-picker-options{background:#1d1f24;border-color:#41454f}
.notepad-page .ql-snow.ql-toolbar button:hover .ql-stroke,.notepad-page .ql-snow .ql-toolbar button.ql-active .ql-stroke{stroke:#f1c40f}
.notepad-page .ql-snow.ql-toolbar button:hover .ql-fill,.notepad-page .ql-snow.ql-toolbar button.ql-active .ql-fill{fill:#f1c40f}
.notepad-page .ql-snow .ql-picker-label:hover,.notepad-page .ql-snow .ql-picker-item:hover{color:#f1c40f}
.notepad-page .ql-toolbar.ql-snow .ql-picker-label{color:#cfd3da}
.notepad-page .ql-toolbar .ql-entity{font-size: max(var(--min-text, 5px), calc(19px * var(--text-scale, 1)));width:34px}
/* Link/entity button: items/gear tab icon (native colors) with a colored link
   emoji badge in the bottom-right corner. */
.notepad-page .ql-toolbar .ql-entity .np-linkicon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;line-height:1}
.notepad-page .ql-toolbar .ql-entity .np-li-base{width:100%;height:100%;object-fit:contain;display:block}
.notepad-page .ql-toolbar .ql-entity .np-li-over{position:absolute;right:-3px;bottom:-3px;font-size: max(var(--min-text, 5px), calc(17px * var(--text-scale, 1)));line-height:1;pointer-events:none;filter:grayscale(1) brightness(1.15);text-shadow:0 0 2px #15161a,0 0 2px #15161a}
.notepad-page .ql-toolbar.ql-snow button{width:34px;height:32px;padding:4px}
.notepad-page .ql-toolbar.ql-snow button svg{width:22px;height:22px}
.notepad-page .ql-toolbar.ql-snow .ql-picker.ql-color-picker,.notepad-page .ql-toolbar.ql-snow .ql-picker.ql-icon-picker{width:34px}
.notepad-page .ql-toolbar.ql-snow .ql-picker-label{font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)))}
.np-entity{display:inline-flex;align-items:center;gap:4px;background:#3a3320;border:1px solid #6b5b1e;border-radius:10px;padding:0 7px;margin:2px 1px;cursor:pointer;font-size: max(var(--min-text, 5px), calc(13px * var(--text-scale, 1)));line-height:1.6;color:#ffe79a;white-space:nowrap;vertical-align:baseline}
.np-entity:hover{background:#4a4026}
.np-entity .np-entity-icon{font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)))}
.np-entity-recipe{background:#1f2c44;border-color:#3a5a8c;color:#bcd4ff}
.np-entity-activity{background:#3a2a1f;border-color:#8c5a3a;color:#ffcaa3}
.np-entity-crafting_tree{background:#1f3322;border-color:#3a7a45;color:#aef0bd}
.np-entity-gearset{background:#2c2244;border-color:#5a3a8c;color:#d8c2ff}
.np-entity-location{background:#3a1f2c;border-color:#8c3a5a;color:#ffc2d8}
.np-entity-achievement{background:#3a331c;border-color:#8c7a3a;color:#ffe9a8}
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
.np-type-btn{display:flex;align-items:center;gap:8px;background:#2a2e37;border:1px solid #41454f;border-radius:8px;padding:10px;cursor:pointer;color:#e8eaef;font-size: max(var(--min-text, 5px), calc(14px * var(--text-scale, 1)))}
.np-type-btn:hover{background:#343a45}
.np-type-btn .np-ticon{flex:0 0 auto;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border-radius:6px;padding:3px;box-sizing:border-box}
.np-type-btn .np-ticon img{width:100%;height:100%;object-fit:contain;display:block}
/* Crafting tree keeps its themed colored square (green bg + white glyph) so it
   reads like the crafting-tree nav button rather than a bare dark icon. */
.np-type-btn.np-type-crafting_tree .np-ticon{background:#0d6d18}
.np-type-btn.np-type-crafting_tree .np-ticon img{filter:brightness(0) invert(1)}
.np-search{width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #41454f;background:#15161a;color:#fff;font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)))}
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
/* Two-line picker rows (achievements): name + smaller grey requirement text. */
.np-pick-text{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.np-pick-text .np-pick-name{flex:none;width:100%}
.np-pick-desc{font-size: max(var(--min-text, 5px), calc(12px * var(--text-scale, 1)));color:#9aa0aa;white-space:normal;line-height:1.25;margin-top:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.np-entity-img{width:16px;height:16px;border-radius:3px;object-fit:contain;vertical-align:middle}
.notepad-page .ql-toolbar button.ql-table-menu svg{width:19px;height:19px}
/* Spellcheck toggle: A+check glyph with a red underline. On = bright w/ red
   underline; off = dimmed with a grey underline. */
.notepad-page .ql-toolbar button.ql-spellcheck .np-sc-wave{fill:none;stroke:#e74c3c;stroke-width:1.7;stroke-linecap:round}
.notepad-page .ql-toolbar button.ql-spellcheck.np-sc-off{opacity:.5}
.notepad-page .ql-toolbar button.ql-spellcheck.np-sc-off .np-sc-wave{stroke:#8a8f99}
.notepad-page .ql-toolbar button.ql-undo,.notepad-page .ql-toolbar button.ql-redo{width:34px;height:34px;padding:0;font-size: max(var(--min-text, 5px), calc(20px * var(--text-scale, 1)));line-height:32px;text-align:center;border:1px solid #41454f;border-radius:50%;background:transparent;color:#cfd3da;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
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
.np-error{padding:40px;color:#e88;text-align:center;font-size: max(var(--min-text, 5px), calc(16px * var(--text-scale, 1)))}
.np-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#2a2e37;color:#fff;border:1px solid #41454f;padding:10px 16px;border-radius:8px;opacity:0;transition:all .2s;z-index:2000;pointer-events:none}
.np-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:768px){.notepad-page .np-sidebar{--np-sb-w:160px}}
`;
        document.head.appendChild(s);
    }
}
