/**
 * Travel Gearset Picker — popup to select an existing saved gearset.
 *
 * Reads from store.state.gearsets.saved and shows a searchable list.
 * When the user picks one, calls the onSelect callback with the gearset data.
 */

let activePickerEl = null;

/**
 * Show the gearset picker popup anchored near the given button.
 * @param {HTMLElement} anchor - The "Select Existing" button
 * @param {Function} onSelect - Called with { name, export_string, slots } when user picks one
 */
export function showGearsetPicker(anchor, onSelect) {
    dismissGearsetPicker();

    // Dynamically import state to get saved gearsets
    import('./state.js').then(({ default: store }) => {
        const saved = store.state.gearsets?.saved || {};
        const gearsets = Object.entries(saved).map(([id, gs]) => ({
            id,
            name: gs.name,
            export_string: gs.export_string,
            slots: gs.slots,
        }));

        if (gearsets.length === 0) {
            if (window.api) window.api.showInfo('No saved gear sets. Save one in the Gear Stats column first.');
            return;
        }

        const popup = document.createElement('div');
        popup.className = 'travel-gearset-picker-popup';

        let searchText = '';
        const renderList = () => {
            // Fail-safe: a saved gearset with a null/empty name must not throw
            // (gs.name.toLowerCase() on undefined) — an exception here bubbles
            // out of the .then() as a silent unhandled rejection and the whole
            // popup never renders, making "Select Existing" look dead.
            const filtered = gearsets.filter(gs =>
                (gs.name || '').toLowerCase().includes(searchText.toLowerCase())
            );
            const items = filtered.map(gs =>
                `<div class="travel-gearset-picker-item" data-id="${gs.id}">
                    <span class="travel-gearset-picker-name">${escapeHtml(gs.name || 'Unnamed')}</span>
                </div>`
            ).join('');
            return items || '<div class="travel-gearset-picker-empty">No matches</div>';
        };

        popup.innerHTML = `
            <div class="travel-gearset-picker-header">
                <span>Select Gear Set</span>
                <button class="travel-gearset-picker-close">✕</button>
            </div>
            <input type="text" class="travel-gearset-picker-search" placeholder="Search..." />
            <div class="travel-gearset-picker-list">${renderList()}</div>
        `;

        // Position near anchor
        document.body.appendChild(popup);
        const rect = anchor.getBoundingClientRect();
        const popW = Math.min(360, window.innerWidth - 24);
        popup.style.maxWidth = popW + 'px';
        popup.style.width = popW + 'px';

        let left = rect.left;
        let top = rect.bottom + 4;
        if (top + 300 > window.innerHeight) top = rect.top - 304;
        if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
        left = Math.max(8, left);
        top = Math.max(8, top);

        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        activePickerEl = popup;

        // Events
        const searchInput = popup.querySelector('.travel-gearset-picker-search');
        const listEl = popup.querySelector('.travel-gearset-picker-list');

        searchInput.addEventListener('input', (e) => {
            searchText = e.target.value;
            listEl.innerHTML = renderList();
        });

        searchInput.focus();

        popup.addEventListener('click', (e) => {
            const item = e.target.closest('.travel-gearset-picker-item');
            if (item) {
                const id = item.dataset.id;
                const gs = gearsets.find(g => g.id === id);
                if (gs) {
                    // Saved gearsets load in SUMMARY mode: both `slots` (slots_json)
                    // and `export_string` come back undefined until lazy-fetched
                    // via store._ensureGearSetFull(id). Handing the summary stub
                    // straight to onSelect gives callers (crafting-tree node select,
                    // travel gearset slots) an entry with BOTH fields undefined, so
                    // they silently do nothing — the "'Select existing' does nothing"
                    // regression (bonez565 424b34f7, resurfaced via the lazy-load
                    // path). Resolve the full payload first so onSelect always
                    // receives usable slots/export_string.
                    const deliver = (full) => {
                        const resolved = full || {};
                        onSelect({
                            id,
                            name: resolved.name != null ? resolved.name : gs.name,
                            export_string: resolved.export_string != null ? resolved.export_string : gs.export_string,
                            slots: resolved.slots != null ? resolved.slots : gs.slots,
                        });
                    };
                    const ensure = (store && typeof store._ensureGearSetFull === 'function')
                        ? store._ensureGearSetFull(id)
                        : Promise.resolve(null);
                    // Fail-safe: if the lazy-fetch rejects, still hand over the
                    // stub so the caller can surface its own error rather than
                    // the click being swallowed by an unhandled rejection.
                    Promise.resolve(ensure).then(deliver).catch(() => deliver(null));
                    dismissGearsetPicker();
                }
                return;
            }
            if (e.target.closest('.travel-gearset-picker-close')) {
                dismissGearsetPicker();
            }
        });

        // Dismiss on outside click
        requestAnimationFrame(() => {
            document.addEventListener('pointerdown', onOutside, { capture: true });
        });
    });
}

function onOutside(e) {
    if (activePickerEl && !activePickerEl.contains(e.target)) {
        dismissGearsetPicker();
        document.removeEventListener('pointerdown', onOutside, { capture: true });
    }
}

export function dismissGearsetPicker() {
    if (activePickerEl) {
        activePickerEl.remove();
        activePickerEl = null;
        document.removeEventListener('pointerdown', onOutside, { capture: true });
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
