/**
 * Drop Item Popover — shows item stats when hovering/clicking a drop icon in the drops section.
 *
 * Behavior mirrors info-popover.js:
 * Desktop: hover shows it, mouseout hides it. Click pins it (stays open).
 * Mobile: tap shows it, tap anywhere else dismisses.
 * Clicking another drop icon replaces the current popover.
 *
 * Displays: item name (with rarity color), Wiki link, Sources button,
 * requirements, keywords, and stat rows — same as column 1 expanded details,
 * minus the Hide checkbox, expand arrow, item icon, and "has" checkbox.
 *
 * Positioned above or below the drop card with a speech-bubble arrow pointing to it.
 */

import { renderRequirementsRow } from './utils/requirements.js';

import { formatFixed } from './utils/number-format.js';
import { wikiDarkModeSuffix } from './utils/wiki-link.js';
import { ownedCountLabel } from './utils/owned-quantity.js';

let activeDropPopover = null;
let dropDismissTimer = null;
let dropPopoverId = 0;

// A child popover is shown when hovering a drop row inside a container popover.
// It lives in parallel with activeDropPopover and is dismissed independently —
// unless the parent popover is dismissed, which dismisses the child too.
let activeChildPopover = null;
let childDismissTimer = null;
let childPopoverId = 0;

// Generation counter for race-protection in async show*Popover functions.
// Each anchor gets a fresh counter on every mouseenter; if the user mouseleaves
// before the async catalog lookup finishes, the counter advances so the show
// function can detect the cancellation and auto-dismiss the popover. Without
// this, hovering then quickly leaving an anchor (faster than the catalog fetch)
// produces a popover that never dismisses because the mouseleave fired BEFORE
// activeDropPopover was set, so the dismiss handler skipped it.
let _showSeq = 0;
function nextShowSeq() {
    _showSeq = (_showSeq + 1) | 0;
    return _showSeq;
}

// Anchor watch — MutationObserver + periodic isConnected check that auto-
// dismisses a popover when its anchor element is removed from the DOM.
// This covers the case where a parent section re-renders (e.g., a state
// subscription fires while the popover is open) and orphans the anchor —
// leaving the popover stuck on screen with no user-triggerable event
// (scroll/outside-click) that would clear it. Mirrors info-popover.js.
let anchorObserver = null;
let staleAnchorCheckInterval = null;

// ============================================================================
// CATALOG LOOKUP
// ============================================================================

/**
 * Find a catalog item by name (case-insensitive).
 * Uses the cached catalog from api.getCatalog().
 * Falls back to matching `egg_name` on pets so drops like "Mummy egg" resolve to
 * the "Mummy" pet entry.
 * @param {string} itemName - Item name to look up
 * @returns {Object|null} Catalog item or null
 */
async function findCatalogItem(itemName) {
    try {
        const catalog = await api.getCatalog();
        if (!catalog) return null;

        const searchName = itemName.toLowerCase().trim();

        // Pass 1: exact name match in flat items array (equipment, materials, crafted, pets)
        if (Array.isArray(catalog.items)) {
            for (const item of catalog.items) {
                if (item.name && item.name.toLowerCase().trim() === searchName) {
                    return item;
                }
            }
        }

        // Pass 2: search collectibles
        if (Array.isArray(catalog.collectibles)) {
            for (const item of catalog.collectibles) {
                if (item.name && item.name.toLowerCase().trim() === searchName) {
                    return item;
                }
            }
        }

        // Pass 3: pet egg fallback — drops are "Mummy egg" but catalog pet is "Mummy"
        if (Array.isArray(catalog.items)) {
            for (const item of catalog.items) {
                if (item.type === 'pet' && item.egg_name &&
                    item.egg_name.toLowerCase().trim() === searchName) {
                    return item;
                }
            }
        }

        return null;
    } catch (err) {
        console.error('Failed to look up catalog item:', err);
        return null;
    }
}

// ============================================================================
// STAT RENDERING (mirrors item-row.js renderStatsFromObject)
// ============================================================================

function formatCondition(skill, location) {
    const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

    const formatLocation = (loc) => {
        if (loc.startsWith('!')) {
            const cleanLoc = loc.substring(1);
            return `NOT ${formatLocation(cleanLoc)}`;
        }
        if (loc === 'gdte') return 'GDTE location';
        if (loc === 'underwater') return 'Underwater location';
        return `${capitalize(loc)} location`;
    };

    const skillGroupNames = {
        'artisan': 'doing Artisan skills',
        'gathering': 'doing Gathering skills',
        'utility': 'doing Utility skills',
        'smelting': 'doing Smelting recipes',
    };

    const skillLower = skill ? skill.toLowerCase() : 'global';
    let formattedSkill = null;
    if (skillLower !== 'global') {
        formattedSkill = skillGroupNames[skillLower] || capitalize(skill);
    }

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

function renderStatsFromObject(stats, requirement) {
    if (!stats || Object.keys(stats).length === 0) return '';
    const rows = [];

    for (const [skill, locationStats] of Object.entries(stats)) {
        for (const [location, statsByLocation] of Object.entries(locationStats)) {
            for (const [statName, statValue] of Object.entries(statsByLocation)) {
                if (!statName || statName === 'undefined') continue;

                let formattedStatName;
                if (statName.startsWith('ItemFindingCategory.')) {
                    const categoryConst = statName.split('.')[1];
                    if (window.itemFindingCategories && window.itemFindingCategories[categoryConst]) {
                        const category = window.itemFindingCategories[categoryConst];
                        const qtyText = category.min_qty === category.max_qty
                            ? category.min_qty
                            : `${category.min_qty} to ${category.max_qty}`;
                        formattedStatName = `Chance to find ${qtyText} ${category.display_name_singular}`;
                    } else {
                        const categoryName = categoryConst
                            .split('_')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ');
                        formattedStatName = `Chance to find ${categoryName.toLowerCase()}`;
                    }
                } else {
                    formattedStatName = statName
                        .split('_')
                        .map(word => word.toLowerCase() === 'xp' ? 'XP' : word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                }

                const isItemFinding = statName.startsWith('ItemFindingCategory.');
                const flatStats = [
                    'quality_outcome', 'inventory_space', 'bonus_xp_base', 'bonus_xp_add',
                    'steps_required', 'steps_add', 'flat_steps', 'bonus_experience_base',
                    'bonus_experience_add', 'foraging_base_xp'
                ];
                const negativeIsGood = [
                    'steps_add', 'steps_required', 'flat_steps', 'steps_pct', 'steps_percent'
                ];

                const isFlat = flatStats.includes(statName);
                const negativeGood = negativeIsGood.includes(statName);

                let formattedValue = statValue;
                let valueClass = 'stat-value';

                if (typeof statValue === 'number') {
                    if (statValue > 0) {
                        valueClass = negativeGood ? 'stat-value-negative' : 'stat-value-positive';
                        formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `+${statValue}%` : `+${statValue}`) : `+${statValue}%`;
                    } else if (statValue < 0) {
                        valueClass = negativeGood ? 'stat-value-positive' : 'stat-value-negative';
                        formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `${statValue}%` : `${statValue}`) : `${statValue}%`;
                    } else {
                        formattedValue = (isFlat || isItemFinding) ? (isItemFinding ? `${statValue}%` : `${statValue}`) : `${statValue}%`;
                    }
                }

                const condition = formatCondition(skill, location);
                const statRowClass = requirement ? 'stat-row stat-row-gated' : 'stat-row';
                const gateHtml = requirement ? `<div class="stat-gate">${requirement}</div>` : '';

                rows.push(`
                    <div class="${statRowClass}">
                        <span class="${valueClass}">${formattedValue}</span>
                        <span class="stat-name">${formattedStatName}</span>
                        <span class="stat-condition">${condition}</span>
                        ${gateHtml}
                    </div>
                `);
            }
        }
    }
    return rows.join('');
}

