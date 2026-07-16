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
import { GearSlotGrid } from './gear-slot-grid.js';
import { getPetIconPath } from '../utils/pet-utils.js';
import { renderRequirementsRow } from '../utils/requirements.js';
import { validateToolKeyword } from '../utils/keyword-validation.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';

import { formatFixed } from '../utils/number-format.js';


// X-per-Y axis labels for the swap-metric popup. Mirrors AXIS_OPTIONS.label
// in xy-recipe-priority-list.js and xy-activity-priority-list.js. When a
// priority entry resolves to its inverse-pair Sorting enum (e.g.
// (total_crafts, materials) → MATERIALS_PER_CRAFT), the legacy enum's
// display name doesn't match the user's configured ratio, so we derive
// the label from the user's (x, y) directly using these labels. Keep in
// sync with the AXIS_OPTIONS lists.
const AXIS_LABELS = {
    // Recipe X/Y
    'expected_steps':  'Steps',
    'displayed_steps': 'Disp. Steps',
    'materials':       'Materials',
    'quality':         'Quality',
    'craft':           'Craft',
    'step':            'Step',
    'target_item':     'Target Item',
    'total_crafts':    'Total Crafts',
    'xp':              'XP',
    'action':          'Action',
    // Activity-only X/Y
    'steps':           'Steps',
    'reward_roll':     'Reward Roll',
    'total_xp':        'Total XP',
};


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

    // Skill groups get special display names
    const skillGroupNames = {
        'artisan': 'doing Artisan skills',
        'gathering': 'doing Gathering skills',
        'utility': 'doing Utility skills',
        'smelting': 'doing Smelting recipes',
    };

    // Format skill
    const skillLower = skill ? skill.toLowerCase() : 'global';
    let formattedSkill = null;
    if (skillLower !== 'global') {
        formattedSkill = skillGroupNames[skillLower] || capitalize(skill);
    }

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
        this.showGenericItems = localStorage.getItem('popupShowGeneric') !== 'false';  // default true
        this.showCommunityItems = localStorage.getItem('popupShowCommunity') === 'true';  // default false

        // Keyboard navigation
        this.keyboardNav = null;

        // Tool slot swipe navigation state
        this._slotSwipe = { startX: 0, startY: 0, tracking: false };

        // Pre-arm lock flag: when true, next equipped item will be auto-locked
        this._pendingLock = false;

        // Swap metric comparison cache (computed lazily per slot)
        this._swapMetricCtx = null;

        // Subscribe to per-slot lock state changes
        this.subscribe('gearsets.lockedSlots', () => {
            if (this.visible) {
                // Update just the lock icon without full re-render
                this._updateLockIcon();
            }
        });

        // Subscribe to Column 1 state changes
        this.subscribe('items', () => {
            if (this.visible) {
                this._rerenderInPlace();
            }
        });

        // Subscribe to Column 2 UI state
        this.subscribe('ui.column2', () => {
            if (this.visible) {
                this._rerenderInPlace();
            }
        });

        // Re-render when gear is equipped (e.g. after optimizer runs)
        this.subscribe('gearsets.current', () => {
            if (this.visible) {
                // Invalidate swap metric cache — gearset changed
                this._swapMetricCtx = null;

                // Auto-expand non-owned upgrades if alternatives just arrived for this slot
                const isSlot2Active = store.state.gearsets?.comparisonMode && store.state.gearsets?.activeGearsetSlot === 2;
                const alternatives = isSlot2Active
                    ? store.state.gearsets?.gearset2Alternatives
                    : store.state.gearsets?.alternatives;
                const lockedAlts = isSlot2Active
                    ? store.state.gearsets?.gearset2LockedAlternatives
                    : store.state.gearsets?.lockedAlternatives;
                if ((alternatives && alternatives[this.slot]?.length > 0) || (lockedAlts && lockedAlts[this.slot]?.length > 0)) {
                    this._alternativesExpanded = true;
                }
                this._rerenderInPlace();
            }
        });

        // Re-render when alternatives data arrives (optimizer finished)
        this.subscribe('gearsets.alternatives', () => {
            if (this.visible) {
                this._rerenderInPlace();
            }
        });
        this.subscribe('gearsets.lockedAlternatives', () => {
            if (this.visible) {
                this._rerenderInPlace();
            }
        });

        this.render();
        this.attachEvents();
    }

    /**
     * Get the ordered list of all navigable slots, skipping locked tool slots.
     * Order matches the UI grid: gear rows → tool rows → special slots.
     * @returns {string[]}
     */
    getNavigableSlots() {
        const level = window.calculateCharacterLevel
            ? window.calculateCharacterLevel(store.state.character)
            : 1;
        const unlockedCount = GearSlotGrid.getUnlockedToolSlots(level);

        const slots = [];
        // Gear slots (row by row, left to right)
        for (const row of GearSlotGrid.GEAR_SLOTS) {
            for (const s of row) slots.push(s);
        }
        // Tool slots (only unlocked)
        for (let i = 0; i < unlockedCount; i++) {
            slots.push(GearSlotGrid.TOOL_SLOTS[i]);
        }
        // Special slots
        for (const s of GearSlotGrid.SPECIAL_SLOTS) {
            slots.push(s);
        }
        return slots;
    }

    /**
     * Navigate to an adjacent slot with a slide animation.
     * @param {number} direction  -1 = previous, +1 = next
     */
    navigateSlot(direction) {
        const navigable = this.getNavigableSlots();
        const curIdx = navigable.indexOf(this.slot);
        if (curIdx < 0) return;

        const nextIdx = curIdx + direction;
        if (nextIdx < 0 || nextIdx >= navigable.length) return;

        const nextSlot = navigable[nextIdx];
        const slideOut = direction > 0 ? 'slide-out-left' : 'slide-out-right';
        const slideIn = direction > 0 ? 'slide-in-right' : 'slide-in-left';

        const $content = this.$element.find('.item-selection-popup .modal-content');

        // Slide current content out
        $content.addClass(slideOut);

        setTimeout(() => {
            // Switch slot and reload
            this.slot = nextSlot;
            this.searchText = '';
            this.expandedItemId = null;

            this.loadItemsForSlot(nextSlot).then(() => {
                this.render();

                // Keep overlay visible
                const $overlay = this.$element.find('.modal-overlay');
                $overlay.css('display', 'flex').addClass('show');

                // Trigger slide-in on new content
                const $newContent = this.$element.find('.item-selection-popup .modal-content');
                $newContent.addClass(slideIn);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        $newContent.removeClass(slideIn);
                    });
                });

                this.attachEvents();
                this.initKeyboardNav();
            });
        }, 150); // match CSS transition duration
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
                    // Input slot: show items matching the keyword filter
                    if (slot === 'input' && this._inputKeywordFilter) {
                        // Normalize underscores to spaces for comparison (activity references use underscores, keywords use spaces)
                        const kw = this._inputKeywordFilter.toLowerCase().replace(/_/g, ' ');
                        // Match by keyword only (not by name substring)
                        const kwMatch = (item.keywords && item.keywords.some(k => k.toLowerCase().replace(/_/g, ' ') === kw));
                        if (!kwMatch) return false;

                        // Apply level filter: only show items whose requirement level >= the activity's required level
                        // Skip filter for items without requirements (e.g., materials like arrows)
                        if (this._inputLevelFilter > 0) {
                            const reqs = item.requirements || [];
                            const skillReq = reqs.find(r => r.type === 'skill');
                            if (skillReq) {
                                const itemLevel = skillReq.level || 0;
                                if (itemLevel < this._inputLevelFilter) return false;
                            }
                            // Items without skill requirements pass through (materials, etc.)
                        }
                        return true;
                    }
                    if (slot === 'input') {
                        // No keyword filter — show generic input items only
                        return item.slot === 'input';
                    }
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

                // Append generic items matching this slot (gated behind feature flag)
                if (window._featureFlags?.generic) {
                    const genericItems = store.state.genericItems || [];
                    for (const gi of genericItems) {
                        const giSlot = gi.slot || '';
                        let matches = false;
                        if (slot === 'input' && this._inputKeywordFilter) {
                            // For input slot with keyword filter: show generic input items matching keyword
                            // Normalize underscores to spaces for comparison
                            const kw = this._inputKeywordFilter.toLowerCase().replace(/_/g, ' ');
                            matches = giSlot === 'input' && gi.keywords && gi.keywords.some(k => k.toLowerCase().replace(/_/g, ' ') === kw);
                            // Apply level filter to generic items too
                            if (matches && this._inputLevelFilter > 0) {
                                const reqs = (gi.gated_stats && gi.gated_stats.requirements) || [];
                                const skillReq = reqs.find(r => r.type === 'skill');
                                if (skillReq) {
                                    const itemLevel = skillReq.level || 0;
                                    if (itemLevel < this._inputLevelFilter) matches = false;
                                }
                            }
                        } else if (slot === 'input') {
                            matches = giSlot === 'input';
                        } else if (slot.startsWith('tool')) {
                            matches = giSlot === 'tool';
                        } else if (slot.startsWith('ring')) {
                            matches = giSlot === 'ring';
                        } else if (slot === 'consumable') {
                            matches = giSlot === 'consumable';
                        } else {
                            matches = giSlot === slot;
                        }
                        if (matches) {
                            const isConsumable = giSlot === 'consumable' || giSlot === 'input';
                            const isCollectible = giSlot === 'collectible';
                            const isPet = giSlot === 'pet';
                            const isCrafted = (isCollectible || isPet) ? false : (gi.is_crafted || isConsumable);
                            // For consumables, normal stats come from quality_stats.Normal
                            let itemStats = gi.stats || {};
                            let statsFine = null;
                            if (isConsumable && gi.quality_stats) {
                                itemStats = gi.quality_stats['Normal'] || gi.stats || {};
                                statsFine = gi.quality_stats['Fine'] || null;
                            }
                            const hasFine = isConsumable && gi.quality_stats && !!gi.quality_stats['Fine'];

                            // Build pet levels from quality_stats
                            let petLevels = null;
                            let petMaxLevel = 0;
                            if (isPet && gi.quality_stats) {
                                petLevels = {};
                                const petXpReqs = gi.quality_values?._pet_xp_requirements || {};
                                for (const [key, lvlStats] of Object.entries(gi.quality_stats)) {
                                    if (key === 'Egg') continue;
                                    const m = key.match(/Level (\d+)/);
                                    if (m) {
                                        const lvl = parseInt(m[1]);
                                        if (lvl > petMaxLevel) petMaxLevel = lvl;
                                        petLevels[String(lvl)] = {
                                            xp_required: petXpReqs[key] || 0,
                                            stats: lvlStats || {},
                                            abilities: [],
                                        };
                                    }
                                }
                            }

                            const _rawIcon = gi.icon || '⚡';
                            const _iconIsPath = _rawIcon.includes('/') || _rawIcon.endsWith('.svg') || _rawIcon.endsWith('.png');

                            this.items.push({
                                id: `generic::item::${gi.id}`,
                                name: gi.name,
                                slot: gi.slot,
                                keywords: gi.keywords || [],
                                rarity: (isCrafted || isPet) ? 'common' : (gi.rarity || 'common'),
                                icon: _iconIsPath ? '⚡' : _rawIcon,
                                icon_color: gi.icon_color,
                                icon_path: _iconIsPath ? _rawIcon : (gi.icon_path || null),
                                type: isPet ? 'pet' : (isCollectible ? 'collectible' : (isConsumable ? 'consumable' : (isCrafted ? 'crafted_item' : 'item'))),
                                is_generic: true,
                                _community: gi._community || false,
                                stats: itemStats,
                                stats_fine: statsFine,
                                stats_by_quality: (!isConsumable && !isPet && gi.quality_stats) ? gi.quality_stats : null,
                                quality_stats: gi.quality_stats || null,
                                gated_stats: gi.gated_stats || {},
                                requirements: (gi.gated_stats && gi.gated_stats.requirements) ? gi.gated_stats.requirements : [],
                                is_crafted: isCrafted,
                                has_fine: hasFine,
                                generic_id: gi.id,
                                levels: petLevels,
                                max_level: petMaxLevel,
                            });
                        }
                    }
                    console.log(`After generic items: ${this.items.length} total`);

                    // Split generic consumables with fine versions (same as wiki consumables above)
                    if (slot === 'consumable') {
                        const expanded = [];
                        for (const item of this.items) {
                            expanded.push(item);
                            if (item.is_generic && item.has_fine && item.stats_fine) {
                                expanded.push({
                                    ...item,
                                    id: item.id + '_fine',
                                    name: item.name + ' (Fine)',
                                    is_fine: true,
                                    has_fine: false,
                                    stats: item.stats_fine,
                                    stats_fine: null,
                                    rarity: 'fine',
                                });
                            }
                        }
                        this.items = expanded;
                    }
                }
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
    show(slot, options = {}) {
        console.log('=== ItemSelectionPopup.show() START ===');
        console.log('Slot:', slot, 'Options:', options);

        this.visible = true;
        this.slot = slot;
        this.searchText = '';
        this.expandedItemId = null;
        this._pendingLock = false;
        this._alternativesExpanded = false;
        this._expandedAltIndex = null;
        this._swapMetricCtx = null;  // Reset swap metric cache for new slot
        this._inputKeywordFilter = options.filterKeyword || null;
        this._inputLevelFilter = options.filterLevel || 0;
        this._inputSlotCallback = options.onSelect || this._inputSlotCallback || null;
        this._showOptions = options;
        // Tree-node context: when this popup is opened from a crafting-tree
        // node slot, the "currently equipped" item, the non-owned
        // alternatives metric, and the lock state all come from the node's
        // gear_config — not from the live character. Reset to null on
        // every show() so a subsequent col-2 open isn't poisoned by a
        // stale tree-node context.
        this._treeNodeContext = options.treeNodeContext || null;

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

        // Reset keyboard slide if active
        if (this._keyboardSlid) {
            const $popup = this.$element.find('.item-selection-popup');
            $popup.css('transform', '');
            $popup.css('transition', '');
            this._keyboardSlid = false;
        }

        // Detach keyboard navigation
        if (this.keyboardNav) {
            this.keyboardNav.detach();
            this.keyboardNav = null;
        }

        // Clean up swipe listeners
        const overlay = $overlay[0];
        if (overlay && this._swipeStartHandler) {
            overlay.removeEventListener('touchstart', this._swipeStartHandler);
            overlay.removeEventListener('touchend', this._swipeEndHandler);
            this._swipeStartHandler = null;
            this._swipeEndHandler = null;
        }

        // Clean up slot keyboard navigation
        if (this._keydownSlotNav) {
            document.removeEventListener('keydown', this._keydownSlotNav);
            this._keydownSlotNav = null;
        }

        // Clean up auto-collapse-on-scroll listener + timers
        if (this._autoCollapseScrollHandler && this._autoCollapseListEl) {
            this._autoCollapseListEl.removeEventListener('scroll', this._autoCollapseScrollHandler);
            this._autoCollapseScrollHandler = null;
        }
        if (this._autoCollapseTouchStartHandler && this._autoCollapseListEl) {
            this._autoCollapseListEl.removeEventListener('touchstart', this._autoCollapseTouchStartHandler);
            this._autoCollapseListEl.removeEventListener('touchmove', this._autoCollapseTouchMoveHandler);
            this._autoCollapseListEl.removeEventListener('touchend', this._autoCollapseTouchEndHandler);
            this._autoCollapseListEl.removeEventListener('touchcancel', this._autoCollapseTouchEndHandler);
            this._autoCollapseTouchStartHandler = null;
            this._autoCollapseTouchMoveHandler = null;
            this._autoCollapseTouchEndHandler = null;
        }
        this._autoCollapseListEl = null;
        this._autoCollapseTouchActive = false;
        if (this._autoCollapseIdleTimer) {
            clearTimeout(this._autoCollapseIdleTimer);
            this._autoCollapseIdleTimer = null;
        }
        if (this._autoCollapseRestoreTimer) {
            clearTimeout(this._autoCollapseRestoreTimer);
            this._autoCollapseRestoreTimer = null;
        }
        this._autoCollapseTopActive = false;
        this._autoCollapseAltActive = false;
        this._autoCollapseScrollStartedAt = 0;

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
        // Use .modal-content as container so arrow keys work while search input has focus
        // (search input is a sibling of .popup-item-list, both inside .modal-content)
        const $modalContent = this.$element.find('.modal-content');

        if (this.keyboardNav) {
            this.keyboardNav.detach();
        }

        this.keyboardNav = new KeyboardNavigator($modalContent, {
            $scrollContainer: this.$element.find('.popup-item-list'),
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
            // Pets are filtered by the pet-specific filter in filterItems() (has + level check)
            if (item.type === 'pet') return true;

            // For generic items, check their has state like any other item
            if (item.is_generic) {
                const itemState = this.getItemState(item.id);
                return itemState.has === true;
            }

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
        const showHidden = store.state.ui.column2?.showHiddenItems || false;
        if (showHidden) return items;

        return items.filter(item => {
            // For split fine consumable entries, check the base item's hide_fine state
            if (item.is_fine && item.id.endsWith('_fine')) {
                const baseId = item.id.replace(/_fine$/, '');
                const baseState = this.getItemState(baseId);
                return baseState.hide_fine !== true;
            }

            const itemState = this.getItemState(item.id);

            // Crafted rings use per-quality hide flags (hide_ring1 / hide_ring2)
            // instead of a single `hide` flag. Treat the row as hidden when
            // BOTH owned qualities are hidden — the eye icon toggles both at
            // once, so this matches the user's mental model. If only one
            // quality is hidden, getAvailableRingQuality picks the visible one.
            if (item.slot === 'ring' && item.type === 'crafted_item') {
                const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
                const ring2Quality = itemState.ring2_quality || 'None';
                const hasRing2 = ring2Quality && ring2Quality !== 'None';
                if (!hasRing2) {
                    // Only one quality owned — hide if its flag is set.
                    return !itemState.hide_ring1;
                }
                // Two qualities owned — hide only if both flags are set.
                if (itemState.hide_ring1 && itemState.hide_ring2) return false;
                return true;
            }

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
     * Apply "only show items with applicable stats" filter.
     * 
     * An item has applicable stats if ANY of its stats would be "applied" given
     * the current activity/recipe skill + location context. Uses the same
     * skill/location matching logic as CombinedStatsSection.aggregateStatsWithContributors.
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    applyApplicableFilter(items) {
        const showApplicableOnly = store.state.ui.column2?.showApplicableOnly ?? false;
        if (!showApplicableOnly) return items;

        // Input slot items are selected by keyword, not by stat applicability
        if (this.slot === 'input') return items;

        // Get current context from CombinedStatsSection
        const css = window.combinedStatsSection;
        if (!css) return items;

        // Tree-node popup overrides CSS context so the filter scopes to the
        // recipe/activity the user is editing in the tree, not whatever
        // they last viewed in the main app. Without this, opening a slot
        // popup from a tree node fell through to the unrelated CSS context
        // — for users who hadn't selected anything elsewhere, the filter
        // was a full no-op and every owned pet/consumable showed. Bug
        // 9ce474f8 (darkbow): "Pets and consumables in tree opt don't seem
        // to match the skill when I press to manually equip them?"
        const tnc = this._treeNodeContext;
        const tncSkill = tnc?.skill ? tnc.skill.toLowerCase() : null;
        const tncIsActivity = tnc?.sourceType === 'activity' || tnc?.sourceType === 'chest';
        const tncIsRecipe = tnc?.sourceType === 'recipe';

        const activitySkill = tncIsActivity && tncSkill
            ? tncSkill
            : css.currentActivitySkill;
        const recipeSkill = tncIsRecipe && tncSkill
            ? tncSkill
            : css.currentRecipeSkill;
        const componentSkills = tnc ? null : css.currentActivityComponentSkills;
        const currentLocation = tnc?.location
            ? tnc.location
            : (tnc ? null : css.currentLocation);

        // If no activity or recipe is selected, don't filter (everything is "applicable")
        if (!activitySkill && !recipeSkill) return items;

        // Determine context type: activity or recipe
        const isActivity = !!activitySkill && !recipeSkill;
        const isRecipe = !!recipeSkill;

        // Stats that only apply to crafting recipes, never to activities
        const RECIPE_ONLY_STATS = new Set([
            'quality_outcome',
            'no_materials_consumed',
        ]);

        // Stats that only apply to activities, never to recipes
        const ACTIVITY_ONLY_STATS = new Set([
            'fine_material_finding',
            'find_collectibles',
            'find_gems',
            'find_bird_nests',
            'find_bird_nest',
        ]);

        // Universal "find" stats. When scoped to 'global' on a pet, these
        // genuinely apply to ANY activity (or chest recipe) that produces the
        // corresponding drop, regardless of the pet's skill specialization.
        // They are the ONE exception to the pet global-scope exclusion that the
        // Tortoise fix (bug 9ce474f8) introduced: a pet whose only relevant
        // stat is a global find_collectibles — e.g. the Level 4 Mummy, which is
        // Tailoring-specialized but carries a global +5% find_collectibles —
        // IS applicable to collectibles activities. Bug dd01d8e6. isStatRelevant
        // still gates the activity-only find stats out of recipe contexts, and
        // generic global utility stats (inventory_space, work_efficiency, etc.)
        // remain excluded so the Tortoise fix is preserved.
        const GLOBAL_FIND_STATS = new Set([
            'find_collectibles',
            'find_gems',
            'find_bird_nests',
            'find_bird_nest',
            'fine_material_finding',
            'chest_finding',
        ]);

        // Skill group definitions (same as CombinedStatsSection)
        const SKILL_GROUPS = {
            'gathering': ['fishing', 'foraging', 'hunting', 'mining', 'woodcutting'],
            'artisan': ['carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'],
            'utility': ['agility', 'traveling'],
        };

        /**
         * Check if a skill key from item stats matches the current context.
         */
        const skillMatches = (skill) => {
            const skillLower = skill.toLowerCase();
            if (skillLower === 'global') return true;

            if (activitySkill) {
                const actSkillLower = activitySkill.toLowerCase();
                if (skillLower === actSkillLower) return true;
                if (SKILL_GROUPS[skillLower]?.includes(actSkillLower)) return true;
                if (componentSkills) {
                    for (const cs of componentSkills) {
                        const csLower = cs.toLowerCase();
                        if (skillLower === csLower) return true;
                        if (SKILL_GROUPS[skillLower]?.includes(csLower)) return true;
                    }
                }
            }

            if (recipeSkill) {
                const recSkillLower = recipeSkill.toLowerCase();
                if (skillLower === recSkillLower) return true;
                if (SKILL_GROUPS[skillLower]?.includes(recSkillLower)) return true;
            }

            return false;
        };

        /**
         * Check if a location key from item stats matches the current context.
         */
        const locationMatches = (location) => {
            const locationLower = location.toLowerCase();
            if (locationLower === 'global') return true;

            // For travel, any location-specific stat is applicable — the user is
            // browsing gear for travel and region stats (jarvonia, syrenthia, etc.)
            // are all relevant regardless of which specific route is selected.
            if (css.isTravel) return true;

            if (!currentLocation) return false;

            const currentLocations = Array.isArray(currentLocation)
                ? currentLocation
                : [currentLocation];

            return currentLocations.some(loc => locationLower === loc.toLowerCase());
        };

        /**
         * Check if a stat name is relevant for the current context.
         * Filters out recipe-only stats (QO, NMC) when an activity is selected,
         * and activity-only stats (find_collectibles, find_gems, etc.) when a recipe is selected.
         */
        const isStatRelevant = (statName) => {
            if (isActivity && RECIPE_ONLY_STATS.has(statName)) return false;
            if (isRecipe && ACTIVITY_ONLY_STATS.has(statName)) return false;
            return true;
        };

        /**
         * Check if a stats object has any applicable stat.
         * Requires skill match, location match, AND at least one relevant stat name.
         */
        const hasApplicableStat = (stats) => {
            for (const [skill, locationStats] of Object.entries(stats)) {
                if (!skillMatches(skill)) continue;
                for (const [location, statsByLocation] of Object.entries(locationStats)) {
                    if (!locationMatches(location)) continue;
                    // Check that at least one stat in this skill/location is relevant
                    for (const statName of Object.keys(statsByLocation)) {
                        if (isStatRelevant(statName)) return true;
                    }
                }
            }
            return false;
        };

        /**
         * Stricter variant for pets: requires a stat scoped to the target
         * skill (or a group containing it), explicitly EXCLUDING the catch-all
         * 'global' scope. Bug 9ce474f8: Tortoise (smithing-focused, with a
         * tiny global +inventory_space) was showing on Crafting / Cooking
         * recipe popups because its global stat passed the standard
         * skillMatches early-return. Players don't think of a pet as
         * "Crafting-applicable" just because it has a global inventory bonus —
         * if its skill-specialized stats are all in OTHER skills (smithing
         * here), it's not a Crafting pet. Mirrors the Python helper
         * `_filter_pet_consumable_candidates_by_skill(item_kind='pet')` in
         * ui/optimize_worker.py — keep them in sync.
         *
         * Falls back to the lenient hasApplicableStat when neither activity
         * nor recipe skill is selected (no context to be strict about).
         */
        const hasSkillScopedApplicableStat = (stats) => {
            if (!activitySkill && !recipeSkill) return hasApplicableStat(stats);
            for (const [skill, locationStats] of Object.entries(stats)) {
                const skillLower = skill.toLowerCase();
                if (skillLower === 'global') {
                    // Global scope is normally excluded for pets (Tortoise's
                    // global +inventory_space must not make it
                    // "Crafting-applicable", bug 9ce474f8). EXCEPTION: universal
                    // "find" stats genuinely apply to ANY activity (or chest
                    // recipe) producing that drop regardless of skill, so a pet
                    // whose only relevant stat is a global find_collectibles
                    // (Level 4 Mummy) IS applicable. Bug dd01d8e6. isStatRelevant
                    // still drops activity-only find stats from recipe contexts.
                    for (const [location, statsByLocation] of Object.entries(locationStats)) {
                        if (!locationMatches(location)) continue;
                        for (const statName of Object.keys(statsByLocation)) {
                            if (GLOBAL_FIND_STATS.has(statName) && isStatRelevant(statName)) return true;
                        }
                    }
                    continue;
                }
                if (!skillMatches(skill)) continue;
                for (const [location, statsByLocation] of Object.entries(locationStats)) {
                    if (!locationMatches(location)) continue;
                    for (const statName of Object.keys(statsByLocation)) {
                        if (isStatRelevant(statName)) return true;
                    }
                }
            }
            return false;
        };

        return items.filter(item => {
            const itemState = this.getItemState(item.id);

            // Pets: check stats from the current level, not from item.stats.
            // Use the stricter skill-scoped check (excludes global-only matches)
            // so e.g. Tortoise — smithing-focused with only a tiny global
            // +inventory_space — does NOT show on a Crafting / Cooking popup.
            // Bug 9ce474f8.
            if (item.type === 'pet') {
                const level = itemState.level || 0;
                if (level === 0) return false; // Eggs have no stats
                const levelData = item.levels && item.levels[String(level)];
                if (levelData && levelData.stats && hasSkillScopedApplicableStat(levelData.stats)) return true;
                return false;
            }

            // Always include items that satisfy a keyword requirement for the activity.
            // EXACT match — substring match would incorrectly count
            // "Fishing rod rest" / "Fishing cage" as satisfying a "fishing rod"
            // requirement. Must mirror util/walkscape_constants.py:item_has_keyword.
            const requiredKeywords = css.currentRequiredKeywords || [];
            if (requiredKeywords.length > 0 && item.keywords && item.keywords.length > 0) {
                const hasRequiredKeyword = requiredKeywords.some(reqKw =>
                    item.keywords.some(kw => kw.toLowerCase() === reqKw.toLowerCase())
                );
                if (hasRequiredKeyword) return true;
            }

            // Check base stats
            let stats = item.stats || {};
            if (item.type === 'crafted_item' && item.stats_by_quality) {
                const quality = itemState.quality || 'Normal';
                stats = item.stats_by_quality[quality] || {};
            }
            if (hasApplicableStat(stats)) return true;

            // Check gated stats (skill_level, achievement_points, set_pieces, activity_completion, total_skill_level, total_collectibles)
            const gated = item.gated_stats || {};
            for (const [gateType, gateData] of Object.entries(gated)) {
                if (!gateData || typeof gateData !== 'object') continue;

                if (gateType === 'achievement_points' || gateType === 'total_skill_level' || gateType === 'total_collectibles') {
                    // Structure: {threshold: {skill: {location: {stat: value}}}}
                    for (const thresholdStats of Object.values(gateData)) {
                        if (typeof thresholdStats === 'object' && thresholdStats !== null) {
                            if (hasApplicableStat(thresholdStats)) return true;
                        }
                    }
                } else {
                    // Structure: {name: {threshold: {skill: {location: {stat: value}}}}}
                    // Covers: skill_level, activity_completion, set_pieces
                    for (const thresholds of Object.values(gateData)) {
                        if (typeof thresholds !== 'object' || thresholds === null) continue;
                        for (const thresholdStats of Object.values(thresholds)) {
                            if (typeof thresholdStats === 'object' && thresholdStats !== null) {
                                if (hasApplicableStat(thresholdStats)) return true;
                            }
                        }
                    }
                }
            }

            return false;
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
            // For ring slots, check if the same item is already equipped in the other ring slot
            // If so, use the next-best available quality
            if (item.slot === 'ring' && this.slot && this.slot.startsWith('ring')) {
                const quality = this.getAvailableRingQuality(item, itemState);
                return ItemSelectionPopup.QUALITY_TO_RARITY[quality.toLowerCase()] || 'common';
            }
            const quality = itemState.quality || 'Normal';
            return ItemSelectionPopup.QUALITY_TO_RARITY[quality.toLowerCase()] || 'common';
        }

        // For non-crafted items, use rarity
        return (item.rarity || 'common').toLowerCase();
    }

    /**
     * Get the best available quality for a ring item, considering what's already equipped
     * in the other ring slot.
     * 
     * @param {Object} item - Ring item
     * @param {Object} itemState - Item state from store
     * @returns {string} Quality name (e.g., 'Excellent', 'Good')
     */
    getAvailableRingQuality(item, itemState) {
        const otherSlot = this.slot === 'ring1' ? 'ring2' : 'ring1';
        // Tree-node popups reason about the NODE's previewed gearset, not the
        // live column-2 gear (bug 82bc145e) — keep consistent with
        // filterUnavailableRings so a ring kept in the list also gets its
        // quality picked against the correct (tree) other-ring slot.
        const currentGear = this._treeGearsetForFilters() || store.state.gearsets?.current || {};
        const otherRingItem = currentGear[otherSlot];

        // For crafted rings with dual quality selections (ring1_quality / ring2_quality)
        const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
        const ring2Quality = itemState.ring2_quality || 'None';

        // Hide flags on a ring are quality-instance-scoped:
        //   hide_ring1 hides whichever quality is currently at ring1Quality
        //   hide_ring2 hides whichever quality is currently at ring2Quality
        // Treat hidden qualities as if the user doesn't own them — the popup
        // should never select a hidden quality for display, and if all owned
        // qualities are hidden the row gets removed by applyHideFilter.
        const hideRing1 = !!itemState.hide_ring1;
        const hideRing2 = !!itemState.hide_ring2;

        // If the other ring slot has the same item equipped, we need to use a different quality
        if (otherRingItem && otherRingItem.itemId === item.id && item.type === 'crafted_item') {
            const otherQuality = otherRingItem.quality;

            // Quality hierarchy (best to worst)
            const qualityHierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];

            // Collect all available qualities with their counts (skip hidden)
            const availableQualities = {};
            if (ring1Quality && ring1Quality !== 'None' && !hideRing1) {
                availableQualities[ring1Quality] = (availableQualities[ring1Quality] || 0) + 1;
            }
            if (ring2Quality && ring2Quality !== 'None' && !hideRing2) {
                availableQualities[ring2Quality] = (availableQualities[ring2Quality] || 0) + 1;
            }

            // The other slot is using one of these qualities - subtract it
            if (otherQuality && availableQualities[otherQuality]) {
                availableQualities[otherQuality]--;
                if (availableQualities[otherQuality] <= 0) {
                    delete availableQualities[otherQuality];
                }
            }

            // Return the best remaining quality
            for (const q of qualityHierarchy) {
                if (availableQualities[q] && availableQualities[q] > 0) {
                    return q;
                }
            }

            // No quality left - this item shouldn't be shown, but return Normal as fallback
            return 'Normal';
        }

        // No conflict (other slot empty or different item) — show the best quality
        // the user owns for this ring, regardless of which "slot" it was assigned to.
        // Skip qualities the user has hidden (hide_ring1 / hide_ring2).
        const qualityHierarchy = ['Eternal', 'Perfect', 'Excellent', 'Great', 'Good', 'Normal'];
        const owned = [];
        if (ring1Quality && ring1Quality !== 'None' && !hideRing1) owned.push(ring1Quality);
        if (ring2Quality && ring2Quality !== 'None' && !hideRing2) owned.push(ring2Quality);
        for (const q of qualityHierarchy) {
            if (owned.includes(q)) return q;
        }
        // Nothing owned (or all hidden). Caller (applyHideFilter / row renderer)
        // is responsible for removing the row in that case. Return ring1Quality
        // as a safe fallback to avoid throwing.
        return ring1Quality;
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
                const existingQuality = this._getQualityForDedup(existing);
                const newQuality = this._getQualityForDedup(item);

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
     * Get quality rarity string for deduplication purposes.
     * For non-owned crafted rings, uses item.rarity directly so non-owned higher-quality
     * variants are not incorrectly discarded in favour of owned lower-quality variants.
     * For all other items, delegates to getItemQuality().
     * 
     * @param {Object} item - Item to get quality for
     * @returns {string} Rarity string (e.g., 'rare', 'epic')
     */
    _getQualityForDedup(item) {
        if (item.type === 'crafted_item' && item.slot === 'ring' &&
            this.slot && this.slot.startsWith('ring')) {
            const itemState = this.getItemState(item.id);
            if (itemState.has !== true) {
                return (item.rarity || 'common').toLowerCase();
            }
        }
        return this.getItemQuality(item);
    }

    /**
     * Filter and sort items for display
     * Requirements: 4.7, 4.8, 4.10
     * 
     * @returns {Array} Filtered and sorted items
     */
    filterItems() {
        let filtered = [...this.items];

        // Filter generic items visibility
        if (!this.showGenericItems) {
            filtered = filtered.filter(item => !item.is_generic);
        } else {
            const showOwnedOnly = store.state.ui.column2?.showOwnedOnly ?? true;
            // When owned-only is on, community items pass through if user has them checked
            // (applyOwnedFilter handles that). When owned-only is off, respect the community checkbox.
            if (!showOwnedOnly && !this.showCommunityItems) {
                filtered = filtered.filter(item => !item.is_generic || !item._community);
            }
        }

        // For pet slot, filter based on ownership and level.
        // When "Show owned only" is ON: require owned (has=true) AND level > 0 (no eggs).
        // When "Show owned only" is OFF: show all pets so users can browse and discover them.
        // Ownership check for pets is handled here (not in applyOwnedFilter) because
        // pets need the combined has+level check that applyOwnedFilter doesn't provide.
        if (this.slot === 'pet') {
            const showOwnedOnly = store.state.ui.column2?.showOwnedOnly ?? true;
            if (showOwnedOnly) {
                filtered = filtered.filter(item => {
                    if (item.type !== 'pet') return true;
                    const petState = this.getItemState(item.id);
                    return petState.has === true && (petState.level || 0) > 0;
                });
            }
            // When !showOwnedOnly, all pets pass through (including eggs for browsing)
        }

        // Apply all filters
        filtered = this.applyOwnedFilter(filtered);
        filtered = this.applyHideFilter(filtered);
        filtered = this.applyStatFilter(filtered);
        filtered = this.applyApplicableFilter(filtered);
        filtered = this.applySearchFilter(filtered);

        // For ring slots, filter out crafted ring items that have no available quality
        // (i.e., the other ring slot already uses all owned copies)
        if (this.slot && this.slot.startsWith('ring')) {
            filtered = this.filterUnavailableRings(filtered);
        }

        // For tool slots, hide items already equipped in another tool slot.
        // The same item can't be equipped to two tool slots at once
        // (validateToolKeyword blocks the click), so showing it would just
        // be misleading. Bug 88a427a8 follow-up.
        if (this.slot && this.slot.startsWith('tool')) {
            filtered = this.filterDuplicateTools(filtered);
        }

        // Deduplicate by quality (keep highest)
        filtered = this.deduplicateByQuality(filtered);

        // Sort by quality then alphabetically
        filtered = this.sortItems(filtered);

        return filtered;
    }

    /**
     * Resolve the slot→item gearset the popup's availability filters
     * (duplicate-tool / unavailable-ring) and quality picker should reason
     * about.
     *
     * When the popup is opened from a crafting-tree node slot
     * (`this._treeNodeContext` set), "what's already equipped in the other
     * slots" is the NODE's previewed gearset — NOT the live column-2
     * character gear. Without this, a tool/ring equipped in column 2 (e.g.
     * Treasure grabber) was wrongly treated as "already equipped in another
     * slot" and stripped from the tree popup's list, even though the tree's
     * preview gearset didn't have it anywhere. Bug 82bc145e.
     *
     * Mirrors renderCurrentItem()'s resolution: per slot, the user's locked
     * pick takes priority over the optimizer's auto-pick, and a
     * `lockedSlots[slot] === null` is the force-empty sentinel (unequipped).
     * Returns null when NOT in a tree context so each caller falls back to
     * its own live-gearset source (they differ:
     * filterDuplicateTools uses getActiveGearset(); the ring helpers use
     * gearsets.current).
     *
     * @returns {Object|null} Normalized slot→{itemId, quality, ...} map, or null.
     */
    _treeGearsetForFilters() {
        const ctx = this._treeNodeContext;
        if (!ctx || !ctx.equippedSlots) return null;

        const equipped = ctx.equippedSlots || {};
        const locked = ctx.lockedSlots || {};
        const result = {};
        const slots = new Set([...Object.keys(equipped), ...Object.keys(locked)]);
        for (const slot of slots) {
            const hasLock = Object.prototype.hasOwnProperty.call(locked, slot);
            const lockedTs = locked[slot];
            // Force-empty sentinel: user explicitly unequipped this slot in
            // the tree — treat as nothing equipped there.
            if (hasLock && lockedTs === null) continue;
            const ts = (lockedTs && lockedTs.itemId !== undefined)
                ? lockedTs
                : (lockedTs || equipped[slot]);
            if (!ts) continue;
            result[slot] = {
                itemId: ts.itemId || ts.id || ts.uuid || null,
                quality: ts.quality || null,
                ring1_quality: ts.ring1_quality,
                ring2_quality: ts.ring2_quality,
                keywords: ts.keywords || [],
                level: ts.level,
            };
        }
        return result;
    }

    /**
     * Filter out ring items that are no longer available because the other ring slot
     * already uses all owned copies.
     * 
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    filterUnavailableRings(items) {
        const otherSlot = this.slot === 'ring1' ? 'ring2' : 'ring1';
        // Tree-node popups reason about the NODE's previewed gearset, not the
        // live column-2 gear (bug 82bc145e). Falls back to gearsets.current
        // outside a tree context.
        const currentGear = this._treeGearsetForFilters() || store.state.gearsets?.current || {};
        const otherRingItem = currentGear[otherSlot];

        if (!otherRingItem) {
            return items;
        }

        return items.filter(item => {
            // Only check ring items that match the other slot's item
            if (item.slot !== 'ring' || item.id !== otherRingItem.itemId) {
                return true;
            }

            const itemState = this.getItemState(item.id);

            if (item.type === 'crafted_item') {
                // For crafted rings, check if any quality remains after the other slot uses one.
                // Hidden qualities (hide_ring1 / hide_ring2) are NOT counted as available —
                // they're removed from the user's selectable pool.
                const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
                const ring2Quality = itemState.ring2_quality || 'None';
                const hideRing1 = !!itemState.hide_ring1;
                const hideRing2 = !!itemState.hide_ring2;

                // Count total available qualities (excluding hidden)
                const availableQualities = {};
                if (ring1Quality && ring1Quality !== 'None' && !hideRing1) {
                    availableQualities[ring1Quality] = (availableQualities[ring1Quality] || 0) + 1;
                }
                if (ring2Quality && ring2Quality !== 'None' && !hideRing2) {
                    availableQualities[ring2Quality] = (availableQualities[ring2Quality] || 0) + 1;
                }

                // Subtract the quality used by the other slot
                const otherQuality = otherRingItem.quality;
                if (otherQuality && availableQualities[otherQuality]) {
                    availableQualities[otherQuality]--;
                }

                // Check if any quality remains
                const totalRemaining = Object.values(availableQualities).reduce((sum, count) => sum + count, 0);
                return totalRemaining > 0;
            } else {
                // For non-crafted rings, check quantity
                const ringQuantity = itemState.ring_quantity || 1;
                // Other slot already uses 1, so we need at least 2
                return ringQuantity >= 2;
            }
        });
    }

    /**
     * Filter out items already equipped in OTHER tool slots so the popup
     * doesn't list duplicates the user can't actually pick.
     *
     * Bug 88a427a8 follow-up: the click-time validation in
     * validateToolKeyword already blocks equipping the same itemId to two
     * tool slots, but showing the duplicate in the list is misleading —
     * the user clicks it expecting to equip it and gets an error toast.
     * Hide it from the list when targeting a different tool slot.
     *
     * @param {Array} items - Items to filter
     * @returns {Array} Filtered items
     */
    filterDuplicateTools(items) {
        // Tree-node popups reason about the NODE's previewed gearset, not the
        // live column-2 gear (bug 82bc145e): a tool equipped in column 2
        // (Treasure grabber) must NOT be hidden here just because it sits in
        // a column-2 tool slot — it isn't equipped in the tree preview.
        // Falls back to getActiveGearset() outside a tree context.
        const currentGear = this._treeGearsetForFilters() || store.getActiveGearset() || {};
        const equippedToolItemIds = new Set();
        for (const [slot, equipped] of Object.entries(currentGear)) {
            if (!slot.startsWith('tool')) continue;
            if (slot === this.slot) continue;  // not this slot — that's just "currently equipped here"
            if (!equipped) continue;
            const id = equipped.itemId || equipped.id;
            if (id) equippedToolItemIds.add(id);
        }
        if (equippedToolItemIds.size === 0) {
            return items;
        }
        return items.filter(item => {
            const id = item.id || item.itemId;
            return !id || !equippedToolItemIds.has(id);
        });
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
            // Per-ring-quality hide flags. Without these, the ring popup
            // can't tell which quality the user has hidden and falls back
            // to picking the highest quality (e.g. "Great") even when the
            // user explicitly hid that quality. Bug bbfb2014 follow-up.
            hide_ring1: overrideItemState.hide_ring1 !== undefined ? overrideItemState.hide_ring1 : baseItemState.hide_ring1,
            hide_ring2: overrideItemState.hide_ring2 !== undefined ? overrideItemState.hide_ring2 : baseItemState.hide_ring2,
            quality: overrideItemState.quality !== undefined ? overrideItemState.quality : baseItemState.quality,
            ring1_quality: overrideItemState.ring1_quality !== undefined ? overrideItemState.ring1_quality : baseItemState.ring1_quality,
            ring2_quality: overrideItemState.ring2_quality !== undefined ? overrideItemState.ring2_quality : baseItemState.ring2_quality,
            ring_quantity: overrideItemState.ring_quantity !== undefined ? overrideItemState.ring_quantity : baseItemState.ring_quantity,
            level: overrideItemState.level !== undefined ? overrideItemState.level : (baseItemState.level !== undefined ? baseItemState.level : 0),
            variant: overrideItemState.variant !== undefined ? overrideItemState.variant : (baseItemState.variant || 'normal'),
            petName: overrideItemState.petName !== undefined ? overrideItemState.petName : (baseItemState.petName || '')
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
     * Render the generic items filter checkboxes
     */
    _renderGenericFilters() {
        if (!window._featureFlags?.generic) return '';
        const showOwnedOnly = store.state.ui.column2?.showOwnedOnly ?? true;
        // Community checkbox only visible when generic is shown AND owned-only is off
        const showCommunityOption = this.showGenericItems && !showOwnedOnly;
        return `
            <div class="popup-generic-filters" style="display:flex;gap:12px;align-items:center;padding:4px 0;font-size:12px;color:var(--text-secondary)">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="checkbox" class="popup-show-generic-cb" ${this.showGenericItems ? 'checked' : ''} />
                    Show generic items
                </label>
                ${showCommunityOption ? `
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer">
                    <input type="checkbox" class="popup-show-community-cb" ${this.showCommunityItems ? 'checked' : ''} />
                    Show community
                </label>
                ` : ''}
            </div>
        `;
    }

    /**
     * Load community generic items into the popup item list
     */
    async _loadCommunityItemsIntoPopup() {
        try {
            const community = await api.getCommunityDefinitions();
            const communityItems = (community.items || []).filter(ci => ci.slot);
            const existingIds = new Set(this.items.map(i => i.generic_id || i.id));

            for (const ci of communityItems) {
                if (existingIds.has(ci.id)) continue;
                const giSlot = ci.slot || '';
                let matches = false;
                if (this.slot?.startsWith('tool')) matches = giSlot === 'tool';
                else if (this.slot?.startsWith('ring')) matches = giSlot === 'ring';
                else if (this.slot === 'consumable') matches = giSlot === 'consumable';
                else if (this.slot === 'pet') matches = giSlot === 'pet';
                else if (this.slot === 'input') matches = giSlot === 'input';
                else matches = giSlot === this.slot;

                if (!matches) continue;

                const isCrafted = ci.is_crafted || giSlot === 'consumable';
                const isConsumable = giSlot === 'consumable' || giSlot === 'input';
                let itemStats = ci.stats || {};
                let statsFine = null;
                if (isConsumable && ci.quality_stats) {
                    itemStats = ci.quality_stats['Normal'] || ci.stats || {};
                    statsFine = ci.quality_stats['Fine'] || null;
                }

                const _ciRawIcon = ci.icon || '⚡';
                const _ciIconIsPath = _ciRawIcon.includes('/') || _ciRawIcon.endsWith('.svg') || _ciRawIcon.endsWith('.png');

                this.items.push({
                    id: `generic::item::${ci.id}`,
                    name: ci.name,
                    slot: ci.slot,
                    keywords: ci.keywords || [],
                    rarity: isCrafted ? 'common' : (ci.rarity || 'common'),
                    icon: _ciIconIsPath ? '⚡' : _ciRawIcon,
                    icon_color: ci.icon_color,
                    icon_path: _ciIconIsPath ? _ciRawIcon : (ci.icon_path || null),
                    type: isConsumable ? 'consumable' : (isCrafted ? 'crafted_item' : 'item'),
                    is_generic: true,
                    _community: true,
                    stats: itemStats,
                    stats_fine: statsFine,
                    stats_by_quality: (!isConsumable && ci.quality_stats) ? ci.quality_stats : null,
                    quality_stats: ci.quality_stats || null,
                    gated_stats: ci.gated_stats || {},
                    requirements: (ci.gated_stats && ci.gated_stats.requirements) ? ci.gated_stats.requirements : [],
                    is_crafted: isCrafted,
                    has_fine: isConsumable && ci.quality_stats && !!ci.quality_stats['Fine'],
                    generic_id: ci.id,
                });
            }
            this.renderItemList();
        } catch (err) {
            console.warn('Failed to load community items for popup:', err);
        }
    }

    /**
     * Render the visibility toggles row — three checkboxes (Show non-owned,
     * Show hidden, Show non-applicable) that mirror the column-2 filter
     * checkboxes but live INSIDE the popup. Bonez565 bug 424b34f7
     * (2026-05-17): "Add options for showing not owned, hidden, or not
     * applicable when changing individual gear/consumable/pets (currently
     * requires backing out of crafting tree just to toggle)". Same store
     * keys as FilterCheckboxes so toggling here updates the column-2 row
     * automatically.
     *
     * sheer follow-up (2026-05-17): only render the inline toggles when
     * the popup is opened from a crafting-tree node. The normal column-2
     * popup is sibling to the column-2 FilterCheckboxes row, so duplicating
     * the toggles inside the popup there is redundant. We detect the
     * crafting-tree case via `this._treeNodeContext` (set by show() from
     * `options.treeNodeContext`) — non-null only when opened from a tree
     * slot.
     *
     * Each toggle is framed positively from the user's standpoint
     * ("show X"), with the underlying store key inverted where needed
     * (showOwnedOnly is true when we want to HIDE non-owned, so the
     * "Show non-owned" toggle is checked when showOwnedOnly is false).
     *
     * @returns {string} HTML for visibility filter toggles, or empty
     *                   string when not in a crafting-tree context.
     */
    _renderVisibilityToggles() {
        // Only show inline toggles for crafting-tree popups; the column-2
        // popup already has the same toggles rendered outside the popup.
        if (!this._treeNodeContext) {
            return '';
        }

        const showOwnedOnly = store.state.ui.column2?.showOwnedOnly ?? true;
        const showHiddenItems = store.state.ui.column2?.showHiddenItems ?? false;
        const showApplicableOnly = store.state.ui.column2?.showApplicableOnly ?? false;

        const showNonOwned = !showOwnedOnly;
        const showHidden = !!showHiddenItems;
        const showNonApplicable = !showApplicableOnly;

        return `
            <div class="popup-visibility-toggles" role="group" aria-label="Item visibility">
                <label class="popup-visibility-toggle" title="Include items you don't own">
                    <input type="checkbox" class="popup-toggle-non-owned" ${showNonOwned ? 'checked' : ''} />
                    <span>Show non-owned</span>
                </label>
                <label class="popup-visibility-toggle" title="Include items you have hidden in the gear tab">
                    <input type="checkbox" class="popup-toggle-hidden" ${showHidden ? 'checked' : ''} />
                    <span>Show hidden</span>
                </label>
                <label class="popup-visibility-toggle" title="Include items whose stats don't apply to this skill/location">
                    <input type="checkbox" class="popup-toggle-non-applicable" ${showNonApplicable ? 'checked' : ''} />
                    <span>Show N/A</span>
                </label>
            </div>
        `;
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

        // Generic items use emoji icon instead of SVG (unless icon_path is set)
        let iconHtml;
        if (item.is_generic) {
            if (item.icon_path) {
                iconHtml = `<img src="${item.icon_path}" alt="${item.name}" class="popup-item-icon rarity-${item.rarity || 'common'}" loading="lazy" onerror="this.style.display='none'">`;
            } else {
                const iconStyle = item.icon_color ? window.emojiTintStyle(item.icon_color) : '';
                iconHtml = `<span class="popup-item-icon-emoji rarity-${item.rarity || 'common'}">${window.tintedEmoji(item.icon || '⚡', item.icon_color)}</span>`;
            }
        } else if (item.type === 'pet') {
            const petState = this.getItemState(item.id);
            const petLevel = petState.level || 0;
            const petVariant = petState.variant || 'normal';
            const petIcon = getPetIconPath(item.name, petLevel, petVariant, item.max_level || 0);
            iconHtml = `<img src="${petIcon}" alt="${item.name}" class="popup-item-icon pet-icon-scaled" loading="lazy"
                         onerror="this.src='${item.icon_path || '/assets/icons/items/pet_eggs/unknown_egg.svg'}'">`;
        } else {
            iconHtml = `<img src="${iconPath}" alt="${item.name}" class="popup-item-icon ${fineClass}" loading="lazy">`;
        }

        // Don't show quality text - color is enough
        // For pets, show "CustomName (Species Level N)" or "Species (Level N)" if no custom name
        let displayName = item.name;
        if (item.type === 'pet') {
            const petState = this.getItemState(item.id);
            const petLevel = petState.level || 0;
            const petName = petState.petName || '';
            if (petName) {
                displayName = `${petName} (${item.name} Level ${petLevel})`;
            } else {
                displayName = `${item.name} (Level ${petLevel})`;
            }
        }

        // Determine if item is hidden (getItemState already merges overrides)
        const isHidden = !!itemState.hide;
        const dimClass = isHidden ? 'item-row-hidden' : '';
        const hiddenClass = isHidden ? 'is-hidden' : '';
        const eyeHtml = `<svg class="eye-icon eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-icon eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2 5 5.5 8 10 8s8-3 10-8"/><path d="M7 16l-1 2"/><path d="M12 18v2"/><path d="M17 16l1 2"/></svg>`;

        return `
            <div class="popup-item-row ${rarityClass} ${expandedClass} ${dimClass}" data-item-id="${item.id}">
                <div class="popup-item-main">
                    ${iconHtml}
                    <span class="popup-item-name">${item.is_generic ? '🔧 ' : ''}${displayName}${item.is_generic ? ' 🔧' : ''}</span>
                    <button class="eye-btn popup-eye-btn ${hiddenClass}" data-item-id="${item.id}" title="${isHidden ? 'Show in optimizer' : 'Hide from optimizer'}">${eyeHtml}</button>
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
        const isExpanded = this.expandedItemId === item.id;
        let stats = item.stats || {};
        // Track the resolved quality so we can pass the same value into
        // _renderSwapComparison below. For ring slots we honor the
        // "other ring slot already used X" rule via getAvailableRingQuality.
        let qualityForSwap = itemState.quality || 'Normal';

        // For crafted items, get stats for selected quality
        if (item.type === 'crafted_item' && item.stats_by_quality) {
            let quality;
            // For ring slots, use the available quality (accounting for other ring slot)
            if (item.slot === 'ring' && this.slot && this.slot.startsWith('ring')) {
                quality = this.getAvailableRingQuality(item, itemState);
            } else {
                quality = itemState.quality || 'Normal';
            }
            stats = item.stats_by_quality[quality] || {};
            qualityForSwap = quality;
        }

        // For pets, get stats for the user's selected level
        if (item.type === 'pet' && item.levels) {
            const petLevel = itemState.level || 0;
            const levelData = item.levels[String(petLevel)];
            stats = levelData?.stats || {};
        }

        const statsHtml = this.renderStatsFromObject(stats);

        // Render gated stats if present
        let gatedHtml = '';
        if (item.gated_stats) {
            gatedHtml = this.renderGatedStats(item.gated_stats, item);
        }

        // Render pet ability info if present
        let abilityHtml = '';
        if (item.type === 'pet' && item.levels) {
            const petLevel = itemState.level || 0;
            const levelData = item.levels[String(petLevel)];
            if (levelData && levelData.abilities) {
                for (const ability of levelData.abilities) {
                    abilityHtml += `<div class="popup-pet-ability">`;
                    abilityHtml += `<div class="popup-pet-ability-header">Ability: ${ability.name || 'Unknown'}</div>`;
                    if (ability.ability_stats && Object.keys(ability.ability_stats).length > 0) {
                        if (ability.duration) {
                            abilityHtml += `<div class="popup-pet-ability-duration">Lasts ${ability.duration} ${ability.duration_unit || 'actions'}</div>`;
                        }
                        abilityHtml += this.renderStatsFromObject(ability.ability_stats);
                    } else if (ability.effect) {
                        // Fallback to raw effect text, cleaned up
                        const cleanEffect = ability.effect
                            .replace(/\.(?=[A-Z+\-])/g, '.<br>')
                            .replace(/Effect lasts for:\s*(\d+)/g, `Effect lasts for $1 ${ability.duration_unit || 'actions'}`);
                        abilityHtml += `<div class="popup-pet-ability-effect">${cleanEffect}</div>`;
                    }
                    abilityHtml += `</div>`;
                }
            }
        }

        const wikiAndKeywordsHtml = this.renderPopupWikiAndKeywords(item);

        // Render the swap-metric-comparison ("Materials/Craft 0.909 ⟶ 0.800")
        // directly into the stats panel for the currently expanded item so
        // it survives popup re-renders triggered by store updates
        // (gearsets.alternatives, gearsets.current, gearsets.lockedSlots,
        // gearsets.lockedAlternatives — any of these refire _rerenderInPlace).
        // Without this, a re-render strips the div that the click handler
        // injected, and the user has to click expand twice to see it again.
        const swapMetricHtml = isExpanded
            ? this._renderSwapComparison(item, qualityForSwap)
            : '';

        // Mirror expansion state in the inline display style so re-renders
        // don't visually collapse a panel the user has open.
        const displayStyle = isExpanded ? '' : 'display: none;';

        return `
            <div class="popup-item-stats" style="${displayStyle}">
                ${swapMetricHtml}
                ${wikiAndKeywordsHtml}
                ${renderRequirementsRow(item.requirements)}
                ${statsHtml}
                ${gatedHtml}
                ${abilityHtml}
            </div>
        `;
    }

    /**
     * Render wiki link and keywords for the popup stats panel
     * @param {Object} item - Item to render wiki/keywords for
     * @returns {string} HTML for wiki link and keywords
     */
    renderPopupWikiAndKeywords(item) {
        const wikiName = item.name.replace(/ /g, '_');
        const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;

        const hiddenKeywords = ['shiny_ring', 'shiny_necklace', 'shiny_bracelet'];
        const visibleKeywords = (item.keywords || []).filter(kw => !hiddenKeywords.includes(kw.toLowerCase()));
        const keywordsHtml = visibleKeywords.map(kw => `<span class="keyword">${kw}</span>`).join('');

        const editBtnHtml = item.is_generic
            ? `<button class="btn-edit-generic-item optimize-btn" data-item-id="${item.generic_id || item.id}" style="font-size:11px;padding:3px 10px;margin-left:6px">🔧 Edit</button>`
            : '';

        return `
            <div class="popup-wiki-keywords">
                ${editBtnHtml}
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link" onclick="event.stopPropagation()">Wiki</a>
                <div class="keywords">${keywordsHtml}</div>
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
                    if (!statName || statName === 'undefined') continue;
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

        // Obtained-collectibles requirements (e.g. Collection ring: cumulative
        // tiers at 10/20/30/40/50/60 collectibles owned). Structure mirrors
        // achievement_points: {threshold: {skill: {location: {stat: value}}}}.
        // store.state.character.collectibles is the ARRAY of owned collectible
        // IDs, so the owned count is its length.
        if (gatedStats.total_collectibles) {
            const coll = store.state.character?.collectibles;
            const ownedCollectibles = Array.isArray(coll) ? coll.length : (coll || 0);

            for (const [threshold, tcStats] of Object.entries(gatedStats.total_collectibles)) {
                const tcThreshold = parseInt(threshold, 10);
                const requirement = `${threshold} Obtained Collectibles`;
                const isMet = ownedCollectibles >= tcThreshold;
                const unmetClass = isMet ? '' : 'gated-unmet';

                for (const [skill, locationStats] of Object.entries(tcStats)) {
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

        // Travel steps requirements
        if (gatedStats.travel_steps) {
            const customStats = store.state.ui?.custom_stats || {};
            const itemNameNormalized = item.name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');

            for (const [threshold, travelStats] of Object.entries(gatedStats.travel_steps)) {
                const customStatId = `${itemNameNormalized}_travel_steps_${threshold}`;
                const formattedThreshold = parseInt(threshold).toLocaleString();
                const requirement = `${formattedThreshold} Travel Steps`;
                const isMet = customStats[customStatId] === true;
                const unmetClass = isMet ? '' : 'gated-unmet';

                for (const [skill, locationStats] of Object.entries(travelStats)) {
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
            'bonus_experience_base', 'bonus_experience_add',
            'foraging_base_xp'
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

        // Eye button click in popup (toggle hide without removing from list)
        // MUST be bound BEFORE .popup-item-row to get priority
        this.$element.on('click', '.popup-eye-btn', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const itemId = $(e.currentTarget).data('item-id');
            const itemState = this.getItemState(itemId);
            const newHide = !itemState.hide;
            // Update store silently (no subscriber notifications — prevents popup re-render)
            store._setPath(`ui.user_overrides.items.${itemId}.hide`, newHide);
            store._syncToBackend(`ui.user_overrides.items.${itemId}.hide`, newHide);
            // Toggle classes — CSS handles crossfade + dim transitions
            const $btn = $(e.currentTarget);
            const $row = $btn.closest('.popup-item-row');
            $btn.toggleClass('is-hidden', newHide);
            $btn.attr('title', newHide ? 'Show in optimizer' : 'Hide from optimizer');
            $row.toggleClass('item-row-hidden', newHide);
        });

        // Item row click (select item)
        this.$element.on('click', '.popup-item-row', (e) => {
            // Don't select if clicking the expand button area, edit button, or eye button
            if ($(e.target).closest('.popup-expand-btn-area, .btn-edit-generic-item, .popup-eye-btn').length > 0) {
                return;
            }

            const itemId = $(e.currentTarget).data('item-id');
            this.selectItem(itemId);
        });

        // Expand button area click (show stats preview)
        this.$element.on('click', '.popup-expand-btn-area', (e) => {
            // Skip current item expand — handled by .popup-current-item-main handler
            if ($(e.currentTarget).hasClass('current-item-expand')) return;
            // Skip alternative item expand — handled by .popup-alt-item-main handler
            if ($(e.currentTarget).closest('.popup-alt-item').length > 0) return;
            if ($(e.currentTarget).closest('.popup-alternatives-header').length > 0) return;
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

                // Inject swap metric comparison if not already present
                if ($stats.find('.swap-metric-comparison').length === 0) {
                    const fullItem = this.items.find(i => i.id === itemId);
                    if (fullItem) {
                        const itemState = this.getItemState(itemId);
                        let quality = itemState.quality || 'Normal';
                        if (fullItem.type === 'crafted_item' && fullItem.slot === 'ring' && this.slot?.startsWith('ring')) {
                            quality = this.getAvailableRingQuality(fullItem, itemState);
                        }
                        const comparisonHtml = this._renderSwapComparison(fullItem, quality);
                        if (comparisonHtml) {
                            $stats.prepend(comparisonHtml);
                        }
                    }
                }

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
        // Tree-node context takes precedence: when this popup was opened from
        // a crafting-tree node slot, "currently equipped" reflects the
        // node's optimized gearset for that slot, NOT the live character's
        // gear. The treeNodeContext.equippedSlots map was decoded by the
        // caller (tree-node-card.js _renderGearPreview path).
        let currentSlotItem;
        if (this._treeNodeContext && this._treeNodeContext.equippedSlots) {
            // Priority: user's locked pick > optimizer's auto-pick.
            // After the user picks a Fine pie via the popup,
            // ctx.lockedSlots[slot] holds the new pick; the next time
            // they click the slot, the popup must show what THEY chose,
            // not the optimizer's stale optimized_consumable. Without
            // this priority order the popup said "Sweet carrot pie"
            // (optimizer auto-pick) even though the locked-slot row in
            // the gear preview correctly displayed "Dried fruit (Fine)"
            // — bug b788d037 follow-up: "Clicking the slot does NOT
            // have the updated item that I manually selected".
            //
            // The fallback to equippedSlots covers the no-lock case
            // (pure auto-pick from the optimizer). When the user has
            // explicitly clicked Unequip on this slot, the unequip
            // handler stores `lockedSlots[slot] = null` as the
            // force-empty sentinel — same shape tree-node-card.js
            // _renderGearPreview honors via `if (info === null) {
            // delete slots[slotName]; }`. The popup must honor it
            // too, otherwise reopening the slot falls back to the
            // optimizer's stale equippedTs and shows the unequipped
            // item as currently-equipped with an Unequip button (bug
            // 8d705f09). Detect the sentinel via key-presence + null
            // so an absent key (no lock) still falls through to
            // equippedTs.
            const lockedSlotsMap = this._treeNodeContext.lockedSlots || {};
            const hasLockEntry = Object.prototype.hasOwnProperty.call(
                lockedSlotsMap, this.slot,
            );
            const lockedTs = lockedSlotsMap[this.slot];
            const equippedTs = this._treeNodeContext.equippedSlots[this.slot];
            const isForceEmpty = hasLockEntry && lockedTs === null;
            const ts = isForceEmpty
                ? null
                : ((lockedTs && lockedTs.itemId !== undefined)
                    ? lockedTs
                    : (lockedTs || equippedTs));
            if (ts) {
                currentSlotItem = {
                    itemId: ts.id || ts.itemId || ts.uuid || null,
                    name: ts.name,
                    is_generic: ts.is_generic,
                    icon: ts.icon,
                    icon_color: ts.icon_color,
                    icon_path: ts.icon_path,
                    rarity: ts.rarity,
                    quality: ts.quality,
                    is_fine: ts.is_fine,
                    level: ts.level,
                    variant: ts.variant,
                    max_level: ts.max_level,
                    type: ts.type,
                };
            }
        } else {
            currentSlotItem = store.getActiveGearset()?.[this.slot];
        }

        // For input slot, check the callback's selected item instead of gearset
        if (this.slot === 'input' && !currentSlotItem) {
            const savedInputItems = store.state.column3?.selectedInputItems;
            if (savedInputItems) {
                // Find the selected input item for the current keyword filter
                for (const [idx, item] of Object.entries(savedInputItems)) {
                    if (item) {
                        currentSlotItem = { itemId: item.itemId || item.id, name: item.name, is_generic: item.is_generic, icon: item.icon, icon_color: item.icon_color, icon_path: item.icon_path, rarity: item.rarity, quality: item.quality, is_fine: item.is_fine };
                        break;
                    }
                }
            }
        }

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

        // Get rarity class - use the equipped quality, not the base item quality
        let rarityClass;
        if (fullItem.type === 'crafted_item' && currentSlotItem.quality) {
            const qualityToRarity = {
                'Eternal': 'ethereal', 'Perfect': 'legendary', 'Excellent': 'epic',
                'Great': 'rare', 'Good': 'uncommon', 'Normal': 'common'
            };
            const rarity = qualityToRarity[currentSlotItem.quality] || 'common';
            const rarityMap = {
                'common': 'rarity-common', 'uncommon': 'rarity-uncommon', 'rare': 'rarity-rare',
                'epic': 'rarity-epic', 'legendary': 'rarity-legendary', 'ethereal': 'rarity-ethereal'
            };
            rarityClass = rarityMap[rarity] || '';
        } else {
            rarityClass = this.getRarityClass(fullItem);
        }
        // For Fine consumables/materials, override rarityClass to
        // 'rarity-fine' so the popup row gets the cyan background that
        // matches column 2. Catalog stores ONE entry per BASE name with
        // rarity='common' — getRarityClass(fullItem) returns 'rarity-common'
        // for Fine variants by default. Bug b788d037 follow-up: popup
        // background didn't match the equipped slot's fine styling.
        if (currentSlotItem.is_fine
                || (currentSlotItem.name && currentSlotItem.name.includes('(Fine)'))) {
            rarityClass = 'rarity-fine';
        }
        const iconPath = fullItem.icon_path || '/assets/icons/items/equipment/placeholder.svg';

        // Render stats for the current item
        const itemState = this.getItemState(fullItem.id);
        let stats = fullItem.stats || {};

        // For crafted items, get stats for the equipped quality (from the slot item, not the base state)
        if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
            const quality = currentSlotItem.quality || itemState.quality || 'Normal';
            stats = fullItem.stats_by_quality[quality] || {};
        }

        // For pets, get stats for the user's selected level
        if (fullItem.type === 'pet' && fullItem.levels) {
            const petLevel = itemState.level || 0;
            const levelData = fullItem.levels[String(petLevel)];
            stats = levelData?.stats || {};
        }

        // For Fine consumables, use stats_fine instead of base stats.
        // Catalog stores ONE entry per BASE consumable name with both
        // stats (regular) and stats_fine (Fine) — the popup needs to
        // show whichever the equipped slot is. Bug b788d037: popup said
        // "Dried fruit (Fine)" name but listed 6% DA (regular base stats)
        // instead of 9% DA (stats_fine).
        if (fullItem.type === 'consumable'
                && fullItem.stats_fine
                && (currentSlotItem.is_fine
                    || (currentSlotItem.name && currentSlotItem.name.includes('(Fine)')))) {
            stats = fullItem.stats_fine;
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

        const wikiAndKeywordsHtml = this.renderPopupWikiAndKeywords(fullItem);

        // Handle generic item emoji icon (or icon_path if set)
        let currentIconHtml;
        if (currentSlotItem.is_generic && currentSlotItem.icon_path) {
            currentIconHtml = `<img src="${currentSlotItem.icon_path}" alt="${fullItem.name}" class="popup-item-icon rarity-${currentSlotItem.rarity || 'common'}" onerror="this.style.display='none'">`;
        } else if (currentSlotItem.is_generic && currentSlotItem.icon) {
            const iconStyle = currentSlotItem.icon_color ? window.emojiTintStyle(currentSlotItem.icon_color) : '';
            currentIconHtml = `<span class="popup-item-icon-emoji rarity-${currentSlotItem.rarity || 'common'}">${window.tintedEmoji(currentSlotItem.icon, currentSlotItem.icon_color)}</span>`;
        } else if (fullItem.type === 'pet') {
            const petLevel = itemState.level || 0;
            const petVariant = itemState.variant || 'normal';
            const petIcon = getPetIconPath(fullItem.name, petLevel, petVariant, fullItem.max_level || 0);
            currentIconHtml = `<img src="${petIcon}" alt="${fullItem.name}" class="popup-item-icon pet-icon-scaled"
                               onerror="this.src='${fullItem.icon_path || '/assets/icons/items/pet_eggs/unknown_egg.svg'}'">`;
        } else {
            currentIconHtml = `<img src="${iconPath}" alt="${fullItem.name}" class="popup-item-icon ${fineClass}">`;
        }

        return `
            <div class="popup-current-item-row ${rarityClass} ${expandedClass}">
                <div class="popup-current-item-main">
                    ${currentIconHtml}
                    <span class="popup-item-name">${
                        fullItem.type === 'pet'
                            ? (itemState.petName
                                ? `${itemState.petName} (${fullItem.name} Level ${itemState.level || 0})`
                                : `${fullItem.name} (Level ${itemState.level || 0})`)
                            // Bug 331d38da: catalog stores ONE consumable
                            // entry per BASE name (Fine variant shares the
                            // row via has_fine flag), so fullItem.name is
                            // always the base — "Dried fruit", never
                            // "Dried fruit (Fine)". Prefer the equipped
                            // slot's actual name when it differs (Fine
                            // suffix or other UI-set name override) so
                            // the popup shows what's really equipped.
                            : (currentSlotItem.name && currentSlotItem.name !== fullItem.name
                                ? currentSlotItem.name
                                : fullItem.name)
                    }</span>
                    <div class="popup-expand-btn-area current-item-expand">
                        <button class="popup-expand-btn">${arrowIcon}</button>
                    </div>
                    <button class="unequip-btn">Unequip</button>
                </div>
                <div class="popup-item-stats" style="display: ${this.currentItemExpanded ? 'block' : 'none'};">
                    ${wikiAndKeywordsHtml}
                    ${renderRequirementsRow(fullItem.requirements)}
                    ${statsHtml}
                    ${gatedHtml}
                </div>
            </div>
        `;
    }

    /**
     * Render the action buttons for the "Non-owned/Locked Upgrades" header:
     *   • "Find alternatives" — run the selected optimization for THIS slot to
     *     discover non-owned/locked upgrades and list them, WITHOUT changing any
     *     equipped gear (discovery only, no full re-optimize).
     *   • "Re-optimize" — the existing slot-scoped optimize that also equips the
     *     best result (class popup-run-optimizer-btn, handler unchanged).
     * Main-page popup only: the crafting-tree-node context resolves alternatives
     * through its own gear_config.slot_alternatives path, so we render nothing
     * there to avoid wiring the live optimizer into a tree-node view.
     * @returns {string} HTML for the button row (empty string in tree context).
     */
    _renderAltActionButtons() {
        if (this._treeNodeContext) return '';
        const optimizing = window.optimizeButton?.isOptimizing;
        const dis = optimizing ? ' disabled' : '';
        // flex:1 1 0 splits the row ~50/50; min-width:max-content + nowrap lets a
        // button grow past its half so its full label always fits.
        const btnStyle = 'font-size:11px;padding:3px 10px;flex:1 1 0;min-width:max-content;white-space:nowrap;';
        const findLabel = optimizing
            ? '<span class="spinner">⏳</span> Finding…'
            : 'Find alternatives';
        const optLabel = optimizing
            ? '<span class="spinner">⏳</span> Optimizing...'
            : 'Re-optimize';
        return `
            <div class="popup-alt-actions" style="display:flex;gap:6px;width:100%;box-sizing:border-box;padding:1px 8px 8px 8px;">
                <button class="popup-find-alternatives-btn optimize-btn" title="Find non-owned/locked upgrades for this slot using your selected optimization — without changing your equipped gear" style="${btnStyle}"${dis}>${findLabel}</button>
                <button class="popup-run-optimizer-btn optimize-btn" title="Optimize only this slot (keeping all other slots locked) and equip the result" style="${btnStyle}"${dis}>${optLabel}</button>
            </div>
        `;
    }

    /**
     * Render the "Non-owned/Locked Upgrades" collapsible section.
     * Shows all non-owned items that improve this slot, ranked smallest→biggest improvement.
     * Also shows owned-but-locked items with their missing requirements.
     */
    renderAlternativeItem() {
        // Non-owned alternatives are always enabled for everyone

        // Skip for input/consumable/pet slots
        if (['input', 'consumable', 'pet'].includes(this.slot)) return '';

        // Tree-node context: when this popup is showing a crafting-tree
        // node's slot, the alternatives + lock pass come from the node's
        // gear_config.slot_alternatives, NOT the live character's
        // store.state.gearsets.alternatives. The tree-node-card.js click
        // handler attaches these as treeNodeContext.alternatives /
        // .lockedAlternatives on every popup open.
        const ctx = this._treeNodeContext;
        let alternatives, lockedAlternatives;
        if (ctx) {
            alternatives = ctx.alternatives || {};
            lockedAlternatives = ctx.lockedAlternatives || {};
        } else {
            const isSlot2Active = store.state.gearsets?.comparisonMode && store.state.gearsets?.activeGearsetSlot === 2;
            alternatives = isSlot2Active
                ? store.state.gearsets?.gearset2Alternatives
                : store.state.gearsets?.alternatives;
            lockedAlternatives = isSlot2Active
                ? store.state.gearsets?.gearset2LockedAlternatives
                : store.state.gearsets?.lockedAlternatives;
        }

        // 2026-06-05 (jwbail): while the stats-report slot-alternatives
        // fetch is in flight, treeNodeContext.alternatives is still {} —
        // without this guard the section rendered "No better alternatives"
        // prematurely, then flipped to the list a second later. Show a
        // loading affordance until the fetch resolves (the stats-report
        // page clears alternativesLoading + re-renders on resolve).
        if (ctx && ctx.alternativesLoading) {
            return `
                <div class="popup-alternatives-section">
                    <div class="popup-alternatives-header" style="cursor: default;">
                        <span class="popup-alternatives-label">Non-owned/Locked Upgrades</span>
                        <span class="popup-alternatives-hint"><span class="spinner">⏳</span> Finding upgrades…</span>
                    </div>
                </div>
            `;
        }

        // No alternatives data at all — show buttons to find/optimize
        if (!alternatives && !lockedAlternatives) {
            return `
                <div class="popup-alternatives-section">
                    <div class="popup-alternatives-header" style="cursor: default;">
                        <span class="popup-alternatives-label">Non-owned/Locked Upgrades</span>
                    </div>
                    ${this._renderAltActionButtons()}
                </div>
            `;
        }

        const slotAlts = alternatives?.[this.slot] || [];
        const slotLocked = lockedAlternatives?.[this.slot] || [];

        // 2026-06-29 (jwbail): defensive display-order sort. The backend now
        // returns alternatives smallest->biggest improvement, but rows whose
        // _slot_alternatives were STORED before that fix (50f40e4a) replay
        // the old reversed order from metrics_json, and re-running the goals
        // report is the only way to refresh them. Sort here by improvement
        // magnitude ascending so EVERY slot renders smallest->biggest
        // regardless of the stored order or the metric direction: maximize
        // metrics (XP/step) carry positive deltas, minimize metrics
        // (steps/item) carry negative deltas, and |delta| ascending collapses
        // both to "smallest improvement first". Sort the SOURCE arrays in
        // place (not a copy) so the expand/equip handlers — which index
        // ctx.alternatives[slot] / ctx.lockedAlternatives[slot] by
        // data-alt-group-idx — stay aligned with the rendered order.
        const _byImprovementAsc = (a, b) => {
            const da = Math.abs(a && a.delta != null ? a.delta : 0);
            const db = Math.abs(b && b.delta != null ? b.delta : 0);
            return da - db;
        };
        slotAlts.sort(_byImprovementAsc);
        slotLocked.sort(_byImprovementAsc);
        const totalCount = slotAlts.length + slotLocked.length;

        // Alternatives were computed but none found for this slot
        if (totalCount === 0) {
            return `
                <div class="popup-alternatives-section">
                    <div class="popup-alternatives-header" style="cursor: default;">
                        <span class="popup-alternatives-label">Non-owned/Locked Upgrades</span>
                        <span class="popup-alternatives-hint">No better alternatives</span>
                    </div>
                </div>
            `;
        }

        const expanded = this._alternativesExpanded || false;
        const arrowClass = expanded ? 'expanded' : '';
        const countBadge = `<span class="popup-alternatives-count">${totalCount}</span>`;

        // Build the list of non-owned alternative items
        const altItemsHtml = slotAlts.map((alt, idx) => {
            return this._renderAltItemRow(alt, idx, 'nonowned');
        }).join('');

        // Build the list of owned-but-locked alternative items
        const lockedItemsHtml = slotLocked.map((alt, idx) => {
            return this._renderAltItemRow(alt, idx, 'locked');
        }).join('');

        // Build subsections
        let listHtml = '';
        if (slotAlts.length > 0) {
            const subLabel = `<div class="popup-alt-subheader">Non-owned <span class="popup-alternatives-count">${slotAlts.length}</span></div>`;
            listHtml += subLabel + altItemsHtml;
        }
        if (slotLocked.length > 0) {
            listHtml += `<div class="popup-alt-subheader locked-subheader">Owned but locked <span class="popup-alternatives-count">${slotLocked.length}</span></div>`;
            listHtml += lockedItemsHtml;
        }

        return `
            <div class="popup-alternatives-section">
                <div class="popup-alternatives-header">
                    <span class="popup-alternatives-label">Non-owned/Locked Upgrades ${countBadge}</span>
                    <div class="popup-expand-btn-area alternatives-toggle-btn">
                        <button class="popup-expand-btn">
                            <span class="expand-arrow ${arrowClass}">▼</span>
                        </button>
                    </div>
                </div>
                <div class="popup-alternatives-list" style="display: ${expanded ? 'block' : 'none'};">
                    ${listHtml}
                </div>
            </div>
        `;
    }

    /**
     * Resolve the user's non-owned upgrade display mode. Reads the live
     * SettingsModal field when available (so a mid-session change applies),
     * else falls back to localStorage, defaulting to 'average'.
     * @returns {'average'|'percent'|'list'}
     */
    _nonOwnedDisplayMode() {
        const v = (window.settingsModal && window.settingsModal.nonOwnedUpgradeDisplay)
            || (() => { try { return localStorage.getItem('nonOwnedUpgradeDisplay'); } catch (_e) { return null; } })();
        return (v === 'percent' || v === 'list') ? v : 'average';
    }

    /**
     * Render a single alternative item row (shared between non-owned and locked).
     * @param {Object} alt - The alternative item data
     * @param {number} idx - Index within its group
     * @param {string} group - 'nonowned' or 'locked'
     */
    _renderAltItemRow(alt, idx, group) {
        const rarityClass = alt.rarity ? `rarity-${alt.rarity}` : '';
        let baseName = alt.name;
        const qualityMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
        if (qualityMatch) baseName = baseName.slice(0, qualityMatch.index);
        const iconName = baseName.toLowerCase().replace(/ /g, '_').replace(/[()]/g, '');
        const iconPath = `/assets/icons/items/equipment/${iconName}.svg`;

        const dataIdx = `${group}-${idx}`;
        const altExpanded = this._expandedAltIndex === dataIdx;
        const altArrowClass = altExpanded ? 'expanded' : '';

        // Show metric improvement inline. Display mode is user-selectable
        // (Settings → UI → "Non-owned upgrade display"):
        //   'average' (default) — old ⟶ new aggregate of all target drops
        //   'percent'           — that improvement as a single +/-X%
        //   'list'              — one line per individual target drop
        //                         (from alt.component_values); falls back to
        //                         the aggregate old ⟶ new when the backend
        //                         hasn't supplied per-component values (e.g.
        //                         single-item targets or older payloads).
        let improvementHtml = '';
        if (alt.new_value != null && alt.old_value != null) {
            let oldDisp = alt.old_value;
            let newDisp = alt.new_value;
            const _isTraveling = window.optimizeButton?.isTravelActivity?.();
            if (alt.primary_metric === 'materials_per_craft' && oldDisp && newDisp && !_isTraveling) {
                oldDisp = 1 / oldDisp;
                newDisp = 1 / newDisp;
            }
            if (alt.primary_metric === 'materials_for_target' && window.recipeInfoSection && !_isTraveling) {
                const recipeSection = window.recipeInfoSection;
                const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
                const odds = recipeSection.calculateCraftingOdds();
                const targetOdd = odds.find(o => o.quality === targetQuality);
                if (targetOdd && targetOdd.avgMats != null) {
                    const liveOldValue = targetOdd.avgMats;
                    newDisp = liveOldValue * (1 + (alt.delta_pct || 0) / 100);
                    oldDisp = liveOldValue;
                }
            }

            const _parts = this._upgradeValueParts(alt, oldDisp, newDisp);
            if (_parts.isList) {
                improvementHtml = `<span class="alt-improvement alt-improvement-multiline" style="display:inline-block;text-align:right;line-height:1.35;">${_parts.html}</span>`;
            } else {
                improvementHtml = `<span class="alt-improvement">${_parts.html}</span>`;
            }
        }

        // Locked badge — removed, the "Owned but locked" subheader is sufficient
        const lockedBadge = '';

        return `
            <div class="popup-alt-item ${rarityClass} ${group === 'locked' ? 'alt-item-locked' : ''}" data-alt-idx="${dataIdx}" data-alt-group="${group}" data-alt-group-idx="${idx}">
                <div class="popup-alt-item-main">
                    <img src="${iconPath}" alt="${alt.name}" class="popup-item-icon"
                         onerror="this.style.display='none'">
                    <span class="popup-item-name">${alt.name}</span>
                    ${improvementHtml}
                    <div class="popup-expand-btn-area alt-expand-btn-area">
                        <button class="popup-expand-btn"><span class="expand-arrow ${altArrowClass}">▼</span></button>
                    </div>
                </div>
                <div class="popup-alt-item-details" style="display: none;"></div>
            </div>
        `;
    }

    /**
     * Format a metric key into a readable name.
     * @param {string} key - Base metric key (e.g. 'steps_per_reward_roll')
     * @param {string|null} target - Optional target like 'cat:chests' that
     *     changes the label suffix (e.g. "Steps/Chest" instead of
     *     "Steps/Reward").
     * @param {{x:string,y:string}|null} xy - Optional X-per-Y entry shape.
     *     When present, the label is derived directly from (x, y) using
     *     AXIS_LABELS so the user sees their configured ratio (e.g.
     *     "Total Crafts/Materials") rather than the underlying enum's
     *     legacy display name (e.g. "Materials/Craft" for the inverse).
     */
    _formatMetricName(key, target = null, xy = null) {
        const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
        const isTraveling = window.optimizeButton?.isTravelActivity?.();

        // X-per-Y derived label takes precedence when the entry is in
        // dict form. The legacy `names[]` table below maps the
        // resolved enum's metric_key to a display string, but with the
        // inverse-pair fallback (see _sortingEntryToLegacyKey) the
        // resolved key may be the INVERSE of what the user configured
        // (e.g. user selects "Total Crafts/Materials" → resolves to
        // materials_per_craft → would show "Materials/Craft"). Honor
        // the user's configured ratio instead.
        if (xy && xy.x && xy.y && AXIS_LABELS[xy.x] && AXIS_LABELS[xy.y]) {
            // Quality target: append the chosen quality so a (materials,
            // quality) entry shows "Materials/Perfect" not "Materials/Quality".
            if (xy.y === 'quality') {
                return `${AXIS_LABELS[xy.x]}/${targetQuality}`;
            }
            // target_item: keep the existing legacy-name handling below
            // (it already produces "Steps/Chest", "Steps/Reward", etc.
            // via target-aware formatters). Falling through is fine.
            if (xy.y !== 'target_item') {
                return `${AXIS_LABELS[xy.x]}/${AXIS_LABELS[xy.y]}`;
            }
        }

        // Travel reuses the recipe `steps_for_target` metric key for total
        // steps across the route. In the travel context, show a route-centric
        // label instead of the crafting "Total Steps for Perfect" wording.
        if (isTraveling) {
            if (key === 'steps_for_target' || key === 'total_steps') return 'Total Steps';
            if (key === 'avg_travel_steps') return 'Avg Steps/Route';
            if (key === 'steps_for_chest') return 'Avg Steps/Chest';
            if (key === 'primary_xp_per_step') return 'XP/Step';
        }

        // Target-specific activity SPR labels take precedence so the
        // user sees "Steps/Chest" instead of the generic "Steps/Reward"
        // when optimizing for chests, etc.
        if (key === 'steps_per_reward_roll' && target) {
            if (target === 'cat:chests' || target === 'primary_chest') return 'Steps/Chest';
            if (target === 'cat:collectibles' || target === 'collectible') return 'Steps/Collectible';
            if (target === 'cat:fine' || target === 'fine_item') return 'Steps/Fine';
            if (target === 'cat:gems') return 'Steps/Gem';
            if (target === 'cat:gems_fine') return 'Steps/Fine Gem';
            if (target === 'cat:coins') return 'Steps/Coins';
            if (target === 'cat:coins_no_chests') return 'Steps/Coins (no chests)';
            if (target === 'cat:normal_items' || target === 'raw_rewards') return 'Steps/Reward';
            // Any other cat:* target (cat:if:* item-filter tokens, etc.) →
            // humanize via the shared category-label map so we never leak a
            // raw "cat:..." enum into the upgrade label.
            if (target.startsWith('cat:')) {
                const human = window.optimizeButton?._getCategoryDisplayName?.(target);
                if (human && human !== target) return `Steps/${human}`;
            }
            // Specific item name target → show it directly
            return `Steps/${target}`;
        }

        const names = {
            'steps_per_reward_roll': 'Steps/Reward',
            'expected_steps_per_action': 'Steps/Action',
            'primary_xp_per_step': 'XP/Step',
            'total_xp_per_step': 'Total XP/Step',
            'reward_rolls_per_step': 'Rewards/Step',
            'materials_per_craft': 'Materials/Craft',
            'expected_steps_per_item': 'Steps/Craft',
            'materials_for_target': `Materials for ${targetQuality}`,
            'steps_for_target': `Total Steps for ${targetQuality}`,
            'total_crafts': `Crafts for ${targetQuality}`,
            'avg_travel_steps': 'Avg Travel Steps',
        };
        return names[key] || key.replace(/_/g, ' ');
    }

    /**
     * Format a metric value for display
     */
    _formatMetricValue(val) {
        if (val == null) return '?';
        if (Math.abs(val) >= 100) return formatFixed(val, 2);
        return formatFixed(val, 3);
    }

    /**
     * Format a steps/item value the same way the drops cards do:
     * 1 trimmed decimal under 100 steps, ceil to a whole number at or
     * above 100. Keeps the non-owned-upgrade per-item list visually
     * consistent with the drops column. Mirrors drops-section.js.
     */
    _formatStepsLikeDrops(val) {
        if (val == null || !isFinite(val)) return '?';
        return Math.abs(val) < 100
            ? formatFixed(val, 1, { trim: true })
            : Math.ceil(val).toLocaleString();
    }

    /**
     * Render the upgrade value for the current display mode, shared by the
     * collapsed alt row and the expanded "inner" detail so both stay in
     * sync. `oldDisp`/`newDisp` are the already-adjusted display values
     * (materials inversion / live-recompute applied by the caller).
     *
     * Returns { isList, html }:
     *   - average: "old ⟶ new"
     *   - percent: signed "+/-X%" (derived from the display values)
     *   - list:    one line per component (alt.component_values), same-step
     *              drops grouped with names joined by "/", drops-style
     *              rounding. Falls back to average when no component_values.
     */
    _upgradeValueParts(alt, oldDisp, newDisp) {
        const mode = this._nonOwnedDisplayMode();
        const comp = alt && alt.component_values;
        const hasComponents = comp && typeof comp === 'object'
            && Object.keys(comp).length > 0;

        if (mode === 'list' && hasComponents) {
            // Group components that share the same (old,new) DISPLAY values
            // onto one line, names joined by "/". Map preserves insertion
            // order (backend emits sorted).
            const groups = new Map();
            for (const [cname, vals] of Object.entries(comp)) {
                if (!vals || vals.old == null || vals.new == null) continue;
                const oldFmt = this._formatStepsLikeDrops(vals.old);
                const newFmt = this._formatStepsLikeDrops(vals.new);
                const key = `${oldFmt}\u0000${newFmt}`;
                let g = groups.get(key);
                if (!g) { g = { oldFmt, newFmt, names: [] }; groups.set(key, g); }
                g.names.push(cname);
            }
            const lines = Array.from(groups.values()).map(g =>
                `<span class="alt-improvement-line" style="display:block;">`
                + `<span class="alt-improvement-comp-name" style="opacity:0.8;margin-right:4px;">${g.names.join('/')}:</span>`
                + `${g.oldFmt} ⟶ ${g.newFmt}`
                + `</span>`
            ).join('');
            if (lines) return { isList: true, html: lines };
            // fall through to average if grouping produced nothing
        }

        if (mode === 'percent' && oldDisp != null && newDisp != null
                && Math.abs(oldDisp) > 1e-9) {
            const pct = ((newDisp - oldDisp) / Math.abs(oldDisp)) * 100;
            const rounded = Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1);
            return { isList: false, html: `${pct > 0 ? '+' : ''}${rounded}%` };
        }

        return {
            isList: false,
            html: `${this._formatMetricValue(oldDisp)} ⟶ ${this._formatMetricValue(newDisp)}`,
        };
    }

    // ========================================================================
    // OWNED ITEM SWAP METRIC COMPARISON
    // ========================================================================

    /**
     * Translate any sorting-entry shape into a {key, target} legacy pair.
     *
     * activitySorting is normalized into legacy [key, weight, target]
     * tuples by settings-modal.js. recipeSorting is the new X-per-Y dict
     * form (`{mode, x, y, quality, targetItem, ...}`) — the same one
     * defaultRecipeEntries() emits and the backend migration consumes.
     *
     * The `(mode, x, y) -> legacy_key` mapping mirrors LEGACY_KEY_MAP in
     * settings-modal.js _normalizeRecipeSortingAny (and
     * LEGACY_RECIPE_KEY_MIGRATION in optimization_settings_migration.py)
     * — keep them in sync.
     *
     * Returns null when the entry shape is unrecognized or maps to a
     * combination the popup can't compute (e.g. `xp/materials`).
     */
    _sortingEntryToLegacyKey(entry) {
        // Activity tuple [key, weight, target] form
        if (Array.isArray(entry)) {
            if (entry.length === 0) return null;
            return { key: entry[0], target: entry.length >= 3 ? (entry[2] || null) : null };
        }
        if (typeof entry === 'string') {
            return { key: entry, target: null };
        }
        if (!entry || typeof entry !== 'object') return null;

        if (entry.mode === 'budget') {
            return { key: 'steps_for_budget', target: null };
        }
        if (entry.mode !== 'ratio') return null;

        const x = entry.x;
        const y = entry.y;

        // X-per-Y resolution table. Mirrors _XY_TO_LEGACY_SORTING_NAMES
        // in util/walkscape_constants.py. Values are the resolved
        // (key, target) for that pair. Quality-target entries pass the
        // configured quality through `target` so the popup can recompute
        // for that quality via the composite key.
        const lookup = (px, py) => {
            if (px === 'materials' && py === 'quality') return { key: 'materials_for_target', target: entry.quality || null };
            if (px === 'total_crafts' && py === 'quality') return { key: 'total_crafts', target: entry.quality || null };
            if (px === 'expected_steps' && py === 'quality') return { key: 'steps_for_target', target: entry.quality || null };
            if (px === 'expected_steps' && py === 'craft') return { key: 'expected_steps_per_item', target: null };
            if (px === 'materials' && py === 'craft') return { key: 'materials_per_craft', target: null };
            if (px === 'xp' && py === 'step') return { key: 'primary_xp_per_step', target: null };
            return null;
        };

        // Axis aliases — X-only/Y-only axes that name the same physical
        // quantity. Mirrors _XY_AXIS_ALIASES in walkscape_constants.py.
        const axisAlias = {
            'total_crafts':   'craft',
            'craft':          'total_crafts',
            'expected_steps': 'step',
            'step':           'expected_steps',
        };

        // Resolution order: direct, inverse, alias-direct, alias-inverse.
        // The inverse fallback works because for ordering gearsets, X/Y
        // and Y/X always produce the same answer — A has more crafts/material
        // than B iff A has fewer materials/craft than B. The existing
        // metric's lower/higher-is-better direction on the inverse metric
        // is automatically the correct comparison for the original (x, y).
        let resolved = lookup(x, y);
        if (!resolved) resolved = lookup(y, x);
        if (!resolved) {
            const ax = axisAlias[x];
            const ay = axisAlias[y];
            if (ax !== undefined || ay !== undefined) {
                const cx = ax !== undefined ? ax : x;
                const cy = ay !== undefined ? ay : y;
                resolved = lookup(cx, cy);
                if (!resolved) resolved = lookup(cy, cx);
            }
        }
        return resolved;
    }

    /**
     * Compute the swap metric context for the current popup slot.
     * Caches the current primary metric value and the info needed to recompute
     * it with a different item in this slot.
     * Fully synchronous — reads activity/recipe from already-loaded info sections.
     */
    _ensureSwapMetricContext() {
        // Already computed for this slot opening
        if (this._swapMetricCtx && this._swapMetricCtx.slot === this.slot) {
            return this._swapMetricCtx;
        }

        // Skip for non-gear slots
        if (['input', 'consumable', 'pet', 'collectible'].includes(this.slot)) {
            this._swapMetricCtx = null;
            return null;
        }

        const combinedStats = window.combinedStatsSection;
        if (!combinedStats || !combinedStats.cachedStats || Object.keys(combinedStats.cachedStats).length === 0) {
            this._swapMetricCtx = null;
            return null;
        }

        // Get activity/recipe from the already-loaded info sections
        const activity = window.activityInfoSection?.activity || null;
        const recipe = window.recipeInfoSection?.recipe || null;

        if (!activity && !recipe) {
            this._swapMetricCtx = null;
            return null;
        }

        // Get the primary metric key (and target, when present)
        let primaryMetric;
        let primaryTarget = null;
        if (activity) {
            primaryMetric = 'steps_per_reward_roll';
        } else {
            primaryMetric = 'expected_steps_per_item';
        }

        // Traveling is a pseudo-activity — it has no reward rolls, no
        // collectible drops, no per-target SPR. The only sensible primary
        // metric is total route steps. Bypass the activity sorting lookup
        // which would otherwise pick up `steps_per_reward_roll` with a
        // target like `cat:collectibles` and mis-label the popup as
        // "Steps/Collectible". See bug report 1d271940.
        const isTravel = !!(activity && activity.is_travel);
        let primaryXY = null;  // The user's configured (x, y) — used by _formatMetricName for the label so the inverse-pair fallback doesn't mis-label e.g. (total_crafts, materials) as "Materials/Craft".
        if (isTravel) {
            primaryMetric = 'total_steps';
            primaryTarget = null;
        } else {
            // Try to get from cached optimization settings on the settings modal
            const settingsModal = window.settingsModal;
            if (settingsModal) {
                const order = activity ? settingsModal.activitySorting : settingsModal.recipeSorting;
                if (order && order.length > 0) {
                    // Quality-only metrics only apply to quality recipes.
                    // For non-quality recipes, skip them and use the first applicable metric.
                    const qualityOnlyMetrics = new Set(['materials_for_target', 'steps_for_target', 'total_crafts']);
                    const isQualityRecipe = !recipe || window.optimizeButton?.isQualityRecipe?.() !== false;

                    for (const entry of order) {
                        // Translate every supported sorting-entry shape into
                        // a {key, target} legacy pair. activitySorting is
                        // still legacy [key, weight, target] tuples; recipeSorting
                        // is the new X-per-Y dict form ({mode, x, y, quality,
                        // targetItem}). Without translating the dict form,
                        // `key` would be the entry object itself and the
                        // currentMetric lookup would always return undefined,
                        // so the swap-metric label silently disappeared on
                        // every recipe. See settings-modal.js
                        // _normalizeRecipeSortingAny (LEGACY_KEY_MAP) for the
                        // reverse direction.
                        const resolved = this._sortingEntryToLegacyKey(entry);
                        if (!resolved || !resolved.key) continue;
                        const { key, target } = resolved;
                        if (!isQualityRecipe && qualityOnlyMetrics.has(key)) continue;
                        primaryMetric = key;
                        primaryTarget = target;
                        // Remember the user's X-per-Y shape for label
                        // derivation. Only meaningful for the new dict
                        // form — legacy tuples / strings have no x/y.
                        if (entry && typeof entry === 'object' && !Array.isArray(entry) && entry.mode === 'ratio') {
                            primaryXY = { x: entry.x, y: entry.y };
                        }
                        break;
                    }
                }
            }
        }

        // Get the current combined stats (flat object, values in percentages)
        const baseStats = { ...combinedStats.cachedStats };

        // Get the current slot item's applied stat contribution
        const currentSlotItem = store.getActiveGearset()?.[this.slot];
        let currentItemAppliedStats = {};
        if (currentSlotItem && currentSlotItem.itemId) {
            currentItemAppliedStats = this._getItemAppliedStats(currentSlotItem);
        }

        // Compute the current metric value — pass the target so the
        // composite key for it is populated on the returned metric dict.
        const currentMetric = this._computeMetricFromStats(baseStats, activity, recipe, primaryTarget);

        this._swapMetricCtx = {
            slot: this.slot,
            baseStats,
            currentItemAppliedStats,
            currentMetric,
            primaryMetric,
            primaryTarget,
            primaryXY,
            activity,
            recipe,
            isRecipe: !!recipe && !activity,
        };

        return this._swapMetricCtx;
    }

    /**
     * Get the "applied" stat contribution of an item in the current context.
     * Returns a flat object like {work_efficiency: 5.0, double_action: 3.0, ...}
     * Only includes stats that match the current skill/location context.
     */
    _getItemAppliedStats(slotItem) {
        const result = {};
        const catalog = api._catalogCache;
        if (!catalog) return result;

        const catalogItems = catalog.items || [];
        let fullItem = catalogItems.find(i => i.id === slotItem.itemId);

        // Handle generic items
        if (!fullItem && slotItem.is_generic) {
            const genericItems = store.state.genericItems || [];
            const genericId = (slotItem.itemId || '').replace('generic::item::', '');
            const gi = genericItems.find(g => g.id === genericId);
            if (gi) {
                fullItem = { stats: gi.stats || {}, stats_by_quality: gi.quality_stats || null, type: gi.is_crafted ? 'crafted_item' : 'item', gated_stats: gi.gated_stats || {} };
            }
        }

        if (!fullItem) return result;

        // Get the right stats (quality-aware)
        let itemStats = fullItem.stats || {};
        if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality) {
            const quality = slotItem.quality || 'Normal';
            const rarityToQuality = { 'common': 'Normal', 'uncommon': 'Good', 'rare': 'Great', 'epic': 'Excellent', 'legendary': 'Perfect', 'ethereal': 'Eternal' };
            const q = rarityToQuality[quality?.toLowerCase()] || quality;
            itemStats = fullItem.stats_by_quality[q] || itemStats;
        }

        // Get pet level stats
        if (fullItem.type === 'pet' && fullItem.levels) {
            const petState = this.getItemState(fullItem.id || slotItem.itemId);
            const petLevel = petState.level || slotItem.level || 0;
            const levelData = fullItem.levels[String(petLevel)];
            itemStats = levelData?.stats || {};
        }

        this._aggregateAppliedStats(result, itemStats);

        // Handle gated stats (AP, skill level, set pieces, etc.)
        if (fullItem.gated_stats) {
            this._aggregateGatedAppliedStats(result, fullItem.gated_stats, slotItem);
        }

        return result;
    }

    /**
     * Get the "applied" stat contribution of a catalog item (for candidate items).
     * @param {Object} catalogItem - Full catalog item object
     * @param {string} quality - Quality name for crafted items
     * @returns {Object} Flat applied stats
     */
    _getCatalogItemAppliedStats(catalogItem, quality) {
        const result = {};

        let itemStats = catalogItem.stats || {};
        if (catalogItem.type === 'crafted_item' && catalogItem.stats_by_quality) {
            itemStats = catalogItem.stats_by_quality[quality || 'Normal'] || itemStats;
        }

        if (catalogItem.type === 'pet' && catalogItem.levels) {
            const petState = this.getItemState(catalogItem.id);
            const petLevel = petState.level || 0;
            const levelData = catalogItem.levels[String(petLevel)];
            itemStats = levelData?.stats || {};
        }

        this._aggregateAppliedStats(result, itemStats);

        // Handle gated stats
        if (catalogItem.gated_stats) {
            this._aggregateGatedAppliedStats(result, catalogItem.gated_stats, null);
        }

        return result;
    }

    /**
     * Aggregate applied stats from a nested stats object into a flat result.
     * Uses the same skill/location matching as CombinedStatsSection.
     */
    _aggregateAppliedStats(result, itemStats) {
        if (!itemStats || typeof itemStats !== 'object') return;

        const combinedStats = window.combinedStatsSection;
        const activitySkill = combinedStats?.currentActivitySkill;
        const componentSkills = combinedStats?.currentActivityComponentSkills;
        const recipeSkill = combinedStats?.currentRecipeSkill;
        const currentLocation = combinedStats?.currentLocation;

        const SKILL_GROUPS = {
            'gathering': ['fishing', 'foraging', 'hunting', 'mining', 'woodcutting'],
            'artisan': ['carpentry', 'cooking', 'crafting', 'smithing', 'tailoring', 'trinketry'],
            'utility': ['agility', 'traveling'],
        };

        for (const [skill, locationStats] of Object.entries(itemStats)) {
            if (!locationStats || typeof locationStats !== 'object') continue;
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                if (!statsByLocation || typeof statsByLocation !== 'object') continue;

                const skillLower = skill.toLowerCase();
                const locationLower = location.toLowerCase();

                // Skill matching
                let skillMatches = skillLower === 'global';
                if (!skillMatches && activitySkill) {
                    const actSkillLower = activitySkill.toLowerCase();
                    skillMatches = (skillLower === actSkillLower);
                    if (!skillMatches && SKILL_GROUPS[skillLower]) {
                        skillMatches = SKILL_GROUPS[skillLower].includes(actSkillLower);
                    }
                    if (!skillMatches && componentSkills) {
                        skillMatches = componentSkills.some(cs => {
                            const csLower = cs.toLowerCase();
                            if (skillLower === csLower) return true;
                            if (SKILL_GROUPS[skillLower]) return SKILL_GROUPS[skillLower].includes(csLower);
                            return false;
                        });
                    }
                } else if (!skillMatches && recipeSkill) {
                    const recSkillLower = recipeSkill.toLowerCase();
                    skillMatches = (skillLower === recSkillLower);
                    if (!skillMatches && SKILL_GROUPS[skillLower]) {
                        skillMatches = SKILL_GROUPS[skillLower].includes(recSkillLower);
                    }
                }

                // Location matching
                let locationMatches = locationLower === 'global';
                if (!locationMatches && currentLocation) {
                    const currentLocations = Array.isArray(currentLocation) ? currentLocation : [currentLocation];
                    locationMatches = currentLocations.some(loc => locationLower === loc.toLowerCase());
                }

                if (skillMatches && locationMatches) {
                    for (const [statName, statValue] of Object.entries(statsByLocation)) {
                        if (!statName || statName === 'undefined') continue;
                        result[statName] = (result[statName] || 0) + statValue;
                    }
                }
            }
        }
    }

    /**
     * Aggregate applied gated stats (AP, skill level, set pieces, activity completion, etc.)
     */
    _aggregateGatedAppliedStats(result, gatedStats, slotItem) {
        const character = store.state.character || {};

        // Achievement points
        if (gatedStats.achievement_points) {
            const overrideAP = store.state.ui?.user_overrides?.achievement_points;
            const characterAP = overrideAP !== undefined ? overrideAP : (character.achievement_points || 0);
            for (const [threshold, apStats] of Object.entries(gatedStats.achievement_points)) {
                if (characterAP >= parseInt(threshold, 10)) {
                    this._aggregateAppliedStats(result, apStats);
                }
            }
        }

        // Skill level
        if (gatedStats.skill_level) {
            for (const [gateSkill, thresholds] of Object.entries(gatedStats.skill_level)) {
                const charLevel = character.skills?.[gateSkill.toLowerCase()] || 0;
                for (const [threshold, skillStats] of Object.entries(thresholds)) {
                    if (charLevel >= parseInt(threshold, 10)) {
                        this._aggregateAppliedStats(result, skillStats);
                    }
                }
            }
        }

        // Total skill level
        if (gatedStats.total_skill_level) {
            const overrides = store.state.ui?.user_overrides || {};
            let totalLevel = 0;
            if (overrides.skills && Object.keys(overrides.skills).length > 0) {
                const baseSkills = character.skills || {};
                const allSkills = new Set([...Object.keys(baseSkills), ...Object.keys(overrides.skills)]);
                for (const skill of allSkills) {
                    totalLevel += (overrides.skills[skill] !== undefined ? overrides.skills[skill] : (baseSkills[skill] || 0));
                }
            } else {
                totalLevel = character.total_skill_level || Object.values(character.skills || {}).reduce((a, b) => a + b, 0);
            }
            for (const [threshold, tslStats] of Object.entries(gatedStats.total_skill_level)) {
                if (totalLevel >= parseInt(threshold, 10)) {
                    this._aggregateAppliedStats(result, tslStats);
                }
            }
        }

        // Set pieces — count equipped items with the keyword
        if (gatedStats.set_pieces) {
            const currentGear = store.getActiveGearset() || {};
            for (const [setName, counts] of Object.entries(gatedStats.set_pieces)) {
                let setCount = 0;
                for (const [checkSlot, checkItem] of Object.entries(currentGear)) {
                    if (checkItem && checkItem.keywords) {
                        if (checkItem.keywords.some(kw => kw.toLowerCase().includes(setName.toLowerCase()))) {
                            setCount++;
                        }
                    }
                }
                for (const [count, setStats] of Object.entries(counts)) {
                    if (setCount >= parseInt(count, 10)) {
                        this._aggregateAppliedStats(result, setStats);
                    }
                }
            }
        }

        // Activity completion
        if (gatedStats.activity_completion) {
            const customStats = store.state.ui?.custom_stats || {};
            const overrides = store.state.ui?.user_overrides || {};
            const allCustomStats = { ...customStats, ...(overrides.custom_stats || {}) };
            for (const [activityName, thresholds] of Object.entries(gatedStats.activity_completion)) {
                const customStatKey = `screwdriver_${activityName.toLowerCase().replace(/ /g, '_')}`;
                if (allCustomStats[customStatKey]) {
                    for (const [threshold, actStats] of Object.entries(thresholds)) {
                        this._aggregateAppliedStats(result, actStats);
                    }
                }
            }
        }

        // Travel steps
        if (gatedStats.travel_steps) {
            const customStats = store.state.ui?.custom_stats || {};
            const itemName = slotItem?.name || '';
            const itemNameNormalized = itemName.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
            for (const [threshold, travelStats] of Object.entries(gatedStats.travel_steps)) {
                const customStatId = `${itemNameNormalized}_travel_steps_${threshold}`;
                if (customStats[customStatId]) {
                    this._aggregateAppliedStats(result, travelStats);
                }
            }
        }
    }

    /**
     * Compute a metric value from a flat stats object and the current activity/recipe.
     * @param {Object} flatStats - Flat stats like {work_efficiency: 15.0, double_action: 5.0, ...}
     * @param {Object} activity - Activity object (or null)
     * @param {Object} recipe - Recipe object (or null)
     * @param {string|null} target - Optional target like 'cat:chests'. When given,
     *     the returned object also includes a composite key
     *     'steps_per_reward_roll::<target>' with the target-adjusted
     *     value (mirrors the backend scorer so the instant preview in
     *     the item selection popup matches what the full optimization
     *     will produce).
     * @returns {Object} Metric values keyed by metric name
     */
    _computeMetricFromStats(flatStats, activity, recipe, target = null) {
        const we = (flatStats.work_efficiency || 0) / 100;
        const da = (flatStats.double_action || 0) / 100;
        const dr = (flatStats.double_rewards || 0) / 100;
        const flat = flatStats.flat_steps || flatStats.steps_add || 0;
        const pct = (flatStats.steps_percent || flatStats.steps_pct || 0) / 100;

        // Traveling pseudo-activity: mirror the backend travel scorer
        // (optimize_travel_gearsets.calculate_route_steps + secondary_bonus).
        // The popup doesn't know the user's actual route, so we use a
        // synthetic BASE_DISTANCE that's large enough for a stable
        // ranking signal. What matters is that better stats produce
        // lower total_steps, matching how the backend ranks candidates.
        // DR and chest_finding are weighted equally in the tiebreaker
        // per user preference (bug report 1d271940).
        if (activity && activity.is_travel) {
            const maxEff = activity.max_efficiency || 0.60;
            const cappedWE = Math.min(we, maxEff);
            const BASE_DISTANCE = 1000; // arbitrary; only relative values matter
            const eff = 2.00 + cappedWE;
            let perAction = BASE_DISTANCE / eff / 10.0;
            perAction = perAction * (1.0 + pct) + flat;
            const stepsPerNode = Math.max(10, Math.ceil(perAction));
            const expectedPaidNodes = 10.0 / (1 + da);
            const totalSteps = Math.ceil(expectedPaidNodes * stepsPerNode);

            // Tiebreaker: DR and chest_finding weighted equally, with WE
            // and bonus_xp_percent as softer tiebreakers. Subtracted from
            // totalSteps so stronger secondary stats -> lower adjusted.
            const cf = (flatStats.chest_finding || 0) / 100;
            const bxp = (flatStats.bonus_xp_percent || 0) / 100;
            const secondaryBonus = dr * 2.0 + cf * 2.0 + we * 0.5 + bxp * 0.3;
            const adjusted = totalSteps - secondaryBonus;

            return {
                total_steps: adjusted,
                steps_for_target: adjusted,
                avg_travel_steps: adjusted,
                steps_for_chest: adjusted,
                primary_xp_per_step: 0.5,
            };
        }

        if (activity) {
            const baseSteps = activity.base_steps;
            const maxEfficiency = activity.max_efficiency;
            const baseXP = activity.base_xp;

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain.
            const cappedWE = Math.min(we, maxEfficiency);
            const totalEfficiency = 1 + cappedWE;
            const baseOverEff = baseSteps / totalEfficiency;
            const stepsWithPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(10, Math.ceil(stepsWithPct + flat));
            const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;
            const stepsPerRewardRoll = stepsPerSingleAction / ((1 + dr) * (1 + da));

            const bonusXPAdd = flatStats.bonus_xp_add || flatStats.bonus_experience_add || 0;
            const bonusXPPercent = (flatStats.bonus_xp_percent || flatStats.bonus_experience_percent || 0) / 100;
            const primaryXP = (baseXP + bonusXPAdd) * (1 + bonusXPPercent);
            const xpPerStep = primaryXP / expectedStepsPerAction;
            const rewardRollsPerStep = 1 / stepsPerRewardRoll;

            const result = {
                steps_per_reward_roll: stepsPerRewardRoll,
                expected_steps_per_action: expectedStepsPerAction,
                primary_xp_per_step: xpPerStep,
                reward_rolls_per_step: rewardRollsPerStep,
            };

            // Target-aware composite keys. Mirrors the backend scorer in
            // optimize_activity_gearsets._compute_spr_for_target so the
            // instant preview in the item selection popup matches the
            // value the real optimization will produce. The activity
            // drop table is NOT available here (we only have the generic
            // activity object from the catalog), so we can only model
            // the synthetic-rate targets (primary_chest at 0.4%,
            // fine_item, collectible). Specific-item chest rates would
            // require looking up drop_rates from the backend. Those
            // values will still be approximate, but they will at least
            // move in the right direction when DR / CF / FC / FMF
            // change, which is what the preview needs to rank items.
            if (target) {
                const cf = (flatStats.chest_finding || 0) / 100;
                const fmf = (flatStats.fine_material_finding || 0) / 100;
                const fc = (flatStats.find_collectibles || flatStats.collectible_finding || 0) / 100;
                let targetSpr = stepsPerRewardRoll;
                if (target === 'cat:chests' || target === 'primary_chest') {
                    const effectiveRate = 0.4 * (1 + cf) * (1 + dr);  // 0.4% synthetic chest base
                    targetSpr = effectiveRate > 0 ? (stepsPerRewardRoll * 100) / effectiveRate : 999999999;
                } else if (target === 'cat:fine' || target === 'fine_item') {
                    const fineRate = 0.01 * (1 + fmf);  // 1% base × FMF
                    targetSpr = fineRate > 0 ? (stepsPerRewardRoll * 100) / fineRate : 999999999;
                } else if (target === 'cat:collectibles' || target === 'collectible') {
                    const effectiveRate = 1 * (1 + fc);  // 1% base × FC
                    targetSpr = effectiveRate > 0 ? (stepsPerRewardRoll * 100) / effectiveRate : 999999999;
                }
                // Non-target / cat:normal_items / 'raw_rewards' → unchanged
                result[`steps_per_reward_roll::${target}`] = targetSpr;
            }

            return result;
        }

        if (recipe) {
            const baseSteps = recipe.base_steps;
            const maxEfficiency = recipe.max_efficiency;
            const baseXP = recipe.base_xp;
            const nmc = (flatStats.no_materials_consumed || 0) / 100;

            // Match the game's formula (per KamiTzayig reference): single ceil at the
            // END of the chain.
            const cappedWE = Math.min(we, maxEfficiency);
            const baseOverEff = baseSteps / (1 + cappedWE);
            const withPct = baseOverEff * (1 + pct);
            const stepsPerSingleAction = Math.max(Math.ceil(withPct + flat), 10);
            const expectedStepsPerAction = (1 / (1 + da)) * stepsPerSingleAction;
            const craftsPerMaterial = (1 + dr) / (1 - Math.min(nmc, 0.999));
            const materialsPerCraft = 1 / craftsPerMaterial;
            const rewardRollsPerCompletion = (1 + da) * (1 + dr);
            const stepsPerRewardRoll = stepsPerSingleAction / rewardRollsPerCompletion;

            const bonusXPAdd = flatStats.bonus_xp_add || flatStats.bonus_experience_add || 0;
            const bonusXPPercent = (flatStats.bonus_xp_percent || flatStats.bonus_experience_percent || 0) / 100;
            const calculatedXP = (baseXP + bonusXPAdd) * (1 + bonusXPPercent);
            const actionsPerCompletion = 1 + da;
            const xpPerStep = (calculatedXP * actionsPerCompletion) / stepsPerSingleAction;

            const result = {
                expected_steps_per_item: stepsPerSingleAction,
                expected_steps_per_action: expectedStepsPerAction,
                steps_per_reward_roll: stepsPerRewardRoll,
                materials_per_craft: materialsPerCraft,
                primary_xp_per_step: xpPerStep,
            };

            // Compute quality-based metrics (steps_for_target, materials_for_target, total_crafts)
            const recipeSection = window.recipeInfoSection;
            if (recipeSection && typeof recipeSection.calculateQualityWeights === 'function') {
                const qo = flatStats.quality_outcome || 0;
                const useFine = recipeSection.useFine && recipeSection.canUseFine();
                const hasEquipmentInput = recipe.has_equipment_input || false;
                const qualityResult = recipeSection.calculateQualityWeights(recipe.level, qo, useFine, hasEquipmentInput);
                const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
                const targetPct = qualityResult.percentages[targetQuality] || 0;
                if (targetPct > 0) {
                    const avgCrafts = 100.0 / targetPct;
                    // avgActions accounts for DR giving bonus items per action
                    const avgActions = avgCrafts / (1 + dr);
                    result.steps_for_target = avgActions * expectedStepsPerAction;
                    result.materials_for_target = avgCrafts / craftsPerMaterial;
                    result.total_crafts = avgCrafts;
                }
            }

            return result;
        }

        return {};
    }

    /**
     * Compute the swap metric comparison for a candidate item.
     * Returns {oldValue, newValue, metricKey, metricLabel} or null if not applicable.
     */
    _computeSwapComparison(catalogItem, quality) {
        const ctx = this._ensureSwapMetricContext();
        if (!ctx) return null;

        // Compute the candidate item's applied stats
        const candidateStats = this._getCatalogItemAppliedStats(catalogItem, quality);

        // Build new combined stats: base - currentItem + candidate
        const newStats = { ...ctx.baseStats };
        for (const [stat, value] of Object.entries(ctx.currentItemAppliedStats)) {
            newStats[stat] = (newStats[stat] || 0) - value;
        }
        for (const [stat, value] of Object.entries(candidateStats)) {
            newStats[stat] = (newStats[stat] || 0) + value;
        }

        // Compute the new metric (target-aware)
        const newMetric = this._computeMetricFromStats(newStats, ctx.activity, ctx.recipe, ctx.primaryTarget);

        // When a target is present, read from the composite key so the
        // preview values match the backend's per-target evaluation.
        // Otherwise (no target) fall back to the bare metric key.
        const lookupKey = ctx.primaryTarget
            ? `${ctx.primaryMetric}::${ctx.primaryTarget}`
            : ctx.primaryMetric;
        const oldVal = ctx.currentMetric[lookupKey] ?? ctx.currentMetric[ctx.primaryMetric];
        const newVal = newMetric[lookupKey] ?? newMetric[ctx.primaryMetric];

        if (oldVal == null || newVal == null) return null;

        // Tree-node context: the optimizer's primary_metric carries the
        // activity's drop_rates target (cat:chests, etc.) which doesn't
        // apply to a tree-node optimization aimed at a specific recipe
        // or activity output. Override 'Steps/<X>' or 'Avg Steps/<X>'
        // to 'Steps/Target Item' so the swap-comparison row reads
        // correctly. Same override site as renderAlternativeItem's
        // metric-label fix.
        let metricLabel = this._formatMetricName(ctx.primaryMetric, ctx.primaryTarget, ctx.primaryXY);
        if (this._treeNodeContext && /^(Avg )?Steps\//.test(metricLabel)) {
            metricLabel = 'Steps/Target Item';
        }

        return {
            oldValue: oldVal,
            newValue: newVal,
            metricKey: lookupKey,
            metricLabel,
        };
    }

    /**
     * Render the swap metric comparison HTML for an owned item.
     * @param {Object} catalogItem - Full catalog item
     * @param {string} quality - Quality name for crafted items
     * @returns {string} HTML string (empty if no comparison available)
     */
    _renderSwapComparison(catalogItem, quality) {
        // 2026-05-21: when the popup is opened from a stats-report row
        // (treeNodeContext.nodeId starts with "stats-report:"), the live
        // swap-metric calculation here pulls from the column-3 activity
        // info, which doesn't match the row's activity / gearset / primary
        // metric. The displayed comparison ends up showing wrong values
        // and a wrong label ("Steps/Target Item" instead of XP/step or
        // Steps/Chest depending on the row's category). Hide it for
        // stats-report rows — the asterisk + recalculated metric pill on
        // the row itself already conveys the new value cleanly.
        if (this._treeNodeContext
            && typeof this._treeNodeContext.nodeId === 'string'
            && this._treeNodeContext.nodeId.startsWith('stats-report:')) {
            return '';
        }
        const comparison = this._computeSwapComparison(catalogItem, quality);
        if (!comparison) return '';

        const { oldValue, newValue, metricLabel } = comparison;
        const oldDisp = this._formatMetricValue(oldValue);
        const newDisp = this._formatMetricValue(newValue);

        // Determine if this metric is "lower is better" or "higher is better"
        const lowerIsBetter = !comparison.metricKey.includes('xp_per_step') && !comparison.metricKey.includes('reward_rolls_per_step');

        let colorClass = 'swap-neutral';
        const diff = newValue - oldValue;
        const threshold = Math.abs(oldValue) * 0.0001; // tiny threshold for "same"
        if (Math.abs(diff) > threshold) {
            if (lowerIsBetter) {
                colorClass = diff < 0 ? 'swap-better' : 'swap-worse';
            } else {
                colorClass = diff > 0 ? 'swap-better' : 'swap-worse';
            }
        }

        return `<div class="swap-metric-comparison ${colorClass}">${metricLabel}: ${oldDisp} ⟶ ${newDisp}</div>`;
    }

    /**
     * Re-render while keeping the popup visible (used for live state updates).
     * Normal render() resets the overlay to display:none, which would close the popup.
     */
    _rerenderInPlace() {
        this.render();
        this.attachEvents();
        // Restore visibility — render() always resets overlay to display:none
        const $overlay = this.$element.find('.modal-overlay');
        $overlay.css('display', 'flex').addClass('show');
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

        // Build slot navigation arrows (mobile only)
        let navArrows = '';
        if (this.slot) {
            const navigable = this.getNavigableSlots();
            const curIdx = navigable.indexOf(this.slot);
            const hasPrev = curIdx > 0;
            const hasNext = curIdx >= 0 && curIdx < navigable.length - 1;

            navArrows = `
                <button class="slot-nav-arrow slot-nav-prev ${hasPrev ? '' : 'disabled'}" 
                        aria-label="Previous slot" ${hasPrev ? '' : 'disabled'}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                    </svg>
                </button>
                <button class="slot-nav-arrow slot-nav-next ${hasNext ? '' : 'disabled'}" 
                        aria-label="Next slot" ${hasNext ? '' : 'disabled'}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                    </svg>
                </button>
            `;
        }

        const html = `
            <div class="modal-overlay item-selection-modal-overlay" style="display: none;">
                ${navArrows}
                <div class="modal item-selection-popup">
                    <div class="modal-header">
                        ${this._renderLockIcon()}
                        <h2>${slotName}</h2>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="modal-content">
                        <div class="popup-top-section">
                            ${this.renderCurrentItem()}
                        </div>
                        <div class="popup-alternatives-wrapper">
                            ${this.renderAlternativeItem()}
                        </div>
                        <div class="popup-bottom-section">
                            <div class="popup-filters">
                                <div class="search-container">
                                    <input type="text" 
                                           class="popup-search" 
                                           placeholder="Search items..." 
                                           value="${this.searchText}">
                                </div>
                                ${this._renderVisibilityToggles()}
                                ${this.renderStatFilter()}
                            </div>
                            ${window._featureFlags?.generic ? `
                            ${this._renderGenericFilters()}
                            <div class="popup-create-generic"><button class="btn-create-generic-in-popup optimize-btn" style="font-size:12px;padding:4px 12px;width:auto">🔧 Create Generic Item</button></div>
                            ` : ''}
                            <div class="popup-item-list">
                                ${itemsHtml}
                            </div>
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
        this.$element.off('change', '.popup-toggle-non-owned');
        this.$element.off('change', '.popup-toggle-hidden');
        this.$element.off('change', '.popup-toggle-non-applicable');
        this.$element.off('click', '.unequip-btn');
        this.$element.off('click', '.popup-current-item-main');
        this.$element.off('click', '.slot-nav-prev');
        this.$element.off('click', '.slot-nav-next');
        this.$element.off('click', '.popup-eye-btn');
        this.$element.off('click', '.popup-item-row');
        this.$element.off('click', '.popup-expand-btn-area');
        this.$element.off('click', '.alternatives-toggle-btn');
        this.$element.off('click', '.alt-expand-btn-area');
        this.$element.off('click', '.alt-sources-btn');
        this.$element.off('click', '.alt-equip-btn');
        this.$element.off('click', '.popup-run-optimizer-btn');
        this.$element.off('click', '.popup-find-alternatives-btn');

        // Lock icon click handler
        this.$element.off('click', '.popup-lock-icon');
        this.$element.on('click', '.popup-lock-icon', (e) => {
            e.stopPropagation();
            // Tree-node context: lock state lives on the tree node, not the
            // global store. Toggle in the local context object so the popup
            // re-renders with the updated lock state, then hand the change
            // to the view layer via treeNodeContext.onSelect — that's what
            // commits to node.locked_slots and triggers the recalc/propagate.
            const ctx = this._treeNodeContext;
            if (ctx) {
                const equipped = ctx.equippedSlots && ctx.equippedSlots[this.slot];
                const itemId = equipped && (equipped.id || equipped.itemId || equipped.uuid) || null;
                const wasLocked = !!ctx.lockedSlots[this.slot];
                if (wasLocked) {
                    delete ctx.lockedSlots[this.slot];
                } else if (itemId) {
                    // Backend resolves locked_slots[slot] as a dict
                    // {itemId, quality}. Match the canonical shape used by
                    // state.js so optimize_worker.py:1559 can look up the
                    // pinned item identically to col-2 locks. Extra
                    // metadata is included so the slot tile overlay and
                    // popup "currently equipped" fallback can render the
                    // pinned item without a fresh catalog lookup —
                    // matters for pets where the displayed icon depends
                    // on level+variant (egg vs juvenile vs adult).
                    ctx.lockedSlots[this.slot] = {
                        itemId,
                        quality: equipped.quality || null,
                        level: equipped.level !== undefined ? equipped.level : undefined,
                        name: equipped.name || null,
                        icon_path: equipped.icon_path || null,
                        rarity: equipped.rarity || null,
                        variant: equipped.variant || null,
                        max_level: equipped.max_level !== undefined ? equipped.max_level : undefined,
                        type: equipped.type || null,
                        is_generic: !!equipped.is_generic,
                        is_fine: !!equipped.is_fine,
                    };
                } else {
                    // Pre-arm semantics for tree nodes: when nothing's
                    // equipped yet, flag intent to lock once an item lands.
                    this._pendingLock = !this._pendingLock;
                }
                if (typeof ctx.onSelect === 'function') {
                    ctx.onSelect({
                        type: 'lock',
                        slot: this.slot,
                        itemId,
                        locked: !wasLocked,
                        lockedSlots: { ...ctx.lockedSlots },
                    });
                }
                this._updateLockIcon();
                return;
            }
            const hasItem = !!store.getActiveGearset()?.[this.slot];
            const isLocked = !!store.getActiveLockedSlots()[this.slot];
            if (isLocked) {
                // Always allow unlocking, even if slot is now empty
                store.toggleSlotLock(this.slot);
            } else if (hasItem) {
                store.toggleSlotLock(this.slot);
            } else {
                // Pre-arm: next equipped item will be auto-locked
                this._pendingLock = !this._pendingLock;
                // Update icon to show pre-armed state
                this._updateLockIcon();
            }
        });

        // Tool slot navigation arrows
        this.$element.on('click', '.slot-nav-prev', (e) => {
            e.stopPropagation();
            this.navigateSlot(-1);
        });
        this.$element.on('click', '.slot-nav-next', (e) => {
            e.stopPropagation();
            this.navigateSlot(1);
        });

        // Keyboard left/right arrow keys to navigate slots (desktop + mobile)
        if (this._keydownSlotNav) {
            document.removeEventListener('keydown', this._keydownSlotNav);
        }
        this._keydownSlotNav = (e) => {
            if (!this.visible) return;
            // Don't intercept if user is typing in the search box
            if (e.target && e.target.classList.contains('popup-search')) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.navigateSlot(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.navigateSlot(1);
            }
        };
        document.addEventListener('keydown', this._keydownSlotNav);

        // Create Generic Item button in popup
        this.$element.on('click', '.btn-create-generic-in-popup', (e) => {
            e.stopPropagation();
            const slotForForm = this.slot?.replace(/\d+$/, '') || '';
            const equipSlot = this.slot; // full slot name with index (e.g. 'tool3')
            // Close the item selection popup first
            this.hide();
            import('./generic-item-form.js').then(mod => {
                mod.default.show({ slot: slotForForm, _autoEquipSlot: equipSlot });
            });
        });

        // Edit Generic Item button in popup stats
        this.$element.on('click', '.btn-edit-generic-item', (e) => {
            e.stopPropagation();
            const itemId = $(e.currentTarget).data('item-id');
            const genericId = String(itemId).replace('generic::item::', '');
            const items = store.state.genericItems || [];
            const item = items.find(i => i.id === genericId);
            if (item) {
                this.hide();
                import('./generic-item-form.js').then(mod => mod.default.show(item));
            }
        });

        // Swipe navigation within the popup (all slots)
        const overlay = this.$element.find('.item-selection-modal-overlay')[0];
        if (overlay) {
            // Remove old listeners if any
            if (this._swipeStartHandler) {
                overlay.removeEventListener('touchstart', this._swipeStartHandler);
                overlay.removeEventListener('touchend', this._swipeEndHandler);
            }
            this._swipeStartHandler = (e) => {
                this._slotSwipe.startX = e.touches[0].clientX;
                this._slotSwipe.startY = e.touches[0].clientY;
                this._slotSwipe.tracking = true;
            };
            this._swipeEndHandler = (e) => {
                if (!this._slotSwipe.tracking) return;
                this._slotSwipe.tracking = false;
                const touch = e.changedTouches[0];
                const dx = touch.clientX - this._slotSwipe.startX;
                const dy = touch.clientY - this._slotSwipe.startY;
                // Must be mostly horizontal
                if (Math.abs(dy) > 80) return;
                if (Math.abs(dx) < 60) return;
                if (dx < 0) {
                    this.navigateSlot(1);  // swipe left = next
                } else {
                    this.navigateSlot(-1); // swipe right = prev
                }
            };
            overlay.addEventListener('touchstart', this._swipeStartHandler, { passive: true });
            overlay.addEventListener('touchend', this._swipeEndHandler, { passive: true });
        }

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

        // Unequip button — use native DOM with capture to ensure it fires
        const unequipBtns = this.$element[0]?.querySelectorAll('.unequip-btn') || [];
        unequipBtns.forEach(btn => {
            // Remove old listener if any
            if (btn._unequipHandler) btn.removeEventListener('click', btn._unequipHandler, true);
            const slot = this.slot;
            const self = this;
            btn._unequipHandler = function (e) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                console.log('[UNEQUIP] clicked, slot:', slot);
                if (!slot) { console.error('[UNEQUIP] no slot'); return; }
                // For input slots, use the onUnequip callback if provided
                if (slot === 'input' && self._showOptions?.onUnequip) {
                    self._showOptions.onUnequip();
                } else if (self._treeNodeContext) {
                    // Tree-node mode: unequip = force this slot empty
                    // even if the optimizer's last pick included an
                    // item there. We can't surgically rewrite the
                    // packed gearset export, so we use a null
                    // sentinel in lockedSlots — the overlay path in
                    // tree-node-card._renderGearPreview treats null
                    // as "force empty" and the slot renders with the
                    // family icon. Backend overlay (crafting_tree.py
                    // _decode_gearset_stats) already skips null
                    // entries via `if not slot_info: continue`, so
                    // stats reflect the empty slot.
                    const ctx = self._treeNodeContext;
                    const newLocks = { ...(ctx.lockedSlots || {}) };
                    newLocks[slot] = null;
                    ctx.lockedSlots = newLocks;
                    if (typeof ctx.onSelect === 'function') {
                        ctx.onSelect({
                            type: 'unequip',
                            slot,
                            itemId: null,
                            locked: false,
                            lockedSlots: newLocks,
                        });
                    }
                } else {
                    store.updateGearSlot(slot, null);
                }
                api.showInfo(`Unequipped item from ${self.getSlotDisplayName(slot)}`);
                self.hide();
            };
            btn.addEventListener('click', btn._unequipHandler, true);
        });

        // Current item expand/collapse — click anywhere on the row except unequip
        this.$element.on('click', '.popup-current-item-main', (e) => {
            if ($(e.target).closest('.unequip-btn').length > 0) return;
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
                // User explicitly expanded — clear any auto-collapse class
                // so they see the full section immediately.
                this.$element.find('.popup-top-section').removeClass('scroll-collapsed');
                this._autoCollapseTopActive = false;
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

        // On mobile, when search input is focused (keyboard opens), slide popup to top
        // so filtered results aren't hidden behind the keyboard.
        // Stays up until the popup is closed (no slide-down on blur).
        this.$element.on('focus', '.popup-search', () => {
            if (window.innerWidth <= 768 && !this._keyboardSlid) {
                const $popup = this.$element.find('.item-selection-popup');
                const popupEl = $popup[0];
                if (popupEl) {
                    const rect = popupEl.getBoundingClientRect();
                    const offset = rect.top - 8;
                    if (offset > 0) {
                        $popup.css('transition', 'transform 0.3s ease');
                        $popup.css('transform', `scale(1) translateY(-${offset}px)`);
                        this._keyboardSlid = true;
                    }
                }
            }
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

        // Visibility toggles inside the popup (Bonez565 bug 424b34f7).
        // Updating the store keys triggers FilterCheckboxes to re-render in
        // column 2, so the column-2 row stays in sync with the popup row.
        // We re-render only the item list locally to avoid tearing down
        // the open popup or losing the search input focus.
        this.$element.on('change', '.popup-toggle-non-owned', (e) => {
            e.stopPropagation();
            // Toggle is checked === user wants non-owned visible === showOwnedOnly false
            store.update('ui.column2.showOwnedOnly', !e.target.checked);
            this.renderItemList();
        });
        this.$element.on('change', '.popup-toggle-hidden', (e) => {
            e.stopPropagation();
            store.update('ui.column2.showHiddenItems', !!e.target.checked);
            this.renderItemList();
        });
        this.$element.on('change', '.popup-toggle-non-applicable', (e) => {
            e.stopPropagation();
            // Toggle is checked === user wants non-applicable visible === showApplicableOnly false
            store.update('ui.column2.showApplicableOnly', !e.target.checked);
            this.renderItemList();
        });

        // Generic items checkbox
        this.$element.on('change', '.popup-show-generic-cb', (e) => {
            this.showGenericItems = e.target.checked;
            localStorage.setItem('popupShowGeneric', this.showGenericItems);
            // Re-render filters area (community checkbox visibility depends on this) + item list
            this.$element.find('.popup-generic-filters').replaceWith(this._renderGenericFilters());
            this.renderItemList();
        });

        // Community items checkbox
        this.$element.on('change', '.popup-show-community-cb', (e) => {
            this.showCommunityItems = e.target.checked;
            localStorage.setItem('popupShowCommunity', this.showCommunityItems);
            if (this.showCommunityItems) {
                // Load community items if not already loaded
                this._loadCommunityItemsIntoPopup();
            } else {
                // Remove community items from the list
                this.items = this.items.filter(i => !i._community);
                this.renderItemList();
            }
        });

        // Attach item row events
        this.attachItemRowEvents();

        // Run optimizer button in alternatives section (when no alternatives data yet)
        this.$element.on('click', '.popup-run-optimizer-btn', (e) => {
            e.stopPropagation();
            if (window.optimizeButton?.isOptimizing) return;

            const slot = this.slot;

            // Lock every currently-equipped slot except this one
            const isSlot2 = store.state.gearsets?.comparisonMode && store.state.gearsets?.activeGearsetSlot === 2;
            const locksKey = isSlot2 ? 'gearset2LockedSlots' : 'lockedSlots';
            const currentGear = store.getActiveGearset() || {};

            // Snapshot the original item in the target slot so we can restore it
            // if the optimizer decides the slot is best left empty (e.g. when the
            // current item is locked behind custom stats the user hasn't toggled).
            // Without this, "Optimize Slot & Equip" can silently delete the user's
            // gear without showing why — a surprising, destructive UX.
            const originalTargetItem = currentGear[slot]
                ? JSON.parse(JSON.stringify(currentGear[slot]))
                : null;

            const tempLocks = {};
            for (const [s, item] of Object.entries(currentGear)) {
                if (s === slot) continue;
                if (!item || !item.itemId) continue;
                if (['consumable', 'pet'].includes(s)) continue;
                tempLocks[s] = { itemId: item.itemId, quality: item.quality || null };
                if (item.level !== undefined) tempLocks[s].level = item.level;
            }

            // Route traveling to the travel optimizer — it understands routes,
            // keyword requirements (skis, light sources, diving gear), and can
            // compute both non-owned and locked alternatives per slot.
            const isTraveling = window.optimizeButton?.isTravelActivity?.();
            if (isTraveling) {
                window.optimizeButton?.optimizeTravel({
                    overrideLocks: tempLocks,
                    showNonOwned: true,
                    suppressResultUI: true,
                });
            } else {
                // Pass temp locks directly — no state mutation, no fake lock badges
                // Force show_non_owned_alternatives since this button is specifically for finding better unowned gear
                // suppressResultUI: the popup handles equipping and re-rendering itself
                window.optimizeButton?.optimize(isSlot2 ? 2 : null, tempLocks, { showNonOwned: true, suppressResultUI: true });
            }

            const $btn = $(e.currentTarget);
            $btn.prop('disabled', true).html('<span class="spinner">⏳</span> Optimizing...');
            const poll = setInterval(() => {
                if (!window.optimizeButton?.isOptimizing) {
                    clearInterval(poll);
                }
            }, 300);

            // When optimization completes, force-equip and re-render
            const onComplete = async (event) => {
                window.removeEventListener('optimization-complete', onComplete);

                // Force-hide the optimize-button's equip button and dismiss toasts
                // (this is a slot-only optimization — the popup handles everything)
                if (window.optimizeButton) {
                    window.optimizeButton.showEquipButton = false;
                    window.optimizeButton.optimizedGearsetId = null;
                    window.optimizeButton.render();
                }
                // Dismiss any optimization toasts
                $('.success-toast, .info-toast').remove();

                const gearset = event.detail?.gearset;
                if (gearset) {
                    // Always equip — user clicked "Optimize Slot & Equip"
                    try {
                        const freshGearSets = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');
                        store.state.gearsets.saved = {};
                        freshGearSets.forEach(gs => {
                            store.state.gearsets.saved[gs.id] = {
                                name: gs.name,
                                slots: gs.slots_json,
                                export_string: gs.export_string,
                                is_optimized: gs.is_optimized
                            };
                        });
                        store._notifySubscribers('gearsets.saved');
                        // Bug 8434d8e3: in comparison mode with slot 2 active,
                        // loadGearSet() writes the optimized gearset into
                        // state.gearsets.current (slot 1) — overwriting the
                        // user's left-hand comparison side instead of the
                        // slot they were actually editing. Route to the
                        // matching loader so the equip lands on the same
                        // slot the optimizer ran for. This mirrors the
                        // isSlot2 branch used a few lines below for the
                        // "no better item found" fallback.
                        if (isSlot2) {
                            await store.loadGearSetToSlot2(gearset.id);
                        } else {
                            await store.loadGearSet(gearset.id);
                        }

                        // If the optimizer decided the target slot should be empty
                        // (e.g. the user's current item is locked behind unmet
                        // custom stats), silently restoring it prevents accidental
                        // deletion. The user clicked "Optimize Slot & Equip"
                        // expecting an upgrade, not a delete.
                        //
                        // Write to state directly rather than store.updateGearSlot()
                        // — that helper clears alternatives/lockedAlternatives as a
                        // side effect, and we just loaded them from the optimized
                        // gearset. Wiping them would leave the popup with nothing
                        // to show after we restore the item.
                        const newGear = isSlot2
                            ? (store.state.gearsets?.gearset2 || {})
                            : (store.state.gearsets?.current || {});
                        const newTargetItem = newGear[slot];
                        if (originalTargetItem && (!newTargetItem || !newTargetItem.itemId)) {
                            console.log('[OptimizeSlot] Optimizer returned empty for slot', slot, '— restoring original item:', originalTargetItem.name);
                            if (isSlot2) {
                                store.state.gearsets.gearset2 = {
                                    ...(store.state.gearsets.gearset2 || {}),
                                    [slot]: originalTargetItem,
                                };
                                store._notifySubscribers(`gearsets.gearset2.${slot}`);
                                store._notifySubscribers('gearsets.gearset2');
                                if (typeof store._saveGearset2 === 'function') {
                                    store._saveGearset2();
                                }
                            } else {
                                store.state.gearsets.current = {
                                    ...(store.state.gearsets.current || {}),
                                    [slot]: originalTargetItem,
                                };
                                store._notifySubscribers(`gearsets.current.${slot}`);
                                store._notifySubscribers('gearsets.current');
                                if (typeof store._saveCurrentGear === 'function') {
                                    store._saveCurrentGear();
                                }
                            }
                            if (window.api?.showInfo) {
                                window.api.showInfo(
                                    `No better item found for this slot — kept ${originalTargetItem.name}.`,
                                    { duration: 5000 }
                                );
                            }
                        }
                    } catch (err) {
                        console.error('Failed to equip optimized gearset from popup:', err);
                    }
                }
                // Re-render popup with new gear + alternatives
                if (this.visible) {
                    const alternatives = store.state.gearsets?.alternatives;
                    const lockedAlts = store.state.gearsets?.lockedAlternatives;
                    if ((alternatives && alternatives[this.slot]?.length > 0) || (lockedAlts && lockedAlts[this.slot]?.length > 0)) {
                        this._alternativesExpanded = true;
                    }
                    this._rerenderInPlace();
                }
            };
            window.addEventListener('optimization-complete', onComplete);
        });

        // "Find alternatives" — run the selected optimization for this slot to
        // discover non-owned/locked upgrades and list them, WITHOUT equipping or
        // changing any gear. Mirrors the "Re-optimize" lock setup but, on
        // completion, only reads the computed alternatives off the result and
        // writes them to state (never loadGearSet).
        this.$element.on('click', '.popup-find-alternatives-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.optimizeButton?.isOptimizing) return;

            const slot = this.slot;
            const isSlot2 = store.state.gearsets?.comparisonMode && store.state.gearsets?.activeGearsetSlot === 2;
            const currentGear = store.getActiveGearset() || {};

            // Lock every currently-equipped slot except this one so the optimizer
            // only searches this slot and returns its non-owned/locked upgrades.
            const tempLocks = {};
            for (const [s, item] of Object.entries(currentGear)) {
                if (s === slot) continue;
                if (!item || !item.itemId) continue;
                if (['consumable', 'pet'].includes(s)) continue;
                tempLocks[s] = { itemId: item.itemId, quality: item.quality || null };
                if (item.level !== undefined) tempLocks[s].level = item.level;
            }

            const isTraveling = window.optimizeButton?.isTravelActivity?.();
            if (isTraveling) {
                window.optimizeButton?.optimizeTravel({
                    overrideLocks: tempLocks,
                    showNonOwned: true,
                    suppressResultUI: true,
                    findOnly: true,
                });
            } else {
                window.optimizeButton?.optimize(isSlot2 ? 2 : null, tempLocks, {
                    showNonOwned: true,
                    suppressResultUI: true,
                    findOnly: true,
                });
            }

            const $btn = $(e.currentTarget);
            $btn.prop('disabled', true).html('<span class="spinner">⏳</span> Finding…');

            const onComplete = (event) => {
                window.removeEventListener('optimization-complete', onComplete);

                // Discovery only: suppress the optimize-button's equip UI/toasts.
                if (window.optimizeButton) {
                    window.optimizeButton.showEquipButton = false;
                    window.optimizeButton.optimizedGearsetId = null;
                    window.optimizeButton.render();
                }
                $('.success-toast, .info-toast').remove();

                // Pull the freshly-computed alternatives off the result gearset
                // and write them to state WITHOUT equipping — current gear must
                // not change.
                const gs = event.detail?.gearset;
                const slots = (gs && (gs.slots_json || gs.slots)) || {};
                const alts = slots._alternatives || {};
                const lockedAlts = slots._locked_alternatives || {};
                if (isSlot2) {
                    store.state.gearsets.gearset2Alternatives = alts;
                    store.state.gearsets.gearset2LockedAlternatives = lockedAlts;
                    store._notifySubscribers('gearsets.gearset2');
                } else {
                    store.state.gearsets.alternatives = alts;
                    store.state.gearsets.lockedAlternatives = lockedAlts;
                    if (typeof store._syncToBackend === 'function') {
                        store._syncToBackend('ui.alternatives', alts);
                        store._syncToBackend('ui.locked_alternatives', lockedAlts);
                    }
                }
                store._notifySubscribers('gearsets.alternatives');
                store._notifySubscribers('gearsets.lockedAlternatives');

                // Auto-expand so the user immediately sees what was found.
                this._alternativesExpanded = true;
                if (this.visible) this._rerenderInPlace();
            };
            window.addEventListener('optimization-complete', onComplete);
        });

        // Alternatives section toggle — single handler on header only
        this.$element.on('click', '.popup-alternatives-header', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Debounce — prevent double-fire from bubbling
            if (this._altToggleDebounce) return;
            this._altToggleDebounce = true;
            setTimeout(() => { this._altToggleDebounce = false; }, 300);

            this._alternativesExpanded = !this._alternativesExpanded;
            const $list = this.$element.find('.popup-alternatives-list');
            const $arrow = this.$element.find('.alternatives-toggle-btn .expand-arrow');
            if (this._alternativesExpanded) {
                $arrow.addClass('expanded');
                $list.slideDown(200);
                // User explicitly expanded — clear any auto-collapse class
                // so they see the full section immediately.
                $list.removeClass('scroll-collapsed');
                this._autoCollapseAltActive = false;
            } else {
                $arrow.removeClass('expanded');
                $list.slideUp(200);
            }
        });

        // Alternative item expand/collapse with animation
        this.$element.on('click', '.popup-alt-item-main', (e) => {
            e.stopPropagation();
            // Don't toggle if clicking action links (wiki, sources, equip)
            if ($(e.target).closest('.alt-action-links, .alt-sources-container, .popup-alt-item-details').length > 0) return;
            // Debounce to prevent double-fire
            if (this._altItemDebounce) return;
            this._altItemDebounce = true;
            setTimeout(() => { this._altItemDebounce = false; }, 300);
            const $altItem = $(e.target).closest('.popup-alt-item');
            const idx = $altItem.data('alt-idx');  // String like "nonowned-0" or "locked-1"
            const group = $altItem.data('alt-group');  // "nonowned" or "locked"
            const groupIdx = parseInt($altItem.data('alt-group-idx'), 10);
            const wasExpanded = this._expandedAltIndex === idx;

            // Collapse previously expanded item
            if (this._expandedAltIndex !== null && this._expandedAltIndex !== idx) {
                const $prev = this.$element.find(`.popup-alt-item[data-alt-idx="${this._expandedAltIndex}"]`);
                $prev.find('.popup-alt-item-details').slideUp(150);
                $prev.find('.alt-expand-btn-area .expand-arrow').removeClass('expanded');
            }

            if (wasExpanded) {
                // Collapse current
                this._expandedAltIndex = null;
                $altItem.find('.popup-alt-item-details').slideUp(150);
                $altItem.find('.alt-expand-btn-area .expand-arrow').removeClass('expanded');
            } else {
                // Expand — render details into the placeholder div
                this._expandedAltIndex = idx;
                $altItem.find('.alt-expand-btn-area .expand-arrow').addClass('expanded');

                const _isSlot2Active = store.state.gearsets?.comparisonMode && store.state.gearsets?.activeGearsetSlot === 2;
                let alt;
                // Tree-node context: when this popup is showing a
                // crafting-tree node's slot, the alternatives data
                // lives on _treeNodeContext (attached by tree-node-card.js
                // ~L2144), NOT on store.state.gearsets. The render path
                // (renderAlternativeItem ~L2585) already checks ctx
                // first; the expand path must use the SAME source so
                // clicking an item resolves to the correct entry. Without
                // this, ctx-popups always read undefined from store and
                // silently early-returned at `if (!alt) return;` —
                // user reported "click does nothing, stats don't slide
                // down". Bug 331d38da follow-up #2.
                const ctx = this._treeNodeContext;
                if (ctx) {
                    if (group === 'locked') {
                        alt = ctx.lockedAlternatives?.[this.slot]?.[groupIdx];
                    } else {
                        alt = ctx.alternatives?.[this.slot]?.[groupIdx];
                    }
                } else if (group === 'locked') {
                    const _lockedAlts = _isSlot2Active ? store.state.gearsets?.gearset2LockedAlternatives : store.state.gearsets?.lockedAlternatives;
                    alt = _lockedAlts?.[this.slot]?.[groupIdx];
                } else {
                    const _alts = _isSlot2Active ? store.state.gearsets?.gearset2Alternatives : store.state.gearsets?.alternatives;
                    alt = _alts?.[this.slot]?.[groupIdx];
                }
                if (!alt) return;

                // Build details HTML
                let baseName = alt.name;
                const qMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
                if (qMatch) baseName = baseName.slice(0, qMatch.index);

                let metricHtml = '';
                if (alt.primary_metric) {
                    const targetQuality = window.optimizeButton?.targetQuality || 'Perfect';
                    // Split a composite key like "steps_per_reward_roll::cat:chests"
                    // into (baseKey, target). Non-composite keys pass through
                    // unchanged with target=null.
                    const sepIdx = alt.primary_metric.indexOf('::');
                    const baseMetric = sepIdx >= 0 ? alt.primary_metric.slice(0, sepIdx) : alt.primary_metric;
                    const metricTarget = sepIdx >= 0 ? alt.primary_metric.slice(sepIdx + 2) : null;

                    // Prefer the target-aware short label over the generic
                    // "Minimize Steps/Target" enum display.
                    const nicerLabel = this._formatMetricName(baseMetric, metricTarget);
                    let metricLabel = nicerLabel.replace('X Quality', targetQuality);
                    // Tree-node context: the optimizer ran with the
                    // tree's specific target item (e.g. Iron Sickle), but
                    // the primary_metric on each alt may carry an
                    // unrelated category target (cat:chests, etc.) from
                    // the activity's drop_rates. In that context the
                    // user wants "Steps/Target Item" — the tree target —
                    // not "Steps/Chest". Override after the lookup.
                    if (this._treeNodeContext && /^(Avg )?Steps\//.test(metricLabel)) {
                        metricLabel = 'Steps/Target Item';
                    }
                    // For materials_per_craft, show as inverse (crafts/mat) which is more intuitive.
                    // Skip this transform for travel (where this key should never appear,
                    // but in case of stale data we'd rather show the raw label).
                    let oldVal = alt.old_value;
                    let newVal = alt.new_value;
                    let displayLabel = metricLabel;
                    const _isTraveling = window.optimizeButton?.isTravelActivity?.();
                    if (baseMetric === 'materials_per_craft' && oldVal && newVal && !_isTraveling) {
                        oldVal = 1 / oldVal;
                        newVal = 1 / newVal;
                        displayLabel = 'Crafts/Mat';
                    }
                    // For materials_for_target, recompute live from the crafting odds table
                    if (baseMetric === 'materials_for_target' && window.recipeInfoSection) {
                        const odds = window.recipeInfoSection.calculateCraftingOdds();
                        const resolvedTarget = metricTarget || targetQuality;
                        const targetOdd = odds.find(o => o.quality === resolvedTarget);
                        if (targetOdd && targetOdd.avgMats != null) {
                            oldVal = targetOdd.avgMats;
                            newVal = oldVal * (1 + (alt.delta_pct || 0) / 100);
                            displayLabel = `Materials for ${resolvedTarget}`;
                        }
                    }
                    // Tree-node context: every alt is scored against the
                    // WHOLE tree (compute_slot_alternatives uses the
                    // optimizer's SORTING_PRIORITY which the worker
                    // rewrites to TOTAL_TREE_STEPS for recipe nodes
                    // with children). The natural label is "Steps for
                    // crafting tree" — uniform across all crafting
                    // metrics. The default labels ("Materials for
                    // Perfect", "Total Steps for Perfect") are
                    // misleading because (a) materials don't have
                    // quality tiers when the node output is a
                    // Material, and (b) the score reflects whole-tree
                    // cost, not local recipe cost. User report
                    // 331d38da follow-up: "the non-owned/locked items
                    // comparison is saying 'materials for perfect' on
                    // crafting bamboo planks, which cannot be perfect.
                    // It should just say 'Steps for crafting tree' or
                    // something since that's what we are doing for the
                    // whole tree optimization". Run AFTER the
                    // materials_per_craft / materials_for_target value
                    // transforms above so they still recompute the
                    // value correctly; only the label gets replaced.
                    //
                    // Followup (948d02f1): only override the label when
                    // the value is ACTUALLY in step units. The worker
                    // now rewrites MATERIALS / STEPS_PER_CRAFT to
                    // TOTAL_TREE_STEPS for tree nodes with children,
                    // so the alt's primary_metric should be
                    // total_tree_steps_for_target on tree nodes.
                    // Restrict the label override to that case (and
                    // total_steps which is also clearly steps) to
                    // avoid showing "Steps for crafting tree: 1.145"
                    // in the failure mode where the worker fell back
                    // to a non-tree metric (e.g. priority entry was
                    // not in the recipe-local rewrite set).
                    if (this._treeNodeContext && !_isTraveling) {
                        const _treeStepMetrics = new Set([
                            'total_tree_steps_for_target',
                            'steps_for_target',
                        ]);
                        if (_treeStepMetrics.has(baseMetric)) {
                            displayLabel = 'Steps for crafting tree';
                        }
                    }
                    const _parts = this._upgradeValueParts(alt, oldVal, newVal);
                    if (_parts.isList) {
                        metricHtml = `<div class="alt-metric-detail">${displayLabel}:`
                            + `<div class="alt-metric-detail-list" style="margin-top:2px;line-height:1.35;">${_parts.html}</div></div>`;
                    } else {
                        metricHtml = `<div class="alt-metric-detail">${displayLabel}: ${_parts.html}</div>`;
                    }
                }

                const wikiName = baseName.replace(/ /g, '_');
                const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;

                let statsHtml = '';
                const catalogItems = api._catalogCache?.items;
                let fullItem = catalogItems ? catalogItems.find(i => i.name === alt.name) : null;
                if (!fullItem) fullItem = this.items.find(i => i.name === alt.name);
                if (!fullItem && baseName !== alt.name) {
                    fullItem = catalogItems ? catalogItems.find(i => i.name === baseName) : null;
                    if (!fullItem) fullItem = this.items.find(i => i.name === baseName);
                }
                if (fullItem) {
                    let stats = fullItem.stats || {};
                    if (fullItem.type === 'crafted_item' && fullItem.stats_by_quality && alt.quality) {
                        stats = fullItem.stats_by_quality[alt.quality] || stats;
                    }
                    statsHtml = this.renderStatsFromObject(stats);
                    if (fullItem.gated_stats) {
                        statsHtml += this.renderGatedStats(fullItem.gated_stats, fullItem);
                    }
                }

                // Render requirement badges (e.g. "Agility 30/30")
                let requirementsHtml = '';
                if (fullItem && fullItem.requirements && fullItem.requirements.length > 0) {
                    requirementsHtml = renderRequirementsRow(fullItem.requirements);
                }

                // Render keywords
                let keywordsHtml = '';
                if (fullItem && fullItem.keywords && fullItem.keywords.length > 0) {
                    const hiddenKeywords = ['shiny_ring', 'shiny_necklace', 'shiny_bracelet'];
                    const visible = fullItem.keywords.filter(kw => !hiddenKeywords.includes(kw.toLowerCase()));
                    if (visible.length > 0) {
                        keywordsHtml = `<div class="keywords">${visible.map(kw => `<span class="keyword">${kw}</span>`).join('')}</div>`;
                    }
                }

                const detailsHtml = `
                    ${metricHtml}
                    <div class="alt-action-links">
                        <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link" onclick="event.stopPropagation()">Wiki</a>
                        <a href="#" class="wiki-link alt-sources-btn" data-alt-idx="${idx}" data-item-name="${baseName}" onclick="event.preventDefault();">Sources <span class="source-arrow">▼</span></a>
                        ${group !== 'locked' ? `<a href="#" class="wiki-link alt-equip-btn" data-alt-idx="${idx}" data-item-name="${alt.name}" data-item-uuid="${alt.uuid || ''}" data-item-quality="${alt.quality || ''}" onclick="event.preventDefault();">Equip</a>` : ''}
                        ${group !== 'locked' ? `<a href="#" class="wiki-link alt-equip-compare-btn" data-alt-idx="${idx}" data-item-name="${alt.name}" data-item-uuid="${alt.uuid || ''}" data-item-quality="${alt.quality || ''}" data-slot="${this.slot}" onclick="event.preventDefault();">Equip &amp; Compare</a>` : ''}
                    </div>
                    <div class="alt-sources-container" data-alt-idx="${idx}" style="display: none;"></div>
                    ${keywordsHtml}
                    ${requirementsHtml}
                    ${statsHtml}
                `;

                const $details = $altItem.find('.popup-alt-item-details');
                $details.html(detailsHtml).hide().slideDown(200);
            }
        });

        // Alternative sources button — same pattern as item-row.js
        this.$element.on('click', '.alt-sources-btn', async (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const idx = $btn.data('alt-idx');  // String like "nonowned-0" or "locked-1"
            const itemName = $btn.data('item-name');
            const $container = this.$element.find(`.alt-sources-container[data-alt-idx="${idx}"]`);
            const $arrow = $btn.find('.source-arrow');

            if ($container.is(':visible') && $container.children().length > 0) {
                $arrow.removeClass('expanded');
                $container.slideUp(150);
                return;
            }

            $arrow.addClass('expanded');
            $container.html('<div class="source-loading">Loading sources...</div>').slideDown(150);
            try {
                const data = await api.getItemSources();
                const lookupName = itemName.toLowerCase().trim();
                const sources = data.sources[lookupName] || [];

                if (sources.length === 0) {
                    $container.html('<div class="source-empty">No sources found</div>');
                    return;
                }

                // Reuse the exact same rendering as item-row.js _loadAndRenderSources
                const activityDrops = sources.filter(s => s.type === 'activity_drop');
                const itemFindingDrops = sources.filter(s => s.type === 'item_finding');
                const recipeDrops = sources.filter(s => s.type === 'recipe_drop');
                const recipeOutputs = sources.filter(s => s.type === 'recipe_output');
                const recipeInputs = sources.filter(s => s.type === 'recipe_input');
                const shopSources = sources.filter(s => s.type === 'shop');

                let html = '<div class="source-dropdown-list">';
                if (activityDrops.length > 0) {
                    html += '<div class="source-group-header">Dropped by</div>';
                    for (const src of activityDrops) {
                        const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                        const secondary = src.secondary ? ' (secondary)' : '';
                        html += `<div class="source-item" data-source-type="activity_drop" data-source-id="${src.id}" title="Click to select this activity"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-activity">Activity</span></div><div class="source-item-details"><span>${src.skill} Lv.${src.level}</span><span>${src.base_steps || '?'} steps</span><span>Drop: ${dropRate}${secondary}</span></div></div>`;
                    }
                }
                if (itemFindingDrops.length > 0) {
                    html += '<div class="source-group-header">Item Finding</div>';
                    for (const src of itemFindingDrops) {
                        const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                        html += `<div class="source-item source-item-no-click" title="Dropped via ${src.category} item finding gear"><div class="source-item-main"><span class="source-name">${src.category}</span><span class="source-badge source-badge-item-finding">Item Finding</span></div>${chance ? `<div class="source-item-details"><span>${chance}</span></div>` : ''}</div>`;
                    }
                }
                if (recipeDrops.length > 0) {
                    html += '<div class="source-group-header">Dropped while crafting</div>';
                    for (const src of recipeDrops) {
                        const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                        html += `<div class="source-item" data-source-type="recipe_drop" data-source-id="${src.id}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-recipe-drop">Recipe Drop</span></div><div class="source-item-details"><span>${src.skill} Lv.${src.level}</span><span>Drop: ${dropRate}</span></div></div>`;
                    }
                }
                if (recipeOutputs.length > 0) {
                    html += '<div class="source-group-header">Crafted by</div>';
                    for (const src of recipeOutputs) {
                        html += `<div class="source-item" data-source-type="recipe_output" data-source-id="${src.id}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-recipe">Recipe</span></div><div class="source-item-details"><span>${src.skill} Lv.${src.level}</span><span>${src.base_steps || '?'} steps</span></div></div>`;
                    }
                }
                if (recipeInputs.length > 0) {
                    html += '<div class="source-group-header">Used in</div>';
                    for (const src of recipeInputs) {
                        html += `<div class="source-item" data-source-type="recipe_input" data-source-id="${src.id}" title="Click to select this recipe"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-recipe-input">Input</span></div><div class="source-item-details"><span>${src.skill} Lv.${src.level}</span><span>${src.quantity || 1}x needed</span></div></div>`;
                    }
                }
                if (shopSources.length > 0) {
                    html += '<div class="source-group-header">Sold at</div>';
                    for (const src of shopSources) {
                        html += `<div class="source-item source-item-no-click"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-shop">Shop</span></div><div class="source-item-details"><span>${src.location || ''}</span><span>${src.price_display || ''}</span></div></div>`;
                    }
                }
                const chestSources = sources.filter(s => s.type === 'container_drop');
                if (chestSources.length > 0) {
                    html += '<div class="source-group-header">Found in chests</div>';
                    for (const src of chestSources) {
                        const rarityClass = src.rarity ? `rarity-${src.rarity}` : '';
                        const rarityLabel = src.rarity ? src.rarity.charAt(0).toUpperCase() + src.rarity.slice(1) : 'Main';
                        const rolls = src.rolls_per_chest || 4;
                        let chestPct = null;
                        if (src.drop_rate != null) {
                            chestPct = (1 - Math.pow(1 - src.drop_rate / 100, rolls)) * 100;
                        }
                        const dropRate = chestPct != null ? `${formatFixed(chestPct, 3)}%` : '?%';
                        const qty = src.quantity && src.quantity !== '1' ? `${src.quantity}x` : '';
                        html += `<div class="source-item source-item-no-click source-item-chest"><div class="source-item-main"><span class="source-name">${src.name}</span><span class="source-badge source-badge-chest ${rarityClass}">${rarityLabel}</span></div><div class="source-item-details"><span>Chance per chest: ${dropRate}</span>${qty ? `<span>${qty}</span>` : ''}</div></div>`;
                    }
                }
                html += '</div>';
                $container.html(html);
            } catch (err) {
                $container.html('<div class="source-empty">Failed to load sources</div>');
            }
        });

        // Alternative equip button — equip with correct quality
        this.$element.on('click', '.alt-equip-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const itemName = $btn.data('item-name');
            const itemUuid = $btn.data('item-uuid');
            const itemQuality = $btn.data('item-quality');

            // Find the item in the catalog (not just popup items)
            const catalogItems = api._catalogCache?.items;
            let targetItem = null;

            // For crafted items, find the base item by UUID then set quality
            if (itemUuid && catalogItems) {
                targetItem = catalogItems.find(i => i.uuid === itemUuid);
            }
            if (!targetItem && catalogItems) {
                // Try base name (strip quality)
                let baseName = itemName;
                const qMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
                if (qMatch) baseName = baseName.slice(0, qMatch.index);
                targetItem = catalogItems.find(i => i.name === baseName);
            }
            if (!targetItem) {
                targetItem = this.items.find(i => i.name === itemName);
            }

            if (targetItem) {
                // For crafted items with a known quality, equip directly with that quality
                // rather than going through selectItem (which re-derives quality from ownership state)
                if (targetItem.type === 'crafted_item' && itemQuality) {
                    const qualityToRarity = {
                        'Normal': 'common', 'Good': 'uncommon', 'Great': 'rare',
                        'Excellent': 'epic', 'Perfect': 'legendary', 'Eternal': 'ethereal'
                    };
                    const rarity = qualityToRarity[itemQuality] || 'common';
                    let itemStats = targetItem.stats || {};
                    if (targetItem.stats_by_quality) {
                        itemStats = targetItem.stats_by_quality[itemQuality] || itemStats;
                    }
                    const slotItem = {
                        itemId: targetItem.id,
                        uuid: targetItem.uuid || '',
                        name: targetItem.name,
                        icon_path: targetItem.icon_path,
                        rarity,
                        quality: itemQuality,
                        keywords: targetItem.keywords || [],
                        is_fine: targetItem.is_fine || false,
                        is_generic: targetItem.is_generic || false,
                        icon: targetItem.icon || null,
                        icon_color: targetItem.icon_color || null,
                        stats: itemStats,
                    };
                    // Tree-node context: equip into the tree node's
                    // slot, NOT column-2 (which is hidden behind the
                    // tree overlay). Routes through the same
                    // ctx.onSelect callback the manual slot-pick uses,
                    // which sets the lock + recalcs the tree. The
                    // popup hides so the user sees the tree update,
                    // but the tree itself stays open per user request:
                    // "Do not close the crafting tree here." Bug
                    // 331d38da follow-up #3.
                    const _ctx = this._treeNodeContext;
                    if (_ctx && typeof _ctx.onSelect === 'function') {
                        const newLockedSlots = { ..._ctx.lockedSlots, [this.slot]: slotItem };
                        _ctx.onSelect({
                            type: 'pick',
                            slot: this.slot,
                            slotItem,
                            locked: true,
                            lockedSlots: newLockedSlots,
                        });
                        api.showInfo(`Equipped ${targetItem.name} (${itemQuality}) to ${this.getSlotDisplayName(this.slot)} in the crafting tree`);
                        this.hide();
                        return;
                    }
                    store.updateGearSlot(this.slot, slotItem);
                    api.showInfo(`Equipped ${targetItem.name} (${itemQuality}) to ${this.getSlotDisplayName(this.slot)}`);
                    this.hide();
                } else {
                    // Non-crafted item path. Tree-node context still
                    // needs to route through ctx.onSelect — without
                    // this branch the regular selectItem() falls
                    // through to store.updateGearSlot.
                    const _ctx = this._treeNodeContext;
                    if (_ctx && typeof _ctx.onSelect === 'function') {
                        const slotItem = {
                            itemId: targetItem.id,
                            uuid: targetItem.uuid || targetItem.id,
                            name: targetItem.name,
                            icon_path: targetItem.icon_path,
                            rarity: targetItem.rarity || 'common',
                            quality: targetItem.quality || null,
                            keywords: targetItem.keywords || [],
                            is_fine: targetItem.is_fine || false,
                            is_generic: targetItem.is_generic || false,
                            icon: targetItem.icon || null,
                            icon_color: targetItem.icon_color || null,
                            stats: targetItem.stats || {},
                        };
                        const newLockedSlots = { ..._ctx.lockedSlots, [this.slot]: slotItem };
                        _ctx.onSelect({
                            type: 'pick',
                            slot: this.slot,
                            slotItem,
                            locked: true,
                            lockedSlots: newLockedSlots,
                        });
                        api.showInfo(`Equipped ${targetItem.name} to ${this.getSlotDisplayName(this.slot)} in the crafting tree`);
                        this.hide();
                        return;
                    }
                    this.selectItem(targetItem.id);
                }
            } else {
                api.showInfo(`${itemName} is not in your inventory. Check sources to find it.`);
            }
        });

        // "Equip & Compare" button — enable comparison, equip item to GS2 only
        this.$element.on('click', '.alt-equip-compare-btn', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const itemName = $btn.data('item-name');
            const itemUuid = $btn.data('item-uuid');
            const itemQuality = $btn.data('item-quality');
            const targetSlot = $btn.data('slot');

            // Resolve the catalog item (same logic as alt-equip-btn)
            const catalogItems = api._catalogCache?.items;
            let targetItem = null;
            if (itemUuid && catalogItems) {
                targetItem = catalogItems.find(i => i.uuid === itemUuid);
            }
            if (!targetItem && catalogItems) {
                let baseName = itemName;
                const qMatch = baseName.match(/\s*\((Normal|Good|Great|Excellent|Perfect|Eternal)\)$/);
                if (qMatch) baseName = baseName.slice(0, qMatch.index);
                targetItem = catalogItems.find(i => i.name === baseName);
            }
            if (!targetItem) {
                targetItem = this.items.find(i => i.name === itemName);
            }
            if (!targetItem) {
                api.showInfo(`${itemName} is not in your inventory. Check sources to find it.`);
                return;
            }

            // Build the slot item data
            let slotItem;
            if (targetItem.type === 'crafted_item' && itemQuality) {
                const qualityToRarity = {
                    'Normal': 'common', 'Good': 'uncommon', 'Great': 'rare',
                    'Excellent': 'epic', 'Perfect': 'legendary', 'Eternal': 'ethereal'
                };
                let itemStats = targetItem.stats || {};
                if (targetItem.stats_by_quality) {
                    itemStats = targetItem.stats_by_quality[itemQuality] || itemStats;
                }
                slotItem = {
                    itemId: targetItem.id,
                    uuid: targetItem.uuid || '',
                    name: targetItem.name,
                    icon_path: targetItem.icon_path,
                    rarity: qualityToRarity[itemQuality] || 'common',
                    quality: itemQuality,
                    keywords: targetItem.keywords || [],
                    is_fine: targetItem.is_fine || false,
                    is_generic: targetItem.is_generic || false,
                    icon: targetItem.icon || null,
                    icon_color: targetItem.icon_color || null,
                    stats: itemStats,
                };
            } else {
                slotItem = {
                    itemId: targetItem.id,
                    uuid: targetItem.uuid || targetItem.id,
                    name: targetItem.name,
                    icon_path: targetItem.icon_path,
                    rarity: targetItem.rarity || 'common',
                    quality: targetItem.quality || null,
                    keywords: targetItem.keywords || [],
                    is_fine: targetItem.is_fine || false,
                    is_generic: targetItem.is_generic || false,
                    icon: targetItem.icon || null,
                    icon_color: targetItem.icon_color || null,
                    stats: targetItem.stats || {},
                };
            }

            // Step 1: Enable comparison mode if not already on
            if (!store.state.gearsets.comparisonMode) {
                // Trigger the checkbox change which handles all the setup
                // (copies GS1 to GS2, initializes contexts, etc.)
                $('#comparison-mode-checkbox').prop('checked', true).trigger('change');
            }

            // Tree-node context: the user pressed "Equip & Compare" on
            // an alt item inside a crafting-tree node popup. The
            // requested behavior (per user spec, bug 331d38da #3) is:
            //   a. Equip the tree node's CURRENT optimized gearset to
            //      GS1 — same effect as pressing the tree card's
            //      Equip button (closes tree, loads gearset, updates
            //      column-3 selectors).
            //   b. Then enable the comparison view with the alt item
            //      swapped in for this slot in GS2 — so the user
            //      sees "tree's current gear" vs "tree's gear with
            //      this swap".
            //
            // Implementation: trigger the tree card's existing
            // Equip button click (which runs the full equip flow,
            // including async loadGearSetFromExport + tree close),
            // then setTimeout to defer the GS2 + comparison setup
            // until after the GS1 load resolves. The 150ms delay
            // covers the fetch+enrich path; if the timing ever
            // becomes flaky we should refactor _equipNodeGearset to
            // accept a {compareSlotItem, compareSlot} option and run
            // the GS2 write at the tail of its async chain.
            const _ctx = this._treeNodeContext;
            if (_ctx && _ctx.nodeId) {
                const $treeEquipBtn = $(`.tree-btn-equip[data-node-id="${_ctx.nodeId}"]`).first();
                if ($treeEquipBtn.length && !$treeEquipBtn.is('[disabled]')) {
                    // Capture before hide() clears _treeNodeContext
                    const _slotName = targetSlot;
                    const _slotItem = slotItem;
                    const _displayName = this.getSlotDisplayName(_slotName);
                    const _qualityLabel = itemQuality ? ` (${itemQuality})` : '';
                    const _itemDisplayName = targetItem.name;
                    // Hide the popup synchronously so the tree-close
                    // doesn't leave a zombie popup overlay.
                    this.hide();
                    // Fire the tree's Equip button — this synchronously
                    // closes the tree and kicks an async load.
                    $treeEquipBtn.trigger('click');
                    // After the async load settles, enable comparison
                    // (GS2 = current = tree's gearset) then overwrite
                    // GS2's slot with the alt item.
                    setTimeout(() => {
                        if (!store.state.gearsets.comparisonMode) {
                            $('#comparison-mode-checkbox').prop('checked', true).trigger('change');
                        }
                        store.state.gearsets.gearset2[_slotName] = _slotItem;
                        store.state.gearsets.gearset2Alternatives = null;
                        store.state.gearsets.gearset2LockedAlternatives = null;
                        store._notifySubscribers('gearsets.gearset2');
                        try { store._saveGearset2(); } catch (_) {}
                        api.showInfo(`Equipped tree gearset to GS1 and ${_itemDisplayName}${_qualityLabel} to ${_displayName} in GS2 for comparison`);
                    }, 150);
                    return;
                }
                // Fallback if the tree card or Equip button is gone
                // (shouldn't happen in practice — popup only opens from
                // the tree card). Fall through to the default flow so
                // the user at least gets GS2 written.
            }

            // Step 2: Write the item directly to GS2 for this slot only
            store.state.gearsets.gearset2[targetSlot] = slotItem;

            // Clear stale GS2 alternatives
            store.state.gearsets.gearset2Alternatives = null;
            store.state.gearsets.gearset2LockedAlternatives = null;

            store._notifySubscribers('gearsets.gearset2');
            store._saveGearset2();

            const displayName = this.getSlotDisplayName(targetSlot);
            const qualityLabel = itemQuality ? ` (${itemQuality})` : '';
            api.showInfo(`Equipped ${targetItem.name}${qualityLabel} to ${displayName} in GS2 for comparison`);
            this.hide();
        });

        // Source item click in alternatives (navigate to activity/recipe)
        this.$element.on('click', '.alt-sources-container .source-item:not(.source-item-no-click)', (e) => {
            const sourceType = $(e.currentTarget).data('source-type');
            const sourceId = $(e.currentTarget).data('source-id');
            // Tree-node context: column-3 is hidden behind the tree
            // overlay, so navigating without closing the tree leaves
            // the user staring at the same tree with no visible
            // change. Close the tree before hiding the popup so the
            // column-3 update is visible — same UX the user gets
            // when clicking a source from anywhere else in the app.
            const _isTreeCtx = !!this._treeNodeContext;
            const _closeTreeIfCtx = () => {
                if (_isTreeCtx) {
                    // Trigger the existing close-button click so the
                    // CraftingTreeView's onClose prop fires and the
                    // overlay tears down cleanly. Using a programmatic
                    // .click() preserves _saveTreeState() semantics
                    // (the close handler saves before unmounting).
                    $('.crafting-tree-close-btn').first().trigger('click');
                }
            };
            if (sourceType === 'activity_drop' && sourceId) {
                store.update('column3.selectedActivity', sourceId);
                store.update('column3.selectedRecipe', null);
                this.hide();
                _closeTreeIfCtx();
            } else if ((sourceType === 'recipe_output' || sourceType === 'recipe_drop' || sourceType === 'recipe_input') && sourceId) {
                store.update('column3.selectedRecipe', sourceId);
                store.update('column3.selectedActivity', null);
                this.hide();
                _closeTreeIfCtx();
            }
        });

        // Escape key to close
        $(document).off('keydown.item-selection-popup');
        $(document).on('keydown.item-selection-popup', (e) => {
            if (e.key === 'Escape' && this.visible) {
                this.hide();
            }
            // "L" key to toggle lock (skip if typing in search)
            if ((e.key === 'l' || e.key === 'L') && this.visible && !e.ctrlKey && !e.metaKey) {
                const tag = document.activeElement?.tagName?.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                e.preventDefault();
                const hasItem = !!store.getActiveGearset()?.[this.slot];
                if (hasItem) {
                    store.toggleSlotLock(this.slot);
                } else {
                    this._pendingLock = !this._pendingLock;
                    this._updateLockIcon();
                }
            }
        });

        // Auto-collapse top sections while scrolling the owned items list.
        // Feature flag in settings (default on). Shrinks .popup-top-section
        // and/or .popup-alternatives-list max-height so the owned list grows
        // upward, then restores after the user stops scrolling.
        this._attachAutoCollapseOnScroll();
    }

    /**
     * Attach scroll listener to .popup-item-list that auto-collapses the
     * current-item stats and non-owned upgrades sections after ~1s of
     * scrolling, then restores them 3s after scrolling stops.
     *
     * Respects the `popupAutoCollapseOnScroll` localStorage flag (default true).
     * Only collapses sections that are currently expanded.
     */
    _attachAutoCollapseOnScroll() {
        const $list = this.$element.find('.popup-item-list');
        if (!$list.length) {
            console.log('[ac] _attachAutoCollapseOnScroll: no .popup-item-list found, abort');
            return;
        }
        console.log('[ac] _attachAutoCollapseOnScroll: attaching listeners, list el =', $list[0]);
        console.log('[ac] localStorage state:', {
            popupAutoCollapseOnScroll: localStorage.getItem('popupAutoCollapseOnScroll'),
            popupAutoCollapseNoRestore: localStorage.getItem('popupAutoCollapseNoRestore'),
            popupAutoCollapseTopMin: localStorage.getItem('popupAutoCollapseTopMin'),
            popupAutoCollapseAltMin: localStorage.getItem('popupAutoCollapseAltMin'),
            popupItemListMin: localStorage.getItem('popupItemListMin'),
        });
        console.log('[ac] :root CSS vars:', {
            topMin: getComputedStyle(document.documentElement)
                .getPropertyValue('--popup-auto-collapse-top-min').trim(),
            altMin: getComputedStyle(document.documentElement)
                .getPropertyValue('--popup-auto-collapse-alt-min').trim(),
            listMin: getComputedStyle(document.documentElement)
                .getPropertyValue('--popup-item-list-min').trim(),
        });
        console.log('[ac] viewport:', { innerWidth: window.innerWidth, innerHeight: window.innerHeight });

        // Clean up previous listener and timers (re-render safety)
        if (this._autoCollapseScrollHandler && this._autoCollapseListEl) {
            this._autoCollapseListEl.removeEventListener('scroll', this._autoCollapseScrollHandler);
        }
        if (this._autoCollapseTouchStartHandler && this._autoCollapseListEl) {
            this._autoCollapseListEl.removeEventListener('touchstart', this._autoCollapseTouchStartHandler);
            this._autoCollapseListEl.removeEventListener('touchmove', this._autoCollapseTouchMoveHandler);
            this._autoCollapseListEl.removeEventListener('touchend', this._autoCollapseTouchEndHandler);
            this._autoCollapseListEl.removeEventListener('touchcancel', this._autoCollapseTouchEndHandler);
        }
        if (this._autoCollapseIdleTimer) {
            clearTimeout(this._autoCollapseIdleTimer);
            this._autoCollapseIdleTimer = null;
        }
        if (this._autoCollapseRestoreTimer) {
            clearTimeout(this._autoCollapseRestoreTimer);
            this._autoCollapseRestoreTimer = null;
        }
        // Reset collapsed state on any freshly-rendered DOM.
        // We track per-section so the user expanding a section mid-cycle
        // causes it to be collapsed on the next activation round.
        this._autoCollapseTopActive = false;
        this._autoCollapseAltActive = false;
        this._autoCollapseScrollStartedAt = 0;

        const listEl = $list[0];
        this._autoCollapseListEl = listEl;

        const SUSTAINED_SCROLL_MS = 1000; // require ~1s of continuous scroll before collapsing
        const SCROLL_IDLE_MS = 400;       // no scroll event for this long => scrolling stopped
        const RESTORE_DELAY_MS = 3000;    // wait 3s after scroll stops, then restore

        const isEnabled = () => localStorage.getItem('popupAutoCollapseOnScroll') !== 'false';
        const isNoRestore = () => localStorage.getItem('popupAutoCollapseNoRestore') === 'true';

        // Apply collapse classes to whichever sections are currently expanded
        // AND not already collapsed. Called as soon as sustained-scroll
        // threshold is reached AND on subsequent scroll events while still
        // scrolling — so a newly-expanded section will be caught mid-scroll.
        const applyCollapse = () => {
            const didSomething = (this.currentItemExpanded && !this._autoCollapseTopActive) ||
                (this._alternativesExpanded && !this._autoCollapseAltActive);
            if (didSomething) {
                const topEl = this.$element.find('.popup-top-section')[0];
                const altEl = this.$element.find('.popup-alternatives-list')[0];
                const topMinVar = getComputedStyle(document.documentElement)
                    .getPropertyValue('--popup-auto-collapse-top-min').trim();
                const altMinVar = getComputedStyle(document.documentElement)
                    .getPropertyValue('--popup-auto-collapse-alt-min').trim();
                console.log('[ac] applyCollapse', {
                    currentItemExpanded: this.currentItemExpanded,
                    topActive: this._autoCollapseTopActive,
                    altExpanded: this._alternativesExpanded,
                    altActive: this._autoCollapseAltActive,
                    topMinVar,
                    altMinVar,
                    topMaxHeightBefore: topEl ? getComputedStyle(topEl).maxHeight : null,
                    topOffsetHeightBefore: topEl ? topEl.offsetHeight : null,
                    altMaxHeightBefore: altEl ? getComputedStyle(altEl).maxHeight : null,
                    altOffsetHeightBefore: altEl ? altEl.offsetHeight : null,
                });
            }
            if (this.currentItemExpanded && !this._autoCollapseTopActive) {
                this.$element.find('.popup-top-section').addClass('scroll-collapsed');
                this._autoCollapseTopActive = true;
            }
            if (this._alternativesExpanded && !this._autoCollapseAltActive) {
                this.$element.find('.popup-alternatives-list').addClass('scroll-collapsed');
                this._autoCollapseAltActive = true;
            }
            if (didSomething) {
                // Log post-apply computed styles after a microtask so the
                // browser has a chance to apply the class.
                setTimeout(() => {
                    const topEl = this.$element.find('.popup-top-section')[0];
                    const altEl = this.$element.find('.popup-alternatives-list')[0];
                    console.log('[ac] applyCollapse post', {
                        topClass: topEl ? topEl.className : null,
                        topMaxHeightAfter: topEl ? getComputedStyle(topEl).maxHeight : null,
                        topOffsetHeightAfter: topEl ? topEl.offsetHeight : null,
                        altClass: altEl ? altEl.className : null,
                        altMaxHeightAfter: altEl ? getComputedStyle(altEl).maxHeight : null,
                        altOffsetHeightAfter: altEl ? altEl.offsetHeight : null,
                    });
                }, 50);
            }
        };

        const removeCollapse = () => {
            const didSomething = this._autoCollapseTopActive || this._autoCollapseAltActive;
            if (didSomething) {
                console.log('[ac] removeCollapse');
            }
            if (this._autoCollapseTopActive) {
                this.$element.find('.popup-top-section').removeClass('scroll-collapsed');
                this._autoCollapseTopActive = false;
            }
            if (this._autoCollapseAltActive) {
                this.$element.find('.popup-alternatives-list').removeClass('scroll-collapsed');
                this._autoCollapseAltActive = false;
            }
        };

        // Called ~150ms after the last scroll event. Scrolling has stopped.
        // - Reset the scroll-start timestamp so a future scroll burst has
        //   to sustain for 1s on its own.
        // - If any section is currently collapsed, schedule a restore
        //   (unless "do not expand back" is enabled).
        const onScrollIdle = () => {
            console.log('[ac] onScrollIdle fired, top/alt active:',
                this._autoCollapseTopActive, this._autoCollapseAltActive,
                'noRestore:', isNoRestore());
            this._autoCollapseIdleTimer = null;
            this._autoCollapseScrollStartedAt = 0;

            const anyCollapsed = this._autoCollapseTopActive || this._autoCollapseAltActive;
            if (!anyCollapsed) return;
            if (isNoRestore()) return;

            this._autoCollapseRestoreTimer = setTimeout(() => {
                this._autoCollapseRestoreTimer = null;
                removeCollapse();
            }, RESTORE_DELAY_MS);
        };

        // Throttle noisy per-event logs so the console isn't flooded during
        // a swipe — still plenty of data points to see timing.
        let _lastLogAt = 0;
        const maybeLog = (tag, extra) => {
            const now = Date.now();
            if (now - _lastLogAt < 200) return;
            _lastLogAt = now;
            console.log('[ac]', tag, extra || '');
        };

        this._autoCollapseScrollHandler = () => {
            if (!isEnabled()) {
                console.log('[ac] scroll: disabled via setting');
                removeCollapse();
                this._autoCollapseScrollStartedAt = 0;
                return;
            }
            // If nothing is expanded, no work to do.
            if (!this.currentItemExpanded && !this._alternativesExpanded) {
                maybeLog('scroll: nothing expanded, skipping');
                return;
            }

            const now = Date.now();

            // Any scroll activity cancels a pending restore — we're scrolling
            // again, don't restore yet.
            if (this._autoCollapseRestoreTimer) {
                clearTimeout(this._autoCollapseRestoreTimer);
                this._autoCollapseRestoreTimer = null;
            }

            // Start (or continue) the sustained-scroll timer. If this is
            // the first scroll event of a new burst, record the start time.
            if (!this._autoCollapseScrollStartedAt) {
                this._autoCollapseScrollStartedAt = now;
                console.log('[ac] scroll: sustained timer STARTED at', now);
            }

            const elapsed = now - this._autoCollapseScrollStartedAt;
            maybeLog('scroll event', {
                elapsed,
                touchActive: this._autoCollapseTouchActive,
                topActive: this._autoCollapseTopActive,
                altActive: this._autoCollapseAltActive,
            });

            // If the user has been scrolling for at least 1s continuously,
            // apply the collapse immediately on the current scroll event.
            if (elapsed >= SUSTAINED_SCROLL_MS) {
                applyCollapse();
            }

            // Reset the idle watchdog. If no scroll event arrives within
            // SCROLL_IDLE_MS, we consider scrolling stopped.
            // Skipped while a finger is actively on the list (touch-based
            // momentum scrolling can have sparse scroll events).
            if (this._autoCollapseIdleTimer) {
                clearTimeout(this._autoCollapseIdleTimer);
                this._autoCollapseIdleTimer = null;
            }
            if (!this._autoCollapseTouchActive) {
                this._autoCollapseIdleTimer = setTimeout(onScrollIdle, SCROLL_IDLE_MS);
            }
        };

        // Touch tracking so mobile momentum scrolling doesn't reset the
        // sustained-scroll timer between sparse scroll events. While a
        // finger is on the list, we treat scrolling as "active" regardless
        // of scroll-event timing.
        this._autoCollapseTouchActive = false;
        this._autoCollapseTouchStartHandler = () => {
            if (!isEnabled()) return;
            console.log('[ac] touchstart');
            this._autoCollapseTouchActive = true;
            // Start the sustained-scroll timer on first touch so a slow
            // finger drag counts toward the 1s threshold.
            if (!this._autoCollapseScrollStartedAt) {
                this._autoCollapseScrollStartedAt = Date.now();
            }
            // Cancel any pending idle/restore while finger is down.
            if (this._autoCollapseIdleTimer) {
                clearTimeout(this._autoCollapseIdleTimer);
                this._autoCollapseIdleTimer = null;
            }
            if (this._autoCollapseRestoreTimer) {
                clearTimeout(this._autoCollapseRestoreTimer);
                this._autoCollapseRestoreTimer = null;
            }
        };
        this._autoCollapseTouchMoveHandler = () => {
            if (!isEnabled()) return;
            if (!this.currentItemExpanded && !this._alternativesExpanded) return;
            const now = Date.now();
            const elapsed = this._autoCollapseScrollStartedAt ?
                now - this._autoCollapseScrollStartedAt : 0;
            maybeLog('touchmove', { elapsed });
            // If the finger has been moving for >= 1s, collapse now even if
            // the scroll event hasn't fired yet (mobile scroll events can be
            // throttled).
            if (this._autoCollapseScrollStartedAt && elapsed >= SUSTAINED_SCROLL_MS) {
                applyCollapse();
            }
        };
        this._autoCollapseTouchEndHandler = () => {
            console.log('[ac] touchend/touchcancel');
            this._autoCollapseTouchActive = false;
            // Kick off the idle watchdog so momentum scrolling can still
            // fire scroll events, but if there's no activity within
            // SCROLL_IDLE_MS we'll handle it as scroll-stopped.
            if (this._autoCollapseIdleTimer) {
                clearTimeout(this._autoCollapseIdleTimer);
            }
            this._autoCollapseIdleTimer = setTimeout(onScrollIdle, SCROLL_IDLE_MS);
        };

        listEl.addEventListener('scroll', this._autoCollapseScrollHandler, { passive: true });
        listEl.addEventListener('touchstart', this._autoCollapseTouchStartHandler, { passive: true });
        listEl.addEventListener('touchmove', this._autoCollapseTouchMoveHandler, { passive: true });
        listEl.addEventListener('touchend', this._autoCollapseTouchEndHandler, { passive: true });
        listEl.addEventListener('touchcancel', this._autoCollapseTouchEndHandler, { passive: true });
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
        let selectedQuality = null;
        if (item.type === 'crafted_item') {
            // For ring slots, use the available quality (accounting for other ring slot)
            let quality;
            if (item.slot === 'ring' && this.slot && this.slot.startsWith('ring')) {
                if (itemState.has !== true) {
                    // Non-owned ring: use the rarity the user clicked, not owned quality
                    const rarityToQuality = {
                        'ethereal': 'Eternal', 'legendary': 'Perfect', 'epic': 'Excellent',
                        'rare': 'Great', 'uncommon': 'Good', 'common': 'Normal'
                    };
                    quality = rarityToQuality[item.rarity] || 'Normal';
                } else {
                    quality = this.getAvailableRingQuality(item, itemState);
                }
            } else {
                quality = itemState.quality || 'Normal';
            }
            selectedQuality = quality;
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

        // Get the correct stats for this item (quality-aware for crafted items)
        let itemStats = item.stats || {};
        if (item.type === 'crafted_item' && item.stats_by_quality) {
            const quality = selectedQuality || 'Normal';
            itemStats = item.stats_by_quality[quality] || item.stats || {};
        }

        // Build item data for the slot (include keywords for set bonus calculation)
        const slotItem = {
            itemId: item.id,
            uuid: item.uuid,  // Add UUID for export
            name: item.name,
            icon_path: item.icon_path,
            rarity: rarity,
            quality: selectedQuality || (item.type === 'crafted_item' ? 'Normal' : null),
            keywords: item.keywords || [],
            is_fine: item.is_fine || false,  // Add is_fine flag for drop shadow
            is_generic: item.is_generic || false,
            icon: item.icon || null,
            icon_color: item.icon_color || null,
            stats: itemStats,  // Include stats for input item stat aggregation
        };

        // For pets, include level and level-specific stats + icon
        if (item.type === 'pet') {
            const petLevel = itemState.level || 0;
            if (petLevel === 0) {
                api.showError('Cannot equip an egg — set the pet level in Owned Items first.');
                return;
            }
            const petVariant = itemState.variant || 'normal';
            const levelData = item.levels ? item.levels[String(petLevel)] : null;
            slotItem.level = petLevel;
            slotItem.variant = petVariant;
            slotItem.stats = levelData?.stats || {};
            slotItem.icon_path = getPetIconPath(item.name, petLevel, petVariant, item.max_level || 0);
            slotItem.type = 'pet';
            slotItem.levels = item.levels;
            slotItem.max_level = item.max_level || 0;
        }

        console.log('Equipping item to slot:', this.slot, slotItem);

        // Tree-node context: in tree-node mode, the popup does NOT mutate
        // the live character's gearset via store.updateGearSlot. Instead
        // it hands the picked item to treeNodeContext.onSelect — the view
        // layer is responsible for committing to the node, persisting the
        // lock if pre-arm was set, and triggering the recalc/propagate.
        if (this._treeNodeContext) {
            const ctx = this._treeNodeContext;
            // Hard-lock semantics: a pick in tree-node mode IS a lock.
            // Without this, an unlocked pick would be silently dropped —
            // the optimizer would just put back its preferred item. The
            // user explicitly chose THIS item, so commit it. Mirrors the
            // spec: "C - Hard lock — optimizer MUST use locked item."
            // Backend optimize_worker.py expects locked_slots[slot] to
            // be a dict {itemId, quality, level?}, not a plain item-id
            // string — see the resolve loop in optimize_worker around
            // L1559. Match the canonical shape used by state.js (the
            // col-2 lockedSlots format) so the worker can resolve the
            // pinned item through the same code path. Extra metadata
            // (name, icon_path, rarity, variant, max_level) is included
            // for the client-side overlay so the slot tile can render
            // the picked item without needing a fresh catalog lookup —
            // critical for pets, where the level-appropriate icon comes
            // from getPetIconPath(name, level, variant, max_level) and
            // can't be derived from itemId alone.
            ctx.lockedSlots[this.slot] = {
                // Bug b788d037 last follow-up: Fine consumable entries
                // in the popup's split-fine-entry list have id (e.g.
                // 'dried_fruit_fine') but NOT itemId. Without the
                // fallback to slotItem.id, lockedSlots.consumable.itemId
                // ended up null — the tree-tile overlay then dropped
                // the slot entirely (`if (!itemId) continue;`) and the
                // user saw no fine outline (or no item at all) on the
                // tile after a manual Fine pick.
                itemId: slotItem.itemId || slotItem.id || null,
                quality: slotItem.quality || null,
                level: slotItem.level !== undefined ? slotItem.level : undefined,
                // Extras for in-place overlay rendering and popup
                // "currently equipped" fallback. The backend ignores
                // unknown keys.
                name: slotItem.name || null,
                icon_path: slotItem.icon_path || null,
                rarity: slotItem.rarity || null,
                variant: slotItem.variant || null,
                max_level: slotItem.max_level !== undefined ? slotItem.max_level : undefined,
                type: slotItem.type || null,
                is_generic: !!slotItem.is_generic,
                is_fine: !!slotItem.is_fine,
            };
            if (typeof ctx.onSelect === 'function') {
                ctx.onSelect({
                    type: 'pick',
                    slot: this.slot,
                    slotItem,
                    locked: true,
                    lockedSlots: { ...ctx.lockedSlots },
                });
            }
            this._pendingLock = false;
            this.hide();
            return;
        }

        // Call the onSelect callback if provided
        if (this.onSelect) {
            this.onSelect(this.slot, slotItem);
        }

        // If this is an input slot selection (from activity info), use callback instead of gearset
        if (this.slot === 'input' && this._inputSlotCallback) {
            this._inputSlotCallback(slotItem);
            this._inputSlotCallback = null;
            api.showInfo(`Selected ${item.name} as input item`);
            this.hide();
            return;
        }

        // Validate tool keyword uniqueness before equipping
        if (this.slot && this.slot.startsWith('tool')) {
            const currentGear = store.getActiveGearset();
            const result = validateToolKeyword(slotItem, this.slot, currentGear);
            if (!result.valid) {
                if (result.conflictKeyword === 'duplicate item') {
                    api.showError(
                        `Can't equip ${item.name}. It's already equipped in another tool slot. The same tool can't be in two slots at once.`
                    );
                } else {
                    const kw = result.conflictKeyword.charAt(0).toUpperCase() + result.conflictKeyword.slice(1);
                    api.showError(
                        `Can't equip ${item.name}. Keyword "${kw}" conflicts with ${result.conflictItem} in another tool slot. Only one tool per keyword is allowed.`
                    );
                }
                return;
            }
        }

        // Update the gear slot in store
        store.updateGearSlot(this.slot, slotItem);

        // If pre-arm lock was set, lock the slot now that an item is equipped
        if (this._pendingLock) {
            store.toggleSlotLock(this.slot);
            this._pendingLock = false;
        }

        // Show toast notification
        api.showInfo(`Equipped ${item.name} to ${this.getSlotDisplayName(this.slot)}`);

        // Close the popup
        this.hide();
    }

    /**
     * Render the lock icon button for the popup header.
     * Shows filled lock when locked, outline lock when unlocked or empty.
     * @returns {string} HTML string for the lock icon button
     */
    _renderLockIcon() {
        // Don't show lock icon for input slot selections
        if (this.slot === 'input') return '';

        // Tree-node context: lock state lives on the tree node, not the
        // global store. Reading from store.getActiveLockedSlots() here
        // gave the popup a stale 'unlocked' on initial render even when
        // the node's locked_slots had this slot pinned. Mirror the same
        // ctx-first lookup that _updateLockIcon already does.
        const ctx = this._treeNodeContext;
        const isLocked = ctx
            ? !!ctx.lockedSlots[this.slot]
            : !!store.getActiveLockedSlots()[this.slot];
        const hasItem = ctx
            ? !!(ctx.equippedSlots && ctx.equippedSlots[this.slot])
            : !!store.getActiveGearset()?.[this.slot];
        const stateClass = isLocked ? 'locked' : (this._pendingLock ? 'pre-armed' : 'unlocked');

        // Two-part lock SVG: separate shackle (stroke arc) and body (filled rect)
        // with hollow circle keyhole in the body
        const lockedSvg = `<svg viewBox="0 0 24 24" fill="none">
            <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
            <circle cx="12" cy="16" r="1.5" fill="var(--bg-primary, #1a1a2e)"/>
        </svg>`;

        const unlockedSvg = `<svg viewBox="0 0 24 24" fill="none">
            <path d="M8 11V7a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
            <circle cx="12" cy="16" r="1.5" fill="var(--bg-primary, #1a1a2e)"/>
        </svg>`;

        const svg = (isLocked || this._pendingLock) ? lockedSvg : unlockedSvg;
        const title = isLocked ? 'Unlock slot' : (hasItem ? 'Lock slot' : (this._pendingLock ? 'Cancel pre-arm lock' : 'Pre-arm lock'));

        return `<button class="popup-lock-icon ${stateClass}" title="${title}">${svg}</button>`;
    }

    /**
     * Update just the lock icon without a full re-render.
     */
    _updateLockIcon() {
        const $lockIcon = this.$element.find('.popup-lock-icon');
        if (!$lockIcon.length) return;

        // Tree-node context owns its own lock state; consult that first so
        // the icon reflects node.locked_slots, not the live character's.
        const ctx = this._treeNodeContext;
        const isLocked = ctx
            ? !!ctx.lockedSlots[this.slot]
            : !!store.getActiveLockedSlots()[this.slot];
        const hasItem = ctx
            ? !!(ctx.equippedSlots && ctx.equippedSlots[this.slot])
            : !!store.getActiveGearset()?.[this.slot];
        const newClass = isLocked ? 'locked' : (this._pendingLock ? 'pre-armed' : 'unlocked');

        // Swap state classes (keeps element in DOM for CSS transitions)
        $lockIcon.removeClass('locked unlocked pre-armed').addClass(newClass);

        // Update SVG content (locked vs unlocked shackle)
        const lockedSvg = `<svg viewBox="0 0 24 24" fill="none">
            <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
            <circle cx="12" cy="16" r="1.5" fill="var(--bg-primary, #1a1a2e)"/>
        </svg>`;
        const unlockedSvg = `<svg viewBox="0 0 24 24" fill="none">
            <path d="M8 11V7a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/>
            <circle cx="12" cy="16" r="1.5" fill="var(--bg-primary, #1a1a2e)"/>
        </svg>`;
        $lockIcon.html((isLocked || this._pendingLock) ? lockedSvg : unlockedSvg);

        // Update title
        const title = isLocked ? 'Unlock slot' : (hasItem ? 'Lock slot' : (this._pendingLock ? 'Cancel pre-arm lock' : 'Pre-arm lock'));
        $lockIcon.attr('title', title);

        // Trigger pop animation
        $lockIcon.removeClass('pop');
        // Force reflow so re-adding the class restarts the animation
        void $lockIcon[0].offsetWidth;
        $lockIcon.addClass('pop');
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
