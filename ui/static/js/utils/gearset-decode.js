/**
 * Decode a base64+pako gearset export string into a slot map suitable
 * for read-only gear-preview rendering.
 *
 * This is a standalone copy of the same logic used in
 * components/tree-node-card.js (kept private to that class). Extracting
 * it here lets the stats report page render compact gear previews
 * without depending on tree-node-card or instantiating its class.
 *
 * Returns: { slotName: { itemId, uuid, name, icon_path, rarity, quality,
 *                         is_generic, is_fine, level?, variant? } }
 *          or null if the export string can't be decoded (catalog not
 *          loaded, pako not loaded, or malformed export).
 *
 * Slot names: head, cape, back, chest, primary, secondary, hands, legs,
 *             neck, feet, ring1, ring2, tool0..tool5, pet, consumable.
 */
export function decodeGearsetSlots(exportString) {
    if (!exportString) {
        console.warn('[gearset-decode] empty exportString');
        return null;
    }
    if (typeof window === 'undefined' || typeof window.pako === 'undefined') {
        console.warn('[gearset-decode] window.pako not loaded');
        return null;
    }
    const catalog = window.api?._catalogCache;
    if (!catalog) {
        console.warn('[gearset-decode] window.api._catalogCache not loaded — caller should await api.getCatalog() first');
        return null;
    }

    try {
        let padded = exportString;
        const padding = exportString.length % 4;
        if (padding) padded += '='.repeat(4 - padding);

        const decoded = atob(padded);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);

        const decompressed = window.pako.inflate(bytes, { to: 'string' });
        const gearsetData = JSON.parse(decompressed);
        const slots = {};
        const catalogItems = catalog.items || [];

        // Pet metadata (level/variant) lives in generic_slots._pet_meta.
        // Without this overlay a level-3 dog renders as a level-0 egg.
        const petMeta = gearsetData.generic_slots && gearsetData.generic_slots._pet_meta;

        for (const itemData of gearsetData.items || []) {
            if (!itemData.item || itemData.item === 'null') continue;
            const itemJson = JSON.parse(itemData.item);
            const uuid = itemJson.id;
            const quality = itemJson.quality || 'common';
            const slotType = itemData.type;
            const index = itemData.index || 0;

            let slotName;
            if (slotType === 'ring') slotName = `ring${index + 1}`;
            else if (slotType === 'tool') slotName = `tool${index}`;
            else if (slotType === 'pet') slotName = 'pet';
            else if (slotType === 'consumable') slotName = 'consumable';
            else if (slotType === 'activityInput') continue;
            else slotName = slotType;

            if (uuid && uuid.startsWith('generic::')) continue;

            const fullItem = catalogItems.find(item => item.uuid === uuid);
            if (!fullItem) continue;

            // Crafted items: the export's `quality` is Normal/Good/Great/...
            // not a rarity string. Derive both for downstream rendering.
            const RARITY_TO_QUALITY = {
                common: 'Normal', uncommon: 'Good', rare: 'Great',
                epic: 'Excellent', legendary: 'Perfect', ethereal: 'Eternal',
            };
            const QUALITY_NAMES = new Set(['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal']);
            let qualityName = quality;
            if (!QUALITY_NAMES.has(qualityName)) {
                qualityName = RARITY_TO_QUALITY[String(quality).toLowerCase()] || 'Normal';
            }
            let rarity = fullItem.rarity;
            if (fullItem.type === 'crafted_item') {
                const qMap = {
                    normal: 'common', common: 'common', good: 'uncommon', uncommon: 'uncommon',
                    great: 'rare', rare: 'rare', excellent: 'epic', epic: 'epic',
                    perfect: 'legendary', legendary: 'legendary', eternal: 'ethereal', ethereal: 'ethereal',
                };
                rarity = qMap[String(quality).toLowerCase()] || 'common';
            }

            slots[slotName] = {
                itemId: fullItem.id || uuid,
                uuid,
                name: fullItem.name,
                icon_path: fullItem.icon_path,
                rarity,
                quality: qualityName,
                is_generic: !!fullItem.is_generic,
                is_fine: !!fullItem.is_fine,
            };
        }

        if (petMeta && slots['pet']) {
            slots['pet'] = {
                ...slots['pet'],
                level: petMeta.level,
                variant: petMeta.variant,
                useAbility: !!petMeta.useAbility,
            };
        }

        // Wiki consumables come through generic_slots.consumable, not the
        // items array, because they aren't in the equipment catalog.
        if (gearsetData.generic_slots && gearsetData.generic_slots.consumable && !slots['consumable']) {
            slots['consumable'] = gearsetData.generic_slots.consumable;
        }

        return slots;
    } catch (e) {
        console.warn('[gearset-decode] Failed to decode export:', e);
        return null;
    }
}

