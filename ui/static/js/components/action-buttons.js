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
                } else {
                    slotName = slotType;
                }

                console.log(`Mapped slot type "${slotType}" index ${index} to slot name "${slotName}"`);

                // Look up full item data from catalog
                const fullItem = catalogItems.find(item => item.uuid === uuid);

                if (!fullItem) {
                    console.warn(`Item not found in catalog: ${uuid}`);
                    continue;
                }

                console.log(`Found item in catalog: ${fullItem.name}`);

                if (!fullItem) {
                    console.warn(`Item not found in catalog: ${uuid}`);
                    continue;
                }

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

            // Update all slots in store
            for (const [slotName, itemData] of Object.entries(slots)) {
                store.updateGearSlot(slotName, itemData);
            }

            // Clear empty slots
            const allSlots = [
                'head', 'cape', 'back', 'hands', 'chest', 'neck',
                'primary', 'legs', 'secondary', 'ring1', 'ring2', 'feet',
                'tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5',
                'consumable', 'pet'
            ];

            for (const slot of allSlots) {
                if (!slots[slot]) {
                    store.updateGearSlot(slot, null);
                }
            }

            // Close popup and show success
            this.hideImportPopup();
            api.showSuccess('Gear set imported successfully');

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
            // Encode current gear
            const exportString = this.encodeGearset(store.state.gearsets.current);

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

        // Add gear slots
        for (const [slotName, slotType] of Object.entries(slotTypeMap)) {
            const item = gearset[slotName];
            if (item && item.uuid) {
                items.push({
                    type: slotType,
                    index: 0,
                    item: JSON.stringify({
                        id: item.uuid,
                        quality: item.quality || 'common',
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
            if (item && item.uuid) {
                items.push({
                    type: 'ring',
                    index: ringNum - 1,
                    item: JSON.stringify({
                        id: item.uuid,
                        quality: item.quality || 'common',
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
            if (item && item.uuid) {
                items.push({
                    type: 'tool',
                    index: toolNum,
                    item: JSON.stringify({
                        id: item.uuid,
                        quality: item.quality || 'common',
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

        // Add pet slot
        const petItem = gearset['pet'];
        if (petItem && petItem.uuid) {
            items.push({
                type: 'pet',
                index: 0,
                item: JSON.stringify({
                    id: petItem.uuid,
                    quality: petItem.quality || 'common',
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

        // Note: Consumables are not included in WalkScape export format

        // Create gearset JSON
        const gearsetJson = { items: items };

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
        const html = `
            <div class="action-buttons">
                <button class="action-button import-button-main">Import</button>
                <button class="action-button export-button">Export</button>
                <button class="action-button unequip-all-button">Unequip All</button>
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
