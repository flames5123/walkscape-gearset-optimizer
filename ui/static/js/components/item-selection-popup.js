/**
 * ItemSelectionPopup Component
 * 
 * Modal popup for selecting items for a gear slot.
 * 
 * Features:
 * - Filter by owned items, hide state, stat presence, search text
 * - Sort by quality (Ethereal first) then alphabetically
 * - Keep only highest quality per item
 * - Stat filter dropdown with percentage stats before flat stats
 * - Item rows with rarity colors matching Column 1
 * - Expand arrow for stats preview
 * - Click row to select and equip item
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.9, 4.10, 4.12, 4.13, 4.14, 4.15, 4.16, 8.1, 8.2, 8.3
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import KeyboardNavigator from '../utils/keyboard-navigation.js';

/**
 * Format condition text for stat display
 * @param {string} skill - Skill name (e.g., 'traveling', 'fishing')
 * @param {string} location - Location name (e.g., 'underwater', 'gdte', '!underwater')
 * @returns {string} Formatted condition text
 */
function formatCondition(skill, location) {
    // Helper to capitalize first letter
    const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

    // Helper to format location
    const formatLocation = (loc) => {
        if (loc.startsWith('!')) {
            // Handle negation (e.g., "!underwater" -> "NOT Underwater location")
            const cleanLoc = loc.substring(1);
            return `NOT ${formatLocation(cleanLoc)}`;
        }

        // Capitalize location and add "location" suffix
        if (loc === 'gdte') {
            return 'GDTE location';
        } else if (loc === 'underwater') {
            return 'Underwater location';
        } else {
            return `${capitalize(loc)} location`;
        }
    };

    // Format skill (capitalize)
    const formattedSkill = skill !== 'global' ? capitalize(skill) : null;

    // Build condition string
    if (formattedSkill && location !== 'global') {
        return `While ${formattedSkill} in ${formatLocation(location)}`;
    } else if (formattedSkill) {
        return `While ${formattedSkill}`;
    } else if (location !== 'global') {
        return `While in ${formatLocation(location)}`;
    } else {
        return 'Global';
    }
}

class ItemSelectionPopup extends Component {
    /**
     * Quality hierarchy for sorting (highest first)
     */
    static QUALITY_ORDER = ['ethereal', 'legendary', 'epic', 'rare', 'uncommon', 'common', 'fine'];

    /**
     * Quality to rarity mapping
     */
    static QUALITY_TO_RARITY = {
        'eternal': 'ethereal',
        'perfect': 'legendary',
        'excellent': 'epic',
        'great': 'rare',
        'good': 'uncommon',
        'normal': 'common'
    };

    /**
     * Percentage-based stats (appear first in dropdown)
     * Requirements: 4.3
     */
    static PERCENTAGE_STATS = [
        'chest_finding',
        'double_action',
        'double_rewards',
        'find_collectibles',
        'find_gems',
        'fine_material_finding',
        'no_materials_consumed',
        'work_efficiency'
    ];

    /**
     * Flat value stats (appear after percentage stats in dropdown)
     * Requirements: 4.3
     */
    static FLAT_STATS = [
        'bonus_xp',
        'inventory_space',
        'quality_outcome',
        'steps_required'
    ];

    /**
     * Get available stats in alphabetical order
     * Requirements: 4.3
     * 
     * @returns {Array} Array of stat names
     */
    getAvailableStats() {
        // Combine all stats and sort alphabetically
        const allStats = [
            ...ItemSelectionPopup.PERCENTAGE_STATS,
            ...ItemSelectionPopup.FLAT_STATS
        ];

        return allStats.sort((a, b) => {
            const nameA = this.formatStatName(a);
            const nameB = this.formatStatName(b);
            return nameA.localeCompare(nameB);
        });
    }

    /**
     * Create an item selection popup
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {Function} props.onSelect - Callback when item is selected
     */
    constructor(element, props = {}) {
        super(element, props);
        this.visible = false;
        this.slot = null;
        this.searchText = '';
        this.statFilter = store.state.ui.column2?.statFilter || 'None';
        this.items = [];  // Cached item list from catalog
        this.expandedItemId = null;  // Currently expanded item for stats preview
        this.currentItemExpanded = true;  // Currently equipped item stats expanded by default
        this.onSelect = props.onSelect || null;

        // Keyboard navigation
        this.keyboardNav = null;

        // Subscribe to Column 1 state changes
        this.subscribe('items', () => {
            if (this.visible) {
                this.render();
                this.attachEvents();
            }
        });

        // Subscribe to Column 2 UI state
        this.subscribe('ui.column2', () => {
            if (this.visible) {
                this.render();
                this.attachEvents();
            }
        });

        this.render();
        this.attachEvents();
    }

    /**
     * Load items from catalog for the given slot
     * @param {string} slot - Slot to load items for
     * @returns {Promise} Promise that resolves when items are loaded
     */
    loadItemsForSlot(slot) {
        // Return the promise so we can wait for it
        return api.getCatalog()
            .then((catalog) => {
                console.log('Catalog loaded, total items:', catalog.items?.length || 0);

                // Filter items by slot
                this.items = (catalog.items || []).filter(item => {
                    // Match slot type
                    if (slot.startsWith('tool')) {
                        // Tools can have slot='tool' or slot='tools' or be in keywords
                        return item.slot === 'tool' ||
                            item.slot === 'tools' ||
                            (item.keywords && item.keywords.some(kw => kw.toLowerCase() === 'tool'));
                    }
                    if (slot.startsWith('ring')) {
                        return item.slot === 'ring' || item.slot === 'rings';
                    }
                    if (slot === 'consumable') {
                        return item.slot === 'consumable' || item.slot === 'consumables' || item.type === 'consumable';
                    }
                    if (slot === 'pet') {
                        return item.slot === 'pet' || item.slot === 'pets' || item.type === 'pet';
                    }
                    return item.slot === slot;
                });

                // For consumable slot, split items with has_fine into normal + fine entries
                if (slot === 'consumable') {
                    const expanded = [];
                    for (const item of this.items) {
                        // Add normal version
                        expanded.push(item);

                        // Add fine version as separate entry right after normal
                        if (item.has_fine && item.stats_fine) {
                            expanded.push({
                                ...item,
                                id: item.id + '_fine',
                                name: item.name + ' (Fine)',
                                is_fine: true,
                                has_fine: false,
                                stats: item.stats_fine,
                                stats_fine: null,
                                duration: item.duration_fine || item.duration,
                                value: item.value_fine || item.value,
                                rarity: 'fine',
                                icon_path: item.icon_path,
                            });
                        }
                    }
                    this.items = expanded;
                    console.log(`Split consumables: ${this.items.length} items (including fine versions)`);
                }

                console.log(`Loaded ${this.items.length} items for slot ${slot}`);
            })
            .fail((error) => {
                console.error('Failed to load catalog:', error);
                this.items = [];
            });
    }

