/**
 * Notepad custom Quill blots + entity-link click dispatch.
 *
 * An "entity link" is an inline, non-editable chip embedded in a note that
 * references a WalkScape object by id (item / drop / recipe / activity /
 * crafting tree / gear set). It round-trips through the Quill Delta as
 *   { insert: { 'entity-link': { type, refId, label, targetItemId?, quality? } } }
 * Clicking it routes to the matching part of the app (see dispatchNotepadEntity).
 *
 * See .kiro/NOTEPAD_SPEC.md.
 */

export const NP_TYPE_ICON = {
    item: '\uD83D\uDCE6',          // 📦
    drop: '\uD83D\uDCA7',          // 💧
    recipe: '\uD83D\uDD28',        // 🔨
    activity: '\u26A1',            // ⚡
    crafting_tree: '\uD83C\uDF33', // 🌳
    gearset: '\uD83E\uDDF0',       // 🧰
    location: '\uD83D\uDCCD',      // 📍
};

export const NP_TYPE_LABEL = {
    item: 'Item',
    drop: 'Drop',
    recipe: 'Recipe',
    activity: 'Activity',
    crafting_tree: 'Crafting tree',
    gearset: 'Gear set',
    location: 'Location',
};

/** Normalize a raw blot value into a clean, fully-populated object. */
export function normalizeEntityValue(v) {
    v = v || {};
    const type = NP_TYPE_ICON[v.type] ? v.type : 'item';
    return {
        type,
        refId: v.refId != null ? String(v.refId) : '',
        label: v.label != null && String(v.label).length ? String(v.label) : NP_TYPE_LABEL[type],
        targetItemId: v.targetItemId != null && String(v.targetItemId).length ? String(v.targetItemId) : undefined,
        quality: v.quality != null && String(v.quality).length ? String(v.quality) : undefined,
        icon: v.icon != null && String(v.icon).length ? String(v.icon) : undefined,
        rarity: v.rarity != null && String(v.rarity).length ? String(v.rarity) : undefined,
        activityIcon: v.activityIcon != null && String(v.activityIcon).length ? String(v.activityIcon) : undefined,
    };
}

let _registered = false;

/** Register the EntityLink blot with a Quill constructor (idempotent). */
export function registerNotepadBlots(Quill) {
    if (!Quill || _registered) return;
    const Embed = Quill.import('blots/embed');

    class EntityLinkBlot extends Embed {
        static create(value) {
            const node = super.create();
            const v = normalizeEntityValue(value);
            node.setAttribute('data-type', v.type);
            node.setAttribute('data-ref-id', v.refId);
            node.setAttribute('data-label', v.label);
            if (v.targetItemId) node.setAttribute('data-target-item-id', v.targetItemId);
            if (v.quality) node.setAttribute('data-quality', v.quality);
            if (v.icon) node.setAttribute('data-icon', v.icon);
            if (v.rarity) node.setAttribute('data-rarity', v.rarity);
            if (v.activityIcon) node.setAttribute('data-activity-icon', v.activityIcon);
            node.setAttribute('contenteditable', 'false');
            node.classList.add('np-entity-' + v.type);
            // Item/drop chips are tinted by item rarity (matching column-2 gear
            // slots); other entity types keep their own themed colors.
            if ((v.type === 'item' || v.type === 'drop') && v.rarity) {
                node.classList.add('rarity-' + v.rarity);
            }
            node.title = NP_TYPE_LABEL[v.type] + ': ' + v.label;
            const mkImg = (src) => { const im = document.createElement('img'); im.className = 'np-entity-img'; im.src = src; im.alt = ''; return im; };
            const mkLab = (txt) => { const s = document.createElement('span'); s.className = 'np-entity-label'; s.textContent = txt; return s; };
            if (v.type === 'drop' && v.activityIcon) {
                // "[activityIcon] Activity \u203A [dropIcon] Drop" — clicking the
                // chip pulls up the activity (see dispatchNotepadEntity).
                const parts = String(v.label || '').split(' \u203A ');
                const aName = parts[0] || '';
                const dName = parts.length > 1 ? parts.slice(1).join(' \u203A ') : (v.label || '');
                node.appendChild(mkImg(v.activityIcon));
                node.appendChild(mkLab(aName + ' \u203A'));
                if (v.icon) node.appendChild(mkImg(v.icon));
                node.appendChild(mkLab(dName));
            } else {
                let icon;
                if (v.icon) {
                    icon = mkImg(v.icon);
                } else {
                    icon = document.createElement('span');
                    icon.className = 'np-entity-icon';
                    icon.textContent = NP_TYPE_ICON[v.type] || '';
                }
                node.appendChild(icon);
                node.appendChild(mkLab(v.label));
            }
            return node;
        }

        static value(node) {
            return normalizeEntityValue({
                type: node.getAttribute('data-type'),
                refId: node.getAttribute('data-ref-id'),
                label: node.getAttribute('data-label'),
                targetItemId: node.getAttribute('data-target-item-id'),
                quality: node.getAttribute('data-quality'),
                icon: node.getAttribute('data-icon'),
                rarity: node.getAttribute('data-rarity'),
                activityIcon: node.getAttribute('data-activity-icon'),
            });
        }
    }
    EntityLinkBlot.blotName = 'entity-link';
    EntityLinkBlot.tagName = 'span';
    EntityLinkBlot.className = 'np-entity';

    Quill.register(EntityLinkBlot, true);
    _registered = true;
}

