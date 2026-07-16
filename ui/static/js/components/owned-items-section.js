/**
 * OwnedItemsSection component
 * 
 * Main collapsible section for all owned items, organized by category:
 * - Collectibles
 * - Consumables (by skill)
 * - Materials
 * - Loot (achievement rewards, activity drops, faction rewards, shop items, chests)
 * - Crafted (by keyword)
 * - Pets
 * 
 * Features:
 * - Collapsed by default
 * - Category headers with obtained/total counts
 * - Renders item rows for each category using jQuery
 * - Syncs item state across multiple locations
 */

import CollapsibleSection from './collapsible.js';
import ItemRow from './item-row.js';
import store from '../state.js';

class OwnedItemsSection extends CollapsibleSection {
    /**
     * Create the owned items section
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     * @param {Object} props.catalog - Item catalog from API
     */
    constructor(element, { catalog }) {
        // Pass catalog through props so it's available in renderContent
        super(element, {
            title: 'Owned Items',
            icon: '/assets/icons/text/general_icons/inventory.svg',
            count: '0/0',
            defaultExpanded: false,
            catalog: catalog || { categories: {} }  // Store in props
        });

        // Now we can safely use 'this'
        this.catalog = this.props.catalog;
        this.itemComponents = new Map(); // Track ItemRow components
        this.searchText = '';
        this.itemNameMap = null; // Built lazily on first search

        // Validate catalog
        if (!catalog || !catalog.categories) {
            console.error('OwnedItemsSection: Invalid catalog provided', catalog);
        }

        // Subscribe to item changes to update counts
        // Listen to both base items and user override items
        this.subscribe('items', () => this.updateCounts());
        this.subscribe('ui.user_overrides.items', () => this.updateCounts());

        // Re-render custom items when generic items change
        this.subscribe('genericItems', () => {
            // Destroy existing generic item ItemRow components
            for (const [key, component] of this.itemComponents.entries()) {
                if (key.startsWith('generic::item::')) {
                    component.destroy();
                    this.itemComponents.delete(key);
                }
            }
            // Re-render the category HTML
            const $cat = this.$element.find('[data-category="custom-items"]');
            if ($cat.length) {
                $cat.replaceWith(this.renderCustomItems());
                // If the category was expanded, initialize the new ItemRow components
                const $newCat = this.$element.find('[data-category="custom-items"]');
                const $items = $newCat.find('.category-subcategories');
                if ($items.is(':visible')) {
                    this.initializeItemRowsInContainer($items);
                }
            }
            // Invalidate search name map so generic items are re-indexed
            this.itemNameMap = null;
        });

        // Initial count update
        this.updateCounts();
    }