    /**
     * Show the popup for a specific slot
     * Requirements: 4.1, 4.2
     * 
     * @param {string} slot - Slot to select item for
     */
    show(slot) {
        console.log('=== ItemSelectionPopup.show() START ===');
        console.log('Slot:', slot);

        this.visible = true;
        this.slot = slot;
        this.searchText = '';
        this.expandedItemId = null;

        // Load items FIRST, then render and show
        this.loadItemsForSlot(slot).then(() => {
            console.log('Items loaded, now rendering and showing');

            // Render with loaded items
            this.render();

            // Get overlay
            const $overlay = this.$element.find('.modal-overlay');
            console.log('Overlay found after render:', $overlay.length);

            // Show overlay with CSS animation
            $overlay.css('display', 'flex');

            // Trigger animation after a frame
            setTimeout(() => {
                $overlay.addClass('show');
            }, 10);

            console.log('Overlay shown with animation');

            // Attach events after animation starts
            setTimeout(() => {
                this.attachEvents();
                console.log('Events attached');

                // Initialize keyboard navigation
                this.initKeyboardNav();
            }, 100);

            console.log('=== ItemSelectionPopup.show() END ===');
        });
    }

    /**
     * Hide the popup
     */
    hide() {
        console.log('ItemSelectionPopup.hide() called');

        const $overlay = this.$element.find('.modal-overlay');

        // Detach keyboard navigation
        if (this.keyboardNav) {
            this.keyboardNav.detach();
            this.keyboardNav = null;
        }

        // Remove show class to trigger fade-out animation
        $overlay.removeClass('show');

        // Wait for animation to complete, then hide
        setTimeout(() => {
            $overlay.css('display', 'none');
            this.visible = false;
            this.slot = null;
            this.expandedItemId = null;

            // Remove escape key handler
            $(document).off('keydown.item-selection-popup');
        }, 200);
    }

    /**
     * Initialize keyboard navigation
     */
    initKeyboardNav() {
        const $itemList = this.$element.find('.popup-item-list');

        if (this.keyboardNav) {
            this.keyboardNav.detach();
        }

        this.keyboardNav = new KeyboardNavigator($itemList, {
            itemSelector: '.popup-item-row',
            onSelect: ($item) => {
                const itemId = $item.data('item-id');
                this.selectItem(itemId);
            },
            getVisibleItems: () => {
                return this.$element.find('.popup-item-row:visible');
            }
        });

        this.keyboardNav.attach();
    }

    /**
     * Get the display name for a slot (first letter capitalized only)
     * Requirements: 4.1
     * 
     * @param {string} slot - Slot identifier
     * @returns {string} Display name
     */
    getSlotDisplayName(slot) {
        const displayNames = {
            'cape': 'Cape',
            'head': 'Head',
            'back': 'Back',
            'hands': 'Hands',
            'chest': 'Chest',
            'neck': 'Neck',
            'primary': 'Primary',
            'legs': 'Legs',
            'secondary': 'Secondary',
            'ring1': 'Ring 1',
            'ring2': 'Ring 2',
            'feet': 'Feet',
            'tool0': 'Tool 1',
            'tool1': 'Tool 2',
            'tool2': 'Tool 3',
            'tool3': 'Tool 4',
            'tool4': 'Tool 5',
            'tool5': 'Tool 6',
            'consumable': 'Consumable',
            'pet': 'Pet'
        };
        return displayNames[slot] || slot.charAt(0).toUpperCase() + slot.slice(1);
    }

    /**
     * Apply owned filter - filter by has state
     * Requirements: 4.10, 8.2
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    applyOwnedFilter(items) {
        const showOwnedOnly = store.state.ui.column2?.showOwnedOnly ?? true;
        if (!showOwnedOnly) return items;

        return items.filter(item => {
            // For split fine consumable entries, check the base item's has_fine state
            if (item.is_fine && item.id.endsWith('_fine')) {
                const baseId = item.id.replace(/_fine$/, '');
                const baseState = this.getItemState(baseId);
                return baseState.has_fine === true;
            }

            const itemState = this.getItemState(item.id);

            // For consumables/materials with fine versions, check both normal and fine
            if ((item.type === 'consumable' || item.type === 'material') && item.has_fine) {
                // Show if either normal or fine is owned
                return itemState.has === true || itemState.has_fine === true;
            }

            return itemState.has === true;
        });
    }

    /**
     * Apply hide filter - filter by hide state
     * Requirements: 4.10
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    applyHideFilter(items) {
        return items.filter(item => {
            // For split fine consumable entries, check the base item's hide_fine state
            if (item.is_fine && item.id.endsWith('_fine')) {
                const baseId = item.id.replace(/_fine$/, '');
                const baseState = this.getItemState(baseId);
                return baseState.hide_fine !== true;
            }

            const itemState = this.getItemState(item.id);
            return itemState.hide !== true;
        });
    }

    /**
     * Apply stat filter - filter by stat presence
     * Requirements: 4.10
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    applyStatFilter(items) {
        if (this.statFilter === 'None') return items;

        return items.filter(item => {
            return this.itemHasStat(item, this.statFilter);
        });
    }

    /**
     * Check if an item has a specific stat
     * @param {Object} item - Item to check
     * @param {string} statName - Stat name to look for
     * @returns {boolean} True if item has the stat
     */
    itemHasStat(item, statName) {
        // Define stat variants that should be included when filtering
        const statVariants = {
            'bonus_xp': ['bonus_xp', 'bonus_xp_percent', 'bonus_xp_add', 'bonus_xp_base', 'bonus_experience', 'bonus_experience_percent', 'bonus_experience_add', 'bonus_experience_base'],
            'steps_required': ['steps_required', 'steps_add', 'steps_pct', 'steps_percent', 'flat_steps']
        };

        // Get all stat names to check (including variants)
        const statsToCheck = statVariants[statName] || [statName];

        const stats = item.stats || {};

        // Check all skill/location combinations
        for (const skill of Object.keys(stats)) {
            const locationStats = stats[skill];
            for (const location of Object.keys(locationStats)) {
                for (const checkStat of statsToCheck) {
                    if (locationStats[location][checkStat] !== undefined) {
                        return true;
                    }
                }
            }
        }

        // Also check stats_by_quality for crafted items
        if (item.stats_by_quality) {
            for (const quality of Object.keys(item.stats_by_quality)) {
                const qualityStats = item.stats_by_quality[quality];
                for (const skill of Object.keys(qualityStats)) {
                    const locationStats = qualityStats[skill];
                    for (const location of Object.keys(locationStats)) {
                        for (const checkStat of statsToCheck) {
                            if (locationStats[location][checkStat] !== undefined) {
                                return true;
                            }
                        }
                    }
                }
            }
        }

        return false;
    }

