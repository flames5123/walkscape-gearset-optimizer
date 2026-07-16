/**
 * ActivitySelectorDropdown Component
 * 
 * Searchable dropdown for selecting activities organized by skill.
 * 
 * Features:
 * - Custom dropdown matching gear set dropdown style
 * - Search box at top
 * - Collapsible skill categories
 * - Alphabetical ordering by skill
 * - Auto-expand categories on search
 * - Mutual exclusion with recipe selection
 * 
 * Requirements: 1.1, 1.2, 1.4, 1.5, 1.7, 1.9
 */

import Component from './base.js';
import store from '../state.js';
import api from '../api.js';
import KeyboardNavigator from '../utils/keyboard-navigation.js';
import GenericActivityForm from './generic-activity-form.js';

class ActivitySelectorDropdown extends Component {
    /**
     * Create an activity selector dropdown
     * @param {HTMLElement|string} element - Container element
     * @param {Object} props - Component properties
     */
    constructor(element, props = {}) {
        super(element, props);
        this.onPick = props.onPick || null;  // pick-mode (Notepad link picker): report selection, don't touch column-3

        // UI state
        this.isOpen = false;
        this.searchText = '';
        this.expandedCategories = new Set();
        this.selectedActivity = null;

        // Data cache
        this.activitiesData = null;

        // Keyboard navigation
        this.keyboardNav = null;

        // Generic activity form (rendered in Column 3 when "Generic" is selected)
        this.genericActivityForm = null;
        this.savedGenericActivities = [];

        // Personalization: order by level
        const saved = localStorage.getItem('orderActivitiesByLevel');
        this.orderByLevel = saved === null ? true : saved === 'true';
        window.addEventListener('orderByLevelChanged', (e) => {
            this.orderByLevel = e.detail.value;
            if (this.isOpen) {
                this.updateActivityList();
            }
        });

        // Subscribe to state changes
        this.subscribe('column3.selectedActivity', () => this.onActivityChange());
        this.subscribe('column3.selectedRecipe', () => this.onRecipeChange());

        // Load activities data
        this.loadActivities();
        this._loadSavedGenericActivities();
    }

    /**
     * Load activities from API
     */
    async loadActivities() {
        try {
            window.__walkscapePerf?.mark('activities_start');
            const response = await $.get('/api/activities');
            window.__walkscapePerf?.measure('activities_load', 'activities_start');
            this.activitiesData = response;
            console.log('[ASD] Activities loaded: count=',
                Array.isArray(response?.activities) ? response.activities.length : 0);
            if (window.__walkscapeVerboseDebug) {
                console.log('[VERBOSE] Activities loaded full payload:', this.activitiesData);
            }

            // Restore selection from store state (e.g., after session load)
            const savedActivity = store.state.column3?.selectedActivity;
            if (savedActivity) {
                this.selectedActivity = savedActivity;
            }

            this.render();
        } catch (error) {
            console.error('Failed to load activities:', error);
            api.showError('Failed to load activities');
        }
    }

    /**
     * Load saved generic activities for the Custom group
     */
    async _loadSavedGenericActivities() {
        const uuid = store.state.session?.uuid;
        if (!uuid) return;
        try {
            if (typeof api.getGenericDefinitions !== 'function') {
                console.warn('api.getGenericDefinitions not available (stale cache?)');
                this.savedGenericActivities = [];
                return;
            }
            const defs = await api.getGenericDefinitions(uuid);
            this.savedGenericActivities = defs.activities || [];
            store.state.column3.savedGenericActivities = this.savedGenericActivities;

            // Restore generic form if a generic activity was selected before reload
            const savedActivity = store.state.column3?.selectedActivity;
            if (savedActivity && (savedActivity === 'generic' || savedActivity.startsWith('generic::'))) {
                this._updateGenericForm(savedActivity);
            }
        } catch (e) {
            console.warn('Failed to load saved generic activities:', e);
            this.savedGenericActivities = [];
        }
    }

    /**
     * Handle activity selection change
     */
    onActivityChange() {
        const selectedId = store.state.column3?.selectedActivity;
        this.selectedActivity = selectedId;
        this._updateGenericForm(selectedId);
        this.render();
    }

