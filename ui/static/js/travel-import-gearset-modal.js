/**
 * Travel Import Gearset Modal
 *
 * Full-screen modal for importing a gearset into a travel RouteGearset slot.
 * Two import methods:
 *   1. Paste an export string (base64-gzip encoded gearset)
 *   2. Select from saved gearsets
 *
 * On confirm the modal decodes/validates the gearset and calls the onConfirm
 * callback with { export_string, name, stats: null } so the caller can persist
 * it into the Travel_Config_Store and trigger terrain validation.
 *
 * Requirement 4.6
 */

// ---------------------------------------------------------------------------
// Decode helper (standalone — avoids coupling to ActionButtons / OptimizeButton)
// ---------------------------------------------------------------------------

function decodeGearsetExport(exportString) {
    if (typeof window.pako === 'undefined') {
        throw new Error('Compression library (pako) not loaded.');
    }

    let padded = exportString;
    const padding = exportString.length % 4;
    if (padding) padded += '='.repeat(4 - padding);

    const decoded = atob(padded);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
    }

    const decompressed = window.pako.inflate(bytes, { to: 'string' });
    return JSON.parse(decompressed);
}

// ---------------------------------------------------------------------------
// Escape helper
// ---------------------------------------------------------------------------

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Modal state
// ---------------------------------------------------------------------------

let activeModal = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the import gearset modal.
 *
 * @param {Object}   opts
 * @param {string}   opts.slotName    - Display name for the target slot (e.g. "Jarvonia 1")
 * @param {Function} opts.onConfirm   - Called with { export_string, name } on successful import
 * @param {Function} [opts.onCancel]  - Called when the modal is dismissed without importing
 */