function renderGatedStats(gatedStats) {
    if (!gatedStats) return '';
    const rows = [];

    if (gatedStats.achievement_points) {
        for (const [threshold, apStats] of Object.entries(gatedStats.achievement_points)) {
            rows.push(renderStatsFromObject(apStats, `${threshold} Achievement Points`));
        }
    }
    if (gatedStats.total_skill_level) {
        for (const [threshold, tslStats] of Object.entries(gatedStats.total_skill_level)) {
            rows.push(renderStatsFromObject(tslStats, `${threshold} Total Skill Level`));
        }
    }
    if (gatedStats.total_collectibles) {
        for (const [threshold, collStats] of Object.entries(gatedStats.total_collectibles)) {
            rows.push(renderStatsFromObject(collStats, `${threshold} Obtained Collectibles`));
        }
    }
    if (gatedStats.skill_level) {
        for (const [skill, levels] of Object.entries(gatedStats.skill_level)) {
            for (const [level, skillStats] of Object.entries(levels)) {
                rows.push(renderStatsFromObject(skillStats, `${skill.charAt(0).toUpperCase() + skill.slice(1)} Level ${level}`));
            }
        }
    }
    if (gatedStats.activity_completion) {
        for (const [activity, counts] of Object.entries(gatedStats.activity_completion)) {
            for (const [count, skillStats] of Object.entries(counts)) {
                rows.push(renderStatsFromObject(skillStats, `${count}+ ${activity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`));
            }
        }
    }
    if (gatedStats.set_pieces) {
        for (const [setName, counts] of Object.entries(gatedStats.set_pieces)) {
            for (const [count, skillStats] of Object.entries(counts)) {
                rows.push(renderStatsFromObject(skillStats, `${count} ${setName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Equipped`));
            }
        }
    }
    if (gatedStats.travel_steps) {
        for (const [threshold, travelStats] of Object.entries(gatedStats.travel_steps)) {
            const formattedThreshold = parseInt(threshold).toLocaleString();
            rows.push(renderStatsFromObject(travelStats, `${formattedThreshold} Travel Steps`));
        }
    }

    return rows.join('');
}

function renderKeywords(item) {
    if (!item.keywords || item.keywords.length === 0) return '';
    const hiddenKeywords = ['shiny_ring', 'shiny_necklace', 'shiny_bracelet'];
    const visible = item.keywords.filter(kw => !hiddenKeywords.includes(kw.toLowerCase()));
    if (visible.length === 0) return '';
    return visible.map(kw => `<span class="keyword">${kw}</span>`).join('');
}

function getRarityClass(rarity) {
    if (!rarity) return 'rarity-common';
    const r = rarity.toLowerCase();
    const map = {
        'common': 'rarity-common', 'uncommon': 'rarity-uncommon',
        'rare': 'rarity-rare', 'epic': 'rarity-epic',
        'legendary': 'rarity-legendary', 'ethereal': 'rarity-ethereal'
    };
    return map[r] || 'rarity-common';
}

/**
 * Map a craft quality tier (Normal..Eternal) to its rarity class so the
 * popover background reflects the variant the user is hovering, not the
 * base item's static rarity. Mirrors the mapping used by gear-preview /
 * column-2 popups (and in crafting-tree-summary._qualityToRarity). "Fine"
 * is intentionally NOT mapped — fine materials have no rarity bump and
 * keep the base item's rarity.
 */
function rarityClassForQuality(quality) {
    if (!quality) return null;
    const q = String(quality).toLowerCase();
    const map = {
        'normal': 'rarity-common',
        'good': 'rarity-uncommon',
        'great': 'rarity-rare',
        'excellent': 'rarity-epic',
        'perfect': 'rarity-legendary',
        'eternal': 'rarity-ethereal',
    };
    return map[q] || null;
}

// ============================================================================
// POPOVER RENDERING
// ============================================================================

function buildPopoverHtml(item, quality = null, opts = null) {
    // Quality-aware rarity: when the popover represents a craft tier
    // (Good/Great/etc), tint by that tier instead of the base item's
    // static rarity so the background matches what col-1 and col-2
    // show for an equipped Good/Great/etc instance. Fine materials
    // and non-tier qualities fall back to the base item rarity.
    const qualityRarity = rarityClassForQuality(quality);
    const rarity = qualityRarity || getRarityClass(item.rarity);
    // Wiki always points at the BASE item, never at a quality variant —
    // the wiki has one page per crafted item and the quality is shown
    // inline on that page (no separate "Steel pickaxe (Good)" page).
    const wikiName = item.name.replace(/ /g, '_');
    const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;

    // Quality-aware stats: CraftedItems carry per-tier stats under
    // `stats_by_quality` (e.g. {Normal: {...}, Good: {...}, Great: {...}}).
    // When the caller provides a quality, render the matching tier's stats
    // so the popover reflects what the user is actually getting from that
    // sub-target craft / quality variant. Fall back to base `item.stats`
    // when quality is null, when stats_by_quality isn't present, or when
    // the requested tier is missing from it.
    const isCrafted = !!(item.stats_by_quality && typeof item.stats_by_quality === 'object');
    const effectiveQuality = quality && isCrafted && item.stats_by_quality[quality] ? quality : null;
    // Fine materials/consumables carry their own stats under `stats_fine`
    // (e.g. a Fine consumable's buffed effect). Use them when the popover
    // represents the Fine variant so it doesn't show the Normal stats.
    const stats = effectiveQuality
        ? item.stats_by_quality[effectiveQuality]
        : ((quality === 'Fine' && item.stats_fine) ? item.stats_fine : (item.stats || {}));

    // Header label: append "(Quality)" when the popover represents a
    // specific tier so the user can tell at a glance which variant the
    // stats are for. "Fine" is treated as a quality marker for materials
    // (no stat differences for materials, but it makes the source label
    // unambiguous).
    const headerLabel = quality ? `${item.name} (${quality})` : item.name;

    const requirementsHtml = renderRequirementsRow(item.requirements);
    const keywordsHtml = renderKeywords(item);
    const statsHtml = renderStatsFromObject(stats, '');
    const gatedHtml = renderGatedStats(item.gated_stats);

    // Optional "N owned" line under the name — same data source the column-3
    // recipe-info material tiles use (character.owned_quantities, keyed by
    // item id, with a "_fine" suffix for the Fine variant). Only rendered when
    // the caller opts in (e.g. the notepad item/drop popover) and a character
    // has been imported.
    let ownedHtml = '';
    if (opts && opts.showOwned && opts.itemId) {
        const oq = (window.store && window.store.state && window.store.state.character
            && window.store.state.character.owned_quantities) || null;
        const ownedText = ownedCountLabel(oq, opts.itemId, { fine: quality === 'Fine' });
        if (ownedText) ownedHtml = `<div class="drop-popover-owned">${ownedText}</div>`;
    }

    return `
        <div class="drop-popover-inner ${rarity}">
            <div class="drop-popover-name">${headerLabel}</div>
            ${ownedHtml}
            <div class="drop-popover-actions">
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
                <button class="btn-source-dropdown drop-popover-sources-btn" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>
            </div>
            <div class="drop-popover-source-container" style="display: none;"></div>
            ${requirementsHtml}
            <div class="keywords">${keywordsHtml}</div>
            <div class="stats">${statsHtml}${gatedHtml}</div>
        </div>
    `;
}

