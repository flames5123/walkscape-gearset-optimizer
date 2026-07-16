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
import api from '../api.js';
import { getPetIconPath, getPetStageLabel, getPetVariants } from '../utils/pet-utils.js';
import { ownedCountLabel } from '../utils/owned-quantity.js';
import { renderRequirementsRow } from '../utils/requirements.js';
import { wikiDarkModeSuffix } from '../utils/wiki-link.js';
import { switchToTab } from '../pull-to-refresh.js';

import { formatFixed } from '../utils/number-format.js';

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
            ring_quantity: overrideItemState.ring_quantity !== undefined ? overrideItemState.ring_quantity : baseItemState.ring_quantity,
            level: overrideItemState.level !== undefined ? overrideItemState.level : (baseItemState.level !== undefined ? baseItemState.level : 0),
            variant: overrideItemState.variant !== undefined ? overrideItemState.variant : (baseItemState.variant || 'normal'),
            petName: overrideItemState.petName !== undefined ? overrideItemState.petName : (baseItemState.petName || '')
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

        // For crafted items (type === 'crafted_item' or generic crafted), use quality from state
        const isCraftedType = this.props.item.type === 'crafted_item' || (this.props.item.is_generic && this.props.item.is_crafted);
        if (isCraftedType) {
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

        // Determine if item is hidden (for eye icon and dimming)
        const isMat = this.props.item.type === 'material' || this.props.item.type === 'consumable';
        const hasFineVar = this.props.item.has_fine;
        const isRing = this.props.item.slot === 'ring' && (this.props.item.type === 'crafted_item' || (this.props.item.is_generic && this.props.item.is_crafted));
        let isHidden;
        if (isRing) {
            isHidden = !!(itemState.hide_ring1 && itemState.hide_ring2);
        } else if (isMat && hasFineVar) {
            isHidden = !!(itemState.hide && itemState.hide_fine);
        } else {
            isHidden = !!itemState.hide;
        }
        const dimClass = isHidden ? 'item-row-hidden' : '';
        const hiddenClass = isHidden ? 'is-hidden' : '';
        const eyeHtml = `<svg class="eye-icon eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><svg class="eye-icon eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2 5 5.5 8 10 8s8-3 10-8"/><path d="M7 16l-1 2"/><path d="M12 18v2"/><path d="M17 16l1 2"/></svg>`;

        const html = `
            <div class="item-row ${rarity} ${dimClass}" data-item="${this.props.item.id}">
                <div class="item-row-main">
                    ${this.renderCheckboxes(itemState)}
                    ${this.renderIcon(itemState)}
                    <div class="item-info">
                        <span class="item-name">${this.props.item.name}</span>
                        ${this.props.item.type === 'pet' ? this.renderPetLevelDropdown(itemState) : ''}
                        ${this.props.showQuality ? this.renderQualityDropdown(itemState) : ''}
                    </div>
                    <button class="eye-btn ${hiddenClass}" title="${isHidden ? 'Show in optimizer' : 'Hide from optimizer'}">${eyeHtml}</button>
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
        const isNonCraftedRing = this.props.item.slot === 'ring' && this.props.item.type !== 'crafted_item' && !(this.props.item.is_generic && this.props.item.is_crafted) && !isAchievementReward;

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
        // Pets have their own details renderer
        if (this.props.item.type === 'pet') {
            return this.renderPetDetails(itemState);
        }

        const isMaterialOrConsumable = this.props.item.type === 'material' || this.props.item.type === 'consumable';
        const hasFine = this.props.item.has_fine;
        const isRing = this.props.item.slot === 'ring' && (this.props.item.type === 'crafted_item' || (this.props.item.is_generic && this.props.item.is_crafted));

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

        // Generate wiki URL + edit button for generic items, or just wiki link for wiki items
        let actionLinkHtml;
        if (this.props.item.is_generic) {
            const wikiName = this.props.item.name.replace(/ /g, '_');
            const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;
            actionLinkHtml = `
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
                <button class="btn-source-dropdown" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>
                <button class="btn-edit-generic-item optimize-btn" data-item-id="${this.props.item.generic_id || this.props.item.id}">🔧 Edit</button>`;
        } else {
            const wikiName = this.props.item.name.replace(/ /g, '_');
            const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;
            actionLinkHtml = `
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
                <button class="btn-source-dropdown" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>`;
        }

        // "N owned" line — same data source + gating as the notepad/drop
        // popover, via the shared ownedCountLabel helper. Only shown once a
        // character has been imported; a missing key then means 0 owned.
        // Matches the popover's wording so column 1 and the hover bubbles
        // read the same.
        let ownedHtml = '';
        const ownedQuantities = (store.state.character && store.state.character.owned_quantities) || null;
        const ownedText = ownedCountLabel(ownedQuantities, this.props.item.id);
        if (ownedText) {
            ownedHtml = `<div class="item-owned-count pet-xp-info">${ownedText}</div>`;
        }

        return `
            <div class="item-details">
                ${ownedHtml}
                <div class="item-action-links">
                    ${actionLinkHtml}
                </div>
                <div class="source-dropdown-container" style="display: none;"></div>
                ${hideCheckboxesHtml}
                ${renderRequirementsRow(this.props.item.requirements)}
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
     * Render level dropdown for pets
     * @param {Object} itemState - Current item state
     * @returns {string} HTML for pet level dropdown + custom name input
     */
    renderPetLevelDropdown(itemState) {
        const levels = this.props.item.levels || {};
        const maxLevel = this.props.item.max_level || 0;
        const currentLevel = itemState.level || 0;
        const currentVariant = itemState.variant || 'normal';
        const currentPetName = itemState.petName || '';

        const levelOptions = [];
        levelOptions.push(`<option value="0" ${currentLevel === 0 ? 'selected' : ''}>Lv 0: Egg</option>`);
        for (let i = 1; i <= maxLevel; i++) {
            const stage = getPetStageLabel(i, maxLevel);
            levelOptions.push(`<option value="${i}" ${currentLevel === i ? 'selected' : ''}>Lv ${i}: ${stage}</option>`);
        }

        // Colour-variant dropdown — omitted for single-colour pets (e.g. Pixie),
        // which have only the 'normal' variant. Variant defaults to 'normal'.
        const variants = getPetVariants(this.props.item);
        const variantSelectHtml = variants.length > 1
            ? `<select class="pet-variant-select quality-dropdown">${variants.map(v =>
                `<option value="${v}" ${v === currentVariant ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`
              ).join('')}</select>`
            : '';

        // Only show name input for non-eggs (level > 0)
        const nameInputHtml = currentLevel > 0
            ? `<input type="text" class="pet-name-input quality-dropdown" placeholder="Custom name…" value="${currentPetName.replace(/"/g, '&quot;')}" style="min-width:80px;max-width:120px">`
            : '';

        return `
            <div class="pet-dropdowns" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
                <select class="pet-level-select quality-dropdown">
                    ${levelOptions.join('')}
                </select>
                ${variantSelectHtml}
                ${nameInputHtml}
            </div>
        `;
    }

    /**
     * Render pet-specific expanded details
     * @param {Object} itemState - Current item state
     * @returns {string} HTML for pet details
     */
    renderPetDetails(itemState) {
        const levels = this.props.item.levels || {};
        const currentLevel = itemState.level || 0;
        const levelData = levels[String(currentLevel)];

        const wikiName = this.props.item.name.replace(/ /g, '_');
        const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName)}${wikiDarkModeSuffix()}`;

        let detailsHtml = `
            <div class="item-details">
                <div class="item-action-links">
                    <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
                    <button class="btn-source-dropdown" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>
                </div>
                <div class="source-dropdown-container" style="display: none;"></div>
                <label class="hide-checkbox">
                    <input type="checkbox" ${itemState.hide ? 'checked' : ''}>
                    Hide
                </label>
        `;

        if (currentLevel === 0) {
            // Egg state — show XP to hatch
            const level1Data = levels['1'];
            if (level1Data) {
                detailsHtml += `<div class="pet-xp-info">XP to hatch: ${(level1Data.xp_required || 0).toLocaleString()}</div>`;
                if (level1Data.requirement_to_gain_xp) {
                    detailsHtml += `<div class="pet-requirement">${level1Data.requirement_to_gain_xp}</div>`;
                }
            }
        } else if (levelData) {
            // Show level info
            if (levelData.xp_required) {
                detailsHtml += `<div class="pet-xp-info">XP required: ${levelData.xp_required.toLocaleString()}</div>`;
            }
            if (levelData.requirement_to_gain_xp) {
                detailsHtml += `<div class="pet-requirement">${levelData.requirement_to_gain_xp}</div>`;
            }

            // Stats
            if (levelData.stats && Object.keys(levelData.stats).length > 0) {
                detailsHtml += `<div class="stats">${this.renderStatsForVersion(levelData.stats, false)}</div>`;
            }

            // Abilities
            if (levelData.abilities && levelData.abilities.length > 0) {
                detailsHtml += `<div class="pet-abilities"><div class="pet-abilities-header">Abilities</div>`;
                for (const ability of levelData.abilities) {
                    // Build a clean effect display from structured data when available
                    let effectHtml = '';
                    if (ability.ability_stats && Object.keys(ability.ability_stats).length > 0) {
                        // Structured stats available — render cleanly
                        const effectLines = [];
                        // Extract flavor text (everything before "Effect lasts for")
                        const rawEffect = ability.effect || '';
                        const flavorMatch = rawEffect.match(/^(.+?)(?:Effect lasts for|$)/i);
                        if (flavorMatch && flavorMatch[1]) {
                            const flavor = flavorMatch[1].trim().replace(/\.$/, '');
                            if (flavor) effectLines.push(flavor);
                        }
                        if (ability.duration) {
                            effectLines.push(`Effect lasts for ${ability.duration} ${ability.duration_unit || 'actions'}`);
                        }
                        // Render each stat as a line
                        for (const [skill, locations] of Object.entries(ability.ability_stats)) {
                            for (const [location, stats] of Object.entries(locations)) {
                                for (const [stat, value] of Object.entries(stats)) {
                                    const statName = stat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                                    const sign = value > 0 ? '+' : '';
                                    const isFlat = stat.includes('_add') || stat.includes('inventory');
                                    const suffix = isFlat ? '' : '%';
                                    const skillLabel = skill === 'global' ? '' : ` While doing ${skill.charAt(0).toUpperCase() + skill.slice(1)}`;
                                    const locLabel = location === 'global' ? '' : ` in ${location}`;
                                    effectLines.push(`${sign}${value}${suffix} ${statName}${skillLabel}${locLabel}`);
                                }
                            }
                        }
                        effectHtml = effectLines.map(l => `<div>${l}</div>`).join('');
                    } else {
                        // No structured stats — clean up raw effect text
                        let cleanEffect = (ability.effect || '')
                            .replace(/\.(?=[A-Z+\-])/g, '.\n')  // Add newline after periods before caps/signs
                            .replace(/Effect lasts for:\s*(\d+)/g, `Effect lasts for $1 ${ability.duration_unit || 'actions'}`);
                        effectHtml = cleanEffect.split('\n').map(l => `<div>${l.trim()}</div>`).join('');
                    }

                    // Clean up cooldown text
                    let cooldownHtml = '';
                    if (ability.cooldown) {
                        let cooldown = ability.cooldown;
                        // Format item-charged cooldowns nicely
                        if (cooldown.includes('charged by using items')) {
                            const chargeMatch = cooldown.match(/requires.*?(\d+)/);
                            const chargeNeeded = chargeMatch ? chargeMatch[1] : '?';
                            const items = [];
                            // Match "N gained from ItemName" — stop before next digit or end of string
                            const itemRegex = /(\d+)\s+gained from\s+([A-Z][a-z][\w\s]*?)(?=\s+\d+\s+gained|\s*$)/g;
                            let m;
                            while ((m = itemRegex.exec(cooldown)) !== null) {
                                items.push({ qty: m[1], name: m[2].trim() });
                            }
                            const drIcon = '/assets/icons/attributes/double_rewards.svg';
                            const inlineIcon = `<img src="${drIcon}" style="width:14px;height:14px;vertical-align:middle" alt="charge">`;
                            cooldownHtml = `<div class="pet-ability-meta">Charged by items. One full charge requires ${inlineIcon} <strong>${chargeNeeded}</strong></div>`;
                            if (items.length) {
                                for (const item of items) {
                                    cooldownHtml += `<div class="pet-ability-meta pet-ability-items">${inlineIcon} <strong>${item.qty}</strong> gained from ${item.name}</div>`;
                                }
                            }
                        } else {
                            cooldownHtml = `<div class="pet-ability-meta">Cooldown: ${cooldown}</div>`;
                        }
                    }

                    const abIcon = ability.icon
                        ? `<img src="/assets/icons/abilities/${ability.icon}.svg" class="pet-ability-icon" width="32" height="32" style="vertical-align:middle;margin-right:6px" alt="" onerror="this.style.display='none'">`
                        : '';
                    detailsHtml += `
                        <div class="pet-ability">
                            <span class="pet-ability-name">${abIcon}${ability.name || 'Unknown'}</span>
                            <div class="pet-ability-effect">${effectHtml}</div>
                            ${cooldownHtml}
                            ${ability.charges ? `<div class="pet-ability-meta">Charges: ${ability.charges}</div>` : ''}
                        </div>
                    `;
                }
                detailsHtml += `</div>`;
            }
        }

        detailsHtml += `</div>`;
        return detailsHtml;
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
            // 2026-05-29: ownership change must trigger stats-report stale
            // recompute. Without this, ticking a chest_finding item
            // wouldn't bubble up as a `!` badge on recipe rows.
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange();
        });

        // Ring quantity dropdown - update quantity for non-crafted rings
        this.$element.on('change', '.ring-quantity-dropdown', (e) => {
            const quantity = parseInt(e.target.value);
            store.update(`ui.user_overrides.items.${this.props.item.id}.ring_quantity`, quantity);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange();
        });

        // Fine checkbox - toggle fine ownership (store as user override)
        this.$element.on('change', '.has-checkbox-fine', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.has_fine`, e.target.checked);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange();
        });

        // Hide checkbox (normal) - toggle visibility in optimization (store as user override)
        this.$element.on('change', '.hide-checkbox input:not(.hide-checkbox-fine):not(.hide-checkbox-ring1):not(.hide-checkbox-ring2)', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide`, e.target.checked);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange();
        });

        // Hide checkbox (fine) - toggle fine visibility in optimization (store as user override)
        this.$element.on('change', '.hide-checkbox-fine', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_fine`, e.target.checked);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange();
        });

        // Hide checkbox (ring1) - toggle ring1 visibility in optimization
        this.$element.on('change', '.hide-checkbox-ring1', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_ring1`, e.target.checked);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange({immediate: true});
        });

        // Hide checkbox (ring2) - toggle ring2 visibility in optimization
        this.$element.on('change', '.hide-checkbox-ring2', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.hide_ring2`, e.target.checked);
            if (window.statsReportBroadcastStateChange) window.statsReportBroadcastStateChange({immediate: true});
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

        // Pet level dropdown - update pet level (store as user override)
        this.$element.on('change', '.pet-level-select', (e) => {
            const newLevel = parseInt(e.target.value);
            store.update(`ui.user_overrides.items.${this.props.item.id}.level`, newLevel);
        });

        // Pet variant dropdown - update pet color variant (store as user override)
        this.$element.on('change', '.pet-variant-select', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.variant`, e.target.value);
        });

        // Pet name input - update custom pet name (store as user override, on blur/enter)
        this.$element.on('change', '.pet-name-input', (e) => {
            store.update(`ui.user_overrides.items.${this.props.item.id}.petName`, e.target.value);
        });

        // Generic item edit button
        this.$element.on('click', '.btn-edit-generic-item', (e) => {
            e.stopPropagation();
            const itemId = $(e.currentTarget).data('item-id');
            const items = store.state.genericItems || [];
            const item = items.find(i => i.id === itemId);
            if (item) {
                import('./generic-item-form.js').then(mod => mod.default.show(item));
            }
        });

        // Source dropdown toggle
        this.$element.on('click', '.btn-source-dropdown', (e) => {
            e.stopPropagation();
            const $container = this.$element.find('.source-dropdown-container');
            const $arrow = $(e.currentTarget).find('.source-arrow');
            if ($container.is(':visible')) {
                $arrow.removeClass('open');
                $container.slideUp(150);
                return;
            }
            $arrow.addClass('open');
            // Load sources and render, then scroll to fit
            this._loadAndRenderSources($container).then(() => {
                this._scrollToFitIfNeeded();
            });
        });

        // Source item click - select activity or recipe
        this.$element.on('click', '.source-item', (e) => {
            e.stopPropagation();
            const $el = $(e.currentTarget);
            if ($el.hasClass('source-item-no-click')) return;
            const sourceType = $el.data('source-type');
            const sourceId = $el.data('source-id');
            // For pets, use egg name for drop table matching
            const itemName = (this.props.item.type === 'pet' && this.props.item.egg_name)
                ? this.props.item.egg_name : this.props.item.name;

            if (sourceType === 'activity_drop') {
                // Select the activity
                if (window.activitySelector) {
                    window.activitySelector.selectActivity(sourceId);
                } else {
                    store.state.column3 = store.state.column3 || {};
                    store.state.column3.selectedActivity = sourceId;
                    store.state.column3.selectedRecipe = null;
                    store._notifySubscribers('column3.selectedActivity');
                    store._notifySubscribers('column3.selectedRecipe');
                    store._saveColumn3Selection();
                }
                // Set the target drop to this item after a short delay (wait for drop table to load)
                setTimeout(() => {
                    if (window.optimizeButton) {
                        // Try exact name first, then fine version
                        window.optimizeButton.targetDrop = itemName;
                        store.update('ui.column3.targetDrop', itemName);
                        window.optimizeButton.render();
                    }
                }, 500);
            } else if (sourceType === 'recipe_output' || sourceType === 'recipe_input' || sourceType === 'recipe_drop') {
                // Select the recipe
                if (window.recipeSelector) {
                    window.recipeSelector.selectRecipe(sourceId);
                } else {
                    store.state.column3 = store.state.column3 || {};
                    store.state.column3.selectedRecipe = sourceId;
                    store.state.column3.selectedActivity = null;
                    store._notifySubscribers('column3.selectedRecipe');
                    store._notifySubscribers('column3.selectedActivity');
                    store._saveColumn3Selection();
                }
            }

            // Navigate to column 3 — on mobile, swap tab with animation; on desktop, scroll
            if (window.innerWidth <= 768) {
                // Mobile: use switchToTab for proper column swap animation
                if (typeof switchToTab === 'function') {
                    switchToTab(2); // column-3 is index 2
                }
                // After tab switch, scroll column 3 to the top (activity/recipe selectors)
                setTimeout(() => {
                    const col3 = document.getElementById('column-3');
                    if (col3) col3.scrollTop = 0;
                }, 250);
            } else {
                // Desktop: scroll column 3's .column-content to show activity/recipe selectors
                const col3 = document.getElementById('column-3');
                if (col3) {
                    const scrollable = col3.querySelector('.column-content') || col3;
                    scrollable.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
        });

        // Eye button - toggle hide state (surgical DOM update, no full re-render)
        this.$element.on('click', '.eye-btn', (e) => {
            e.stopPropagation();
            const itemId = this.props.item.id;
            const itemState = this.getCurrentItemState();
            const isMat = this.props.item.type === 'material' || this.props.item.type === 'consumable';
            const hasFineVar = this.props.item.has_fine;
            const isRing = this.props.item.slot === 'ring' && (this.props.item.type === 'crafted_item' || (this.props.item.is_generic && this.props.item.is_crafted));

            let newHide;
            if (isRing) {
                // Toggle both ring qualities — hidden if EITHER is hidden (toggle to all-show or all-hide)
                newHide = !(itemState.hide_ring1 || itemState.hide_ring2);
                store.update(`ui.user_overrides.items.${itemId}.hide_ring1`, newHide);
                store.update(`ui.user_overrides.items.${itemId}.hide_ring2`, newHide);
            } else if (isMat && hasFineVar) {
                // Toggle both normal and fine — hidden if EITHER is hidden
                newHide = !(itemState.hide || itemState.hide_fine);
                store.update(`ui.user_overrides.items.${itemId}.hide`, newHide);
                store.update(`ui.user_overrides.items.${itemId}.hide_fine`, newHide);
            } else {
                newHide = !itemState.hide;
                store.update(`ui.user_overrides.items.${itemId}.hide`, newHide);
            }

            // Surgical DOM update — just toggle classes (CSS handles crossfade + dim)
            const $btn = $(e.currentTarget);
            const $row = this.$element.find('.item-row');
            $btn.toggleClass('is-hidden', newHide);
            $btn.attr('title', newHide ? 'Show in optimizer' : 'Hide from optimizer');
            $row.toggleClass('item-row-hidden', newHide);

            // Also update hide checkboxes in expanded details if visible
            if (this.expanded) {
                if (isRing) {
                    this.$element.find('.hide-checkbox-ring1').prop('checked', newHide);
                    this.$element.find('.hide-checkbox-ring2').prop('checked', newHide);
                } else if (isMat && hasFineVar) {
                    this.$element.find('.hide-checkbox-normal').prop('checked', newHide);
                    this.$element.find('.hide-checkbox-fine').prop('checked', newHide);
                } else {
                    this.$element.find('.hide-checkbox input').prop('checked', newHide);
                }
            }
        });

        // Expand button - toggle details view with animation
        this.$element.on('click', '.expand-btn', () => {
            this._toggleExpand();
        });

        // Clicking the item name/info area also toggles expand (like the gear popup)
        this.$element.on('click', '.item-info', (e) => {
            // Don't toggle if clicking a dropdown or input inside item-info
            if ($(e.target).closest('select, input, .quality-dropdown').length) return;
            this._toggleExpand();
        });
    }

    /**
     * Toggle the expand/collapse state of the item details panel.
     */
    _toggleExpand() {
        this.expanded = !this.expanded;

        // Toggle the .expanded class on the existing arrow span so the CSS
        // `transition: transform 0.2s ease-in-out` actually fires (matching
        // every other expand-arrow in the app -- category headers, settings
        // sections, tree dropdowns, etc.). Replacing the span with .html()
        // skips the transition because new elements render at their final
        // transform value.
        const $arrow = this.$element.find('.expand-btn .expand-arrow');
        $arrow.toggleClass('expanded', this.expanded);

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

            // Animate in, then scroll to fit if near bottom
            this.$element.find('.item-details').hide().slideDown(200, () => {
                this._scrollToFitIfNeeded();
            });
        } else {
            // Animate out and remove
            $details.slideUp(200, () => {
                $details.remove();
            });
        }
    }

    /**
     * Scroll the column container so this item row is visible after expanding.
     * If the expanded content pushes below the viewport, scroll up so the
     * item row header sits near the top.
     */
    _scrollToFitIfNeeded() {
        // On mobile, .column scrolls; on desktop, .column-content scrolls
        let $scrollContainer = this.$element.closest('.column-content');
        if (!$scrollContainer.length || $scrollContainer[0].scrollHeight <= $scrollContainer[0].clientHeight) {
            $scrollContainer = this.$element.closest('.column');
        }
        if (!$scrollContainer.length) return;

        const scrollContainer = $scrollContainer[0];
        const rowEl = this.$element[0];
        if (!rowEl) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();

        // If the row top is in the bottom 40% of the visible area, scroll up
        const rowRelativeTop = rowRect.top - containerRect.top;
        const viewportHeight = containerRect.height;

        if (rowRelativeTop > viewportHeight * 0.6) {
            const targetScrollTop = scrollContainer.scrollTop + rowRelativeTop - 80;
            $scrollContainer.animate({ scrollTop: targetScrollTop }, 200);
        }
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
            ring_quantity: overrideItemState.ring_quantity !== undefined ? overrideItemState.ring_quantity : baseItemState.ring_quantity,
            level: overrideItemState.level !== undefined ? overrideItemState.level : (baseItemState.level !== undefined ? baseItemState.level : 0),
            variant: overrideItemState.variant !== undefined ? overrideItemState.variant : (baseItemState.variant || 'normal'),
            petName: overrideItemState.petName !== undefined ? overrideItemState.petName : (baseItemState.petName || '')
        };
    }

    /**
     * Load item sources from API and render the dropdown
     * @param {jQuery} $container - The container element to render into
     */
    async _loadAndRenderSources($container) {
        $container.html('<div class="source-loading">Loading sources...</div>').slideDown(150);

        try {
            const data = await api.getItemSources();
            // For pets, look up by egg name (e.g., "Chicken egg") since that's what appears in drop tables
            const lookupName = (this.props.item.type === 'pet' && this.props.item.egg_name)
                ? this.props.item.egg_name : this.props.item.name;
            const itemName = lookupName.toLowerCase().trim();
            const sources = data.sources[itemName] || [];

            if (sources.length === 0) {
                $container.html('<div class="source-empty">No sources found</div>');
                return;
            }

            // Group sources by type
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
                    html += `
                        <div class="source-item" data-source-type="activity_drop" data-source-id="${src.id}" title="Click to select this activity">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-activity">Activity</span>
                            </div>
                            <div class="source-item-details">
                                <span>${src.skill} Lv.${src.level}</span>
                                <span>${src.base_steps || '?'} steps</span>
                                <span>Drop: ${dropRate}${secondary}</span>
                            </div>
                        </div>`;
                }
            }

            if (itemFindingDrops.length > 0) {
                html += '<div class="source-group-header">Item Finding</div>';
                for (const src of itemFindingDrops) {
                    const chance = src.chance_in_category != null ? `${src.chance_in_category}% in category` : '';
                    html += `
                        <div class="source-item source-item-no-click" title="Dropped via ${src.category} item finding gear">
                            <div class="source-item-main">
                                <span class="source-name">${src.category}</span>
                                <span class="source-badge source-badge-item-finding">Item Finding</span>
                            </div>
                            ${chance ? `<div class="source-item-details"><span>${chance}</span></div>` : ''}
                        </div>`;
                }
            }

            if (recipeDrops.length > 0) {
                html += '<div class="source-group-header">Dropped while crafting</div>';
                for (const src of recipeDrops) {
                    const dropRate = src.drop_rate != null ? `${src.drop_rate}%` : '?%';
                    html += `
                        <div class="source-item" data-source-type="recipe_drop" data-source-id="${src.id}" title="Click to select this recipe">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-recipe-drop">Recipe Drop</span>
                            </div>
                            <div class="source-item-details">
                                <span>${src.skill} Lv.${src.level}</span>
                                <span>${src.base_steps || '?'} steps</span>
                                <span>Drop: ${dropRate}</span>
                            </div>
                        </div>`;
                }
            }

            if (recipeOutputs.length > 0) {
                html += '<div class="source-group-header">Crafted by</div>';
                for (const src of recipeOutputs) {
                    html += `
                        <div class="source-item" data-source-type="recipe_output" data-source-id="${src.id}" title="Click to select this recipe">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-recipe">Recipe</span>
                            </div>
                            <div class="source-item-details">
                                <span>${src.skill} Lv.${src.level}</span>
                                <span>${src.base_steps || '?'} steps</span>
                            </div>
                        </div>`;
                }
            }

            if (recipeInputs.length > 0) {
                html += '<div class="source-group-header">Used in</div>';
                for (const src of recipeInputs) {
                    html += `
                        <div class="source-item" data-source-type="recipe_input" data-source-id="${src.id}" title="Click to select this recipe">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-recipe-input">Input</span>
                            </div>
                            <div class="source-item-details">
                                <span>${src.skill} Lv.${src.level}</span>
                                <span>${src.base_steps || '?'} steps</span>
                                <span>${src.quantity || 1}x needed</span>
                            </div>
                        </div>`;
                }
            }

            if (shopSources.length > 0) {
                html += '<div class="source-group-header">Sold at</div>';
                for (const src of shopSources) {
                    html += `
                        <div class="source-item source-item-no-click" title="${src.name} in ${src.location}">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-shop">Shop</span>
                            </div>
                            <div class="source-item-details">
                                <span>${src.location}</span>
                                <span>${src.price_display}</span>
                                ${src.stock > 1 ? `<span>Stock: ${src.stock}</span>` : ''}
                            </div>
                        </div>`;
                }
            }

            const chestSources = sources.filter(s => s.type === 'container_drop');
            if (chestSources.length > 0) {
                html += '<div class="source-group-header">Found in chests</div>';
                for (const src of chestSources) {
                    const rarityClass = src.rarity ? `rarity-${src.rarity}` : '';
                    const rarityLabel = src.rarity
                        ? src.rarity.charAt(0).toUpperCase() + src.rarity.slice(1)
                        : 'Main';
                    const rolls = src.rolls_per_chest || 4;
                    let chestPct = null;
                    if (src.drop_rate != null) {
                        chestPct = (1 - Math.pow(1 - src.drop_rate / 100, rolls)) * 100;
                    }
                    const dropRate = chestPct != null ? `${formatFixed(chestPct, 3)}%` : '?%';
                    const qty = src.quantity && src.quantity !== '1' ? `${src.quantity}x` : '';
                    html += `
                        <div class="source-item source-item-no-click source-item-chest">
                            <div class="source-item-main">
                                <span class="source-name">${src.name}</span>
                                <span class="source-badge source-badge-chest ${rarityClass}">${rarityLabel}</span>
                            </div>
                            <div class="source-item-details">
                                <span>Chance per chest: ${dropRate}</span>
                                ${qty ? `<span>${qty}</span>` : ''}
                            </div>
                        </div>`;
                }
            }

            html += '</div>';
            $container.html(html);
        } catch (err) {
            console.error('Failed to load item sources:', err);
            $container.html('<div class="source-empty">Failed to load sources</div>');
        }
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
     * Render the item icon (SVG for wiki items, emoji for generic items)
     * @param {Object} itemState - Current item state
     * @returns {string} HTML string for icon
     */
    renderIcon(itemState) {
        if (this.props.item.is_generic) {
            // Generic items with icon_path use SVG/PNG image
            if (this.props.item.icon_path) {
                const rarity = this.props.item.rarity || 'common';
                const fineClass = itemState.has_fine ? ' fine' : '';
                return `<img src="${this.props.item.icon_path}" 
                             class="item-icon rarity-${rarity}${fineClass}" 
                             alt="${this.props.item.name}"
                             onerror="this.style.display='none'"
                             loading="lazy">`;
            }
            // Generic items use emoji icons with color tinting
            const icon = this.props.item.icon || '⚡';
            const iconColor = this.props.item.icon_color;
            const rarity = this.props.item.rarity || 'common';
            const fineClass = itemState.has_fine ? ' fine' : '';
            return `<span class="item-icon item-icon-emoji rarity-${rarity}${fineClass}">${window.tintedEmoji(icon, iconColor)}</span>`;
        }
        // Pets use level-based icons. Eggs (level 0) render at their native 32px;
        // juvenile/adult render at their native 48px viewBox.
        if (this.props.item.type === 'pet') {
            const petLevel = itemState.level || 0;
            const petSize = petLevel === 0 ? 32 : 48;
            const iconPath = getPetIconPath(this.props.item.name, petLevel, itemState.variant || 'normal', this.props.item.max_level || 0);
            return `<img src="${iconPath}" 
                         class="item-icon pet-icon-scaled" 
                         style="width:${petSize}px;height:${petSize}px"
                         alt="${this.props.item.name}"
                         onerror="this.src='${this.props.item.icon_path || '/assets/icons/items/pet_eggs/unknown_egg.svg'}'"
                         loading="lazy">`;
        }
        // Wiki items use SVG images
        return `<img src="${this.getIconPath()}" 
                     class="${this.getIconClasses(itemState)}" 
                     alt="${this.props.item.name}"
                     loading="lazy">`;
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
        const isCraftedItem = this.props.item.type === 'crafted_item' || (this.props.item.is_generic && this.props.item.is_crafted);
        const statsByQuality = this.props.item.stats_by_quality || this.props.item.quality_stats;
        if (this.props.item.slot === 'ring' && isCraftedItem) {
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
            const ring1Stats = statsByQuality?.[ring1QualityName] || {};

            // Add header for ring 1
            if (Object.keys(ring1Stats).length > 0) {
                statsHtml.push(`<div class="ring-stats-header">${ring1QualityName}</div>`);
                statsHtml.push(this.renderStatsForVersion(ring1Stats, false));
            }

            // Get stats for ring 2 if not "None"
            if (ring2QualityName) {
                const ring2Stats = statsByQuality?.[ring2QualityName] || {};

                if (Object.keys(ring2Stats).length > 0) {
                    statsHtml.push(`<div class="ring-stats-header">${ring2QualityName}</div>`);
                    statsHtml.push(this.renderStatsForVersion(ring2Stats, false));
                }
            }

            return statsHtml.join('');
        }

        // For crafted items, get stats for the selected quality
        let stats = this.props.item.stats;
        if (isCraftedItem && statsByQuality) {
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
            stats = statsByQuality[qualityName] || {};
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
                const requirement = `${threshold} Achievement Points`;
                statsHtml.push(this.renderStatsFromObject(apStats, isFine, requirement));
            }
        }

        // Obtained-collectibles requirements (e.g. Collection ring: cumulative
        // tiers at 10/20/30/40/50/60 collectibles owned).
        if (gatedStats.total_collectibles) {
            for (const [threshold, tcStats] of Object.entries(gatedStats.total_collectibles)) {
                const requirement = `${threshold} Obtained Collectibles`;
                statsHtml.push(this.renderStatsFromObject(tcStats, isFine, requirement));
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

        // Travel steps requirements
        if (gatedStats.travel_steps) {
            for (const [threshold, travelStats] of Object.entries(gatedStats.travel_steps)) {
                const formattedThreshold = parseInt(threshold).toLocaleString();
                const requirement = `${formattedThreshold} Travel Steps`;
                statsHtml.push(this.renderStatsFromObject(travelStats, isFine, requirement));
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
                    if (!statName || statName === 'undefined') continue;
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
                        'bonus_experience_add',
                        'foraging_base_xp'
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
                        } else if (requirement.includes('Obtained Collectibles')) {
                            // Obtained-collectibles requirement (e.g. "10 Obtained
                            // Collectibles" — Collection ring). character.collectibles
                            // is the ARRAY of owned collectible IDs, so count via length.
                            const match = requirement.match(/(\d+) Obtained Collectibles/);
                            if (match) {
                                const reqCount = parseInt(match[1]);
                                const coll = store.state.character?.collectibles;
                                const owned = Array.isArray(coll) ? coll.length : (coll || 0);
                                requirementMet = owned >= reqCount;
                                console.log(`  Collectibles: char has ${owned} >= required ${reqCount}? ${requirementMet}`);
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
                        } else if (requirement.includes('Travel Steps')) {
                            // Travel steps requirement (e.g., "125,000 Travel Steps")
                            const match = requirement.match(/([\d,]+) Travel Steps/);
                            if (match) {
                                const threshold = match[1].replace(/,/g, '');
                                const itemName = this.props.item.name.toLowerCase().replace(/ /g, '_').replace(/'/g, '');
                                const customStatKey = `${itemName}_travel_steps_${threshold}`;
                                const customStats = store.state.ui?.custom_stats || {};
                                requirementMet = customStats[customStatKey] === true;
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
