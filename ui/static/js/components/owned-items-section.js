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

        // Validate catalog
        if (!catalog || !catalog.categories) {
            console.error('OwnedItemsSection: Invalid catalog provided', catalog);
        }

        // Subscribe to item changes to update counts
        // Listen to both base items and user override items
        this.subscribe('items', () => this.updateCounts());
        this.subscribe('ui.user_overrides.items', () => this.updateCounts());

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

        console.log('renderContent called, catalog:', catalog);
        console.log('catalog.categories:', catalog.categories);
        if (catalog.categories) {
            console.log('collectibles count:', catalog.categories.collectibles?.length);
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
                ${this.renderCollectibles()}
                ${this.renderConsumables()}
                ${this.renderLoot()}
                ${this.renderCrafted()}
                ${this.renderChests()}
                ${this.renderPets()}
                ${this.renderMaterials()}
            </div>
        `;

        return html;
    }

    /**
     * Render Collectibles category
     * @returns {string} HTML string
     */
    renderCollectibles() {
        const catalog = this.props.catalog || { categories: {} };
        const items = catalog.categories.collectibles || [];
        const obtained = this.countObtained(items);

        console.log(`Rendering Collectibles: ${items.length} items`);

        return `
            <div class="item-category collapsible-category" data-category="collectibles">
                <div class="category-header clickable">
                    <span class="category-title">Collectibles</span>
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
     * Render Consumables category with skill subcategories
     * @returns {string} HTML string
     */
    renderConsumables() {
        const catalog = this.props.catalog || { categories: {} };
        const consumablesBySkill = catalog.categories.consumables || {};
        const allItems = Object.values(consumablesBySkill).flat();
        const obtained = this.countObtained(allItems);

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
                    <span class="category-count">${obtained}/${allItems.length}</span>
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
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}"></div>`).join('')}
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
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}"></div>`).join('')}
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
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}"></div>`).join('')}
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
        const allItems = Object.values(craftedByKeyword).flat();
        const obtained = this.countObtained(allItems);

        // Sort keywords alphabetically, but put "Misc. Crafted" at the end
        const sortedKeywords = Object.keys(craftedByKeyword).sort((a, b) => {
            if (a === 'Misc. Crafted') return 1;
            if (b === 'Misc. Crafted') return -1;
            return a.localeCompare(b);
        });

        return `
            <div class="item-category collapsible-category" data-category="crafted">
                <div class="category-header clickable">
                    <span class="category-title">Crafted</span>
                    <span class="category-count">${obtained}/${allItems.length}</span>
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

        return `
            <div class="subcategory collapsible-subcategory" data-subcategory="${keyword}">
                <div class="subcategory-header clickable">
                    <span class="subcategory-title">${keyword}</span>
                    <span class="subcategory-count">${obtained}/${items.length}</span>
                    <span class="expand-arrow">▼</span>
                </div>
                <div class="subcategory-items" style="display: none;">
                    ${items.map(item => `<div class="item-row-container" data-item-id="${item.id}"></div>`).join('')}
                </div>
            </div>
        `;
    }

    /**
     * Render Chests category
     * @returns {string} HTML string
     */
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
        console.log(`Rendering chest: ${chest.name}, contents:`, chest.contents);
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
        return `
            <div class="item-category collapsible-category" data-category="pets">
                <div class="category-header clickable">
                    <span class="category-title">Pets</span>
                    <span class="category-count">TODO - not in export yet</span>
                    <span class="category-arrow">▼</span>
                </div>
            </div>
        `;
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

        // Collectibles
        items.push(...(catalog.categories.collectibles || []));

        // Consumables
        const consumables = catalog.categories.consumables || {};
        for (const skillItems of Object.values(consumables)) {
            items.push(...skillItems);
        }

        // Materials
        items.push(...(catalog.categories.materials || []));

        // Loot
        const loot = catalog.categories.loot || {};
        for (const [subcategory, subcatItems] of Object.entries(loot)) {
            if (Array.isArray(subcatItems)) {
                items.push(...subcatItems);
            } else if (typeof subcatItems === 'object') {
                for (const keywordItems of Object.values(subcatItems)) {
                    items.push(...keywordItems);
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

            // Find all items in this container
            const $items = $container.find('.item-row-container');
            const total = $items.length;

            if (total === 0) {
                return; // Skip empty categories (TODO placeholders)
            }

            // Count obtained items - check user overrides first
            let obtained = 0;
            $items.each((j, itemEl) => {
                const itemId = $(itemEl).data('item-id');

                // Check user overrides first, then fall back to base items state
                const overrides = store.state.ui.user_overrides || {};
                const overrideItemState = (overrides.items && overrides.items[itemId]) || {};
                const baseItemState = store.state.items[itemId] || {};

                const has = overrideItemState.has !== undefined ? overrideItemState.has : baseItemState.has;

                if (has === true) {
                    obtained++;
                }
            });

            $el.text(`${obtained}/${total}`);
        });
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

            console.log('Category clicked, arrow classes:', $arrow.attr('class'));

            // Check current visibility state
            const isCurrentlyVisible = $items.is(':visible');

            console.log('Is currently visible:', isCurrentlyVisible);

            // Toggle based on current visibility
            if (isCurrentlyVisible) {
                console.log('Collapsing - removing expanded class');
                $arrow.removeClass('expanded');
                console.log('After removeClass, arrow classes:', $arrow.attr('class'));
                $items.slideUp(200);
            } else {
                console.log('Expanding - adding expanded class');
                $arrow.addClass('expanded');
                console.log('After addClass, arrow classes:', $arrow.attr('class'));
                $items.slideDown(200, () => {
                    // After animation, initialize ItemRows if expanded
                    this.initializeItemRowsInContainer($items);
                });
            }
        });

        // Add subcategory collapse/expand handlers
        this.$element.on('click', '.subcategory-header.clickable', (e) => {
            console.log('Subcategory header clicked');
            e.stopPropagation(); // Prevent category header from triggering

            const $header = $(e.currentTarget);
            const $subcategory = $header.closest('.collapsible-subcategory');
            console.log('Found subcategory:', $subcategory.length);

            const $items = $subcategory.find('.subcategory-items, .subcategory-nested').first();
            console.log('Found items container:', $items.length, 'visible:', $items.is(':visible'));

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
                    console.log('Slide down complete, now visible:', $items.is(':visible'));
                    console.log('Calling initializeItemRowsInContainer');
                    this.initializeItemRowsInContainer($items);
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
                });
            }
        });

        // Only initialize ItemRow components if the section is expanded
        // When collapsed, defer initialization until first expand (saves ~700+ SVG requests)
        if (this.expanded) {
            setTimeout(() => {
                this.initializeItemRows();
            }, 0);
        }
    }

    /**
     * Initialize ItemRow components for all item containers
     */
    initializeItemRows() {
        console.log('Initializing ItemRow components...');

        // Find all item row containers
        const $containers = this.$element.find('.item-row-container');
        console.log(`Found ${$containers.length} item containers`);

        $containers.each((i, container) => {
            this.initializeItemRow(container);
        });

        console.log(`Initialized ${this.itemComponents.size} ItemRow components`);
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

        console.log('initializeItemRow called for:', itemId);

        // Skip if already initialized
        if (this.itemComponents.has(itemId)) {
            console.log('  Already initialized, skipping');
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

        console.log('  Found item:', item.name);

        // Determine if this is a crafted item (needs quality dropdown)
        const showQuality = item.type === 'crafted_item';

        // Create ItemRow component
        try {
            const itemRow = new ItemRow(container, { item, showQuality });
            this.itemComponents.set(itemId, itemRow);
            console.log('  ItemRow created successfully');
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

        // Collectibles
        for (const item of (categories.collectibles || [])) {
            if (item.id === itemId) return item;
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

        return null;
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