/**
 * Build HTML for a pet-egg popover. Mirrors the egg state of the column 1
 * pet details panel: Wiki link, Sources button, "XP to hatch", and the
 * requirement_to_gain_xp note. The wiki page is the egg's page, not the pet's.
 * @param {Object} pet - Catalog pet entry (type === 'pet')
 * @param {string} dropName - The drop's item_name ("Mummy egg") — used for header and wiki
 */
function buildPetEggPopoverHtml(pet, dropName) {
    const wikiName = (dropName || pet.egg_name || pet.name).replace(/ /g, '_');
    const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;

    // XP-to-hatch comes from level 1 data
    const levels = pet.levels || {};
    const level1 = levels['1'] || null;
    const xpToHatch = level1 && level1.xp_required
        ? level1.xp_required.toLocaleString()
        : null;
    const requirement = level1 && level1.requirement_to_gain_xp
        ? level1.requirement_to_gain_xp
        : null;

    const xpRow = xpToHatch
        ? `<div class="pet-xp-info">XP to hatch: ${xpToHatch}</div>`
        : '';
    const reqRow = requirement
        ? `<div class="pet-requirement">${requirement}</div>`
        : '';

    // Show what species this egg hatches into so users know what they're getting
    const hatchesInto = pet.name
        ? `<div class="pet-hatches-into">Hatches into: <strong>${pet.name}</strong></div>`
        : '';

    return `
        <div class="drop-popover-inner pet-egg-popover-inner">
            <div class="drop-popover-name">${dropName || pet.egg_name || pet.name}</div>
            <div class="drop-popover-actions">
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
                <button class="btn-source-dropdown drop-popover-sources-btn" title="Show sources for this item">Sources <span class="source-arrow">▼</span></button>
            </div>
            <div class="drop-popover-source-container" style="display: none;"></div>
            ${hatchesInto}
            ${xpRow}
            ${reqRow}
        </div>
    `;
}

// ============================================================================
// CONTAINER POPOVER RENDERING
// ============================================================================

/**
 * Build the icon path for a drop inside a container.
 * Mirrors the logic in drops-section.js renderDropItem.
 */
function iconPathForContainerDrop(drop) {
    const iconName = (drop.item_name || '').toLowerCase().replace(/ /g, '_');

    if (drop.item_name === 'Coins') {
        return '/assets/icons/items/coins.svg';
    }

    if (drop.item_ref) {
        const [type] = drop.item_ref.split('.');
        if (type === 'Currency') return `/assets/icons/items/${iconName}.svg`;
        if (type === 'Material') return `/assets/icons/items/materials/${iconName}.svg`;
        if (type === 'Item') return `/assets/icons/items/equipment/${iconName}.svg`;
        if (type === 'Collectible') return `/assets/icons/items/collectibles/${iconName}.svg`;
        if (type === 'Consumable') return `/assets/icons/items/consumables/${iconName}.svg`;
        if (type === 'Container') return `/assets/icons/items/containers/${iconName}.svg`;
        if (type === 'Egg') return `/assets/icons/items/pet_eggs/${iconName}.svg`;
    }

    // Fallback — try materials
    return `/assets/icons/items/materials/${iconName}.svg`;
}

/**
 * Format a drop chance percent for display (trim trailing zeros, preserve precision).
 */
function formatChancePercent(value) {
    if (value === null || value === undefined || value === 0) return '0';
    return formatFixed(value, 3, { trim: true });
}

/**
 * Render a single container drop row (icon, name, chance, quantity).
 * Rows carry `data-item-name` so hover/click handlers can look the item up
 * in the catalog and show a child popover with its full details.
 * The displayed chance is per chest opening (across all ROLLS_PER_CHEST rolls),
 * which matches how players think about drops.
 */
function renderContainerDropRow(drop) {
    const iconPath = iconPathForContainerDrop(drop);
    const chanceStr = formatChancePercent(drop.chance_per_chest);
    const qtyStr = drop.quantity_display || '1';
    // Coins / Currency drops don't have catalog entries — skip interactivity
    const isInteractive = drop.item_ref && !drop.item_ref.startsWith('Currency.') && drop.item_name !== 'Coins';
    const rowClass = isInteractive
        ? 'container-drop-row container-drop-row-interactive'
        : 'container-drop-row';
    const dataAttr = isInteractive ? `data-item-name="${drop.item_name.replace(/"/g, '&quot;')}"` : '';
    return `
        <div class="${rowClass}" ${dataAttr}>
            <img src="${iconPath}" alt="${drop.item_name}" class="container-drop-icon" loading="lazy"
                 onerror="if(this.src.endsWith('.svg')){this.src=this.src.replace('.svg','.png')}else{this.src='/assets/icons/items/containers/treasure_chest.svg'}" />
            <span class="container-drop-name">${drop.item_name}</span>
            <span class="container-drop-qty">${qtyStr}</span>
            <span class="container-drop-chance" title="Chance per chest opening">${chanceStr}%</span>
        </div>
    `;
}

/**
 * Render a rarity-colored section of container drops.
 * Uses the same rarity classes as gear/items so colors match the rest of the UI.
 * Each section is collapsible — click the header to toggle body visibility.
 */
function renderContainerSection(table) {
    const rarity = table.rarity || 'common';
    const rarityClass = `rarity-${rarity}`;
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    const rowsHtml = table.drops.map(renderContainerDropRow).join('');
    return `
        <div class="container-section ${rarityClass}">
            <div class="container-section-header" role="button" tabindex="0">
                <span class="container-section-label">${label}</span>
                <span class="expand-arrow expanded">▼</span>
            </div>
            <div class="container-section-body">${rowsHtml}</div>
        </div>
    `;
}

/**
 * Build HTML for the container popover (replaces buildPopoverHtml for containers).
 * Container is the response from /api/container/{name}.
 * The drop card's native tooltip already shows the chest name, so we omit it
 * from the popover header.
 */
function buildContainerPopoverHtml(container) {
    const wikiName = container.name.replace(/ /g, '_');
    const wikiUrl = `https://wiki.walkscape.app/wiki/${encodeURIComponent(wikiName).replace(/%2F/g, '/').replace(/%5F/g, '_')}${wikiDarkModeSuffix()}`;

    const sectionsHtml = (container.tables || []).map(renderContainerSection).join('');

    return `
        <div class="drop-popover-inner container-popover-inner">
            <div class="drop-popover-name">${container.name}</div>
            <div class="drop-popover-actions">
                <a href="${wikiUrl}" target="_blank" rel="noopener noreferrer" class="wiki-link">Wiki</a>
            </div>
            <div class="container-sections">${sectionsHtml}</div>
        </div>
    `;
}

/**
 * Show a container popover anchored to a drop card.
 * @param {HTMLElement} anchor - The .drop-card element
 * @param {string} containerName - Display name, e.g. "Agility chest"
 * @param {boolean} pinned - If true, stays until explicitly dismissed
 */
