/**
 * OptimizeButton Component
 * 
 * Button that appears when an activity or recipe is selected.
 * Runs optimization to find the best gearset and auto-saves it.
 * 
 * Features:
 * - Only visible when activity or recipe is selected
 * - Shows loading state during optimization
 * - Auto-saves optimized gearset with descriptive name
 * - Gear icon button to open optimization settings
 * - Target drop/quality selector
 * - Background optimization with polling
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';

class OptimizeButton extends Component {
    /**
     * Create an optimize button
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // UI state
        this.isOptimizing = false;
        this.selectedActivity = null;
        this.selectedRecipe = null;
        this.targetDrop = 'raw_rewards'; // Default for activities
        this.targetQuality = 'Perfect'; // Default for recipes
        this.dropTableData = null;
        this.recipeData = null;
        this.isTargetDropdownOpen = false;
        this.showEquipButton = false;
        this.optimizedGearsetId = null;

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onSelectionChange());
        this.subscribe('column3.selectedRecipe', () => this.onSelectionChange());

        // Listen for show item finding drops checkbox change
        window.addEventListener('showItemFindingDropsChanged', () => {
            console.log('Show item finding drops changed, reloading drop table');
            if (this.selectedActivity) {
                // If unchecking and current target is an equipment drop, reset to raw rewards
                const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';
                if (!showItemFinding && this.targetDrop !== 'raw_rewards' && this.dropTableData) {
                    const currentDrop = this.dropTableData.find(d =>
                        d.item_name === this.targetDrop || `${d.item_name} (Fine)` === this.targetDrop
                    );
                    if (currentDrop && currentDrop.source === 'equipment') {
                        this.targetDrop = 'raw_rewards';
                    }
                }

                this.loadDropTable().then(() => {
                    this.render();
                    this.attachEvents();
                });
            }
        });

        this.render();
    }

    /**
     * Handle selection change
     */
    async onSelectionChange() {
        const prevActivity = this.selectedActivity;
        const prevRecipe = this.selectedRecipe;

        this.selectedActivity = store.state.column3?.selectedActivity;
        this.selectedRecipe = store.state.column3?.selectedRecipe;

        // Load drop table if activity selected and changed
        if (this.selectedActivity && this.selectedActivity !== prevActivity) {
            console.log('Activity changed, loading drop table for:', this.selectedActivity);

            // Save current target drop before loading new drop table
            const previousTargetDrop = this.targetDrop;

            await this.loadDropTable();
            console.log('Drop table loaded:', this.dropTableData);

            // Check if previous target exists in new drop table
            if (previousTargetDrop && previousTargetDrop !== 'raw_rewards' && this.dropTableData) {
                const targetExists = this.dropTableData.some(drop =>
                    drop.item_name === previousTargetDrop ||
                    `${drop.item_name} (Fine)` === previousTargetDrop
                );

                if (targetExists) {
                    // Keep the same target
                    console.log('Previous target exists in new activity, keeping:', previousTargetDrop);
                    this.targetDrop = previousTargetDrop;
                } else {
                    // Reset to raw rewards
                    console.log('Previous target not found in new activity, resetting to raw rewards');
                    this.targetDrop = 'raw_rewards';
                }
            } else if (!prevActivity) {
                // First time selecting an activity
                this.targetDrop = 'raw_rewards';
            }
        }

        // Load recipe data if recipe selected and changed
        if (this.selectedRecipe && this.selectedRecipe !== prevRecipe) {
            console.log('Recipe changed, loading recipe data for:', this.selectedRecipe);
            await this.loadRecipeData();
            console.log('Recipe data loaded:', this.recipeData);

            // Reset quality when switching recipes (or first time)
            if (!prevRecipe) {
                this.targetQuality = 'Perfect';
            }

            // Hide equip button when recipe changes
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
        }

        // Hide equip button when activity changes
        if (this.selectedActivity && this.selectedActivity !== prevActivity) {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
        }

        this.render();
    }

    /**
     * Load drop table for selected activity
     */
    async loadDropTable() {
        try {
            const response = await $.get('/api/activities');
            console.log('Activities API response:', response);

            const activity = response.activities.find(a => a.id === this.selectedActivity);
            if (activity) {
                // Combine primary and secondary drop tables
                this.dropTableData = [
                    ...(activity.drop_table || []),
                    ...(activity.secondary_drop_table || [])
                ];
                console.log('Found activity, combined drop tables:', this.dropTableData.length, 'drops');

                // If "Show item finding drops" is checked, collect ALL ItemFindingCategory stats from ALL owned items
                const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';
                console.log('Show item finding drops:', showItemFinding);
                if (showItemFinding) {
                    await this.addAllItemFindingDrops(activity);
                }
            } else {
                console.error('Activity not found in response:', this.selectedActivity);
                console.log('Available activities:', response.activities.map(a => a.id));
            }
        } catch (error) {
            console.error('Failed to load drop table:', error);
        }
    }

    /**
     * Add ALL item finding drops from ALL owned items for this activity
     * @param {Object} activity - Activity object with primary_skill
     */
    async addAllItemFindingDrops(activity) {
        try {
            console.log('=== addAllItemFindingDrops START ===');
            const skill = activity.primary_skill?.toLowerCase() || 'global';
            console.log('Calling /api/all-item-finding-drops for skill:', skill);

            const response = await fetch('/api/all-item-finding-drops', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skill })
            });

            if (!response.ok) {
                console.error('Backend returned error:', response.status);
                return;
            }

            const data = await response.json();
            const equipmentDrops = data.drops || [];

            console.log('Backend returned', equipmentDrops.length, 'expanded drops');

            for (const drop of equipmentDrops) {
                this.dropTableData.push({
                    item_name: drop.item_name,
                    item_ref: drop.item_ref,
                    chance_percent: drop.chance_percent,
                    quantity: { min: drop.min_qty, max: drop.max_qty },
                    has_fine_material: drop.has_fine_material,
                    source: 'equipment'
                });
            }

            console.log('Total drops after adding equipment:', this.dropTableData.length);
            console.log('=== addAllItemFindingDrops END ===');
        } catch (error) {
            console.error('Failed to add item finding drops:', error);
        }
    }

    /**
     * Load recipe data for selected recipe
     */
    async loadRecipeData() {
        try {
            const response = await $.get('/api/recipes');
            const recipe = response.recipes.find(r => r.id === this.selectedRecipe);
            if (recipe) {
                this.recipeData = recipe;
                console.log('Found recipe, has_fine_option:', recipe.has_fine_option);
            } else {
                console.error('Recipe not found:', this.selectedRecipe);
            }
        } catch (error) {
            console.error('Failed to load recipe data:', error);
        }
    }

    /**
     * Check if current recipe produces quality items
     */
    isQualityRecipe() {
        // If recipe data not loaded yet, assume it's NOT a quality recipe (safer default)
        if (!this.recipeData) {
            console.log('isQualityRecipe: No recipe data loaded, assuming non-quality');
            return false;
        }

        // has_fine_option is TRUE when recipe CAN use fine materials (materials/consumables)
        // has_fine_option is FALSE when recipe uses equipment as input
        // 
        // BUT: Planks and other materials DON'T have quality!
        // The flag means "can use fine materials" not "produces quality items"
        // 
        // We need to check the OUTPUT item type instead
        const outputItem = this.recipeData.output_item;

        // If output is an Item (equipment), it HAS quality
        const isQuality = outputItem && outputItem.startsWith('Item.');

        console.log('isQualityRecipe:', isQuality, 'output_item:', outputItem, 'recipe:', this.recipeData.name);
        return isQuality;
    }

    /**
     * Check if button should be visible
     */
    shouldShow() {
        return !!(this.selectedActivity || this.selectedRecipe);
    }

    /**
     * Open settings modal to optimization tab
     */
    openOptimizationSettings() {
        // Find the settings modal instance
        if (window.settingsModal) {
            window.settingsModal.activeTab = 'optimization';
            window.settingsModal.show();
        }
    }

    /**
     * Toggle target dropdown
     */
    toggleTargetDropdown() {
        this.isTargetDropdownOpen = !this.isTargetDropdownOpen;

        const $dropdown = this.$element.find('.target-dropdown');
        const $arrow = this.$element.find('.target-dropdown-toggle .expand-arrow');

        if (this.isTargetDropdownOpen) {
            // Render dropdown content
            $dropdown.html(this.renderTargetDropdownContent());

            // Update arrow and slide down
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);
        } else {
            // Update arrow and slide up
            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
        }
    }

    /**
     * Select target drop (for activities)
     */
    selectTargetDrop(itemName) {
        this.targetDrop = itemName;
        this.isTargetDropdownOpen = false;
        this.render();
    }

    /**
     * Select target quality (for recipes)
     */
    selectTargetQuality(quality) {
        this.targetQuality = quality;
        this.isTargetDropdownOpen = false;
        this.render();
    }

    /**
     * Run optimization
     */
    async optimize() {
        if (this.isOptimizing) {
            return;
        }

        this.isOptimizing = true;

        // Store optimization start time for polling
        this.optimizationStartTime = new Date().toISOString();

        this.render();

        try {
            // Determine optimization type and ID
            const optType = this.selectedActivity ? 'activity' : 'recipe';
            const optId = this.selectedActivity || this.selectedRecipe;

            console.log(`Starting optimization for ${optType}: ${optId}`);

            // Get sorting priorities from session
            const sortingPriority = await this.getSortingPriorities(optType);

            // Build request data
            const requestData = {
                type: optType,
                id: optId,
                sorting_priority: sortingPriority
            };

            // Debug: log current state
            console.log('Current store.state.column3:', store.state.column3);

            // Get include_consumables from settings based on optimization type
            let includeConsumables = false;
            if (window.settingsModal) {
                includeConsumables = optType === 'activity'
                    ? window.settingsModal.includeConsumablesActivity
                    : window.settingsModal.includeConsumablesRecipe;
            }
            requestData.include_consumables = includeConsumables;
            console.log('includeConsumables:', includeConsumables);

            // Add target item or quality
            if (optType === 'activity' && this.targetDrop !== 'raw_rewards') {
                requestData.target_item = this.targetDrop;
            } else if (optType === 'recipe') {
                requestData.target_quality = this.targetQuality;

                // Get selected service from state (most up-to-date)
                const selectedService = store.state.column3?.selectedService;
                console.log('selectedService from state:', selectedService);

                if (selectedService) {
                    requestData.service_id = selectedService;
                    console.log('Using selected service:', selectedService);
                } else {
                    console.log('No service selected, backend will auto-select');
                }
            }

            console.log('Final requestData:', requestData);

            // Call API
            const response = await $.ajax({
                url: '/api/optimize-gearset',
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify(requestData)
            });

            console.log('Optimization response:', response);

            if (response.success) {
                // Keep button in loading state while polling
                // Don't reset isOptimizing yet

                // Show success message
                api.showSuccess('Optimization started! Finding best gearset...');

                // Start polling for new gearsets (keeps button in loading state)
                this.startPollingForGearset();
            } else {
                api.showError('Optimization failed to start');
                this.isOptimizing = false;
                this.render();
            }

        } catch (error) {
            console.error('Optimization error:', error);

            // Check for specific error messages
            if (error.responseJSON?.detail?.message) {
                const message = error.responseJSON.detail.message;
                const traceback = error.responseJSON.detail.traceback;

                if (traceback) {
                    console.error('Server traceback:', traceback);
                }

                api.showError(message);
            } else if (error.responseJSON?.detail) {
                api.showError(error.responseJSON.detail);
            } else if (error.responseText) {
                console.error('Response text:', error.responseText);
                api.showError('Optimization failed. Check console for details.');
            } else {
                api.showError('Optimization failed. Please try again.');
            }

            // Reset loading state on error
            this.isOptimizing = false;
            this.render();
        }
        // Note: Don't reset isOptimizing in finally - let polling handle it
    }

    /**
     * Get sorting priorities from session
     * @param {string} optType - 'activity' or 'recipe'
     * @returns {Array} Array of metric keys in priority order
     */
    async getSortingPriorities(optType) {
        try {
            const response = await $.get('/api/optimization-settings');
            let priorities = optType === 'activity' ?
                response.activity.current_order :
                response.recipe.current_order;

            // For non-quality recipes, filter out quality-specific sorting
            if (optType === 'recipe' && !this.isQualityRecipe()) {
                const qualitySpecificKeys = ['materials_for_target', 'steps_for_target', 'total_crafts'];
                priorities = priorities.filter(key => !qualitySpecificKeys.includes(key));
                console.log('Non-quality recipe, filtered priorities:', priorities);
            }

            return priorities;
        } catch (error) {
            console.error('Failed to get sorting priorities:', error);

            // Return defaults
            if (optType === 'activity') {
                return ['steps_per_reward_roll', 'primary_xp_per_step', 'expected_steps_per_action'];
            } else {
                // For recipes, use non-quality defaults if needed
                if (!this.isQualityRecipe()) {
                    return ['current_steps', 'primary_xp_per_step', 'materials_per_craft'];
                }
                return ['materials_for_target', 'steps_for_target', 'current_steps'];
            }
        }
    }

    /**
     * Start polling for new gearsets (check every 5 seconds for 2 minutes)
     */
    startPollingForGearset() {
        let pollCount = 0;
        const maxPolls = 24; // 2 minutes (24 * 5 seconds)

        const startTime = this.optimizationStartTime;
        console.log('Starting polling, looking for gearsets created after:', startTime);

        const pollInterval = setInterval(async () => {
            pollCount++;
            console.log(`Poll #${pollCount}: Checking for new optimized gearsets...`);

            try {
                console.log('  Fetching gearsets...');

                // Fetch gearsets
                const response = await $.get('/api/session/' + store.state.session.uuid + '/gearsets');

                console.log(`  Total gearsets: ${response.length}`);
                console.log(`  Looking for: is_optimized=true AND created_at > ${startTime}`);

                // Debug: show optimized gearsets
                const optimizedGearsets = response.filter(gs => gs.is_optimized);
                console.log(`  Optimized gearsets: ${optimizedGearsets.length}`);
                optimizedGearsets.forEach(gs => {
                    console.log(`    - "${gs.name}": created_at=${gs.created_at}`);
                });

                // Look for optimized gearsets created after optimization started
                // Convert timestamps to Date objects for proper comparison
                const startDate = new Date(startTime);
                const newOptimizedGearset = response.find(gs => {
                    if (!gs.is_optimized) return false;
                    const gsDate = new Date(gs.created_at);
                    return gsDate > startDate;
                });

                if (newOptimizedGearset) {
                    console.log('✓ New optimized gearset detected:', newOptimizedGearset.name);

                    // Store the gearset ID for equip button
                    this.optimizedGearsetId = newOptimizedGearset.id;
                    this.showEquipButton = true;

                    // Show notification
                    api.showSuccess(`Optimization complete! Saved: ${newOptimizedGearset.name}`);

                    // Reload gearsets from API
                    store._loadGearSets(store.state.session.uuid);

                    // Reset loading state and render to show equip button
                    this.isOptimizing = false;
                    this.render();

                    clearInterval(pollInterval);
                } else {
                    console.log('  No new optimized gearsets found yet');
                }
            } catch (error) {
                console.error('Failed to poll for gearsets:', error);
                console.error('Error details:', error.responseJSON || error.responseText || error);
            }

            // Stop polling after max attempts
            if (pollCount >= maxPolls) {
                console.log('Polling timeout - optimization may still be running');
                this.isOptimizing = false;
                this.render();
                clearInterval(pollInterval);
            }
        }, 5000); // Poll every 5 seconds
    }

    /**
     * Render target dropdown content
     */
    renderTargetDropdownContent() {
        console.log('renderTargetDropdownContent called');
        console.log('selectedActivity:', this.selectedActivity);
        console.log('selectedRecipe:', this.selectedRecipe);
        console.log('dropTableData:', this.dropTableData);

        if (this.selectedActivity) {
            // Activity: show drop table items
            if (!this.dropTableData) {
                console.log('No drop table data, showing loading...');
                return '<div class="target-item">Loading...</div>';
            }

            console.log('Building drop list from', this.dropTableData.length, 'drops');

            // Check if we should show item finding drops
            const showItemFinding = localStorage.getItem('showItemFindingDrops') === 'true';

            // Build sorted list: raw rewards first, then alphabetical
            const items = [
                { name: 'Raw Reward Rolls', value: 'raw_rewards', icon: '/assets/icons/attributes/double_rewards.svg' }
            ];

            // Separate regular drops from equipment (item finding) drops
            const regularDrops = this.dropTableData
                .filter(drop => drop.item_name !== 'Nothing' && drop.source !== 'equipment')
                .sort((a, b) => a.item_name.localeCompare(b.item_name));

            const equipmentDrops = showItemFinding ? this.dropTableData
                .filter(drop => drop.item_name !== 'Nothing' && drop.source === 'equipment')
                .sort((a, b) => a.item_name.localeCompare(b.item_name))
                : [];

            // Build set of regular drop names for checking duplicates
            const regularDropNames = new Set(regularDrops.map(d => d.item_name));

            console.log('Regular drops:', regularDrops.length, 'Equipment drops:', equipmentDrops.length);

            // Add regular drops first
            for (const drop of regularDrops) {
                items.push({
                    name: drop.item_name,
                    value: drop.item_name,
                    icon: this.getDropIcon(drop)
                });

                if (drop.has_fine_material) {
                    items.push({
                        name: `${drop.item_name} (Fine)`,
                        value: `${drop.item_name} (Fine)`,
                        icon: this.getDropIcon(drop),
                        isFine: true
                    });
                }
            }

            // Add equipment drops at the end (with * prefix if not already a regular drop)
            for (const drop of equipmentDrops) {
                const isAlsoRegularDrop = regularDropNames.has(drop.item_name);
                if (isAlsoRegularDrop) continue;  // Skip duplicates

                items.push({
                    name: `✦ ${drop.item_name}`,
                    value: drop.item_name,
                    icon: this.getDropIcon(drop),
                    isEquipmentDrop: true
                });

                if (drop.has_fine_material) {
                    items.push({
                        name: `✦ ${drop.item_name} (Fine)`,
                        value: `${drop.item_name} (Fine)`,
                        icon: this.getDropIcon(drop),
                        isFine: true,
                        isEquipmentDrop: true
                    });
                }
            }

            console.log('Total items to render:', items.length);

            return items.map(item => `
                <div class="target-item ${item.isFine ? 'fine-item' : ''} ${item.isEquipmentDrop ? 'equipment-drop-item' : ''}" data-value="${item.value}">
                    <img src="${item.icon}" alt="${item.name}" class="target-icon" />
                    <span>${item.name}</span>
                </div>
            `).join('');

        } else if (this.selectedRecipe) {
            // Recipe: show quality options
            const qualities = [
                { name: 'Normal', value: 'Normal', color: 'var(--rarity-common)' },
                { name: 'Good', value: 'Good', color: 'var(--rarity-uncommon)' },
                { name: 'Great', value: 'Great', color: 'var(--rarity-rare)' },
                { name: 'Excellent', value: 'Excellent', color: 'var(--rarity-epic)' },
                { name: 'Perfect', value: 'Perfect', color: 'var(--rarity-legendary)' },
                { name: 'Eternal', value: 'Eternal', color: 'var(--rarity-ethereal)' }
            ];

            return qualities.map(q => `
                <div class="target-item quality-item" data-value="${q.value}" style="background: ${q.color};">
                    <span>${q.name}</span>
                </div>
            `).join('');
        }

        return '';
    }

    /**
     * Get icon path for a drop (EXACT same logic as drops-section.js)
     */
    getDropIcon(drop) {
        let iconPath = '';

        // Special case for coins
        if (drop.item_name === 'Coins') {
            iconPath = '/assets/icons/items/coins.svg';
        } else if (drop.item_ref) {
            // Parse item reference to get icon path
            // Format: "Material.ITEM_NAME" or "Item.ITEM_NAME" or "Collectible.ITEM_NAME"
            const [type, itemName] = drop.item_ref.split('.');

            // Use the actual item name from drop.item_name for the icon filename (lowercase)
            // This preserves apostrophes and uses lowercase
            const iconName = drop.item_name.toLowerCase().replace(/ /g, '_');

            if (type === 'Currency') {
                iconPath = `/assets/icons/items/${iconName}.svg`;
            } else if (type === 'Material') {
                iconPath = `/assets/icons/items/materials/${iconName}.svg`;
            } else if (type === 'Item') {
                iconPath = `/assets/icons/items/equipment/${iconName}.svg`;
            } else if (type === 'Collectible') {
                iconPath = `/assets/icons/items/collectibles/${iconName}.svg`;
            } else if (type === 'Consumable') {
                iconPath = `/assets/icons/items/consumables/${iconName}.svg`;
            } else if (type === 'Container') {
                iconPath = `/assets/icons/items/containers/${iconName}.svg`;
            } else if (type === 'Egg') {
                iconPath = `/assets/icons/items/pet_eggs/${iconName}.svg`;
            }
        }

        // Fallback: if no icon path determined, try to infer from item name (lowercase)
        if (!iconPath && drop.item_name) {
            // Convert to icon filename: lowercase, spaces to underscores, keep apostrophes
            const itemNameFormatted = drop.item_name.toLowerCase().replace(/ /g, '_');
            // Try materials first, then consumables
            iconPath = `/assets/icons/items/materials/${itemNameFormatted}.svg`;
        }

        return iconPath || '/assets/icons/items/materials/placeholder.svg';
    }

    /**
     * Get display name for current target
     */
    getTargetDisplayName() {
        if (this.selectedActivity) {
            return this.targetDrop === 'raw_rewards' ? 'Raw Reward Rolls' : this.targetDrop;
        } else if (this.selectedRecipe) {
            return this.targetQuality;
        }
        return '';
    }

    /**
     * Get icon for current target
     */
    getTargetIcon() {
        if (this.selectedActivity) {
            if (this.targetDrop === 'raw_rewards') {
                return '/assets/icons/attributes/double_rewards.svg';
            }
            // Find in drop table
            if (this.dropTableData) {
                const drop = this.dropTableData.find(d =>
                    d.item_name === this.targetDrop ||
                    `${d.item_name} (Fine)` === this.targetDrop
                );
                if (drop) {
                    return this.getDropIcon(drop);
                }
            }
        }
        return null;
    }

    /**
     * Get background color for target (recipes only)
     */
    getTargetBackgroundColor() {
        if (!this.selectedRecipe) return '';

        const qualityColors = {
            'Normal': 'var(--rarity-common)',
            'Good': 'var(--rarity-uncommon)',
            'Great': 'var(--rarity-rare)',
            'Excellent': 'var(--rarity-epic)',
            'Perfect': 'var(--rarity-legendary)',
            'Eternal': 'var(--rarity-ethereal)'
        };

        return qualityColors[this.targetQuality] || '';
    }

    /**
     * Get border color for target (recipes only)
     */
    getTargetBorderColor() {
        if (!this.selectedRecipe) return '';

        const qualityBorderColors = {
            'Normal': 'var(--rarity-common-border)',
            'Good': 'var(--rarity-uncommon-border)',
            'Great': 'var(--rarity-rare-border)',
            'Excellent': 'var(--rarity-epic-border)',
            'Perfect': 'var(--rarity-legendary-border)',
            'Eternal': 'var(--rarity-ethereal-border)'
        };

        return qualityBorderColors[this.targetQuality] || '';
    }

    /**
     * Render the component
     */
    render() {
        if (!this.shouldShow()) {
            this.$element.html('');
            return;
        }

        const buttonText = this.isOptimizing ? 'Optimizing...' : 'Optimize Gear Set';
        const buttonClass = this.isOptimizing ? 'optimize-btn optimizing' : 'optimize-btn';
        const disabled = this.isOptimizing ? 'disabled' : '';

        // Determine if we should show target selector
        const showTargetSelector = this.selectedActivity || (this.selectedRecipe && this.isQualityRecipe());

        // Target selector HTML
        let targetSelectorHtml = '';
        if (showTargetSelector) {
            const targetLabel = this.selectedActivity ?
                'Target Drop for Steps/Reward Roll' :
                'Target Quality';

            const targetIcon = this.getTargetIcon();
            const targetBgColor = this.getTargetBackgroundColor();
            const targetBorderColor = this.getTargetBorderColor();
            const targetDisplayName = this.getTargetDisplayName();

            // Check if selected target is a fine item
            const isFineSelected = this.selectedActivity && this.targetDrop.includes('(Fine)');
            const iconClass = isFineSelected ? 'target-dropdown-icon fine-icon' : 'target-dropdown-icon';

            const targetIconHtml = targetIcon ?
                `<img src="${targetIcon}" alt="${targetDisplayName}" class="${iconClass}" />` :
                '';

            // Build inline styles for dropdown button
            let buttonStyles = '';
            if (this.selectedRecipe) {
                // For recipes, add background and 2px border with quality color
                if (targetBgColor && targetBorderColor) {
                    buttonStyles = `background: ${targetBgColor}; border: 2px solid ${targetBorderColor};`;
                }
            } else {
                // For activities, no special background
                buttonStyles = '';
            }

            targetSelectorHtml = `
                <div class="target-selector">
                    <div class="target-label">${targetLabel}</div>
                    <div class="target-dropdown-button" style="${buttonStyles}">
                        <div class="target-dropdown-value">
                            ${targetIconHtml}
                            <span>${targetDisplayName}</span>
                        </div>
                        <button class="target-dropdown-toggle">
                            <span class="expand-arrow ${this.isTargetDropdownOpen ? 'expanded' : ''}">▼</span>
                        </button>
                    </div>
                    <div class="target-dropdown" style="display: none;"></div>
                </div>
            `;
        }

        const html = `
            <div class="optimize-container">
                <!-- Target Selector (conditional) -->
                ${targetSelectorHtml}

                <!-- Optimize Button -->
                <button class="${buttonClass}" ${disabled}>
                    ${this.isOptimizing ? '<span class="spinner">⏳</span>' : ''}
                    ${buttonText}
                    <div class="optimize-settings-icon" title="Optimization options">
                        <svg viewBox="0 0 24 24">
                            <path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
                        </svg>
                    </div>
                </button>
                
                <!-- Equip Button (shown after optimization completes) -->
                ${this.showEquipButton ? `
                    <button class="equip-gearset-btn">
                        Equip Gear Set
                    </button>
                ` : ''}
            </div>
        `;

        this.$element.html(html);

        // Slide down equip button if it just appeared
        if (this.showEquipButton) {
            const $equipBtn = this.$element.find('.equip-gearset-btn');
            $equipBtn.hide().slideDown(300);
        }

        this.attachEvents();
    }

    /**
     * Decode gearset export string
     * @param {string} exportString - Base64 encoded gzip compressed JSON
     * @returns {Object} Decoded gearset data
     */
    decodeGearset(exportString) {
        try {
            // Base64 decode
            const binaryString = atob(exportString);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Gunzip
            const decompressed = pako.ungzip(bytes, { to: 'string' });

            // Parse JSON
            return JSON.parse(decompressed);
        } catch (error) {
            console.error('Failed to decode gearset:', error);
            return null;
        }
    }

    /**
     * Decode gearset export string and apply to current gear
     * @param {string} exportString - Base64 encoded gzip compressed JSON
     */
    async decodeAndApplyGearset(exportString) {
        try {
            // Decode the gearset export string
            const decoded = this.decodeGearset(exportString);

            if (!decoded || !decoded.items) {
                throw new Error('Invalid gearset export');
            }

            // Convert to slot format and apply to state
            const slots = {};

            for (const item of decoded.items) {
                const slotName = item.type;
                const itemData = JSON.parse(item.item);

                // Map slot names (handle tool0-5, ring1-2)
                let finalSlotName = slotName;
                if (slotName === 'tool') {
                    finalSlotName = `tool${item.index}`;
                } else if (slotName === 'ring') {
                    finalSlotName = `ring${item.index + 1}`;
                }

                slots[finalSlotName] = {
                    itemId: itemData.id,
                    quality: itemData.quality || null
                };
            }

            // Update state (this will trigger gear slot grid to render with full item objects)
            if (!store.state.column2) {
                store.state.column2 = {};
            }
            store.state.column2.gearSlots = slots;

            // Notify subscribers
            store._notifySubscribers('column2.gearSlots');

            console.log('Applied gearset:', slots);

        } catch (error) {
            console.error('Failed to apply gearset:', error);
            throw error;
        }
    }

    /**
     * Equip the optimized gear set
     */
    async equipOptimizedGearset() {
        if (!this.optimizedGearsetId) return;

        console.log('Equipping optimized gearset:', this.optimizedGearsetId);

        // Slide up the button first
        const $equipBtn = this.$element.find('.equip-gearset-btn');
        $equipBtn.slideUp(300);

        // Load the gearset (this will update the state and trigger gear slot updates)
        store.loadGearSet(this.optimizedGearsetId);

        // Hide the button after animation
        setTimeout(() => {
            this.showEquipButton = false;
            this.optimizedGearsetId = null;
            this.render();
        }, 300);
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        this.$element.off('click');

        // Optimize button click
        this.$element.on('click', '.optimize-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.isOptimizing && !$(e.target).closest('.optimize-settings-icon').length) {
                this.optimize();
            }
        });

        // Settings icon click
        this.$element.on('click', '.optimize-settings-icon', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openOptimizationSettings();
        });

        // Equip gearset button click
        this.$element.on('click', '.equip-gearset-btn', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.equipOptimizedGearset();
        });

        // Target dropdown toggle
        this.$element.on('click', '.target-dropdown-toggle, .target-dropdown-button', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleTargetDropdown();
        });

        // Target item selection
        this.$element.on('click', '.target-item', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const value = $(e.currentTarget).data('value');

            if (this.selectedActivity) {
                this.selectTargetDrop(value);
            } else if (this.selectedRecipe) {
                this.selectTargetQuality(value);
            }
        });

        // Click outside to close dropdown
        $(document).on('click.target-dropdown', (e) => {
            if (this.isTargetDropdownOpen && !$(e.target).closest('.target-selector').length) {
                this.isTargetDropdownOpen = false;
                const $dropdown = this.$element.find('.target-dropdown');
                $dropdown.slideUp(200);
            }
        });
    }

    /**
     * Clean up when component is destroyed
     */
    destroy() {
        $(document).off('click.target-dropdown');
        super.destroy();
    }
}

export default OptimizeButton;