export function showImportGearsetModal({ slotName = '', onConfirm, onCancel } = {}) {
    dismissImportGearsetModal();

    const overlay = document.createElement('div');
    overlay.className = 'travel-import-modal-overlay';

    overlay.innerHTML = `
        <div class="travel-import-modal">
            <div class="travel-import-modal-header">
                <span>Import Gearset${slotName ? ' — ' + escapeHtml(slotName) : ''}</span>
                <button class="travel-import-modal-close" aria-label="Close">✕</button>
            </div>

            <div class="travel-import-modal-body">
                <!-- Tab bar -->
                <div class="travel-import-tabs">
                    <button class="travel-import-tab active" data-tab="paste">Paste Export</button>
                    <button class="travel-import-tab" data-tab="saved">Saved Gearsets</button>
                </div>

                <!-- Paste tab -->
                <div class="travel-import-tab-content" data-tab="paste">
                    <label class="travel-import-label">Paste a gearset export string:</label>
                    <textarea class="travel-import-textarea" rows="4"
                              placeholder="Paste base64 export string here…"></textarea>
                    <div class="travel-import-error" style="display:none"></div>
                    <div class="travel-import-actions">
                        <button class="button travel-import-cancel-btn">Cancel</button>
                        <button class="button button-primary travel-import-confirm-btn">Import</button>
                    </div>
                </div>

                <!-- Saved gearsets tab -->
                <div class="travel-import-tab-content" data-tab="saved" style="display:none">
                    <input type="text" class="travel-import-search"
                           placeholder="Search saved gearsets…" />
                    <div class="travel-import-saved-list"></div>
                    <div class="travel-import-actions">
                        <button class="button travel-import-cancel-btn">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    activeModal = overlay;

    // -----------------------------------------------------------------------
    // Internal refs
    // -----------------------------------------------------------------------
    const modal = overlay.querySelector('.travel-import-modal');
    const textarea = overlay.querySelector('.travel-import-textarea');
    const errorEl = overlay.querySelector('.travel-import-error');
    const searchInput = overlay.querySelector('.travel-import-search');
    const savedList = overlay.querySelector('.travel-import-saved-list');
    const tabs = overlay.querySelectorAll('.travel-import-tab');
    const tabContents = overlay.querySelectorAll('.travel-import-tab-content');

    // -----------------------------------------------------------------------
    // Tab switching
    // -----------------------------------------------------------------------
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            for (const t of tabs) t.classList.remove('active');
            tab.classList.add('active');
            const target = tab.dataset.tab;
            for (const tc of tabContents) {
                tc.style.display = tc.dataset.tab === target ? '' : 'none';
            }
            if (target === 'paste') textarea.focus();
            if (target === 'saved') {
                searchInput.focus();
                renderSavedList('');
            }
        });
    }

    // -----------------------------------------------------------------------
    // Paste tab — confirm
    // -----------------------------------------------------------------------
    const confirmBtn = overlay.querySelector('.travel-import-confirm-btn');
    confirmBtn.addEventListener('click', () => {
        const raw = textarea.value.trim();
        if (!raw) {
            showError('Please paste a gearset export string.');
            return;
        }
        try {
            const data = decodeGearsetExport(raw);
            if (!data || !data.items || !Array.isArray(data.items)) {
                showError('Invalid gearset format — missing items array.');
                return;
            }
            // Success
            dismissImportGearsetModal();
            if (onConfirm) onConfirm({ export_string: raw, name: null });
        } catch (err) {
            console.error('[ImportGearsetModal] decode error:', err);
            showError('Invalid export string. Check that you copied the full string.');
        }
    });

    // Allow Enter in textarea to submit (Shift+Enter for newline)
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            confirmBtn.click();
        }
    });

    // -----------------------------------------------------------------------
    // Saved gearsets tab
    // -----------------------------------------------------------------------
    let savedGearsets = [];

    async function loadSavedGearsets() {
        try {
            const { default: store } = await import('./state.js');
            const saved = store.state.gearsets?.saved || {};
            savedGearsets = Object.entries(saved).map(([id, gs]) => ({
                id,
                name: gs.name || id,
                export_string: gs.export_string,
            }));
        } catch (err) {
            savedGearsets = [];
        }
        renderSavedList(searchInput.value);
    }

    function renderSavedList(filter) {
        const lc = (filter || '').toLowerCase();
        const filtered = savedGearsets.filter(gs =>
            gs.name.toLowerCase().includes(lc)
        );
        if (filtered.length === 0) {
            savedList.innerHTML = `<div class="travel-import-saved-empty">
                ${savedGearsets.length === 0
                    ? 'No saved gearsets. Save one in the Gear Stats column first.'
                    : 'No matches.'}
            </div>`;
            return;
        }
        savedList.innerHTML = filtered.map(gs => `
            <div class="travel-import-saved-item" data-id="${escapeHtml(gs.id)}">
                <span class="travel-import-saved-name">${escapeHtml(gs.name)}</span>
            </div>
        `).join('');
    }

    searchInput.addEventListener('input', () => renderSavedList(searchInput.value));

    savedList.addEventListener('click', (e) => {
        const item = e.target.closest('.travel-import-saved-item');
        if (!item) return;
        const id = item.dataset.id;
        const gs = savedGearsets.find(g => g.id === id);
        if (!gs) return;
        dismissImportGearsetModal();
        if (onConfirm) onConfirm({ export_string: gs.export_string || '__saved__', name: gs.name, saved_gearset_id: gs.id });
    });

    // Pre-load saved gearsets
    loadSavedGearsets();

    // -----------------------------------------------------------------------
    // Cancel / close / overlay click
    // -----------------------------------------------------------------------
    const cancelBtns = overlay.querySelectorAll('.travel-import-cancel-btn');
    for (const btn of cancelBtns) {
        btn.addEventListener('click', () => {
            dismissImportGearsetModal();
            if (onCancel) onCancel();
        });
    }

    overlay.querySelector('.travel-import-modal-close').addEventListener('click', () => {
        dismissImportGearsetModal();
        if (onCancel) onCancel();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            dismissImportGearsetModal();
            if (onCancel) onCancel();
        }
    });

    // Escape key
    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            dismissImportGearsetModal();
            if (onCancel) onCancel();
            document.removeEventListener('keydown', onKeyDown);
        }
    };
    document.addEventListener('keydown', onKeyDown);

    // -----------------------------------------------------------------------
    // Error display helper
    // -----------------------------------------------------------------------
    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = '';
    }

    // Focus textarea on open
    requestAnimationFrame(() => textarea.focus());

    // Convenience: if the clipboard already holds a gearset export string,
    // pre-fill the paste textarea. A base64-gzip export always starts with the
    // magic prefix "H4sI" (gzip bytes 0x1f 0x8b 0x08 base64-encode to H4sI).
    // Best-effort: silently no-ops on unsupported browsers / denied permission.
    autofillGearsetFromClipboard(textarea);
}

/**
 * Best-effort: read the clipboard and, if it looks like a base64-gzip gearset
 * export string, populate the (empty) paste textarea. Never throws / never
 * surfaces an error — failure just leaves the field blank.
 *
 * @param {HTMLTextAreaElement} textarea
 */
function autofillGearsetFromClipboard(textarea) {
    try {
        if (!textarea || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
            return;
        }
        navigator.clipboard.readText().then((text) => {
            if (typeof text !== 'string') return;
            const trimmed = text.trim();
            // base64-gzip export strings always start with "H4sI".
            if (!trimmed.startsWith('H4sI')) return;
            // Don't clobber anything already typed.
            if (textarea.value.trim()) return;
            textarea.value = trimmed;
        }).catch(() => { /* permission denied / unsupported — ignore */ });
    } catch (e) {
        /* ignore — clipboard access is a convenience, not required */
    }
}

/**
 * Dismiss the import modal if open.
 */
export function dismissImportGearsetModal() {
    if (activeModal) {
        activeModal.remove();
        activeModal = null;
    }
}
