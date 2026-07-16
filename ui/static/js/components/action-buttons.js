/**
 * ActionButtons Component
 * 
 * Provides quick actions for gear set management:
 * - Import: Import gear set from export string
 * - Export: Export current gear to clipboard
 * - Unequip All: Clear all gear slots
 * 
 * Features:
 * - Import popup with paste area
 * - Export to clipboard with toast notification
 * - Unequip all with confirmation toast
 * 
 * Requirements: 5.1, 5.3, 5.5
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import { getPetIconPath } from '../utils/pet-utils.js';
import { GearSlotGrid } from './gear-slot-grid.js';

class ActionButtons extends Component {
    /**
     * Create action buttons component
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        this.importPopupOpen = false;
        this.importText = '';

        // Re-render when comparison mode changes (to show/hide copy button)
        this.subscribe('gearsets.comparisonMode', () => {
            this.render();
            this.attachEvents();
        });
        // Re-render when active gearset changes (to update copy button label)
        this.subscribe('gearsets.current', () => {
            if (store.state.gearsets.comparisonMode) {
                this.render();
                this.attachEvents();
            }
        });

        this.render();
        this.attachEvents();
    }

    /**
     * Show import popup
     * Requirements: 5.1
     */
    showImportPopup() {
        this.importPopupOpen = true;
        this.importText = '';
        this.render();

        // Focus the textarea after render
        setTimeout(() => {
            this.$element.find('.import-textarea').focus();
        }, 100);
    }

    /**
     * Hide import popup
     */
    hideImportPopup() {
        this.importPopupOpen = false;
        this.importText = '';
        this.render();
    }

    /**
     * Import gear set from export string
     * Requirements: 5.1, 5.2
     */
    async importGearSet() {
        const exportString = this.importText.trim();

        if (!exportString) {
            api.showError('Please paste a gearset export string');
            return;
        }

        // Check if pako is loaded
        if (typeof window.pako === 'undefined') {
            api.showError('Compression library not loaded. Please refresh the page.');
            console.error('Pako library not available. Check if CDN script is loaded.');
            return;
        }

        try {
            // Decode the gearset export string
            const gearsetData = this.decodeGearset(exportString);

            // Get catalog to look up items
            const catalog = await api.getCatalog();
            const catalogItems = catalog.items || [];

            // Populate slots with imported items
            const slots = {};

            for (const itemData of gearsetData.items) {
                console.log('Processing import item:', itemData);

                if (itemData.item === 'null') {
                    continue;
                }

                // Parse item JSON
                const itemJson = JSON.parse(itemData.item);
                const uuid = itemJson.id;
                const quality = itemJson.quality || 'common';

                // Map to slot name
                const slotType = itemData.type;
                const index = itemData.index || 0;

                let slotName;
                if (slotType === 'ring') {
                    slotName = `ring${index + 1}`;
                } else if (slotType === 'tool') {
                    slotName = `tool${index}`;
                } else if (slotType === 'consumable') {
                    slotName = 'consumable';
                } else if (slotType === 'pet') {
                    slotName = 'pet';
                } else if (slotType === 'activityInput') {
                    continue; // Skip activity inputs for now
                } else {
                    slotName = slotType;
                }

                console.log(`Mapped slot type "${slotType}" index ${index} to slot name "${slotName}"`);

                // Special handling for pets — official format uses pet name as id, level as quality
                if (slotType === 'pet') {
                    const petId = uuid; // e.g. "camel"
                    const petLevel = parseInt(quality) || 0;
                    // Find pet in catalog by id (pet name lowercase)
                    const petItem = catalogItems.find(item => item.id === petId && item.type === 'pet');
                    if (petItem) {
                        const levelData = petItem.levels ? petItem.levels[String(petLevel)] : null;
                        const overrides = store.state.ui?.user_overrides?.items?.[petId] || {};
                        const baseState = store.state.items?.[petId] || {};
                        const variant = overrides.variant || baseState.variant || 'normal';
                        slots[slotName] = {
                            itemId: petItem.id,
                            uuid: petItem.uuid || petItem.id,
                            name: petItem.name,
                            icon_path: getPetIconPath(petItem.name, petLevel, variant, petItem.max_level || 0),
                            rarity: 'common',
                            keywords: petItem.keywords || [],
                            type: 'pet',
                            level: petLevel,
                            variant: variant,
                            levels: petItem.levels,
                            stats: levelData?.stats || {},
                        };
                        console.log(`  Pet imported: ${petItem.name} at level ${petLevel}`);
                    } else {
                        console.warn(`Pet not found in catalog: ${petId}`);
                    }
                    continue;
                }

                // Look up full item data from catalog
                const fullItem = catalogItems.find(item => item.uuid === uuid);

                if (!fullItem) {
                    // Check if this is a generic item — will be restored from generic_slots
                    if (uuid && uuid.startsWith('generic::')) {
                        console.log(`  Generic item ${uuid} — will restore from generic_slots`);
                        continue;
                    }
                    console.warn(`Item not found in catalog: ${uuid}`);
                    continue;
                }

                console.log(`Found item in catalog: ${fullItem.name}`);

                // Convert export quality (rarity names) to quality names for crafted items
                let qualityName = null;
                let rarity = fullItem.rarity;

                if (fullItem.type === 'crafted_item') {
                    const exportQualityToQualityName = {
                        'normal': 'Normal',
                        'common': 'Normal',
                        'good': 'Good',
                        'uncommon': 'Good',
                        'great': 'Great',
                        'rare': 'Great',
                        'excellent': 'Excellent',
                        'epic': 'Excellent',
                        'perfect': 'Perfect',
                        'legendary': 'Perfect',
                        'eternal': 'Eternal',
                        'ethereal': 'Eternal'
                    };
                    qualityName = exportQualityToQualityName[quality.toLowerCase()] || 'Normal';

                    // Convert quality name to rarity for display
                    const qualityToRarity = {
                        'Normal': 'common',
                        'Good': 'uncommon',
                        'Great': 'rare',
                        'Excellent': 'epic',
                        'Perfect': 'legendary',
                        'Eternal': 'ethereal'
                    };
                    rarity = qualityToRarity[qualityName] || 'common';
                }

                // Store full item data
                slots[slotName] = {
                    itemId: fullItem.id,
                    uuid: fullItem.uuid,
                    name: fullItem.name,
                    icon_path: fullItem.icon_path,
                    rarity: rarity,
                    quality: qualityName,
                    keywords: fullItem.keywords || []
                };
            }

            // Check for tools in locked slots and skip them
            const skippedTools = [];
            const characterLevel = window.calculateCharacterLevel
                ? window.calculateCharacterLevel(store.state.character)
                : 1;
            const unlockedToolSlots = GearSlotGrid.getUnlockedToolSlots(characterLevel);

            for (const slotName of Object.keys(slots)) {
                if (slotName.startsWith('tool')) {
                    const slotIndex = parseInt(slotName.replace('tool', ''), 10);
                    if (slotIndex >= unlockedToolSlots) {
                        const item = slots[slotName];
                        const toolNum = slotIndex + 1;
                        skippedTools.push(`${item.name || 'Unknown'} in Tool ${toolNum}`);
                        delete slots[slotName];
                    }
                }
            }

            // Update all slots in store
            for (const [slotName, itemData] of Object.entries(slots)) {
                store.updateGearSlot(slotName, itemData);
            }

            // Restore generic items from custom extension field (not in catalog)
            const restoredGenericSlots = new Set();
            if (gearsetData.generic_slots) {
                console.log('Restoring generic_slots:', Object.keys(gearsetData.generic_slots));

                // Build a map of slot → quality from the items array
                const itemsQualityMap = {};
                for (const item of gearsetData.items || []) {
                    if (!item.item || item.item === 'null') continue;
                    try {
                        const itemData = JSON.parse(item.item);
                        if (itemData.id && itemData.id.startsWith('generic::')) {
                            let slotName = item.type;
                            if (slotName === 'tool') slotName = `tool${item.index}`;
                            else if (slotName === 'ring') slotName = `ring${item.index + 1}`;
                            itemsQualityMap[slotName] = itemData.quality;
                        }
                    } catch (e) { /* skip */ }
                }

                for (const [slotName, itemData] of Object.entries(gearsetData.generic_slots)) {
                    if (slotName === '_pet_meta') continue; // Handled below
                    if (!itemData) continue;

                    // Skip generic tools in locked slots
                    if (slotName.startsWith('tool')) {
                        const slotIndex = parseInt(slotName.replace('tool', ''), 10);
                        if (slotIndex >= unlockedToolSlots) {
                            const toolNum = slotIndex + 1;
                            skippedTools.push(`${itemData.name || 'Unknown'} in Tool ${toolNum}`);
                            continue;
                        }
                    }

                    // Resolve from store (source of truth) instead of using stale embedded data
                    const genericId = (itemData.itemId || itemData.uuid || '').replace('generic::item::', '');
                    const storeItem = genericId ? (store.state.genericItems || []).find(gi => gi.id === genericId) : null;

                    const rarityToQuality = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
                    const itemRarity = itemsQualityMap[slotName] || itemData.rarity || 'common';
                    const qualityName = itemData.quality || rarityToQuality[itemRarity] || 'Normal';

                    if (storeItem) {
                        const resolved = {
                            ...itemData,
                            itemId: itemData.itemId || `generic::item::${genericId}`,
                            icon_path: storeItem.icon_path || itemData.icon_path,
                            icon: storeItem.icon || itemData.icon,
                            icon_color: storeItem.icon_color || itemData.icon_color,
                            stats: storeItem.stats || itemData.stats || {},
                            quality_stats: storeItem.quality_stats || itemData.quality_stats,
                            stats_by_quality: storeItem.quality_stats || itemData.quality_stats,
                            keywords: storeItem.keywords || itemData.keywords || [],
                            rarity: itemRarity,
                            quality: qualityName,
                            slot: storeItem.slot || itemData.slot,
                            type: storeItem.is_crafted ? 'crafted_item' : 'item',
                            is_crafted: storeItem.is_crafted,
                            is_generic: true,
                        };
                        store.updateGearSlot(slotName, resolved);
                        console.log(`  ✓ Restored generic slot ${slotName}: ${storeItem.name} quality=${qualityName} (from store)`);
                    } else {
                        store.updateGearSlot(slotName, { ...itemData, quality: qualityName, rarity: itemRarity });
                        console.log(`  ✓ Restored generic slot ${slotName}: ${itemData.name} quality=${qualityName} (from embedded data)`);
                    }
                    restoredGenericSlots.add(slotName);
                }

                // Restore pet level/variant/useAbility metadata for wiki pets
                if (gearsetData.generic_slots._pet_meta && slots['pet']) {
                    const meta = gearsetData.generic_slots._pet_meta;
                    slots['pet'].level = meta.level;
                    slots['pet'].variant = meta.variant;
                    slots['pet'].useAbility = meta.useAbility || false;
                    store.updateGearSlot('pet', slots['pet']);
                    console.log(`  Restored pet meta: level=${meta.level}, variant=${meta.variant}, useAbility=${meta.useAbility || false}`);
                }
            }

            // Clear empty slots (skip slots restored from catalog or generic_slots)
            const allSlots = [
                'head', 'cape', 'back', 'hands', 'chest', 'neck',
                'primary', 'legs', 'secondary', 'ring1', 'ring2', 'feet',
                'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5',
                'consumable', 'pet'
            ];

            for (const slot of allSlots) {
                if (!slots[slot] && !restoredGenericSlots.has(slot)) {
                    store.updateGearSlot(slot, null);
                }
            }

            // Close popup and show success
            this.hideImportPopup();
            api.showSuccess('Gear set imported successfully');

            // Show warning for any tools that were skipped due to locked slots
            if (skippedTools.length > 0) {
                const toolList = skippedTools.join(', ');
                api.showWarning(
                    `Skipped ${skippedTools.length} tool${skippedTools.length > 1 ? 's' : ''} from imported gearset (slot not unlocked): ${toolList}`,
                    { duration: 10000 }
                );
            }

        } catch (error) {
            console.error('Failed to import gearset:', error);
            api.showError('Invalid gearset format');
        }
    }

    /**
     * Decode a gearset export string
     * Requirements: 5.2
     * 
     * @param {string} exportString - Base64-encoded, gzip-compressed JSON
     * @returns {Object} Decoded gearset data
     */
    decodeGearset(exportString) {
        // Check if pako is available
        if (typeof window.pako === 'undefined') {
            throw new Error('Pako library not loaded');
        }

        // Add padding if needed
        let padded = exportString;
        const padding = exportString.length % 4;
        if (padding) {
            padded += '='.repeat(4 - padding);
        }

        // Decode base64
        const decoded = atob(padded);

        // Convert to Uint8Array for pako
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
            bytes[i] = decoded.charCodeAt(i);
        }

        // Decompress using pako
        const decompressed = window.pako.inflate(bytes, { to: 'string' });

        // Parse JSON
        return JSON.parse(decompressed);
    }

    /**
     * Export current gear to clipboard
     * Requirements: 5.3, 5.4
     */
    async exportGearSet() {
        // Check if pako is loaded
        if (typeof window.pako === 'undefined') {
            api.showError('Compression library not loaded. Please refresh the page.');
            console.error('Pako library not available. Check if CDN script is loaded.');
            return;
        }

        try {
            // Encode active gear (respects comparison mode slot)
            const activeGear = store.getActiveGearset();
            const exportString = this.encodeGearset(activeGear);

            // Copy to clipboard
            await navigator.clipboard.writeText(exportString);

            // Show success toast
            api.showSuccess('Export code copied to clipboard');

        } catch (error) {
            console.error('Failed to export gearset:', error);
            api.showError('Failed to copy to clipboard');
        }
    }

    /**
     * Encode current gear to export string
     * Requirements: 5.3
     * 
     * @param {Object} gearset - Current gear slots
     * @returns {string} Base64-encoded, gzip-compressed JSON
     */
    encodeGearset(gearset) {
        // Build items array
        const items = [];

        // Slot type mapping
        const slotTypeMap = {
            'head': 'head',
            'cape': 'cape',
            'back': 'back',
            'chest': 'chest',
            'primary': 'primary',
            'secondary': 'secondary',
            'hands': 'hands',
            'legs': 'legs',
            'neck': 'neck',
            'feet': 'feet'
        };

        // Helper: get the rarity code for gearset export encoding.
        // Crafted items store quality="Good" (display) and rarity="uncommon" (code).
        // The backend expects the rarity code.
        const getExportQuality = (item) => item?.rarity || 'common';

        // Helper: get the UUID to use in the export.
        // For generic items, use gear_set_export from the definition if available.
        const getExportUuid = (item) => {
            if (item?.is_generic && item?.itemId?.startsWith('generic::item::')) {
                const genericId = item.itemId.replace('generic::item::', '');
                const gi = (store.state.genericItems || []).find(g => g.id === genericId);
                if (gi?.gear_set_export) return gi.gear_set_export;
            }
            return item?.uuid || null;
        };

        // Add gear slots
        for (const [slotName, slotType] of Object.entries(slotTypeMap)) {
            const item = gearset[slotName];
            const exportUuid = getExportUuid(item);
            if (item && exportUuid) {
                items.push({
                    type: slotType,
                    index: 0,
                    item: JSON.stringify({
                        id: exportUuid,
                        quality: getExportQuality(item),
                        tag: null
                    }),
                    errors: []
                });
            } else {
                items.push({
                    type: slotType,
                    index: 0,
                    item: 'null',
                    errors: []
                });
            }
        }

        // Add ring slots
        for (let ringNum = 1; ringNum <= 2; ringNum++) {
            const slotName = `ring${ringNum}`;
            const item = gearset[slotName];
            const exportUuid = getExportUuid(item);
            if (item && exportUuid) {
                items.push({
                    type: 'ring',
                    index: ringNum - 1,
                    item: JSON.stringify({
                        id: exportUuid,
                        quality: getExportQuality(item),
                        tag: null
                    }),
                    errors: []
                });
            } else {
                items.push({
                    type: 'ring',
                    index: ringNum - 1,
                    item: 'null',
                    errors: []
                });
            }
        }

        // Add tool slots
        for (let toolNum = 0; toolNum < 6; toolNum++) {
            const slotName = `tool${toolNum}`;
            const item = gearset[slotName];
            const exportUuid = getExportUuid(item);
            if (item && exportUuid) {
                items.push({
                    type: 'tool',
                    index: toolNum,
                    item: JSON.stringify({
                        id: exportUuid,
                        quality: getExportQuality(item),
                        tag: null
                    }),
                    errors: []
                });
            } else {
                items.push({
                    type: 'tool',
                    index: toolNum,
                    item: 'null',
                    errors: []
                });
            }
        }

        // Add pet slot (official format: id=pet name lowercase, quality=level number)
        const petItem = gearset['pet'];
        if (petItem && petItem.itemId) {
            items.push({
                type: 'pet',
                index: 0,
                item: JSON.stringify({
                    id: petItem.itemId,
                    quality: String(petItem.level || 0),
                    tag: null
                }),
                errors: []
            });
        } else {
            items.push({
                type: 'pet',
                index: 0,
                item: 'null',
                errors: []
            });
        }

        // Add consumable slot
        const consumable = gearset['consumable'];
        if (consumable && consumable.uuid) {
            items.push({
                type: 'consumable',
                index: 0,
                item: JSON.stringify({
                    id: consumable.uuid,
                    quality: getExportQuality(consumable),
                    tag: null
                }),
                errors: []
            });
        }

        // Add activityInput slot (official format compatibility)
        items.push({
            type: 'activityInput',
            index: 0,
            item: 'null',
            errors: []
        });

        // Generic items don't need generic_slots — resolved from store by generic::item::UUID on load
        // Only store pet meta and consumable for round-trip (not in standard items array)
        const genericSlots = {};

        // Also include pet slot data (level, variant, stats, useAbility) even for wiki pets
        const petItem2 = gearset['pet'];
        if (petItem2 && !petItem2.is_generic) {
            if (!genericSlots['_pet_meta']) {
                genericSlots['_pet_meta'] = {
                    level: petItem2.level,
                    variant: petItem2.variant,
                    useAbility: petItem2.useAbility || false,
                };
            }
        }

        // Include consumable slot data for round-trip
        const consumableItem = gearset['consumable'];
        if (consumableItem && !consumableItem.is_generic) {
            if (!genericSlots['consumable']) {
                genericSlots['consumable'] = consumableItem;
            }
        }

        // Create gearset JSON (with generic_slots extension for round-trip support)
        const gearsetJson = { items: items };
        if (Object.keys(genericSlots).length > 0) {
            gearsetJson.generic_slots = genericSlots;
        }

        // Compress and encode
        const jsonStr = JSON.stringify(gearsetJson);
        const compressed = window.pako.gzip(jsonStr);

        // Convert to base64
        let binary = '';
        const bytes = new Uint8Array(compressed);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const encoded = btoa(binary);

        return encoded;
    }

    /**
     * Unequip all gear slots
     * Requirements: 5.5, 5.6, 5.7
     */
    unequipAll() {
        // Clear all slots via store method
        store.unequipAll();

        // Show success toast
        api.showSuccess('Unequipped all gear');
    }

    /**
     * Copy the active gearset to the other comparison slot
     */
    copyToOtherSet() {
        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
        if (activeSlot === 1) {
            // Copy current → gearset2
            store.state.gearsets.gearset2 = { ...store.state.gearsets.current };
            store._notifySubscribers('gearsets.gearset2');
            api.showSuccess('Copied Gear Set 1 → Gear Set 2');
        } else {
            // Copy gearset2 → current
            store.state.gearsets.current = { ...store.state.gearsets.gearset2 };
            store._notifySubscribers('gearsets.current');
            store._saveCurrentGear();
            api.showSuccess('Copied Gear Set 2 → Gear Set 1');
        }
    }

    /**
     * Render import popup
     * @returns {string} HTML for import popup
     */
    renderImportPopup() {
        if (!this.importPopupOpen) {
            return '';
        }

        return `
            <div class="import-popup-overlay">
                <div class="import-popup">
                    <div class="import-popup-header">
                        <h3>Import Gear Set</h3>
                        <button class="close-button">×</button>
                    </div>
                    <div class="import-popup-content">
                        <p>Paste your gearset export string below:</p>
                        <button class="import-from-clipboard-button">Import from Clipboard</button>
                        <textarea 
                            class="import-textarea" 
                            placeholder="Paste gearset export string here..."
                            rows="6"
                        >${this.importText}</textarea>
                    </div>
                    <div class="import-popup-footer">
                        <button class="cancel-button">Cancel</button>
                        <button class="import-button">Import</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 5.1, 5.3, 5.5
     */
    render() {
        const comparisonMode = store.state.gearsets.comparisonMode;
        const activeSlot = store.state.gearsets.activeGearsetSlot || 1;
        const copyLabel = activeSlot === 1 ? 'Copy to Set 2' : 'Copy to Set 1';

        const html = `
            <div class="action-buttons">
                <button class="action-button import-button-main">Import</button>
                <button class="action-button export-button">Export</button>
                <button class="action-button unequip-all-button">Unequip All</button>
                ${comparisonMode ? `<button class="action-button copy-to-other-btn">${copyLabel}</button>` : ''}
            </div>
            ${this.renderImportPopup()}
        `;

        this.$element.html(html);
    }

    /**
     * Import from clipboard
     */
    async importFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            this.importText = text;

            // Update the textarea
            this.$element.find('.import-textarea').val(text);

            // Automatically trigger import
            await this.importGearSet();

        } catch (error) {
            console.error('Failed to read clipboard:', error);
            api.showError('Failed to read clipboard. Please paste manually.');
        }
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Import button click
        this.$element.on('click', '.import-button-main', () => {
            this.showImportPopup();
        });

        // Export button click
        this.$element.on('click', '.export-button', () => {
            this.exportGearSet();
        });

        // Unequip All button click
        this.$element.on('click', '.unequip-all-button', () => {
            this.unequipAll();
        });

        // Copy to other set button click
        this.$element.on('click', '.copy-to-other-btn', () => {
            this.copyToOtherSet();
        });

        // Import from clipboard button
        this.$element.on('click', '.import-from-clipboard-button', () => {
            this.importFromClipboard();
        });

        // Import popup - close button
        this.$element.on('click', '.close-button', () => {
            this.hideImportPopup();
        });

        // Import popup - cancel button
        this.$element.on('click', '.cancel-button', () => {
            this.hideImportPopup();
        });

        // Import popup - import button
        this.$element.on('click', '.import-button', () => {
            this.importGearSet();
        });

        // Import popup - textarea input
        this.$element.on('input', '.import-textarea', (e) => {
            this.importText = $(e.target).val();
        });

        // Import popup - click overlay to close
        this.$element.on('click', '.import-popup-overlay', (e) => {
            if ($(e.target).hasClass('import-popup-overlay')) {
                this.hideImportPopup();
            }
        });
    }
}

export default ActionButtons;
