/**
 * ItemRow component
 * 
 * Displays a single item with:
 * - "Has" checkbox for ownership
 * - Icon (with placeholder fallback)
 * - Item name (centered)
 * - Expand arrow for details
 * - Expandable details section with:
 *   - "Hide" checkbox for optimization exclusion
 *   - Keywords display
 *   - Stats with conditions
 *   - Quality dropdown for crafted items
 * - Rarity-based background colors
 */

import Component from './base.js';
import store from '../state.js';

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

class ItemRow extends Component {
    /**
     * Create an item row
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {Object} props.item - Item data object
     * @param {boolean} props.showQuality - Whether to show quality dropdown (for crafted items)
     */
    constructor(element, { item, showQuality = false }) {
        super(element, { item, showQuality });
        this.expanded = false;

        // Subscribe to item state changes (both base and overrides)
        this.subscribe(`items.${item.id}`, () => this.render());
        this.subscribe(`ui.user_overrides.items.${item.id}`, () => this.render());

        this.render();
        this.attachEvents();
    }

    /**
     * Render the item row HTML
     * @returns {string} HTML string
 */
    render() {
        // Get item state from user overrides first, then fall back to base items state
        const overrides = store.state.ui.user_overrides || {};
        const overrideItemState = (overrides.items && overrides.items[this.props.item.id]) || {};
        const baseItemState = store.state.items[this.props.item.id] || {};

        // Merge: overrides take precedence
        const itemState = {
            has: overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has,
            has_fine: overrideItemState.has_fine !== undefined ? overrideItemState.has_fine : baseItemState.has_fine,
            hide: overrideItemState.hide !== undefined ? overrideItemState.hide : baseItemState.hide,
            hide_fine: overrideItemState.hide_fine !== undefined ? overrideItemState.hide_fine : baseItemState.hide_fine,
            hide_ring1: overrideItemState.hide_ring1 !== undefined ? overrideItemState.hide_ring1 : baseItemState.hide_ring1,
            hide_ring2: overrideItemState.hide_ring2 !== undefined ? overrideItemState.hide_ring2 : baseItemState.hide_ring2,
            quality: overrideItemState.quality !== undefined ? overrideItemState.quality : baseItemState.quality,
            ring1_quality: overrideItemState.ring1_quality !== undefined ? overrideItemState.ring1_quality : baseItemState.ring1_quality,
            ring2_quality: overrideItemState.ring2_quality !== undefined ? overrideItemState.ring2_quality : baseItemState.ring2_quality,
            ring_quantity: overrideItemState.ring_quantity !== undefined ? overrideItemState.ring_quantity : baseItemState.ring_quantity
        };

        // Map quality names to rarity names for background color
        const qualityToRarity = {
            'normal': 'common',
            'good': 'uncommon',
            'great': 'rare',
            'excellent': 'epic',
            'perfect': 'legendary',
            'eternal': 'ethereal'
        };

        // Determine rarity for background color
        let rarityValue;

        // For crafted items (type === 'crafted_item'), use quality from state
        if (this.props.item.type === 'crafted_item') {
            // For rings, use the highest quality between ring1 and ring2
            if (this.props.item.slot === 'ring') {
                const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
                const ring2Quality = itemState.ring2_quality || 'None';

                // Quality hierarchy for comparison
                const qualityHierarchy = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];
                const ring1Index = qualityHierarchy.indexOf(ring1Quality);
                const ring2Index = ring2Quality !== 'None' ? qualityHierarchy.indexOf(ring2Quality) : -1;

                // Use the higher quality
                const highestQuality = ring2Index > ring1Index ? ring2Quality : ring1Quality;
                rarityValue = highestQuality;
            } else {
                // For non-ring crafted items, use quality from state
                rarityValue = itemState.quality || 'Normal';
            }

            // Convert quality name to rarity name
            if (qualityToRarity[rarityValue?.toLowerCase()]) {
                rarityValue = qualityToRarity[rarityValue.toLowerCase()];
            }
        } else {
            // For non-crafted items, use the item's base rarity
            rarityValue = this.props.item.rarity;
        }

        const rarity = this.getRarityClass(rarityValue);

        // Debug logging for items without correct background
        console.log(`Item ${this.props.item.name}: type="${this.props.item.type}", rarityValue="${rarityValue}", rarityClass="${rarity}"`);