    /**
     * Apply search filter - filter by name, keywords, and stat conditions
     * Requirements: 4.10
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    applySearchFilter(items) {
        if (!this.searchText || this.searchText.trim() === '') return items;

        const searchLower = this.searchText.toLowerCase().trim();
        return items.filter(item => {
            // Search in item name
            if (item.name.toLowerCase().includes(searchLower)) {
                return true;
            }

            // Search in keywords
            if (item.keywords && item.keywords.some(kw => kw.toLowerCase().includes(searchLower))) {
                return true;
            }

            // Search in stat conditions (skill and location)
            const itemState = this.getItemState(item.id);
            let stats = item.stats || {};

            // For crafted items, get stats for selected quality
            if (item.type === 'crafted_item' && item.stats_by_quality) {
                const quality = itemState.quality || 'Normal';
                stats = item.stats_by_quality[quality] || {};
            }

            // Check all skill/location combinations
            for (const [skill, locationStats] of Object.entries(stats)) {
                // Search in skill name
                if (skill !== 'global' && skill.toLowerCase().includes(searchLower)) {
                    return true;
                }

                for (const [location, statsByLocation] of Object.entries(locationStats)) {
                    // Search in location name
                    if (location !== 'global' && location.toLowerCase().includes(searchLower)) {
                        return true;
                    }

                    // Search in stat names
                    for (const statName of Object.keys(statsByLocation)) {
                        const formatted = this.formatStatName(statName).toLowerCase();
                        if (formatted.includes(searchLower)) {
                            return true;
                        }
                    }
                }
            }

            // Search in gated stats conditions
            if (item.gated_stats) {
                // Check skill level requirements
                if (item.gated_stats.skill_level) {
                    for (const [skill, levels] of Object.entries(item.gated_stats.skill_level)) {
                        if (skill.toLowerCase().includes(searchLower)) {
                            return true;
                        }
                    }
                }

                // Check activity completion requirements
                if (item.gated_stats.activity_completion) {
                    for (const activityName of Object.keys(item.gated_stats.activity_completion)) {
                        if (activityName.toLowerCase().includes(searchLower)) {
                            return true;
                        }
                    }
                }

                // Check set pieces requirements
                if (item.gated_stats.set_pieces) {
                    for (const setName of Object.keys(item.gated_stats.set_pieces)) {
                        if (setName.toLowerCase().includes(searchLower)) {
                            return true;
                        }
                    }
                }
            }

            return false;
        });
    }

    /**
     * Sort items by quality (Ethereal first) then alphabetically
     * Requirements: 4.7
     * 
     * @param {Array} items - Items to sort
     * @returns {Array} Sorted items
     */
    sortItems(items) {
        return [...items].sort((a, b) => {
            // For consumable slot: sort by base name, then normal before fine
            if (a.type === 'consumable' && b.type === 'consumable') {
                const aBase = a.name.replace(' (Fine)', '');
                const bBase = b.name.replace(' (Fine)', '');
                const nameCompare = aBase.localeCompare(bBase);
                if (nameCompare !== 0) return nameCompare;
                // Same base name: normal before fine
                if (a.is_fine && !b.is_fine) return 1;
                if (!a.is_fine && b.is_fine) return -1;
                return 0;
            }

            // Get quality/rarity for each item
            const aQuality = this.getItemQuality(a);
            const bQuality = this.getItemQuality(b);

            // Compare by quality order (lower index = higher quality)
            const aIndex = ItemSelectionPopup.QUALITY_ORDER.indexOf(aQuality);
            const bIndex = ItemSelectionPopup.QUALITY_ORDER.indexOf(bQuality);

            if (aIndex !== bIndex) {
                return aIndex - bIndex;  // Lower index first (higher quality)
            }

            // Same quality - sort alphabetically
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Get the effective quality/rarity for an item
     * @param {Object} item - Item to check
     * @returns {string} Quality/rarity name (lowercase)
     */
    getItemQuality(item) {
        const itemState = this.getItemState(item.id);

        // For crafted items, use quality from state
        if (item.type === 'crafted_item') {
            const quality = itemState.quality || 'Normal';
            return ItemSelectionPopup.QUALITY_TO_RARITY[quality.toLowerCase()] || 'common';
        }

        // For non-crafted items, use rarity
        return (item.rarity || 'common').toLowerCase();
    }

    /**
     * Deduplicate items - keep only highest quality per item
     * Requirements: 4.8
     * 
     * @param {Array} items - Items to deduplicate
     * @returns {Array} Deduplicated items
     */
    deduplicateByQuality(items) {
        // Group items by base name (without quality suffix)
        const itemsByName = new Map();

        for (const item of items) {
            const baseName = item.name;

            if (!itemsByName.has(baseName)) {
                itemsByName.set(baseName, item);
            } else {
                // Compare qualities and keep highest
                const existing = itemsByName.get(baseName);
                const existingQuality = this.getItemQuality(existing);
                const newQuality = this.getItemQuality(item);

                const existingIndex = ItemSelectionPopup.QUALITY_ORDER.indexOf(existingQuality);
                const newIndex = ItemSelectionPopup.QUALITY_ORDER.indexOf(newQuality);

                if (newIndex < existingIndex) {
                    // New item has higher quality
                    itemsByName.set(baseName, item);
                }
            }
        }

        return Array.from(itemsByName.values());
    }

    /**
     * Filter and sort items for display
     * Requirements: 4.7, 4.8, 4.10
     * 
     * @returns {Array} Filtered and sorted items
     */
    filterItems() {
        let filtered = [...this.items];

        // Apply all filters
        filtered = this.applyOwnedFilter(filtered);
        filtered = this.applyHideFilter(filtered);
        filtered = this.applyStatFilter(filtered);
        filtered = this.applySearchFilter(filtered);

        // Deduplicate by quality (keep highest)
        filtered = this.deduplicateByQuality(filtered);

        // Sort by quality then alphabetically
        filtered = this.sortItems(filtered);

        return filtered;
    }

    /**
     * Get item state from store (with overrides)
     * Requirements: 4.15, 8.4
     * 
     * @param {string} itemId - Item ID
     * @returns {Object} Item state
     */
    getItemState(itemId) {
        const overrides = store.state.ui.user_overrides || {};
        const overrideItemState = (overrides.items && overrides.items[itemId]) || {};
        const baseItemState = store.state.items[itemId] || {};

        return {
            has: overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has,
            has_fine: overrideItemState.has_fine !== undefined ? overrideItemState.has_fine : baseItemState.has_fine,
            hide: overrideItemState.hide !== undefined ? overrideItemState.hide : baseItemState.hide,
            hide_fine: overrideItemState.hide_fine !== undefined ? overrideItemState.hide_fine : baseItemState.hide_fine,
            quality: overrideItemState.quality !== undefined ? overrideItemState.quality : baseItemState.quality,
            ring1_quality: overrideItemState.ring1_quality !== undefined ? overrideItemState.ring1_quality : baseItemState.ring1_quality,
            ring2_quality: overrideItemState.ring2_quality !== undefined ? overrideItemState.ring2_quality : baseItemState.ring2_quality
        };
    }

    /**
     * Get rarity class for an item
     * Requirements: 4.9, 8.3
     * 
     * @param {Object} item - Item data
     * @returns {string} CSS class for rarity
     */
    getRarityClass(item) {
        const quality = this.getItemQuality(item);

        const rarityMap = {
            'common': 'rarity-common',
            'fine': 'rarity-fine',
            'uncommon': 'rarity-uncommon',
            'rare': 'rarity-rare',
            'epic': 'rarity-epic',
            'legendary': 'rarity-legendary',
            'ethereal': 'rarity-ethereal'
        };

        return rarityMap[quality] || '';
    }

    /**
     * Format stat name for display
     * @param {string} statName - Stat name (snake_case)
     * @returns {string} Formatted name
     */
    formatStatName(statName) {
        // Handle ItemFindingCategory stats
        if (statName.startsWith('ItemFindingCategory.')) {
            const categoryConst = statName.split('.')[1];

            // Try to get category info from window cache
            if (window.itemFindingCategories && window.itemFindingCategories[categoryConst]) {
                const category = window.itemFindingCategories[categoryConst];
                const qtyText = category.min_qty === category.max_qty
                    ? category.min_qty
                    : `${category.min_qty} to ${category.max_qty}`;
                return `Chance to find ${qtyText} ${category.display_name_singular}`;
            }

            // Fallback: format from constant name
            const categoryName = categoryConst
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            return `Chance to find ${categoryName.toLowerCase()}`;
        }

        return statName
            .split('_')
            .map(word => {
                if (word.toLowerCase() === 'xp') return 'XP';
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(' ');
    }

    /**
     * Capitalize first letter of a string
     * @param {string} str - String to capitalize
     * @returns {string} Capitalized string
     */
    capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Format location name for display
     * @param {string} loc - Location name
     * @returns {string} Formatted location
     */
    formatLocation(loc) {
        if (loc.startsWith('!')) {
            // Handle negation (e.g., "!underwater" -> "NOT Underwater location")
            const cleanLoc = loc.substring(1);
            return `NOT ${this.formatLocation(cleanLoc)}`;
        }

        // Capitalize location and add "location" suffix
        if (loc === 'gdte') {
            return 'GDTE location';
        } else if (loc === 'underwater') {
            return 'Underwater location';
        } else {
            return `${this.capitalize(loc)} location`;
        }
    }

    /**
     * Render the stat filter dropdown
     * Requirements: 4.3, 4.4, 4.5
     * 
     * @returns {string} HTML for stat filter
     */
    renderStatFilter() {
        const stats = this.getAvailableStats();
        const selectedStat = this.statFilter;

        const options = stats.map(stat => {
            const formatted = this.formatStatName(stat);
            const isPercentage = stat.startsWith('ItemFindingCategory.') || ItemSelectionPopup.PERCENTAGE_STATS.includes(stat);
            const suffix = isPercentage ? ' %' : '';
            return `<option value="${stat}" ${stat === selectedStat ? 'selected' : ''}>${formatted}${suffix}</option>`;
        }).join('');

        return `
            <div class="stat-filter-container">
                <label for="stat-filter">Filter by stat:</label>
                <select id="stat-filter" class="stat-filter-dropdown">
                    <option value="None" ${selectedStat === 'None' ? 'selected' : ''}>None</option>
                    ${options}
                </select>
            </div>
        `;
    }

    /**
     * Render an item row
     * Requirements: 4.9, 4.14, 4.15, 8.1, 8.3
     * 
     * @param {Object} item - Item to render
     * @returns {string} HTML for item row
     */
    renderItemRow(item) {
        const itemState = this.getItemState(item.id);
        const rarityClass = this.getRarityClass(item);
        const isExpanded = this.expandedItemId === item.id;
        const expandedClass = isExpanded ? 'expanded' : '';
        const iconPath = item.icon_path || '/assets/icons/items/equipment/placeholder.svg';

        // Add fine class for fine items
        const isFine = item.is_fine || (item.name && item.name.includes('(Fine)'));
        const fineClass = isFine ? 'fine' : '';

        // Don't show quality text - color is enough
        return `
            <div class="popup-item-row ${rarityClass} ${expandedClass}" data-item-id="${item.id}">
                <div class="popup-item-main">
                    <img src="${iconPath}" alt="${item.name}" class="popup-item-icon ${fineClass}" loading="lazy">
                    <span class="popup-item-name">${item.name}</span>
                    <div class="popup-expand-btn-area" data-item-id="${item.id}">
                        <button class="popup-expand-btn">
                            <span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>
                        </button>
                    </div>
                </div>
                ${this.renderStatsPreview(item)}
            </div>
        `;
    }

    /**
     * Render stats preview for an item
     * Requirements: 4.12, 4.13, 4.16
     * 
     * @param {Object} item - Item to show stats for
     * @returns {string} HTML for stats preview
     */
    renderStatsPreview(item) {
        const itemState = this.getItemState(item.id);
        let stats = item.stats || {};

        // For crafted items, get stats for selected quality
        if (item.type === 'crafted_item' && item.stats_by_quality) {
            const quality = itemState.quality || 'Normal';
            stats = item.stats_by_quality[quality] || {};
        }

        const statsHtml = this.renderStatsFromObject(stats);

        // Render gated stats if present
        let gatedHtml = '';
        if (item.gated_stats) {
            gatedHtml = this.renderGatedStats(item.gated_stats, item);
        }

        return `
            <div class="popup-item-stats" style="display: none;">
                ${statsHtml}
                ${gatedHtml}
            </div>
        `;
    }

    /**
     * Render stats from a stats object
     * @param {Object} stats - Stats object {skill: {location: {stat: value}}}
     * @returns {string} HTML for stats
     */
    renderStatsFromObject(stats) {
        if (!stats || Object.keys(stats).length === 0) {
            return '<div class="no-stats">No stats</div>';
        }

        const statsHtml = [];

        for (const [skill, locationStats] of Object.entries(stats)) {
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                for (const [statName, statValue] of Object.entries(statsByLocation)) {
                    const formatted = this.formatStatName(statName);
                    const valueStr = this.formatStatValue(statName, statValue);
                    const valueClass = this.getStatValueClass(statName, statValue);

                    const condition = formatCondition(skill, location);

                    statsHtml.push(`
                        <div class="popup-stat-row">
                            <span class="${valueClass}">${valueStr}</span>
                            <span class="popup-stat-name">${formatted}</span>
                            <span class="popup-stat-condition">${condition}</span>
                        </div>
                    `);
                }
            }
        }

        return statsHtml.join('');
    }

    /**
     * Render gated stats
     * Requirements: 4.13
     * 
     * @param {Object} gatedStats - Gated stats object
     * @param {Object} item - The item being viewed
     * @returns {string} HTML for gated stats
     */
    renderGatedStats(gatedStats, item) {
        const statsHtml = [];

        // Achievement Points requirements
        if (gatedStats.achievement_points) {
            // Get character's current AP (check overrides first, then character)
            const overrideAP = store.state.ui?.user_overrides?.achievement_points;
            const characterAP = overrideAP !== undefined ? overrideAP : (store.state.character?.achievement_points || 0);

            for (const [threshold, apStats] of Object.entries(gatedStats.achievement_points)) {
                const apThreshold = parseInt(threshold, 10);
                const requirement = `${threshold} Achievement Points`;
                const isMet = characterAP >= apThreshold;
                const unmetClass = isMet ? '' : 'gated-unmet';

                console.log(`AP requirement: ${threshold}, character has: ${characterAP}, met: ${isMet}`);

                // Render each stat with requirement below it
                for (const [skill, locationStats] of Object.entries(apStats)) {
                    for (const [location, statsByLocation] of Object.entries(locationStats)) {
                        for (const [statName, statValue] of Object.entries(statsByLocation)) {
                            const formatted = this.formatStatName(statName);
                            const valueStr = this.formatStatValue(statName, statValue);
                            const valueClass = this.getStatValueClass(statName, statValue);

                            const condition = formatCondition(skill, location);

                            statsHtml.push(`
                                <div class="popup-stat-row popup-stat-gated ${unmetClass}">
                                    <span class="${valueClass}">${valueStr}</span>
                                    <span class="popup-stat-name">${formatted}</span>
                                    <span class="popup-stat-condition">${condition}</span>
                                </div>
                                <div class="popup-gated-requirement ${unmetClass}">${requirement}</div>
                            `);
                        }
                    }
                }
            }
        }

        // Total skill level requirements (sum of all skill levels)
        if (gatedStats.total_skill_level) {
            // Calculate character's total skill level
            const character = store.state.character || {};
            const overrides = store.state.ui?.user_overrides || {};
            let totalLevel = 0;
            if (overrides.skills && Object.keys(overrides.skills).length > 0) {
                // Use overrides if any exist
                const baseSkills = character.skills || {};
                const allSkills = new Set([...Object.keys(baseSkills), ...Object.keys(overrides.skills)]);
                for (const skill of allSkills) {
                    totalLevel += (overrides.skills[skill] !== undefined ? overrides.skills[skill] : (baseSkills[skill] || 0));
                }
            } else {
                // Use character total_skill_level or calculate from skills
                totalLevel = character.total_skill_level || Object.values(character.skills || {}).reduce((a, b) => a + b, 0);
            }

            for (const [threshold, tslStats] of Object.entries(gatedStats.total_skill_level)) {
                const tslThreshold = parseInt(threshold, 10);
                const requirement = `${threshold} Total Skill Level`;
                const isMet = totalLevel >= tslThreshold;
                const unmetClass = isMet ? '' : 'gated-unmet';

                // Render each stat with requirement below it
                for (const [skill, locationStats] of Object.entries(tslStats)) {
                    for (const [location, statsByLocation] of Object.entries(locationStats)) {
                        for (const [statName, statValue] of Object.entries(statsByLocation)) {
                            const formatted = this.formatStatName(statName);
                            const valueStr = this.formatStatValue(statName, statValue);
                            const valueClass = this.getStatValueClass(statName, statValue);

                            const condition = formatCondition(skill, location);

                            statsHtml.push(`
                                <div class="popup-stat-row popup-stat-gated ${unmetClass}">
                                    <span class="${valueClass}">${valueStr}</span>
                                    <span class="popup-stat-name">${formatted}</span>
                                    <span class="popup-stat-condition">${condition}</span>
                                </div>
                                <div class="popup-gated-requirement ${unmetClass}">${requirement}</div>
                            `);
                        }
                    }
                }
            }
        }

        // Skill level requirements
        if (gatedStats.skill_level) {
            for (const [skill, levels] of Object.entries(gatedStats.skill_level)) {
                for (const [level, skillStats] of Object.entries(levels)) {
                    const requirement = `${skill.charAt(0).toUpperCase() + skill.slice(1)} Level ${level}`;

                    // Check if requirement is met
                    const character = store.state.character || {};
                    const overrides = store.state.ui?.user_overrides || {};
                    const overrideLevel = overrides.skills?.[skill.toLowerCase()];
                    const characterLevel = character.skills?.[skill.toLowerCase()];
                    const charLevel = overrideLevel !== undefined ? overrideLevel : (characterLevel || 1);
                    const isMet = charLevel >= parseInt(level, 10);
                    const unmetClass = isMet ? '' : 'gated-unmet';

                    // Render each stat with requirement below it
                    // skillStats structure: {skill: {location: {stat: value}}}
                    for (const [statSkill, locationStats] of Object.entries(skillStats)) {
                        for (const [location, statsByLocation] of Object.entries(locationStats)) {
                            for (const [statName, statValue] of Object.entries(statsByLocation)) {
                                const formatted = this.formatStatName(statName);
                                const valueStr = this.formatStatValue(statName, statValue);
                                const valueClass = this.getStatValueClass(statName, statValue);

                                let condition = 'Global';
                                if (statSkill !== 'global' && location !== 'global') {
                                    condition = `While ${this.capitalize(statSkill)} in ${this.formatLocation(location)}`;
                                } else if (statSkill !== 'global') {
                                    condition = `While ${this.capitalize(statSkill)}`;
                                } else if (location !== 'global') {
                                    condition = `While in ${this.formatLocation(location)}`;
                                }

                                statsHtml.push(`
                                    <div class="popup-stat-row popup-stat-gated ${unmetClass}">
                                        <span class="${valueClass}">${valueStr}</span>
                                        <span class="popup-stat-name">${formatted}</span>
                                        <span class="popup-stat-condition">${condition}</span>
                                    </div>
                                    <div class="popup-gated-requirement ${unmetClass}">${requirement}</div>
                                `);
                            }
                        }
                    }
                }
            }
        }

        // Activity completion requirements
        if (gatedStats.activity_completion) {
            for (const [activityName, counts] of Object.entries(gatedStats.activity_completion)) {
                for (const [count, activityStats] of Object.entries(counts)) {
                    const requirement = `${count}+ ${activityName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;

                    // Check if requirement is met via custom stats
                    const customStatKey = `screwdriver_${activityName.toLowerCase().replace(/ /g, '_')}`;
                    const customStats = store.state.ui?.custom_stats || {};
                    const overrides = store.state.ui?.user_overrides || {};
                    const allCustomStats = { ...customStats, ...(overrides.custom_stats || {}) };
                    const isMet = allCustomStats[customStatKey] === true;
                    const unmetClass = isMet ? '' : 'gated-unmet';

                    // Render each stat with requirement below it
                    // activityStats structure: {skill: {location: {stat: value}}}
                    for (const [statSkill, locationStats] of Object.entries(activityStats)) {
                        for (const [location, statsByLocation] of Object.entries(locationStats)) {
                            for (const [statName, statValue] of Object.entries(statsByLocation)) {
                                const formatted = this.formatStatName(statName);
                                const valueStr = this.formatStatValue(statName, statValue);
                                const valueClass = this.getStatValueClass(statName, statValue);

                                let condition = 'Global';
                                if (statSkill !== 'global' && location !== 'global') {
                                    condition = `While ${this.capitalize(statSkill)} in ${this.formatLocation(location)}`;
                                } else if (statSkill !== 'global') {
                                    condition = `While ${this.capitalize(statSkill)}`;
                                } else if (location !== 'global') {
                                    condition = `While in ${this.formatLocation(location)}`;
                                }

                                statsHtml.push(`
                                    <div class="popup-stat-row popup-stat-gated ${unmetClass}">
                                        <span class="${valueClass}">${valueStr}</span>
                                        <span class="popup-stat-name">${formatted}</span>
                                        <span class="popup-stat-condition">${condition}</span>
                                    </div>
                                    <div class="popup-gated-requirement ${unmetClass}">${requirement}</div>
                                `);
                            }
                        }
                    }
                }
            }
        }

        // Set pieces requirements
        if (gatedStats.set_pieces) {
            for (const [setName, counts] of Object.entries(gatedStats.set_pieces)) {
                for (const [count, setStats] of Object.entries(counts)) {
                    const requiredCount = parseInt(count, 10);
                    const requirement = `${count} ${setName} Equipped`;

                    // Check if the item being viewed is part of this set
                    const itemIsInSet = this.itemIsInSet(item, setName);

                    // Count current set items (excluding the current slot being replaced)
                    const currentSetCount = this.countSetItems(setName, this.slot);

                    // Calculate what the count would be if this item is equipped
                    const wouldHaveCount = itemIsInSet ? currentSetCount + 1 : currentSetCount;
                    const isMet = wouldHaveCount >= requiredCount;
                    const unmetClass = isMet ? '' : 'gated-unmet';

                    console.log(`Set bonus: ${requirement}, item "${item.name}" in set: ${itemIsInSet}, current: ${currentSetCount}, would have: ${wouldHaveCount}, met: ${isMet}`);

                    // Render each stat with requirement below it
                    for (const [skill, locationStats] of Object.entries(setStats)) {
                        for (const [location, statsByLocation] of Object.entries(locationStats)) {
                            for (const [statName, statValue] of Object.entries(statsByLocation)) {
                                const formatted = this.formatStatName(statName);
                                const valueStr = this.formatStatValue(statName, statValue);
                                const valueClass = this.getStatValueClass(statName, statValue);

                                const condition = formatCondition(skill, location);

                                statsHtml.push(`
                                    <div class="popup-stat-row popup-stat-gated ${unmetClass}">
                                        <span class="${valueClass}">${valueStr}</span>
                                        <span class="popup-stat-name">${formatted}</span>
                                        <span class="popup-stat-condition">${condition}</span>
                                    </div>
                                    <div class="popup-gated-requirement ${unmetClass}">${requirement}</div>
                                `);
                            }
                        }
                    }
                }
            }
        }

        return statsHtml.join('');
    }

    /**
     * Check if an item is part of a set
     * @param {Object} item - Item to check
     * @param {string} setName - Set name
     * @returns {boolean} True if item is in the set
     */
    itemIsInSet(item, setName) {
        if (!item || !item.keywords) return false;

        return item.keywords.some(kw =>
            kw.toLowerCase().includes(setName.toLowerCase())
        );
    }

    /**
     * Count how many items from a set are currently equipped (excluding a specific slot)
     * @param {string} setName - Name of the set
     * @param {string} excludeSlot - Slot to exclude from count (the slot being replaced)
     * @returns {number} Count of set items equipped
     */
    countSetItems(setName, excludeSlot = null) {
        const currentGear = store.state.gearsets?.current || {};
        let count = 0;

        // Check all slots for items with this set name in keywords
        for (const [slot, item] of Object.entries(currentGear)) {
            // Skip the slot being replaced
            if (slot === excludeSlot) continue;

            if (item && item.keywords) {
                // Check if any keyword matches the set name (case-insensitive)
                const hasSet = item.keywords.some(kw =>
                    kw.toLowerCase().includes(setName.toLowerCase())
                );
                if (hasSet) {
                    count++;
                }
            }
        }

        console.log(`Counting ${setName} items (excluding ${excludeSlot}): ${count}`);
        return count;
    }

    /**
     * Format a stat value for display
     * @param {string} statName - Stat name
     * @param {number} value - Stat value
     * @returns {string} Formatted value
     */
    formatStatValue(statName, value) {
        const flatStats = [
            'quality_outcome',
            'inventory_space', 'bonus_xp_base', 'bonus_xp_add',
            'steps_required', 'steps_add', 'flat_steps',
            'bonus_experience_base', 'bonus_experience_add'
        ];

        const isFlat = flatStats.includes(statName);

        if (value > 0) {
            return isFlat ? `+${value}` : `+${value}%`;
        } else if (value < 0) {
            return isFlat ? `${value}` : `${value}%`;
        }
        return isFlat ? `${value}` : `${value}%`;
    }

    /**
     * Get CSS class for stat value
     * @param {string} statName - Stat name
     * @param {number} value - Stat value
     * @returns {string} CSS class
     */
    getStatValueClass(statName, value) {
        const negativeIsGood = ['steps_add', 'steps_required', 'flat_steps', 'steps_pct', 'steps_percent'];
        const negativeGood = negativeIsGood.includes(statName);

        if (value > 0) {
            return negativeGood ? 'stat-value-negative' : 'stat-value-positive';
        } else if (value < 0) {
            return negativeGood ? 'stat-value-positive' : 'stat-value-negative';
        }
        return 'stat-value';
    }

    /**
     * Render just the item list (without recreating the whole popup)
     */
    renderItemList() {
        const filteredItems = this.filterItems();

        const itemsHtml = filteredItems.length > 0
            ? filteredItems.map(item => this.renderItemRow(item)).join('')
            : '<div class="no-items">No items found</div>';

        this.$element.find('.popup-item-list').html(itemsHtml);

        // Re-attach events for the new item rows
        this.attachItemRowEvents();

        // Reset keyboard navigation after list update
        if (this.keyboardNav) {
            this.keyboardNav.reset();
        }
    }

    /**
     * Attach events specifically for item rows (called after renderItemList)
     */
    attachItemRowEvents() {
        // Remove old item row handlers
        this.$element.off('click', '.popup-item-row');
        this.$element.off('click', '.popup-expand-btn-area');

        // Item row click (select item)
        this.$element.on('click', '.popup-item-row', (e) => {
            // Don't select if clicking the expand button area
            if ($(e.target).closest('.popup-expand-btn-area').length > 0) {
                return;
            }

            const itemId = $(e.currentTarget).data('item-id');
            this.selectItem(itemId);
        });

        // Expand button area click (show stats preview)
        this.$element.on('click', '.popup-expand-btn-area', (e) => {
            e.stopPropagation();
            const itemId = $(e.currentTarget).data('item-id');

            console.log('Expand button clicked for item:', itemId, 'current expanded:', this.expandedItemId);

            if (this.expandedItemId === itemId) {
                this.expandedItemId = null;
            } else {
                this.expandedItemId = itemId;
            }

            // Find the item row and toggle stats with slideDown/slideUp
            const $itemRow = this.$element.find(`.popup-item-row[data-item-id="${itemId}"]`);
            const $stats = $itemRow.find('.popup-item-stats');

            console.log('Found item row:', $itemRow.length, 'stats element:', $stats.length, 'new expanded:', this.expandedItemId);

            if (this.expandedItemId === itemId) {
                console.log('Sliding down');
                $itemRow.addClass('expanded');
                $stats.slideDown(200);
                $itemRow.find('.popup-expand-btn .expand-arrow').addClass('expanded');
            } else {
                console.log('Sliding up');
                $itemRow.removeClass('expanded');
                $stats.slideUp(200);
                $itemRow.find('.popup-expand-btn .expand-arrow').removeClass('expanded');
            }
        });
    }

    /**
     * Render the currently equipped item section
     * @returns {string} HTML for current item
     */
    renderCurrentItem() {
        const currentSlotItem = store.state.gearsets?.current?.[this.slot];

        if (!currentSlotItem) {
            return '<div class="popup-current-item-empty">No item equipped</div>';
        }

        // Find the full item data from the catalog
        const fullItem = this.items.find(i => i.id === currentSlotItem.itemId);

        console.log('Rendering current item:', currentSlotItem, 'fullItem found:', !!fullItem, 'items loaded:', this.items.length);

        if (!fullItem) {
            // Fallback if item not found in catalog (items not loaded yet)
            const iconPath = currentSlotItem.icon_path || '/assets/icons/items/equipment/placeholder.svg';
            return `
                <div class="popup-current-item">
                    <img src="${iconPath}" alt="${currentSlotItem.name}" class="current-item-icon">
                    <span class="current-item-name">${currentSlotItem.name}</span>
                    <button class="unequip-btn">Unequip</button>
                </div>
            `;
        }

        // Get rarity class
        const rarityClass = this.getRarityClass(fullItem);
        const iconPath = fullItem.icon_path || '/assets/icons/items/equipment/placeholder.svg';

        // Render stats for the current item
        const itemState = this.getItemState(fullItem.id);
        let stats = fullItem.stats || {};

        // For crafted items, get stats for selected quality
        if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
            const quality = itemState.quality || 'Normal';
            stats = fullItem.stats_by_quality[quality] || {};
        }

        const statsHtml = this.renderStatsFromObject(stats);

        // Render gated stats if present
        let gatedHtml = '';
        if (fullItem.gated_stats) {
            gatedHtml = this.renderGatedStats(fullItem.gated_stats, fullItem);
        }

        console.log('Rendering current item with stats, statsHtml length:', statsHtml.length);

        const expandedClass = this.currentItemExpanded ? 'expanded' : '';
        const arrowIcon = `<span class="expand-arrow ${this.currentItemExpanded ? 'expanded' : ''}">▼</span>`;

        // Add fine class for fine items
        const isFine = fullItem.is_fine || (fullItem.name && fullItem.name.includes('(Fine)'));
        const fineClass = isFine ? 'fine' : '';

        return `
            <div class="popup-current-item-row ${rarityClass} ${expandedClass}">
                <div class="popup-current-item-main">
                    <img src="${iconPath}" alt="${fullItem.name}" class="popup-item-icon ${fineClass}">
                    <span class="popup-item-name">${fullItem.name}</span>
                    <div class="popup-expand-btn-area current-item-expand">
                        <button class="popup-expand-btn">${arrowIcon}</button>
                    </div>
                    <button class="unequip-btn">Unequip</button>
                </div>
                <div class="popup-item-stats" style="display: ${this.currentItemExpanded ? 'block' : 'none'};">
                    ${statsHtml}
                    ${gatedHtml}
                </div>
            </div>
        `;
    }

    /**
     * Render the popup HTML
     */
    render() {
        const slotName = this.slot ? this.getSlotDisplayName(this.slot) : 'Select Item';
        const filteredItems = this.filterItems();

        const itemsHtml = filteredItems.length > 0
            ? filteredItems.map(item => this.renderItemRow(item)).join('')
            : '<div class="no-items">No items found</div>';

        const html = `
            <div class="modal-overlay item-selection-modal-overlay" style="display: none;">
                <div class="modal item-selection-popup">
                    <div class="modal-header">
                        <h2>${slotName}</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-content">
                        ${this.renderCurrentItem()}
                        <div class="popup-filters">
                            <div class="search-container">
                                <input type="text" 
                                       class="popup-search" 
                                       placeholder="Search items..." 
                                       value="${this.searchText}">
                            </div>
                            ${this.renderStatFilter()}
                        </div>
                        <div class="popup-item-list">
                            ${itemsHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.$element.html(html);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers
        this.$element.off('click', '.close-btn');
        this.$element.off('click', '.modal-overlay');
        this.$element.off('input', '.popup-search');
        this.$element.off('change', '.stat-filter-dropdown');
        this.$element.off('click', '.unequip-btn');
        this.$element.off('click', '.current-item-expand');

        // Close button
        this.$element.on('click', '.close-btn', () => {
            this.hide();
        });

        // Click outside modal to close
        this.$element.on('click', '.modal-overlay', (e) => {
            if ($(e.target).hasClass('modal-overlay')) {
                this.hide();
            }
        });

        // Unequip button
        this.$element.on('click', '.unequip-btn', (e) => {
            e.stopPropagation();
            console.log('Unequipping item from slot:', this.slot);
            store.updateGearSlot(this.slot, null);
            api.showInfo(`Unequipped item from ${this.getSlotDisplayName(this.slot)}`);
            this.hide();
        });

        // Current item expand/collapse button
        this.$element.on('click', '.current-item-expand', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('Current item expand clicked, current state:', this.currentItemExpanded);
            this.currentItemExpanded = !this.currentItemExpanded;

            // Use jQuery slideDown/slideUp like the item rows
            const $currentItemRow = this.$element.find('.popup-current-item-row');
            const $stats = $currentItemRow.find('.popup-item-stats');
            const $arrow = this.$element.find('.current-item-expand .expand-arrow');

            console.log('Found rows:', $currentItemRow.length, 'stats:', $stats.length, 'new state:', this.currentItemExpanded);

            if (this.currentItemExpanded) {
                $currentItemRow.addClass('expanded');
                $stats.stop(true, false).slideDown(200);
                $arrow.addClass('expanded');
            } else {
                $currentItemRow.removeClass('expanded');
                $stats.stop(true, false).slideUp(200);
                $arrow.removeClass('expanded');
            }
        });

        // Search input
        this.$element.on('input', '.popup-search', (e) => {
            e.stopPropagation();
            this.searchText = e.target.value;
            // Only re-render the item list, not the whole popup
            this.renderItemList();
        });

        // Stat filter dropdown
        this.$element.on('change', '.stat-filter-dropdown', (e) => {
            e.stopPropagation();
            console.log('Stat filter changed to:', e.target.value);
            this.statFilter = e.target.value;
            // Persist to store (session only, not to backend)
            store.state.ui.column2.statFilter = this.statFilter;
            // Only re-render the item list, not the whole popup
            this.renderItemList();
            console.log('Item list re-rendered with new filter');
        });

        // Attach item row events
        this.attachItemRowEvents();

        // Escape key to close
        $(document).off('keydown.item-selection-popup');
        $(document).on('keydown.item-selection-popup', (e) => {
            if (e.key === 'Escape' && this.visible) {
                this.hide();
            }
        });
    }

    /**
     * Select an item and equip it to the slot
     * Requirements: 4.16
     * 
     * @param {string} itemId - Item ID to select
     */
    selectItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) {
            console.error('Item not found:', itemId);
            return;
        }

        const itemState = this.getItemState(itemId);

        // For crafted items, convert quality to rarity
        let rarity = item.rarity;
        if (item.type === 'crafted_item') {
            const quality = itemState.quality || 'Normal';
            const qualityToRarity = {
                'Eternal': 'ethereal',
                'Perfect': 'legendary',
                'Excellent': 'epic',
                'Great': 'rare',
                'Good': 'uncommon',
                'Normal': 'common'
            };
            rarity = qualityToRarity[quality] || 'common';
            console.log(`Crafted item: ${item.name}, quality: ${quality}, converted to rarity: ${rarity}`);
        }

        // Build item data for the slot (include keywords for set bonus calculation)
        const slotItem = {
            itemId: item.id,
            uuid: item.uuid,  // Add UUID for export
            name: item.name,
            icon_path: item.icon_path,
            rarity: rarity,
            quality: itemState.quality || (item.type === 'crafted_item' ? 'Normal' : null),
            keywords: item.keywords || [],
            is_fine: item.is_fine || false  // Add is_fine flag for drop shadow
        };

        console.log('Equipping item to slot:', this.slot, slotItem);

        // Call the onSelect callback if provided
        if (this.onSelect) {
            this.onSelect(this.slot, slotItem);
        }

        // Update the gear slot in store
        store.updateGearSlot(this.slot, slotItem);

        // Show toast notification
        api.showInfo(`Equipped ${item.name} to ${this.getSlotDisplayName(this.slot)}`);

        // Close the popup
        this.hide();
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        // Detach keyboard navigation
        if (this.keyboardNav) {
            this.keyboardNav.detach();
            this.keyboardNav = null;
        }

        $(document).off('keydown.item-selection-popup');
        super.destroy();
    }
}

export default ItemSelectionPopup;