export async function showContainerPopover(anchor, containerName, pinned = false) {
    console.log(`[DROP-POPOVER] showContainerPopover called for "${containerName}", pinned=${pinned}`);
    clearTimeout(dropDismissTimer);
    dropDismissTimer = null;

    // Toggle off if clicking same pinned container
    if (activeDropPopover && activeDropPopover.anchor === anchor && activeDropPopover.pinned) {
        dismissDropPopover();
        return;
    }

    // Remove any existing popover
    if (activeDropPopover) {
        activeDropPopover.el.remove();
        activeDropPopover = null;
    }

    // Race protection (see showDropPopover) — capture the anchor's show-sequence.
    const seqAtStart = anchor.dataset.popoverSeq || '0';

    // Fetch container data
    const container = await api.getContainerDetails(containerName);
    if (!container) {
        console.warn(`Container popover: "${containerName}" not found`);
        return;
    }

    // Aborted: user moved off the anchor while the request was in flight.
    if (!pinned && (anchor.dataset.popoverSeq || '0') !== seqAtStart) {
        console.log(`[DROP-POPOVER] showContainerPopover aborted for "${containerName}" — anchor mouseleft during fetch`);
        return;
    }

    const id = ++dropPopoverId;
    const popover = document.createElement('div');
    popover.className = 'drop-item-popover container-popover';
    popover.innerHTML = `
        <div class="drop-popover-arrow drop-popover-arrow-bottom"></div>
        ${buildContainerPopoverHtml(container)}
    `;
    document.body.appendChild(popover);

    positionPopover(popover, anchor);

    // Lock width so content shifts don't reflow the bubble
    const initialWidth = popover.getBoundingClientRect().width;
    popover.style.width = initialWidth + 'px';

    activeDropPopover = { el: popover, anchor, pinned, id, container };
    attachScrollDismiss();
    startAnchorWatch();

    // Wire Wiki link — stop propagation so it doesn't dismiss the popover
    const wikiLink = popover.querySelector('.wiki-link');
    if (wikiLink) {
        wikiLink.addEventListener('click', (e) => e.stopPropagation());
    }

    // Wire collapsible section headers — click toggles body visibility with
    // the same slide animation used elsewhere (rotating arrow + slideUp/Down).
    popover.querySelectorAll('.container-section-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const $body = $(header).next('.container-section-body');
            const $arrow = $(header).find('.expand-arrow');
            if ($arrow.hasClass('expanded')) {
                $arrow.removeClass('expanded');
                $body.slideUp(150, () => {
                    // Reposition popover after content shrinks
                    if (activeDropPopover && activeDropPopover.el === popover) {
                        positionPopover(popover, anchor);
                    }
                });
            } else {
                $arrow.addClass('expanded');
                $body.slideDown(150, () => {
                    if (activeDropPopover && activeDropPopover.el === popover) {
                        positionPopover(popover, anchor);
                    }
                });
            }
        });
        // Keyboard accessibility — Enter/Space also toggle
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                header.click();
            }
        });
    });

    // Wire drop rows inside the container — hover/click shows a child popover
    // with the item's stats, wiki link, and sources (same as a regular drop popover).
    popover.querySelectorAll('.container-drop-row-interactive').forEach(row => {
        const itemName = row.getAttribute('data-item-name');
        if (!itemName) return;

        row.addEventListener('mouseenter', () => {
            if (isTouchDevice()) return;
            // Don't override a pinned child popover — user pinned it intentionally
            if (activeChildPopover && activeChildPopover.pinned) return;
            row.dataset.popoverSeq = String(nextShowSeq());
            clearTimeout(childDismissTimer);
            childDismissTimer = null;
            showChildItemPopover(row, itemName, false, popover);
        });

        row.addEventListener('mouseleave', (e) => {
            if (isTouchDevice()) return;
            if (activeChildPopover && activeChildPopover.pinned) return;
            // Bump row seq to abort any in-flight child show.
            row.dataset.popoverSeq = String(nextShowSeq());
            if (!activeChildPopover || activeChildPopover.anchor !== row) return;
            // If the mouse is moving into the child popover itself, don't dismiss
            if (e.relatedTarget && activeChildPopover.el.contains(e.relatedTarget)) {
                return;
            }
            scheduleChildDismiss(activeChildPopover.id);
        });

        row.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            row.dataset.popoverSeq = String(nextShowSeq());
            if (activeChildPopover && activeChildPopover.anchor === row && activeChildPopover.pinned) {
                dismissChildPopover();
            } else {
                showChildItemPopover(row, itemName, true, popover);
            }
        });
    });

    // Scrolling the sections area invalidates the child popover's anchor
    // position (the row moves but the child doesn't). Dismiss on scroll so the
    // user can re-hover to get a fresh, correctly-positioned popover.
    const scrollableSections = popover.querySelector('.container-sections');
    if (scrollableSections) {
        scrollableSections.addEventListener('scroll', () => {
            if (activeChildPopover) {
                dismissChildPopover();
            }
        }, { passive: true });
    }

    // Hover handling (desktop) — parent popover stays alive while mouse is over
    // either the parent itself OR a child popover anchored to it.
    popover.addEventListener('mouseenter', () => {
        if (activeDropPopover && !activeDropPopover.pinned) {
            clearTimeout(dropDismissTimer);
            dropDismissTimer = null;
        }
    });
    popover.addEventListener('mouseleave', (e) => {
        if (activeDropPopover && activeDropPopover.pinned) return;
        if (!activeDropPopover || activeDropPopover.id !== id) return;
        // If the mouse is moving into the child popover, don't dismiss
        if (activeChildPopover && e.relatedTarget &&
            activeChildPopover.el.contains(e.relatedTarget)) {
            return;
        }
        scheduleDropDismiss(id);
    });

    // Outside click dismisses (pinned or touch)
    if (pinned || isTouchDevice()) {
        const delay = isTouchDevice() ? 500 : 0;
        setTimeout(() => {
            const eventType = isTouchDevice() ? 'touchend' : 'pointerdown';
            document.addEventListener(eventType, onDropOutsideClick, { once: true, capture: true });
        }, delay);
    }
}

// ============================================================================
// POSITIONING
// ============================================================================

function positionPopover(popover, anchor) {
    // Use the icon inside the card for arrow targeting, fall back to the card itself
    const iconEl = anchor.querySelector('.drop-card-icon') || anchor;
    const iconRect = iconEl.getBoundingClientRect();
    const cardRect = anchor.getBoundingClientRect();
    const arrowEl = popover.querySelector('.drop-popover-arrow');
    const innerEl = popover.querySelector('.drop-popover-inner');
    // Container popovers manage their own scrolling via a fixed CSS cap on
    // .container-sections. Skip the dynamic inner-cap below so sections stay
    // at their natural height (never squished).
    const isContainerPopover = popover.classList.contains('container-popover');

    const margin = 10;
    const arrowSize = 8;
    const gap = arrowSize + 4;

    // Temporarily remove constraints so we can measure natural size
    if (innerEl && !isContainerPopover) {
        innerEl.style.maxHeight = 'none';
        innerEl.style.overflowY = 'visible';
    }
    popover.style.top = '';
    popover.style.bottom = '';

    // Measure natural height
    const popRect = popover.getBoundingClientRect();

    // Use the icon's vertical position for above/below decision
    const spaceAbove = iconRect.top - margin;
    const spaceBelow = window.innerHeight - iconRect.bottom - margin;

    let placement;
    if (spaceBelow >= popRect.height + gap) {
        placement = 'below';
    } else if (spaceAbove >= popRect.height + gap) {
        placement = 'above';
    } else if (spaceBelow >= spaceAbove) {
        placement = 'below';
    } else {
        placement = 'above';
    }

    // Cap height to fit in the available space. Container popovers skip this
    // since their CSS already caps .container-sections internally.
    if (!isContainerPopover && innerEl) {
        const availableSpace = (placement === 'above' ? spaceAbove : spaceBelow) - gap;
        if (popRect.height > availableSpace) {
            innerEl.style.maxHeight = Math.max(150, availableSpace - 4) + 'px';
            innerEl.style.overflowY = 'auto';
        } else {
            innerEl.style.maxHeight = 'none';
            innerEl.style.overflowY = 'visible';
        }
    }

    if (placement === 'below') {
        popover.style.top = (iconRect.bottom + gap) + 'px';
    } else {
        popover.style.bottom = (window.innerHeight - iconRect.top + gap) + 'px';
    }

    // Center horizontally on the icon
    const finalPopRect = popover.getBoundingClientRect();
    let left = iconRect.left + (iconRect.width / 2) - (finalPopRect.width / 2);
    left = Math.max(margin, Math.min(left, window.innerWidth - finalPopRect.width - margin));
    popover.style.left = left + 'px';

    // Position arrow pointing at the icon center
    if (arrowEl) {
        const arrowLeft = iconRect.left + (iconRect.width / 2) - left - arrowSize;
        arrowEl.style.left = Math.max(12, Math.min(arrowLeft, finalPopRect.width - 24)) + 'px';

        if (placement === 'above') {
            arrowEl.className = 'drop-popover-arrow drop-popover-arrow-bottom';
        } else {
            arrowEl.className = 'drop-popover-arrow drop-popover-arrow-top';
        }
    }
}