        const html = `
            <div class="item-row ${rarity}" data-item="${this.props.item.id}">
                <div class="item-row-main">
                    ${this.renderCheckboxes(itemState)}
                    <img src="${this.getIconPath()}" 
                         class="${this.getIconClasses(itemState)}" 
                         alt="${this.props.item.name}"
                         loading="lazy">
                    <div class="item-info">
                        <span class="item-name">${this.props.item.name}</span>
                        ${this.props.showQuality ? this.renderQualityDropdown(itemState) : ''}
                    </div>
                    <button class="expand-btn">
                        <span class="expand-arrow ${this.expanded ? 'expanded' : ''}">▼</span>
                    </button>
                </div>
                ${this.expanded ? this.renderDetails(itemState) : ''}
            </div>
        `;

        this.$element.html(html);
        return html;
    }

    /**
     * Render checkboxes (single for regular items, dual for materials/consumables)
     * @param {Object} itemState - Current item state
     * @returns {string} HTML for checkboxes
     */
    renderCheckboxes(itemState) {
        const isMaterialOrConsumable = this.props.item.type === 'material' || this.props.item.type === 'consumable';
        const hasFine = this.props.item.has_fine;
        // Check for exact "achievement reward" keyword (case-insensitive)
        const isAchievementReward = this.props.item.keywords && this.props.item.keywords.some(kw => kw.toLowerCase() === 'achievement reward');
        const isNonCraftedRing = this.props.item.slot === 'ring' && this.props.item.type !== 'crafted_item' && !isAchievementReward;

        // Debug logging for rings
        if (this.props.item.slot === 'ring') {
            console.log(`Ring ${this.props.item.name}:`, {
                type: this.props.item.type,
                keywords: this.props.item.keywords,
                isAchievementReward,
                isNonCraftedRing
            });
        }

        if (isMaterialOrConsumable && hasFine) {
            // Dual checkboxes for materials/consumables with fine versions
            return `
                <div class="checkbox-group">
                    <input type="checkbox" class="has-checkbox" 
                           ${itemState.has ? 'checked' : ''}
                           title="Normal">
                    <input type="checkbox" class="has-checkbox-fine fine-checkbox" 
                           ${itemState.has_fine ? 'checked' : ''}
                           title="Fine">
                </div>
            `;
        } else if (isNonCraftedRing) {
            // Checkbox with quantity dropdown for non-crafted rings (excluding achievement rewards)
            const ringQuantity = itemState.ring_quantity || 1;

            return `
                <div class="checkbox-group ring-quantity-group">
                    <input type="checkbox" class="has-checkbox" 
                           ${itemState.has ? 'checked' : ''}>
                    ${itemState.has ? `
                        <span class="ring-quantity-selector">
                            (<select class="ring-quantity-dropdown">
                                <option value="1" ${ringQuantity === 1 ? 'selected' : ''}>1</option>
                                <option value="2" ${ringQuantity === 2 ? 'selected' : ''}>2</option>
                            </select>/2)
                        </span>
                    ` : ''}
                </div>
            `;
        } else {
            // Single checkbox for regular items
            return `
                <input type="checkbox" class="has-checkbox" 
                       ${itemState.has ? 'checked' : ''}>
            `;
        }
    }

    /**
     * Render the expanded details section
     * @param {Object} itemState - Current item state from store
     * @returns {string} HTML string for details
     */
    renderDetails(itemState) {
        const isMaterialOrConsumable = this.props.item.type === 'material' || this.props.item.type === 'consumable';
        const hasFine = this.props.item.has_fine;
        const isRing = this.props.item.slot === 'ring' && this.props.item.type === 'crafted_item';

        // Render hide checkboxes
        let hideCheckboxesHtml = '';

        if (isRing) {
            // Dual hide checkboxes for rings with quality-specific labels
            const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
            const ring2Quality = itemState.ring2_quality || 'None';

            // Convert rarity to quality if needed
            const rarityToQuality = {
                'common': 'Normal',
                'uncommon': 'Good',
                'rare': 'Great',
                'epic': 'Excellent',
                'legendary': 'Perfect',
                'ethereal': 'Eternal'
            };

            const ring1QualityName = rarityToQuality[ring1Quality.toLowerCase()] || ring1Quality;
            const ring2QualityName = ring2Quality !== 'None' ? (rarityToQuality[ring2Quality.toLowerCase()] || ring2Quality) : null;

            hideCheckboxesHtml = `
                <div class="hide-checkbox-group">
                    <label class="hide-checkbox">
                        <input type="checkbox" class="hide-checkbox-ring1" ${itemState.hide_ring1 ? 'checked' : ''}>
                        Hide ${ring1QualityName} Quality
                    </label>
                    ${ring2QualityName ? `
                        <label class="hide-checkbox">
                            <input type="checkbox" class="hide-checkbox-ring2" ${itemState.hide_ring2 ? 'checked' : ''}>
                            Hide ${ring2QualityName} Quality
                        </label>
                    ` : ''}
                </div>
            `;
        } else if (isMaterialOrConsumable && hasFine) {
            // Dual hide checkboxes for materials/consumables with fine versions
            hideCheckboxesHtml = `
                <div class="hide-checkbox-group">
                    <label class="hide-checkbox">
                        <input type="checkbox" class="hide-checkbox-normal" ${itemState.hide ? 'checked' : ''}>
                        Hide Normal
                    </label>
                    <label class="hide-checkbox hide-checkbox-fine-label">
                        <input type="checkbox" class="hide-checkbox-fine" ${itemState.hide_fine ? 'checked' : ''}>
                        Hide Fine
                    </label>
                </div>
            `;
        } else {
            // Single hide checkbox for regular items
            hideCheckboxesHtml = `
                <label class="hide-checkbox">
                    <input type="checkbox" ${itemState.hide ? 'checked' : ''}>
                    Hide
                </label>
            `;
        }

        return `
            <div class="item-details">
                ${hideCheckboxesHtml}
                <div class="keywords">${this.renderKeywords()}</div>
                <div class="stats">${this.renderStats()}</div>
            </div>
        `;
    }

    /**
     * Render quality dropdown for crafted items
     * @param {Object} itemState - Current item state from store
     * @returns {string} HTML string for quality dropdown
     */
    renderQualityDropdown(itemState) {
        // Check if this is a ring (slot === 'ring')
        const isRing = this.props.item.slot === 'ring';

        if (isRing) {
            return this.renderRingDropdowns(itemState);
        }

        // Quality names (what's shown in dropdown)
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];

        // Map rarity to quality for selection
        const rarityToQuality = {
            'common': 'Normal',
            'uncommon': 'Good',
            'rare': 'Great',
            'epic': 'Excellent',
            'legendary': 'Perfect',
            'ethereal': 'Eternal'
        };

        // Get selected quality - check both quality and rarity fields
        let selected = itemState.quality || 'Normal';

        // If quality is a rarity name, convert it
        if (rarityToQuality[selected.toLowerCase()]) {
            selected = rarityToQuality[selected.toLowerCase()];
        }

        return `
            <select class="quality-dropdown">
                ${qualities.map(q =>
            `<option value="${q}" ${q === selected ? 'selected' : ''}>${q}</option>`
        ).join('')}
            </select>
        `;
    }

    /**
     * Render dual ring dropdowns for crafted rings
     * @param {Object} itemState - Current item state from store
     * @returns {string} HTML string for ring dropdowns
     */
    renderRingDropdowns(itemState) {
        // Quality names (what's shown in dropdown)
        const qualities = ['Normal', 'Good', 'Great', 'Excellent', 'Perfect', 'Eternal'];

        // Map rarity to quality names
        const rarityToQuality = {
            'common': 'Normal',
            'uncommon': 'Good',
            'rare': 'Great',
            'epic': 'Excellent',
            'legendary': 'Perfect',
            'ethereal': 'Eternal'
        };

        // Get ring selections from state (ring1_quality, ring2_quality)
        let ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
        let ring2Quality = itemState.ring2_quality || 'None';

        // Convert rarity names to quality names if needed
        if (rarityToQuality[ring1Quality.toLowerCase()]) {
            ring1Quality = rarityToQuality[ring1Quality.toLowerCase()];
        }
        if (ring2Quality !== 'None' && rarityToQuality[ring2Quality.toLowerCase()]) {
            ring2Quality = rarityToQuality[ring2Quality.toLowerCase()];
        }

        // Debug logging
        console.log(`Ring dropdowns for ${this.props.item.name}:`, {
            ring1Quality,
            ring2Quality,
            fullItemState: itemState
        });

        // Get available qualities based on character's owned rings
        // For now, we'll show all qualities and let the import handle filtering
        // TODO: Filter based on actual owned quantities from character export

        // Map quality to rarity for border colors
        const qualityToRarity = {
            'Normal': 'common',
            'Good': 'uncommon',
            'Great': 'rare',
            'Excellent': 'epic',
            'Perfect': 'legendary',
            'Eternal': 'ethereal'
        };

        const ring1Rarity = qualityToRarity[ring1Quality] || 'common';
        const ring2Rarity = ring2Quality !== 'None' ? qualityToRarity[ring2Quality] : null;

        return `
            <div class="ring-dropdowns">
                <select class="quality-dropdown ring-dropdown ring-dropdown-1" data-ring-border="${ring1Rarity}">
                    ${qualities.map(q =>
            `<option value="${q}" ${q === ring1Quality ? 'selected' : ''}>${q}</option>`
        ).join('')}
                </select>
                <select class="quality-dropdown ring-dropdown ring-dropdown-2" data-ring-border="${ring2Rarity || 'none'}">
                    <option value="None" ${ring2Quality === 'None' ? 'selected' : ''}>None</option>
                    ${qualities.map(q =>
            `<option value="${q}" ${q === ring2Quality ? 'selected' : ''}>${q}</option>`
        ).join('')}
                </select>
            </div>
        `;
    }

    /**
     * Attach jQuery event handlers
     */
    attachEvents() {
        // Has checkbox - toggle normal ownership (store as user override)
        this.$element.on('change', '.has-checkbox', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.has`, e.target.checked);

            // For non-crafted rings, default quantity to 1 when checked
            const isNonCraftedRing = this.props.item.slot === 'ring' && this.props.item.type !== 'crafted_item';
            if (isNonCraftedRing && e.target.checked) {
                const currentQuantity = store.state.ui.user_overrides?.items?.[this.props.item.id]?.ring_quantity;
                if (currentQuantity === undefined) {
                    store.update(`ui.user_overrides.items.${this.props.item.id}.ring_quantity`, 1);
                }
            }
        });

        // Ring quantity dropdown - update quantity for non-crafted rings
        this.$element.on('change', '.ring-quantity-dropdown', (e) => {
            const quantity = parseInt(e.target.value);
            store.update(`ui.user_overrides.items.${this.props.item.id}.ring_quantity`, quantity);
        });

        // Fine checkbox - toggle fine ownership (store as user override)
        this.$element.on('change', '.has-checkbox-fine', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.has_fine`, e.target.checked);
        });

        // Hide checkbox (normal) - toggle visibility in optimization (store as user override)
        this.$element.on('change', '.hide-checkbox input:not(.hide-checkbox-fine):not(.hide-checkbox-ring1):not(.hide-checkbox-ring2)', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide`, e.target.checked);
        });

        // Hide checkbox (fine) - toggle fine visibility in optimization (store as user override)
        this.$element.on('change', '.hide-checkbox-fine', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_fine`, e.target.checked);
        });

        // Hide checkbox (ring1) - toggle ring1 visibility in optimization
        this.$element.on('change', '.hide-checkbox-ring1', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_ring1`, e.target.checked);
        });

        // Hide checkbox (ring2) - toggle ring2 visibility in optimization
        this.$element.on('change', '.hide-checkbox-ring2', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_ring2`, e.target.checked);
        });

        // Quality dropdown - update item quality (store as user override)
        this.$element.on('change', '.quality-dropdown:not(.ring-dropdown)', (e) => {
            const newQuality = e.target.value;
            store.update(`ui.user_overrides.items.${this.props.item.id}.quality`, newQuality);
        });

        // Ring dropdown 1 - update ring1 quality
        this.$element.on('change', '.ring-dropdown-1', (e) => {
            const newQuality = e.target.value;
            store.update(`ui.user_overrides.items.${this.props.item.id}.ring1_quality`, newQuality);

            // Update border color
            const qualityToRarity = {
                'Normal': 'common',
                'Good': 'uncommon',
                'Great': 'rare',
                'Excellent': 'epic',
                'Perfect': 'legendary',
                'Eternal': 'ethereal'
            };
            $(e.target).attr('data-ring-border', qualityToRarity[newQuality] || 'common');
        });

        // Ring dropdown 2 - update ring2 quality
        this.$element.on('change', '.ring-dropdown-2', (e) => {
            const newQuality = e.target.value;
            store.update(`ui.user_overrides.items.${this.props.item.id}.ring2_quality`, newQuality);

            // Update border color
            const qualityToRarity = {
                'Normal': 'common',
                'Good': 'uncommon',
                'Great': 'rare',
                'Excellent': 'epic',
                'Perfect': 'legendary',
                'Eternal': 'ethereal'
            };
            $(e.target).attr('data-ring-border', newQuality !== 'None' ? qualityToRarity[newQuality] : 'none');
        });

        // Expand button - toggle details view with animation
        this.$element.on('click', '.expand-btn', () => {
            this.expanded = !this.expanded;

            // Update arrow immediately
            const $btn = this.$element.find('.expand-btn');
            $btn.html(`<span class="expand-arrow ${this.expanded ? 'expanded' : ''}">▼</span>`);

            // Animate the details section
            const $details = this.$element.find('.item-details');
            if (this.expanded) {
                // Re-render to add details HTML
                const itemState = this.getCurrentItemState();
                const detailsHtml = this.renderDetails(itemState);

                // Replace or add details
                if ($details.length > 0) {
                    $details.replaceWith(detailsHtml);
                } else {
                    this.$element.find('.item-row').append(detailsHtml);
                }

                // Animate in
                this.$element.find('.item-details').hide().slideDown(200);
            } else {
                // Animate out and remove
                $details.slideUp(200, () => {
                    $details.remove();
                });
            }
        });
    }

    /**
     * Get current item state (helper for expand button)
     * @returns {Object} Current item state
     */
    getCurrentItemState() {
        const overrides = store.state.ui.user_overrides || {};
        const overrideItemState = (overrides.items && overrides.items[this.props.item.id]) || {};
        const baseItemState = store.state.items[this.props.item.id] || {};

        return {
            has: overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has,
            has_fine: overrideItemState.has_fine !== undefined ? overrideItemState.has_fine : baseItemState.has_fine,
            hide: overrideItemState.hide !== undefined ? overrideItemState.hide : baseItemState.hide,
            hide_fine: overrideItemState.hide_fine !== undefined ? overrideItemState.hide_fine : baseItemState.hide_fine,
            hide_ring1: overrideItemState.hide_ring1 !== undefined ? overrideItemState.hide_ring1 : baseItemState.hide_ring1,
            hide_ring2: overrideItemState.hide_ring2 !== undefined ? overrideItemState.hide_ring2 : baseItemState.hide_ring2,
            quality: overrideItemState.quality !== undefined ? overrideItemState.quality : baseItemState.quality,
            ring1_quality: overrideItemState.ring1_quality !== undefined ? overrideItemState.ring1_quality : baseItemState.ring1_quality,
            ring2_quality: overrideItemState.ring2_quality !== undefined ? overrideItemState.ring2_quality : baseItemState.ring2_quality,
            ring_quantity: overrideItemState.ring_quantity !== undefined ? overrideItemState.ring_quantity : baseItemState.ring_quantity
        };
    }

    /**
     * Get CSS class for rarity background color
     * @param {string} rarity - Rarity level
     * @returns {string} CSS class name
     */
    getRarityClass(rarity) {
        // Handle undefined or null rarity
        if (!rarity) {
            return '';
        }

        const rarityMap = {
            'common': 'rarity-common',
            'uncommon': 'rarity-uncommon',
            'rare': 'rarity-rare',
            'epic': 'rarity-epic',
            'legendary': 'rarity-legendary',
            'ethereal': 'rarity-ethereal'
        };
        return rarityMap[rarity.toLowerCase()] || '';
    }

    /**
     * Get icon path
     * @returns {string} Icon URL/path
     */
    getIconPath() {
        let iconPath = this.props.item.icon_path || '/assets/icons/items/equipment/placeholder.svg';

        // For fine items (consumables/materials), remove "(Fine)" from the path
        if (this.props.item.is_fine) {
            iconPath = iconPath.replace('_(Fine)', '').replace('(Fine)', '');
        }

        return iconPath;
    }

    /**
     * Get icon CSS classes
     * @param {Object} itemState - Current item state
     * @returns {string} CSS classes for icon
     */
    getIconClasses(itemState) {
        let classes = 'item-icon';

        // Add 'fine' class if fine checkbox is checked
        if (itemState.has_fine) {
            classes += ' fine';
        }

        return classes;
    }

    /**
     * Render keywords as badges
     * @returns {string} HTML string for keywords
     */
    renderKeywords() {
        if (!this.props.item.keywords || this.props.item.keywords.length === 0) {
            return '';  // Return empty string instead of "No keywords"
        }

        // Filter out internal/system keywords that shouldn't be displayed
        const hiddenKeywords = ['shiny_ring', 'shiny_necklace', 'shiny_bracelet'];
        const visibleKeywords = this.props.item.keywords.filter(kw =>
            !hiddenKeywords.includes(kw.toLowerCase())
        );

        if (visibleKeywords.length === 0) {
            return '';
        }

        return visibleKeywords.map(kw =>
            `<span class="keyword">${kw}</span>`
        ).join('');
    }

    /**
     * Render stats with icons and conditions
     * @returns {string} HTML string for stats
     */
    renderStats() {
        // Get item state from user overrides first, then fall back to base items state
        const overrides = store.state.ui.user_overrides || {};
        const overrideItemState = (overrides.items && overrides.items[this.props.item.id]) || {};
        const baseItemState = store.state.items[this.props.item.id] || {};

        // Merge: overrides take precedence
        const itemState = {
            has_fine: overrideItemState.has_fine !== undefined ? overrideItemState.has_fine : baseItemState.has_fine,
            quality: overrideItemState.quality !== undefined ? overrideItemState.quality : baseItemState.quality,
            ring1_quality: overrideItemState.ring1_quality !== undefined ? overrideItemState.ring1_quality : baseItemState.ring1_quality,
            ring2_quality: overrideItemState.ring2_quality !== undefined ? overrideItemState.ring2_quality : baseItemState.ring2_quality
        };

        const statsHtml = [];

        // For materials/consumables with fine versions, show both normal and fine stats
        if ((this.props.item.type === 'material' || this.props.item.type === 'consumable') && this.props.item.has_fine) {
            // Render normal stats
            if (this.props.item.stats) {
                statsHtml.push(this.renderStatsForVersion(this.props.item.stats, false));
            }
            // Render fine stats
            if (this.props.item.stats_fine) {
                statsHtml.push(this.renderStatsForVersion(this.props.item.stats_fine, true));
            }
            return statsHtml.join('');
        }

        // For rings, show stats for both selected qualities
        if (this.props.item.slot === 'ring' && this.props.item.type === 'crafted_item') {
            const ring1Quality = itemState.ring1_quality || itemState.quality || 'Normal';
            const ring2Quality = itemState.ring2_quality || 'None';

            // Map rarity to quality if needed
            const rarityToQuality = {
                'common': 'Normal',
                'uncommon': 'Good',
                'rare': 'Great',
                'epic': 'Excellent',
                'legendary': 'Perfect',
                'ethereal': 'Eternal'
            };

            const ring1QualityName = rarityToQuality[ring1Quality.toLowerCase()] || ring1Quality;
            const ring2QualityName = ring2Quality !== 'None' ? (rarityToQuality[ring2Quality.toLowerCase()] || ring2Quality) : null;

            // Get stats for ring 1
            const ring1Stats = this.props.item.stats_by_quality?.[ring1QualityName] || {};

            // Add header for ring 1
            if (Object.keys(ring1Stats).length > 0) {
                statsHtml.push(`<div class="ring-stats-header">${ring1QualityName}</div>`);
                statsHtml.push(this.renderStatsForVersion(ring1Stats, false));
            }

            // Get stats for ring 2 if not "None"
            if (ring2QualityName) {
                const ring2Stats = this.props.item.stats_by_quality?.[ring2QualityName] || {};

                if (Object.keys(ring2Stats).length > 0) {
                    statsHtml.push(`<div class="ring-stats-header">${ring2QualityName}</div>`);
                    statsHtml.push(this.renderStatsForVersion(ring2Stats, false));
                }
            }

            return statsHtml.join('');
        }

        // For crafted items, get stats for the selected quality
        let stats = this.props.item.stats;
        if (this.props.item.type === 'crafted_item' && this.props.item.stats_by_quality) {
            const quality = itemState.quality || 'Normal';

            // Map rarity to quality if needed
            const rarityToQuality = {
                'common': 'Normal',
                'uncommon': 'Good',
                'rare': 'Great',
                'epic': 'Excellent',
                'legendary': 'Perfect',
                'ethereal': 'Eternal'
            };

            const qualityName = rarityToQuality[quality.toLowerCase()] || quality;
            stats = this.props.item.stats_by_quality[qualityName] || {};
        }

        // Render regular stats
        return this.renderStatsForVersion(stats, false);
    }

    /**
     * Render stats for a specific version (normal or fine)
     * @param {Object} stats - Stats object
     * @param {boolean} isFine - Whether these are fine stats
     * @returns {string} HTML string for stats
     */
    renderStatsForVersion(stats, isFine) {

        if (!stats || Object.keys(stats).length === 0) {
            return '';  // Return empty string instead of "No stats"
        }

        const statsHtml = [];

        // Render regular stats
        statsHtml.push(...this.renderStatsFromObject(stats, isFine, ''));

        // Render gated stats if present
        if (this.props.item.gated_stats) {
            statsHtml.push(...this.renderGatedStats(this.props.item.gated_stats, isFine));
        }

        return statsHtml.join('');
    }

    /**
     * Render gated stats with requirements
     * @param {Object} gatedStats - Gated stats object
     * @param {boolean} isFine - Whether these are fine stats
     * @returns {Array} Array of HTML strings
     */
    renderGatedStats(gatedStats, isFine) {
        const statsHtml = [];

        // Achievement Points requirements
        if (gatedStats.achievement_points) {
            // Get character's current AP (check overrides first, then character)
            const overrideAP = store.state.ui?.user_overrides?.achievement_points;
            const characterAP = overrideAP !== undefined ? overrideAP : (store.state.character?.achievement_points || 0);

            for (const [threshold, apStats] of Object.entries(gatedStats.achievement_points)) {
                const apThreshold = parseInt(threshold, 10);

                // Only show stats if character meets the threshold
                if (characterAP >= apThreshold) {
                    const requirement = `${threshold} Achievement Points`;
                    statsHtml.push(this.renderStatsFromObject(apStats, isFine, requirement));
                }
            }
        }

        // Total skill level requirements
        if (gatedStats.total_skill_level) {
            // Calculate character's total skill level
            const character = store.state.character || {};
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
                const tslThreshold = parseInt(threshold, 10);
                const isMet = totalLevel >= tslThreshold;
                const requirement = `${threshold} Total Skill Level`;
                statsHtml.push(this.renderStatsFromObject(tslStats, isFine, requirement));
            }
        }

        // Skill level requirements
        if (gatedStats.skill_level) {
            for (const [skill, levels] of Object.entries(gatedStats.skill_level)) {
                for (const [level, skillStats] of Object.entries(levels)) {
                    const requirement = `${skill.charAt(0).toUpperCase() + skill.slice(1)} Level ${level}`;
                    statsHtml.push(this.renderStatsFromObject(skillStats, isFine, requirement));
                }
            }
        }

        // Activity completion requirements
        if (gatedStats.activity_completion) {
            for (const [activity, counts] of Object.entries(gatedStats.activity_completion)) {
                for (const [count, skillStats] of Object.entries(counts)) {
                    const requirement = `${count}+ ${activity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
                    statsHtml.push(this.renderStatsFromObject(skillStats, isFine, requirement));
                }
            }
        }

        // Set pieces requirements
        if (gatedStats.set_pieces) {
            for (const [setName, counts] of Object.entries(gatedStats.set_pieces)) {
                for (const [count, skillStats] of Object.entries(counts)) {
                    const requirement = `${count} ${setName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Equipped`;
                    statsHtml.push(this.renderStatsFromObject(skillStats, isFine, requirement));
                }
            }
        }

        return statsHtml;
    }

    /**
     * Render stats from a stats object
     * @param {Object} stats - Stats object {skill: {location: {stat: value}}}
     * @param {boolean} isFine - Whether these are fine stats
     * @param {string} requirement - Requirement text (empty for ungated stats)
     * @returns {Array} Array of HTML strings
     */
    renderStatsFromObject(stats, isFine, requirement) {
        const statsHtml = [];

        // Stats structure: {skill: {location: {stat: value}}}
        for (const [skill, locationStats] of Object.entries(stats)) {
            for (const [location, statsByLocation] of Object.entries(locationStats)) {
                for (const [statName, statValue] of Object.entries(statsByLocation)) {
                    // Format stat name
                    let formattedStatName;

                    // Handle ItemFindingCategory stats
                    if (statName.startsWith('ItemFindingCategory.')) {
                        const categoryConst = statName.split('.')[1];

                        // Try to get category info from window cache
                        if (window.itemFindingCategories && window.itemFindingCategories[categoryConst]) {
                            const category = window.itemFindingCategories[categoryConst];
                            const qtyText = category.min_qty === category.max_qty
                                ? category.min_qty
                                : `${category.min_qty} to ${category.max_qty}`;
                            formattedStatName = `Chance to find ${qtyText} ${category.display_name_singular}`;
                        } else {
                            // Fallback
                            const categoryName = categoryConst
                                .split('_')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                                .join(' ');
                            formattedStatName = `Chance to find ${categoryName.toLowerCase()}`;
                        }
                    } else {
                        // Regular stat formatting
                        formattedStatName = statName
                            .split('_')
                            .map(word => {
                                if (word.toLowerCase() === 'xp') {
                                    return 'XP';
                                }
                                return word.charAt(0).toUpperCase() + word.slice(1);
                            })
                            .join(' ');
                    }

                    // Format stat value
                    let formattedValue = statValue;
                    let valueClass = 'stat-value';

                    // ItemFindingCategory stats are always percentages
                    const isItemFinding = statName.startsWith('ItemFindingCategory.');

                    // Stats that should NOT have % (flat numbers)
                    const flatStats = [
                        'quality_outcome',
                        'inventory_space',
                        'bonus_xp_base',
                        'bonus_xp_add',
                        'steps_required',
                        'steps_add',
                        'flat_steps',
                        'bonus_experience_base',
                        'bonus_experience_add'
                    ];

                    // Stats where negative is good (should be green)
                    const negativeIsGood = [
                        'steps_add',
                        'steps_required',
                        'flat_steps',
                        'steps_pct',      // Percentage steps reduction (e.g., -5% is good)
                        'steps_percent'   // Percentage steps reduction (e.g., -1% is good)
                    ];

                    const isFlat = flatStats.includes(statName);
                    const negativeGood = negativeIsGood.includes(statName);

                    if (typeof statValue === 'number') {
                        // Determine if positive or negative
                        if (statValue > 0) {
                            // Positive value
                            if (negativeGood) {
                                valueClass = 'stat-value-negative';  // Red for positive steps (bad)
                            } else {
                                valueClass = 'stat-value-positive';  // Green for positive (good)
                            }
                            formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `+${statValue}%` : `+${statValue}`) : `+${statValue}%`;
                        } else if (statValue < 0) {
                            // Negative value
                            if (negativeGood) {
                                valueClass = 'stat-value-positive';  // Green for negative steps (good)
                            } else {
                                valueClass = 'stat-value-negative';  // Red for negative (bad)
                            }
                            formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `${statValue}%` : `${statValue}`) : `${statValue}%`;
                        } else {
                            formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `${statValue}%` : `${statValue}`) : `${statValue}%`;
                        }
                    }

                    // Determine condition text (skill/location context - always show)
                    const condition = formatCondition(skill, location);

                    // Check if requirement is satisfied
                    let requirementMet = false;

                    if (requirement) {
                        console.log('Checking requirement:', requirement);

                        // Parse requirement to check if met
                        if (requirement.includes('Achievement Points')) {
                            // Achievement Points requirement (e.g., "60 Achievement Points")
                            const match = requirement.match(/(\d+) Achievement Points/);
                            if (match) {
                                const reqAP = parseInt(match[1]);
                                const characterAP = store.state.character?.achievement_points || 0;
                                requirementMet = characterAP >= reqAP;
                                console.log(`  AP: char has ${characterAP} >= required ${reqAP}? ${requirementMet}`);
                            }
                        } else if (requirement.includes('Total Skill Level')) {
                            // Total skill level requirement (e.g., "100 Total Skill Level")
                            const match = requirement.match(/(\d+) Total Skill Level/);
                            if (match) {
                                const reqLevel = parseInt(match[1]);
                                const character = store.state.character || {};
                                const overrides = store.state.ui.user_overrides || {};

                                let totalLevel = 0;
                                if (overrides.skills && Object.keys(overrides.skills).length > 0) {
                                    const baseSkills = character.skills || {};
                                    const allSkills = new Set([...Object.keys(baseSkills), ...Object.keys(overrides.skills)]);
                                    for (const s of allSkills) {
                                        totalLevel += (overrides.skills[s] !== undefined ? overrides.skills[s] : (baseSkills[s] || 0));
                                    }
                                } else {
                                    totalLevel = character.total_skill_level || Object.values(character.skills || {}).reduce((a, b) => a + b, 0);
                                }

                                requirementMet = totalLevel >= reqLevel;
                            }
                        } else if (requirement.includes('Level')) {
                            // Skill level requirement (e.g., "Crafting Level 50")
                            const match = requirement.match(/(\w+) Level (\d+)/);
                            if (match) {
                                const reqSkill = match[1].toLowerCase();
                                const reqLevel = parseInt(match[2]);
                                const character = store.state.character || {};
                                const overrides = store.state.ui.user_overrides || {};

                                // Get skill level - check override first, then character
                                const overrideLevel = overrides.skills?.[reqSkill];
                                const characterLevel = character.skills?.[reqSkill];
                                const charLevel = overrideLevel !== undefined ? overrideLevel : (characterLevel || 1);

                                requirementMet = charLevel >= reqLevel;
                                console.log(`  Skill ${reqSkill}: char level ${charLevel} >= required ${reqLevel}? ${requirementMet}`);
                            }
                        } else if (requirement.includes('+')) {
                            // Activity completion requirement (e.g., "50+ Underwater Basket Weaving")
                            const match = requirement.match(/(\d+)\+ (.+)/);
                            if (match) {
                                const reqCount = parseInt(match[1]);
                                const activity = match[2].toLowerCase().replace(/ /g, '_');
                                const customStats = store.state.ui.custom_stats || {};
                                const overrides = store.state.ui.user_overrides || {};
                                const allCustomStats = { ...customStats, ...(overrides.custom_stats || {}) };

                                // Check custom stats for activity completion
                                const customStatKey = `screwdriver_${activity}`;
                                requirementMet = allCustomStats[customStatKey] === true;
                            }
                        }
                    }

                    // Add fine class to stat name if showing fine stats
                    const statNameClass = isFine ? 'stat-name stat-name-fine' : 'stat-name';

                    // Add dimming if gated and not met
                    const statRowClass = requirement ? (requirementMet ? 'stat-row stat-row-gated' : 'stat-row stat-row-gated stat-row-gated-unmet') : 'stat-row';
                    const gateClass = requirement && !requirementMet ? 'stat-gate stat-gate-unmet' : 'stat-gate';

                    statsHtml.push(`
                        <div class="${statRowClass}">
                            <span class="${valueClass}">${formattedValue}</span>
                            <span class="${statNameClass}">${formattedStatName}</span>
                            <span class="stat-condition">${condition}</span>
                            ${requirement ? `<div class="${gateClass}">${requirement}</div>` : ''}
                        </div>
                    `);
                }
            }
        }

        return statsHtml.join('');
    }
}

export default ItemRow;