    /**
     * Handle recipe selection change (mutual exclusion)
     * Requirements: 1.9
     */
    onRecipeChange() {
        const selectedRecipe = store.state.column3?.selectedRecipe;
        if (selectedRecipe) {
            // Recipe was selected, clear activity selection
            this.selectedActivity = null;
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
        const $dropdown = this.$element.find('.activity-dropdown');
        $arrow.removeClass('expanded');
        $dropdown.slideUp(200);
    }

    /**
     * Toggle dropdown open/closed
     */
    toggleDropdown() {
        console.log('ActivitySelectorDropdown: toggleDropdown called, isOpen:', this.isOpen);

        // If opening, close the recipe dropdown first
        if (!this.isOpen) {
            // Notify other dropdowns to close via custom event
            $(document).trigger('dropdown:opening', { source: 'activity' });
        }

        this.isOpen = !this.isOpen;
        this.searchText = '';  // Reset search when opening

        const $arrow = this.$element.find('.dropdown-toggle .expand-arrow');
        const $dropdown = this.$element.find('.activity-dropdown');

        if (this.isOpen) {
            console.log('ActivitySelectorDropdown: Opening dropdown');
            this.expandedCategories.clear();  // Collapse all categories when opening

            // Update dropdown content
            $dropdown.html(this.renderDropdownContent());

            // Update arrow and slide down
            $arrow.addClass('expanded');
            $dropdown.slideDown(200);

            // Auto-focus search box after animation completes
            setTimeout(() => {
                const $searchInput = this.$element.find('.activity-search');
                console.log('ActivitySelectorDropdown: Attempting to focus search input, found:', $searchInput.length, 'elements');
                if ($searchInput.length > 0) {
                    $searchInput.focus();
                    console.log('ActivitySelectorDropdown: Focus called, active element:', document.activeElement);

                    // Initialize keyboard navigation
                    this.initKeyboardNav();
                } else {
                    console.log('ActivitySelectorDropdown: Search input not found!');
                }
            }, 250);
        } else {
            console.log('ActivitySelectorDropdown: Closing dropdown');

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
        const $dropdown = this.$element.find('.activity-dropdown');

        if (this.keyboardNav) {
            this.keyboardNav.detach();
        }

        this.keyboardNav = new KeyboardNavigator($dropdown, {
            itemSelector: '.activity-item, .category-header',
            categorySelector: '.category-header',
            onSelect: ($item) => {
                if ($item.hasClass('none-option')) {
                    this.clearSelection();
                } else if ($item.hasClass('activity-item')) {
                    const id = $item.data('id');
                    this.selectActivity(id);
                }
            },
            onCategoryToggle: ($item) => {
                const skill = $item.data('skill');
                this.toggleCategory(skill);
            },
            getVisibleItems: () => {
                return this.$element.find('.activity-item:visible, .category-header:visible');
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

        // Only update the activity list, not the entire component
        this.updateActivityList();

        // Reset keyboard navigation after list update
        if (this.keyboardNav) {
            this.keyboardNav.reset();
        }
    }

    /**
     * Update only the activity list content (not the entire component)
     * This prevents the search input from losing focus
     */
    updateActivityList() {
        if (!this.isOpen) {
            return;
        }

        const filteredActivities = this.getFilteredActivities();
        const sortedSkills = Object.keys(filteredActivities).sort();

        // Render categories
        const categories = sortedSkills.map(skill =>
            this.renderCategory(skill, filteredActivities[skill])
        ).join('');

        const listHtml = `
            <div class="activity-item none-option">
                <span class="activity-name">None</span>
            </div>
            ${categories}
        `;

        // Update only the list content
        this.$element.find('.activity-list').html(listHtml);
    }

    /**
     * Auto-expand categories containing search matches
     * Requirements: 1.7
     */
    autoExpandMatchingCategories() {
        if (!this.activitiesData || !this.searchText) {
            return;
        }

        const searchLower = this.searchText.toLowerCase();
        this.expandedCategories.clear();

        // Check each skill category for matches
        for (const [skill, activities] of Object.entries(this.activitiesData.by_skill)) {
            const hasMatch = activities.some(activity =>
                activity.name.toLowerCase().includes(searchLower)
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

            // Slide up and remove activity items
            $category.find('.activity-item').slideUp(150, function () {
                $(this).remove();
            });
        } else {
            // Expand - slide down
            this.expandedCategories.add(skill);

            $categoryHeader.find('.expand-arrow').addClass('expanded');

            // Get activities for this skill
            const activities = this.activitiesData.by_skill[skill] || [];
            const filtered = this.searchText
                ? activities.filter(a => a.name.toLowerCase().includes(this.searchText.toLowerCase()))
                : activities;
            const filteredActivities = this._sortActivities(filtered);

            // Add activity items (hidden initially)
            const activityItems = filteredActivities.map(activity => {
                const reqLevel = activity.requirements?.skill_requirements?.[activity.primary_skill] || 1;
                const charSkills = store.state.character?.skills || {};
                const charLevel = charSkills[activity.primary_skill?.toLowerCase()] || 1;
                const canDo = charLevel >= reqLevel;
                const levelClass = canDo ? 'level-ok' : 'level-too-high';

                return `
                <div class="activity-item" data-id="${activity.id}" style="display: none;">
                    <img src="${activity.icon_path}" alt="${activity.name}" class="activity-icon" />
                    <span class="activity-name">${activity.name}</span>
                    <span class="dropdown-level-badge ${levelClass}">Lv. ${reqLevel}</span>
                </div>
            `;
            }).join('');

            $category.append(activityItems);

            // Slide down
            const $items = $category.find('.activity-item');
            $items.slideDown(150);

            // Scroll after the first item's animation completes (not all items)
            $items.first().promise().done(() => {
                const $dropdown = this.$element.find('.activity-dropdown');
                const categoryHeaderOffset = $categoryHeader.position().top;
                $dropdown.animate({
                    scrollTop: $dropdown.scrollTop() + categoryHeaderOffset
                }, 200);
            });
        }
    }

    /**
     * Select an activity
     * Requirements: 1.9
     * @param {string} activityId - Activity ID
     */
    selectActivity(activityId) {
        // Pick-mode (Notepad link picker): report the choice and close without
        // mutating the shared column-3 selection.
        if (this.onPick) {
            this.onPick(activityId);
            this.isOpen = false;
            this.render();
            return;
        }
        // Update state
        if (!store.state.column3) {
            store.state.column3 = {};
        }

        store.state.column3.selectedActivity = activityId;
        store.state.column3.selectedRecipe = null;  // Clear recipe (mutual exclusion)
        store.state.column3.useFine = false;  // Reset fine materials on selection change

        // Clear non-owned alternatives — they're stale for the new activity
        store.state.gearsets.alternatives = null;
        store.state.gearsets.gearset2Alternatives = null;
        store.state.gearsets.lockedAlternatives = null;
        store.state.gearsets.gearset2LockedAlternatives = null;

        // Notify subscribers
        store._notifySubscribers('column3.selectedActivity');
        store._notifySubscribers('column3.selectedRecipe');
        store._notifySubscribers('column3.useFine');

        // Auto-save selection to session
        store._saveColumn3Selection();

        // Show/hide generic activity form
        this._updateGenericForm(activityId);

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

        store.state.column3.selectedActivity = null;
        store.state.column3.useFine = false;  // Reset fine materials on clear
        store.state.column3.genericActivity = null;

        // Notify subscribers
        store._notifySubscribers('column3.selectedActivity');

        // Auto-save selection to session
        store._saveColumn3Selection();

        // Hide generic form
        this._updateGenericForm(null);

        // Close dropdown
        this.isOpen = false;
        this.render();
    }

    /**
     * Show or hide the GenericActivityForm based on selection
     */
    _updateGenericForm(activityId) {
        const $container = $('#generic-activity-form-container');
        if (!$container.length) return;

        const isGeneric = activityId === 'generic' ||
            (activityId && activityId.startsWith('generic::'));

        if (isGeneric) {
            if (!this.genericActivityForm) {
                // First time — create and render
                this.genericActivityForm = new GenericActivityForm($container);
                this.genericActivityForm.render();
            }
            // Don't re-render if form already exists — it would clear fields

            // Only pre-populate if this is a NEW selection (not a save notification)
            if (activityId && activityId.startsWith('generic::') && !this.genericActivityForm.currentDefId) {
                const defId = activityId.replace('generic::', '');
                const def = this.savedGenericActivities.find(d => d.id === defId);
                if (def) {
                    this.genericActivityForm.populateFromSaved(def);
                }
            }

            $container.show();
        } else {
            if (this.genericActivityForm) {
                this.genericActivityForm.destroy();
                this.genericActivityForm = null;
            }
            $container.hide();
        }
    }

    /**
     * Sort activities within a skill group based on orderByLevel setting
     * @param {Array} activities - Activities array
     * @returns {Array} Sorted copy (or original if alphabetical)
     */
    _sortActivities(activities) {
        if (!this.orderByLevel) return activities;
        return [...activities].sort((a, b) => {
            const lvlA = a.requirements?.skill_requirements?.[a.primary_skill] || 1;
            const lvlB = b.requirements?.skill_requirements?.[b.primary_skill] || 1;
            return lvlA !== lvlB ? lvlA - lvlB : a.name.localeCompare(b.name);
        });
    }

    /**
     * Get filtered activities by search text
     * Requirements: 1.7
     * @returns {Object} Filtered activities by skill
     */
    getFilteredActivities() {
        if (!this.activitiesData) {
            return {};
        }

        const source = this.activitiesData.by_skill;

        if (!this.searchText) {
            const result = {};
            for (const [skill, activities] of Object.entries(source)) {
                result[skill] = this._sortActivities(activities);
            }
            return result;
        }

        const searchLower = this.searchText.toLowerCase();
        const filtered = {};

        for (const [skill, activities] of Object.entries(source)) {
            const matchingActivities = activities.filter(activity =>
                activity.name.toLowerCase().includes(searchLower)
            );

            if (matchingActivities.length > 0) {
                filtered[skill] = this._sortActivities(matchingActivities);
            }
        }

        return filtered;
    }

    /**
     * Get selected activity data for display
     * @returns {Object|null} Activity object or null
     */
    getSelectedActivity() {
        if (!this.selectedActivity || !this.activitiesData) {
            return null;
        }

        // Find activity by ID
        for (const activities of Object.values(this.activitiesData.by_skill)) {
            const activity = activities.find(a => a.id === this.selectedActivity);
            if (activity) {
                return activity;
            }
        }

        return null;
    }

    /**
     * Get selected activity name for display
     * @returns {string} Activity name or placeholder
     */
    getSelectedActivityName() {
        // Check for generic activity
        if (this.selectedActivity === 'generic') {
            return '🔧 Generic Activity';
        }
        if (this.selectedActivity && this.selectedActivity.startsWith('generic::')) {
            const def = this.savedGenericActivities.find(
                d => d.id === this.selectedActivity.replace('generic::', '')
            );
            if (def) {
                const iconHtml = def.icon_color ? window.tintedEmoji(def.icon || '⚡', def.icon_color) : (def.icon || '⚡');
                return `${iconHtml} ${def.name}`;
            }
            return '🔧 Generic Activity';
        }

        const activity = this.getSelectedActivity();

        if (!activity) {
            // Check if recipe is selected (mutual exclusion)
            if (store.state.column3?.selectedRecipe) {
                return 'Select an activity';
            }
            return 'Select an activity';
        }

        return activity.name;
    }

    /**
     * Render a skill category with activities
     * Requirements: 1.5
     * @param {string} skill - Skill name
     * @param {Array} activities - Activities in this skill
     * @returns {string} HTML for category
     */
    renderCategory(skill, activities) {
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

        // Render activity items
        const activityItems = isExpanded ? activities.map(activity => {
            // Get the primary skill level requirement
            const reqLevel = activity.requirements?.skill_requirements?.[activity.primary_skill] || 1;
            const charSkills = store.state.character?.skills || {};
            const charLevel = charSkills[activity.primary_skill?.toLowerCase()] || 1;
            const canDo = charLevel >= reqLevel;
            const levelClass = canDo ? 'level-ok' : 'level-too-high';

            return `
            <div class="activity-item" data-id="${activity.id}">
                <img src="${activity.icon_path}" alt="${activity.name}" class="activity-icon" />
                <span class="activity-name">${activity.name}</span>
                <span class="dropdown-level-badge ${levelClass}">Lv. ${reqLevel}</span>
            </div>
        `;
        }).join('') : '';

        return `
            <div class="activity-category">
                <div class="category-header" data-skill="${skill}">
                    ${skillIconHtml}
                    <span class="skill-name">${skill}</span>
                    ${arrowIcon}
                </div>
                ${activityItems}
            </div>
        `;
    }

    /**
     * Render the dropdown content
     * Requirements: 1.2, 1.3, 1.4, 1.5
     * @returns {string} HTML for dropdown
     */
    renderDropdown() {
        // Render wrapper with initial hidden state
        // jQuery slideUp/slideDown will manage visibility after that
        const content = this.isOpen ? this.renderDropdownContent() : '';

        return `
            <div class="activity-dropdown" style="display: none;">
                ${content}
            </div>
        `;
    }

    /**
     * Render just the dropdown content (without wrapper)
     * @returns {string} HTML for dropdown content
     */
    renderDropdownContent() {
        const filteredActivities = this.getFilteredActivities();

        // Sort skills alphabetically
        const sortedSkills = Object.keys(filteredActivities).sort();

        // Render categories
        const categories = sortedSkills.map(skill =>
            this.renderCategory(skill, filteredActivities[skill])
        ).join('');

        return `
            <input 
                type="text" 
                class="activity-search" 
                placeholder="Search activities..."
                value="${this.searchText}"
            />
            <div class="activity-list">
                <div class="activity-item none-option">
                    <span class="activity-name">None</span>
                </div>
                ${categories}
                ${window._featureFlags?.generic ? `
                <div class="activity-item generic-option" data-id="generic">
                    <span class="activity-icon generic-icon">🔧</span>
                    <span class="activity-name">Generic</span>
                </div>` : ''}
            </div>
        `;
    }

    /**
     * Render the component
     * Requirements: 1.1
     */
    render() {
        const selectedActivity = this.getSelectedActivity();
        const selectedName = this.getSelectedActivityName();
        const arrowIcon = `<span class="expand-arrow ${this.isOpen ? 'expanded' : ''}">▼</span>`;
        const dropdownHtml = this.renderDropdown();

        // Build dropdown value with icon if activity selected
        let dropdownValueHtml = '';
        if (selectedActivity) {
            dropdownValueHtml = `
                <img src="${selectedActivity.icon_path}" alt="${selectedActivity.name}" class="dropdown-activity-icon" />
                <span>${selectedName}</span>
            `;
        } else {
            dropdownValueHtml = `<span>${selectedName}</span>`;
        }

        const html = `
            <div class="activity-selector-dropdown" data-pin-id="activity-selector">
                <div class="dropdown-label-header">Activity</div>
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
        this.$element.on('input', '.activity-search', (e) => {
            e.stopPropagation();
            this.updateSearch($(e.target).val());
        });

        // Category header click (expand/collapse)
        this.$element.on('click', '.category-header', (e) => {
            e.stopPropagation();
            const skill = $(e.currentTarget).data('skill');
            this.toggleCategory(skill);
        });

        // Activity item click (select) — includes generic items
        this.$element.on('click', '.activity-item:not(.none-option):not(.generic-option)', (e) => {
            e.stopPropagation();
            const id = $(e.currentTarget).data('id');
            this.selectActivity(id);
        });

        // Generic option click
        this.$element.on('click', '.generic-option', (e) => {
            e.stopPropagation();
            this.selectActivity('generic');
        });

        // None option click (clear selection)
        this.$element.on('click', '.none-option', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });

        // Click outside to close dropdown
        $(document).on('click.activity-dropdown', (e) => {
            if (this.isOpen && !$(e.target).closest('.activity-selector-dropdown').length) {
                this.closeDropdown();
            }
        });

        // Listen for other dropdowns opening
        $(document).on('dropdown:opening.activity-dropdown', (e, data) => {
            if (data.source !== 'activity') {
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
        $(document).off('click.activity-dropdown');
        $(document).off('dropdown:opening.activity-dropdown');
        super.destroy();
    }
}

export default ActivitySelectorDropdown;