    /**
     * Render the content inside the collapsible section
     * @returns {string} HTML string for all categories
     */
    renderContent() {
        // Access catalog from props (set before super() was called)
        const catalog = this.props.catalog || { categories: {} };

        console.log('[OIS] renderContent: catalog summary',
            catalog.categories
                ? {
                      category_groups: Object.keys(catalog.categories),
                      collectibles: Object.keys(catalog.categories.collectibles || {}).length,
                      materials: Array.isArray(catalog.categories.materials) ? catalog.categories.materials.length : 0,
                      chests: Object.keys(catalog.categories.chests || {}).length,
                      pets: Array.isArray(catalog.categories.pets) ? catalog.categories.pets.length : 0,
                  }
                : 'no categories');
        if (window.__walkscapeVerboseDebug) {
            console.log('[VERBOSE] renderContent catalog full payload:', catalog);
            console.log('[VERBOSE] catalog.categories full payload:', catalog.categories);
        }
        if (catalog.categories) {
            console.log('collectibles subcategories:', Object.keys(catalog.categories.collectibles || {}));
        }

        // Check if catalog is valid
        if (!catalog.categories) {
            return `
                <div class="owned-items-container">
                    <div class="error-message" style="padding: 20px; text-align: center; color: #ff6b6b;">
                        <p>Unable to load item catalog</p>
                        <p style="font-size: 12px; color: #b0b0b0;">The catalog data is not available. Please refresh the page.</p>
                    </div>
                </div>
            `;
        }

        const html = `
            <div class="owned-items-container">
                <div class="owned-items-search-container">
                    <input type="text" 
                           class="owned-items-search" 
                           placeholder="Search by name or keyword..." 
                           value="${this.searchText || ''}">
                </div>
                <div class="owned-items-categories">
                    ${this.renderCollectibles()}
                    ${this.renderConsumables()}
                    ${this.renderLoot()}
                    ${this.renderCrafted()}
                    ${this.renderChests()}
                    ${this.renderPets()}
                    ${this.renderMaterials()}
                    ${this.renderCustomItems()}
                </div>
                <div style="padding: var(--spacing-sm); text-align: center; border-top: 1px solid var(--border-color); margin-top: var(--spacing-sm);">
                    <button class="btn-expand-all-items" style="
                        background: var(--bg-tertiary);
                        border: 1px solid var(--border-color);
                        border-radius: 4px;
                        color: var(--text-secondary);
                        cursor: pointer;
                        font-size: 0.8em;
                        padding: var(--spacing-xs) var(--spacing-sm);
                        width: 100%;
                    ">⬇️ Expand All</button>
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Render Collectibles category with subcategories
     * @returns {string} HTML string
     */
    renderCollectibles() {
        const catalog = this.props.catalog || { categories: {} };
        const collectiblesData = catalog.categories.collectibles || {};

        // Count all collectible items across subcategories
        let totalItems = 0;
        let totalObtained = 0;

        for (const [subcategory, data] of Object.entries(collectiblesData)) {
            if (Array.isArray(data)) {
                totalItems += data.length;
                totalObtained += this.countObtained(data);
            } else if (typeof data === 'object') {
                // Nested subcategories (e.g. Faction Rewards -> {faction: [items]})
                for (const subItems of Object.values(data)) {
                    totalItems += subItems.length;
                    totalObtained += this.countObtained(subItems);
                }
            }
        }

        return `
            <div class="item-category collapsible-category" data-category="collectibles">
                <div class="category-header clickable">
                    <span class="category-title">Collectibles</span>
                    <span class="category-count">${totalObtained}/${totalItems}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-subcategories" style="display: none;">
                    ${Object.entries(collectiblesData).map(([subcategory, data]) => {
            if (Array.isArray(data)) {
                return this.renderLootSubcategory(subcategory, data);
            } else if (typeof data === 'object') {
                return this.renderLootNestedSubcategory(subcategory, data);
            }
            return '';
        }).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Consumables category with skill subcategories
     * @returns {string} HTML string
     */
    renderConsumables() {
        const catalog = this.props.catalog || { categories: {} };
        const consumablesBySkill = catalog.categories.consumables || {};
        const allItems = Object.values(consumablesBySkill).flat();

        // Deduplicate by item ID for the category total
        // (skill group items like Nut Mix appear in multiple skill subcategories)
        const uniqueItems = [...new Map(allItems.map(item => [item.id, item])).values()];
        const obtained = this.countObtained(uniqueItems);

        // Sort skills: "Global Consumables" first, then alphabetically
        const sortedSkills = Object.keys(consumablesBySkill).sort((a, b) => {
            if (a === 'Global Consumables') return -1;
            if (b === 'Global Consumables') return 1;
            return a.localeCompare(b);
        });

        return `
            <div class="item-category collapsible-category" data-category="consumables">
                <div class="category-header clickable">
                    <span class="category-title">Consumables</span>
                    <span class="category-count">${obtained}/${uniqueItems.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-subcategories" style="display: none;">
                    ${sortedSkills.map(skill =>
            this.renderConsumableSkillSubcategory(skill, consumablesBySkill[skill])
        ).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render a skill subcategory for consumables
     * @param {string} skill - Skill name
     * @param {Array} items - Items for this skill
     * @returns {string} HTML string
     */
    renderConsumableSkillSubcategory(skill, items) {
        const obtained = this.countObtained(items);

        return `
            <div class="subcategory collapsible-subcategory" data-subcategory="${skill}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${skill}</span>
                    <span class="subcategory-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}" data-skill="${skill}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Materials category
     * @returns {string} HTML string
     */
    renderMaterials() {
        const catalog = this.props.catalog || { categories: {} };
        const items = catalog.categories.materials || [];
        const obtained = this.countObtained(items);

        return `
            <div class="item-category collapsible-category" data-category="materials">
                <div class="category-header clickable">
                    <span class="category-title">Materials</span>
                    <span class="category-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Loot category with subcategories
     * @returns {string} HTML string
     */
    renderLoot() {
        const catalog = this.props.catalog || { categories: {} };
        const loot = catalog.categories.loot || {};

        // Count all loot items
        let totalItems = 0;
        let totalObtained = 0;

        for (const [subcategory, items] of Object.entries(loot)) {
            if (Array.isArray(items)) {
                totalItems += items.length;
                totalObtained += this.countObtained(items);
            } else if (typeof items === 'object') {
                // Nested subcategories (achievement_rewards, faction_rewards)
                for (const subItems of Object.values(items)) {
                    totalItems += subItems.length;
                    totalObtained += this.countObtained(subItems);
                }
            }
        }

        return `
            <div class="item-category collapsible-category" data-category="loot">
                <div class="category-header clickable">
                    <span class="category-title">Loot</span>
                    <span class="category-count">${totalObtained}/${totalItems}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-subcategories" style="display: none;">
                    ${this.renderLootSubcategory('Achievement Point Rewards', loot.ap_rewards || [])}
                    ${this.renderLootNestedSubcategory('Achievement Rewards', loot.achievement_rewards || {})}
                    ${this.renderLootSubcategory('Activity Drops', loot.activity_drops || [])}
                    ${this.renderLootSubcategory('Misc. Loot', loot.misc_loot || [])}
                    ${this.renderLootNestedSubcategory('Faction Rewards', loot.faction_rewards || {})}
                    ${this.renderLootSubcategory('Shop Items', loot.shop_items || [])}
                </div>
            </div>
        `;
    }

    /**
     * Render a simple loot subcategory
     * @param {string} title - Subcategory title
     * @param {Array} items - Items in this subcategory
     * @returns {string} HTML string
     */
    renderLootSubcategory(title, items) {
        const obtained = this.countObtained(items);

        // Special handling for TODO placeholders
        if (items.length === 0) {
            return `
                <div class="subcategory" data-subcategory="${title}">
                    <div class="subcategory-header">
                        <span class="subcategory-title">${title}</span>
                        <span class="subcategory-count">TODO</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="subcategory collapsible-subcategory" data-subcategory="${title}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${title}</span>
                    <span class="subcategory-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}" data-subcat="${title}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render a nested loot subcategory (with keyword groups)
     * @param {string} title - Subcategory title
     * @param {Object} itemsByKeyword - Items grouped by keyword
     * @returns {string} HTML string
     */
    renderLootNestedSubcategory(title, itemsByKeyword) {
        // Count all items across keywords
        let totalItems = 0;
        let totalObtained = 0;

        for (const items of Object.values(itemsByKeyword)) {
            totalItems += items.length;
            totalObtained += this.countObtained(items);
        }

        if (totalItems === 0) {
            return `
                <div class="subcategory" data-subcategory="${title}">
                    <div class="subcategory-header">
                        <span class="subcategory-title">${title}</span>
                        <span class="subcategory-count">0/0</span>
                    </div>
                </div>
            `;
        }

        return `
            <div class="subcategory collapsible-subcategory" data-subcategory="${title}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${title}</span>
                    <span class="subcategory-count">${totalObtained}/${totalItems}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-nested" style="display: none;">
                    ${Object.entries(itemsByKeyword).map(([keyword, items]) =>
            this.renderKeywordGroup(keyword, items)
        ).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render a keyword group within a nested subcategory
     * @param {string} keyword - Keyword name
     * @param {Array} items - Items with this keyword
     * @returns {string} HTML string
     */
    renderKeywordGroup(keyword, items) {
        const obtained = this.countObtained(items);

        return `
            <div class="keyword-group collapsible-keyword" data-keyword="${keyword}">
                <div class="keyword-header clickable">
                    <span class="keyword-title">${keyword}</span>
                    <span class="keyword-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="keyword-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}" data-subcat="${keyword}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Crafted category with keyword subcategories
     * @returns {string} HTML string
     */
    renderCrafted() {
        const catalog = this.props.catalog || { categories: {} };
        const craftedByKeyword = catalog.categories.crafted || {};
        // Get server-computed unique count, then remove metadata key
        const uniqueCount = craftedByKeyword._unique_count || 0;
        // Filter to only real category arrays (skip metadata keys starting with _)
        const categoryKeys = Object.keys(craftedByKeyword).filter(k => !k.startsWith('_'));
        const allItemsRaw = categoryKeys.flatMap(k => craftedByKeyword[k]);
        const uniqueItems = [...new Map(allItemsRaw.map(item => [item.id, item])).values()];
        const obtained = this.countObtained(uniqueItems);
        const totalCount = uniqueCount || uniqueItems.length;

        // Sort keywords alphabetically, but put "Misc. Crafted" at the end
        // Skip the _unique_count metadata key
        const sortedKeywords = categoryKeys.sort((a, b) => {
            if (a === 'Misc. Crafted') return 1;
            if (b === 'Misc. Crafted') return -1;
            return a.localeCompare(b);
        });

        return `
            <div class="item-category collapsible-category" data-category="crafted">
                <div class="category-header clickable">
                    <span class="category-title">Crafted</span>
                    <span class="category-count">${obtained}/${totalCount}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-subcategories" style="display: none;">
                    ${sortedKeywords.map(keyword =>
            this.renderCraftedKeywordSubcategory(keyword, craftedByKeyword[keyword])
        ).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render a keyword subcategory for crafted items
     * @param {string} keyword - Keyword name
     * @param {Array} items - Items with this keyword
     * @returns {string} HTML string
     */
    renderCraftedKeywordSubcategory(keyword, items) {
        const obtained = this.countObtained(items);
        // Rename slot-based categories to clarify they refer to gear slots, not containers
        const slotDisplayNames = { 'Chests': 'Chest Slots', 'Pants': 'Pant Slots', 'Rings': 'Ring Slots' };
        const displayName = slotDisplayNames[keyword] || keyword;

        return `
            <div class="subcategory collapsible-subcategory" data-subcategory="${keyword}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${displayName}</span>
                    <span class="subcategory-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}" data-subcat="${keyword}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    renderChests() {
        const catalog = this.props.catalog || { categories: {} };
        const chests = catalog.categories.chests || {};

        console.log('renderChests called, chests:', chests);

        // Count total items across all chests
        let totalItems = 0;
        let totalObtained = 0;

        for (const chest of Object.values(chests)) {
            if (chest.contents) {
                totalItems += chest.contents.length;
                totalObtained += this.countObtained(chest.contents);
            }
        }

        // Sort chests alphabetically (no special chests anymore)
        const sortedChests = Object.values(chests).sort((a, b) => {
            return a.name.localeCompare(b.name);
        });

        return `
            <div class="item-category collapsible-category" data-category="chests">
                <div class="category-header clickable">
                    <span class="category-title">Chests</span>
                    <span class="category-count">${totalObtained}/${totalItems}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-subcategories" style="display: none;">
                    ${sortedChests.map(chest => this.renderChestSubcategory(chest)).join('')}
                </div>
            </div>
            `;
    }

    /**
     * Render a single chest subcategory with its contents
     * @param {Object} chest - Chest object with contents
     * @returns {string} HTML string
     */
    renderChestSubcategory(chest) {
        console.log(`Rendering chest: ${chest.name}, contents: `, chest.contents);
        const obtained = this.countObtained(chest.contents);

        const itemsHtml = chest.contents.map(item => {
            console.log(`  - Item: ${item.name} (${item.id})`);
            return `<div class="item-row-container" data-item-id="${item.id}"></div>`;
        }).join('');

        console.log(`Chest ${chest.name}: ${obtained}/${chest.contents.length}, HTML length: ${itemsHtml.length}`);

        return `
            <div class="item-subcategory collapsible-subcategory" data-subcategory="${chest.id}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${chest.name}</span>
                    <span class="subcategory-count">${obtained}/${chest.contents.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-items" style="display: none;">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    /**
     * Render Pets category (TODO placeholder)
     * @returns {string} HTML string
     */
    renderPets() {
        const catalog = this.props.catalog || { categories: {} };
        const petsData = catalog.categories.pets || [];

        if (petsData.length === 0) {
            return `
                <div class="item-category collapsible-category" data-category="pets">
                    <div class="category-header clickable">
                        <span class="category-title">Pets</span>
                        <span class="category-count">0/0</span>
                        <span class="expand-arrow">▼</span>
                    </div>
                </div>
            `;
        }

        const obtained = this.countObtained(petsData);

        return `
            <div class="item-category collapsible-category" data-category="pets">
                <div class="category-header clickable">
                    <span class="category-title">Pets</span>
                    <span class="category-count">${obtained}/${petsData.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="category-items" style="display: none;">
                    ${petsData.map(pet => `<div class="item-row-container" data-item-id="${pet.id}" data-item-type="pet"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Custom Items category (generic items).
     * Gated behind window._featureFlags?.generic.
     */
    renderCustomItems() {
        if (!window._featureFlags?.generic) return '';

        const items = store.state.genericItems || [];
        const communityChecked = store.state.column1?.showGenericItemCommunity ? 'checked' : '';

        // Ensure each generic item has a state entry so ItemRow subscriptions work
        // ALL generic items default to unchecked (has: false) — ownership is determined
        // by the import matching code in main.js or manual user action.
        // Previously non-community items defaulted to has:true which incorrectly
        // marked sheet-synced items like Weighted vest as owned.
        for (const gi of items) {
            const stateId = `generic::item::${gi.id}`;
            if (!store.state.items[stateId]) {
                store.state.items[stateId] = { has: false };
            }
        }

        // Group items by slot
        const slotOrder = ['head', 'cape', 'back', 'chest', 'hands', 'legs', 'neck', 'feet', 'ring', 'tool', 'primary', 'secondary', 'consumable', 'collectible', 'input', 'pet'];
        const slotLabels = {
            head: 'Head', cape: 'Cape', back: 'Back', chest: 'Chest',
            hands: 'Hands', legs: 'Legs', neck: 'Neck', feet: 'Feet',
            ring: 'Ring', tool: 'Tool', primary: 'Primary', secondary: 'Secondary',
            consumable: 'Consumable', collectible: 'Collectible', input: 'Input', pet: 'Pet'
        };
        const bySlot = {};
        for (const item of items) {
            const slot = item.slot || 'tool';
            if (!bySlot[slot]) bySlot[slot] = [];
            bySlot[slot].push(item);
        }

        // Build subcategory HTML for each slot that has items
        const subcategoriesHtml = slotOrder
            .filter(slot => bySlot[slot] && bySlot[slot].length > 0)
            .map(slot => {
                const slotItems = bySlot[slot];
                const rows = slotItems.map(item => {
                    const stateId = `generic::item::${item.id}`;
                    return `<div class="item-row-container" data-item-id="${stateId}"></div>`;
                }).join('');
                const label = slotLabels[slot] || slot.charAt(0).toUpperCase() + slot.slice(1);
                return `
                    <div class="subcategory collapsible-subcategory" data-subcategory="gi-${slot}">
                        <div class="subcategory-header clickable">
                            <img src="/assets/icons/slots/${slot}.svg" class="gi-slot-subcat-icon" />
                            <span class="subcategory-title">${label}</span>
                            <span class="subcategory-count">${slotItems.length}</span>
                            <span class="expand-arrow">▼</span>
                        </div>
                        <div class="subcategory-items" style="display:none">${rows}</div>
                    </div>`;
            }).join('');

        return `
        <div class="item-category collapsible-category" data-category="custom-items">
            <div class="category-header clickable">
                <span class="category-title">🔧 Generic Items</span>
                <span class="category-count">${items.length}</span>
                <span class="expand-arrow">▼</span>
            </div>
            <div class="category-subcategories" style="display:none">
                <div class="gi-category-controls">
                    <button class="btn-create-generic-item optimize-btn" style="font-size:13px;padding:5px 14px">🔧 Add/Edit Generic Items</button>
                    <label class="gi-checkbox-label gi-community-toggle" style="margin-top:6px">
                        <input type="checkbox" class="gi-show-community-col1" ${communityChecked} />
                        Show community definitions
                    </label>
                </div>
                ${items.length === 0 ? '<div class="gi-no-items-msg" style="padding:4px 0;color:var(--text-secondary);font-size:12px">No custom items yet.</div>' : subcategoriesHtml}
            </div>
        </div>`;
    }

    /**
     * Convert a generic item to a catalog-compatible item object for ItemRow
     * @param {Object} gi - Generic item from store.state.genericItems
     * @returns {Object} Catalog-compatible item object
     */
    _genericItemToCatalogItem(gi) {
        const isConsumable = gi.slot === 'consumable' || gi.slot === 'input';
        const isCollectible = gi.slot === 'collectible';
        const isPet = gi.slot === 'pet';
        // Consumables and inputs are always crafted (Normal/Fine), collectibles and pets are never crafted
        const isCrafted = (isCollectible || isPet) ? false : (gi.is_crafted || isConsumable);
        // Consumables/inputs with quality_stats have fine versions
        const hasFine = isConsumable && gi.quality_stats && gi.quality_stats['Fine'];
        // For consumables/inputs, normal stats come from quality_stats.Normal
        let stats = gi.stats || {};
        let statsFine = null;
        if (isConsumable && gi.quality_stats) {
            stats = gi.quality_stats['Normal'] || gi.stats || {};
            statsFine = gi.quality_stats['Fine'] || null;
        }

        // For pets, build levels dict from quality_stats (keyed by "Level 1", "Level 2", etc.)
        let levels = null;
        let maxLevel = 0;
        if (isPet && gi.quality_stats) {
            levels = {};
            const petXpReqs = gi.quality_values?._pet_xp_requirements || {};
            const petXpReqRows = gi.quality_values?._pet_xp_req_rows || [];
            for (const [key, levelStats] of Object.entries(gi.quality_stats)) {
                if (key === 'Egg') continue;
                const match = key.match(/Level (\d+)/);
                if (match) {
                    const lvl = parseInt(match[1]);
                    if (lvl > maxLevel) maxLevel = lvl;
                    levels[String(lvl)] = {
                        xp_required: petXpReqs[key] || 0,
                        requirement_to_gain_xp: this._formatPetXpReqDisplay(petXpReqRows),
                        stats: levelStats || {},
                        abilities: [],
                    };
                }
            }
        }

        // If icon field contains a path (from sheet data), treat it as icon_path
        const rawIcon = gi.icon || '⚡';
        const iconIsPath = rawIcon.includes('/') || rawIcon.endsWith('.svg') || rawIcon.endsWith('.png');

        const result = {
            id: `generic::item::${gi.id}`,
            name: gi.name,
            slot: gi.slot,
            keywords: gi.keywords || [],
            rarity: (isCrafted || isPet) ? 'common' : (gi.rarity || 'common'),
            icon: iconIsPath ? '⚡' : (gi.icon || '⚡'),
            icon_color: gi.icon_color,
            icon_path: iconIsPath ? gi.icon : (gi.icon_path || null),
            type: isPet ? 'pet' : (isCollectible ? 'collectible' : (isConsumable ? 'consumable' : (isCrafted ? 'crafted_item' : 'item'))),
            is_generic: true,
            is_crafted: isCrafted,
            generic_id: gi.id,
            stats: stats,
            stats_fine: statsFine,
            stats_by_quality: (!isConsumable && !isPet && gi.quality_stats) ? gi.quality_stats : null,
            quality_stats: gi.quality_stats || null,
            gated_stats: gi.gated_stats || {},
            requirements: (gi.gated_stats && gi.gated_stats.requirements) ? gi.gated_stats.requirements : [],
            has_fine: !!hasFine,
        };

        // Add pet-specific fields
        if (isPet) {
            result.levels = levels || {};
            result.max_level = maxLevel;
            result.egg_name = gi.name + ' egg';
        }

        return result;
    }

    /**
     * Format pet XP requirement rows into a display string
     */
    _formatPetXpReqDisplay(rows) {
        if (!rows || !rows.length) return null;
        const locLabels = {
            jarvonia: 'Jarvonia', gdte: 'GDTE', trellin: 'Trellin', erdwise: 'Erdwise',
            halfling_rebels: 'Halfling Rebels', syrenthia: 'Syrenthia', wallisia: 'Wallisia',
            wrentmark: 'Wrentmark', underwater: 'Underwater', spectral: 'Spectral'
        };
        return rows.filter(r => r.type && r.value).map(r => {
            if (r.type === 'location') {
                const loc = locLabels[r.value] || r.value;
                return `While in ${loc} area`;
            }
            if (r.type === 'skill') {
                const prefix = r.not ? 'Not doing ' : 'While doing ';
                return prefix + (r.value.charAt(0).toUpperCase() + r.value.slice(1));
            }
            return '';
        }).filter(Boolean).join('. ') + '.';
    }

    /**
     * Count how many items are obtained (has=true)
     * @param {Array} items - Array of item objects
     * @returns {number} Count of obtained items
     */
    countObtained(items) {
        return items.filter(item => {
            // Check user overrides first, then fall back to base items state
            const overrides = store.state.ui.user_overrides || {};
            const overrideItemState = (overrides.items && overrides.items[item.id]) || {};
            const baseItemState = store.state.items[item.id] || {};

            const has = overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has;
            return has === true;
        }).length;
    }

    /**
     * Update all counts after item state changes
     */
    updateCounts() {
        // Update main section count
        const allItems = this.getAllItems();
        const obtained = this.countObtained(allItems);
        this.updateCount(`${obtained}/${allItems.length}`);

        // Update category counts
        this.updateCategoryCounts();
    }

    /**
     * Get all items across all categories
     * @returns {Array} All items
     */
    getAllItems() {
        // Use this.catalog if available (after constructor), otherwise props
        const catalog = this.catalog || this.props.catalog || { categories: {} };
        if (!catalog.categories) {
            return [];
        }

        const items = [];

        // Collectibles (now a dict of subcategories)
        const collectibles = catalog.categories.collectibles || {};
        for (const subcatData of Object.values(collectibles)) {
            if (Array.isArray(subcatData)) {
                items.push(...subcatData);
            } else if (typeof subcatData === 'object') {
                for (const groupItems of Object.values(subcatData)) {
                    items.push(...groupItems);
                }
            }
        }

        // Consumables (deduplicate — skill group items appear in multiple subcategories)
        const consumables = catalog.categories.consumables || {};
        const seenConsumableIds = new Set();
        for (const skillItems of Object.values(consumables)) {
            for (const item of skillItems) {
                if (!seenConsumableIds.has(item.id)) {
                    seenConsumableIds.add(item.id);
                    items.push(item);
                }
            }
        }

        // Materials
        items.push(...(catalog.categories.materials || []));

        // Loot (deduplicate — items can appear in multiple subcategories)
        const loot = catalog.categories.loot || {};
        const seenLootIds = new Set();
        for (const [subcategory, subcatItems] of Object.entries(loot)) {
            if (Array.isArray(subcatItems)) {
                for (const item of subcatItems) {
                    if (!seenLootIds.has(item.id)) {
                        seenLootIds.add(item.id);
                        items.push(item);
                    }
                }
            } else if (typeof subcatItems === 'object') {
                for (const keywordItems of Object.values(subcatItems)) {
                    for (const item of keywordItems) {
                        if (!seenLootIds.has(item.id)) {
                            seenLootIds.add(item.id);
                            items.push(item);
                        }
                    }
                }
            }
        }

        // Crafted
        const crafted = catalog.categories.crafted || {};
        for (const keywordItems of Object.values(crafted)) {
            items.push(...keywordItems);
        }

        // Pets (empty for now)
        items.push(...(catalog.categories.pets || []));

        return items;
    }

    /**
     * Update counts for all categories and subcategories
     */
    updateCategoryCounts() {
        // Update each category count in the DOM
        this.$element.find('.category-count, .subcategory-count, .keyword-count').each((i, el) => {
            const $el = $(el);
            const $container = $el.closest('[data-category], [data-subcategory], [data-keyword]');
            const category = $container.data('category');

            // Find all items in this container
            const $items = $container.find('.item-row-container');
            const total = $items.length;

            if (total === 0) {
                return; // Skip empty categories (TODO placeholders)
            }

            // For the consumables, loot, and crafted category headers, deduplicate by item ID
            // (skill group items appear in multiple consumable subcategories,
            //  loot items can appear in multiple loot subcategories like faction rewards + shop items,
            //  crafted items can appear in multiple keyword subcategories like "Diving Gear" + "Chests")
            const needsDedup = (category === 'consumables' || category === 'loot' || category === 'crafted') && $el.hasClass('category-count');

            // Collect item IDs, deduplicating for category totals
            const seen = new Set();
            let obtained = 0;
            let uniqueTotal = 0;

            $items.each((j, itemEl) => {
                const itemId = $(itemEl).data('item-id');

                if (needsDedup && seen.has(itemId)) {
                    return; // Skip duplicate for category total
                }
                seen.add(itemId);
                uniqueTotal++;

                // Check user overrides first, then fall back to base items state
                const overrides = store.state.ui.user_overrides || {};
                const overrideItemState = (overrides.items && overrides.items[itemId]) || {};
                const baseItemState = store.state.items[itemId] || {};

                const has = overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has;

                if (has === true) {
                    obtained++;
                }
            });

            $el.text(`${obtained}/${needsDedup ? uniqueTotal : total}`);
        });
    }

    /**
     * Override toggle to add scroll-to-fit when expanding the Owned Items header.
     */
    toggle() {
        const wasExpanded = this.expanded;
        super.toggle();

        // After expanding, scroll so the header is near the top
        if (!wasExpanded && this.expanded) {
            const $header = this.$element.find('.collapsible-header');
            // Wait for slideDown animation to finish
            this.$element.find('.collapsible-content').promise().done(() => {
                this._scrollToFitExpanded($header);
            });
        }
    }

    /**
     * Attach event handlers and initialize ItemRow components
     */
    attachEvents() {
        // Call parent to attach collapsible header events
        super.attachEvents();

        // Add category collapse/expand handlers
        this.$element.on('click', '.category-header.clickable', (e) => {
            const $header = $(e.currentTarget);
            const $category = $header.closest('.collapsible-category');
            const $items = $category.find('.category-items, .category-subcategories').first();
            const $arrow = $header.find('.expand-arrow');

            // Check current visibility state
            const isCurrentlyVisible = $items.is(':visible');

            // Toggle based on current visibility
            if (isCurrentlyVisible) {
                $arrow.removeClass('expanded');
                $items.slideUp(200);
            } else {
                $arrow.addClass('expanded');
                $items.slideDown(200, () => {
                    // After animation, initialize ItemRows if expanded
                    this.initializeItemRowsInContainer($items);
                    // Scroll to fit expanded content in view
                    this._scrollToFitExpanded($header);
                });
            }
        });

        // Add subcategory collapse/expand handlers
        this.$element.on('click', '.subcategory-header.clickable', (e) => {
            e.stopPropagation(); // Prevent category header from triggering

            const $header = $(e.currentTarget);
            const $subcategory = $header.closest('.collapsible-subcategory');

            const $items = $subcategory.find('.subcategory-items, .subcategory-nested').first();

            const $arrow = $header.find('.expand-arrow');

            // Check current visibility state
            const isCurrentlyVisible = $items.is(':visible');

            // Toggle based on current visibility
            if (isCurrentlyVisible) {
                $arrow.removeClass('expanded');
                $items.slideUp(200);
            } else {
                // Small delay to ensure the browser has rendered the collapsed state
                setTimeout(() => {
                    $arrow.addClass('expanded');
                }, 10);
                $items.slideDown(200, () => {
                    this.initializeItemRowsInContainer($items);
                    // Scroll to fit expanded content in view
                    this._scrollToFitExpanded($header);
                });
            }
        });

        // Add keyword group collapse/expand handlers
        this.$element.on('click', '.keyword-header.clickable', (e) => {
            e.stopPropagation(); // Prevent parent headers from triggering

            const $header = $(e.currentTarget);
            const $keywordGroup = $header.closest('.collapsible-keyword');
            const $items = $keywordGroup.find('.keyword-items');
            const $arrow = $header.find('.expand-arrow');

            // Check current visibility state
            const isCurrentlyVisible = $items.is(':visible');

            // Toggle based on current visibility
            if (isCurrentlyVisible) {
                $arrow.removeClass('expanded');
                $items.slideUp(200);
            } else {
                // Small delay to ensure the browser has rendered the collapsed state
                setTimeout(() => {
                    $arrow.addClass('expanded');
                }, 10);
                $items.slideDown(200, () => {
                    // After animation, initialize ItemRows if expanded
                    this.initializeItemRowsInContainer($items);
                    // Scroll to fit expanded content in view
                    this._scrollToFitExpanded($header);
                });
            }
        });

        // Expand All button — recursively expands every category, subcategory, and keyword group
        this.$element.on('click', '.btn-expand-all-items', (e) => {
            e.stopPropagation();
            const $btn = $(e.currentTarget);
            const $categories = this.$element.find('.owned-items-categories');
            const isExpanding = $btn.data('af-expanded') !== true;

            if (isExpanding) {
                // Expand all top-level categories
                $categories.find('.category-header.clickable').each((_, header) => {
                    const $header = $(header);
                    const $items = $header.closest('.collapsible-category').find('.category-items, .category-subcategories').first();
                    if (!$items.is(':visible')) {
                        $header.find('.expand-arrow').addClass('expanded');
                        $items.show();
                        this.initializeItemRowsInContainer($items);
                    }
                });
                // Expand all subcategories
                $categories.find('.subcategory-header.clickable').each((_, header) => {
                    const $header = $(header);
                    const $items = $header.closest('.collapsible-subcategory').find('.subcategory-items, .subcategory-nested').first();
                    if (!$items.is(':visible')) {
                        $header.find('.expand-arrow').addClass('expanded');
                        $items.show();
                        this.initializeItemRowsInContainer($items);
                    }
                });
                // Expand all keyword groups
                $categories.find('.keyword-header.clickable').each((_, header) => {
                    const $header = $(header);
                    const $items = $header.closest('.collapsible-keyword').find('.keyword-items');
                    if (!$items.is(':visible')) {
                        $header.find('.expand-arrow').addClass('expanded');
                        $items.show();
                        this.initializeItemRowsInContainer($items);
                    }
                });
                $btn.text('⬆️ Collapse All').data('af-expanded', true);
            } else {
                // Collapse everything
                $categories.find('.expand-arrow').removeClass('expanded');
                $categories.find('.category-items, .category-subcategories, .subcategory-items, .subcategory-nested, .keyword-items').hide();
                $btn.text('⬇️ Expand All').data('af-expanded', false);
            }
        });
        // When collapsed, defer initialization until first expand (saves ~700+ SVG requests)
        if (this.expanded) {
            setTimeout(() => {
                this.initializeItemRows();
            }, 0);
        }

        // Search input handler
        this.$element.on('input', '.owned-items-search', (e) => {
            this.applySearch(e.target.value);
        });

        // Custom items: create button
        this.$element.on('click', '.btn-create-generic-item', (e) => {
            e.stopPropagation();
            import('./generic-item-form.js').then(mod => mod.default.show());
        });

        // Custom items: community toggle
        this.$element.on('change', '.gi-show-community-col1', async (e) => {
            e.stopPropagation();
            if (!store.state.column1) store.state.column1 = {};
            const checked = $(e.target).is(':checked');
            store.state.column1.showGenericItemCommunity = checked;
            // Persist to session
            const uuid = store.state.session?.uuid;
            if (uuid) {
                api.updateConfig(uuid, 'ui.column1.showGenericItemCommunity', checked);
            }

            // Get the user's own items (non-community) as the base
            const userItems = (store.state.genericItems || []).filter(i => !i._community);

            if (checked) {
                try {
                    const community = await api.getCommunityDefinitions();
                    const communityItems = community.items || [];
                    // Filter out items the user already owns (by id AND by name to catch seed data)
                    const existingIds = new Set(userItems.map(i => i.id));
                    const existingNames = new Set(userItems.map(i => (i.name || '').toLowerCase()));
                    const newItems = communityItems.filter(ci =>
                        !existingIds.has(ci.id) && !existingNames.has((ci.name || '').toLowerCase())
                    );
                    store.state.communityGenericItems = newItems;
                    store.state.genericItems = [...userItems, ...newItems.map(ci => ({ ...ci, _community: true }))];
                } catch (err) {
                    console.warn('Failed to load community generic items:', err);
                }
            } else {
                // Remove community items from genericItems, keep user's own
                store.state.genericItems = userItems;
                store.state.communityGenericItems = [];
            }

            this._refreshCustomItemsSubcategories();
        });
    }

    /**
     * Refresh the custom items subcategories in-place without collapsing the category.
     * Cleans up stale ItemRow components and rebuilds slot subcategories from store.state.genericItems.
     */
    _refreshCustomItemsSubcategories() {
        const $category = this.$element.find('[data-category="custom-items"]');
        if (!$category.length) return;

        const items = store.state.genericItems || [];

        // Ensure each item has a state entry
        for (const gi of items) {
            const stateId = `generic::item::${gi.id}`;
            if (!store.state.items[stateId]) {
                store.state.items[stateId] = { has: false };
            }
        }

        // Update the count in the header
        $category.find('.category-header .category-count').text(items.length);

        // Destroy ALL generic item components — DOM is about to be rebuilt
        for (const [key, component] of this.itemComponents.entries()) {
            if (key.startsWith('generic::item::')) {
                if (component.destroy) component.destroy();
                this.itemComponents.delete(key);
            }
        }

        // Remove existing slot subcategories (but keep .gi-category-controls)
        const $subcategories = $category.find('.category-subcategories');
        $subcategories.find('.collapsible-subcategory').remove();
        $subcategories.find('.gi-no-items-msg').remove();

        // Build and append new subcategory HTML
        const slotOrder = ['head', 'cape', 'back', 'chest', 'hands', 'legs', 'neck', 'feet', 'ring', 'tool', 'primary', 'secondary', 'consumable', 'collectible', 'input', 'pet'];
        const slotLabels = {
            head: 'Head', cape: 'Cape', back: 'Back', chest: 'Chest',
            hands: 'Hands', legs: 'Legs', neck: 'Neck', feet: 'Feet',
            ring: 'Ring', tool: 'Tool', primary: 'Primary', secondary: 'Secondary',
            consumable: 'Consumable', collectible: 'Collectible', input: 'Input', pet: 'Pet'
        };
        const bySlot = {};
        for (const item of items) {
            const slot = item.slot || 'tool';
            if (!bySlot[slot]) bySlot[slot] = [];
            bySlot[slot].push(item);
        }

        if (items.length === 0) {
            $subcategories.append('<div class="gi-no-items-msg" style="padding:4px 0;color:var(--text-secondary);font-size:12px">No custom items yet.</div>');
        } else {
            for (const slot of slotOrder) {
                if (!bySlot[slot] || bySlot[slot].length === 0) continue;
                const slotItems = bySlot[slot];
                const rows = slotItems.map(item => {
                    const stateId = `generic::item::${item.id}`;
                    return `<div class="item-row-container" data-item-id="${stateId}"></div>`;
                }).join('');
                const label = slotLabels[slot] || slot.charAt(0).toUpperCase() + slot.slice(1);
                $subcategories.append(`
                    <div class="subcategory collapsible-subcategory" data-subcategory="gi-${slot}">
                        <div class="subcategory-header clickable">
                            <img src="/assets/icons/slots/${slot}.svg" class="gi-slot-subcat-icon" />
                            <span class="subcategory-title">${label}</span>
                            <span class="subcategory-count">${slotItems.length}</span>
                            <span class="expand-arrow">▼</span>
                        </div>
                        <div class="subcategory-items" style="display:none">${rows}</div>
                    </div>`);
            }
        }

        // Initialize ItemRows for the new containers
        $subcategories.find('.item-row-container').each((i, container) => {
            this.initializeItemRow(container);
        });
    }

    /**
     * Scroll the column container so that the expanded header and its content
     * are visible. If the content extends below the viewport, scroll up so the
     * header sits near the top of the visible area.
     * @param {jQuery} $header - The header element that was clicked to expand
     */
    _scrollToFitExpanded($header) {
        // On mobile, .column scrolls; on desktop, .column-content scrolls
        let $scrollContainer = this.$element.closest('.column-content');
        if (!$scrollContainer.length || $scrollContainer[0].scrollHeight <= $scrollContainer[0].clientHeight) {
            $scrollContainer = this.$element.closest('.column');
        }
        if (!$scrollContainer.length) return;

        const scrollContainer = $scrollContainer[0];
        const headerEl = $header[0];
        if (!headerEl) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const headerRect = headerEl.getBoundingClientRect();

        // If the header is already in the top half of the viewport, no need to scroll
        const headerRelativeTop = headerRect.top - containerRect.top;
        const viewportHeight = containerRect.height;

        // Only scroll if the header is in the bottom 40% of the visible area
        if (headerRelativeTop > viewportHeight * 0.6) {
            const targetScrollTop = scrollContainer.scrollTop + headerRelativeTop - 80;
            $scrollContainer.animate({ scrollTop: targetScrollTop }, 200);
        }
    }

    /**
     * Initialize ItemRow components for all item containers
     */
    initializeItemRows() {
        // Only mount rows that are actually VISIBLE. Every category/subcategory/
        // keyword group renders collapsed (display:none) by default and lazily
        // mounts its own rows on expand via initializeItemRowsInContainer(), and
        // search lazily mounts matching rows. Mounting every row here — including
        // the ~700 hidden ones — needlessly builds DOM and fires hundreds of icon
        // (SVG) requests on a single blocking task, which froze page load for
        // 25-30s whenever the Owned Items section was expanded on load.
        // Scoping to :visible makes this a no-op on a freshly-rendered (collapsed)
        // section while still mounting rows in any category the user has expanded.
        const $containers = this.$element.find('.item-row-container:visible');

        $containers.each((i, container) => {
            this.initializeItemRow(container);
        });
    }

    /**
     * Initialize ItemRow components in a specific container
     * @param {jQuery} $container - jQuery object containing item-row-container elements
     */
    initializeItemRowsInContainer($container) {
        const $containers = $container.find('.item-row-container');
        console.log(`Initializing ${$containers.length} items in expanded section`);

        $containers.each((i, container) => {
            this.initializeItemRow(container);
        });
    }

    /**
     * Initialize a single ItemRow component
     * @param {HTMLElement} container - The item-row-container element
     */
    initializeItemRow(container) {
        const $container = $(container);
        const itemId = $container.data('item-id');
        const skill = $container.data('skill');
        const subcat = $container.data('subcat');

        // Use composite key when item appears in multiple subcategories
        const componentKey = skill ? `${itemId}__${skill}` : (subcat ? `${itemId}__${subcat}` : itemId);

        // Skip if already initialized
        if (this.itemComponents.has(componentKey)) {
            return;
        }

        // Find the item in the catalog
        const item = this.findItemById(itemId);
        if (!item) {
            console.warn(`Item not found in catalog: ${itemId}`);
            // Remove the empty container
            $container.remove();
            return;
        }

        // Determine if this is a crafted item (needs quality dropdown)
        const showQuality = item.type === 'crafted_item';

        // Create ItemRow component
        try {
            const itemRow = new ItemRow(container, { item, showQuality });
            this.itemComponents.set(componentKey, itemRow);
        } catch (error) {
            console.error(`Failed to create ItemRow for ${item.name}:`, error);
            // Remove the container if ItemRow creation fails
            $container.remove();
        }
    }

    /**
     * Find an item by ID in the catalog
     * @param {string} itemId - Item ID
     * @returns {Object|null} Item object or null
     */
    findItemById(itemId) {
        // Use this.catalog if available (after constructor), otherwise props
        const catalog = this.catalog || this.props.catalog || { categories: {} };
        if (!catalog.categories) {
            return null;
        }

        // Search through all categories
        const categories = catalog.categories;

        // Collectibles (dict of subcategories)
        const collectibles = categories.collectibles || {};
        for (const subcatData of Object.values(collectibles)) {
            if (Array.isArray(subcatData)) {
                for (const item of subcatData) {
                    if (item.id === itemId) return item;
                }
            } else if (typeof subcatData === 'object') {
                for (const groupItems of Object.values(subcatData)) {
                    for (const item of groupItems) {
                        if (item.id === itemId) return item;
                    }
                }
            }
        }

        // Consumables
        for (const skillItems of Object.values(categories.consumables || {})) {
            for (const item of skillItems) {
                if (item.id === itemId) return item;
            }
        }

        // Materials
        for (const item of (categories.materials || [])) {
            if (item.id === itemId) return item;
        }

        // Loot
        for (const subcatItems of Object.values(categories.loot || {})) {
            if (Array.isArray(subcatItems)) {
                for (const item of subcatItems) {
                    if (item.id === itemId) return item;
                }
            } else if (typeof subcatItems === 'object') {
                for (const keywordItems of Object.values(subcatItems)) {
                    for (const item of keywordItems) {
                        if (item.id === itemId) return item;
                    }
                }
            }
        }

        // Crafted
        for (const keywordItems of Object.values(categories.crafted || {})) {
            for (const item of keywordItems) {
                if (item.id === itemId) return item;
            }
        }

        // Chests - search through chest contents
        for (const chest of Object.values(categories.chests || {})) {
            if (chest.contents) {
                for (const item of chest.contents) {
                    if (item.id === itemId) return item;
                }
            }
        }

        // Pets
        for (const item of (categories.pets || [])) {
            if (item.id === itemId) return item;
        }

        // Generic items (custom user-created items)
        if (itemId.startsWith('generic::item::')) {
            const genericId = itemId.replace('generic::item::', '');
            const genericItems = store.state.genericItems || [];
            const gi = genericItems.find(g => g.id === genericId);
            if (gi) return this._genericItemToCatalogItem(gi);
        }

        return null;
    }

    /**
     * Build a map of item ID -> lowercase name for fast search filtering
     */
    _buildItemNameMap() {
        const map = {};
        const allItems = this.getAllItems();
        for (const item of allItems) {
            // Include both name and keywords for search
            const keywords = (item.keywords || []).join(' ').toLowerCase();
            map[item.id] = `${(item.name || '').toLowerCase()} ${keywords}`;
        }
        const chests = (this.catalog && this.catalog.categories && this.catalog.categories.chests) || {};
        for (const chest of Object.values(chests)) {
            if (chest.contents) {
                for (const item of chest.contents) {
                    const keywords = (item.keywords || []).join(' ').toLowerCase();
                    map[item.id] = `${(item.name || '').toLowerCase()} ${keywords}`;
                }
            }
        }
        // Include generic items in search (searchable by name and keywords)
        const genericItems = store.state.genericItems || [];
        for (const item of genericItems) {
            const keywords = (item.keywords || []).join(' ').toLowerCase();
            map[`generic::item::${item.id}`] = `${(item.name || '').toLowerCase()} ${keywords}`;
        }
        return map;
    }

    /**
     * Apply search filter - hide/show item rows and auto-expand matching sections
     */
    applySearch(searchText) {
        this.searchText = searchText;
        const query = searchText.toLowerCase().trim();
        const $container = this.$element.find('.owned-items-categories');

        if (!query) {
            // Clear search: remove all search classes, restore normal state
            $container.find('.search-match').removeClass('search-match');
            $container.find('.search-no-match').removeClass('search-no-match');
            $container.find('.search-hidden').removeClass('search-hidden');
            $container.find('.search-expanded').each((_, el) => {
                // Collapse sections that were auto-expanded by search
                const $el = $(el);
                $el.removeClass('search-expanded');
                $el.find('> .category-items, > .category-subcategories, > .subcategory-items, > .subcategory-nested, > .keyword-items').hide();
                $el.find('> .category-header > .expand-arrow, > .subcategory-header > .expand-arrow, > .keyword-header > .expand-arrow').removeClass('expanded');
            });
            return;
        }

        // Build name map lazily on first search
        if (!this.itemNameMap) {
            this.itemNameMap = this._buildItemNameMap();
        }

        // Mark item rows as match/no-match using classes (works even when parent is hidden)
        $container.find('.item-row-container').each((_, el) => {
            const $el = $(el);
            const itemId = $el.data('item-id');
            const name = this.itemNameMap[itemId] || '';
            const matches = name.includes(query);
            $el.toggleClass('search-match', matches);
            $el.toggleClass('search-no-match', !matches);
        });

        // Keyword groups: hide if no matching items, auto-expand if matches
        $container.find('.collapsible-keyword').each((_, el) => {
            const $group = $(el);
            const hasMatch = $group.find('.item-row-container.search-match').length > 0;
            $group.toggleClass('search-hidden', !hasMatch);
            if (hasMatch) {
                $group.addClass('search-expanded');
                $group.find('.keyword-items').show();
                $group.find('.keyword-header > .expand-arrow').addClass('expanded');
            }
        });

        // Subcategories
        $container.find('.collapsible-subcategory').each((_, el) => {
            const $sub = $(el);
            const hasMatch = $sub.find('.item-row-container.search-match').length > 0;
            $sub.toggleClass('search-hidden', !hasMatch);
            if (hasMatch) {
                $sub.addClass('search-expanded');
                $sub.find('> .subcategory-items, > .subcategory-nested').show();
                $sub.find('> .subcategory-header > .expand-arrow').addClass('expanded');
            }
        });

        // Categories
        $container.find('.collapsible-category').each((_, el) => {
            const $cat = $(el);
            const hasMatch = $cat.find('.item-row-container.search-match').length > 0;
            $cat.toggleClass('search-hidden', !hasMatch);
            if (hasMatch) {
                $cat.addClass('search-expanded');
                $cat.find('> .category-items, > .category-subcategories').show();
                $cat.find('> .category-header > .expand-arrow').addClass('expanded');
            }
        });

        // Initialize any matching item rows that haven't been initialized yet
        $container.find('.item-row-container.search-match').each((_, el) => {
            this.initializeItemRow(el);
        });
    }

    /**
     * Clean up component
     */
    destroy() {
        // Destroy all ItemRow components
        for (const itemRow of this.itemComponents.values()) {
            itemRow.destroy();
        }
        this.itemComponents.clear();

        // Call parent destroy
        super.destroy();
    }
}

export default OwnedItemsSection;