function _toast(msg) {
    try {
        let t = document.getElementById('np-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'np-toast';
            t.className = 'np-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._hideTimer);
        t._hideTimer = setTimeout(() => t.classList.remove('show'), 2600);
    } catch (_) { /* ignore */ }
}

function _closeNotepad() {
    try { if (window.location.hash === '#notepad') window.location.hash = ''; } catch (_) { /* ignore */ }
}

function _scrollColumn3() {
    try {
        const col3 = document.getElementById('column-3');
        if (col3 && col3.scrollIntoView) col3.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) { /* ignore */ }
}

/**
 * Route an entity-link click to the relevant part of the app. Every branch is
 * defensive: if the target subsystem isn't available it shows a toast rather
 * than throwing (graceful degradation per the spec).
 */
export function dispatchNotepadEntity(detail) {
    const v = normalizeEntityValue(detail);
    const store = window.store;
    try {
        switch (v.type) {
            case 'item':
                if (window.itemSelectionPopup && typeof window.itemSelectionPopup.show === 'function') {
                    _closeNotepad();
                    window.itemSelectionPopup.show('input', {});
                    // Best-effort: surface the linked item by pre-filling the
                    // popup's search box with its label.
                    setTimeout(() => {
                        try {
                            const inp = document.querySelector('#item-selection-popup input[type="text"], #item-selection-popup .search-input, #item-selection-popup input');
                            if (inp) {
                                inp.value = v.label;
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        } catch (_) { /* ignore */ }
                    }, 220);
                } else {
                    _toast('Item view is not available here.');
                }
                break;
            case 'drop':
                // A drop links to its activity: open the activity in column 3
                // and scroll to the drops section.
                _closeNotepad();
                if (window.activitySelector && typeof window.activitySelector.selectActivity === 'function') {
                    window.activitySelector.selectActivity(v.refId);
                    setTimeout(() => {
                        try {
                            const el = document.getElementById('drops-section');
                            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            else _scrollColumn3();
                        } catch (_) { _scrollColumn3(); }
                    }, 150);
                } else { _toast('Activity selector is not available.'); }
                break;
            case 'recipe':
                _closeNotepad();
                if (window.recipeSelector && typeof window.recipeSelector.selectRecipe === 'function') {
                    window.recipeSelector.selectRecipe(v.refId);
                    _scrollColumn3();
                } else { _toast('Recipe selector is not available.'); }
                break;
            case 'activity':
                _closeNotepad();
                if (window.activitySelector && typeof window.activitySelector.selectActivity === 'function') {
                    window.activitySelector.selectActivity(v.refId);
                    _scrollColumn3();
                } else { _toast('Activity selector is not available.'); }
                break;
            case 'gearset':
                _closeNotepad();
                if (store && typeof store.loadGearSet === 'function') {
                    Promise.resolve(store.loadGearSet(v.refId)).catch(() => _toast('Could not load that gear set (it may have been deleted).'));
                } else { _toast('Gear set loading is not available.'); }
                break;
            case 'location':
                _closeNotepad();
                try {
                    if (store && store.state) {
                        if (!store.state.column3) store.state.column3 = {};
                        store.state.column3.selectedLocation = v.refId;
                        if (typeof store._saveColumn3Selection === 'function') store._saveColumn3Selection();
                    }
                    window.dispatchEvent(new CustomEvent('notepad:selectLocation', { detail: { locationId: v.refId } }));
                    _scrollColumn3();
                } catch (_) { _toast('Could not open that location.'); }
                break;
            case 'crafting_tree':
                // Stash the requested preset so the crafting-tree view restores
                // the exact saved layout when it opens (consumed in loadTree).
                try { window._notepadPendingSavedTree = { treeId: v.refId, targetItemId: v.targetItemId || null }; } catch (_) { /* ignore */ }
                if (typeof window._openCraftingTreeGlobal === 'function') {
                    // Navigate: the handleHashChange top close-guard closes the
                    // notepad and the '#crafting-tree' branch opens the tree —
                    // a single open path, which consumes the pending preset.
                    window.location.hash = '#crafting-tree';
                } else {
                    _toast('Crafting tree is not available.');
                }
                break;
            default:
                _toast('Unknown link type.');
        }
    } catch (e) {
        console.warn('[notepad] entity dispatch failed', e);
        _toast('Could not open that link.');
    }
}
