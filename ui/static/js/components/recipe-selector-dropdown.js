/**
 * RecipeSelectorDropdown Component
 * 
 * Searchable dropdown for selecting recipes organized by skill.
 * 
 * Features:
 * - Custom dropdown matching gear set dropdown style
 * - Search box at top
 * - Collapsible skill categories
 * - Alphabetical ordering by skill
 * - Auto-expand categories on search
 * - Mutual exclusion with activity selection
 * 
 * Requirements: 1.1, 1.3, 1.5, 1.7, 1.10
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import KeyboardNavigator from '../utils/keyboard-navigation.js';
import GenericRecipeForm from './generic-recipe-form.js';

class RecipeSelectorDropdown extends Component {
    /**
     * Create a recipe selector dropdown
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);
        this.onPick = props.onPick || null;  // pick-mode (Notepad link picker): report selection, don't touch column-3
        // Standalone mode (crafting-tree target selector). When true this
        // instance is fully DECOUPLED from column-3 state: it must not
        // subscribe to column3.selectedRecipe/selectedActivity and must
        // not restore its selection from column3 on load. Without this,
        // the crafting-tree recipe dropdown snapped its label to whatever
        // the user was exploring in the main optimizer (column 3) after a
        // page reload — while the tree target_item_id (and Optimize) stayed
        // correct. Bug 5e9a6344 (2026-07-11).
        this._decoupleColumn3 = !!props.decoupleColumn3;

        // UI state
        this.isOpen = false;
        this.searchText = '';
        this.expandedCategories = new Set();
        this.selectedRecipe = null;

        // Data cache
        this.recipesData = null;

        // Keyboard navigation
        this.keyboardNav = null;

        // Generic recipe form (rendered in Column 3 when "Generic" is selected)
        this.genericRecipeForm = null;
        this.savedGenericRecipes = [];

        // Personalization: order by level
        const saved = localStorage.getItem('orderActivitiesByLevel');
        this.orderByLevel = saved === null ? true : saved === 'true';
        window.addEventListener('orderByLevelChanged', (e) => {
            this.orderByLevel = e.detail.value;
            if (this.isOpen) {
                this.updateRecipeList();
            }
        });

        // Subscribe to state changes — but ONLY when this instance is
        // wired to column 3. The crafting-tree standalone instance passes
        // decoupleColumn3:true so column-3 recipe/activity changes never
        // hijack its label (bug 5e9a6344).
        if (!this._decoupleColumn3) {
            this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
            this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        }

        // Load recipes data
        this.loadRecipes();
        this._loadSavedGenericRecipes();
    }

    /**
     * Load recipes from API
     */
    async loadRecipes() {
        try {
            window.__walkscapePerf?.mark('recipes_start');
            const response = await $.get('/api/recipes');
            window.__walkscapePerf?.measure('recipes_load', 'recipes_start');
            this.recipesData = response;
            console.log('[RSD] Recipes loaded: count=',
                Array.isArray(response?.recipes) ? response.recipes.length : 0);
            if (window.__walkscapeVerboseDebug) {
                console.log('[VERBOSE] Recipes loaded full payload:', this.recipesData);
            }

            // Restore selection from store state (e.g., after session load).
            // Skipped for the decoupled crafting-tree instance, whose
            // selection is driven solely by the tree target (bug 5e9a6344).
            if (!this._decoupleColumn3) {
                const savedRecipe = store.state.column3?.selectedRecipe;
                if (savedRecipe) {
                    this.selectedRecipe = savedRecipe;
                }
            }

            this.render();
        } catch (error) {
            console.error('Failed to load recipes:', error);
            api.showError('Failed to load recipes');
        }
    }

    /**
     * Handle recipe selection change
     */
    onRecipeChange() {
        const selectedId = store.state.column3?.selectedRecipe;
        this.selectedRecipe = selectedId;
        this._updateGenericForm(selectedId);
        this.render();
    }

    /**
     * Handle activity selection change (mutual exclusion)
     * Requirements: 1.10
     */
    onActivityChange() {
        const selectedActivity = store.state.column3?.selectedActivity;
        if (selectedActivity) {
            // Activity was selected, clear recipe selection
            this.selectedRecipe = null;
        }
        this.render();
    }

    /**
     * Load saved generic recipes for the Custom group
     */
    async _loadSavedGenericRecipes() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            if (typeof api.getGenericDefinitions !== 'function') {
                console.warn('api.getGenericDefinitions not available (stale cache?)');
                this.savedGenericRecipes = [];
                return;
            }
            const defs = await api.getGenericDefinitions(uuid);
            this.savedGenericRecipes = defs.recipes || [];
            store.state.column3.savedGenericRecipes = this.savedGenericRecipes;

            // Restore generic form if a generic recipe was selected before reload
            const savedRecipe = store.state.column3?.selectedRecipe;
            if (savedRecipe && (savedRecipe === 'generic' || savedRecipe.startsWith('generic::'))) {
                this._updateGenericForm(savedRecipe);
            }
        } catch (e) {
            console.warn('Failed to load saved generic recipes:', e);
            this.savedGenericRecipes = [];
        }
    }

    /**
     * Show or hide the GenericRecipeForm based on selection
     */
    _updateGenericForm(recipeId) {
        const $container = $('#generic-recipe-form-container');
        if (!$container.length) return;

        const isGeneric = recipeId === 'generic' ||
            (recipeId && recipeId.startsWith('generic::'));

        if (isGeneric) {
            if (!this.genericRecipeForm) {
                this.genericRecipeForm = new GenericRecipeForm($container);
                this.genericRecipeForm.render();
            }
            // Don't re-render if form already exists — it would clear fields

            // Only pre-populate if this is a NEW selection (not a save notification)
            if (recipeId && recipeId.startsWith('generic::') && !this.genericRecipeForm.currentDefId) {
                const defId = recipeId.replace('generic::', '');
                const def = this.savedGenericRecipes.find(d => d.id === defId);
                if (def) {
                    this.genericRecipeForm.populateFromSaved(def);
                }
            }

            $container.show();
        } else {
            if (this.genericRecipeForm) {
                this.genericRecipeForm.destroy();
                this.genericRecipeForm = null;
            }
            $container.hide();
        }
    }

    /**
     * Close dropdown programmatically (called by other components)
     */
    closeDropdown() {
        if (!this.isOpen) {
            return;
        }

        this.isOpen = false;

        // Detach keyboard navigation
        if (this.keyboardNav) {
            this.keyboardNav.detach();
            this.keyboardNav = null;
        }

        // Close dropdown without re-rendering
        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
        const $dropdown = this.$element.find('.recipe-dropdown');
        $arrow.removeClass('expanded');
        $dropdown.slideUp(200);
    }

    /**
     * Toggle dropdown open/closed
     */
    toggleDropdown() {
        console.log('RecipeSelectorDropdown: toggleDropdown called, isOpen:', this.isOpen);

        // If opening, close the activity dropdown first
        if (!this.isOpen) {
            // Notify other dropdowns to close via custom event
            $(document).trigger('dropdown:opening', { source: 'recipe' });
        }

        this.isOpen = !this.isOpen;
        this.searchText = '';  // Reset search when opening

        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
        const $dropdown = this.$element.find('.recipe-dropdown');

        if (this.isOpen) {
            console.log('RecipeSelectorDropdown: Opening dropdown');
            this.expandedCategories.clear();  // Collapse all categories when opening

            // Update dropdown content
            $dropdown.html(this.renderDropdownContent());

            // Update arrow and slide down
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);

            // Auto-focus search box after animation completes
            setTimeout(() => {
                const $searchInput = this.$element.find('.recipe-search');
                console.log('RecipeSelectorDropdown: Attempting to focus search input, found:', $searchInput.length, 'elements');
                if ($searchInput.length > 0) {
                    $searchInput.focus();
                    console.log('RecipeSelectorDropdown: Focus called, active element:', document.activeElement);

                    // Initialize keyboard navigation
                    this.initKeyboardNav();
                } else {
                    console.log('RecipeSelectorDropdown: Search input not found!');
                }
            }, 250);
        } else {
            console.log('RecipeSelectorDropdown: Closing dropdown');

            // Detach keyboard navigation
            if (this.keyboardNav) {
                this.keyboardNav.detach();
                this.keyboardNav = null;
            }

            // Update arrow and slide up
            $arrow.removeClass('expanded');
            $dropdown.slideUp(200);
        }
    }

    /**
     * Initialize keyboard navigation
     */
    initKeyboardNav() {
        const $dropdown = this.$element.find('.recipe-dropdown');

        if (this.keyboardNav) {
            this.keyboardNav.detach();
        }

        this.keyboardNav = new KeyboardNavigator($dropdown, {
            itemSelector: '.recipe-item, .category-header',
            categorySelector: '.category-header',
            onSelect: ($item) => {
                if ($item.hasClass('none-option')) {
                    this.clearSelection();
                } else if ($item.hasClass('recipe-item')) {
                    const id = $item.data('id');
                    this.selectRecipe(id);
                }
            },
            onCategoryToggle: ($item) => {
                const skill = $item.data('skill');
                this.toggleCategory(skill);
            },
            getVisibleItems: () => {
                return this.$element.find('.recipe-item:visible, .category-header:visible');
            }
        });

        this.keyboardNav.attach();
    }

    /**
     * Update search text
     * Requirements: 1.7
     * @param {string} text - Search text
     */
    updateSearch(text) {
        this.searchText = text;

        // Auto-expand categories containing matches
        if (text) {
            this.autoExpandMatchingCategories();
        } else {
            // Collapse all when search is cleared
            this.expandedCategories.clear();
        }

        // Only update the recipe list, not the entire component
        this.updateRecipeList();

        // Reset keyboard navigation after list update
        if (this.keyboardNav) {
            this.keyboardNav.reset();
        }
    }

    /**
     * Update only the recipe list content (not the entire component)
     * This prevents the search input from losing focus
     */
    updateRecipeList() {
        if (!this.isOpen) {
            return;
        }

        const filteredRecipes = this.getFilteredRecipes();
        const sortedSkills = Object.keys(filteredRecipes).sort();

        // Render categories
        const categories = sortedSkills.map(skill =>
            this.renderCategory(skill, filteredRecipes[skill])
        ).join('');

        const listHtml = `
            <div class="recipe-item none-option">
                <span class="recipe-name">None</span>
            </div>
            ${categories}
        `;

        // Update only the list content
        this.$element.find('.recipe-list').html(listHtml);
    }

    /**
     * Auto-expand categories containing search matches
     * Requirements: 1.7
     */
    autoExpandMatchingCategories() {
        if (!this.recipesData || !this.searchText) {
            return;
        }

        const searchLower = this.searchText.toLowerCase();
        this.expandedCategories.clear();

        // Check each skill category for matches
        for (const [skill, recipes] of Object.entries(this.recipesData.by_skill)) {
            const hasMatch = recipes.some(recipe =>
                recipe.name.toLowerCase().includes(searchLower)
            );

            if (hasMatch) {
                this.expandedCategories.add(skill);
            }
        }
    }

    /**
     * Toggle category expanded/collapsed
     * @param {string} skill - Skill name
     */
    toggleCategory(skill) {
        const $categoryHeader = this.$element.find(`.category-header[data-skill="${skill}"]`);
        const $category = $categoryHeader.parent();

        if (this.expandedCategories.has(skill)) {
            // Collapse - slide up
            this.expandedCategories.delete(skill);

            $categoryHeader.find('.expand-arrow').removeClass('expanded');

            // Slide up and remove recipe items
            $category.find('.recipe-item').slideUp(150, function () {
                $(this).remove();
            });
        } else {
            // Expand - slide down
            this.expandedCategories.add(skill);

            $categoryHeader.find('.expand-arrow').addClass('expanded');

            // Get recipes for this skill
            const recipes = this.recipesData.by_skill[skill] || [];
            const filtered = this.searchText
                ? recipes.filter(r => r.name.toLowerCase().includes(this.searchText.toLowerCase()))
                : recipes;
            const filteredRecipes = this._sortRecipes(filtered);

            // Add recipe items (hidden initially)
            const recipeItems = filteredRecipes.map(recipe => {
                const reqLevel = recipe.level || 1;
                const charSkills = store.state.character?.skills || {};
                const charLevel = charSkills[recipe.skill?.toLowerCase()] || 1;
                const canDo = charLevel >= reqLevel;
                const levelClass = canDo ? 'level-ok' : 'level-too-high';

                return `
                <div class="recipe-item" data-id="${recipe.id}" style="display: none;">
                    <img src="${recipe.icon_path}" alt="${recipe.name}" class="recipe-icon" />
                    <span class="recipe-name">${recipe.name}</span>
                    <span class="dropdown-level-badge ${levelClass}">Lv. ${reqLevel}</span>
                </div>
            `;
            }).join('');

            $category.append(recipeItems);

            // Slide down
            const $items = $category.find('.recipe-item');
            $items.slideDown(150);

            // Scroll after the first item's animation completes (not all items)
            $items.first().promise().done(() => {
                const $dropdown = this.$element.find('.recipe-dropdown');
                const categoryHeaderOffset = $categoryHeader.position().top;
                $dropdown.animate({
                    scrollTop: $dropdown.scrollTop() + categoryHeaderOffset
                }, 200);
            });
        }
    }

    /**
     * Select a recipe
     * Requirements: 1.10
     * @param {string} recipeId - Recipe ID
     */
    selectRecipe(recipeId) {
        // Pick-mode (Notepad link picker): report the choice and close without
        // mutating the shared column-3 selection.
        if (this.onPick) {
            this.onPick(recipeId);
            this.isOpen = false;
            this.render();
            return;
        }
        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }

        store.state.column3.selectedRecipe = recipeId;
        store.state.column3.selectedActivity = null;  // Clear activity (mutual exclusion)
        store.state.column3.useFine = false;  // Reset fine materials on selection change

        // Clear non-owned alternatives — they're stale for the new recipe
        store.state.gearsets.alternatives = null;
        store.state.gearsets.gearset2Alternatives = null;
        store.state.gearsets.lockedAlternatives = null;
        store.state.gearsets.gearset2LockedAlternatives = null;

        // Notify subscribers
        store._notifySubscribers('column3.selectedRecipe');
        store._notifySubscribers('column3.selectedActivity');
        store._notifySubscribers('column3.useFine');

        // Auto-save selection to session
        store._saveColumn3Selection();

        // Show/hide generic recipe form
        this._updateGenericForm(recipeId);

        // Close dropdown
        this.isOpen = false;
        this.render();
    }

    /**
     * Clear selection (select "None")
     */
    clearSelection() {
        if (!store.state.column3) {
            store.state.column3 = {};
        }

        store.state.column3.selectedRecipe = null;
        store.state.column3.useFine = false;  // Reset fine materials on clear
        store.state.column3.genericRecipe = null;

        // Notify subscribers
        store._notifySubscribers('column3.selectedRecipe');

        // Auto-save selection to session
        store._saveColumn3Selection();

        // Hide generic form
        this._updateGenericForm(null);

        // Close dropdown
        this.isOpen = false;
        this.render();
    }

    /**
     * Sort recipes within a skill group based on orderByLevel setting
     * @param {Array} recipes - Recipes array
     * @returns {Array} Sorted copy (or original if alphabetical)
     */
    _sortRecipes(recipes) {
        if (!this.orderByLevel) return recipes;
        return [...recipes].sort((a, b) => {
            const lvlA = a.level || 1;
            const lvlB = b.level || 1;
            return lvlA !== lvlB ? lvlA - lvlB : a.name.localeCompare(b.name);
        });
    }

    /**
     * Get filtered recipes by search text
     * Requirements: 1.7
     * @returns {Object} Filtered recipes by skill
     */
    getFilteredRecipes() {
        if (!this.recipesData) {
            return {};
        }

        const source = this.recipesData.by_skill;

        if (!this.searchText) {
            const result = {};
            for (const [skill, recipes] of Object.entries(source)) {
                result[skill] = this._sortRecipes(recipes);
            }
            return result;
        }

        const searchLower = this.searchText.toLowerCase();
        const filtered = {};

        for (const [skill, recipes] of Object.entries(source)) {
            const matchingRecipes = recipes.filter(recipe =>
                recipe.name.toLowerCase().includes(searchLower)
            );

            if (matchingRecipes.length > 0) {
                filtered[skill] = this._sortRecipes(matchingRecipes);
            }
        }

        return filtered;
    }

    /**
     * Get selected recipe data for display
     * @returns {Object|null} Recipe object or null
     */
    getSelectedRecipe() {
        if (!this.selectedRecipe || !this.recipesData) {
            return null;
        }

        // Find recipe by ID
        for (const recipes of Object.values(this.recipesData.by_skill)) {
            const recipe = recipes.find(r => r.id === this.selectedRecipe);
            if (recipe) {
                return recipe;
            }
        }

        return null;
    }

    /**
     * Get selected recipe name for display
     * @returns {string} Recipe name or placeholder
     */
    getSelectedRecipeName() {
        // Check for generic recipe
        if (this.selectedRecipe === 'generic') {
            return '🔧 Generic Recipe';
        }
        if (this.selectedRecipe && this.selectedRecipe.startsWith('generic::')) {
            const def = this.savedGenericRecipes.find(
                d => d.id === this.selectedRecipe.replace('generic::', '')
            );
            if (def) {
                const iconHtml = window.tintedEmoji(def.icon || '⚡', def.icon_color) || (def.icon || '⚡');
                return `${iconHtml} ${def.name}`;
            }
            return '🔧 Generic Recipe';
        }

        const recipe = this.getSelectedRecipe();

        if (!recipe) {
            // Check if activity is selected (mutual exclusion)
            if (store.state.column3?.selectedActivity) {
                return 'Select a recipe';
            }
            return 'Select a recipe';
        }

        return recipe.name;
    }

    /**
     * Render a skill category with recipes
     * Requirements: 1.5
     * @param {string} skill - Skill name
     * @param {Array} recipes - Recipes in this skill
     * @returns {string} HTML for category
     */
    renderCategory(skill, recipes) {
        const isExpanded = this.expandedCategories.has(skill);
        const arrowIcon = `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}">▼</span>`;

        // Get skill icon path
        const skillId = skill.toLowerCase().replace(' ', '_');
        const skillIconPath = `/assets/icons/text/skill_icons/${skillId}.svg`;
        const SKILL_EMOJI_FALLBACK = { traveling: '🧭' };
        const emojiFallback = SKILL_EMOJI_FALLBACK[skillId];
        const skillIconHtml = emojiFallback
            ? `<img src="${skillIconPath}" alt="${skill}" class="skill-icon" onerror="this.outerHTML='<span class=\\'skill-icon-emoji\\' style=\\'transform:scale(2);display:inline-block\\'>${emojiFallback}</span>'" />`
            : `<img src="${skillIconPath}" alt="${skill}" class="skill-icon" />`;

        // Render recipe items
        const recipeItems = isExpanded ? recipes.map(recipe => {
            const reqLevel = recipe.level || 1;
            const charSkills = store.state.character?.skills || {};
            const charLevel = charSkills[recipe.skill?.toLowerCase()] || 1;
            const canDo = charLevel >= reqLevel;
            const levelClass = canDo ? 'level-ok' : 'level-too-high';

            return `
            <div class="recipe-item" data-id="${recipe.id}">
                <img src="${recipe.icon_path}" alt="${recipe.name}" class="recipe-icon" />
                <span class="recipe-name">${recipe.name}</span>
                <span class="dropdown-level-badge ${levelClass}">Lv. ${reqLevel}</span>
            </div>
        `;
        }).join('') : '';

        return `
            <div class="recipe-category">
                <div class="category-header" data-skill="${skill}">
                    ${skillIconHtml}
                    <span class="skill-name">${skill}</span>
                    ${arrowIcon}
                </div>
                ${recipeItems}
            </div>
        `;
    }

    /**
     * Render the dropdown content
     * Requirements: 1.3, 1.5
     * @returns {string} HTML for dropdown
     */
    renderDropdown() {
        // Render wrapper with initial hidden state
        // jQuery slideUp/slideDown will manage visibility after that
        const content = this.isOpen ? this.renderDropdownContent() : '';

        return `
            <div class="recipe-dropdown" style="display: none;">
                ${content}
            </div>
        `;
    }

    /**
     * Render just the dropdown content (without wrapper)
     * @returns {string} HTML for dropdown content
     */
    renderDropdownContent() {
        const filteredRecipes = this.getFilteredRecipes();

        // Sort skills alphabetically
        const sortedSkills = Object.keys(filteredRecipes).sort();

        // Render categories
        const categories = sortedSkills.map(skill =>
            this.renderCategory(skill, filteredRecipes[skill])
        ).join('');

        return `
            <input 
                type="text" 
                class="recipe-search" 
                placeholder="Search recipes..."
                value="${this.searchText}"
            />
            <div class="recipe-list">
                <div class="recipe-item none-option">
                    <span class="recipe-name">None</span>
                </div>
                ${categories}
                ${window._featureFlags?.generic ? `
                <div class="recipe-item generic-option" data-id="generic">
                    <span class="recipe-icon generic-icon">🔧</span>
                    <span class="recipe-name">Generic</span>
                </div>` : ''}
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 1.1
     */
    render() {
        const selectedRecipe = this.getSelectedRecipe();
        const selectedName = this.getSelectedRecipeName();
        const arrowIcon = `<span class="expand-arrow ${this.isOpen ? 'expanded' : ''}">▼</span>`;
        const dropdownHtml = this.renderDropdown();

        // Build dropdown value with icon if recipe selected
        let dropdownValueHtml = '';
        if (selectedRecipe) {
            dropdownValueHtml = `
                <img src="${selectedRecipe.icon_path}" alt="${selectedRecipe.name}" class="dropdown-recipe-icon" />
                <span>${selectedName}</span>
            `;
        } else {
            dropdownValueHtml = `<span>${selectedName}</span>`;
        }

        const html = `
            <div class="recipe-selector-dropdown" data-pin-id="recipe-selector">
                <div class="dropdown-label-header">Recipe</div>
                <div class="dropdown-button">
                    <div class="dropdown-value">${dropdownValueHtml}</div>
                    <button class="dropdown-toggle">${arrowIcon}</button>
                </div>
                ${dropdownHtml}
            </div>
        `;

        this.$element.html(html);
        this.attachEvents();
    }

    /**
     * Attach event handlers
     */
    attachEvents() {
        // Remove old handlers to prevent duplicates
        this.$element.off('click');
        this.$element.off('input');

        // Dropdown toggle
        this.$element.on('click', '.dropdown-toggle', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Dropdown button click (also toggles)
        this.$element.on('click', '.dropdown-button', (e) => {
            if (!$(e.target).hasClass('dropdown-toggle')) {
                this.toggleDropdown();
            }
        });

        // Search input
        this.$element.on('input', '.recipe-search', (e) => {
            e.stopPropagation();
            this.updateSearch($(e.target).val());
        });

        // Category header click (expand/collapse)
        this.$element.on('click', '.category-header', (e) => {
            e.stopPropagation();
            const skill = $(e.currentTarget).data('skill');
            this.toggleCategory(skill);
        });

        // Recipe item click (select)
        this.$element.on('click', '.recipe-item:not(.none-option):not(.generic-option)', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('id');
            this.selectRecipe(id);
        });

        // Generic option click
        this.$element.on('click', '.generic-option', (e) => {
            e.stopPropagation();
            this.selectRecipe('generic');
        });

        // None option click (clear selection)
        this.$element.on('click', '.none-option', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });

        // Click outside to close dropdown
        $(document).on('click.recipe-dropdown', (e) => {
            if (this.isOpen && !$(e.target).closest('.recipe-selector-dropdown').length) {
                this.closeDropdown();
            }
        });

        // Listen for other dropdowns opening
        $(document).on('dropdown:opening.recipe-dropdown', (e, data) => {
            if (data.source !== 'recipe') {
                this.closeDropdown();
            }
        });
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

        // Remove document-level event handlers
        $(document).off('click.recipe-dropdown');
        $(document).off('dropdown:opening.recipe-dropdown');
        super.destroy();
    }
}

export default RecipeSelectorDropdown;
