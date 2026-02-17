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

class RecipeSelectorDropdown extends Component {
    /**
     * Create a recipe selector dropdown
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);

        // UI state
        this.isOpen = false;
        this.searchText = '';
        this.expandedCategories = new Set();
        this.selectedRecipe = null;

        // Data cache
        this.recipesData = null;

        // Keyboard navigation
        this.keyboardNav = null;

        // Subscribe to state changes
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());

        // Load recipes data
        this.loadRecipes();
    }

    /**
     * Load recipes from API
     */
    async loadRecipes() {
        try {
            const response = await $.get('/api/recipes');
            this.recipesData = response;
            console.log('Recipes loaded:', this.recipesData);
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
            const filteredRecipes = this.searchText
                ? recipes.filter(r => r.name.toLowerCase().includes(this.searchText.toLowerCase()))
                : recipes;

            // Add recipe items (hidden initially)
            const recipeItems = filteredRecipes.map(recipe => `
                <div class="recipe-item" data-id="${recipe.id}" style="display: none;">
                    <img src="${recipe.icon_path}" alt="${recipe.name}" class="recipe-icon" />
                    <span class="recipe-name">${recipe.name}</span>
                </div>
            `).join('');

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
        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }

        store.state.column3.selectedRecipe = recipeId;
        store.state.column3.selectedActivity = null;  // Clear activity (mutual exclusion)

        // Notify subscribers
        store._notifySubscribers('column3.selectedRecipe');
        store._notifySubscribers('column3.selectedActivity');

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

        // Notify subscribers
        store._notifySubscribers('column3.selectedRecipe');

        // Close dropdown
        this.isOpen = false;
        this.render();
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

        if (!this.searchText) {
            return this.recipesData.by_skill;
        }

        const searchLower = this.searchText.toLowerCase();
        const filtered = {};

        for (const [skill, recipes] of Object.entries(this.recipesData.by_skill)) {
            const matchingRecipes = recipes.filter(recipe =>
                recipe.name.toLowerCase().includes(searchLower)
            );

            if (matchingRecipes.length > 0) {
                filtered[skill] = matchingRecipes;
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

        // Render recipe items
        const recipeItems = isExpanded ? recipes.map(recipe => `
            <div class="recipe-item" data-id="${recipe.id}">
                <img src="${recipe.icon_path}" alt="${recipe.name}" class="recipe-icon" />
                <span class="recipe-name">${recipe.name}</span>
            </div>
        `).join('') : '';

        return `
            <div class="recipe-category">
                <div class="category-header" data-skill="${skill}">
                    <img src="${skillIconPath}" alt="${skill}" class="skill-icon" />
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
            <div class="recipe-selector-dropdown">
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
        this.$element.on('click', '.recipe-item:not(.none-option)', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('id');
            this.selectRecipe(id);
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