// ============================================================================
// SHOW / DISMISS
// ============================================================================

/**
 * Show a drop item popover next to the given drop card element.
 * @param {HTMLElement} anchor - The .drop-card element
 * @param {string} itemName - The item name to look up
 * @param {boolean} pinned - If true, stays until explicitly dismissed
 */
export async function showDropPopover(anchor, itemName, pinned = false, quality = null) {
    console.log(`[DROP-POPOVER] showDropPopover called for "${itemName}", pinned=${pinned}, quality=${quality || '-'}`);
    clearTimeout(dropDismissTimer);
    dropDismissTimer = null;

    // If same anchor is already showing and pinned, toggle off
    if (activeDropPopover && activeDropPopover.anchor === anchor && activeDropPopover.pinned) {
        dismissDropPopover();
        return;
    }

    // Remove existing popover
    if (activeDropPopover) {
        activeDropPopover.el.remove();
        activeDropPopover = null;
    }

    // Race protection — capture the current show-sequence for THIS anchor.
    // mouseleave/mouseenter handlers bump anchor.dataset.popoverSeq; if it
    // changes between now and when the catalog lookup resolves, the user has
    // since moved off (or onto a different anchor), so we should not show.
    const seqAtStart = anchor.dataset.popoverSeq || '0';

    // Look up item in catalog
    const item = await findCatalogItem(itemName);
    console.log(`[DROP-POPOVER] catalog lookup for "${itemName}":`, item ? item.name : 'NOT FOUND');
    if (!item) {
        console.warn(`Drop popover: item "${itemName}" not found in catalog`);
        return;
    }

    // If the user already moved off this anchor while we were awaiting the
    // catalog, abort silently — showing the popover now would leave it
    // floating with no mouse interaction to dismiss it.
    if (!pinned && (anchor.dataset.popoverSeq || '0') !== seqAtStart) {
        console.log(`[DROP-POPOVER] showDropPopover aborted for "${itemName}" — anchor mouseleft during catalog lookup`);
        return;
    }

    const id = ++dropPopoverId;
    const isPetEgg = item.type === 'pet';
    // Pet eggs use a neutral outer bg; other items tint by rarity.
    // When the popover represents a craft quality variant (Good/Great/...)
    // we tint by that tier — matching col-1/col-2 popups for a Good
    // equipped item — so the user sees the quality color on hover.
    // Fine materials and base items keep the catalog rarity.
    const qualityRarity = rarityClassForQuality(quality);
    const rarity = qualityRarity || getRarityClass(item.rarity);
    const outerClass = isPetEgg
        ? 'drop-item-popover pet-egg-popover'
        : `drop-item-popover ${rarity}`;
    const popover = document.createElement('div');
    popover.className = outerClass;
    popover.innerHTML = `
        <div class="drop-popover-arrow drop-popover-arrow-bottom"></div>
        ${isPetEgg ? buildPetEggPopoverHtml(item, itemName) : buildPopoverHtml(item, quality, { showOwned: true, itemId: anchor.dataset.npOwnedItemId || item.id })}
    `;
    document.body.appendChild(popover);

    // Initial position (needs to be in DOM to measure)
    positionPopover(popover, anchor);

    // Lock width so it doesn't jump when sources expand
    const initialWidth = popover.getBoundingClientRect().width;
    popover.style.width = initialWidth + 'px';

    activeDropPopover = { el: popover, anchor, pinned, id, item };
    attachScrollDismiss();
    startAnchorWatch();

    // Wire sources button inside popover
    const sourcesBtn = popover.querySelector('.drop-popover-sources-btn');
    const sourceContainer = popover.querySelector('.drop-popover-source-container');
    if (sourcesBtn && sourceContainer) {
        sourcesBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const arrow = sourcesBtn.querySelector('.source-arrow');
            if (sourceContainer.style.display !== 'none') {
                if (arrow) arrow.classList.remove('open');
                $(sourceContainer).slideUp(150, () => {
                    if (activeDropPopover && activeDropPopover.el === popover) {
                        positionPopover(popover, anchor);
                    }
                });
                return;
            }
            if (arrow) arrow.classList.add('open');
            // Remove inner max-height constraint so content can grow
            const innerEl = popover.querySelector('.drop-popover-inner');
            if (innerEl) {
                innerEl.style.maxHeight = 'none';
                innerEl.style.overflowY = 'visible';
            }
            // For pet eggs, the sources index keys by the egg name (drop.item_name),
            // not the pet name (item.name). Pass it explicitly.
            const sourceLookup = isPetEgg ? itemName : null;
            await loadAndRenderSources(item, sourceContainer, sourceLookup);
            // Reposition immediately after content is set (before slideDown starts)
            if (activeDropPopover && activeDropPopover.el === popover) {
                positionPopover(popover, anchor);
            }
        });
    }

    // Wiki link — stop propagation so it doesn't dismiss
    const wikiLink = popover.querySelector('.wiki-link');
    if (wikiLink) {
        wikiLink.addEventListener('click', (e) => e.stopPropagation());
    }

    // Hover on popover itself cancels dismiss timer
    popover.addEventListener('mouseenter', () => {
        if (activeDropPopover && !activeDropPopover.pinned) {
            clearTimeout(dropDismissTimer);
            dropDismissTimer = null;
        }
    });

    // Mouseleave from popover schedules dismiss (unless pinned)
    popover.addEventListener('mouseleave', () => {
        if (activeDropPopover && !activeDropPopover.pinned && activeDropPopover.id === id) {
            scheduleDropDismiss(id);
        }
    });

    // On mobile or pinned, dismiss on outside click
    if (pinned || isTouchDevice()) {
        const delay = isTouchDevice() ? 500 : 0;
        setTimeout(() => {
            const eventType = isTouchDevice() ? 'touchend' : 'pointerdown';
            document.addEventListener(eventType, onDropOutsideClick, { once: true, capture: true });
        }, delay);
    }
}

function scheduleDropDismiss(forId) {
    clearTimeout(dropDismissTimer);
    dropDismissTimer = setTimeout(() => {
        if (activeDropPopover && activeDropPopover.id === forId && !activeDropPopover.pinned) {
            dismissDropPopover();
        }
        dropDismissTimer = null;
    }, 200);
}