/**
 * Convert an activity display name to the canonical activity_id used by
 * window.activitySelector.selectActivity() and store.state.column3.selectedActivity.
 *
 * Mirrors the algorithm in ui/app.py:get_activities — must stay in sync.
 */
export function activityIdFromName(activityName) {
    if (!activityName) return null;
    return String(activityName)
        .toLowerCase()
        .replace(/ /g, '_')
        .replace(/\(/g, '')
        .replace(/\)/g, '')
        .replace(/-/g, '_')
        .replace(/'/g, '');
}

/**
 * Render a compact 2-row read-only gear preview given a slot map (output
 * of decodeGearsetSlots). Returns an HTML string suitable for innerHTML.
 *
 * Row 1: 12 gear slots (head, cape, back, chest, primary, secondary,
 *        hands, legs, neck, feet, ring1, ring2)
 * Row 2: 6 tool slots + pet + consumable + (optional) input items
 *
 * Empty slots show the slot family icon. Filled slots show the item icon
 * with the existing .travel-gear-mini-slot rarity classes.
 *
 * @param {Object} slots - decoded slot map (output of decodeGearsetSlots)
 * @param {Object} [options]
 * @param {Array<Object>} [options.inputs] - optional list of input item
 *   metas to render after pet/consumable in the tools row. Each entry:
 *   { name, icon_path, rarity, is_fine, keyword?, level? }. Mirrors how
 *   components/tree-node-card.js renders activity_input_items inline
 *   with the tools row so the user sees what input the optimizer
 *   assumed (e.g. arrows for hunting).
 */
export function renderMiniGearPreview(slots, options = {}) {
    slots = slots || {};
    const inputs = Array.isArray(options.inputs) ? options.inputs : [];

    const QUALITY_TO_RARITY = {
        common: 'rarity-common', uncommon: 'rarity-uncommon', rare: 'rarity-rare',
        epic: 'rarity-epic', legendary: 'rarity-legendary', ethereal: 'rarity-ethereal',
        fine: 'rarity-fine',
    };

    const gearSlotNames = ['head', 'cape', 'back', 'chest', 'primary', 'secondary',
                           'hands', 'legs', 'neck', 'feet', 'ring1', 'ring2'];
    const toolSlotNames = ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'];
    const extraSlotNames = ['pet', 'consumable'];

    // Tool-slot level gating — mirrors components/tree-node-card.js. Tool
    // slots tool3..tool5 unlock at character total skill levels 20/50/80
    // respectively. Without this overlay the gear preview lies about what
    // the user can actually equip — the optimizer respects the cap but
    // the tile shows the slot as "empty/clickable".
    let _characterLevel = 1;
    try {
        const characterStore = (window.store && window.store.state && window.store.state.character) || {};
        if (typeof window.calculateCharacterLevel === 'function') {
            _characterLevel = window.calculateCharacterLevel(characterStore) || 1;
        }
    } catch (_) { /* default to 1 — everything beyond tool2 will show locked */ }
    const _toolUnlockTable = [
        { idx: 3, level: 20 },
        { idx: 4, level: 50 },
        { idx: 5, level: 80 },
    ];
    const isToolSlotLockedByLevel = (slotName) => {
        if (!slotName.startsWith('tool')) return null;
        const idx = parseInt(slotName.replace('tool', ''), 10);
        const row = _toolUnlockTable.find(r => r.idx === idx);
        if (!row) return null;
        return _characterLevel < row.level
            ? { required: row.level, current: _characterLevel }
            : null;
    };

    const slotIconFamily = (slotName) => {
        if (slotName === 'ring1' || slotName === 'ring2') return 'ring';
        if (slotName.startsWith('tool')) return 'tool';
        return slotName;
    };

    const formatSlotLabel = (slotName) => {
        if (!slotName) return '';
        if (slotName.startsWith('tool')) {
            const n = parseInt(slotName.slice(4), 10);
            return Number.isFinite(n) ? `Tool ${n + 1}` : `Tool ${slotName.slice(4)}`;
        }
        if (slotName === 'ring1' || slotName === 'ring2') return `Ring ${slotName.slice(4)}`;
        return slotName.charAt(0).toUpperCase() + slotName.slice(1);
    };

    const renderSlot = (slotName) => {
        // Level-locked tool slot: show the same red-padlock tile as the
        // crafting tree (.tree-gear-mini-slot--level-locked CSS class is
        // already present in the app stylesheet).
        const levelLock = isToolSlotLockedByLevel(slotName);
        if (levelLock) {
            return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--level-locked"
                data-slot="${slotName}" data-disabled="1"
                title="${formatSlotLabel(slotName)} requires character level ${levelLock.required} (you are level ${levelLock.current})">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
                </svg>
            </div>`;
        }
        const item = slots[slotName];
        if (!item) {
            const slotIcon = `/assets/icons/slots/${slotIconFamily(slotName)}.svg`;
            return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--empty"
                data-slot="${slotName}"
                title="Empty ${formatSlotLabel(slotName)} slot">
                <img src="${slotIcon}" class="tree-gear-mini-empty-icon" alt="" onerror="this.style.display='none'">
            </div>`;
        }
        let rarityClass = item.rarity ? QUALITY_TO_RARITY[item.rarity] || '' : '';
        if (item.is_fine && rarityClass !== 'rarity-fine') rarityClass = 'rarity-fine';
        const isFine = !!item.is_fine
            || (typeof item.name === 'string' && item.name.includes('(Fine)'));
        const iconClass = `travel-gear-mini-icon${isFine ? ' fine' : ''}`;
        const iconPath = item.icon_path || '';
        return `<div class="travel-gear-mini-slot tree-gear-mini-slot ${rarityClass}"
            data-slot="${slotName}"
            title="${item.name || formatSlotLabel(slotName)}">
            ${iconPath ? `<img src="${iconPath}" alt="${item.name || ''}" class="${iconClass}" loading="lazy" />` : ''}
        </div>`;
    };

    const gearHtml = gearSlotNames.map(renderSlot).join('');
    const toolHtml = toolSlotNames.map(renderSlot).join('');
    const extraHtml = extraSlotNames.map(renderSlot).join('');

    // Input slots rendered inline with the tools row, after pet +
    // consumable. Mirrors components/tree-node-card.js _renderGearPreview
    // (~line 760) which puts each declared activity input as its own
    // tile so activities with multiple input requirements get one slot
    // per requirement. Stats report only carries a single input
    // currently (worker exposes optimize_activity_gearsets.INPUT_ITEM
    // which is single-valued) but the loop is generic in case that
    // changes.
    const inputHtml = inputs.map((inp) => {
        if (!inp || !inp.name) return '';
        const rarityClass = inp.rarity ? QUALITY_TO_RARITY[inp.rarity] || '' : '';
        const isFine = !!inp.is_fine
            || (typeof inp.name === 'string' && inp.name.includes('(Fine)'));
        const iconClass = `travel-gear-mini-icon${isFine ? ' fine' : ''}`;
        const iconPath = inp.icon_path || '';
        const title = inp.name || 'Input item';
        return `<div class="travel-gear-mini-slot tree-gear-mini-slot tree-gear-mini-slot--input ${rarityClass}"
            data-slot="input"
            title="${String(title).replace(/"/g, '&quot;')}">
            ${iconPath ? `<img src="${iconPath}" alt="${String(title).replace(/"/g, '&quot;')}" class="${iconClass}" loading="lazy" />` : ''}
        </div>`;
    }).join('');

    return `
        <div class="stats-report-gear-preview" style="display:flex;flex-direction:column;gap:4px">
            <div class="stats-report-gear-row" style="display:flex;flex-wrap:wrap;gap:3px">${gearHtml}</div>
            <div class="stats-report-gear-row" style="display:flex;flex-wrap:wrap;gap:3px">${toolHtml}${extraHtml}${inputHtml}</div>
        </div>
    `;
}
