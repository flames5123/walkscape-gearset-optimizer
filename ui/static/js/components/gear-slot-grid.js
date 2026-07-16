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
import api from '../api.js';
import { getPetIconPath } from '../utils/pet-utils.js';
import { wireInfoIcons } from '../info-popover.js';
import { getSlotGroup, getValidMoveTargets } from '../utils/slot-reorder.js';

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
        this.subscribe('gearsets.gearset2', () => {
            // Re-render if we're viewing gearset 2
            if (store.state.gearsets.comparisonMode && store.state.gearsets.activeGearsetSlot === 2) {
                this.render();
            }
        });
        this.subscribe('gearsets.lockedSlots', () => {
            const newLocked = store.getActiveLockedSlots();

            // Track which slots currently have badges (before re-render)
            const previousBadgeSlots = new Set();
            this.$element.find('.slot-lock-badge').each((_, el) => {
                previousBadgeSlots.add($(el).data('slot'));
            });

            // Animate out any badges that are being removed
            let needsAnimatedRemoval = false;
            this.$element.find('.slot-lock-badge').each((_, el) => {
                const slot = $(el).data('slot');
                if (!newLocked[slot]) {
                    $(el).addClass('removing');
                    needsAnimatedRemoval = true;
                }
            });

            const doRender = () => {
                this.render();
                // Add appear animation only to newly added badges
                this.$element.find('.slot-lock-badge').each((_, el) => {
                    const slot = $(el).data('slot');
                    if (!previousBadgeSlots.has(slot)) {
                        $(el).addClass('appearing');
                    }
                });
            };

            if (needsAnimatedRemoval) {
                setTimeout(doRender, 200);
            } else {
                doRender();
            }
        });
        this.subscribe('character', () => {
            // Update character level if it changes
            this.updateCharacterLevel();
            this.render();
        });

        // Sync equipped pet when level changes in Column 1
        this.subscribe('ui.user_overrides.items', () => this.syncEquippedPetLevel());

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
        const currentGear = store.getActiveGearset() || {};
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
        // Defensive: if item.is_fine but rarity didn't resolve to
        // 'rarity-fine' (e.g. catalog returned 'common' for a Fine
        // consumable), force the rarity-fine class so the slot still
        // gets the fine background. Bug b788d037.
        if (item && item.is_fine && rarityClass !== 'rarity-fine') {
            slotClasses += ' rarity-fine';
        }

        if (item) {
            console.log(`Rendering slot ${slot} with item:`, item, 'rarity class:', rarityClass);
        }

        // Check for per-slot lock (orange badge) — distinct from level-based tool lock (red border)
        const isPerSlotLocked = store.getActiveLockedSlots()[slot];
        const lockBadgeHtml = isPerSlotLocked ? `
            <div class="slot-lock-badge" data-slot="${slot}" title="Click to unlock">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="#e8820c" stroke-width="2.5" stroke-linecap="round"/>
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="#e8820c"/>
                    <circle cx="12" cy="16" r="1.5" fill="#3d2503"/>
                </svg>
            </div>
        ` : '';

        if (item) {
            // Slot has an item equipped
            const isFine = item.is_fine || (item.name && item.name.includes('(Fine)'));
            const fineClass = isFine ? 'fine' : '';

            // Generic items use emoji icon instead of SVG (unless icon_path is set)
            let iconHtml;
            if (item.is_generic && item.icon_path) {
                const rarityClass = item.rarity ? `rarity-${item.rarity}` : '';
                iconHtml = `<img src="${item.icon_path}" alt="${item.name || displayName}" class="slot-icon ${rarityClass} ${fineClass}" onerror="this.style.display='none'">`;
            } else if (item.is_generic && item.icon) {
                const rarityClass = item.rarity ? `rarity-${item.rarity}` : '';
                iconHtml = `<span class="slot-icon-emoji ${rarityClass}">${window.tintedEmoji(item.icon, item.icon_color)}</span>`;
            } else {
                // Pet slot: catalog icon_path is the EGG SVG. The actual
                // displayed icon depends on level+variant. Resolve via
                // getPetIconPath when those are present. Bug 331d38da:
                // Equip from a tree node sent {name, level, variant} with
                // no icon_path — fallback to placeholder.svg (which doesn't
                // exist) made the slot render a broken image whose alt text
                // ("Camel") leaked as visible content.
                let iconPath = item.icon_path;
                const isPetSlot = (slot === 'pet') || item.type === 'pet';
                if (isPetSlot && item.name && item.level !== undefined && item.level !== null) {
                    iconPath = getPetIconPath(
                        item.name,
                        item.level,
                        item.variant || 'normal',
                        item.max_level || 0,
                    );
                }
                if (!iconPath) {
                    iconPath = '/assets/icons/items/equipment/placeholder.svg';
                }
                const petScaled = iconPath.includes('/pets/') || iconPath.includes('/pet_eggs/') ? ' pet-icon-scaled' : '';
                iconHtml = `<img src="${iconPath}" alt="${item.name || displayName}" class="slot-icon ${fineClass}${petScaled}" onerror="this.style.display='none'">`;
            }

            return `
                <div class="${slotClasses}" data-slot="${slot}" title="${item.name || displayName}">
                    ${iconHtml}
                    ${lockBadgeHtml}
                </div>
            `;
        } else {
            // Empty slot - show name in ALL CAPS
            // Add 'long-name' class for names with 8+ characters (like CONSUMABLE)
            const nameClass = displayName.length >= 8 ? 'slot-name long-name' : 'slot-name';
            return `
                <div class="${slotClasses}" data-slot="${slot}" title="${displayName}">
                    <span class="${nameClass}">${displayName}</span>
                    ${lockBadgeHtml}
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
        const consumableSlot = this.renderSlot('consumable');
        const petSlot = this.renderSlot('pet');

        // Check if equipped pet has an ability with stats
        const petItem = this.getSlotItem('pet');
        let abilityCheckboxHtml = '';
        this._abilityPopoverHtml = null;
        if (petItem && petItem.levels && petItem.level) {
            const levelData = petItem.levels[String(petItem.level)];
            if (levelData && levelData.abilities) {
                const abilityWithStats = levelData.abilities.find(a => a.ability_stats && Object.keys(a.ability_stats).length > 0);
                if (abilityWithStats) {
                    const isChecked = petItem.useAbility ? 'checked' : '';
                    abilityCheckboxHtml = `
                        <div class="pet-ability-toggle">
                            <label class="pet-ability-label">
                                <input type="checkbox" class="pet-ability-checkbox" ${isChecked}>
                                <span class="pet-ability-text">Use ability</span>
                                <span class="travel-info-icon pet-ability-info-icon" role="button" tabindex="0" aria-label="Ability info">ⓘ</span>
                            </label>
                        </div>
                    `;
                    this._abilityPopoverHtml = this._buildAbilityPopoverHtml(abilityWithStats);
                }
            }
        }

        return `
            <div class="special-slots-section">
                <div class="gear-slot-row centered">
                    ${consumableSlot}
                    <div class="pet-slot-col">
                        ${petSlot}
                        ${abilityCheckboxHtml}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Build rich HTML content for the pet ability info popover,
     * matching the combined stats section style with icons and colors.
     * @param {Object} ability - Ability data with ability_stats
     * @returns {string} HTML string for the popover
     */
    _buildAbilityPopoverHtml(ability) {
        // Stat icon map (same as combined-stats-section.js getStatIconPath)
        const iconMap = {
            'work_efficiency': 'work_efficiency',
            'double_action': 'double_action',
            'double_rewards': 'double_rewards',
            'steps_add': 'steps_required',
            'steps_required': 'steps_required',
            'flat_steps': 'steps_required',
            'steps_pct': 'steps_required',
            'steps_percent': 'steps_required',
            'no_materials_consumed': 'no_materials_consumed',
            'quality_outcome': 'quality_outcome',
            'bonus_xp': 'bonus_experience',
            'bonus_xp_percent': 'bonus_experience',
            'bonus_experience': 'bonus_experience',
            'chest_finding': 'chest_finding',
            'item_finding': 'item_finding',
            'fine_material_finding': 'fine_material_finding',
            'find_collectibles': 'find_collectibles',
            'inventory_space': 'inventory_space',
        };

        // Percentage stats (show %)
        const percentageStats = [
            'work_efficiency', 'double_action', 'double_rewards',
            'no_materials_consumed', 'bonus_xp', 'bonus_xp_percent',
            'chest_finding', 'item_finding', 'fine_material_finding',
            'find_collectibles',
        ];

        // Format stat name (same as combined-stats-section.js formatStatName)
        const formatName = (stat) => stat.split('_').map(w => {
            if (w === 'xp') return 'XP';
            return w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');

        // Format skill label
        const formatSkill = (skill) => {
            if (skill === 'global') return '';
            return skill.charAt(0).toUpperCase() + skill.slice(1);
        };

        const _abIcon = ability.icon
            ? `<img src="/assets/icons/abilities/${ability.icon}.svg" width="32" height="32" style="vertical-align:middle;margin-right:6px" alt="" onerror="this.style.display='none'">`
            : '';
        let html = `<div class="info-popover-title">${_abIcon}${ability.name}</div>`;

        if (ability.duration) {
            html += `<div class="pet-popover-duration">Lasts ${ability.duration} ${ability.duration_unit || 'actions'}</div>`;
        }

        if (ability.ability_stats) {
            html += `<div class="pet-popover-stats">`;
            for (const [skill, locations] of Object.entries(ability.ability_stats)) {
                for (const [location, stats] of Object.entries(locations)) {
                    // Skill/location condition line
                    const skillName = formatSkill(skill);
                    const locName = location === 'global' ? '' : location;
                    let conditionText = '';
                    if (skillName) conditionText += `While doing ${skillName}`;
                    if (locName) conditionText += `${conditionText ? ' ' : 'While '}in ${locName}`;
                    if (conditionText) {
                        html += `<div class="pet-popover-condition">${conditionText}</div>`;
                    }

                    for (const [stat, value] of Object.entries(stats)) {
                        const iconFile = iconMap[stat] || stat;
                        const iconPath = `/assets/icons/attributes/${iconFile}.svg`;
                        const name = formatName(stat);
                        const isPercent = percentageStats.includes(stat);
                        const sign = value > 0 ? '+' : '';
                        const suffix = isPercent ? '%' : '';
                        // Steps stats: negative = good (green), positive = bad (red)
                        // Everything else: positive = good (green), negative = bad (red)
                        const isStepsStat = stat.includes('steps');
                        const isGood = isStepsStat ? value < 0 : value > 0;
                        const colorClass = isGood ? 'stat-positive' : 'stat-negative';

                        html += `
                            <div class="pet-popover-stat-row">
                                <span class="${colorClass}">${sign}${value}${suffix}</span>
                                <img src="${iconPath}" class="pet-popover-stat-icon" alt="${name}">
                                <span>${name}</span>
                            </div>
                        `;
                    }
                }
            }
            html += `</div>`;
        }

        // Add input requirements (items needed to charge the ability)
        if (ability.cooldown && ability.cooldown.includes('charged by using items')) {
            const cooldown = ability.cooldown;
            const chargeMatch = cooldown.match(/requires.*?(\d+)/);
            const chargeNeeded = chargeMatch ? chargeMatch[1] : '?';
            const items = [];
            const itemRegex = /(\d+)\s+gained from\s+([A-Z][a-z][\w\s]*?)(?=\s+\d+\s+gained|\s*$)/g;
            let m;
            while ((m = itemRegex.exec(cooldown)) !== null) {
                items.push({ qty: m[1], name: m[2].trim() });
            }
            const drIcon = '/assets/icons/attributes/double_rewards.svg';
            html += `<div class="pet-popover-inputs">`;
            html += `<div class="pet-popover-inputs-header">Charged by items. One full charge requires <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge"> <strong>${chargeNeeded}</strong></div>`;
            for (const item of items) {
                const iconName = item.name.toLowerCase().replace(/ /g, '_');
                html += `
                    <div class="pet-popover-input-row">
                        <img src="${drIcon}" class="pet-popover-inline-icon" alt="charge">
                        <strong>${item.qty}</strong> gained from
                        <img src="/assets/icons/items/materials/${iconName}.svg" class="pet-popover-stat-icon" alt="${item.name}"
                             onerror="this.src='/assets/icons/items/consumables/${iconName}.svg'; this.onerror=null;">
                        ${item.name}
                    </div>
                `;
            }
            html += `</div>`;
        } else if (ability.charges) {
            html += `<div class="pet-popover-inputs">`;
            html += `<div class="pet-popover-inputs-header">Charges: ${ability.charges}</div>`;
            html += `</div>`;
        }

        return html;
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

        // Set ability popover HTML content on the icon element (avoids HTML-in-attribute escaping)
        if (this._abilityPopoverHtml) {
            const icon = this.$element.find('.pet-ability-info-icon')[0];
            if (icon) {
                icon.dataset.infoHtml = this._abilityPopoverHtml;
                wireInfoIcons(this.$element[0]);
            }
        }

        // If a reorder (move mode) is in progress, re-apply its visual state
        // after the DOM was rebuilt so the highlight/dim survives re-renders.
        if (this._moveMode) {
            this._applyMoveModeClasses();
        }
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Click handler for per-slot lock badge (quick unlock with animation)
        this.$element.on('click', '.slot-lock-badge', (e) => {
            e.stopPropagation();
            const $badge = $(e.currentTarget);
            const slot = $badge.data('slot');

            // Animate out, then toggle
            $badge.addClass('removing');
            setTimeout(() => {
                store.toggleSlotLock(slot);
            }, 200);
        });

        // Pet ability checkbox handler
        this.$element.on('change', '.pet-ability-checkbox', (e) => {
            const isChecked = e.target.checked;
            const petItem = this.getSlotItem('pet');
            if (petItem) {
                // Update the pet slot with the useAbility flag
                store.updateGearSlot('pet', {
                    ...petItem,
                    useAbility: isChecked,
                });
            }
        });

        // Pet ability (i) icon — handled by wireInfoIcons in render()

        // Click handler for slots
        this.$element.on('click', '.gear-slot', (e) => {
            const $slot = $(e.currentTarget);
            const slot = $slot.data('slot');
            const isLocked = $slot.hasClass('locked');

            // Swallow the click synthesized by a long-press's pointerup — both
            // when arming tool move-mode and after an immediate ring auto-swap —
            // so it doesn't cancel the move or open the slot popup.
            if (this._suppressNextClick) {
                this._suppressNextClick = false;
                if (this._suppressTimer) { clearTimeout(this._suppressTimer); this._suppressTimer = null; }
                e.stopPropagation();
                return;
            }

            // --- Reorder (move mode) takes priority over the normal popup ---
            if (this._moveMode) {
                e.stopPropagation();
                this._handleMoveModeClick(slot);
                return;
            }

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

        // --- Hold-to-move (reorder) for tool & ring slots -------------------
        // Pointer events unify mouse + touch + pen, avoiding the double-fire
        // that separate mouse/touch handlers cause on hybrid devices.
        const LONG_PRESS_MS = 350;
        const MOVE_CANCEL_PX = 10;
        let pressTimer = null;
        let pressStart = null;

        const clearPressTimer = () => {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            pressStart = null;
            this._removeHoldProgress();
        };

        this.$element.on('pointerdown', '.gear-slot', (e) => {
            const oe = e.originalEvent || e;
            // Primary button / touch / pen only.
            if (typeof oe.button === 'number' && oe.button > 0) return;
            // While already reordering, pointerdown is part of a target tap —
            // let the click handler deal with it. Clear any stale click-suppress
            // flag so a missing synthesized click can't poison the target tap.
            if (this._moveMode) {
                this._suppressNextClick = false;
                return;
            }

            const slot = $(e.currentTarget).data('slot');
            if (!getSlotGroup(slot)) return;        // not a tool/ring
            if (this.isSlotLocked(slot)) return;     // locked tool slot: not a source
            if (!this.getSlotItem(slot)) return;     // nothing to pick up

            pressStart = { x: oe.clientX, y: oe.clientY };
            clearPressTimer();
            // Show a clockwise-filling ring on the slot that completes exactly
            // when the long-press arms move mode.
            this._showHoldProgress($(e.currentTarget), LONG_PRESS_MS);
            pressTimer = setTimeout(() => {
                pressTimer = null;
                this._enterMoveMode(slot);
            }, LONG_PRESS_MS);
        });

        // Abort the long-press if the pointer drifts (i.e. the user is scrolling).
        this.$element.on('pointermove', '.gear-slot', (e) => {
            if (!pressTimer || !pressStart) return;
            const oe = e.originalEvent || e;
            if (Math.abs(oe.clientX - pressStart.x) > MOVE_CANCEL_PX ||
                Math.abs(oe.clientY - pressStart.y) > MOVE_CANCEL_PX) {
                clearPressTimer();
            }
        });

        this.$element.on('pointerup pointercancel pointerleave', '.gear-slot', () => {
            clearPressTimer();
        });

        // Suppress the iOS long-press callout / context menu while reordering.
        this.$element.on('contextmenu', '.gear-slot', (e) => {
            if (this._moveMode || pressTimer) e.preventDefault();
        });
    }

    /**
     * Enter reorder (move) mode for a source tool/ring slot: highlight the
     * source, light up valid targets, and dim everything else.
     * @param {string} sourceSlot
     */
    _enterMoveMode(sourceSlot) {
        // The hold completed — clear the progress ring; move-mode highlight takes over.
        this._removeHoldProgress();
        const group = getSlotGroup(sourceSlot);
        const targets = getValidMoveTargets(sourceSlot, (s) => this.isSlotLocked(s));
        // Nothing to swap with (e.g. all other tool slots locked) — no-op.
        if (!targets.length) return;

        // Rings only have one possible partner — swap immediately on hold (no
        // tap step) and confirm with a toast.
        if (group === 'rings') {
            this._armClickSuppression();
            store.swapGearSlots(sourceSlot, targets[0]);
            if (api && typeof api.showSuccess === 'function') {
                api.showSuccess('Swapped rings');
            }
            return;
        }

        this._moveMode = { sourceSlot, targets };
        // The pointerup that completed this long-press will fire a click on the
        // source slot; ignore that one so we don't immediately cancel.
        this._armClickSuppression();
        this._applyMoveModeClasses();
        this._bindMoveModeGlobal();
    }

    /**
     * Arm one-shot suppression of the next slot click (the click synthesized by
     * the long-press's pointerup), with a self-healing timeout so a missing
     * synthesized click can't poison a later genuine tap.
     */
    _armClickSuppression() {
        this._suppressNextClick = true;
        if (this._suppressTimer) clearTimeout(this._suppressTimer);
        this._suppressTimer = setTimeout(() => {
            this._suppressNextClick = false;
            this._suppressTimer = null;
        }, 600);
    }

    /**
     * Show a clockwise-filling progress ring on a slot while it is being held,
     * signalling how long until the press arms move mode. The fill duration is
     * synced to the long-press threshold passed from the pointerdown handler.
     * @param {jQuery} $slot - The slot being held.
     * @param {number} durationMs - Long-press threshold (ring fill time).
     */
    _showHoldProgress($slot, durationMs) {
        this._removeHoldProgress();
        if (!$slot || !$slot[0]) return;
        const wrap = document.createElement('div');
        wrap.className = 'slot-hold-progress';
        // r=16 => circumference = 2*pi*16 ≈ 100.53 (matches CSS dasharray).
        wrap.innerHTML =
            '<svg viewBox="0 0 36 36" aria-hidden="true">' +
            '<circle class="slot-hold-progress-track" cx="18" cy="18" r="16"></circle>' +
            '<circle class="slot-hold-progress-fill" cx="18" cy="18" r="16"></circle>' +
            '</svg>';
        const fill = wrap.querySelector('.slot-hold-progress-fill');
        if (fill) fill.style.animationDuration = durationMs + 'ms';
        $slot[0].appendChild(wrap);
        $slot.addClass('slot-holding');
        this._holdProgressEl = wrap;
        this._holdSlot = $slot;
    }

    /** Remove the hold-progress ring and its slot styling, if present. */
    _removeHoldProgress() {
        if (this._holdProgressEl) {
            this._holdProgressEl.remove();
            this._holdProgressEl = null;
        }
        if (this._holdSlot) {
            this._holdSlot.removeClass('slot-holding');
            this._holdSlot = null;
        }
    }

    /**
     * Handle a click on a slot while in move mode: swap with a valid target,
     * or cancel on the source / an invalid (dimmed) slot.
     * @param {string} slot
     */
    _handleMoveModeClick(slot) {
        const mm = this._moveMode;
        if (!mm) return;
        if (slot !== mm.sourceSlot && mm.targets.includes(slot)) {
            store.swapGearSlots(mm.sourceSlot, slot);
        }
        // Tapping the source, a dimmed slot, or completing a swap all end move mode.
        this._exitMoveMode();
    }

    /** Apply the source/target/dim CSS classes for the current move mode. */
    _applyMoveModeClasses() {
        const mm = this._moveMode;
        if (!mm) return;
        this.$element.find('.gear-slot-grid-container').addClass('move-mode');
        this.$element.find('.slot-move-hint').remove();
        this.$element.find('.gear-slot').each((_, el) => {
            const $el = $(el);
            const s = $el.data('slot');
            $el.removeClass('slot-move-source slot-move-target slot-move-dim');
            if (s === mm.sourceSlot) {
                $el.addClass('slot-move-source');
                // "Tap to swap" label floating above the held slot.
                const hint = document.createElement('div');
                hint.className = 'slot-move-hint';
                hint.textContent = 'Tap to swap';
                el.appendChild(hint);
            } else if (mm.targets.includes(s)) {
                $el.addClass('slot-move-target');
            } else {
                $el.addClass('slot-move-dim');
            }
        });
    }

    /** Remove all move-mode CSS classes. */
    _removeMoveModeClasses() {
        this.$element.find('.gear-slot-grid-container').removeClass('move-mode');
        this.$element.find('.slot-move-hint').remove();
        this.$element.find('.gear-slot').removeClass('slot-move-source slot-move-target slot-move-dim');
    }

    /** Bind document-level Escape / outside-click handlers to cancel move mode. */
    _bindMoveModeGlobal() {
        this._moveModeKeyHandler = (ev) => {
            if (ev.key === 'Escape') this._exitMoveMode();
        };
        this._moveModeDocClick = (ev) => {
            if (!this.$element[0].contains(ev.target)) this._exitMoveMode();
        };
        document.addEventListener('keydown', this._moveModeKeyHandler);
        // Defer the outside-click listener so it doesn't catch the click from
        // the long-press that opened move mode.
        setTimeout(() => {
            if (this._moveMode) document.addEventListener('click', this._moveModeDocClick);
        }, 0);
    }

    /** Exit reorder mode and tear down its classes + global handlers. */
    _exitMoveMode() {
        if (!this._moveMode) return;
        this._moveMode = null;
        this._suppressNextClick = false;
        this._removeMoveModeClasses();
        if (this._moveModeKeyHandler) {
            document.removeEventListener('keydown', this._moveModeKeyHandler);
            this._moveModeKeyHandler = null;
        }
        if (this._moveModeDocClick) {
            document.removeEventListener('click', this._moveModeDocClick);
            this._moveModeDocClick = null;
        }
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

    /**
     * Sync equipped pet's icon and stats when level changes in Column 1.
     */
    syncEquippedPetLevel() {
        const equippedPet = store.state.gearsets?.current?.pet;
        if (!equippedPet || !equippedPet.itemId) return;

        // Get the pet's current level and variant from overrides/state
        const overrides = store.state.ui?.user_overrides || {};
        const overrideState = (overrides.items && overrides.items[equippedPet.itemId]) || {};
        const baseState = store.state.items[equippedPet.itemId] || {};
        const newLevel = overrideState.level !== undefined ? overrideState.level : (baseState.level !== undefined ? baseState.level : 0);
        const newVariant = overrideState.variant !== undefined ? overrideState.variant : (baseState.variant || 'normal');

        if (newLevel === equippedPet.level && newVariant === equippedPet.variant) return;

        // Get level-specific stats from the equipped pet's levels data
        const levelData = equippedPet.levels ? equippedPet.levels[String(newLevel)] : null;

        // Check if the new level still has an ability with stats — if not, clear useAbility
        let useAbility = equippedPet.useAbility || false;
        if (useAbility && levelData) {
            const hasAbilityStats = levelData.abilities?.some(a => a.ability_stats && Object.keys(a.ability_stats).length > 0);
            if (!hasAbilityStats) useAbility = false;
        }

        store.updateGearSlot('pet', {
            ...equippedPet,
            level: newLevel,
            variant: newVariant,
            useAbility: useAbility,
            icon_path: getPetIconPath(equippedPet.name, newLevel, newVariant, equippedPet.max_level || 0),
            stats: levelData?.stats || {},
        });
    }
}

export default GearSlotGrid;

// Also export the static method for testing
export { GearSlotGrid };