/**
 * Wire a single DOM element as a drop-popover anchor. Used by wireDropCards()
 * below and by the comparison view in gearset-comparison-section.js. Attaches
 * mouseenter/mouseleave/click handlers with the correct pinned-popover guards
 * and grace-period dismissal semantics.
 *
 * @param {HTMLElement} anchor - Element to attach listeners to.
 * @param {string} name - Item name (regular) or container name (chest/container).
 *                        Should be the BASE item name when targeting a quality
 *                        / fine variant — wiki + sources lookups go through
 *                        this name and the wiki has no per-quality pages.
 * @param {boolean} isContainer - If true, shows container popover; otherwise drop popover.
 * @param {string|null} quality - Optional quality tier ("Good", "Great", ...,
 *                                "Fine") used to render the matching tier's
 *                                stats from the catalog item's
 *                                stats_by_quality map. Falls back to the
 *                                anchor's `data-drop-quality` attribute when
 *                                not provided. Ignored for containers.
 */
export function wireDropAnchor(anchor, name, isContainer, quality = null) {
    if (!anchor || !name) return;
    // Skip if already wired (safe to call on re-render)
    if (anchor.dataset.dropWired) return;
    anchor.dataset.dropWired = '1';
    anchor.classList.add('drop-card-interactive');
    anchor.dataset.dropItemName = name;

    // Quality tier — argument wins, then fall back to data-drop-quality on
    // the anchor (set by call sites that lay out HTML strings, e.g. the
    // crafting tree summary). Container popovers don't take a quality.
    const effectiveQuality = isContainer
        ? null
        : (quality || anchor.dataset.dropQuality || null);

    const showFn = isContainer
        ? (a, n, p) => showContainerPopover(a, n, p)
        : (a, n, p) => showDropPopover(a, n, p, effectiveQuality);

    anchor.addEventListener('mouseenter', () => {
        if (isTouchDevice()) return;
        if (activeDropPopover && activeDropPopover.pinned) return;
        // Bump per-anchor seq so a previously-aborted hover (mouseleave during
        // catalog lookup) doesn't poison this fresh hover.
        anchor.dataset.popoverSeq = String(nextShowSeq());
        clearTimeout(dropDismissTimer);
        dropDismissTimer = null;
        showFn(anchor, name, false);
    });

    anchor.addEventListener('mouseleave', () => {
        if (isTouchDevice()) return;
        if (activeDropPopover && activeDropPopover.pinned) return;
        // Bump seq — if the show function is mid-await, this signals it to
        // abort the popover creation. Without this, a fast hover-then-leave
        // can leave a stuck popover (the mouseleave fires before
        // activeDropPopover is set, so the dismiss check below is a no-op).
        anchor.dataset.popoverSeq = String(nextShowSeq());
        if (activeDropPopover && activeDropPopover.anchor === anchor) {
            scheduleDropDismiss(activeDropPopover.id);
        }
    });

    anchor.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Pinned popovers don't care about hover seq; bump anyway so any
        // pending un-pinned hover-show aborts cleanly.
        anchor.dataset.popoverSeq = String(nextShowSeq());
        if (activeDropPopover && activeDropPopover.anchor === anchor && activeDropPopover.pinned) {
            dismissDropPopover();
        } else {
            showFn(anchor, name, true);
        }
    });
}

/**
 * Schedule dismissal of the active drop popover if it is anchored to the
 * given element and is not pinned. Safe to call from any anchor's mouseleave
 * handler — mirrors the mouseleave logic inside wireDropCards(). Allows a
 * brief grace period so the user can move from the anchor onto the popover
 * without it closing.
 */
export function scheduleDropDismissIfAnchor(anchor) {
    if (!activeDropPopover || activeDropPopover.pinned) return;
    if (activeDropPopover.anchor !== anchor) return;
    scheduleDropDismiss(activeDropPopover.id);
}

/**
 * Global scroll listener — dismiss the drop popover when the page (or any
 * scrollable container holding the anchor) scrolls, since the popover is
 * position: fixed and would otherwise stay orphaned in place while the card
 * scrolls away underneath it. Scrolls that originate INSIDE the popover or
 * its child popover are ignored (those are intentional internal scrolls).
 */
function onPageScrollDismiss(e) {
    if (!activeDropPopover) return;
    const target = e.target;
    // Ignore scrolls that originated inside the popover or its child —
    // users scrolling the drops list inside a chest popover shouldn't close it.
    const insideParent = target && (target === activeDropPopover.el ||
        (activeDropPopover.el.contains && activeDropPopover.el.contains(target)));
    const insideChild = activeChildPopover && target && (target === activeChildPopover.el ||
        (activeChildPopover.el.contains && activeChildPopover.el.contains(target)));
    if (insideParent || insideChild) return;
    dismissDropPopover();
}

function attachScrollDismiss() {
    // Capture phase so we catch scrolls from any nested scroll container
    // (columns, popups, etc.), not just the window.
    document.addEventListener('scroll', onPageScrollDismiss, { capture: true, passive: true });
    window.addEventListener('wheel', onPageScrollDismiss, { capture: true, passive: true });
}

function detachScrollDismiss() {
    document.removeEventListener('scroll', onPageScrollDismiss, { capture: true });
    window.removeEventListener('wheel', onPageScrollDismiss, { capture: true });
}

function onDropOutsideClick(e) {
    if (!activeDropPopover) return;
    // Clicking inside the parent popover, its anchor, or the child popover (if open)
    // should NOT dismiss anything — re-register the listener and return.
    const insideParent = activeDropPopover.el.contains(e.target);
    const insideAnchor = activeDropPopover.anchor.contains(e.target);
    const insideChild = activeChildPopover && activeChildPopover.el.contains(e.target);
    if (!insideParent && !insideAnchor && !insideChild) {
        console.log('[DROP-POPOVER] outside click → dismissDropPopover');
        dismissDropPopover();  // dismisses child too
        return;
    }
    // Re-register so the listener keeps watching for the next outside click
    const eventType = isTouchDevice() ? 'touchend' : 'pointerdown';
    document.addEventListener(eventType, onDropOutsideClick, { once: true, capture: true });
}

export function dismissDropPopover() {
    console.log('[DROP-POPOVER] dismissDropPopover invoked, hadPopover=', !!activeDropPopover, 'pinned=', activeDropPopover?.pinned);
    clearTimeout(dropDismissTimer);
    dropDismissTimer = null;
    detachScrollDismiss();
    // If a child popover is open, dismiss it first — it's anchored to the parent
    if (activeChildPopover) {
        dismissChildPopover();
    }
    if (activeDropPopover) {
        const el = activeDropPopover.el;
        activeDropPopover = null;
        el.style.animation = 'drop-popover-out 0.12s ease-in forwards';
        setTimeout(() => el.remove(), 120);
    }
    stopAnchorWatchIfIdle();
}

/**
 * Dismiss the child (item) popover without touching the parent container popover.
 */
function dismissChildPopover() {
    console.log('[DROP-POPOVER] dismissChildPopover invoked, hadPopover=', !!activeChildPopover, 'pinned=', activeChildPopover?.pinned);
    clearTimeout(childDismissTimer);
    childDismissTimer = null;
    if (activeChildPopover) {
        const el = activeChildPopover.el;
        activeChildPopover = null;
        el.style.animation = 'drop-popover-out 0.12s ease-in forwards';
        setTimeout(() => el.remove(), 120);
    }
    stopAnchorWatchIfIdle();
}

function scheduleChildDismiss(forId) {
    clearTimeout(childDismissTimer);
    childDismissTimer = setTimeout(() => {
        if (activeChildPopover && activeChildPopover.id === forId && !activeChildPopover.pinned) {
            dismissChildPopover();
        }
        childDismissTimer = null;
    }, 200);
}

