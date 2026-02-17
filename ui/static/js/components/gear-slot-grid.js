/**
 * GearSlotGrid Component
 * 
 * Displays all equipment slots in a grid layout:
 * - Gear slots: 3-column grid (cape/head/back, hands/chest/neck, etc.)
 * - Tool slots: 3-column grid (tool 0-5, based on character level)
 * - Consumable and Pet slots: 2 centered columns below tools
 * 
 * Features:
 * - Shows slot name in ALL CAPS when empty
 * - Shows item icon with rarity styling when equipped
 * - Red border for locked tool slots
 * - CSS variable for slot size
 * - Tool slot availability based on character level
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import Component from './base.js';
import store from '../state.js';

class GearSlotGrid extends Component {
    /**
     * Gear slot layout - 3 columns, 4 rows
     * Requirements: 3.1
     */
    static GEAR_SLOTS = [
        ['cape', 'head', 'back'],
        ['hands', 'chest', 'neck'],
        ['primary', 'legs', 'secondary'],
        ['ring1', 'feet', 'ring2']
    ];

    /**
     * Tool slots - 6 total, availability based on character level
     * Requirements: 3.2, 3.7
     */
    static TOOL_SLOTS = ['tool0', 'tool1', 'tool2', 'tool3', 'tool4', 'tool5'];

    /**
     * Special slots - consumable and pet
     * Requirements: 3.3
     */
    static SPECIAL_SLOTS = ['consumable', 'pet'];

    /**
     * Create a gear slot grid
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {number} props.characterLevel - Character level for tool slot availability
     * @param {Function} props.onSlotClick - Callback when a slot is clicked
     */
    constructor(element, props = {}) {
        super(element, props);
        this.characterLevel = props.characterLevel || 1;
        this.onSlotClick = props.onSlotClick || null;

        // Subscribe to gear state changes
        this.subscribe('gearsets.current', () => this.render());
        this.subscribe('character', () => {
            // Update character level if it changes
            this.updateCharacterLevel();
            this.render();
        });

        this.render();
        this.attachEvents();
    }

    /**
     * Update character level from store
     */
    updateCharacterLevel() {
        const character = store.state.character || {};

        // Calculate character level from character data
        if (window.calculateCharacterLevel) {
            this.characterLevel = window.calculateCharacterLevel(character);
        }
    }

    /**
     * Get number of unlocked tool slots based on character level
     * Requirements: 3.7
     * 
     * @param {number} level - Character level
     * @returns {number} Number of unlocked tool slots (3-6)
     */
    static getUnlockedToolSlots(level) {
        if (level < 20) return 3;
        if (level < 50) return 4;
        if (level < 80) return 5;
        return 6;
    }

    /**
     * Check if a tool slot is locked based on character level
     * Requirements: 3.7
     * 
     * @param {string} slot - Slot name (e.g., 'tool3')
     * @returns {boolean} True if slot is locked
     */
    isSlotLocked(slot) {
        if (!slot.startsWith('tool')) return false;

        const slotIndex = parseInt(slot.replace('tool', ''), 10);
        const unlockedSlots = GearSlotGrid.getUnlockedToolSlots(this.characterLevel);

        return slotIndex >= unlockedSlots;
    }

    /**
     * Get the display name for a slot
     * @param {string} slot - Slot identifier
     * @returns {string} Display name in ALL CAPS
     */
    getSlotDisplayName(slot) {
        // Map slot identifiers to display names
        const displayNames = {
            'cape': 'CAPE',
            'head': 'HEAD',
            'back': 'BACK',
            'hands': 'HANDS',
            'chest': 'CHEST',
            'neck': 'NECK',
            'primary': 'PRIMARY',
            'legs': 'LEGS',
            'secondary': 'SECONDARY',
            'ring1': 'RING 1',
            'ring2': 'RING 2',
            'feet': 'FEET',
            'tool0': 'TOOL 1',
            'tool1': 'TOOL 2',
            'tool2': 'TOOL 3',
            'tool3': 'TOOL 4',
            'tool4': 'TOOL 5',
            'tool5': 'TOOL 6',
            'consumable': 'CONSUMABLE',
            'pet': 'PET'
        };

        return displayNames[slot] || slot.toUpperCase();
    }

    /**
     * Get item data for a slot from current gear state
     * @param {string} slot - Slot identifier
     * @returns {Object|null} Item data or null if empty
     */
    getSlotItem(slot) {
        const currentGear = store.state.gearsets?.current || {};
        return currentGear[slot] || null;
    }

    /**
     * Get rarity class for an item
     * @param {Object} item - Item data
     * @returns {string} CSS class for rarity
     */
    getRarityClass(item) {
        if (!item || !item.rarity) return '';

        const rarityMap = {
            'common': 'rarity-common',
            'fine': 'rarity-fine',
            'uncommon': 'rarity-uncommon',
            'rare': 'rarity-rare',
            'epic': 'rarity-epic',
            'legendary': 'rarity-legendary',
            'ethereal': 'rarity-ethereal'
        };

        return rarityMap[item.rarity?.toLowerCase()] || '';
    }

    /**
     * Render a single slot
     * @param {string} slot - Slot identifier
     * @returns {string} HTML for the slot
     */
    renderSlot(slot) {
        const item = this.getSlotItem(slot);
        const isLocked = this.isSlotLocked(slot);
        const displayName = this.getSlotDisplayName(slot);

        let slotClasses = 'gear-slot';
        if (isLocked) slotClasses += ' locked';
        if (item) slotClasses += ' equipped';

        const rarityClass = item ? this.getRarityClass(item) : '';
        if (rarityClass) slotClasses += ` ${rarityClass}`;

        if (item) {
            console.log(`Rendering slot ${slot} with item:`, item, 'rarity class:', rarityClass);
        }

        if (item) {
            // Slot has an item equipped
            const iconPath = item.icon_path || '/assets/icons/items/equipment/placeholder.svg';
            const isFine = item.is_fine || (item.name && item.name.includes('(Fine)'));
            const fineClass = isFine ? 'fine' : '';

            return `
                <div class="${slotClasses}" data-slot="${slot}" title="${item.name || displayName}">
                    <img src="${iconPath}" alt="${item.name || displayName}" class="slot-icon ${fineClass}">
                </div>
            `;
        } else {
            // Empty slot - show name in ALL CAPS
            // Add 'long-name' class for names with 8+ characters (like CONSUMABLE)
            const nameClass = displayName.length >= 8 ? 'slot-name long-name' : 'slot-name';
            return `
                <div class="${slotClasses}" data-slot="${slot}" title="${displayName}">
                    <span class="${nameClass}">${displayName}</span>
                </div>
            `;
        }
    }

    /**
     * Render the gear slots grid
     * @returns {string} HTML for gear slots
     */
    renderGearSlots() {
        const rows = GearSlotGrid.GEAR_SLOTS.map(row => {
            const slots = row.map(slot => this.renderSlot(slot)).join('');
            return `<div class="gear-slot-row">${slots}</div>`;
        }).join('');

        return `
            <div class="gear-slots-section">
                <div class="section-label">Gear</div>
                <div class="gear-slots-grid">
                    ${rows}
                </div>
            </div>
        `;
    }

    /**
     * Render the tool slots grid
     * @returns {string} HTML for tool slots
     */
    renderToolSlots() {
        // Arrange tools in 2 rows of 3
        const toolRows = [
            GearSlotGrid.TOOL_SLOTS.slice(0, 3),
            GearSlotGrid.TOOL_SLOTS.slice(3, 6)
        ];

        const rows = toolRows.map(row => {
            const slots = row.map(slot => this.renderSlot(slot)).join('');
            return `<div class="gear-slot-row">${slots}</div>`;
        }).join('');

        return `
            <div class="tool-slots-section">
                <div class="section-label">Tools</div>
                <div class="tool-slots-grid">
                    ${rows}
                </div>
            </div>
        `;
    }

    /**
     * Render the special slots (consumable and pet)
     * @returns {string} HTML for special slots
     */
    renderSpecialSlots() {
        const slots = GearSlotGrid.SPECIAL_SLOTS.map(slot => this.renderSlot(slot)).join('');

        return `
            <div class="special-slots-section">
                <div class="gear-slot-row centered">
                    ${slots}
                </div>
            </div>
        `;
    }

    /**
     * Render the complete grid
     */
    render() {
        const html = `
            <div class="gear-slot-grid-container">
                ${this.renderGearSlots()}
                ${this.renderToolSlots()}
                ${this.renderSpecialSlots()}
            </div>
        `;

        this.$element.html(html);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Click handler for slots
        this.$element.on('click', '.gear-slot', (e) => {
            const $slot = $(e.currentTarget);
            const slot = $slot.data('slot');
            const isLocked = $slot.hasClass('locked');

            console.log('Gear slot clicked:', slot, 'isLocked:', isLocked, 'hasCallback:', !!this.onSlotClick);

            // Don't open popup for locked slots (but still allow display)
            // Requirements: 3.8 - locked slots can still display items
            if (this.onSlotClick && !isLocked) {
                console.log('Calling onSlotClick callback for slot:', slot);
                this.onSlotClick(slot);
            } else if (!this.onSlotClick) {
                console.warn('No onSlotClick callback provided to GearSlotGrid');
            } else if (isLocked) {
                console.log('Slot is locked, not opening popup');
            }
        });
    }

    /**
     * Equip an item to a slot
     * @param {string} slot - Slot identifier
     * @param {Object|null} item - Item data or null to unequip
     */
    equipItem(slot, item) {
        store.updateGearSlot(slot, item);
    }

    /**
     * Unequip an item from a slot
     * @param {string} slot - Slot identifier
     */
    unequipSlot(slot) {
        store.updateGearSlot(slot, null);
    }

    /**
     * Set character level and re-render
     * @param {number} level - New character level
     */
    setCharacterLevel(level) {
        this.characterLevel = level;
        this.render();
    }
}

export default GearSlotGrid;

// Also export the static method for testing
export { GearSlotGrid };