/**
 * Show an item popover as a child of an existing parent popover. Used when
 * hovering/clicking a drop row inside the container popover. Has its own
 * lifecycle slot (activeChildPopover) so it doesn't replace the parent.
 *
 * @param {HTMLElement} rowAnchor - The .container-drop-row element
 * @param {string} itemName - Item name to look up
 * @param {boolean} pinned - If true, stays until dismissed
 * @param {HTMLElement} parentPopover - The parent container popover element
 */
async function showChildItemPopover(rowAnchor, itemName, pinned, parentPopover) {
    console.log(`[DROP-POPOVER] showChildItemPopover called for "${itemName}", pinned=${pinned}`);
    clearTimeout(childDismissTimer);
    childDismissTimer = null;

    // Toggle off if clicking the same pinned row
    if (activeChildPopover && activeChildPopover.anchor === rowAnchor && activeChildPopover.pinned) {
        dismissChildPopover();
        return;
    }

    // Remove any previous child
    if (activeChildPopover) {
        activeChildPopover.el.remove();
        activeChildPopover = null;
    }

    // Race protection — capture the row's show-sequence (separate from the
    // parent's). If the user moves off the row before catalog resolves, we
    // skip showing.
    const seqAtStart = rowAnchor.dataset.popoverSeq || '0';

    const item = await findCatalogItem(itemName);
    if (!item) {
        console.warn(`Child popover: item "${itemName}" not found in catalog`);
        return;
    }

    // Aborted: user moved off the row while we were awaiting the catalog,
    // or the parent popover went away (so the row is detached).
    if (!pinned && (rowAnchor.dataset.popoverSeq || '0') !== seqAtStart) {
        console.log(`[DROP-POPOVER] showChildItemPopover aborted for "${itemName}" — row mouseleft during catalog lookup`);
        return;
    }

    const id = ++childPopoverId;
    const isPetEgg = item.type === 'pet';
    const rarity = getRarityClass(item.rarity);
    const outerClass = isPetEgg
        ? 'drop-item-popover pet-egg-popover drop-child-popover'
        : `drop-item-popover ${rarity} drop-child-popover`;
    const popover = document.createElement('div');
    popover.className = outerClass;
    popover.innerHTML = `
        <div class="drop-popover-arrow drop-popover-arrow-bottom"></div>
        ${isPetEgg ? buildPetEggPopoverHtml(item, itemName) : buildPopoverHtml(item, null, { showOwned: true, itemId: item.id })}
    `;
    document.body.appendChild(popover);

    // Position above/below the hovered row (same behavior as main drop cards).
    // It's fine — expected, even — that the child popover overlaps the parent
    // container popover: the user is focused on the row they're hovering.
    positionPopover(popover, rowAnchor);

    // Lock width so sources expansion doesn't reflow
    const initialWidth = popover.getBoundingClientRect().width;
    popover.style.width = initialWidth + 'px';

    activeChildPopover = { el: popover, anchor: rowAnchor, pinned, id, item };
    startAnchorWatch();

    // Wire sources button inside child popover
    const sourcesBtn = popover.querySelector('.drop-popover-sources-btn');
    const sourceContainer = popover.querySelector('.drop-popover-source-container');
    if (sourcesBtn && sourceContainer) {
        sourcesBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const arrow = sourcesBtn.querySelector('.source-arrow');
            if (sourceContainer.style.display !== 'none') {
                if (arrow) arrow.classList.remove('open');
                $(sourceContainer).slideUp(150, () => {
                    if (activeChildPopover && activeChildPopover.el === popover) {
                        positionPopover(popover, rowAnchor);
                    }
                });
                return;
            }
            if (arrow) arrow.classList.add('open');
            const innerEl = popover.querySelector('.drop-popover-inner');
            if (innerEl) {
                innerEl.style.maxHeight = 'none';
                innerEl.style.overflowY = 'visible';
            }
            const sourceLookup = isPetEgg ? itemName : null;
            await loadAndRenderSources(item, sourceContainer, sourceLookup);
            if (activeChildPopover && activeChildPopover.el === popover) {
                positionPopover(popover, rowAnchor);
            }
        });
    }

    // Wiki link — stop propagation
    const wikiLink = popover.querySelector('.wiki-link');
    if (wikiLink) {
        wikiLink.addEventListener('click', (e) => e.stopPropagation());
    }

    // Hover handling — keep it alive while mouse is over it, and also
    // cancel any pending parent-popover dismiss so the parent stays open
    // while the user is interacting with the child.
    popover.addEventListener('mouseenter', () => {
        clearTimeout(dropDismissTimer);
        dropDismissTimer = null;
        if (activeChildPopover && !activeChildPopover.pinned) {
            clearTimeout(childDismissTimer);
            childDismissTimer = null;
        }
    });
    popover.addEventListener('mouseleave', (e) => {
        if (activeChildPopover && activeChildPopover.pinned) return;
        if (!activeChildPopover || activeChildPopover.id !== id) return;
        // If the mouse is moving back into the parent, don't dismiss the child
        if (activeDropPopover && e.relatedTarget &&
            activeDropPopover.el.contains(e.relatedTarget)) {
            return;
        }
        scheduleChildDismiss(id);
    });
}

// ============================================================================
// ANCHOR WATCH
// ============================================================================

/**
 * Check whether any active popover's anchor has been detached from the DOM,
 * and dismiss it if so. Called by the MutationObserver and periodic backstop.
 *
 * Order matters: dismiss the child first in case the parent is also orphaned,
 * so dismissDropPopover doesn't try to dismiss an already-gone child.
 */
function checkStaleAnchors() {
    if (activeChildPopover && activeChildPopover.anchor
        && !activeChildPopover.anchor.isConnected) {
        console.log('[DROP-POPOVER] anchor watch: child anchor disconnected → dismissChildPopover');
        dismissChildPopover();
    }
    if (activeDropPopover && activeDropPopover.anchor
        && !activeDropPopover.anchor.isConnected) {
        console.log('[DROP-POPOVER] anchor watch: parent anchor disconnected → dismissDropPopover');
        dismissDropPopover();
    }
}

/**
 * Start watching for anchor removal. Idempotent — if already running, this
 * is a no-op. The watch covers both the parent (activeDropPopover) and
 * child (activeChildPopover) slots simultaneously.
 *
 * Uses a MutationObserver for immediate detection plus a 300ms interval as
 * a backstop in case a mutation is missed (e.g., direct innerHTML replace
 * on a subtree that was re-parented).
 */
function startAnchorWatch() {
    if (anchorObserver || staleAnchorCheckInterval) return;  // already running
    if (typeof MutationObserver !== 'undefined') {
        anchorObserver = new MutationObserver(checkStaleAnchors);
        anchorObserver.observe(document.body, { childList: true, subtree: true });
    }
    staleAnchorCheckInterval = setInterval(checkStaleAnchors, 300);
}

/**
 * Stop the anchor watch — but only if BOTH popover slots are empty. This
 * lets dismiss* functions call it unconditionally: the parent's dismiss
 * won't tear down the watch while the child is still open, and vice versa.
 */
function stopAnchorWatchIfIdle() {
    if (activeDropPopover || activeChildPopover) return;  // still needed
    if (anchorObserver) {
        anchorObserver.disconnect();
        anchorObserver = null;
    }
    if (staleAnchorCheckInterval) {
        clearInterval(staleAnchorCheckInterval);
        staleAnchorCheckInterval = null;
    }
}

function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ============================================================================
// SOURCES LOADING (mirrors item-row.js _loadAndRenderSources)
// ============================================================================

async function loadAndRenderSources(item, container, lookupOverride = null) {
    container.innerHTML = '<div class="source-loading">Loading sources...</div>';
    $(container).hide().slideDown(150);

    try {
        const data = await api.getItemSources();
        // Pet eggs: drop is indexed by egg name ("Mummy egg"), but item.name is the
        // pet's name ("Mummy"). Caller passes the drop name via lookupOverride.
        const lookupName = (lookupOverride || item.name).toLowerCase().trim();
        const sources = data.sources[lookupName] || [];

        if (sources.length === 0) {
            container.innerHTML = '<div class="source-empty">No sources found</div>';
            return;
        }

        const activityDrops = sources.filter(s => s.type === 'activity_drop');
        const itemFindingDrops = sources.filter(s => s.type === 'item_finding');
        const recipeDrops = sources.filter(s => s.type === 'recipe_drop');
        const recipeOutputs = sources.filter(s => s.type === 'recipe_output');
        const recipeInputs = sources.filter(s => s.type === 'recipe_input');
        const shopSources = sources.filter(s => s.type === 'shop');
        const chestSources = sources.filter(s => s.type === 'container_drop');

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
        // Set content directly — display:block so positionPopover can measure
        container.innerHTML = html;
        container.style.display = 'block';

        // Wire source item clicks (navigate to activity/recipe)
        container.querySelectorAll('.source-item:not(.source-item-no-click)').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const sourceType = el.dataset.sourceType;
                const sourceId = el.dataset.sourceId;

                if (sourceType === 'activity_drop') {
                    if (window.activitySelector) {
                        window.activitySelector.selectActivity(sourceId);
                    }
                } else if (sourceType === 'recipe_output' || sourceType === 'recipe_input' || sourceType === 'recipe_drop') {
                    if (window.recipeSelector) {
                        window.recipeSelector.selectRecipe(sourceId);
                    }
                }

                dismissDropPopover();
            });
        });
    } catch (err) {
        console.error('Failed to load item sources:', err);
        container.innerHTML = '<div class="source-empty">Failed to load sources</div>';
    }
}

// ============================================================================
// WIRING — attach hover + click to drop cards
// ============================================================================

/**
 * Wire hover + click behavior to all .drop-card elements within a container.
 * Regular items show an item popover (with Wiki/Sources); containers/chests show
 * a container popover listing the chest's drops grouped by rarity.
 * @param {HTMLElement} container - The drops section container
 * @param {Array} drops - The calculated drops array (to map card index → drop data)
 */
export function wireDropCards(container, drops) {
    console.log('[DROP-POPOVER] wireDropCards called, drops:', drops?.length);
    const cards = container.querySelectorAll('.drop-card');
    console.log('[DROP-POPOVER] found cards:', cards.length);
    cards.forEach((card, index) => {
        const drop = drops[index];
        if (!drop) {
            console.log(`[DROP-POPOVER] card ${index}: no matching drop`);
            return;
        }

        // Skip synthetic entries and items without a name
        if (!drop.item_name || drop.item_name === 'Coins') {
            return;
        }
        if (drop.source === 'synthetic_fine' || drop.source === 'synthetic_collectible') {
            return;
        }

        // Detect if this drop is a container/chest. We have three shapes:
        //   - source === 'chest'  (synthetic chest added for recipes / generic activities)
        //   - item_ref starts with 'Container.'
        //   - item_name contains "chest" / "nest" / "pouch" (fallback for activity drops)
        const isContainerRef = drop.item_ref && drop.item_ref.startsWith('Container.');
        const isSyntheticChest = drop.source === 'chest';
        const isContainer = isContainerRef || isSyntheticChest;

        // Skip if already wired
        if (card.dataset.dropWired) return;
        card.dataset.dropWired = '1';

        // Only the item icon should open the stats popover. The steps counter
        // has its own click-to-fill-calculator behavior (wired in
        // drops-section.js) and the percent/quantity rows are non-interactive.
        // Anchor all hover/click popover handlers to the icon wrapper so
        // hovering or clicking the steps display no longer opens the popover.
        const anchor = card.querySelector('.drop-card-icon-wrapper') || card;
        anchor.classList.add('drop-card-interactive');
        card.dataset.dropItemName = drop.item_name;

        if (isContainer) {
            // Figure out the container display name to look up on the backend.
            // Shapes we handle:
            //   - Container ref (activity drops): item_name is already the display name
            //     ("Agility chest", "Bird nest", "Gem pouch").
            //   - Synthetic chest (recipes): item_name is literally "Chest" and
            //     drop.primary_skill holds the skill ("smithing"). Backend container
            //     for skill chests is keyed as "<Skill> chest" (lowercase 'c').
            //   - Synthetic chest (generic activities): item_name is "<Skill> Chest"
            //     with uppercase C — normalize to lowercase 'c'.
            let containerName = drop.item_name;
            if (isSyntheticChest) {
                const skill = drop.primary_skill || '';
                if (skill) {
                    const skillCap = skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase();
                    containerName = `${skillCap} chest`;
                } else {
                    containerName = containerName.replace(/Chest$/i, 'chest');
                }
            }

            console.log(`[DROP-POPOVER] card ${index}: wiring container "${containerName}"`);

            anchor.addEventListener('mouseenter', () => {
                if (isTouchDevice()) return;
                if (activeDropPopover && activeDropPopover.pinned) return;
                anchor.dataset.popoverSeq = String(nextShowSeq());
                clearTimeout(dropDismissTimer);
                dropDismissTimer = null;
                showContainerPopover(anchor, containerName, false);
            });

            anchor.addEventListener('mouseleave', () => {
                if (isTouchDevice()) return;
                if (activeDropPopover && activeDropPopover.pinned) return;
                // Bump seq to abort any in-flight async show (race protection).
                anchor.dataset.popoverSeq = String(nextShowSeq());
                if (activeDropPopover && activeDropPopover.anchor === anchor) {
                    scheduleDropDismiss(activeDropPopover.id);
                }
            });

            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                anchor.dataset.popoverSeq = String(nextShowSeq());
                if (activeDropPopover && activeDropPopover.anchor === anchor && activeDropPopover.pinned) {
                    dismissDropPopover();
                } else {
                    showContainerPopover(anchor, containerName, true);
                }
            });
            return;
        }

        console.log(`[DROP-POPOVER] card ${index}: wiring "${drop.item_name}"`);

        anchor.addEventListener('mouseenter', () => {
            console.log(`[DROP-POPOVER] mouseenter on "${drop.item_name}"`);
            if (isTouchDevice()) return;
            if (activeDropPopover && activeDropPopover.pinned) return;
            anchor.dataset.popoverSeq = String(nextShowSeq());
            clearTimeout(dropDismissTimer);
            dropDismissTimer = null;
            showDropPopover(anchor, drop.item_name, false);
        });

        anchor.addEventListener('mouseleave', () => {
            if (isTouchDevice()) return;
            if (activeDropPopover && activeDropPopover.pinned) return;
            // Bump seq to abort any in-flight async show (race protection).
            anchor.dataset.popoverSeq = String(nextShowSeq());
            if (activeDropPopover && activeDropPopover.anchor === anchor) {
                scheduleDropDismiss(activeDropPopover.id);
            }
        });

        anchor.addEventListener('click', (e) => {
            console.log(`[DROP-POPOVER] click on "${drop.item_name}"`);
            e.preventDefault();
            e.stopPropagation();
            anchor.dataset.popoverSeq = String(nextShowSeq());
            if (activeDropPopover && activeDropPopover.anchor === anchor && activeDropPopover.pinned) {
                dismissDropPopover();
            } else {
                showDropPopover(anchor, drop.item_name, true);
            }
        });
    });
}
